import {createHash} from 'node:crypto';
import {isOffCurveAddress} from '@solana/kit';
import {asBytes} from '../../protocol-core/src/index.mjs';
import {baseConfigR2Id,PROGRAMS} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes,decodeNativeFrame} from './native.mjs';
import {validateV1Resources} from './transaction.mjs';
import {restoreSynthesisManifest,publicSynthesisWorkflow} from './synthesis-manifest.mjs';
import {planDelegatedSynthesisCompetition} from './synthesis-workflow.mjs';
import {FileJournalStore} from './file-journal.mjs';

const MAX=(1n<<64n)-1n,MAX_TEXT=600000,MAX_REQUEST=650000,contexts=new WeakMap(),safeErrors=new WeakSet();
const failure=code=>{const error=Object.assign(new Error(code),{code});safeErrors.add(error);return error;};
const check=(v,c)=>{if(!v)throw failure(c);};
const fields=(v,required,optional=[])=>check(v&&Object.getPrototypeOf(v)===Object.prototype&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)),'RESEARCH_MANIFEST_FIELDS');
const hex=b=>Buffer.from(b).toString('hex');
const id=v=>{check(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),'RESEARCH_MANIFEST_ID');return v;};
const u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'RESEARCH_MANIFEST_U64');return n;};
const dec=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&s.length<=20,'RESEARCH_MANIFEST_DECIMAL');return u64(BigInt(s));};
const digest=text=>createHash('sha256').update('BIORESEARCH-MANIFEST1\0').update(text).digest('hex');
const sanitize=(error,fallback='RESEARCH_PRIVATE_OPERATION_FAILED')=>failure(safeErrors.has(error)?error.code:['FILE_CAS_GATE_BUSY','FILE_CAS_LOCK_BUSY'].includes(error?.code)?error.code:fallback);
const privateWork=async work=>{try{return await work();}catch(error){throw sanitize(error);}};
const parse=text=>{try{return JSON.parse(text);}catch{check(false,'RESEARCH_PRIVATE_ENCODING');}};
function resourceRecord(value){
  fields(value,['computeUnitLimit','loadedAccountsDataSizeLimit','priorityFeeLamports'],['heapSize']);
  const r=validateV1Resources(value);return {computeUnitLimit:r.computeUnitLimit,loadedAccountsDataSizeLimit:r.loadedAccountsDataSizeLimit,heapSize:r.heapSize,priorityFeeLamports:r.priorityFeeLamports.toString()};
}
function resourceValues(value){fields(value,['computeUnitLimit','loadedAccountsDataSizeLimit','heapSize','priorityFeeLamports']);return {...value,priorityFeeLamports:dec(value.priorityFeeLamports)};}
function binding(release,abi,author){
  check(abi?.hash===release.hashes.abiHash.toString('hex'),'RESEARCH_MANIFEST_ABI');const key=nativeKeyAddress(author);
  check(key!==PROGRAMS.systemProgram&&!isOffCurveAddress(key),'RESEARCH_AUTHOR_WALLET');
  return {releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:hex(release.domain),configHex:hex(baseConfigR2Id(release)),author:key};
}
function context(m){const c=contexts.get(m);check(c&&m.workflowId===c.workflowId&&m.text===c.text,'RESEARCH_MANIFEST_OBJECT');return c;}
function caps(base,{maxRent,maxUploadRent,maxFee,resources}){
  u64(maxRent);u64(maxUploadRent);u64(maxFee);const record=resourceRecord(resources);
  check(base.plan.target===22&&base.challengePpm===2000000,'RESEARCH_BIO_CHALLENGE');
  check(base.maxRent===maxRent&&base.maxUploadRent===maxUploadRent&&base.maxFee===maxFee&&JSON.stringify(resourceRecord(base.resources))===JSON.stringify(record),'RESEARCH_BASE_CAPS');
  return record;
}
async function reconstruct({release,abi,author,cranker,baseManifest,commitNonce,round,salt,expectedGeneration,maxRent,maxUploadRent,maxFee,resources}){
  const head=binding(release,abi,author),crank=nativeKeyAddress(cranker);check(crank!==head.author&&crank!==PROGRAMS.systemProgram&&!isOffCurveAddress(crank),'RESEARCH_DISTINCT_CRANKER');
  const n=u64(commitNonce),r=u64(round),generation=u64(expectedGeneration),secret=Buffer.from(asBytes(salt,32));check(n<MAX&&generation<MAX,'RESEARCH_COUNTER_EXHAUSTED');
  const base=await restoreSynthesisManifest({release,abi,actor:head.author,workflowId:baseManifest.workflowId,text:baseManifest.text}),record=caps(base,{maxRent,maxUploadRent,maxFee,resources});
  const workflow=await planDelegatedSynthesisCompetition({release,abi,plan:base.plan,cranker:crank,commitNonce:n,round:r,salt:secret,expectedGeneration:generation,challengePpm:2000000,maxRent,maxUploadRent});
  return {head,cranker:crank,baseManifest:base,workflow,commitNonce:n,round:r,salt:secret,expectedGeneration:generation,maxRent,maxUploadRent,maxFee,resources:record};
}
function valueOf(c){
  return {version:'BIORESEARCH-MANIFEST1',...c.head,cranker:c.cranker,baseWorkflowId:c.baseManifest.workflowId,baseManifestText:c.baseManifest.text,
    commitNonce:c.commitNonce.toString(),round:c.round.toString(),saltHex:hex(c.salt),expectedGeneration:c.expectedGeneration.toString(),futureManufactureNonce:c.workflow.futureManufactureNonce.toString(),chunkCount:c.workflow.chunkCount,
    commitIdHex:hex(c.workflow.commit.commitId),commitmentHex:hex(c.workflow.commit.commitment),commitFrameHex:hex(c.workflow.commit.frame),maxRent:c.maxRent.toString(),maxUploadRent:c.maxUploadRent.toString(),maxFee:c.maxFee.toString(),resources:c.resources};
}
function branded(c,text,workflowId,release,abi){
  const m=Object.freeze({workflowId,text,author:c.head.author,cranker:c.cranker,baseManifest:c.baseManifest,workflow:c.workflow,commitNonce:c.commitNonce,round:c.round,salt:Buffer.from(c.salt),expectedGeneration:c.expectedGeneration,maxRent:c.maxRent,maxUploadRent:c.maxUploadRent,maxFee:c.maxFee,resources:Object.freeze(resourceValues(c.resources))});
  contexts.set(m,{...c,workflowId,text,release,abi,salt:Buffer.from(c.salt),artifactId:Buffer.from(c.baseManifest.plan.artifactId),artifactSHA:Buffer.from(c.baseManifest.plan.artifactSHA),artifactBytes:c.baseManifest.plan.bytes.length,commitId:Buffer.from(c.workflow.commit.commitId),futureManufactureNonce:c.workflow.futureManufactureNonce});return m;
}
/** Private bytes only; the creator chooses a CSPRNG salt inside createRequest's
 * build callback. Neither creating nor restoring reserves an author nonce. */
