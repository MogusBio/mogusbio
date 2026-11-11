import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decimalToAtoms,atomsToDecimal,verifiedPlayerIdentity,mountFeeMirror,mountProfileSelector,mountPlayerShell} from '../apps/player/dist/player-shell.js';
import {setBrowserAuthSession} from '../apps/player/dist/auth-session.js';
import {discoveryDocument,Element,actor,context,config,response,flush} from './discovery-ui-fixture.mjs';

const html=await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8');
test('seven grouped destinations retain the twelve business routes and separate three secondary markets',()=>{
  const values=[...html.matchAll(/\bdata-view="([^"]+)"/g)].map(x=>x[1]);assert.equal(values.length,15);assert.equal(new Set(values).size,15);
  for(const name of ['builder','flow','economy','native','guided','project','manufacture','synthesis','mining','research','directory','wallet-discovery','market-material','market-product','market-bio'])assert.equal(values.filter(v=>v===name).length,1);
  const groups=[...html.matchAll(/data-nav-group="([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(groups,['economy','projects','workshop','mining','assets','market','research']);
  assert.match(html,/生物工坊/);assert.match(html,/我的资产/);assert.match(html,/浏览与购料/);assert.match(html,/首创研究/);assert.match(html,/<summary>说明与高级工具<\/summary>/);
});
test('existing field IDs remain unique, fees stay explicit and the visual constructor is outside advanced JSON',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length);
  for(const id of ['guided-actor','manufacture-projects','manufacture-sources','synthesis-direct','synthesis-graph-hex','synthesis-workflow-id','native-intent','graph-json','visual-designer'])assert.equal(ids.filter(v=>v===id).length,1);
  assert.match(html,/<section id="visual-designer"><\/section><section class="result-panel"/);
  assert.match(html,/<input[^>]*id="synthesis-max-fee"[^>]*value="0"[^>]*data-player-fee="6"/);
  assert.match(html,/<input[^>]*id="manufacture-max-part-rent"[^>]*value="0"[^>]*data-player-fee="9"/);
  assert.match(html,/<input[^>]*id="challenge"[^>]*value="2000000"/);
  assert.match(html,/src="\/player-shell.js"/);assert.match(html,/<details class="player-login" id="player-login">/);assert.doesNotMatch(html,/<details[^>]*id="player-login"[^>]*\bopen\b/);assert.match(html,/<body data-player-mode="simple">/);
});
test('SOL9 and LAB6 decimal conversion preserve tiny fees and the exact u64 upper boundary',()=>{
  for(const [display,scale,atoms]of [['0',9,'0'],['0.000000001',9,'1'],['0.000001',6,'1'],['12.000000',6,'12000000'],['18446744073.709551615',9,'18446744073709551615'],['18446744073709.551615',6,'18446744073709551615'],['42',0,'42']])assert.equal(decimalToAtoms(display,scale),atoms);
  for(const scale of [0,6,9])for(const atom of ['0','1','9007199254740993','18446744073709551615'])assert.equal(decimalToAtoms(atomsToDecimal(atom,scale),scale),atom);
});
test('negative, exponent, separators, extra precision, noncanonical and overflowing fees are rejected',()=>{
  for(const v of ['','-1','+1','1e-9','1,000','01','00.1','.5','1.',' 1','1 ','NaN','Infinity','０.１','0.0000000001','18446744073.709551616','1'.repeat(200)])assert.throws(()=>decimalToAtoms(v,9),v);
  for(const v of ['0.0000001','18446744073709.551616'])assert.throws(()=>decimalToAtoms(v,6));
  assert.throws(()=>atomsToDecimal('-1',9));assert.throws(()=>atomsToDecimal('18446744073709551616',9));assert.throws(()=>decimalToAtoms('1',10));
});
function feeDom(){const raw=new Element('input');raw.id='fee';raw.value='0';raw.classList.add=name=>raw.classList.toggle(name,true);raw.dataset={playerFee:'9',feeUnit:'SOL',feeLabel:'账户押存上限'};raw.before=el=>{raw.mirror=el;};raw.getAttribute=k=>raw.attributes[k]??null;const made=[];const document={defaultView:{Event:class{constructor(type){this.type=type;}}},createElement:tag=>{const e=new Element(tag);e.getAttribute=k=>e.attributes[k]??null;made.push(e);return e;},querySelector:()=>null};return {raw,document,made};}
test('fee mirror mounting never authorizes spending and each explicit edit updates original input exactly once',async()=>{
  const {document,raw}=feeDom();let changed=0;raw.addEventListener('input',()=>changed++);const mirror=mountFeeMirror(document,raw);assert.equal(raw.value,'0');assert.equal(changed,0);assert.equal(mirror.input.value,'0');
  mirror.input.value='0.000000001';await mirror.input.trigger('input');assert.equal(raw.value,'1');assert.equal(changed,1);
  mirror.input.value='0.020000000';await mirror.input.trigger('input');assert.equal(raw.value,'20000000');assert.equal(changed,2);
});
test('invalid visible fees clear the old authoritative amount and follow original disabled/programmatic state',async()=>{
  const {document,raw}=feeDom(),mirror=mountFeeMirror(document,raw);mirror.input.value='0.02';await mirror.input.trigger('input');assert.equal(raw.value,'20000000');
  mirror.input.value='garbage';await mirror.input.trigger('input');assert.equal(raw.value,'');assert.equal(mirror.input.getAttribute('aria-invalid'),'true');
  raw.value='18446744073709551615';raw.disabled=true;mirror.sync();assert.equal(mirror.input.value,'18446744073.709551615');assert.equal(mirror.input.disabled,true);
  raw.disabled=false;mirror.sync();assert.equal(mirror.input.disabled,false);assert.equal(raw.value,'18446744073709551615');
});
test('authenticated wallet display requires the real browser context store, never actor-shaped config alone',()=>{
  setBrowserAuthSession(null);assert.equal(verifiedPlayerIdentity(config()),null);setBrowserAuthSession({actor},context);assert.equal(verifiedPlayerIdentity(config()),actor);
  assert.equal(verifiedPlayerIdentity({...config(),sessionActor:'2'.repeat(32)}),null);assert.equal(verifiedPlayerIdentity({...config(),configHex:'e'.repeat(64)}),null);assert.equal(verifiedPlayerIdentity({...config(),authenticationRequired:false}),null);setBrowserAuthSession(null);
});
async function shellDocument(){const d=await discoveryDocument();d.body=new Element('body');for(const e of [...d.els.values(),...d.nav,...d.views]){e.querySelector=()=>null;e.querySelectorAll=()=>[];e.closest=()=>null;e.after=()=>{};e.prepend=(...v)=>e.children.unshift(...v);}let disconnected=0;d.defaultView.MutationObserver=class{observe(){}disconnect(){disconnected++;}};d.querySelector=()=>null;d.getDisconnected=()=>disconnected;return d;}
test('shell adds navigation guidance and one config read without wallet, planning, hidden spending or auto action',async()=>{
  setBrowserAuthSession(null);const d=await shellDocument(),calls=[];const ui=mountPlayerShell(d,{fetchImpl:async(url)=>{calls.push(url);return response({enabled:false});}});await flush();assert.deepEqual(calls,['/api/native/config']);assert.equal(d.body.dataset.playerMode,'simple');
  let navigations=0;d.nav.find(v=>v.dataset.view==='synthesis').addEventListener('click',()=>navigations++);ui.go('synthesis');assert.equal(navigations,1);assert.equal(calls.length,1);ui.mode(true);assert.equal(d.body.dataset.playerMode,'advanced');ui.mode(false);assert.equal(d.body.dataset.playerMode,'simple');ui.close();assert.equal(d.getDisconnected(),1);
});
test('verified identity locks accidental actor edits only in player mode and old replies cannot revive logout',async()=>{
  setBrowserAuthSession({actor},context);const d=await shellDocument(),deferred=[];const ui=mountPlayerShell(d,{fetchImpl:async()=>new Promise(resolve=>deferred.push(resolve))});deferred.shift()(response(config()));await flush();assert.equal(d.els.get('synthesis-actor').readOnly,true);assert.match(d.els.get('player-wallet-display').textContent,/…/);
  ui.mode(true);assert.equal(d.els.get('synthesis-actor').readOnly,false);ui.mode(false);setBrowserAuthSession(null);d.dispatchEvent({type:'biolab-auth-change',detail:{actor}});assert.equal(d.els.get('player-wallet-display').textContent,'未验证登录身份');deferred.shift()(response(config()));await flush();assert.equal(d.els.get('player-wallet-display').textContent,'未验证登录身份');ui.close();
});

