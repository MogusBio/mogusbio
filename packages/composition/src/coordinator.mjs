import { ByteReader, ByteWriter, asBytes, equalBytes, integer, I64_MAX, U64_MAX } from '../../protocol-core/src/codec.mjs';
import { cloneProtocolState } from '../../protocol-core/src/atomic.mjs';
import { businessKey, instanceId, decodeExactFrame, encodeRecord, decodeRecord, requestHash, sha256 } from '../../protocol-core/src/p0.mjs';
import { prepareMaterialConsumption } from '../../protocol-core/src/inventory.mjs';
import { catalogHash, decodeMaterialPlan, encodeDebitPlan, decodeDebitPlan, speciesCreditInt, F1_BOM, F1_EFFECTIVE_SPECIES } from '../../protocol-core/src/materials.mjs';
import { encodeGraph, validateGraph, assertChildUnchanged, ORGAN_CELLS, members, DYNAMIC } from '../../biology/src/graph.mjs';
import { SettlementEngine } from '../../settlement/src/engine.mjs';
import { requireComposition, readSealedArtifact, hex32 } from './artifact.mjs';
import { descriptorBytes, decodeDescriptor, encodeLeafMap, encodeSynthesisPayload, decodeSynthesisPayload, validateSourceUnion } from './payload.mjs';
import { computeAdmissionH16 } from '../../originality/src/wire.mjs';

const zero = () => Buffer.alloc(32);
const scopeName = target => target <= 15 ? 'CELL' : target <= 21 ? 'ORGAN' : 'BIO';
const feeRate = target => target <= 15 ? 200_000n : target <= 21 ? 400_000n : 200_000n;
export const synthesisFee = (B_int, target) => {
  requireComposition(typeof B_int === 'bigint' && B_int > 0n && B_int <= U64_MAX
    && Number.isInteger(target) && target >= 1 && target <= 22, 'FEE_INPUT');
  return integer((B_int * feeRate(target) + 119_999n) / 120_000n, 0n, U64_MAX);
};

function mutableRootBody(w, actor) {
  return w.raw(actor, 32).u64(0n).u8(0).raw(zero()).raw(zero()).i64(0n).u64(0n);
}
function immutableCapsule(fullRootBytes) {
  return Buffer.concat([fullRootBytes.subarray(0, 322), fullRootBytes.subarray(443)]);
}

/**
 * Module-bound trusted dependencies, never accepted in a player request.
 * Functional and semantic certification must be provided by the real verifier.
 * All returned state is a detached draft; an outer executeAtomic commits it.
 */
