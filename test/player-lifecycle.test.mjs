import test from 'node:test';
import assert from 'node:assert/strict';
import { ByteWriter, businessKey, encodeExactFrame, executeAtomic, nonceOpId, sha256,
  catalogHash, encodeMaterialPlan, inventoryTotals, cloneProtocolState } from '../packages/protocol-core/src/index.mjs';
import { applyLaunchpad, encodeCreatePayload, encodeBuyPayload, CREATE_FEE, RESOURCE_FEE_PER_UNIT } from '../packages/launchpad/src/index.mjs';
import { createCompositionCoordinator, descriptorBytes, putArtifact, sealArtifact, artifactId, synthesisFee } from '../packages/composition/src/index.mjs';
import { createOriginalityCoordinator, encodeBlueprint } from '../packages/originality/src/index.mjs';
import { createImprovement, projectGraph, validateDesign, designId } from '../packages/biology/src/index.mjs';
import { SettlementEngine, H_END } from '../packages/settlement/src/index.mjs';
import { planComponentMaterials } from '../packages/client/src/index.mjs';
import { fixture, bytes, DOMAIN, CONFIG, OWNER as CREATOR, BUYER, SELLER, key } from '../packages/launchpad/test/fixtures.mjs';

// These are explicitly local System/PDA/rent fixtures. Functional verification,
// all material transitions and all reward arithmetic below use real modules.
// Native signature/CPI/compute acceptance is separately tested by the Rust ELF.
const base = { domain: DOMAIN, config: CONFIG, catalog: catalogHash(), rule: bytes(0x72),
  validatorHash: bytes(0x73), labMint: bytes(0x74) };
const REWARD_START = 3_600n, LAB_TOKEN = bytes(0x75);
const at = h => REWARD_START + BigInt(h) * 3_600n;
const replace = (target, value) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, value); };

function upload(state, payload, actor, payloadSchema, now) {
  const meta = { domain: DOMAIN, config: CONFIG, actor, payloadSchema,
    totalLength: payload.length, payloadSHA: sha256(payload) };
  let next = state, seq = 0n;
  for (let offset = 0; offset < payload.length; offset += 1024) {
    next = putArtifact(next, { ...meta, offset, expectedSeq: seq++, chunk: payload.subarray(offset, offset + 1024) }).state;
  }
  const id = artifactId(meta);
  return { state: sealArtifact(next, { artifactId: id, actor, expectedSeq: seq, now, slot: 2n }).state, id };
}

function settle(engine, hour, now) {
  const run = (op, args) => engine.executePrepared(op, { actor: 'permissionless-crank', now, ...args });
  run('openHour', { hour });
  let steps = 0;
  while (['ROOT_SCAN', 'K_SCAN'].includes(engine.hour(hour).status)) {
    const h = engine.hour(hour), snapshot = engine.snapshot();
    run('scanHour', { hour, expectedPhase: h.status,
      expectedCursor: h.status === 'K_SCAN' ? snapshot.registry.kScanSeq : h.rootCursor,
      workCount: hour < 338n && h.status === 'ROOT_SCAN' ? Math.min(8, Number(h.rootCutoff - h.rootCursor)) : 1 });
    assert.ok(++steps < 1000, 'hour scan must make bounded progress');
  }
  const balanceBefore = engine.ledger();
  run('advanceFrozenHour', { hour });
  assert.deepEqual(engine.ledger(), balanceBefore, 'freeze frontier cannot allocate or seal pending funds');
  const eligible = [...engine.snapshot().intervals.values()].filter(p => p.start <= hour && hour < (p.end ?? H_END)).reverse();
  if (eligible.length === 0) run('materializePosition', { hour, expectedCursor: 0n, intervalId: null });
  for (const p of eligible) run('materializePosition', { hour, expectedCursor: engine.hour(hour).materializeCursor, intervalId: p.id });
  assert.equal(engine.hour(hour).status, 'FINAL');
}

