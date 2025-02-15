import { PublicKey, TransactionError } from '@solana/web3.js';

export interface SwapSuccessResult {
  txid: string;
  inputAddress: PublicKey;
  outputAddress: PublicKey;
  inputAmount: number;
  outputAmount: number;
}

export interface SwapErrorResult {
  error: TransactionError | undefined;
}

export type SwapResult = SwapSuccessResult | SwapErrorResult;