import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mountNativeConsole} from '../apps/player/dist/native-console.js';
import {mountGuidedOperations} from '../apps/player/dist/guided-operations.js';
import {mountProjectOperations} from '../apps/player/dist/project-operations.js';
import {mountManufactureOperations} from '../apps/player/dist/manufacture-operations.js';
import {synthesisInputsRequest,synthesisPlanRequest,synthesisNextRequest,checkedSynthesisInputs,checkedSynthesisWorkflow,checkedSynthesisSaved,checkedSynthesisNext,checkedSynthesisDesignEncoding,mountSynthesisOperations} from '../apps/player/dist/synthesis-operations.js';
import {encodeArtifactPutPayload,encodeArtifactSealPayload,encodeVerifyBeginPayload,encodeVerifyStepPayload,encodeSynthFinalizePayload} from '../packages/client/src/native.mjs';
// Browser event fixtures only, never new native synthesis or live-wallet proof.
const actor='11111111111111111111111111111111',other='22222222222222222222222222222222',workflowId='de'.repeat(32),output='ef'.repeat(32),domainHex='11'.repeat(32),configHex='22'.repeat(32);
const direct=Array.from({length:6},(_,i)=>(161+i).toString(16).repeat(32)),nonce='9007199254740993';
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
const graph=await readFile(new URL('../fixtures/graphs/c320-scope-22.bin',import.meta.url));
const graphHex=graph.toString('hex'),bound=Buffer.from(graph);Buffer.from(domainHex,'hex').copy(bound,16);Buffer.from(configHex,'hex').copy(bound,48);
const graphSHAHex=createHash('sha256').update(bound).digest('hex'),localSHA=createHash('sha256').update(graph).digest('hex');
const values={actor,target:'22',directIdsHex:direct.join('\n'),graphHex,challengePpm:'2000000',maxRent:'20000000',maxUploadRent:'10000000',maxFee:'12000000',resources:JSON.stringify(resources),workflowId};
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false};
const workflow=()=>({workflowId,actor,target:22,artifactIdHex:'01'.repeat(32),artifactSHAHex:'02'.repeat(32),graphSHAHex,challengePpm:2000000,materialFeeAtoms:'12000000',maxRent:values.maxRent,maxUploadRent:values.maxUploadRent,maxFee:values.maxFee,resources:{...resources},direct:direct.map((instanceHex,i)=>({instanceHex,revision:'0',fingerprintHex:(177+i).toString(16).repeat(32)})),parents:direct.map((instanceHex,i)=>({instanceHex,artifactIdHex:(193+i).toString(16).repeat(32)})),artifactBytes:2048,predictsFinalNonce:false,stepCountPredicted:false});
const inputRead=()=>{const eligibility=direct.map(instanceHex=>({instanceHex,owner:actor,revision:'0',lifecycle:0,registered:false,ordinaryEnd:'0',kEnd:'0',ordinaryCount:'0',coverageSequence:'0',nextCoverageHour:'18446744073709551615',certificateFault:false,movable:true,blockingReason:null,blockingReasons:[]}));return {...flags,decision:'INPUTS_READ',actor,target:22,contextSlot:'21',nextNonce:nonce,inputRecordsVerified:true,allEligible:true,eligibility,summary:{actor,target:22,materialFeeAtoms:'12000000',historicalDebtMustBeClaimed:false,noLABBalanceIncluded:true,inputs:eligibility.map(v=>({...v}))}};};
const saved=()=>({...flags,decision:'WORKFLOW_SAVED',actor,workflow:workflow(),requiresExplicitNextRead:true});
const verification=(phase=5,round=72)=>({generation:'3',phase,workSequence:11,progress:0,physicsRound:round,target:22,challengePpm:2000000,qualityPpm:round===73?'2000000':'0',taskApplicable:round===73,cost:round===73?'320':'0',used:false});
function stageIntent(kind,w=workflow(),v=verification()){
 const common={artifactId:Buffer.from(w.artifactIdHex,'hex'),artifactSHA:Buffer.from(w.artifactSHAHex,'hex'),artifactLength:w.artifactBytes,maxRent:BigInt(w.maxRent)};let payload;
 if(kind==='UPLOAD')payload=encodeArtifactPutPayload({kind:702,totalLength:w.artifactBytes,artifactSHA:common.artifactSHA,expectedSequence:0n,offset:0,chunk:Buffer.alloc(1024),maxRent:BigInt(w.maxUploadRent)});
 if(kind==='SEAL')payload=encodeArtifactSealPayload({kind:702,artifactId:common.artifactId,expectedSequence:2n,maxRent:BigInt(w.maxUploadRent)});
 if(kind==='BEGIN')payload=encodeVerifyBeginPayload({...common,challengePpm:w.challengePpm,expectedGeneration:0n});
 if(kind==='STEP')payload=encodeVerifyStepPayload({artifactId:common.artifactId,expectedGeneration:BigInt(v.generation),expectedWorkSequence:v.workSequence,count:v.phase===5?Math.min(2,73-v.physicsRound):1,previousDigest:Buffer.alloc(32,9),maxRent:BigInt(w.maxRent)});
 if(kind==='FINAL')payload=encodeSynthFinalizePayload({...common,expectedGeneration:BigInt(v.generation),transcriptSHA:Buffer.alloc(32,9),maxFee:BigInt(w.maxFee)});
 return {operation:{UPLOAD:'ARTIFACT_PUT',SEAL:'ARTIFACT_SEAL',BEGIN:'VERIFY_BEGIN',STEP:'VERIFY_STEP',FINAL:'SYNTH_FINALIZE'}[kind],nonce,payloadHex:payload.toString('hex'),suffix:[],dynamicAccounts:[],resources:{...resources}};
}
const next=(decision='ACTION',kind='UPLOAD')=>{const v=kind==='STEP'?verification():kind==='FINAL'?verification(6,73):null,w=workflow();return {...flags,decision,actor,workflow:w,outputVerified:false,exactRequestExecutionVerified:false,root:null,verification:v,...(decision==='ACTION'?{stage:{kind,nonce},intent:stageIntent(kind,w,v)}:{})};};
const actualOutput=()=>({...next('OUTPUT_READ'),outputVerified:true,root:{instanceHex:output,owner:actor,lifecycle:0,schema:4,target:22,artifactIdHex:workflow().artifactIdHex,descriptorHex:'16030000',qualityPpm:'2000000',B:'7200000',retired:'2700000'}});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flush=async()=>{await tick();await new Promise(resolve=>setTimeout(resolve,5));await tick();};

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
    if(name==='config')return response({enabled,chain:'solana:localnet',domainHex,configHex});
    if(name==='synthesis-inputs')return response(inputRead());if(name==='synthesis-plan')return response(saved());if(name==='synthesis-next')return response(next());
    if(name==='design-encode')return response({localDesignOnly:true,transactionExecuted:false,networkSubmitted:false,target:22,graphHex,graphSHA:localSHA});
    throw new Error(`Unexpected execution API ${name}`);
  };
  const native=await mountNativeConsole(document,{fetchImpl,getWallets:()=>({get:()=>[wallet],on(){}})}),guided=await mountGuidedOperations(document,{fetchImpl}),projectUI=await mountProjectOperations(document,{fetchImpl}),manufacture=await mountManufactureOperations(document,{fetchImpl}),synthesis=await mountSynthesisOperations(document,{fetchImpl});
  const set=async(id,value,event='input')=>{const el=document.getElementById(id);el.value=value;await el.trigger(event);},click=async id=>{await document.getElementById(id).trigger('click');await flush();};
  const fill=async()=>{for(const [name,value]of Object.entries({actor,target:'22',direct:values.directIdsHex,'graph-hex':graphHex,challenge:values.challengePpm,'max-rent':values.maxRent,'max-upload-rent':values.maxUploadRent,'max-fee':values.maxFee}))await set('synthesis-'+name,value);};
  const resume=async()=>{await click('synthesis-tab-resume');await set('synthesis-actor',actor);await set('synthesis-workflow-id',workflowId);await click('synthesis-next');};
  return {document,calls,walletCalls,native,guided,projectUI,manufacture,...synthesis,set,click,fill,resume};
}

