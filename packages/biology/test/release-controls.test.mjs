import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceGraph, validateGraph, compareEdges } from '../src/graph.mjs';
import { initialState, sense, makePlan, compileRuntime, stepRound } from '../src/runtime.mjs';

const U = 1_000_000n, graph = createReferenceGraph(), compiled = compileRuntime(graph);
const stocks = ordinal => Array.from({ length: 15 }, (_, i) => ordinal === i + 1 ? U / 2n : U);
const phaseState = (phase, ordinal = 0) => {
  const state = initialState();
  if (phase) { state.xA = U / 2n; state.xB = -U / 2n; }
  state.cells.forEach((c, i) => { c.N = stocks(ordinal)[i]; c.I = phase; });
  return state;
};

// FUNC2 release acceptance of a fixed controller. The suite1 Frame736 transport
// was retired; these do not pretend to be suite1 probe/transcript records.
for (let f = 0; f <= 1; f++) for (let b = 0; b <= 1; b++) for (let phase = 0; phase <= 1; phase++) {
  test(`release ENVPOSE f${f} b${b} phase${phase}`, () => {
    const result = stepRound(compiled, phaseState(phase), [f, b], 2_000_000);
    const mode = f === 0 ? 'STARVE' : b === 1 ? 'HOLD' : 'RUN';
    assert.equal(result.snapshot.mode, mode);
    assert.equal(result.snapshot.phase, phase);
    assert.equal(result.snapshot.target, 0); assert.equal(result.snapshot.d, 0n);
    const outputPhase = mode === 'RUN' ? 1 - phase : phase;
    assert.equal(result.state.xA, outputPhase ? U / 2n : -U / 2n);
    assert.equal(result.state.xB, -result.state.xA);
    assert.ok(result.plan.u1.every((n, i) => n === (mode === 'RUN' && ![2, 8, 13, 14].includes(i) ? U : 0n)));
    if (mode === 'STARVE') assert.ok(result.plan.u0.every(n => n === 0n));
    assert.ok(result.state.cells.every(c => c.I === (mode === 'STARVE' || mode === 'HOLD' ? 2 : outputPhase)));
  });
}
for (let ordinal = 0; ordinal <= 15; ordinal++) {
  test(`release BODY immutable round-start read ${ordinal}`, () => {
    const input = stocks(ordinal), expected = [...input], snapshot = sense(input, 1, 0, 0);
    input.fill(0n);
    assert.deepEqual(snapshot.N0, expected);
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.N0));
    assert.throws(() => { snapshot.N0[0] = 0n; });
    const result = stepRound(compiled, phaseState(0, ordinal), [1, 0], 2_000_000);
    assert.deepEqual(result.snapshot.N0, expected, 'the exposed snapshot must precede maintenance');
    assert.notDeepEqual(result.snapshot.N0, expected.map(n => n - U / 4n));
  });
  for (let b = 0; b <= 1; b++) for (let phase = 0; phase <= 1; phase++) {
    test(`release MODE_SAFE stock${ordinal} b${b} phase${phase}`, () => {
      const snapshot = sense(stocks(ordinal), 1, b, phase), plan = makePlan(snapshot, graph.cells, 2_000_000);
      assert.equal(snapshot.mode, ordinal ? 'RECOVER' : b ? 'HOLD' : 'RUN');
      assert.equal(snapshot.target, ordinal); assert.equal(snapshot.d, ordinal ? U / 2n : 0n);
      for (let i = 0; i < 15; i++) {
        const safe = ordinal !== 0 || b !== 0, muscle = i === 9 || i === 10;
        const u0 = safe && muscle ? 0n : U;
        const u1 = !safe && ![2, 8, 13, 14].includes(i) ? U : 0n;
        assert.equal(plan.u0[i], u0); assert.equal(plan.u1[i], u1);
        const m = (U + u0 + u1) / 4n;
        assert.equal(plan.m[i], m);
        assert.equal(plan.feed[i], m + (ordinal === i + 1 ? U / 2n : 0n));
      }
      const result = stepRound(compiled, phaseState(phase, ordinal), [1, b], 2_000_000);
      assert.deepEqual(result.plan, plan);
      assert.ok(result.state.cells.every(c => c.N === U && c.E === 0n && c.W === 0n && c.J === U));
    });
  }
}

const attempts = [
  ['cut sensor BASE', g => g.edges.splice(g.edges.findIndex(e => e.type === 8 && e.src.role === 12 && e.src.port === 80), 1)],
  ['cut sensor BODY', g => g.edges.splice(g.edges.findIndex(e => e.type === 8 && e.src.role === 12 && e.src.port === 81), 1)],
  ['cut integrator BASE_PLAN', g => g.edges.splice(g.edges.findIndex(e => e.type === 8 && e.src.role === 13 && e.src.port === 80), 1)],
  ['cut integrator BOOST_PLAN', g => g.edges.splice(g.edges.findIndex(e => e.type === 8 && e.src.role === 13 && e.src.port === 81), 1)],
  ['swap BASE and BODY', g => { for (const e of g.edges) if (e.type === 8 && e.src.role === 12) e.src.port = e.src.port === 80 ? 81 : 80; }],
  ['replace BODY source with external constant', g => { const e = g.edges.find(e => e.type === 8 && e.src.role === 12); e.src.kind = 3; }],
  ['replace round-start read with another port', g => { const e = g.edges.find(e => e.type === 7 && e.src.kind === 0 && e.src.sub === 1); e.src.port = 11; }],
  ['duplicate BOOST receipt path', g => { g.edges.push(structuredClone(g.edges.find(e => e.type === 8 && e.src.port === 81))); }],
  ['remove mandatory DUT action', g => { g.edges.splice(g.edges.findIndex(e => e.type === 9), 1); }],
  ['borrow neighbouring energy', g => { const e = g.edges.find(e => e.type === 5); e.src.role = e.src.role === 1 ? 2 : 1; }],
  ['attach virtual external force', g => { g.edges.find(e => e.type === 10).src.kind = 3; }],
  ['remove mandatory R/J real path', g => { g.edges.splice(g.edges.findIndex(e => e.type === 4), 1); }],
];
for (const [name, change] of attempts) test(`fixed catalog rejects graph attempt: ${name}`, () => {
  const changed = createReferenceGraph(); change(changed); changed.edges.sort(compareEdges);
  assert.throws(() => validateGraph(changed));
});
for (let role = 1; role <= 15; role++) test(`local isolation never substitutes another role for mandatory role${role}`, () => {
  const changed = createReferenceGraph();
  changed.edges.splice(changed.edges.findIndex(e => e.type === 6 && e.dst.role === role), 1);
  assert.throws(() => validateGraph(changed));
});
