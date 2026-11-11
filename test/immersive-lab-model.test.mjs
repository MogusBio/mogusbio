import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { handleWorkbenchRequest } from '../apps/server/main.mjs';
import { LAB_TARGETS, checkLabConfig, createLabDraft, changeLabDraft, checkLabResult, isLabRecord, labInput, labRecord } from '../apps/player/dist/lab-model.js';
import { mountImmersiveLab, readLabJSON } from '../apps/player/dist/lab.js';
import { Element, allText, flush } from './discovery-ui-fixture.mjs';

const root = new URL('../apps/player/dist/', import.meta.url);
const html = await readFile(new URL('lab.html', root), 'utf8');
const moleculeBytes = await readFile(new URL('lab-assets/molecules.json', root));
const molecules = JSON.parse(moleculeBytes);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

// Real handler and validator, called in memory: no listener, wallet or chain mutation.
async function api(url = '/api/config', { method = 'GET', body = '' } = {}) {
  const bytes = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from([Buffer.from(bytes)]);
  Object.assign(req, { method, url, socket: { localPort: 4317 }, headers: { host: '127.0.0.1:4317', 'content-type': 'application/json' } });
  const result = {};
  await handleWorkbenchRequest(req, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(value) { result.bytes = Buffer.from(value); }
  });
  result.data = result.headers['content-type'].startsWith('application/json') ? JSON.parse(result.bytes) : null;
  return result;
}
const config = checkLabConfig((await api()).data);
const validate = draft => api('/api/validate', { method: 'POST', body: labInput(draft) });

function labDocument() {
  const els = new Map(), all = [], listeners = new Map();
  for (const [, tag, attrs] of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)) {
    const el = new Element(tag);
    el.hidden = /\bhidden\b/.test(attrs);
    el.id = attrs.match(/\bid="([^"]+)"/)?.[1];
    for (const [, key, value] of attrs.matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) el.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    if (el.id) els.set(el.id, el);
    el.querySelector = selector => selector === 'span' ? (el.span ??= new Element('span')) : null;
    all.push(el);
  }
  const body = new Element('body');
  return {
    els, all, body, hidden: false,
    defaultView: { matchMedia: () => ({ matches: true }) },
    getElementById: id => els.get(id),
    createElement: tag => new Element(tag),
    querySelectorAll(selector) {
      const key = selector.match(/^\[data-([a-z-]+)\]$/)?.[1]?.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return key ? all.filter(el => Object.hasOwn(el.dataset, key)) : [];
    },
    addEventListener(type, fn) { const values = listeners.get(type) ?? new Set(); values.add(fn); listeners.set(type, values); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    text() { return [...els.values()].map(allText).join(' '); }
  };
}
function fakeScene() {
  return { stages: [], specimens: [], disposed: 0, setStage(value) { this.stages.push(value); }, setSpecimen(value) { this.specimens.push(value); }, setStation() {}, setQuality() {}, getMetrics() { return { fps: 30, drawCalls: 20 }; }, dispose() { this.disposed++; } };
}
function storage(initial = '[]') {
  return { value: initial, writes: 0, getItem() { return this.value; }, setItem(key, value) { assert.equal(key, 'biolab:immersive-records:v1'); this.value = value; this.writes++; } };
}
async function controller(t, { fetchImpl, localStorage = storage(), sceneFactory, operationsFactory } = {}) {
  const document = labDocument(), scene = fakeScene(), calls = [];
  const defaults = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/lab-assets/molecules.json') return json(molecules);
    const response = await api(url, { method: init.method, body: init.body });
    return new Response(response.bytes, { status: response.status, headers: response.headers });
  };
  const ui = mountImmersiveLab(document, { fetchImpl: fetchImpl ? (url, init) => fetchImpl(url, init, defaults) : defaults, storage: localStorage, sceneFactory: sceneFactory ?? (async () => scene),operationsFactory,...(operationsFactory?{window:{...document.defaultView,location:{pathname:'/lab'}}}:{}) });
  t.after(() => ui.close());
  await ui.ready;
  return { document, scene, calls, ui, localStorage };
}

