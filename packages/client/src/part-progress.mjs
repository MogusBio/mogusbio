import {asBytes,prepareMaterialConsumption,encodeDebitPlan} from '../../protocol-core/src/index.mjs';
import {descriptorBytes} from '../../composition/src/payload.mjs';
import {validateV1Resources} from './transaction.mjs';
import {readMaterialInventory} from './material-inventory.mjs';
import {planManufacturePartWorkflow} from './workflow.mjs';
import {createPartManifest,publicPartWorkflow,partReadFlags} from './part-manifest.mjs';
import {decodeNativePartArtifact,decodePartManufactureBody,decodeNativeManufacturePartResult} from './manufacture-records.mjs';
import {decodeNativeBaseConfig,decodeNativeRoot} from './accounts.mjs';
import {decodeNativeClock,decodeNativeEconomyConfig} from './economy-accounts.mjs';
import {decodeActorNonceSnapshot} from './journal.mjs';
import {PROGRAMS,baseConfigR2Id} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda,nativeRequestHash} from './native.mjs';
import {nativeActionIntent} from './player-settlement.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const hex=b=>Buffer.from(b).toString('hex');
const pda=(r,...s)=>nativePda(r.input.programId,'bio',...s).then(p=>p.address);
const absent=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const equalAccount=(a,b)=>a===null?b===null:b!==null&&a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&asBytes(a.data).equals(asBytes(b.data));
function refs(m){const p=publicPartWorkflow(m);return {projectIds:p.projectIdsHex.map(v=>Buffer.from(v,'hex')),sourceIds:p.existingSourceIdsHex.map(v=>Buffer.from(v,'hex'))};}
function preflight(release,actor,m,read){
  return prepareMaterialConsumption(read.inventory,{domain:release.domain,manufactureBusiness:m.workflow.business,authorizedOwners:new Set([hex(nativeKeyBytes(actor))]),createdAt:read.clock.unixTimestamp,createdSlot:read.clock.slot,plan:m.workflow.materialPlan});
}
/** The only write is an immutable public local manifest. No chain or request
 * journal is mutated; a later explicit progress read must recheck actual facts. */
