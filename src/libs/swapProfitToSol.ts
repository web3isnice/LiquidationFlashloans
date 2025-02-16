import { Keypair, Connection } from '@solana/web3.js';
import { BOT_CONFIG } from '../config/settings';
import { SwapError } from './errors';
import { logInfo, logSuccess, metrics } from './logger';
import { SUCCESS_MESSAGES } from '../constants';
import { swap } from './swap';

export async function swapProfitToSol(
  connection: Connection,
  payer: Keypair,
  usdcAmount: number
): Promise<string | undefined> {
  try {
    const swapAmount = Math.floor((usdcAmount - BOT_CONFIG.FINANCIAL.MIN_USDC_BUFFER) * 1e6);
    if (swapAmount <= 0) return undefined;

    logInfo(`Swapping ${usdcAmount - BOT_CONFIG.FINANCIAL.MIN_USDC_BUFFER} USDC to SOL`);

    const txHash = await swap(
      connection,
      payer,
      BOT_CONFIG.TOKENS.USDC,
      BOT_CONFIG.TOKENS.WSOL,
      swapAmount,
      100 // 1% slippage for maintenance swaps
    );
    
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