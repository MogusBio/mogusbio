import {isOffCurveAddress} from '@solana/kit';
import {asBytes,ByteWriter,typedHash} from '../../protocol-core/src/index.mjs';
import {TASK_FAMILY as F,ROUND_SECONDS} from '../../originality/src/wire.mjs';
import {H_END} from '../../settlement/src/emission.mjs';
import {ReadOnlyRpc} from './rpc.mjs';
import {PROGRAMS,baseConfigR2Id} from './release.mjs';
import {nativeKeyBytes,nativeKeyAddress,nativePda,nativeOperation,encodeNativeFrame,buildNativeInstruction} from './native.mjs';
import {decodeActorNonceSnapshot} from './journal.mjs';
import {decodeNativeBaseConfig,decodeNativeAccountRecord,decodeNativeRoot,decodeNativeRegistry,decodeNativeRoot as readRoot,decodeNativePosition,decodeNativeDirectory,decodeNativeActivation} from './accounts.mjs';
import {decodeNativeEconomyConfig,decodeNativeClock,decodeNativeRootRegistration} from './economy-accounts.mjs';
import {decodeNativeOriginalityTask,decodeNativeKSlot,decodeNativeOpeningSnapshot,decodeNativeRound,decodeNativeCandidate,decodeNativeCommit,decodeNativeDisclosure,decodeNativeKnowledge,decodeNativeWinner} from './originality-accounts.mjs';

