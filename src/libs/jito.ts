import axios from 'axios';
import { Transaction, Connection, Commitment, ConnectionConfig } from '@solana/web3.js';
import { CONSTANTS } from './constants';

export class JitoConnection extends Connection {
  private jitoUrl: string;
  private retryCount: number = 0;
  private readonly maxRetries: number = 3;

  constructor(jitoUrl: string, commitmentOrConfig?: Commitment | ConnectionConfig) {
    super(jitoUrl, commitmentOrConfig);
    this.jitoUrl = jitoUrl;
  }

  async sendRawTransaction(
    rawTransaction: Buffer | Uint8Array | Array<number>,
    options?: any
  ): Promise<string> {
    try {
      const transaction = Transaction.from(rawTransaction);
      const serializedTransaction = transaction.serialize().toString('base64');

      const response = await axios.post(
        `${this.jitoUrl}/api/v1/transactions`,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [
            serializedTransaction,
            {
              encoding: 'base64',
              minContextSlot: options?.minContextSlot,
              maxRetries: 0,
              skipPreflight: true,
              bundleOnly: true
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.error) {
        throw new Error(`Jito error: ${JSON.stringify(response.data.error)}`);
      }

      return response.data.result;
    } catch (error) {
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        await new Promise(resolve => setTimeout(resolve, CONSTANTS.RETRY_DELAY_MS));
        return this.sendRawTransaction(rawTransaction, options);
      }
      throw error;
    } finally {
      this.retryCount = 0;
    }
  }

  async getLatestBlockhash(commitment?: string): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    try {
      const response = await axios.post(
        this.jitoUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestBlockhash',
          params: [{ commitment }]
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.error) {
        throw new Error(`Jito error: ${JSON.stringify(response.data.error)}`);
      }

      const result = response.data.result.value;
      return {
        ...result,
        lastValidBlockHeight: result.lastValidBlockHeight + 150 // Add ~1 minute buffer
      };
    } catch (error) {
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        await new Promise(resolve => setTimeout(resolve, CONSTANTS.RETRY_DELAY_MS));
        return this.getLatestBlockhash(commitment);
      }
      throw error;
    }
  }
}