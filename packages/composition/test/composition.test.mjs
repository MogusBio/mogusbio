import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CompositionError, createCompositionCoordinator, artifactId, putArtifact, sealArtifact,
  readSealedArtifact, encodeArtifactBody, decodeArtifactBody,
  descriptorBytes, encodeSynthesisPayload, decodeSynthesisPayload, validateSourceUnion, synthesisFee,
} from '../src/index.mjs';
import { ByteWriter } from '../../protocol-core/src/codec.mjs';
import { encodeExactFrame, businessKey, sourceId, projectId, sha256 } from '../../protocol-core/src/p0.mjs';
import { nonceOpId, cloneProtocolState } from '../../protocol-core/src/atomic.mjs';
import { catalogHash, encodeMaterialPlan, F1_BOM, materialClass } from '../../protocol-core/src/materials.mjs';
import { createReferenceGraph, encodeGraph } from '../../biology/src/graph.mjs';
import { validateDesign } from '../../biology/src/evidence.mjs';
import { designId } from '../../biology/src/canonical.mjs';
import { SettlementEngine } from '../../settlement/src/index.mjs';

const b = n => Buffer.alloc(32, n);
const hex = value => Buffer.from(value).toString('hex');
const base = { domain: b(0), config: b(0x11), rule: b(0x12), validatorHash: b(0x13), labMint: b(0x14) };
const OWNER = b(0x31), TOKEN = b(0x32), PROJECT_M = b(0x44);
const PROJECT = projectId(base.domain, PROJECT_M);
const REWARD_START = 3_600n;
const at = h => REWARD_START + BigInt(h) * 3_600n;
const graph = target => createReferenceGraph({ ...base, catalog: catalogHash(), target });
const expectCode = (fn, code) => assert.throws(fn, error => error instanceof CompositionError && error.code === code);

// Deliberate module mocks for lifecycle/rollback unit tests. They are not
// biological verification, H16 certification or a production release approval.
const mockVerifier = g => ({ status: 'PASS', q_ppm: 1_000_000n, graphSHA: sha256(encodeGraph(g)),
  transcriptSHA: b(0x77), positiveBitmap: Buffer.alloc(64), taskApplicable: false, C: 0n });
const coordinator = (overrides = {}) => createCompositionCoordinator(base, {
  verifyFunction: mockVerifier, semanticDesign: g => sha256(encodeGraph(g)), ...overrides,
});

function initial() {
  const classes = [1, 2, 3, 4].map(classId => ({ class: classId, mint: b(0x54 + classId),
    lifetimeCap: 1_000n, priceLamports: 1n, issued: 100n, intakeBurned: 0n }));
  const materials = {
    projects: new Map([[hex(PROJECT), { creator: OWNER, creationBusiness: PROJECT_M,
      catalogHash: catalogHash(), saleRecipient: OWNER, createdAt: 0n, createdSlot: 0n, name: 'Lab', classes }]]),
    mints: new Map(classes.map(c => [hex(c.mint), { supply: 100n }])),
    tokens: new Map(classes.map(c => [hex(b(0x60 + c.class)), { mint: c.mint, owner: OWNER,
      amount: 100n, initialized: true, native: false, frozen: false }])),
    sources: new Map(), actorNonces: new Map(),
    labTokens: new Map([[hex(TOKEN), { mint: base.labMint, owner: OWNER,
      amount: 0n, initialized: true, native: false, frozen: false }]]),
  };
  return coordinator().initialState(materials, { rewardStart: REWARD_START });
}

function planFor(state, M) {
  const intakes = [], debitInputs = [];
  for (let classId = 1; classId <= 4; classId += 1) {
    const positive = materialClass(classId).species.filter(s => F1_BOM[s - 1] > 0n);
    const existing = [...state.sources.entries()].find(([, source]) => source.class === classId
      && positive.every(s => source.initialTick[s - 1] - source.spentPrefix[s - 1] >= F1_BOM[s - 1]));
    if (existing) {
      const [id, source] = existing;
      debitInputs.push({ sourceId: Buffer.from(id, 'hex'), entries: positive.map(species => ({ species,
        expectedPrefix: source.spentPrefix[species - 1], takeTick: F1_BOM[species - 1] })) });
    } else {
      const ordinal = intakes.length;
      intakes.push({ projectId: PROJECT, class: classId, sourceTokenAccount: b(0x60 + classId), materialOwner: OWNER, unitCount: 1n });
      debitInputs.push({ sourceId: sourceId(base.domain, M, ordinal), entries: positive.map(species => ({ species,
        expectedPrefix: 0n, takeTick: F1_BOM[species - 1] })) });
    }
  }
  debitInputs.sort((a, c) => Buffer.compare(a.sourceId, c.sourceId));
  return { catalogHash: catalogHash(), intakes, debits: debitInputs };
}