export async function savePartManufactureWorkflow({release,abi,rpc,actor,projectIds,sourceIds,descriptor,maxPartRent,maxUploadRent,resources,store}){
  descriptorBytes(descriptor);validateV1Resources(resources);
  for(const n of [maxPartRent,maxUploadRent])check(typeof n==='bigint'&&n>=0n&&n<(1n<<64n),'PART_WORKFLOW_U64');
  const read=await readMaterialInventory({release,rpc,actor,projectIds,sourceIds});
  if(read.decision!=='INVENTORY_READ')return {...partReadFlags,decision:read.decision,contextSlot:read.contextSlot,actor:nativeKeyAddress(actor)};
  const workflow=await planManufacturePartWorkflow({release,abi,actor,initialNonce:read.nextNonce,inventory:read.inventory,descriptor,maxPartRent,maxUploadRent});
  const manifest=await createPartManifest({release,abi,actor,workflow,resources});preflight(release,actor,manifest,read);
  const saved=await store.save(manifest);
  return {...partReadFlags,decision:'WORKFLOW_SAVED',actor:nativeKeyAddress(actor),contextSlot:read.contextSlot,workflow:publicPartWorkflow(manifest),summary:read.summary,alreadySaved:saved.alreadySaved,requiresExplicitNextRead:true,reservesOnChainNonce:false,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null};
}
async function snapshot(release,rpc,m){
  const w=m.workflow,keys=[release.pdas.baseConfig.address,await pda(release,'econ-config'),PROGRAMS.clockSysvar,await pda(release,'actor-nonce',nativeKeyBytes(m.actor)),await pda(release,'artifact',w.artifactId),w.outputAddress,...await Promise.all(m.newSourceIds.map(id=>pda(release,'source',id)))];
  const {accounts,contextSlot}=await rpc.getMultipleAccounts(keys);await decodeNativeBaseConfig(release,accounts[0]);await decodeNativeEconomyConfig(release,accounts[1]);
  const clock=decodeNativeClock(accounts[2]),nonce=await decodeActorNonceSnapshot({release,actor:m.actor,address:keys[3],account:accounts[3],contextSlot,commitment:'finalized'});
  const artifact=absent(accounts[4])?null:await decodeNativePartArtifact({release,info:accounts[4],artifactId:w.artifactId,actor:m.actor,expectedBody:w.artifactBody});
  if(artifact?.sealed)check(artifact.sealedAt<=clock.unixTimestamp&&artifact.sealedSlot<=clock.slot,'PART_PROGRESS_FUTURE_ARTIFACT');
  const root=absent(accounts[5])?null:await decodeNativeRoot(release,accounts[5],w.outputId);
  return {accounts,contextSlot,clock,nonce,artifact,root};
}
async function request(session,nonce){try{return await session.getRequest(nonce);}catch(e){if(['JOURNAL_NOT_FOUND','JOURNAL_ARCHIVE_NOT_FOUND'].includes(e.code))return null;throw e;}}
const exactFrame=(entry,stage)=>entry!==null&&asBytes(entry.frameBytes).equals(stage.frame);
function sessionContext(release,abi,actor,session){const c=session?.recoveryIdentity;check(c?.releaseHash===release.input.releaseHash&&c.abiHash===abi.hash&&c.actor===nativeKeyAddress(actor)&&c.domainHex===hex(release.domain)&&c.configHex===hex(baseConfigR2Id(release)),'PART_PROGRESS_SESSION');}
function rootPublic(root){return {instanceHex:hex(root.instance),owner:root.owner,lifecycle:root.lifecycle,schema:root.schema,descriptorHex:hex(root.descriptor),qualityPpm:root.qualityPpm,B:root.B,retired:root.retired};}
async function actualOutput(release,abi,m,s,rpc,session){
  const w=m.workflow,final=w.stages.at(-1),root=s.root;decodePartManufactureBody({release,abi,frame:final.frame,artifactBody:w.artifactBody});
  check(root.schema===1&&root.manufactureBusiness.equals(w.business)&&root.requestHash.equals(nativeRequestHash(abi,final.frame))&&root.descriptor.equals(w.artifactBody.subarray(0,4))&&root.createdAt<=s.clock.unixTimestamp&&root.createdSlot<=s.clock.slot&&s.nonce.nextNonce>w.manufactureNonce,'PART_OUTPUT_IDENTITY');
  check(s.accounts[5].data.subarray(443).equals(encodeDebitPlan(w.materialPlan.debits)),'PART_OUTPUT_DEBIT_PLAN');
  check(s.artifact?.sealed===true&&s.artifact.fullPayloadHashVerified===true&&s.artifact.sealedAt<=root.createdAt&&s.artifact.sealedSlot<=root.createdSlot,'PART_OUTPUT_ARTIFACT');
  const ref=refs(m),sourceIds=[...ref.sourceIds,...m.newSourceIds],read=await readMaterialInventory({release,rpc,actor:m.actor,projectIds:ref.projectIds,sourceIds});
  if(read.decision!=='INVENTORY_READ')return {decision:read.decision,outputVerified:false,root:null};
  for(const d of w.materialPlan.debits){
    const actual=read.inventory.sources.get(hex(d.sourceId));check(actual&&d.entries.every(e=>actual.spentPrefix[e.species-1]>=e.expectedPrefix+e.takeTick),'PART_OUTPUT_SOURCE_PREFIX');
  }
  for(const [i,id]of m.newSourceIds.entries()){
    const actual=read.inventory.sources.get(hex(id)),item=w.materialPlan.intakes[i],project=read.inventory.projects.get(hex(item.projectId));
    check(actual.manufactureBusiness.equals(w.business)&&actual.projectId.equals(item.projectId)&&actual.sourceTokenAccount.equals(item.sourceTokenAccount)&&actual.unitCount===item.unitCount&&actual.intakeOrdinal===i&&actual.class===item.class&&actual.createdAt===root.createdAt&&actual.createdSlot===root.createdSlot&&project.classes[item.class-1].intakeBurned>=item.unitCount,'PART_OUTPUT_SOURCE_ORIGIN');
  }
  let exact=false,receipt=null;const entry=await request(session,final.nonce);
  if(exactFrame(entry,final)){
    const result=await session.reconcile(final.nonce);
    if(result.decision==='CONFIRMED'&&result.businessExecutionVerified===true){receipt=await decodeNativeManufacturePartResult({release,abi,frame:final.frame,result:result.resultBytes,artifactBody:w.artifactBody});exact=true;}
  }
  const last=await snapshot(release,rpc,m);
  check(read.clock.slot>=s.clock.slot&&read.clock.unixTimestamp>=s.clock.unixTimestamp&&last.clock.slot>=read.clock.slot&&last.clock.unixTimestamp>=read.clock.unixTimestamp&&read.nextNonce>=s.nonce.nextNonce&&last.nonce.nextNonce>=read.nextNonce,'PART_PROGRESS_CLOCK_REGRESSION');
  if(!equalAccount(s.accounts[4],last.accounts[4])||!equalAccount(s.accounts[5],last.accounts[5]))return {decision:'REPLAN_STALE_STATE',outputVerified:false,root:null,contextSlot:last.contextSlot};
  return {decision:'OUTPUT_READ',outputVerified:true,exactRequestExecutionVerified:exact,businessExecutionVerified:exact,root:rootPublic(last.root),receipt,contextSlot:last.contextSlot,sourceBudgets:read.summary.sourceBudgets,summary:read.summary};
}
/** Reads and local journal reconciliation only. A prefix that cannot be tied
 * to its durable exact requests remains pending even if the Artifact exists. */