function launchAndBuy() {
  const f = fixture(); let state = f.state;
  const ctx = f.context;
  const makeFrame = (module, actor, nonce, payload) => encodeExactFrame({ module, opcode: 1,
    domain: DOMAIN, configId: CONFIG, actor, opId: nonceOpId(nonce), payload });
  const create = makeFrame(201, CREATOR, 0n, encodeCreatePayload({ catalogHash: catalogHash(),
    saleRecipient: SELLER, principalPayer: CREATOR, rentPayer: CREATOR,
    maxProtocolLamports: CREATE_FEE, maxRentLamports: 100_000_000n, name: 'Player Lab',
    classes: [1, 2, 3, 4].map(c => ({ class: c, lifetimeCap: 1000n, priceLamports: 500_000n })) }));
  state = applyLaunchpad(state, create, ctx).state;
  const [projectKey, project] = [...state.projects][0];
  const projectId = Buffer.from(projectKey, 'hex');
  const quantities = [30n, 60n, 15n, 15n], before = cloneProtocolState(state);
  for (let c = 1; c <= 4; c++) {
    const p = project.classes[c - 1];
    const frame = makeFrame(202, BUYER, BigInt(c - 1), encodeBuyPayload({
      projectId, class: c, mint: p.mint, catalogHash: catalogHash(), quantity: quantities[c - 1],
      principalPayer: BUYER, materialRecipient: BUYER, destinationToken: ctx.deriveAtaAddress(p.mint, BUYER),
      destinationMode: 1, saleRecipient: SELLER, unitPriceLamports: p.priceLamports,
      resourcePerUnitLamports: RESOURCE_FEE_PER_UNIT, maxProtocolLamports: 100_000_000n,
      rentPayer: BUYER, maxRentLamports: 100_000_000n, expectedSeason: 0 }));
    state = applyLaunchpad(state, frame, ctx).state;
  }
  assert.equal(state.lamports.get(key(SELLER)) - before.lamports.get(key(SELLER)), 60_000_000n);
  assert.equal(state.lamports.get(key(ctx.opsAddress)) - before.lamports.get(key(ctx.opsAddress)), 12_000_000n);
  assert.deepEqual(project.classes.map(c => c.issued), [0n, 0n, 0n, 0n], 'old snapshot is detached');
  assert.deepEqual(state.projects.get(projectKey).classes.map(c => c.issued), quantities);
  assert.equal(state.sources.size, 0, 'buying raw units does not create a Source or mining asset');
  return { state, projectKey, context: ctx };
}

