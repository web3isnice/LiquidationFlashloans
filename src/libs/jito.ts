import axios from 'axios';
import { Transaction, Connection, Commitment, ConnectionConfig, PublicKey } from '@solana/web3.js';
import { BOT_CONFIG } from '../config/settings';
import { logError, logInfo, logWarning } from './logger';

interface JitoResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface BundleResult {
  bundle_id: string;
}

interface BundleStatus {
  bundle_id: string;
  status: 'Invalid' | 'Pending' | 'Failed' | 'Landed';
  landed_slot: number | null;
}

class RateLimiter {
  private requestQueue: number[] = [];
  private dailyRequests: number = 0;
  private monthlyRequests: number = 0;
  private lastReset = {
    daily: Date.now(),
    monthly: Date.now()
  };
  private backoffDelay = BOT_CONFIG.RPC.RATE_LIMIT.MIN_BACKOFF_MS;
  private errorCount = 0;
  private totalRequests = 0;
  private circuitOpen = false;
  private lastCircuitBreak = 0;

  constructor() {
    // Reset counters periodically
    setInterval(() => this.resetCounters(), 60000); // Check every minute
  }

  private resetCounters() {
    const now = Date.now();
    
    // Reset daily counter
    if (now - this.lastReset.daily >= 86400000) {
      this.dailyRequests = 0;
      this.lastReset.daily = now;
      this.errorCount = 0;
      this.totalRequests = 0;
    }
    
    // Reset monthly counter
    if (now - this.lastReset.monthly >= 2592000000) {
      this.monthlyRequests = 0;
      this.lastReset.monthly = now;
    }

    // Clean up old requests from queue
    const oneSecondAgo = now - 1000;
    this.requestQueue = this.requestQueue.filter(timestamp => timestamp > oneSecondAgo);
  }

  private async handleRateLimit(type: 'burst' | 'daily' | 'monthly'): Promise<void> {
    const delays = {
      burst: this.backoffDelay,
      daily: Math.max(60000, this.backoffDelay), // At least 1 minute
      monthly: Math.max(300000, this.backoffDelay) // At least 5 minutes
    };

    logWarning(`${type} rate limit reached, backing off for ${delays[type]}ms`);
    await new Promise(resolve => setTimeout(resolve, delays[type]));
    
    // Increase backoff delay up to max
    const newBackoff = Math.min(
      this.backoffDelay * BOT_CONFIG.RPC.RATE_LIMIT.BACKOFF_MULTIPLIER,
      BOT_CONFIG.RPC.RATE_LIMIT.MAX_BACKOFF_MS
    );
    
    // Ensure backoff stays within MIN_BACKOFF_MS
    this.backoffDelay = Math.max(newBackoff, BOT_CONFIG.RPC.RATE_LIMIT.MIN_BACKOFF_MS);
  }

  private checkCircuitBreaker() {
    if (this.totalRequests < 100) return false; // Need minimum sample size
    
    const errorRate = this.errorCount / this.totalRequests;
    if (errorRate > BOT_CONFIG.RPC.RATE_LIMIT.ERROR_THRESHOLD) {
      this.circuitOpen = true;
      this.lastCircuitBreak = Date.now();
      logWarning(`Circuit breaker triggered - Error rate: ${(errorRate * 100).toFixed(2)}%`);
      return true;
    }
    return false;
  }

  public recordError() {
    this.errorCount++;
    this.checkCircuitBreaker();
  }

