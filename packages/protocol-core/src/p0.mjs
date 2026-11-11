import { createHash } from 'node:crypto';
import { ByteReader, ByteWriter, asBytes, equalBytes, integer, I64_MAX } from './codec.mjs';
import { ERRORS as E, ProtocolError, invariant } from './errors.mjs';

const HASH_MAGIC = Buffer.from('42494f4841534800', 'hex');
const FRAME_MAGIC = Buffer.from('42494f4958000000', 'hex');
const RECORD_MAGIC = Buffer.from('42494f4c41420000', 'hex');
export const EXACT_FRAME_HEADER_SIZE = 152;
export const RECORD_HEADER_SIZE = 120;
export const MAX_FRAME_SIZE = 4096;

const operationRows = [
  [1, 1, 33], [1, 2, 40], [1, 3, 128], [201, 1, 208], [202, 1, 58],
  [301, 1, 56], [301, 2, 64], [501, 1, 108],
  [701, 1, 53], [701, 2, 84], [702, 1, 176],
  [1001, 1, 72], [1001, 2, 48], [1002, 1, 40], [1002, 2, 41],
  [1002, 3, 72], [1002, 4, 49], [1002, 5, 124],
  [1002, 10, 58], [1002, 11, 66], [1002, 12, 64],
  [1101, 1, 40], [1102, 1, 57], [1102, 2, 65],
  [1201, 1, 65], [1201, 2, 113], [1202, 1, 72], [1202, 2, 104],
  [1203, 1, 88],
];
const registeredOperations = [...operationRows.map(([module, opcode, resultLength]) =>
  Object.freeze({ module, opcode, schema: 1, resultLength })), Object.freeze({ module: 1201, opcode: 1, schema: 2, resultLength: 65 })];
const operations = new Map(registeredOperations.map((row) => [`${row.module}/${row.opcode}/${row.schema}`, row]));
export const OPEN_OPERATIONS = Object.freeze(registeredOperations);
export const EXECUTION_V2_WIRE = Object.freeze({
  productionEnabled: false,
  records: Object.freeze([
    Object.freeze({ kind: 27, schema: 2, bodyLength: 255, totalLength: 375, name: 'POSITION' }),
    Object.freeze({ kind: 18, schema: 2, bodyLength: 297, totalLength: 417, name: 'HOUR' }),
    Object.freeze({ kind: 35, schema: 1, bodyLength: 298, totalLength: 418, name: 'ACTOR_NONCE' }),
  ]),
  operations: Object.freeze([
    Object.freeze({ module: 1201, opcode: 1, schema: 2, payloadLength: 57, resultLength: 65, profile: 19217 }),
    Object.freeze({ module: 1203, opcode: 1, schema: 1, payloadLength: 120, resultLength: 88, profile: 19249 }),
  ]),
});

function operation(module, opcode, schema) {
  invariant(registeredOperations.some((row) => row.module === module && row.opcode === opcode),
    E.OPCODE_NOT_OPEN, 'module/opcode is not open');
  const entry = operations.get(`${module}/${opcode}/${schema}`);
  invariant(entry, E.UNSUPPORTED_VERSION_OR_SCHEMA, 'unknown payload schema');
  return entry;
}

export function sha256(payload) { return createHash('sha256').update(asBytes(payload)).digest(); }
export function typedHashInput(typeTag, payload) {
  invariant(Number.isInteger(typeTag) && typeTag >= 1 && typeTag <= 22,
    E.UNSUPPORTED_VERSION_OR_SCHEMA, 'unregistered typed-hash tag');
  const bytes = asBytes(payload);
  return new ByteWriter(bytes.length + 16).raw(HASH_MAGIC).u16(1).u16(typeTag).u32(bytes.length).raw(bytes).finish();
}
export function typedHash(typeTag, payload) { return sha256(typedHashInput(typeTag, payload)); }
const tuple32 = (...values) => Buffer.concat(values.map((v) => asBytes(v, 32)));
export const deploymentDomain = (genesis, program, nonce) => typedHash(1, tuple32(genesis, program, nonce));
export const businessKey = (domain, actor, opId) => typedHash(3, tuple32(domain, actor, opId));
export const requestHash = (frameBytes) => { decodeExactFrame(frameBytes); return typedHash(4, frameBytes); };
export const sourceId = (domain, manufactureBusiness, ordinal) => {
  integer(ordinal, 0n, 31n, 'intake ordinal');
  return typedHash(5, new ByteWriter(66).raw(tuple32(domain, manufactureBusiness)).u16(ordinal).finish());
};
export const instanceId = (domain, manufactureBusiness, ordinal = 0) =>
  typedHash(6, new ByteWriter(66).raw(tuple32(domain, manufactureBusiness)).u16(ordinal).finish());
