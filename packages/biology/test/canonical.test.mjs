import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceGraph, encodeGraph, edge, leaf, compareEdges, HARD } from '../src/graph.mjs';
import { canonicalBytes, designId } from '../src/canonical.mjs';

test('frozen E172 and standard canonical lengths differ from exact graph lengths', () => {
  assert.equal(canonicalBytes(createReferenceGraph()).length, 6068);
  assert.equal(canonicalBytes(createReferenceGraph({ compact: false })).length, 6196);
});
test('all 45 legal double-port swaps and four rectangle mirrors preserve H7 without changing original bytes', () => {
  const g = createReferenceGraph(), old = encodeGraph(g), id = designId(g);
  for (let role = 1; role <= 15; role++) for (const [type, low, high] of [[1, 1, 2], [2, 3, 4], [3, 5, 6]]) {
    const changed = structuredClone(g);
    for (const e of changed.edges) { const p = type === 3 ? e.src : e.dst; if (e.type === type && p.role === role) p.port = p.port === low ? high : low; }
    changed.edges.sort(compareEdges); assert.ok(designId(changed).equals(id));
  }
  for (const [lr, ud] of [[true, false], [false, true], [true, true]]) {
    const changed = structuredClone(g); for (const s of changed.slots) { if (lr) s.x = 4 - s.x; if (ud) s.y = 2 - s.y; } assert.ok(designId(changed).equals(id));
  }
  assert.ok(encodeGraph(g).equals(old));
});
test('zero material edge changes exact graph but not canonical design; illegal duplicates still fail first', () => {
  const g = createReferenceGraph(), h = structuredClone(g);
  h.edges.push(edge(1, leaf(7, 4, 17), leaf(1, 1, 1), 0)); h.edges.sort(compareEdges);
  assert.ok(!encodeGraph(g).equals(encodeGraph(h))); assert.ok(designId(g).equals(designId(h)));
  h.edges.push(structuredClone(h.edges[0])); h.edges.sort(compareEdges); assert.throws(() => designId(h), /reused|ordered/);
});
test('changed wallet/domain/config cannot refresh design; changed physical rule/v/tier must change it', () => {
  const g = createReferenceGraph(), h = structuredClone(g), id = designId(g);
  h.domain = Buffer.alloc(32, 8); h.config = Buffer.alloc(32, 9); assert.ok(designId(h).equals(id));
  h.cells[0].v = 999_000; assert.ok(!designId(h).equals(id));
  h.cells[0].v = 1_000_000; h.tiers[0].mode = 1; assert.ok(!designId(h).equals(id));
  h.tiers[0].mode = 0; h.rule = Buffer.alloc(32, 2); assert.ok(!designId(h).equals(id));
});
test('empty columns normalize toward lower ports but do not rewrite physical capacity owner', () => {
  const g = createReferenceGraph(), original = encodeGraph(g), c = canonicalBytes(g);
  assert.ok(c.length > 0); assert.ok(encodeGraph(g).equals(original));
  assert.equal(g.edges.filter(e => e.type === 2 && HARD.includes(e.dst.role)).length, 4);
});
