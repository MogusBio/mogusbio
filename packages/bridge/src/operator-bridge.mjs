import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateProductionRelease,baseConfigR2Id } from '../../client/src/release.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativeOperation } from '../../client/src/native.mjs';
import { NativePlayerSession,inspectPreparedNativeEnvelope } from '../../client/src/session.mjs';
import { FileJournalStore } from '../../client/src/file-journal.mjs';
import { ReadOnlyRpc,validateReadOnlyRpcEndpoint } from '../../client/src/rpc.mjs';
import { validateV1Resources } from '../../client/src/transaction.mjs';
import { prepareNativeCancellation,reconcileNativeCancellation } from '../../client/src/recovery.mjs';
import { planSelfPurchase } from '../../client/src/purchase-workflow.mjs';
import { readPlayerAsset,planPlayerAssetAction,planGuidedPositionAction } from '../../client/src/player-assets.mjs';
import { nativeActionIntent } from '../../client/src/player-settlement.mjs';
import { planCreateProject } from '../../client/src/project-workflow.mjs';
import { readProjectState,reconcileProjectCreation } from '../../client/src/project-state.mjs';
import {readMaterialInventory} from '../../client/src/material-inventory.mjs';
import {PartWorkflowStore} from '../../client/src/part-manifest.mjs';
import {savePartManufactureWorkflow,readPartManufactureProgress} from '../../client/src/part-progress.mjs';
import {readSynthesisInputs} from '../../client/src/synthesis-inputs.mjs';
import {SynthesisWorkflowStore} from '../../client/src/synthesis-manifest.mjs';
import {bindSynthesisDesignGraph,saveGuidedSynthesisWorkflow,readGuidedSynthesisProgress} from '../../client/src/synthesis-progress.mjs';
import {readMiningDashboard,planGuidedGlobalSettlement,planGuidedHourClosure} from '../../client/src/mining-dashboard.mjs';
import {planPlayerLifecycleAction} from '../../client/src/player-lifecycle.mjs';
import {readCompetitionState,planNextCompetitionRound,planActivateWinner} from '../../client/src/competition-round.mjs';
import {ResearchWorkflowStore} from '../../client/src/research-manifest.mjs';
import {saveGuidedResearchWorkflow,readGuidedResearchProgress} from '../../client/src/research-progress.mjs';
import {DiscoveryRpc,DiscoveryStore,readDiscoveryPage,DISCOVERY_SECTIONS,validateDiscoveryRequest} from '../../client/src/discovery.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function fields(v,required,optional=[]){
  check(record(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)),'BRIDGE_FIELDS');
}
function decimal(v){
  check(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=20,'BRIDGE_DECIMAL');
  const n=BigInt(v);check(n<1n<<64n,'BRIDGE_U64');return n;
}
function hex(v,max){check(typeof v==='string'&&v.length<=max*2&&/^(?:[0-9a-f]{2})*$/.test(v),'BRIDGE_HEX');return Buffer.from(v,'hex');}
function id32(v){const b=hex(v,32);check(b.length===32,'BRIDGE_ID32');return b;}
function ids32(v,max){check(Array.isArray(v)&&v.length<=max,'BRIDGE_IDS');const values=v.map(id32);check(new Set(values.map(b=>b.toString('hex'))).size===values.length,'BRIDGE_DUPLICATE_IDS');return values;}
function actorAddress(v){check(typeof v==='string','BRIDGE_ACTOR');return nativeKeyAddress(v);}
function resources(v){
  fields(v,['computeUnitLimit','loadedAccountsDataSizeLimit','priorityFeeLamports'],['heapSize']);
  if(Object.hasOwn(v,'heapSize'))check(Number.isSafeInteger(v.heapSize),'BRIDGE_RESOURCES');
  return validateV1Resources({...v,priorityFeeLamports:decimal(v.priorityFeeLamports)});
}
function accounts(v,dynamic=false){
  check(Array.isArray(v)&&v.length<=64,'BRIDGE_ACCOUNTS');
  return v.map(row=>{
    fields(row,dynamic?['address','writable','signer']:['name','address']);
    if(dynamic)check(typeof row.writable==='boolean'&&typeof row.signer==='boolean','BRIDGE_ACCOUNT_FLAGS');
    else check(typeof row.name==='string'&&row.name.length<=128,'BRIDGE_ACCOUNT_NAME');
    return {...row,address:actorAddress(row.address)};
  });
}
export function intentInput(v,abi){
  fields(v,['operation','nonce','payloadHex','resources'],['suffix','dynamicAccounts','feePayer','labDestinationSetup']);
  check(typeof v.operation==='string','BRIDGE_OPERATION');nativeOperation(abi,v.operation);
  const out={operation:v.operation,nonce:decimal(v.nonce),payload:hex(v.payloadHex,3944),resources:resources(v.resources)};
  if(Object.hasOwn(v,'suffix'))out.suffix=accounts(v.suffix);
  if(Object.hasOwn(v,'dynamicAccounts'))out.dynamicAccounts=accounts(v.dynamicAccounts,true);
  if(Object.hasOwn(v,'feePayer'))out.feePayer=actorAddress(v.feePayer);
  if(Object.hasOwn(v,'labDestinationSetup')){
    fields(v.labDestinationSetup,['beneficiary']);out.labDestinationSetup={beneficiary:actorAddress(v.labDestinationSetup.beneficiary)};
  }
  return out;
}
function signedBytes(v){
  check(typeof v==='string'&&v.length>0&&v.length<=4*Math.ceil(4096/3)
    &&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v),'BRIDGE_SIGNED_BASE64');
  const bytes=Buffer.from(v,'base64');check(bytes.length<=4096&&bytes.toString('base64')===v,'BRIDGE_SIGNED_BASE64');return bytes;
}
// Walk before JSON.stringify so Buffer.toJSON cannot turn bytes into an object.
function jsonSafe(v){
  if(typeof v==='bigint')return v.toString();
  if(v instanceof Uint8Array)return Buffer.from(v).toString('hex');
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'){check(Number.isSafeInteger(v),'BRIDGE_RESULT_NUMBER');return v;}
  if(Array.isArray(v))return v.map(jsonSafe);
  check(record(v),'BRIDGE_RESULT');return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,
    ['error','storageError'].includes(k)&&typeof x==='string'&&!/^[A-Z0-9_]{1,80}$/.test(x)?'TRANSPORT_ERROR':jsonSafe(x)]));
}
async function privateRoot(directory){
  check(typeof directory==='string'&&path.isAbsolute(directory)&&path.normalize(directory)===directory,'BRIDGE_STATE_ROOT');
  const stat=await fs.lstat(directory);
  check(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0
    &&(typeof process.getuid!=='function'||stat.uid===process.getuid())&&await fs.realpath(directory)===directory,'BRIDGE_STATE_ROOT');
  return directory;
}

