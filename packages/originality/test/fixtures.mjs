import { ByteWriter } from '../../protocol-core/src/codec.mjs';
import { cloneProtocolState, nonceOpId } from '../../protocol-core/src/atomic.mjs';
import { businessKey, instanceId, requestHash, encodeExactFrame, encodeRecord, sha256 } from '../../protocol-core/src/p0.mjs';
import { catalogHash } from '../../protocol-core/src/materials.mjs';
import { encodeGraph } from '../../biology/src/graph.mjs';
import { designId } from '../../biology/src/canonical.mjs';
import { validateDesign } from '../../biology/src/evidence.mjs';
import { createImprovement } from '../../biology/src/seeds.mjs';
import { SettlementEngine } from '../../settlement/src/index.mjs';
import { putArtifact, sealArtifact, artifactId } from '../../composition/src/artifact.mjs';
import { descriptorBytes, encodeSynthesisPayload, encodeLeafMap } from '../../composition/src/payload.mjs';
import { createOriginalityCoordinator, encodeBlueprint, TASK_FAMILY, commitmentHash, computeAdmissionH16 } from '../src/index.mjs';

export const b = n => Buffer.alloc(32, n), key = value => Buffer.from(value).toString('hex');
export const ALICE = b(0xa1), BOB = b(0xa2), CRANK = b(0xa9);
export const B0 = 1_000_000n, W = 86_400n, D = B0 + 259_200n;
export const BASE = { domain: b(0), config: b(1), catalog: catalogHash(), rule: sha256(Buffer.from('FUNC2-unit-fixture')),
  rewardStart: B0, seedOpen: 0n };
export const coordinator = createOriginalityCoordinator(BASE);
export const context = (now, actor = CRANK, extra = {}) => ({ now, slot: 99n, actor,
  authorizedActors: new Set([key(actor)]), ...extra });

export function upload(state, bytes, payloadSchema = 2, now = 10n) {
  const metadata = { domain: BASE.domain, config: BASE.config, actor: CRANK, payloadSchema,
    totalLength: bytes.length, payloadSHA: sha256(bytes) };
  const existingId = artifactId(metadata);
  if (state.compositionArtifacts?.get(key(existingId))?.status === 'SEALED') return { state, id: existingId };
  let draft = state, seq = 0n;
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    draft = putArtifact(draft, { ...metadata, expectedSeq: seq++, offset, chunk: bytes.subarray(offset, offset + 1024) }).state;
  }
  const id = artifactId(metadata);
  draft = sealArtifact(draft, { artifactId: id, actor: CRANK, expectedSeq: seq, now, slot: 1n }).state;
  return { state: draft, id };
}

let openingCache;
export function opening({ historical = false } = {}) {
  if (!openingCache) {
    let state = coordinator.initialize({ compositionArtifacts: new Map(), compositionRoots: new Map(),
      settlement: new SettlementEngine({ rewardStart: B0 }).snapshot() });
    for (const [n, graph] of coordinator.initialGraphs().entries()) {
      const artifact = upload(state, encodeBlueprint({ graph })); state = artifact.state;
      state = coordinator.registerSeed(state, context(20n + BigInt(n), CRANK, { artifactId: artifact.id })).state;
    }
    state = coordinator.sealOpeningStep(state, context(B0, CRANK, { expectedCursor: 0n, maxScan: 8 })).state;
    state = coordinator.sealOpeningStep(state, context(B0, CRANK, { expectedCursor: 8n, maxScan: 8 })).state;
    openingCache = state;
  }
  const state = cloneProtocolState(openingCache);
  if (historical) {
    // Explicit NON-PRODUCTION historical deployment fixture: the previous
    // twelve-seed opening328, before C324/C320 became required public K0.
    // There is deliberately no production API to select this opening.
    const task = state.originality;
    task.knowledge = task.knowledge.slice(0, 12);
    for (const [id, seed] of task.seeds) if (seed.C < 328n) {
      task.seeds.delete(id); task.disclosures.delete(id);
    }
    task.best = { C: 328n, design: task.knowledge[11].design, index: 11n };
    task.eventSeq = 25n; task.generation = 11n; task.rounds.clear();
    task.opening.seedCount = 12n; task.opening.cursor = 12n; task.opening.initialBitmap = 0xfff;
    task.opening.snapshot.best = cloneProtocolState(task.best); task.opening.snapshot.seedCount = 12n;
    state.settlement.bestCost = 328n;
  }
  return state;
}

export const improved = (surfaces = false) => createImprovement({ ...BASE, surfaces });

export function makeCommit(state, { graph, author = ALICE, commitNonce = 0n, manufactureNonce = 1n,
  salt = b(0x55), now = B0 + 1n, round = 0n } = {}) {
  const manufactureOpId = nonceOpId(manufactureNonce);
  const hash = commitmentHash({ domain: BASE.domain, round, author, design: designId(graph), manufactureOpId, salt });
  const payload = new ByteWriter(116).raw(TASK_FAMILY).u32(1).u64(round).raw(hash).raw(author).u64(0n).finish();
  const frameBytes = encodeExactFrame({ module: 1002, opcode: 1, domain: BASE.domain,
    configId: BASE.config, actor: author, opId: nonceOpId(commitNonce), payload });
  const result = coordinator.commit(state, context(now, author, { frameBytes }));
  return { ...result, manufactureOpId, salt, author, graph };
}

/**
 * Authoritative upstream Root storage fixture, not material manufacturing.
 * Biology is really re-executed by FUNC2 here and again by originality.
 * Actual material/provenance lifecycle is independently tested in composition.
 */
