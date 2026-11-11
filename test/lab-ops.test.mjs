import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountLabOperations,chooseLabJourney} from '../apps/player/dist/lab-ops.js';
import {preparePlaytestCheckpoint,createLabSimulationRuntime} from '../apps/playtest/runtime.mjs';
import {Element} from './discovery-ui-fixture.mjs';

const html=await readFile(new URL('../apps/player/dist/lab.html',import.meta.url),'utf8');
const initial=await createLabSimulationRuntime({checkpoint:await preparePlaytestCheckpoint()}),checkpoint=initial.exportState();
const RUN='b1'.repeat(32),PREF='mogusbio:lab-sim:preferences:v1';
const flatten=element=>[element,...element.children.flatMap(flatten)],flush=()=>new Promise(resolve=>setImmediate(resolve));
const text=element=>flatten(element).map(item=>item.textContent).join(' ');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
class DomElement extends Element{
  append(...children){super.append(...children);for(const child of children)child.parentElement=this;}
  removeEventListener(type,callback){this.listeners[type]=(this.listeners[type]??[]).filter(listener=>listener!==callback);}
  dispatchEvent(event){const input={preventDefault(){},stopPropagation(){},...event,target:event.target??this};for(const listener of this.listeners[event.type]??[])listener(input);return true;}
  querySelectorAll(selector){return flatten(this).slice(1).filter(item=>selector==='button'?item.tagName==='button':selector==='span'?item.tagName==='span':false);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  focus(){this.ownerDocument.activeElement=this;}
}
function documentFixture(){
  const fixed=new Map(),all=[],document=new DomElement('document');document.activeElement=null;
  document.createElement=tag=>{const element=new DomElement(tag);element.ownerDocument=document;return element;};document.createElementNS=(_,tag)=>document.createElement(tag);
  for(const [,tag,attributes]of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)){
    const element=document.createElement(tag);for(const [,name,value]of attributes.matchAll(/([a-z-]+)="([^"]*)"/g)){element.setAttribute(name,value);if(name==='id'){element.id=value;fixed.set(value,element);}if(name.startsWith('data-'))element.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;}
    element.hidden=/\bhidden\b/.test(attributes);all.push(element);
  }
  document.getElementById=id=>fixed.get(id)??all.flatMap(flatten).find(element=>element.id===id)??null;
  document.querySelectorAll=selector=>selector==='[data-operation]'?all.filter(element=>element.dataset.operation):selector==='[data-journey-step]'?all.filter(element=>element.dataset.journeyStep):[];
  document.defaultView={};return document;
}
async function fixture({anonymous=false,savedPreferences,storageMap=new Map()}={}){
  const runtime=await createLabSimulationRuntime({checkpoint}),document=documentFixture(),operations=[],inspected=[],ownedPreviews=[],inventories=[],calls=[],gates=new Map(),unknown=new Set();let authenticated=!anonymous,revision=0;
  if(savedPreferences)storageMap.set(PREF,JSON.stringify(savedPreferences));
  const storage={getItem:key=>storageMap.get(key)??null,setItem:(key,value)=>storageMap.set(key,value),removeItem:key=>storageMap.delete(key)};
  const envelope=()=>authenticated?{profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,authenticated:true,runId:RUN,revision:String(revision),state:runtime.snapshot()}:{profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,authenticated:false};
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const fetchImpl=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;calls.push({url,body,method:init.method??'GET'});
    if(url.endsWith('/config'))return json({enabled:true,referenceModel:true,networkSubmitted:false});
    if(init.method!=='POST')return json(envelope());
    if(url.endsWith('/start')){authenticated=true;return json(envelope());}
    if(unknown.delete(body.action))return json({code:'PLAYTEST_BUSY',outcome:'UNKNOWN'},503);
    const gate=gates.get(body.action);if(gate){gates.delete(body.action);await gate.promise;}
    try{runtime.execute({action:body.action,params:body.params});revision++;return json(envelope());}catch(error){return json({profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,code:error.code??'PLAYTEST_FIELDS'},400);}
  };
  const ops=mountLabOperations(document,{fetchImpl,storage,window:document.defaultView,onOperation:id=>operations.push(id),onSpecimen:id=>inspected.push(id),onWork:work=>ownedPreviews.push(work),onInventory:works=>inventories.push(works.map(w=>w.id))});await ops.ready;
  const content=()=>document.getElementById('lab-ops-content'),all=()=>flatten(content()),button=label=>{const element=all().find(item=>item.tagName==='button'&&item.textContent===label);assert.ok(element,`button ${label}`);return element;};
  const field=label=>{const parent=all().find(item=>item.tagName==='label'&&item.children[0]?.textContent===label);assert.ok(parent,`field ${label}`);return parent.children[1];};
  const designerField=name=>{const element=all().find(item=>item.id?.endsWith(`-${name}`));assert.ok(element,`designer field ${name}`);return element;};
  const wait=async()=>{for(let i=0;i<100;i++){await flush();if(!ops.snapshot.busy)return;}throw Error('controller remained busy');};
  const input=(element,value,type='change')=>{element.value=String(value);element.dispatchEvent({type});};
  const capacity=value=>{const element=designerField('capacity');input(element,value,'input');let form=element.parentElement;while(form.tagName!=='form')form=form.parentElement;form.dispatchEvent({type:'submit'});};
  return{ops,runtime,document,storage,storageMap,calls,operations,inspected,ownedPreviews,inventories,all,button,field,designerField,wait,input,capacity,text:()=>text(content()),signOut(){authenticated=false;},unknownOnce(action){unknown.add(action);},gate(action){const gate=deferred();gates.set(action,gate);return gate;}};
}

