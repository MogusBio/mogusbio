import {createHash} from 'node:crypto';
import {decodeMaterialPlan,encodeMaterialPlan,F1_BOM,sourceId,initialTicks,materialClass} from '../../protocol-core/src/index.mjs';
import {decodeDescriptor} from '../../composition/src/payload.mjs';
import {baseConfigR2Id} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes} from './native.mjs';
import {validateV1Resources} from './transaction.mjs';
import {compileManufacturePartWorkflow} from './workflow.mjs';
import {FileJournalStore} from './file-journal.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const hex=b=>Buffer.from(b).toString('hex');
const dec=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&s.length<=20,'PART_MANIFEST_DECIMAL');const n=BigInt(s);check(n<(1n<<64n),'PART_MANIFEST_U64');return n;};
const fields=(v,names)=>check(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...names].sort().join(','),'PART_MANIFEST_FIELDS');
const hash=s=>createHash('sha256').update('BIOPART-MANIFEST1\0').update(s).digest('hex');
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false};
function resourceRecord(value){
  const v=validateV1Resources(value);return {computeUnitLimit:v.computeUnitLimit,loadedAccountsDataSizeLimit:v.loadedAccountsDataSizeLimit,...(v.heapSize===undefined?{}:{heapSize:v.heapSize}),priorityFeeLamports:v.priorityFeeLamports.toString()};
}
function readResources(value){
  const names=['computeUnitLimit','loadedAccountsDataSizeLimit','priorityFeeLamports',...(Object.hasOwn(value??{},'heapSize')?['heapSize']:[])];fields(value,names);
  return {...value,priorityFeeLamports:dec(value.priorityFeeLamports)};
}
function validatePlan(release,actor,workflow){
  const plan=workflow.materialPlan,owner=nativeKeyBytes(actor),totals=Array(32).fill(0n);
  check(plan.catalogHash.equals(release.hashes.catalogHash)&&plan.intakes.length<=4&&plan.debits.length===4,'PART_MANIFEST_PLAN');
  for(const d of plan.debits)for(const e of d.entries)totals[e.species-1]+=e.takeTick;
  check(totals.every((n,i)=>n===F1_BOM[i]),'PART_MANIFEST_BOM');
  const newIds=plan.intakes.map((_,i)=>sourceId(release.domain,workflow.business,i));
  for(const [i,item] of plan.intakes.entries()){
    check(item.materialOwner.equals(owner),'PART_MANIFEST_OWNER');
    const d=plan.debits.find(v=>v.sourceId.equals(newIds[i]));check(d,'PART_MANIFEST_NEW_SOURCE');
    const species=materialClass(item.class).species,max=d.entries.reduce((m,e)=>e.takeTick>m?e.takeTick:m,0n);
    check(item.unitCount===(max+999n)/1000n&&d.entries.every(e=>e.expectedPrefix===0n&&species.includes(e.species)&&e.takeTick<=initialTicks(item.class,item.unitCount)[e.species-1]),'PART_MANIFEST_INTAKE');
  }
  return newIds;
}
function manifestText(release,abi,actor,workflow,resources){
  const f=workflow.stages[0].frame;
  return JSON.stringify({version:'BIOPART-MANIFEST1',releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:hex(release.domain),configHex:hex(baseConfigR2Id(release)),actor:nativeKeyAddress(actor),initialNonce:workflow.initialNonce.toString(),maxUploadRent:f.readBigUInt64LE(f.length-8).toString(),artifactBodyHex:hex(workflow.artifactBody),resources:resourceRecord(resources)});
}

