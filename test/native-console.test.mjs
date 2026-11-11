import test from 'node:test';
import {WALLET_SELECTION_EVENT,uniqueNativeWalletOption} from '../apps/player/dist/wallet-catalog.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parsePublicJson, decimalString, parseIntent, unsignedTransactionBytes, transactionBase64,
  parseSignedTransaction, trustedConsoleConfig, consoleWalletCapability, createConsoleState,
  invalidateConsole, acceptEnvelope, acceptInspection, acceptSimulation, consoleGates,
  isCurrentOperation, describeDecision, nativeRequest, mountNativeConsole,
} from '../apps/player/dist/native-console.js';

const actor = '11111111111111111111111111111111';
const resources = {computeUnitLimit:500000,loadedAccountsDataSizeLimit:100000,heapSize:32768,priorityFeeLamports:'0'};
const intent = {operation:'SYNC_EMISSION',nonce:'7',payloadHex:'00',resources};
const envelope = (extra = {}) => ({actor,nonce:'7',operation:'SYNC_EMISSION',unsignedHex:'0001027fff',frameHex:'aabb',feePayer:actor,
  resources,lifetime:{blockhash:actor,lastValidBlockHeight:'99'},messageSHA256:'ab'.repeat(32),...extra});
const inspection = (extra = {}) => ({actor,nonce:'7',operation:'SYNC_EMISSION',feePayer:actor,requiredSigners:[actor],resources,requestHash:'cd'.repeat(32),...extra});
const simulation = {simulationOnly:true,transactionExecuted:false,signatureVerified:false,unitsConsumed:'1',logs:[]};
const response = (value,status = 200) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const prepared = () => { const state = createConsoleState(); state.config = {enabled:true,chain:'solana:localnet'}; state.actor = actor;
  acceptEnvelope(state,'primary',envelope()); acceptInspection(state.logs.primary,inspection()); return state; };

test('intent and packets preserve decimal strings and exact byte values, refusing hidden configuration and noncanonical encodings',() => {
  assert.deepEqual(parseIntent(JSON.stringify(intent)),intent);
  for (const value of ['01','-1','1e4','18446744073709551616',1,null]) assert.throws(() => decimalString(value));
  assert.equal(decimalString('18446744073709551615'),'18446744073709551615');
  for (const extra of [{endpoint:'https://example.invalid'},{release:{}},{state:'/tmp/other'},{nonce:7},{resources:{...resources,priorityFeeLamports:0}}]) {
    assert.throws(() => parseIntent(JSON.stringify({...intent,...extra})));
  }
  assert.throws(() => parsePublicJson('[]')); assert.throws(() => parsePublicJson('{"text":"世界"}',12));
  const bytes = unsignedTransactionBytes(envelope()); assert.deepEqual([...bytes],[0,1,2,127,255]);
  assert.equal(transactionBase64(bytes),'AAECf/8='); assert.deepEqual(parseSignedTransaction('AAECf/8='),bytes);
  for (const value of ['','AAECf/8=\n','AAECf/9=','A===','AAAA='.repeat(5000)]) assert.throws(() => parseSignedTransaction(value));
  for (const unsignedHex of ['','0','AB','00'.repeat(4097)]) assert.throws(() => unsignedTransactionBytes({unsignedHex}));
});

test('Wallet Standard gate uses numeric v1 on the actual sign feature and exact configured chain without invoking a wallet',() => {
  let calls = 0; const wallet = {chains:['solana:localnet'],features:{'standard:connect':{connect:() => {calls++;}},
    'solana:signTransaction':{supportedTransactionVersions:['1'],signTransaction:() => {calls++;}},
    'solana:signAndSendTransaction':{supportedTransactionVersions:[1]}}};
  assert.equal(consoleWalletCapability(wallet,'solana:localnet').supported,false);
  wallet.features['solana:signTransaction'].supportedTransactionVersions = [1];
  assert.equal(consoleWalletCapability(wallet,'solana:localnet').supported,true);
  assert.equal(consoleWalletCapability(wallet,'solana:mainnet').supported,false);
  assert.equal(consoleWalletCapability(wallet,null).supported,false); assert.equal(calls,0);
  assert.equal(trustedConsoleConfig({enabled:false}),false);
  const state = prepared(); state.config.chain = null;
  assert.equal(consoleGates(state).inspect,true); assert.equal(consoleGates(state,{wallet}).sign,false);
});

