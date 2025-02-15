import { Keypair, Connection } from '@solana/web3.js';
import { unwrapTokens } from './unwrapToken';

// CONSTANTS
const RPC_MAINNET = 'https://ssc-dao.genesysgo.net/';

// RUN
(async () => {
  // establish rpc connection
  const connection = new Connection(RPC_MAINNET, 'confirmed');

  // open paper wallet (privatekey retracted)
  const paperWallet = Keypair.generate(); // For testing purposes
  const result = await unwrapTokens(connection, paperWallet);
})();