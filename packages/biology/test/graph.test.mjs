import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceGraph, validateGraph, fixedEdges, encodeGraph, decodeGraph, sha256, projectGraph, assertChildUnchanged, compareEdges, edge, leaf } from '../src/graph.mjs';

test('frozen C03 golden checksum independently matches exact 308-byte encoding', () => {
  const bytes = encodeGraph(createReferenceGraph({ target: 3 }));
  assert.equal(bytes.length, 308);
  assert.equal(sha256(bytes).toString('hex'), '7e41635a73d845912b916953e46f7c6929cd4d45d9872b0d76b6bc97815615d6');
});
test('all fixed type counts and reference total match frozen graph limits', () => {
  const counts = new Map(); for (const e of fixedEdges()) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  assert.deepEqual([...counts].sort((a, b) => a[0] - b[0]), [[4, 90], [5, 45], [6, 30], [7, 53], [8, 24], [9, 12], [10, 6]]);
  assert.equal(encodeGraph(createReferenceGraph()).length, 6145);
  assert.equal(encodeGraph(createReferenceGraph({ compact: false })).length, 6273);
});
test('all 22 complete subtrees round-trip and parent projections preserve their exact bytes', () => {
  const full = createReferenceGraph();
  for (let scope = 1; scope <= 22; scope++) {
    const child = projectGraph(full, scope), bytes = encodeGraph(child);
    assert.ok(encodeGraph(decodeGraph(bytes)).equals(bytes));
    assertChildUnchanged(full, child);
  }
});
test('cannot change manufactured child routing/v/tier when embedding in parent', () => {
  const full = createReferenceGraph(), child = projectGraph(full, 6);
  const changed = structuredClone(full); changed.cells[5].v = 999_000;
  assert.throws(() => assertChildUnchanged(changed, child), /manufactured child/);
  changed.cells[5].v = full.cells[5].v; changed.tiers[5].mode = 1;
  assert.throws(() => assertChildUnchanged(changed, child), /manufactured child/);
});
test('missing fixed guard and missing fixed paid-task edge are rejected', () => {
  for (const type of [6, 9]) { const g = createReferenceGraph(); g.edges.splice(g.edges.findIndex(e => e.type === type), 1); assert.throws(() => validateGraph(g), /missing/); }
});
test('renaming ordered endpoints cannot duplicate capacity under another owner/type', () => {
  const g = createReferenceGraph(); const duplicate = structuredClone(g.edges.find(e => e.type === 1)); duplicate.owner = 22; g.edges.push(duplicate); g.edges.sort(compareEdges);
  assert.throws(() => validateGraph(g), /reused|ordered/);
});
test('free cross-cell energy and unapproved material ports do not become valid edges', () => {
  for (const bad of [edge(5, leaf(1, 2, 5), leaf(2, 4, 1)), edge(1, leaf(1, 4, 17), leaf(3, 1, 1), 0)]) {
    const g = createReferenceGraph(); g.edges.push(bad); g.edges.sort(compareEdges); assert.throws(() => validateGraph(g), /fixed edge|typed material/);
  }
});
test('same amount cannot be assigned once per physical port instead of once per species', () => {
  const g = createReferenceGraph(); g.edges.find(e => e.type === 1).fraction = 1_000_000;
  assert.throws(() => validateGraph(g), /fraction exceeds/);
});
test('layout is bijective and cannot introduce another cell or hidden tier', () => {
  const g = createReferenceGraph(); g.slots[1] = { ...g.slots[1], x: g.slots[0].x, y: g.slots[0].y };
  assert.throws(() => validateGraph(g), /5x3/);
  const h = createReferenceGraph(); h.nodes.push({ scope: 23, kind: 1, role: 16, parent: 22 }); assert.throws(() => validateGraph(h), /subtree/);
});
test('unapproved deployment identity rejects even a structurally legal zero-domain fixture', () => {
  const g = createReferenceGraph(), context = { domain: Buffer.alloc(32, 1), config: g.config, catalog: g.catalog, rule: g.rule };
  assert.throws(() => validateGraph(g, context), /approved context/);
});
test('malformed graph counts, reserved bytes, schemas and trailing data fail before acceptance', () => {
  const bytes = encodeGraph(createReferenceGraph());
  for (const mutate of [b => { b[11] = 1; }, b => { b[8] = 2; }, b => { b[144] = 255; }, b => { b[12] = 1; }]) {
    const bad = Buffer.from(bytes); mutate(bad); assert.throws(() => decodeGraph(bad));
  }
  assert.throws(() => decodeGraph(Buffer.concat([bytes, Buffer.of(0)])));
  assert.throws(() => decodeGraph(bytes.subarray(0, -1)));
});
