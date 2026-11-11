import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountNativeConsole } from '../apps/player/dist/native-console.js';
import { mountGuidedOperations } from '../apps/player/dist/guided-operations.js';
import { projectName,projectPlanRequest,projectReadRequest,projectStatusRequest,checkedProjectPlan,checkedProjectRead,checkedProjectStatus,
  createProjectState,invalidateProjectState,isCurrentProjectOperation,mountProjectOperations } from '../apps/player/dist/project-operations.js';

const actor='11111111111111111111111111111111',seller='22222222222222222222222222222222',projectIdHex='ab'.repeat(32),nonce='9007199254740993';
const resources={computeUnitLimit:500000,loadedAccountsDataSizeLimit:100000,heapSize:32768,priorityFeeLamports:'0'};
const classes=Array.from({length:4},(_,i)=>({class:i+1,cap:String(100+i),unitPrice:String(i)}));
const values={actor,name:'生物实验 BioLab',seller,classes,maxCreationFee:'18446744073709551615',maxRent:'1000000',resources:JSON.stringify(resources),projectIdHex,nonce};
const mintAddresses=['33333333333333333333333333333333','44444444444444444444444444444444','55555555555555555555555555555555','66666666666666666666666666666666'];
const action=request=>({decision:'ACTION',actor:request.actor,clientPlanOnly:true,transactionExecuted:false,nonceReserved:false,
  intent:{operation:'CREATE_PROJECT',nonce,payloadHex:'00017fff',suffix:[],dynamicAccounts:[],resources:request.resources},preview:{projectIdHex,name:request.name}});
const actualRecords=()=>({decision:'PROJECT_READ',actor,projectIdHex,clientPlanOnly:true,transactionExecuted:false,projectRecordVerified:true,businessExecutionVerified:false,contextSlot:'21',
  project:{projectIdHex,address:'77777777777777777777777777777777',name:values.name,creator:actor,seller,creationBusinessHex:'cd'.repeat(32),
    classes:classes.map((entry,i)=>({...entry,mint:mintAddresses[i],issued:'3',intakeBurned:'1'}))},
  mints:classes.map((entry,i)=>({class:entry.class,address:mintAddresses[i],authority:'88888888888888888888888888888888',supply:'2',decimals:0}))});
const statusRecords=(exact=false)=>({...actualRecords(),decision:exact?'CONFIRMED':'ALREADY_PROCESSED',nonce,lookupOnly:true,
  exactRequestExecutionVerified:exact,businessExecutionVerified:exact,recordMatchesRequest:true,receipt:exact?{projectIdHex,projectAddress:'77777777777777777777777777777777',mints:mintAddresses,creationFeeLamports:'1000000000',rentLamports:'1000000'}:null,resultSource:exact?'receipt':'project'});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

class Element{
  constructor(tagName='div'){this.tagName=tagName;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.disabled=false;this.hidden=false;this.textContent='';this._value='';this.className='';
    this.classList={toggle:(name,on)=>{const names=new Set(this.className.split(' ').filter(Boolean));if(on)names.add(name);else names.delete(name);this.className=[...names].join(' ');}};}
  get value(){return this._value;}set value(value){this._value=String(value);}
  set innerHTML(_){throw new Error('unsafe innerHTML is forbidden');}
  append(...children){for(const child of children){this.children.push(child);if(this.tagName==='select'&&this.children.length===1)this.value=child.value;}}
  replaceChildren(...children){this.children=[];if(this.tagName==='select')this.value='';this.append(...children);}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,handler){(this.listeners[name]??=[]).push(handler);}
  dispatchEvent(event){for(const handler of this.listeners[event.type]??[])handler({type:event.type,target:this});return true;}
  click(){if(!this.disabled)this.dispatchEvent({type:'click'});}
  async trigger(name){if(name==='click')this.click();else this.dispatchEvent({type:name});await tick();}
}

