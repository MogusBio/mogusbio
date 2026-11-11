import { createHash } from 'node:crypto';
import { ByteReader, ByteWriter } from '../../protocol-core/src/codec.mjs';

export const MICRO = 1_000_000n;
export const DYNAMIC = Object.freeze([1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13]);
export const HARD = Object.freeze([3, 9, 14, 15]);
export const ORGAN_CELLS = Object.freeze([[1, 2], [3, 4, 5], [6, 7, 8, 9], [10, 11], [12, 13], [14, 15]]);
export const PARENT = new Map(ORGAN_CELLS.flatMap((roles, i) => roles.map(r => [r, i + 16])).concat(Array.from({ length: 6 }, (_, i) => [i + 16, 22])));
export class BiologyError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = 'BiologyError'; this.code = code; this.detail = detail; }
}
export function requireBio(condition, code, message, detail) { if (!condition) throw new BiologyError(code, message, detail); }
export const sha256 = bytes => createHash('sha256').update(bytes).digest();
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const int = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
export const leaf = (role, sub, port) => ({ kind: 0, role, sub, port });
export const endpoint = (kind, role, port, sub = 0) => ({ kind, role, sub, port });
export const endpointKey = e => `${e.kind}:${e.role}:${e.sub}:${e.port}`;
export const edgeKey = e => `${endpointKey(e.src)}>${endpointKey(e.dst)}`;
export function anchor(e) {
  if (e.kind === 1) return null;
  if ([4, 5, 6].includes(e.kind)) return e.role + 9;
  return e.role;
}
export function members(target) {
  requireBio(int(target, 1, 22), 'TREE', 'target scope outside fixed catalog');
  if (target <= 15) return [target];
  if (target <= 21) return [...ORGAN_CELLS[target - 16]];
  return Array.from({ length: 15 }, (_, i) => i + 1);
}
export function scopes(target) {
  return target <= 15 ? [target] : target <= 21 ? [...members(target), target] : Array.from({ length: 22 }, (_, i) => i + 1);
}
export function lca(a, b) {
  if (a === null || b === null) return 0;
  const ancestors = new Set();
  for (let c = a; c !== undefined; c = PARENT.get(c)) ancestors.add(c);
  for (let c = b; c !== undefined; c = PARENT.get(c)) if (ancestors.has(c)) return c;
  throw new BiologyError('TREE', 'no common fixed ancestor');
}
export function edge(type, src, dst, fraction = 0) { return { owner: lca(anchor(src), anchor(dst)), type, src, dst, fraction }; }
export function compareEdges(a, b) {
  const tuple = e => [e.owner, e.type, e.src.kind, e.src.role, e.src.sub, e.src.port, e.dst.kind, e.dst.role, e.dst.sub, e.dst.port];
  const av = tuple(a), bv = tuple(b);
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  return 0;
}
export function fixedEdges(target = 22) {
  const all = [], add = (type, src, dst) => all.push(edge(type, src, dst));
  const env = p => endpoint(1, 0, p), head = p => endpoint(7, 12, p), gt = (r, p) => endpoint(8, r, p);
  for (const r of [1, 2]) { add(4, env(1), leaf(r, 4, 16)); add(4, leaf(r, 4, 19), env(2)); }
  add(4, env(3), leaf(4, 4, 16)); add(4, leaf(4, 4, 17), leaf(5, 4, 16)); add(4, leaf(5, 4, 17), leaf(8, 4, 16));
  for (const r of [6, 7]) add(4, leaf(8, 4, 17), leaf(r, 4, 16));
  add(4, leaf(8, 4, 18), leaf(9, 4, 16)); add(4, leaf(9, 4, 17), env(4));
  add(4, env(5), leaf(15, 4, 16)); add(4, leaf(15, 4, 17), leaf(14, 4, 16));
  add(4, leaf(14, 4, 19), leaf(15, 4, 18)); add(4, leaf(15, 4, 19), env(6));
  for (let r = 1; r <= 15; r++) {
    add(4, leaf(14, 4, 17), leaf(r, 1, 10)); add(4, leaf(r, 1, 11), leaf(14, 4, 18));
    add(4, leaf(r, 1, 7), leaf(r, 2, 1)); add(4, leaf(r, 1, 8), leaf(r, 2, 2)); add(4, leaf(r, 2, 3), leaf(r, 1, 9));
    add(5, leaf(r, 2, 4), endpoint(2, r, 1));
    for (let s = 0; s < 2; s++) { add(5, leaf(r, 2, s + 5), endpoint(3, r, 1, s)); add(6, leaf(r, 3, s + 3), leaf(r, 4, s + 1)); }
    add(7, leaf(r, 1, 12), leaf(12, 4, 31 + r)); add(7, leaf(r, 1, 12), leaf(12, 4, 63 + r)); add(7, leaf(r, 1, 12), head(15 + r));
  }
  add(7, env(7), leaf(12, 4, 16)); add(7, env(8), leaf(12, 4, 17));
  add(7, endpoint(4, 1, 2), leaf(12, 4, 18)); add(7, endpoint(4, 2, 2), leaf(12, 4, 19));
  add(7, env(7), head(1)); add(7, env(8), head(2));
  add(7, head(32), leaf(12, 2, 7)); add(7, head(32), leaf(12, 3, 5));
  add(8, leaf(12, 4, 80), leaf(13, 3, 1)); add(8, leaf(12, 4, 81), leaf(13, 3, 2));
  for (const r of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15]) add(8, leaf(13, 4, 80), leaf(r, 3, 1));
  for (const r of [1, 2, 4, 5, 6, 7, 8, 10, 11]) add(8, leaf(13, 4, 81), leaf(r, 3, 2));
  for (const r of [1, 2]) for (const p of [1, 2]) add(9, leaf(r, 4, 20), gt(r, p));
  for (const r of [4, 5]) add(9, leaf(3, 4, 16), gt(r, 3));
  for (const r of [6, 7, 8]) add(9, leaf(9, 4, 18), gt(r, 4));
  add(9, leaf(9, 4, 18), gt(9, 5)); for (const p of [6, 7]) add(9, leaf(15, 4, 20), gt(15, p));
  for (const [r, axis] of [[10, 1], [11, 2]]) for (const k of [4, 5, 6]) add(10, leaf(r, 4, 16), endpoint(k, axis, 1));
  const set = new Set(members(target));
  return all.filter(e => [anchor(e.src), anchor(e.dst)].every(a => a === null || set.has(a))).sort(compareEdges);
}
function group(e) { return [e.type === 3 ? e.src.role : e.dst.role, e.type]; }
function validFree(e, real) {
  if (![1, 2, 3].includes(e.type) || !int(e.fraction, 0, 1_000_000)) return false;
  if (e.src.kind !== 0 || e.dst.kind !== 0 || !real.has(e.src.role) || !real.has(e.dst.role)) return false;
  if (e.type === 1 || e.type === 2) return e.src.sub === 4 && e.src.port === 17 && (e.type === 1 ? [6, 7] : [1, 2]).includes(e.src.role)
    && e.dst.sub === 1 && (e.type === 1 ? [1, 2] : [3, 4]).includes(e.dst.port);
  return e.src.sub === 1 && [5, 6].includes(e.src.port) && [1, 2].includes(e.dst.role) && e.dst.sub === 4 && e.dst.port === 18;
}
function opensFor(roles, edges) {
  return roles.flatMap(role => [1, 2, 3].map(species => ({ role, species, remaining: 1_000_000 - edges.filter(e => {
    const [r, s] = group(e); return e.type <= 3 && r === role && s === species;
  }).reduce((sum, e) => sum + e.fraction, 0) })));
}
function nodesFor(target) { return scopes(target).map(scope => ({ scope, kind: scope <= 15 ? 1 : scope <= 21 ? 2 : 3, role: scope <= 15 ? scope : scope <= 21 ? scope - 15 : 0, parent: scope === target ? 0 : PARENT.get(scope) })); }
const rowsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validateGraph(g, context = null) {
  const roles = members(g.target), real = new Set(roles), tree = scopes(g.target);
  for (const name of ['domain', 'config', 'catalog', 'rule']) {
    requireBio(g[name] instanceof Uint8Array && g[name].length === 32, 'IDENTITY', `invalid ${name}`);
    if (context) requireBio(context[name] instanceof Uint8Array && eq(g[name], context[name]), 'IDENTITY', `${name} differs from approved context`);
  }
  requireBio(rowsEqual(g.nodes, nodesFor(g.target)), 'TREE', 'fixed subtree differs');
  requireBio(Array.isArray(g.cells) && g.cells.length === roles.length && g.cells.every((c, i) => c.role === roles[i] && int(c.v, 0, 1_000_000) && c.v % 1000 === 0 && (!HARD.includes(c.role) || c.v === 0)), 'CELL', 'invalid role/v');
  requireBio(Array.isArray(g.tiers) && g.tiers.length === tree.length && g.tiers.every((t, i) => t.scope === tree[i] && [0, 1].includes(t.mode)), 'TIER', 'invalid inherited tier');
  requireBio(Array.isArray(g.edges) && g.edges.length <= 440, 'EDGE', 'edge count outside catalog');
  const required = new Map(fixedEdges(g.target).map(e => [edgeKey(e), e])), seen = new Set();
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i], k = edgeKey(e);
    requireBio(!seen.has(k), 'DUPLICATE_EDGE', 'same ordered endpoints reused'); seen.add(k);
    requireBio(i === 0 || compareEdges(g.edges[i - 1], e) < 0, 'ORDER', 'edges not strictly ordered');
    requireBio(e.owner === lca(anchor(e.src), anchor(e.dst)), 'LCA', 'edge capacity owner differs');
    if (e.type <= 3) requireBio(validFree(e, real), 'PORT', 'illegal typed material connection');
    else { const expected = required.get(k); requireBio(expected && rowsEqual(e, expected), 'FIXED_EDGE', 'fixed edge differs'); required.delete(k); }
  }
  requireBio(required.size === 0, 'FIXED_EDGE', 'required edge missing');
  const expectedOpen = opensFor(roles, g.edges);
  requireBio(expectedOpen.every(o => o.remaining >= 0), 'FRACTION', 'species fraction exceeds one');
  requireBio(rowsEqual(g.opens, expectedOpen), 'OPEN', 'open fractions do not match actual edges');
  for (const o of expectedOpen) if (o.remaining > 0) requireBio(g.target !== 22 && (o.species === 1 ? [6, 7] : [1, 2]).some(r => !real.has(r)), 'DEAD_INTERFACE', 'no future macro peer can fill open fraction');
  requireBio(Array.isArray(g.slots) && (g.target === 22 ? g.slots.length === 15 : g.slots.length === 0), 'SLOTS', 'layout on wrong layer');
  if (g.target === 22) requireBio(g.slots.every((s, i) => s.role === i + 1 && int(s.x, 0, 4) && int(s.y, 0, 2)) && new Set(g.slots.map(s => `${s.x},${s.y}`)).size === 15, 'SLOTS', 'layout must fill 5x3 once');
  return g;
}
export function createGraph({ target = 22, freeEdges = [], v = {}, tiers = {}, slots = null, domain = Buffer.alloc(32), config = Buffer.alloc(32), catalog = Buffer.alloc(32), rule = Buffer.alloc(32) } = {}) {
  const roles = members(target), edges = [...fixedEdges(target), ...freeEdges].sort(compareEdges);
  const graph = { domain, config, catalog, rule, target, nodes: nodesFor(target), cells: roles.map(role => ({ role, v: HARD.includes(role) ? 0 : v[role] ?? 1_000_000 })),
    tiers: scopes(target).map(scope => ({ scope, mode: tiers[scope] ?? 0 })), edges, opens: opensFor(roles, edges),
    slots: target === 22 ? slots ?? roles.map((role, i) => ({ role, x: i % 5, y: Math.floor(i / 5) })) : [] };
  return validateGraph(graph);
}
export function createReferenceGraph({ compact = true, ...options } = {}) {
  const freeEdges = [];
  for (let role = 1; role <= 15; role++) {
    freeEdges.push(edge(1, leaf(6, 4, 17), leaf(role, 1, 1), 500_000), edge(1, leaf(7, 4, 17), leaf(role, 1, 2), 500_000));
    for (const type of [2, 3]) for (let port = 0; port < (compact && HARD.includes(role) ? 1 : 2); port++) {
      const macro = compact && HARD.includes(role) ? HARD.indexOf(role) % 2 + 1 : port + 1, fraction = compact && HARD.includes(role) ? 1_000_000 : 500_000;
      freeEdges.push(type === 2 ? edge(type, leaf(macro, 4, 17), leaf(role, 1, 3 + port), fraction) : edge(type, leaf(role, 1, 5 + port), leaf(macro, 4, 18), fraction));
    }
  }
  const full = createGraph({ ...options, target: 22, freeEdges });
  return options.target && options.target !== 22 ? projectGraph(full, options.target) : full;
}
export function projectGraph(g, target) {
  requireBio(scopes(g.target).includes(target), 'PROJECTION', 'child not in parent');
  const roles = members(target), set = new Set(roles);
  const edges = g.edges.filter(e => [anchor(e.src), anchor(e.dst)].every(a => a === null || set.has(a))).map(e => structuredClone(e));
  return validateGraph({ domain: Buffer.from(g.domain), config: Buffer.from(g.config), catalog: Buffer.from(g.catalog), rule: Buffer.from(g.rule), target,
    nodes: nodesFor(target), cells: g.cells.filter(c => set.has(c.role)).map(c => ({ ...c })), tiers: g.tiers.filter(t => scopes(target).includes(t.scope)).map(t => ({ ...t })),
    edges, opens: opensFor(roles, edges), slots: target === 22 ? structuredClone(g.slots) : [] });
}
export function assertChildUnchanged(parent, child) {
  requireBio(eq(encodeGraph(projectGraph(parent, child.target)), encodeGraph(child)), 'CHILD_CHANGED', 'parent changes an already manufactured child');
}
function putEndpoint(w, e) { w.u8(e.kind).u8(e.role).u8(e.sub).u16(e.port); }
function readEndpoint(r) { return { kind: r.u8(), role: r.u8(), sub: r.u8(), port: r.u16() }; }
export function encodeGraph(g) {
  validateGraph(g); const w = new ByteWriter(7697);
  for (const key of ['domain', 'config', 'catalog', 'rule']) w.raw(g[key], 32);
  w.u8(g.nodes.length); for (const n of g.nodes) w.u8(n.scope).u8(n.kind).u8(n.role).u8(n.parent);
  w.u8(g.cells.length); for (const c of g.cells) w.u8(c.role).u32(c.v);
  w.u8(g.tiers.length); for (const t of g.tiers) w.u8(t.scope).u8(t.mode);
  w.u16(g.edges.length); for (const e of g.edges) { w.u8(e.owner).u8(e.type); putEndpoint(w, e.src); putEndpoint(w, e.dst); w.u32(e.fraction); }
  w.u8(g.opens.length); for (const o of g.opens) w.u8(o.role).u8(o.species).u32(o.remaining);
  w.u8(g.slots.length); for (const s of g.slots) w.u8(s.role).u8(s.x).u8(s.y);
  const body = w.finish(); return new ByteWriter(7713).raw(Buffer.from('BIOP6G01')).u16(1).u8(g.target).u8(0).u32(body.length).raw(body).finish();
}
export function decodeGraph(bytes) {
  const r = new ByteReader(bytes, 7713);
  requireBio(eq(r.raw(8), Buffer.from('BIOP6G01')) && r.u16() === 1, 'CODEC', 'unknown graph magic/schema');
  const target = r.u8(); r.zero(1); requireBio(r.u32() === r.remaining, 'CODEC', 'graph body length mismatch');
  const g = { target }; for (const key of ['domain', 'config', 'catalog', 'rule']) g[key] = r.raw(32);
  const list = (max, size, read, wide = false) => { const n = wide ? r.u16() : r.u8(); requireBio(n <= max && n * size <= r.remaining, 'CODEC', 'untrusted count exceeds bound'); return Array.from({ length: n }, () => read()); };
  g.nodes = list(22, 4, () => ({ scope: r.u8(), kind: r.u8(), role: r.u8(), parent: r.u8() }));
  g.cells = list(15, 5, () => ({ role: r.u8(), v: r.u32() })); g.tiers = list(22, 2, () => ({ scope: r.u8(), mode: r.u8() }));
  g.edges = list(440, 16, () => ({ owner: r.u8(), type: r.u8(), src: readEndpoint(r), dst: readEndpoint(r), fraction: r.u32() }), true);
  g.opens = list(45, 6, () => ({ role: r.u8(), species: r.u8(), remaining: r.u32() })); g.slots = list(15, 3, () => ({ role: r.u8(), x: r.u8(), y: r.u8() }));
  r.finish(); return validateGraph(g);
}
