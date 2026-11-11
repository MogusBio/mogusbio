import { ByteReader, ByteWriter, asBytes } from '../../protocol-core/src/codec.mjs';
import { requireThat, u64, time, min } from './arithmetic.mjs';
import { H_END, hourBudget } from './emission.mjs';
import { normalWeight, K_WEIGHT, denominator } from './weights.mjs';

export const POSITION_BODY_SIZE = 255;
export const HOUR_BODY_SIZE = 297;
export const CLAIM_POSITION_PAYLOAD_SIZE = 120;
export const CLAIM_POSITION_RESULT_SIZE = 88;
const zero32 = () => Buffer.alloc(32);
const isZero = (bytes) => asBytes(bytes, 32).every((byte) => byte === 0);
const endBound = (writer, end) => writer.u8(end === null ? 0 : 1).u64(end ?? 0n);
const readEnd = (reader) => {
  const tag = reader.u8(), value = reader.u64();
  requireThat(tag <= 1 && (tag !== 0 || value === 0n), 'NONCANONICAL_END_BOUND');
  return tag === 0 ? null : value;
};

function validatePosition(p) {
  [p.instance, p.registrationM, p.beneficiary, p.endBusiness].forEach((v) => asBytes(v, 32));
  for (const name of ['rootSeq', 'rootDirectorySeq', 'rootRevision', 'B_int', 'start',
    'createdSlot', 'endedSlot', 'accrued', 'paid', 'nextUnsettledHour']) u64(p[name], name);
  time(p.createdTime); time(p.endedTime);
  requireThat(p.start < H_END && p.paid <= p.accrued, 'POSITION_INVARIANT');
  requireThat(Number.isInteger(p.q_ppm) && Number.isInteger(p.L_quarters), 'POSITION_INVARIANT');
  const scope = ({ 4: 'COMPONENT', 6: 'CELL', 10: 'ORGAN', 12: 'BIO' })[p.L_quarters];
  requireThat(scope, 'INVALID_SCOPE');
  requireThat(p.weight === normalWeight({ scope, B_int: p.B_int, q_ppm: BigInt(p.q_ppm) }), 'POSITION_WEIGHT');
  if (p.end === null) {
    requireThat(p.endReason === 0 && isZero(p.endBusiness) && p.endedTime === 0n && p.endedSlot === 0n,
      'POSITION_END_FACTS');
  } else {
    u64(p.end);
    requireThat(p.end >= p.start && (p.endReason === 1 || p.endReason === 2)
      && (p.end > p.start || p.endReason === 2) && p.endedTime >= p.createdTime,
    'POSITION_END_FACTS');
  }
  requireThat(p.nextUnsettledHour >= p.start && p.nextUnsettledHour <= min(p.end ?? H_END, H_END), 'COVERAGE_SEQUENCE');
}

/** kind27/schema2 body. Header/PDA/owner/domain are validated by the adapter. */
export function encodePositionBody(p) {
  validatePosition(p);
  const w = new ByteWriter(POSITION_BODY_SIZE).raw(p.instance, 32).u64(p.rootSeq)
    .u64(p.rootDirectorySeq).raw(p.registrationM, 32).raw(p.beneficiary, 32)
    .u64(p.rootRevision).u64(p.B_int).u32(p.q_ppm).u8(p.L_quarters).u128(p.weight).u64(p.start);
  endBound(w, p.end).u8(p.endReason).raw(p.endBusiness, 32)
    .i64(p.createdTime).u64(p.createdSlot).i64(p.endedTime).u64(p.endedSlot)
    .u64(p.accrued).u64(p.paid).u64(p.nextUnsettledHour);
  return w.finish();
}

export function decodePositionBody(bytes) {
  const r = new ByteReader(bytes, POSITION_BODY_SIZE);
  const p = { instance: r.raw(32), rootSeq: r.u64(), rootDirectorySeq: r.u64(), registrationM: r.raw(32),
    beneficiary: r.raw(32), rootRevision: r.u64(), B_int: r.u64(), q_ppm: r.u32(), L_quarters: r.u8(),
    weight: r.u128(), start: r.u64(), end: readEnd(r), endReason: r.u8(), endBusiness: r.raw(32),
    createdTime: r.i64(), createdSlot: r.u64(), endedTime: r.i64(), endedSlot: r.u64(),
    accrued: r.u64(), paid: r.u64(), nextUnsettledHour: r.u64() };
  r.finish(); validatePosition(p); return p;
}

