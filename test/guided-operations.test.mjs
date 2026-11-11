import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountNativeConsole } from '../apps/player/dist/native-console.js';
import { purchasePlanRequest,assetReadRequest,assetPlanRequest,positionPlanRequest,checkedAssetRead,checkedGuidedPlan,
  createGuidedState,invalidateGuidedState,isCurrentGuidedOperation,mountGuidedOperations } from '../apps/player/dist/guided-operations.js';

const actor='11111111111111111111111111111111',beneficiary='22222222222222222222222222222222',project='ab'.repeat(32),instance='cd'.repeat(32);
const resources={computeUnitLimit:500000,loadedAccountsDataSizeLimit:100000,heapSize:32768,priorityFeeLamports:'0'};
const values={actor,projectIdHex:project,class:'2',quantity:'9007199254740993',maxPayment:'18446744073709551615',maxRent:'1000000',resources:JSON.stringify(resources),
  instanceHex:instance,positionPageStart:'0',positionPageLimit:'10',beneficiary:'',positionSeq:'1'};
const operations={purchase:'BUY_MATERIAL',stake:'REGISTER_ORDINARY',exit:'EXIT_ORDINARY',claim:'CLAIM_POSITION',accrue:'MATERIALIZE_HOUR'};
const makeIntent=(source,budget=resources)=>({operation:operations[source],nonce:'9007199254740993',payloadHex:'00017fff',suffix:[{name:'<unsafe label>',address:beneficiary}],
  dynamicAccounts:[],resources:budget,...(source==='claim'?{labDestinationSetup:{beneficiary}}:{})});
const action=(source,request)=>({decision:'ACTION',actor:request.actor,clientPlanOnly:true,transactionExecuted:false,nonceReserved:false,
  beneficiary:source==='claim'?beneficiary:request.beneficiary??request.actor,previewAtoms:'123',intent:makeIntent(source,request.resources)});
const assetRecords=()=>({knownInstanceOnly:true,contextSlot:'21',registrationExists:true,root:{owner:actor,revision:'3',lifecycle:0},
  registration:{ordinaryCount:'2',activationCount:'0',kEnd:'0',directorySequence:'0'},nextPageStart:null,
  positions:[{positionSeq:'0',beneficiaryAddress:actor,accrued:'2000000',paid:'1000000'},
    {positionSeq:'1',beneficiaryAddress:beneficiary,accrued:'5000000',paid:'0'}]});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('exact read/plan bodies preserve decimal precision and reject invalid public inputs or invented Position selection',()=>{
  assert.deepEqual(purchasePlanRequest(values),{actor,projectIdHex:project,class:2,quantity:values.quantity,maxPayment:values.maxPayment,maxRent:'1000000',resources});
  const query=assetReadRequest(values);assert.deepEqual(query,{actor,instanceHex:instance,positionPageStart:'0',positionPageLimit:10});
  assert.deepEqual(assetPlanRequest(values,'stake'),{actor,instanceHex:instance,kind:'stake',beneficiary:actor,maxRent:'1000000',resources});
  assert.deepEqual(assetPlanRequest({...values,beneficiary},'exit'),{actor,instanceHex:instance,kind:'exit',maxRent:'1000000',resources});
  const asset=checkedAssetRead(assetRecords(),query);
  assert.deepEqual(positionPlanRequest(values,'claim',asset),{actor,instanceHex:instance,positionSeq:'1',kind:'claim',maxRent:'1000000',resources});
  for(const mutate of [{quantity:'0'},{quantity:'01'},{class:'5'},{maxPayment:'1e9'},{projectIdHex:project.toUpperCase()},{actor:'bad'},{resources:JSON.stringify({...resources,priorityFeeLamports:0})}])
    assert.throws(()=>purchasePlanRequest({...values,...mutate}));
  for(const mutate of [{positionPageLimit:'21'},{positionPageLimit:'1.5'},{positionPageStart:'-1'},{instanceHex:'00'}])assert.throws(()=>assetReadRequest({...values,...mutate}));
  assert.throws(()=>positionPlanRequest({...values,positionSeq:'2'},'claim',asset));
  assert.throws(()=>positionPlanRequest({...values,actor:beneficiary},'claim',asset));
  assert.throws(()=>positionPlanRequest(values,'claim',null));
});

