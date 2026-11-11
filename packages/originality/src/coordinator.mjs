import { ByteReader, ByteWriter, asBytes, equalBytes, integer, U64_MAX, I64_MAX } from '../../protocol-core/src/codec.mjs';
import { cloneProtocolState } from '../../protocol-core/src/atomic.mjs';
import { businessKey, decodeExactFrame, instanceId, typedHash, requestHash, sha256 } from '../../protocol-core/src/p0.mjs';
import { encodeGraph, validateGraph, members } from '../../biology/src/graph.mjs';
import { designId } from '../../biology/src/canonical.mjs';
import { createSeed, createImprovement, createFurtherImprovement, FROZEN_SEED_COSTS } from '../../biology/src/seeds.mjs';
import { createPublishedC310Graph } from '../../biology/src/published-c310.mjs';
import { validateDesign as defaultValidateDesign } from '../../biology/src/evidence.mjs';
import { readSealedArtifact } from '../../composition/src/artifact.mjs';
import { decodeSynthesisPayload, encodeLeafMap } from '../../composition/src/payload.mjs';
import { SettlementEngine } from '../../settlement/src/engine.mjs';
import { H_END } from '../../settlement/src/emission.mjs';
import { TASK_FAMILY, TASK_VERSION, ROUND_SECONDS, WINDOW_SECONDS, requireOriginality,
  commitmentHash, decodeBlueprint, computeAdmissionH16, key32, initialSeedSetId, openingSnapshotId } from './wire.mjs';

const n64 = value => integer(value, 0n, U64_MAX);
const add = value => n64(value + 1n);
const roundKey = (domain, round) => typedHash(9, new ByteWriter(76).raw(domain, 32).raw(TASK_FAMILY).u32(TASK_VERSION).u64(round).finish());
const disclosureKey = (domain, design) => typedHash(8, new ByteWriter(64).raw(domain, 32).raw(design, 32).finish());
const winnerKey = (domain, roundId) => typedHash(10, new ByteWriter(64).raw(domain, 32).raw(roundId, 32).finish());
const seedKey = (domain, design) => typedHash(15, new ByteWriter(97).u8(1).raw(domain, 32).raw(TASK_FAMILY).raw(design, 32).finish());
const sameReport = (a, b) => a.q_ppm === b.q_ppm && a.C === b.C && a.taskApplicable === b.taskApplicable
  && equalBytes(a.graphSHA, b.graphSHA) && equalBytes(a.transcriptSHA, b.transcriptSHA)
  && equalBytes(a.positiveBitmap, b.positiveBitmap);

