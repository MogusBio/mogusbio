import { ByteReader, ByteWriter, asBytes, equalBytes, integer, U64_MAX } from '../../protocol-core/src/codec.mjs';
import { typedHash, sha256 } from '../../protocol-core/src/p0.mjs';
import { decodeGraph, encodeGraph, members } from '../../biology/src/graph.mjs';
import { descriptorBytes, decodeDescriptor } from '../../composition/src/payload.mjs';

export const TASK_FAMILY = sha256(Buffer.from('BIO-DESIGN-01', 'ascii'));
export const TASK_VERSION = 1;
export const ROUND_SECONDS = 259_200n;
export const WINDOW_SECONDS = 86_400n;

export class OriginalityError extends Error {
  constructor(code, message = code) { super(message); this.name = 'OriginalityError'; this.code = code; }
}
export function requireOriginality(condition, code, message) {
  if (!condition) throw new OriginalityError(code, message);
}
export const key32 = value => asBytes(value, 32).toString('hex');

export function commitmentHash({ domain, round, author, design, manufactureOpId, salt }) {
  integer(round, 0n, U64_MAX);
  return typedHash(22, new ByteWriter(204).raw(domain, 32).raw(TASK_FAMILY).u32(TASK_VERSION).u64(round)
    .raw(author, 32).raw(design, 32).raw(manufactureOpId, 32).raw(salt, 32).finish());
}

/** Pure encoding does not certify any claim. The caller must first replay it. */
export function encodeAdmission321(a) {
  requireOriginality(a.evidenceKind === 0 || a.evidenceKind === 1, 'ADMISSION_EVIDENCE_KIND');
  requireOriginality(Number.isInteger(a.target) && a.target >= 1 && a.target <= 22, 'ADMISSION_TARGET');
  requireOriginality(a.suite === 2 && a.fixture === 1 && a.load === 1, 'ADMISSION_VERSION');
  requireOriginality(typeof a.taskApplicable === 'boolean', 'ADMISSION_BOOLEAN');
  const q = integer(a.q_ppm, 500_000n, 2_000_000n), c = integer(a.c_ppm, 500_000n, 2_000_000n);
  requireOriginality(q % 1_000n === 0n && c % 1_000n === 0n, 'ADMISSION_QUALITY');
  return new ByteWriter(321).raw(a.domain, 32).raw(a.config, 32).raw(a.rule, 32).raw(a.graphSHA, 32)
    .raw(a.leafMapSHA, 32).raw(a.evidenceRef, 32).u8(a.target).u8(a.evidenceKind)
    .u32(c).u32(q).u8(a.taskApplicable ? 1 : 0).u64(a.C).u32(a.suite).u32(a.fixture).u32(a.load)
    .u16(a.dutMask).raw(a.transcriptSHA, 32).raw(a.positiveBitmap, 64).finish();
}
export const computeAdmissionH16 = admission => typedHash(16, encodeAdmission321(admission));

export function initialSeedSetId(domain, rows) {
  requireOriginality(Array.isArray(rows) && rows.length === 16, 'INITIAL_SEED_COUNT');
  const w = new ByteWriter(709).u8(3).raw(domain, 32).raw(TASK_FAMILY).u32(rows.length);
  let previous = null;
  for (const row of rows) {
    const design = asBytes(row.design, 32);
    requireOriginality(previous === null || Buffer.compare(previous, design) < 0, 'INITIAL_SEED_ORDER');
    w.raw(design).u64(row.C); previous = design;
  }
  return typedHash(15, w.finish());
}

export function encodeOpeningSnapshot176(snapshot) {
  requireOriginality(snapshot.best !== null, 'OPENING_NO_BEST');
  return new ByteWriter(176).raw(TASK_FAMILY).raw(snapshot.initialSetId, 32).i64(snapshot.cutoff)
    .u64(snapshot.seedCount).raw(snapshot.digest, 32).u64(snapshot.best.C).raw(snapshot.best.design, 32)
    .u64(snapshot.event).u64(snapshot.slot).i64(snapshot.now).finish();
}
export function openingSnapshotId(domain, snapshot) {
  return typedHash(15, new ByteWriter(209).u8(3).raw(domain, 32).raw(encodeOpeningSnapshot176(snapshot)).finish());
}

export function encodeDescriptorMap(graph) {
  const roles = members(graph.target), w = new ByteWriter(361).u8(roles.length * 4);
  for (const role of roles) for (let primitive = 1; primitive <= 4; primitive += 1)
    w.u8(role).u8(primitive).raw(descriptorBytes({ primitive, profile: primitive === 4 ? role : 0 }));
  return w.finish();
}

export function encodeBlueprint({ graph, challenge = 2_000_000 }) {
  requireOriginality(Number.isInteger(challenge) && challenge >= 500_000 && challenge <= 2_000_000
    && challenge % 1_000 === 0, 'BLUEPRINT_CHALLENGE');
  const graphBytes = encodeGraph(graph);
  const body = new ByteWriter(8082).u32(challenge).bytes(graphBytes, 7713).raw(encodeDescriptorMap(graph)).finish();
  return new ByteWriter(8098).raw(Buffer.from('BIOP7K01')).u16(1).u8(graph.target).u8(0).u32(body.length).raw(body).finish();
}

export function decodeBlueprint(bytes) {
  const r = new ByteReader(bytes, 8098);
  requireOriginality(equalBytes(r.raw(8), Buffer.from('BIOP7K01')) && r.u16() === 1, 'BLUEPRINT_SCHEMA');
  const target = r.u8(); r.zero(1); requireOriginality(r.u32() === r.remaining, 'BLUEPRINT_LENGTH');
  const challenge = r.u32(), graph = decodeGraph(r.byteVector(7713));
  requireOriginality(target === graph.target && challenge >= 500_000 && challenge <= 2_000_000
    && challenge % 1_000 === 0, 'BLUEPRINT_TARGET');
  const count = r.u8(); requireOriginality(count <= 60 && count === members(target).length * 4, 'BLUEPRINT_DESCRIPTORS');
  const descriptors = Array.from({ length: count }, () => ({ role: r.u8(), primitive: r.u8(), descriptor: r.raw(4) }));
  r.finish();
  descriptors.forEach(d => decodeDescriptor(d.descriptor));
  const out = { graph, challenge };
  requireOriginality(equalBytes(encodeBlueprint(out), bytes), 'BLUEPRINT_NONCANONICAL');
  return { ...out, descriptorMapSHA: sha256(encodeDescriptorMap(graph)) };
}
