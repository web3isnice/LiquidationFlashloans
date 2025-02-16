import axios from 'axios';
import { Transaction, Connection, Commitment, ConnectionConfig, PublicKey, GetBalanceConfig } from '@solana/web3.js';
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

  constructor(endpoint: string, commitmentOrConfig?: Commitment | ConnectionConfig) {
    super(endpoint, commitmentOrConfig);
    logInfo('Initializing Jito connection', { endpoint });
  }

  private async makeJitoRequest<T>(method: string, params: any[], isTransactionMethod: boolean = false): Promise<T> {
    try {
      logInfo(`Making Jito RPC request: ${method}`, { 
        endpoint: this.rpcEndpoint,
        attempt: this.retryCount + 1 
      });
      
      const endpoint = isTransactionMethod 
        ? `${this.rpcEndpoint}/api/v1/transactions`
        : this.rpcEndpoint;

      const response = await axios.post<JitoResponse<T>>(
        endpoint,
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
        throw new Error(`Jito error: ${JSON.stringify(response.data.error)}`);
      }

      logInfo(`Jito RPC request successful: ${method}`);
      return response.data.result as T;
    } catch (error) {
      logWarning(`Jito RPC request failed: ${method}`, {
        endpoint: this.rpcEndpoint,
        attempt: this.retryCount + 1,
        error: error instanceof Error ? error.message : error
      });

      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = BOT_CONFIG.OPERATIONAL.RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1);
        logInfo(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeJitoRequest(method, params, isTransactionMethod);
      }

      logError(`Jito RPC request failed after ${this.maxRetries} attempts: ${method}`);
      throw error;
    } finally {
      if (this.retryCount >= this.maxRetries) {
        this.retryCount = 0;
      }
    }
  }

  override async getLatestBlockhash(commitmentOrConfig?: Commitment | ConnectionConfig): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    try {
      logInfo('Getting latest blockhash...');
      const result = await this.makeJitoRequest<{
        blockhash: string;
        lastValidBlockHeight: number;
      }>('getLatestBlockhash', [{ commitment: commitmentOrConfig || this.commitment }]);

      if (!result || !result.blockhash) {
        throw new Error('Invalid response from getLatestBlockhash');
      }

      logInfo('Successfully retrieved latest blockhash');
      return {
        blockhash: result.blockhash,
        lastValidBlockHeight: result.lastValidBlockHeight + 150 // Add ~1 minute buffer
      };
    } catch (error) {
      logError('Failed to get latest blockhash', { error });
      throw error;
    }
  }

  override async getBalance(publicKey: PublicKey, commitmentOrConfig?: Commitment | GetBalanceConfig): Promise<number> {
    try {
      logInfo('Getting account balance...', { publicKey: publicKey.toString() });
      const result = await this.makeJitoRequest<number>(
        'getBalance',
        [publicKey.toString(), { commitment: (typeof commitmentOrConfig === 'string' ? commitmentOrConfig : commitmentOrConfig?.commitment) || this.commitment }]
      );
      
      logInfo('Successfully retrieved balance', { publicKey: publicKey.toString(), balance: result });
      return result;
    } catch (error) {
      logError('Failed to get balance', { error, publicKey: publicKey.toString() });
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

    const result = await this.makeJitoRequest<BundleResult>(
      'sendBundle',
      [encodedTransactions, { encoding: 'base64' }],
      true // Use transactions endpoint
    );

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
      const transaction = Transaction.from(rawTransaction);
      const serializedTransaction = transaction.serialize().toString('base64');

      return await this.makeJitoRequest<string>(
        'sendTransaction',
        [
          serializedTransaction,
          {
            encoding: 'base64',
            minContextSlot: options?.minContextSlot,
            maxRetries: 0,
            skipPreflight: true
          }
        ],
        true // Use transactions endpoint
      );
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