  public async checkRateLimit(): Promise<void> {
    // Check circuit breaker
    if (this.circuitOpen) {
      const now = Date.now();
      if (now - this.lastCircuitBreak >= BOT_CONFIG.RPC.RATE_LIMIT.CIRCUIT_BREAKER_TIMEOUT_MS) {
        this.circuitOpen = false;
        this.errorCount = 0;
        this.totalRequests = 0;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    this.resetCounters();
    const now = Date.now();
    
    // Check monthly limit
    if (this.monthlyRequests >= BOT_CONFIG.RPC.RATE_LIMIT.MONTHLY_REQUEST_LIMIT) {
      await this.handleRateLimit('monthly');
      return this.checkRateLimit();
    }
    
    // Check daily limit
    if (this.dailyRequests >= BOT_CONFIG.RPC.RATE_LIMIT.DAILY_REQUEST_LIMIT) {
      await this.handleRateLimit('daily');
      return this.checkRateLimit();
    }
    
    // Remove requests older than 1 second
    this.requestQueue = this.requestQueue.filter(timestamp => now - timestamp < 1000);
    
    // Check burst limit
    if (this.requestQueue.length >= BOT_CONFIG.RPC.RATE_LIMIT.BURST_REQUESTS) {
      await this.handleRateLimit('burst');
      return this.checkRateLimit();
    }
    
    // Add request to queue and increment counters
    this.requestQueue.push(now);
    this.dailyRequests++;
    this.monthlyRequests++;
    this.totalRequests++;
    
    // Adaptive throttling
    if (BOT_CONFIG.RPC.RATE_LIMIT.ENABLE_ADAPTIVE_THROTTLING) {
      const dailyUsagePercent = (this.dailyRequests / BOT_CONFIG.RPC.RATE_LIMIT.DAILY_REQUEST_LIMIT) * 100;
      const monthlyUsagePercent = (this.monthlyRequests / BOT_CONFIG.RPC.RATE_LIMIT.MONTHLY_REQUEST_LIMIT) * 100;
      
      if (dailyUsagePercent > 90 || monthlyUsagePercent > 90) {
        await new Promise(resolve => setTimeout(resolve, this.backoffDelay * 2));
      } else if (dailyUsagePercent > 75 || monthlyUsagePercent > 75) {
        await new Promise(resolve => setTimeout(resolve, this.backoffDelay));
      }
    }

    // Reset backoff if we've made it this far
    this.backoffDelay = BOT_CONFIG.RPC.RATE_LIMIT.MIN_BACKOFF_MS;
  }

  public getStats() {
    return {
      dailyRequests: this.dailyRequests,
      monthlyRequests: this.monthlyRequests,
      dailyUsagePercent: (this.dailyRequests / BOT_CONFIG.RPC.RATE_LIMIT.DAILY_REQUEST_LIMIT) * 100,
      monthlyUsagePercent: (this.monthlyRequests / BOT_CONFIG.RPC.RATE_LIMIT.MONTHLY_REQUEST_LIMIT) * 100,
      currentBurst: this.requestQueue.length,
      errorRate: this.totalRequests ? (this.errorCount / this.totalRequests) * 100 : 0,
      circuitBreakerStatus: this.circuitOpen ? 'OPEN' : 'CLOSED',
      currentBackoffDelay: this.backoffDelay
    };
  }
}

export class JitoConnection extends Connection {
  private retryCount: number = 0;
  private readonly maxRetries: number = 3;
  private readonly tipAccounts: string[] = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
  ];

  private readonly regularConnection: Connection;
  private readonly jitoEndpoint: string;
  private readonly rateLimiter: RateLimiter;

  constructor(jitoEndpoint: string, regularEndpoint: string, commitmentOrConfig?: Commitment | ConnectionConfig) {
    super(regularEndpoint, commitmentOrConfig);
    this.jitoEndpoint = jitoEndpoint;
    this.regularConnection = new Connection(regularEndpoint, commitmentOrConfig);
    this.rateLimiter = new RateLimiter();
    logInfo('Initialized Jito connection', { jitoEndpoint, regularEndpoint });
  }

  public getRegularConnection(): Connection {
    return this.regularConnection;
  }

  public getRateLimiterStats() {
    return this.rateLimiter.getStats();
  }

  private async makeJitoRequest<T>(method: string, params: any[]): Promise<T> {
    try {
      await this.rateLimiter.checkRateLimit();

      logInfo(`Making Jito RPC request: ${method}`, { 
        endpoint: this.jitoEndpoint,
        attempt: this.retryCount + 1,
        rateStats: this.getRateLimiterStats()
      });

      const response = await axios.post<JitoResponse<T>>(
        this.jitoEndpoint,
        {
          jsonrpc: '2.0',
          id: 1,
          method,
          params
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: BOT_CONFIG.RPC.TIMEOUT_MS
        }
      );

      if (response.data.error) {
        this.rateLimiter.recordError();
        throw new Error(`Jito error: ${JSON.stringify(response.data.error)}`);
      }

      return response.data.result as T;
    } catch (error) {
      this.rateLimiter.recordError();
      
      logWarning(`Jito RPC request failed: ${method}`, {
        endpoint: this.jitoEndpoint,
        attempt: this.retryCount + 1,
        error: error instanceof Error ? error.message : error,
        rateStats: this.getRateLimiterStats()
      });

      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = BOT_CONFIG.OPERATIONAL.RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeJitoRequest(method, params);
      }

      throw error;
    } finally {
      this.retryCount = 0;
    }
  }

