import {isOffCurveAddress} from '@solana/kit';
import {asBytes,ByteWriter,sha256,typedHash} from '../../protocol-core/src/index.mjs';
import {encodeGraph} from '../../biology/src/graph.mjs';
import {decodeSynthesisPayload,encodeSynthesisPayload,encodeLeafMap} from '../../composition/src/payload.mjs';
import {ReadOnlyRpc} from './rpc.mjs';
import {baseConfigR2Id,PROGRAMS} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda} from './native.mjs';
import {decodeActorNonceSnapshot} from './journal.mjs';
import {decodeNativeBaseConfig,decodeNativeAccountRecord,decodeNativeRoot,decodeNativeRegistry,decodeNativeActivation,decodeNativePosition,decodeClassicMint,decodeClassicTokenAccount} from './accounts.mjs';
import {decodeNativeEconomyConfig,decodeNativeClock,decodeNativeTreasury,validateNativeTreasuryBalances,decodeNativeRootRegistration} from './economy-accounts.mjs';
import {decodeNativeSealedSynthesisArtifact,decodeNativeSynthesisVerification,planSynthesisPayload,planSynthesisRegistration,planSynthesisFinalization} from './synthesis-workflow.mjs';
import {H_END} from '../../settlement/src/emission.mjs';

const MAX=(1n<<64n)-1n,FAMILY=Buffer.from('a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe','hex');
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const hex=b=>Buffer.from(b).toString('hex'),zero=b=>b.every(v=>v===0);
const pda=(r,...seeds)=>nativePda(r.input.programId,'bio',...seeds).then(v=>v.address);
const le=n=>new ByteWriter(8).u64(n).finish(),v1=new ByteWriter(4).u32(1).finish();
const u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'SYN_FINAL_U64');return n;};
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,reservesOnChainNonce:false};
const state=(decision,contextSlot,extra={})=>({...flags,decision,contextSlot,...extra});
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&a.lamports===b.lamports&&asBytes(a.data).equals(asBytes(b.data));
const stable=(before,after,keys)=>Object.keys(keys).filter(k=>k!=='Clock').every(k=>same(before.accounts.get(keys[k]),after.accounts.get(keys[k])));
async function batch(rpc,keys){const addresses=[...new Set(Object.values(keys))];check(addresses.length<=100,'SYN_FINAL_ACCOUNT_BOUND');const {accounts,contextSlot}=await rpc.getMultipleAccounts(addresses);return {contextSlot,accounts:new Map(addresses.map((a,i)=>[a,accounts[i]]))};}
function planCopy(release,actor,plan){
  const bytes=Buffer.from(asBytes(plan?.bytes)),payload=decodeSynthesisPayload(bytes),artifactSHA=sha256(bytes),graphSHA=sha256(encodeGraph(payload.graph));
  check(encodeSynthesisPayload(payload).equals(bytes),'SYN_FINAL_CANONICAL_PAYLOAD');
  const artifactId=typedHash(19,new ByteWriter(134).raw(release.domain).raw(baseConfigR2Id(release)).raw(nativeKeyBytes(actor)).u16(702).u32(bytes.length).raw(artifactSHA).finish());
  check(plan.actor===actor&&plan.domainHex===hex(release.domain)&&plan.configHex===hex(baseConfigR2Id(release))&&asBytes(plan.artifactId,32).equals(artifactId)&&asBytes(plan.artifactSHA,32).equals(artifactSHA)&&asBytes(plan.graphSHA,32).equals(graphSHA),'SYN_FINAL_PLAN_CONTEXT');
  return {bytes,payload,artifactId,artifactSHA,graphSHA,target:payload.graph.target};
}
async function taskFacts(release,account){
  if(fresh(account))return {count:0n,event:0n,generation:0n,best:null,high:0n};
  const r=await decodeNativeAccountRecord(release,account,{kind:30,schemas:[1],seeds:['bio','task',FAMILY],recordKey:FAMILY,maxBodyBytes:135}),b=r.body;
  check(b.length===135&&b.subarray(0,32).equals(FAMILY)&&b.readUInt32LE(32)===1&&b[60]<=1&&b[117]<=1&&b[118]<=1&&b.readBigInt64LE(127)>=0n,'SYN_FINAL_TASK');
  const count=b.readBigUInt64LE(44),best=b[60]?b.readBigUInt64LE(61):null;
  check(best===null?zero(b.subarray(61,109)):best>0n&&b.readBigUInt64LE(101)<count,'SYN_FINAL_TASK_BEST');
  return {count,event:b.readBigUInt64LE(36),generation:b.readBigUInt64LE(109),best,high:b.readBigInt64LE(127)};
}
async function slotFacts(release,account,task){
  if(fresh(account))return {activation:null};
  const r=await decodeNativeAccountRecord(release,account,{kind:34,schemas:[1],seeds:['bio','k-slot',FAMILY],recordKey:FAMILY,maxBodyBytes:74}),b=r.body;
  check(b.length===74&&b.subarray(0,32).equals(FAMILY)&&b.readBigUInt64LE(32)===task.generation&&b[40]<=1&&b[73]<=4&&((b[40]===0)===(b[73]===0)),'SYN_FINAL_K_SLOT');
  check(b[40]===1||zero(b.subarray(41,73)),'SYN_FINAL_K_SLOT_REF');return {activation:b[40]?Buffer.from(b.subarray(41,73)):null};
}
async function basic(release,actor,frozen,read,keys){
  const a=n=>read.accounts.get(keys[n]);await decodeNativeBaseConfig(release,a('Base'));const economy=await decodeNativeEconomyConfig(release,a('Economy')),clock=decodeNativeClock(a('Clock'));
  const wallet=a('Actor');check(wallet&&wallet.address===actor&&wallet.owner===PROGRAMS.systemProgram&&!wallet.executable&&asBytes(wallet.data).length===0&&!isOffCurveAddress(actor),'SYN_FINAL_ACTOR_WALLET');
  const nonce=await decodeActorNonceSnapshot({release,actor,address:keys.Nonce,account:a('Nonce'),contextSlot:read.contextSlot,commitment:'finalized'});
  const verification=await decodeNativeSynthesisVerification(release,a('Verification'),{actor,artifactId:frozen.artifactId,artifactSHA:frozen.artifactSHA,contextSlot:read.contextSlot});
  const artifact=await decodeNativeSealedSynthesisArtifact(release,a('Artifact'),{expectedId:frozen.artifactId});
  check(artifact.owner===actor&&artifact.bytes.equals(frozen.bytes)&&verification.artifactLength===frozen.bytes.length&&verification.graphSHA.equals(frozen.graphSHA)&&verification.target===frozen.target,'SYN_FINAL_ARTIFACT');
  check(Number.isInteger(verification.challengePpm)&&verification.challengePpm>=500000&&verification.challengePpm<=2000000&&verification.challengePpm%1000===0&&(![3,9,14,15,21].includes(frozen.target)||verification.challengePpm===2000000),'SYN_FINAL_CHALLENGE');
  const d=a('Verification').data,graphLength=frozen.bytes.readUInt32LE(16),directAt=21+graphLength,leafAt=directAt+74*frozen.payload.direct.length;
  check(d.readUInt32LE(196)===20&&d.readUInt32LE(200)===graphLength&&d.readUInt32LE(204)===leafAt&&d[208]===frozen.payload.leaves.length&&d[209]===frozen.payload.direct.length
    &&d.subarray(212,244).equals(sha256(frozen.bytes.subarray(directAt,leafAt)))&&d.subarray(244,276).equals(sha256(encodeLeafMap(frozen.payload.leaves)))
    &&d.readBigUInt64LE(308)===BigInt(frozen.payload.leaves.length)*120000n&&d.readBigUInt64LE(316)===BigInt(frozen.payload.leaves.length)*45000n,'SYN_FINAL_VERIFIED_PAYLOAD');
  check(verification.clock<=clock.unixTimestamp&&a('Artifact').data.readBigInt64LE(235)<=clock.unixTimestamp&&a('Artifact').data.readBigUInt64LE(243)<=clock.slot,'SYN_FINAL_CLOCK');
  const task=await taskFacts(release,a('Task'));check(clock.unixTimestamp>=task.high,'SYN_FINAL_TASK_CLOCK');
  const slot=verification.taskApplicable?await slotFacts(release,a('KSlot'),task):{activation:null};
  return {clock,economy,nonce,verification,task,slot};
}
function forward(first,last){check(last.clock.slot>=first.clock.slot&&last.clock.unixTimestamp>=first.clock.unixTimestamp&&last.nonce.nextNonce>=first.nonce.nextNonce,'SYN_FINAL_OBSERVATION_REGRESSION');}
async function finalRecords(release,actor,frozen,read,keys,facts){
  const get=n=>read.accounts.get(keys[n]),freshDirectInputs=[],boundary=facts.clock.unixTimestamp<facts.economy.rewardStart?0n:(facts.clock.unixTimestamp-facts.economy.rewardStart)/3600n;
  const blocks=[];
  for(let i=0;i<frozen.payload.direct.length;i++){
    const id=frozen.payload.direct[i].instance,account=get(`Root${i}`),rr=get(`RootReg${i}`),root=await decodeNativeRoot(release,account,id);
    check(root.createdAt<=facts.clock.unixTimestamp&&root.createdSlot<=facts.clock.slot,'SYN_FINAL_ROOT_CLOCK');
    let reason=root.owner!==actor?'OWNER_MISMATCH':root.lifecycle!==0?'INPUT_ALREADY_CONSUMED':null;
    if(!fresh(rr)){
      const reg=await decodeNativeRootRegistration(release,rr,id);
      reason??=reg.certificateFault?'CERTIFICATE_FAULT':reg.ordinaryEnd===null?'ORDINARY_INTERVAL_OPEN':reg.kEnd===null?'K_INTERVAL_OPEN':boundary<reg.ordinaryEnd?'WAIT_ORDINARY_END':boundary<reg.kEnd?'WAIT_K_END':reg.coverageSequence!==reg.ordinaryCount||reg.nextCoverageHour!==MAX?'HISTORY_COVERAGE_REQUIRED':null;
    }
    if(reason)blocks.push({instanceHex:hex(id),reason});
    freshDirectInputs.push({instance:Buffer.from(id),account,rootReg:fresh(rr)?null:rr,...(root.schema>1?{originalArtifact:get(`ParentArtifact${i}`)}:{})});
  }
  if(blocks.length)return {decision:'INPUTS_NOT_MOVABLE',blocks};
  const currentPlan=await planSynthesisPayload({release,actor,graph:frozen.payload.graph,directInputs:freshDirectInputs});
  check(currentPlan.bytes.equals(frozen.bytes),'SYN_FINAL_DIRECT_CHANGED');
  const mint=decodeClassicMint(get('LABMint'),{expectedAddress:keys.LABMint,expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null});
  const reserve=decodeClassicTokenAccount(get('Reserve'),{expectedAddress:keys.Reserve,expectedMint:keys.LABMint,expectedOwner:release.pdas.labAuthority.address,reserve:true});
  const treasury=await decodeNativeTreasury(release,get('Treasury'));validateNativeTreasuryBalances(release,treasury,{mint,reserve});
  const source=fresh(get('LABSource'))?null:decodeClassicTokenAccount(get('LABSource'),{expectedAddress:keys.LABSource,expectedMint:keys.LABMint,expectedOwner:actor});
  if(source)check(source.amount<=mint.supply,'SYN_FINAL_LAB_SUPPLY');
  if(source===null||source.amount<currentPlan.materialFeeAtoms)return {decision:'LAB_BALANCE_INSUFFICIENT',requiredFeeAtoms:currentPlan.materialFeeAtoms,availableLABAtoms:source?.amount??0n};
  const round=facts.clock.unixTimestamp<facts.economy.rewardStart?null:(facts.clock.unixTimestamp-facts.economy.rewardStart)/259200n;
  if(round===null)return {decision:'WAIT_REWARD_START',rewardStart:facts.economy.rewardStart};
  if(!fresh(get('Round'))){const id=typedHash(9,Buffer.concat([release.domain,FAMILY,v1,le(round)])),r=await decodeNativeAccountRecord(release,get('Round'),{kind:15,schemas:[2],seeds:['bio','round',FAMILY,v1,le(round)],recordKey:id,maxBodyBytes:389}),b=r.body;
    check(b.length===389&&b.subarray(0,32).equals(FAMILY)&&b.readUInt32LE(32)===1&&b.readBigUInt64LE(36)===round&&b[44]<=2&&b[117]<=4&&b[134]<=1&&b.readBigUInt64LE(85)<=b.readBigUInt64LE(93)&&(b[44]===1||zero(b.subarray(45,85))),'SYN_FINAL_ROUND');
    if(b[117]===4)return {decision:'ROUND_ALREADY_FINALIZED',round};
  }
  if(!fresh(get('Disclosure'))){const did=typedHash(8,Buffer.concat([release.domain,facts.verification.semantic])),r=await decodeNativeAccountRecord(release,get('Disclosure'),{kind:14,schemas:[1],seeds:['bio','disclosure',did],recordKey:did,maxBodyBytes:217}),b=r.body;
    check(b.length===217&&b.subarray(0,32).equals(facts.verification.semantic)&&b.subarray(184,216).equals(FAMILY)&&b[216]>=1&&b[216]<=22&&b.readBigUInt64LE(128)>0n&&b.readBigUInt64LE(128)<=facts.task.event&&b.readBigUInt64LE(136)<=facts.clock.slot&&b.readBigInt64LE(144)>=0n&&b.readBigInt64LE(144)<=facts.clock.unixTimestamp,'SYN_FINAL_DISCLOSURE');
  }
  const touched=(fresh(get('Disclosure'))?1n:0n)+(facts.verification.taskApplicable?1n:0n);check(facts.task.event<=MAX-touched,'SYN_FINAL_TASK_COUNTER');
  if(facts.verification.taskApplicable){check(facts.task.count<MAX&&fresh(get('Knowledge')),'SYN_FINAL_KNOWLEDGE_NOT_FRESH');if(facts.task.best===null||facts.verification.cost<facts.task.best)check(facts.task.generation<MAX,'SYN_FINAL_TASK_COUNTER');}
  const registry=fresh(get('Registry'))?null:await decodeNativeRegistry(release,get('Registry'));
  if(registry)check(facts.clock.unixTimestamp>=registry.highWater,'SYN_FINAL_REGISTRY_CLOCK');
  return {decision:'READY',currentPlan,freshDirectInputs,source,registry,round};
}
async function priorPosition(release,rpc,activation,registration,start){
  const count=registration.ordinaryCount;check(count>0n,'SYN_FINAL_K_POSITION_COUNT');let cursor=start===undefined?count:u64(start);check(cursor<=count,'SYN_FINAL_K_LOOKUP_CURSOR');
  let scanned=0;
  while(cursor>0n&&scanned<256){
    const sequence=cursor-1n,id=typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(27).finish(),activation.instance,le(sequence)]));
    if(id.equals(activation.ordinaryPosition)){
      const address=await pda(release,'reg',activation.instance,le(sequence)),read=await rpc.getMultipleAccounts([address]),value=await decodeNativePosition(release,read.accounts[0],activation.instance,sequence);
      check(value.positionId.equals(activation.ordinaryPosition)&&value.rootDirectorySeq===registration.directorySequence,'SYN_FINAL_K_DIRECTORY');return {found:true,sequence,address,value};
    }
    cursor--;scanned++;
  }
  return {found:false,lookup:{activationIdHex:hex(activation.id),rootInstanceHex:hex(activation.instance),positionIdHex:hex(activation.ordinaryPosition),nextStart:cursor>0n?cursor.toString():null,ordinaryCount:count.toString()}};
}

