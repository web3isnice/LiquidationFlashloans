import {
  Keypair,
  Connection,
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
    logInfo('Starting initial setup check...');
    // This will throw if the keypair is invalid
    const payer = createKeypairFromSecret('keypair');
    logInfo('Keypair loaded successfully', { publicKey: payer.publicKey.toString() });
    
    // Validate environment variables
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

async function checkHealth(connection: Connection, payer: Keypair) {
  try {
    logInfo('Starting health check...');
    
    // Get latest blockhash first to verify RPC connection
    logInfo('Checking RPC connection...');
    const { blockhash } = await connection.getLatestBlockhash()
      .catch((error) => {
        throw new RpcError(`${ERROR_MESSAGES.RPC_ERROR}: ${error.message}`);
      });

    if (!blockhash) {
      throw new RpcError('Failed to get latest blockhash');
    }
    logInfo('RPC connection verified');

    // Check SOL balance with retry
    let retryCount = 0;
    const maxRetries = 3;
    let solBalance;

    logInfo('Checking SOL balance...');
    while (retryCount < maxRetries) {
      try {
        solBalance = await connection.getBalance(payer.publicKey, 'confirmed');
        break;
      } catch (error) {
        retryCount++;
        logWarning(`Failed to get balance (attempt ${retryCount}/${maxRetries})`, { error });
        if (retryCount === maxRetries) {
          throw new RpcError(`Failed to get balance after ${maxRetries} attempts: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
      }
    }

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

    // Create regular Solana connection for standard RPC operations
    logInfo('Connecting to Solana RPC...', { endpoint: BOT_CONFIG.SOLANA_RPC_ENDPOINT });
    const connection = new Connection(BOT_CONFIG.SOLANA_RPC_ENDPOINT, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: BOT_CONFIG.OPERATIONAL.TRANSACTION_TIMEOUT_MS
    });

    // Create Jito connection for transactions and bundles
    logInfo('Connecting to Jito RPC...', { endpoint: BOT_CONFIG.JITO_ENDPOINT });
    const jitoConnection = new JitoConnection(BOT_CONFIG.JITO_ENDPOINT, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: BOT_CONFIG.OPERATIONAL.TRANSACTION_TIMEOUT_MS
    });
    
    if (!BOT_CONFIG.SECRET_PATH) {
      throw new ConfigurationError(ERROR_MESSAGES.NO_SECRET_PATH);
    }

    const payer = createKeypairFromSecret('keypair');

    // Initial health check using regular Solana RPC
    const isHealthy = await checkHealth(connection, payer);
    if (!isHealthy) {
      throw new Error(ERROR_MESSAGES.HEALTH_CHECK_FAILED);
    }
    
    logInfo('Initializing Jupiter SDK...');
    const jupiter = await Jupiter.load({
      connection, // Use regular Solana RPC for Jupiter
      cluster: 'mainnet-beta',
      user: payer,
      wrapUnwrapSOL: false,
    });

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
          // Periodic health check using regular Solana RPC
          const isHealthy = await checkHealth(connection, payer);
          if (!isHealthy) {
            throw new Error(ERROR_MESSAGES.HEALTH_CHECK_FAILED);
          }

          logInfo(`Fetching data for market ${market.name}...`);
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
                  jitoConnection, // Use Jito connection for transactions
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