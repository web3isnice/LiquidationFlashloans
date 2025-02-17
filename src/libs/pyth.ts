import { parsePriceData, PriceStatus } from '@pythnetwork/client';
import {
  AggregatorState,
} from '@switchboard-xyz/switchboard-api';
import SwitchboardProgram from '@switchboard-xyz/sbv2-lite';
import { Connection, PublicKey } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import { MarketConfig, MarketConfigReserve } from 'global';
import { logWarning, logError, logInfo } from './logger';
import LRU from 'lru-cache';
import { BOT_CONFIG } from '../config/settings';

const NULL_ORACLE = 'nu11111111111111111111111111111111111111111';
const SWITCHBOARD_V1_ADDRESS = 'DtmE9D2CSB4L5D6A15mraeEjrGMm6auWVzgaD8hK2tZM';
const SWITCHBOARD_V2_ADDRESS = 'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f';

let switchboardV2: SwitchboardProgram | undefined;

// Price cache with configurable TTL
const priceCache = new LRU<string, {
  price: BigNumber;
  timestamp: number;
  confidence?: number;
  source: 'pyth' | 'switchboard' | 'fallback';
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
  confidence?: number;
  source: 'pyth' | 'switchboard' | 'fallback';
};

async function getTokenOracleData(connection: Connection, reserve: MarketConfigReserve): Promise<TokenOracleData | null> {
  try {
    const symbol = reserve.liquidityToken.symbol;
    const cacheKey = `${symbol}-${reserve.address}`;
    const cachedData = priceCache.get(cacheKey);
    
    // Use cached data if it's not stale
    if (cachedData && Date.now() - cachedData.timestamp < BOT_CONFIG.PRICE_FEEDS.STALE_PRICE_THRESHOLD_MS) {
      logInfo(`Using cached price for ${symbol}`, {
        price: cachedData.price.toString(),
        source: cachedData.source,
        age: Date.now() - cachedData.timestamp
      });
      
      return {
        symbol,
        reserveAddress: reserve.address,
        mintAddress: reserve.liquidityToken.mint,
        decimals: new BigNumber(10 ** reserve.liquidityToken.decimals),
        price: cachedData.price,
        confidence: cachedData.confidence,
        source: cachedData.source
      };
    }

    let priceData: number | undefined;
    let confidence: number | undefined;
    let source: 'pyth' | 'switchboard' | 'fallback' | undefined;

    // Try Pyth first
    if (reserve.pythOracle && reserve.pythOracle !== NULL_ORACLE) {
      try {
        const pricePublicKey = new PublicKey(reserve.pythOracle);
        const result = await connection.getAccountInfo(pricePublicKey);
        if (result?.data) {
          const priceInfo = parsePriceData(result.data);
          
          // Validate price confidence
          const confidenceBps = (priceInfo.confidence || 0) / priceInfo.price * 10000;
          if (priceInfo.price && 
              priceInfo.status === PriceStatus.Trading && 
              confidenceBps <= BOT_CONFIG.PRICE_FEEDS.REQUIRED_CONFIDENCE_BPS) {
            priceData = priceInfo.price;
            confidence = priceInfo.confidence;
            source = 'pyth';
          } else {
            logWarning(`Pyth price for ${symbol} rejected - confidence: ${confidenceBps}bps, status: ${priceInfo.status}`);
          }
        }
      } catch (error) {
        logWarning(`Failed to fetch Pyth price for ${symbol}`, { error });
      }
    }

    // Try Switchboard if Pyth failed
    if (!priceData && reserve.switchboardOracle) {
      for (let attempt = 1; attempt <= BOT_CONFIG.PRICE_FEEDS.RETRY_ATTEMPTS; attempt++) {
        try {
          const pricePublicKey = new PublicKey(reserve.switchboardOracle);
          const info = await connection.getAccountInfo(pricePublicKey);
          if (!info?.data) continue;

          const owner = info.owner.toString();
          
          if (owner === SWITCHBOARD_V1_ADDRESS) {
            const result = AggregatorState.decodeDelimited(Buffer.from(info.data.slice(1)));
            if (result?.lastRoundResult?.result) {
              priceData = result.lastRoundResult.result;
              source = 'switchboard';
            }
          } 
          else if (owner === SWITCHBOARD_V2_ADDRESS) {
            if (!switchboardV2) {
              switchboardV2 = await SwitchboardProgram.loadMainnet(connection);
            }
            const result = switchboardV2.decodeLatestAggregatorValue(info);
            if (result?.toNumber()) {
              priceData = result.toNumber();
              source = 'switchboard';
            }
          }
          
          if (priceData) break;
        } catch (error) {
          logWarning(`Failed to fetch Switchboard price for ${symbol} (attempt ${attempt}/${BOT_CONFIG.PRICE_FEEDS.RETRY_ATTEMPTS})`, { error });
          if (attempt < BOT_CONFIG.PRICE_FEEDS.RETRY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, BOT_CONFIG.PRICE_FEEDS.RETRY_DELAY_MS));
          }
        }
      }
    }

    // Try fallback price for known stable tokens
    if (!priceData && symbol in BOT_CONFIG.PRICE_FEEDS.FALLBACK_PRICES) {
      priceData = BOT_CONFIG.PRICE_FEEDS.FALLBACK_PRICES[symbol];
      source = 'fallback';
      logInfo(`Using fallback price for ${symbol}`, { price: priceData });
    }

    if (!priceData) {
      logError(`Failed to get price for ${symbol} | reserve ${reserve.address}`);
      return null;
    }

    // Cache the valid price
    const price = new BigNumber(priceData);
    priceCache.set(cacheKey, {
      price,
      confidence,
      timestamp: Date.now(),
      source: source!
    });

    return {
      symbol,
      reserveAddress: reserve.address,
      mintAddress: reserve.liquidityToken.mint,
      decimals: new BigNumber(10 ** reserve.liquidityToken.decimals),
      price,
      confidence,
      source: source!
    };
  } catch (error) {
    logError(`Error getting oracle data for ${reserve.liquidityToken.symbol}`, { error });
    return null;
  }
}

export async function getTokensOracleData(connection: Connection, market: MarketConfig) {
  const promises = market.reserves.map((reserve) => getTokenOracleData(connection, reserve));
  const results = await Promise.all(promises);
  
  // Filter out failed price fetches and log summary
  const validResults = results.filter(result => result !== null);
  const failedCount = results.length - validResults.length;
  
  if (failedCount > 0) {
    logWarning(`Failed to fetch prices for ${failedCount}/${results.length} tokens`);
  }
  
  logInfo('Price feed summary', {
    total: results.length,
    valid: validResults.length,
    failed: failedCount,
    sources: validResults.reduce((acc, result) => {
      acc[result!.source] = (acc[result!.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  });

  return validResults as TokenOracleData[];
}