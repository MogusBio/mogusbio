import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountNativeConsole} from '../apps/player/dist/native-console.js';
import {mountGuidedOperations} from '../apps/player/dist/guided-operations.js';
import {mountProjectOperations} from '../apps/player/dist/project-operations.js';
import {inventoryReadRequest,manufacturePlanRequest,manufactureNextRequest,checkedInventoryRead,checkedManufactureWorkflow,checkedManufactureSaved,checkedManufactureNext,
 createManufactureState,invalidateManufactureState,isCurrentManufactureOperation,mountManufactureOperations} from '../apps/player/dist/manufacture-operations.js';
const actor='11111111111111111111111111111111',other='22222222222222222222222222222222',project='ab'.repeat(32),source='cd'.repeat(32),workflowId='de'.repeat(32),output='ef'.repeat(32);
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
const nonce='9007199254740993';
const values={actor,projectIdsHex:project,sourceIdsHex:source,primitive:'1',profile:'0',maxPartRent:'18446744073709551615',maxUploadRent:'10000000',resources:JSON.stringify(resources),workflowId};
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false};
const workflow=()=>({workflowId,actor,initialNonce:nonce,manufactureNonce:(BigInt(nonce)+2n).toString(),nextNonce:(BigInt(nonce)+3n).toString(),artifactIdHex:'01'.repeat(32),artifactSHAHex:'02'.repeat(32),outputIdHex:output,outputAddress:'33333333333333333333333333333333',descriptor:{primitive:1,profile:0},maxPartRent:values.maxPartRent,maxUploadRent:values.maxUploadRent,resources:{...resources},stageCount:3,newSourceIdsHex:[],existingSourceIdsHex:[source],projectIdsHex:[project],materialPlan:{intakes:[],debits:[{sourceId:source,entries:[{species:1,expectedPrefix:'0',takeTick:'1000'}]}]}});
const inventory=()=>({...flags,decision:'INVENTORY_READ',actor,actualInventoryVerified:true,contextSlot:'21',nextNonce:nonce,summary:{standardUnits:[{projectIdHex:project,class:1,mint:other,tokenAccount:'44444444444444444444444444444444',amount:'5'}],sourceBudgets:[{sourceIdHex:source,class:2,remainingTick:Array(32).fill('1000')}],totals:{ticks:Array(32).fill('1000'),totalTick:'32000',creditInt:'120000'}}});
const saved=()=>({...flags,decision:'WORKFLOW_SAVED',actor,workflow:workflow(),requiresExplicitNextRead:true});
const next=(kind='ACTION')=>({...flags,decision:kind,actor,workflow:workflow(),outputVerified:false,exactRequestExecutionVerified:false,root:null,...(kind==='ACTION'?{stage:{index:0,count:3,kind:'UPLOAD',nonce},intent:{operation:'ARTIFACT_PUT',nonce,payloadHex:'0100',suffix:[],dynamicAccounts:[],resources:{...resources}}}:{})});
const actualOutput=()=>({...next('OUTPUT_READ'),outputVerified:true,root:{instanceHex:output,owner:actor,lifecycle:0,schema:1,descriptorHex:'01000100',qualityPpm:'1000000',B:'120000',retired:'45000'}});
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
  // native/guided/project adapters below must make all seven views exclusive afterward.
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
  const wallet={name:'fixture',chains:['solana:localnet'],accounts:[],features:{'standard:connect':{connect:()=>{walletCalls.connect++;return{accounts:[]};}},'solana:signTransaction':{supportedTransactionVersions:[1],signTransaction:()=>{walletCalls.sign++;}},'solana:signAndSendTransaction':{signAndSendTransaction:()=>{walletCalls.send++;}}}};
  const fetchImpl=async(url,options)=>{const name=url.split('/').at(-1),body=options.body?JSON.parse(options.body):undefined;calls.push({name,body,signal:options.signal});const override=handler?.(name,body,options);if(override!==undefined)return override;
    if(name==='config')return response({enabled,chain:'solana:localnet'});if(name==='inventory-read')return response(inventory());if(name==='manufacture-plan')return response(saved());if(name==='manufacture-next')return response(next());throw new Error(`Unexpected execution API ${name}`);};
  const native=await mountNativeConsole(document,{fetchImpl,getWallets:()=>({get:()=>[wallet],on(){}})}),guided=await mountGuidedOperations(document,{fetchImpl}),projectUI=await mountProjectOperations(document,{fetchImpl}),manufacture=await mountManufactureOperations(document,{fetchImpl});
  const set=async(id,value,event='input')=>{const element=document.getElementById(id);element.value=value;await element.trigger(event);};const click=id=>document.getElementById(id).trigger('click');
  const fill=async()=>{await set('manufacture-actor',actor);await set('manufacture-projects',project);await set('manufacture-sources',source);await set('manufacture-max-part-rent',values.maxPartRent);await set('manufacture-max-upload-rent',values.maxUploadRent);};
  const resume=async()=>{await click('manufacture-tab-resume');await set('manufacture-actor',actor);await set('manufacture-workflow-id',workflowId);await click('manufacture-next');};
  return {document,calls,walletCalls,native,guided,projectUI,...manufacture,set,click,fill,resume};
}

