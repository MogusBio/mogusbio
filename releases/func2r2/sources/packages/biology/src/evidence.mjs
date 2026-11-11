import { ByteWriter } from '../../protocol-core/src/codec.mjs';
import { encodeGraph, decodeGraph, sha256, requireBio } from './graph.mjs';
import { runSuite } from './runtime.mjs';

export const FUNC2 = Object.freeze({ suite: 2, fixture: 1, load: 1, recordBytes: 2271 });
const modes = Object.freeze({ RUN: 0, STARVE: 1, RECOVER: 2, HOLD: 3 });
export function positiveBitmap(graph, positiveEdges) {
  const bitmap = Buffer.alloc(64);
  graph.edges.forEach((e, i) => { if (e.type <= 3 && positiveEdges.has(JSON.stringify(e))) bitmap[i >> 3] |= 1 << (i & 7); });
  return bitmap;
}
export function encodeWitness(graph, caseIndex, round, result) {
  const { snapshot, plan, state, ledger, macro } = result;
  const w = new ByteWriter(FUNC2.recordBytes).u8(caseIndex).u16(round).u8(modes[snapshot.mode]).u8(snapshot.f).u8(snapshot.b).u8(snapshot.phase).u8(snapshot.target).u64(snapshot.d);
  for (const vector of [snapshot.N0, state.cells.map(c => c.N), plan.m, plan.feed, plan.u0, plan.u1]) for (const n of vector) w.u64(n);
  w.i64(state.xA).i64(state.xB); for (const c of state.cells) w.u8(c.I);
  w.raw(positiveBitmap(graph, result.positiveEdges), 64);
  for (const l of ledger) for (const field of ['N', 'O', 'generated', 'maintenance', 'job0', 'job1', 'work', 'heat']) w.u64(l[field]);
  for (let type = 1; type <= 4; type++) for (let role = 1; role <= 15; role++) w.u64(macro.get(`${type}:${role}`) ?? 0n);
  const bytes = w.finish(); requireBio(bytes.length === FUNC2.recordBytes, 'EVIDENCE', 'FUNC2 witness has wrong size'); return bytes;
}
export function initialWitnessDigest(graphSHA, challenge) {
  return sha256(new ByteWriter(56).raw(Buffer.from('BIO6TI02')).raw(graphSHA, 32).u32(challenge).u32(FUNC2.suite).u32(FUNC2.fixture).u32(FUNC2.load).finish());
}
/** Suite2 is explicitly different from the retired full-transcript single-SHA assumption. */
export function validateDesign(inputGraph, { challenge = 2_000_000, onWitness = null } = {}) {
  // Normalize object field order through the exact wire, retaining all real zero edges and physical ports.
  const bytes = encodeGraph(inputGraph), graph = decodeGraph(bytes), graphSHA = sha256(bytes);
  let digest = initialWitnessDigest(graphSHA, challenge), count = 0;
  const report = runSuite(graph, { challenge, onRound: ({ caseIndex, round, result }) => {
    const record = encodeWitness(graph, caseIndex, round, result);
    digest = sha256(Buffer.concat([Buffer.from('BIO6TR02'), digest, record])); count++;
    onWitness?.({ caseIndex, round, record: Buffer.from(record), digest: Buffer.from(digest) });
  } });
  requireBio(count === 73, 'EVIDENCE', 'complete FUNC2 suite was not executed');
  return { status: 'PASS', evidenceVersion: 2, q_ppm: BigInt(report.quality), transcriptSHA: digest, positiveBitmap: positiveBitmap(graph, report.positiveEdges),
    taskApplicable: report.taskApplicable, C: BigInt(report.cost), graphSHA, suite: FUNC2.suite, fixture: FUNC2.fixture, load: FUNC2.load,
    productionAdmission: false, report };
}