async function documentFixture(){
  const html=await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8'),elements=new Map(),nav=[],views=[];
  for(const [,tag,attributes]of html.matchAll(/<([a-z-]+)\b([^>]*)>/g)){
    const element=new Element(tag),id=attributes.match(/\bid="([^"]+)"/)?.[1];if(id){element.id=id;elements.set(id,element);}
    element.className=attributes.match(/\bclass="([^"]+)"/)?.[1]??'';element.value=attributes.match(/\bvalue="([^"]*)"/)?.[1]??'';
    element.disabled=/\bdisabled\b/.test(attributes);element.hidden=/\bhidden\b/.test(attributes);
    const view=attributes.match(/\bdata-view="([^"]+)"/)?.[1];if(view){element.dataset.view=view;nav.push(element);}if(element.className.split(' ').includes('view'))views.push(element);
  }
  for(const [,attributes,content]of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)){const id=attributes.match(/\bid="([^"]+)"/)?.[1];if(id)elements.get(id).value=content;}
  for(const [,attributes,content]of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){
    const id=attributes.match(/\bid="([^"]+)"/)?.[1];if(!id)continue;const select=elements.get(id);
    for(const [,optionAttributes,label]of content.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)){
      const option=new Element('option');option.value=optionAttributes.match(/\bvalue="([^"]*)"/)?.[1]??label;option.textContent=label;select.append(option);
      if(/\bselected\b/.test(optionAttributes))select.value=option.value;
    }
  }
  // Retain the current app.js listener order/three-name limitation. The actual
  // native/guided/project adapters below must make all fifteen views exclusive afterward.
  for(const button of nav)button.addEventListener('click',()=>{
    for(const item of nav)item.classList.toggle('active',item===button);
    for(const name of ['builder','flow','economy'])elements.get(name+'-view').hidden=name!==button.dataset.view;
    elements.get('page-title').textContent=({builder:'构造工作台',flow:'玩家路径',economy:'产出与原料'})[button.dataset.view];
  });
  return {getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),querySelectorAll:selector=>selector==='.nav-item'?nav:selector==='.view'?views:[],
    defaultView:{Event:class{constructor(type){this.type=type;}}},elements,nav,views};
}


async function mounted({enabled=true,handler}={}){
  const document=await documentFixture(),calls=[],walletCalls={connect:0,sign:0,send:0};
  const wallet={name:'fixture',chains:['solana:localnet'],accounts:[],features:{'standard:connect':{connect:()=>{walletCalls.connect++;return{accounts:[]};}},
    'solana:signTransaction':{supportedTransactionVersions:[1],signTransaction:()=>{walletCalls.sign++;}},'solana:signAndSendTransaction':{signAndSendTransaction:()=>{walletCalls.send++;}}}};
  const fetchImpl=async(url,options)=>{
    const name=url.split('/').at(-1),body=options.body?JSON.parse(options.body):undefined;calls.push({name,body,signal:options.signal});
    const override=handler?.(name,body,options);if(override!==undefined)return override;
    if(name==='config')return response({enabled,chain:'solana:localnet'});
    if(name==='project-plan')return response(action(body));
    if(name==='project-read')return response(actualRecords());
    if(name==='project-status')return response(statusRecords());
    throw new Error(`Unexpected execution API ${name}`);
  };
  const native=await mountNativeConsole(document,{fetchImpl,getWallets:()=>({get:()=>[wallet],on(){}})});
  const guided=await mountGuidedOperations(document,{fetchImpl});
  const project=await mountProjectOperations(document,{fetchImpl});
  const set=async(id,value,event='input')=>{const element=document.getElementById(id);element.value=value;await element.trigger(event);};
  const click=id=>document.getElementById(id).trigger('click');
  const draft=async()=>{await set('project-actor',actor);await set('project-name',values.name);await set('project-seller',seller);
    for(const entry of classes){await set('project-cap-'+entry.class,entry.cap);await set('project-price-'+entry.class,entry.unitPrice);}
    await set('project-max-creation-fee',values.maxCreationFee);await set('project-max-rent',values.maxRent);};
  const read=async()=>{await click('project-tab-read');await set('project-actor',actor);await set('project-read-id',projectIdHex);await click('project-read');};
  return {document,calls,walletCalls,native,guided,...project,set,click,draft,read};
}

