import { readFileSync, writeFileSync } from 'node:fs';
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, signTransaction } from '@solana/kit';
import { buildV1Transaction, transactionBytes } from '../packages/client/src/transaction.mjs';

// Public RFC8032 test seed only; exclusively funded in local test genesis.
const pair = await createKeyPairFromPrivateKeyBytes(Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'));
const feePayer = await getAddressFromPublicKey(pair.publicKey);
const [input, output] = process.argv.slice(2);
const request = JSON.parse(readFileSync(input, 'utf8'));
if (request.fixtureOnly !== true) throw new Error('this signer is restricted to public local test fixtures');
const instructions = request.instructions.map(ix => ({ programAddress: ix.programAddress,
  accounts: ix.accounts, data: Buffer.from(ix.dataHex, 'hex') }));
const built = buildV1Transaction({ feePayer, supportedTransactionVersions: [1], instructions,
  lifetime: { blockhash: request.blockhash, lastValidBlockHeight: BigInt(request.lastValidBlockHeight) },
  resources: { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 67_108_864,
    heapSize: 262_144, priorityFeeLamports: BigInt(request.priorityFeeLamports ?? 17) } });
const signed = await signTransaction([pair], built.transaction);
writeFileSync(output, transactionBytes(signed));
