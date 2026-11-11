import test from 'node:test';
import assert from 'node:assert/strict';
import { ByteWriter, ByteReader, fromHex, U64_MAX, U128_MAX, I64_MIN, I64_MAX, checkedAdd, checkedMultiply,
  ProtocolError, ERRORS as E } from '../src/index.mjs';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof ProtocolError && e.code === code);

test('fixed-width integers round trip exactly at boundaries', () => {
  const out = new ByteWriter().u8(255).u16(65535).u32(4294967295).u64(U64_MAX).u128(U128_MAX).i64(I64_MIN).i64(I64_MAX).finish();
  const r = new ByteReader(out);
  assert.equal(r.u8(), 255); assert.equal(r.u16(), 65535); assert.equal(r.u32(), 4294967295);
  assert.equal(r.u64(), U64_MAX); assert.equal(r.u128(), U128_MAX); assert.equal(r.i64(), I64_MIN); assert.equal(r.i64(), I64_MAX); r.finish();
  assert.equal(new ByteWriter().u32(0x12345678).finish().toString('hex'), '78563412');
});
test('integers reject floats, unsafe numbers, strings, overflow and negative unsigned values', () => {
  for (const bad of [1.2, Number.MAX_SAFE_INTEGER + 1, '12', NaN, Infinity, -1, U64_MAX + 1n])
    throwsCode(() => new ByteWriter().u64(bad), E.INTEGER_RANGE);
  throwsCode(() => new ByteWriter().i64(I64_MIN - 1n), E.INTEGER_RANGE);
  throwsCode(() => checkedAdd(U64_MAX, 1n), E.INTEGER_RANGE);
  throwsCode(() => checkedMultiply(U64_MAX, 2n), E.INTEGER_RANGE);
});
test('strict bool, Option and exact exhaustion cannot hide additional bytes', () => {
  const b = new ByteWriter().bool(true).option(null, () => {}).option(12, (w, v) => w.u16(v)).finish();
  assert.equal(b.toString('hex'), '0100010c00');
  const r = new ByteReader(b); assert.equal(r.bool(), true); assert.equal(r.option((s) => s.u16()), null);
  assert.equal(r.option((s) => s.u16()), 12); r.finish();
  throwsCode(() => new ByteReader(Buffer.from([2])).bool(), E.BAD_FRAME);
  throwsCode(() => new ByteReader(Buffer.from([2])).option(() => 1), E.BAD_FRAME);
  throwsCode(() => { const reader = new ByteReader(Buffer.from([0, 5])); reader.option((s) => s.u8()); reader.finish(); }, E.BAD_FRAME);
  throwsCode(() => new ByteWriter().bool(1), E.BAD_FRAME);
  throwsCode(() => new ByteWriter().option(undefined, () => {}), E.BAD_FRAME);
});
test('Vec checks the count and remaining length before iterating or allocating', () => {
  let callbacks = 0;
  throwsCode(() => new ByteReader(Buffer.from('ffffffff', 'hex')).vector(32, 1, () => { callbacks += 1; }), E.BAD_FRAME);
  throwsCode(() => new ByteReader(Buffer.from('0300000001', 'hex')).vector(32, 2, () => { callbacks += 1; }), E.BAD_FRAME);
  assert.equal(callbacks, 0);
  throwsCode(() => new ByteReader(Buffer.from('01000000', 'hex')).byteVector(1), E.BAD_FRAME);
  throwsCode(() => new ByteWriter(2).u32(0), E.BAD_FRAME);
  throwsCode(() => new ByteWriter().uint(0, 3), E.BAD_FRAME);
  throwsCode(() => new ByteReader(Buffer.alloc(3)).uint(3), E.BAD_FRAME);
});
test('UTF-8 is fatal, measured in bytes and preserves actual content including BOM', () => {
  const data = new ByteWriter().text('生物\ufeff', 9).finish();
  assert.equal(new ByteReader(data).text(9), '生物\ufeff');
  assert.equal(new ByteReader(new ByteWriter().text('\ufeffabc', 6).finish()).text(6), '\ufeffabc');
  throwsCode(() => new ByteReader(Buffer.from('02000000c080', 'hex')).text(2), E.BAD_FRAME);
  throwsCode(() => new ByteWriter().text('\ud800', 10), E.BAD_FRAME);
  throwsCode(() => new ByteWriter().text('生物', 5), E.BAD_FRAME);
});
test('strict hex and byte copies avoid permissive decoding and caller aliases', () => {
  throwsCode(() => fromHex('0'), E.BAD_FRAME); throwsCode(() => fromHex('zz'), E.BAD_FRAME);
  throwsCode(() => fromHex('ff', 32), E.BAD_FRAME);
  const input = Buffer.from([1]), reader = new ByteReader(input); input[0] = 2; assert.equal(reader.u8(), 1);
  const writer = new ByteWriter(), byte = Buffer.from([3]); writer.raw(byte); byte[0] = 4; assert.equal(writer.finish()[0], 3);
});