test('asset pages and ACTION handoff data fail closed on duplicate/out-of-page records, wrong operations and missing plan-only markers',()=>{
  const query=assetReadRequest(values);
  for(const positions of [[{positionSeq:'0'},{positionSeq:'0'}],[{positionSeq:'10'}],[{positionSeq:0}],Array.from({length:11},(_,i)=>({positionSeq:String(i)}))])
    assert.throws(()=>checkedAssetRead({...assetRecords(),positions},query));
  assert.throws(()=>checkedAssetRead({...assetRecords(),intent:{}},query));
  const request=purchasePlanRequest(values),good=action('purchase',request);assert.deepEqual(checkedGuidedPlan(good,'purchase',actor).intent,good.intent);
  for(const bad of [{...good,clientPlanOnly:false},{...good,transactionExecuted:true},{...good,actor:beneficiary},{...good,intent:makeIntent('claim')},
    {...good,intent:{...good.intent,endpoint:'https://example.invalid'}}])assert.throws(()=>checkedGuidedPlan(bad,'purchase',actor));
  assert.equal(checkedGuidedPlan({decision:'WAIT_FROZEN_FRONTIER'},'accrue',actor),null);
  assert.throws(()=>checkedGuidedPlan({decision:'WAIT_FROZEN_FRONTIER',intent:good.intent},'accrue',actor));
  const state=createGuidedState(),controller={};assert.equal(isCurrentGuidedOperation(state,0,controller,controller),true);
  invalidateGuidedState(state);assert.equal(isCurrentGuidedOperation(state,0,controller,controller),false);
  assert.equal(isCurrentGuidedOperation(state,1,controller,{}),false);
});

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
  // native/guided adapters below must make all five views exclusive afterward.
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
    if(name==='asset-read')return response(assetRecords());
    if(name==='purchase-plan')return response(action('purchase',body));
    if(name==='asset-plan'||name==='position-plan')return response(action(body.kind,body));
    throw new Error(`Unexpected execution API ${name}`);
  };
  const native=await mountNativeConsole(document,{fetchImpl,getWallets:()=>({get:()=>[wallet],on(){}})});
  const guided=await mountGuidedOperations(document,{fetchImpl});
  const set=async(id,value,event='input')=>{const element=document.getElementById(id);element.value=value;await element.trigger(event);};
  const click=id=>document.getElementById(id).trigger('click');
  const draft=async()=>{await set('guided-actor',actor);await set('guided-project',project);await set('guided-material-class','2','change');
    await set('guided-quantity',values.quantity);await set('guided-max-payment',values.maxPayment);await set('guided-max-rent','1000000');};
  const readAsset=async()=>{await click('guided-tab-asset');await set('guided-instance',instance);await click('guided-asset-read');};
  return {document,calls,walletCalls,native,...guided,set,click,draft,readAsset};
}

test('disabled configuration blocks all planning and every view remains exclusive in actual listener order',async()=>{
  const ui=await mounted({enabled:false});assert.equal(ui.document.getElementById('guided-actor').disabled,true);
  for(const id of ['purchase-plan','asset-read','stake-plan','exit-plan','claim-plan','accrue-plan','use-intent'])assert.equal(ui.document.getElementById('guided-'+id).disabled,true);
  assert.match(ui.document.getElementById('guided-config-note').textContent,/未启用/);assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
  for(const button of ui.document.nav){await button.trigger('click');for(const view of ui.document.views)assert.equal(view.hidden,view.id!==button.dataset.view+'-view');}
  await ui.document.nav.find(button=>button.dataset.view==='guided').trigger('click');assert.equal(ui.document.getElementById('page-title').textContent,'资产与购买');
});

