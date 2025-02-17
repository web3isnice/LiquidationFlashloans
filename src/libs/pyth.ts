import { parsePriceData, PriceStatus } from '@pythnetwork/client';
import {
  AggregatorState,
} from '@switchboard-xyz/switchboard-api';
import SwitchboardProgram from '@switchboard-xyz/sbv2-lite';
import { Connection, PublicKey } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import { MarketConfig, MarketConfigReserve } from 'global';
import { logWarning, logError } from './logger';
import LRU from 'lru-cache';
import { BOT_CONFIG } from '../config/settings';

const NULL_ORACLE = 'nu11111111111111111111111111111111111111111';
const SWITCHBOARD_V1_ADDRESS = 'DtmE9D2CSB4L5D6A15mraeEjrGMm6auWVzgaD8hK2tZM';
const SWITCHBOARD_V2_ADDRESS = 'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f';

let switchboardV2: SwitchboardProgram | undefined;

// Price cache with 10 second TTL
const priceCache = new LRU<string, {
  price: BigNumber;
  timestamp: number;
}>({
  max: 500,
  ttl: BOT_CONFIG.PRICE_FEEDS.CACHE_TTL_MS,
});

export type TokenOracleData = {
  symbol: string;
  reserveAddress: string;
  mintAddress: string;
  decimals: BigNumber;
  price: BigNumber;
};

async function getTokenOracleData(connection: Connection, reserve: MarketConfigReserve): Promise<TokenOracleData | null> {
  try {
    // Check cache first
    const cacheKey = `${reserve.liquidityToken.symbol}-${reserve.address}`;
    const cachedData = priceCache.get(cacheKey);
    
    if (cachedData && Date.now() - cachedData.timestamp < BOT_CONFIG.PRICE_FEEDS.STALE_PRICE_THRESHOLD_MS) {
      return {
        symbol: reserve.liquidityToken.symbol,
        reserveAddress: reserve.address,
        mintAddress: reserve.liquidityToken.mint,
        decimals: new BigNumber(10 ** reserve.liquidityToken.decimals),
        price: cachedData.price,
      };
    }

    let priceData;
    const oracle = {
      priceAddress: reserve.pythOracle,
      switchboardFeedAddress: reserve.switchboardOracle,
    };

    // Try Pyth first
    if (oracle.priceAddress && oracle.priceAddress !== NULL_ORACLE) {
      try {
        const pricePublicKey = new PublicKey(oracle.priceAddress);
        const result = await connection.getAccountInfo(pricePublicKey);
        if (result?.data) {
          const priceInfo = parsePriceData(result.data);
          // Check if price is valid and trading
          if (priceInfo.price && priceInfo.status === PriceStatus.Trading) {
            priceData = priceInfo.price;
            
            // Cache the valid price
            priceCache.set(cacheKey, {
              price: new BigNumber(priceData),
              timestamp: Date.now()
            });
          }
        }
      } catch (error) {
        logWarning(`Failed to fetch Pyth price for ${reserve.liquidityToken.symbol}`, { error });
      }
    }

    // Try Switchboard if Pyth failed
    if (!priceData && oracle.switchboardFeedAddress) {
      for (let attempt = 1; attempt <= BOT_CONFIG.PRICE_FEEDS.RETRY_ATTEMPTS; attempt++) {
        try {
          const pricePublicKey = new PublicKey(oracle.switchboardFeedAddress);
          const info = await connection.getAccountInfo(pricePublicKey);
          if (!info?.data) continue;

          const owner = info.owner.toString();
          
          if (owner === SWITCHBOARD_V1_ADDRESS) {
            const result = AggregatorState.decodeDelimited(Buffer.from(info.data.slice(1)));
            priceData = result?.lastRoundResult?.result;
          } 
          else if (owner === SWITCHBOARD_V2_ADDRESS) {
            if (!switchboardV2) {
              switchboardV2 = await SwitchboardProgram.loadMainnet(connection);
            }
            const result = switchboardV2.decodeLatestAggregatorValue(info);
            priceData = result?.toNumber();
          }
          
          if (priceData) {
            // Cache the valid price
            priceCache.set(cacheKey, {
              price: new BigNumber(priceData),
              timestamp: Date.now()
            });
            break;
          }
        } catch (error) {
          logWarning(`Failed to fetch Switchboard price for ${reserve.liquidityToken.symbol} (attempt ${attempt}/${BOT_CONFIG.PRICE_FEEDS.RETRY_ATTEMPTS})`, { error });
          if (attempt < BOT_CONFIG.PRICE_FEEDS.RETRY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, BOT_CONFIG.PRICE_FEEDS.RETRY_DELAY_MS));
          }
        }
      }
    }

    if (!priceData) {
      logError(`Failed to get price for ${reserve.liquidityToken.symbol} | reserve ${reserve.address}`);
      return null;
    }

    return {
      symbol: reserve.liquidityToken.symbol,
      reserveAddress: reserve.address,
      mintAddress: reserve.liquidityToken.mint,
      decimals: new BigNumber(10 ** reserve.liquidityToken.decimals),
      price: new BigNumber(priceData),
    };
  } catch (error) {
    logError(`Error getting oracle data for ${reserve.liquidityToken.symbol}`, { error });
    return null;
  }
}

export async function getTokensOracleData(connection: Connection, market: MarketConfig) {
  const promises = market.reserves.map((reserve) => getTokenOracleData(connection, reserve));
  const results = await Promise.all(promises);
  return results.filter(result => result !== null); // Filter out failed price fetches
}