test('simulation, inspection, attempted broadcast and current-account gates fail closed',() => {
  const state = prepared(), slot = state.logs.primary;
  const account = {address:actor,chains:['solana:localnet'],features:['solana:signTransaction']};
  const wallet = {chains:['solana:localnet'],accounts:[account],features:{'standard:connect':{connect(){}},'solana:signTransaction':{supportedTransactionVersions:[1],signTransaction(){}}}};
  assert.equal(consoleGates(state,{wallet,account}).sign,false);
  for (const failed of [{...simulation,transactionExecuted:true},{...simulation,simulationOnly:false},{...simulation,signatureVerified:true},{...simulation,err:'failure'},{}]) {
    slot.signedBytes = new Uint8Array([1]); assert.throws(() => acceptSimulation(slot,failed)); assert.equal(slot.signedBytes,null); assert.equal(slot.simulation,null);
  }
  acceptSimulation(slot,simulation); assert.equal(consoleGates(state,{wallet,account}).sign,true);
  assert.equal(consoleGates(state,{wallet,account:{...account}}).sign,false);
  assert.equal(consoleGates(state,{wallet,account,busy:true}).sign,false);
  slot.signedBytes = new Uint8Array([1]); assert.equal(consoleGates(state,{wallet,account}).broadcast,true);
  slot.attempted = true; assert.equal(consoleGates(state,{wallet,account}).broadcast,false); assert.equal(consoleGates(state,{wallet,account}).sign,false);
  assert.throws(() => acceptInspection(slot,inspection({nonce:'8'})));
  assert.throws(() => acceptInspection(slot,inspection({requiredSigners:[]})));
});

test('refresh and input changes invalidate dependent signatures and stale responses without changing original Frame or cancellation log',() => {
  const state = prepared(), primaryBefore = JSON.stringify(state.logs.primary.envelope);
  acceptSimulation(state.logs.primary,simulation); state.logs.primary.signedBytes = new Uint8Array([1]);
  acceptEnvelope(state,'cancellation',envelope({frameHex:'ccdd',unsignedHex:'010203'}));
  assert.equal(JSON.stringify(state.logs.primary.envelope),primaryBefore);
  state.logs.cancellation.signedBytes = new Uint8Array([4]);
  acceptEnvelope(state,'primary',envelope({unsignedHex:'050607'}),{refresh:true});
  assert.equal(state.logs.primary.envelope.frameHex,'aabb'); assert.equal(state.logs.primary.envelope.nonce,'7');
  assert.equal(state.logs.primary.inspection,null); assert.equal(state.logs.primary.simulation,null); assert.equal(state.logs.primary.signedBytes,null);
  assert.equal(state.logs.cancellation.envelope.frameHex,'ccdd');
  assert.throws(() => acceptEnvelope(state,'primary',envelope({nonce:'8'}),{refresh:true}));
  assert.throws(() => acceptEnvelope(state,'cancellation',envelope({nonce:'8',frameHex:'ccdd'})));
  const old = state.logs.primary, generation = state.generation;
  invalidateConsole(state,{actor:'22222222222222222222222222222222',intentText:'{}'});
  assert.equal(isCurrentOperation(state,generation,'primary',old),false);
  assert.equal(state.logs.primary.envelope,null); assert.equal(state.logs.cancellation.envelope,null);
  assert.equal(state.actor,'22222222222222222222222222222222');
});