  override async getLatestBlockhash(commitmentOrConfig?: Commitment | ConnectionConfig): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    try {
      await this.rateLimiter.checkRateLimit();
      return await this.regularConnection.getLatestBlockhash(commitmentOrConfig);
    } catch (error) {
      logError('Failed to get latest blockhash from regular connection, trying Jito endpoint', { error });
      try {
        const result = await this.makeJitoRequest<{ blockhash: string; lastValidBlockHeight: number }>(
          'getLatestBlockhash',
          []
        );
        return result;
      } catch (jitoError) {
        logError('Failed to get latest blockhash from both endpoints', { error: jitoError });
        throw jitoError;
      }
    }
  }

  override async getBalance(publicKey: PublicKey, commitmentOrConfig?: Commitment | ConnectionConfig): Promise<number> {
    try {
      await this.rateLimiter.checkRateLimit();
      return await this.regularConnection.getBalance(publicKey, commitmentOrConfig);
    } catch (error) {
      logError('Failed to get balance', { error, publicKey: publicKey.toString() });
      throw error;
    }
  }

  override async getAccountInfo(publicKey: PublicKey, commitmentOrConfig?: Commitment | ConnectionConfig): Promise<any> {
    try {
      await this.rateLimiter.checkRateLimit();
      return await this.regularConnection.getAccountInfo(publicKey, commitmentOrConfig);
    } catch (error) {
      logError('Failed to get account info', { error, publicKey: publicKey.toString() });
      throw error;
    }
  }

  async sendBundle(transactions: Transaction[]): Promise<string> {
    if (transactions.length > 5) {
      throw new Error('Bundle cannot contain more than 5 transactions');
    }

    const encodedTransactions = transactions.map(tx => 
      tx.serialize().toString('base64')
    );

    const result = await this.makeJitoRequest<BundleResult>('sendBundle', [
      encodedTransactions,
      { encoding: 'base64' }
    ]);

    return result.bundle_id;
  }

  async getBundleStatus(bundleId: string): Promise<BundleStatus | null> {
    const result = await this.makeJitoRequest<{
      context: { slot: number };
      value: BundleStatus[];
    }>('getBundleStatuses', [[bundleId]]);

    return result.value[0] || null;
  }

  async waitForBundle(bundleId: string, timeout: number = BOT_CONFIG.OPERATIONAL.TRANSACTION_TIMEOUT_MS): Promise<BundleStatus> {
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Bundle confirmation timeout');
      }

      const status = await this.getBundleStatus(bundleId);
      
      if (!status) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (status.status === 'Failed') {
        throw new Error('Bundle execution failed');
      }

      if (status.status === 'Landed') {
        return status;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async getRandomTipAccount(): Promise<string> {
    const index = Math.floor(Math.random() * this.tipAccounts.length);
    return this.tipAccounts[index];
  }

  override async sendRawTransaction(
    rawTransaction: Buffer | Uint8Array | Array<number>,
    options?: any
  ): Promise<string> {
    try {
      await this.rateLimiter.checkRateLimit();
      const transaction = Transaction.from(rawTransaction);
      const serializedTransaction = transaction.serialize().toString('base64');

      return await this.makeJitoRequest<string>('sendTransaction', [
        serializedTransaction,
        {
          encoding: 'base64',
          minContextSlot: options?.minContextSlot,
          maxRetries: 0,
          skipPreflight: true
        }
      ]);
    } catch (error) {
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        await new Promise(resolve => setTimeout(resolve, BOT_CONFIG.OPERATIONAL.RETRY_DELAY_MS));
        return this.sendRawTransaction(rawTransaction, options);
      }
      throw error;
    }
  }
}