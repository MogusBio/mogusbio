import test from 'node:test';
import assert from 'node:assert/strict';
import { ByteWriter } from '../../protocol-core/src/codec.mjs';
import { cloneProtocolState, nonceOpId } from '../../protocol-core/src/atomic.mjs';
import { typedHash, sha256 } from '../../protocol-core/src/p0.mjs';
import { designId } from '../../biology/src/canonical.mjs';
import { validateDesign } from '../../biology/src/evidence.mjs';
import { SettlementEngine } from '../../settlement/src/index.mjs';
import { OriginalityError, TASK_FAMILY, commitmentHash, encodeAdmission321, computeAdmissionH16,
  encodeBlueprint, decodeBlueprint, createOriginalityCoordinator } from '../src/index.mjs';
import { initialSeedSetId, encodeOpeningSnapshot176, openingSnapshotId } from '../src/index.mjs';
import { b, key, BASE, ALICE, BOB, CRANK, B0, W, D, coordinator, context, upload,
  opening, improved, makeCommit, compete, materializedRoot, finalize } from './fixtures.mjs';

const expectCode = (fn, code) => assert.throws(fn, error => error instanceof OriginalityError && error.code === code);

test('fixed family and H22 payload204 use author/design/future manufacture nonce/salt independently', () => {
  assert.equal(key(TASK_FAMILY), 'a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe');
  const values = { domain: BASE.domain, round: 7n, author: ALICE, design: b(2), manufactureOpId: nonceOpId(10n), salt: b(3) };
  const raw = new ByteWriter(204).raw(BASE.domain).raw(TASK_FAMILY).u32(1).u64(7n).raw(ALICE).raw(b(2)).raw(nonceOpId(10n)).raw(b(3)).finish();
  assert.equal(raw.length, 204); assert.deepEqual(commitmentHash(values), typedHash(22, raw));
  for (const changed of [{ author: BOB }, { design: b(9) }, { manufactureOpId: nonceOpId(11n) }, { salt: b(4) }, { round: 8n }])
    assert.notDeepEqual(commitmentHash({ ...values, ...changed }), commitmentHash(values));
});

test('FUNC2 H16 has exact321 payload /337 typed input and versions at precise offsets', () => {
  const report = validateDesign(improved());
  const value = { ...BASE, graphSHA: report.graphSHA, leafMapSHA: b(1), evidenceRef: b(2), evidenceKind: 1,
    target: 22, c_ppm: 2_000_000, q_ppm: report.q_ppm, taskApplicable: true, C: report.C,
    suite: 2, fixture: 1, load: 1, dutMask: 0x7fff, transcriptSHA: report.transcriptSHA, positiveBitmap: report.positiveBitmap };
  const bytes = encodeAdmission321(value);
  assert.equal(bytes.length, 321); assert.equal(bytes[192], 22); assert.equal(bytes[193], 1);
  assert.equal(bytes.readUInt32LE(211), 2); assert.equal(bytes.readUInt32LE(215), 1); assert.equal(bytes.readUInt32LE(219), 1);
  assert.deepEqual(computeAdmissionH16(value), typedHash(16, bytes));
  expectCode(() => encodeAdmission321({ ...value, suite: 1 }), 'ADMISSION_VERSION');
});

test('blueprint exact6530-byte E172 plus full descriptor map, no fake physical root ids', () => {
  const graph = improved(), bytes = encodeBlueprint({ graph });
  const decoded = decodeBlueprint(bytes);
  assert.equal(bytes.length, 6530); assert.equal(decoded.descriptorMapSHA.length, 32);
  assert.deepEqual(encodeBlueprint(decoded), bytes);
  assert.throws(() => decodeBlueprint(Buffer.concat([bytes, Buffer.from([0])])));
});

test('production opening genuinely verifies all sixteen prepublished graphs and seals at316', () => {
  const state = opening(), task = state.originality;
  assert.equal(task.knowledge.length, 16); assert.equal(task.seeds.size, 16);
  assert.equal(task.opening.initialBitmap, 0xffff); assert.equal(task.opening.sealed, true);
  assert.equal(task.best.C, 316n); assert.equal(task.opening.snapshot.best.C, 316n);
  assert.equal(task.opening.snapshot.cutoff, B0);
  assert.deepEqual(task.knowledge.map(entry => entry.C), [413n,394n,375n,347n,343n,341n,340n,336n,332n,330n,330n,328n,324n,320n,318n,316n]);
  assert.equal(SettlementEngine.fromSnapshot(state.settlement).snapshot().registry.roots.length, 0);
});

