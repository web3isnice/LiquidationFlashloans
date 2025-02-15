import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token-v2';
import {
  Transaction,
  Keypair,
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import { getWalletBalance } from 'libs/utils';
import { MINT_BASIS, MINT_RBASIS, unstakeBasisInstruction } from 'models/instructions/basis/unstake';

export const checkAndUnwrapBasisTokens = async (connection: Connection, payer: Keypair) => {
  const rBasisPubKey = new PublicKey(MINT_RBASIS);
  // check if wallet has rBasis tokens
  const tokenAmount = await getWalletBalance(connection, rBasisPubKey, payer.publicKey);
  if (tokenAmount) {
    await unstakeBasis(connection, payer, rBasisPubKey, tokenAmount);
  }
};

export const unstakeBasis = async (
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  amount: number,
) => {
  console.log(`unstaking ${amount} rBasis`);
  const ixs: TransactionInstruction[] = [];
  // get associated token account for rBasis
  const rBasisAccount = await getAssociatedTokenAddress(
    new PublicKey(mint),
    payer.publicKey,
  );

  // get associated token account for Basis (or create if doens't exist)
  const BasisAccount = await getAssociatedTokenAddress(
    new PublicKey(MINT_BASIS),
    payer.publicKey,
  );
  const BasisAccountInfo = await connection.getAccountInfo(BasisAccount);
  if (!BasisAccountInfo) {
    const createBasisAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      BasisAccount,
      payer.publicKey,
      new PublicKey(MINT_BASIS),
    );
    ixs.push(createBasisAtaIx);
  }

  // compose full unstake instruction
  const unstakeBasisIx = unstakeBasisInstruction(
    amount, // NOTE: full unstake
    payer.publicKey,
    BasisAccount,
    rBasisAccount,
  );
  ixs.push(unstakeBasisIx);

  const tx = new Transaction().add(...ixs);
  const { blockhash } = await connection.getRecentBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  const txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(txHash, 'processed');
  console.log(`successfully unstaked ${amount} rBasis: ${txHash}`);
  return txHash;
};