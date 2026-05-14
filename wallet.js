'use strict';

const { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const config = require('./config');

let connection;

function getConnection() {
  if (!connection) {
    connection = new Connection(config.SOLANA_RPC, 'confirmed');
  }
  return connection;
}

function generateWallet() {
  const keypair = Keypair.generate();
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: Buffer.from(keypair.secretKey).toString('hex'),
  };
}

async function getIncomingAmount(address, knownSignatures = []) {
  try {
    const conn = getConnection();
    const pubkey = new PublicKey(address);
    const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 20 });

    let totalNew = 0;
    const newSigs = [];

    for (const sigInfo of sigs) {
      if (knownSignatures.includes(sigInfo.signature)) continue;
      if (sigInfo.confirmationStatus === 'processed') continue;

      try {
        const tx = await conn.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.meta) continue;

        const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
        const addressIndex = accountKeys.findIndex(k => k.toBase58() === address);
        if (addressIndex === -1) continue;

        const preBal = tx.meta.preBalances[addressIndex] || 0;
        const postBal = tx.meta.postBalances[addressIndex] || 0;
        const diff = (postBal - preBal) / LAMPORTS_PER_SOL;

        if (diff >= config.MIN_SOL) {
          totalNew += diff;
          newSigs.push(sigInfo.signature);
        }
      } catch (txErr) {
        console.error('[wallet] tx parse error:', txErr.message);
      }
    }

    return { amount: totalNew, signatures: newSigs };
  } catch (err) {
    console.error('[wallet] getIncomingAmount error:', err.message);
    return { amount: 0, signatures: [] };
  }
}

async function sweepToTreasury(privateKeyHex, receivedLamports) {
  try {
    const conn = getConnection();
    const secretKey = Buffer.from(privateKeyHex, 'hex');
    const keypair = Keypair.fromSecretKey(secretKey);
    const treasury = new PublicKey(config.TREASURY_WALLET);

    const { Transaction, SystemProgram } = require('@solana/web3.js');

    // Use 5000 lamports as fee buffer (standard transfer fee)
    const FEE = 5000;
    const lamports = Math.floor(receivedLamports * LAMPORTS_PER_SOL);
    const sendLamports = lamports - FEE;

    if (sendLamports <= 0) {
      console.log('[wallet] Sweep skipped — amount too small to cover fees');
      return null;
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: treasury,
        lamports: sendLamports,
      })
    );

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);

    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');

    console.log(`[wallet] Swept ${sendLamports / LAMPORTS_PER_SOL} SOL to treasury. Sig: ${sig}`);
    return sig;
  } catch (err) {
    console.error('[wallet] sweepToTreasury error:', err.message);
    return null;
  }
}

module.exports = { generateWallet, getIncomingAmount, getConnection, sweepToTreasury };