export async function createResearchManifest(args){return privateWork(async()=>{
  fields(args,['release','abi','author','cranker','baseManifest','commitNonce','round','salt','expectedGeneration','maxRent','maxUploadRent','maxFee','resources'],['commitment']);
  const expected=args.commitment===undefined?undefined:Buffer.from(asBytes(args.commitment,32));
  const copied={...args,salt:Buffer.from(asBytes(args.salt,32)),resources:{...args.resources},baseManifest:{workflowId:args.baseManifest?.workflowId,text:args.baseManifest?.text}};
  const c=await reconstruct(copied);if(expected!==undefined)check(c.workflow.commit.commitment.equals(expected),'RESEARCH_COMMITMENT_MISMATCH');
  const text=JSON.stringify(valueOf(c));check(Buffer.byteLength(text)<=MAX_TEXT,'RESEARCH_MANIFEST_SIZE');return branded(c,text,digest(text),args.release,args.abi);
});}
export async function restoreResearchManifest(args){return privateWork(async()=>{
  fields(args,['release','abi','author','workflowId','text']);const {release,abi,author,workflowId,text}=args;id(workflowId);
  check(typeof text==='string'&&Buffer.byteLength(text)<=MAX_TEXT&&digest(text)===workflowId,'RESEARCH_MANIFEST_HASH');const v=parse(text),head=binding(release,abi,author);
  fields(v,['version',...Object.keys(head),'cranker','baseWorkflowId','baseManifestText','commitNonce','round','saltHex','expectedGeneration','futureManufactureNonce','chunkCount','commitIdHex','commitmentHex','commitFrameHex','maxRent','maxUploadRent','maxFee','resources']);
  check(v.version==='BIORESEARCH-MANIFEST1'&&Object.entries(head).every(([k,value])=>v[k]===value),'RESEARCH_MANIFEST_CONTEXT');
  id(v.baseWorkflowId);id(v.saltHex);id(v.commitIdHex);id(v.commitmentHex);
  check(typeof v.baseManifestText==='string'&&Buffer.byteLength(v.baseManifestText)<=540672&&typeof v.commitFrameHex==='string'&&/^(?:[0-9a-f]{2})+$/.test(v.commitFrameHex)&&v.commitFrameHex.length<=8192&&Number.isInteger(v.chunkCount)&&v.chunkCount>=1&&v.chunkCount<=256,'RESEARCH_MANIFEST_PRIVATE_FIELDS');
  const c=await reconstruct({release,abi,author,cranker:v.cranker,baseManifest:{workflowId:v.baseWorkflowId,text:v.baseManifestText},commitNonce:dec(v.commitNonce),round:dec(v.round),salt:Buffer.from(v.saltHex,'hex'),expectedGeneration:dec(v.expectedGeneration),maxRent:dec(v.maxRent),maxUploadRent:dec(v.maxUploadRent),maxFee:dec(v.maxFee),resources:resourceValues(v.resources)});
  check(JSON.stringify(valueOf(c))===text,'RESEARCH_MANIFEST_CANONICAL');return branded(c,text,workflowId,release,abi);
});}
/** Before COMMIT confirmation this deliberate allowlist contains no design or
 * Artifact identifier. Even after explicit reveal, salt stays private here. */