function makeComponent(state, primitive, profile = 0, nonce = BigInt(state.compositionRoots.size)) {
  const opId = nonceOpId(nonce), M = businessKey(base.domain, OWNER, opId);
  const payload = new ByteWriter(3116).raw(descriptorBytes({ primitive, profile })).raw(OWNER).u64(0n)
    .raw(encodeMaterialPlan(planFor(state, M))).finish();
  const frameBytes = encodeExactFrame({ module: 501, opcode: 1, domain: base.domain,
    configId: base.config, actor: OWNER, opId, payload });
  const context = { frameBytes, authorizedActors: new Set([hex(OWNER)]), authorizedOwners: new Set([hex(OWNER)]),
    createdAt: 0n, createdSlot: 1n, rootBump: 255, actualRentLamports: 0n };
  return { ...coordinator().manufactureComponent(state, context), context };
}

function upload(state, payload, now = at(121)) {
  const metadata = { domain: base.domain, config: base.config, actor: OWNER,
    payloadSchema: 1, totalLength: payload.length, payloadSHA: sha256(payload) };
  let next = state, seq = 0n;
  for (let offset = 0; offset < payload.length; offset += 1024) {
    next = putArtifact(next, { ...metadata, expectedSeq: seq, offset,
      chunk: payload.subarray(offset, Math.min(offset + 1024, payload.length)) }).state;
    seq += 1n;
  }
  const id = artifactId(metadata);
  next = sealArtifact(next, { artifactId: id, actor: OWNER, expectedSeq: seq, now, slot: 2n }).state;
  return { state: next, id };
}

function settleHour(engine, h, now) {
  const execute = (name, request) => engine.executePrepared(name, { actor: 'crank', now, ...request });
  execute('openHour', { hour: h });
  while (['ROOT_SCAN', 'K_SCAN'].includes(engine.hour(h).status)) {
    const record = engine.hour(h), snapshot = engine.snapshot();
    execute('scanHour', { hour: h, expectedPhase: record.status,
      expectedCursor: record.status === 'K_SCAN' ? snapshot.registry.kScanSeq : record.rootCursor, workCount: 1 });
  }
  const record = engine.hour(h);
  execute('materializeHour', { hour: h, expectedCursor: 0n, rootCount: Number(record.rootCutoff) });
}

let cachedCellFixture;
function cellFixture() {
  if (!cachedCellFixture) {
    let state = initial(); const inputs = [];
    for (let primitive = 1; primitive <= 4; primitive += 1) {
      const made = makeComponent(state, primitive, primitive === 4 ? 3 : 0);
      state = made.state; inputs.push(made.root.instance);
    }
    const engine = SettlementEngine.fromSnapshot(state.settlement), positions = [];
    for (const id of inputs) positions.push(engine.executePrepared('register', { actor: hex(OWNER), now: 0n, instance: hex(id) }).intervalId);
    for (let h = 0n; h < 120n; h += 1n) settleHour(engine, h, at(120));
    for (const id of inputs) engine.executePrepared('exit', { actor: hex(OWNER), now: at(120), instance: hex(id), seq: 0n });
    settleHour(engine, 120n, at(121));
    for (const id of positions.slice(0, 3)) engine.executePrepared('claimPosition', {
      actor: hex(OWNER), now: at(121), intervalId: id, expectedPaid: 0n,
      upToAccrued: engine.position(id).accrued, destinationOwner: hex(OWNER) });
    state.settlement = engine.snapshot();
    state.labTokens.get(hex(TOKEN)).amount = engine.balance(hex(OWNER));
    const payload = coordinator().prepareSynthesisPayload(state, { graph: graph(3), inputIds: inputs });
    const uploaded = upload(state, payload, at(338)); state = uploaded.state;
    cachedCellFixture = { state, inputs, positions, payload, artifactId: uploaded.id };
  }
  return cloneProtocolState(cachedCellFixture);
}

