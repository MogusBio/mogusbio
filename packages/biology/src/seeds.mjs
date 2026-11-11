import { createReferenceGraph, HARD, edge, leaf, compareEdges, lca, anchor, validateGraph } from './graph.mjs';

const layouts = [
  [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15]],
  [[8,13,3,4,5],[6,7,1,9,10],[11,12,2,14,15]],
  [[8,6,3,4,5],[13,7,1,9,10],[11,12,2,14,15]],
  [[8,6,3,4,5],[13,2,1,9,10],[11,12,7,14,15]],
  [[8,3,6,4,5],[13,2,1,9,10],[11,12,7,14,15]],
  [[8,3,6,4,9],[13,2,1,5,10],[11,12,7,14,15]],
  [[3,8,6,4,9],[13,2,1,5,10],[11,12,7,14,15]],
  [[3,8,6,4,9],[13,2,1,5,10],[11,12,7,15,14]],
  [[3,8,6,4,9],[13,2,1,5,10],[15,12,7,11,14]],
];
const rows = [[0,0,413],[0,1,394],[0,2,375],[1,2,347],[2,2,343],[3,2,341],[4,2,340],[4,3,336],[5,3,332],[6,3,330],[7,3,330],[8,3,328]];
export const FROZEN_SEED_COSTS = Object.freeze(rows.map(row => row[2]));
export function createSeed(index, identities = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) throw new RangeError('unknown frozen seed');
  const [layout, routing] = rows[index], slots = layouts[layout].flatMap((row, y) => row.map((role, x) => ({ role, x, y }))).sort((a,b) => a.role - b.role);
  const g = createReferenceGraph({ ...identities, compact: false, slots });
  if (routing > 0) {
    g.edges = g.edges.filter(e => !(HARD.includes(e.type === 3 ? e.src.role : e.dst.role) && (e.type === 2 || (routing > 1 && e.type === 3))));
    for (const role of HARD) for (const type of routing === 1 ? [2] : [2,3]) {
      const macro = (routing === 3 ? [9,14] : [3,9]).includes(role) ? 1 : 2;
      g.edges.push(type === 2 ? edge(type, leaf(macro,4,17), leaf(role,1,macro + 2),1_000_000) : edge(type,leaf(role,1,macro + 4),leaf(macro,4,18),1_000_000));
    }
    g.edges.sort(compareEdges);
  }
  return validateGraph(g);
}
/** Legal paired rewiring, keeping all supplies/caps and equal normal macro totals. */
export function createImprovement({ surfaces = true, ...identities } = {}) {
  const g = createSeed(11, identities);
  for (const e of g.edges) {
    if (e.type === 1 && [6,7].includes(e.dst.role)) e.src.role = e.dst.role;
    if (surfaces && e.type === 2 && [1,2].includes(e.dst.role)) e.src.role = e.dst.role;
    if (surfaces && e.type === 3 && [1,2].includes(e.src.role)) e.dst.role = e.src.role;
    if (e.type <= 3) e.owner = lca(anchor(e.src),anchor(e.dst));
  }
  g.edges.sort(compareEdges); return validateGraph(g);
}

/** Newly public legal designs. These must be K0 knowledge before production. */
export function createFurtherImprovement({ stage = 2, ...identities } = {}) {
  if (![1, 2].includes(stage)) throw new RangeError('unknown paired routing stage');
  const g = createImprovement(identities);
  const rewire = new Map([[4, 6], [5, 7], ...(stage === 2 ? [[12, 7], [13, 6]] : [])]);
  for (const e of g.edges) if (e.type === 1 && rewire.has(e.dst.role)) {
    e.src.role = rewire.get(e.dst.role); e.owner = lca(anchor(e.src), anchor(e.dst));
  }
  g.edges.sort(compareEdges); return validateGraph(g);
}