export function createOriginalityCoordinator(config, dependencies = {}) {
  const base = Object.fromEntries(['domain', 'config', 'catalog', 'rule'].map(key => [key, asBytes(config[key], 32)]));
  const rewardStart = integer(config.rewardStart, 0n, I64_MAX), seedOpen = integer(config.seedOpen ?? 0n, 0n, rewardStart);
  const openingProfile=config.openingProfile??'CURRENT16-316';
  requireOriginality(['CURRENT16-316','OPEN310'].includes(openingProfile),'OPENING_POLICY');const openingFrontier=openingProfile==='OPEN310'?310n:316n;
  requireOriginality(config.frontier===undefined||config.frontier===Number(openingFrontier)||config.frontier===openingFrontier,'OPENING_POLICY');
  const validate = dependencies.validateDesign ?? defaultValidateDesign;
  requireOriginality(typeof validate === 'function', 'VALIDATOR_UNAVAILABLE');
  const initialGraphs = Array.from({ length: 12 }, (_, n) => createSeed(n, base))
    .concat([createImprovement({ ...base, surfaces: false }), createImprovement({ ...base, surfaces: true }),
      createFurtherImprovement({ ...base, stage: 1 }), createFurtherImprovement({ ...base, stage: 2 })]);
  const initialCosts = [...FROZEN_SEED_COSTS, 324, 320, 318, 316].map(BigInt);
  const initialRows = initialGraphs.map((graph, n) => ({ design: designId(graph, base), C: initialCosts[n] }))
    .sort((a, b) => Buffer.compare(a.design, b.design));
  const requiredInitial = new Map(initialRows.map((row, ordinal) => [key32(row.design), { ordinal, cost: row.C }]));
  requireOriginality(requiredInitial.size === 16, 'INITIAL_CANONICAL_COLLISION');
  const initialSetId = initialSeedSetId(base.domain, initialRows);

  function auth(context) {
    asBytes(context.actor, 32); integer(context.now, 0n, I64_MAX); n64(context.slot);
    requireOriginality(context.authorizedActors instanceof Set && context.authorizedActors.has(key32(context.actor)), 'ACTOR_NOT_AUTHORIZED');
  }
  function stateOf(state) { requireOriginality(state.originality?.version === 'ORIGINALITY2/2', 'TASK_UNINITIALIZED'); return state.originality; }
  function observe(task, now) { requireOriginality(now >= task.highWater, 'TASK_CLOCK_ROLLBACK'); task.highWater = now; }
  function currentRound(now) { requireOriginality(now >= rewardStart, 'TASK_NOT_OPEN'); return (now - rewardStart) / ROUND_SECONDS; }
  function phase(now, round) {
    const elapsed = now - rewardStart - round * ROUND_SECONDS;
    if (elapsed < 0n || elapsed >= ROUND_SECONDS) return 'OUTSIDE';
    return elapsed < WINDOW_SECONDS ? 'COMMIT' : elapsed < 2n * WINDOW_SECONDS ? 'MANUFACTURE' : 'PREPARE';
  }
  function ensureRound(task, now) {
    if (now < rewardStart) return null;
    const number = currentRound(now);
    let round = task.rounds.get(number);
    if (!round) {
      round = { number, id: roundKey(base.domain, number), startKnowledgeCount: BigInt(task.knowledge.length),
        knowledgeEndCount: BigInt(task.knowledge.length), observedBest: cloneProtocolState(task.best),
        commits: 0n, candidates: [], state: 'OPEN', scanEpoch: task.safetyEpoch, baselineCursor: 0n,
        baseline: null, candidateCursor: 0n, knowledgeCursor: 0n, minDisclosure: null, bestCandidate: null,
        winner: null, finalizedEvent: null, confirmedStart: null, activation: null };
      task.rounds.set(number, round);
    }
    return round;
  }
  function touch(task, now, slot) {
    observe(task, now); ensureRound(task, now); task.eventSeq = add(task.eventSeq);
    return { event: task.eventSeq, now, slot };
  }
  function disclose(task, design, evidence, actor, now, slot) {
    const key = key32(design), previous = task.disclosures.get(key);
    if (previous) return previous;
    const position = touch(task, now, slot);
    const record = cloneProtocolState({ id: disclosureKey(base.domain, design), design: asBytes(design, 32), artifactId: evidence.artifactId,
      graphSHA: evidence.report.graphSHA, actor: asBytes(actor, 32), target: evidence.graph.target, ...position });
    task.disclosures.set(key, record); return record;
  }
  function validated(graph, challenge) {
    validateGraph(graph, base);
    const report = validate(cloneProtocolState(graph), { challenge });
    requireOriginality(report && !(report && typeof report.then === 'function') && report.status === 'PASS'
      && report.evidenceVersion === 2 && typeof report.q_ppm === 'bigint' && typeof report.C === 'bigint'
      && equalBytes(asBytes(report.graphSHA, 32), sha256(encodeGraph(graph))), 'EVIDENCE_NOT_VALIDATED');
    asBytes(report.transcriptSHA, 32); asBytes(report.positiveBitmap, 64);
    const supportOnly = [3, 9, 14, 15, 21].includes(graph.target);
    requireOriginality((supportOnly ? challenge === 2_000_000 && report.q_ppm === 1_000_000n
      : report.q_ppm >= BigInt(challenge)) && report.q_ppm <= 2_000_000n
      && report.q_ppm % 1_000n === 0n && typeof report.taskApplicable === 'boolean', 'EVIDENCE_QUALITY');
    n64(report.C);
    // Do not persist the verifier's optional diagnostic round/case objects.
    // Permanent evidence retains only the bounded frozen certificate fields.
    return { status: 'PASS', evidenceVersion: 2, q_ppm: report.q_ppm, C: report.C,
      taskApplicable: report.taskApplicable, graphSHA: asBytes(report.graphSHA, 32),
      transcriptSHA: asBytes(report.transcriptSHA, 32), positiveBitmap: asBytes(report.positiveBitmap, 64) };
  }
  function admission(evidence) {
    return computeAdmissionH16({ ...base, graphSHA: evidence.report.graphSHA, leafMapSHA: evidence.leafMapSHA,
      evidenceRef: evidence.kind === 0 ? evidence.artifactId : evidence.ref, evidenceKind: evidence.kind,
      target: evidence.graph.target, c_ppm: evidence.challenge, q_ppm: evidence.report.q_ppm,
      taskApplicable: evidence.report.taskApplicable, C: evidence.report.C, suite: 2, fixture: 1, load: 1,
      dutMask: members(evidence.graph.target).reduce((mask, role) => mask | (1 << (role - 1)), 0),
      transcriptSHA: evidence.report.transcriptSHA, positiveBitmap: evidence.report.positiveBitmap });
  }
  function blueprintEvidence(state, artifactId) {
    const artifact = readSealedArtifact(state, artifactId, base);
    requireOriginality(artifact.payloadSchema === 2, 'BLUEPRINT_ARTIFACT_SCHEMA');
    const decoded = decodeBlueprint(artifact.written), report = validated(decoded.graph, decoded.challenge);
    const evidence = { kind: 0, ref: asBytes(artifactId, 32), artifactId: asBytes(artifactId, 32), sealedAt: artifact.sealedAt, graph: decoded.graph,
      challenge: decoded.challenge, leafMapSHA: decoded.descriptorMapSHA, report };
    evidence.admissionId = admission(evidence); return evidence;
  }
  function rootEvidence(state, id, { strictStored = true } = {}) {
    const root = state.compositionRoots?.get(key32(id));
    requireOriginality(root && ['CELL', 'ORGAN', 'BIO'].includes(root.scope)
      && root.B_int === BigInt(members(root.target).length) * 480_000n, 'MANUFACTURED_ROOT_REQUIRED');
    const artifact = readSealedArtifact(state, root.artifactId, base);
    const decoded = decodeSynthesisPayload(artifact.written);
    requireOriginality(equalBytes(encodeGraph(decoded.graph), encodeGraph(root.graph)), 'ROOT_ARTIFACT_BINDING');
    const report = validated(decoded.graph, root.c_ppm);
    const evidence = { kind: 1, ref: asBytes(id, 32), artifactId: asBytes(root.artifactId, 32), graph: decoded.graph,
      challenge: root.c_ppm, leafMapSHA: sha256(encodeLeafMap(decoded.leaves)), report };
    evidence.admissionId = admission(evidence);
    if (strictStored) requireOriginality(root.suiteVersion === 2 && root.q_ppm === report.q_ppm
      && equalBytes(root.graphSHA, report.graphSHA) && equalBytes(root.transcriptSHA, report.transcriptSHA)
      && equalBytes(asBytes(root.admission, 32), evidence.admissionId)
      && root.wireBytes.readBigUInt64LE(120 + 599) === report.C, 'ROOT_ADMISSION_MISMATCH');
    return evidence;
  }
  function taskQualified(evidence) { return evidence.graph.target === 22 && evidence.challenge === 2_000_000
    && evidence.report.q_ppm === 2_000_000n && evidence.report.taskApplicable && evidence.report.C > 0n; }
  function appendKnowledge(state, task, evidence, disclosure, position, kind = evidence.kind, ref = evidence.ref) {
    const index = BigInt(task.knowledge.length), design = designId(evidence.graph, base);
    const entry = cloneProtocolState({ index, design, C: evidence.report.C, admissionId: evidence.admissionId,
      evidenceKind: kind, evidenceRef: asBytes(ref, 32), baseKind: evidence.kind, baseRef: evidence.ref,
      artifactId: evidence.artifactId, disclosureId: disclosure.id, firstDisclosure: disclosure.event,
      qualifiedEvent: position.event, qualifiedTime: position.now, qualifiedSlot: position.slot,
      validity: 'ACCEPTED', fault: null, report: cloneProtocolState(evidence.report) });
    task.knowledge.push(entry);
    const round = ensureRound(task, position.now); if (round) round.knowledgeEndCount = BigInt(task.knowledge.length);
    if (task.best === null || entry.C < task.best.C) {
      task.best = { C: entry.C, design: entry.design, index };
      task.generation = add(task.generation);
      const settlement = SettlementEngine.fromSnapshot(state.settlement);
      if (settlement.snapshot().bestCost === null || entry.C < settlement.snapshot().bestCost)
        settlement.acceptFrontier({ cost: entry.C, now: position.now });
      state.settlement = settlement.snapshot();
    }
    return entry;
  }
  function resetScan(task, round) {
    round.state = 'SCAN_BASELINE'; round.scanEpoch = task.safetyEpoch; round.baselineCursor = 0n;
    // Preserve the original start/deadline prefixes. Later repairs use their
    // immutable historical origin; later new designs cannot enter old rounds.
    round.scanKnowledgeCount = BigInt(task.knowledge.length);
    round.baseline = null; round.candidateCursor = 0n; round.knowledgeCursor = 0n;
    round.minDisclosure = null; round.bestCandidate = null;
  }
  function effectiveKnowledgeIndex(task, entry) {
    if (entry.evidenceKind !== 2) return entry.index;
    const proof = task.safeties.get(key32(entry.evidenceRef));
    requireOriginality(proof && proof.correctedIndex === entry.index && typeof proof.originKnowledgeIndex === 'bigint'
      && proof.originKnowledgeIndex >= 0n && (proof.originKnowledgeIndex <= proof.knowledgeIndex || proof.originKnowledgeIndex === entry.index)
      && proof.knowledgeIndex < entry.index, 'SAFETY_CORRECTION_ORIGIN');
    return proof.originKnowledgeIndex;
  }
  function chooseBest(best, entry) { return best === null || entry.C < best.C ? { C: entry.C, design: entry.design, index: entry.index } : best; }
  function kEligible(settlement, winner) {
    const state = settlement.snapshot(), root = state.roots.get(key32(winner.root));
    const reg = state.registrations.get(key32(winner.root));
    const ordinary = reg?.intervals.length ? state.intervals.get(reg.intervals.at(-1)) : null;
    const lastId = state.registry.kHistory.at(-1), last = lastId ? state.activations.get(lastId) : null;
    return root?.status === 'LIVE' && root.owner === key32(winner.author) && !reg?.revoked
      && !reg?.certificateFault && ordinary?.end === null && ordinary.beneficiary === key32(winner.author)
      && !state.taskPaused && (last === null || last.end !== null);
  }
  function attachWinner(state, task, round, winner, now) {
    const settlement = SettlementEngine.fromSnapshot(state.settlement);
    settlement.acceptWinner({ winnerId: key32(winner.id), instance: key32(winner.root), author: key32(winner.author), cost: winner.C });
    if (task.best?.C === winner.C && now < rewardStart + (H_END - 1n) * 3_600n && kEligible(settlement, winner)) {
      const activated = settlement.executePrepared('activateK', { actor: key32(winner.author), instance: key32(winner.root),
        winnerId: key32(winner.id), now });
      round.activation = activated.activationId; round.confirmedStart = activated.start;
      task.generation = add(task.generation);
    }
    state.settlement = settlement.snapshot();
  }
  function analyzeEvidence(state, task, entry) {
    try {
      let evidence, claimed;
      if (entry.baseKind === 0) {
        const seed = [...task.seeds.values()].find(s => equalBytes(s.id, entry.baseRef));
        requireOriginality(seed, 'SEED_EVIDENCE_MISSING');
        evidence = blueprintEvidence(state, seed.artifactId);
        evidence.ref = seed.id;
        claimed = { report: seed.report, admissionId: seed.admissionId };
      } else {
        requireOriginality(entry.baseKind === 1, 'SAFETY_BASE_KIND');
        evidence = rootEvidence(state, entry.baseRef, { strictStored: false });
        const root = state.compositionRoots.get(key32(entry.baseRef));
        claimed = { admissionId: root.admission, report: { q_ppm: root.q_ppm,
          C: root.wireBytes.readBigUInt64LE(120 + 599), taskApplicable: root.wireBytes[120 + 185] === 1,
          graphSHA: root.graphSHA, transcriptSHA: root.transcriptSHA,
          positiveBitmap: root.wireBytes.subarray(120 + 535, 120 + 599) } };
      }
      const design = designId(evidence.graph, base);
      if (entry.evidenceKind === 2) {
        const proof = task.safeties.get(key32(entry.evidenceRef));
        requireOriginality(proof && proof.correctedIndex === entry.index && proof.correctedEvidence,
          'SAFETY_CORRECTION_BINDING');
        claimed = proof.correctedEvidence;
      }
      const baseBad = !sameReport(claimed.report, evidence.report)
        || !equalBytes(asBytes(claimed.admissionId, 32), evidence.admissionId);
      const correctDisclosureId = disclosureKey(base.domain, design);
      const disclosed = task.disclosures.get(key32(design));
      // A missing correctly linked record is UNKNOWN. A separately proven
      // H7/base/link error may create the real corrected H8 at the current
      // event, without borrowing the wrong identity's old disclosure time.
      if (!disclosed) {
        requireOriginality(!equalBytes(entry.disclosureId, correctDisclosureId), 'DISCLOSURE_EVIDENCE_UNAVAILABLE');
        return { outcome: 'FAULT', evidence, faultType: baseBad ? 0 : 1,
          preserveHistoricalOrigin: false, rootBad: baseBad && entry.baseKind === 1 && entry.evidenceKind !== 2 };
      }
      requireOriginality(equalBytes(disclosed.design, design)
        && equalBytes(disclosed.id, correctDisclosureId)
        && typeof disclosed.event === 'bigint' && disclosed.event > 0n && disclosed.event <= task.eventSeq,
      'DISCLOSURE_EVIDENCE_UNAVAILABLE');
      const linkBad = !equalBytes(entry.design, design) || entry.C !== evidence.report.C
        || !equalBytes(entry.admissionId, evidence.admissionId) || !equalBytes(entry.artifactId, evidence.artifactId)
        || !equalBytes(entry.disclosureId, disclosed.id) || entry.firstDisclosure !== disclosed.event;
      if (!baseBad && !linkBad && taskQualified(evidence)) return { outcome: 'MATCH', evidence };
      return { outcome: 'FAULT', evidence, faultType: baseBad ? 0 : 1,
        preserveHistoricalOrigin: equalBytes(entry.design, design) && disclosed.event < entry.qualifiedEvent,
        rootBad: baseBad && entry.baseKind === 1 && entry.evidenceKind !== 2 };
    } catch (error) {
      // This first implementation proves complete replay-output/link mismatch.
      // Missing bytes/unknown decoding/failed runtime are never inferred FAULT.
      return { outcome: 'UNKNOWN', reason: error.code ?? error.message };
    }
  }

  return Object.freeze({
    productionAdmission: false,
    initialGraphs: () => initialGraphs.map(graph => cloneProtocolState(graph)),
    publishedGraphs:()=>[...initialGraphs,...(openingProfile==='OPEN310'?[createPublishedC310Graph(base)]:[])].map(graph=>cloneProtocolState(graph)),
    openingPolicy:()=>({profile:openingProfile,requiredSeedCount:16,publishedKnownCount:openingProfile==='OPEN310'?17:16,frontier:openingFrontier}),
    initialSetId: () => Buffer.from(initialSetId),
    initialize(state) {
      requireOriginality(!state.originality, 'TASK_ALREADY_INITIALIZED');
      requireOriginality(state.settlement?.rewardStart === rewardStart, 'REWARD_CLOCK_MISMATCH');
      const draft = cloneProtocolState(state);
      draft.originality = { version: 'ORIGINALITY2/2', eventSeq: 0n, highWater: 0n, knowledge: [],
        disclosures: new Map(), seeds: new Map(), commits: new Map(), rounds: new Map(), winners: new Map(),
        best: null, generation: 0n, nextFinalizeRound: 0n, paused: false, safetyEpoch: 0n,
        safeties: new Map(), initialSetId: Buffer.from(initialSetId), opening: { cursor: 0n, initialBitmap: 0, seedCount: 0n, sealed: false, snapshot: null,
          accumulator: sha256(Buffer.concat([Buffer.from('BIOSEED1'), base.domain, TASK_FAMILY])) } };
      return draft;
    },
    registerSeed(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft);
      requireOriginality(context.now >= seedOpen && context.now < rewardStart, 'SEED_WINDOW'); observe(task, context.now);
      const evidence = blueprintEvidence(draft, context.artifactId);
      requireOriginality(context.now >= evidence.sealedAt, 'SEED_BEFORE_ARTIFACT');
      requireOriginality(taskQualified(evidence), 'SEED_NOT_QUALIFIED');
      const design = designId(evidence.graph, base), key = key32(design), initial = requiredInitial.get(key);
      if (initial) requireOriginality(evidence.report.C === initial.cost, 'INITIAL_GOLDEN_COST');
      const existing = task.seeds.get(key);
      if (existing) return { state: draft, result: cloneProtocolState(existing) };
      const disclosure = disclose(task, design, evidence, context.actor, context.now, context.slot);
      const position = touch(task, context.now, context.slot), id = seedKey(base.domain, design);
      evidence.ref = id;
      const entry = appendKnowledge(draft, task, evidence, disclosure, position);
      const seed = cloneProtocolState({ id, design, C: evidence.report.C, artifactId: context.artifactId, admissionId: evidence.admissionId,
        knowledgeIndex: entry.index, report: evidence.report, initialOrdinal: initial?.ordinal ?? null });
      task.seeds.set(key, seed); task.opening.seedCount += 1n;
      if (initial) task.opening.initialBitmap |= 1 << initial.ordinal;
      return { state: draft, result: cloneProtocolState(seed) };
    },
    sealOpeningStep(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft), opening = task.opening;
      requireOriginality(context.now >= rewardStart && !opening.sealed, 'OPENING_SEAL_STATE'); observe(task, context.now);
      requireOriginality(opening.initialBitmap === 0xffff && opening.seedCount >= 16n, 'INITIAL_SEEDS_INCOMPLETE');
      requireOriginality(context.expectedCursor === opening.cursor && Number.isInteger(context.maxScan)
        && context.maxScan >= 1 && context.maxScan <= 8, 'OPENING_CURSOR');
      const stop = opening.cursor + BigInt(context.maxScan) < opening.seedCount ? opening.cursor + BigInt(context.maxScan) : opening.seedCount;
      while (opening.cursor < stop) {
        const entry = task.knowledge[Number(opening.cursor)], seed = task.seeds.get(key32(entry.design));
        requireOriginality(entry.evidenceKind === 0 && entry.qualifiedTime < rewardStart && seed?.knowledgeIndex === entry.index,
          'OPENING_EVIDENCE');
        opening.accumulator = sha256(new ByteWriter(120).raw(Buffer.from('BIOSEED1')).raw(opening.accumulator)
          .u64(entry.index).raw(entry.design).u64(entry.C).raw(entry.admissionId).finish());
        opening.cursor += 1n;
      }
      if (opening.cursor === opening.seedCount) {
        requireOriginality(task.best!==null&&task.best.C<=openingFrontier,'OPENING_FRONTIER');
        const position = touch(task, context.now, context.slot);
        opening.sealed = true; opening.snapshot = { cutoff: rewardStart, seedCount: opening.seedCount,
          initialSetId: Buffer.from(initialSetId), digest: opening.accumulator, best: cloneProtocolState(task.best), ...position };
        opening.snapshot.id = openingSnapshotId(base.domain, opening.snapshot);
      }
      return { state: draft, result: cloneProtocolState(opening) };
    },
    commit(state, context) {
      const frame = decodeExactFrame(context.frameBytes);
      requireOriginality(frame.module === 1002 && frame.opcode === 1 && frame.payloadSchema === 1
        && equalBytes(frame.domain, base.domain) && equalBytes(frame.configId, base.config), 'COMMIT_FRAME');
      auth({ ...context, actor: frame.actor });
      const r = new ByteReader(frame.payload, 116), family = r.raw(32), version = r.u32(), number = r.u64(), hash = r.raw(32);
      const rentPayer = r.raw(32); r.u64(); r.finish();
      requireOriginality(equalBytes(family, TASK_FAMILY) && version === TASK_VERSION, 'COMMIT_TASK');
      requireOriginality(context.authorizedActors.has(key32(rentPayer)), 'PAYER_NOT_AUTHORIZED');
      const draft = cloneProtocolState(state), task = stateOf(draft);
      observe(task, context.now);
      requireOriginality(task.opening.sealed && !task.paused && phase(context.now, number) === 'COMMIT', 'COMMIT_WINDOW_OR_PAUSED');
      const id = businessKey(base.domain, frame.actor, frame.opId), idKey = key32(id), previous = task.commits.get(idKey);
      if (previous) { requireOriginality(equalBytes(previous.requestSHA, requestHash(context.frameBytes)), 'COMMIT_CONFLICT');
        return { state: draft, result: cloneProtocolState(previous) }; }
      const round = ensureRound(task, context.now), position = touch(task, context.now, context.slot);
      requireOriginality(round.number === number, 'COMMIT_ROUND');
      const record = { id, round: number, author: frame.actor, hash, opId: frame.opId,
        requestSHA: requestHash(context.frameBytes), candidate: null, ...position };
      task.commits.set(idKey, record); round.commits = add(round.commits);
      return { state: draft, result: cloneProtocolState(record) };
    },
    discloseBlueprint(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft);
      observe(task, context.now);
      const artifact = readSealedArtifact(draft, context.artifactId, base);
      requireOriginality(artifact.payloadSchema === 2, 'BLUEPRINT_ARTIFACT_SCHEMA');
      const decoded = decodeBlueprint(artifact.written); validateGraph(decoded.graph, base);
      const evidence = { graph: decoded.graph, artifactId: context.artifactId,
        report: { graphSHA: sha256(encodeGraph(decoded.graph)) } };
      const result = disclose(task, designId(decoded.graph, base), evidence, context.actor, context.now, context.slot);
      return { state: draft, result: cloneProtocolState(result) };
    },
    /** Trusted SYNTH hook. No q/C/PASS fields are read from the caller. */
    admitManufactured(state, context) {
      const draft = cloneProtocolState(state), task = stateOf(draft);
      integer(context.now, rewardStart, I64_MAX); n64(context.slot); observe(task, context.now);
      const evidence = rootEvidence(draft, context.rootId), root = draft.compositionRoots.get(key32(context.rootId));
      const frame = decodeExactFrame(context.frameBytes);
      requireOriginality(frame.module === 702 && frame.opcode === 1 && equalBytes(frame.domain, base.domain)
        && equalBytes(frame.configId, base.config) && equalBytes(instanceId(base.domain, businessKey(base.domain, frame.actor, frame.opId)), root.instance)
        && equalBytes(requestHash(context.frameBytes), root.wireBytes.subarray(120 + 64, 120 + 96)), 'MANUFACTURE_FRAME_BINDING');
      requireOriginality(root.wireBytes.readBigInt64LE(120 + 186) === context.now
        && root.wireBytes.readBigUInt64LE(120 + 194) === context.slot, 'MANUFACTURE_CLOCK_BINDING');
      const mode = frame.payload[184];
      requireOriginality((mode === 0 && frame.payload.length === 185 && !context.competition)
        || (mode === 1 && frame.payload.length === 249 && context.competition
          && equalBytes(frame.payload.subarray(185, 217), context.competition.commitId)
          && equalBytes(frame.payload.subarray(217, 249), context.competition.salt)), 'COMPETITION_FRAME_BINDING');
      const design = designId(evidence.graph, base);
      requireOriginality(equalBytes(root.semantic, design), 'ROOT_CANONICAL_BINDING');
      const disclosure = disclose(task, design, evidence, frame.actor, context.now, context.slot);
      if (!taskQualified(evidence)) {
        requireOriginality(!context.competition, 'CANDIDATE_NOT_QUALIFIED');
        return { state: draft, result: { disclosure, knowledgeIndex: null, candidate: null } };
      }
      requireOriginality(!task.knowledge.some(entry => entry.baseKind === 1 && equalBytes(entry.baseRef, context.rootId)), 'EVIDENCE_ALREADY_ADMITTED');
      const round = ensureRound(task, context.now);
      let commit = null;
      if (context.competition) {
        requireOriginality(!task.paused && phase(context.now, round.number) === 'MANUFACTURE', 'CANDIDATE_WINDOW_OR_PAUSED');
        commit = task.commits.get(key32(context.competition.commitId));
        requireOriginality(commit && commit.round === round.number && equalBytes(commit.author, frame.actor)
          && commit.candidate === null && !equalBytes(commit.opId, frame.opId), 'CANDIDATE_COMMIT');
        requireOriginality(equalBytes(commit.hash, commitmentHash({ domain: base.domain, round: round.number,
          author: frame.actor, design, manufactureOpId: frame.opId, salt: context.competition.salt })), 'COMMIT_REVEAL');
      }
      const position = touch(task, context.now, context.slot), entry = appendKnowledge(draft, task, evidence, disclosure, position);
      let candidate = null;
      if (commit) {
        const id = typedHash(18, new ByteWriter(128).raw(base.domain).raw(round.id).raw(commit.id).raw(root.instance).finish());
        candidate = { id, index: BigInt(round.candidates.length), round: round.number, root: root.instance,
          author: frame.actor, design, C: entry.C, commitId: commit.id, commitEvent: commit.event,
          manufactureM: businessKey(base.domain, frame.actor, frame.opId), manufactureOpId: frame.opId,
          knowledgeIndex: entry.index, qualifiedEvent: entry.qualifiedEvent, qualifiedTime: context.now };
        round.candidates.push(candidate); commit.candidate = id;
      }
      return { state: draft, result: { disclosure, knowledgeIndex: entry.index, candidate } };
    },
    finalizeStep(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft); observe(task, context.now);
      n64(context.round);
      requireOriginality(context.now >= rewardStart + (context.round + 1n) * ROUND_SECONDS
        && context.round === task.nextFinalizeRound && !task.paused, 'ROUND_NOT_FINALIZABLE');
      requireOriginality(Number.isInteger(context.maxScan) && context.maxScan >= 1 && context.maxScan <= 8, 'ROUND_SCAN_COUNT');
      let round = task.rounds.get(context.round);
      if (!round) {
        const id = roundKey(base.domain, context.round), position = touch(task, context.now, context.slot);
        round = { number: context.round, id, state: 'FINALIZED', absent: true, candidates: [], winner: null,
          finalizedEvent: position.event, activation: null, confirmedStart: null };
        task.rounds.set(context.round, round); task.nextFinalizeRound += 1n;
        return { state: draft, result: cloneProtocolState(round) };
      }
      requireOriginality(round.state !== 'FINALIZED', 'ROUND_ALREADY_FINALIZED');
      requireOriginality(context.expectedPhase === round.state, 'ROUND_PHASE');
      if (round.state === 'OPEN' || round.scanEpoch !== task.safetyEpoch) resetScan(task, round);
      requireOriginality(context.expectedCandidateCursor === round.candidateCursor
        && context.expectedKnowledgeCursor === (round.state === 'SCAN_BASELINE' ? round.baselineCursor : round.knowledgeCursor), 'ROUND_CURSOR');
      if (round.state === 'SCAN_BASELINE') {
        for (let n = 0; n < context.maxScan && round.baselineCursor < round.scanKnowledgeCount; n += 1) {
          const entry = task.knowledge[Number(round.baselineCursor++)];
          requireOriginality(entry, 'KNOWLEDGE_GAP');
          if (entry.validity === 'ACCEPTED' && effectiveKnowledgeIndex(task, entry) < round.startKnowledgeCount)
            round.baseline = chooseBest(round.baseline, entry);
        }
        if (round.baselineCursor === round.scanKnowledgeCount) round.state = 'SCAN_CANDIDATES';
      } else if (round.state === 'SCAN_CANDIDATES') {
        if (round.candidateCursor < BigInt(round.candidates.length)) {
          const candidate = round.candidates[Number(round.candidateCursor)];
          for (let n = 0; n < context.maxScan && round.knowledgeCursor < round.scanKnowledgeCount; n += 1) {
            const entry = task.knowledge[Number(round.knowledgeCursor++)]; requireOriginality(entry, 'KNOWLEDGE_GAP');
            if (entry.validity === 'ACCEPTED' && effectiveKnowledgeIndex(task, entry) < round.knowledgeEndCount && entry.C <= candidate.C
              && (round.minDisclosure === null || entry.firstDisclosure < round.minDisclosure)) round.minDisclosure = entry.firstDisclosure;
          }
          if (round.knowledgeCursor === round.scanKnowledgeCount) {
            const own = task.knowledge[Number(candidate.knowledgeIndex)];
            requireOriginality(own && own.qualifiedEvent === candidate.qualifiedEvent && own.index < round.knowledgeEndCount, 'CANDIDATE_KNOWLEDGE');
            const eligible = own.validity === 'ACCEPTED' && round.minDisclosure !== null && candidate.commitEvent < round.minDisclosure
              && (round.baseline === null || candidate.C < round.baseline.C);
            const old = round.bestCandidate;
            if (eligible && (!old || candidate.C < old.C || (candidate.C === old.C && (candidate.commitEvent < old.commitEvent
              || (candidate.commitEvent === old.commitEvent && Buffer.compare(candidate.manufactureM, old.manufactureM) < 0))))) round.bestCandidate = candidate;
            round.candidateCursor += 1n; round.knowledgeCursor = 0n; round.minDisclosure = null;
          }
        }
        if (round.candidateCursor === BigInt(round.candidates.length)) round.state = 'READY';
      } else if (round.state === 'READY') {
        const position = touch(task, context.now, context.slot);
        if (round.bestCandidate) {
          const candidate = round.bestCandidate, id = winnerKey(base.domain, round.id);
          const winner = { ...cloneProtocolState(candidate), id, selectedEvent: position.event, selectedTime: context.now };
          requireOriginality(!task.winners.has(key32(id)), 'WINNER_ALREADY_EXISTS');
          task.winners.set(key32(id), winner); round.winner = id;
          attachWinner(draft, task, round, winner, context.now);
        }
        round.finalizedEvent = position.event; round.state = 'FINALIZED'; task.nextFinalizeRound += 1n;
      }
      return { state: draft, result: cloneProtocolState(round) };
    },
    activateWinner(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft); observe(task, context.now);
      requireOriginality(!task.paused, 'TASK_PAUSED');
      const winner = task.winners.get(key32(context.winnerId));
      requireOriginality(winner && equalBytes(winner.author, context.actor) && task.best?.C === winner.C, 'WINNER_NOT_CURRENT');
      const settlement = SettlementEngine.fromSnapshot(draft.settlement);
      const result = settlement.executePrepared('activateK', { actor: key32(context.actor), now: context.now,
        instance: key32(winner.root), winnerId: key32(winner.id) });
      draft.settlement = settlement.snapshot(); task.generation = add(task.generation); touch(task, context.now, context.slot);
      return { state: draft, result };
    },
    /** Route owner EXIT through this hook whenever an OPEN K may be stopped. */
    exitStake(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft);
      const settlement = SettlementEngine.fromSnapshot(draft.settlement), before = settlement.snapshot();
      const reg = before.registrations.get(key32(context.rootId));
      const lastId = reg?.activations.at(-1), previous = lastId ? before.activations.get(lastId) : null;
      if (previous?.end === null) observe(task, context.now);
      const result = settlement.executePrepared('exit', { actor: key32(context.actor), now: context.now,
        instance: key32(context.rootId), seq: context.seq });
      const after = settlement.snapshot();
      if (previous?.end === null && after.activations.get(lastId).end !== null) {
        task.generation = add(task.generation); touch(task, context.now, context.slot);
      }
      draft.settlement = after;
      return { state: draft, result };
    },
    proveFault(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft);
      requireOriginality(context.now >= rewardStart && context.expectedEpoch === task.safetyEpoch, 'SAFETY_EPOCH_OR_WINDOW');
      n64(context.knowledgeIndex); observe(task, context.now);
      const entry = task.knowledge[Number(context.knowledgeIndex)];
      requireOriginality(entry?.index === context.knowledgeIndex && entry.validity === 'ACCEPTED', 'SAFETY_ALREADY_INVALID_OR_MISSING');
      const analysis = analyzeEvidence(draft, task, entry);
      requireOriginality(analysis.outcome !== 'UNKNOWN', 'SAFETY_REPLAY_UNKNOWN');
      requireOriginality(analysis.outcome === 'FAULT', 'SAFETY_NOT_A_FAULT');
      const qualifiedCorrection = taskQualified(analysis.evidence);
      const originKnowledgeIndex = qualifiedCorrection && !analysis.preserveHistoricalOrigin
        ? BigInt(task.knowledge.length) : effectiveKnowledgeIndex(task, entry);
      const epoch = add(task.safetyEpoch), id = typedHash(14, new ByteWriter(42).raw(base.domain).u16(20).u64(epoch).finish());
      const position = touch(task, context.now, context.slot);
      const proof = { id, epoch, knowledgeIndex: entry.index, originKnowledgeIndex, faultType: analysis.faultType,
        baseKind: entry.baseKind, baseRef: entry.baseRef, faultEvent: position.event, time: context.now,
        state: 'PAUSED', cursor: 0n, target: 0n, observedCount: 0n, best: null,
        correctedIndex: null, correctedEvidence: null, recoveredEvent: null };
      task.safetyEpoch = epoch; task.paused = true; task.generation = add(task.generation);
      task.safeties.set(key32(id), proof); entry.validity = 'FAULT_INVALID'; entry.fault = id;
      const settlement = SettlementEngine.fromSnapshot(draft.settlement);
      if (analysis.rootBad) settlement.invalidateCertificate({ instance: key32(entry.baseRef),
        now: context.now, faultReference: key32(id) });
      settlement.pauseTask({ now: context.now, faultReference: key32(id) });
      draft.settlement = settlement.snapshot();
      if (qualifiedCorrection) {
        const design = designId(analysis.evidence.graph, base);
        const disclosure = disclose(task, design, analysis.evidence, context.actor, context.now, context.slot);
        const qualified = touch(task, context.now, context.slot);
        const corrected = appendKnowledge(draft, task, analysis.evidence, disclosure, qualified, 2, id);
        proof.correctedIndex = corrected.index;
        proof.correctedEvidence = { report: cloneProtocolState(analysis.evidence.report), admissionId: analysis.evidence.admissionId };
      }
      proof.target = BigInt(task.knowledge.length); proof.observedCount = proof.target;
      return { state: draft, result: cloneProtocolState(proof) };
    },
    auditNext(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft); observe(task, context.now);
      requireOriginality(task.paused && context.expectedEpoch === task.safetyEpoch, 'SAFETY_EPOCH_OR_PAUSE');
      const proof = [...task.safeties.values()].find(p => p.epoch === task.safetyEpoch);
      requireOriginality(proof && proof.state !== 'RECOVERED' && context.expectedCursor === proof.cursor, 'SAFETY_CURSOR');
      if (proof.cursor < proof.target) {
        const entry = task.knowledge[Number(proof.cursor)]; requireOriginality(entry, 'KNOWLEDGE_GAP');
        if (entry.validity === 'FAULT_INVALID') {
          const old = task.safeties.get(key32(entry.fault));
          requireOriginality(old && old.knowledgeIndex === entry.index, 'INVALID_FAULT_LINK');
        } else {
          const analysis = analyzeEvidence(draft, task, entry);
          requireOriginality(analysis.outcome !== 'UNKNOWN', 'SAFETY_REPLAY_UNKNOWN');
          requireOriginality(analysis.outcome === 'MATCH', 'AUDIT_NEW_FAULT');
          proof.best = chooseBest(proof.best, entry);
        }
        proof.cursor += 1n;
      }
      const count = BigInt(task.knowledge.length);
      if (proof.cursor === proof.target && count > proof.target) {
        proof.target = count; proof.observedCount = count;
      }
      proof.state = proof.cursor === proof.target && proof.observedCount === count ? 'READY' : 'SCANNING';
      return { state: draft, result: cloneProtocolState(proof) };
    },
    recoverTask(state, context) {
      auth(context); const draft = cloneProtocolState(state), task = stateOf(draft); observe(task, context.now);
      requireOriginality(task.paused && context.expectedEpoch === task.safetyEpoch, 'SAFETY_EPOCH_OR_PAUSE');
      const proof = [...task.safeties.values()].find(p => p.epoch === task.safetyEpoch);
      const count = BigInt(task.knowledge.length);
      requireOriginality(proof?.state === 'READY' && proof.cursor === count && proof.target === count
        && proof.observedCount === count && context.expectedKnowledgeCount === count, 'SAFETY_NOT_READY_OR_TAIL_CHANGED');
      task.best = cloneProtocolState(proof.best); task.paused = false; task.generation = add(task.generation);
      const position = touch(task, context.now, context.slot); proof.state = 'RECOVERED'; proof.recoveredEvent = position.event;
      const settlement = SettlementEngine.fromSnapshot(draft.settlement);
      settlement.recoverTaskFrontier({ now: context.now, faultReference: key32(proof.id), bestCost: task.best?.C ?? null });
      draft.settlement = settlement.snapshot();
      return { state: draft, result: cloneProtocolState(proof) };
    },
  });
}
