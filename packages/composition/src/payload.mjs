import { ByteReader, ByteWriter, asBytes, compareBytes, equalBytes } from '../../protocol-core/src/codec.mjs';
import { sha256 } from '../../protocol-core/src/p0.mjs';
import { decodeGraph, encodeGraph, members } from '../../biology/src/graph.mjs';
import { requireComposition, ARTIFACT_MAX_BYTES, hex32 } from './artifact.mjs';

export function descriptorBytes({ primitive, profile }) {
  requireComposition(Number.isInteger(primitive) && primitive >= 1 && primitive <= 4
    && Number.isInteger(profile) && (primitive === 4 ? profile >= 1 && profile <= 15 : profile === 0), 'COMPONENT_DESCRIPTOR');
  return new ByteWriter(4).u16(1).u8(primitive).u8(profile).finish();
}
export function decodeDescriptor(bytes) {
  const r = new ByteReader(bytes, 4);
  requireComposition(r.u16() === 1, 'COMPONENT_DESCRIPTOR');
  const value = { primitive: r.u8(), profile: r.u8() }; r.finish(); descriptorBytes(value); return value;
}

export function encodeLeafMap(leaves) {
  requireComposition(Array.isArray(leaves) && leaves.length <= 60, 'LEAF_COUNT');
  const w = new ByteWriter(4201).u8(leaves.length);
  let previous = 0;
  const ids = new Set();
  for (const leaf of leaves) {
    const key = leaf.role * 4 + leaf.primitive;
    requireComposition(Number.isInteger(leaf.role) && leaf.role >= 1 && leaf.role <= 15
      && key > previous && leaf.primitive >= 1 && leaf.primitive <= 4, 'LEAF_ORDER');
    const d = decodeDescriptor(leaf.descriptor);
    requireComposition(d.primitive === leaf.primitive && (d.primitive !== 4 || d.profile === leaf.role), 'LEAF_DESCRIPTOR');
    requireComposition(!ids.has(hex32(leaf.instance)), 'DUPLICATE_LEAF'); ids.add(hex32(leaf.instance));
    previous = key;
    w.u8(leaf.role).u8(leaf.primitive).raw(leaf.descriptor, 4).raw(leaf.instance, 32).raw(leaf.fingerprint, 32);
  }
  return w.finish();
}

export function encodeSynthesisPayload(payload) {
  const { graph, direct, leaves, capsules } = payload;
  const graphBytes = encodeGraph(graph);
  requireComposition(Array.isArray(direct) && direct.length >= 2 && direct.length <= 6, 'DIRECT_COUNT');
  requireComposition(leaves.length === members(graph.target).length * 4 && capsules.length === leaves.length, 'LEAF_COUNT');
  const expectedPositions = members(graph.target).flatMap(role => [1, 2, 3, 4].map(primitive => ({ role, primitive })));
  requireComposition(leaves.every((leaf, n) => leaf.role === expectedPositions[n].role
    && leaf.primitive === expectedPositions[n].primitive), 'LEAF_POSITION_SET');
  const leafBytes = encodeLeafMap(leaves);
  const body = new ByteWriter(ARTIFACT_MAX_BYTES).bytes(graphBytes, 7713).u8(direct.length);
  let previous = -1;
  const ids = new Set();
  for (const d of direct) {
    const key = d.scope * 5 + d.primitive;
    requireComposition(Number.isInteger(d.scope) && d.scope >= 1 && d.scope <= 21
      && Number.isInteger(d.primitive) && d.primitive >= 0 && d.primitive <= 4 && key > previous, 'DIRECT_ORDER');
    requireComposition(!ids.has(hex32(d.instance)), 'DUPLICATE_DIRECT_INPUT'); ids.add(hex32(d.instance));
    previous = key;
    body.u8(d.scope).u8(d.primitive).raw(d.instance, 32).u64(d.expectedRevision).raw(d.fingerprint, 32);
  }
  body.raw(leafBytes).u8(capsules.length);
  for (let n = 0; n < capsules.length; n += 1) {
    const capsule = asBytes(capsules[n]);
    requireComposition(capsule.length >= 326 && capsule.length <= 3358
      && equalBytes(sha256(capsule), leaves[n].fingerprint), 'CAPSULE_FINGERPRINT');
    body.bytes(capsule, 3358);
  }
  const bytes = body.finish();
  requireComposition(bytes.length + 16 <= ARTIFACT_MAX_BYTES, 'PAYLOAD_LENGTH');
  return new ByteWriter(ARTIFACT_MAX_BYTES).raw(Buffer.from('BIOP7D01')).u16(1)
    .u8(graph.target).u8(0).u32(bytes.length).raw(bytes).finish();
}

