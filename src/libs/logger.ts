import winston from 'winston';
import { BOT_CONFIG } from '../config/settings';

const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}] : ${message}`;
  
  if (metadata.error) {
    const error = metadata.error;
    delete metadata.error;
    
    if (error instanceof Error) {
      msg += `\nError: ${error.message}`;
      if (error.stack) {
        msg += `\nStack: ${error.stack}`;
      }
      // Include any additional properties from the error object
      const additionalProps = Object.entries(error)
        .filter(([key]) => !['name', 'message', 'stack'].includes(key))
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
      if (Object.keys(additionalProps).length > 0) {
        msg += `\nAdditional Error Properties: ${JSON.stringify(additionalProps, null, 2)}`;
      }
    } else if (typeof error === 'object') {
      msg += `\nError Details: ${JSON.stringify(error, null, 2)}`;
    } else {
      msg += `\nError: ${error}`;
    }
  }

  if (Object.keys(metadata).length > 0) {
    msg += `\nMetadata: ${JSON.stringify(metadata, null, 2)}`;
  }

  return msg;
});

const loggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: BOT_CONFIG.LOGGING.LOG_FILE_MAX_SIZE,
      maxFiles: BOT_CONFIG.LOGGING.LOG_MAX_FILES,
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: BOT_CONFIG.LOGGING.LOG_FILE_MAX_SIZE,
      maxFiles: BOT_CONFIG.LOGGING.LOG_MAX_FILES,
    })
  ]
};

export const logger = winston.createLogger(loggerOptions);

// Add convenience methods with emojis and status indicators
export const logSuccess = (message: string, meta?: any) => {
  logger.info(`✅ SUCCESS: ${message}`, meta);
  console.log(`✅ ${message}`);
};

export const logWarning = (message: string, meta?: any) => {
  logger.warn(`⚠️ WARNING: ${message}`, meta);
  console.log(`⚠️ ${message}`);
};

export const logError = (message: string, meta?: any) => {
  logger.error(`❌ ERROR: ${message}`, meta);
  console.error(`❌ ${message}`);
};

export const logInfo = (message: string, meta?: any) => {
  logger.info(`ℹ️ ${message}`, meta);
  console.log(`ℹ️ ${message}`);
};

export const logDebug = (message: string, meta?: any) => {
  logger.debug(`🔍 DEBUG: ${message}`, meta);
};

export const logAction = (message: string, meta?: any) => {
  logger.info(`🔄 PROCESSING: ${message}`, meta);
  console.log(`🔄 ${message}`);
};

export const logMarket = (message: string, meta?: any) => {
  logger.info(`💱 MARKET: ${message}`, meta);
  console.log(`💱 ${message}`);
};

export const logObligation = (message: string, meta?: any) => {
  logger.info(`📊 OBLIGATION: ${message}`, meta);
  console.log(`📊 ${message}`);
};

export const logTransaction = (message: string, meta?: any) => {
  logger.info(`💫 TRANSACTION: ${message}`, meta);
  console.log(`💫 ${message}`);
};

export const logProfit = (message: string, meta?: any) => {
  logger.info(`💰 PROFIT: ${message}`, meta);
  console.log(`💰 ${message}`);
};

// Add monitoring metrics
let totalLiquidations = 0;
let totalProfit = 0;
let failedLiquidations = 0;
let failedSwaps = 0;
let activeMarkets = 0;
let processedObligations = 0;
let successfulSwaps = 0;

export const metrics = {
  incrementLiquidations: () => totalLiquidations++,
  incrementFailedLiquidations: () => failedLiquidations++,
  incrementFailedSwaps: () => failedSwaps++,
  incrementSuccessfulSwaps: () => successfulSwaps++,
  addProfit: (amount: number) => totalProfit += amount,
  setActiveMarkets: (count: number) => activeMarkets = count,
  incrementProcessedObligations: () => processedObligations++,
  resetProcessedObligations: () => processedObligations = 0,
  getStats: () => ({
    totalLiquidations,
    totalProfit,
    failedLiquidations,
    failedSwaps,
    successfulSwaps,
    activeMarkets,
    processedObligations,
    successRate: totalLiquidations ? 
      ((totalLiquidations - failedLiquidations) / totalLiquidations * 100).toFixed(2) + '%' : 
      '0%',
    profitPerLiquidation: totalLiquidations ?
      (totalProfit / totalLiquidations).toFixed(2) + ' USDC' :
      '0 USDC'
  })
};

// Log stats periodically
setInterval(() => {
  const stats = metrics.getStats();
  logInfo('Bot Performance Statistics', {
    ...stats,
    uptime: process.uptime().toFixed(2) + 's',
    memory: process.memoryUsage().heapUsed / 1024 / 1024 + 'MB'
  });
}, BOT_CONFIG.LOGGING.STATS_INTERVAL_MS);