function synthesisContext(f) {
  const payload = new ByteWriter(185).raw(f.artifactId).raw(sha256(f.payload)).u32(f.payload.length).u32(2_000_000)
    .raw(OWNER).raw(TOKEN).u64(800_000n).raw(OWNER).u64(0n).u8(0).finish();
  const frameBytes = encodeExactFrame({ module: 702, opcode: 1, domain: base.domain, configId: base.config,
    actor: OWNER, opId: nonceOpId(100n), payload });
  return { frameBytes, authorizedActors: new Set([hex(OWNER)]), createdAt: at(121), createdSlot: 500n,
    rootBump: 255, actualRentLamports: 0n };
}

test('Artifact grows in exact bounded1024 segments and sealed bytes round trip', () => {
  const payload = Buffer.alloc(2_123, 7), uploaded = upload({}, payload);
  const record = readSealedArtifact(uploaded.state, uploaded.id, base);
  assert.equal(record.writeSeq, 3n);
  assert.equal(record.written.length, 2_123);
  assert.deepEqual(record.written, payload);
  const body = encodeArtifactBody(record);
  assert.equal(body.length, 131 + 2_123);
  assert.deepEqual(encodeArtifactBody(decodeArtifactBody(body, base)), body);
  expectCode(() => putArtifact(uploaded.state, { ...record, expectedSeq: 3n, offset: 0, chunk: payload.subarray(0, 1024) }), 'ARTIFACT_SEALED');
});

test('Artifact rejects holes, partial chunks, stale sequence and premature seal without mutating state', () => {
  const payload = Buffer.alloc(2_048, 1);
  const metadata = { ...base, actor: OWNER, payloadSchema: 1, totalLength: payload.length, payloadSHA: sha256(payload) };
  expectCode(() => putArtifact({}, { ...metadata, expectedSeq: 0n, offset: 1024, chunk: payload.subarray(0, 1024) }), 'ARTIFACT_INITIAL_SEQUENCE');
  expectCode(() => putArtifact({}, { ...metadata, expectedSeq: 0n, offset: 0, chunk: payload.subarray(0, 500) }), 'ARTIFACT_CHUNK');
  const first = putArtifact({}, { ...metadata, expectedSeq: 0n, offset: 0, chunk: payload.subarray(0, 1024) });
  const before = cloneProtocolState(first.state);
  expectCode(() => putArtifact(first.state, { ...metadata, expectedSeq: 0n, offset: 1024, chunk: payload.subarray(1024) }), 'ARTIFACT_SEQUENCE_OR_OWNER');
  expectCode(() => sealArtifact(first.state, { artifactId: first.result.artifactId, actor: OWNER,
    expectedSeq: 1n, now: 0n, slot: 1n }), 'ARTIFACT_INCOMPLETE');
  assert.deepEqual(first.state, before);
});

test('unsealed erroneous chunk may be replaced at same length; sealed SHA cannot be faked', () => {
  const payload = Buffer.alloc(1024, 1), bad = Buffer.alloc(1024, 2);
  const metadata = { ...base, actor: OWNER, payloadSchema: 1, totalLength: payload.length, payloadSHA: sha256(payload) };
  let state = putArtifact({}, { ...metadata, expectedSeq: 0n, offset: 0, chunk: bad }).state;
  expectCode(() => sealArtifact(state, { artifactId: artifactId(metadata), actor: OWNER,
    expectedSeq: 1n, now: 0n, slot: 0n }), 'ARTIFACT_SHA');
  state = putArtifact(state, { ...metadata, expectedSeq: 1n, offset: 0, chunk: payload }).state;
  state = sealArtifact(state, { artifactId: artifactId(metadata), actor: OWNER,
    expectedSeq: 2n, now: 0n, slot: 0n }).state;
  assert.equal(readSealedArtifact(state, artifactId(metadata)).status, 'SEALED');
});