test('immersive drafts use the actual OPEN310 configuration and never mutate public references', () => {
  assert.equal(config.references.length, 17);
  assert.equal(config.productionAdmission, false);
  const before = structuredClone(config), draft = createLabDraft(config);
  assert.equal(draft.referenceName, 'C310');
  assert.equal(draft.target, 4);
  assert.equal(draft.challenge, 2000000);
  const changed = changeLabDraft(draft, { capacity: 500000, challenge: 1000000 });
  assert.equal(changed.graph.cells.find(c => c.role === 4).v, 500000);
  assert.equal(draft.graph.cells.find(c => c.role === 4).v, 1000000);
  const input = labInput(changed); input.graph.cells[0].v = 0;
  assert.equal(changed.graph.cells[0].v, 1000000);
  assert.deepEqual(config, before);
});

test('malformed configuration, targets, fractional and out-of-range model edits are rejected', () => {
  for (const update of [{ productionAdmission: true }, { ruleHash: 'x'.repeat(64) }, { references: [] }, { validatorHash: null }]) assert.throws(() => checkLabConfig({ ...config, ...update }));
  const invalidReference = structuredClone(config); invalidReference.references[0].graph.rule = '0'.repeat(64);
  assert.throws(() => checkLabConfig(invalidReference));
  for (const values of [{ target: 0 }, { target: 23 }, { challenge: 499000 }, { challenge: 2000001 }, { challenge: 500001 }, { capacity: -1000 }, { capacity: 1000001 }, { capacity: 0.5 }, { capacity: NaN }]) assert.throws(() => changeLabDraft(createLabDraft(config), values));
});

test('every selectable layer passes the real 73-round validator and records no manufactured asset', async () => {
  assert.deepEqual(Object.keys(LAB_TARGETS).map(Number), [4, 17, 22]);
  for (const target of Object.keys(LAB_TARGETS).map(Number)) {
    const draft = changeLabDraft(createLabDraft(config), { target });
    const response = await validate(draft);
    assert.equal(response.status, 200, `target ${target}`);
    const result = checkLabResult(response.data, draft), record = labRecord(draft, result, '2026-10-26T00:00:00.000Z');
    const requestSHA = createHash('sha256').update(JSON.stringify(labInput(draft))).digest('hex');
    assert.equal(result.requestSHA, requestSHA);
    assert.equal(checkLabResult(response.data, draft, { requestSHA }), result);
    assert.equal(result.steps, 73);
    assert.equal(record.scope, LAB_TARGETS[target].scope);
    assert.equal(record.previewOnly, true);
    assert.equal(record.networkSubmitted, false);
    assert.equal(record.rule, config.ruleHash);
    assert.equal(record.graphSHA, result.graphSHA);
  }
});

test('the visible metabolic-response edit changes actual validation at every selectable layer', async () => {
  for (const target of Object.keys(LAB_TARGETS).map(Number)) {
    const draft = changeLabDraft(createLabDraft(config), { target, capacity: 0 });
    const response = await validate(draft);
    assert.equal(response.status, 400, `target ${target} must not silently ignore C04`);
    assert.equal(response.data.status, 'FAIL');
    assert.equal(response.data.code, 'PROCESSOR');
  }
});

test('PASS-shaped results with wrong layer, admission, quality or incomplete evidence are rejected', async () => {
  const draft = createLabDraft(config), good = (await validate(draft)).data;
  for (const update of [{ status: 'FAIL' }, { target: 22 }, { scope: 'BIO' }, { productionAdmission: true }, { q: '0' }, { q: '2000001' }, { q: '01' }, { steps: 72 }, { graphSHA: 'wrong' }, { designId: null }, { requestSHA: undefined }]) assert.throws(() => checkLabResult({ ...good, ...update }, draft));
  assert.throws(() => checkLabResult(good, draft, { requestSHA: '0'.repeat(64) }));
});