export function publicResearchWorkflow(m,options={}){
  fields(options,[],['reveal']);check(options.reveal===undefined||typeof options.reveal==='boolean','RESEARCH_REVEAL_FLAG');const c=context(m);
  return {workflowId:c.workflowId,author:c.head.author,cranker:c.cranker,round:c.round.toString(),commitNonce:c.commitNonce.toString(),futureManufactureNonce:c.futureManufactureNonce.toString(),chunkCount:c.workflow.chunkCount,
    maxRent:c.maxRent.toString(),maxUploadRent:c.maxUploadRent.toString(),maxFee:c.maxFee.toString(),resources:{...c.resources},...(options.reveal===true?{synthesis:publicSynthesisWorkflow(c.baseManifest)}:{})};
}
function checkedFinal(c,frameHex){
  check(typeof frameHex==='string'&&frameHex.length>0&&frameHex.length<=8192&&/^(?:[0-9a-f]{2})+$/.test(frameHex),'RESEARCH_HINT_FRAME');const frame=decodeNativeFrame(c.abi,Buffer.from(frameHex,'hex')),p=frame.payload;
  check(frame.operation==='SYNTH_FINALIZE'&&p.length===189&&p[124]===1&&frame.domain.equals(c.release.domain)&&frame.configId.equals(baseConfigR2Id(c.release))&&frame.actor.equals(nativeKeyBytes(c.head.author)),'RESEARCH_HINT_CONTEXT');
  check(frame.nonce===c.futureManufactureNonce&&p.subarray(0,32).equals(c.artifactId)&&p.subarray(32,64).equals(c.artifactSHA)&&p.readUInt32LE(64)===c.artifactBytes&&p.readBigUInt64LE(68)===c.expectedGeneration+1n&&p.readBigUInt64LE(108)===c.maxFee&&p.readBigUInt64LE(116)===c.maxRent&&p.subarray(125,157).equals(c.commitId)&&p.subarray(157,189).equals(c.salt),'RESEARCH_HINT_BINDING');return frame;
}
function hints(c,text){
  if(text===null)return {finalFrameHex:null};check(typeof text==='string'&&Buffer.byteLength(text)<=12288,'RESEARCH_HINT_SIZE');const v=parse(text);fields(v,['version','workflowId','finalFrameHex']);
  check(v.version==='BIORESEARCH-HINTS1'&&v.workflowId===c.workflowId,'RESEARCH_HINT_CONTEXT');if(v.finalFrameHex!==null)checkedFinal(c,v.finalFrameHex);check(JSON.stringify({version:v.version,workflowId:v.workflowId,finalFrameHex:v.finalFrameHex})===text,'RESEARCH_HINT_CANONICAL');return {finalFrameHex:v.finalFrameHex};
}
function positionLookup(value){
  if(value===null)return null;fields(value,['activationIdHex','rootInstanceHex','positionIdHex','nextStart','ordinaryCount']);
  for(const k of ['activationIdHex','rootInstanceHex','positionIdHex'])id(value[k]);const count=dec(value.ordinaryCount),next=value.nextStart===null?null:dec(value.nextStart);check(count>0n&&(next===null||next<count),'RESEARCH_LOOKUP_CURSOR');
  return {activationIdHex:value.activationIdHex,rootInstanceHex:value.rootInstanceHex,positionIdHex:value.positionIdHex,nextStart:next===null?null:next.toString(),ordinaryCount:count.toString()};
}
function lookupRecord(c,text){
  if(text===null)return null;check(typeof text==='string'&&Buffer.byteLength(text)<=2048,'RESEARCH_LOOKUP_SIZE');const v=parse(text);fields(v,['version','workflowId','positionLookup']);check(v.version==='BIORESEARCH-POSITION-LOOKUP1'&&v.workflowId===c.workflowId,'RESEARCH_LOOKUP_CONTEXT');const lookup=positionLookup(v.positionLookup);check(JSON.stringify({version:v.version,workflowId:v.workflowId,positionLookup:lookup})===text,'RESEARCH_LOOKUP_CANONICAL');return lookup;
}
function requestRecord(raw,head,requestId,requestDigest){
  check(typeof raw==='string'&&Buffer.byteLength(raw)<=MAX_REQUEST,'RESEARCH_REQUEST_SIZE');const v=parse(raw);fields(v,['version',...Object.keys(head),'requestId','requestDigest','workflowId','manifestText']);
  check(v.version==='BIORESEARCH-REQUEST1'&&Object.entries(head).every(([k,value])=>v[k]===value)&&v.requestId===requestId,'RESEARCH_REQUEST_CONTEXT');
  check(v.requestDigest===requestDigest,'RESEARCH_REQUEST_DIGEST_CONFLICT');id(v.workflowId);check(typeof v.manifestText==='string'&&Buffer.byteLength(v.manifestText)<=MAX_TEXT,'RESEARCH_REQUEST_PRIVATE_FIELDS');
  check(JSON.stringify({version:v.version,...head,requestId,requestDigest,workflowId:v.workflowId,manifestText:v.manifestText})===raw,'RESEARCH_REQUEST_CANONICAL');return v;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class ResearchWorkflowStore{
  #directory;
  constructor({directory}){this.#directory=directory;}
  async #store(workflowId,kind='manifest'){id(workflowId);return FileJournalStore.open({directory:this.#directory,name:`research-${workflowId}${kind==='hints'?'-hints':kind==='request'?'-request':kind==='lookup'?'-lookup':''}.json`});}
  async save(m){return privateWork(async()=>{
    const c=context(m),store=await this.#store(c.workflowId),old=await store.load();if(old.payload!==null){check(old.payload===c.text,'RESEARCH_MANIFEST_CONFLICT');return {saved:true,alreadySaved:true};}
    const saved=await store.compareAndSwap(old.revision,c.text);if(saved===false)check((await store.load()).payload===c.text,'RESEARCH_MANIFEST_CONFLICT');return {saved:true,alreadySaved:saved===false};
  });}
  async load({release,abi,author,workflowId}){return privateWork(async()=>{const value=await(await this.#store(workflowId)).load();check(value.payload!==null,'RESEARCH_MANIFEST_NOT_FOUND');return restoreResearchManifest({release,abi,author,workflowId,text:value.payload});});}
  async loadHints(m){return privateWork(async()=>{const c=context(m),value=await(await this.#store(c.workflowId,'hints')).load();return hints(c,value.payload);});}
  async loadPositionLookup(m){return privateWork(async()=>{const c=context(m),value=await(await this.#store(c.workflowId,'lookup')).load();return lookupRecord(c,value.payload);});}
  async savePositionLookup(m,value){return privateWork(async()=>{
    const c=context(m),lookup=positionLookup(value);check((await(await this.#store(c.workflowId)).load()).payload===c.text,'RESEARCH_MANIFEST_NOT_SAVED');const store=await this.#store(c.workflowId,'lookup'),text=JSON.stringify({version:'BIORESEARCH-POSITION-LOOKUP1',workflowId:c.workflowId,positionLookup:lookup});
    for(let attempt=0;attempt<16;attempt++){
      const old=await store.load();lookupRecord(c,old.payload);if(old.payload===text)return {saved:true,alreadySaved:true};let saved;try{saved=await store.compareAndSwap(old.revision,text);}catch(error){if(!['FILE_CAS_GATE_BUSY','FILE_CAS_LOCK_BUSY'].includes(error?.code))throw error;await delay(2+Math.min(attempt,10));continue;}if(saved!==false)return {saved:true,alreadySaved:false};
    }check(false,'RESEARCH_LOOKUP_CAS_RETRY');
  });}
  async recordFinalAttempt(m,action){return privateWork(async()=>{
    const c=context(m),frameHex=hex(asBytes(action?.frame)),frame=checkedFinal(c,frameHex);if(action.nonce!==undefined)check(u64(action.nonce)===frame.nonce,'RESEARCH_HINT_ACTION');if(action.operation!==undefined)check(action.operation===frame.operation,'RESEARCH_HINT_ACTION');
    check((await(await this.#store(c.workflowId)).load()).payload===c.text,'RESEARCH_MANIFEST_NOT_SAVED');const store=await this.#store(c.workflowId,'hints');
    for(let attempt=0;attempt<8;attempt++){
      const old=await store.load(),previous=hints(c,old.payload);if(previous.finalFrameHex!==null){check(previous.finalFrameHex===frameHex,'RESEARCH_HINT_NONCE_CONFLICT');return {saved:true,alreadySaved:true};}
      const text=JSON.stringify({version:'BIORESEARCH-HINTS1',workflowId:c.workflowId,finalFrameHex:frameHex});if(await store.compareAndSwap(old.revision,text)!==false)return {saved:true,alreadySaved:false};
    }
    check(false,'RESEARCH_HINT_CAS_RETRY');
  });}
  /** The first protected request CAS fixes the private result. Only that winner
   * is indexed; a retry repairs the index after a crash between the two writes. */
  async createRequest(args){return privateWork(async()=>{
    fields(args,['release','abi','author','requestId','requestDigest','build']);const {release,abi,author,requestId,requestDigest,build}=args,head=binding(release,abi,author);id(requestId);id(requestDigest);check(typeof build==='function','RESEARCH_REQUEST_BUILD');
    const store=await this.#store(requestId,'request');let built=null;
    const saveWinner=async m=>{
      for(let attempt=0;attempt<32;attempt++)try{await this.save(m);return;}catch(error){if(!['FILE_CAS_GATE_BUSY','FILE_CAS_LOCK_BUSY'].includes(error?.code))throw error;await delay(2+Math.min(attempt,10));}
      check(false,'RESEARCH_REQUEST_BUSY');
    };
    const restoreWinner=async raw=>{const v=requestRecord(raw,head,requestId,requestDigest),m=await restoreResearchManifest({release,abi,author,workflowId:v.workflowId,text:v.manifestText});await saveWinner(m);return m;};
    for(let attempt=0;attempt<32;attempt++){
      const old=await store.load();if(old.payload!==null)return {manifest:await restoreWinner(old.payload),alreadySaved:true};
      if(built===null){
        try{built=await build();}catch(error){throw sanitize(error,'RESEARCH_REQUEST_BUILD_FAILED');}
        const c=context(built);check(Object.entries(head).every(([k,value])=>c.head[k]===value),'RESEARCH_REQUEST_BUILD_CONTEXT');
      }
      const c=context(built),text=JSON.stringify({version:'BIORESEARCH-REQUEST1',...head,requestId,requestDigest,workflowId:c.workflowId,manifestText:c.text});check(Buffer.byteLength(text)<=MAX_REQUEST,'RESEARCH_REQUEST_SIZE');
      let saved;try{saved=await store.compareAndSwap(old.revision,text);}catch(error){if(!['FILE_CAS_GATE_BUSY','FILE_CAS_LOCK_BUSY'].includes(error?.code))throw error;await delay(2+Math.min(attempt,10));continue;}
      if(saved!==false){await saveWinner(built);return {manifest:built,alreadySaved:false};}
    }
    check(false,'RESEARCH_REQUEST_BUSY');
  });}
}
