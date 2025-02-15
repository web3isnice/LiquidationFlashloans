import { Connection, PublicKey } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token-v2';
import {
  OBLIGATION_SIZE, parseObligation, parseReserve, Reserve, RESERVE_SIZE,
} from '@solendprotocol/solend-sdk';
import BigNumber from 'bignumber.js';
import {
  LiquidityToken, MarketConfig, TokenCount,
} from 'global';
import { findWhere } from 'underscore';
import { TokenOracleData } from './pyth';
import { Borrow } from './refreshObligation';

export const WAD = new BigNumber(`1${''.padEnd(18, '0')}`);
export const U64_MAX = '18446744073709551615';
const INITIAL_COLLATERAL_RATIO = 1;
const INITIAL_COLLATERAL_RATE = new BigNumber(INITIAL_COLLATERAL_RATIO).multipliedBy(WAD);

// Converts amount to human (rebase with decimals)
export function toHuman(market: MarketConfig, amount: string, symbol: string) {
  const decimals = getDecimals(market, symbol);
  return toHumanDec(amount, decimals);
}

export function toBaseUnit(market: MarketConfig, amount: string, symbol: string) {
  if (amount === U64_MAX) return amount;
  const decimals = getDecimals(market, symbol);
  return toBaseUnitDec(amount, decimals);
}

// Converts to base unit amount
// e.g. 1.0 SOL => 1000000000 (lamports)
function toBaseUnitDec(amount: string, decimals: number) {
  if (decimals < 0) {
    throw new Error(`Invalid decimal ${decimals}`);
  }
  if ((amount.match(/\./g) || []).length > 1) {
    throw new Error('Too many decimal points');
  }
  let decimalIndex = amount.indexOf('.');
  let precision;
  if (decimalIndex === -1) {
    precision = 0;
    decimalIndex = amount.length; // Pretend it's at the end
  } else {
    precision = amount.length - decimalIndex - 1;
  }
  if (precision === decimals) {
    return amount.slice(0, decimalIndex) + amount.slice(decimalIndex + 1);
  }
  if (precision < decimals) {
    const numTrailingZeros = decimals - precision;
    return (
      amount.slice(0, decimalIndex)
      + amount.slice(decimalIndex + 1)
      + ''.padEnd(numTrailingZeros, '0')
    );
  }
  return (
    amount.slice(0, decimalIndex)
    + amount.slice(decimalIndex + 1, decimalIndex + decimals + 1)
  );
}

function getDecimals(market: MarketConfig, symbol: string) {
  const tokenInfo = getTokenInfo(market, symbol);
  return tokenInfo.decimals;
}

// Returns token info from config
export function getTokenInfo(market: MarketConfig, symbol: string) {
  const tokenInfo = findWhere(market.reserves.map((reserve) => reserve.liquidityToken), { symbol });
  if (!tokenInfo) {
    throw new Error(`Could not find ${symbol} in config.assets`);
  }
  return tokenInfo;
}

export function getTokenInfoFromMarket(market: MarketConfig, symbol: string) {
  const liquidityToken: LiquidityToken = findWhere(market.reserves.map((reserve) => reserve.liquidityToken), { symbol })!;
  if (!liquidityToken) {
    throw new Error(`Could not find ${symbol} in config.assets`);
  }
  return {
    name: liquidityToken.name,
    symbol: liquidityToken.symbol,
    decimals: liquidityToken.decimals,
    mintAddress: liquidityToken.mint,
    logo: liquidityToken.logo,
  };
}

export function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function toHumanDec(amount: string, decimals: number) {
  let amountStr = amount.slice(amount.length - Math.min(decimals, amount.length));
  if (decimals > amount.length) {
    for (let i = 0; i < decimals - amount.length; i += 1) {
      amountStr = `0${amountStr}`;
    }
    amountStr = `0.${amountStr}`;
  } else {
    amountStr = `.${amountStr}`;
    for (let i = amount.length - decimals - 1; i >= 0; i -= 1) {
      amountStr = amount[i] + amountStr;
    }
  }
  amountStr = stripEnd(amountStr, '0');
  amountStr = stripEnd(amountStr, '.');
  return amountStr;
}

// Strips character c from end of string s
function stripEnd(s: string, c: string) {
  let i = s.length - 1;
  for (; i >= 0; i -= 1) {
    if (s[i] !== c) {
      break;
    }
  }
  return s.slice(0, i + 1);
}

export function getProgramIdForCurrentDeployment(): string {
  return {
    beta: 'BLendhFh4HGnycEDDFhbeFEUYLP4fXB5tTHMoTX8Dch5',
    production: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
    staging: 'ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx',
  }[process.env.APP || 'production'] || 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
}

export async function getObligations(connection: Connection, lendingMarketAddr) {
  const programID = getProgramIdForCurrentDeployment();
  const resp = await connection.getProgramAccounts(new PublicKey(programID), {
    commitment: connection.commitment,
    filters: [
      {
        memcmp: {
          offset: 10,
          bytes: lendingMarketAddr,
        },
      },
      {
        dataSize: OBLIGATION_SIZE,
      }],
    encoding: 'base64',
  });

  return resp.map((account) => parseObligation(account.pubkey, account.account));
}