test('only explicit execution evidence labels a status verified; PENDING, UNKNOWN and an advanced nonce remain unverified',() => {
  for (const decision of ['PENDING','UNKNOWN','ALREADY_PROCESSED','NONCE_CONFLICT','CANCELLATION_PENDING','CONFIRMED']) {
    const result = describeDecision({decision,networkSubmitted:true,signature:'anything'}); assert.equal(result.decision,decision); assert.equal(result.verified,false);
  }
  assert.equal(describeDecision({decision:'CONFIRMED',businessExecutionVerified:true}).verified,true);
  assert.equal(describeDecision({decision:'ORIGINAL_CONFIRMED',originalExecutionVerified:true}).verified,true);
  assert.equal(describeDecision({decision:'CANCEL_CONFIRMED',cancellationExecutionVerified:true}).verified,true);
  assert.equal(describeDecision({decision:'UNKNOWN',businessExecutionVerified:true}).verified,false);
});

test('same-origin transport bounds request bytes, response bytes, redirects, errors and stalled response bodies',async () => {
  let calls = 0; const fetchImpl = async (url,options) => { calls++; assert.equal(url,'/api/native/inspect'); assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'same-origin'); assert.deepEqual(JSON.parse(options.body),{envelope:envelope()}); return response(inspection()); };
  assert.deepEqual(await nativeRequest('inspect',{envelope:envelope()},{fetchImpl}),inspection()); assert.equal(calls,1);
  await assert.rejects(nativeRequest('https://example.invalid',{}, {fetchImpl}),/未知/);
  await assert.rejects(nativeRequest('prepare',{text:'世界'.repeat(20)},{fetchImpl,maxRequestBytes:20}),/大小/); assert.equal(calls,1);
  await assert.rejects(nativeRequest('config',undefined,{fetchImpl:async () => response({value:'x'.repeat(50)}),maxResponseBytes:20}),/大小/);
  await assert.rejects(nativeRequest('config',undefined,{fetchImpl:async () => new Response('<html>no</html>')}),/JSON/);
  await assert.rejects(nativeRequest('config',undefined,{fetchImpl:async () => response({error:'SERVER_REJECTED'},400)}),/SERVER_REJECTED/);
  await assert.rejects(nativeRequest('config',undefined,{timeoutMs:10,fetchImpl:() => new Promise(()=>{})}),/超时/);
  await assert.rejects(nativeRequest('config',undefined,{timeoutMs:10,fetchImpl:async () => new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})}),/超时/);
});

