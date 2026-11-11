import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setBrowserAuthSession } from '../apps/player/dist/auth-session.js';
import { discoveryConfigReady,discoveryQuery,discoveryRequest,checkedDiscoveryPage } from '../apps/player/dist/discovery-contract.js';
import { mountProjectDirectory,handoffDirectoryProject } from '../apps/player/dist/project-directory.js';
import { mountProjectOperations } from '../apps/player/dist/project-operations.js';
import { actor,other,context,config,cursor,projectId,response,flush,clone,login,projectRow,discoveryPage,discoveryDocument,allText } from './discovery-ui-fixture.mjs';

async function mounted({authenticated=true,handler,integrate=false}={}){
  if(authenticated)login();else setBrowserAuthSession(null);const document=await discoveryDocument(),calls=[];
  const fetchImpl=async(url,options)=>{const action=url.split('/').at(-1),body=options.body?JSON.parse(options.body):undefined;calls.push({action,body,signal:options.signal});const r=handler?.(action,body,options);if(r!==undefined)return r;return response(action==='config'?config():discoveryPage({actor:body.actor,section:body.section}));};
  if(integrate)await mountProjectOperations(document,{fetchImpl});const ui=await mountProjectDirectory(document,{fetchImpl});
  return {document,calls,...ui,async fill(id,value,event='input'){const el=document.getElementById(id);el.value=value;await el.trigger(event);},async click(id){await document.getElementById(id).trigger('click');}};
}

test('frozen request has four exact fields, canonical UTF-8 query, authenticated actor and opaque cursor only',()=>{
  login();assert.deepEqual(discoveryRequest({config:config(),section:'projects',query:' e\u0301 ',cursor}),{actor,section:'projects',query:'é',cursor});
  for(const q of ['x\n','\ud800','界'.repeat(43),' '.repeat(129)])assert.throws(()=>discoveryQuery(q));
  assert.equal(discoveryQuery('界'.repeat(42)),'界'.repeat(42));
  for(const args of [{section:'bad'},{section:'roots',query:' '},{section:'projects',cursor:'bad'}])assert.throws(()=>discoveryRequest({config:config(),...args}));
  for(const c of [{...config(),sessionActor:other},{...config(),authenticationRequired:false},{...config(),sessionAuthenticated:false},{...config(),domainHex:'0'.repeat(64)}])assert.equal(discoveryConfigReady(c),false);
});

test('strict directory DTO rejects execution, foreign context/actor, duplicates, impossible supplies and false completeness',()=>{
  login();const q=discoveryRequest({config:config(),section:'projects'});assert.equal(checkedDiscoveryPage(discoveryPage(),q,config()).result.rows[0].projectIdHex,projectId);
  for(const mutate of [p=>{p.actor=other;},p=>{p.context.domainHex='0'.repeat(64);},p=>{p.intent={};},p=>{p.readFlags.networkSubmitted=true;},p=>{p.coverage.fullWallet=true;},p=>{p.coverage.consistency='SINGLE_SLOT';},p=>{p.rows[0].recordVerified=false;},p=>{p.rows[0].classes[0].supply='4';},p=>{p.rows[0].classes[0].issued='101';},p=>{p.rows.push(clone(p.rows[0]));},p=>{p.rows=Array.from({length:9},(_,i)=>projectRow({projectIdHex:String(i).repeat(64)}));},p=>{p.coverage.pending=true;},p=>{p.rows[0].observedSlot='999';}]){const p=discoveryPage();mutate(p);assert.throws(()=>checkedDiscoveryPage(p,q,config()));}
  const mine=discoveryRequest({config:config(),section:'my-projects'});assert.throws(()=>checkedDiscoveryPage(discoveryPage({section:'my-projects',rows:[projectRow({creator:other})]}),mine,config()));
  assert.throws(()=>checkedDiscoveryPage(discoveryPage(),{...q,query:'never matches'},config()));
});

test('15-page structure stays exclusive; unauthenticated discovery is closed and mount/navigation call config only',async()=>{
  const ui=await mounted({authenticated:false});assert.equal(ui.document.views.length,15);assert.equal(ui.document.nav.length,15);for(const id of ['directory-start','directory-next','directory-use','directory-section','directory-query'])assert.equal(ui.document.getElementById(id).disabled,true);
  const before=ui.calls.length;for(const nav of ui.document.nav){nav.click();assert.equal(ui.document.views.filter(v=>!v.hidden).length,1);assert.equal(ui.document.views.find(v=>!v.hidden).id,nav.dataset.view+'-view');}assert.equal(ui.calls.length,before);assert.ok(ui.calls.every(c=>c.action==='config'));
  const css=await readFile(new URL('../apps/player/dist/style.css',import.meta.url),'utf8');assert.match(css,/\.sidebar>nav\{[^}]*overflow-y:auto/);assert.match(css,/@media\(max-width:620px\)\{\.sidebar\{[^}]*height:auto/);assert.match(css,/max-height:148px[^}]*overflow:auto/);
});

