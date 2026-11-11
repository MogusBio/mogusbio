import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSeed, createImprovement } from '../packages/biology/src/seeds.mjs';
import { createReferenceGraph, projectGraph, encodeGraph, sha256 } from '../packages/biology/src/graph.mjs';
import { runSuite } from '../packages/biology/src/runtime.mjs';
import { designId } from '../packages/biology/src/canonical.mjs';
import { validateDesign } from '../packages/biology/src/evidence.mjs';

const out = fileURLToPath(new URL('../fixtures/graphs/', import.meta.url));
mkdirSync(out, { recursive: true });
const cases = Array.from({ length: 12 }, (_, i) => [`seed-${String(i).padStart(2, '0')}`, createSeed(i)]);
cases.push(['candidate-c324', createImprovement({ surfaces: false })], ['candidate-c320', createImprovement()], ['golden-c03-zero', createReferenceGraph({ target: 3 })]);
for (let target = 1; target <= 22; target++) cases.push([`c320-scope-${String(target).padStart(2,'0')}`, projectGraph(createImprovement(), target)]);
const manifest = { format: 'BIOP6G01', fixtureOnly: true, approvedProductionDomain: false, entries: [] };
const measurements = { format: 'FUNC2', suite: 2, fixture: 1, load: 1, recordBytes: 2271, fixtureOnly: true, entries: [] };
for (const [name, graph] of cases) {
  const bytes = encodeGraph(graph), report = runSuite(graph);
  writeFileSync(`${out}/${name}.bin`, bytes);
  manifest.entries.push({ file: `${name}.bin`, bytes: bytes.length, sha256: sha256(bytes).toString('hex'), design: designId(graph).toString('hex'), target: graph.target,
    challenge: 2_000_000, quality: report.quality, taskApplicable: report.taskApplicable, cost: report.cost, rounds: report.rounds });
  const evidence = validateDesign(graph);
  measurements.entries.push({ file: `${name}.bin`, graphSHA: evidence.graphSHA.toString('hex'), q: evidence.q_ppm.toString(), cost: evidence.C.toString(),
    taskApplicable: evidence.taskApplicable, bitmap: evidence.positiveBitmap.toString('hex'), digest: evidence.transcriptSHA.toString('hex'), rounds: 73,
    cases: evidence.report.cases.map(c => ({ N: c.state.cells.map(x => x.N.toString()), I: c.state.cells.map(x => x.I), xA: c.state.xA.toString(), xB: c.state.xB.toString() })) });
}
writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${out}/expected-FUNC2.json`, `${JSON.stringify(measurements, null, 2)}\n`);
console.log(`Exported ${manifest.entries.length} exact graph fixtures for independent Rust/SBF validation`);
