import {
  Account,
  Connection,
  Keypair,
  PublicKey,
  TransactionError,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import {
  getObligations, getReserves, sortBorrows,
} from 'libs/utils';
import { getTokensOracleData } from 'libs/pyth';
import { Borrow, calculateRefreshedObligation } from 'libs/refreshObligation';
import { readSecret } from 'libs/secret';
import { liquidateAndRedeem } from 'libs/actions/liquidateAndRedeem';
import { Jupiter } from '@jup-ag/core';
import { unwrapTokens } from 'libs/unwrap/unwrapToken';
import { parseObligation } from '@solendprotocol/solend-sdk';
import { getMarkets } from './config';
import JSBI from 'jsbi';

dotenv.config();

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const MIN_USDC_BUFFER = 1; // Keep 1 USDC as buffer
const PROFIT_SWAP_SLIPPAGE = 50; // 0.5% slippage for profit swaps

interface SwapSuccessResult {
  txid: string;
  inputAddress: PublicKey;
  outputAddress: PublicKey;
  inputAmount: number;
  outputAmount: number;
}

interface SwapErrorResult {
  error: TransactionError;
}

type JupiterSwapResult = SwapSuccessResult | SwapErrorResult;

async function swapProfitToSol(
  connection: Connection,
  payer: Account,
  jupiter: Jupiter,
  usdcAmount: number
): Promise<string | undefined> {
  try {
    // Calculate amount to swap (leave buffer)
    const swapAmount = Math.floor((usdcAmount - MIN_USDC_BUFFER) * 1e6); // Convert to USDC decimals
    if (swapAmount <= 0) return undefined;

    console.log(`Swapping ${usdcAmount - MIN_USDC_BUFFER} USDC to SOL`);

    const routes = await jupiter.computeRoutes({
      inputMint: USDC_MINT,
      outputMint: WSOL_MINT,
      amount: JSBI.BigInt(swapAmount),
      slippageBps: PROFIT_SWAP_SLIPPAGE,
    });

    if (routes.routesInfos.length === 0) {
      throw new Error('No routes found for USDC to SOL swap');
    }

    const { execute } = await jupiter.exchange({
      routeInfo: routes.routesInfos[0]
    });

    const result = await execute() as JupiterSwapResult;
    
    if ('error' in result) {
      throw new Error(`Swap failed: ${result.error}`);
    }

    const swapResult = result as SwapSuccessResult;
    console.log(`Successfully swapped profits to SOL: ${swapResult.txid}`);
    
    return swapResult.txid;
  } catch (error) {
    console.error('Failed to swap profits to SOL:', {
      error: error.message,
      usdcAmount,
      stack: error.stack
    });
    return undefined;
  }
}

async function runLiquidator() {
  try {
    const rpcEndpoint = process.env.RPC_ENDPOINT;
    if (!rpcEndpoint) {
      throw new Error('Please provide a private RPC endpoint in .env file');
    }

    const markets = await getMarkets();
    if (!markets || markets.length === 0) {
      throw new Error('No markets found. Please check your configuration.');
    }

    const connection = new Connection(rpcEndpoint, 'confirmed');

    // Use environment variable for keypair path
    const secretPath = process.env.SECRET_PATH;
    if (!secretPath) {
      throw new Error('SECRET_PATH environment variable is not set');
    }

    // Read keypair from the path specified in environment variable
    const payer = new Account(JSON.parse(readSecret('keypair')));

    // Check SOL balance for transaction fees
    const solBalance = await connection.getBalance(payer.publicKey);
    if (solBalance < 0.1 * 1e9) { // 0.1 SOL minimum
      throw new Error('Insufficient SOL balance for transaction fees. Please maintain at least 0.1 SOL');
    }

    const jupiter = await Jupiter.load({
      connection,
      cluster: 'mainnet-beta',
      user: Keypair.fromSecretKey(payer.secretKey),
      wrapUnwrapSOL: false,
    });

    console.log(`
      Liquidator Configuration:
      - Environment: ${process.env.APP || 'production'}
      - RPC: ${rpcEndpoint}
      - Wallet: ${payer.publicKey.toBase58()}
      - Markets: ${markets.length} pools
      - SOL Balance: ${solBalance / 1e9} SOL
    `);

    for (let epoch = 0; ; epoch += 1) {
      for (const market of markets) {
        try {
          const tokensOracle = await getTokensOracleData(connection, market);
          const allObligations = await getObligations(connection, market.address);
          const allReserves = await getReserves(connection, market.address);

          for (const obligation of allObligations) {
            try {
              if (!obligation) continue;
              
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
                const selectedBorrow: Borrow | undefined = sortBorrows(borrows)[0];

                // Select withdrawal collateral token with highest market value
                let selectedDeposit;
                deposits.forEach((deposit) => {
                  if (!selectedDeposit || deposit.marketValue.gt(selectedDeposit.marketValue)) {
                    selectedDeposit = deposit;
                  }
                });

                if (!selectedBorrow || !selectedDeposit) {
                  console.warn('Invalid obligation state - missing borrow or deposit data');
                  break;
                }

                console.log(`
                  Found underwater obligation ${currentObligation.pubkey.toString()}:
                  - Borrowed Value: ${borrowedValue.toString()}
                  - Unhealthy Borrow Value: ${unhealthyBorrowValue.toString()}
                  - Market: ${market.address}
                  - Selected Borrow: ${selectedBorrow.symbol}
                  - Selected Collateral: ${selectedDeposit.symbol}
                `);

                const { txHash, profit } = await liquidateAndRedeem(
                  connection,
                  payer,
                  selectedBorrow.borrowAmountWads.toString(),
                  selectedBorrow.symbol,
                  selectedDeposit.symbol,
                  market,
                  currentObligation,
                  jupiter,
                );

                // If we made a profit, swap excess USDC to SOL
                if (profit > MIN_USDC_BUFFER) {
                  await swapProfitToSol(connection, payer, jupiter, profit);
                }

                const postLiquidationObligation = await connection.getAccountInfo(
                  currentObligation.pubkey,
                );
                
                if (!postLiquidationObligation) {
                  console.warn('Could not fetch post-liquidation obligation state');
                  break;
                }

                const parsedObligation = parseObligation(currentObligation.pubkey, postLiquidationObligation);
                if (!parsedObligation) {
                  console.warn('Could not parse post-liquidation obligation');
                  break;
                }
                currentObligation = parsedObligation;
              }
            } catch (err) {
              console.error('Error processing obligation:', {
                error: err.message,
                obligation: obligation?.pubkey.toString(),
                market: market.address,
                stack: err.stack,
              });
              continue;
            }
          }

          // Unwrap any wrapped tokens received from liquidations
          await unwrapTokens(connection, payer);

          // Throttle to avoid rate limiter if configured
          if (process.env.THROTTLE) {
            await new Promise(resolve => setTimeout(resolve, Number(process.env.THROTTLE)));
          }

        } catch (err) {
          console.error('Error processing market:', {
            error: err.message,
            market: market.address,
            stack: err.stack,
          });
          continue;
        }
      }
    }
  } catch (error) {
    console.error('Fatal error in liquidator:', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

runLiquidator();
