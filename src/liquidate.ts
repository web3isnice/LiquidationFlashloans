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
    logInfo('Starting initial setup check...');
    const payer = createKeypairFromSecret('keypair');
    logInfo('Keypair loaded successfully', { publicKey: payer.publicKey.toString() });
    
    if (!BOT_CONFIG.ENV) {
      throw new ConfigurationError('APP environment variable is not set');
    }
    if (!['production', 'devnet'].includes(BOT_CONFIG.ENV)) {
      throw new ConfigurationError('APP must be either "production" or "devnet"');
    }
    logSuccess('Initial setup check passed');
  } catch (error) {
    if (error instanceof Error) {
      throw new ConfigurationError(`Failed to read or parse keypair file: ${error.message}`);
    }
    throw error;
  }
}

async function checkHealth(connection: JitoConnection, payer: Keypair) {
  try {
    logInfo('Starting health check...');
    
    // Check SOL balance
    const solBalance = await connection.getBalance(payer.publicKey);
    if (solBalance < BOT_CONFIG.FINANCIAL.MIN_SOL_BALANCE) {
      throw new InsufficientFundsError(ERROR_MESSAGES.INSUFFICIENT_SOL);
    }
    logInfo('SOL balance check passed', { balance: solBalance / 1e9 });

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed / 1024 / 1024 > BOT_CONFIG.HEALTH_CHECK.MAX_MEMORY_MB) {
      logWarning('High memory usage detected', {
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
      });
    }

    // Check RPC connection by getting latest blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    if (!blockhash) {
      throw new RpcError('Failed to get latest blockhash');
    }
    logInfo('RPC connection verified');

    logSuccess('Health check passed', {
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
    logInfo('Starting liquidator bot...');
    
    // Initial setup validation
    await checkInitialSetup();

    logInfo('Fetching markets...');
    const markets = await getMarkets();
    if (!markets || markets.length === 0) {
      throw new ConfigurationError(ERROR_MESSAGES.NO_MARKETS);
    }
    logInfo(`Found ${markets.length} markets`);

    // Create Jito connection with both endpoints
    logInfo('Initializing Jito connection...', { 
      jitoEndpoint: BOT_CONFIG.JITO_ENDPOINT,
      solanaEndpoint: BOT_CONFIG.SOLANA_RPC_ENDPOINT
    });
    
    const connection = new JitoConnection(
      BOT_CONFIG.JITO_ENDPOINT,
      BOT_CONFIG.SOLANA_RPC_ENDPOINT,
      {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: BOT_CONFIG.OPERATIONAL.TRANSACTION_TIMEOUT_MS
      }
    );
    
    if (!BOT_CONFIG.SECRET_PATH) {
      throw new ConfigurationError(ERROR_MESSAGES.NO_SECRET_PATH);
    }

    const payer = createKeypairFromSecret('keypair');

    // Initial health check
    const isHealthy = await checkHealth(connection, payer);
    if (!isHealthy) {
      throw new Error(ERROR_MESSAGES.HEALTH_CHECK_FAILED);
    }

    logSuccess(SUCCESS_MESSAGES.STARTUP, {
      environment: BOT_CONFIG.ENV,
      jitoEndpoint: BOT_CONFIG.JITO_ENDPOINT,
      solanaEndpoint: BOT_CONFIG.SOLANA_RPC_ENDPOINT,
      wallet: payer.publicKey.toBase58(),
      marketCount: markets.length,
      solBalance: await connection.getBalance(payer.publicKey) / 1e9
    });

    let consecutiveErrors = 0;
    let epoch = 0;

    logInfo('Starting main liquidation loop...');
    while (true) {
      logInfo(`Starting epoch ${epoch}`);
      for (const market of markets) {
        try {
          // Periodic health check
          const isHealthy = await checkHealth(connection, payer);
          if (!isHealthy) {
            throw new Error(ERROR_MESSAGES.HEALTH_CHECK_FAILED);
          }

          logInfo(`Processing market: ${market.name}`);
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

          logInfo('Market data fetched', {
            marketName: market.name,
            marketAddress: market.address,
            obligationCount: allObligations.length,
            reserveCount: allReserves.length
          });

          for (let i = 0; i < allObligations.length; i += BOT_CONFIG.OPERATIONAL.LIQUIDATION_BATCH_SIZE) {
            const batch = allObligations.slice(i, i + BOT_CONFIG.OPERATIONAL.LIQUIDATION_BATCH_SIZE);
            logInfo(`Processing batch ${Math.floor(i/BOT_CONFIG.OPERATIONAL.LIQUIDATION_BATCH_SIZE) + 1}/${Math.ceil(allObligations.length/BOT_CONFIG.OPERATIONAL.LIQUIDATION_BATCH_SIZE)}`);
            
            await Promise.all(
              batch.map(obligation => 
                processObligation(
                  obligation,
                  connection,
                  payer,
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

          logInfo('Unwrapping tokens...');
          await unwrapTokens(connection, payer);
          consecutiveErrors = 0;

          if (BOT_CONFIG.THROTTLE) {
            logInfo(`Throttling for ${BOT_CONFIG.THROTTLE}ms before next market`);
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
            logWarning(`Too many consecutive errors (${consecutiveErrors}), cooling down...`);
            await new Promise(resolve => setTimeout(resolve, BOT_CONFIG.ERROR_HANDLING.ERROR_COOLDOWN_MS));
            consecutiveErrors = 0;
          }
        }
      }
      epoch++;
      logInfo(`Completed epoch ${epoch}`);
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

// Start the liquidator
runLiquidator().catch(error => {
  logError('Unhandled error in liquidator', { error });
  process.exit(1);
});