import { PublicKey, TransactionError } from '@solana/web3.js';

export interface SwapSuccessResult {
  txid: string;
  inputAddress: PublicKey;
  outputAddress: PublicKey;
  inputAmount: number;
  outputAmount: number;
}

export interface SwapErrorResult {
  error: TransactionError;
}

export type SwapResult = SwapSuccessResult | SwapErrorResult;