test('sixteen-seed set is canonical H7-sorted and snapshot retains exact176-byte wire', () => {
  const state = opening(), snapshot = state.originality.opening.snapshot;
  const rows = [...state.originality.seeds.values()].map(seed => ({ design: seed.design, C: seed.C }))
    .sort((a, b) => Buffer.compare(a.design, b.design));
  assert.deepEqual(initialSeedSetId(BASE.domain, rows), state.originality.initialSetId);
  const raw = encodeOpeningSnapshot176(snapshot);
  assert.equal(raw.length, 176); assert.equal(raw.readBigInt64LE(64), B0);
  assert.equal(raw.readBigUInt64LE(72), 16n); assert.equal(raw.readBigUInt64LE(112), 316n);
  assert.deepEqual(openingSnapshotId(BASE.domain, snapshot), snapshot.id);
  expectCode(() => initialSeedSetId(BASE.domain, [...rows].reverse()), 'INITIAL_SEED_ORDER');
});

test('input buffers cannot mutate stored seed identifiers or another initialized deployment state', () => {
  let state = coordinator.initialize({ compositionArtifacts: new Map(), compositionRoots: new Map(),
    settlement: new SettlementEngine({ rewardStart: B0 }).snapshot() });
  const uploaded = upload(state, encodeBlueprint({ graph: coordinator.initialGraphs()[0] }));
  const externalId = Buffer.from(uploaded.id);
  const saved = coordinator.registerSeed(uploaded.state, context(20n, CRANK, { artifactId: externalId }));
  externalId.fill(0xff);
  assert.deepEqual(saved.state.originality.knowledge[0].artifactId, uploaded.id);
  const first = coordinator.initialSetId(); first.fill(0xff);
  assert.notDeepEqual(coordinator.initialSetId(), first);
});

test('seed late/duplicate and opening incomplete/cursor failures cannot rewrite first disclosure', () => {
  const full = opening(), entry = full.originality.knowledge[0];
  expectCode(() => coordinator.registerSeed(full, context(B0, CRANK, { artifactId: entry.artifactId })), 'SEED_WINDOW');
  let state = coordinator.initialize({ compositionArtifacts: new Map(), compositionRoots: new Map(),
    settlement: new SettlementEngine({ rewardStart: B0 }).snapshot() });
  const g = coordinator.initialGraphs()[0], artifact = upload(state, encodeBlueprint({ graph: g })); state = artifact.state;
  state = coordinator.registerSeed(state, context(20n, CRANK, { artifactId: artifact.id })).state;
  const first = cloneProtocolState(state.originality.disclosures.get(key(designId(g))));
  state = coordinator.registerSeed(state, context(21n, ALICE, { artifactId: artifact.id })).state;
  assert.equal(state.originality.knowledge.length, 1);
  assert.deepEqual(state.originality.disclosures.get(key(designId(g))), first);
  expectCode(() => coordinator.sealOpeningStep(state, context(B0, CRANK, { expectedCursor: 0n, maxScan: 8 })), 'INITIAL_SEEDS_INCOMPLETE');
});

test('opening and settlement share the same immutable reward clock', () => {
  expectCode(() => coordinator.initialize({ settlement: new SettlementEngine({ rewardStart: B0 + 1n }).snapshot() }), 'REWARD_CLOCK_MISMATCH');
});

test('commit is24h only and a future callback cannot fake earlier time', () => {
  const state = opening();
  expectCode(() => makeCommit(state, { graph: improved(), now: B0 + W }), 'COMMIT_WINDOW_OR_PAUSED');
  expectCode(() => makeCommit(state, { graph: improved(), now: B0 - 1n }), 'TASK_CLOCK_ROLLBACK');
  const accepted = makeCommit(state, { graph: improved(), now: B0 + 1n });
  assert.equal(accepted.result.event, state.originality.eventSeq + 1n);
  expectCode(() => makeCommit(accepted.state, { graph: improved(), now: B0 }), 'TASK_CLOCK_ROLLBACK');
});

