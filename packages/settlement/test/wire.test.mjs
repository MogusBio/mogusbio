import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePositionBody, decodePositionBody, encodeHourBody, decodeHourBody, emptyHourWire,
  encodeClaimPositionPayload, decodeClaimPositionPayload,
  encodeClaimPositionResult, decodeClaimPositionResult,
  normalWeight, hourBudget, W_FLOOR,
} from '../src/index.mjs';
import { encodeRecord, decodeRecord, encodeExactFrame, decodeExactFrame } from '../../protocol-core/src/p0.mjs';
import { encodeActorNonceBody, decodeActorNonceBody, nonceOpId } from '../../protocol-core/src/atomic.mjs';

const bytes = (n) => Buffer.alloc(32, n);
const position = () => ({
  instance: bytes(1), rootSeq: 0n, rootDirectorySeq: 7n, registrationM: bytes(2), beneficiary: bytes(3),
  rootRevision: 0n, B_int: 7_200_000n, q_ppm: 2_000_000, L_quarters: 12,
  weight: normalWeight({ scope: 'BIO', B_int: 7_200_000n, q_ppm: 2_000_000n }),
  start: 0n, end: null, endReason: 0, endBusiness: bytes(0),
  createdTime: 10n, createdSlot: 11n, endedTime: 0n, endedSlot: 0n,
  accrued: 470_890n, paid: 10n, nextUnsettledHour: 1n,
});
const header = (kind, schema, body) => ({ kind, schema, body, domain: bytes(10), configId: bytes(11), bump: 255, recordKey: bytes(12) });

test('Position schema2 exact 255-byte body / 375-byte record and independent LE offsets', () => {
  const p = position();
  const encoded = encodePositionBody(p);
  assert.equal(encoded.length, 255);
  assert.deepEqual(decodePositionBody(encoded), p);
  assert.equal(encoded.readBigUInt64LE(231), 470_890n);
  assert.equal(encoded.readBigUInt64LE(239), 10n);
  assert.equal(encoded.readBigUInt64LE(247), 1n);
  assert.equal(encoded.readBigUInt64LE(40), 7n);
  const full = encodeRecord(header(27, 2, encoded));
  assert.equal(full.length, 375);
  assert.deepEqual(decodePositionBody(decodeRecord(full).body), p);
});

test('Position Bound9 is fixed width and OPEN must have zero value', () => {
  const encoded = encodePositionBody(position());
  assert.equal(encoded[157], 0);
  assert.equal(encoded.readBigUInt64LE(158), 0n);
  const invalid = Buffer.from(encoded); invalid[158] = 1;
  assert.throws(() => decodePositionBody(invalid), { code: 'NONCANONICAL_END_BOUND' });
  const closed = { ...position(), end: 2n, endReason: 1, endBusiness: bytes(4), endedTime: 20n, endedSlot: 21n };
  assert.deepEqual(decodePositionBody(encodePositionBody(closed)), closed);
});

test('Position canonical decoder rejects short, trailing, false weight, unpaid overflow and invalid quantum', () => {
  const encoded = encodePositionBody(position());
  assert.throws(() => decodePositionBody(encoded.subarray(0, 254)));
  assert.throws(() => decodePositionBody(Buffer.concat([encoded, Buffer.from([0])])));
  assert.throws(() => encodePositionBody({ ...position(), weight: 1n }), { code: 'POSITION_WEIGHT' });
  assert.throws(() => encodePositionBody({ ...position(), paid: 470_891n }), { code: 'POSITION_INVARIANT' });
  assert.throws(() => encodePositionBody({ ...position(), q_ppm: 1_000_001 }), { code: 'QUALITY_NOT_MILLIQUANTIZED' });
});

test('Position zero length permitted only deterministic certificate fault', () => {
  const p = { ...position(), start: 1n, end: 1n, endReason: 2,
    nextUnsettledHour: 1n, accrued: 0n, paid: 0n, endBusiness: bytes(5), endedTime: 20n, endedSlot: 21n };
  assert.deepEqual(decodePositionBody(encodePositionBody(p)), p);
  assert.throws(() => encodePositionBody({ ...p, endReason: 1 }), { code: 'POSITION_END_FACTS' });
});

