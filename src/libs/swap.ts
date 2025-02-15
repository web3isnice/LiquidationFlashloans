import { Jupiter } from '@jup-ag/core';
import {
  Connection, Keypair, PublicKey,
} from '@solana/web3.js';
import JSBI from 'jsbi';

const SLIPPAGE_BPS = 200; // 2% slippage
const SWAP_TIMEOUT_SEC = 20;

interface SwapSuccessResult {
  txid: string;
  inputAddress: PublicKey;
  outputAddress: PublicKey;
  inputAmount: number;
  outputAmount: number;
}

interface SwapErrorResult {
  error: string;
}

type SwapResult = SwapSuccessResult | SwapErrorResult;

export default async function swap(connection: Connection, wallet: Keypair, jupiter: Jupiter, fromTokenInfo, toTokenInfo, amount: number) {
  console.log({
    fromToken: fromTokenInfo.symbol,
    toToken: toTokenInfo.symbol,
    amount: amount.toString(),
  }, 'swapping tokens');

  const inputMint = new PublicKey(fromTokenInfo.mintAddress);
  const outputMint = new PublicKey(toTokenInfo.mintAddress);
  const routes = await jupiter.computeRoutes({
    inputMint,
    outputMint,
    amount: JSBI.BigInt(amount.toString()),
    slippageBps: SLIPPAGE_BPS,
  });

  if (routes.routesInfos.length === 0) {
    throw new Error(`No routes found for ${fromTokenInfo.symbol} to ${toTokenInfo.symbol}`);
  }

  // Execute swap
  const { execute } = await jupiter.exchange({
    routeInfo: routes.routesInfos[0],
  });

  // Execute swap with timeout
  const swapResult = await new Promise<SwapResult>((resolve, reject) => {
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error(`Swap took longer than ${SWAP_TIMEOUT_SEC} seconds to complete.`);
      reject(new Error('Swap timed out'));
    }, SWAP_TIMEOUT_SEC * 1000);

    execute().then((result) => {
      if (!timedOut) {
        clearTimeout(timeoutHandle);
        if ('error' in result) {
          reject(new Error(`Swap failed: ${result.error}`));
        } else {
          const successResult = result as SwapSuccessResult;
          console.log({
            tx: successResult.txid,
            inputAmount: amount / Number(fromTokenInfo.decimals),
            outputAmount: successResult.outputAmount / Number(toTokenInfo.decimals),
            inputToken: fromTokenInfo.symbol,
            outputToken: toTokenInfo.symbol,
          }, 'successfully swapped token');
          resolve(successResult);
        }
      }
    }).catch((error) => {
      if (!timedOut) {
        clearTimeout(timeoutHandle);
        console.error({
          error: error.message,
          fromToken: fromTokenInfo.symbol,
          toToken: toTokenInfo.symbol,
        }, 'error swapping');
        reject(error);
      }
    });
  });

  return swapResult;
}