/** Public bytes only; the content ID is not chain authorization or execution. */
export async function createPartManifest({release,abi,actor,workflow,resources}){
  validatePlan(release,actor,workflow);const text=manifestText(release,abi,actor,workflow,resources);
  return restorePartManifest({release,abi,actor,workflowId:hash(text),text});
}
export async function restorePartManifest({release,abi,actor,workflowId,text}){
  check(typeof text==='string'&&Buffer.byteLength(text)<=16384&&typeof workflowId==='string'&&/^[0-9a-f]{64}$/.test(workflowId)&&hash(text)===workflowId,'PART_MANIFEST_HASH');
  const v=JSON.parse(text);fields(v,['version','releaseHash','abiHash','domainHex','configHex','actor','initialNonce','maxUploadRent','artifactBodyHex','resources']);
  check(v.version==='BIOPART-MANIFEST1'&&v.releaseHash===release.input.releaseHash&&v.abiHash===abi.hash&&v.domainHex===hex(release.domain)&&v.configHex===hex(baseConfigR2Id(release))&&v.actor===nativeKeyAddress(actor),'PART_MANIFEST_CONTEXT');
  check(typeof v.artifactBodyHex==='string'&&/^(?:[0-9a-f]{2})+$/.test(v.artifactBodyHex)&&v.artifactBodyHex.length<=6232,'PART_MANIFEST_BODY');
  const body=Buffer.from(v.artifactBodyHex,'hex');check(body.length>44&&body.subarray(4,36).equals(nativeKeyBytes(actor)),'PART_MANIFEST_RENT_PAYER');
  const descriptor=decodeDescriptor(body.subarray(0,4)),plan=decodeMaterialPlan(body.subarray(44)),resources=readResources(v.resources);
  check(encodeMaterialPlan(plan).equals(body.subarray(44)),'PART_MANIFEST_CANONICAL_PLAN');
  const workflow=await compileManufacturePartWorkflow({release,abi,actor,initialNonce:dec(v.initialNonce),materialPlan:plan,descriptor,maxPartRent:body.readBigUInt64LE(36),maxUploadRent:dec(v.maxUploadRent)});
  const newSourceIds=validatePlan(release,actor,workflow);check(workflow.artifactBody.equals(body)&&manifestText(release,abi,actor,workflow,resources)===text,'PART_MANIFEST_CANONICAL');
  return {workflowId,text,actor:v.actor,workflow,descriptor,resources,newSourceIds,maxUploadRent:dec(v.maxUploadRent),maxPartRent:body.readBigUInt64LE(36)};
}
export function publicPartWorkflow(m){
  const w=m.workflow,newSet=new Set(m.newSourceIds.map(hex)),projectIdsHex=[...new Set(w.materialPlan.intakes.map(i=>hex(i.projectId)))].sort();
  return {workflowId:m.workflowId,actor:m.actor,initialNonce:w.initialNonce,manufactureNonce:w.manufactureNonce,nextNonce:w.nextNonce,artifactIdHex:hex(w.artifactId),artifactSHAHex:hex(w.artifactSHA),outputIdHex:hex(w.outputId),outputAddress:w.outputAddress,descriptor:m.descriptor,maxPartRent:m.maxPartRent,maxUploadRent:m.maxUploadRent,stageCount:w.stages.length,resources:resourceRecord(m.resources),newSourceIdsHex:m.newSourceIds.map(hex),existingSourceIdsHex:w.materialPlan.debits.map(d=>hex(d.sourceId)).filter(id=>!newSet.has(id)),projectIdsHex,materialPlan:{intakes:w.materialPlan.intakes,debits:w.materialPlan.debits}};
}
export class PartWorkflowStore{
  #directory;
  constructor({directory}){this.#directory=directory;}
  async #store(id){check(typeof id==='string'&&/^[0-9a-f]{64}$/.test(id),'PART_WORKFLOW_ID');return FileJournalStore.open({directory:this.#directory,name:`part-${id}.json`});}
  async save(manifest){
    check(manifest&&hash(manifest.text)===manifest.workflowId,'PART_MANIFEST_HASH');const store=await this.#store(manifest.workflowId),old=await store.load();
    if(old.payload!==null){check(old.payload===manifest.text,'PART_MANIFEST_CONFLICT');return {saved:true,alreadySaved:true};}
    const saved=await store.compareAndSwap(old.revision,manifest.text);
    if(saved===false){const reread=await store.load();check(reread.payload===manifest.text,'PART_MANIFEST_CONFLICT');}
    return {saved:true,alreadySaved:saved===false};
  }
  async load({release,abi,actor,workflowId}){const store=await this.#store(workflowId),value=await store.load();check(value.payload!==null,'PART_MANIFEST_NOT_FOUND');return restorePartManifest({release,abi,actor,workflowId,text:value.payload});}
}
export {flags as partReadFlags};