test('all four molecule records retain real formula, complete heavy-atom connectivity and honest coordinate dimensions', () => {
  assert.equal(molecules.profile, 'BIOLAB-MOLECULES1');
  const expected = { glycine: [750, 'C2H5NO2', '3D', 5, 4], atp: [5957, 'C10H16N5O13P3', '3D', 31, 33], dopc: [10350317, 'C44H84NO8P', '2D', 54, 53], glucose: [5793, 'C6H12O6', '3D', 12, 12] };
  assert.deepEqual(Object.keys(molecules.compounds).sort(), Object.keys(expected).sort());
  for (const [key, [cid, formula, dimension, atomCount, bondCount]] of Object.entries(expected)) {
    const c = molecules.compounds[key], counts = new Map(), degrees = c.atoms.map(() => 0), neighbors = c.atoms.map(() => []), seen = new Set();
    assert.equal(c.cid, cid); assert.equal(c.formula, formula); assert.equal(c.coordinateType, dimension);
    assert.equal(c.atoms.length, atomCount); assert.equal(c.bonds.length, bondCount); assert.equal(c.includeHydrogens, false);
    assert.equal(new URL(c.source).hostname, 'pubchem.ncbi.nlm.nih.gov');
    let hydrogens = 0;
    for (const a of c.atoms) {
      assert.ok(['C', 'N', 'O', 'P'].includes(a.element));
      assert.ok([a.x, a.y, a.z].every(Number.isFinite));
      assert.ok(Number.isSafeInteger(a.hydrogens) && a.hydrogens >= 0);
      hydrogens += a.hydrogens; counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
      if (dimension === '2D') assert.equal(a.z, 0);
    }
    counts.set('H', hydrogens); assert.equal(hydrogens, c.omittedHydrogenCount);
    const formulaCounts = new Map([...formula.matchAll(/([A-Z][a-z]?)(\d*)/g)].map(([, element, count]) => [element, Number(count || 1)]));
    assert.deepEqual([...counts].sort(), [...formulaCounts].sort());
    for (const [a, b, order] of c.bonds) {
      assert.ok(Number.isInteger(a) && a >= 0 && a < atomCount && Number.isInteger(b) && b >= 0 && b < atomCount && a !== b);
      assert.ok([1, 2, 3].includes(order));
      const edge = [a, b].sort((x, y) => x - y).join(':'); assert.ok(!seen.has(edge)); seen.add(edge);
      degrees[a] += order; degrees[b] += order; neighbors[a].push(b); neighbors[b].push(a);
    }
    const reached = new Set([0]), queue = [0]; for (const a of queue) for (const b of neighbors[a]) if (!reached.has(b)) { reached.add(b); queue.push(b); }
    assert.equal(reached.size, atomCount);
    for (const [i, a] of c.atoms.entries()) assert.equal(degrees[i] + a.hydrogens, a.element === 'C' ? 4 : a.element === 'N' ? (a.charge === 1 ? 4 : 3) : a.element === 'O' ? (a.charge === -1 ? 1 : 2) : 5, `${key} atom ${i}`);
    assert.equal(c.atoms.reduce((sum, a) => sum + a.charge, 0), c.formalCharge);
  }
});

test('vendor and molecule provenance pins the exact shipped files', async () => {
  const sources = JSON.parse(await readFile(new URL('lab-assets/sources.json', root), 'utf8'));
  const three = await readFile(new URL('lab-assets/three.module.js', root));
  assert.ok(three.byteLength < 700000); assert.ok(moleculeBytes.byteLength < 100000);
  assert.match(three.toString(), /MIT/);
  const serialized = JSON.stringify(sources);
  assert.ok(serialized.includes(createHash('sha256').update(three).digest('hex')));
  assert.ok(serialized.includes(createHash('sha256').update(moleculeBytes).digest('hex')));
});