test('Hour schema2 body297 / record417; former paid_sum is zero reserved at offset257', () => {
  const hour = emptyHourWire(0n);
  const encoded = encodeHourBody(hour);
  assert.equal(encoded.length, 297);
  assert.equal(encoded.readBigUInt64LE(257), 0n);
  assert.equal(encoded.readBigUInt64LE(8), hourBudget(0n));
  assert.deepEqual(decodeHourBody(encoded), hour);
  assert.equal(encodeRecord(header(18, 2, encoded)).length, 417);
  const invalid = Buffer.from(encoded); invalid[257] = 1;
  assert.throws(() => decodeHourBody(invalid));
});

test('Hour exact denominator, final residual and K sentinel validated without trusting bytes', () => {
  const ready = emptyHourWire(0n);
  assert.throws(() => encodeHourBody({ ...ready, denominator: W_FLOOR - 1n }), { code: 'DENOMINATOR_INVARIANT' });
  assert.throws(() => encodeHourBody({ ...ready, kInstance: bytes(1) }), { code: 'K_SENTINEL' });
  assert.throws(() => encodeHourBody({ ...ready, status: 4 }), { code: 'HOUR_CONSERVATION' });
  const final = { ...ready, status: 4, sealedResidual: ready.budget };
  assert.deepEqual(decodeHourBody(encodeHourBody(final)), final);
});

test('CLAIM_POSITION has exact120-byte signed payload / 272-byte ExactFrame and88-byte result', () => {
  const payload = { intervalId: bytes(1), expectedPaid: 100n, upToAccrued: 470_890n,
    destination: bytes(2), rentPayer: bytes(3), maxRentDebit: 10_000n };
  const encoded = encodeClaimPositionPayload(payload);
  assert.equal(encoded.length, 120);
  assert.equal(encoded.readBigUInt64LE(32), 100n);
  assert.equal(encoded.readBigUInt64LE(40), 470_890n);
  assert.deepEqual(decodeClaimPositionPayload(encoded), payload);
  const frame = encodeExactFrame({ module: 1203, opcode: 1, payloadSchema: 1,
    domain: bytes(4), configId: bytes(5), actor: bytes(6), opId: nonceOpId(9n), payload: encoded });
  assert.equal(frame.length, 272);
  assert.deepEqual(decodeClaimPositionPayload(decodeExactFrame(frame).payload), payload);
  const result = { intervalId: bytes(1), beneficiary: bytes(7), amount: 470_790n, paid: 470_890n, accrued: 500_000n };
  assert.equal(encodeClaimPositionResult(result).length, 88);
  assert.deepEqual(decodeClaimPositionResult(encodeClaimPositionResult(result)), result);
});

test('CLAIM_POSITION rejects inverted accumulator, trailing payload and overpaid result', () => {
  const payload = { intervalId: bytes(1), expectedPaid: 20n, upToAccrued: 10n,
    destination: bytes(2), rentPayer: bytes(3), maxRentDebit: 1n };
  assert.throws(() => encodeClaimPositionPayload(payload), { code: 'UNACCRUED_CLAIM' });
  const encoded = encodeClaimPositionPayload({ ...payload, expectedPaid: 0n });
  assert.throws(() => decodeClaimPositionPayload(Buffer.concat([encoded, Buffer.from([0])])));
  assert.throws(() => encodeClaimPositionResult({ intervalId: bytes(1), beneficiary: bytes(2),
    amount: 1n, paid: 1n, accrued: 0n }), { code: 'POSITION_PAYMENT_STATE' });
});

test('ActorNonce uses core codec exact298-body /418-record independent of number of prior actions', () => {
  const entry = { nextNonce: 1_000_000n, lastDigest: bytes(1), lastResult: Buffer.alloc(256, 7) };
  const body = encodeActorNonceBody(entry);
  assert.equal(body.length, 298);
  assert.deepEqual(decodeActorNonceBody(body), entry);
  assert.equal(encodeRecord(header(35, 1, body)).length, 418);
  const empty = encodeActorNonceBody({ nextNonce: 0n, lastDigest: null, lastResult: null });
  assert.equal(empty.length, 298);
});