test('exact bounded inventory/manufacture bodies keep canonical decimals, descriptors and known IDs',()=>{
  assert.deepEqual(inventoryReadRequest(values),{actor,projectIdsHex:[project],sourceIdsHex:[source]});
  assert.deepEqual(manufactureNextRequest(values),{actor,workflowId});
  assert.deepEqual(manufacturePlanRequest(values),{actor,projectIdsHex:[project],sourceIdsHex:[source],descriptor:{primitive:1,profile:0},maxPartRent:values.maxPartRent,maxUploadRent:values.maxUploadRent,resources});
  assert.equal(manufacturePlanRequest({...values,primitive:'4',profile:'15'}).descriptor.profile,15);
  for(const mutation of [{actor:'bad'},{projectIdsHex:project.toUpperCase()},{sourceIdsHex:`${source}\n${source}`},{projectIdsHex:Array(9).fill(project)},{sourceIdsHex:Array(17).fill(source)},
    {primitive:'4',profile:'0'},{primitive:'2',profile:'1'},{primitive:'1.5'},{profile:''},{maxPartRent:'01'},{maxUploadRent:'1e9'},{resources:JSON.stringify({...resources,priorityFeeLamports:0})}]){
    assert.throws(()=>manufacturePlanRequest({...values,...mutation}));}
  assert.throws(()=>manufactureNextRequest({...values,workflowId:'0'}));
});

test('actual inventory distinguishes standard units and source budgets and fails closed on stale/malformed records',()=>{
  const query=inventoryReadRequest(values),record=inventory();assert.equal(checkedInventoryRead(record,query).records.summary.totals.creditInt,'120000');
  for(const mutate of [r=>r.clientPlanOnly=false,r=>r.transactionExecuted=true,r=>r.networkSubmitted=true,r=>r.actor=other,r=>r.actualInventoryVerified=false,r=>r.summary.sourceBudgets[0].sourceIdHex=project,
    r=>r.summary.standardUnits.push({...r.summary.standardUnits[0]}),r=>r.summary.sourceBudgets[0].remainingTick.pop(),r=>r.summary.totals.totalTick=32000,r=>r.intent={}]){const bad=inventory();mutate(bad);assert.throws(()=>checkedInventoryRead(bad,query));}
  assert.equal(checkedInventoryRead({...flags,actor,decision:'REPLAN_STALE_STATE',actualInventoryVerified:false},query),null);
  assert.throws(()=>checkedInventoryRead({...record,decision:'REPLAN_STALE_STATE'},query));
});