export function decodeSynthesisPayload(bytes) {
  const r = new ByteReader(bytes, ARTIFACT_MAX_BYTES);
  requireComposition(equalBytes(r.raw(8), Buffer.from('BIOP7D01')) && r.u16() === 1, 'PAYLOAD_SCHEMA');
  const target = r.u8(); r.zero(1); requireComposition(r.u32() === r.remaining, 'PAYLOAD_LENGTH');
  const graph = decodeGraph(r.byteVector(7713));
  requireComposition(graph.target === target, 'PAYLOAD_TARGET');
  const directCount = r.u8(); requireComposition(directCount >= 2 && directCount <= 6, 'DIRECT_COUNT');
  const direct = Array.from({ length: directCount }, () => ({ scope: r.u8(), primitive: r.u8(),
    instance: r.raw(32), expectedRevision: r.u64(), fingerprint: r.raw(32) }));
  const leafCount = r.u8(); requireComposition(leafCount <= 60, 'LEAF_COUNT');
  const leaves = Array.from({ length: leafCount }, () => ({ role: r.u8(), primitive: r.u8(),
    descriptor: r.raw(4), instance: r.raw(32), fingerprint: r.raw(32) }));
  const capsuleCount = r.u8(); requireComposition(capsuleCount === leafCount, 'LEAF_COUNT');
  const capsules = Array.from({ length: capsuleCount }, () => r.byteVector(3358)); r.finish();
  const payload = { graph, direct, leaves, capsules };
  requireComposition(equalBytes(encodeSynthesisPayload(payload), bytes), 'PAYLOAD_NONCANONICAL');
  return payload;
}

/** Check all original historical effective AND retired slices before merging. */
export function validateSourceUnion(leaves) {
  requireComposition(Array.isArray(leaves) && leaves.length <= 60, 'LEAF_COUNT');
  const rows = [];
  for (const leaf of leaves) {
    requireComposition(Array.isArray(leaf.effective) && Array.isArray(leaf.retired)
      && leaf.effective.length + leaf.retired.length <= 128, 'SOURCE_SLICE_COUNT');
    for (const row of [...leaf.effective, ...leaf.retired]) {
      asBytes(row.sourceId, 32);
      requireComposition(Number.isInteger(row.species) && row.species >= 1 && row.species <= 32
        && typeof row.lo === 'bigint' && typeof row.hi === 'bigint'
        && row.lo >= 0n && row.hi > row.lo && row.hi <= (1n << 64n) - 1n, 'SOURCE_SLICE');
      rows.push({ ...row });
    }
  }
  rows.sort((a, b) => compareBytes(a.sourceId, b.sourceId) || a.species - b.species
    || (a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : 0));
  let previous = null;
  for (const row of rows) {
    if (previous && equalBytes(row.sourceId, previous.sourceId) && row.species === previous.species)
      requireComposition(row.lo >= previous.hi, 'SOURCE_OVERLAP');
    previous = row;
  }
  const effective = leaves.flatMap((leaf) => leaf.effective.map((row) => ({ ...row })))
    .sort((a, b) => compareBytes(a.sourceId, b.sourceId) || a.species - b.species || (a.lo < b.lo ? -1 : 1));
  const merged = [];
  for (const row of effective) {
    const last = merged.at(-1);
    if (last && equalBytes(row.sourceId, last.sourceId) && row.species === last.species && row.lo === last.hi) last.hi = row.hi;
    else merged.push(row);
  }
  const encoded = new ByteWriter(4 + merged.length * 50).u32(merged.length);
  for (const row of merged) encoded.raw(row.sourceId, 32).u16(row.species).u64(row.lo).u64(row.hi);
  return { effective: merged, effectiveUnionSHA: sha256(encoded.finish()) };
}