// Tiny DOM fixture tests the actual event wiring without adding a browser framework.
class Element {
  constructor(tagName = 'div') { this.tagName = tagName; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.disabled = false; this.hidden = false; this.textContent = ''; this._value = ''; this.className = '';
    this.classList = {toggle:(name,enabled) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (enabled) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); }}; }
  get value() { return this._value; } set value(value) { this._value = String(value); }
  append(...children) { for (const child of children) { this.children.push(child); if (this.tagName === 'select' && this.children.length === 1) this.value = child.value; } }
  replaceChildren(...children) { this.children = []; if (this.tagName === 'select') this.value = ''; this.append(...children); }
  setAttribute(name,value) { this.attributes[name] = value; }
  addEventListener(name,handler) { (this.listeners[name] ??= []).push(handler); }
  async trigger(name) { if (name === 'click' && this.disabled) return; for (const handler of this.listeners[name] ?? []) await handler({target:this}); await new Promise(resolve => setImmediate(resolve)); }
}
async function documentFixture() {
  const html = await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8'), elements = new Map(), nav = [], views = [];
  for (const match of html.matchAll(/<([a-z-]+)\b([^>]*)>/g)) {
    const [,tag,attributes] = match, id = attributes.match(/\bid="([^"]+)"/)?.[1], element = new Element(tag);
    if (id) { element.id = id; elements.set(id,element); }
    element.className = attributes.match(/\bclass="([^"]+)"/)?.[1] ?? '';
    element.value = attributes.match(/\bvalue="([^"]*)"/)?.[1] ?? '';
    element.disabled = /\bdisabled\b/.test(attributes); element.hidden = /\bhidden\b/.test(attributes);
    const view = attributes.match(/\bdata-view="([^"]+)"/)?.[1]; if (view) { element.dataset.view = view; nav.push(element); }
    if (element.className.split(' ').includes('view')) views.push(element);
  }
  elements.get('native-cancel-resources').value = JSON.stringify(resources);
  return {getElementById:id => elements.get(id),createElement:tag => new Element(tag),querySelectorAll:selector => selector === '.nav-item' ? nav : selector === '.view' ? views : [],elements,nav,views};
}
async function mounted({enabled = true,chain = 'solana:localnet',handler} = {}) {
  const document = await documentFixture(), calls = [], walletCalls = {connect:0,sign:0,send:0}, account = {address:actor,chains:['solana:localnet'],features:['solana:signTransaction']};
  const wallet = {name:'<img src=x onerror=attack()>',chains:['solana:localnet'],accounts:[account],features:{
    'standard:connect':{connect:async () => {walletCalls.connect++; return {accounts:[account]};}},
    'solana:signTransaction':{supportedTransactionVersions:[1],signTransaction:async input => {walletCalls.sign++; walletCalls.input = input; return [{signedTransaction:new Uint8Array([3,2,1])}];}},
    'solana:signAndSendTransaction':{signAndSendTransaction:() => {walletCalls.send++; throw new Error('must never run');}},
  }};
  const fetchImpl = async (url,options) => {
    const action = url.split('/').at(-1), body = options.body ? JSON.parse(options.body) : undefined; calls.push({action,body});
    const overridden = handler?.(action,body,options); if (overridden !== undefined) return overridden;
    const values = {config:{enabled,chain},prepare:envelope(),inspect:inspection(),simulate:simulation,
      broadcast:{decision:'PENDING',networkSubmitted:true,businessExecutionVerified:false,nonce:'7'},
      refresh:envelope({unsignedHex:'040506'}),'cancel-prepare':{decision:'CANCELLATION_PREPARED',envelope:envelope({frameHex:'ccdd',unsignedHex:'070809'})},
      status:{decision:'UNKNOWN',businessExecutionVerified:false},'cancel-status':{decision:'UNKNOWN',originalExecutionVerified:false,cancellationExecutionVerified:false}};
    return response(values[action]);
  };
  const control = await mountNativeConsole(document,{fetchImpl,getWallets:() => ({get:() => [wallet],on(){}})});
  const set = async (id,value) => { const element = document.getElementById(id); element.value = value; await element.trigger('input'); };
  const click = id => document.getElementById(id).trigger('click');
  const draft = async () => { await set('native-actor',actor); await set('native-intent',JSON.stringify(intent)); };
  return {document,calls,walletCalls,wallet,account,...control,set,click,draft};
}

test('native selector merges OKX aliases, pins the actual provider and only changes it on an explicit card choice',async()=>{
  const document=await documentFixture(),events=new EventTarget();document.addEventListener=events.addEventListener.bind(events);document.dispatchEvent=events.dispatchEvent.bind(events);document.defaultView={Event,CustomEvent};
  const calls={connect:0,sign:0},make=(name,versions)=>({name,chains:['solana:localnet'],accounts:[],features:{'standard:connect':{connect(){calls.connect++;return{accounts:[]};}},'solana:signTransaction':{supportedTransactionVersions:versions,signTransaction(){calls.sign++;}}}});
  const a=make('OKEX',[0]),b=make('OKX Wallet',[1]);let installed=[a,b];const listeners=new Map(),registry={get:()=>installed,on(name,fn){listeners.set(name,fn);}};
  await mountNativeConsole(document,{getWallets:()=>registry,fetchImpl:async()=>response({enabled:true,chain:'solana:localnet'})});const select=document.getElementById('native-wallet');assert.equal(select.children.length,1);assert.match(select.children[0].textContent,/^OKX ·/);assert.equal(select.value,'1');
  installed=[b,a];assert.equal(uniqueNativeWalletOption(select,b,installed),'1');
  a.features['solana:signTransaction'].supportedTransactionVersions=[1];document.dispatchEvent(new CustomEvent(WALLET_SELECTION_EVENT,{detail:{wallet:a,connect:true}}));assert.equal(select.children.length,1);assert.equal(select.value,'0');assert.equal(uniqueNativeWalletOption(select,a,installed),'0');
  listeners.get('register')();assert.equal(select.value,'1');assert.equal(uniqueNativeWalletOption(select,a,installed),'1');
  a.features['solana:signTransaction'].supportedTransactionVersions=[0];listeners.get('register')();assert.equal(select.value,'1');assert.equal(select.children[0].disabled,true);assert.equal(document.getElementById('native-connect').disabled,true);assert.deepEqual(calls,{connect:0,sign:0});
});