test('known production C324/C320 copies never obtain a first-discovery prize', () => {
  const committed = makeCommit(opening(), { graph: improved(true) });
  const admitted = compete(committed.state, committed);
  assert.equal(admitted.state.originality.knowledge.length, 17, 'a real independent copy is retained as evidence');
  assert.equal(admitted.state.originality.rounds.get(0n).candidates.length, 1);
  const finished = finalize(admitted.state);
  assert.equal(finished.result.winner, null); assert.equal(finished.state.originality.winners.size, 0);
});

test('historical non-production opening328: true C324 competes and records one immutable winner', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  const admitted = compete(committed.state, committed), finished = finalize(admitted.state);
  assert.equal(finished.state.originality.winners.size, 1);
  const winner = finished.state.originality.winners.get(key(finished.result.winner));
  assert.equal(winner.C, 324n); assert.deepEqual(winner.author, ALICE);
  assert.equal(finished.result.activation, null, 'manufacture alone is not a stake');
  expectCode(() => finalize(finished.state), 'ROUND_NOT_FINALIZABLE');
});

test('wrong salt/author/future nonce or mismatched callback mode cannot manufacture a candidate', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  const made = materializedRoot(committed.state, { graph: committed.graph, author: ALICE,
    opId: committed.manufactureOpId, competition: { commitId: committed.result.id, salt: b(0x99) } });
  const before = cloneProtocolState(made.state);
  expectCode(() => coordinator.admitManufactured(made.state, made.context), 'COMMIT_REVEAL');
  assert.deepEqual(made.state, before);
  const normal = materializedRoot(committed.state, { graph: committed.graph, author: ALICE, opId: committed.manufactureOpId });
  expectCode(() => coordinator.admitManufactured(normal.state, { ...normal.context,
    competition: { commitId: committed.result.id, salt: committed.salt } }), 'COMPETITION_FRAME_BINDING');
});

test('manufacture must first validate during middle24h and actual root timestamp/slot must match', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  expectCode(() => compete(committed.state, committed, { now: B0 + 2n * W }), 'CANDIDATE_WINDOW_OR_PAUSED');
  const made = materializedRoot(committed.state, { graph: committed.graph, opId: committed.manufactureOpId,
    competition: { commitId: committed.result.id, salt: committed.salt } });
  expectCode(() => coordinator.admitManufactured(made.state, { ...made.context, now: made.context.now + 1n }), 'MANUFACTURE_CLOCK_BINDING');
});

test('two equal-cost copies: earlier valid commit wins even when the other copy manufactures first', () => {
  let first = makeCommit(opening({ historical: true }), { graph: improved(), author: ALICE, now: B0 + 1n });
  const second = makeCommit(first.state, { graph: improved(), author: BOB, now: B0 + 2n });
  let state = compete(second.state, second, { now: B0 + W + 1n }).state;
  state = compete(state, first, { now: B0 + W + 2n }).state;
  const finished = finalize(state), winner = finished.state.originality.winners.get(key(finished.result.winner));
  assert.deepEqual(winner.author, ALICE);
  assert.equal(finished.state.originality.knowledge.length, 14);
});

test('same-hour stricter C320 beats C324; finalization never adds two K awards', () => {
  const first = makeCommit(opening({ historical: true }), { graph: improved(), author: ALICE, now: B0 + 1n });
  const second = makeCommit(first.state, { graph: improved(true), author: BOB, now: B0 + 2n });
  let state = compete(second.state, first, { now: B0 + W + 1n }).state;
  state = compete(state, second, { now: B0 + W + 2n }).state;
  const finished = finalize(state), winner = finished.state.originality.winners.get(key(finished.result.winner));
  assert.equal(winner.C, 320n); assert.deepEqual(winner.author, BOB);
  assert.equal(finished.state.originality.winners.size, 1);
  assert.equal(SettlementEngine.fromSnapshot(finished.state.settlement).snapshot().activations.size, 0);
});

test('formal disclosure before commitment prevents novelty even if manufacturing is better than old opening', () => {
  let state = opening({ historical: true });
  const uploaded = upload(state, encodeBlueprint({ graph: improved() }), 2, B0);
  state = coordinator.discloseBlueprint(uploaded.state, context(B0 + 1n, BOB, { artifactId: uploaded.id })).state;
  const committed = makeCommit(state, { graph: improved(), now: B0 + 2n });
  const admitted = compete(committed.state, committed);
  assert.equal(finalize(admitted.state).result.winner, null);
});