export const projectId = (domain, creationBusiness) => typedHash(17, tuple32(domain, creationBusiness));
export const receiptKey = (domain, instance, hour) =>
  typedHash(12, new ByteWriter(72).raw(tuple32(domain, instance)).u64(hour).finish());

export function encodeExactFrame(frame) {
  const schema = frame.payloadSchema ?? 1;
  operation(frame.module, frame.opcode, schema);
  const payload = asBytes(frame.payload);
  invariant(payload.length <= MAX_FRAME_SIZE - EXACT_FRAME_HEADER_SIZE, E.BAD_FRAME, 'payload too long');
  return new ByteWriter(MAX_FRAME_SIZE).raw(FRAME_MAGIC).u16(1).u16(frame.module).u16(frame.opcode).u16(schema)
    .raw(frame.domain, 32).raw(frame.configId, 32).raw(frame.actor, 32).raw(frame.opId, 32)
    .u32(payload.length).u32(0).raw(payload).finish();
}

export function decodeExactFrame(bytes) {
  const reader = new ByteReader(bytes, MAX_FRAME_SIZE);
  invariant(equalBytes(reader.raw(8), FRAME_MAGIC), E.BAD_FRAME, 'bad ExactFrame magic');
  invariant(reader.u16() === 1, E.UNSUPPORTED_VERSION_OR_SCHEMA, 'unknown ExactFrame codec');
  const frame = { module: reader.u16(), opcode: reader.u16(), payloadSchema: reader.u16(),
    domain: reader.raw(32), configId: reader.raw(32), actor: reader.raw(32), opId: reader.raw(32) };
  const length = reader.u32(); reader.zero(4);
  invariant(length === reader.remaining, E.BAD_FRAME, 'ExactFrame length mismatch');
  operation(frame.module, frame.opcode, frame.payloadSchema);
  frame.payload = reader.raw(length); reader.finish(); return frame;
}

function approvedRecordSchema(kind, schema) {
  invariant(Number.isInteger(kind) && kind >= 1 && kind <= 35 && ![10, 13, 29].includes(kind),
    E.UNSUPPORTED_VERSION_OR_SCHEMA, 'unopened record kind');
  invariant(kind === 12 ? schema >= 1 && schema <= 4 : [18, 27].includes(kind) ? [1, 2].includes(schema) : schema === 1,
    E.UNSUPPORTED_VERSION_OR_SCHEMA, 'unknown record schema');
}

/** Header codec only: the caller must validate its exact kind-specific body and real PDA/owner. */
export function encodeRecord(record) {
  approvedRecordSchema(record.kind, record.schema);
  const body = asBytes(record.body);
  return new ByteWriter(body.length + RECORD_HEADER_SIZE).raw(RECORD_MAGIC).u16(1).u16(record.kind)
    .u16(record.schema).u16(0).raw(record.domain, 32).raw(record.configId, 32).u32(body.length)
    .u8(record.bump).u8(0).u16(0).raw(record.recordKey, 32).raw(body).finish();
}

export function decodeRecord(bytes, maxBodyLength = 16 * 1024 * 1024) {
  const reader = new ByteReader(bytes, maxBodyLength + RECORD_HEADER_SIZE);
  invariant(equalBytes(reader.raw(8), RECORD_MAGIC), E.BAD_PDA_OR_HEADER, 'bad record magic');
  invariant(reader.u16() === 1, E.UNSUPPORTED_VERSION_OR_SCHEMA, 'unknown record codec');
  const kind = reader.u16(), schema = reader.u16(); approvedRecordSchema(kind, schema); reader.zero(2);
  const domain = reader.raw(32), configId = reader.raw(32), bodyLength = reader.u32(), bump = reader.u8();
  reader.zero(1); reader.zero(2);
  const recordKey = reader.raw(32);
  invariant(bodyLength === reader.remaining && bodyLength <= maxBodyLength, E.BAD_PDA_OR_HEADER, 'record length mismatch');
  const body = reader.raw(bodyLength); reader.finish();
  return { kind, schema, domain, configId, bump, recordKey, body };
}