export function materializedRoot(state, { graph, author = ALICE, opId = nonceOpId(1n),
  now = B0 + W + 1n, slot = 99n, competition = null, challenge = 2_000_000 } = {}) {
  const draft = cloneProtocolState(state), report = validateDesign(graph, { challenge }), graphBytes = encodeGraph(graph);
  const M = businessKey(BASE.domain, author, opId), id = instanceId(BASE.domain, M);
  const capsule = Buffer.alloc(934), fingerprint = sha256(capsule);
  const leaves = Array.from({ length: 15 }, (_, i) => [1, 2, 3, 4].map(primitive => {
    const role = i + 1, n = role * 4 + primitive;
    return { role, primitive, descriptor: descriptorBytes({ primitive, profile: primitive === 4 ? role : 0 }),
      instance: sha256(Buffer.from(`fixture-leaf:${key(id)}:${n}`)), fingerprint };
  })).flat();
  const direct = [16, 17, 18, 19, 20, 21].map(scope => ({ scope, primitive: 0,
    instance: sha256(Buffer.from(`fixture-direct:${key(id)}:${scope}`)), expectedRevision: 0n, fingerprint }));
  const bytes = encodeSynthesisPayload({ graph, direct, leaves, capsules: leaves.map(() => capsule) });
  const uploaded = upload(draft, bytes, 1, now);
  const payload = new ByteWriter(249).raw(uploaded.id).raw(sha256(bytes)).u32(bytes.length).u32(challenge)
    .raw(author).raw(b(0x70)).u64(12_000_000n).raw(author).u64(0n).u8(competition ? 1 : 0);
  if (competition) payload.raw(competition.commitId).raw(competition.salt);
  const frameBytes = encodeExactFrame({ module: 702, opcode: 1, domain: BASE.domain,
    configId: BASE.config, actor: author, opId, payload: payload.finish() });
  const leafMapSHA = sha256(encodeLeafMap(leaves));
  const admission = computeAdmissionH16({ ...BASE, graphSHA: report.graphSHA, leafMapSHA,
    evidenceRef: id, evidenceKind: 1, target: 22, c_ppm: challenge, q_ppm: report.q_ppm,
    taskApplicable: report.taskApplicable, C: report.C, suite: 2, fixture: 1, load: 1, dutMask: 0x7fff,
    transcriptSHA: report.transcriptSHA, positiveBitmap: report.positiveBitmap });
  const body = new ByteWriter(641).raw(id).raw(M).raw(requestHash(frameBytes)).raw(BASE.catalog).raw(BASE.rule)
    .raw(Buffer.from([22, 3, 0, 0])).u32(report.q_ppm).u64(7_200_000n).u64(2_700_000n)
    .u8(2).u8(report.taskApplicable ? 1 : 0).i64(now).u64(slot).raw(author).u64(0n).u8(0).raw(b(0)).raw(b(0)).i64(0n).u64(0n)
    .raw(uploaded.id).raw(sha256(bytes)).u32(bytes.length).raw(report.graphSHA).raw(leafMapSHA).raw(b(0))
    .u32(challenge).u32(2).u32(1).u32(1).raw(report.transcriptSHA).raw(report.positiveBitmap)
    .u64(report.C).raw(designId(graph)).u8(6).u8(60).finish();
  const wireBytes = encodeRecord({ kind: 12, schema: 4, domain: BASE.domain, configId: BASE.config,
    bump: 255, recordKey: id, body });
  const root = { instance: id, scope: 'BIO', target: 22, graph, B_int: 7_200_000n, q_ppm: report.q_ppm,
    wireBytes, graphSHA: report.graphSHA, transcriptSHA: report.transcriptSHA, admission,
    artifactId: uploaded.id, artifactSHA: sha256(bytes), semantic: designId(graph), c_ppm: challenge, suiteVersion: 2 };
  uploaded.state.compositionRoots.set(key(id), root);
  const settlement = SettlementEngine.fromSnapshot(uploaded.state.settlement);
  settlement.createVerifiedRoot({ instance: key(id), owner: key(author), scope: 'BIO',
    B_int: 7_200_000n, q_ppm: report.q_ppm, certificate: key(admission) });
  uploaded.state.settlement = settlement.snapshot();
  return { state: uploaded.state, root, frameBytes, context: { rootId: id, frameBytes, now, slot, competition } };
}

export function compete(state, commit, { now = B0 + W + 1n } = {}) {
  const made = materializedRoot(state, { graph: commit.graph, author: commit.author,
    opId: commit.manufactureOpId, now, competition: { commitId: commit.result.id, salt: commit.salt } });
  return { ...coordinator.admitManufactured(made.state, made.context), root: made.root, context: made.context };
}

export function finalize(state, round = 0n, now = D) {
  let draft = state;
  for (let i = 0; i < 1000; i++) {
    const current = draft.originality.rounds.get(round);
    const restart = current && current.state !== 'FINALIZED' && current.scanEpoch !== draft.originality.safetyEpoch;
    const next = coordinator.finalizeStep(draft, context(now, CRANK, { round, maxScan: 8,
      expectedPhase: current?.state ?? 'ABSENT', expectedCandidateCursor: restart ? 0n : current?.candidateCursor ?? 0n,
      expectedKnowledgeCursor: restart ? 0n : current?.state === 'SCAN_BASELINE' ? current.baselineCursor : current?.knowledgeCursor ?? 0n }));
    draft = next.state;
    if (next.result.state === 'FINALIZED') return next;
  }
  throw new Error('fixture finalization did not finish');
}
