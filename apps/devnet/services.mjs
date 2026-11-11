import path from 'node:path';
import {createHash} from 'node:crypto';
import {isOffCurveAddress} from '@solana/kit';
import {isDevnetRelease} from '../../packages/client/src/cluster.mjs';
import {baseConfigR2Id,PROGRAMS} from '../../packages/client/src/release.mjs';
import {nativeKeyAddress,nativeKeyBytes} from '../../packages/client/src/native.mjs';
import {ReadOnlyRpc} from '../../packages/client/src/rpc.mjs';
import {FileJournalStore} from '../../packages/client/src/file-journal.mjs';
import {inspectDevnetReadiness} from '../../packages/client/src/devnet-readiness.mjs';
import {acquireServiceLease} from '../service/lease.mjs';
import {openServiceSupervisor} from '../service/supervisor.mjs';
import {createDevnetServiceAdapters,readDevnetServiceManifest} from './service-adapter.mjs';
import {DevnetRpc,DEVNET_RPC} from './rpc.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},digest=v=>createHash('sha256').update(v).digest('hex'),HEX=/^[0-9a-f]{64}$/;
const safe=e=>typeof e?.code==='string'&&/^(?:SERVICE|DEVNET|RPC)_[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'DEVNET_SERVICE_DEPENDENCY';
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'},MAX_JOBS=8,INTERVAL=10000;
const terminal=new Set(['OUTPUT_READ','WORKFLOW_COMPLETE','COMPLETE','RESEARCH_COMPLETE','EXPIRED','REJECTED','FAILED','CANCELLED']);
const actor=v=>{const a=nativeKeyAddress(v);check(a!==PROGRAMS.systemProgram&&!isOffCurveAddress(a),'DEVNET_SERVICE_ACTOR');return a;};
/** Only trusted runtime directories enter here; the HTTP request supplies three
 * identifiers and can never select key, journal, config or graph paths. */
export async function createDevnetServices({release,abi,endpoint=DEVNET_RPC,fetchImpl=globalThis.fetch,stateDirectory,businessDirectory,keyDirectory}={}){
 check(isDevnetRelease(release)&&abi?.hash===release.input.abiHash,'DEVNET_SERVICE_RELEASE');check(typeof fetchImpl==='function','DEVNET_SERVICE_TRANSPORT');for(const value of [stateDirectory,businessDirectory,keyDirectory])check(typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value,'DEVNET_SERVICE_DIRECTORY');
 const abort=new AbortController(),transport=(url,init)=>fetchImpl(url,{...init,signal:AbortSignal.any([abort.signal,...(init?.signal?[init.signal]:[])])}),probe=new DevnetRpc({endpoint,fetchImpl:transport,allowTransactions:false}),target=probe.endpoint;
 const context={releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex')},namespace=digest(JSON.stringify(context)),binding=digest(JSON.stringify({...context,endpoint:target}));
 const bootstrap=await createDevnetServiceAdapters({release,abi,keyDirectory,keyFiles:['ops-2.json','ops-1.json'],endpoint:target,fetchImpl:transport,globalActor:null}),[globalActor,cranker]=bootstrap.signer.actors;
 check(globalActor&&cranker&&globalActor!==cranker,'DEVNET_SERVICE_ROLE_KEYS');const lease=await acquireServiceLease(stateDirectory);
 try{
 const queueStore=await FileJournalStore.open({directory:stateDirectory,name:'queue.json'}),loaded=await queueStore.load();let revision=loaded.revision,data=loaded.payload===null?{version:'BIO-DEVNET-SERVICES1',binding,jobs:[],rotation:0,activeWorkflowId:null}:JSON.parse(loaded.payload);
 check(data&&Object.keys(data).sort().join(',')==='activeWorkflowId,binding,jobs,rotation,version'&&data.version==='BIO-DEVNET-SERVICES1'&&data.binding===binding&&Array.isArray(data.jobs)&&data.jobs.length<=MAX_JOBS&&Number.isSafeInteger(data.rotation)&&data.rotation>=0,'DEVNET_SERVICE_QUEUE');
 for(const j of data.jobs)check(j&&Object.keys(j).sort().join(',')==='author,cranker,errorCode,state,workflowId'&&actor(j.author)!==globalActor&&j.cranker===cranker&&j.author!==j.cranker&&HEX.test(j.workflowId)&&typeof j.state==='string'&&j.state.length<=80&&(j.errorCode===null||typeof j.errorCode==='string'&&j.errorCode.length<=100),'DEVNET_SERVICE_QUEUE');
 check(data.activeWorkflowId===null||HEX.test(data.activeWorkflowId)&&data.jobs.some(j=>j.workflowId===data.activeWorkflowId),'DEVNET_SERVICE_QUEUE');
 check(new Set(data.jobs.map(j=>j.workflowId)).size===data.jobs.length,'DEVNET_SERVICE_QUEUE');
 let started=false,closed=false,timer=null,serial=Promise.resolve(),running=false,lastTickAt=null,lastError=null,readiness=null,globalState='NOT_STARTED',global=null,activeResearch=null;const supervisors=new Set();
 const persist=async()=>{await lease.assert();const next=await queueStore.compareAndSwap(revision,JSON.stringify(data));check(next!==false,'DEVNET_SERVICE_QUEUE_CAS');revision=next;};
 if(loaded.payload===null)await persist();
 const inOrder=work=>{const next=serial.then(work);serial=next.catch(()=>{});return next;};
 const paths=author=>{const root=path.join(businessDirectory,namespace,nativeKeyBytes(author).toString('hex'));return{manifestDirectory:path.join(root,'research'),authorJournalDirectory:path.join(root,'primary')};};
 const jobConfig=j=>({name:'research',author:j.author,cranker:j.cranker,workflowId:j.workflowId,...paths(j.author),delegated:true});
 const manifest=j=>readDevnetServiceManifest({release,abi,...jobConfig(j)});
 const configFor=(j,m)=>{const total=j?'30000000':'100000000',rent=m?m.maxRent.toString():'10000000',r=m?{...m.resources,priorityFeeLamports:m.resources.priorityFeeLamports.toString()}:{...resources};check(BigInt(rent)<=100000000n&&BigInt(r.priorityFeeLamports)===0n,'DEVNET_SERVICE_MANIFEST_BUDGET');return{version:'BIOLAB-SERVICE1',...context,stateDirectory:path.join(stateDirectory,j?'research':'global',j?.workflowId??'settlement'),endpoint:target,sendEnabled:true,globalActor:j?null:globalActor,researchJobs:j?[jobConfig(j)]:[],maxRent:rent,resources:r,limits:{stepFee:'50000',stepRent:rent,stepTotal:(BigInt(rent)+50000n).toString(),dayFee:total,dayRent:total,dayTotal:total,lifetimeFee:total,lifetimeRent:total,lifetimeTotal:total,minimumBalance:'1000000',maxRefreshes:2,maxQuoteAgeSlots:8},poll:{minMs:INTERVAL,maxMs:30000,maxTicks:10000,maxDurationMs:86400000}};};
 const open=async(j,m)=>{const config=configFor(j,m),adapters=await createDevnetServiceAdapters({release,abi,serviceConfig:config,keyDirectory,keyFiles:j?['ops-1.json']:['ops-2.json'],endpoint:target,fetchImpl:transport}),s=await openServiceSupervisor({release,abi,config,...adapters});supervisors.add(s);return s;};
 const finish=async s=>{await s.close();supervisors.delete(s);};
 async function facts(){await probe.verifyNetwork();const rpc=new ReadOnlyRpc({release,endpoint:target,fetchImpl:transport,maxAccountDataBytes:4*1024*1024});readiness=await inspectDevnetReadiness({release,rpc});return readiness.readyForFunctionalTests;}
 async function cycle(){if(closed||!started)return;running=true;lastTickAt=Date.now();lastError=null;try{await lease.assert();if(!await facts()){globalState=`WAIT_${readiness.state}`;return;}
  const globalBalance=await probe.balance(globalActor);if(globalBalance<1050000n)globalState='WAIT_FUNDS';else{global??=await open(null,null);const r=await global.tick();globalState=r.decision;}
  if(closed)return;const pending=data.jobs.filter(j=>!terminal.has(j.state));if(!pending.length)return;
  const selected=activeResearch?.job??data.jobs.find(j=>j.workflowId===data.activeWorkflowId)??pending[data.rotation%pending.length];if(!activeResearch&&!data.activeWorkflowId)data.rotation=(data.rotation+1)%0x100000000;
  const balance=await probe.balance(cranker);if(balance<1050000n){selected.state='WAIT_FUNDS';selected.errorCode=null;await persist();return;}
  try{const m=await manifest(selected);if(!activeResearch){data.activeWorkflowId=selected.workflowId;await persist();activeResearch={job:selected,supervisor:await open(selected,m)};}const r=await activeResearch.supervisor.tick();selected.state=r.errorCode==='SERVICE_SPENDING_LIMIT'?'WAIT_BUDGET':r.errorCode==='SERVICE_BALANCE_LOW'?'WAIT_FUNDS':r.decision;selected.errorCode=r.errorCode??null;const health=r.health??activeResearch.supervisor.health(),hasPending=health.lanes.some(l=>l.pendingNonce!==null);
   await persist();if(!hasPending){await finish(activeResearch.supervisor);activeResearch=null;data.activeWorkflowId=null;await persist();}
  }catch(e){selected.state='WAIT_DEPENDENCY';selected.errorCode=safe(e);await persist();if(activeResearch){const h=activeResearch.supervisor.health();if(!h.lanes.some(l=>l.pendingNonce!==null)){await finish(activeResearch.supervisor);activeResearch=null;data.activeWorkflowId=null;await persist();}}}
 }catch(e){lastError=safe(e);globalState='WAIT_DEPENDENCY';}finally{running=false;}}
 const schedule=()=>{if(closed||!started)return;timer=setTimeout(()=>{timer=null;void inOrder(cycle).finally(schedule);},INTERVAL);timer.unref?.();};
 const health=()=>({profile:'BIO-DEVNET-SERVICES1',chain:'solana:devnet',started,closed,running,lastTickAt,errorCode:lastError,readiness:readiness?.state??'UNKNOWN',intervalMs:INTERVAL,automaticSubmissionEnabled:started&&!closed,global:{actor:globalActor,state:globalState,health:global?.health()??null},queued:data.jobs.filter(j=>!terminal.has(j.state)).length,totalRegistered:data.jobs.length,maximumRegistered:MAX_JOBS,researchBudgetLamportsPerJob:'30000000',researchBudgetLamportsAllJobsMaximum:'240000000',globalLifetimeBudgetLamports:'100000000',actualExpenditureVerified:false,jobs:data.jobs.map(j=>({...j})),activeResearch:activeResearch?.job.workflowId??data.activeWorkflowId});
 return Object.freeze({async start(){check(!closed,'DEVNET_SERVICE_CLOSED');if(started)return health();started=true;await inOrder(cycle);schedule();return health();},async registerResearch(input){return inOrder(async()=>{check(!closed,'DEVNET_SERVICE_CLOSED');check(input&&Object.keys(input).sort().join(',')==='author,cranker,workflowId','DEVNET_SERVICE_REGISTER_FIELDS');const author=actor(input.author);check(author!==globalActor&&author!==cranker&&input.cranker===cranker&&HEX.test(input.workflowId),'DEVNET_SERVICE_EXECUTOR');const old=data.jobs.find(j=>j.workflowId===input.workflowId);if(old){check(old.author===author&&old.cranker===input.cranker,'DEVNET_SERVICE_JOB_CHANGED');return{decision:'ALREADY_REGISTERED',workflowId:old.workflowId};}check(data.jobs.length<MAX_JOBS,'DEVNET_SERVICE_QUEUE_FULL');const j={author,cranker,workflowId:input.workflowId,state:'QUEUED',errorCode:null};const m=await manifest(j);configFor(j,m);data.jobs.push(j);try{await persist();}catch(e){data.jobs.pop();throw e;}return{decision:'REGISTERED',workflowId:j.workflowId};});},async executors(){let reason=null,balance=null;try{check(!closed&&started,'DEVNET_SERVICE_NOT_STARTED');check(await facts(),'DEVNET_SERVICE_NOT_READY');balance=await probe.balance(cranker);check(balance>=1050000n,'DEVNET_SERVICE_FUNDS_LOW');check(data.jobs.length<MAX_JOBS,'DEVNET_SERVICE_QUEUE_FULL');}catch(e){reason=safe(e);}return[{address:cranker,label:'MogusBio Devnet verifier',available:reason===null,reason,balanceLamports:balance?.toString()??null}];},status:health,async close(){if(closed)return;closed=true;started=false;clearTimeout(timer);abort.abort();for(const s of supervisors)void s.stop().catch(()=>{});await serial;for(const s of [...supervisors])await finish(s);await lease.close();}});
 }catch(e){await lease.close();throw Object.assign(Error(safe(e)),{code:safe(e)});}
}
