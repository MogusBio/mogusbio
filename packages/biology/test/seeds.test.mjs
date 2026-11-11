import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, createImprovement, FROZEN_SEED_COSTS } from '../src/seeds.mjs';
import { projectGraph, encodeGraph } from '../src/graph.mjs';
import { runSuite } from '../src/runtime.mjs';
import { designId } from '../src/canonical.mjs';

test('all twelve frozen public seeds really execute at q2 and match independently frozen task costs', () => {
  const designs = new Set();
  for (const [index, expected] of FROZEN_SEED_COSTS.entries()) {
    const g = createSeed(index), report = runSuite(g);
    assert.equal(report.quality, 2_000_000); assert.equal(report.cost, expected); designs.add(designId(g).toString('hex'));
  }
  assert.equal(designs.size, 12);
});
test('paired self-source rewiring is a real legal C324 improvement over C328, without changing frozen parameters', () => {
  const base = createSeed(11), candidate = createImprovement({ surfaces: false }), report = runSuite(candidate);
  assert.equal(report.cost, 324); assert.equal(report.quality, 2_000_000);
  assert.equal(encodeGraph(candidate).length, encodeGraph(base).length); assert.notEqual(designId(candidate).toString('hex'), designId(base).toString('hex'));
});
test('adding paired self-surface connections yields C320 and every required lower subtree can actually be manufactured', () => {
  const candidate = createImprovement(), report = runSuite(candidate);
  assert.equal(report.cost, 320); assert.equal(report.taskApplicable, true);
  for (let target = 1; target <= 22; target++) {
    const child = projectGraph(candidate, target), checked = runSuite(child);
    assert.equal(checked.quality, [3,9,14,15,21].includes(target) ? 1_000_000 : 2_000_000);
  }
});
