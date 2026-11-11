import { isOffCurveAddress } from '@solana/kit';
import { asBytes, ByteWriter } from '../../protocol-core/src/index.mjs';
import { H_END } from '../../settlement/src/emission.mjs';
import { ReadOnlyRpc } from './rpc.mjs';
import { PROGRAMS, baseConfigR2Id } from './release.mjs';
import { nativePda, nativeKeyAddress, nativeKeyBytes, nativeOperation, encodeNativeFrame,
  encodeExitOrdinaryPayload, encodeTransferRootPayload, buildNativeInstruction } from './native.mjs';
import { decodeNativeBaseConfig, decodeNativeRoot, decodeNativeRegistry,
  decodeNativePosition, decodeNativeActivation } from './accounts.mjs';
import { decodeNativeEconomyConfig, decodeNativeClock, decodeNativeRootRegistration } from './economy-accounts.mjs';
import { decodeNativeOriginalityTask, decodeNativeKSlot } from './originality-accounts.mjs';
import { TASK_FAMILY } from '../../originality/src/wire.mjs';
import { decodeActorNonceSnapshot } from './journal.mjs';

const MAX=(1n<<64n)-1n;
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const le=n=>new ByteWriter(8).u64(n).finish();
const pda=(r,...s)=>nativePda(r.input.programId,'bio',...s).then(v=>v.address);
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&a.lamports===b.lamports&&asBytes(a.data).equals(asBytes(b.data));
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,reservesOnChainNonce:false,readStateVerified:true,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null};
const state=(decision,contextSlot,extra={})=>({decision,contextSlot,...flags,...extra});
const boundary=(clock,economy)=>clock.unixTimestamp<economy.rewardStart?0n:(clock.unixTimestamp-economy.rewardStart)/3600n;
const min=(a,b)=>a<b?a:b,max=(a,b)=>a>b?a:b;
function args(value){
  const required=['release','abi','rpc','actor','instance','kind','maxRent'],allowed=[...required,'newOwner'];
  check(value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).every(k=>typeof k==='string'&&allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'LIFECYCLE_FIELDS');
  check(value.kind==='exit'||value.kind==='transfer','LIFECYCLE_KIND');
  check(value.kind==='transfer'?Object.hasOwn(value,'newOwner'):!Object.hasOwn(value,'newOwner'),'LIFECYCLE_NEW_OWNER_FIELDS');
  check(typeof value.maxRent==='bigint'&&value.maxRent>=0n&&value.maxRent<=MAX,'LIFECYCLE_MAX_RENT');
  check(value.rpc instanceof ReadOnlyRpc,'LIFECYCLE_READ_ONLY_RPC');
  check(value.abi?.hash===value.release.hashes.abiHash.toString('hex'),'LIFECYCLE_ABI');
  nativeOperation(value.abi,value.kind==='exit'?'EXIT_ORDINARY':'TRANSFER_ROOT');
}
function wallet(account,address,code,{allowMissing=false}={}){
  if(account===null){check(allowMissing,code);return;}
  check(account.address===address&&account.owner===PROGRAMS.systemProgram&&account.executable===false&&asBytes(account.data).length===0&&!isOffCurveAddress(address),code);
}
async function batch(rpc,keys){
  const addresses=[...new Set(Object.values(keys))];check(addresses.length<=15,'LIFECYCLE_ACCOUNT_BOUND');
  const {contextSlot,accounts}=await rpc.getMultipleAccounts(addresses);return {contextSlot,accounts:new Map(addresses.map((key,i)=>[key,accounts[i]]))};
}
async function common(release,actor,id,keys,read){
  const get=name=>read.accounts.get(keys[name]);await decodeNativeBaseConfig(release,get('Base'));
  const economy=await decodeNativeEconomyConfig(release,get('Economy')),clock=decodeNativeClock(get('Clock'));
  wallet(get('Actor'),actor,'LIFECYCLE_ACTOR_WALLET');
  check(clock.unixTimestamp>=economy.initializedAt,'LIFECYCLE_CLOCK_BEFORE_INIT');
  const nonce=await decodeActorNonceSnapshot({release,actor,address:keys.Nonce,account:get('Nonce'),contextSlot:read.contextSlot,commitment:'finalized'}),root=await decodeNativeRoot(release,get('Root'),id),registrationExists=!fresh(get('RootReg')),registryExists=!fresh(get('Registry'));
  const registration=registrationExists?await decodeNativeRootRegistration(release,get('RootReg'),id):null,registry=registryExists?await decodeNativeRegistry(release,get('Registry')):null;
  if(registration?.ordinaryCount>0n)check(registry&&registration.directorySequence<registry.rootCount,'LIFECYCLE_REGISTRY_DIRECTORY');
  return {economy,clock,nonce,root,registration,registry,registrationExists,registryExists};
}
function compare(first,last,keys){
  check(last.facts.clock.slot>=first.facts.clock.slot&&last.facts.clock.unixTimestamp>=first.facts.clock.unixTimestamp,'LIFECYCLE_CLOCK_REGRESSION');
  check(last.facts.nonce.nextNonce>=first.facts.nonce.nextNonce,'LIFECYCLE_NONCE_REGRESSION');
  if(boundary(first.facts.clock,first.facts.economy)!==boundary(last.facts.clock,last.facts.economy))return 'CLOCK_BOUNDARY_CHANGED';
  if((first.facts.clock.unixTimestamp<first.facts.economy.rewardStart)!==(last.facts.clock.unixTimestamp<last.facts.economy.rewardStart))return 'REWARD_START_CHANGED';
  for(const [name,address]of Object.entries(keys))if(name!=='Clock'&&!same(first.read.accounts.get(address),last.read.accounts.get(address)))return `${name.toUpperCase()}_CHANGED`;
  return null;
}
async function dependent(release,id,keys,read,facts){
  const get=n=>read.accounts.get(keys[n]),rr=facts.registration;let position=null,task=null,slot=null,activation=null;
  if(keys.Position){position=await decodeNativePosition(release,get('Position'),id,rr.ordinaryCount-1n);check(position.rootDirectorySeq===rr.directorySequence&&position.positionId.equals(rr.lastPositionId)&&position.end===rr.ordinaryEnd&&position.rootRevision<=facts.root.revision&&position.createdTime>=facts.root.createdAt&&position.createdSlot>=facts.root.createdSlot,'LIFECYCLE_POSITION_LINK');}
  if(keys.Task){
    task=await decodeNativeOriginalityTask(release,get('Task'));slot=await decodeNativeKSlot(release,get('KSlot'),{generation:task.generation});activation=await decodeNativeActivation(release,get('Activation'),rr.lastActivationId);
    check(slot.status===1&&slot.current?.equals(activation.id)&&activation.instance.equals(id)&&activation.author.equals(nativeKeyBytes(facts.root.owner))&&activation.ordinaryPosition.equals(position.positionId)&&activation.author.equals(position.beneficiary)&&activation.local<MAX&&activation.local+1n===rr.activationCount&&activation.end===null&&rr.kEnd===null&&activation.start>=position.start,'LIFECYCLE_K_LINK');
    check(activation.generation<=task.generation&&activation.body.readBigUInt64LE(202)<=task.event&&activation.global<facts.registry.nextKSequence&&activation.global<facts.registry.nextKScanSequence,'LIFECYCLE_K_COUNTERS');
    check(facts.root.schema===4&&facts.root.qualityPpm===2000000n&&facts.root.admission===1,'LIFECYCLE_K_ROOT');
  }
  return {position,task,slot,activation};
}

