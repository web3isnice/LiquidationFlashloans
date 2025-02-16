import { Keypair, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { findAssociatedTokenAddress } from 'libs/utils';
import { createFlashLoanInstructions } from 'libs/flashLoan';
import { refreshObligationInstruction, refreshReserveInstruction, LiquidateObligationAndRedeemReserveCollateral } from 'models/instructions';
import { logAction } from 'libs/logger';
import BN from 'bn.js';

export async function liquidateAndRedeem(
  connection: Connection,
  payer: Keypair,
  borrowAmount: string | BN,
  borrowSymbol: string,
  withdrawSymbol: string,
  market: any,
  obligation: any,
): Promise<{ txHash: string; profit: number }> {
  // Convert borrowAmount to BN if it's a string
  const borrowAmountBN = typeof borrowAmount === 'string' ? new BN(borrowAmount) : borrowAmount;

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
    borrowAmountBN,
    userBorrowTokenAccount,
    market,
    payer.publicKey,
  );

  // Get liquidation instructions
  const liquidateIx = LiquidateObligationAndRedeemReserveCollateral(
    borrowAmountBN,
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
    maxRetries: 0
  });

  // Calculate profit
  const profit = calculateProfit(borrowAmountBN.toString(), withdrawSymbol, market);

  return { txHash, profit };
}

function calculateProfit(borrowAmount: string, withdrawSymbol: string, market: any): number {
  // Profit calculation logic here
  return 0; // Placeholder
}