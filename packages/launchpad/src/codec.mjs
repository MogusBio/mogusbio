import { ByteReader, ByteWriter, integer, U64_MAX, ERRORS, invariant } from '../../protocol-core/src/index.mjs';

export const CREATE_FEE = 10000000n;
export const RESOURCE_FEE_PER_UNIT = 100000n;
export const MAX_UNIT_PRICE = U64_MAX - RESOURCE_FEE_PER_UNIT;
export const SEASON_CAPS = Object.freeze([50000n, 100000n, 25000n, 25000n]);
export const LIFETIME_CAPS = Object.freeze(SEASON_CAPS.map((n) => n * 100n));

function validateClassParameters(parameters) {
  invariant(Array.isArray(parameters) && parameters.length === 4, 6201, 'exactly four class parameters required');
  parameters.forEach((c, i) => {
    invariant(c.class === i + 1, 6201, 'class parameters must be ordered 1 through 4');
    integer(c.lifetimeCap, 1n, 1000000n); integer(c.priceLamports, 0n, MAX_UNIT_PRICE);
  });
}
export function encodeCreatePayload(p) {
  validateClassParameters(p.classes);
  const w = new ByteWriter(280).raw(p.catalogHash, 32).raw(p.saleRecipient, 32).raw(p.principalPayer, 32).raw(p.rentPayer, 32)
    .u64(p.maxProtocolLamports).u64(p.maxRentLamports).text(p.name, 64);
  p.classes.forEach((c) => w.u8(c.class).u64(c.lifetimeCap).u64(c.priceLamports)); return w.finish();
}
export function decodeCreatePayload(bytes) {
  const r = new ByteReader(bytes, 280);
  const p = { catalogHash: r.raw(32), saleRecipient: r.raw(32), principalPayer: r.raw(32), rentPayer: r.raw(32),
    maxProtocolLamports: r.u64(), maxRentLamports: r.u64(), name: r.text(64) };
  p.classes = Array.from({ length: 4 }, () => ({ class: r.u8(), lifetimeCap: r.u64(), priceLamports: r.u64() }));
  r.finish(); validateClassParameters(p.classes); return p;
}
export function encodeBuyPayload(p) {
  return new ByteWriter(300).raw(p.projectId, 32).u8(p.class).raw(p.mint, 32).raw(p.catalogHash, 32).u64(p.quantity)
    .raw(p.principalPayer, 32).raw(p.materialRecipient, 32).raw(p.destinationToken, 32).u8(p.destinationMode)
    .raw(p.saleRecipient, 32).u64(p.unitPriceLamports).u64(p.resourcePerUnitLamports).u64(p.maxProtocolLamports)
    .raw(p.rentPayer, 32).u64(p.maxRentLamports).u16(p.expectedSeason).finish();
}
export function decodeBuyPayload(bytes) {
  const r = new ByteReader(bytes, 300);
  const p = { projectId: r.raw(32), class: r.u8(), mint: r.raw(32), catalogHash: r.raw(32), quantity: r.u64(),
    principalPayer: r.raw(32), materialRecipient: r.raw(32), destinationToken: r.raw(32), destinationMode: r.u8(),
    saleRecipient: r.raw(32), unitPriceLamports: r.u64(), resourcePerUnitLamports: r.u64(), maxProtocolLamports: r.u64(),
    rentPayer: r.raw(32), maxRentLamports: r.u64(), expectedSeason: r.u16() };
  r.finish(); return p;
}
export function encodeQueuePayload(p) {
  return new ByteWriter(168).raw(p.expenseRef, 32).u64(p.expectedNonce).raw(p.recipient, 32).u64(p.amount)
    .raw(p.evidenceHash, 32).i64(p.notBefore).i64(p.expiresAt).raw(p.rentPayer, 32).u64(p.maxRentLamports).finish();
}
export function decodeQueuePayload(bytes) {
  const r = new ByteReader(bytes, 168), p = { expenseRef: r.raw(32), expectedNonce: r.u64(), recipient: r.raw(32), amount: r.u64(),
    evidenceHash: r.raw(32), notBefore: r.i64(), expiresAt: r.i64(), rentPayer: r.raw(32), maxRentLamports: r.u64() };
  r.finish(); return p;
}
export function encodePayPayload(p) {
  invariant(Array.isArray(p.memberIndices) && p.memberIndices.length === 3, 6412, 'three member indices required');
  const w = new ByteWriter(203).raw(p.expenseRef, 32).raw(p.expenseId, 32).u64(p.allocatedNonce).raw(p.recipient, 32)
    .u64(p.amount).raw(p.evidenceHash, 32).i64(p.notBefore).i64(p.expiresAt);
  p.memberIndices.forEach((i) => w.u8(i)); return w.raw(p.rentPayer, 32).u64(p.maxRentLamports).finish();
}
export function decodePayPayload(bytes) {
  const r = new ByteReader(bytes, 203), p = { expenseRef: r.raw(32), expenseId: r.raw(32), allocatedNonce: r.u64(),
    recipient: r.raw(32), amount: r.u64(), evidenceHash: r.raw(32), notBefore: r.i64(), expiresAt: r.i64(),
    memberIndices: [r.u8(), r.u8(), r.u8()], rentPayer: r.raw(32), maxRentLamports: r.u64() };
  r.finish(); return p;
}
export function decodeBuyResult(bytes) {
  const r = new ByteReader(bytes, 58), result = { quantity: r.u64(), saleLamports: r.u64(), resourceLamports: r.u64(),
    rentLamports: r.u64(), season: r.u16(), projectIssued: r.u64(), seasonIssued: r.u64(), lifetimeIssued: r.u64() };
  r.finish(); return result;
}
export function encodeExpenseBody(e) {
  return new ByteWriter(289).raw(e.expenseRef, 32).u64(e.nonce).raw(e.queueActor, 32).raw(e.queueBusiness, 32)
    .raw(e.recipient, 32).u64(e.amount).raw(e.evidenceHash, 32).i64(e.queuedAt).u64(e.queuedSlot)
    .i64(e.notBefore).i64(e.expiresAt).u8(e.status).raw(e.paidBusiness, 32).raw(e.paidActor, 32).i64(e.paidAt).u64(e.paidSlot).finish();
}
export function decodeExpenseBody(bytes) {
  const r = new ByteReader(bytes, 289), e = { expenseRef: r.raw(32), nonce: r.u64(), queueActor: r.raw(32), queueBusiness: r.raw(32),
    recipient: r.raw(32), amount: r.u64(), evidenceHash: r.raw(32), queuedAt: r.i64(), queuedSlot: r.u64(), notBefore: r.i64(),
    expiresAt: r.i64(), status: r.u8(), paidBusiness: r.raw(32), paidActor: r.raw(32), paidAt: r.i64(), paidSlot: r.u64() };
  r.finish(); invariant([0, 1].includes(e.status), 6419, 'unknown Expense status'); return e;
}