test('purchase planning is read-only and explicit handoff preserves exact intent, dispatches both inputs, and never executes or connects a wallet',async()=>{
  const ui=await mounted();await ui.draft();await ui.click('guided-purchase-plan');
  const planned=ui.calls.at(-1);assert.equal(planned.name,'purchase-plan');assert.deepEqual(planned.body,purchasePlanRequest(values));
  assert.equal(ui.document.getElementById('guided-use-intent').disabled,false);assert.equal(ui.native.state.logs.primary.envelope,null);
  const expected=ui.state.plan.intent,observed=[];
  for(const id of ['native-actor','native-intent'])ui.document.getElementById(id).addEventListener('input',()=>observed.push({actor:ui.document.getElementById('native-actor').value,intent:JSON.parse(ui.document.getElementById('native-intent').value)}));
  const before=ui.calls.length;await ui.click('guided-use-intent');assert.equal(ui.calls.length,before);
  assert.equal(observed.length,2);for(const entry of observed){assert.equal(entry.actor,actor);assert.deepEqual(entry.intent,expected);}
  assert.deepEqual(JSON.parse(ui.native.state.intentText),expected);assert.equal(ui.native.state.actor,actor);assert.equal(ui.native.state.logs.primary.envelope,null);
  assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});assert.equal(ui.state.plan,null);assert.equal(ui.document.getElementById('guided-use-intent').disabled,true);
  for(const view of ui.document.views)assert.equal(view.hidden,view.id!=='native-view');assert.equal(ui.document.getElementById('page-title').textContent,'链上操作');
});

test('asset forms select actual paged Positions, preserve historical beneficiary, and send exact stake/exit/claim/accrue requests',async()=>{
  const ui=await mounted();await ui.draft();await ui.readAsset();
  assert.deepEqual(ui.calls.at(-1).body,{actor,instanceHex:instance,positionPageStart:'0',positionPageLimit:10});
  assert.deepEqual(ui.document.getElementById('guided-position').children.map(option=>option.value),['','0','1']);
  assert.equal(ui.document.getElementById('guided-claim-plan').disabled,true);
  await ui.set('guided-beneficiary',beneficiary);await ui.click('guided-stake-plan');assert.deepEqual(ui.calls.at(-1).body,{actor,instanceHex:instance,kind:'stake',beneficiary,maxRent:'1000000',resources});
  await ui.click('guided-exit-plan');assert.deepEqual(ui.calls.at(-1).body,{actor,instanceHex:instance,kind:'exit',maxRent:'1000000',resources});
  await ui.set('guided-position','1','change');await ui.click('guided-claim-plan');
  assert.deepEqual(ui.calls.at(-1).body,{actor,instanceHex:instance,positionSeq:'1',kind:'claim',maxRent:'1000000',resources});
  assert.equal(ui.state.plan.result.beneficiary,beneficiary);assert.deepEqual(ui.state.plan.intent.labDestinationSetup,{beneficiary});
  assert.match(ui.document.getElementById('guided-position-note').textContent,new RegExp(beneficiary));
  await ui.click('guided-accrue-plan');assert.equal(ui.calls.at(-1).body.kind,'accrue');assert.equal(ui.state.plan.intent.operation,'MATERIALIZE_HOUR');
  await ui.set('guided-page-start','1');assert.equal(ui.state.asset,null);assert.equal(ui.document.getElementById('guided-claim-plan').disabled,true);assert.equal(ui.state.plan,null);
});

test('known open K exit and all non-ACTION/malformed/error responses leave no usable intent; unsafe server text stays text',async()=>{
  let mode='good';const unsafe='<img src=x onerror=attack()>',ui=await mounted({handler:(name,body)=>{
    if(name==='asset-read'&&mode==='k'){const records=assetRecords();records.registration.activationCount='1';records.registration.kEnd=null;return response(records);}
    if(name!=='purchase-plan')return undefined;
    if(mode==='wait')return response({decision:'WAIT_FROZEN_FRONTIER',clientPlanOnly:true,transactionExecuted:false,message:unsafe});
    if(mode==='malformed')return response({...action('purchase',body),transactionExecuted:true});
    if(mode==='error')return response({error:unsafe},400);
    return undefined;
  }});
  await ui.draft();await ui.click('guided-purchase-plan');assert.ok(ui.state.plan);
  mode='wait';await ui.click('guided-purchase-plan');assert.equal(ui.state.plan,null);assert.match(ui.document.getElementById('guided-result-json').textContent,/<img/);
  mode='malformed';await ui.click('guided-purchase-plan');assert.equal(ui.state.plan,null);assert.equal(ui.document.getElementById('guided-use-intent').disabled,true);
  mode='error';await ui.click('guided-purchase-plan');assert.equal(ui.document.getElementById('guided-message').textContent,unsafe);assert.equal(ui.state.plan,null);
  mode='k';await ui.readAsset();assert.equal(ui.document.getElementById('guided-k-note').hidden,false);assert.equal(ui.document.getElementById('guided-exit-plan').disabled,true);
  const before=ui.calls.length;await ui.click('guided-exit-plan');assert.equal(ui.calls.length,before);
});