test('laboratory controller performs real validation, saves a local record and only calls read/test endpoints', async t => {
  const { ui, document, calls, localStorage } = await controller(t);
  assert.equal(ui.state.draft.referenceName, 'C310');
  await ui.primary(); assert.equal(ui.state.phase, 1);
  await ui.primary(); assert.equal(ui.state.phase, 3); assert.equal(ui.state.result.status, 'PASS');
  await ui.primary(); assert.equal(ui.state.phase, 4); assert.equal(localStorage.writes, 1);
  assert.equal(ui.state.records.length, 1); assert.equal(ui.state.records[0].networkSubmitted, false);
  assert.deepEqual(calls.map(c => c.url), ['/api/config', '/lab-assets/molecules.json', '/api/validate']);
  assert.match(document.els.get('lab-status').textContent, /No token, asset or reward/);
  assert.doesNotMatch(document.text(), /[\u3400-\u9fff]/);
});

test('failed experiments clear prior success and cannot be saved as new observations', async t => {
  const { ui, document } = await controller(t);
  await ui.runExperiment(); assert.ok(ui.state.result);
  ui.change({ capacity: 0 }); assert.equal(ui.state.result, null);
  await ui.runExperiment(); assert.equal(ui.state.result, null); assert.equal(ui.state.phase, 1);
  assert.equal(ui.state.records.length, 0);
  assert.match(document.els.get('lab-status').textContent, /nutrient-processing/);
});

test('changing a design cancels an outstanding test and ignores its late PASS response', async t => {
  let resolveOld, entered, posts = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const { ui, document } = await controller(t, { fetchImpl: async (url, init, defaults) => {
    if (url !== '/api/validate' || ++posts > 1) return defaults(url, init);
    const reply = await defaults(url, init);
    return new Promise(resolve => { resolveOld = () => resolve(reply); entered(); });
  } });
  const old = ui.runExperiment();
  await Promise.race([started, old.then(() => { throw Error('VALIDATOR_REQUEST_NOT_STARTED'); })]);
  assert.equal(ui.state.running, true);
  ui.change({ capacity: 0 }); assert.equal(ui.state.running, false);
  await old; await ui.runExperiment(); assert.equal(ui.state.result, null);
  const status = document.els.get('lab-status').textContent;
  resolveOld(); await flush(); assert.equal(ui.state.result, null); assert.equal(document.els.get('lab-status').textContent, status);
});

test('a valid PASS from a different request cannot produce a preview or saved observation', async t => {
  const { ui, document } = await controller(t, { fetchImpl: async (url, init, defaults) => {
    const reply = await defaults(url, init);
    if (url !== '/api/validate') return reply;
    const data = await reply.json(); data.requestSHA = '0'.repeat(64);
    return json(data);
  } });
  await ui.runExperiment();
  assert.equal(ui.state.result, null); assert.equal(ui.state.phase, 1); assert.equal(ui.state.records.length, 0);
  assert.match(document.els.get('lab-status').textContent, /did not match this design/);
});

test('malformed historical observations are rejected before local notes are rendered', async t => {
  const draft = createLabDraft(config), result = (await validate(draft)).data;
  const valid = labRecord(draft, result, '2026-10-26T00:00:00.000Z');
  assert.equal(isLabRecord(valid), true);
  const invalid = [{ ...valid, date: '2026-02-30T00:00:00.000Z' }, { ...valid, reference: '<script>' }, { ...valid, quality: 'NaN' }, { ...valid, target: 23 }, { ...valid, scope: 'BIO' }, { ...valid, rounds: 72 }, { ...valid, graphSHA: 'bad' }, { ...valid, networkSubmitted: true }, { ...valid, previewOnly: false }];
  for (const record of invalid) assert.equal(isLabRecord(record), false);
  const { ui, document } = await controller(t, { localStorage: storage(JSON.stringify([...invalid, valid])) });
  assert.deepEqual(ui.state.records, [valid]);
  ui.openNotes('samples');
  assert.doesNotMatch(document.els.get('lab-notebook-content').textContent, /NaN|<script>/);
});