test('a real q1 BIO disclosure remains the first publication when the same graph later qualifies q2', () => {
  let state = opening({ historical: true });
  const weak = materializedRoot(state, { graph: improved(), author: BOB, now: B0 + 1n,
    challenge: 1_000_000, opId: nonceOpId(7n) });
  const disclosed = coordinator.admitManufactured(weak.state, weak.context);
  assert.equal(disclosed.result.knowledgeIndex, null);
  assert.equal(disclosed.state.originality.knowledge.length, 12);
  const committed = makeCommit(disclosed.state, { graph: improved(), now: B0 + 2n });
  const admitted = compete(committed.state, committed);
  assert.equal(finalize(admitted.state).result.winner, null);
});

test('later round knowledge cannot be backfilled into the previous cutoff', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  let state = compete(committed.state, committed).state;
  const cutoff = state.originality.rounds.get(0n).knowledgeEndCount;
  const made = materializedRoot(state, { graph: improved(true), author: BOB, now: D + 1n, opId: nonceOpId(12n) });
  state = coordinator.admitManufactured(made.state, made.context).state;
  assert.equal(state.originality.rounds.get(0n).knowledgeEndCount, cutoff);
  const finished = finalize(state, 0n, D + 1n);
  assert.equal(finished.state.originality.winners.get(key(finished.result.winner)).C, 324n);
  assert.equal(finished.result.activation, null, 'historical winner is already outranked by true current320');
});

test('author sale before finalization retains original winner and does not promote the runner-up', () => {
  const first = makeCommit(opening({ historical: true }), { graph: improved(), author: ALICE, now: B0 + 1n });
  const second = makeCommit(first.state, { graph: improved(), author: BOB, now: B0 + 2n });
  let result = compete(second.state, second, { now: B0 + W + 1n });
  result = compete(result.state, first, { now: B0 + W + 2n });
  const engine = SettlementEngine.fromSnapshot(result.state.settlement);
  engine.executePrepared('transfer', { actor: key(ALICE), now: B0 + W + 3n,
    instance: key(result.root.instance), newOwner: key(BOB) });
  result.state.settlement = engine.snapshot();
  const finished = finalize(result.state), winner = finished.state.originality.winners.get(key(finished.result.winner));
  assert.deepEqual(winner.author, ALICE); assert.equal(finished.result.activation, null);
  expectCode(() => coordinator.activateWinner(finished.state, context(D + 1n, BOB, { winnerId: winner.id })), 'WINNER_NOT_CURRENT');
});

test('winner can stake original root later and activate K only at a future full hour', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  const finished = finalize(compete(committed.state, committed).state), state = finished.state;
  const winner = state.originality.winners.get(key(finished.result.winner));
  let engine = SettlementEngine.fromSnapshot(state.settlement);
  const normal = engine.executePrepared('register', { actor: key(ALICE), now: D, instance: key(winner.root) });
  state.settlement = engine.snapshot();
  const active = coordinator.activateWinner(state, context(D, ALICE, { winnerId: winner.id }));
  engine = SettlementEngine.fromSnapshot(active.state.settlement);
  const activation = [...engine.snapshot().activations.values()][0];
  assert.equal(activation.start, 73n); assert.equal(normal.start, 73n);
  assert.equal(engine.snapshot().activations.size, 1);
  assert.throws(() => coordinator.activateWinner(active.state, context(D, ALICE, { winnerId: winner.id })));
});

test('author EXIT stops its K via the actual settlement interface and records one task event', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  const admitted = compete(committed.state, committed);
  let engine = SettlementEngine.fromSnapshot(admitted.state.settlement);
  engine.executePrepared('register', { actor: key(ALICE), now: B0 + W + 1n, instance: key(admitted.root.instance) });
  admitted.state.settlement = engine.snapshot();
  const finished = finalize(admitted.state), previousEvent = finished.state.originality.eventSeq;
  const previousGeneration = finished.state.originality.generation;
  const ctx = context(D + 3600n, ALICE, { rootId: admitted.root.instance, seq: 0n });
  const exited = coordinator.exitStake(finished.state, ctx);
  engine = SettlementEngine.fromSnapshot(exited.state.settlement);
  assert.equal([...engine.snapshot().activations.values()][0].end, 74n);
  assert.equal(exited.state.originality.eventSeq, previousEvent + 1n);
  assert.equal(exited.state.originality.generation, previousGeneration + 1n);
  const replayed = coordinator.exitStake(exited.state, ctx);
  assert.equal(replayed.state.originality.eventSeq, exited.state.originality.eventSeq);
});