test('P5 component consumes four actual classes and stores complete934-byte immutable capsule', () => {
  const state = initial(), before = cloneProtocolState(state), made = makeComponent(state, 1);
  assert.deepEqual(state, before);
  assert.equal(made.root.B_int, 120_000n);
  assert.equal(made.root.retired_B_int, 45_000n);
  assert.equal(made.result.consumedTick, 14_000n);
  assert.deepEqual(made.result.burnedStandardUnits, [1n, 1n, 1n, 1n]);
  assert.equal(made.root.wireBytes.length, 1055);
  assert.equal(made.root.capsule.length, 934);
  assert.equal(made.root.effective.length, 27);
  assert.equal(made.root.retired.length, 2);
  assert.equal(SettlementEngine.fromSnapshot(made.state.settlement).root(hex(made.root.instance)).scope, 'COMPONENT');
});

test('P5 same sources and make request cannot mint a second output', () => {
  const first = makeComponent(initial(), 1);
  const before = cloneProtocolState(first.state);
  assert.throws(() => coordinator().manufactureComponent(first.state, first.context));
  assert.deepEqual(first.state, before);
  const second = makeComponent(first.state, 2);
  assert.notDeepEqual(second.root.instance, first.root.instance);
  assert.deepEqual(second.result.burnedStandardUnits, [0n, 1n, 0n, 0n]);
});

test('P5 forged native authorization cannot consume real owner materials', () => {
  const first = makeComponent(initial(), 1);
  const context = { ...first.context, authorizedActors: new Set() };
  expectCode(() => coordinator().manufactureComponent(initial(), context), 'ACTOR_NOT_AUTHORIZED');
  assert.throws(() => descriptorBytes({ primitive: 4, profile: 0 }));
  assert.throws(() => descriptorBytes({ primitive: 1, profile: 1 }));
});

test('60 manufactured leaves use exact [30,60,15,15] standard material units without recycling', () => {
  let state = initial();
  for (let role = 1; role <= 15; role += 1) for (let primitive = 1; primitive <= 4; primitive += 1)
    state = makeComponent(state, primitive, primitive === 4 ? role : 0).state;
  assert.equal(state.compositionRoots.size, 60);
  const burned = state.projects.get(hex(PROJECT)).classes.map(c => c.intakeBurned);
  assert.deepEqual(burned, [30n, 60n, 15n, 15n]);
  assert.equal([...state.compositionRoots.values()].reduce((sum, root) => sum + root.B_int, 0n), 7_200_000n);
  assert.equal([...state.compositionRoots.values()].reduce((sum, root) => sum + root.retired_B_int, 0n), 2_700_000n);
});

test('CELL.C03 exact synthesis payload is4659 bytes with true4 leaves, capsules and source plan', () => {
  const f = cellFixture();
  assert.equal(f.payload.length, 4659);
  const decoded = decodeSynthesisPayload(f.payload);
  assert.equal(decoded.graph.target, 3);
  assert.equal(decoded.direct.length, 4);
  assert.equal(decoded.leaves.length, 4);
  assert.deepEqual(encodeSynthesisPayload(decoded), f.payload);
  assert.throws(() => decodeSynthesisPayload(Buffer.concat([f.payload, Buffer.from([0])])));
});

test('CELL synthesis uses owned real roots, actual paid LAB fee and preserves an old unpaid Position', () => {
  const f = cellFixture(), before = cloneProtocolState(f.state);
  const made = coordinator().synthesize(f.state, synthesisContext(f));
  assert.deepEqual(f.state, before);
  assert.equal(made.root.scope, 'CELL'); assert.equal(made.root.target, 3);
  assert.equal(made.root.B_int, 480_000n); assert.equal(made.root.retired_B_int, 180_000n);
  assert.equal(made.result.fee, 800_000n); assert.equal(made.root.wireBytes.length, 761);
  const engine = SettlementEngine.fromSnapshot(made.state.settlement);
  for (const id of f.inputs) assert.equal(engine.root(hex(id)).status, 'CONSUMED');
  assert.equal(engine.root(hex(made.root.instance)).status, 'LIVE');
  const lastPosition = engine.position(f.positions[3]);
  assert.equal(lastPosition.paid, 0n); assert.equal(lastPosition.accrued, 287_738n);
  engine.executePrepared('claimPosition', { actor: 'relayer', now: at(121), intervalId: f.positions[3],
    expectedPaid: 0n, upToAccrued: lastPosition.accrued, destinationOwner: hex(OWNER) });
  assert.equal(engine.position(f.positions[3]).paid, 287_738n);
  assert.equal(engine.ledger().manufactureBurned, 800_000n);
  assert.equal(made.state.labTokens.get(hex(TOKEN)).amount, before.labTokens.get(hex(TOKEN)).amount - 800_000n);
});

