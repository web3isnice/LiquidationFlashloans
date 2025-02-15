import {
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import {
  getObligations, getReserves,
} from 'libs/utils';
import { getTokensOracleData } from 'libs/pyth';
import { createKeypairFromSecret } from 'libs/secret';
import { Jupiter } from '@jup-ag/core';
import { unwrapTokens } from 'libs/unwrap/unwrapToken';
import { getMarkets } from './config';
import { BOT_CONFIG } from './config/settings';
import { JitoConnection } from './libs/jito';
import { 
  ConfigurationError, 
  InsufficientFundsError,
  LiquidationError,
  RpcError,
  SwapError,
  TimeoutError,
  TransactionError 
} from 'libs/errors';
import { 
  logger,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  metrics
} from 'libs/logger';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from 'libs/constants';
import { processObligation } from 'libs/processObligation';

dotenv.config();

async function checkInitialSetup() {
  try {
    // This will throw if the keypair is invalid
    const payer = createKeypairFromSecret('keypair');
    
    // Validate environment variables
    if (!BOT_CONFIG.ENV) {
      throw new ConfigurationError('APP environment variable is not set');
    }
    if (!['production', 'devnet'].includes(BOT_CONFIG.ENV)) {
      throw new ConfigurationError('APP must be either "production" or "devnet"');
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new ConfigurationError(`Failed to read or parse keypair file: ${error.message}`);
    }
    throw error;
  }
}

async function checkHealth(connection: JitoConnection, payer: Keypair) {
  try {
    // Check SOL balance
    const solBalance = await connection.getBalance(payer.publicKey);
    if (solBalance < BOT_CONFIG.FINANCIAL.MIN_SOL_BALANCE) {
      throw new InsufficientFundsError(ERROR_MESSAGES.INSUFFICIENT_SOL);
    }

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed / 1024 / 1024 > BOT_CONFIG.HEALTH_CHECK.MAX_MEMORY_MB) {
      logWarning('High memory usage detected', {
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
      });
    }

    // Check RPC connection by getting latest blockhash
    const { blockhash } = await connection.getLatestBlockhash()
      .catch((error) => {
        throw new RpcError(`${ERROR_MESSAGES.RPC_ERROR}: ${error.message}`);
      });

    if (!blockhash) {
      throw new RpcError('Failed to get latest blockhash');
    }

    logInfo('Health check passed', {
      solBalance: solBalance / 1e9,
      memoryUsage: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      endpoint: connection.rpcEndpoint
    });

    return true;
  } catch (error) {
    logError(ERROR_MESSAGES.HEALTH_CHECK_FAILED, { 
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error 
    });
    return false;
  }
}

async function runLiquidator() {
  try {
    // Initial setup validation
    await checkInitialSetup();

    const markets = await getMarkets();
    if (!markets || markets.length === 0) {
      throw new ConfigurationError(ERROR_MESSAGES.NO_MARKETS);
    }

    // Create Jito connection
    const connection = new JitoConnection(BOT_CONFIG.JITO_ENDPOINT, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: BOT_CONFIG.OPERATIONAL.TRANSACTION_TIMEOUT_MS
    });
    
    if (!BOT_CONFIG.SECRET_PATH) {
      throw new ConfigurationError(ERROR_MESSAGES.NO_SECRET_PATH);
    }

    const payer = createKeypairFromSecret('keypair');

    // Initial health check
    const isHealthy = await checkHealth(connection, payer);
    if (!isHealthy) {
      throw new Error(ERROR_MESSAGES.HEALTH_CHECK_FAILED);
    }
    
    const jupiter = await Jupiter.load({
      connection,
      cluster: 'mainnet-beta',
      user: payer,
      wrapUnwrapSOL: false,
    });

    logInfo(SUCCESS_MESSAGES.STARTUP, {
      environment: BOT_CONFIG.ENV,
      jitoEndpoint: BOT_CONFIG.JITO_ENDPOINT,
      wallet: payer.publicKey.toBase58(),
      marketCount: markets.length,
      solBalance: await connection.getBalance(payer.publicKey) / 1e9
    });

    let consecutiveErrors = 0;

    for (let epoch = 0; ; epoch += 1) {
      for (const market of markets) {
        try {
          // Periodic health check
          const isHealthy = await checkHealth(connection, payer);
          if (!isHealthy) {
            throw new Error(ERROR_MESSAGES.HEALTH_CHECK_FAILED);
          }

          const tokensOracle = await getTokensOracleData(connection, market);
          if (!tokensOracle || tokensOracle.length === 0) {
            throw new Error('Failed to fetch token oracle data');
          }

          const allObligations = await getObligations(connection, market.address);
          if (!allObligations) {
            throw new Error('Failed to fetch obligations');
          }

          const allReserves = await getReserves(connection, market.address);
          if (!allReserves) {
            throw new Error('Failed to fetch reserves');
          }

          logInfo('Processing market', {
            marketAddress: market.address,
            obligationCount: allObligations.length,
            reserveCount: allReserves.length
          });

          for (let i = 0; i < allObligations.length; i += BOT_CONFIG.OPERATIONAL.LIQUIDATION_BATCH_SIZE) {
            const batch = allObligations.slice(i, i + BOT_CONFIG.OPERATIONAL.LIQUIDATION_BATCH_SIZE);
            await Promise.all(
              batch.map(obligation => 
                processObligation(
                  obligation,
                  connection,
                  payer,
                  jupiter,
                  market,
                  allReserves,
                  tokensOracle
                ).catch(error => {
                  logError('Error processing obligation', {
                    error,
                    obligationId: obligation?.pubkey.toString(),
                    market: market.address
                  });
                })
              )
            );
          }

          await unwrapTokens(connection, payer);
          consecutiveErrors = 0;

          if (BOT_CONFIG.THROTTLE) {
            await new Promise(resolve => setTimeout(resolve, BOT_CONFIG.THROTTLE));
          }

        } catch (error) {
          consecutiveErrors++;
          
          logError('Error processing market', {
            error: error instanceof Error ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            } : error,
            market: market.address,
            consecutiveErrors
          });

          if (consecutiveErrors >= BOT_CONFIG.ERROR_HANDLING.MAX_CONSECUTIVE_ERRORS) {
            logError('Too many consecutive errors, waiting before retry');
            await new Promise(resolve => setTimeout(resolve, BOT_CONFIG.ERROR_HANDLING.ERROR_COOLDOWN_MS));
            consecutiveErrors = 0;
          }
        }
      }
    }
  } catch (error) {
    logError('Fatal error in liquidator', { 
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error as any)
      } : error
    });
    process.exit(1);
  }
}

runLiquidator();