import test from 'node:test';
import assert from 'node:assert/strict';
import { typedHash, deploymentDomain, businessKey, sourceId, instanceId, receiptKey, requestHash, encodeExactFrame, decodeExactFrame,
  encodeRecord, decodeRecord, encodeSourceSlice, decodeSourceSlice, encodeBusinessRecord, decodeBusinessRecord, inspectBusinessRetry,
  OPEN_OPERATIONS, EXECUTION_V2_WIRE, ProtocolError, ERRORS as E } from '../src/index.mjs';
import { bytes, OWNER, DOMAIN, CONFIG } from './fixtures.mjs';
const hex = (b) => b.toString('hex');
const fail = (fn, code) => assert.throws(fn, (e) => e instanceof ProtocolError && e.code === code);
function if2() { return encodeExactFrame({ module: 1, opcode: 3, domain: DOMAIN, configId: CONFIG, actor: OWNER,
  opId: bytes(0x22), payload: Buffer.concat([bytes(0x33), OWNER]) }); }

test('P0 frozen typed SHA goldens agree independently of round trips', () => {
  assert.equal(hex(deploymentDomain(bytes(0), bytes(0), bytes(0))), '4ba013682c3313d8fdd88a28046896360e5fb4e796a347eaa04bb82217b6ed02');
  assert.equal(hex(businessKey(bytes(0), bytes(0x11), bytes(0x22))), 'acd5cc2e7190fd0b0c0d3e8a8415fe0aa8dd78adbf179dd53b1da778037f8439');
  assert.equal(hex(receiptKey(bytes(0), bytes(0x33), 1n)), '60e8b657eedb902f87f46d410110020591ddaa76d6418357c3e8263523fd8deb');
  fail(() => typedHash(0, Buffer.alloc(0)), E.UNSUPPORTED_VERSION_OR_SCHEMA);
  fail(() => typedHash(23, Buffer.alloc(0)), E.UNSUPPORTED_VERSION_OR_SCHEMA);
  assert.notDeepEqual(typedHash(1, bytes(0)), typedHash(2, bytes(0)));
});
test('P1 amended Source identity includes ordinal, distinct from instance', () => {
  const m = businessKey(DOMAIN, OWNER, bytes(0x22));
  assert.equal(hex(m), '6a68ff9fd3c89a1c1881d39fdcbdb569d73f6a90bd1c453b9f81b5fe91c3169f');
  const expected = ['827130d74857f4f1f6f738ba01366dbe926e86c62a8cf2b49dabceffe182c01c',
    'f30dbe1e4aee081424a10793fa7fad3790097bc4a861f140260575238df2c8b9',
    'bc730ee3a57b499e65d417e6a4565554f2bd1d2910b07e38405fe1e4f7d0867d',
    'a10567ad624839ab5bfd811de21d7f7a54d7f40c113742c08291b1ecd8854c96'];
  expected.forEach((h, i) => assert.equal(hex(sourceId(DOMAIN, m, i)), h));
  assert.notDeepEqual(sourceId(DOMAIN, m, 0), instanceId(DOMAIN, m));
  fail(() => sourceId(DOMAIN, m, 32), E.INTEGER_RANGE);
});
test('IF2 complete frame uses the frozen byte length and request digest', () => {
  const frame = if2(); assert.equal(frame.length, 216);
  assert.equal(hex(requestHash(frame)), '59ac428a5255d3b76d9714a26045987f800aeba8aeb255100c5b86655287984e');
  const decoded = decodeExactFrame(frame); assert.deepEqual(encodeExactFrame(decoded), frame);
  assert.equal(decoded.module, 1); assert.equal(decoded.payloadSchema, 1);
  assert.equal(frame.subarray(144, 152).toString('hex'), '4000000000000000');
});
test('ExactFrame rejects unknown versions, P1 direct writes, tails, reserved and oversized payloads', () => {
  for (const [offset, value, code] of [[8, 2, E.UNSUPPORTED_VERSION_OR_SCHEMA], [14, 2, E.UNSUPPORTED_VERSION_OR_SCHEMA], [148, 1, E.BAD_FRAME]]) {
    const f = if2(); f[offset] = value; fail(() => decodeExactFrame(f), code);
  }
  const f = if2(); f.writeUInt16LE(101, 10); f.writeUInt16LE(1, 12); fail(() => decodeExactFrame(f), E.OPCODE_NOT_OPEN);
  fail(() => decodeExactFrame(Buffer.concat([if2(), Buffer.alloc(1)])), E.BAD_FRAME);
  fail(() => encodeExactFrame({ ...decodeExactFrame(if2()), payload: Buffer.alloc(3945) }), E.BAD_FRAME);
});
test('120-byte record header and 50-byte slices preserve exact ranges', () => {
  const record = encodeRecord({ kind: 1, schema: 1, domain: DOMAIN, configId: bytes(0), recordKey: bytes(0), bump: 255,
    body: Buffer.from([1, 0]) });
  assert.equal(record.length, 122); assert.equal(record[84], 255); assert.equal(decodeRecord(record).body.length, 2);
  const corrupt = Buffer.from(record); corrupt[85] = 1; fail(() => decodeRecord(corrupt), E.BAD_FRAME);
  fail(() => decodeRecord(Buffer.concat([record, Buffer.alloc(1)])), E.BAD_PDA_OR_HEADER);
  const s = encodeSourceSlice({ sourceId: DOMAIN, species: 1, lo: 500n, hi: 1000n });
  assert.equal(s.length, 50); assert.equal(s.subarray(32).toString('hex'), '0100f401000000000000e803000000000000');
  assert.equal(decodeSourceSlice(s).lo, 500n);
  fail(() => encodeSourceSlice({ sourceId: DOMAIN, species: 1, lo: 1n, hi: 1n }), E.BAD_MATERIAL_PLAN);
});
test('legacy frozen Business stores full request bytes and checks repeated identity', () => {
  const requestBytes = if2(), resultBytes = Buffer.alloc(128, 0x44);
  const record = encodeBusinessRecord({ requestBytes, resultBytes, committedAt: 2n, committedSlot: 3n, bump: 254 });
  assert.equal(record.length, 588);
  assert.deepEqual(decodeBusinessRecord(record).resultBytes, resultBytes);
  assert.deepEqual(inspectBusinessRetry(requestBytes, record, DOMAIN), resultBytes);
  const changed = Buffer.from(requestBytes); changed[152] ^= 1;
  fail(() => inspectBusinessRetry(changed, record, DOMAIN), E.IDEMPOTENCY_CONFLICT);
  const bad = Buffer.from(record); bad[120] ^= 1;
  fail(() => decodeBusinessRecord(bad), E.BAD_BUSINESS_RECORD);
  fail(() => inspectBusinessRetry(requestBytes, record, bytes(1)), E.BAD_DEPLOYMENT_DOMAIN);
});
test('closed operation registry preserves the independently specified P3 and ROLLUP1 result sizes', () => {
  assert.equal(OPEN_OPERATIONS.find((x) => x.module === 301 && x.opcode === 1).resultLength, 56);
  assert.equal(OPEN_OPERATIONS.find((x) => x.module === 702 && x.opcode === 1).resultLength, 176);
  assert.equal(OPEN_OPERATIONS.some((x) => [101, 601, 602, 603].includes(x.module)), false);
  fail(() => encodeExactFrame({ ...decodeExactFrame(if2()), module: 1002, opcode: 6 }), E.OPCODE_NOT_OPEN);
});
test('approved SETTLE2 wire has distinct schemas and fixed bounded records', () => {
  assert.deepEqual(EXECUTION_V2_WIRE.records.map((r) => [r.kind, r.schema, r.bodyLength, r.totalLength]),
    [[27, 2, 255, 375], [18, 2, 297, 417], [35, 1, 298, 418]]);
  assert.equal(EXECUTION_V2_WIRE.productionEnabled, false);
  const p = encodeExactFrame({ ...decodeExactFrame(if2()), module: 1201, opcode: 1, payloadSchema: 2, payload: Buffer.alloc(57) });
  assert.equal(decodeExactFrame(p).payloadSchema, 2);
  const claim = encodeExactFrame({ ...decodeExactFrame(if2()), module: 1203, opcode: 1, payload: Buffer.alloc(120) });
  assert.equal(claim.length, 272);
  EXECUTION_V2_WIRE.records.forEach((r) => {
    const encoded = encodeRecord({ ...r, domain: DOMAIN, configId: CONFIG, recordKey: bytes(9), bump: 255, body: Buffer.alloc(r.bodyLength) });
    assert.equal(encoded.length, r.totalLength); assert.equal(decodeRecord(encoded).schema, r.schema);
  });
});