test('exact creation/read/status bodies retain decimal precision and enforce UTF-8 names and all four direct classes',()=>{
  assert.deepEqual(projectPlanRequest(values),{actor,name:values.name,seller,classes,maxCreationFee:values.maxCreationFee,maxRent:values.maxRent,resources});
  assert.deepEqual(projectReadRequest(values),{actor,projectIdHex});assert.deepEqual(projectStatusRequest(values),{actor,nonce});
  assert.equal(projectName('界'.repeat(21)+'x'),'界'.repeat(21)+'x');assert.equal(projectName('😀'.repeat(16)),'😀'.repeat(16));
  for(const name of ['', '界'.repeat(22),'😀'.repeat(16)+'x','x\n','x\u0085','\ud800'])assert.throws(()=>projectName(name));
  for(const mutation of [{seller:''},{actor:'bad'},{maxCreationFee:'01'},{maxRent:'1e9'},{classes:classes.slice(0,3)},
    {classes:[...classes].reverse()},{classes:classes.map((entry,i)=>i===1?{...entry,cap:'0'}:entry)},
    {classes:classes.map((entry,i)=>i===2?{...entry,cap:'1000001'}:entry)},
    {classes:classes.map((entry,i)=>i===0?{...entry,unitPrice:'18446744073709451616'}:entry)},
    {classes:classes.map((entry,i)=>i===0?{...entry,unitPrice:'01'}:entry)},
    {resources:JSON.stringify({...resources,priorityFeeLamports:0})}])assert.throws(()=>projectPlanRequest({...values,...mutation}));
  const large=classes.map(entry=>({...entry,cap:'1000000',unitPrice:'18446744073709451615'}));
  assert.deepEqual(projectPlanRequest({...values,classes:large}).classes,large,'CREATE has no artificial cap × price bound');
});

test('drafts cannot establish creation; reads require actual verified project and four mutually consistent mints',()=>{
  const request=projectPlanRequest(values),good=action(request);assert.deepEqual(checkedProjectPlan(good,request).intent,good.intent);
  for(const bad of [{...good,clientPlanOnly:false},{...good,transactionExecuted:true},{...good,actor:seller},
    {...good,intent:{...good.intent,operation:'BUY_MATERIAL'}},{...good,intent:{...good.intent,resources:{...resources,heapSize:65536}}}])assert.throws(()=>checkedProjectPlan(bad,request));
  assert.equal(checkedProjectPlan({decision:'WAIT_EPOCH'},request),null);assert.throws(()=>checkedProjectPlan({decision:'WAIT_EPOCH',intent:good.intent},request));
  const query=projectReadRequest(values),actual=actualRecords();assert.equal(checkedProjectRead(actual,query).project.projectIdHex,projectIdHex);
  for(const mutate of [records=>{records.projectRecordVerified=false;},records=>{records.businessExecutionVerified=true;},records=>{records.actor=seller;},
    records=>{records.projectIdHex='ef'.repeat(32);},records=>{records.project.classes[0].mint=mintAddresses[1];},
    records=>{records.mints[0].decimals=6;},records=>{records.mints.pop();},records=>{records.intent=good.intent;},
    records=>{records.project.classes[1].class=1;},records=>{records.contextSlot=21;}]){const records=actualRecords();mutate(records);assert.throws(()=>checkedProjectRead(records,query));}
  assert.equal(checkedProjectRead({decision:'PROJECT_NOT_FOUND',actor,projectIdHex,projectRecordVerified:false,clientPlanOnly:true,transactionExecuted:false,project:null},query),null);
  const state=createProjectState(),controller={};assert.equal(isCurrentProjectOperation(state,0,controller,controller),true);invalidateProjectState(state);assert.equal(isCurrentProjectOperation(state,0,controller,controller),false);
});

