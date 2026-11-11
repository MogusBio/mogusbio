import { promises as fs,constants as C } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validateProductionRelease } from '../../packages/client/src/release.mjs';
import { nativeKeyBytes,decodeNativeFrame,nativeRequestHash,encodeNativeFrame } from '../../packages/client/src/native.mjs';
import { validateV1Resources } from '../../packages/client/src/transaction.mjs';
import { NativePlayerSession,createPreparedNativeEnvelope,inspectPreparedNativeEnvelope } from '../../packages/client/src/session.mjs';
import { verifyWalletSignedV1 } from '../../packages/client/src/wallet.mjs';
import { FileJournalStore } from '../../packages/client/src/file-journal.mjs';
import { ResearchWorkflowStore } from '../../packages/client/src/research-manifest.mjs';
import { readGuidedResearchProgress } from '../../packages/client/src/research-progress.mjs';
import { planGuidedGlobalSettlement } from '../../packages/client/src/mining-dashboard.mjs';
import { reconcileNativeCancellation } from '../../packages/client/src/recovery.mjs';
import { acquireServiceLease,readServiceJournal,observeServiceLease } from './lease.mjs';
import { serviceQuoteAdapter } from './quote.mjs';
import { servicePolicy,GLOBAL_OPS,check,dec,publicError } from './policy.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex'),resourceJSON=r=>({...r,priorityFeeLamports:r.priorityFeeLamports.toString()});
const policyBinding=p=>{const {endpoint,sendEnabled,poll,...immutable}=p.config;return hash(JSON.stringify(immutable));};
const actionJSON=a=>({operation:a.operation,nonce:a.nonce.toString(),payloadHex:a.payload.toString('hex'),suffix:a.suffix,dynamicAccounts:a.dynamicAccounts??[]});
const actionValue=(a,resources)=>({operation:a.operation,nonce:dec(a.nonce),payload:Buffer.from(a.payloadHex,'hex'),suffix:a.suffix,dynamicAccounts:a.dynamicAccounts,resources});
const totals=()=>({fee:'0',rent:'0',total:'0'}),safeDay=now=>String(Math.floor(now/86400000));
const empty=(binding,lanes)=>({version:'BIO-SERVICE-STATE1',binding,runtimeSendEnabled:false,stopRequested:false,lastTickAt:null,heartbeatAt:null,rotation:0,ticks:0,confirmed:0,reservationSequence:'0',lifetime:totals(),days:{},lanes:Object.fromEntries(lanes.map(l=>[l.name,{state:'READY',lastOperation:null,pending:null,lastError:null,confirmed:0,backlogHours:null}]))});
const laneList=p=>[...(p.globalActor?[{name:'global',kind:'global',actor:p.globalActor}]:[]),...p.jobs.map(j=>({name:j.name,kind:'research',actor:j.cranker,job:j}))];
const publicTotals=b=>Object.fromEntries(['fee','rent','total'].map(k=>[k,String(dec(b[k]))]));
const recentHeartbeat=(policy,data,now=Date.now())=>typeof data.stopRequested==='boolean'&&typeof data.runtimeSendEnabled==='boolean'&&Number.isSafeInteger(data.ticks)&&data.ticks>=0&&Number.isSafeInteger(data.confirmed)&&data.confirmed>=0&&Number.isSafeInteger(data.lastTickAt)&&Number.isSafeInteger(data.heartbeatAt)&&data.lastTickAt>0&&data.heartbeatAt>=data.lastTickAt&&data.heartbeatAt<=now&&now-data.lastTickAt<=Math.max(30000,policy.poll.maxMs*3+15000);
function publicHealth(policy,data,processState='UNKNOWN'){return {version:'BIO-SERVICE-HEALTH1',configured:true,processState,mode:data.runtimeSendEnabled?'AUTHORIZED_SEND':'PLAN_ONLY',automaticSubmissionEnabled:data.runtimeSendEnabled,signerSendForbidden:true,stopped:processState==='UNKNOWN'?null:processState!=='RUNNING',lastTickAt:data.lastTickAt??null,heartbeatAt:data.heartbeatAt??null,ticks:data.ticks,confirmed:data.confirmed,conservativeCharged:publicTotals(data.lifetime),dayCharged:publicTotals(data.days[safeDay(Date.now())]??totals()),actualExpenditureVerified:false,lanes:laneList(policy).map(l=>({name:l.name,kind:l.kind,actor:l.actor,state:data.lanes[l.name].state,lastOperation:data.lanes[l.name].lastOperation,pendingNonce:data.lanes[l.name].pending?.intent.nonce??null,confirmed:data.lanes[l.name].confirmed,backlogHours:data.lanes[l.name].backlogHours,errorCode:data.lanes[l.name].lastError}))};}
/** Read-only process observation. Missing/foreign/stale leases are never recovered. */
export async function readServiceHealth({release,abi,config}){
  const p=servicePolicy({release,abi,config}),readLease=()=>readServiceJournal(p.stateDirectory,'service-lease.json').catch(()=>null),before=await readLease(),v=await readServiceJournal(p.stateDirectory,'supervisor.json'),binding=policyBinding(p),data=v.payload===null?empty(binding,laneList(p)):JSON.parse(v.payload);
  check(data.version==='BIO-SERVICE-STATE1'&&data.binding===binding,'SERVICE_STATE_BINDING');
  let stopFile=false;try{await fs.lstat(path.join(p.stateDirectory,'STOP'));stopFile=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  const after=await readLease(),stable=before&&after&&before.revision===after.revision&&before.payload===after.payload;
  let state=stable?observeServiceLease(after):'UNKNOWN';
  if(state==='ALIVE')state=data.stopRequested===true||stopFile?'STOPPED':recentHeartbeat(p,data)?'RUNNING':'UNKNOWN';
  return publicHealth(p,data,state);
}
export function readOnlyServiceAuthorStore(store){return Object.freeze({load:()=>store.load(),readTerminal:(...args)=>store.readTerminal(...args),inspectLock:()=>store.inspectLock(),compareAndSwap(){check(false,'SERVICE_AUTHOR_WRITE_FORBIDDEN');},archiveTerminals(){check(false,'SERVICE_AUTHOR_WRITE_FORBIDDEN');}});}

export async function openServiceSupervisor({release,abi,config,fetchImpl,signer=null,quoteAdapter=null}){
  const pinned=await validateProductionRelease(structuredClone(release.input),{localPublicFixture:release.localPublicFixture}),policy=servicePolicy({release:pinned,abi,config}),binding=policyBinding(policy);
  check(fetchImpl===undefined||typeof fetchImpl==='function','SERVICE_FETCH');if(signer!==null)check(signer&&signer.signOnly===true&&Array.isArray(signer.actors)&&typeof signer.signEnvelope==='function','SERVICE_SIGNER');
  const transportAbort=new AbortController(),effectiveFetch=fetchImpl?((url,options)=>fetchImpl(url,{...options,signal:AbortSignal.any([transportAbort.signal,...(options?.signal?[options.signal]:[])])})):undefined;
  const halt=()=>{transportAbort.abort();};
  async function boundedAdapter(work){check(!transportAbort.signal.aborted,'SERVICE_STOP_REQUESTED');const controller=new AbortController();let timer,interrupted;const stop=()=>interrupted('SERVICE_STOP_REQUESTED');const interruption=new Promise((_,reject)=>{interrupted=code=>{controller.abort();try{check(false,code);}catch(e){reject(e);}};timer=setTimeout(()=>interrupted('SERVICE_ADAPTER_TIMEOUT'),15000);transportAbort.signal.addEventListener('abort',stop,{once:true});});try{return await Promise.race([Promise.resolve().then(()=>{check(!controller.signal.aborted,'SERVICE_STOP_REQUESTED');return work(controller.signal);}),interruption]);}finally{clearTimeout(timer);transportAbort.signal.removeEventListener('abort',stop);}}
  const lease=await acquireServiceLease(policy.stateDirectory);try{
  const stateStore=await FileJournalStore.open({directory:policy.stateDirectory,name:'supervisor.json'}),global=policy.globalActor?[{name:'global',kind:'global',actor:policy.globalActor}]:[],lanes=[...global,...policy.jobs.map(j=>({name:j.name,kind:'research',actor:j.cranker,job:j}))],sessions=new Map();
  for(const lane of lanes){
    const dir=path.join(policy.stateDirectory,'actors',nativeKeyBytes(lane.actor).toString('hex')),store=await FileJournalStore.open({directory:dir,name:'primary.json'}),cancelStore=await FileJournalStore.open({directory:dir,name:'cancellation.json'}),runtime={release:pinned,abi,actor:lane.actor,endpoint:policy.endpoint??(pinned.localPublicFixture?'http://127.0.0.1:1':'https://unconfigured.invalid'),fetchImpl:effectiveFetch,allowLocalhost:pinned.localPublicFixture};
    sessions.set(lane.name,{primary:new NativePlayerSession({...runtime,store}),cancel:new NativePlayerSession({...runtime,store:cancelStore}),store});
    if(lane.job){const authorStore=await FileJournalStore.open({directory:lane.job.authorJournalDirectory});sessions.get(lane.name).author=new NativePlayerSession({...runtime,actor:lane.job.author,store:readOnlyServiceAuthorStore(authorStore)});}
  }
  let stored=await stateStore.load(),data=stored.payload===null?empty(binding,lanes):JSON.parse(stored.payload),revision=stored.revision,stopped=false,busy=false,closed=false;
  check(data.version==='BIO-SERVICE-STATE1'&&data.binding===binding&&Object.keys(data.lanes).sort().join(',')===lanes.map(l=>l.name).sort().join(','),'SERVICE_STATE_BINDING');
  let persistence=Promise.resolve();
  const persist=()=>{data.heartbeatAt=Date.now();const payload=JSON.stringify(data);const write=persistence.then(async()=>{const next=await stateStore.compareAndSwap(revision,payload);check(next!==false,'SERVICE_STATE_CAS');revision=next;});persistence=write;return write;};
  data.runtimeSendEnabled=policy.sendEnabled;data.stopRequested=false;data.lastTickAt=null;await persist();
  const quote=quoteAdapter??(policy.endpoint&&effectiveFetch?serviceQuoteAdapter({release:pinned,abi,fetchImpl:effectiveFetch,endpoint:policy.endpoint}):null);
  check(quote===null||typeof quote.quote==='function'&&typeof quote.lifetime==='function','SERVICE_QUOTE_ADAPTER');
  const stoppedNow=async()=>{if(stopped)return true;try{await fs.lstat(path.join(policy.stateDirectory,'STOP'));stopped=true;data.stopRequested=true;await persist();return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
  const assertSend=async()=>{await lease.assert();check(!await stoppedNow(),'SERVICE_STOP_REQUESTED');};
  const health=()=>publicHealth(policy,data,stopped||closed?'STOPPED':recentHeartbeat(policy,data)?'RUNNING':'UNKNOWN');
  const mark=async(lane,state,extra={})=>{const s=data.lanes[lane.name];s.state=state;s.lastError=null;Object.assign(s,extra);await persist();return {decision:state,lane:lane.name,health:health()};};
  function permitted(lane,intent){const op=intent.operation;check(lane.kind==='global'?GLOBAL_OPS.includes(op):op==='VERIFY_STEP','SERVICE_OPERATION_NOT_AUTHORIZED');check(!intent.labDestinationSetup&&(!intent.feePayer||intent.feePayer===lane.actor),'SERVICE_ACTOR_FEE_PAYER');const p=intent.payload??(intent.payloadHex?Buffer.from(intent.payloadHex,'hex'):null);if(p)check(p.length>=8&&p.readBigUInt64LE(p.length-8)<=policy.maxRent,'SERVICE_SIGNED_RENT_CAP');}
  async function plan(lane){
    const s=sessions.get(lane.name);if(lane.kind==='global')return planGuidedGlobalSettlement({release:pinned,abi,rpc:s.primary.rpc,actor:lane.actor,maxRent:policy.maxRent});
    const r=await readGuidedResearchProgress({release:pinned,abi,authorSession:s.author,executorSession:s.primary,actor:lane.actor,author:lane.job.author,workflowId:lane.job.workflowId,store:new ResearchWorkflowStore({directory:lane.job.manifestDirectory})});
    if(r.decision!=='ACTION')return r;check(r.stage?.kind==='STEP'&&r.intent?.operation==='VERIFY_STEP'&&r.workflow.cranker===lane.actor&&r.workflow.author===lane.job.author,'SERVICE_RESEARCH_DELEGATION');
    const i=r.intent;check(JSON.stringify(i.resources)===JSON.stringify(resourceJSON(policy.resources)),'SERVICE_RESEARCH_RESOURCES');return {...r,action:{operation:i.operation,nonce:dec(i.nonce),payload:Buffer.from(i.payloadHex,'hex'),suffix:i.suffix,dynamicAccounts:i.dynamicAccounts??[]}};
  }
  async function inspected(lane,envelope){const r=await inspectPreparedNativeEnvelope({release:pinned,abi,envelope});const f=decodeNativeFrame(abi,r.frame);permitted(lane,{operation:f.operation,payload:f.payload,feePayer:envelope.feePayer});check(r.actor===lane.actor&&envelope.feePayer===lane.actor&&Object.keys(r.transaction.signatures).length===1&&Object.keys(r.transaction.signatures)[0]===lane.actor,'SERVICE_REQUIRED_SIGNERS');return r;}
  async function simulationAndQuote(lane,envelope){
    const s=sessions.get(lane.name);await inspected(lane,envelope);await s.primary.rpc.simulatePreparedV1(Buffer.from(envelope.unsignedHex,'hex'),{supportedTransactionVersions:[1]});check(quote,'SERVICE_QUOTE_UNAVAILABLE');const q=await boundedAdapter(signal=>quote.quote(envelope,s.primary.rpc,{signal}));
    check(q?.source==='FINALIZED_RPC_MESSAGE_AND_RENT'&&q.messageSHA256===envelope.messageSHA256&&typeof q.contextSlot==='bigint'&&typeof q.balanceContextSlot==='bigint'&&q.contextSlot>=q.balanceContextSlot&&q.contextSlot-q.balanceContextSlot<=BigInt(policy.limits.maxQuoteAgeSlots),'SERVICE_QUOTE_BINDING');
    for(const k of ['feeLamports','rentLamports','balanceLamports'])check(typeof q[k]==='bigint'&&q[k]>=0n&&q[k]<=(1n<<64n)-1n,'SERVICE_QUOTE_VALUE');
    check(q.rentLamports<=policy.maxRent&&q.feeLamports<=policy.limits.stepFee&&q.rentLamports<=policy.limits.stepRent&&q.feeLamports+q.rentLamports<=policy.limits.stepTotal,'SERVICE_STEP_LIMIT');check(q.balanceLamports>=q.feeLamports+q.rentLamports+policy.limits.minimumBalance,'SERVICE_BALANCE_LOW');return q;
  }
  function budget(q){const day=safeDay(Date.now()),prior=data.days[day]??totals(),fee=q.feeLamports,rent=q.rentLamports,total=fee+rent;
    for(const [scope,book]of [['day',prior],['lifetime',data.lifetime]])for(const [k,n]of [['Fee',fee],['Rent',rent],['Total',total]])check(dec(book[k.toLowerCase()])+n<=policy.limits[scope+k],'SERVICE_SPENDING_LIMIT');
    return {day,prior,fee,rent,total};
  }
  async function reserve(lane,p,q){
    if(p.reservation)return;const {day,prior,fee,rent,total}=budget(q);
    const seq=dec(data.reservationSequence)+1n;data.reservationSequence=String(seq);for(const book of [prior,data.lifetime]){book.fee=String(dec(book.fee)+fee);book.rent=String(dec(book.rent)+rent);book.total=String(dec(book.total)+total);}data.days[day]=prior;
    p.reservation={version:'BIO-SERVICE-RESERVATION1',sequence:String(seq),lane:lane.name,actor:lane.actor,operation:p.intent.operation,nonce:p.intent.nonce,requestHash:nativeRequestHash(abi,Buffer.from(p.envelope.frameHex,'hex')).toString('hex'),messageSHA256:p.envelope.messageSHA256,day,feeLamports:String(fee),rentLamports:String(rent),totalLamports:String(total),quoteContextSlot:String(q.contextSlot),conservativeUpperCharge:true};await persist();
  }
  async function audit(p){const store=await FileJournalStore.open({directory:path.join(policy.stateDirectory,'reservations'),name:`charge-${p.reservation.sequence}.json`}),old=await store.load(),text=JSON.stringify(p.reservation);if(old.payload===null)check(await store.compareAndSwap(old.revision,text)!==false,'SERVICE_AUDIT_CAS');else check(old.payload===text,'SERVICE_AUDIT_CHANGED');}
  async function finish(lane,decision){const s=data.lanes[lane.name];if(decision==='CONFIRMED'){data.confirmed++;s.confirmed++;}s.pending=null;return mark(lane,decision);}
  async function pending(lane){
    const l=data.lanes[lane.name],p=l.pending,s=sessions.get(lane.name),nonce=dec(p.intent.nonce);permitted(lane,p.intent);
    let entry=null;try{entry=await s.primary.getRequest(nonce);}catch(e){check(['JOURNAL_NOT_FOUND','JOURNAL_ARCHIVE_NOT_FOUND'].includes(e.code),'SERVICE_JOURNAL_READ');}
    const expected=encodeNativeFrame(abi,{operation:p.intent.operation,domain:pinned.domain,configId:Buffer.from(policy.config.configHex,'hex'),actor:nativeKeyBytes(lane.actor),nonce,payload:Buffer.from(p.intent.payloadHex,'hex')});if(entry)check(entry.frameBytes.equals(expected),'SERVICE_JOURNAL_INTENT_CONFLICT');if(p.envelope)check(p.envelope.frameHex===expected.toString('hex'),'SERVICE_PENDING_FRAME_CHANGED');
    if(entry){
      const outcome=await s.primary.reconcile(nonce);if(outcome.decision==='CONFIRMED')return finish(lane,'CONFIRMED');if(outcome.decision==='NONCE_CONFLICT'){
        let competing=null;try{competing=await s.cancel.getRequest(nonce);}catch(e){if(!['JOURNAL_NOT_FOUND','JOURNAL_ARCHIVE_NOT_FOUND'].includes(e.code))throw e;}
        if(competing){const c=await reconcileNativeCancellation({release:pinned,abi,actor:lane.actor,primarySession:s.primary,cancellationSession:s.cancel,nonce});if(c.decision==='CANCEL_CONFIRMED')return finish(lane,'CANCEL_CONFIRMED');}return mark(lane,'WAIT_NONCE_CONFLICT');
      }
      if(outcome.decision==='ALREADY_PROCESSED')return mark(lane,'WAIT_OLD_EXECUTION_UNKNOWN');
      check(outcome.decision==='RETRY_SAME_FRAME','SERVICE_RECOVERY_STATE');
    }
    if(!policy.sendEnabled)return mark(lane,'WAIT_SEND_DISABLED');if(!signer||!signer.actors.includes(lane.actor))return mark(lane,'WAIT_SIGNER');if(!quote)return mark(lane,'WAIT_QUOTE');
    if(p.stage==='SIGNING')return mark(lane,'WAIT_SIGNING_RECOVERY');
    if(entry?.attempts.length&&!p.envelope)return mark(lane,'WAIT_ENVELOPE_RECOVERY');
    if(p.envelope){const life=await boundedAdapter(signal=>quote.lifetime(p.envelope,s.primary.rpc,{signal})),submitted=entry?.attempts.at(-1)?.blockhash===p.envelope.lifetime.blockhash;if(submitted&&!life.expired)return mark(lane,'WAIT_PENDING_FINALITY');if(!life.valid&&!life.expired)return mark(lane,'WAIT_LIFETIME_PROOF');if(life.expired){if(p.refreshes>=policy.limits.maxRefreshes)return mark(lane,'WAIT_REFRESH_LIMIT');await assertSend();const refreshed=await s.primary.refresh(p.envelope);check(refreshed.lifetime.blockhash!==p.envelope.lifetime.blockhash,'SERVICE_REFRESH_NOT_NEW');p.envelope=refreshed;p.refreshes++;p.reservation=null;p.stage='PREPARED';p.signedHex=null;await persist();}}
    if(!p.envelope){await assertSend();p.envelope=await s.primary.prepare(actionValue(p.intent,policy.resources));p.stage='PREPARED';await persist();}
    const q=await simulationAndQuote(lane,p.envelope);if(p.reservation)check(q.feeLamports<=dec(p.reservation.feeLamports)&&q.rentLamports<=dec(p.reservation.rentLamports),'SERVICE_RESERVED_QUOTE_CHANGED');await reserve(lane,p,q);await audit(p);await assertSend();
    if(!p.signedHex){p.stage='SIGNING';await persist();const bytes=await boundedAdapter(signal=>signer.signEnvelope(structuredClone(p.envelope),{actor:lane.actor,role:lane.kind,requestId:p.envelope.messageSHA256,signal}));verifyWalletSignedV1(Buffer.from(p.envelope.unsignedHex,'hex'),bytes);p.signedHex=Buffer.from(bytes).toString('hex');p.stage='SIGNED';await persist();}
    await assertSend();const sent=await s.primary.broadcastSigned(p.envelope,Buffer.from(p.signedHex,'hex'));p.stage='SUBMITTED';await persist();if(sent.decision==='CONFIRMED')return finish(lane,'CONFIRMED');return mark(lane,sent.decision==='UNKNOWN'?'WAIT_RPC_UNKNOWN':'WAIT_PENDING_FINALITY');
  }
  async function tick(){
    if(busy)return {decision:'WAIT_BUSY',health:health()};check(!closed,'SERVICE_CLOSED');busy=true;try{
      await lease.assert();if(await stoppedNow())return {decision:'STOPPED',health:health()};data.lastTickAt=Date.now();await persist();if(!lanes.length)return {decision:'WAIT_NO_LANES',health:health()};const lane=lanes[data.rotation%lanes.length];data.rotation=(data.rotation+1)%lanes.length;data.ticks++;
      try{
        if(!policy.endpoint||!fetchImpl)return mark(lane,'WAIT_NETWORK_CONFIG');if(['CANCEL_CONFIRMED','WAIT_CANCELLED'].includes(data.lanes[lane.name].state))return mark(lane,'WAIT_CANCELLED');if(data.lanes[lane.name].pending)return await pending(lane);
        const planned=await plan(lane),l=data.lanes[lane.name];if(planned.summary?.emission)l.backlogHours=planned.summary.emission.backlogHours;
        if(planned.decision!=='ACTION')return mark(lane,planned.decision);permitted(lane,planned.action);l.lastOperation=planned.action.operation;
        if(!policy.sendEnabled)return mark(lane,'WAIT_SEND_DISABLED');if(!signer||!signer.actors.includes(lane.actor))return mark(lane,'WAIT_SIGNER');if(!quote)return mark(lane,'WAIT_QUOTE');
        const action=planned.action,draft=await createPreparedNativeEnvelope({release:pinned,abi,frame:action.frame??encodeNativeFrame(abi,{operation:action.operation,domain:pinned.domain,configId:Buffer.from(policy.config.configHex,'hex'),actor:nativeKeyBytes(lane.actor),nonce:action.nonce,payload:action.payload}),suffix:action.suffix,dynamicAccounts:action.dynamicAccounts??[],feePayer:lane.actor,lifetime:await sessions.get(lane.name).primary.latestLifetime(),resources:policy.resources});
        budget(await simulationAndQuote(lane,draft));l.pending={intent:actionJSON(action),envelope:null,stage:'PREPARING',refreshes:0,signedHex:null,reservation:null};await persist();return await pending(lane);
      }catch(e){const l=data.lanes[lane.name];l.lastError=publicError(e);l.state=stopped||e.code==='SERVICE_STOP_REQUESTED'?'STOPPED':'WAIT_DEPENDENCY';await persist();return {decision:l.state,errorCode:l.lastError,lane:lane.name,health:health()};}
    }finally{busy=false;}
  }
  async function resumeSigning(name){await lease.assert();check(!busy,'SERVICE_BUSY');const lane=lanes.find(l=>l.name===name),p=lane&&data.lanes[name].pending;check(p?.stage==='SIGNING','SERVICE_NOT_SIGNING');const entry=await sessions.get(name).primary.getRequest(dec(p.intent.nonce));check(entry.attempts.length===0,'SERVICE_ALREADY_SUBMITTED');p.stage='PREPARED';await persist();return {decision:'SIGNING_RECOVERY_AUTHORIZED',health:health()};}
  async function resumeCancelled(name){await lease.assert();check(!busy&&lanes.some(l=>l.name===name)&&!data.lanes[name].pending&&['CANCEL_CONFIRMED','WAIT_CANCELLED'].includes(data.lanes[name].state),'SERVICE_NOT_CANCELLED');data.lanes[name].state='READY';await persist();return {decision:'CANCELLED_LANE_RESUME_AUTHORIZED',health:health()};}
  const stop=()=>{stopped=true;data.stopRequested=true;halt();const write=persist();write.catch(()=>{});return write;};
  async function run({maxTicks=policy.poll.maxTicks,maxDurationMs=policy.poll.maxDurationMs,signal}={}){check(Number.isInteger(maxTicks)&&maxTicks>=1&&maxTicks<=policy.poll.maxTicks&&Number.isInteger(maxDurationMs)&&maxDurationMs>=1&&maxDurationMs<=policy.poll.maxDurationMs,'SERVICE_RUN_BOUND');const start=Date.now(),interrupt=()=>{void stop();},timer=setTimeout(interrupt,maxDurationMs);signal?.addEventListener('abort',interrupt,{once:true});let backoff=policy.poll.minMs,last=null;try{for(let i=0;i<maxTicks&&Date.now()-start<maxDurationMs;i++){if(signal?.aborted){interrupt();break;}last=await tick();if(last.decision==='STOPPED')break;backoff=last.decision==='CONFIRMED'?policy.poll.minMs:Math.min(policy.poll.maxMs,backoff*2);if(i+1<maxTicks&&Date.now()-start+backoff<maxDurationMs)try{await delay(backoff,undefined,{signal});}catch(e){if(e.name!=='AbortError')throw e;interrupt();break;}}return {decision:stopped?'STOPPED':'RUN_BOUND_REACHED',lastDecision:last?.decision??null,health:health()};}finally{clearTimeout(timer);signal?.removeEventListener('abort',interrupt);}}
  return {tick,run,health,resumeSigning,resumeCancelled,stop,async close(){check(!busy,'SERVICE_BUSY');if(!closed){await persistence;await lease.close();closed=true;}}};
  }catch(e){await lease.close();throw e;}
}
