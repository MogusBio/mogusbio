import { ByteReader, ByteWriter, asBytes, equalBytes, integer, U64_MAX, I64_MAX } from '../../protocol-core/src/codec.mjs';
import { cloneProtocolState } from '../../protocol-core/src/atomic.mjs';
import { sha256, typedHash } from '../../protocol-core/src/p0.mjs';

export const ARTIFACT_MAX_BYTES = 262_144;
export const ARTIFACT_CHUNK_BYTES = 1_024;
export class CompositionError extends Error {
  constructor(code, message = code) { super(message); this.name = 'CompositionError'; this.code = code; }
}
export function requireComposition(condition, code, message) {
  if (!condition) throw new CompositionError(code, message);
}
export const hex32 = (value) => asBytes(value, 32).toString('hex');

export function artifactId({ domain, config, actor, payloadSchema, totalLength, payloadSHA }) {
  requireComposition([1, 2].includes(payloadSchema), 'ARTIFACT_SCHEMA');
  requireComposition(Number.isInteger(totalLength) && totalLength >= 1 && totalLength <= ARTIFACT_MAX_BYTES, 'ARTIFACT_LENGTH');
  return typedHash(19, new ByteWriter(134).raw(domain, 32).raw(config, 32).raw(actor, 32)
    .u16(payloadSchema).u32(totalLength).raw(payloadSHA, 32).finish());
}

/** Pure draft transition; authorized actor is supplied by the outer signed core. */
export function putArtifact(state, context) {
  const { actor, expectedSeq, offset, chunk, ...metadata } = context;
  const id = artifactId({ ...metadata, actor });
  const bytes = asBytes(chunk);
  integer(expectedSeq, 0n, U64_MAX);
  requireComposition(Number.isInteger(offset) && offset >= 0 && offset < metadata.totalLength
    && offset % ARTIFACT_CHUNK_BYTES === 0, 'ARTIFACT_OFFSET');
  requireComposition(bytes.length === Math.min(ARTIFACT_CHUNK_BYTES, metadata.totalLength - offset), 'ARTIFACT_CHUNK');
  const draft = cloneProtocolState(state);
  draft.compositionArtifacts ??= new Map();
  requireComposition(draft.compositionArtifacts instanceof Map, 'ARTIFACT_STATE');
  let artifact = draft.compositionArtifacts.get(hex32(id));
  if (!artifact) {
    requireComposition(offset === 0 && expectedSeq === 0n, 'ARTIFACT_INITIAL_SEQUENCE');
    artifact = { id, actor: asBytes(actor, 32), domain: asBytes(metadata.domain, 32), config: asBytes(metadata.config, 32),
      payloadSchema: metadata.payloadSchema, totalLength: metadata.totalLength, payloadSHA: asBytes(metadata.payloadSHA, 32),
      written: Buffer.alloc(0), writeSeq: 0n, status: 'WRITING', sealedAt: 0n, sealedSlot: 0n };
    draft.compositionArtifacts.set(hex32(id), artifact);
  }
  requireComposition(artifact.status === 'WRITING', 'ARTIFACT_SEALED');
  requireComposition(equalBytes(actor, artifact.actor) && artifact.writeSeq === BigInt(expectedSeq), 'ARTIFACT_SEQUENCE_OR_OWNER');
  requireComposition(offset === artifact.written.length || offset + bytes.length <= artifact.written.length, 'ARTIFACT_HOLE');
  if (offset === artifact.written.length) artifact.written = Buffer.concat([artifact.written, bytes]);
  else bytes.copy(artifact.written, offset);
  artifact.writeSeq = integer(artifact.writeSeq + 1n, 0n, U64_MAX);
  return { state: draft, result: { artifactId: Buffer.from(id), writtenLength: artifact.written.length,
    writeSeq: artifact.writeSeq, status: artifact.status } };
}