test('molecular source links are reconstructed from the verified PubChem identifier', async t => {
  const untrusted = structuredClone(molecules); untrusted.compounds.glycine.source = 'javascript:alert(1)';
  const { ui, document } = await controller(t, { fetchImpl: (url, init, defaults) => url === '/lab-assets/molecules.json' ? Promise.resolve(json(untrusted)) : defaults(url, init) });
  ui.setSpecimen('glycine'); ui.openNotes('recipe');
  const flatten = el => [el, ...el.children.flatMap(flatten)];
  const links = flatten(document.els.get('lab-notebook-content')).filter(el => el.tagName === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://pubchem.ncbi.nlm.nih.gov/compound/750');
  assert.equal(links[0].rel, 'noopener');
});

test('unavailable molecule data leaves all four reagent and recipe controls usable without invented coordinates', async t => {
  const { ui, document } = await controller(t, { fetchImpl: (url, init, defaults) => url === '/lab-assets/molecules.json' ? Promise.resolve(json({ error: 'offline' }, 503)) : defaults(url, init) });
  for (const key of ['glycine', 'atp', 'dopc', 'glucose']) {
    assert.doesNotThrow(() => ui.setSpecimen(key), key);
    assert.doesNotThrow(() => ui.openNotes('recipe'), key);
    assert.doesNotMatch(document.els.get('lab-specimen-tag').textContent, /VERIFIED|VALIDATED/);
  }
  await ui.runExperiment(); assert.equal(ui.state.result.status, 'PASS');
});

test('scene failure leaves actual model testing available through the 2D inspector', async t => {
  const { ui, document } = await controller(t, { sceneFactory: async () => { throw Error('WEBGL_UNAVAILABLE'); } });
  assert.equal(document.els.get('lab-fallback').hidden, false);
  document.els.get('lab-fallback-action').click(); assert.equal(document.els.get('lab-fallback').hidden, true);
  await ui.runExperiment(); assert.equal(ui.state.result.status, 'PASS');
});

test('aborting data loading also bounds a fetch implementation that ignores its signal', async () => {
  const abort = new AbortController();
  const loading = readLabJSON('/fixture', { fetchImpl: () => new Promise(() => {}), signal: abort.signal });
  abort.abort();
  await assert.rejects(loading, /LAB_DATA_ABORTED/);
});

test('failed local storage does not duplicate observations or falsely mark them saved', async t => {
  const localStorage = { getItem: () => '[]', setItem() { throw Error('QUOTA_EXCEEDED'); } };
  const { ui, document } = await controller(t, { localStorage });
  await ui.runExperiment();
  await ui.primary(); await ui.primary();
  assert.equal(ui.state.phase, 3); assert.equal(ui.state.records.length, 0);
  assert.match(document.els.get('lab-status').textContent, /storage is unavailable/);
  assert.ok(ui.state.result);
});

test('closing while a delayed scene fails does not start a permanent metrics interval', async () => {
  const document = labDocument(); let failScene, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval, timers = [];
  globalThis.setInterval = (...args) => { const timer = realSetInterval(...args); timers.push(timer); return timer; };
  let ui;
  try {
    ui = mountImmersiveLab(document, { storage: storage(), fetchImpl: async url => json(url === '/api/config' ? config : molecules), sceneFactory: () => { entered(); return new Promise((resolve, reject) => { failScene = reject; }); } });
    await started; ui.close(); failScene(Error('SCENE_CLOSED'));
    await ui.ready;
    assert.equal(timers.length, 0);
  } finally {
    globalThis.setInterval = realSetInterval;
    for (const timer of timers) realClearInterval(timer);
    ui?.close();
  }
});

test('JSON loading refuses oversized, malformed and non-JSON data without HTML insertion', async () => {
  await assert.rejects(readLabJSON('/fixture', { fetchImpl: async () => json({ large: 'x'.repeat(100) }), maxBytes: 16 }), /LAB_DATA_SIZE/);
  await assert.rejects(readLabJSON('/fixture', { fetchImpl: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) }), /LAB_DATA/);
  await assert.rejects(readLabJSON('/fixture', { fetchImpl: async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }) }));
  assert.deepEqual(await readLabJSON('/fixture', { fetchImpl: async () => json({ value: '<script>alert(1)</script>' }) }), { value: '<script>alert(1)</script>' });
});