test('bounded finalization cursor and phase cannot skip knowledge or advance out of order', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  const state = compete(committed.state, committed).state;
  expectCode(() => coordinator.finalizeStep(state, context(D, CRANK, { round: 0n, maxScan: 8,
    expectedPhase: 'OPEN', expectedCandidateCursor: 0n, expectedKnowledgeCursor: 1n })), 'ROUND_CURSOR');
  expectCode(() => coordinator.finalizeStep(state, context(D, CRANK, { round: 1n, maxScan: 8,
    expectedPhase: 'ABSENT', expectedCandidateCursor: 0n, expectedKnowledgeCursor: 0n })), 'ROUND_NOT_FINALIZABLE');
});

test('a genuine matching stored seed cannot be paused by a client claim', () => {
  const state = opening(), before = cloneProtocolState(state);
  expectCode(() => coordinator.proveFault(state, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n })), 'SAFETY_NOT_A_FAULT');
  assert.deepEqual(state, before);
});

test('finite wrong knowledge-link proof pauses once, appends one correction, and preserves good root eligibility', () => {
  const state = opening();
  state.originality.knowledge[0].C = 1n; // explicit accepted-storage bug fixture
  const proof = coordinator.proveFault(state, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n }));
  assert.equal(proof.result.faultType, 1); assert.equal(proof.result.correctedIndex, 16n);
  assert.equal(proof.state.originality.knowledge.length, 17);
  assert.equal(proof.state.originality.knowledge[0].validity, 'FAULT_INVALID');
  assert.equal(proof.state.originality.paused, true);
  assert.equal(SettlementEngine.fromSnapshot(proof.state.settlement).snapshot().taskPaused, true);
  expectCode(() => coordinator.proveFault(proof.state, context(B0, BOB, { knowledgeIndex: 0n, expectedEpoch: 1n })), 'SAFETY_ALREADY_INVALID_OR_MISSING');
  expectCode(() => makeCommit(proof.state, { graph: improved() }), 'COMMIT_WINDOW_OR_PAUSED');
});

test('knowledge disclosure metadata cannot invent an earlier event or point to another design', () => {
  for (const mutate of [entry => { entry.firstDisclosure = 0n; }, entry => { entry.disclosureId = b(0xfa); }]) {
    const state = opening(), first = state.originality.knowledge[0];
    const original = cloneProtocolState(first); mutate(first);
    const proof = coordinator.proveFault(state, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n }));
    assert.equal(proof.result.faultType, 1);
    const corrected = proof.state.originality.knowledge[Number(proof.result.correctedIndex)];
    assert.equal(corrected.firstDisclosure, original.firstDisclosure);
    assert.deepEqual(corrected.disclosureId, original.disclosureId);
    assert.equal(proof.state.originality.knowledge[0].validity, 'FAULT_INVALID');
  }
  const missing = opening(), first = missing.originality.knowledge[0];
  missing.originality.disclosures.delete(key(first.design));
  expectCode(() => coordinator.proveFault(missing, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n })), 'SAFETY_REPLAY_UNKNOWN');
});