/** Trusted server runtime only. Construction performs local admission and
 * filesystem checks; transport is used only by explicit dispatch calls. No
 * wallet, secret, browser-provided endpoint or filesystem path is accepted. */
export async function createOperatorBridge({release,abi,endpoint,stateDirectory,fetchImpl,allowLocalhost=false}){
  check(typeof fetchImpl==='function'&&typeof allowLocalhost==='boolean','BRIDGE_RUNTIME');
  check(release?.input&&typeof release.localPublicFixture==='boolean','BRIDGE_RELEASE');
  // Retain an independently admitted snapshot, not mutable caller buffers.
  const pinned=await validateProductionRelease(structuredClone(release.input),{localPublicFixture:release.localPublicFixture});
  check(abi?.hash===pinned.hashes.abiHash.toString('hex'),'BRIDGE_ABI');nativeOperation(abi,abi.operations?.[0]?.name);
  const url=validateReadOnlyRpcEndpoint(endpoint,{allowLocalhost}),root=await privateRoot(stateDirectory),u=new URL(url);
  const binding={releaseHash:pinned.input.releaseHash,abiHash:abi.hash,domainHex:pinned.domain.toString('hex'),configHex:baseConfigR2Id(pinned).toString('hex')};
  const namespace=createHash('sha256').update(JSON.stringify(binding)).digest('hex');
  const discoveryNamespace=createHash('sha256').update(url).digest('hex');
  const runtime={release:pinned,abi,endpoint:url,fetchImpl,allowLocalhost,requestTimeoutMs:15000};
  const publicInfo={enabled:true,profile:pinned.input.profile,programId:pinned.input.programId,...binding,
    opening:{profile:pinned.openingProfile,requiredSeedCount:16,minimumPublishedCount:pinned.input.frontier===310?17:16,frontier:pinned.input.frontier},
    discovery:{profile:'BIO-DISCOVERY1',sections:[...DISCOVERY_SECTIONS],readOnly:true,pageSize:8},
    localPublicFixture:pinned.localPublicFixture,productionAdmission:false,
    endpoint:{origin:u.origin,local:['localhost','127.0.0.1','[::1]'].includes(u.hostname)},
    network:{genesisHash:pinned.input.genesisHash,networkProfileHash:pinned.input.networkProfileHash}};
  async function session(actor,log){
    check(log==='primary'||log==='cancellation','BRIDGE_LOG');
    const directory=path.join(root,namespace,nativeKeyBytes(actor).toString('hex'),log);
    const store=await FileJournalStore.open({directory});
    return new NativePlayerSession({...runtime,actor,store});
  }
  async function inspect(envelope,actor){
    const prepared=await inspectPreparedNativeEnvelope({release:pinned,abi,envelope});
    if(actor!==undefined)check(prepared.actor===actor,'BRIDGE_ACTOR_MISMATCH');return prepared;
  }
  async function dispatch(action,body){
    let result;
    if(action==='discovery-read'){
      fields(body,['actor','section','cursor','query']);validateDiscoveryRequest(body);
      result=await readDiscoveryPage({release:pinned,rpc:new ReadOnlyRpc({...runtime,requestTimeoutMs:2000}),
        discoveryRpc:new DiscoveryRpc({release:pinned,endpoint:url,fetchImpl,allowLocalhost}),
        store:new DiscoveryStore({directory:path.join(root,namespace,'discovery',discoveryNamespace)}),
        actor:actorAddress(body.actor),section:body.section,cursor:body.cursor,query:body.query});
    }else if(['research-create','research-next'].includes(action)){
      fields(body,action==='research-create'?['actor','cranker','graphHex','directIdsHex','maxRent','maxUploadRent','maxFee','resources','requestId']:['actor','author','workflowId']);
      const actor=actorAddress(body.actor),author=action==='research-create'?actor:actorAddress(body.author),store=new ResearchWorkflowStore({directory:path.join(root,namespace,nativeKeyBytes(author).toString('hex'),'research')});
      if(action==='research-create')result=await saveGuidedResearchWorkflow({release:pinned,abi,rpc:new ReadOnlyRpc(runtime),author,cranker:actorAddress(body.cranker),graph:bindSynthesisDesignGraph({release:pinned,graphBytes:hex(body.graphHex,7713)}),directIds:ids32(body.directIdsHex,6),maxRent:decimal(body.maxRent),maxUploadRent:decimal(body.maxUploadRent),maxFee:decimal(body.maxFee),resources:resources(body.resources),requestId:id32(body.requestId).toString('hex'),store});
      else{
        const workflowId=id32(body.workflowId).toString('hex'),directory=path.join(root,namespace,nativeKeyBytes(author).toString('hex'),'research');
        let entry;try{entry=await fs.lstat(directory);}catch(error){if(error.code==='ENOENT')check(false,'RESEARCH_WORKFLOW_NOT_FOUND');throw error;}
        check(entry.isDirectory()&&!entry.isSymbolicLink(),'RESEARCH_WORKFLOW_DIRECTORY');
        const manifest=await store.load({release:pinned,abi,author,workflowId});check(actor===manifest.author||actor===manifest.cranker,'RESEARCH_EXECUTOR_ROLE');
        result=await readGuidedResearchProgress({release:pinned,abi,authorSession:await session(author,'primary'),executorSession:await session(actor,'primary'),actor,author,workflowId,store});
      }
    }else if(['competition-read','round-plan','winner-plan'].includes(action)){
      fields(body,['actor',...(action==='winner-plan'?['winnerIdHex']:['round']),...(action==='competition-read'?[]:['maxRent','resources'])]);
      const actor=actorAddress(body.actor),rpc=new ReadOnlyRpc(runtime);
      if(action==='competition-read')result=await readCompetitionState({release:pinned,rpc,actor,round:decimal(body.round)});
      else{
        const selectedResources=resources(body.resources),args={release:pinned,abi,rpc,actor,maxRent:decimal(body.maxRent)};let planned;
        if(action==='winner-plan')planned=await planActivateWinner({...args,winnerId:id32(body.winnerIdHex)});
        else{
          const round=decimal(body.round),cursor=await FileJournalStore.open({directory:path.join(root,namespace,nativeKeyBytes(actor).toString('hex'),'rounds'),name:`round-${round}.json`}),old=await cursor.load();let hint=null;
          if(old.payload!==null){hint=JSON.parse(old.payload);fields(hint,['roundIdHex','bestCandidateHex','candidateCount','nextStart']);id32(hint.roundIdHex);id32(hint.bestCandidateHex);decimal(hint.candidateCount);decimal(hint.nextStart);}
          planned=await planNextCompetitionRound({...args,round,limit:8,...(hint?{candidateLookupStart:decimal(hint.nextStart),candidateLookupContext:{roundIdHex:hint.roundIdHex,bestCandidateHex:hint.bestCandidateHex,candidateCount:hint.candidateCount}}:{})});
          if(planned.decision==='CANDIDATE_LOOKUP_REQUIRED'&&planned.lookup?.nextStart!==null)await cursor.compareAndSwap(old.revision,JSON.stringify(planned.lookup));
        }
        const {action:proposed,...facts}=planned;result={...facts,actor,...(proposed?{intent:nativeActionIntent(proposed,selectedResources)}:{})};
      }
    }else if(action==='mining-read'){
      fields(body,['actor','instancesHex','positionPageStart','positionPageLimit']);const actor=actorAddress(body.actor);
      const read=await readMiningDashboard({release:pinned,rpc:new ReadOnlyRpc(runtime),actor,instances:ids32(body.instancesHex,4),positionPageStart:decimal(body.positionPageStart),positionPageLimit:body.positionPageLimit});
      const {roots,currentK,registry,book,clock,...facts}=read;result=facts;
    }else if(['global-plan','hour-close-plan','lifecycle-plan'].includes(action)){
      fields(body,['actor','maxRent','resources',...(action==='hour-close-plan'?['hour']:action==='lifecycle-plan'?['instanceHex','kind',...(body.kind==='transfer'?['newOwner']:[])]:[])]);
      const actor=actorAddress(body.actor),args={release:pinned,abi,rpc:new ReadOnlyRpc(runtime),actor,maxRent:decimal(body.maxRent)},selectedResources=resources(body.resources);
      const planned=action==='global-plan'?await planGuidedGlobalSettlement(args):action==='hour-close-plan'?await planGuidedHourClosure({...args,hour:decimal(body.hour)}):await planPlayerLifecycleAction({...args,instance:id32(body.instanceHex),kind:body.kind,...(body.kind==='transfer'?{newOwner:actorAddress(body.newOwner)}:{})});
      const {action:proposed,...facts}=planned;result={...facts,actor,...(proposed?{intent:nativeActionIntent(proposed,selectedResources)}:{})};
    }else if(['synthesis-inputs','synthesis-plan','synthesis-next'].includes(action)){
      fields(body,action==='synthesis-inputs'?['actor','target','directIdsHex']:action==='synthesis-plan'?['actor','graphHex','directIdsHex','challengePpm','maxRent','maxUploadRent','maxFee','resources']:['actor','workflowId']);
      const actor=actorAddress(body.actor),store=new SynthesisWorkflowStore({directory:path.join(root,namespace,nativeKeyBytes(actor).toString('hex'),'synthesis')});
      if(action==='synthesis-next')result=await readGuidedSynthesisProgress({release:pinned,abi,actor,workflowId:id32(body.workflowId).toString('hex'),store,session:await session(actor,'primary')});
      else{
        const directIds=ids32(body.directIdsHex,6),rpc=new ReadOnlyRpc(runtime);
        if(action==='synthesis-inputs'){
          const {directInputs,...facts}=await readSynthesisInputs({release:pinned,rpc,actor,target:body.target,directIds});result=facts;
        }else{
          const selectedResources=resources(body.resources),graph=bindSynthesisDesignGraph({release:pinned,graphBytes:hex(body.graphHex,7713)});
          result=await saveGuidedSynthesisWorkflow({release:pinned,abi,rpc,actor,graph,directIds,challengePpm:body.challengePpm,maxRent:decimal(body.maxRent),maxUploadRent:decimal(body.maxUploadRent),maxFee:decimal(body.maxFee),resources:selectedResources,store});
        }
      }
    }else if(['inventory-read','manufacture-plan','manufacture-next'].includes(action)){
      fields(body,action==='inventory-read'?['actor','projectIdsHex','sourceIdsHex']:action==='manufacture-plan'?['actor','projectIdsHex','sourceIdsHex','descriptor','maxPartRent','maxUploadRent','resources']:['actor','workflowId']);
      const actor=actorAddress(body.actor),store=new PartWorkflowStore({directory:path.join(root,namespace,nativeKeyBytes(actor).toString('hex'),'workflows')});
      if(action==='manufacture-next'){
        const workflowId=id32(body.workflowId).toString('hex');
        result=await readPartManufactureProgress({release:pinned,abi,actor,workflowId,store,session:await session(actor,'primary')});
      }else{
        const projectIds=ids32(body.projectIdsHex,8),sourceIds=ids32(body.sourceIdsHex,16),rpc=new ReadOnlyRpc(runtime);
        if(action==='inventory-read'){
          const {inventory,...facts}=await readMaterialInventory({release:pinned,rpc,actor,projectIds,sourceIds});result={...facts,actor};
        }else{
          fields(body.descriptor,['primitive','profile']);
          const selectedResources=resources(body.resources),maxPartRent=decimal(body.maxPartRent),maxUploadRent=decimal(body.maxUploadRent);
          result=await savePartManufactureWorkflow({release:pinned,abi,rpc,actor,projectIds,sourceIds,descriptor:body.descriptor,maxPartRent,maxUploadRent,resources:selectedResources,store});
        }
      }
    }else if(action==='project-plan'){
      fields(body,['actor','name','seller','classes','maxCreationFee','maxRent','resources']);
      check(Array.isArray(body.classes)&&body.classes.length===4,'BRIDGE_PROJECT_CLASSES');
      const classes=body.classes.map(c=>{fields(c,['class','cap','unitPrice']);return {class:c.class,cap:decimal(c.cap),unitPrice:decimal(c.unitPrice)};});
      const selectedResources=resources(body.resources),actor=actorAddress(body.actor),rpc=new ReadOnlyRpc(runtime);
      const {action:proposed,...facts}=await planCreateProject({release:pinned,abi,rpc,actor,name:body.name,seller:actorAddress(body.seller),classes,maxCreationFee:decimal(body.maxCreationFee),maxRent:decimal(body.maxRent)});
      result={...facts,actor,...(facts.preview?.projectId?{projectIdHex:facts.preview.projectId}:{}),...(proposed?{intent:nativeActionIntent(proposed,selectedResources)}:{})};
    }else if(action==='project-read'){
      fields(body,['actor','projectIdHex']);const actor=actorAddress(body.actor),projectId=id32(body.projectIdHex);
      result={...await readProjectState({release:pinned,rpc:new ReadOnlyRpc(runtime),projectId}),actor};
    }else if(action==='project-status'){
      fields(body,['actor','nonce']);const actor=actorAddress(body.actor),nonce=decimal(body.nonce);
      result=await reconcileProjectCreation({release:pinned,abi,session:await session(actor,'primary'),actor,nonce});
    }else if(['purchase-plan','asset-read','asset-plan','position-plan'].includes(action)){
      const rpc=new ReadOnlyRpc(runtime);let plan,selectedResources;
      if(action==='purchase-plan'){
        fields(body,['actor','projectIdHex','class','quantity','maxPayment','maxRent','resources']);selectedResources=resources(body.resources);
        plan=await planSelfPurchase({release:pinned,abi,rpc,actor:actorAddress(body.actor),projectId:id32(body.projectIdHex),class:body.class,quantity:decimal(body.quantity),maxPayment:decimal(body.maxPayment),maxRent:decimal(body.maxRent)});
      }else if(action==='asset-read'){
        fields(body,['actor','instanceHex','positionPageStart','positionPageLimit']);
        plan=await readPlayerAsset({release:pinned,rpc,actor:actorAddress(body.actor),instance:id32(body.instanceHex),positionPageStart:decimal(body.positionPageStart),positionPageLimit:body.positionPageLimit});
        if(plan.positions)plan={...plan,positions:plan.positions.map(p=>({positionSeq:p.sequence,...p.value}))};
      }else if(action==='asset-plan'){
        check(body?.kind==='stake'||body?.kind==='exit','BRIDGE_ASSET_KIND');
        fields(body,['actor','instanceHex','kind','maxRent','resources',...(body.kind==='stake'?['beneficiary']:[])]);selectedResources=resources(body.resources);
        plan=await planPlayerAssetAction({release:pinned,abi,rpc,actor:actorAddress(body.actor),instance:id32(body.instanceHex),kind:body.kind,maxRent:decimal(body.maxRent),...(body.kind==='stake'?{beneficiary:actorAddress(body.beneficiary)}:{})});
      }else{
        fields(body,['actor','instanceHex','positionSeq','kind','maxRent','resources']);selectedResources=resources(body.resources);
        plan=await planGuidedPositionAction({release:pinned,abi,rpc,actor:actorAddress(body.actor),instance:id32(body.instanceHex),positionSeq:decimal(body.positionSeq),kind:body.kind,maxRent:decimal(body.maxRent)});
      }
      const {action:proposed,...facts}=plan;
      result={...facts,actor:actorAddress(body.actor),...(proposed?{intent:nativeActionIntent(proposed,selectedResources)}:{})};
    }else if(action==='inspect'||action==='simulate'){
      fields(body,['envelope']);const prepared=await inspect(body.envelope);
      if(action==='simulate')result=await new ReadOnlyRpc(runtime).simulatePreparedV1(prepared.unsignedBytes,{supportedTransactionVersions:[1]});
      else result={operation:body.envelope.operation,actor:prepared.actor,feePayer:body.envelope.feePayer,programId:pinned.input.programId,nonce:prepared.nonce,bytes:prepared.unsignedBytes.length,
        requestHash:prepared.requestHash,requiredSigners:Object.keys(prepared.transaction.signatures),resources:body.envelope.resources,
        businessExecutionVerified:false,...(body.envelope.labDestinationSetup===undefined?{}:{labDestinationSetup:body.envelope.labDestinationSetup})};
    }else if(action==='prepare'){
      fields(body,['actor','intent']);const actor=actorAddress(body.actor),intent=intentInput(body.intent,abi);
      result=await(await session(actor,'primary')).prepare(intent);
    }else if(action==='refresh'||action==='broadcast'){
      fields(body,action==='refresh'?['actor','envelope','log']:['actor','envelope','signedTransactionBase64','log']);
      const actor=actorAddress(body.actor);check(body.log==='primary'||body.log==='cancellation','BRIDGE_LOG');
      await inspect(body.envelope,actor);
      const bytes=action==='broadcast'?signedBytes(body.signedTransactionBase64):null,s=await session(actor,body.log);
      result=action==='refresh'?await s.refresh(body.envelope):await s.broadcastSigned(body.envelope,bytes);
    }else if(action==='status'){
      fields(body,['actor','nonce','log']);const actor=actorAddress(body.actor),nonce=decimal(body.nonce);
      result=await(await session(actor,body.log)).reconcile(nonce);
    }else if(action==='cancel-prepare'||action==='cancel-status'){
      fields(body,action==='cancel-prepare'?['actor','nonce','maxRent','resources']:['actor','nonce']);
      const actor=actorAddress(body.actor),nonce=decimal(body.nonce);
      const extra=action==='cancel-prepare'?{maxRent:decimal(body.maxRent),resources:resources(body.resources)}:{};
      const args={release:pinned,abi,actor,nonce,primarySession:await session(actor,'primary'),cancellationSession:await session(actor,'cancellation'),...extra};
      result=action==='cancel-prepare'?await prepareNativeCancellation(args):await reconcileNativeCancellation(args);
    }else check(false,'BRIDGE_ACTION');
    return jsonSafe(result);
  }
  return Object.freeze({dispatch,publicConfig:()=>jsonSafe(publicInfo)});
}