export function createCompositionCoordinator(base, dependencies = {}) {
  const approved = Object.fromEntries(['domain', 'config', 'rule', 'validatorHash', 'labMint']
    .map(key => [key, asBytes(base[key], 32)]));
  approved.catalog = catalogHash();

  const getFrame = (context, module) => {
    const frame = decodeExactFrame(context.frameBytes);
    requireComposition(frame.module === module && frame.opcode === 1 && frame.payloadSchema === 1, 'MANUFACTURE_FRAME');
    requireComposition(equalBytes(frame.domain, approved.domain) && equalBytes(frame.configId, approved.config), 'MANUFACTURE_DOMAIN');
    requireComposition(context.authorizedActors instanceof Set && context.authorizedActors.has(hex32(frame.actor)), 'ACTOR_NOT_AUTHORIZED');
    integer(context.createdAt, 0n, I64_MAX); integer(context.createdSlot, 0n, U64_MAX);
    requireComposition(Number.isInteger(context.rootBump) && context.rootBump >= 0 && context.rootBump <= 255, 'ROOT_BUMP');
    const M = businessKey(frame.domain, frame.actor, frame.opId);
    return { frame, M, id: instanceId(frame.domain, M), requestSHA: requestHash(context.frameBytes) };
  };

  const rootRecord = (body, id, schema, bump) => encodeRecord({ kind: 12, schema, domain: approved.domain,
    configId: approved.config, recordKey: id, bump, body });

  const getInput = (state, id, settlement) => {
    const root = state.compositionRoots?.get(hex32(id));
    requireComposition(root && equalBytes(root.instance, id), 'UNKNOWN_COMPOSITION_ROOT');
    const current = settlement.root(hex32(id));
    requireComposition(current.status === 'LIVE', 'INPUT_CONSUMED');
    requireComposition(equalBytes(sha256(immutableCapsule(root.wireBytes)), root.fingerprint), 'INPUT_IMMUTABLE_FINGERPRINT');
    requireComposition(current.certificate === hex32(root.fingerprint) && current.scope === root.scope
      && current.B_int === root.B_int && current.q_ppm === root.q_ppm, 'INPUT_SETTLEMENT_BINDING');
    return { root, current };
  };

  const parseHistoricalLeaf = (capsule, role, primitive) => {
    const bytes = asBytes(capsule);
    requireComposition(bytes.length >= 326 && bytes.length <= 3358, 'CAPSULE_LENGTH');
    // Restore only the omitted mutable121 bytes so the actual old header length
    // and P5 immutable fields can be decoded; the restored bytes grant no LIVE
    // status/ownership. Current direct roots were checked independently above.
    const full = Buffer.concat([bytes.subarray(0, 322), Buffer.alloc(121), bytes.subarray(322)]);
    const record = decodeRecord(full, 3359);
    requireComposition(record.kind === 12 && record.schema === 1
      && equalBytes(record.domain, approved.domain) && equalBytes(record.configId, approved.config), 'CAPSULE_RECORD');
    const body = record.body, leafId = body.subarray(0, 32), M = body.subarray(32, 64);
    requireComposition(equalBytes(record.recordKey, leafId) && equalBytes(instanceId(approved.domain, M), leafId)
      && equalBytes(body.subarray(96, 128), approved.catalog)
      && equalBytes(body.subarray(128, 160), approved.validatorHash), 'CAPSULE_IDENTITY');
    const descriptor = body.subarray(160, 164), d = decodeDescriptor(descriptor);
    requireComposition(d.primitive === primitive && (primitive !== 4 || d.profile === role)
      && body.readUInt32LE(164) === 1_000_000 && body.readBigUInt64LE(168) === 120_000n
      && body.readBigUInt64LE(176) === 45_000n && body[184] === 1 && body[185] === 0
      && body.readBigInt64LE(186) >= 0n, 'CAPSULE_COMPONENT_FACTS');
    const debits = decodeDebitPlan(body.subarray(323));
    const effective = [], retired = [], totals = Array(32).fill(0n);
    for (const group of debits) for (const entry of group.entries) {
      totals[entry.species - 1] += entry.takeTick;
      const row = { sourceId: group.sourceId, species: entry.species,
        lo: entry.expectedPrefix, hi: entry.expectedPrefix + entry.takeTick };
      (F1_EFFECTIVE_SPECIES.includes(entry.species) ? effective : retired).push(row);
    }
    requireComposition(totals.every((n, i) => n === F1_BOM[i]), 'CAPSULE_BOM');
    return { role, primitive, descriptor: Buffer.from(descriptor), instance: Buffer.from(leafId),
      fingerprint: sha256(bytes), capsule: bytes, effective, retired };
  };

  const derivePayload = (state, { graph, inputIds }) => {
    validateGraph(graph, approved);
    requireComposition(Array.isArray(inputIds) && new Set(inputIds.map(hex32)).size === inputIds.length, 'DUPLICATE_DIRECT_INPUT');
    const settlement = SettlementEngine.fromSnapshot(state.settlement);
    const inputs = inputIds.map(id => getInput(state, id, settlement));
    const target = graph.target;
    const originalPayloads = new Map();
    if (target <= 15) {
      requireComposition(inputs.length === 4 && inputs.every(({ root }) => root.scope === 'COMPONENT'), 'CELL_INPUTS');
      inputs.sort((a, b) => a.root.primitive - b.root.primitive);
      requireComposition(inputs.every(({ root }, n) => root.primitive === n + 1
        && (root.primitive !== 4 || root.profile === target)), 'CELL_DESCRIPTOR_SET');
    } else {
      const expectedTargets = target <= 21 ? ORGAN_CELLS[target - 16] : [16, 17, 18, 19, 20, 21];
      const expectedScope = target <= 21 ? 'CELL' : 'ORGAN';
      requireComposition(inputs.length === expectedTargets.length
        && inputs.every(({ root }) => root.scope === expectedScope), 'PARENT_INPUTS');
      inputs.sort((a, b) => a.root.target - b.root.target);
      requireComposition(inputs.every(({ root }, n) => root.target === expectedTargets[n]), 'PARENT_ROLE_SET');
      for (const { root } of inputs) {
        assertChildUnchanged(graph, root.graph);
        const original = readSealedArtifact(state, root.artifactId, approved);
        requireComposition(equalBytes(original.payloadSHA, root.artifactSHA), 'CHILD_ARTIFACT');
        const originalPayload = decodeSynthesisPayload(original.written);
        requireComposition(equalBytes(encodeGraph(originalPayload.graph), encodeGraph(root.graph))
          && equalBytes(encodeLeafMap(originalPayload.leaves), encodeLeafMap(root.leaves)), 'CHILD_ARTIFACT');
        originalPayloads.set(hex32(root.instance), originalPayload);
      }
    }
    const leaves = inputs.flatMap(({ root }) => root.scope === 'COMPONENT'
      ? [parseHistoricalLeaf(immutableCapsule(root.wireBytes), target, root.primitive)]
      : originalPayloads.get(hex32(root.instance)).leaves.map((leaf, n) => {
        const parsed = parseHistoricalLeaf(originalPayloads.get(hex32(root.instance)).capsules[n], leaf.role, leaf.primitive);
        requireComposition(equalBytes(parsed.instance, leaf.instance) && equalBytes(parsed.fingerprint, leaf.fingerprint)
          && equalBytes(parsed.descriptor, leaf.descriptor), 'CAPSULE_LEAF_BINDING');
        return parsed;
      }))
      .sort((a, b) => a.role - b.role || a.primitive - b.primitive);
    requireComposition(leaves.length === members(target).length * 4, 'LEAF_COUNT');
    const union = validateSourceUnion(leaves);
    const B_int = leaves.flatMap(leaf => leaf.effective).reduce((sum, row) => sum + speciesCreditInt(row.species, row.hi - row.lo), 0n);
    const retired_B_int = leaves.flatMap(leaf => leaf.retired).reduce((sum, row) => sum + speciesCreditInt(row.species, row.hi - row.lo), 0n);
    requireComposition(B_int === BigInt(leaves.length) * 120_000n && retired_B_int === BigInt(leaves.length) * 45_000n
      && B_int === inputs.reduce((sum, { root }) => sum + root.B_int, 0n), 'PROVENANCE_CREDIT');
    const direct = inputs.map(({ root, current }) => ({ scope: target <= 15 ? target : root.target,
      primitive: root.scope === 'COMPONENT' ? root.primitive : 0, instance: root.instance,
      expectedRevision: current.revision, fingerprint: root.fingerprint }));
    return { inputs, leaves, union, B_int, retired_B_int,
      payload: { graph, direct, leaves, capsules: leaves.map(leaf => leaf.capsule) } };
  };

  return Object.freeze({
    productionAdmission: false,
    initialState(materialState, { rewardStart, saleStart = 0n }) {
      const state = cloneProtocolState(materialState);
      state.compositionRoots = new Map(); state.compositionArtifacts = new Map();
      state.settlement = new SettlementEngine({ rewardStart, saleStart }).snapshot();
      return state;
    },

    manufactureComponent(state, context) {
      const { frame, M, id, requestSHA } = getFrame(context, 501);
      const r = new ByteReader(frame.payload, 3116);
      const descriptor = decodeDescriptor(r.raw(4));
      const rentPayer = r.raw(32), maxRent = r.u64();
      const plan = decodeMaterialPlan(r.raw(r.remaining)); r.finish();
      requireComposition(context.authorizedActors.has(hex32(rentPayer)), 'RENT_PAYER_NOT_AUTHORIZED');
      integer(context.actualRentLamports, 0n, maxRent);
      const prepared = prepareMaterialConsumption(state, { domain: approved.domain, manufactureBusiness: M,
        authorizedOwners: context.authorizedOwners, createdAt: context.createdAt, createdSlot: context.createdSlot, plan });
      requireComposition(prepared.effectiveCreditInt === 120_000n && prepared.retiredCreditInt === 45_000n
        && prepared.consumedTick === 14_000n, 'COMPONENT_BOM');
      const draft = prepared.state;
      draft.compositionRoots ??= new Map();
      requireComposition(!draft.compositionRoots.has(hex32(id)), 'OUTPUT_ALREADY_EXISTS');
      const dp = encodeDebitPlan(plan.debits);
      const body = new ByteWriter(323 + dp.length).raw(id).raw(M).raw(requestSHA).raw(approved.catalog)
        .raw(approved.validatorHash).raw(descriptorBytes(descriptor)).u32(1_000_000)
        .u64(120_000n).u64(45_000n).u8(1).u8(0).i64(context.createdAt).u64(context.createdSlot);
      mutableRootBody(body, frame.actor).raw(dp);
      const wireBytes = rootRecord(body.finish(), id, 1, context.rootBump);
      const capsule = immutableCapsule(wireBytes), fingerprint = sha256(capsule);
      const root = { instance: id, scope: 'COMPONENT', ...descriptor, B_int: 120_000n, retired_B_int: 45_000n,
        q_ppm: 1_000_000n, wireBytes, capsule, fingerprint, effective: prepared.effective, retired: prepared.retired };
      draft.compositionRoots.set(hex32(id), root);
      const settlement = SettlementEngine.fromSnapshot(draft.settlement);
      settlement.createVerifiedRoot({ instance: hex32(id), owner: hex32(frame.actor), scope: 'COMPONENT',
        B_int: root.B_int, q_ppm: root.q_ppm, certificate: hex32(fingerprint) });
      draft.settlement = settlement.snapshot();
      return { state: draft, root: cloneProtocolState(root), result: { instance: id, descriptor: descriptorBytes(descriptor),
        B_int: root.B_int, retired_B_int: root.retired_B_int, burnedStandardUnits: prepared.burnedStandardUnits,
        consumedTick: prepared.consumedTick, actualRentLamports: BigInt(context.actualRentLamports) } };
    },

    prepareSynthesisPayload(state, request) {
      return encodeSynthesisPayload(derivePayload(state, request).payload);
    },

    synthesize(state, context) {
      const { frame, M, id, requestSHA } = getFrame(context, 702);
      requireComposition(BigInt(context.createdAt) >= state.settlement.rewardStart, 'SYNTHESIS_NOT_OPEN');
      const r = new ByteReader(frame.payload, 249);
      const artifactId = r.raw(32), artifactSHA = r.raw(32), artifactLength = r.u32(), c_ppm = r.u32();
      const labFeePayer = r.raw(32), labSource = r.raw(32), maxLab = r.u64(), rentPayer = r.raw(32), maxRent = r.u64(), mode = r.u8();
      requireComposition(mode === 0 || mode === 1, 'COMPETITION_MODE');
      const competition = mode === 1 ? { commitId: r.raw(32), salt: r.raw(32) } : null;
      r.finish();
      if (mode === 1) requireComposition(typeof dependencies.admitKnowledge === 'function', 'COMPETITION_MODULE_NOT_IMPLEMENTED');
      requireComposition(c_ppm >= 500_000 && c_ppm <= 2_000_000 && c_ppm % 1_000 === 0, 'CHALLENGE');
      integer(context.actualRentLamports, 0n, maxRent);
      requireComposition(context.authorizedActors.has(hex32(rentPayer)) && context.authorizedActors.has(hex32(labFeePayer)), 'PAYER_NOT_AUTHORIZED');
      const draft = cloneProtocolState(state);
      const artifact = readSealedArtifact(draft, artifactId, approved);
      requireComposition(artifact.payloadSchema === 1 && artifact.totalLength === artifactLength
        && equalBytes(artifact.payloadSHA, artifactSHA), 'SYNTHESIS_ARTIFACT');
      const payload = decodeSynthesisPayload(artifact.written);
      const derived = derivePayload(draft, { graph: payload.graph, inputIds: payload.direct.map(d => d.instance) });
      requireComposition(equalBytes(encodeSynthesisPayload(derived.payload), artifact.written), 'SYNTHESIS_INPUT_BINDING');
      const settlement = SettlementEngine.fromSnapshot(draft.settlement);
      for (const { root, current } of derived.inputs) {
        requireComposition(current.owner === hex32(frame.actor), 'INPUT_OWNER');
        settlement.assertCanConsume(hex32(root.instance), BigInt(context.createdAt));
      }
      requireComposition(typeof dependencies.verifyFunction === 'function' && typeof dependencies.semanticDesign === 'function', 'VERIFIER_MODULE_UNAVAILABLE');
      const graphBytes = encodeGraph(payload.graph), graphSHA = sha256(graphBytes);
      const report = dependencies.verifyFunction(cloneProtocolState(payload.graph), { challenge: c_ppm });
      const supportOnly = [3, 9, 14, 15, 21].includes(payload.graph.target);
      requireComposition(report && !(report && typeof report.then === 'function') && report.status === 'PASS'
        && typeof report.q_ppm === 'bigint' && (supportOnly
          ? c_ppm === 2_000_000 && report.q_ppm === 1_000_000n : report.q_ppm >= BigInt(c_ppm))
        && report.q_ppm <= 2_000_000n && report.q_ppm % 1_000n === 0n, 'FUNCTION_NOT_CERTIFIED');
      requireComposition(equalBytes(asBytes(report.graphSHA, 32), graphSHA), 'FUNCTION_GRAPH_BINDING');
      asBytes(report.transcriptSHA, 32); asBytes(report.positiveBitmap, 64);
      for (let bit = payload.graph.edges.length; bit < 512; bit += 1)
        requireComposition((report.positiveBitmap[bit >> 3] & (1 << (bit & 7))) === 0, 'FUNCTION_BITMAP');
      const taskExpected = payload.graph.target === 22 && c_ppm === 2_000_000 && report.q_ppm === 2_000_000n
        && payload.graph.cells.every(cell => !DYNAMIC.includes(cell.role) || cell.v === 1_000_000);
      requireComposition(typeof report.taskApplicable === 'boolean' && report.taskApplicable === taskExpected
        && (report.taskApplicable ? report.C > 0n : report.C === 0n), 'FUNCTION_TASK_ADMISSION');
      if (mode === 1) requireComposition(report.taskApplicable, 'COMPETITION_NOT_QUALIFIED');
      integer(report.C, 0n, U64_MAX);
      const semantic = asBytes(dependencies.semanticDesign(cloneProtocolState(payload.graph)), 32);
      const fee = synthesisFee(derived.B_int, payload.graph.target);
      requireComposition(fee <= maxLab, 'LAB_FEE_CAP');
      const token = draft.labTokens?.get(hex32(labSource));
      requireComposition(token && token.initialized === true && token.native === false && token.frozen !== true
        && equalBytes(token.owner, labFeePayer) && equalBytes(token.mint, approved.labMint), 'LAB_SOURCE');
      requireComposition(integer(token.amount, 0n, U64_MAX) >= fee, 'LAB_SOURCE_BALANCE');
      settlement.executePrepared('burnManufacture', { actor: hex32(labFeePayer), amount: fee, now: BigInt(context.createdAt) });
      token.amount = BigInt(token.amount) - fee;
      const graph = payload.graph, target = graph.target, leafMapSHA = sha256(encodeLeafMap(payload.leaves));
      const suiteVersion = report.evidenceVersion === 2 ? 2 : 1;
      const admission = suiteVersion === 2 ? computeAdmissionH16({
        domain: approved.domain, config: approved.config, rule: approved.rule, graphSHA, leafMapSHA,
        evidenceRef: id, evidenceKind: 1, target, c_ppm, q_ppm: report.q_ppm,
        taskApplicable: report.taskApplicable, C: report.C, suite: 2, fixture: 1, load: 1,
        dutMask: members(target).reduce((mask, role) => mask | (1 << (role - 1)), 0),
        transcriptSHA: report.transcriptSHA, positiveBitmap: report.positiveBitmap,
      }) : null;
      const descriptor = [target, target <= 15 ? 1 : target <= 21 ? 2 : 3, target <= 15 ? target : target <= 21 ? target - 15 : 0, 0];
      const body = new ByteWriter(641).raw(id).raw(M).raw(requestSHA).raw(approved.catalog).raw(approved.validatorHash)
        .raw(Buffer.from(descriptor)).u32(report.q_ppm).u64(derived.B_int).u64(derived.retired_B_int)
        .u8(2).u8(report.taskApplicable ? 1 : 0).i64(context.createdAt).u64(context.createdSlot);
      mutableRootBody(body, frame.actor).raw(artifactId).raw(artifactSHA).u32(artifactLength).raw(graphSHA)
        .raw(leafMapSHA).raw(derived.union.effectiveUnionSHA).u32(c_ppm).u32(suiteVersion).u32(1).u32(1)
        .raw(report.transcriptSHA, 32).raw(report.positiveBitmap, 64).u64(report.C).raw(semantic)
        .u8(derived.inputs.length).u8(derived.leaves.length);
      const wireBytes = rootRecord(body.finish(), id, target <= 15 ? 2 : target <= 21 ? 3 : 4, context.rootBump);
      const fingerprint = sha256(immutableCapsule(wireBytes));
      const root = { instance: id, scope: scopeName(target), target, B_int: derived.B_int, retired_B_int: derived.retired_B_int,
        q_ppm: report.q_ppm, wireBytes, fingerprint, graph, leaves: derived.leaves,
        artifactId, artifactSHA, semantic, graphSHA, transcriptSHA: report.transcriptSHA,
        admission, c_ppm, suiteVersion };
      settlement.executePrepared('consume', { actor: hex32(frame.actor), now: BigInt(context.createdAt),
        instances: derived.inputs.map(({ root: child }) => hex32(child.instance)), outputInstance: hex32(id),
        outputFacts: { instance: hex32(id), owner: hex32(frame.actor), scope: root.scope, B_int: root.B_int,
          q_ppm: root.q_ppm, certificate: hex32(fingerprint) } });
      draft.settlement = settlement.snapshot();
      requireComposition(!draft.compositionRoots.has(hex32(id)), 'OUTPUT_ALREADY_EXISTS');
      draft.compositionRoots.set(hex32(id), root);
      if (report.taskApplicable) requireComposition(typeof dependencies.admitKnowledge === 'function', 'TASK_MODULE_UNAVAILABLE');
      if (typeof dependencies.admitKnowledge === 'function') dependencies.admitKnowledge(draft,
        cloneProtocolState(root), cloneProtocolState(report), {
          frameBytes: asBytes(context.frameBytes), manufactureOpId: asBytes(frame.opId), actor: asBytes(frame.actor),
          now: BigInt(context.createdAt), slot: BigInt(context.createdSlot), competition,
        });
      return { state: draft, root: cloneProtocolState(root), result: { instance: id, artifactId,
        q_ppm: report.q_ppm, B_int: derived.B_int, retired_B_int: derived.retired_B_int,
        C: report.C, semantic, fee, actualRentLamports: BigInt(context.actualRentLamports), target,
        taskApplicable: report.taskApplicable, directCount: derived.inputs.length,
        leafCount: derived.leaves.length, transcriptSHA: asBytes(report.transcriptSHA, 32) } };
    },
  });
}