test('HTML-backed operations are English, CSP-safe and passive until the player acts',async()=>{
  const f=await fixture();
  try{
    for(const id of ['projects','supplies','design','workshop','assembly','energy','market','assets']){
      f.ops.open(id);assert.doesNotMatch(f.text(),/[\u3400-\u9fff]/,id);assert.ok(f.text().length>30,id);
      for(const element of f.all()){assert.ok(!['style','script','iframe'].includes(element.tagName),id);assert.equal(element.attributes.style,undefined,id);}
    }
    assert.equal(f.calls.filter(call=>call.method==='POST').length,0,'visiting apparatus does not execute operations');
    assert.equal(f.document.getElementById('lab-ops').attributes.role,'dialog');
    assert.equal(f.document.getElementById('lab-ops').attributes['aria-labelledby'],'lab-ops-title');
    f.ops.open('design');assert.equal(f.all().filter(element=>element.attributes['data-role']).length,15,'selectedGraph fallback mounts actual nodes');
  }finally{f.ops.dispose();}
});

test('a fresh account progresses through material purchase, individual components, a cell and settled LAB',async()=>{
  const f=await fixture({anonymous:true});
  try{
    assert.equal(chooseLabJourney(null).operation,'account');await f.ops.next();assert.equal(f.ops.snapshot.current.state.works.length,0);
    assert.equal(f.ops.snapshot.current.state.materials.every(material=>material.amount==='0'),true);
    f.button('Buy reference materials · 120 units').click();await f.wait();let state=f.ops.snapshot.current.state;
    assert.deepEqual(state.materials.map(material=>material.amount),['30','60','15','15']);assert.equal(state.works.length,0,'buying does not auto-manufacture');
    await f.ops.next();assert.equal(f.operations.at(-1),'workshop','first component does not require a cell blueprint');f.button('Manufacture 1 component').click();await f.wait();assert.equal(f.ops.snapshot.current.state.works.length,1);
    await f.ops.next();assert.equal(f.operations.at(-1),'design');f.button('Use this validated blueprint').click();await f.wait();assert.equal(f.operations.at(-1),'workshop');
    for(let primitive=2;primitive<=4;primitive++){
      assert.equal(f.field('Component function').value,String(primitive),'next missing component is selected');f.button('Manufacture 1 component').click();await f.wait();
    }
    state=f.ops.snapshot.current.state;assert.equal(state.works.length,4);assert.deepEqual(state.works.map(work=>work.primitive).sort(),[1,2,3,4]);
    await f.ops.next();assert.equal(f.operations.at(-1),'assembly');f.button('Validate & assemble 1 cell').click();await f.wait();
    state=f.ops.snapshot.current.state;assert.equal(state.works.length,1);assert.equal(state.works[0].scope,'CELL');assert.equal(state.works[0].target,4);assert.equal(state.lab.manufactureBurnedAtoms,'800000');
    f.ops.open('energy');f.button('Stake specimen').click();await f.wait();f.button('Settle 2 simulation hours').click();await f.wait();
    state=f.ops.snapshot.current.state;assert.ok(BigInt(state.lab.unclaimedAtoms)>0n);const amount=BigInt(state.lab.unclaimedAtoms),before=BigInt(state.lab.balanceAtoms);
    f.button('Claim settled LAB').click();await f.wait();state=f.ops.snapshot.current.state;assert.equal(BigInt(state.lab.balanceAtoms),before+amount);assert.equal(state.lab.unclaimedAtoms,'0');assert.equal(state.ledgerInvariant.valid,true);
  }finally{f.ops.dispose();}
});