test('real FUNC2 hard support accepts challenge2000000/q1000000 and produces exact H16 suite2', () => {
  const f = cellFixture();
  const real = coordinator({ verifyFunction: validateDesign, semanticDesign: designId });
  const made = real.synthesize(f.state, synthesisContext(f));
  assert.equal(made.root.q_ppm, 1_000_000n);
  assert.equal(made.root.c_ppm, 2_000_000);
  assert.equal(made.root.suiteVersion, 2);
  assert.equal(made.root.admission.length, 32);
  assert.equal(made.root.wireBytes.readUInt32LE(120 + 491), 2);
});

test('trusted verifier rejects client PASS/local MODEL_PASS without exact certificate fields and rolls back all inputs', () => {
  const f = cellFixture(), before = cloneProtocolState(f.state), context = synthesisContext(f);
  expectCode(() => coordinator({ verifyFunction: () => true }).synthesize(f.state, context), 'FUNCTION_NOT_CERTIFIED');
  expectCode(() => coordinator({ verifyFunction: () => ({ status: 'MODEL_PASS', quality: 1 }) }).synthesize(f.state, context), 'FUNCTION_NOT_CERTIFIED');
  expectCode(() => coordinator({ verifyFunction: g => ({ ...mockVerifier(g), graphSHA: b(0) }) }).synthesize(f.state, context), 'FUNCTION_GRAPH_BINDING');
  expectCode(() => coordinator({ verifyFunction: g => ({ ...mockVerifier(g), positiveBitmap: Buffer.alloc(64, 255) }) }).synthesize(f.state, context), 'FUNCTION_BITMAP');
  assert.deepEqual(f.state, before);
});

test('failed semantic/fee/source/position validation leaves materials, input roots and LAB unchanged', () => {
  const f = cellFixture(), context = synthesisContext(f), before = cloneProtocolState(f.state);
  assert.throws(() => coordinator({ semanticDesign: () => { throw new Error('semantic module failed'); } }).synthesize(f.state, context));
  const poor = cloneProtocolState(f.state); poor.labTokens.get(hex(TOKEN)).amount = 799_999n;
  expectCode(() => coordinator().synthesize(poor, context), 'LAB_SOURCE_BALANCE');
  expectCode(() => coordinator().synthesize(f.state, { ...context, createdAt: 0n }), 'SYNTHESIS_NOT_OPEN');
  assert.deepEqual(f.state, before);
});

test('sealing a forged capsule does not make it a genuine manufacture input', () => {
  const f = cellFixture(), payload = decodeSynthesisPayload(f.payload);
  const forgedCapsule = Buffer.from(payload.capsules[0]); forgedCapsule[10] ^= 1;
  payload.capsules[0] = forgedCapsule; payload.leaves[0].fingerprint = sha256(forgedCapsule);
  const altered = encodeSynthesisPayload(payload), uploaded = upload(f.state, altered);
  const forged = { ...f, state: uploaded.state, payload: altered, artifactId: uploaded.id };
  expectCode(() => coordinator().synthesize(forged.state, synthesisContext(forged)), 'SYNTHESIS_INPUT_BINDING');
});

test('stale direct revision and duplicate real inputs cannot be hidden in free graph data', () => {
  const f = cellFixture(), payload = decodeSynthesisPayload(f.payload);
  payload.direct[0].expectedRevision += 1n;
  const altered = encodeSynthesisPayload(payload), uploaded = upload(f.state, altered);
  const stale = { ...f, state: uploaded.state, payload: altered, artifactId: uploaded.id };
  expectCode(() => coordinator().synthesize(stale.state, synthesisContext(stale)), 'SYNTHESIS_INPUT_BINDING');
  expectCode(() => coordinator().prepareSynthesisPayload(f.state, { graph: graph(3), inputIds: [f.inputs[0], ...f.inputs.slice(0, 3)] }), 'DUPLICATE_DIRECT_INPUT');
});