test('type4 exposes a named purpose choice and generic types derive only their fixed profile0',async()=>{
  const primitive=new Element('select'),raw=new Element('input');primitive.after=()=>{};for(let i=1;i<=4;i++){const option=new Element('option');option.value=String(i);primitive.append(option);}primitive.value='1';raw.value='0';let changes=0;raw.addEventListener('input',()=>changes++);
  const d={getElementById:id=>id==='manufacture-primitive'?primitive:raw,createElement:tag=>new Element(tag),defaultView:{Event:class{constructor(type){this.type=type;}}}},picker=mountProfileSelector(d);assert.equal(picker.box.hidden,true);assert.equal(raw.value,'0');assert.equal(changes,0);
  primitive.value='4';await primitive.trigger('change');assert.equal(picker.box.hidden,false);assert.equal(picker.select.value,'');assert.equal(raw.value,'0');picker.select.value='12';await picker.select.trigger('change');assert.equal(raw.value,'12');assert.equal(changes,1);primitive.value='1';await primitive.trigger('change');assert.equal(raw.value,'0');assert.equal(changes,2);assert.equal(picker.box.hidden,true);
});
test('stable mirror sync causes no redundant observed mutations or event-loop feedback',()=>{
  const {document,raw}=feeDom(),fee=mountFeeMirror(document,raw);let attributes=0;const setter=fee.input.setAttribute.bind(fee.input);fee.input.setAttribute=(...v)=>{attributes++;setter(...v);};for(let i=0;i<20;i++)fee.sync();assert.equal(attributes,0);
  const primitive=new Element('select'),profile=new Element('input');for(let i=1;i<=4;i++){const o=new Element('option');o.value=String(i);primitive.append(o);}primitive.value='1';primitive.after=()=>{};profile.value='0';const d={getElementById:id=>id==='manufacture-primitive'?primitive:profile,createElement:tag=>new Element(tag)},picker=mountProfileSelector(d);let hidden=picker.box.hidden,writes=0;Object.defineProperty(picker.box,'hidden',{get:()=>hidden,set:v=>{writes++;hidden=v;}});for(let i=0;i<20;i++)picker.sync();assert.equal(writes,0);
});
test('small-screen shell keeps primary navigation in one scrollable focusable row and compresses account chrome',async()=>{
  const css=await readFile(new URL('../apps/player/dist/style.css',import.meta.url),'utf8');
  assert.match(html,/<div class="player-nav-primary" role="group" aria-label="主要玩法，可横向滚动" tabindex="0">/);
  const mobile=css.slice(css.indexOf('/* A short mobile header'));
  assert.match(mobile,/@media\(max-width:620px\)/);assert.match(mobile,/\.player-nav-primary\{[^}]*display:flex;[^}]*flex-wrap:nowrap;[^}]*overflow-x:auto;/);
  assert.match(mobile,/\.sidebar\{[^}]*grid-template-columns:96px minmax\(0,1fr\)/);
  assert.match(mobile,/#player-wallet-note\{display:none\}/);assert.match(mobile,/\.player-login>summary>span\{display:inline/);
  assert.match(mobile,/#builder-view>\.player-step-guide\{display:grid/);
});