export function encodeSourceSlice(slice) {
  integer(slice.species, 1n, 32n, 'species');
  const lo = integer(slice.lo, 0n, (1n << 64n) - 1n), hi = integer(slice.hi, 0n, (1n << 64n) - 1n);
  invariant(lo < hi, E.BAD_MATERIAL_PLAN, 'empty or inverted source slice');
  return new ByteWriter(50).raw(slice.sourceId, 32).u16(slice.species).u64(lo).u64(hi).finish();
}
export function decodeSourceSlice(bytes) {
  const reader = new ByteReader(bytes, 50);
  const result = { sourceId: reader.raw(32), species: reader.u16(), lo: reader.u64(), hi: reader.u64() };
  reader.finish(); encodeSourceSlice(result); return result;
}

export function encodeBusinessRecord({ requestBytes, resultBytes, committedAt, committedSlot, bump }) {
  const frame = decodeExactFrame(requestBytes);
  const result = asBytes(resultBytes);
  invariant(result.length === operation(frame.module, frame.opcode, frame.payloadSchema).resultLength,
    E.BAD_BUSINESS_RECORD, 'wrong opcode result length');
  integer(committedAt, 0n, I64_MAX, 'commit time');
  const body = new ByteWriter(4476).raw(frame.actor).raw(frame.opId).raw(requestHash(requestBytes))
    .u16(frame.module).u16(frame.opcode).i64(committedAt).u64(committedSlot)
    .bytes(requestBytes, MAX_FRAME_SIZE).bytes(result, 256).finish();
  return encodeRecord({ kind: 8, schema: 1, domain: frame.domain, configId: frame.configId,
    bump, recordKey: businessKey(frame.domain, frame.actor, frame.opId), body });
}

export function decodeBusinessRecord(bytes) {
  try {
    const header = decodeRecord(bytes, 4476);
    invariant(header.kind === 8 && header.schema === 1, E.BAD_BUSINESS_RECORD, 'not a Business record');
    const r = new ByteReader(header.body, 4476);
    const body = { actor: r.raw(32), opId: r.raw(32), requestHash: r.raw(32), module: r.u16(), opcode: r.u16(),
      committedAt: r.i64(), committedSlot: r.u64(), requestBytes: r.byteVector(MAX_FRAME_SIZE), resultBytes: r.byteVector(256) };
    r.finish(); integer(body.committedAt, 0n, I64_MAX);
    const frame = decodeExactFrame(body.requestBytes);
    const checks = [[body.actor, frame.actor], [body.opId, frame.opId], [body.requestHash, requestHash(body.requestBytes)],
      [header.domain, frame.domain], [header.configId, frame.configId],
      [header.recordKey, businessKey(frame.domain, frame.actor, frame.opId)]];
    invariant(checks.every(([a, b]) => equalBytes(a, b)) && body.module === frame.module && body.opcode === frame.opcode,
      E.BAD_BUSINESS_RECORD, 'Business repeated identity mismatch');
    invariant(body.resultBytes.length === operation(frame.module, frame.opcode, frame.payloadSchema).resultLength,
      E.BAD_BUSINESS_RECORD, 'Business result length mismatch');
    return { ...header, ...body, frame };
  } catch (error) {
    if (error instanceof ProtocolError) throw new ProtocolError(E.BAD_BUSINESS_RECORD, error.message);
    throw error;
  }
}

/** A real caller must first verify native top-level entry, actor signature, and canonical Business PDA. */
export function inspectBusinessRetry(requestBytes, existingRecordBytes, expectedDomain) {
  const frame = decodeExactFrame(requestBytes);
  invariant(equalBytes(frame.domain, expectedDomain), E.BAD_DEPLOYMENT_DOMAIN, 'wrong deployment domain');
  if (existingRecordBytes === null || existingRecordBytes === undefined) return null;
  const record = decodeBusinessRecord(existingRecordBytes);
  invariant(equalBytes(record.recordKey, businessKey(frame.domain, frame.actor, frame.opId)),
    E.BAD_BUSINESS_RECORD, 'Business key mismatch');
  invariant(equalBytes(record.requestBytes, requestBytes), E.IDEMPOTENCY_CONFLICT, 'same key with different ExactFrame');
  return Buffer.from(record.resultBytes);
}
