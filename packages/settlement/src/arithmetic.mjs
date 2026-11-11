export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
export const I64_MAX = (1n << 63n) - 1n;

export class SettlementError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'SettlementError';
    this.code = code;
  }
}

export function requireThat(condition, code, message) {
  if (!condition) throw new SettlementError(code, message);
}

export function uint(value, max = U64_MAX, name = 'value') {
  requireThat(typeof value === 'bigint' && value >= 0n && value <= max,
    'ARITHMETIC', `${name} must be a checked nonnegative BigInt <= ${max}`);
  return value;
}

export function u64(value, name) { return uint(value, U64_MAX, name); }
export function u128(value, name) { return uint(value, U128_MAX, name); }
export function time(value) { return uint(value, I64_MAX, 'time'); }
export function add64(a, b) { return u64(u64(a) + u64(b)); }
export function add128(a, b) { return u128(u128(a) + u128(b)); }
export function sub64(a, b) { return u64(u64(a) - u64(b)); }
export function mul128(a, b) { return u128(u128(a) * u128(b)); }
export function min(a, b) { return a < b ? a : b; }
export function max(a, b) { return a > b ? a : b; }
