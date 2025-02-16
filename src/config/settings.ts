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

// Regular Solana RPC endpoint
export const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// Bot Configuration
export const BOT_CONFIG = {
  // Environment
  ENV: process.env.APP || 'production',
  JITO_ENDPOINT: process.env.JITO_ENDPOINT || DEFAULT_JITO_ENDPOINT,
  SOLANA_RPC_ENDPOINT: process.env.SOLANA_RPC_ENDPOINT || DEFAULT_SOLANA_RPC,
  SECRET_PATH: process.env.SECRET_PATH,
  THROTTLE: process.env.THROTTLE ? Number(process.env.THROTTLE) : undefined,

  // Token Constants
  TOKENS: {
    USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    WSOL: new PublicKey('So11111111111111111111111111111111111111112'),
  },

  // Financial Settings
  FINANCIAL: {
    MIN_USDC_BUFFER: 1,
    MIN_SOL_BALANCE: 0.1 * 1e9,
  },

  // Operational Settings
  OPERATIONAL: {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    TRANSACTION_TIMEOUT_MS: 60000,
    LIQUIDATION_BATCH_SIZE: 3, // Reduced to stay within rate limits
    STATS_INTERVAL_MS: 300000,
  },

  // RPC Settings
  RPC: {
    TIMEOUT_MS: 30000,
    BATCH_SIZE: 50, // Reduced batch size to manage data transfer
    RATE_LIMIT: {
      // 10 RPS limit
      MAX_REQUESTS_PER_SECOND: 8, // Leave some headroom for system operations
      BURST_REQUESTS: 15, // Small burst allowance
      COOLDOWN_MS: 2000, // Longer cooldown to ensure we stay under daily limit
      
      // Monthly limits
      MONTHLY_REQUEST_LIMIT: 2000000, // 2M requests per month
      DAILY_REQUEST_LIMIT: 50000, // 50K requests per day
      DATA_TRANSFER_LIMIT_GB: 100, // 100GB data transfer limit
      
      // Additional safeguards
      REQUEST_TRACKING_WINDOW_MS: 86400000, // 24 hours in milliseconds
      ENABLE_ADAPTIVE_THROTTLING: true, // Automatically adjust rates based on usage
    }
  },

  // Health Check Settings
  HEALTH_CHECK: {
    INTERVAL_MS: 60000,
    MAX_MEMORY_MB: 1024,
  },

  // Error Handling
  ERROR_HANDLING: {
    MAX_CONSECUTIVE_ERRORS: 5,
    ERROR_COOLDOWN_MS: 5000,
  },

  // Logging Settings
  LOGGING: {
    LOG_FILE_MAX_SIZE: 10 * 1024 * 1024,
    LOG_MAX_FILES: 5,
    STATS_INTERVAL_MS: 300000,
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