test('every editable field invalidates an earlier ACTION and aborts a first in-flight plan before a late response',async()=>{
  const edits=[['guided-actor',beneficiary],['guided-max-rent','2'],['guided-resources',JSON.stringify({...resources,priorityFeeLamports:'1'})],
    ['guided-project','ef'.repeat(32)],['guided-material-class','3','change'],['guided-quantity','2'],['guided-max-payment','3'],
    ['guided-instance',instance],['guided-page-start','1'],['guided-page-limit','5','change'],['guided-beneficiary',beneficiary],['guided-position','0','change']];
  for(const [id,value,event]of edits){
    let pending=false,resolveOld,oldBody,oldSignal;const ui=await mounted({handler:(name,body,options)=>name==='purchase-plan'&&pending?new Promise(resolve=>{resolveOld=resolve;oldBody=body;oldSignal=options.signal;}):undefined});
    await ui.draft();await ui.click('guided-purchase-plan');assert.ok(ui.state.plan);pending=true;await ui.click('guided-purchase-plan');assert.equal(ui.state.plan,null);
    await ui.set(id,value,event);assert.equal(oldSignal.aborted,true);assert.equal(ui.state.plan,null);assert.equal(ui.document.getElementById('guided-use-intent').disabled,true);
    resolveOld(response(action('purchase',oldBody)));await tick();assert.equal(ui.state.plan,null);assert.equal(ui.document.getElementById('guided-use-intent').disabled,true);
  }
});

test('navigation and category changes abort plans; late rejection/finally cannot clobber a newer pending request',async()=>{
  let pending=false;const requests=[],ui=await mounted({handler:(name,body,options)=>name==='purchase-plan'&&pending?new Promise((resolve,reject)=>requests.push({body,signal:options.signal,resolve,reject})):undefined});
  await ui.draft();await ui.click('guided-purchase-plan');assert.ok(ui.state.plan);await ui.click('guided-tab-asset');assert.equal(ui.state.plan,null);
  await ui.click('guided-tab-purchase');pending=true;await ui.click('guided-purchase-plan');
  const quantity=ui.document.getElementById('guided-quantity');quantity.value='3';quantity.dispatchEvent({type:'input'});
  ui.document.getElementById('guided-purchase-plan').click();assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,true);
  requests[0].reject(new Error('old late failure'));await tick();
  assert.equal(ui.document.getElementById('guided-purchase-plan').disabled,true);assert.equal(ui.state.plan,null);
  assert.doesNotMatch(ui.document.getElementById('guided-message').textContent,/old late failure/);
  requests[1].resolve(response(action('purchase',requests[1].body)));await tick();assert.ok(ui.state.plan);assert.equal(ui.state.plan.request.quantity,'3');
  await ui.document.nav.find(button=>button.dataset.view==='builder').trigger('click');assert.equal(ui.state.plan,null);
  await ui.document.nav.find(button=>button.dataset.view==='guided').trigger('click');assert.equal(ui.document.getElementById('guided-use-intent').disabled,true);
  await ui.click('guided-purchase-plan');const last=requests.at(-1);await ui.click('guided-tab-asset');assert.equal(last.signal.aborted,true);
  last.resolve(response(action('purchase',last.body)));await tick();assert.equal(ui.state.plan,null);
});