/** Actual-state EXIT/TRANSFER proposal. This does not reserve a nonce or pay,
 * stop, transfer, claim or otherwise execute a transaction. */
export async function planPlayerLifecycleAction(input){
  args(input);const {release,abi,rpc,kind,maxRent}=input,actor=nativeKeyAddress(input.actor),id=Buffer.from(asBytes(input.instance,32));
  check(actor!==PROGRAMS.systemProgram&&!isOffCurveAddress(actor),'LIFECYCLE_ACTOR');
  const newOwner=kind==='transfer'?nativeKeyAddress(input.newOwner):null;
  if(newOwner!==null)check(!isOffCurveAddress(newOwner)&&![actor,PROGRAMS.systemProgram,PROGRAMS.tokenProgram,release.input.programId].includes(newOwner),'LIFECYCLE_NEW_OWNER');
  const keys={Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar,Nonce:await pda(release,'actor-nonce',nativeKeyBytes(actor)),Actor:actor,Root:await pda(release,'root',id),RootReg:await pda(release,'root-reg',id),Registry:await pda(release,'mining')};
  if(newOwner!==null)keys.Recipient=newOwner;
  const discovery=await batch(rpc,keys),firstFacts=await common(release,actor,id,keys,discovery),first={read:discovery,facts:firstFacts},known={...keys},rr0=firstFacts.registration,rg0=firstFacts.registry;
  if(rr0?.ordinaryCount>0n)keys.Position=await pda(release,'reg',id,le(rr0.ordinaryCount-1n));
  if(kind==='exit'&&rr0?.ordinaryCount>0n&&rr0.ordinaryEnd===null){
    check(rg0,'LIFECYCLE_REGISTRY_REQUIRED');
    if(rr0.kEnd===null){
      keys.Task=await pda(release,'task',TASK_FAMILY);keys.KSlot=await pda(release,'k-slot',TASK_FAMILY);keys.Activation=await pda(release,'activation',rr0.lastActivationId);
      if(rg0.eventCount<=MAX-2n){keys.KEndEvent=await pda(release,'mining-event',le(rg0.eventCount));keys.OrdinaryEndEvent=await pda(release,'mining-event',le(rg0.eventCount+1n));}
    }else if(rg0.eventCount<MAX)keys.OrdinaryEndEvent=await pda(release,'mining-event',le(rg0.eventCount));
  }
  const expanded=await batch(rpc,keys),middleFacts=await common(release,actor,id,keys,expanded),middle={read:expanded,facts:middleFacts};
  const stale1=compare(first,middle,known);if(stale1)return state('REPLAN_STALE_STATE',expanded.contextSlot,{kind,actor,instance:id,reason:stale1});
  await dependent(release,id,keys,expanded,middleFacts);
  const final=await batch(rpc,keys),facts=await common(release,actor,id,keys,final),last={read:final,facts};
  const stale2=compare(middle,last,keys);if(stale2)return state('REPLAN_STALE_STATE',final.contextSlot,{kind,actor,instance:id,reason:stale2});
  const dep=await dependent(release,id,keys,final,facts),{root,registration:rr,registry:rg,clock,economy}=facts,current=boundary(clock,economy),get=n=>final.accounts.get(keys[n]);
  const commonFacts={kind,actor,instance:id,nextNonce:facts.nonce.nextNonce,root,registration:rr,registry:rg,currentBoundary:current,preservesHistoricalBeneficiaries:true,historicalDebtMustBeClaimed:false};
  const blocked=(decision,extra={})=>state(decision,final.contextSlot,{...commonFacts,...extra});
  if(newOwner!==null)wallet(get('Recipient'),newOwner,'LIFECYCLE_RECIPIENT_WALLET',{allowMissing:true});
  if(root.owner!==actor)return blocked('OWNER_MISMATCH');
  if(root.lifecycle!==0)return blocked('INPUT_ALREADY_CONSUMED');
  if(rr?.certificateFault)return blocked('CERTIFICATE_FAULT');
  if(clock.unixTimestamp<root.createdAt||clock.slot<root.createdSlot||rg&&clock.unixTimestamp<rg.highWater||rr?.revocationCause&& (rr.revocationTime>clock.unixTimestamp||rr.revocationSlot>clock.slot))return blocked('WAIT_CLOCK');
  check(facts.nonce.nextNonce<MAX,'LIFECYCLE_NONCE_EXHAUSTED');
  let operation,payload,fixed,dynamicAccounts=[],ordinaryEnd=rr?.ordinaryEnd??0n,kEnd=rr?.kEnd??0n,events=[];
  if(kind==='exit'){
    if(!rr||rr.ordinaryCount===0n)return blocked('NO_POSITION');
    if(rr.ordinaryEnd!==null)return blocked('ALREADY_EXITED');
    const position=dep.position;check(position.end===null&&position.rootRevision===root.revision,'LIFECYCLE_CURRENT_POSITION');
    if(clock.unixTimestamp<economy.rewardStart||current<position.start)return blocked('WAIT_POSITION_START',{start:position.start});
    if(clock.unixTimestamp<position.createdTime||clock.slot<position.createdSlot)return blocked('WAIT_CLOCK');
    check(rr.revision<MAX&&current<MAX,'LIFECYCLE_COUNTER_EXHAUSTED');ordinaryEnd=current+1n;
    const ordinaryDue=min(ordinaryEnd,H_END);
    if(rr.kEnd===null){
      const {task,activation}=dep;check(task.event<MAX&&task.generation<MAX&&rg.eventCount<=MAX-2n,'LIFECYCLE_COUNTER_EXHAUSTED');
      if(clock.unixTimestamp<task.highWater||clock.unixTimestamp<activation.body.readBigInt64LE(218)||clock.slot<activation.body.readBigUInt64LE(210))return blocked('WAIT_CLOCK');
      kEnd=max(min(current+1n,H_END),activation.start);
      check(rg.lastEventDue<=kEnd&&rg.nextHour<=kEnd&&kEnd<=ordinaryDue,'LIFECYCLE_EVENT_ORDER');
      check(fresh(get('KEndEvent'))&&fresh(get('OrdinaryEndEvent')),'LIFECYCLE_EVENT_NOT_FRESH');
      dynamicAccounts=[{address:keys.Task,writable:true,signer:false},{address:keys.KSlot,writable:true,signer:false},{address:keys.Activation,writable:true,signer:false},{address:keys.KEndEvent,writable:true,signer:false}];
      events=[{kind:'K_END',sequence:rg.eventCount,due:kEnd},{kind:'ORDINARY_END',sequence:rg.eventCount+1n,due:ordinaryDue}];
    }else{
      check(rg.eventCount<MAX,'LIFECYCLE_COUNTER_EXHAUSTED');check(rg.lastEventDue<=ordinaryDue&&rg.nextHour<=ordinaryDue,'LIFECYCLE_EVENT_ORDER');
      check(fresh(get('OrdinaryEndEvent')),'LIFECYCLE_EVENT_NOT_FRESH');events=[{kind:'ORDINARY_END',sequence:rg.eventCount,due:ordinaryDue}];
    }
    operation='EXIT_ORDINARY';payload=encodeExitOrdinaryPayload({instance:id,positionSeq:rr.ordinaryCount-1n,rootRevision:root.revision,maxRent});
    fixed={Registry:keys.Registry,Root:keys.Root,RootReg:keys.RootReg,Position:keys.Position,OrdinaryEndEvent:keys.OrdinaryEndEvent};
  }else{
    if(rr){
      if(rr.kEnd===null)return blocked('K_AWARE_EXIT_REQUIRED');
      if(rr.ordinaryEnd===null)return blocked('ORDINARY_EXIT_REQUIRED');
      if(current<rr.kEnd)return blocked('WAIT_K_END',{end:rr.kEnd});
      if(current<rr.ordinaryEnd)return blocked('WAIT_ORDINARY_END',{end:rr.ordinaryEnd});
      if(rr.coverageSequence!==rr.ordinaryCount||rr.nextCoverageHour!==MAX)return blocked('HISTORICAL_COVERAGE_REQUIRED');
      if(dep.position)check(dep.position.nextUnsettledHour===min(dep.position.end,H_END),'LIFECYCLE_COVERED_POSITION');
    }
    check(root.revision<MAX&&(!rr||rr.revocationCause!==0||rr.revision<MAX),'LIFECYCLE_COUNTER_EXHAUSTED');
    operation='TRANSFER_ROOT';payload=encodeTransferRootPayload({instance:id,rootRevision:root.revision,registrationRevision:rr?.revision??0n,newOwner,maxRent});
    fixed={Registry:keys.Registry,Root:keys.Root,RootReg:keys.RootReg};
  }
  const suffix=nativeOperation(abi,operation).publicFixedSuffix.map(r=>({name:r.role,address:fixed[r.role]})),nonce=facts.nonce.nextNonce;
  const frame=encodeNativeFrame(abi,{operation,domain:release.domain,configId:baseConfigR2Id(release),actor,nonce,payload}),instruction=await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts});
  const action={clientPlanOnly:true,operation,nonce,payload,suffix,dynamicAccounts,frame,instruction};
  const preview={instance:id,kind,oldOwner:root.owner,newOwner:kind==='transfer'?newOwner:root.owner,rootRevision:root.revision,nextRootRevision:kind==='transfer'?root.revision+1n:root.revision,registrationRevision:rr?.revision??0n,nextRegistrationRevision:kind==='exit'||!rr||rr.revocationCause===0?(rr?.revision??0n)+1n:rr.revision,ordinaryEnd,kEnd,positionSequence:rr?.ordinaryCount>0n?rr.ordinaryCount-1n:null,beneficiary:dep.position?.beneficiaryAddress??null,lastPositionUnpaid:dep.position?dep.position.accrued-dep.position.paid:0n,historicalPositionCount:rr?.ordinaryCount??0n,events,preservesHistoricalBeneficiaries:true,historicalDebtMustBeClaimed:false};
  return state('ACTION',final.contextSlot,{...commonFacts,action,preview});
}