function validateHour(h) {
  for (const key of ['hour', 'budget', 'rootCutoff', 'rootCursor', 'materializeCursor', 'members',
    'materializedCount', 'materializedSum', 'sealedResidual', 'openedSlot', 'kCutoff']) u64(h[key], key);
  time(h.openedTime);
  requireThat(h.hour < H_END && h.budget === hourBudget(h.hour), 'HOUR_BUDGET');
  requireThat(Number.isInteger(h.status) && h.status >= 0 && h.status <= 4, 'HOUR_PHASE');
  requireThat(h.rootCursor <= h.rootCutoff && h.materializeCursor <= h.rootCutoff
    && h.materializedCount <= h.members && h.materializedSum <= h.budget, 'HOUR_INVARIANT');
  for (const key of ['kActivationId', 'kInstance', 'kBeneficiary', 'kIntervalId']) asBytes(h[key], 32);
  requireThat(h.kWeight === 0n || h.kWeight === K_WEIGHT, 'INVALID_K_WEIGHT');
  if (h.kWeight === 0n) requireThat(['kActivationId', 'kInstance', 'kBeneficiary', 'kIntervalId']
    .every((key) => isZero(h[key])), 'K_SENTINEL');
  else requireThat(['kActivationId', 'kInstance', 'kBeneficiary', 'kIntervalId']
    .every((key) => !isZero(h[key])), 'K_SENTINEL');
  if (h.status >= 2) requireThat(h.totalWeight === h.normalWeight + h.kWeight
    && h.denominator === denominator(h.totalWeight), 'DENOMINATOR_INVARIANT');
  else requireThat(h.totalWeight === 0n && h.denominator === 0n, 'DENOMINATOR_NOT_FIXED');
  if (h.status === 4) requireThat(h.materializeCursor === h.rootCutoff
    && h.materializedCount === h.members && h.materializedSum + h.sealedResidual === h.budget, 'HOUR_CONSERVATION');
  else requireThat(h.sealedResidual === 0n, 'PREMATURE_RESIDUAL');
}

/** kind18/schema2 retains the previous paid_sum slot as eight reserved zeros. */
export function encodeHourBody(h) {
  validateHour(h);
  return new ByteWriter(HOUR_BODY_SIZE).u64(h.hour).u64(h.budget).u64(h.rootCutoff)
    .u64(h.rootCursor).u64(h.materializeCursor).u8(h.status).u64(h.members).u64(h.materializedCount)
    .u128(h.normalWeight).raw(h.kActivationId, 32).raw(h.kInstance, 32).raw(h.kBeneficiary, 32)
    .raw(h.kIntervalId, 32).u128(h.kWeight).u128(h.totalWeight).u128(h.denominator)
    .u64(h.materializedSum).u64(0n).u64(h.sealedResidual).i64(h.openedTime).u64(h.openedSlot).u64(h.kCutoff).finish();
}

export function decodeHourBody(bytes) {
  const r = new ByteReader(bytes, HOUR_BODY_SIZE);
  const h = { hour: r.u64(), budget: r.u64(), rootCutoff: r.u64(), rootCursor: r.u64(),
    materializeCursor: r.u64(), status: r.u8(), members: r.u64(), materializedCount: r.u64(),
    normalWeight: r.u128(), kActivationId: r.raw(32), kInstance: r.raw(32), kBeneficiary: r.raw(32),
    kIntervalId: r.raw(32), kWeight: r.u128(), totalWeight: r.u128(), denominator: r.u128(), materializedSum: r.u64() };
  r.zero(8);
  Object.assign(h, { sealedResidual: r.u64(), openedTime: r.i64(), openedSlot: r.u64(), kCutoff: r.u64() });
  r.finish(); validateHour(h); return h;
}

export function encodeClaimPositionPayload(p) {
  u64(p.expectedPaid); u64(p.upToAccrued); u64(p.maxRentDebit);
  requireThat(p.upToAccrued >= p.expectedPaid, 'UNACCRUED_CLAIM');
  return new ByteWriter(CLAIM_POSITION_PAYLOAD_SIZE).raw(p.intervalId, 32).u64(p.expectedPaid)
    .u64(p.upToAccrued).raw(p.destination, 32).raw(p.rentPayer, 32).u64(p.maxRentDebit).finish();
}

export function decodeClaimPositionPayload(bytes) {
  const r = new ByteReader(bytes, CLAIM_POSITION_PAYLOAD_SIZE);
  const p = { intervalId: r.raw(32), expectedPaid: r.u64(), upToAccrued: r.u64(),
    destination: r.raw(32), rentPayer: r.raw(32), maxRentDebit: r.u64() };
  r.finish(); encodeClaimPositionPayload(p); return p;
}

export function encodeClaimPositionResult(p) {
  [p.amount, p.paid, p.accrued].forEach((n) => u64(n));
  requireThat(p.amount <= p.paid && p.paid <= p.accrued, 'POSITION_PAYMENT_STATE');
  return new ByteWriter(CLAIM_POSITION_RESULT_SIZE).raw(p.intervalId, 32).raw(p.beneficiary, 32)
    .u64(p.amount).u64(p.paid).u64(p.accrued).finish();
}

export function decodeClaimPositionResult(bytes) {
  const r = new ByteReader(bytes, CLAIM_POSITION_RESULT_SIZE);
  const result = { intervalId: r.raw(32), beneficiary: r.raw(32), amount: r.u64(), paid: r.u64(), accrued: r.u64() };
  r.finish(); encodeClaimPositionResult(result); return result;
}

export function emptyHourWire(hour) {
  return { hour, budget: hourBudget(hour), rootCutoff: 0n, rootCursor: 0n, materializeCursor: 0n,
    status: 2, members: 0n, materializedCount: 0n, normalWeight: 0n, kActivationId: zero32(),
    kInstance: zero32(), kBeneficiary: zero32(), kIntervalId: zero32(), kWeight: 0n,
    totalWeight: 0n, denominator: denominator(0n), materializedSum: 0n, sealedResidual: 0n,
    openedTime: 0n, openedSlot: 0n, kCutoff: 0n };
}