test('historical source overlaps include retired ATP/glucose and adjacency alone is legal', () => {
  const row = { sourceId: b(1), species: 1, lo: 0n, hi: 500n };
  const leaf = { effective: [row], retired: [] };
  expectCode(() => validateSourceUnion([leaf, leaf]), 'SOURCE_OVERLAP');
  const merged = validateSourceUnion([leaf, { effective: [{ ...row, lo: 500n, hi: 1000n }], retired: [] }]);
  assert.equal(merged.effective.length, 1); assert.equal(merged.effective[0].hi, 1000n);
  expectCode(() => validateSourceUnion([{ effective: [], retired: [{ ...row, species: 25 }] },
    { effective: [], retired: [{ ...row, species: 25, lo: 250n, hi: 750n }] }]), 'SOURCE_OVERLAP');
  expectCode(() => validateSourceUnion([{ effective: [], retired: [{ ...row, species: 33 }] }]), 'SOURCE_SLICE');
  expectCode(() => validateSourceUnion([{ effective: [], retired: [{ ...row, hi: 1n << 64n }] }]), 'SOURCE_SLICE');
});

test('source provenance is re-parsed from actual immutable capsules, never a cached effective list', () => {
  const f = cellFixture(), changed = cloneProtocolState(f.state);
  const first = changed.compositionRoots.get(hex(f.inputs[0]));
  first.effective[0].sourceId = b(0xff);
  first.effective[0].lo = 999n; first.effective[0].hi = 1499n;
  assert.deepEqual(coordinator().prepareSynthesisPayload(changed, { graph: graph(3), inputIds: f.inputs }), f.payload);
});

test('frozen fee formula totals48 LAB across15 cells, six organs and one BIO', () => {
  assert.equal(synthesisFee(480_000n, 3), 800_000n);
  const organCells = [2n, 3n, 4n, 2n, 2n, 2n];
  const organFees = organCells.reduce((sum, cells, n) => sum + synthesisFee(cells * 480_000n, 16 + n), 0n);
  assert.equal(organFees, 24_000_000n);
  assert.equal(15n * 800_000n + organFees + synthesisFee(7_200_000n, 22), 48_000_000n);
});