test('late cross-round repairs retain historical origins, including a repaired correction, and invalidate a false old winner', () => {
  let state = opening();
  // Explicit accepted-storage bug fixture: the three cheapest opening rows
  // contain the wrong linked cost. Actual seed artifacts/reports stay intact.
  for (const i of [13, 14, 15]) state.originality.knowledge[i].C = 999n;
  const graph = improved(true); graph.tiers[0].mode = 1 - graph.tiers[0].mode;
  assert.equal(validateDesign(graph).C, 320n);
  assert.ok(!state.originality.disclosures.has(key(designId(graph))));
  const commit = makeCommit(state, { graph }); state = compete(commit.state, commit).state;
  // Interrupt a real partial old-round scan, then repair in the following round.
  state = coordinator.finalizeStep(state, context(D, CRANK, { round: 0n, maxScan: 8,
    expectedPhase: 'OPEN', expectedCandidateCursor: 0n, expectedKnowledgeCursor: 0n })).state;
  const beforeCutoff = state.originality.rounds.get(0n).knowledgeEndCount;
  state = coordinator.proveFault(state, context(D + 1n, ALICE, { knowledgeIndex: 13n, expectedEpoch: 0n })).state;
  let proof = [...state.originality.safeties.values()].at(-1);
  assert.equal(proof.originKnowledgeIndex, 13n);
  const correction = proof.correctedIndex; state.originality.knowledge[Number(correction)].C = 998n;
  state = coordinator.proveFault(state, context(D + 1n, ALICE, { knowledgeIndex: correction, expectedEpoch: 1n })).state;
  assert.equal([...state.originality.safeties.values()].at(-1).originKnowledgeIndex, 13n);
  for (const [i, epoch] of [[14n, 2n], [15n, 3n]]) state = coordinator.proveFault(state,
    context(D + 1n, ALICE, { knowledgeIndex: i, expectedEpoch: epoch })).state;
  const count = BigInt(state.originality.knowledge.length);
  for (let cursor = 0n; cursor < count; cursor++) state = coordinator.auditNext(state,
    context(D + 1n, CRANK, { expectedEpoch: 4n, expectedCursor: cursor })).state;
  state = coordinator.recoverTask(state, context(D + 1n, ALICE, { expectedEpoch: 4n, expectedKnowledgeCount: count })).state;
  const finished = finalize(state, 0n, D + 2n);
  assert.equal(finished.result.knowledgeEndCount, beforeCutoff);
  assert.equal(finished.result.scanKnowledgeCount, count);
  assert.equal(finished.result.baseline.C, 316n);
  assert.equal(finished.result.winner, null);
});

test('wrong identity correction uses the real H8 and cannot borrow the old identity historical position',()=>{
  for(const fresh of [false,true]){
    const state=opening(),entry=state.originality.knowledge[0],original=cloneProtocolState(entry);
    entry.design=b(0xfa);entry.disclosureId=b(0xfb); // explicit accepted-storage bug fixture
    if(fresh)state.originality.disclosures.delete(key(original.design));
    const fixed=coordinator.proveFault(state,context(D+1n,ALICE,{knowledgeIndex:0n,expectedEpoch:0n}));
    const proof=fixed.result,corrected=fixed.state.originality.knowledge[Number(proof.correctedIndex)];
    assert.equal(proof.originKnowledgeIndex,proof.correctedIndex);
    assert.deepEqual(corrected.design,original.design);assert.deepEqual(corrected.disclosureId,original.disclosureId);
    assert.equal(corrected.qualifiedTime,D+1n);
    if(fresh)assert.ok(corrected.firstDisclosure>original.qualifiedEvent);
    else assert.equal(corrected.firstDisclosure,original.firstDisclosure);
  }
});

test('a later new manufactured design with earlier free disclosure cannot enter the old deadline prefix', () => {
  let state = opening({ historical: true });
  // This is the explicit historical twelve-seed deployment fixture. A free
  // public blueprint is not manufactured qualified knowledge at the deadline.
  const uploaded = upload(state, encodeBlueprint({ graph: improved(true) }), 2, B0 + 1n);
  state = coordinator.discloseBlueprint(uploaded.state, context(B0 + 1n, CRANK, { artifactId: uploaded.id })).state;
  const commit = makeCommit(state, { graph: improved(), now: B0 + 2n }); state = compete(commit.state, commit).state;
  const cutoff = state.originality.rounds.get(0n).knowledgeEndCount;
  const late = materializedRoot(state, { graph: improved(true), author: BOB, now: D + 1n });
  state = coordinator.admitManufactured(late.state, late.context).state;
  const finished = finalize(state, 0n, D + 2n);
  assert.ok(finished.result.winner);
  const winner = finished.state.originality.winners.get(key(finished.result.winner));
  assert.equal(winner.C, 324n); assert.equal(finished.result.knowledgeEndCount, cutoff);
  assert.equal(finished.result.activation, null); // New global frontier320 beats324, so no new K.
});

