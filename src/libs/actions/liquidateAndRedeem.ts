import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token-v2';
import {
  Account,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getTokenInfoFromMarket,
} from 'libs/utils';
import { findWhere, map } from 'underscore';
import { refreshReserveInstruction } from 'models/instructions/refreshReserve';
import { LiquidateObligationAndRedeemReserveCollateral } from 'models/instructions/LiquidateObligationAndRedeemReserveCollateral';
import { refreshObligationInstruction } from 'models/instructions/refreshObligation';
import { MarketConfig, MarketConfigReserve } from 'global';
import { createFlashLoanInstructions } from '../flashLoan';
import { Jupiter } from '@jup-ag/core';
import BN from 'bn.js';
import JSBI from 'jsbi';

const FLASH_LOAN_BUFFER = 1.3; // 30% buffer for fees and price movements
const SLIPPAGE_BPS = 50; // 0.5% slippage for Jupiter swaps
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const liquidateAndRedeem = async (
  connection: Connection,
  payer: Account,
  liquidityAmount: number | string,
  repayTokenSymbol: string,
  withdrawTokenSymbol: string,
  lendingMarket: MarketConfig,
  obligation: any,
  jupiter: Jupiter,
) => {
  try {
    const ixs: TransactionInstruction[] = [];

    const depositReserves = map(obligation.info.deposits, (deposit) => deposit.depositReserve);
    const borrowReserves = map(obligation.info.borrows, (borrow) => borrow.borrowReserve);
    const uniqReserveAddresses = [...new Set<String>(map(depositReserves.concat(borrowReserves), (reserve) => reserve.toString()))];
    
    // Get initial USDC balance
    const repayTokenInfo = getTokenInfoFromMarket(lendingMarket, repayTokenSymbol);
    const repayAccount = await getAssociatedTokenAddress(
      new PublicKey(repayTokenInfo.mintAddress),
      payer.publicKey,
    );
    const initialBalance = await connection.getTokenAccountBalance(repayAccount);
    const initialUsdcAmount = initialBalance.value.uiAmount || 0;

    // Refresh reserves
    for (const reserveAddress of uniqReserveAddresses) {
      const reserveInfo: MarketConfigReserve = findWhere(lendingMarket!.reserves, {
        address: reserveAddress,
      });
      if (!reserveInfo) {
        throw new Error(`Reserve info not found for address ${reserveAddress}`);
      }
      const refreshReserveIx = refreshReserveInstruction(
        new PublicKey(reserveAddress),
        new PublicKey(reserveInfo.pythOracle),
        new PublicKey(reserveInfo.switchboardOracle),
      );
      ixs.push(refreshReserveIx);
    }

    const refreshObligationIx = refreshObligationInstruction(
      obligation.pubkey,
      depositReserves,
      borrowReserves,
    );
    ixs.push(refreshObligationIx);

    if (!repayTokenInfo) {
      throw new Error(`Token info not found for ${repayTokenSymbol}`);
    }

    const reserveSymbolToReserveMap = new Map<string, MarketConfigReserve>(
      lendingMarket.reserves.map((reserve) => [reserve.liquidityToken.symbol, reserve]),
    );

    const repayReserve: MarketConfigReserve | undefined = reserveSymbolToReserveMap.get(repayTokenSymbol);
    const withdrawReserve: MarketConfigReserve | undefined = reserveSymbolToReserveMap.get(withdrawTokenSymbol);
    const withdrawTokenInfo = getTokenInfoFromMarket(lendingMarket, withdrawTokenSymbol);

    if (!withdrawReserve || !repayReserve) {
      throw new Error(`Required reserves not found. Repay: ${repayTokenSymbol}, Withdraw: ${withdrawTokenSymbol}`);
    }

    const rewardedWithdrawalCollateralAccount = await getAssociatedTokenAddress(
      new PublicKey(withdrawReserve.collateralMintAddress),
      payer.publicKey,
    );
    const rewardedWithdrawalCollateralAccountInfo = await connection.getAccountInfo(
      rewardedWithdrawalCollateralAccount,
    );
    if (!rewardedWithdrawalCollateralAccountInfo) {
      const createUserCollateralAccountIx = createAssociatedTokenAccountInstruction(
        payer.publicKey,
        rewardedWithdrawalCollateralAccount,
        payer.publicKey,
        new PublicKey(withdrawReserve.collateralMintAddress),
      );
      ixs.push(createUserCollateralAccountIx);
    }

    const rewardedWithdrawalLiquidityAccount = await getAssociatedTokenAddress(
      new PublicKey(withdrawTokenInfo.mintAddress),
      payer.publicKey,
    );
    const rewardedWithdrawalLiquidityAccountInfo = await connection.getAccountInfo(
      rewardedWithdrawalLiquidityAccount,
    );
    if (!rewardedWithdrawalLiquidityAccountInfo) {
      const createUserCollateralAccountIx = createAssociatedTokenAccountInstruction(
        payer.publicKey,
        rewardedWithdrawalLiquidityAccount,
        payer.publicKey,
        new PublicKey(withdrawTokenInfo.mintAddress),
      );
      ixs.push(createUserCollateralAccountIx);
    }

    // Calculate flash loan amount with buffer
    const flashLoanAmount = new BN(Number(liquidityAmount) * FLASH_LOAN_BUFFER);

    // Get flash loan instructions
    const { borrowInstruction, repayInstruction } = await createFlashLoanInstructions(
      flashLoanAmount,
      repayAccount,
      lendingMarket,
      payer.publicKey,
    );

    // Add flash loan borrow instruction
    ixs.push(borrowInstruction);

    // Add liquidation instruction
    ixs.push(
      LiquidateObligationAndRedeemReserveCollateral(
        liquidityAmount,
        repayAccount,
        rewardedWithdrawalCollateralAccount,
        rewardedWithdrawalLiquidityAccount,
        new PublicKey(repayReserve.address),
        new PublicKey(repayReserve.liquidityAddress),
        new PublicKey(withdrawReserve.address),
        new PublicKey(withdrawReserve.collateralMintAddress),
        new PublicKey(withdrawReserve.collateralSupplyAddress),
        new PublicKey(withdrawReserve.liquidityAddress),
        new PublicKey(withdrawReserve.liquidityFeeReceiverAddress),
        obligation.pubkey,
        new PublicKey(lendingMarket.address),
        new PublicKey(lendingMarket.authorityAddress),
        payer.publicKey,
      ),
    );

    // Get Jupiter swap route for collateral -> USDC
    const routes = await jupiter.computeRoutes({
      inputMint: new PublicKey(withdrawTokenInfo.mintAddress),
      outputMint: new PublicKey(repayTokenInfo.mintAddress),
      amount: JSBI.BigInt(flashLoanAmount.toString()),
      slippageBps: SLIPPAGE_BPS,
    });

    if (routes.routesInfos.length === 0) {
      throw new Error(`No swap route found from ${withdrawTokenSymbol} to ${repayTokenSymbol}`);
    }

    // Execute the swap
    const { execute } = await jupiter.exchange({
      routeInfo: routes.routesInfos[0],
    });

    const swapResult = await execute();

    if ('error' in swapResult) {
      throw new Error(`Swap failed: ${swapResult.error}`);
    }

    // Add flash loan repay instruction
    ixs.push(repayInstruction);

    const tx = new Transaction().add(...ixs);
    const { blockhash } = await connection.getRecentBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    // Simulate transaction first to catch potential errors
    const simulation = await connection.simulateTransaction(tx);
    if (simulation.value.err) {
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const txHash = await connection.sendRawTransaction(tx.serialize(), { 
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    
    await connection.confirmTransaction(txHash, 'confirmed');

    // After successful liquidation, check profit
    const finalBalance = await connection.getTokenAccountBalance(repayAccount);
    const finalUsdcAmount = finalBalance.value.uiAmount || 0;
    const profit = finalUsdcAmount - initialUsdcAmount;

    console.log(`
      Liquidation successful:
      - Transaction: ${txHash}
      - Initial USDC: ${initialUsdcAmount}
      - Final USDC: ${finalUsdcAmount}
      - Profit: ${profit} USDC
    `);

    return {
      txHash,
      profit,
    };
  } catch (error) {
    console.error('Liquidation failed:', {
      error: error.message,
      obligation: obligation.pubkey.toString(),
      repayToken: repayTokenSymbol,
      withdrawToken: withdrawTokenSymbol,
      liquidityAmount: liquidityAmount.toString(),
      stack: error.stack,
    });
    throw error;
  }
};