export function sealArtifact(state, { artifactId: id, actor, expectedSeq, now, slot }) {
  integer(now, 0n, I64_MAX); integer(slot, 0n, U64_MAX); integer(expectedSeq, 0n, U64_MAX);
  const draft = cloneProtocolState(state);
  const artifact = draft.compositionArtifacts?.get(hex32(id));
  requireComposition(artifact, 'UNKNOWN_ARTIFACT');
  requireComposition(artifact.status === 'WRITING', 'ARTIFACT_SEALED');
  requireComposition(equalBytes(actor, artifact.actor) && artifact.writeSeq === BigInt(expectedSeq), 'ARTIFACT_SEQUENCE_OR_OWNER');
  requireComposition(artifact.written.length === artifact.totalLength, 'ARTIFACT_INCOMPLETE');
  requireComposition(equalBytes(sha256(artifact.written), artifact.payloadSHA), 'ARTIFACT_SHA');
  artifact.status = 'SEALED'; artifact.sealedAt = BigInt(now); artifact.sealedSlot = BigInt(slot);
  return { state: draft, result: { artifactId: Buffer.from(artifact.id), payloadSHA: Buffer.from(artifact.payloadSHA),
    payloadLength: artifact.totalLength, sealedAt: artifact.sealedAt, sealedSlot: artifact.sealedSlot } };
}

export function readSealedArtifact(state, id, expectedContext = null) {
  const artifact = state.compositionArtifacts?.get(hex32(id));
  requireComposition(artifact?.status === 'SEALED' && artifact.written.length === artifact.totalLength, 'ARTIFACT_NOT_SEALED');
  requireComposition(equalBytes(artifactId(artifact), artifact.id)
    && equalBytes(sha256(artifact.written), artifact.payloadSHA), 'ARTIFACT_SHA');
  if (expectedContext) requireComposition(equalBytes(artifact.domain, expectedContext.domain)
    && equalBytes(artifact.config, expectedContext.config), 'ARTIFACT_DOMAIN');
  return cloneProtocolState(artifact);
}

export function encodeArtifactBody(artifact) {
  requireComposition(['WRITING', 'SEALED'].includes(artifact.status)
    && equalBytes(artifactId(artifact), artifact.id)
    && artifact.written.length > 0 && artifact.written.length <= artifact.totalLength
    && (artifact.written.length === artifact.totalLength || artifact.written.length % ARTIFACT_CHUNK_BYTES === 0), 'ARTIFACT_STATE');
  integer(artifact.writeSeq, 1n, U64_MAX); integer(artifact.sealedAt, 0n, I64_MAX);
  if (artifact.status === 'WRITING') requireComposition(artifact.sealedAt === 0n && artifact.sealedSlot === 0n, 'ARTIFACT_STATE');
  else requireComposition(artifact.written.length === artifact.totalLength
    && equalBytes(sha256(artifact.written), artifact.payloadSHA), 'ARTIFACT_SHA');
  const w = new ByteWriter(131 + ARTIFACT_MAX_BYTES).raw(artifact.id, 32).raw(artifact.actor, 32)
    .u16(artifact.payloadSchema).u32(artifact.totalLength).raw(artifact.payloadSHA, 32)
    .u32(artifact.written.length).u64(artifact.writeSeq).u8(artifact.status === 'SEALED' ? 1 : 0)
    .i64(artifact.sealedAt).u64(artifact.sealedSlot).raw(artifact.written);
  return w.finish();
}

export function decodeArtifactBody(bytes, { domain, config }) {
  const r = new ByteReader(bytes, 131 + ARTIFACT_MAX_BYTES);
  const artifact = { id: r.raw(32), actor: r.raw(32), payloadSchema: r.u16(), totalLength: r.u32(), payloadSHA: r.raw(32) };
  const writtenLength = r.u32(); artifact.writeSeq = r.u64(); const status = r.u8();
  requireComposition(status <= 1 && writtenLength <= artifact.totalLength, 'ARTIFACT_STATE');
  artifact.status = status === 1 ? 'SEALED' : 'WRITING';
  artifact.sealedAt = r.i64(); artifact.sealedSlot = r.u64(); artifact.written = r.raw(writtenLength); r.finish();
  artifact.domain = asBytes(domain, 32); artifact.config = asBytes(config, 32);
  requireComposition(equalBytes(artifactId(artifact), artifact.id) && artifact.writeSeq > 0n
    && artifact.sealedAt >= 0n && writtenLength > 0
    && (writtenLength === artifact.totalLength || writtenLength % ARTIFACT_CHUNK_BYTES === 0), 'ARTIFACT_STATE');
  if (artifact.status === 'SEALED') requireComposition(writtenLength === artifact.totalLength
    && equalBytes(sha256(artifact.written), artifact.payloadSHA), 'ARTIFACT_SHA');
  else requireComposition(artifact.sealedAt === 0n && artifact.sealedSlot === 0n, 'ARTIFACT_STATE');
  return artifact;
}
