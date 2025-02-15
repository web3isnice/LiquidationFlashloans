import { Account, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { Jupiter } from '@jup-ag/core';
import { findAssociatedTokenAddress, toBaseUnit } from 'libs/utils';
import { createFlashLoanInstructions } from 'libs/flashLoan';
import { refreshObligationInstruction, refreshReserveInstruction, LiquidateObligationAndRedeemReserveCollateral } from 'models/instructions';
import { logAction } from 'libs/logger';
import JSBI from 'jsbi';

export async function liquidateAndRedeem(
  connection: Connection,
  payer: Account,
  borrowAmount: string,
  borrowSymbol: string,
  withdrawSymbol: string,
  market: any,
  obligation: any,
  jupiter: Jupiter,
): Promise<{ txHash: string; profit: number }> {
  // Get token accounts
  const userBorrowTokenAccount = await findAssociatedTokenAddress(
    payer.publicKey,
    new PublicKey(market.reserves.find((r) => r.liquidityToken.symbol === borrowSymbol).liquidityToken.mint),
  );

  const userWithdrawTokenAccount = await findAssociatedTokenAddress(
    payer.publicKey,
    new PublicKey(market.reserves.find((r) => r.liquidityToken.symbol === withdrawSymbol).liquidityToken.mint),
  );

  // Get flash loan instructions
  const { borrowInstruction, repayInstruction } = await createFlashLoanInstructions(
    borrowAmount,
    userBorrowTokenAccount,
    market,
    payer.publicKey,
  );

  // Get liquidation instructions
  const liquidateIx = LiquidateObligationAndRedeemReserveCollateral(
    borrowAmount,
    userBorrowTokenAccount,
    userWithdrawTokenAccount,
    userBorrowTokenAccount,
    obligation.info.borrowedAssets[0].mintAddress,
    obligation.info.borrowedAssets[0].tokenAccount,
    obligation.info.collateralAssets[0].mintAddress,
    obligation.info.collateralAssets[0].tokenMint,
    obligation.info.collateralAssets[0].tokenAccount,
    obligation.info.collateralAssets[0].liquiditySupply,
    obligation.info.collateralAssets[0].feeReceiver,
    obligation.pubkey,
    market.address,
    market.authorityAddress,
    payer.publicKey,
  );

  // Compose transaction
  const tx = new Transaction();
  tx.add(borrowInstruction);
  tx.add(liquidateIx);
  tx.add(repayInstruction);

  // Get latest blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  logAction('Executing liquidation transaction');
  const txHash = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 0,
    bundleOnly: true
  });

  // Calculate profit
  const profit = calculateProfit(borrowAmount, withdrawSymbol, market);

  return { txHash, profit };
}

function calculateProfit(borrowAmount: string, withdrawSymbol: string, market: any): number {
  // Profit calculation logic here
  return 0; // Placeholder
}