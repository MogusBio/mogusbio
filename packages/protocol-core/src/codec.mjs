import { ERRORS as E, ProtocolError, invariant } from './errors.mjs';

export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
export const I64_MIN = -(1n << 63n);
export const I64_MAX = (1n << 63n) - 1n;

export function integer(value, minimum, maximum, label = 'integer') {
  invariant(typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value)),
    E.INTEGER_RANGE, `${label} must be BigInt or a safe integer`);
  const result = BigInt(value);
  invariant(result >= minimum && result <= maximum, E.INTEGER_RANGE, `${label} out of range`);
  return result;
}

export function asBytes(value, length, label = 'bytes') {
  invariant(Buffer.isBuffer(value) || value instanceof Uint8Array, E.BAD_FRAME, `${label} must be bytes`);
  const result = Buffer.from(value);
  invariant(length === undefined || result.length === length, E.BAD_FRAME, `${label} length mismatch`);
  return result;
}

export function fromHex(value, length) {
  invariant(typeof value === 'string' && value.length % 2 === 0 && /^[0-9a-f]*$/i.test(value),
    E.BAD_FRAME, 'invalid hex');
  return asBytes(Buffer.from(value, 'hex'), length);
}

export function equalBytes(left, right) { return asBytes(left).equals(asBytes(right)); }
export function compareBytes(left, right) { return Buffer.compare(asBytes(left), asBytes(right)); }

export class ByteWriter {
  constructor(maxLength = 16 * 1024 * 1024) {
    invariant(Number.isSafeInteger(maxLength) && maxLength >= 0, E.INTEGER_RANGE, 'invalid writer bound');
    this.maxLength = maxLength;
    this.parts = [];
    this.length = 0;
  }
  raw(value, length) {
    const bytes = asBytes(value, length);
    invariant(bytes.length <= this.maxLength - this.length, E.BAD_FRAME, 'encoded length exceeds bound');
    this.parts.push(bytes); this.length += bytes.length; return this;
  }
  uint(value, width) {
    invariant([1, 2, 4, 8, 16].includes(width), E.BAD_FRAME, 'unapproved integer width');
    const n = integer(value, 0n, (1n << BigInt(width * 8)) - 1n);
    const out = Buffer.alloc(width);
    let remaining = n;
    for (let i = 0; i < width; i += 1) { out[i] = Number(remaining & 255n); remaining >>= 8n; }
    return this.raw(out);
  }
  u8(v) { return this.uint(v, 1); }
  u16(v) { return this.uint(v, 2); }
  u32(v) { return this.uint(v, 4); }
  u64(v) { return this.uint(v, 8); }
  u128(v) { return this.uint(v, 16); }
  i64(v) {
    const n = integer(v, I64_MIN, I64_MAX);
    return this.u64(n < 0n ? n + (1n << 64n) : n);
  }
  bool(value) {
    invariant(typeof value === 'boolean', E.BAD_FRAME, 'bool must be boolean');
    return this.u8(value ? 1 : 0);
  }
  option(value, encode) {
    if (value === null) return this.u8(0);
    invariant(value !== undefined, E.BAD_FRAME, 'Option must be null or an explicit value');
    this.u8(1); encode(this, value); return this;
  }
  vector(values, maxCount, encode) {
    invariant(Array.isArray(values) && values.length <= maxCount, E.BAD_FRAME, 'Vec exceeds bound');
    this.u32(values.length); values.forEach((value, i) => encode(this, value, i)); return this;
  }
  bytes(value, maxLength) {
    const b = asBytes(value);
    invariant(b.length <= maxLength, E.BAD_FRAME, 'byte Vec exceeds bound');
    return this.u32(b.length).raw(b);
  }
  text(value, maxLength) {
    invariant(typeof value === 'string', E.BAD_FRAME, 'text must be string');
    const b = Buffer.from(value, 'utf8');
    invariant(b.toString('utf8') === value, E.BAD_FRAME, 'text contains invalid Unicode');
    return this.bytes(b, maxLength);
  }
  finish() { return Buffer.concat(this.parts, this.length); }
}

export class ByteReader {
  constructor(bytes, maxLength = 16 * 1024 * 1024) {
    this.bytes = asBytes(bytes);
    invariant(this.bytes.length <= maxLength, E.BAD_FRAME, 'input exceeds bound');
    this.offset = 0;
  }
  get remaining() { return this.bytes.length - this.offset; }
  raw(length) {
    invariant(Number.isSafeInteger(length) && length >= 0 && length <= this.remaining,
      E.BAD_FRAME, 'truncated or invalid field length');
    const result = Buffer.from(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length; return result;
  }
  uint(width) {
    invariant([1, 2, 4, 8, 16].includes(width), E.BAD_FRAME, 'unapproved integer width');
    const bytes = this.raw(width);
    let value = 0n;
    for (let i = width - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]);
    return value;
  }
  u8() { return Number(this.uint(1)); }
  u16() { return Number(this.uint(2)); }
  u32() { return Number(this.uint(4)); }
  u64() { return this.uint(8); }
  u128() { return this.uint(16); }
  i64() { const n = this.u64(); return n >= (1n << 63n) ? n - (1n << 64n) : n; }
  bool() { const n = this.u8(); invariant(n <= 1, E.BAD_FRAME, 'noncanonical bool'); return n === 1; }
  option(decode) {
    const n = this.u8(); invariant(n <= 1, E.BAD_FRAME, 'noncanonical Option');
    return n === 0 ? null : decode(this);
  }
  vector(maxCount, minimumElementLength, decode) {
    const count = this.u32();
    invariant(Number.isSafeInteger(maxCount) && maxCount >= 0 && count <= maxCount,
      E.BAD_FRAME, 'Vec count exceeds schema bound');
    invariant(Number.isSafeInteger(minimumElementLength) && minimumElementLength >= 0,
      E.BAD_FRAME, 'invalid Vec minimum size');
    invariant(minimumElementLength === 0 || count <= Math.floor(this.remaining / minimumElementLength),
      E.BAD_FRAME, 'Vec cannot fit remaining bytes');
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(decode(this, i));
    return out;
  }
  byteVector(maxLength) {
    const length = this.u32();
    invariant(length <= maxLength, E.BAD_FRAME, 'byte Vec exceeds schema bound');
    return this.raw(length);
  }
  text(maxLength) {
    const bytes = this.byteVector(maxLength);
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new ProtocolError(E.BAD_FRAME, 'invalid UTF-8'); }
  }
  zero(length) { invariant(this.raw(length).every((n) => n === 0), E.BAD_FRAME, 'nonzero reserved bytes'); }
  finish() { invariant(this.remaining === 0, E.BAD_FRAME, 'trailing bytes'); }
}

export function checkedAdd(a, b, max = U64_MAX) {
  return integer(integer(a, 0n, max) + integer(b, 0n, max), 0n, max);
}
export function checkedMultiply(a, b, max = U64_MAX) {
  return integer(integer(a, 0n, max) * integer(b, 0n, max), 0n, max);
}
