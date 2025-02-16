export const ERROR_MESSAGES = {
  INSUFFICIENT_SOL: 'Insufficient SOL balance for transaction fees. Please maintain at least 0.1 SOL',
  NO_RPC_ENDPOINT: 'Please provide a private RPC endpoint in .env file',
  NO_MARKETS: 'No markets found. Please check your configuration.',
  NO_SECRET_PATH: 'SECRET_PATH environment variable is not set',
  SWAP_FAILED: 'Failed to swap USDC profits to SOL',
  LIQUIDATION_FAILED: 'Liquidation attempt failed',
  TRANSACTION_TIMEOUT: 'Transaction timed out',
  RPC_ERROR: 'RPC node error',
  INVALID_CONFIG: 'Invalid configuration',
  MARKET_ERROR: 'Error fetching market data',
  OBLIGATION_ERROR: 'Error processing obligation',
  HEALTH_CHECK_FAILED: 'Health check failed',
} as const;

export const SUCCESS_MESSAGES = {
  LIQUIDATION_SUCCESS: '🎯 Successfully liquidated position',
  SWAP_SUCCESS: '💱 Successfully swapped USDC profits to SOL',
  STARTUP: '🚀 Liquidator bot started successfully',
  MARKET_REFRESH: '🔄 Successfully refreshed market data',
  HEALTH_CHECK_PASSED: '✅ Health check passed',
  PROFIT_CONVERTED: '💰 Profits successfully converted to SOL',
  TOKENS_UNWRAPPED: '📦 Successfully unwrapped tokens',
} as const;