test('exact synthesis requests preserve direct hierarchy counts, graph wire, decimal caps and challenge',()=>{
  assert.deepEqual(synthesisInputsRequest(values),{actor,target:22,directIdsHex:direct});assert.deepEqual(synthesisNextRequest(values),{actor,workflowId});
  assert.deepEqual(synthesisPlanRequest(values),{actor,graphHex,directIdsHex:direct,challengePpm:2000000,maxRent:values.maxRent,maxUploadRent:values.maxUploadRent,maxFee:values.maxFee,resources});
  for(const change of [{actor:'bad'},{target:'022'},{target:'23'},{directIdsHex:direct.slice(0,5)},{directIdsHex:[...direct.slice(0,5),direct[0]]},{directIdsHex:direct.map(v=>v.toUpperCase())},{graphHex:'0100'},{challengePpm:'1000001'},{challengePpm:'02'},{maxFee:'11999999'},{maxRent:'01'},{maxUploadRent:'1e9'},{resources:JSON.stringify({...resources,priorityFeeLamports:0})}])assert.throws(()=>synthesisPlanRequest({...values,...change}));
});
test('actual input eligibility is query-bound and distinguishes coverage/owner blocks from spend authority',()=>{
  const q=synthesisInputsRequest(values),r=inputRead();assert.equal(checkedSynthesisInputs(r,q).records.allEligible,true);
  for(const change of [r=>r.inputRecordsVerified=false,r=>r.actor=other,r=>r.target=1,r=>r.allEligible=false,r=>r.eligibility[0].instanceHex=output,r=>r.eligibility[0].owner=other,r=>r.eligibility[0].kEnd=null,r=>r.eligibility[0].coverageSequence='1',r=>r.summary.historicalDebtMustBeClaimed=true,r=>r.intent={}]){const bad=inputRead();change(bad);assert.throws(()=>checkedSynthesisInputs(bad,q));}
  const blocked=inputRead();blocked.allEligible=false;blocked.eligibility[0].movable=false;blocked.eligibility[0].kEnd=null;blocked.eligibility[0].blockingReason='K_AWARE_EXIT_REQUIRED';assert.equal(checkedSynthesisInputs(blocked,q).records.allEligible,false);
  assert.equal(checkedSynthesisInputs({...flags,decision:'REPLAN_STALE_STATE',actor,target:22},q),null);
});
test('saved public workflow binds zero-context design to fixed release and never predicts final nonce or steps',async()=>{
  const q=synthesisPlanRequest(values),w=await checkedSynthesisSaved(saved(),q,{domainHex,configHex});assert.equal(w.graphSHAHex,graphSHAHex);assert.equal(w.predictsFinalNonce,false);assert.equal(w.stepCountPredicted,false);
  for(const change of [r=>r.intent={},r=>r.requiresExplicitNextRead=false,r=>r.workflow.graphSHAHex=localSHA,r=>r.workflow.maxFee='1',r=>r.workflow.challengePpm=1000000,r=>r.workflow.direct[0].instanceHex=output,r=>r.workflow.parents[0].instanceHex=output,r=>r.workflow.resources.heapSize=32768,r=>r.workflow.predictsFinalNonce=true,r=>r.workflow.stepCountPredicted=true]){const bad=saved();change(bad);await assert.rejects(checkedSynthesisSaved(bad,q,{domainHex,configHex}));}
  const foreign=Buffer.from(graph);Buffer.alloc(32,7).copy(foreign,16);await assert.rejects(checkedSynthesisSaved(saved(),{...q,graphHex:foreign.toString('hex')},{domainHex,configHex}),/非零/);
  assert.equal(await checkedSynthesisSaved({...flags,decision:'INPUTS_BLOCKED',actor},q,{domainHex,configHex}),null);
});
test('all five ACTION kinds bind actual variable stages, frozen Artifact, resources, fees and V4 cursor',()=>{
  const q=synthesisNextRequest(values);for(const kind of ['UPLOAD','SEAL','BEGIN','STEP','FINAL'])assert.equal(checkedSynthesisNext(next('ACTION',kind),q).plan.stage.kind,kind);
  for(const change of [r=>r.stage.kind='FINAL',r=>r.stage.nonce='0',r=>r.intent.nonce='0',r=>r.intent.resources.priorityFeeLamports='1',r=>r.workflow.workflowId=output,r=>r.workflow.stepCountPredicted=true,r=>r.intent.payloadHex=r.intent.payloadHex.replace(/^....../,'be0201')]){const bad=next();change(bad);assert.throws(()=>checkedSynthesisNext(bad,q));}
  for(const kind of ['STEP','FINAL']){const bad=next('ACTION',kind);bad.verification.workSequence++;if(kind==='STEP')assert.throws(()=>checkedSynthesisNext(bad,q));else{bad.verification.phase=5;assert.throws(()=>checkedSynthesisNext(bad,q));}}
  for(const phase of [0,1,2,3,4,5]){const r=next('ACTION','STEP');r.verification=verification(phase,phase===5?71:0);r.intent=stageIntent('STEP',r.workflow,r.verification);assert.equal(checkedSynthesisNext(r,q).plan.stage.kind,'STEP');}
  for(const decision of ['INPUTS_BLOCKED','RECOVER_CURRENT_REQUEST','K_POSITION_LOOKUP_REQUIRED','REPLAN_STALE_STATE']){assert.equal(checkedSynthesisNext(next(decision),q).plan,null);assert.throws(()=>checkedSynthesisNext({...next(decision),intent:next().intent},q));}
  const previous=workflow();assert.ok(checkedSynthesisNext(next(),q,Object.fromEntries(Object.entries(previous).reverse())).plan);assert.throws(()=>checkedSynthesisNext(next(),q,{...previous,maxRent:'1'}));
});
test('only actual available Root matching layer and Artifact can hand off, while transferred/consumed output remains historical',()=>{
  const q=synthesisNextRequest(values);assert.ok(checkedSynthesisNext(actualOutput(),q).verified);const withState={...actualOutput(),verification:{...verification(6,73),used:true}};assert.ok(checkedSynthesisNext(withState,q).verified);assert.throws(()=>checkedSynthesisNext({...withState,root:{...withState.root,qualityPpm:'1999000'}},q));
  for(const change of [r=>r.root.artifactIdHex=output,r=>r.root.schema=3,r=>r.root.target=21,r=>r.root.descriptorHex='15020600',r=>r.root.B='1',r=>r.root.retired='0',r=>r.root.qualityPpm='2000001',r=>r.outputVerified=false]){const bad=actualOutput();change(bad);assert.throws(()=>checkedSynthesisNext(bad,q));}
  for(const change of [r=>r.root.owner=other,r=>r.root.lifecycle=1]){const record=actualOutput();change(record);assert.equal(checkedSynthesisNext(record,q).verified,null);}
});
test('default-disabled eighth view preserves all fifteen exclusive views and never triggers wallet or chain planning',async()=>{
  const ui=await mounted({enabled:false});assert.equal(ui.document.views.length,15);for(const name of ['actor','direct','challenge','max-rent','max-upload-rent','max-fee','resources','workflow-id','read','save','next','open-saved','use-intent','use-root'])assert.equal(ui.document.getElementById('synthesis-'+name).disabled,true);
  for(const name of ['target','graph-hex','import'])assert.equal(ui.document.getElementById('synthesis-'+name).disabled,false);
  for(const nav of ui.document.nav){await nav.trigger('click');for(const view of ui.document.views)assert.equal(view.hidden,view.id!==nav.dataset.view+'-view');}
  await ui.document.nav.find(v=>v.dataset.view==='synthesis').trigger('click');assert.equal(ui.document.getElementById('page-title').textContent,'细胞与合成');assert.ok(ui.calls.every(c=>c.name==='config'));assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
});
test('explicit workbench import is local-only, target-bound and usable while native config is disabled',async()=>{
  const ui=await mounted({enabled:false});ui.document.getElementById('graph-json').value=JSON.stringify({target:22,eventFixture:true});await ui.click('synthesis-import');assert.deepEqual(ui.calls.at(-1).body,{graph:{target:22,eventFixture:true},target:22});assert.equal(ui.calls.at(-1).name,'design-encode');assert.equal(ui.document.getElementById('synthesis-graph-hex').value,graphHex);assert.equal(ui.state.encoding.graphSHA,localSHA);assert.equal(ui.state.plan,null);assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
  await assert.rejects(checkedSynthesisDesignEncoding({localDesignOnly:true,transactionExecuted:false,networkSubmitted:false,target:22,graphHex,graphSHA:'00'.repeat(32)},{target:22}),/SHA/);
});
test('input lookup and public save are explicit exact bodies; save never runs next or creates intent',async()=>{
  const ui=await mounted();await ui.fill();await ui.click('synthesis-read');assert.deepEqual(ui.calls.at(-1).body,synthesisInputsRequest(values));assert.ok(ui.state.inputs);
  await ui.click('synthesis-save');assert.deepEqual(ui.calls.at(-1).body,synthesisPlanRequest(values));assert.ok(ui.state.workflow);assert.equal(ui.state.plan,null);assert.equal(ui.document.getElementById('synthesis-use-intent').disabled,true);const n=ui.calls.length;
  await ui.click('synthesis-open-saved');assert.equal(ui.calls.length,n);assert.equal(ui.state.workflow,null);assert.equal(ui.state.mode,'resume');assert.equal(ui.document.getElementById('synthesis-workflow-id').value,workflowId);await ui.click('synthesis-next');assert.deepEqual(ui.calls.at(-1).body,{actor,workflowId});assert.ok(ui.state.plan);
});
test('one-stage native handoff fills both fields before events and clears old signatures without execution',async()=>{
  const ui=await mounted();await ui.resume();assert.ok(ui.state.plan);const expected=ui.state.plan.intent,observations=[];ui.native.state.logs.primary.signedBytes=new Uint8Array([1]);for(const id of ['native-actor','native-intent'])ui.document.getElementById(id).addEventListener('input',()=>observations.push({actor:ui.document.getElementById('native-actor').value,intent:JSON.parse(ui.document.getElementById('native-intent').value)}));
  const count=ui.calls.length;await ui.click('synthesis-use-intent');assert.equal(ui.calls.length,count);assert.equal(observations.length,2);for(const v of observations){assert.equal(v.actor,actor);assert.deepEqual(v.intent,expected);}assert.equal(ui.native.state.logs.primary.signedBytes,null);assert.equal(ui.state.plan,null);for(const view of ui.document.views)assert.equal(view.hidden,view.id!=='native-view');assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
});
test('only actual output fills guided asset form and tab, with no read/stake/claim automation',async()=>{
  const ui=await mounted({handler:name=>name==='synthesis-next'?response(actualOutput()):undefined});await ui.resume();assert.ok(ui.state.verified);const count=ui.calls.length;ui.document.getElementById('guided-page-start').value='60';ui.document.getElementById('guided-page-limit').value='1';await ui.click('synthesis-use-root');assert.equal(ui.calls.length,count);assert.equal(ui.document.getElementById('guided-page-start').value,'0');assert.equal(ui.document.getElementById('guided-page-limit').value,'5');assert.equal(ui.document.getElementById('guided-actor').value,actor);assert.equal(ui.document.getElementById('guided-instance').value,output);assert.equal(ui.guided.state.mode,'asset');assert.equal(ui.guided.state.asset,null);for(const view of ui.document.views)assert.equal(view.hidden,view.id!=='guided-view');assert.deepEqual(ui.walletCalls,{connect:0,sign:0,send:0});
});
test('every field aborts first pending request and rejects late accepted data',async()=>{
  for(const name of ['actor','target','direct','graph-hex','challenge','max-rent','max-upload-rent','max-fee','resources','workflow-id']){let resolve;const ui=await mounted({handler:name=>name==='synthesis-next'?new Promise(r=>resolve=r):undefined});await ui.resume();const pending=ui.calls.at(-1);assert.equal(pending.name,'synthesis-next');await ui.set('synthesis-'+name,ui.document.getElementById('synthesis-'+name).value+' ');assert.equal(pending.signal.aborted,true);resolve(response(next()));await flush();assert.equal(ui.state.plan,null);assert.equal(ui.state.workflow,null);assert.equal(ui.document.getElementById('synthesis-use-intent').disabled,true);}
});
test('tab/navigation/config invalidation and late errors never restore old output or replace a newer response',async()=>{
  for(const mode of ['tab','nav','config']){const ui=await mounted({handler:name=>name==='synthesis-next'?response(actualOutput()):undefined});await ui.resume();assert.ok(ui.state.verified);if(mode==='tab')await ui.click('synthesis-tab-plan');if(mode==='nav')await ui.document.nav[0].trigger('click');if(mode==='config')await ui.click('synthesis-reload');assert.equal(ui.state.verified,null);assert.equal(ui.state.workflow,null);assert.equal(ui.document.getElementById('synthesis-use-root').disabled,true);}
  let reject;const ui=await mounted({handler:(name,body)=>name==='synthesis-next'&&body.workflowId===workflowId?new Promise((_,r)=>reject=r):name==='synthesis-next'?response({...next('INPUTS_BLOCKED'),workflow:{...workflow(),workflowId:output}}):undefined});await ui.resume();await ui.set('synthesis-workflow-id',output);await ui.click('synthesis-next');assert.equal(ui.state.result.decision,'INPUTS_BLOCKED');reject(new Error('late stale failure'));await flush();assert.equal(ui.state.result.decision,'INPUTS_BLOCKED');
});
test('malformed/oversized data fails closed and all strings render as text only',async()=>{
  for(const r of [{...next(),transactionExecuted:true},{...next('INPUTS_BLOCKED'),intent:next().intent},{...next(),intent:{...next().intent,nonce:'0'}},{...actualOutput(),root:{...actualOutput().root,artifactIdHex:output}}]){const ui=await mounted({handler:name=>name==='synthesis-next'?response(r):undefined});await ui.resume();assert.equal(ui.state.plan,null);assert.equal(ui.state.verified,null);assert.equal(ui.state.result,null);}
  const huge=await mounted({handler:name=>name==='synthesis-next'?response({...next('BLOCKED'),padding:'x'.repeat(66000)}):undefined});await huge.resume();assert.equal(huge.state.result,null);
  const text=await mounted({handler:name=>name==='synthesis-next'?response(next('BLOCKED_<img onerror=evil>')):undefined});await text.resume();assert.match(text.document.getElementById('synthesis-result-badge').textContent,/<img/);assert.equal(text.state.plan,null);
});

