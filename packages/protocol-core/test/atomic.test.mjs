import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAtomic, nonceOpId, opIdNonce, encodeActorNonceBody, decodeActorNonceBody, encodeExactFrame,
  encodeMaterialPlan, prepareMaterialConsumption, cloneProtocolState, ProtocolError, ERRORS as E } from '../src/index.mjs';
import { fixture, DOMAIN, CONFIG, OWNER, bytes, key } from './fixtures.mjs';
const fail = (fn, code) => assert.throws(fn, (e) => e instanceof ProtocolError && e.code === code);
function context() { return { expectedDomain: DOMAIN, authorizedActors: new Set([key(OWNER)]) }; }
function frame(nonce, payload = Buffer.alloc(0)) { return encodeExactFrame({ module: 501, opcode: 1, domain: DOMAIN,
  configId: CONFIG, actor: OWNER, opId: nonceOpId(nonce), payload }); }

test('v2 opId has one canonical u64 nonce and 24 zero bytes', () => {
  assert.equal(nonceOpId(1n).toString('hex'), `0100000000000000${'00'.repeat(24)}`);
  assert.equal(opIdNonce(nonceOpId(0xffffffffffffffffn)), 0xffffffffffffffffn);
  const bad = nonceOpId(0n); bad[31] = 1; fail(() => opIdNonce(bad), E.BAD_NONCE_OP_ID);
});
test('v2 caches latest result, replays without transition and permanently rejects older nonces', () => {
  let calls = 0; const original = { balance: 3n, actorNonces: new Map() };
  const apply = (s) => { calls += 1; s.balance -= 1n; return Buffer.from([Number(s.balance)]); };
  const first = executeAtomic(original, frame(0n), context(), apply);
  assert.equal(original.balance, 3n); assert.equal(original.actorNonces.size, 0);
  assert.equal(first.state.balance, 2n); assert.equal(first.replayed, false);
  const retry = executeAtomic(first.state, frame(0n), context(), () => { throw new Error('must not run'); });
  assert.deepEqual(retry.resultBytes, first.resultBytes); assert.equal(retry.state.balance, 2n); assert.equal(retry.replayed, true);
  const second = executeAtomic(retry.state, frame(1n), context(), apply);
  assert.equal(second.state.balance, 1n); assert.equal(calls, 2);
  fail(() => executeAtomic(second.state, frame(0n), context(), apply), E.ALREADY_PROCESSED);
  fail(() => executeAtomic(second.state, frame(3n), context(), apply), E.NONCE_GAP);
  fail(() => executeAtomic(first.state, frame(0n, Buffer.from([1])), context(), apply), E.IDEMPOTENCY_CONFLICT);
});
test('latest retry still requires correct domain and actor authorization', () => {
  const r = executeAtomic({ actorNonces: new Map() }, frame(0n), context(), () => Buffer.from([1]));
  fail(() => executeAtomic(r.state, frame(0n), { ...context(), authorizedActors: new Set() }, () => Buffer.alloc(0)), E.REQUIRED_SIGNER);
  fail(() => executeAtomic(r.state, frame(0n), { ...context(), expectedDomain: bytes(1) }, () => Buffer.alloc(0)), E.BAD_DEPLOYMENT_DOMAIN);
});
test('v2 execution cannot enter legacy per-hour Receipt creation or claim', () => {
  const oldMaterialize = encodeExactFrame({ module: 1201, opcode: 1, domain: DOMAIN, configId: CONFIG,
    actor: OWNER, opId: nonceOpId(0n), payload: Buffer.alloc(57) });
  const oldClaim = encodeExactFrame({ module: 1201, opcode: 2, domain: DOMAIN, configId: CONFIG,
    actor: OWNER, opId: nonceOpId(0n), payload: Buffer.alloc(112) });
  fail(() => executeAtomic({}, oldMaterialize, context(), () => Buffer.alloc(0)), E.OPCODE_NOT_OPEN);
  fail(() => executeAtomic({}, oldClaim, context(), () => Buffer.alloc(0)), E.OPCODE_NOT_OPEN);
});
test('a failed complete manufacturing transaction rolls back material, output and nonce together', () => {
  const f = fixture({ opId: nonceOpId(0n) }), original = cloneProtocolState(f.state);
  const payload = Buffer.concat([Buffer.from([1, 0, 1, 0]), OWNER, Buffer.alloc(8), encodeMaterialPlan(f.context.plan)]);
  const signedFrame = frame(0n, payload);
  assert.throws(() => executeAtomic(f.state, signedFrame, context(), (draft, info) => {
    const material = prepareMaterialConsumption(draft, { ...f.context, manufactureBusiness: info.businessKey });
    Object.assign(draft, material.state); draft.roots.set('output', { credit: material.effectiveCreditInt });
    throw new Error('full functional output validation failed');
  }), /functional output validation failed/);
  assert.deepEqual(f.state, original);
  const success = executeAtomic(f.state, signedFrame, context(), (draft, info) => {
    const material = prepareMaterialConsumption(draft, { ...f.context, manufactureBusiness: info.businessKey });
    Object.assign(draft, material.state); draft.roots.set('output', { credit: material.effectiveCreditInt }); return Buffer.alloc(108);
  });
  assert.equal(success.state.sources.size, 4); assert.equal(success.state.roots.size, 1); assert.equal(success.state.actorNonces.size, 1);
  const retry = executeAtomic(success.state, signedFrame, context(), () => { throw new Error('duplicate burn'); });
  assert.equal(retry.state.sources.size, 4); assert.equal(retry.state.roots.size, 1);
});
test('ActorNonce has bounded fixed 298-byte data, strict padding and latest result only', () => {
  const initial = { nextNonce: 0n, lastDigest: null, lastResult: null };
  assert.equal(encodeActorNonceBody(initial).length, 298); assert.deepEqual(decodeActorNonceBody(encodeActorNonceBody(initial)), initial);
  const s = executeAtomic({}, frame(0n), context(), () => Buffer.from([9, 8]));
  const entry = s.state.actorNonces.values().next().value, encoded = encodeActorNonceBody(entry);
  assert.equal(encoded.length, 298); assert.deepEqual(decodeActorNonceBody(encoded), entry);
  const bad = Buffer.from(encoded); bad[297] = 1; fail(() => decodeActorNonceBody(bad), E.BAD_FRAME);
});
test('draft output and cached result do not alias input, result and journal cannot silently diverge', () => {
  const initial = { nested: { buffer: Buffer.from([1]) }, actorNonces: new Map() }, result = Buffer.from([5]);
  const first = executeAtomic(initial, frame(0n), context(), (draft) => { draft.nested.buffer[0] = 2; draft.actorNonces.clear(); return result; });
  result[0] = 9; first.resultBytes[0] = 7;
  assert.equal(initial.nested.buffer[0], 1); assert.equal(first.state.nested.buffer[0], 2);
  const retry = executeAtomic(first.state, frame(0n), context(), () => Buffer.alloc(0)); assert.deepEqual(retry.resultBytes, Buffer.from([5]));
  fail(() => executeAtomic(first.state, frame(1n), context(), () => Buffer.alloc(257)), E.BAD_FRAME);
  fail(() => executeAtomic(first.state, frame(1n), context(), () => Promise.resolve(Buffer.alloc(0))), E.BAD_FRAME);
  assert.equal(first.state.actorNonces.values().next().value.nextNonce, 1n);
});