test('disabled config and unverified chain never request wallet access; fourth view keeps every existing view mutually exclusive',async () => {
  const ui = await mounted({enabled:false}); assert.equal(ui.walletCalls.connect,0); assert.equal(ui.walletCalls.sign,0);
  assert.equal(ui.document.getElementById('native-connect').disabled,true); assert.equal(ui.document.getElementById('native-prepare').disabled,true);
  assert.match(ui.document.getElementById('native-config-note').textContent,/未启用/);
  assert.match(ui.document.getElementById('native-wallet').children[0].textContent,/<img/);
  await ui.document.nav.find(button => button.dataset.view === 'native').trigger('click');
  for (const view of ui.document.views) assert.equal(view.hidden,view.id !== 'native-view');
  assert.equal(ui.document.getElementById('page-title').textContent,'链上操作');
  const unknown = await mounted({chain:null}); await unknown.draft();
  assert.equal(unknown.document.getElementById('native-prepare').disabled,false);
  assert.equal(unknown.document.getElementById('native-connect').disabled,true); assert.equal(unknown.walletCalls.connect,0);
});

test('actual UI requires every explicit step, signs exact envelope bytes, sends only to backend and never calls wallet send',async () => {
  const ui = await mounted(); await ui.draft();
  assert.equal(ui.walletCalls.connect,0); await ui.click('native-prepare');
  assert.deepEqual(ui.calls.at(-1),{action:'prepare',body:{actor,intent}});
  assert.equal(ui.document.getElementById('native-sign').disabled,true);
  await ui.click('native-inspect'); await ui.click('native-simulate');
  assert.equal(ui.document.getElementById('native-sign').disabled,true);
  await ui.click('native-connect'); assert.equal(ui.walletCalls.connect,1);
  await ui.click('native-sign'); assert.equal(ui.walletCalls.sign,1); assert.equal(ui.walletCalls.send,0);
  assert.deepEqual([...ui.walletCalls.input.transaction],[0,1,2,127,255]); assert.equal(ui.walletCalls.input.chain,'solana:localnet'); assert.equal(ui.walletCalls.input.account,ui.account);
  assert.equal(ui.calls.some(call => call.action === 'broadcast'),false);
  await ui.click('native-broadcast'); assert.deepEqual(ui.calls.at(-1),{action:'broadcast',body:{actor,envelope:envelope(),signedTransactionBase64:'AwIB',log:'primary'}});
  assert.match(ui.document.getElementById('native-decision').textContent,/^PENDING/); assert.doesNotMatch(ui.document.getElementById('native-decision').className,/pass/);
  await ui.click('native-broadcast'); assert.equal(ui.calls.filter(call => call.action === 'broadcast').length,1);
  await ui.click('native-refresh'); assert.equal(ui.state.logs.primary.signedBytes,null); assert.equal(ui.state.logs.primary.simulation,null);
  assert.equal(ui.document.getElementById('native-sign').disabled,true); assert.equal(ui.document.getElementById('native-broadcast').disabled,true);
});