test('complete safety prefix audit recovers316 by CAS, without auto K or changing old history', () => {
  let state = opening(); state.originality.knowledge[0].C = 1n;
  state = coordinator.proveFault(state, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n })).state;
  const count = BigInt(state.originality.knowledge.length);
  expectCode(() => coordinator.recoverTask(state, context(B0, ALICE, { expectedEpoch: 1n, expectedKnowledgeCount: count })), 'SAFETY_NOT_READY_OR_TAIL_CHANGED');
  for (let cursor = 0n; cursor < count; cursor += 1n) state = coordinator.auditNext(state, context(B0, CRANK, { expectedEpoch: 1n, expectedCursor: cursor })).state;
  state = coordinator.recoverTask(state, context(B0, ALICE, { expectedEpoch: 1n, expectedKnowledgeCount: count })).state;
  assert.equal(state.originality.paused, false); assert.equal(state.originality.best.C, 316n);
  assert.equal([...state.originality.safeties.values()][0].state, 'RECOVERED');
  assert.equal(SettlementEngine.fromSnapshot(state.settlement).snapshot().activations.size, 0);
});

test('unknown/missing evidence does not become a fault or arbitrary administrator pause', () => {
  const state = opening(), first = state.originality.knowledge[0];
  state.compositionArtifacts.delete(key(first.artifactId));
  const before = cloneProtocolState(state);
  expectCode(() => coordinator.proveFault(state, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n })), 'SAFETY_REPLAY_UNKNOWN');
  assert.deepEqual(state, before);
});

test('safety tail growth blocks recovery until the new actual evidence has also been audited', () => {
  let state = opening(); state.originality.knowledge[0].C = 1n;
  state = coordinator.proveFault(state, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n })).state;
  const originalCount = BigInt(state.originality.knowledge.length);
  for (let cursor = 0n; cursor < originalCount; cursor += 1n) state = coordinator.auditNext(state, context(B0, CRANK, { expectedEpoch: 1n, expectedCursor: cursor })).state;
  const made = materializedRoot(state, { graph: improved(true), author: BOB, now: B0 + 1n });
  state = coordinator.admitManufactured(made.state, made.context).state;
  expectCode(() => coordinator.recoverTask(state, context(B0 + 1n, ALICE, { expectedEpoch: 1n,
    expectedKnowledgeCount: originalCount })), 'SAFETY_NOT_READY_OR_TAIL_CHANGED');
  state = coordinator.auditNext(state, context(B0 + 1n, CRANK, { expectedEpoch: 1n, expectedCursor: originalCount })).state;
  state = coordinator.auditNext(state, context(B0 + 1n, CRANK, { expectedEpoch: 1n, expectedCursor: originalCount })).state;
  state = coordinator.recoverTask(state, context(B0 + 1n, ALICE, { expectedEpoch: 1n,
    expectedKnowledgeCount: originalCount + 1n })).state;
  assert.equal(state.originality.best.C, 316n);
});

test('same-hour better normal PASS cancels newly pending K without creating another winner or changing ordinary stake', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  let admitted = compete(committed.state, committed);
  let engine = SettlementEngine.fromSnapshot(admitted.state.settlement);
  const position = engine.executePrepared('register', { actor: key(ALICE), now: B0 + W + 1n, instance: key(admitted.root.instance) });
  admitted.state.settlement = engine.snapshot();
  let finished = finalize(admitted.state);
  engine = SettlementEngine.fromSnapshot(finished.state.settlement);
  assert.equal(engine.snapshot().activations.size, 1);
  const better = materializedRoot(finished.state, { graph: improved(true), author: BOB, now: D + 1n, opId: nonceOpId(7n) });
  const newer = coordinator.admitManufactured(better.state, better.context);
  engine = SettlementEngine.fromSnapshot(newer.state.settlement);
  const activation = [...engine.snapshot().activations.values()][0];
  assert.equal(activation.start, 73n); assert.equal(activation.end, 73n);
  assert.equal(engine.position(position.intervalId).end, null);
  assert.equal(newer.state.originality.winners.size, 1);
  assert.equal(newer.state.originality.best.C, 320n);
});

test('an independent equal-cost copy earns no new K and does not stop the existing winner K', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  const admitted = compete(committed.state, committed);
  let engine = SettlementEngine.fromSnapshot(admitted.state.settlement);
  engine.executePrepared('register', { actor: key(ALICE), now: B0 + W + 1n, instance: key(admitted.root.instance) });
  admitted.state.settlement = engine.snapshot();
  const finished = finalize(admitted.state), generation = finished.state.originality.generation;
  const copy = materializedRoot(finished.state, { graph: improved(), author: BOB, now: D + 1n, opId: nonceOpId(9n) });
  const state = coordinator.admitManufactured(copy.state, copy.context).state;
  engine = SettlementEngine.fromSnapshot(state.settlement);
  assert.equal(engine.snapshot().activations.size, 1);
  assert.equal([...engine.snapshot().activations.values()][0].end, null);
  assert.equal(state.originality.generation, generation);
  engine.executePrepared('register', { actor: key(BOB), now: D + 1n, instance: key(copy.root.instance) });
  assert.equal(engine.snapshot().registry.roots.length, 2);
});

