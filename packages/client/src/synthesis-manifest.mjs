import {createHash} from 'node:crypto';
import {asBytes,ByteWriter,sha256,typedHash} from '../../protocol-core/src/index.mjs';
import {encodeGraph,validateGraph,members} from '../../biology/src/graph.mjs';
import {decodeSynthesisPayload,encodeSynthesisPayload} from '../../composition/src/payload.mjs';
import {baseConfigR2Id} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda,decodeNativeFrame} from './native.mjs';
import {validateV1Resources} from './transaction.mjs';
import {planSynthesisPayload} from './synthesis-workflow.mjs';
import {FileJournalStore} from './file-journal.mjs';

const MAX=(1n<<64n)-1n,I64=(1n<<63n)-1n,MAX_BYTES=262144,MAX_TEXT=540672;
const contexts=new WeakMap();
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const hex=b=>Buffer.from(b).toString('hex');
const fields=(v,n)=>check(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...n].sort().join(','),'SYN_MANIFEST_FIELDS');
const id=s=>{check(typeof s==='string'&&/^[0-9a-f]{64}$/.test(s),'SYN_MANIFEST_ID');return Buffer.from(s,'hex');};
const u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'SYN_MANIFEST_U64');return n;};
const dec=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&s.length<=20,'SYN_MANIFEST_DECIMAL');return u64(BigInt(s));};
const pda=(release,...s)=>nativePda(release.input.programId,'bio',...s).then(p=>p.address);
const digest=text=>createHash('sha256').update('BIOSYNTHESIS-MANIFEST1\0').update(text).digest('hex');
function challenge(target,value){
  check(Number.isInteger(value)&&value>=500000&&value<=2000000&&value%1000===0,'SYN_MANIFEST_CHALLENGE');
  check(![3,9,14,15,21].includes(target)||value===2000000,'SYN_MANIFEST_HARD_CHALLENGE');return value;
}
function resourceRecord(value){
  fields(value,['computeUnitLimit','loadedAccountsDataSizeLimit','priorityFeeLamports',...(Object.hasOwn(value??{},'heapSize')?['heapSize']:[])]);
  const v=validateV1Resources(value);return {computeUnitLimit:v.computeUnitLimit,loadedAccountsDataSizeLimit:v.loadedAccountsDataSizeLimit,heapSize:v.heapSize,priorityFeeLamports:v.priorityFeeLamports.toString()};
}
function resourceValues(value){fields(value,['computeUnitLimit','loadedAccountsDataSizeLimit','heapSize','priorityFeeLamports']);return {...value,priorityFeeLamports:dec(value.priorityFeeLamports)};}
function binding(release,abi,actor){
  check(abi?.hash===release.hashes.abiHash.toString('hex'),'SYN_MANIFEST_ABI');
  return {version:'BIOSYNTHESIS-MANIFEST1',releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:hex(release.domain),configHex:hex(baseConfigR2Id(release)),actor:nativeKeyAddress(actor)};
}
const fee=payload=>BigInt(payload.leaves.length)*(payload.graph.target>=16&&payload.graph.target<=21?400000n:200000n);
function exactHierarchy(payload){
  const target=payload.graph.target,expected=target<=15?[1,2,3,4]:target<=21?members(target):[16,17,18,19,20,21];
  check(payload.direct.length===expected.length&&payload.direct.every((d,i)=>d.scope===(target<=15?target:expected[i])&&d.primitive===(target<=15?expected[i]:0)),'SYN_MANIFEST_DIRECT_HIERARCHY');
}
function serialize(value){return JSON.stringify(value);}
const cloneInput=input=>({instance:Buffer.from(asBytes(input.instance,32)),account:{...input.account,data:Buffer.from(asBytes(input.account.data))},rootReg:input.rootReg,
  originalArtifact:input.originalArtifact===undefined?undefined:{...input.originalArtifact,data:Buffer.from(asBytes(input.originalArtifact.data))}});

/** Create freezes an existing actual-input plan. Restore never needs children
 * to remain LIVE, which is essential after successful one-way consumption. */
