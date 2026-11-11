import {createHash} from 'node:crypto';
import {isOffCurveAddress} from '@solana/kit';
import {nativeKeyAddress} from './native.mjs';
import {baseConfigR2Id,PROGRAMS} from './release.mjs';

export const DISCOVERY_SECTIONS=Object.freeze(['projects','my-projects','roots','sources','positions','material-atas','token-owner-hints']);
export const DISCOVERY_LIMITS=Object.freeze({rows:8,leafRows:256,responseBytes:65536,scanCalls:4,factCalls:3,rpcTimeoutMs:2000,pageDeadlineMs:18000,scanDeadlineMs:9000,ttlMs:1800000,activePerActor:4,retainedScans:128,scanBytes:262144,storeBytes:8*1024*1024});
export const ISSUE_CODES=Object.freeze(['DISCOVERY_RPC_UNAVAILABLE','DISCOVERY_RPC_TIMEOUT','DISCOVERY_RPC_OVERFLOW','DISCOVERY_RPC_INVALID_RESPONSE','DISCOVERY_GENESIS_MISMATCH','DISCOVERY_BASE_MISMATCH','DISCOVERY_RECORD_CHANGED','DISCOVERY_RECORD_INVALID','DISCOVERY_CURSOR_INVALID','DISCOVERY_CURSOR_EXPIRED','DISCOVERY_CACHE_LIMIT','DISCOVERY_DEADLINE','DISCOVERY_TOKEN_OWNER_OVERFLOW','DISCOVERY_INTERNAL']);
const requestCodes=['DISCOVERY_REQUEST_FIELDS','DISCOVERY_REQUEST_ACTOR','DISCOVERY_REQUEST_SECTION','DISCOVERY_REQUEST_CURSOR','DISCOVERY_REQUEST_QUERY'];
const ownErrors=new WeakSet(),codes=new Set([...ISSUE_CODES,...requestCodes]);
export function failure(code){const error=Object.assign(new Error(codes.has(code)?code:'DISCOVERY_INTERNAL'),{code:codes.has(code)?code:'DISCOVERY_INTERNAL'});ownErrors.add(error);return error;}
export function requireDiscovery(value,code='DISCOVERY_INTERNAL'){if(!value)throw failure(code);}
export function publicIssue(error,fallback='DISCOVERY_INTERNAL'){return ownErrors.has(error)&&codes.has(error.code)?error.code:fallback;}
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export function exact(v,keys,code='DISCOVERY_INTERNAL'){requireDiscovery(plain(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(','),code);}
export const hex32=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=20&&BigInt(v)<(1n<<64n);
export const digest=v=>createHash('sha256').update(v).digest('hex');
export function validateDiscoveryRequest(value){
  exact(value,['actor','section','cursor','query'],'DISCOVERY_REQUEST_FIELDS');
  let actor;try{requireDiscovery(typeof value.actor==='string','DISCOVERY_REQUEST_ACTOR');actor=nativeKeyAddress(value.actor);requireDiscovery(actor===value.actor&&actor!==PROGRAMS.systemProgram&&!isOffCurveAddress(actor),'DISCOVERY_REQUEST_ACTOR');}catch{throw failure('DISCOVERY_REQUEST_ACTOR');}
  requireDiscovery(DISCOVERY_SECTIONS.includes(value.section),'DISCOVERY_REQUEST_SECTION');requireDiscovery(value.cursor===null||hex32(value.cursor),'DISCOVERY_REQUEST_CURSOR');
  const q=value.query;requireDiscovery(typeof q==='string'&&Buffer.byteLength(q)<=128&&Buffer.from(q,'utf8').toString('utf8')===q&&!/[\u0000-\u001f\u007f]/u.test(q),'DISCOVERY_REQUEST_QUERY');
  requireDiscovery(['projects','my-projects'].includes(value.section)||q==='','DISCOVERY_REQUEST_QUERY');
  const query=q.normalize('NFC').trim();requireDiscovery(Buffer.byteLength(query)<=128,'DISCOVERY_REQUEST_QUERY');return Object.freeze({actor,section:value.section,cursor:value.cursor,query});
}
export function discoveryBinding(release,endpoint){
  try{
    const context={releaseHash:release.input.releaseHash,abiHash:Buffer.from(release.hashes.abiHash).toString('hex'),domainHex:Buffer.from(release.domain).toString('hex'),configHex:baseConfigR2Id(release).toString('hex')};
    requireDiscovery(Object.values(context).every(hex32)&&typeof release.input.programId==='string','DISCOVERY_BASE_MISMATCH');
    return Object.freeze({...context,programId:nativeKeyAddress(release.input.programId),genesisHex:Buffer.from(release.hashes.genesisHash).toString('hex'),endpointSHA:digest(endpoint),queryVersion:1});
  }catch(error){throw failure(publicIssue(error,'DISCOVERY_BASE_MISMATCH'));}
}
export function publicContext(binding){return Object.fromEntries(['releaseHash','abiHash','domainHex','configHex'].map(k=>[k,binding[k]]));}
export const sameBinding=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const sublanes=section=>section==='roots'?[1,2,3,4]:[0];
export function freshTraversal(){return {lane:0,prefix:'',parents:[]};}
export function completeScan(scan){return scan.traversal.lane>=sublanes(scan.section).length&&scan.pending.length===0;}
export function advancePrefix(scan){
  const t=scan.traversal;
  while(t.parents.length){const p=t.parents.at(-1);if(p.next<256){t.prefix=p.prefix+p.next.toString(16).padStart(2,'0');p.next++;return;}t.parents.pop();}
  t.lane++;t.prefix='';
}
export function splitPrefix(scan){const t=scan.traversal;requireDiscovery(t.prefix.length<64,'DISCOVERY_RPC_INVALID_RESPONSE');t.parents.push({prefix:t.prefix,next:1});t.prefix+='00';}
export function matchProject(project,id,query){return query===''||project.name.normalize('NFC').toLowerCase().includes(query.toLowerCase())||id.toLowerCase()===query.toLowerCase()||nativeKeyAddress(project.creator)===query;}
export function observe(scan,slot){
  requireDiscovery(typeof slot==='bigint'&&slot>=0n&&slot<(1n<<64n),'DISCOVERY_RPC_INVALID_RESPONSE');
  if(scan.maxSlot!==null)requireDiscovery(slot>=BigInt(scan.maxSlot),'DISCOVERY_RPC_INVALID_RESPONSE');
  if(scan.minSlot===null)scan.minSlot=String(slot);scan.maxSlot=String(slot);
}
export function responseFor(binding,request,scan,{rows=[],issue=null,decision='DISCOVERY_PAGE',state}={}){
  const pending=!completeScan(scan);return {profile:'BIO-DISCOVERY1',decision,actor:request.actor,section:request.section,context:publicContext(binding),rows,nextCursor:pending?scan.cursor:null,
    coverage:{state:state??(pending?'IN_PROGRESS':scan.changed>0?'CHANGED':'TRAVERSAL_EXHAUSTED'),commitment:'finalized',consistency:'MULTI_SLOT_BEST_EFFORT',minObservedSlot:scan.minSlot,maxObservedSlot:scan.maxSlot,prefixesVisited:scan.visited,pending,cryptographicComplete:false,fullWallet:false},
    issues:issue?[{code:ISSUE_CODES.includes(issue)?issue:'DISCOVERY_INTERNAL'}]:[],readFlags:{transactionExecuted:false,networkSubmitted:false,reservesOnChainNonce:false,discoveryOnly:true,actionEligibilityVerified:false}};
}
