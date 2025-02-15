import fs from 'fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

function isValidBase58(str: string): boolean {
  try {
    const decoded = bs58.decode(str);
    return decoded.length === 32 || decoded.length === 64;
  } catch {
    return false;
  }
}

function isValidByteArray(arr: number[]): boolean {
  return Array.isArray(arr) && (arr.length === 32 || arr.length === 64) && 
         arr.every(byte => typeof byte === 'number' && byte >= 0 && byte <= 255);
}

function normalizeKeypair(input: string | number[]): Uint8Array {
  // If input is a string, try to parse as JSON first
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (isValidByteArray(parsed)) {
        // For 64-byte arrays, first 32 bytes are public key, last 32 are private key
        return new Uint8Array(parsed.length === 64 ? parsed.slice(32) : parsed);
      }
    } catch {
      // If JSON parsing fails, try base58
      if (isValidBase58(input.trim())) {
        const decoded = bs58.decode(input.trim());
        // For 64-byte decoded base58, first 32 bytes are public key, last 32 are private key
        return new Uint8Array(decoded.length === 64 ? decoded.slice(32) : decoded);
      }
    }
  } 
  // If input is already an array
  else if (isValidByteArray(input)) {
    // For 64-byte arrays, first 32 bytes are public key, last 32 are private key
    return new Uint8Array(input.length === 64 ? input.slice(32) : input);
  }

  throw new Error('bad secret key size');
}

export function readSecret(secretName: string): Uint8Array {
  const path = process.env.SECRET_PATH || `/run/secrets/${secretName}`;
  try {
    const content = fs.readFileSync(path, 'utf8');
    return normalizeKeypair(content.trim());
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error(
        `An error occurred while trying to read the secret path: ${path}. Err: ${err}`,
      );
    } else {
      console.debug(`Could not find the secret: ${secretName}. Err: ${err}`);
    }
    throw err;
  }
}

export function createKeypairFromSecret(secretName: string): Keypair {
  const secretKey = readSecret(secretName);
  return Keypair.fromSecretKey(secretKey);
}