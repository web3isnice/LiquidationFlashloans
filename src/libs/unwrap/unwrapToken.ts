import { Keypair, Connection } from '@solana/web3.js';
import { checkAndUnwrapBasisTokens } from './basis/rBasisSwap';
import { checkAndUnwrapNLPTokens } from './nazare/unwrapNazareLp';
import { checkAndUnwrapKaminoTokens } from './kamino/unwrapKamino';

export const unwrapTokens = async (connection: Connection, payer: Keypair) => {
  try {
    await checkAndUnwrapBasisTokens(connection, payer);
    await checkAndUnwrapNLPTokens(connection, payer);
    await checkAndUnwrapKaminoTokens(connection, payer);
  } catch (error) {
    console.error('Error unwrapping tokens:', error);
  }
};