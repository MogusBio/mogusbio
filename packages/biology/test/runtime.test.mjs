import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceGraph, validateGraph, compareEdges, HARD } from '../src/graph.mjs';
import { initialState, compileRuntime, stepRound, runSuite, sense, makePlan, executionGraph } from '../src/runtime.mjs';

test('q2 reference executes all 73 real transitions with exact independent energy hand totals', () => {
  let phaseCount = 0;
  const report = runSuite(createReferenceGraph(), { onPhase: () => phaseCount++ });
  assert.equal(report.rounds, 73); assert.equal(phaseCount, 511); assert.equal(report.quality, 2_000_000);
  assert.equal(report.taskApplicable, true); assert.equal(report.productionAdmission, false);
  assert.deepEqual(report.cases[0].rounds[0].totals, { food: 10_250_000n, consumed: 10_250_000n, oxygen: 10_250_000n, waste: 10_250_000n, energy: 41_000_000n, work: 4_000_000n, heat: 78_000_000n, potential: 82_000_000n });
});
test('q1 lower challenge pays base service rather than invented boost', () => {
  const report = runSuite(createReferenceGraph(), { challenge: 1_000_000 });
  assert.equal(report.quality, 1_000_000); assert.equal(report.taskApplicable, false);
  assert.deepEqual(report.cases[0].rounds[0].totals, { food: 7_500_000n, consumed: 7_500_000n, oxygen: 7_500_000n, waste: 7_500_000n, energy: 30_000_000n, work: 2_000_000n, heat: 58_000_000n, potential: 60_000_000n });
});
test('two starvation rounds use real stored nutrient and one-target-at-a-time recovery restores all cells', () => {
  const s2r = runSuite(createReferenceGraph()).cases[1];
  assert.ok(s2r.rounds[1].state.cells.every(c => c.N === 500_000n));
  assert.equal(s2r.rounds[0].totals.heat, 30_000_000n);
  for (let k = 0; k < 15; k++) {
    const r = s2r.rounds[k + 2]; assert.equal(r.snapshot.target, k + 1); assert.equal(r.snapshot.d, 500_000n);
    assert.equal(r.state.cells.reduce((s, c) => s + c.N, 0n), 7_500_000n + BigInt(k + 1) * 500_000n);
    assert.equal(r.totals.food, 7_500_000n); assert.equal(r.totals.work, 0n);
  }
  assert.ok(s2r.state.cells.every(c => c.N === 1_000_000n && c.I === 1));
});
test('obstacle removes boost and mechanical work while retaining real paid maintenance/support', () => {
  const h = runSuite(createReferenceGraph()).cases[2];
  assert.equal(h.rounds[0].snapshot.mode, 'HOLD'); assert.equal(h.rounds[0].totals.energy, 28_000_000n);
  assert.equal(h.rounds[0].totals.heat, 56_000_000n); assert.equal(h.rounds[0].totals.work, 0n);
  assert.ok(h.state.cells.every(c => c.N === 1_000_000n && c.I === 0));
});
test('mixed starvation and obstacle priorities, all 15 recovery targets, and complete state cycle', () => {
  const sh = runSuite(createReferenceGraph()).cases[3];
  assert.equal(sh.rounds[0].snapshot.mode, 'STARVE');
  for (let k = 0; k < 15; k++) { assert.equal(sh.rounds[k + 1].snapshot.target, k + 1); assert.equal(sh.rounds[k + 1].snapshot.d, 250_000n); assert.equal(sh.rounds[k + 1].totals.food, 7_250_000n); }
  assert.equal(sh.rounds[16].snapshot.mode, 'HOLD'); assert.deepEqual(sh.state, initialState());
});
test('heat never decreases while paid muscle work waits for mechanical phase', () => {
  const phaseHeat = [];
  stepRound(compileRuntime(createReferenceGraph()), initialState(), [1, 0], 2_000_000, e => phaseHeat.push(e.ledger.reduce((s, l) => s + l.heat, 0n)));
  for (let i = 1; i < phaseHeat.length; i++) assert.ok(phaseHeat[i] >= phaseHeat[i - 1]);
  assert.equal(phaseHeat.at(-1), 78_000_000n);
});
test('virtual fixture preserves all real edges and cannot erase existing COMMON capacity', () => {
  const cell = createReferenceGraph({ target: 1 }), full = executionGraph(cell);
  assert.ok(cell.edges.every(e => full.edges.some(f => JSON.stringify(e) === JSON.stringify(f))));
  assert.equal(runSuite(cell).quality, 2_000_000);
  const g = createReferenceGraph(); g.tiers.find(t => t.scope === 22).mode = 1;
  assert.throws(() => runSuite(g), /cut exceeded/);
});
test('hard targets certify support at challenge two but return fixed quality one', () => {
  const g = createReferenceGraph({ target: 3 });
  assert.equal(runSuite(g).quality, 1_000_000);
  assert.throws(() => runSuite(g, { challenge: 1_000_000 }), /support challenge two/);
});
test('a legal graph may fail q2 because its sources are unbalanced, rather than receive an average quality', () => {
  const g = createReferenceGraph();
  for (const e of g.edges) if (HARD.includes(e.type === 3 ? e.src.role : e.dst.role)) { if (e.type === 2) e.src.role = 1; if (e.type === 3) e.dst.role = 1; }
  for (const e of g.edges) if (e.type <= 3) {
    // Refresh only the derived LCA after intentionally rewiring the actual graph.
    const { lca, anchor } = graphHelpers; e.owner = lca(anchor(e.src), anchor(e.dst));
  }
  g.edges.sort(compareEdges); validateGraph(g); assert.throws(() => runSuite(g), /quality below/);
});
import * as graphHelpers from '../src/graph.mjs';
test('one weak muscle cannot borrow another muscle or virtual force to reach requested load', () => {
  const g = createReferenceGraph(); g.cells.find(c => c.role === 10).v = 0;
  assert.throws(() => runSuite(g), /muscle work not funded/);
});
test('control boost cannot be copied or generated without actual second sensor service', () => {
  const g = createReferenceGraph(); g.cells.find(c => c.role === 12).v = 0;
  assert.throws(() => runSuite(g), /sensor\/integrator/);
});
test('strict integer routing rejects the known partial-fixture .001 hole, permits integral .002', () => {
  const g = createReferenceGraph({ target: 4 });
  assert.throws(() => runSuite(g, { challenge: 1_001_000 }), /non-integral branch/);
  assert.equal(runSuite(g, { challenge: 1_002_000 }).quality, 1_002_000);
});
test('controller uses round-start N, food availability wins over obstacle, recovery precedes hold', () => {
  const n = Array(15).fill(1_000_000n); n[8] = 500_000n;
  assert.equal(sense(n, 0, 1, 0).mode, 'STARVE'); assert.equal(sense(n, 1, 1, 1).target, 9);
  assert.equal(sense(n, 1, 1, 1).d, 500_000n);
});
test('hostile boundary state cannot carry energy, cache, J drift or illegal axis positions', () => {
  const compiled = compileRuntime(createReferenceGraph());
  for (const mutate of [s => s.cells[0].E = 1n, s => s.cells[0].W = 1n, s => s.cells[0].J = 999_999n, s => s.xA = 0n]) {
    const s = initialState(); mutate(s); assert.throws(() => stepRound(compiled, s, [1, 0], 2_000_000));
  }
});