export async function createSynthesisManifest(args){
  fields(args,['release','abi','actor','plan','directInputs','challengePpm','maxRent','maxUploadRent','maxFee','resources']);
  const {release,abi}=args,actor=nativeKeyAddress(args.actor),bytes=Buffer.from(asBytes(args.plan?.bytes));
  check(bytes.length>0&&bytes.length<=MAX_BYTES,'SYN_MANIFEST_PAYLOAD');
  const payload=decodeSynthesisPayload(bytes);validateGraph(payload.graph,{domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash});exactHierarchy(payload);
  const challengePpm=challenge(payload.graph.target,args.challengePpm),maxRent=u64(args.maxRent),maxUploadRent=u64(args.maxUploadRent),maxFee=u64(args.maxFee),resources=resourceRecord(args.resources);
  check(maxFee>=fee(payload),'SYN_MANIFEST_FEE_CAP');check(Array.isArray(args.directInputs)&&args.directInputs.length===payload.direct.length,'SYN_MANIFEST_DIRECT_COUNT');
  const directInputs=args.directInputs.map(cloneInput),actual=await planSynthesisPayload({release,actor,graph:payload.graph,directInputs});
  check(actual.bytes.equals(bytes),'SYN_MANIFEST_ACTUAL_PLAN');
  const direct=actual.directRoots.map(r=>({instanceHex:hex(r.instance),revision:r.revision.toString(),fingerprintHex:hex(r.fingerprint),createdAt:r.createdAt.toString(),createdSlot:r.createdSlot.toString()}));
  const parents=actual.parents.map(p=>{const input=directInputs.find(i=>i.instance.equals(p.instance));check(input?.originalArtifact,'SYN_MANIFEST_PARENT');return {instanceHex:hex(p.instance),artifactIdHex:hex(input.account.data.subarray(443,475))};});
  const text=serialize({...binding(release,abi,actor),payload702Hex:hex(bytes),direct,parents,challengePpm,maxRent:maxRent.toString(),maxUploadRent:maxUploadRent.toString(),maxFee:maxFee.toString(),resources});
  return restoreSynthesisManifest({release,abi,actor,workflowId:digest(text),text});
}
export async function restoreSynthesisManifest(args){
  fields(args,['release','abi','actor','workflowId','text']);const {release,abi,workflowId,text}=args;
  check(typeof text==='string'&&Buffer.byteLength(text)<=MAX_TEXT&&digest(text)===workflowId,'SYN_MANIFEST_HASH');id(workflowId);
  const value=JSON.parse(text),head=binding(release,abi,args.actor);
  fields(value,[...Object.keys(head),'payload702Hex','direct','parents','challengePpm','maxRent','maxUploadRent','maxFee','resources']);
  check(Object.entries(head).every(([k,v])=>value[k]===v),'SYN_MANIFEST_CONTEXT');
  check(typeof value.payload702Hex==='string'&&value.payload702Hex.length>0&&value.payload702Hex.length<=MAX_BYTES*2&&/^(?:[0-9a-f]{2})+$/.test(value.payload702Hex),'SYN_MANIFEST_PAYLOAD');
  const bytes=Buffer.from(value.payload702Hex,'hex'),payload=decodeSynthesisPayload(bytes),target=payload.graph.target;
  check(encodeSynthesisPayload(payload).equals(bytes),'SYN_MANIFEST_CANONICAL_PAYLOAD');
  validateGraph(payload.graph,{domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash});exactHierarchy(payload);
  const challengePpm=challenge(target,value.challengePpm),maxRent=dec(value.maxRent),maxUploadRent=dec(value.maxUploadRent),maxFee=dec(value.maxFee),resources=resourceValues(value.resources),materialFeeAtoms=fee(payload);
  check(maxFee>=materialFeeAtoms&&JSON.stringify(resourceRecord(resources))===JSON.stringify(value.resources),'SYN_MANIFEST_FEE_OR_RESOURCES');
  check(Array.isArray(value.direct)&&value.direct.length===payload.direct.length,'SYN_MANIFEST_DIRECT_COUNT');
  const directRoots=[];
  for(let i=0;i<payload.direct.length;i++){
    const row=value.direct[i],d=payload.direct[i];fields(row,['instanceHex','revision','fingerprintHex','createdAt','createdSlot']);
    const instance=id(row.instanceHex),fingerprint=id(row.fingerprintHex),revision=dec(row.revision),createdAt=dec(row.createdAt),createdSlot=dec(row.createdSlot);
    check(instance.equals(d.instance)&&fingerprint.equals(d.fingerprint)&&revision===d.expectedRevision&&createdAt<=I64,'SYN_MANIFEST_DIRECT_BINDING');
    directRoots.push({instance,address:await pda(release,'root',instance),revision,fingerprint,createdAt,createdSlot});
  }
  check(Array.isArray(value.parents)&&value.parents.length===(target<=15?0:payload.direct.length),'SYN_MANIFEST_PARENT_COUNT');
  const parents=[];
  for(let i=0;i<value.parents.length;i++){
    const row=value.parents[i];fields(row,['instanceHex','artifactIdHex']);const instance=id(row.instanceHex),artifact=id(row.artifactIdHex);
    check(instance.equals(payload.direct[i].instance),'SYN_MANIFEST_PARENT_BINDING');
    parents.push({instance,rootAddress:directRoots[i].address,artifactAddress:await pda(release,'artifact',artifact)});
  }
  const artifactSHA=sha256(bytes),artifactId=typedHash(19,new ByteWriter(134).raw(release.domain).raw(baseConfigR2Id(release)).raw(nativeKeyBytes(head.actor)).u16(702).u32(bytes.length).raw(artifactSHA).finish()),graphSHA=sha256(encodeGraph(payload.graph));
  const plan={profile:'BIOP0R2-SYN-PLAN1',domainHex:head.domainHex,configHex:head.configHex,actor:head.actor,target,payload,bytes,artifactId,artifactSHA,graphSHA,directRoots,parents,materialFeeAtoms,clientPlanOnly:true,productionAdmission:false};
  const direct=directRoots.map(r=>({instanceHex:hex(r.instance),revision:r.revision.toString(),fingerprintHex:hex(r.fingerprint),createdAt:r.createdAt.toString(),createdSlot:r.createdSlot.toString()}));
  const parentRows=value.parents.map(row=>({instanceHex:row.instanceHex,artifactIdHex:row.artifactIdHex}));
  const canonical={...head,payload702Hex:value.payload702Hex,direct,parents:parentRows,challengePpm,maxRent:value.maxRent,maxUploadRent:value.maxUploadRent,maxFee:value.maxFee,resources:resourceRecord(resources)};
  check(serialize(canonical)===text,'SYN_MANIFEST_CANONICAL');
  const m=Object.freeze({workflowId,text,actor:head.actor,plan,challengePpm,maxRent,maxUploadRent,maxFee,resources:Object.freeze({...resources})});
  contexts.set(m,{release,abi,workflowId,text,actor:head.actor,artifactId:Buffer.from(artifactId),artifactSHA:Buffer.from(artifactSHA),artifactBytes:bytes.length,maxRent,maxFee,parents:value.parents.map(r=>({...r}))});return m;
}
function context(m){const c=contexts.get(m);check(c&&m.workflowId===c.workflowId&&m.text===c.text,'SYN_MANIFEST_OBJECT');return c;}
export function publicSynthesisWorkflow(m){
  const c=context(m),p=m.plan;
  return {workflowId:c.workflowId,actor:c.actor,target:p.target,artifactIdHex:hex(c.artifactId),artifactSHAHex:hex(c.artifactSHA),graphSHAHex:hex(p.graphSHA),challengePpm:m.challengePpm,materialFeeAtoms:p.materialFeeAtoms.toString(),maxRent:m.maxRent.toString(),maxUploadRent:m.maxUploadRent.toString(),maxFee:m.maxFee.toString(),resources:resourceRecord(m.resources),
    direct:p.directRoots.map(r=>({instanceHex:hex(r.instance),revision:r.revision.toString(),fingerprintHex:hex(r.fingerprint)})),parents:c.parents.map(r=>({...r})),artifactBytes:c.artifactBytes,predictsFinalNonce:false,stepCountPredicted:false};
}
function finalFrame(c,frameHex){
  check(typeof frameHex==='string'&&frameHex.length>0&&frameHex.length<=8192&&/^(?:[0-9a-f]{2})+$/.test(frameHex),'SYN_MANIFEST_HINT_FRAME');
  const f=decodeNativeFrame(c.abi,Buffer.from(frameHex,'hex'));
  check(f.operation==='SYNTH_FINALIZE'&&f.payload.length===124&&f.actor.equals(nativeKeyBytes(c.actor))&&f.domain.equals(c.release.domain)&&f.configId.equals(baseConfigR2Id(c.release)),'SYN_MANIFEST_HINT_CONTEXT');
  check(f.nonce<MAX&&f.payload.subarray(0,32).equals(c.artifactId)&&f.payload.subarray(32,64).equals(c.artifactSHA)&&f.payload.readUInt32LE(64)===c.artifactBytes
    &&f.payload.readBigUInt64LE(68)>0n&&f.payload.readBigUInt64LE(108)===c.maxFee&&f.payload.readBigUInt64LE(116)===c.maxRent,'SYN_MANIFEST_HINT_ARTIFACT');return f;
}
function lookup(value){
  if(value===null)return null;fields(value,['activationIdHex','rootInstanceHex','positionIdHex','nextStart','ordinaryCount']);
  for(const k of ['activationIdHex','rootInstanceHex','positionIdHex'])id(value[k]);const count=dec(value.ordinaryCount),next=value.nextStart===null?null:dec(value.nextStart);
  check(next===null||next<count,'SYN_MANIFEST_HINT_CURSOR');
  return {activationIdHex:value.activationIdHex,rootInstanceHex:value.rootInstanceHex,positionIdHex:value.positionIdHex,nextStart:next===null?null:next.toString(),ordinaryCount:count.toString()};
}
function hints(c,text){
  if(text===null)return {finalFrameHex:null,positionLookup:null};
  check(typeof text==='string'&&Buffer.byteLength(text)<=12288,'SYN_MANIFEST_HINT_SIZE');const v=JSON.parse(text);fields(v,['version','workflowId','finalFrameHex','positionLookup']);
  check(v.version==='BIOSYNTHESIS-HINTS1'&&v.workflowId===c.workflowId,'SYN_MANIFEST_HINT_BINDING');if(v.finalFrameHex!==null)finalFrame(c,v.finalFrameHex);
  const row={version:v.version,workflowId:v.workflowId,finalFrameHex:v.finalFrameHex,positionLookup:lookup(v.positionLookup)};
  check(JSON.stringify(row)===text,'SYN_MANIFEST_HINT_CANONICAL');return {finalFrameHex:row.finalFrameHex,positionLookup:row.positionLookup};
}
export class SynthesisWorkflowStore{
  #directory;
  constructor({directory}){this.#directory=directory;}
  async #store(workflowId,hint=false){id(workflowId);return FileJournalStore.open({directory:this.#directory,name:`synthesis-${workflowId}${hint?'-hints':''}.json`});}
  async save(m){
    const c=context(m),store=await this.#store(c.workflowId),old=await store.load();
    if(old.payload!==null){check(old.payload===c.text,'SYN_MANIFEST_CONFLICT');return {saved:true,alreadySaved:true};}
    const saved=await store.compareAndSwap(old.revision,c.text);
    if(saved===false)check((await store.load()).payload===c.text,'SYN_MANIFEST_CONFLICT');return {saved:true,alreadySaved:saved===false};
  }
  async load({release,abi,actor,workflowId}){const value=await(await this.#store(workflowId)).load();check(value.payload!==null,'SYN_MANIFEST_NOT_FOUND');return restoreSynthesisManifest({release,abi,actor,workflowId,text:value.payload});}
  async loadHints(m){const c=context(m),value=await(await this.#store(c.workflowId,true)).load();return hints(c,value.payload);}
  async #update(m,change){
    const c=context(m),saved=await(await this.#store(c.workflowId)).load();check(saved.payload===c.text,'SYN_MANIFEST_NOT_SAVED');
    const store=await this.#store(c.workflowId,true);
    for(let attempt=0;attempt<8;attempt++){
      const before=await store.load(),current=hints(c,before.payload),next=change(current,c),text=JSON.stringify({version:'BIOSYNTHESIS-HINTS1',workflowId:c.workflowId,finalFrameHex:next.finalFrameHex,positionLookup:next.positionLookup});
      hints(c,text);if(text===before.payload)return {saved:true,alreadySaved:true,...next};
      const result=await store.compareAndSwap(before.revision,text);if(result!==false)return {saved:true,alreadySaved:false,...next};
    }
    check(false,'SYN_MANIFEST_HINT_CAS_RETRY');
  }
  async recordFinalAttempt(m,action){
    const c=context(m),frameHex=hex(asBytes(action?.frame)),next=finalFrame(c,frameHex);
    if(action.nonce!==undefined)check(u64(action.nonce)===next.nonce,'SYN_MANIFEST_HINT_ACTION');
    if(action.operation!==undefined)check(action.operation===next.operation,'SYN_MANIFEST_HINT_ACTION');
    return this.#update(m,(current)=>{
      if(current.finalFrameHex!==null){const old=finalFrame(c,current.finalFrameHex);check(next.nonce>=old.nonce,'SYN_MANIFEST_HINT_NONCE_REGRESSION');check(next.nonce!==old.nonce||current.finalFrameHex===frameHex,'SYN_MANIFEST_HINT_NONCE_CONFLICT');}
      return {...current,finalFrameHex:frameHex};
    });
  }
  async savePositionLookup(m,value){const next=lookup(value);return this.#update(m,current=>({...current,positionLookup:next}));}
}
