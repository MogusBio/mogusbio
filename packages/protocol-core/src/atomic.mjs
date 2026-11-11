import { ByteReader, ByteWriter, asBytes, equalBytes, integer, U64_MAX } from './codec.mjs';
import { ERRORS as E, invariant } from './errors.mjs';
import { businessKey, decodeExactFrame, requestHash } from './p0.mjs';

/** Deterministic model state only: no wallets, RPC AccountInfo, or live runtime objects. */
export function cloneProtocolState(value, memo = new Map()) {
  if (value === null || typeof value !== 'object') {
    invariant(typeof value !== 'function' && typeof value !== 'symbol', E.BAD_FRAME, 'non-data state value');
    return value;
  }
  if (memo.has(value)) return memo.get(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const b = Buffer.from(value); memo.set(value, b); return b;
  }
  let result;
  if (Array.isArray(value)) result = [];
  else if (value instanceof Map) result = new Map();
  else if (value instanceof Set) result = new Set();
  else {
    invariant(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
      E.BAD_FRAME, 'state must contain plain data');
    result = Object.create(Object.getPrototypeOf(value));
  }
  memo.set(value, result);
  if (value instanceof Map) value.forEach((v, k) => result.set(cloneProtocolState(k, memo), cloneProtocolState(v, memo)));
  else if (value instanceof Set) value.forEach((v) => result.add(cloneProtocolState(v, memo)));
  else Object.keys(value).forEach((k) => { result[k] = cloneProtocolState(value[k], memo); });
  return result;
}

export function nonceOpId(nonce) { return new ByteWriter(32).u64(nonce).raw(Buffer.alloc(24)).finish(); }
export function opIdNonce(opId) {
  const r = new ByteReader(opId, 32), nonce = r.u64();
  invariant(r.raw(24).every((v) => v === 0), E.BAD_NONCE_OP_ID, 'v2 opId must be u64 nonce followed by 24 zeros');
  r.finish(); return nonce;
}

/**
 * ECON-SETTLE2 model transaction boundary. `authorizedActors` comes from a trusted
 * ingress; this function does not create or verify a Solana native signature.
 * `transition` must be synchronous and execute all business validation/effects.
 */
export function executeAtomic(state, frameBytes, context, transition) {
  invariant(state !== null && typeof state === 'object' && !Array.isArray(state), E.BAD_FRAME, 'plain protocol state required');
  const frame = decodeExactFrame(frameBytes);
  invariant(!(frame.module === 1201 && (frame.opcode === 2 || frame.payloadSchema === 1)),
    E.OPCODE_NOT_OPEN, 'v2 execution does not create or claim per-hour Receipts');
  invariant(equalBytes(frame.domain, context.expectedDomain), E.BAD_DEPLOYMENT_DOMAIN, 'wrong deployment domain');
  const actor = frame.actor.toString('hex');
  invariant(context.authorizedActors instanceof Set && context.authorizedActors.has(actor),
    E.REQUIRED_SIGNER, 'trusted ingress did not authorize actor');
  invariant(typeof transition === 'function', E.BAD_FRAME, 'missing trusted transition');
  invariant(state.actorNonces === undefined || state.actorNonces instanceof Map, E.BAD_FRAME, 'invalid ActorNonce table');
  const nonce = opIdNonce(frame.opId), digest = requestHash(frameBytes), key = `${frame.domain.toString('hex')}:${actor}`;
  const manufactureBusiness = businessKey(frame.domain, frame.actor, frame.opId);
  const current = state.actorNonces?.get(key) ?? { nextNonce: 0n, lastDigest: null, lastResult: null };
  const next = integer(current.nextNonce, 0n, U64_MAX, 'next nonce');
  invariant(next === 0n ? current.lastDigest === null && current.lastResult === null
    : current.lastDigest !== null && current.lastResult !== null, E.BAD_BUSINESS_RECORD, 'invalid ActorNonce initialized state');
  if (next > 0n) { asBytes(current.lastDigest, 32); invariant(asBytes(current.lastResult).length <= 256, E.BAD_BUSINESS_RECORD, 'cached result too large'); }
  if (nonce < next) {
    invariant(nonce + 1n === next, E.ALREADY_PROCESSED, 'old nonce already processed; consult local history');
    invariant(equalBytes(digest, current.lastDigest), E.IDEMPOTENCY_CONFLICT, 'latest nonce with different request');
    return { state: cloneProtocolState(state), resultBytes: asBytes(current.lastResult), replayed: true,
      businessKey: Buffer.from(manufactureBusiness), nonce };
  }
  invariant(nonce === next, E.NONCE_GAP, 'nonce is ahead of next nonce');
  invariant(next < U64_MAX, E.INTEGER_RANGE, 'ActorNonce exhausted');
  const draft = cloneProtocolState(state), preservedNonces = cloneProtocolState(state.actorNonces ?? new Map());
  const result = transition(draft, { frame: cloneProtocolState(frame), businessKey: Buffer.from(manufactureBusiness), nonce });
  invariant(!(result && typeof result.then === 'function'), E.BAD_FRAME, 'atomic transition must be synchronous');
  const resultBytes = asBytes(result);
  invariant(resultBytes.length <= 256, E.BAD_FRAME, 'atomic result exceeds 256 bytes');
  preservedNonces.set(key, { nextNonce: next + 1n, lastDigest: Buffer.from(digest), lastResult: Buffer.from(resultBytes) });
  draft.actorNonces = preservedNonces;
  return { state: draft, resultBytes, replayed: false, businessKey: Buffer.from(manufactureBusiness), nonce };
}

/** Fixed-size v2 nonce body; no complete per-operation request/account remains. */
export function encodeActorNonceBody(entry) {
  const next = integer(entry.nextNonce, 0n, U64_MAX);
  const digest = next === 0n ? Buffer.alloc(32) : asBytes(entry.lastDigest, 32);
  const result = next === 0n ? Buffer.alloc(0) : asBytes(entry.lastResult);
  invariant(next !== 0n || (entry.lastDigest === null && entry.lastResult === null), E.BAD_BUSINESS_RECORD, 'nonce zero must be empty');
  invariant(result.length <= 256, E.BAD_BUSINESS_RECORD, 'nonce result exceeds capacity');
  return new ByteWriter(298).u64(next).raw(digest).u16(result.length).raw(result).raw(Buffer.alloc(256 - result.length)).finish();
}
export function decodeActorNonceBody(bytes) {
  const r = new ByteReader(bytes, 298), nextNonce = r.u64(), digest = r.raw(32), length = r.u16();
  invariant(length <= 256, E.BAD_BUSINESS_RECORD, 'nonce result exceeds capacity');
  const result = r.raw(length); r.zero(256 - length); r.finish();
  if (nextNonce === 0n) {
    invariant(digest.every((v) => v === 0) && length === 0, E.BAD_BUSINESS_RECORD, 'nonce zero must have empty cache');
    return { nextNonce, lastDigest: null, lastResult: null };
  }
  return { nextNonce, lastDigest: digest, lastResult: result };
}