test('changing challenge invalidates visible PASS and saving uses the edited exact graph',async()=>{
  const f=await fixture();
  try{
    f.ops.open('design');f.button('Run functional experiment').click();await f.wait();assert.match(f.text(),/EXPERIMENT PASSED/);
    f.input(f.field('Requested challenge'),1500000);assert.doesNotMatch(f.text(),/EXPERIMENT PASSED/);assert.match(f.text(),/Requested challenge changed/);
    f.capacity('90');f.input(f.field('Your design name'),'Adaptive controller test');f.button('Validate & save my blueprint').click();await f.wait();
    const state=f.ops.snapshot.current.state,saved=state.designs.find(design=>design.id===state.selectedDesignId);assert.equal(saved.isReference,false);assert.equal(saved.name,'Adaptive controller test');assert.equal(state.selectedGraph.cells.find(cell=>cell.role===4).v,900000);assert.equal(saved.challenge,1500000);
    const request=f.calls.findLast(call=>call.body?.action==='design-save');assert.equal(request.body.params.graph.cells.find(cell=>cell.role===4).v,900000);assert.equal(request.body.params.challenge,1500000);
  }finally{f.ops.dispose();}
});

test('a delayed save locks user controls and preserves any newer programmatic draft edits',async()=>{
  const f=await fixture();
  try{
    f.ops.open('design');f.input(f.field('Requested challenge'),1500000);f.capacity('90');const gate=f.gate('design-save');f.button('Validate & save my blueprint').click();await flush();
    assert.equal(f.ops.snapshot.busy,true);assert.equal(f.field('Requested challenge').disabled,true);assert.equal(f.all().find(element=>element.className==='lab-op-designer').inert,true);assert.equal(f.document.getElementById('lab-ops').attributes['aria-busy'],'true');
    f.capacity('80');gate.resolve();await f.wait();
    assert.equal(f.ops.snapshot.current.state.selectedGraph.cells.find(cell=>cell.role===4).v,900000,'server saved only the submitted graph');
    assert.equal(f.designerField('capacity').value,'80','newer unsaved edits survive the older save response');assert.doesNotMatch(f.text(),/EXPERIMENT PASSED/);
    assert.equal(f.document.getElementById('lab-ops').attributes['aria-busy'],'false');
  }finally{f.ops.dispose();}
});

test('an uncertain operation exposes an enabled recovery button and retries the exact request',async()=>{
  const f=await fixture();
  try{
    f.ops.open('design');f.unknownOnce('design-test');f.button('Run functional experiment').click();await f.wait();assert.ok(f.ops.snapshot.pending);assert.equal(f.ops.snapshot.busy,false);
    f.ops.open('assets');const retry=f.button('Retry pending operation');assert.equal(retry.disabled,false,'pending blocks new writes but must permit recovery');retry.click();await f.wait();
    assert.equal(f.ops.snapshot.pending,null);const requests=f.calls.filter(call=>call.body?.action==='design-test');assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body,'recovery keeps request ID, revision and exact graph');
    assert.equal(f.ops.snapshot.current.state.lastResult.action,'design-test');assert.equal(f.ops.snapshot.current.state.lastResult.rounds,73);
  }finally{f.ops.dispose();}
});