export async function readPartManufactureProgress({release,abi,session,actor,workflowId,store}){
  sessionContext(release,abi,actor,session);const m=await store.load({release,abi,actor,workflowId}),w=m.workflow,rpc=session.rpc;
  const common={...partReadFlags,actor:m.actor,workflow:publicPartWorkflow(m),outputVerified:false,exactRequestExecutionVerified:false,root:null,lookupOnly:true};
  let s=await snapshot(release,rpc,m);
  if(s.root)return {...common,...await actualOutput(release,abi,m,s,rpc,session)};
  const n=s.nonce.nextNonce,index=w.stages.findIndex(v=>v.nonce===n);
  if(index<0)return {...common,decision:'NONCE_WINDOW_CHANGED_REPLAN',contextSlot:s.contextSlot,nextNonce:n};
  const stage=w.stages[index],chunks=w.stages.length-2,expectedWritten=Math.min(Math.min(index,chunks)*1024,w.artifactBody.length);
  if(index===0)check(s.artifact===null,'PART_PROGRESS_UNEXPECTED_ARTIFACT');
  else check(s.artifact&&s.artifact.written===expectedWritten&&s.artifact.sequence===BigInt(Math.min(index,chunks))&&s.artifact.sealed===(stage.kind==='MANUFACTURE'),'PART_PROGRESS_ARTIFACT_STAGE');
  for(let i=0;i<index;i++){
    const prior=w.stages[i],entry=await request(session,prior.nonce);
    if(!exactFrame(entry,prior))return {...common,decision:'WAIT_UNVERIFIED_PREFIX',contextSlot:s.contextSlot,blockingNonce:prior.nonce};
    const result=await session.reconcile(prior.nonce);
    if(result.decision!=='CONFIRMED'||result.businessExecutionVerified!==true)return {...common,decision:'WAIT_UNVERIFIED_PREFIX',contextSlot:s.contextSlot,blockingNonce:prior.nonce,requestDecision:result.decision};
  }
  const pending=await request(session,n);
  if(pending!==null)return {...common,decision:exactFrame(pending,stage)?'RECOVER_CURRENT_REQUEST':'CONFLICTING_CURRENT_REQUEST',contextSlot:s.contextSlot,stage:{index,count:w.stages.length,kind:stage.kind,nonce:n},recoveryNonce:n};
  const ref=refs(m),read=await readMaterialInventory({release,rpc,actor:m.actor,...ref});
  if(read.decision!=='INVENTORY_READ')return {...common,decision:read.decision,contextSlot:read.contextSlot};
  if(read.nextNonce!==n)return {...common,decision:'REPLAN_STALE_STATE',contextSlot:read.contextSlot};
  try{preflight(release,m.actor,m,read);}catch(e){return {...common,decision:'MATERIAL_PLAN_STALE',reason:e.code??'PART_MATERIAL_PREFLIGHT',contextSlot:read.contextSlot};}
  const last=await snapshot(release,rpc,m);check(last.clock.slot>=s.clock.slot&&last.clock.unixTimestamp>=s.clock.unixTimestamp,'PART_PROGRESS_CLOCK_REGRESSION');
  if(last.nonce.nextNonce!==n||!equalAccount(s.accounts[4],last.accounts[4])||!equalAccount(s.accounts[5],last.accounts[5]))return {...common,decision:'REPLAN_STALE_STATE',contextSlot:last.contextSlot};
  check(last.accounts.slice(6).every(absent),'PART_PROGRESS_NEW_SOURCE_EXISTS');
  return {...common,decision:'ACTION',contextSlot:last.contextSlot,stage:{index,count:w.stages.length,kind:stage.kind,nonce:n},intent:nativeActionIntent(stage,m.resources),requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null,reservesOnChainNonce:false};
}
