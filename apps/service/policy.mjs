import path from 'node:path';
import { isOffCurveAddress } from '@solana/kit';
import { baseConfigR2Id, PROGRAMS } from '../../packages/client/src/release.mjs';
import { nativeKeyAddress, nativeOperation } from '../../packages/client/src/native.mjs';
import { validateReadOnlyRpcEndpoint } from '../../packages/client/src/rpc.mjs';
import { validateV1Resources } from '../../packages/client/src/transaction.mjs';

export const GLOBAL_OPS=Object.freeze(['SYNC_EMISSION','OPEN_HOUR','APPLY_EVENT','EMPTY_SKIP','ADVANCE_FROZEN_HOUR','MATERIALIZE_HOUR']);
const ownedErrors=new WeakSet();
export const check=(v,c)=>{if(!v){const e=Object.assign(new Error(c),{code:c});ownedErrors.add(e);throw e;}};
export const dec=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&s.length<=20&&BigInt(s)<=(1n<<64n)-1n,'SERVICE_DECIMAL');return BigInt(s);};
export const exact=(v,fields)=>check(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...fields].sort().join(','),'SERVICE_FIELDS');
const publicCodes=new Set(['SERVICE_SIGNER_TIMEOUT','FILE_CAS_GATE_BUSY','FILE_CAS_LOCK_BUSY','SESSION_BLOCKHASH_INVALID','SESSION_BLOCKHASH_EXPIRED','SESSION_RPC_ERROR','RPC_ERROR','RPC_GENESIS_MISMATCH','RPC_HTTP_STATUS','RPC_CONTEXT_REGRESSION','JOURNAL_NONCE_CONFLICT','JOURNAL_STORAGE_CAS']);
export const publicError=e=>ownedErrors.has(e)||publicCodes.has(e?.code)?e.code:'SERVICE_OPERATION_FAILED';
const actor=v=>{const a=nativeKeyAddress(v);check(a!==PROGRAMS.systemProgram&&!isOffCurveAddress(a),'SERVICE_ACTOR');return a;};
const absolute=v=>{check(typeof v==='string'&&path.isAbsolute(v),'SERVICE_ABSOLUTE_PATH');return path.resolve(v);};
export function servicePolicy({release,abi,config}){
  exact(config,['version','releaseHash','abiHash','domainHex','configHex','stateDirectory','endpoint','sendEnabled','globalActor','researchJobs','maxRent','resources','limits','poll']);
  check(config.version==='BIOLAB-SERVICE1'&&config.releaseHash===release.input.releaseHash&&config.abiHash===abi.hash&&config.domainHex===release.domain.toString('hex')&&config.configHex===baseConfigR2Id(release).toString('hex'),'SERVICE_RELEASE_BINDING');
  nativeOperation(abi,'VERIFY_STEP');check(typeof config.sendEnabled==='boolean','SERVICE_SEND_FLAG');const stateDirectory=absolute(config.stateDirectory),endpoint=config.endpoint===null?null:validateReadOnlyRpcEndpoint(config.endpoint,{allowLocalhost:release.localPublicFixture});
  if(release.localPublicFixture&&endpoint)check(['localhost','127.0.0.1','[::1]'].includes(new URL(endpoint).hostname),'SERVICE_FIXTURE_LOOPBACK_ONLY');
  const globalActor=config.globalActor===null?null:actor(config.globalActor);check(Array.isArray(config.researchJobs)&&config.researchJobs.length<=8,'SERVICE_JOB_BOUND');
  const jobs=config.researchJobs.map(j=>{exact(j,['name','author','cranker','workflowId','manifestDirectory','authorJournalDirectory','delegated']);check(typeof j.name==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(j.name)&&j.delegated===true&&typeof j.workflowId==='string'&&/^[0-9a-f]{64}$/.test(j.workflowId),'SERVICE_JOB');const author=actor(j.author),cranker=actor(j.cranker);check(author!==cranker,'SERVICE_AUTHOR_CRANKER');return {...j,author,cranker,manifestDirectory:absolute(j.manifestDirectory),authorJournalDirectory:absolute(j.authorJournalDirectory)};});
  const actors=[...(globalActor?[globalActor]:[]),...jobs.map(j=>j.cranker)];check(new Set(actors).size===actors.length&&new Set(jobs.map(j=>j.name)).size===jobs.length&&jobs.every(j=>j.name!=='global'&&!actors.includes(j.author)),'SERVICE_ACTOR_ROLE_ALIAS');
  exact(config.resources,['computeUnitLimit','loadedAccountsDataSizeLimit','heapSize','priorityFeeLamports']);const resources=validateV1Resources({...config.resources,priorityFeeLamports:dec(config.resources.priorityFeeLamports)}),maxRent=dec(config.maxRent);
  exact(config.limits,['stepFee','stepRent','stepTotal','dayFee','dayRent','dayTotal','lifetimeFee','lifetimeRent','lifetimeTotal','minimumBalance','maxRefreshes','maxQuoteAgeSlots']);const limits={};for(const [k,v]of Object.entries(config.limits))limits[k]=['maxRefreshes','maxQuoteAgeSlots'].includes(k)?v:dec(v);
  check(Number.isInteger(limits.maxRefreshes)&&limits.maxRefreshes>=0&&limits.maxRefreshes<=8&&Number.isInteger(limits.maxQuoteAgeSlots)&&limits.maxQuoteAgeSlots>=0&&limits.maxQuoteAgeSlots<=32,'SERVICE_LIMIT_BOUND');check(maxRent<=limits.stepRent,'SERVICE_RENT_POLICY');
  exact(config.poll,['minMs','maxMs','maxTicks','maxDurationMs']);const poll={...config.poll};check(Number.isInteger(poll.minMs)&&poll.minMs>=10&&Number.isInteger(poll.maxMs)&&poll.maxMs>=poll.minMs&&poll.maxMs<=60000&&Number.isInteger(poll.maxTicks)&&poll.maxTicks>=1&&poll.maxTicks<=10000&&Number.isInteger(poll.maxDurationMs)&&poll.maxDurationMs>=1&&poll.maxDurationMs<=86400000,'SERVICE_POLL_BOUND');
  return {stateDirectory,endpoint,globalActor,jobs,resources,maxRent,limits,poll,sendEnabled:config.sendEnabled,config:structuredClone(config)};
}
