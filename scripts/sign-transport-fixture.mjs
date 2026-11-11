import { writeFileSync } from 'node:fs';
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, signTransaction } from '@solana/kit';
import { buildV1Transaction, transactionBytes } from '../packages/client/src/transaction.mjs';

// Public RFC8032 test vector only. Never a deployment key or a funded wallet.
const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const pair = await createKeyPairFromPrivateKeyBytes(seed);
const feePayer = await getAddressFromPublicKey(pair.publicKey);
const [blockhash, output, profile = 'full'] = process.argv.slice(2);
if (!blockhash || !output) throw new Error('blockhash and output required');
const built = buildV1Transaction({ feePayer, lifetime: { blockhash, lastValidBlockHeight: 1000n },
  supportedTransactionVersions: [1], resources: { computeUnitLimit: 1_400_000,
    loadedAccountsDataSizeLimit: 67_108_864, heapSize: 262_144, priorityFeeLamports: 17n },
  instructions: [{ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    data: Buffer.alloc(1160, 0x61), accounts: [] }] });
// Negative profiles exercise the actual runtime defaults, bypassing the client
// guard deliberately. The production builder never emits either profile.
if (profile !== 'full') throw new Error('unsupported fixture profile');
const signed = await signTransaction([pair], built.transaction);
writeFileSync(output, transactionBytes(signed));
console.log(JSON.stringify({ publicTestSigner: feePayer, bytes: transactionBytes(signed).length, profile }));
