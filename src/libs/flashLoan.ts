import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import {
  flashBorrowReserveLiquidityInstruction,
  flashRepayReserveLiquidityInstruction,
} from '@solendprotocol/solend-sdk';
import { findWhere } from 'underscore';
import { MarketConfig } from 'global';

// Specific USDC reserve addresses
const USDC_RESERVE = {
  RESERVE_ADDRESS: new PublicKey('EjUgEaPpKMg2nqex9obb46gZQ6Ar9mWSdVKbw9A6PyXA'),
  LIQUIDITY_ADDRESS: new PublicKey('49mYvAcRHFYnHt3guRPsxecFqBAY8frkGSFuXRL3cqfC'),
  LENDING_MARKET: new PublicKey('7RCz8wb6WXxUhAigok9ttgrVgDFFFbibcirECzWSBauM'),
  LENDING_PROGRAM_ID: new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'),
  FEE_RECEIVER_ADDRESS: new PublicKey('5Gdxn4yquneifE6uk9tK8X4CqHfWKjW2BvYU25hAykwP'),
};

export async function createFlashLoanInstructions(
  borrowAmount: BN,
  userTokenAccount: PublicKey,
  market: MarketConfig,
  payer: PublicKey,
) {
  // Create flash loan borrow instruction using specific USDC reserve
  const borrowInstruction = flashBorrowReserveLiquidityInstruction(
    borrowAmount,
    USDC_RESERVE.LIQUIDITY_ADDRESS,
    userTokenAccount,
    USDC_RESERVE.RESERVE_ADDRESS,
    USDC_RESERVE.LENDING_MARKET,
    USDC_RESERVE.LENDING_PROGRAM_ID,
  );

  // Create flash loan repay instruction
  const repayInstruction = flashRepayReserveLiquidityInstruction(
    borrowAmount,
    0, // Borrow instruction index
    userTokenAccount,
    USDC_RESERVE.LIQUIDITY_ADDRESS,
    USDC_RESERVE.FEE_RECEIVER_ADDRESS,
    userTokenAccount, // Host fee receiver (using same account as we don't need host fees)
    USDC_RESERVE.RESERVE_ADDRESS,
    USDC_RESERVE.LENDING_MARKET,
    payer,
    USDC_RESERVE.LENDING_PROGRAM_ID,
  );

  return {
    borrowInstruction,
    repayInstruction,
  };
}