test('saved immutable workflow cannot become an intent or manufacturing proof and binds descriptor/resources/rents',()=>{
  const request=manufacturePlanRequest(values);assert.equal(checkedManufactureSaved(saved(),request).workflowId,workflowId);
  for(const mutate of [r=>r.intent={},r=>r.requiresExplicitNextRead=false,r=>r.workflow.actor=other,r=>r.workflow.stageCount=4,r=>r.workflow.descriptor.profile=1,r=>r.workflow.maxPartRent='1',r=>r.workflow.resources.heapSize=65536,
    r=>r.workflow.existingSourceIdsHex.push(source),r=>r.workflow.materialPlan.debits.push({...r.workflow.materialPlan.debits[0]})]){const bad=saved();mutate(bad);assert.throws(()=>checkedManufactureSaved(bad,request));}
  assert.equal(checkedManufactureSaved({...flags,actor,decision:'BLOCKED_MATERIALS'},request),null);
  const wf=workflow();assert.equal(checkedManufactureWorkflow(wf,actor).manufactureNonce,(BigInt(nonce)+2n).toString());
});

test('next-stage intent belongs to fixed workflow window and only actual available Root may hand off',()=>{
  const query=manufactureNextRequest(values);assert.equal(checkedManufactureNext(next(),query).plan.intent.nonce,nonce);
  for(const mutate of [r=>r.workflow.workflowId=project,r=>r.stage.index=1,r=>r.stage.count=4,r=>r.stage.kind='MANUFACTURE',r=>r.stage.nonce='0',r=>r.intent.operation='MANUFACTURE_PART',r=>r.intent.resources.priorityFeeLamports='1',r=>r.outputVerified=true]){const bad=next();mutate(bad);assert.throws(()=>checkedManufactureNext(bad,query));}
  for(const decision of ['RECOVER_CURRENT_REQUEST','WAIT_UNVERIFIED_PREFIX','NONCE_WINDOW_CHANGED_REPLAN','BLOCKED_MATERIALS']){assert.equal(checkedManufactureNext(next(decision),query).plan,null);assert.throws(()=>checkedManufactureNext({...next(decision),intent:next().intent},query));}
  for(const [index,kind,operation] of [[1,'SEAL','ARTIFACT_SEAL'],[2,'MANUFACTURE','MANUFACTURE_PART']]){const result=next(),stageNonce=(BigInt(nonce)+BigInt(index)).toString();result.stage={index,count:3,kind,nonce:stageNonce};result.intent={...result.intent,operation,nonce:stageNonce};assert.equal(checkedManufactureNext(result,query).plan.stage.kind,kind);}
  assert.ok(checkedManufactureNext(next(),query,Object.fromEntries(Object.entries(workflow()).reverse())).plan);
  const outputResult=actualOutput();assert.equal(checkedManufactureNext(outputResult,query).verified.root.instanceHex,output);
  assert.equal(checkedManufactureNext({...outputResult,root:{...outputResult.root,lifecycle:1}},query).verified,null);
  for(const mutate of [r=>r.root.owner=other,r=>r.root.instanceHex=project,r=>r.root.schema=2,r=>r.root.descriptorHex='01000200',r=>r.root.lifecycle=2,r=>r.root.qualityPpm='999999',r=>r.root.B='1',r=>r.root.retired='0',r=>r.outputVerified=false]){const bad=actualOutput();mutate(bad);assert.throws(()=>checkedManufactureNext(bad,query));}
  assert.throws(()=>checkedManufactureNext(next(),query,{...workflow(),outputIdHex:project}));
  const state=createManufactureState(),controller={};assert.equal(isCurrentManufactureOperation(state,0,controller,controller),true);invalidateManufactureState(state);assert.equal(isCurrentManufactureOperation(state,0,controller,controller),false);
});