test('server search continues beyond an empty first page and each request keeps the canonical query',async()=>{
  let n=0;const ui=await mounted({handler:(a,b)=>a==='discovery-read'?response(++n===1?discoveryPage({rows:[],nextCursor:cursor,coverage:{...discoveryPage().coverage,state:'IN_PROGRESS',pending:true}}):discoveryPage()):undefined});
  await ui.fill('directory-query',' target ');await ui.click('directory-start');assert.equal(ui.document.getElementById('directory-next').disabled,false);assert.match(allText(ui.document.getElementById('directory-rows')),/还有分区或候选/);await ui.click('directory-next');assert.equal(ui.state.page.result.rows.length,1);assert.deepEqual(ui.calls.filter(c=>c.action==='discovery-read').map(c=>c.body),[{actor,section:'projects',cursor:null,query:'target'},{actor,section:'projects',cursor,query:'target'}]);assert.match(ui.document.getElementById('directory-coverage').textContent,/多时点观察/);assert.match(ui.document.getElementById('directory-coverage').textContent,/不能证明全钱包/);
});

test('directory cap is labelled as project terms; unordered records and HTML-like names remain safe text',async()=>{
  const ui=await mounted({handler:a=>a==='discovery-read'?response(discoveryPage({rows:[projectRow({name:'<img src=x onerror=bad>',createdSlot:'90'}),projectRow({projectIdHex:'cd'.repeat(32),createdSlot:'30'})]})):undefined});await ui.click('directory-start');const text=allText(ui.document.getElementById('directory-rows'));assert.match(text,/<img src=x onerror=bad>/);assert.match(text,/项目已发行 \/ 项目上限/);assert.ok(!text.includes('97'));assert.ok(!text.includes('最新发售'));assert.equal(ui.state.page.result.rows[0].createdSlot,'90');
});

test('handoff fills only existing project reader and normal events invalidate old plans; no project read/plan or wallet action is automatic',async()=>{
  const ui=await mounted({integrate:true});await ui.click('directory-start');await ui.fill('directory-selection',projectId,'change');const before=ui.calls.length;await ui.click('directory-use');assert.equal(ui.document.getElementById('project-read-id').value,projectId);assert.equal(ui.document.getElementById('project-actor').value,actor);assert.equal(ui.document.views.find(v=>!v.hidden).id,'project-view');assert.equal(ui.calls.length,before);assert.equal(ui.state.page,null);assert.ok(!ui.calls.some(c=>['project-read','project-plan','prepare','broadcast'].includes(c.action)));
});

test('query/section/navigation invalidate rows and cursors; old row cannot hand off across actor or release context',async()=>{
  const ui=await mounted();await ui.click('directory-start');const old=ui.state.page;await ui.fill('directory-selection',projectId,'change');await ui.fill('directory-query','new');assert.equal(ui.state.page,null);assert.equal(ui.document.getElementById('directory-use').disabled,true);await ui.fill('directory-section','my-projects','change');assert.equal(ui.state.page,null);assert.throws(()=>handoffDirectoryProject(ui.document,old,projectId,{...config(),sessionActor:other}));assert.throws(()=>handoffDirectoryProject(ui.document,old,projectId,{...config(),configHex:'0'.repeat(64)}));
});

test('late response after auth expiry/account change cannot restore rows, continuation or handoff',async()=>{
  let resolve,started;const ready=new Promise(r=>started=r);const ui=await mounted({handler:a=>a==='discovery-read'?(started(),new Promise(r=>resolve=r)):undefined});ui.document.getElementById('directory-start').click();await ready;const pending=ui.calls.at(-1);setBrowserAuthSession(null);ui.document.dispatchEvent({type:'biolab-auth-change'});resolve(response(discoveryPage({nextCursor:cursor,coverage:{...discoveryPage().coverage,state:'IN_PROGRESS',pending:true}})));await flush();await flush();assert.equal(pending.signal.aborted,true);assert.equal(ui.state.page,null);assert.equal(ui.document.getElementById('directory-use').disabled,true);assert.equal(ui.document.getElementById('directory-next').disabled,true);
});

test('restart/overflow and malformed later response do not claim empty complete data or leave stale selection enabled',async()=>{
  let decision='DISCOVERY_RESTART_REQUIRED';const ui=await mounted({handler:a=>a==='discovery-read'?response(decision==='bad'?{...discoveryPage(),readFlags:{...discoveryPage().readFlags,transactionExecuted:true}}:discoveryPage({decision,rows:[],coverage:{...discoveryPage().coverage,state:'OVERFLOW'},issues:[{code:'DISCOVERY_LIMIT'}]})):undefined});await ui.click('directory-start');assert.equal(ui.document.getElementById('directory-use').disabled,true);assert.match(ui.document.getElementById('directory-coverage').textContent,/覆盖不足/);decision='bad';await ui.click('directory-start');assert.equal(ui.state.page,null);assert.equal(ui.document.getElementById('directory-use').disabled,true);assert.match(ui.document.getElementById('directory-message').textContent,/执行或行动资格/);
});

test('401 or403 closes directory identity and clears cursors until an explicit session/config reread',async()=>{
  for(const status of [401,403]){const ui=await mounted({handler:a=>a==='discovery-read'?response({error:'login required'},status):undefined});await ui.click('directory-start');assert.equal(ui.state.config,null);assert.equal(ui.state.page,null);assert.equal(ui.state.resume,null);assert.equal(ui.document.getElementById('directory-start').disabled,true);assert.equal(ui.document.getElementById('directory-use').disabled,true);assert.match(ui.document.getElementById('directory-message').textContent,/权限已失效/);}
});
