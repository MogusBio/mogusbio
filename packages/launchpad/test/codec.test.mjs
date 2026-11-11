import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCreatePayload, decodeCreatePayload, encodeBuyPayload, decodeBuyPayload, encodeQueuePayload, decodeQueuePayload,
  encodePayPayload, decodePayPayload, expenseId, quotaKey, materialSeason } from '../src/index.mjs';
import { encodeExactFrame, requestHash, catalogHash, ProtocolError } from '../../protocol-core/src/index.mjs';
import { bytes, OWNER, DOMAIN, CONFIG, createFields, queueFields, payFields } from './fixtures.mjs';
const fail = (fn, code) => assert.throws(fn, (e) => e instanceof ProtocolError && (code === undefined || e.code === code));
function oldFrame(module, opcode, op, payload) { return encodeExactFrame({ module, opcode, domain: DOMAIN, configId: CONFIG, actor: OWNER, opId: bytes(op), payload }); }

test('CREATE exact fields match the frozen independent REQUEST golden', () => {
  const p = createFields({ saleRecipient: OWNER, principalPayer: OWNER, rentPayer: OWNER,
    classes: [1, 2, 3, 4].map((c) => ({ class: c, lifetimeCap: 1000n, priceLamports: 500000n })) });
  const payload = encodeCreatePayload(p); assert.equal(payload.length, 219); assert.deepEqual(encodeCreatePayload(decodeCreatePayload(payload)), payload);
  assert.equal(requestHash(oldFrame(201, 1, 0x22, payload)).toString('hex'), 'dbedfb060d5501b803e169609bd51540d2dc360646feb23ef94741383e3cf2cf');
});
test('BUY exact300 bytes and frozen REQUEST golden', () => {
  const p = { projectId: Buffer.from('a8c8764dbc95e40ac25991fad75ccffc90e6d29d54940f2d2ad75d8a100d65f7', 'hex'), class: 1, mint: bytes(0x55),
    catalogHash: catalogHash(), quantity: 30n, principalPayer: OWNER, materialRecipient: OWNER, destinationToken: bytes(0x99), destinationMode: 1,
    saleRecipient: OWNER, unitPriceLamports: 500000n, resourcePerUnitLamports: 100000n, maxProtocolLamports: 18000000n,
    rentPayer: OWNER, maxRentLamports: 100000000n, expectedSeason: 0 };
  const payload = encodeBuyPayload(p); assert.equal(payload.length, 300); assert.deepEqual(encodeBuyPayload(decodeBuyPayload(payload)), payload);
  assert.equal(requestHash(oldFrame(202, 1, 0x33, payload)).toString('hex'), '4e9e9a264a6db234e0e9c8645f415b1608748293cc88adc3bec7d10a8ccaca72');
});
test('QUEUE/PAY exact168/203 bytes match frozen independent REQUEST goldens', () => {
  const recipient = Buffer.from('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', 'hex');
  const q = queueFields({ recipient, rentPayer: OWNER }); const payload = encodeQueuePayload(q);
  assert.equal(payload.length, 168); assert.deepEqual(encodeQueuePayload(decodeQueuePayload(payload)), payload);
  assert.equal(requestHash(oldFrame(301, 1, 0x66, payload)).toString('hex'), '9c0ff0ac17b7fce5c74adf3647220be9b5f4cf40ce2f8ea7afa82ef77806c8ea');
  const p = payFields(q, { rentPayer: OWNER }), payPayload = encodePayPayload(p);
  assert.equal(payPayload.length, 203); assert.deepEqual(encodePayPayload(decodePayPayload(payPayload)), payPayload);
  assert.equal(requestHash(oldFrame(301, 2, 0x77, payPayload)).toString('hex'), '547ff23d58fa5b1f24970bced8906915f8b5c7aba31b4e3d73bddf9cb70fdffd');
  assert.equal(expenseId(DOMAIN, bytes(0xaa)).toString('hex'), '2516f739a9f714ba96ac1dac1e5ed1f9b94c156f904ed63b6d5e2bb3d5fc9da2');
});
test('quota identities distinguish season0, season99 and global lifetime', () => {
  assert.equal(quotaKey(DOMAIN, 1, 1, 0).toString('hex'), 'fed4c15d28ff898efc14635f9ff6ae88fa433603b990d136c1f669355e5f3408');
  assert.equal(quotaKey(DOMAIN, 1, 1, 99).toString('hex'), '142df59f3ee2b627b670dc79a12d5b59ed486bed1c6529aeee277ec8e198f7dd');
  assert.equal(quotaKey(DOMAIN, 2, 1, 65535).toString('hex'), '879b45a68a29ebd4fdc9bbfbfb8111289d9fe746e588f832663f17f9a0d57247');
  fail(() => quotaKey(DOMAIN, 2, 1, 0), 6313); fail(() => quotaKey(DOMAIN, 1, 5, 0), 6313);
});
test('all canonical payloads reject tails/truncation and unknown CREATE class order', () => {
  const q = encodeQueuePayload(queueFields());
  fail(() => decodeQueuePayload(Buffer.concat([q, Buffer.alloc(1)]))); fail(() => decodeQueuePayload(q.subarray(0, 167)));
  const p = createFields(); p.classes.reverse(); fail(() => encodeCreatePayload(p), 6201);
});
test('material calendar honors each91/91/91/92-day boundary and full100-season stop', () => {
  const samples = [[0n, 0], [7862399n, 0], [7862400n, 1], [15724800n, 2], [23587200n, 3], [31535999n, 3], [31536000n, 4],
    [756864000n, 96], [764726400n, 97], [772588800n, 98], [780451200n, 99], [788399999n, 99]];
  samples.forEach(([now, expected]) => assert.equal(materialSeason(now, 0n), expected));
  fail(() => materialSeason(788400000n, 0n), 6311); fail(() => materialSeason(0n, 1n), 6311); fail(() => materialSeason(-1n, 0n));
});