test('bad stored root admission proves finite fault, stops future K and keeps earned Position debt intact', () => {
  const committed = makeCommit(opening({ historical: true }), { graph: improved() });
  const admitted = compete(committed.state, committed);
  let engine = SettlementEngine.fromSnapshot(admitted.state.settlement);
  const registration = engine.executePrepared('register', { actor: key(ALICE), now: B0 + W + 1n, instance: key(admitted.root.instance) });
  admitted.state.settlement = engine.snapshot();
  const finished = finalize(admitted.state); let state = finished.state;
  engine = SettlementEngine.fromSnapshot(state.settlement);
  const now = B0 + 74n * 3600n;
  for (let h = 24n; h < 74n; h += 1n) {
    engine.executePrepared('openHour', { actor: key(CRANK), now, hour: h });
    while (['K_SCAN', 'ROOT_SCAN'].includes(engine.hour(h).status)) {
      const s = engine.snapshot(), r = engine.hour(h);
      engine.executePrepared('scanHour', { actor: key(CRANK), now, hour: h, expectedPhase: r.status,
        expectedCursor: r.status === 'K_SCAN' ? s.registry.kScanSeq : r.rootCursor, workCount: 1 });
    }
    engine.executePrepared('materializeHour', { actor: key(CRANK), now, hour: h, expectedCursor: 0n, rootCount: 1 });
  }
  const accrued = engine.position(registration.intervalId).accrued;
  state.settlement = engine.snapshot();
  state.compositionRoots.get(key(admitted.root.instance)).admission = b(0xee); // stored admission bug fixture
  state = coordinator.proveFault(state, context(now, BOB, { knowledgeIndex: 12n, expectedEpoch: 0n })).state;
  engine = SettlementEngine.fromSnapshot(state.settlement);
  const reg = engine.snapshot().registrations.get(key(admitted.root.instance));
  assert.equal(reg.certificateFault, true);
  assert.equal([...engine.snapshot().activations.values()][0].end, 75n);
  assert.equal(engine.position(registration.intervalId).accrued, accrued);
  engine.executePrepared('claimPosition', { actor: key(CRANK), now, intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: accrued, destinationOwner: key(ALICE) });
  assert.equal(engine.balance(key(ALICE)), accrued);
  const count = BigInt(state.originality.knowledge.length);
  for (let cursor = 0n; cursor < count; cursor += 1n) state = coordinator.auditNext(state,
    context(now, CRANK, { expectedEpoch: 1n, expectedCursor: cursor })).state;
  state = coordinator.recoverTask(state, context(now, CRANK, { expectedEpoch: 1n, expectedKnowledgeCount: count })).state;
  assert.equal(state.originality.best.C, 324n);
  assert.equal(SettlementEngine.fromSnapshot(state.settlement).snapshot().registrations.get(key(admitted.root.instance)).certificateFault, true);
});

test('audit cannot silently skip another deterministic mismatch; a second bounded fault increments epoch', () => {
  let state = opening(); state.originality.knowledge[0].C = 1n; state.originality.knowledge[1].C = 2n;
  state = coordinator.proveFault(state, context(B0, ALICE, { knowledgeIndex: 0n, expectedEpoch: 0n })).state;
  state = coordinator.auditNext(state, context(B0, CRANK, { expectedEpoch: 1n, expectedCursor: 0n })).state;
  const before = cloneProtocolState(state);
  expectCode(() => coordinator.auditNext(state, context(B0, CRANK, { expectedEpoch: 1n, expectedCursor: 1n })), 'AUDIT_NEW_FAULT');
  assert.deepEqual(state, before);
  state = coordinator.proveFault(state, context(B0, BOB, { knowledgeIndex: 1n, expectedEpoch: 1n })).state;
  assert.equal(state.originality.safetyEpoch, 2n);
  assert.equal([...state.originality.safeties.values()][1].cursor, 0n);
});
