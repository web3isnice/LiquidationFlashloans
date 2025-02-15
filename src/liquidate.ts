import {
  Account,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import {
  getObligations, getReserves, sortBorrows,
} from 'libs/utils';
import { getTokensOracleData } from 'libs/pyth';
import { Borrow, calculateRefreshedObligation } from 'libs/refreshObligation';
import { readSecret } from 'libs/secret';
import { liquidateAndRedeem } from 'libs/actions/liquidateAndRedeem';
import { Jupiter } from '@jup-ag/core';
import { unwrapTokens } from 'libs/unwrap/unwrapToken';
import { parseObligation } from '@solendprotocol/solend-sdk';
import { getMarkets } from './config';
import JSBI from 'jsbi';
import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import { JitoConnection } from './libs/jito';
import { BOT_CONFIG } from './config/settings';
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
import { CONSTANTS, ERROR_MESSAGES, SUCCESS_MESSAGES } from 'libs/constants';

dotenv.config();

async function swapProfitToSol(
  connection: JitoConnection,
  payer: Account,
  jupiter: Jupiter,
  usdcAmount: number
): Promise<string | undefined> {
  try {
    const swapAmount = Math.floor((usdcAmount - BOT_CONFIG.FINANCIAL.MIN_USDC_BUFFER) * 1e6);
    if (swapAmount <= 0) return undefined;

    logInfo(`Swapping ${usdcAmount - BOT_CONFIG.FINANCIAL.MIN_USDC_BUFFER} USDC to SOL`);

    const routes = await pTimeout(
      jupiter.computeRoutes({
        inputMint: BOT_CONFIG.TOKENS.USDC,
        outputMint: BOT_CONFIG.TOKENS.WSOL,
        amount: JSBI.BigInt(swapAmount),
        // No slippage check for maintenance swaps
        slippageBps: 10000 // Allow up to 100% slippage
      }),
      BOT_CONFIG.RPC.TIMEOUT_MS,
      'Route computation timed out'
    );

    if (routes.routesInfos.length === 0) {
      throw new SwapError('No routes found for USDC to SOL swap');
    }

    const { execute } = await jupiter.exchange({
      routeInfo: routes.routesInfos[0]
    });

    const result = await pTimeout(
      execute(),
      BOT_CONFIG.OPERATIONAL.TRANSACTION_TIMEOUT_MS,
      'Swap transaction timed out'
    );

    if ('error' in result) {
      throw new SwapError(result.error?.toString() || 'Unknown swap error');
    }

    const txHash = result.txid;
    
    logSuccess(SUCCESS_MESSAGES.SWAP_SUCCESS, { txHash });
    metrics.addProfit(usdcAmount);
    metrics.incrementSuccessfulSwaps();
    
    return txHash;
  } catch (error) {
    metrics.incrementFailedSwaps();
    if (error instanceof Error) {
      throw new SwapError(error.message, {
        usdcAmount,
        originalError: error
      });
    }
    throw error;
  }
}

async function runLiquidator() {
  try {
    const markets = await getMarkets();
    if (!markets || markets.length === 0) {
      throw new ConfigurationError(ERROR_MESSAGES.NO_MARKETS);
    }

    const connection = new JitoConnection(BOT_CONFIG.JITO_ENDPOINT, 'confirmed');
    
    if (!BOT_CONFIG.SECRET_PATH) {
      throw new ConfigurationError(ERROR_MESSAGES.NO_SECRET_PATH);
    }

    const payer = new Account(JSON.parse(readSecret('keypair')));

    const jupiter = await Jupiter.load({
      connection,
      cluster: 'mainnet-beta',
      user: Keypair.fromSecretKey(payer.secretKey),
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
          const tokensOracle = await getTokensOracleData(connection, market);
          const allObligations = await getObligations(connection, market.address);
          const allReserves = await getReserves(connection, market.address);

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
            error,
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
    logError('Fatal error in liquidator', { error });
    process.exit(1);
  }
}

runLiquidator();