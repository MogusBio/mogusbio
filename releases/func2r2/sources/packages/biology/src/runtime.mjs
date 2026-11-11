import { MICRO as U, DYNAMIC, HARD, members, scopes, createGraph, validateGraph, compareEdges, edge, leaf, requireBio, BiologyError } from './graph.mjs';

const min = (...xs) => xs.reduce((a, b) => a < b ? a : b);
const sum = xs => xs.reduce((a, b) => a + b, 0n);
const div = (a, b, label) => { requireBio(a >= 0n && b > 0n && a % b === 0n, 'INTEGER', `non-integral ${label}`); return a / b; };
export const FULL_ROLES = Object.freeze(Array.from({ length: 15 }, (_, i) => i + 1));
const OTHERS = FULL_ROLES.filter(r => r !== 12 && r !== 13);
export const TEST_CASES = Object.freeze([
  { name: 'N32', env: Array.from({ length: 32 }, () => [1, 0]) },
  { name: 'S2R', env: [...Array.from({ length: 2 }, () => [0, 0]), ...Array.from({ length: 16 }, () => [1, 0])] },
  { name: 'H2R', env: [[1, 1], [1, 1], [1, 0], [1, 0]] },
  { name: 'SH', env: [[0, 1], ...Array.from({ length: 16 }, () => [1, 1]), [1, 0], [1, 0]] },
]);
export function initialState() { return { cells: FULL_ROLES.map(role => ({ role, N: U, W: 0n, E: 0n, J: U, I: 0 })), xA: -U / 2n, xB: U / 2n }; }
function phaseOf(state) {
  if (state.xA === -U / 2n && state.xB === U / 2n) return 0;
  if (state.xA === U / 2n && state.xB === -U / 2n) return 1;
  throw new BiologyError('MECHANICAL', 'axes are not at a legal phase');
}
/** Fixed fixture exists only during a partial target's test. No assets are created. */
export function executionGraph(g) {
  validateGraph(g); if (g.target === 22) return g;
  const real = new Set(members(g.target)), free = g.edges.filter(e => e.type <= 3).map(e => structuredClone(e));
  for (let r = 1; r <= 15; r++) for (const type of [1, 2, 3]) {
    const sources = type === 1 ? [6, 7] : [1, 2], ports = type === 1 ? [1, 2] : type === 2 ? [3, 4] : [5, 6];
    const make = (source, port, fraction) => type === 3 ? edge(type, leaf(r, 1, port), leaf(source, 4, 18), fraction) : edge(type, leaf(source, 4, 17), leaf(r, 1, port), fraction);
    if (!real.has(r)) { free.push(make(sources[0], ports[0], 500_000), make(sources[1], ports[1], 500_000)); continue; }
    const existing = free.filter(e => e.type === type && (type === 3 ? e.src.role : e.dst.role) === r);
    const parts = ports.map(p => existing.filter(e => (type === 3 ? e.src.port : e.dst.port) === p).reduce((s, e) => s + e.fraction, 0));
    const external = sources.filter(s => !real.has(s)), remaining = 1_000_000 - parts[0] - parts[1];
    requireBio(remaining === 0 || external.length > 0, 'FIXTURE', 'no external macro for actual open fraction');
    if (!remaining) continue;
    const low = Math.min(Math.max(500_000, parts[0]), 1_000_000 - parts[1]);
    for (const [i, total] of [low - parts[0], 1_000_000 - low - parts[1]].entries()) {
      const quotient = Math.floor(total / external.length), remainder = total % external.length;
      external.forEach((source, j) => { const f = quotient + (j < remainder ? 1 : 0); if (f) free.push(make(source, ports[i], f)); });
    }
  }
  return createGraph({ target: 22, freeEdges: free, v: Object.fromEntries(g.cells.map(c => [c.role, c.v])), tiers: Object.fromEntries(g.tiers.map(t => [t.scope, t.mode])), domain: g.domain, config: g.config, catalog: g.catalog, rule: g.rule });
}
export function sense(N0, f, b, phase) {
  requireBio(N0.length === 15 && N0.every(n => typeof n === 'bigint' && n >= 0n && n <= U), 'STOCK', 'invalid round snapshot');
  requireBio([0, 1].includes(f) && [0, 1].includes(b) && [0, 1].includes(phase), 'CONTROL', 'invalid environment/pose');
  const deficit = N0.findIndex(n => n < U);
  const mode = f === 0 ? 'STARVE' : deficit >= 0 ? 'RECOVER' : b === 1 ? 'HOLD' : 'RUN';
  return Object.freeze({ f, b, phase, mode, target: mode === 'RECOVER' ? deficit + 1 : 0, d: mode === 'RECOVER' ? min(U / 2n, U - N0[deficit]) : 0n, N0: Object.freeze([...N0]) });
}
export function makePlan(snapshot, cells, challenge) {
  const c = BigInt(challenge), v = new Map(cells.map(x => [x.role, BigInt(x.v)]));
  requireBio(c >= U / 2n && c <= 2n * U && c % 1000n === 0n, 'CHALLENGE', 'invalid challenge lattice');
  const w = r => HARD.includes(r) ? 0n : min(v.get(r), c > U ? c - U : 0n);
  const u0 = FULL_ROLES.map(r => snapshot.mode === 'STARVE' || (['HOLD', 'RECOVER'].includes(snapshot.mode) && [10, 11].includes(r)) ? 0n : U);
  const u1 = FULL_ROLES.map(r => snapshot.mode === 'RUN' ? w(r) : 0n);
  for (const amount of u1) requireBio(amount <= w(12) && amount <= w(13), 'CONTROL', 'downstream boost exceeds real sensor/integrator service');
  const m = FULL_ROLES.map((_, i) => div(U + u0[i] + u1[i], 4n, 'metabolism'));
  const feed = m.map((n, i) => snapshot.mode === 'STARVE' ? 0n : n + (snapshot.target === i + 1 ? snapshot.d : 0n));
  const work = snapshot.mode === 'RUN' ? [c, c] : [0n, 0n];
  return { u0, u1, m, feed, work };
}
function projectionChecks(g, macro) {
  for (const tier of g.tiers) {
    const included = new Set(members(tier.scope)), cap = tier.mode === 0 ? 12n * U : 15n * U / 2n;
    for (const type of [1, 2, 3, 4]) {
      let flow = 0n;
      for (const [key, value] of macro) { const [t, role] = key.split(':').map(Number); if (t === type && included.has(role)) flow += value; }
      requireBio(flow <= cap, 'CUT', 'inherited scope cut exceeded', { scope: tier.scope, type, flow, cap });
    }
  }
}
export function compileRuntime(graph) {
  validateGraph(graph); const full = executionGraph(graph), routes = new Map(), edgeIndices = new Map(full.edges.map((e, i) => [JSON.stringify(e), i]));
  for (const type of [1, 2, 3]) for (let role = 1; role <= 15; role++) routes.set(`${type}:${role}`, full.edges.filter(e => e.type === type && (type === 3 ? e.src.role : e.dst.role) === role));
  return { graph, full, routes, edgeIndices, v: new Map(full.cells.map(c => [c.role, BigInt(c.v)])) };
}
/** The only external state is the explicit stock and axis state. No time/LAB balance enters physiology. */
export function stepRound(compiled, prior, environment, challenge, emit = null) {
  const { graph, full, routes, edgeIndices } = compiled;
  const state = structuredClone(prior), N0 = state.cells.map(c => c.N), phase = phaseOf(state);
  requireBio(state.cells.length === 15 && state.cells.every((c, i) => c.role === i + 1 && c.N >= 0n && c.N <= U && c.E === 0n && c.W === 0n && c.J === U && [0, 1, 2, 3].includes(c.I)), 'STATE', 'invalid complete boundary state');
  const snapshot = sense(N0, environment[0], environment[1], phase), plan = makePlan(snapshot, full.cells, challenge);
  const ledger = FULL_ROLES.map(() => ({ N: 0n, O: 0n, generated: 0n, maintenance: 0n, job0: 0n, job1: 0n, work: 0n, heat: 0n }));
  const macro = new Map(), ports = new Map(), positiveEdges = new Set(), paid = new Set(), flows = new Map();
  const add = (map, key, n) => map.set(key, (map.get(key) ?? 0n) + n);
  const route = (type, role, amount) => {
    let delivered = 0n;
    for (const e of routes.get(`${type}:${role}`)) {
      const n = div(amount * BigInt(e.fraction), U, 'branch flow'); delivered += n;
      const port = type === 3 ? e.src.port : e.dst.port, source = type === 3 ? e.dst.role : e.src.role;
      add(ports, `${type}:${role}:${port}`, n); requireBio(ports.get(`${type}:${role}:${port}`) <= U / 2n, 'PORT_CAP', 'physical port shared capacity exceeded');
      add(macro, `${type}:${source}`, n); requireBio(macro.get(`${type}:${source}`) <= (type === 1 ? 6n : 8n) * U, 'MACRO_CAP', 'macro source/sink capacity exceeded');
      const index = edgeIndices.get(JSON.stringify(e)); add(flows, index, n); if (n > 0n) positiveEdges.add(JSON.stringify(e));
    }
    requireBio(delivered === amount, 'MATERIAL_BALANCE', 'branch sum does not equal actual demand');
  };
  const reactPay = (role, amount, purpose) => {
    if (amount === 0n) return;
    const c = state.cells[role - 1], l = ledger[role - 1], energy = amount * 4n;
    requireBio(c.N >= amount, 'ENERGY', 'cannot borrow future food or another cell energy');
    route(2, role, amount); c.N -= amount; c.W += amount; c.E += energy;
    requireBio(l.N + amount <= U && c.W <= U, 'CAPACITY', 'local reaction/storage budget exceeded');
    l.N += amount; l.O += amount; l.generated += energy;
    requireBio(c.E >= energy, 'ENERGY', 'local payment not funded'); c.E -= energy; l[purpose] += energy;
    if (purpose !== 'maintenance') { requireBio(!paid.has(`${role}:${purpose}`) && energy <= U, 'TASK', 'task paid twice/slot exceeded'); paid.add(`${role}:${purpose}`); }
  };
  const event = p => {
    for (let i = 0; i < 15; i++) {
      const pending = p < 6 && snapshot.mode === 'RUN' && [9, 10].includes(i) ? (paid.has(`${i + 1}:job0`) ? min(BigInt(challenge), U) : 0n) + (paid.has(`${i + 1}:job1`) ? plan.u1[i] : 0n) : 0n;
      const l = ledger[i]; l.heat = l.generated + l.maintenance + l.job0 + l.job1 - l.work - pending;
      requireBio(l.heat >= 0n, 'ENERGY', 'negative heat balance');
    }
    emit?.({ phase: p, snapshot, state: structuredClone(state), ledger: structuredClone(ledger), flows: new Map(flows), plan: structuredClone(plan) });
  };
  for (let r = 1; r <= 15; r++) reactPay(r, U / 4n, 'maintenance'); event(1);
  if (snapshot.mode !== 'STARVE') { reactPay(12, U / 4n, 'job0'); if (plan.u1[11]) reactPay(12, div(plan.u1[11], 4n, 'sensor payment'), 'job1'); } event(2);
  if (snapshot.mode !== 'STARVE') { requireBio(paid.has('12:job0'), 'CONTROL', 'sensor source absent'); reactPay(13, U / 4n, 'job0'); if (plan.u1[12]) { requireBio(paid.has('12:job1'), 'CONTROL', 'BODY not actually paid'); reactPay(13, div(plan.u1[12], 4n, 'integrator payment'), 'job1'); } } event(3);
  for (const r of OTHERS) { if (plan.u0[r - 1]) reactPay(r, div(plan.u0[r - 1], 4n, 'base payment'), 'job0'); if (plan.u1[r - 1]) { requireBio(paid.has('13:job1'), 'CONTROL', 'BOOST not actually paid'); reactPay(r, div(plan.u1[r - 1], 4n, 'boost payment'), 'job1'); } } event(4);
  const food = sum(plan.feed), consumed = sum(ledger.map(l => l.N));
  if (food > 0n) {
    for (const r of [4, 5, 8]) requireBio(paid.has(`${r}:job0`) && food <= div(15n * (U + plan.u0[r - 1] + plan.u1[r - 1]), 4n, 'P capacity'), 'PROCESSOR', 'real food processing path insufficient');
    for (const r of [3, 9, 14, 15]) requireBio(paid.has(`${r}:job0`), 'GUARD', 'real seal/steady-state action missing');
    requireBio(food <= 12n * U, 'CUT', 'N/R global cut exceeded');
    add(macro, '4:9', food);
  }
  for (let r = 1; r <= 15; r++) {
    route(1, r, plan.feed[r - 1]); route(3, r, ledger[r - 1].N);
    const c = state.cells[r - 1]; c.N += plan.feed[r - 1]; c.W -= ledger[r - 1].N;
    requireBio(c.N >= 0n && c.N <= U && c.W === 0n, 'STATE', 'real stock balance or waste failed');
    c.J += U / 10n; requireBio(c.J <= 6n * U / 5n, 'STEADY', 'J transient overflow'); c.J -= U / 10n;
  }
  requireBio(consumed <= 12n * U && 3n * U <= 4n * U, 'CUT', 'global O/W/J budget failed'); projectionChecks(full, macro); event(5);
  if (snapshot.mode === 'RUN') {
    for (const r of [10, 11]) { const available = ledger[r - 1].job0 + ledger[r - 1].job1; requireBio(available >= BigInt(challenge), 'MECHANICAL', 'real muscle work not funded'); ledger[r - 1].work = BigInt(challenge); }
    state.xA = -state.xA; state.xB = -state.xB;
  } event(6);
  const nextI = snapshot.mode === 'STARVE' ? 2 : state.cells.some(c => c.N < U) ? 3 : snapshot.b === 1 ? 2 : phaseOf(state);
  for (let i = 0; i < 15; i++) { const c = state.cells[i]; c.I = nextI; requireBio(c.N === N0[i] - plan.m[i] + plan.feed[i] && c.E === 0n && c.W === 0n && c.J === U, 'STATE', 'full boundary not restored'); }
  const work = sum(ledger.map(l => l.work)), heat = sum(ledger.map(l => l.heat));
  requireBio(heat + work === 8n * consumed, 'ENERGY', 'potential/heat/work conservation failed'); event(7);
  const services = new Map();
  if (snapshot.mode === 'RUN') {
    const score = (n, scale) => { const numerator = scale * n - 19n * U; requireBio(numerator >= 0n, 'QUALITY', 'negative service numerator'); return numerator / 11n; };
    const rR = score(food, 4n);
    for (const r of [4, 5, 8]) services.set(r, min(score(food, 4n), plan.u0[r - 1] + plan.u1[r - 1]));
    for (const r of [6, 7]) services.set(r, min(score(macro.get(`1:${r}`) ?? 0n, 8n), plan.u0[r - 1] + plan.u1[r - 1]));
    for (const r of [1, 2]) services.set(r, min(score(macro.get(`2:${r}`) ?? 0n, 8n), score(macro.get(`3:${r}`) ?? 0n, 8n), plan.u0[r - 1] + plan.u1[r - 1]));
    for (const r of [10, 11]) services.set(r, ledger[r - 1].work);
    const noncontrol = min(...services.values(), rR), available = noncontrol > U ? min(U, noncontrol - U) : 0n;
    for (const r of [12, 13]) services.set(r, U + min(plan.u1[11], plan.u1[12], available));
  }
  return { state, snapshot, plan, ledger, macro, services, positiveEdges, totals: { food, consumed, oxygen: consumed, waste: consumed, energy: consumed * 4n, work, heat, potential: consumed * 8n } };
}
export function taskCost(graph, positive) {
  requireBio(graph.target === 22, 'TASK', 'only full BIO has task cost');
  const pos = new Map(graph.slots.map(s => [s.role, s])); let cost = 90;
  for (const e of graph.edges) if (e.type <= 3 && positive.has(JSON.stringify(e))) { const a = pos.get(e.src.role), b = pos.get(e.dst.role); cost += 1 + Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  return cost;
}
/** Executable kernel report, deliberately not the final on-chain H16 admission. */
export function runSuite(graph, { challenge = 2_000_000, onPhase = null, onRound = null } = {}) {
  validateGraph(graph); const hard = graph.target <= 15 ? HARD.includes(graph.target) : graph.target === 21;
  requireBio(!hard || challenge === 2_000_000, 'CHALLENGE', 'hard targets require support challenge two');
  const compiled = compileRuntime(graph), targetRoles = members(graph.target), dynamics = targetRoles.filter(r => DYNAMIC.includes(r));
  const minima = new Map(dynamics.map(r => [r, 2n * U])), positive = new Set(), cases = []; let rounds = 0;
  for (const [caseIndex, tc] of TEST_CASES.entries()) {
    let state = initialState(); const results = [];
    for (const [round, env] of tc.env.entries()) {
      const result = stepRound(compiled, state, env, challenge, onPhase ? e => onPhase({ ...e, caseIndex, round }) : null);
      state = result.state; results.push(result); rounds++;
      onRound?.({ caseIndex, round, result });
      for (const k of result.positiveEdges) positive.add(k);
      if (result.snapshot.mode === 'RUN') for (const role of dynamics) minima.set(role, min(minima.get(role), result.services.get(role)));
    }
    cases.push({ name: tc.name, state, rounds: results });
  }
  const quality = hard ? U : min(...minima.values()) / 1000n * 1000n;
  requireBio(quality >= U / 2n && (hard || quality >= BigInt(challenge)), 'QUALITY', 'worst actual quality below requested challenge');
  const applicable = graph.target === 22 && quality === 2n * U && graph.cells.every(c => HARD.includes(c.role) ? c.v === 0 : c.v === 1_000_000);
  return { implementation: 'F1.4-KERNEL1', status: 'MODEL_PASS', productionAdmission: false, quality: Number(quality), taskApplicable: applicable,
    cost: applicable ? taskCost(graph, positive) : 0, rounds, positiveEdges: positive, cases };
}