test('default disabled gates all seventh-view inputs and all fifteen views remain exclusive with actual listener order',async()=>{
  const ui=await mounted({enabled:false});assert.equal(ui.document.views.length,15);
  for(const id of ['actor','projects','sources','primitive','profile','max-part-rent','max-upload-rent','resources','workflow-id','read','save','next','open-saved','use-intent','use-root'])assert.equal(ui.document.getElementById('manufacture-'+id).disabled,true);
  for(const nav of ui.document.nav){await nav.trigger('click');for(const view of ui.document.views)assert.equal(view.hidden,view.id===nav.dataset.view+'-view'?false:true);}
  await ui.document.nav.find(nav=>nav.dataset.view==='manufacture').trigger('click');assert.equal(ui.document.getElementById('page-title').textContent,'库存与制造');assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});assert.ok(ui.calls.every(call=>call.name==='config'));
});

test('inventory read and manifest save are exact explicit requests; save requires independent next read',async()=>{
  const ui=await mounted();await ui.fill();await ui.click('manufacture-read');assert.deepEqual(ui.calls.at(-1).body,inventoryReadRequest(values));assert.ok(ui.state.inventory);assert.equal(ui.state.plan,null);
  await ui.click('manufacture-save');assert.deepEqual(ui.calls.at(-1).body,manufacturePlanRequest(values));assert.ok(ui.state.workflow);assert.equal(ui.state.plan,null);assert.equal(ui.document.getElementById('manufacture-use-intent').disabled,true);assert.equal(ui.document.getElementById('manufacture-workflow-id').value,workflowId);
  const count=ui.calls.length;await ui.click('manufacture-open-saved');assert.equal(ui.calls.length,count);assert.equal(ui.state.mode,'resume');assert.equal(ui.state.workflow,null);assert.equal(ui.document.getElementById('manufacture-workflow-id').value,workflowId);
  await ui.click('manufacture-next');assert.deepEqual(ui.calls.at(-1).body,{actor,workflowId});assert.ok(ui.state.plan);assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
});

test('current stage handoff only fills exact native inputs and clears old signatures without executing',async()=>{
  const ui=await mounted();await ui.resume();assert.ok(ui.state.plan);const expected=ui.state.plan.intent,observed=[];
  ui.native.state.logs.primary.signedBytes=new Uint8Array([1]);for(const id of ['native-actor','native-intent'])ui.document.getElementById(id).addEventListener('input',()=>observed.push({actor:ui.document.getElementById('native-actor').value,intent:JSON.parse(ui.document.getElementById('native-intent').value)}));
  const count=ui.calls.length;await ui.click('manufacture-use-intent');assert.equal(ui.calls.length,count);assert.equal(observed.length,2);for(const event of observed){assert.equal(event.actor,actor);assert.deepEqual(event.intent,expected);}
  assert.equal(ui.native.state.logs.primary.signedBytes,null);assert.equal(ui.native.state.logs.primary.envelope,null);assert.equal(ui.state.plan,null);assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});for(const view of ui.document.views)assert.equal(view.hidden,view.id!=='native-view');
});

test('only actual usable Root can fill guided instance and asset tab; never reads or stakes automatically',async()=>{
  const ui=await mounted({handler:name=>name==='manufacture-next'?response(actualOutput()):undefined});await ui.resume();assert.ok(ui.state.verified);const count=ui.calls.length;
  ui.document.getElementById('guided-page-start').value='60';ui.document.getElementById('guided-page-limit').value='1';await ui.click('manufacture-use-root');assert.equal(ui.calls.length,count);assert.equal(ui.document.getElementById('guided-page-start').value,'0');assert.equal(ui.document.getElementById('guided-page-limit').value,'5');assert.equal(ui.document.getElementById('guided-actor').value,actor);assert.equal(ui.document.getElementById('guided-instance').value,output);assert.equal(ui.guided.state.mode,'asset');assert.equal(ui.guided.state.asset,null);
  assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});for(const view of ui.document.views)assert.equal(view.hidden,view.id!=='guided-view');
  const consumed=await mounted({handler:name=>name==='manufacture-next'?response({...actualOutput(),root:{...actualOutput().root,lifecycle:1}}):undefined});await consumed.resume();assert.equal(consumed.state.verified,null);assert.equal(consumed.document.getElementById('manufacture-use-root').disabled,true);
});