test('changing modal sections preserves the outside focus target and Escape closes the activity',async()=>{
  const f=await fixture();
  try{
    const outside=f.document.querySelectorAll('[data-operation]').find(element=>element.dataset.operation==='supplies');outside.focus();f.ops.open('supplies');assert.equal(f.document.activeElement,f.document.getElementById('lab-ops-close'));
    f.ops.open('design');f.document.dispatchEvent({type:'keydown',key:'Escape'});assert.equal(f.document.getElementById('lab-ops').hidden,true);assert.equal(f.document.activeElement,outside,'focus returns to the original external trigger after tab changes');
  }finally{f.ops.dispose();}
});

test('stale preference runs do not skip initial design and disposed controllers remain quiet',async()=>{
  const f=await fixture({savedPreferences:{runId:'c2'.repeat(32),designConfirmed:true}});
  try{
    const projectId=f.ops.snapshot.current.state.selectedProjectId;await f.ops.act('project-buy-kit',{projectId});await f.ops.next();assert.equal(f.operations.at(-1),'workshop');await f.ops.act('manufacture-part',{primitive:1,profile:0});await f.ops.next();assert.equal(f.operations.at(-1),'design','a new run still requires a blueprint for the first cell');
    f.ops.open('design');const gate=f.gate('design-test');f.button('Run functional experiment').click();await flush();const count=f.operations.length;
    f.ops.dispose();const before=f.text();gate.resolve();await f.wait();assert.equal(f.text(),before,'late validation does not remount disposed DOM');assert.equal(f.operations.length,count);
    assert.equal((f.document.listeners.keydown??[]).length,0);for(const element of f.document.querySelectorAll('[data-operation]'))assert.equal((element.listeners.click??[]).length,0);
  }finally{f.ops.dispose();}
});

test('owned specimen preview receives current ownership after escrow, cancellation and sale',async()=>{
  const f=await fixture();try{
    await f.ops.act('project-buy-kit',{projectId:f.ops.snapshot.current.state.selectedProjectId});await f.ops.act('manufacture-part',{primitive:1,profile:0});
    const work=f.ops.snapshot.current.state.works[0];assert.equal(f.ownedPreviews.at(-1).id,work.id);assert.ok(f.inventories.at(-1).includes(work.id));
    await f.ops.act('market-list',{assetType:'WORK',workId:work.id,priceLamports:'1000000'});let listing=f.ops.snapshot.current.state.market.listings.find(l=>l.workId===work.id&&l.status==='OPEN');assert.ok(listing);assert.equal(f.inventories.at(-1).includes(work.id),false);
    await f.ops.act('market-cancel',{listingId:listing.id});assert.ok(f.inventories.at(-1).includes(work.id));assert.equal(f.ownedPreviews.at(-1).id,work.id);
    await f.ops.act('market-list',{assetType:'WORK',workId:work.id,priceLamports:'1000000'});listing=f.ops.snapshot.current.state.market.listings.find(l=>l.workId===work.id&&l.status==='OPEN');await f.ops.act('market-test-counterparty-buy',{listingId:listing.id});assert.equal(f.inventories.at(-1).includes(work.id),false);assert.equal(f.ops.snapshot.current.state.works.length,0);
  }finally{f.ops.dispose();}
});

test('losing an authenticated simulation notifies empty inventory so an owned 3D preview cannot remain claimed',async()=>{const f=await fixture();try{f.ops.open('supplies');f.button('Buy reference materials · 120 units').click();await f.wait();f.ops.open('workshop');f.button('Manufacture 1 component').click();await f.wait();assert.equal(f.inventories.at(-1).length,1);f.signOut();f.button('Refresh ledger').click();await f.wait();assert.equal(f.ops.snapshot.current,null);assert.deepEqual(f.inventories.at(-1),[]);}finally{f.ops.dispose();}});
