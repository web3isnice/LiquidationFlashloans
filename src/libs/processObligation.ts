import { Keypair, Connection } from '@solana/web3.js';
import { Jupiter } from '@jup-ag/core';
import { calculateRefreshedObligation } from './refreshObligation';
import { liquidateAndRedeem } from './actions/liquidateAndRedeem';
import { logError, logInfo, logSuccess, logWarning, metrics } from './logger';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from './constants';
import { BOT_CONFIG } from '../config/settings';
import { swapProfitToSol } from './swapProfitToSol';
import { parseObligation } from '@solendprotocol/solend-sdk';
import { LiquidationError } from './errors';
import pRetry from 'p-retry';

export async function processObligation(
  obligation: any,
  connection: Connection,
  payer: Keypair,
  jupiter: Jupiter,
  market: any,
  allReserves: any[],
  tokensOracle: any[]
) {
  try {
    let currentObligation = obligation;
    
    while (currentObligation) {
      const {
        borrowedValue,
        unhealthyBorrowValue,
        deposits,
        borrows,
      } = calculateRefreshedObligation(
        currentObligation.info,
        allReserves,
        tokensOracle,
      );

      // Skip if obligation is healthy
      if (borrowedValue.isLessThanOrEqualTo(unhealthyBorrowValue)) {
        break;
      }

      // Select repay token with highest market value
      const selectedBorrow = borrows[0];

      // Select withdrawal collateral token with highest market value
      let selectedDeposit;
      deposits.forEach((deposit) => {
        if (!selectedDeposit || deposit.marketValue.gt(selectedDeposit.marketValue)) {
          selectedDeposit = deposit;
        }
      });

      if (!selectedBorrow || !selectedDeposit) {
        logWarning('Invalid obligation state - missing borrow or deposit data', {
          obligationId: currentObligation.pubkey.toString()
        });
        break;
      }

      logInfo('Found underwater obligation', {
        obligationId: currentObligation.pubkey.toString(),
        borrowedValue: borrowedValue.toString(),
        unhealthyBorrowValue: unhealthyBorrowValue.toString(),
        market: market.address,
        selectedBorrow: selectedBorrow.symbol,
        selectedDeposit: selectedDeposit.symbol
      });

      const { txHash, profit } = await pRetry(
        () => liquidateAndRedeem(
          connection,
          payer,
          selectedBorrow.borrowAmountWads.toString(),
          selectedBorrow.symbol,
          selectedDeposit.symbol,
          market,
          currentObligation,
          jupiter,
        ),
        {
          retries: BOT_CONFIG.OPERATIONAL.MAX_RETRIES,
          onFailedAttempt: error => {
            logWarning(`Liquidation attempt failed (${error.attemptNumber}/${error.retriesLeft + error.attemptNumber})`, {
              error: error.message,
              obligationId: currentObligation.pubkey.toString()
            });
          }
        }
      );

      metrics.incrementLiquidations();
      logSuccess(SUCCESS_MESSAGES.LIQUIDATION_SUCCESS, {
        txHash,
        profit,
        obligationId: currentObligation.pubkey.toString()
      });

      // If we made a profit, swap excess USDC to SOL
      if (profit > BOT_CONFIG.FINANCIAL.MIN_USDC_BUFFER) {
        await swapProfitToSol(connection, payer, jupiter, profit);
      }

      const postLiquidationObligation = await connection.getAccountInfo(
        currentObligation.pubkey,
      );
      
      if (!postLiquidationObligation) {
        logWarning('Could not fetch post-liquidation obligation state');
        break;
      }

      const parsedObligation = parseObligation(currentObligation.pubkey, postLiquidationObligation);
      if (!parsedObligation) {
        logWarning('Could not parse post-liquidation obligation');
        break;
      }
      currentObligation = parsedObligation;
    }
  } catch (error) {
    metrics.incrementFailedLiquidations();
    throw new LiquidationError(ERROR_MESSAGES.LIQUIDATION_FAILED, {
      obligationId: obligation?.pubkey.toString(),
      error
    });
  }
}