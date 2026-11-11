// Independent Node expectations for structurally legal, physically rejected
// graphs. They are test inputs only; the SBF program never reads this JSON.
import { mkdir, writeFile } from 'node:fs/promises';
import { createReferenceGraph, validateGraph, encodeGraph, decodeGraph, compareEdges, HARD, lca, anchor } from '../../../packages/biology/src/graph.mjs';
import { runSuite } from '../../../packages/biology/src/runtime.mjs';

const directory = new URL('./negative-fixtures/', import.meta.url);
await mkdir(directory, { recursive: true });
const specifications = [
  { name: 'parent-common-cut', mutate: g => { g.tiers.find(t => t.scope === 22).mode = 1; }, error: 'CUT', rustCode: 8014 },
  { name: 'weak-muscle', mutate: g => { g.cells.find(c => c.role === 10).v = 0; }, error: 'MECHANICAL', rustCode: 8016 },
  { name: 'missing-sensor-boost', mutate: g => { g.cells.find(c => c.role === 12).v = 0; }, error: 'CONTROL', rustCode: 8004 },
  { name: 'partial-nonintegral', target: 4, challenge: 1_001_000, mutate: () => {}, error: 'INTEGER', rustCode: 8001 },
  { name: 'unbalanced-source-quality', mutate: g => {
    for (const e of g.edges) if (HARD.includes(e.type === 3 ? e.src.role : e.dst.role)) {
      if (e.type === 2) e.src.role = 1;
      if (e.type === 3) e.dst.role = 1;
    }
    for (const e of g.edges) if (e.type <= 3) e.owner = lca(anchor(e.src), anchor(e.dst));
    g.edges.sort(compareEdges);
  }, error: 'QUALITY', rustCode: 8019 },
];
const entries = [];
for (const spec of specifications) {
  const graph = createReferenceGraph({ target: spec.target ?? 22 }); spec.mutate(graph); validateGraph(graph);
  const raw = encodeGraph(graph), normalized = decodeGraph(raw), challenge = spec.challenge ?? 2_000_000;
  let completed = 0, failure = null;
  try { runSuite(normalized, { challenge, onRound: () => completed++ }); }
  catch (error) { failure = { code: error.code, message: error.message }; }
  if (!failure || failure.code !== spec.error) throw new Error(`${spec.name}: expected ${spec.error}, got ${JSON.stringify(failure)}`);
  const file = `${spec.name}.bin`; await writeFile(new URL(file, directory), raw);
  entries.push({ file, bytes: raw.length, challenge, completedRounds: completed, failure, rustCode: spec.rustCode });
}
await writeFile(new URL('expected.json', directory), JSON.stringify({ fixtureOnly: true, structurallyValid: true, entries }, null, 2) + '\n');
console.log(entries.map(e => `${e.file}: ${e.failure.code}, completed=${e.completedRounds}`).join('\n'));