test('immersive HTML and controller labels are English, and user-provided text uses safe DOM sinks', async () => {
  const source = await readFile(new URL('lab.js', root), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.doesNotMatch(html + source, /[\u3400-\u9fff]/);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML\s*\(/);
  assert.match(source, /\.textContent\s*=/);
});

function appearanceComponent(){const id='ab'.repeat(32),lineage=Buffer.concat([Buffer.from([64]),Buffer.from(id,'hex').subarray(0,8)]);return{id,scope:'COMPONENT',primitive:1,profile:0,quality:'1.000',weight:'4000000000000',appearance:{profile:'BIO-LINE-APPEARANCE1',version:1,structureKey:createHash('sha256').update(Buffer.from([1,0,1,0])).digest('hex'),specimenKey:id,graphKey:null,lineage:lineage.toString('base64')}};}

test('owned geometry recovers with appearance metadata, remains stable on balance refresh, and clears with an empty inventory',async t=>{let hooks;const scene=fakeScene();scene.owned=[];scene.setWork=function(work){this.owned.push(structuredClone(work));return true;};const {document}=await controller(t,{sceneFactory:async()=>scene,operationsFactory:(_,callbacks)=>{hooks=callbacks;return{ready:Promise.resolve(),renderSummary(){},dispose(){}};}});const work=appearanceComponent(),missing={...work};delete missing.appearance;hooks.onWork(missing);assert.match(document.els.get('lab-specimen-tag').textContent,/REFERENCE VIEW/);hooks.onInventory([work]);assert.equal(scene.owned.length,2);assert.match(document.els.get('lab-specimen-tag').textContent,/COMPOSED/);hooks.onInventory([{...work,weight:'4040000000000'}]);assert.equal(scene.owned.length,2,'ordinary ledger changes do not rebuild immutable geometry');assert.match(document.els.get('lab-specimen-description').textContent,/1010/);hooks.onInventory([]);assert.doesNotMatch(document.els.get('lab-specimen-tag').textContent,/^OWNED/);assert.equal(scene.specimens.at(-1),'component');});

test('a failed replacement or metadata refresh retains the previously accepted geometry and corresponding HUD',async t=>{let hooks,reject=false;const scene=fakeScene();scene.setWork=()=>!reject;const {document}=await controller(t,{sceneFactory:async()=>scene,operationsFactory:(_,callbacks)=>{hooks=callbacks;return{ready:Promise.resolve(),renderSummary(){},dispose(){}};}});const work=appearanceComponent();hooks.onWork(work);const priorTitle=document.els.get('lab-specimen-title').textContent,priorTag=document.els.get('lab-specimen-tag').textContent;reject=true;hooks.onWork({...work,id:'cd'.repeat(32),primitive:2});assert.equal(document.els.get('lab-specimen-title').textContent,priorTitle);assert.equal(document.els.get('lab-specimen-tag').textContent,priorTag);const missing={...work};delete missing.appearance;hooks.onInventory([missing]);assert.equal(document.els.get('lab-specimen-tag').textContent,priorTag);assert.match(document.els.get('lab-status').textContent,/previous specimen view is preserved/);});