test('status distinguishes exact CREATE execution from matching project records after cached receipt overwrite',()=>{
  const query=projectStatusRequest(values),exact=statusRecords(true),matching=statusRecords();
  assert.equal(checkedProjectStatus(exact,query).project.projectIdHex,projectIdHex);
  assert.equal(checkedProjectStatus(matching,query).project.projectIdHex,projectIdHex);
  for(const mutation of [{nonce:'0'},{actor:seller},{lookupOnly:false},{transactionExecuted:true},
    {exactRequestExecutionVerified:true},{businessExecutionVerified:true},
    {exactRequestExecutionVerified:true,businessExecutionVerified:true,decision:'CONFIRMED',receipt:null}])assert.throws(()=>checkedProjectStatus({...matching,...mutation},query));
  assert.equal(checkedProjectStatus({...matching,recordMatchesRequest:false},query),null);
  assert.equal(checkedProjectStatus({...matching,projectRecordVerified:false,recordMatchesRequest:false,project:null,mints:null},query),null);
  assert.throws(()=>checkedProjectStatus({...exact,receipt:{...exact.receipt,projectIdHex:'ef'.repeat(32)}},query));
  assert.throws(()=>checkedProjectStatus({...exact,receipt:{...exact.receipt,mints:[...mintAddresses].reverse()}},query));
});

test('default disabled gates all project inputs, execution handoffs and reads; actual listeners preserve all fifteen views',async()=>{
  const ui=await mounted({enabled:false});assert.equal(ui.document.views.length,15);
  for(const id of ['actor','name','seller','cap-1','price-4','resources','read-id','status-nonce','plan','read','status','use-intent','use-purchase','use-actor'])assert.equal(ui.document.getElementById('project-'+id).disabled,true);
  for(const button of ui.document.nav){await button.trigger('click');for(const view of ui.document.views)assert.equal(view.hidden,view.id!==button.dataset.view+'-view');}
  await ui.document.nav.find(button=>button.dataset.view==='project').trigger('click');assert.equal(ui.document.getElementById('page-title').textContent,'创建与发售');
  assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});assert.ok(ui.calls.every(call=>call.name==='config'));
});

test('creation handoff fills both native inputs before their events, clears old signatures, and makes no transaction or wallet call',async()=>{
  const ui=await mounted();await ui.draft();await ui.click('project-plan');
  assert.equal(ui.calls.at(-1).name,'project-plan');assert.deepEqual(ui.calls.at(-1).body,projectPlanRequest(values));
  assert.ok(ui.state.plan);assert.equal(ui.state.verified,null);assert.match(ui.document.getElementById('project-plan-note').textContent,/未证明创建/);
  assert.equal(ui.document.getElementById('project-use-purchase').disabled,true);
  const expected=ui.state.plan.intent,observed=[];
  ui.native.state.logs.primary.signedBytes=new Uint8Array([1]);
  for(const id of ['native-actor','native-intent'])ui.document.getElementById(id).addEventListener('input',()=>observed.push({actor:ui.document.getElementById('native-actor').value,intent:JSON.parse(ui.document.getElementById('native-intent').value)}));
  const before=ui.calls.length;await ui.click('project-use-intent');assert.equal(ui.calls.length,before);assert.equal(observed.length,2);
  for(const entry of observed){assert.equal(entry.actor,actor);assert.deepEqual(entry.intent,expected);}
  assert.equal(ui.native.state.actor,actor);assert.deepEqual(JSON.parse(ui.native.state.intentText),expected);assert.equal(ui.native.state.logs.primary.envelope,null);assert.equal(ui.native.state.logs.primary.signedBytes,null);
  assert.equal(ui.state.plan,null);assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});for(const view of ui.document.views)assert.equal(view.hidden,view.id!=='native-view');
});