export async function getReserves(connection: Connection, lendingMarketAddr) {
  const programID = getProgramIdForCurrentDeployment();
  const resp = await connection.getProgramAccounts(new PublicKey(programID), {
    commitment: connection.commitment,
    filters: [
      {
        memcmp: {
          offset: 10,
          bytes: lendingMarketAddr,
        },
      },
      {
        dataSize: RESERVE_SIZE,
      },
    ],
    encoding: 'base64',
  });

  return resp.map((account) => parseReserve(account.pubkey, account.account));
}

export async function getWalletBalances(connection: Connection, wallet, tokensOracle, market) {
  const promises: Promise<any>[] = [];
  for (const [key, value] of Object.entries(tokensOracle)) {
    if (value) {
      const tokenOracleData = value as TokenOracleData;
      promises.push(getWalletTokenData(connection, market, wallet, tokenOracleData.mintAddress, tokenOracleData.symbol));
    }
  }
  const walletBalances = await Promise.all(promises);
  return walletBalances;
}

export async function getWalletTokenData(connection: Connection, market: MarketConfig, wallet, mintAddress, symbol) {
  const userTokenAccount = await getAssociatedTokenAddress(
    new PublicKey(mintAddress),
    wallet.publicKey,
  );

  try {
    const accountInfo = await connection.getTokenAccountBalance(userTokenAccount);
    const balance = toHuman(market, accountInfo.value.amount, symbol);
    const balanceBase = accountInfo.value.amount;

    return {
      balance: Number(balance),
      balanceBase: Number(balanceBase),
      symbol,
    };
  } catch (e) {
    return {
      balance: -1, // sentinel value
      balanceBase: -1, // sentinel value
      symbol,
    };
  }
}

export const findAssociatedTokenAddress = async (
  walletAddress: PublicKey,
  tokenMintAddress: PublicKey,
) => getAssociatedTokenAddress(
  tokenMintAddress,
  walletAddress,
);

export const getWalletBalance = async (
  connection: Connection,
  mint: PublicKey,
  walletAddress: PublicKey,
): Promise<number> => {
  const userAta = await getAssociatedTokenAddress(
    mint,
    walletAddress,
  );

  return connection
    .getTokenAccountBalance(userAta)
    .then((tokenAmount) => {
      if (parseFloat(tokenAmount?.value?.amount)) {
        return parseFloat(tokenAmount.value.amount);
      }
      return 0;
    })
    .catch((error) => 0);
};

export function getWalletDistTarget() {
  const target: TokenCount[] = [];
  const targetRaw = process.env.TARGETS || '';

  const targetDistributions = targetRaw.split(' ');
  for (const dist of targetDistributions) {
    const tokens = dist.split(':');
    const asset = tokens[0];
    const unitAmount = tokens[1];

    if (asset && unitAmount) {
      target.push({ symbol: asset, target: parseFloat(unitAmount) });
    }
  }

  return target;
}

export const getCollateralExchangeRate = (reserve: Reserve): BigNumber => {
  const totalLiquidity = (new BigNumber(reserve.liquidity.availableAmount.toString()).multipliedBy(WAD))
    .plus(new BigNumber(reserve.liquidity.borrowedAmountWads.toString()));

  const { collateral } = reserve;
  let rate;
  if (collateral.mintTotalSupply.isZero() || totalLiquidity.isZero()) {
    rate = INITIAL_COLLATERAL_RATE;
  } else {
    const { mintTotalSupply } = collateral;
    rate = (new BigNumber(mintTotalSupply.toString()).multipliedBy(WAD))
      .dividedBy(new BigNumber(totalLiquidity.toString()));
  }
  return rate;
};

export const getLoanToValueRate = (reserve: Reserve): BigNumber => new BigNumber(
  reserve.config.loanToValueRatio / 100,
);

export const getLiquidationThresholdRate = (reserve: Reserve): BigNumber => new BigNumber(
  reserve.config.liquidationThreshold / 100,
);

export const sortBorrows = (borrows: Borrow[]): Borrow[] => {
  return borrows.sort((a, b) => {
    if (a.addedBorrowWeightBPS.eq(b.addedBorrowWeightBPS)) {
      return comparePubkeys(b.borrowReserve, a.borrowReserve);
    } else {
      // Otherwise, sort by addedBorrowWeightBPS in descending order
      return b.addedBorrowWeightBPS.cmp(a.addedBorrowWeightBPS);
    }
  });
};

// use the bytes representation to compare two addresses
export const comparePubkeys = (a: PublicKey, b: PublicKey): number => {
  const aBytes = a.toBytes();
  const bBytes = b.toBytes();

  for (let i = 0; i < 32; i++) {
    if (aBytes[i] < bBytes[i]) {
      return -1;
    }
    if (aBytes[i] > bBytes[i]) {
      return 1;
    }
  }

  return 0;
};