test('all editable fields abort first in-flight request and reject late success',async()=>{
  for(const id of ['actor','projects','sources','primitive','profile','max-part-rent','max-upload-rent','resources','workflow-id']){
    let resolve;const ui=await mounted({handler:name=>name==='manufacture-next'?new Promise(r=>resolve=r):undefined});await ui.resume();const pending=ui.calls.at(-1);assert.equal(pending.name,'manufacture-next');
    await ui.set('manufacture-'+id,ui.document.getElementById('manufacture-'+id).value+' ');assert.equal(pending.signal.aborted,true);resolve(response(next()));await tick();await tick();assert.equal(ui.state.plan,null);assert.equal(ui.state.workflow,null);assert.equal(ui.document.getElementById('manufacture-use-intent').disabled,true);
  }
});

test('tab/navigation/config changes invalidate actual Root or draft, and late errors cannot overwrite newer result',async()=>{
  for(const change of ['tab','nav','config']){
    const ui=await mounted({handler:name=>name==='manufacture-next'?response(actualOutput()):undefined});await ui.resume();assert.ok(ui.state.verified);
    if(change==='tab')await ui.click('manufacture-tab-plan');if(change==='nav')await ui.document.nav[0].trigger('click');if(change==='config')await ui.click('manufacture-reload');
    assert.equal(ui.state.verified,null);assert.equal(ui.state.workflow,null);assert.equal(ui.document.getElementById('manufacture-use-root').disabled,true);
  }
  let reject;const ui=await mounted({handler:(name,body)=>name==='manufacture-next'&&body.workflowId===workflowId?new Promise((_,r)=>reject=r):name==='manufacture-next'?response({...next('WAIT_UNVERIFIED_PREFIX'),workflow:{...workflow(),workflowId:project}}):undefined});await ui.resume();await ui.set('manufacture-workflow-id',project);await ui.click('manufacture-next');assert.equal(ui.state.result.decision,'WAIT_UNVERIFIED_PREFIX');reject(new Error('late old failure'));await tick();assert.equal(ui.state.result.decision,'WAIT_UNVERIFIED_PREFIX');
});

test('malformed and oversized responses or transport errors retain no usable intent; strings render as text',async()=>{
  for(const result of [{...next(),transactionExecuted:true},{...next('RECOVER_CURRENT_REQUEST'),intent:next().intent},{...next(),intent:{...next().intent,nonce:'0'}}]){
    const ui=await mounted({handler:name=>name==='manufacture-next'?response(result):undefined});await ui.resume();assert.equal(ui.state.plan,null);assert.equal(ui.state.workflow,null);assert.equal(ui.document.getElementById('manufacture-use-intent').disabled,true);
  }
  const ui=await mounted({handler:name=>name==='manufacture-next'?response({...next('BLOCKED_<img onerror=evil>'),padding:'x'.repeat(66000)}):undefined});await ui.resume();assert.equal(ui.state.plan,null);assert.equal(ui.state.result,null);
  const text=await mounted({handler:name=>name==='manufacture-next'?response(next('BLOCKED_<img onerror=evil>')):undefined});await text.resume();assert.match(text.document.getElementById('manufacture-result-badge').textContent,/<img/);assert.equal(text.state.plan,null);
  const fail=await mounted({handler:name=>name==='manufacture-next'?Promise.reject(new Error('fixture failure')):undefined});await fail.resume();assert.equal(fail.state.plan,null);assert.match(fail.document.getElementById('manufacture-message').textContent,/fixture failure/);
});