test('real model lifecycle: sale → four materials →60 parts→15 cells→6 organs→C320 BIO→ECON4 lazy continuous LAB', () => {
  const launched = launchAndBuy(); let state = launched.state;
  state.labTokens = new Map([[key(LAB_TOKEN), { mint: base.labMint, owner: BUYER,
    amount: 0n, initialized: true, native: false, frozen: false }]]);
  const novelty = createOriginalityCoordinator({ ...base, rewardStart: REWARD_START });
  const composition = createCompositionCoordinator(base, {
    verifyFunction: validateDesign, semanticDesign: designId,
    admitKnowledge(draft, root, _report, context) {
      const admitted = novelty.admitManufactured(draft, { ...context, rootId: root.instance });
      replace(draft, admitted.state);
    },
  });
  state = novelty.initialize(composition.initialState(state, { rewardStart: REWARD_START }));
  for (const graph of novelty.initialGraphs()) {
    const sent = upload(state, encodeBlueprint({ graph }), CREATOR, 2, 0n); state = sent.state;
    state = novelty.registerSeed(state, { actor: CREATOR, now: 0n, slot: 2n,
      authorizedActors: new Set([key(CREATOR)]), artifactId: sent.id }).state;
  }
  assert.equal(state.originality.best.C, 316n);

  const authorizedActors = new Set([key(BUYER)]), components = [];
  const transact = (module, payload, now) => {
    const nonce = state.actorNonces.get(`${key(DOMAIN)}:${key(BUYER)}`)?.nextNonce ?? 0n;
    const frameBytes = encodeExactFrame({ module, opcode: 1, domain: DOMAIN, configId: CONFIG,
      actor: BUYER, opId: nonceOpId(nonce), payload });
    const result = executeAtomic(state, frameBytes, { expectedDomain: DOMAIN, authorizedActors }, draft => {
      const context = { frameBytes, authorizedActors, authorizedOwners: authorizedActors,
        createdAt: now, createdSlot: 1000n, actualRentLamports: 0n, rootBump: 255 };
      const made = module === 501 ? composition.manufactureComponent(draft, context) : composition.synthesize(draft, context);
      replace(draft, made.state);
      // The integration harness caches the instance only; native adapters use
      // their exact result codec and real account rent/nonce initialization.
      return made.root.instance;
    });
    state = result.state;
    return { id: result.resultBytes, frameBytes };
  };
  for (let role = 1; role <= 15; role++) {
    const inputs = [];
    for (let primitive = 1; primitive <= 4; primitive++) {
      const nonce = state.actorNonces.get(`${key(DOMAIN)}:${key(BUYER)}`).nextNonce;
      const business = businessKey(DOMAIN, BUYER, nonceOpId(nonce));
      const plan = planComponentMaterials(state, { domain: DOMAIN, business, owner: BUYER });
      const payload = new ByteWriter(3116).raw(descriptorBytes({ primitive, profile: primitive === 4 ? role : 0 }))
        .raw(BUYER).u64(0n).raw(encodeMaterialPlan(plan)).finish();
      inputs.push(transact(501, payload, 0n).id);
    }
    components.push(inputs);
  }
  assert.deepEqual(state.projects.get(launched.projectKey).classes.map(c => c.intakeBurned), [30n, 60n, 15n, 15n]);
  assert.ok([...state.tokens.values()].every(t => t.amount === 0n));
  assert.ok([...state.mints.values()].every(m => m.supply === 0n));
  assert.equal(inventoryTotals(state.sources).totalTick, 300_000n);
  assert.equal(inventoryTotals(state.sources).creditInt, 4_500_000n, '300 species units of unspent NUC are4500 RU, not300 RU');
  assert.equal(state.compositionRoots.size, 60);

  let engine = SettlementEngine.fromSnapshot(state.settlement);
  const positions = components.flat().map(id => engine.executePrepared('register', {
    actor: key(BUYER), now: 0n, instance: key(id) }).intervalId);
  state.settlement = engine.snapshot();
  while (!state.originality.opening.sealed) state = novelty.sealOpeningStep(state, {
    actor: CREATOR, now: REWARD_START, slot: 3n, authorizedActors: new Set([key(CREATOR)]),
    expectedCursor: state.originality.opening.cursor, maxScan: 8 }).state;
  engine = SettlementEngine.fromSnapshot(state.settlement);
  for (let h = 0n; h < 337n; h++) settle(engine, h, at(337));
  for (const id of components.flat()) engine.executePrepared('exit', { actor: key(BUYER),
    now: at(337), instance: key(id), seq: 0n });
  settle(engine, 337n, at(338));
  for (const intervalId of positions) engine.executePrepared('claimPosition', { actor: key(BUYER),
    now: at(338), intervalId, expectedPaid: 0n, upToAccrued: engine.position(intervalId).accrued,
    destinationOwner: key(BUYER) });
  assert.equal(engine.balance(key(BUYER)), 48_225_840n, 'manufacturing fees are actually earned, not prefunded');
  state.settlement = engine.snapshot(); state.labTokens.get(key(LAB_TOKEN)).amount = engine.balance(key(BUYER));
  const fullGraph = createImprovement(base);
  const makeParent = (target, inputIds) => {
    const graph = projectGraph(fullGraph, target);
    const bytes = composition.prepareSynthesisPayload(state, { graph, inputIds });
    const sent = upload(state, bytes, BUYER, 1, at(338)); state = sent.state;
    const fee = synthesisFee(BigInt(inputIds.reduce((n, id) => n + Number(state.compositionRoots.get(key(id)).B_int), 0)), target);
    const payload = new ByteWriter(185).raw(sent.id).raw(sha256(bytes)).u32(bytes.length).u32(2_000_000)
      .raw(BUYER).raw(LAB_TOKEN).u64(fee).raw(BUYER).u64(0n).u8(0).finish();
    const made = transact(702, payload, at(338));
    const root = state.compositionRoots.get(key(made.id));
    assert.equal(root.suiteVersion, 2); assert.ok(root.admission?.length === 32);
    assert.equal(root.q_ppm, [3, 9, 14, 15, 21].includes(target) ? 1_000_000n : 2_000_000n);
    return made;
  };
  const cells = components.map((ids, n) => makeParent(n + 1, ids).id);
  const groups = [[0, 1], [2, 3, 4], [5, 6, 7, 8], [9, 10], [11, 12], [13, 14]];
  const organs = groups.map((group, n) => makeParent(16 + n, group.map(role => cells[role])).id);
  const final = makeParent(22, organs), finalRoot = state.compositionRoots.get(key(final.id));
  assert.equal(finalRoot.leaves.length, 60); assert.equal(finalRoot.B_int, 7_200_000n);
  assert.equal(finalRoot.retired_B_int, 2_700_000n);
  assert.equal(finalRoot.wireBytes.readBigUInt64LE(719), 320n);
  assert.equal(state.originality.knowledge.length, 17);
  assert.equal(state.originality.winners.size, 0, 'public C320 earns ordinary mining, never novelty K');
  assert.equal(state.compositionRoots.size, 82);
  engine = SettlementEngine.fromSnapshot(state.settlement);
  assert.equal(engine.ledger().manufactureBurned, 48_000_000n);
  assert.equal(state.labTokens.get(key(LAB_TOKEN)).amount, 225_840n);
  const oldIds = [...components.flat(), ...cells, ...organs];
  for (const id of oldIds) {
    assert.equal(engine.root(key(id)).status, 'CONSUMED');
    assert.throws(() => engine.executePrepared('register', { actor: key(BUYER), now: at(338), instance: key(id) }));
  }
  const snapshot = cloneProtocolState(state);
  const replay = executeAtomic(state, final.frameBytes, { expectedDomain: DOMAIN, authorizedActors }, () => assert.fail('latest retry reran synthesis'));
  assert.equal(replay.replayed, true); assert.deepEqual(replay.state, snapshot);
  const registration = engine.executePrepared('register', { actor: key(BUYER), now: at(338), instance: key(final.id) });
  assert.equal(registration.start, 339n);
  settle(engine, 338n, at(339)); settle(engine, 339n, at(340));
  assert.equal(engine.hour(339n).members, 1n);
  assert.equal(engine.position(registration.intervalId).accrued, 470_890n);
  assert.equal(engine.ledger().total, 100_000_000_000_000n);
  assert.equal(engine.snapshot().registry.kHistory.length, 0);
  const paid = engine.executePrepared('claimPosition', { actor: key(BUYER), now: at(340),
    intervalId: registration.intervalId, expectedPaid: 0n, upToAccrued: 470_890n, destinationOwner: key(BUYER) });
  assert.equal(paid.amount, 470_890n);
  assert.throws(() => engine.executePrepared('claimPosition', { actor: key(BUYER), now: at(340),
    intervalId: registration.intervalId, expectedPaid: 0n, upToAccrued: 470_890n, destinationOwner: key(BUYER) }));
  assert.equal(engine.position(registration.intervalId).paid, 470_890n);
});
