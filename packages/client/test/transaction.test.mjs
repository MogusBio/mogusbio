import test from 'node:test';
import assert from 'node:assert/strict';
import { verify, createPublicKey } from 'node:crypto';
import { generateKeyPair, getAddressFromPublicKey, signTransaction, AccountRole, getAddressEncoder } from '@solana/kit';
import { buildV1Transaction, decodeV1Transaction, transactionBytes } from '../src/index.mjs';

const ZERO = '11111111111111111111111111111111';
const PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const resources = { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 67_108_864,
  heapSize: 262_144, priorityFeeLamports: 17n };
const lifetime = { blockhash: ZERO, lastValidBlockHeight: 10n };
const build = (feePayer, overrides = {}) => buildV1Transaction({ feePayer, lifetime,
  supportedTransactionVersions: [1], resources,
  instructions: [{ programAddress: PROGRAM, data: Buffer.alloc(1160, 0x61), accounts: [] }], ...overrides });

test('official Kit8 constructs and really signs a >legacy v1 packet with all resource config', async () => {
  const pair = await generateKeyPair(), feePayer = await getAddressFromPublicKey(pair.publicKey);
  const unsigned = build(feePayer), signed = await signTransaction([pair], unsigned.transaction);
  const bytes = transactionBytes(signed);
  assert.equal(bytes[0], 0x81); assert.ok(bytes.length > 1232 && bytes.length <= 4096);
  const { transaction, message } = decodeV1Transaction(bytes);
  assert.equal(message.version, 1); assert.equal(message.configMask, 31);
  assert.deepEqual(message.configValues.map(v => v.value), [17n, 1_400_000, 67_108_864, 262_144]);
  const rawPublic = Buffer.from(getAddressEncoder().encode(feePayer));
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublic]), type: 'spki', format: 'der' });
  assert.equal(verify(null, transaction.messageBytes, publicKey, transaction.signatures[feePayer]), true);
  const tampered = Buffer.from(transaction.messageBytes); tampered[20] ^= 1;
  assert.equal(verify(null, tampered, publicKey, transaction.signatures[feePayer]), false);
  assert.deepEqual(transactionBytes(transaction), bytes);
});

test('resource limits and supported transaction version are mandatory before signing', () => {
  assert.throws(() => build(ZERO, { supportedTransactionVersions: [0] }), /UNSUPPORTED/);
  for (const invalid of [{}, { ...resources, computeUnitLimit: 0 }, { ...resources, loadedAccountsDataSizeLimit: 0 },
    { ...resources, computeUnitLimit: 1_400_001 }, { ...resources, heapSize: 33_000 },
    { ...resources, priorityFeeLamports: 17 }]) assert.throws(() => build(ZERO, { resources: invalid }));
  assert.throws(() => build(ZERO, { instructions: [{ programAddress: 'ComputeBudget111111111111111111111111111111', data: Buffer.alloc(0) }] }), /MESSAGE_RESOURCE_CONFIG/);
  assert.throws(() => build(ZERO, { instructions: [{ programAddress: PROGRAM, data: Buffer.alloc(4096) }] }), /4096/);
});

test('v1 parser rejects wrong prefix, unknown masks, trailing bytes and truncated signatures', () => {
  const bytes = transactionBytes(build(ZERO).transaction);
  const wrongVersion = Buffer.from(bytes); wrongVersion[0] = 0x80;
  assert.throws(() => decodeV1Transaction(wrongVersion));
  const unknownMask = Buffer.from(bytes); unknownMask[7] = 0x80;
  assert.throws(() => decodeV1Transaction(unknownMask));
  assert.throws(() => decodeV1Transaction(Buffer.concat([bytes, Buffer.from([0])])));
  assert.throws(() => decodeV1Transaction(bytes.subarray(0, -1)));
});

test('multiple real signers occupy tail signatures without compact prefix', async () => {
  const first = await generateKeyPair(), second = await generateKeyPair();
  const payer = await getAddressFromPublicKey(first.publicKey), actor = await getAddressFromPublicKey(second.publicKey);
  const built = build(payer, { instructions: [{ programAddress: PROGRAM, data: Buffer.alloc(1160),
    accounts: [{ address: actor, role: AccountRole.READONLY_SIGNER }] }] });
  await assert.rejects(signTransaction([first], built.transaction));
  const signed = await signTransaction([first, second], built.transaction), bytes = transactionBytes(signed);
  const { transaction } = decodeV1Transaction(bytes);
  assert.equal(Object.keys(transaction.signatures).length, 2);
  assert.equal(bytes.subarray(-128).length, 128);
});
