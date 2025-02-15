import got from 'got';
import { MarketConfig } from 'global';
import dotenv from 'dotenv';

dotenv.config();

export const OBLIGATION_LEN = 1300;
export const RESERVE_LEN = 619;
export const LENDING_MARKET_LEN = 290;
const eligibleApps = ['production', 'devnet'];

function getApp() {
  const app = process.env.APP;
  if (!eligibleApps.includes(app!)) {
    throw new Error(
      `Unrecognized env app provided: ${app}. Must be production or devnet`,
    );
  }
  return app;
}

function getMarketsUrl(): string {
  // Only fetch the targeted markets if specified. Otherwise we fetch all solend pools
  if (process.env.MARKET) {
    return `https://api.solend.fi/v1/markets/configs?ids=${process.env.MARKET}`;
  }

  return `https://api.solend.fi/v1/markets/configs?scope=solend&deployment=${getApp()}`;
}

export async function getMarkets(): Promise<MarketConfig[]> {
  let attemptCount = 0;
  let backoffFactor = 1;
  const maxAttempt = 10;
  const marketUrl = getMarketsUrl();

  // Function to wait for a certain amount of time
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  while (attemptCount < maxAttempt) {
    try {
      if (attemptCount > 0) {
        await wait(backoffFactor * 10);
        backoffFactor *= 2;
      }
      attemptCount += 1;
      const response = await got(marketUrl);
      const data = JSON.parse(response.body) as MarketConfig[];
      return data;
    } catch (error) {
      console.error('error fetching /v1/markets/configs ', error);
    }
  }

  throw new Error('failed to fetch /v1/markets/configs');
}