test('only actual verified records hand off project and Actor to purchase, selecting purchase tab without planning or paying',async()=>{
  const ui=await mounted();await ui.draft();await ui.click('project-plan');assert.equal(ui.document.getElementById('project-use-purchase').disabled,true);
  await ui.read();assert.deepEqual(ui.calls.at(-1).body,{actor,projectIdHex});assert.ok(ui.state.verified);assert.equal(ui.state.plan,null);
  await ui.click('guided-tab-asset');const before=ui.calls.length;await ui.click('project-use-purchase');assert.equal(ui.calls.length,before);
  assert.equal(ui.document.getElementById('guided-actor').value,actor);assert.equal(ui.document.getElementById('guided-project').value,projectIdHex);
  assert.equal(ui.document.getElementById('guided-purchase-panel').hidden,false);assert.equal(ui.document.getElementById('guided-asset-panel').hidden,true);assert.equal(ui.guided.state.plan,null);
  for(const view of ui.document.views)assert.equal(view.hidden,view.id!=='guided-view');assert.equal(ui.state.verified,null);assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
});

test('public CREATE status exact evidence is distinct from actual-record-only acceptance in live event rendering',async()=>{
  let exact=false;const ui=await mounted({handler:name=>name==='project-status'?response(statusRecords(exact)):undefined});
  await ui.draft();await ui.click('project-tab-read');assert.equal(ui.document.getElementById('project-status-nonce').value,'');assert.equal(ui.document.getElementById('project-status').disabled,true);
  await ui.set('project-status-nonce',nonce);await ui.click('project-status');
  assert.deepEqual(ui.calls.at(-1).body,{actor,nonce});assert.ok(ui.state.verified);assert.match(ui.document.getElementById('project-read-note').textContent,/尚未证明/);
  assert.equal(ui.document.getElementById('project-use-purchase').disabled,false);exact=true;await ui.click('project-status');
  assert.match(ui.document.getElementById('project-read-note').textContent,/精确执行证明/);assert.equal(ui.document.getElementById('project-read-badge').textContent,'CONFIRMED');
});

test('non-ACTION, malformed read/status, transport errors and unsafe strings never retain usable draft or records',async()=>{
  let mode='good';const unsafe='<img src=x onerror=attack()>',ui=await mounted({handler:(name,body)=>{
    if(name==='project-plan'&&mode==='wait')return response({decision:'WAIT',message:unsafe});
    if(name==='project-plan'&&mode==='malformed')return response({...action(body),transactionExecuted:true});
    if(name==='project-plan'&&mode==='error')return response({error:unsafe},400);
    if(name==='project-read'&&mode==='badread')return response({...actualRecords(),projectRecordVerified:false});
    if(name==='project-status'&&mode==='badstatus')return response({...statusRecords(),exactRequestExecutionVerified:true});
  }});
  await ui.draft();await ui.click('project-plan');assert.ok(ui.state.plan);
  mode='wait';await ui.click('project-plan');assert.equal(ui.state.plan,null);assert.match(ui.document.getElementById('project-plan-json').textContent,/<img/);
  mode='malformed';await ui.click('project-plan');assert.equal(ui.state.plan,null);
  mode='error';await ui.click('project-plan');assert.equal(ui.document.getElementById('project-message').textContent,unsafe);assert.equal(ui.state.plan,null);
  mode='badread';await ui.read();assert.equal(ui.state.verified,null);assert.equal(ui.document.getElementById('project-use-purchase').disabled,true);
  mode='badstatus';await ui.set('project-status-nonce',nonce);await ui.click('project-status');assert.equal(ui.state.verified,null);assert.equal(ui.state.result,null);
});

const edits=[['project-actor',seller],['project-name','new'],['project-seller',actor],['project-max-creation-fee','1'],['project-max-rent','2'],
  ['project-resources',JSON.stringify({...resources,priorityFeeLamports:'1'})],['project-read-id','ef'.repeat(32)],['project-status-nonce','3'],
  ...classes.flatMap(entry=>[['project-cap-'+entry.class,'4'],['project-price-'+entry.class,'5']])];

