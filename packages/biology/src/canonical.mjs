import { ByteWriter } from '../../protocol-core/src/codec.mjs';
import { typedHash } from '../../protocol-core/src/p0.mjs';
import { validateGraph, encodeGraph, compareEdges } from './graph.mjs';

function columnBytes(rows, type) {
  const ordered = [...rows].sort((a, b) => {
    const tuple = e => { const p = type === 3 ? e.dst : e.src; return [e.owner, p.kind, p.role, p.sub, p.port, e.fraction]; };
    const aa = tuple(a), bb = tuple(b); for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]; return 0;
  });
  const w = new ByteWriter(21).u8(ordered.length);
  for (const e of ordered) { const p = type === 3 ? e.dst : e.src; w.u8(e.owner).u8(p.kind).u8(p.role).u8(p.sub).u16(p.port).u32(e.fraction); }
  return w.finish();
}
export function canonicalBytes(graph, context = null) {
  validateGraph(graph, context); const g = structuredClone(graph);
  g.edges = g.edges.filter(e => e.type > 3 || e.fraction !== 0);
  for (const { role } of g.cells) for (const [type, low, high] of [[1, 1, 2], [2, 3, 4], [3, 5, 6]]) {
    const endpoint = e => type === 3 ? e.src : e.dst;
    const rows = g.edges.filter(e => e.type === type && endpoint(e).role === role);
    const a = columnBytes(rows.filter(e => endpoint(e).port === low), type), b = columnBytes(rows.filter(e => endpoint(e).port === high), type);
    if (Buffer.compare(a, b) > 0) for (const e of rows) endpoint(e).port = endpoint(e).port === low ? high : low;
  }
  g.edges.sort(compareEdges);
  const transforms = graph.target === 22 ? [(x, y) => [x, y], (x, y) => [4 - x, y], (x, y) => [x, 2 - y], (x, y) => [4 - x, 2 - y]] : [(x, y) => [x, y]];
  let smallest = null;
  for (const transform of transforms) {
    const candidate = { ...g, slots: g.slots.map(s => { const [x, y] = transform(s.x, s.y); return { role: s.role, x, y }; }) };
    const bytes = new ByteWriter(7636).u16(1).u8(g.target).raw(g.catalog, 32).raw(g.rule, 32).raw(encodeGraph(candidate).subarray(144)).finish();
    if (!smallest || Buffer.compare(bytes, smallest) < 0) smallest = bytes;
  }
  return smallest;
}
export const designId = (graph, context = null) => typedHash(7, canonicalBytes(graph, context));
