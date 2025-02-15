import { PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

// Jito RPC endpoints
export const JITO_ENDPOINTS = {
  'amsterdam': 'https://amsterdam.mainnet.block-engine.jito.wtf',
  'frankfurt': 'https://frankfurt.mainnet.block-engine.jito.wtf',
  'ny': 'https://ny.mainnet.block-engine.jito.wtf',
  'tokyo': 'https://tokyo.mainnet.block-engine.jito.wtf',
  'slc': 'https://slc.mainnet.block-engine.jito.wtf'
} as const;

export const DEFAULT_JITO_ENDPOINT = JITO_ENDPOINTS.ny;

// Bot Configuration
export const BOT_CONFIG = {
  // Environment
  ENV: process.env.APP || 'production',
  JITO_ENDPOINT: process.env.JITO_ENDPOINT || DEFAULT_JITO_ENDPOINT,
  SECRET_PATH: process.env.SECRET_PATH,
  THROTTLE: process.env.THROTTLE ? Number(process.env.THROTTLE) : undefined,

  // Token Constants
  TOKENS: {
    USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    WSOL: new PublicKey('So11111111111111111111111111111111111111112'),
  },

  // Financial Settings
  FINANCIAL: {
    MIN_USDC_BUFFER: 1, // Keep 1 USDC as buffer
    MIN_SOL_BALANCE: 0.1 * 1e9, // 0.1 SOL minimum for transaction fees
  },

  // Operational Settings
  OPERATIONAL: {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    TRANSACTION_TIMEOUT_MS: 60000, // 1 minute timeout for transactions
    LIQUIDATION_BATCH_SIZE: 5, // Number of obligations to process in parallel
    STATS_INTERVAL_MS: 300000, // Log stats every 5 minutes
  },

  // RPC Settings
  RPC: {
    TIMEOUT_MS: 30000, // 30 seconds
    BATCH_SIZE: 100,
  },

  // Health Check Settings
  HEALTH_CHECK: {
    INTERVAL_MS: 60000, // 1 minute
    MAX_MEMORY_MB: 1024, // 1GB
  },

  // Error Handling
  ERROR_HANDLING: {
    MAX_CONSECUTIVE_ERRORS: 5,
    ERROR_COOLDOWN_MS: 5000, // 5 seconds
  },

  // Logging Settings
  LOGGING: {
    LOG_FILE_MAX_SIZE: 10 * 1024 * 1024, // 10MB
    LOG_MAX_FILES: 5,
    STATS_INTERVAL_MS: 300000, // 5 minutes
  },

  // Status Messages
  STATUS_MESSAGES: {
    STARTING: '🚀 Starting Solend liquidator bot...',
    CHECKING_HEALTH: '🏥 Performing health check...',
    SCANNING_MARKETS: '🔍 Scanning markets for opportunities...',
    PROCESSING_MARKET: '💹 Processing market: %s',
    FOUND_OPPORTUNITY: '💡 Found liquidation opportunity in obligation %s',
    EXECUTING_LIQUIDATION: '⚡ Executing liquidation transaction...',
    SWAPPING_PROFITS: '💱 Converting profits to SOL...',
    UNWRAPPING_TOKENS: '📦 Unwrapping received tokens...',
    COOLING_DOWN: '⏳ Cooling down after errors...',
    ERROR_RECOVERY: '🔄 Attempting to recover from error...',
  }
} as const;