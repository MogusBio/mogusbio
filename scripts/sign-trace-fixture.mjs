import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, getAddressDecoder, signTransaction } from '@solana/kit';
import { buildV1Transaction, transactionBytes } from '../packages/client/src/transaction.mjs';

// Public RFC8032 test vector only. This process has no RPC or user wallet.
const acceptancePair = await createKeyPairFromPrivateKeyBytes(Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'));
const fixturePair = n => createKeyPairFromPrivateKeyBytes(createHash('sha256').update(`BIOP0R2 native SIGNING FIXTURE ONLY ${n}`).digest());
const productionPair = await fixturePair(1), programPair = await fixturePair(0);
const productionProgram = await getAddressFromPublicKey(programPair.publicKey);
const acceptanceProgram = getAddressDecoder().decode(Buffer.alloc(32, 0x45));
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line) continue;
  const request = JSON.parse(line);
  const pair = request.productionWire === true ? productionPair : acceptancePair;
  const feePayer = await getAddressFromPublicKey(pair.publicKey);
  if (request.fixtureOnly !== true || request.feePayer !== feePayer) throw new Error('LOCAL_TRACE_FIXTURE_SIGNER_ONLY');
  const allowed = new Set([request.productionWire === true ? productionProgram : acceptanceProgram,
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL','11111111111111111111111111111111']);
  if (request.instructions.some(ix => !allowed.has(ix.programId) || !/^(?:[0-9a-f]{2})*$/.test(ix.dataHex)))
    throw new Error('LOCAL_TRACE_FIXTURE_PROGRAM_ONLY');
  const instructions = request.instructions.map(ix => ({ programAddress: ix.programId,
    accounts: ix.accounts.map(a => ({ address: a.pubkey, role: (a.isSigner ? 2 : 0) + (a.isWritable ? 1 : 0) })),
    data: Buffer.from(ix.dataHex, 'hex') }));
  if (instructions.some(ix => ix.accounts.some(a => (a.role & 2) && a.address !== feePayer)))
    throw new Error('TRACE_REQUIRES_UNAVAILABLE_SIGNER');
  const built = buildV1Transaction({ feePayer, supportedTransactionVersions: [1], instructions,
    lifetime: { blockhash: request.blockhash, lastValidBlockHeight: BigInt(request.lastValidBlockHeight) },
    resources: { computeUnitLimit: request.maxCU, loadedAccountsDataSizeLimit: 67_108_864,
      heapSize: request.heap, priorityFeeLamports: 0n } });
  const signed = await signTransaction([pair], built.transaction);
  process.stdout.write(`${JSON.stringify({ seq: request.seq, bytesHex: transactionBytes(signed).toString('hex') })}\n`);
}