/** Actual finalized dependency closure for one ordinary FINAL proposal. The
 * expected verification identity is never used as q/PASS or account authority. */
export async function planActualSynthesisFinalization(input){
  check(input&&Object.keys(input).every(k=>['release','abi','rpc','actor','plan','verification','maxRent','maxFee','positionLookupStart','positionLookupContext'].includes(k)),'SYN_FINAL_FIELDS');
  const {release,abi,rpc,plan,verification,maxRent,maxFee,positionLookupStart,positionLookupContext}=input;check(rpc instanceof ReadOnlyRpc,'SYN_FINAL_RPC');u64(maxRent);u64(maxFee);if(positionLookupStart!==undefined)u64(positionLookupStart);
  let lookupContext=null;if(positionLookupContext!==undefined){
    const c=positionLookupContext;check(c&&Object.getPrototypeOf(c)===Object.prototype&&Object.keys(c).sort().join(',')==='activationIdHex,ordinaryCount,positionIdHex,rootInstanceHex'
      &&['activationIdHex','positionIdHex','rootInstanceHex'].every(k=>typeof c[k]==='string'&&/^[0-9a-f]{64}$/.test(c[k]))&&typeof c.ordinaryCount==='string'&&/^(0|[1-9][0-9]*)$/.test(c.ordinaryCount)&&c.ordinaryCount.length<=20,'SYN_FINAL_K_LOOKUP_CONTEXT');u64(BigInt(c.ordinaryCount));lookupContext={...c};
  }
  const actor=nativeKeyAddress(input.actor),frozen=planCopy(release,actor,plan),expected={generation:u64(verification?.generation),artifactId:Buffer.from(asBytes(verification?.artifactId,32)),artifactSHA:Buffer.from(asBytes(verification?.artifactSHA,32))};
  check(expected.artifactId.equals(frozen.artifactId)&&expected.artifactSHA.equals(frozen.artifactSHA),'SYN_FINAL_EXPECTED_VERIFICATION');
  const keys={Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar,Nonce:await pda(release,'actor-nonce',nativeKeyBytes(actor)),Actor:actor,Verification:await pda(release,'verify',nativeKeyBytes(actor)),Artifact:await pda(release,'artifact',frozen.artifactId),Task:await pda(release,'task',FAMILY),KSlot:await pda(release,'k-slot',FAMILY),Registry:await pda(release,'mining'),LABMint:release.pdas.labMint.address,Reserve:release.pdas.labReserve.address,Treasury:await pda(release,'treasury')};
  keys.LABSource=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(keys.LABMint))).address;
  for(const [i,d]of frozen.payload.direct.entries()){keys[`Root${i}`]=await pda(release,'root',d.instance);keys[`RootReg${i}`]=await pda(release,'root-reg',d.instance);}
  let read=await batch(rpc,keys),facts=await basic(release,actor,frozen,read,keys);
  const common={actor,target:frozen.target,knownInputsOnly:true};
  if(facts.verification.generation!==expected.generation)return state('REPLAN_STALE_STATE',read.contextSlot,common);
  if(facts.verification.used)return state('VERIFICATION_ALREADY_USED',read.contextSlot,common);
  if(facts.verification.phase!==6||facts.verification.physicsRound!==73)return state('VERIFICATION_INCOMPLETE',read.contextSlot,common);
  if(facts.clock.unixTimestamp<facts.economy.rewardStart)return state('WAIT_REWARD_START',read.contextSlot,{...common,rewardStart:facts.economy.rewardStart});
  const round=(facts.clock.unixTimestamp-facts.economy.rewardStart)/259200n;
  keys.Round=await pda(release,'round',FAMILY,v1,le(round));keys.Disclosure=await pda(release,'disclosure',typedHash(8,Buffer.concat([release.domain,facts.verification.semantic])));
  if(facts.verification.taskApplicable)keys.Knowledge=await pda(release,'knowledge',FAMILY,le(facts.task.count));
  if(facts.slot.activation)keys.PriorActivation=await pda(release,'activation',facts.slot.activation);
  for(let i=0;i<frozen.payload.direct.length;i++){const root=await decodeNativeRoot(release,read.accounts.get(keys[`Root${i}`]),frozen.payload.direct[i].instance);if(root.schema>1)keys[`ParentArtifact${i}`]=await pda(release,'artifact',read.accounts.get(keys[`Root${i}`]).data.subarray(443,475));}
  const previousKeys={...keys};for(const k of ['Round','Disclosure','Knowledge','PriorActivation',...Object.keys(keys).filter(k=>k.startsWith('ParentArtifact'))])delete previousKeys[k];
  const expanded=await batch(rpc,keys),nextFacts=await basic(release,actor,frozen,expanded,keys);forward(facts,nextFacts);
  if(!stable(read,expanded,previousKeys)||(nextFacts.clock.unixTimestamp-nextFacts.economy.rewardStart)/259200n!==round)return state('REPLAN_STALE_STATE',expanded.contextSlot,common);
  read=expanded;facts=nextFacts;let activation=null,positionSequence=null;
  if(facts.slot.activation){activation=await decodeNativeActivation(release,read.accounts.get(keys.PriorActivation),facts.slot.activation);keys.PriorRoot=await pda(release,'root',activation.instance);keys.PriorRootReg=await pda(release,'root-reg',activation.instance);
    const before={...keys};delete before.PriorRoot;delete before.PriorRootReg;const next=await batch(rpc,keys),updated=await basic(release,actor,frozen,next,keys);forward(facts,updated);if(!stable(read,next,before))return state('REPLAN_STALE_STATE',next.contextSlot,common);read=next;facts=updated;
    const reg=await decodeNativeRootRegistration(release,read.accounts.get(keys.PriorRootReg),activation.instance),cursorMatches=lookupContext&&lookupContext.activationIdHex===hex(activation.id)&&lookupContext.rootInstanceHex===hex(activation.instance)&&lookupContext.positionIdHex===hex(activation.ordinaryPosition)&&lookupContext.ordinaryCount===reg.ordinaryCount.toString(),found=await priorPosition(release,rpc,activation,reg,cursorMatches?positionLookupStart:undefined);
    if(!found.found)return state(found.lookup.nextStart===null?'K_POSITION_NOT_FOUND':'K_POSITION_LOOKUP_REQUIRED',read.contextSlot,{...common,lookup:found.lookup});positionSequence=found.sequence;keys.PriorPosition=found.address;
    const registry=await decodeNativeRegistry(release,read.accounts.get(keys.Registry));
    if((facts.task.best===null||facts.verification.cost<facts.task.best)&&activation.end===null)keys.StopEvent=await pda(release,'mining-event',le(registry.eventCount));
  }
  const before={...keys};delete before.PriorPosition;delete before.StopEvent;const full=await batch(rpc,keys),fullFacts=await basic(release,actor,frozen,full,keys);forward(facts,fullFacts);
  if(!stable(read,full,before)||(fullFacts.clock.unixTimestamp-fullFacts.economy.rewardStart)/259200n!==round)return state('REPLAN_STALE_STATE',full.contextSlot,common);
  read=full;facts=fullFacts;
  const records=await finalRecords(release,actor,frozen,read,keys,facts);if(records.decision!=='READY')return state(records.decision,read.contextSlot,{...common,...records});
  if(maxFee<records.currentPlan.materialFeeAtoms)return state('FEE_CAP_INSUFFICIENT',read.contextSlot,{...common,requiredFeeAtoms:records.currentPlan.materialFeeAtoms,maxFee});
  check(facts.nonce.nextNonce<MAX,'SYN_FINAL_NONCE_EXHAUSTED');
  let priorActivation=null;
  if(activation){
    const old=await decodeNativeActivation(release,read.accounts.get(keys.PriorActivation),activation.id),reg=await decodeNativeRootRegistration(release,read.accounts.get(keys.PriorRootReg),old.instance),position=await decodeNativePosition(release,read.accounts.get(keys.PriorPosition),old.instance,positionSequence);await decodeNativeRoot(release,read.accounts.get(keys.PriorRoot),old.instance);
    check(reg.lastActivationId.equals(old.id)&&reg.activationCount===old.local+1n&&reg.kEnd===old.end&&position.positionId.equals(old.ordinaryPosition)&&position.rootDirectorySeq===reg.directorySequence&&position.rootSeq<reg.ordinaryCount&&position.beneficiary.equals(old.author)&&old.start>=position.start,'SYN_FINAL_K_LINKAGE');
    check(old.body.readBigInt64LE(218)<=facts.clock.unixTimestamp&&old.body.readBigUInt64LE(210)<=facts.clock.slot&&(old.end===null||old.body.readBigInt64LE(243)<=facts.clock.unixTimestamp&&old.body.readBigUInt64LE(235)<=facts.clock.slot),'SYN_FINAL_K_CLOCK');
    if(keys.StopEvent){const registry=records.registry;check(registry&&registry.eventCount<MAX&&facts.clock.unixTimestamp>=old.body.readBigInt64LE(218)&&facts.clock.slot>=old.body.readBigUInt64LE(210)&&fresh(read.accounts.get(keys.StopEvent)),'SYN_FINAL_K_STOP_EVENT');
      let end=(facts.clock.unixTimestamp-facts.economy.rewardStart)/3600n+1n;end=end>H_END?H_END:end;end=end<old.start?old.start:end;if(position.end!==null)end=end>position.end?position.end:end;end=end<old.start?old.start:end;
      check(registry.lastEventDue<=end&&registry.nextHour<=end,'SYN_FINAL_K_EVENT_ORDER');
    }
    priorActivation={activation:read.accounts.get(keys.PriorActivation),rootReg:read.accounts.get(keys.PriorRootReg),ordinaryPosition:read.accounts.get(keys.PriorPosition),root:read.accounts.get(keys.PriorRoot),registry:read.accounts.get(keys.Registry)};
  }
  const registration=await planSynthesisRegistration({release,verification:facts.verification,clockAccount:read.accounts.get(keys.Clock),taskAccount:read.accounts.get(keys.Task),kSlotAccount:read.accounts.get(keys.KSlot),priorActivation});
  const action=await planSynthesisFinalization({release,abi,plan:records.currentPlan,verification:facts.verification,nonce:facts.nonce.nextNonce,maxRent,maxFee,labSource:keys.LABSource,registration,freshDirectInputs:records.freshDirectInputs});
  keys.NewRoot=action.suffix.find(v=>v.name==='NewRoot').address;
  const checkKeys={...keys};delete checkKeys.NewRoot;const last=await batch(rpc,keys),lastFacts=await basic(release,actor,frozen,last,keys);forward(facts,lastFacts);
  if(!stable(read,last,checkKeys)||(lastFacts.clock.unixTimestamp-lastFacts.economy.rewardStart)/259200n!==round)return state('REPLAN_STALE_STATE',last.contextSlot,common);
  check(fresh(last.accounts.get(keys.NewRoot)),'SYN_FINAL_OUTPUT_NOT_FRESH');
  return state('ACTION',last.contextSlot,{...common,action,verification:lastFacts.verification,clock:lastFacts.clock,nextNonce:lastFacts.nonce.nextNonce,
    // Internal branded context for the private competition coordinator. HTTP
    // handlers expose only the explicit intent and public preview.
    finalizationContext:{registration,freshDirectInputs:records.freshDirectInputs,labSource:keys.LABSource,observedAddresses:Object.values(keys),observedAccounts:Object.values(keys).map(address=>last.accounts.get(address))},
    preview:{outputIdHex:hex(action.outputId),outputAddress:keys.NewRoot,feeAtoms:records.currentPlan.materialFeeAtoms,availableLABAtoms:records.source.amount,round,qualityPpm:facts.verification.qualityPpm,priorActivationIdHex:activation?hex(activation.id):null,priorPositionSequence:positionSequence,stopsPriorK:!!keys.StopEvent},requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null});
}
