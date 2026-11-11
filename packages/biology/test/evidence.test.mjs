import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, createImprovement } from '../src/seeds.mjs';
import { validateDesign, initialWitnessDigest } from '../src/evidence.mjs';
import { sha256, encodeGraph, projectGraph } from '../src/graph.mjs';

test('FUNC2 hashes exactly 73 independently chained 2271-byte witnesses', () => {
  const graph = createImprovement(); let digest = initialWitnessDigest(sha256(encodeGraph(graph)), 2_000_000), count = 0;
  const evidence = validateDesign(graph, { onWitness: e => {
    assert.equal(e.record.length, 2271); assert.equal(e.record[0], e.caseIndex); assert.equal(e.record.readUInt16LE(1), e.round);
    digest = sha256(Buffer.concat([Buffer.from('BIO6TR02'), digest, e.record])); assert.ok(digest.equals(e.digest)); count++;
  } });
  assert.equal(count, 73); assert.ok(evidence.transcriptSHA.equals(digest)); assert.equal(evidence.C, 320n); assert.equal(evidence.q_ppm, 2_000_000n);
  assert.equal(evidence.productionAdmission, false);
});
test('actual graph bytes, deployment identity and challenge bind the witness; H7 equivalence does not replace the actual graph', () => {
  const g = createSeed(11), a = validateDesign(g), b = validateDesign(g, { challenge: 1_000_000 });
  assert.ok(!a.transcriptSHA.equals(b.transcriptSHA));
  const changed = structuredClone(g); changed.domain = Buffer.alloc(32, 9); assert.ok(!a.transcriptSHA.equals(validateDesign(changed).transcriptSHA));
  changed.domain = g.domain; changed.slots = changed.slots.map(s => ({ ...s, x: 4 - s.x })); assert.ok(!a.transcriptSHA.equals(validateDesign(changed).transcriptSHA));
});
test('partial targets include only real original graph edge indices in the union bitmap', () => {
  const graph = projectGraph(createImprovement(), 6), evidence = validateDesign(graph);
  for (let i = 0; i < 512; i++) if (evidence.positiveBitmap[i >> 3] & (1 << (i & 7))) {
    assert.ok(i < graph.edges.length); assert.ok(graph.edges[i].type <= 3); assert.ok(graph.edges[i].fraction > 0);
  }
  assert.equal(evidence.taskApplicable, false); assert.equal(evidence.C, 0n);
});