test('complete lifecycle with explicit verifier mocks: four materials →60parts→15cells→6organs→BIO, fees and future mining', () => {
  const local = coordinator({
    verifyFunction: (g, { challenge }) => ({ ...mockVerifier(g),
      q_ppm: [3, 9, 14, 15, 21].includes(g.target) ? 1_000_000n : BigInt(challenge),
      taskApplicable: g.target === 22 && challenge === 2_000_000, C: g.target === 22 ? 342n : 0n }),
    admitKnowledge: (draft, root) => {
      draft.testKnowledge ??= new Map(); draft.testKnowledge.set(hex(root.semantic), root.instance);
    },
  });
  let state = initial();
  const components = [];
  for (let role = 1; role <= 15; role += 1) {
    const rows = [];
    for (let primitive = 1; primitive <= 4; primitive += 1) {
      const made = makeComponent(state, primitive, primitive === 4 ? role : 0);
      state = made.state; rows.push(made.root.instance);
    }
    components.push(rows);
  }
  let engine = SettlementEngine.fromSnapshot(state.settlement);
  const positions = [];
  for (const id of components.flat()) positions.push(engine.executePrepared('register', {
    actor: hex(OWNER), now: 0n, instance: hex(id) }).intervalId);

  const boundedSettle = (h, now) => {
    const execute = (name, request) => engine.executePrepared(name, { actor: 'crank', now, ...request });
    execute('openHour', { hour: h });
    while (['ROOT_SCAN', 'K_SCAN'].includes(engine.hour(h).status)) {
      const r = engine.hour(h), s = engine.snapshot();
      // At h338 closed component segments each require one skip and one root
      // completion. Single-step fallback handles those finite mixed steps.
      const workCount = h < 338n && r.status === 'ROOT_SCAN' ? Math.min(8, Number(r.rootCutoff - r.rootCursor)) : 1;
      execute('scanHour', { hour: h, expectedPhase: r.status,
        expectedCursor: r.status === 'K_SCAN' ? s.registry.kScanSeq : r.rootCursor, workCount });
    }
    while (engine.hour(h).status !== 'FINAL') {
      const r = engine.hour(h);
      execute('materializeHour', { hour: h, expectedCursor: r.materializeCursor,
        rootCount: Math.min(8, Number(r.rootCutoff - r.materializeCursor)) });
    }
  };
  for (let h = 0n; h < 337n; h += 1n) boundedSettle(h, at(337));
  for (const id of components.flat()) engine.executePrepared('exit', {
    actor: hex(OWNER), now: at(337), instance: hex(id), seq: 0n });
  boundedSettle(337n, at(338));
  for (const id of positions) engine.executePrepared('claimPosition', {
    actor: hex(OWNER), now: at(338), intervalId: id, expectedPaid: 0n,
    upToAccrued: engine.position(id).accrued, destinationOwner: hex(OWNER) });
  const seedEarnings = 142_680n * 338n;
  assert.equal(engine.balance(hex(OWNER)), seedEarnings);
  state.settlement = engine.snapshot(); state.labTokens.get(hex(TOKEN)).amount = seedEarnings;

  let manufactureNonce = 100n;
  const makeParent = (target, inputIds) => {
    const payload = local.prepareSynthesisPayload(state, { graph: graph(target), inputIds });
    const uploaded = upload(state, payload); state = uploaded.state;
    const leafCount = target <= 15 ? 4n : target === 22 ? 60n : BigInt([2, 3, 4, 2, 2, 2][target - 16]) * 4n;
    const challenge = 2_000_000;
    const fee = synthesisFee(leafCount * 120_000n, target);
    const p = new ByteWriter(185).raw(uploaded.id).raw(sha256(payload)).u32(payload.length).u32(challenge)
      .raw(OWNER).raw(TOKEN).u64(fee).raw(OWNER).u64(0n).u8(0).finish();
    const frameBytes = encodeExactFrame({ module: 702, opcode: 1, domain: base.domain, configId: base.config,
      actor: OWNER, opId: nonceOpId(manufactureNonce++), payload: p });
    const made = local.synthesize(state, { frameBytes, authorizedActors: new Set([hex(OWNER)]),
      createdAt: at(338), createdSlot: 1000n, rootBump: 255, actualRentLamports: 0n });
    state = made.state;
    return made.root.instance;
  };
  const cells = components.map((ids, n) => makeParent(n + 1, ids));
  const groups = [[0, 1], [2, 3, 4], [5, 6, 7, 8], [9, 10], [11, 12], [13, 14]];
  const organs = groups.map((roles, n) => makeParent(16 + n, roles.map(role => cells[role])));
  const finalBio = makeParent(22, organs);
  const finalRoot = state.compositionRoots.get(hex(finalBio));
  assert.equal(state.compositionRoots.size, 82);
  assert.equal(finalRoot.B_int, 7_200_000n);
  assert.equal(finalRoot.retired_B_int, 2_700_000n);
  assert.equal(finalRoot.leaves.length, 60);
  assert.equal(state.compositionArtifacts.get(hex(finalRoot.artifactId)).totalLength, 67_092);
  assert.deepEqual(state.projects.get(hex(PROJECT)).classes.map(c => c.intakeBurned), [30n, 60n, 15n, 15n]);
  engine = SettlementEngine.fromSnapshot(state.settlement);
  assert.equal(engine.ledger().manufactureBurned, 48_000_000n);
  assert.equal(engine.balance(hex(OWNER)), seedEarnings - 48_000_000n);
  for (const id of [...components.flat(), ...cells, ...organs]) assert.equal(engine.root(hex(id)).status, 'CONSUMED');
  const registration = engine.executePrepared('register', { actor: hex(OWNER), now: at(338), instance: hex(finalBio) });
  assert.equal(registration.start, 339n);
  boundedSettle(338n, at(339));
  boundedSettle(339n, at(340));
  assert.equal(engine.hour(339n).members, 1n);
  assert.equal(engine.position(registration.intervalId).accrued, 470_890n);
  assert.equal(engine.ledger().total, 100_000_000_000_000n);
});
