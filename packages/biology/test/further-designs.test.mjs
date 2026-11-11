import test from 'node:test';
import assert from 'node:assert/strict';
import { createFurtherImprovement } from '../src/seeds.mjs';
import { projectGraph, encodeGraph } from '../src/graph.mjs';
import { validateDesign } from '../src/evidence.mjs';

for (const [stage, cost] of [[1, 318n], [2, 316n]]) test(`public C${cost} really passes all22 manufacturing scopes with unchanged primitives`, () => {
  const graph = createFurtherImprovement({ stage });
  assert.equal(encodeGraph(graph).length, 6145);
  assert.equal(graph.edges.length, 342);
  for (let target = 1; target <= 22; target++) {
    const report = validateDesign(projectGraph(graph, target));
    assert.equal(report.q_ppm, [3, 9, 14, 15, 21].includes(target) ? 1_000_000n : 2_000_000n);
    assert.equal(report.C, target === 22 ? cost : 0n);
    assert.equal(report.taskApplicable, target === 22);
  }
});