test('every editable field aborts the first in-flight creation and invalidates ACTION before late result acceptance',async()=>{
  for(const[id,value]of edits){let pending=false,resolveOld,oldBody,oldSignal;
    const ui=await mounted({handler:(name,body,options)=>name==='project-plan'&&pending?new Promise(resolve=>{resolveOld=resolve;oldBody=body;oldSignal=options.signal;}):undefined});
    await ui.draft();await ui.click('project-plan');assert.ok(ui.state.plan);pending=true;await ui.click('project-plan');assert.equal(ui.state.plan,null);
    await ui.set(id,value);assert.equal(oldSignal.aborted,true);assert.equal(ui.document.getElementById('project-use-intent').disabled,true);
    resolveOld(response(action(oldBody)));await tick();assert.equal(ui.state.plan,null);assert.equal(ui.state.verified,null);
  }
});

test('every input invalidates verified records and aborts pending reads/status before late results',async()=>{
  for(const[id,value]of edits){let pending=false,resolveOld,oldSignal;
    const ui=await mounted({handler:(name,_body,options)=>name==='project-read'&&pending?new Promise(resolve=>{resolveOld=resolve;oldSignal=options.signal;}):undefined});
    await ui.read();assert.ok(ui.state.verified);await ui.set(id,value);assert.equal(ui.state.verified,null);assert.equal(ui.document.getElementById('project-use-purchase').disabled,true);
    await ui.read();assert.ok(ui.state.verified);pending=true;await ui.click('project-read');await ui.set(id,value);assert.equal(oldSignal.aborted,true);
    resolveOld(response(actualRecords()));await tick();assert.equal(ui.state.verified,null);assert.equal(ui.document.getElementById('project-use-purchase').disabled,true);
  }
  let resolveStatus,signal;const ui=await mounted({handler:(name,_body,options)=>name==='project-status'?new Promise(resolve=>{resolveStatus=resolve;signal=options.signal;}):undefined});
  await ui.read();await ui.set('project-status-nonce',nonce);await ui.click('project-status');await ui.click('project-tab-create');assert.equal(signal.aborted,true);
  resolveStatus(response(statusRecords(true)));await tick();assert.equal(ui.state.verified,null);
});

test('project transport rejects oversized public responses and configuration reload invalidates every handoff',async()=>{
  let oversized=false,enabled=true;const ui=await mounted({handler:(name,body)=>{
    if(name==='config')return response({enabled,chain:'solana:localnet'});
    if(name==='project-plan'&&oversized)return response({...action(body),padding:'x'.repeat(65536)});
  }});
  await ui.draft();await ui.click('project-plan');assert.ok(ui.state.plan);await ui.click('project-reload');assert.equal(ui.state.plan,null);
  oversized=true;await ui.click('project-plan');assert.equal(ui.state.plan,null);assert.match(ui.document.getElementById('project-message').textContent,/超过/);
  await ui.read();assert.ok(ui.state.verified);enabled=false;await ui.click('project-reload');assert.equal(ui.state.verified,null);
  assert.equal(ui.document.getElementById('project-use-purchase').disabled,true);assert.equal(ui.document.getElementById('project-read').disabled,true);assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
});

test('navigation and category changes invalidate work; old late error/finally cannot clobber a newer request',async()=>{
  let pending=false;const requests=[],ui=await mounted({handler:(name,body,options)=>name==='project-plan'&&pending?new Promise((resolve,reject)=>requests.push({body,signal:options.signal,resolve,reject})):undefined});
  await ui.draft();await ui.click('project-plan');await ui.click('project-tab-read');assert.equal(ui.state.plan,null);await ui.click('project-tab-create');
  pending=true;await ui.click('project-plan');await ui.set('project-name','new');await ui.click('project-plan');assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,true);
  requests[0].reject(new Error('old late error'));await tick();assert.equal(ui.document.getElementById('project-plan').disabled,true);assert.doesNotMatch(ui.document.getElementById('project-message').textContent,/old late error/);
  requests[1].resolve(response(action(requests[1].body)));await tick();assert.equal(ui.state.plan.request.name,'new');
  await ui.document.nav.find(button=>button.dataset.view==='builder').trigger('click');assert.equal(ui.state.plan,null);await ui.click('project-plan');const last=requests.at(-1);
  await ui.click('project-tab-read');assert.equal(last.signal.aborted,true);last.resolve(response(action(last.body)));await tick();assert.equal(ui.state.plan,null);
});
