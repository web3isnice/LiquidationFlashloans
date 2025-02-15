import { Keypair, Connection } from '@solana/web3.js';
import { Jupiter } from '@jup-ag/core';
import JSBI from 'jsbi';
import pTimeout from 'p-timeout';
import { BOT_CONFIG } from '../config/settings';
import { SwapError } from './errors';
import { logInfo, logSuccess, metrics } from './logger';
import { SUCCESS_MESSAGES } from './constants';
import { SwapResult, SwapSuccessResult } from '../types/jupiter';

export async function swapProfitToSol(
  connection: Connection,
  payer: Keypair,
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
    ) as SwapResult;

    if ('error' in result) {
      throw new SwapError(result.error?.toString() || 'Unknown swap error');
    }

    const successResult = result as SwapSuccessResult;
    const txHash = successResult.txid;
    
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