const MAX=(1n<<64n)-1n,check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const le=n=>new ByteWriter(8).u64(n).finish(),v1=new ByteWriter(4).u32(1).finish(),hex=b=>Buffer.from(b).toString('hex');
const u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'COMPETITION_ROUND_U64');return n;};
const pda=(r,...s)=>nativePda(r.input.programId,'bio',...s).then(p=>p.address);
const rid=(r,n)=>typedHash(9,Buffer.concat([r.domain,F,v1,le(n)])),wid=(r,n)=>typedHash(10,Buffer.concat([r.domain,rid(r,n)]));
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const same=(a,b)=>a===null||b===null?a===b:a.owner===b.owner&&a.address===b.address&&a.executable===b.executable&&a.lamports===b.lamports&&asBytes(a.data).equals(asBytes(b.data));
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,reservesOnChainNonce:false};
const result=(decision,ctx,extra={})=>({...flags,decision,contextSlot:ctx?.read.contextSlot??0n,...extra});
function fields(input,names){check(input&&Object.getPrototypeOf(input)===Object.prototype&&Object.keys(input).every(k=>names.includes(k)),'COMPETITION_ROUND_FIELDS');}
async function batch(rpc,keys){const addresses=[...new Set(Object.values(keys))];check(addresses.length<=100,'COMPETITION_ROUND_ACCOUNT_BOUND');const {contextSlot,accounts}=await rpc.getMultipleAccounts(addresses);return {contextSlot,accounts:new Map(addresses.map((a,i)=>[a,accounts[i]]))};}
const get=(ctx,name)=>ctx.read.accounts.get(ctx.keys[name]);
async function decodeCommon(ctx){
  const {release,actor}=ctx;await decodeNativeBaseConfig(release,get(ctx,'Base'));const economy=await decodeNativeEconomyConfig(release,get(ctx,'Economy')),clock=decodeNativeClock(get(ctx,'Clock'));
  const a=get(ctx,'Actor');check(a&&a.owner===PROGRAMS.systemProgram&&!a.executable&&asBytes(a.data).length===0&&!isOffCurveAddress(actor),'COMPETITION_ROUND_ACTOR');
  const nonce=await decodeActorNonceSnapshot({release,actor,address:ctx.keys.Nonce,account:get(ctx,'Nonce'),contextSlot:ctx.read.contextSlot,commitment:'finalized'});
  const task=fresh(get(ctx,'Task'))?null:await decodeNativeOriginalityTask(release,get(ctx,'Task'));
  const slot=fresh(get(ctx,'KSlot'))?{generation:task?.generation??0n,current:null,status:0}:await decodeNativeKSlot(release,get(ctx,'KSlot'),{generation:task?.generation??0n});
  const snapshot=fresh(get(ctx,'Snapshot'))?null:await decodeNativeOpeningSnapshot(release,get(ctx,'Snapshot'));
  if(task)check(clock.unixTimestamp>=task.highWater,'COMPETITION_ROUND_TASK_CLOCK');if(snapshot)check(snapshot.createdAt<=clock.unixTimestamp&&snapshot.slot<=clock.slot,'COMPETITION_ROUND_SNAPSHOT_CLOCK');
  return {economy,clock,nonce,task,slot,snapshot};
}
async function initial(release,rpc,actor){
  check(rpc instanceof ReadOnlyRpc,'COMPETITION_ROUND_RPC');const address=nativeKeyAddress(actor),keys={Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar,Actor:address,Nonce:await pda(release,'actor-nonce',nativeKeyBytes(address)),Task:await pda(release,'task',F),KSlot:await pda(release,'k-slot',F),Snapshot:await pda(release,'seed-final',F)};
  const ctx={release,rpc,actor:address,keys,read:await batch(rpc,keys)};ctx.facts=await decodeCommon(ctx);return ctx;
}
async function grow(ctx,extra={}){
  const oldKeys={...ctx.keys},old=ctx.read,facts=ctx.facts;Object.assign(ctx.keys,extra);ctx.read=await batch(ctx.rpc,ctx.keys);ctx.facts=await decodeCommon(ctx);
  check(ctx.facts.clock.slot>=facts.clock.slot&&ctx.facts.clock.unixTimestamp>=facts.clock.unixTimestamp&&ctx.facts.nonce.nextNonce>=facts.nonce.nextNonce,'COMPETITION_ROUND_OBSERVATION_REGRESSION');
  if(!Object.keys(oldKeys).filter(k=>k!=='Clock').every(k=>same(old.accounts.get(oldKeys[k]),ctx.read.accounts.get(oldKeys[k]))))throw Object.assign(new Error('COMPETITION_ROUND_REPLAN'),{code:'COMPETITION_ROUND_REPLAN',contextSlot:ctx.read.contextSlot});
}
function gates(ctx){if(!ctx.facts.task)return 'TASK_NOT_INITIALIZED';if(!ctx.facts.snapshot||!ctx.facts.task.opening)return 'OPENING_NOT_FINALIZED';if(ctx.facts.task.paused)return 'TASK_PAUSED';return null;}
async function action(ctx,abi,operation,payload,fixed,dynamicAccounts=[]){
  check(ctx.facts.nonce.nextNonce<MAX,'COMPETITION_ROUND_NONCE_EXHAUSTED');const suffix=nativeOperation(abi,operation).publicFixedSuffix.map(v=>({name:v.role,address:fixed[v.role]})),nonce=ctx.facts.nonce.nextNonce;
  const frame=encodeNativeFrame(abi,{operation,domain:ctx.release.domain,configId:baseConfigR2Id(ctx.release),actor:ctx.actor,nonce,payload});
  return {clientPlanOnly:true,operation,nonce,frame,payload,suffix,dynamicAccounts,instruction:await buildNativeInstruction({release:ctx.release,abi,frame,suffix,dynamicAccounts})};
}
async function addKnowledge(ctx,indices){
  const extra={};for(const n of indices)extra[`Knowledge${n}`]=await pda(ctx.release,'knowledge',F,le(n));if(Object.keys(extra).some(k=>!Object.hasOwn(ctx.keys,k)))await grow(ctx,extra);
  const proofs={};for(const n of indices){
    const info=get(ctx,`Knowledge${n}`),id=Buffer.concat([le(n),Buffer.alloc(24)]),r=await decodeNativeAccountRecord(ctx.release,info,{kind:33,schemas:[1],seeds:['bio','knowledge',F,le(n)],recordKey:id,maxBodyBytes:279});check(r.body.length===279,'COMPETITION_ROUND_KNOWLEDGE_SIZE');
    if(r.body[148]===2&&r.body[245]===0){const address=nativeKeyAddress(r.body.subarray(149,181));proofs[`Safety${address}`]=address;}
  }
  if(Object.keys(proofs).some(k=>!Object.hasOwn(ctx.keys,k)))await grow(ctx,proofs);
  const values=new Map();for(const n of indices){const info=get(ctx,`Knowledge${n}`),b=info.data.subarray(120),safety=b[148]===2&&b[245]===0?ctx.read.accounts.get(nativeKeyAddress(b.subarray(149,181))):undefined;
    const k=await decodeNativeKnowledge(ctx.release,info,n,safety?{safetyAccount:safety}:{});check(k.createdAt<=ctx.facts.clock.unixTimestamp&&k.slot<=ctx.facts.clock.slot,'COMPETITION_ROUND_KNOWLEDGE_CLOCK');values.set(n.toString(),k);
  }return values;
}
function dynamicAppender(ctx,initial=[]){const rows=[...initial],seen=new Set([...Object.values(ctx.keys).filter(a=>[ctx.keys.Actor,ctx.keys.Nonce,ctx.keys.Base,ctx.keys.Economy,ctx.keys.Clock,ctx.keys.Task,ctx.keys.KSlot,ctx.keys.Round].includes(a)),PROGRAMS.systemProgram,PROGRAMS.tokenProgram,PROGRAMS.instructionsSysvar,...initial.map(v=>v.address)]);
  return {rows,push:(address,writable=false)=>{check(!seen.has(address),'COMPETITION_ROUND_ACCOUNT_ALIAS');seen.add(address);rows.push({address,writable,signer:false});},proof:k=>{if(k.safety&&!seen.has(k.safety.address)){seen.add(k.safety.address);rows.push({address:k.safety.address,writable:false,signer:false});}}};
}
const boundary=ctx=>ctx.facts.clock.unixTimestamp<ctx.facts.economy.rewardStart?-1n:(ctx.facts.clock.unixTimestamp-ctx.facts.economy.rewardStart)/3600n;
function basicEligibility(ctx,root,reg,author,cost){
  if(ctx.facts.task.paused)return 'TASK_PAUSED';if(!ctx.facts.task.best||ctx.facts.task.best.cost!==cost)return 'NOT_CURRENT_BEST';if(root.owner!==author)return 'OWNER_MISMATCH';if(root.lifecycle!==0)return 'INPUT_ALREADY_CONSUMED';if(root.schema!==4||root.qualityPpm!==2000000n)return 'ROOT_NOT_QUALIFIED_BIO';
  if(boundary(ctx)<0n||boundary(ctx)>=H_END-1n)return 'REWARD_WINDOW_CLOSED';if(!reg||reg.ordinaryCount===0n)return 'ORDINARY_POSITION_REQUIRED';if(reg.certificateFault)return 'CERTIFICATE_FAULT';if(reg.revocationCause!==0)return 'ROOT_REVOKED';if(reg.ordinaryEnd!==null)return 'ORDINARY_INTERVAL_ENDED';if(reg.kEnd===null)return 'K_ALREADY_ACTIVE';return null;
}
async function activationBundle(ctx,{root,reg,author,cost,winnerId}){
  let reason=basicEligibility(ctx,root,reg,author,cost);if(reason)return {eligible:false,reason};
  const start=boundary(ctx)+1n;check(reg.revision<MAX&&reg.activationCount<MAX&&ctx.facts.task.generation<MAX&&ctx.facts.task.event<MAX,'COMPETITION_ACTIVATION_COUNTER');
  const extra={Ordinary:await pda(ctx.release,'reg',root.instance,le(reg.ordinaryCount-1n)),Directory:await pda(ctx.release,'mining-root',le(reg.directorySequence)),Registry:await pda(ctx.release,'mining')};
  if(ctx.facts.slot.current)extra.OldActivation=await pda(ctx.release,'activation',ctx.facts.slot.current);await grow(ctx,extra);
  const position=await decodeNativePosition(ctx.release,get(ctx,'Ordinary'),root.instance,reg.ordinaryCount-1n),directory=await decodeNativeDirectory(ctx.release,get(ctx,'Directory'),reg.directorySequence),registry=await decodeNativeRegistry(ctx.release,get(ctx,'Registry'));
  check(position.positionId.equals(reg.lastPositionId)&&position.rootDirectorySeq===reg.directorySequence&&position.rootRevision===root.revision&&position.beneficiaryAddress===author&&directory.instance.equals(root.instance),'COMPETITION_ACTIVATION_POSITION');
  if(position.end!==null)return {eligible:false,nativeEligible:true,reason:'ORDINARY_INTERVAL_ENDED'};if(position.start>start)return {eligible:false,nativeEligible:true,reason:'WAIT_ORDINARY_START'};
  // Directory can still describe an earlier queued interval while the newly
  // registered ordinary Position starts in the future. Native activation uses
  // its immutable Position/RootReg linkage, not materialized Directory state.
  check(ctx.facts.clock.unixTimestamp>=registry.highWater&&registry.nextKSequence<MAX&&registry.eventCount<MAX&&registry.lastEventDue<=start&&registry.nextHour<=start,'COMPETITION_ACTIVATION_EVENT_ORDER');
  if(ctx.facts.slot.current){const old=await decodeNativeActivation(ctx.release,get(ctx,'OldActivation'),ctx.facts.slot.current);check(old.global+1n===registry.nextKSequence&&old.start<=start,'COMPETITION_ACTIVATION_OLD_SEQUENCE');if(old.end===null||old.end>start)return {eligible:false,nativeEligible:true,reason:'WAIT_PREVIOUS_K_END'};check(old.body.readBigInt64LE(218)<=ctx.facts.clock.unixTimestamp&&old.body.readBigUInt64LE(210)<=ctx.facts.clock.slot&&old.body.readBigInt64LE(243)<=ctx.facts.clock.unixTimestamp&&old.body.readBigUInt64LE(235)<=ctx.facts.clock.slot,'COMPETITION_ACTIVATION_OLD_CLOCK');}
  else check(registry.nextKSequence===0n,'COMPETITION_ACTIVATION_OLD_REQUIRED');
  const id=typedHash(11,Buffer.concat([ctx.release.domain,F,winnerId,le(reg.activationCount)]));
  await grow(ctx,{Activation:await pda(ctx.release,'activation',id),KHistory:await pda(ctx.release,'mining-k',le(registry.nextKSequence)),Event:await pda(ctx.release,'mining-event',le(registry.eventCount))});
  check(fresh(get(ctx,'Activation'))&&fresh(get(ctx,'KHistory'))&&fresh(get(ctx,'Event')),'COMPETITION_ACTIVATION_NOT_FRESH');
  return {eligible:true,id,start,position,registry,local:reg.activationCount,global:registry.nextKSequence};
}
async function decodeCandidateBundle(ctx,n,index,{disclosure=true}={}){
  const key=await pda(ctx.release,'candidate',rid(ctx.release,n),le(index));await grow(ctx,{Candidate:key});const candidate=await decodeNativeCandidate(ctx.release,get(ctx,'Candidate'),{round:n,index});
  await grow(ctx,{Commit:await pda(ctx.release,'commit',candidate.commit),...(disclosure?{Disclosure:await pda(ctx.release,'disclosure',candidate.disclosure)}:{})});
  const commit=await decodeNativeCommit(ctx.release,get(ctx,'Commit'),candidate.commit),knowledge=await addKnowledge(ctx,[candidate.knowledgeIndex]),own=knowledge.get(candidate.knowledgeIndex.toString());
  check(commit.used&&commit.candidate.equals(candidate.id)&&commit.candidateIndex===index&&commit.author===candidate.author&&commit.round===n&&own.index<ctx.round.endCount&&own.design.equals(candidate.design)&&own.evidence.equals(candidate.instance)&&own.admission.equals(candidate.admission)&&own.cost===candidate.cost&&own.event===candidate.event,'COMPETITION_ROUND_CANDIDATE_LINKAGE');
  if(disclosure){const d=await decodeNativeDisclosure(ctx.release,get(ctx,'Disclosure'),candidate.design);check(d.id.equals(candidate.disclosure)&&d.event===own.firstDisclosureEvent&&d.event<=ctx.facts.task.event&&d.createdAt<=ctx.facts.clock.unixTimestamp&&d.slot<=ctx.facts.clock.slot&&commit.event<candidate.event,'COMPETITION_ROUND_DISCLOSURE_LINKAGE');}
  check(candidate.createdAt<=ctx.facts.clock.unixTimestamp&&candidate.slot<=ctx.facts.clock.slot&&candidate.event<=ctx.facts.task.event,'COMPETITION_ROUND_CANDIDATE_CLOCK');return {candidate,commit,own};
}
function lookupOptions(value){if(value===undefined)return null;check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')==='bestCandidateHex,candidateCount,roundIdHex'&&['bestCandidateHex','roundIdHex'].every(k=>typeof value[k]==='string'&&/^[0-9a-f]{64}$/.test(value[k]))&&typeof value.candidateCount==='string'&&/^(0|[1-9][0-9]*)$/.test(value.candidateCount)&&value.candidateCount.length<=20,'COMPETITION_ROUND_LOOKUP_CONTEXT');u64(BigInt(value.candidateCount));return {...value};}
async function selectedCandidate(ctx,n,limit,start,context,hint){
  const r=ctx.round,id=rid(ctx.release,n),matches=context&&context.roundIdHex===hex(id)&&context.bestCandidateHex===hex(r.bestCandidate)&&context.candidateCount===r.candidateCount.toString();
  let from=matches&&start!==undefined?start:0n;if(hint!==undefined){u64(hint);check(hint<r.candidateCount,'COMPETITION_ROUND_CANDIDATE_HINT');from=hint;}check(from<=r.candidateCount,'COMPETITION_ROUND_LOOKUP_CURSOR');
  const end=hint!==undefined?from+1n:(from+BigInt(limit)<r.candidateCount?from+BigInt(limit):r.candidateCount),extra={};for(let i=from;i<end;i++)extra[`LookupCandidate${i}`]=await pda(ctx.release,'candidate',id,le(i));await grow(ctx,extra);
  for(let i=from;i<end;i++){const c=await decodeNativeCandidate(ctx.release,get(ctx,`LookupCandidate${i}`),{round:n,index:i});if(c.id.equals(r.bestCandidate))return {index:i};}
  if(hint!==undefined)return {decision:'CANDIDATE_HINT_MISMATCH'};
  return {decision:end<r.candidateCount?'CANDIDATE_LOOKUP_REQUIRED':'SELECTED_CANDIDATE_NOT_FOUND',lookup:{roundIdHex:hex(id),bestCandidateHex:hex(r.bestCandidate),candidateCount:r.candidateCount.toString(),nextStart:end<r.candidateCount?end.toString():null}};
}

export async function planNextCompetitionRound(input){
  let ctx;try{
    fields(input,['release','abi','rpc','actor','round','maxRent','limit','candidateLookupStart','candidateLookupContext','candidateIndexHint']);const {release,abi,rpc,actor,round:n,maxRent,limit=8,candidateLookupStart,candidateLookupContext,candidateIndexHint}=input;u64(n);u64(maxRent);check(Number.isInteger(limit)&&limit>=1&&limit<=8,'COMPETITION_ROUND_LIMIT');if(candidateLookupStart!==undefined)u64(candidateLookupStart);const context=lookupOptions(candidateLookupContext);
    ctx=await initial(release,rpc,actor);const blocked=gates(ctx);if(blocked&&blocked!=='TASK_PAUSED')return result(blocked,ctx);await grow(ctx,{Round:await pda(release,'round',F,v1,le(n))});ctx.round=fresh(get(ctx,'Round'))?null:await decodeNativeRound(release,get(ctx,'Round'),n);
    const r=ctx.round;if(r?.completed){let winner=null;if(r.winner){await grow(ctx,{Winner:await pda(release,'winner',r.winner)});winner=await decodeNativeWinner(release,get(ctx,'Winner'),r.winner);}return result('ROUND_COMPLETE',ctx,{round:n,winner,winnerRecognized:winner!==null,activationRecorded:r.activation!==null,kActivationCurrentVerified:false});}
    if(blocked)return result(blocked,ctx);if(n!==ctx.facts.task.nextRound)return result('ROUND_NOT_NEXT',ctx,{round:n,nextRound:ctx.facts.task.nextRound});
    const deadline=release.rewardStart+(n+1n)*ROUND_SECONDS;if(ctx.facts.clock.unixTimestamp<deadline)return result('WAIT_ROUND_DEADLINE',ctx,{round:n,deadline});
    if(r)check(r.scanCount<=ctx.facts.task.count&&r.endCount<=ctx.facts.task.count,'COMPETITION_ROUND_SCAN_DOMAIN');
    let expectedPhase=r?.phase??0,candidateCursor=r?.candidateCursor??0n,scanCursor=r?.phase===1?r.baselineCursor:r?.scanCursor??0n,activation=null,lookup=null;let dynamic=[];
    const reset=r&&(r.phase===0||r.epoch!==ctx.facts.task.epoch);
    if(reset){candidateCursor=0n;scanCursor=0n;}
    else if(r?.phase===1){const stop=r.baselineCursor+BigInt(limit)<r.scanCount?r.baselineCursor+BigInt(limit):r.scanCount,indices=[];for(let i=r.baselineCursor;i<stop;i++)indices.push(i);const values=await addKnowledge(ctx,indices),append=dynamicAppender(ctx);for(const n of indices){append.push(ctx.keys[`Knowledge${n}`]);append.proof(values.get(n.toString()));}dynamic=append.rows;}
    else if(r?.phase===2&&r.candidateCursor<r.candidateCount){
      const {candidate}=await decodeCandidateBundle(ctx,n,r.candidateCursor),stop=r.scanCursor+BigInt(limit)<r.scanCount?r.scanCursor+BigInt(limit):r.scanCount,indices=[];for(let i=r.scanCursor;i<stop;i++)indices.push(i);
      const values=await addKnowledge(ctx,[...new Set([...indices,candidate.knowledgeIndex])]),initialRows=[ctx.keys.Candidate,ctx.keys.Commit,ctx.keys.Disclosure,ctx.keys[`Knowledge${candidate.knowledgeIndex}`]].map(address=>({address,writable:false,signer:false})),append=dynamicAppender(ctx,initialRows);
      for(const i of indices){if(i!==candidate.knowledgeIndex)append.push(ctx.keys[`Knowledge${i}`]);append.proof(values.get(i.toString()));}dynamic=append.rows;
    }else if(r?.phase===3&&r.bestCandidate){
      const selected=await selectedCandidate(ctx,n,limit,candidateLookupStart,context,candidateIndexHint);if(selected.decision)return result(selected.decision,ctx,{round:n,lookup:selected.lookup??null});
      const {candidate,commit,own}=await decodeCandidateBundle(ctx,n,selected.index,{disclosure:false});check(candidate.cost===r.bestCandidateCost&&commit.event===r.bestCommitEvent&&candidate.manufactureBusiness.equals(r.bestManufactureBusiness)&&!own.revoked,'COMPETITION_ROUND_SELECTED_LINKAGE');
      const winnerId=wid(release,n);await grow(ctx,{NewWinner:await pda(release,'winner',winnerId),Root:await pda(release,'root',candidate.instance),RootReg:await pda(release,'root-reg',candidate.instance)});check(fresh(get(ctx,'NewWinner')),'COMPETITION_ROUND_WINNER_NOT_FRESH');
      const root=await readRoot(release,get(ctx,'Root'),candidate.instance),reg=fresh(get(ctx,'RootReg'))?null:await decodeNativeRootRegistration(release,get(ctx,'RootReg'),candidate.instance);check(root.qualityPpm===2000000n&&root.schema===4&&root.cost===candidate.cost&&get(ctx,'Root').data.subarray(727,759).equals(candidate.design)&&root.createdAt<=ctx.facts.clock.unixTimestamp&&root.createdSlot<=ctx.facts.clock.slot,'COMPETITION_ROUND_ROOT_LINKAGE');
      activation=await activationBundle(ctx,{root,reg,author:candidate.author,cost:candidate.cost,winnerId});
      if(!activation.eligible&&activation.nativeEligible)return result(activation.reason,ctx,{round:n,winnerRecognized:false,activationPending:true});
      dynamic=[{address:ctx.keys.Candidate,writable:false,signer:false},{address:ctx.keys.Commit,writable:false,signer:false},{address:ctx.keys[`Knowledge${candidate.knowledgeIndex}`],writable:false,signer:false},{address:ctx.keys.NewWinner,writable:true,signer:false},{address:ctx.keys.Root,writable:false,signer:false},{address:ctx.keys.RootReg,writable:activation.eligible,signer:false}];
      if(activation.eligible){for(const name of ['Ordinary','Activation','KHistory','Registry','Event'])dynamic.push({address:ctx.keys[name],writable:name!=='Ordinary',signer:false});if(ctx.facts.slot.current)dynamic.push({address:ctx.keys.OldActivation,writable:false,signer:false});}
    }
    check(ctx.facts.task.event<MAX&&ctx.facts.task.nextRound<MAX,'COMPETITION_ROUND_COUNTER');
    const payload=new ByteWriter(102).raw(F).u32(1).u64(n).u8(expectedPhase).u64(candidateCursor).u64(scanCursor).u8(limit).raw(nativeKeyBytes(ctx.actor)).u64(maxRent).finish(),proposed=await action(ctx,abi,'FINALIZE_ROUND',payload,{Task:ctx.keys.Task,KSlot:ctx.keys.KSlot,Round:ctx.keys.Round},dynamic);
    const currentHour=boundary(ctx);await grow(ctx);if(activation?.eligible&&boundary(ctx)!==currentHour)return result('REPLAN_STALE_STATE',ctx);
    return result('ACTION',ctx,{action:proposed,round:n,phase:expectedPhase,preview:{candidateCursor,scanCursor,scanCount:r?.scanCount??0n,limit,epochReset:!!reset,winnerRecognitionOnly:!!r?.bestCandidate&&!activation?.eligible,activationPlanned:activation?.eligible??false,activationBlock:activation&&!activation.eligible?activation.reason:null,activationStart:activation?.eligible?activation.start:null},requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null});
  }catch(e){if(e.code==='COMPETITION_ROUND_REPLAN')return result('REPLAN_STALE_STATE',ctx);throw e;}
}

export async function planActivateWinner(input){
  let ctx;try{
    fields(input,['release','abi','rpc','actor','winnerId','maxRent']);const {release,abi,rpc,actor,maxRent}=input,id=Buffer.from(asBytes(input.winnerId,32));u64(maxRent);ctx=await initial(release,rpc,actor);const blocked=gates(ctx);if(blocked)return result(blocked,ctx);await grow(ctx,{Winner:await pda(release,'winner',id)});const winner=await decodeNativeWinner(release,get(ctx,'Winner'),id);
    if(winner.author!==ctx.actor)return result('WINNER_AUTHOR_REQUIRED',ctx,{winnerRecognized:true});check(winner.createdAt<=ctx.facts.clock.unixTimestamp&&winner.slot<=ctx.facts.clock.slot,'COMPETITION_WINNER_CLOCK');
    await grow(ctx,{Round:await pda(release,'round',F,v1,le(winner.round)),Root:await pda(release,'root',winner.instance),RootReg:await pda(release,'root-reg',winner.instance)});
    const round=await decodeNativeRound(release,get(ctx,'Round'),winner.round);check(round.completed&&round.winner?.equals(id),'COMPETITION_WINNER_ROUND');const root=await decodeNativeRoot(release,get(ctx,'Root'),winner.instance),reg=fresh(get(ctx,'RootReg'))?null:await decodeNativeRootRegistration(release,get(ctx,'RootReg'),winner.instance);
    check(root.cost===winner.cost&&get(ctx,'Root').data.subarray(727,759).equals(winner.design)&&root.createdAt<=ctx.facts.clock.unixTimestamp&&root.createdSlot<=ctx.facts.clock.slot,'COMPETITION_WINNER_ROOT_LINKAGE');const activation=await activationBundle(ctx,{root,reg,author:winner.author,cost:winner.cost,winnerId:id});
    if(!activation.eligible)return result(activation.reason,ctx,{winnerRecognized:true,kActivatable:false});
    const payload=new ByteWriter(48).raw(id).u64(ctx.facts.task.generation).u64(maxRent).finish(),fixed=Object.fromEntries(['Task','KSlot','Winner','Root','RootReg','Ordinary','Activation','KHistory','Registry','Event'].map(k=>[k,ctx.keys[k]])),dynamic=ctx.facts.slot.current?[{address:ctx.keys.OldActivation,writable:false,signer:false}]:[],proposed=await action(ctx,abi,'ACTIVATE_WINNER',payload,fixed,dynamic),currentHour=boundary(ctx);
    await grow(ctx);if(boundary(ctx)!==currentHour)return result('REPLAN_STALE_STATE',ctx);
    return result('ACTION',ctx,{action:proposed,winnerRecognized:true,kActivatable:true,preview:{winnerIdHex:hex(id),activationIdHex:hex(activation.id),start:activation.start,generation:ctx.facts.task.generation+1n,localSequence:activation.local,globalSequence:activation.global,beneficiary:winner.author,retainedOldActivation:ctx.facts.slot.current!==null,historicalCoverageGate:false},requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null});
  }catch(e){if(e.code==='COMPETITION_ROUND_REPLAN')return result('REPLAN_STALE_STATE',ctx);throw e;}
}

/** Public observations only: no private preimage, execution verdict or K claim. */
export async function readCompetitionState(input){
  let ctx;try{
    fields(input,['release','rpc','actor','round']);const {release,rpc,actor,round:n}=input;u64(n);ctx=await initial(release,rpc,actor);
    await grow(ctx,{Round:await pda(release,'round',F,v1,le(n))});const round=fresh(get(ctx,'Round'))?null:await decodeNativeRound(release,get(ctx,'Round'),n);
    await grow(ctx);const {task,slot,snapshot,clock}=ctx.facts,start=release.rewardStart+n*ROUND_SECONDS,elapsed=clock.unixTimestamp-release.rewardStart;
    const currentRound=elapsed<0n?null:elapsed/ROUND_SECONDS,currentOffset=elapsed<0n?null:elapsed%ROUND_SECONDS;
    const summary={...flags,decision:'OBSERVED',contextSlot:ctx.read.contextSlot.toString(),actor:ctx.actor,round:n.toString(),roundExists:round!==null,
      clock:{slot:clock.slot.toString(),unixTimestamp:clock.unixTimestamp.toString()},
      window:{roundStart:start.toString(),commitEnd:(start+ROUND_SECONDS/3n).toString(),manufactureEnd:(start+2n*ROUND_SECONDS/3n).toString(),deadline:(start+ROUND_SECONDS).toString(),currentRound:currentRound?.toString()??null,currentPhase:currentOffset===null?'BEFORE_REWARDS':currentOffset<ROUND_SECONDS/3n?'COMMIT':currentOffset<2n*ROUND_SECONDS/3n?'MANUFACTURE':'FINALIZE'},
      task:task?{event:task.event.toString(),knowledgeCount:task.count.toString(),nextRound:task.nextRound.toString(),generation:task.generation.toString(),epoch:task.epoch.toString(),opening:task.opening,paused:task.paused,best:task.best?{cost:task.best.cost.toString(),designHex:hex(task.best.design),index:task.best.index.toString()}:null}:null,
      snapshot:snapshot?{idHex:hex(snapshot.id),cutoff:snapshot.cutoff.toString(),seedCount:snapshot.seedCount.toString(),frontierCost:snapshot.best.cost.toString(),frontierDesignHex:hex(snapshot.best.design),sealed:true}:null,
      kSlot:{generation:slot.generation.toString(),referenceIdHex:slot.current?hex(slot.current):null,status:slot.status,statusName:slot.statusName??'EMPTY',currentActivationVerified:false},
      settlement:round?{idHex:hex(round.id),phase:round.phase,epoch:round.epoch.toString(),startCount:round.startCount.toString(),endCount:round.endCount.toString(),scanCount:round.scanCount.toString(),commitCount:round.commitCount.toString(),candidateCount:round.candidateCount.toString(),baselineCursor:round.baselineCursor.toString(),candidateCursor:round.candidateCursor.toString(),scanCursor:round.scanCursor.toString(),bestCandidateHex:round.bestCandidate?hex(round.bestCandidate):null,completed:round.completed,winnerIdHex:round.winner?hex(round.winner):null,activationRecordedIdHex:round.activation?hex(round.activation):null}:null};
    return summary;
  }catch(e){if(e.code==='COMPETITION_ROUND_REPLAN')return {...flags,decision:'REPLAN_STALE_STATE',contextSlot:(ctx?.read.contextSlot??0n).toString()};throw e;}
}
