import { logger } from './logger';

export class LiquidatorError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    
    // Log error with context
    logger.error(message, {
      errorType: this.name,
      ...context
    });
  }
}

export class SwapError extends LiquidatorError {
  constructor(message: string, context?: Record<string, any>) {
    super(`Swap failed: ${message}`, context);
  }
}

export class LiquidationError extends LiquidatorError {
  constructor(message: string, context?: Record<string, any>) {
    super(`Liquidation failed: ${message}`, context);
  }
}

export class TransactionError extends LiquidatorError {
  constructor(message: string, context?: Record<string, any>) {
    super(`Transaction failed: ${message}`, context);
  }
}

export class ConfigurationError extends LiquidatorError {
  constructor(message: string, context?: Record<string, any>) {
    super(`Configuration error: ${message}`, context);
  }
}

export class TimeoutError extends LiquidatorError {
  constructor(message: string, context?: Record<string, any>) {
    super(`Operation timed out: ${message}`, context);
  }
}

export class InsufficientFundsError extends LiquidatorError {
  constructor(message: string, context?: Record<string, any>) {
    super(`Insufficient funds: ${message}`, context);
  }
}

export class RpcError extends LiquidatorError {
  constructor(message: string, context?: Record<string, any>) {
    super(`RPC error: ${message}`, context);
  }
}