test('cancellation uses the original nonce and separate envelope/log; simulation failures and edited intents prevent signing',async () => {
  let simulationFails = false;
  const ui = await mounted({handler:action => action === 'simulate' && simulationFails ? response({error:'RPC_SIMULATION_FAILED'},400) : undefined});
  await ui.draft(); await ui.click('native-prepare'); const original = JSON.stringify(ui.state.logs.primary.envelope);
  await ui.set('native-status-nonce','99'); await ui.click('native-cancel-prepare');
  assert.deepEqual(ui.calls.at(-1),{action:'cancel-prepare',body:{actor,nonce:'7',maxRent:'0',resources}});
  assert.equal(JSON.stringify(ui.state.logs.primary.envelope),original); assert.equal(ui.state.activeLog,'cancellation');
  await ui.click('native-inspect');
  // The inspection mock above describes the same operation/actor/nonce and is
  // separately reconstructed by the backend in production.
  await ui.click('native-simulate'); await ui.click('native-connect'); await ui.click('native-sign');
  await ui.click('native-broadcast'); assert.equal(ui.calls.at(-1).body.log,'cancellation');
  assert.equal(JSON.stringify(ui.state.logs.primary.envelope),original);
  await ui.click('native-primary'); await ui.click('native-inspect'); simulationFails = true; await ui.click('native-simulate');
  assert.equal(ui.state.logs.primary.simulation,null); assert.equal(ui.document.getElementById('native-sign').disabled,true);
  await ui.set('native-intent',JSON.stringify({...intent,nonce:'8'})); assert.equal(ui.state.logs.primary.envelope,null); assert.equal(ui.state.logs.cancellation.envelope,null);
  assert.equal(ui.document.getElementById('native-broadcast').disabled,true);
});

test('late preparation cannot restore a stale draft, and failed sends retain UNKNOWN without allowing silent resend',async () => {
  let resolvePrepare;
  const stale = await mounted({handler:action => action === 'prepare' ? new Promise(resolve => {resolvePrepare = resolve;}) : undefined});
  await stale.draft(); await stale.click('native-prepare'); await stale.set('native-actor','22222222222222222222222222222222');
  resolvePrepare(response(envelope())); await new Promise(resolve => setImmediate(resolve));
  assert.equal(stale.state.logs.primary.envelope,null);
  const failed = await mounted({handler:action => action === 'broadcast' ? Promise.reject(new Error('lost response')) : undefined});
  await failed.draft(); await failed.click('native-prepare'); await failed.click('native-inspect'); await failed.click('native-simulate');
  await failed.set('native-signed-input','AwIB'); await failed.click('native-import-signed'); await failed.click('native-broadcast');
  assert.equal(failed.state.logs.primary.decision.decision,'UNKNOWN'); assert.equal(failed.state.logs.primary.attempted,true);
  assert.equal(failed.document.getElementById('native-broadcast').disabled,true); assert.equal(failed.state.logs.primary.signedBytes,null);
});

test('editing either cancellation budget field aborts the first in-flight preparation before any cancellation envelope exists',async () => {
  for (const [field,value] of [['native-cancel-rent','25'],['native-cancel-resources',JSON.stringify({...resources,computeUnitLimit:600000})]]) {
    let resolveCancellation, cancellationSignal;
    const ui = await mounted({handler:(action,body,options) => action === 'cancel-prepare' ? new Promise(resolve => {
      resolveCancellation = resolve; cancellationSignal = options.signal;
    }) : undefined});
    await ui.draft(); await ui.click('native-prepare'); await ui.click('native-inspect'); await ui.click('native-simulate');
    await ui.set('native-signed-input','AwIB'); await ui.click('native-import-signed');
    const primary = ui.state.logs.primary, original = JSON.stringify(primary), generation = ui.state.generation;
    assert.equal(ui.state.logs.cancellation.envelope,null);
    await ui.click('native-cancel-prepare');
    assert.equal(cancellationSignal.aborted,false); assert.equal(ui.state.logs.cancellation.envelope,null);
    await ui.set(field,value);
    assert.equal(cancellationSignal.aborted,true); assert.ok(ui.state.generation > generation);
    assert.equal(ui.state.logs.primary,primary); assert.equal(JSON.stringify(ui.state.logs.primary),original);
    resolveCancellation(response({decision:'CANCELLATION_PREPARED',envelope:envelope({frameHex:'ccdd',unsignedHex:'070809'})}));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.state.logs.cancellation.envelope,null); assert.equal(ui.state.activeLog,'primary');
    assert.equal(JSON.stringify(ui.state.logs.primary),original);
    assert.equal(ui.document.getElementById('native-cancel-prepare').disabled,false);
  }
});
