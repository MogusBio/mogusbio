import { isOffCurveAddress } from '@solana/kit';
import { asBytes, ByteWriter, typedHash, instanceId } from '../../protocol-core/src/index.mjs';
import { TASK_FAMILY, ROUND_SECONDS, WINDOW_SECONDS } from '../../originality/src/wire.mjs';
import { H_END } from '../../settlement/src/emission.mjs';
import { decodeNativeAccountRecord } from './accounts.mjs';
import { nativeKeyAddress, nativeKeyBytes, nativeOpIdNonce } from './native.mjs';
import { productionOpening,openingPolicy } from './release.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const zero=b=>b.every(v=>v===0), copy=(b,at)=>Buffer.from(b.subarray(at,at+32));
const MAX=(1n<<64n)-1n,I64_MAX=(1n<<63n)-1n;
const u64=(n,c)=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,c);return n;};
const le=n=>new ByteWriter(8).u64(u64(n,'ORIGINALITY_U64')).finish();
const version=()=>new ByteWriter(4).u32(1).finish();
const family=()=>Buffer.from(TASK_FAMILY);
const roundId=(release,n)=>typedHash(9,Buffer.concat([release.domain,TASK_FAMILY,version(),le(n)]));
const disclosureId=(release,design)=>typedHash(8,Buffer.concat([release.domain,design]));
const winnerId=(release,n)=>typedHash(10,Buffer.concat([release.domain,roundId(release,n)]));
const keyIndex=n=>Buffer.concat([le(n),Buffer.alloc(24)]);
function fields(value,allowed){check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),'ORIGINALITY_OPTIONS');}
function ref(b,at,code){check(b[at]<=1,code);const id=copy(b,at+1);check(b[at]===1||zero(id),code);return b[at]===1?id:null;}
function wallet(b,at,code){const key=nativeKeyAddress(copy(b,at));check(!isOffCurveAddress(key),code);return key;}
function rawBody(release,account,size){check(account&&account.owner===release.input.programId&&account.executable===false,'ACCOUNT_OWNER');const b=asBytes(account.data);check(b.length===120+size,'ACCOUNT_SIZE');return b.subarray(120);}
function roundStart(release,n){const start=release.rewardStart+u64(n,'ORIGINALITY_ROUND')*ROUND_SECONDS;check(start>=0n&&start+ROUND_SECONDS<=I64_MAX,'ORIGINALITY_ROUND_TIME');return start;}
async function record(release,account,kind,schema,size,seeds,id){
  const r=await decodeNativeAccountRecord(release,account,{kind,schemas:[schema],seeds,recordKey:id,maxBodyBytes:size});
  check(r.body.length===size,'ORIGINALITY_SIZE');return r;
}
const result=(r,values)=>({schema:r.schema,body:Buffer.from(r.body),bytes:Buffer.from(r.bytes),source:'OBSERVED_PROGRAM_ACCOUNT',recordValidated:true,businessExecutionVerified:false,...values});
function familyVersion(b,code){check(b.subarray(0,32).equals(TASK_FAMILY)&&b.readUInt32LE(32)===1,code);}

/** Initialized records only. Fresh PDA handling belongs to the caller. */
export async function decodeNativeOriginalityTask(release,account){
  const r=await record(release,account,30,1,135,['bio','task',TASK_FAMILY],TASK_FAMILY),b=r.body;
  familyVersion(b,'TASK_CONTEXT');const event=b.readBigUInt64LE(36),count=b.readBigUInt64LE(44),nextRound=b.readBigUInt64LE(52),generation=b.readBigUInt64LE(109),epoch=b.readBigUInt64LE(119),highWater=b.readBigInt64LE(127);
  check(b[60]<=1&&b[117]<=1&&b[118]<=1&&highWater>=0n,'TASK_FLAGS');
  let best=null;if(b[60]){best={cost:b.readBigUInt64LE(61),design:copy(b,69),index:b.readBigUInt64LE(101)};check(best.cost>0n&&best.index<count,'TASK_BEST');}
  else check(zero(b.subarray(61,109)),'TASK_BEST');
  check(count<=event&&generation<=event&&nextRound<=event&&epoch<=generation&&(!b[118]||epoch>0n),'TASK_COUNTERS');
  return result(r,{family:family(),version:1,event,count,nextRound,best,generation,opening:b[117]===1,paused:b[118]===1,epoch,highWater});
}

export async function decodeNativeKSlot(release,account,options={}){
  fields(options,['generation']);const r=await record(release,account,34,1,74,['bio','k-slot',TASK_FAMILY],TASK_FAMILY),b=r.body;
  const generation=b.readBigUInt64LE(32),current=ref(b,40,'K_SLOT_REFERENCE'),status=b[73];
  check(b.subarray(0,32).equals(TASK_FAMILY)&&status<=4&&(status===0)===(current===null),'K_SLOT_FACTS');
  if(options.generation!==undefined)check(generation===u64(options.generation,'K_SLOT_GENERATION'),'K_SLOT_GENERATION');
  return result(r,{family:family(),generation,current,status,statusName:['EMPTY','ACTIVE_REFERENCE','STOPPED','SUPERSEDED','FAULTED'][status],activationStateVerified:false});
}

export async function decodeNativeCommit(release,account,id){
  const expected=asBytes(id,32),r=await record(release,account,31,1,207,['bio','commit',expected],expected),b=r.body;
  familyVersion(b,'COMMIT_CONTEXT');const round=b.readBigUInt64LE(36),author=wallet(b,44,'COMMIT_AUTHOR'),event=b.readBigUInt64LE(140),slot=b.readBigUInt64LE(148),createdAt=b.readBigInt64LE(156),used=b[164],candidate=ref(b,165,'COMMIT_CANDIDATE'),indexTag=b[198],index=b.readBigUInt64LE(199),start=roundStart(release,round);
  check(b.subarray(108,140).equals(expected)&&event>0n&&createdAt>=start&&createdAt<start+WINDOW_SECONDS,'COMMIT_FACTS');
  check(used<=1&&indexTag<=1&&(used===0)===(candidate===null)&&(indexTag===0)===(candidate===null)&&(indexTag!==0||index===0n),'COMMIT_USED');
  return result(r,{id:Buffer.from(expected),family:family(),version:1,round,author,authorBytes:copy(b,44),commitment:copy(b,76),event,slot,createdAt,commitWindowStart:start,commitWindowEnd:start+WINDOW_SECONDS,used:used===1,candidate,candidateIndex:indexTag?index:null,eligibilityVerified:false});
}

export async function decodeNativeRound(release,account,n){
  const round=u64(n,'ROUND_NUMBER'),id=roundId(release,round),r=await record(release,account,15,2,389,['bio','round',TASK_FAMILY,version(),le(round)],id),b=r.body;
  familyVersion(b,'ROUND_CONTEXT');check(b.readBigUInt64LE(36)===round,'ROUND_NUMBER');
  const baselineTag=b[44],startCount=b.readBigUInt64LE(85),endCount=b.readBigUInt64LE(93),commitCount=b.readBigUInt64LE(101),candidateCount=b.readBigUInt64LE(109),phase=b[117],epoch=b.readBigUInt64LE(118),baselineCursor=b.readBigUInt64LE(126),baselineBestTag=b[134],candidateCursor=b.readBigUInt64LE(175),scanCursor=b.readBigUInt64LE(183),firstDisclosureTag=b[191],bestCandidate=ref(b,200,'ROUND_CANDIDATE'),done=b[281],winner=ref(b,306,'ROUND_WINNER'),activation=ref(b,339,'ROUND_ACTIVATION'),startTag=b[372],activationStart=b.readBigUInt64LE(373),scanCount=b.readBigUInt64LE(381);
  check(baselineTag<=2&&phase<=4&&baselineBestTag<=1&&firstDisclosureTag<=1&&done<=1&&startTag<=1,'ROUND_FLAGS');
  check(startCount<=endCount&&candidateCount<=commitCount&&candidateCursor<=candidateCount&&baselineCursor<=scanCount&&scanCursor<=scanCount,'ROUND_COUNTERS');
  check(phase===0?scanCount===startCount:scanCount>=endCount,'ROUND_FROZEN_COUNT');
  check(baselineTag===1?b.readBigUInt64LE(45)>0n:zero(b.subarray(45,85)),'ROUND_BASELINE');
  check(baselineBestTag===1?b.readBigUInt64LE(135)>0n:zero(b.subarray(135,175)),'ROUND_SCAN_BEST');
  check(firstDisclosureTag===1?b.readBigUInt64LE(192)>0n:b.readBigUInt64LE(192)===0n,'ROUND_DISCLOSURE');
  check(bestCandidate!==null?b.readBigUInt64LE(233)>0n&&b.readBigUInt64LE(241)>0n:zero(b.subarray(233,281)),'ROUND_SELECTED');
  check((baselineBestTag===0||baselineCursor>0n)&&(firstDisclosureTag===0||scanCursor>0n)&&(bestCandidate===null||candidateCursor>0n),'ROUND_OBSERVATION_CURSOR');
  check(done===(phase===4?1:0)&&(done===1?b.readBigUInt64LE(282)>0n&&b.readBigInt64LE(298)>=roundStart(release,round)+ROUND_SECONDS:zero(b.subarray(282,306))),'ROUND_COMPLETION');
  check(winner===null||phase===4&&winner.equals(winnerId(release,round))&&bestCandidate!==null,'ROUND_WINNER');
  check(phase!==4||(winner===null)===(bestCandidate===null),'ROUND_WINNER_COMPLETION');
  check((activation!==null)===(startTag===1)&&(activation===null?activationStart===0n:winner!==null&&activationStart<H_END),'ROUND_ACTIVATION');
  if(phase===0)check(zero(b.subarray(126,381)),'ROUND_INITIAL');
  if(phase===1)check(candidateCursor===0n&&scanCursor===0n&&firstDisclosureTag===0&&bestCandidate===null,'ROUND_BASELINE_PHASE');
  if(phase===2||phase===3||phase===4&&baselineTag!==0)check(baselineCursor===scanCount,'ROUND_SCAN_COMPLETE');
  if(phase>=3)check(candidateCursor===candidateCount&&scanCursor===0n&&firstDisclosureTag===0,'ROUND_CANDIDATES_COMPLETE');
  return result(r,{id, family:family(),version:1,round,baselineTag,baseline:baselineTag===1?{cost:b.readBigUInt64LE(45),design:copy(b,53)}:null,startCount,endCount,commitCount,candidateCount,phase,epoch,baselineCursor,baselineBest:baselineBestTag?{cost:b.readBigUInt64LE(135),design:copy(b,143)}:null,candidateCursor,scanCursor,firstDisclosureEvent:firstDisclosureTag?b.readBigUInt64LE(192):null,bestCandidate,bestCandidateCost:bestCandidate?b.readBigUInt64LE(233):null,bestCommitEvent:bestCandidate?b.readBigUInt64LE(241):null,bestManufactureBusiness:bestCandidate?copy(b,249):null,completed:done===1,completedEvent:done?b.readBigUInt64LE(282):null,completedSlot:done?b.readBigUInt64LE(290):null,completedAt:done?b.readBigInt64LE(298):null,winner,activation,activationStart:startTag?activationStart:null,scanCount,deadline:roundStart(release,round)+ROUND_SECONDS});
}

export async function decodeNativeCandidate(release,account,options){
  fields(options,['round','index']);const round=u64(options.round,'CANDIDATE_ROUND'),index=u64(options.index,'CANDIDATE_INDEX'),raw=rawBody(release,account,348),rid=roundId(release,round),commit=copy(raw,52),root=copy(raw,84),id=typedHash(18,Buffer.concat([release.domain,rid,commit,root]));
  const r=await record(release,account,32,1,348,['bio','candidate',rid,le(index)],id),b=r.body;familyVersion(b,'CANDIDATE_CONTEXT');
  const author=wallet(b,116,'CANDIDATE_AUTHOR'),manufactureBusiness=copy(b,308),opId=copy(b,252),nonce=nativeOpIdNonce(opId),start=roundStart(release,round),createdAt=b.readBigInt64LE(300),design=copy(b,148);
  check(b.readBigUInt64LE(36)===round&&b.readBigUInt64LE(44)===index&&b.readBigUInt64LE(180)>0n&&b.readBigUInt64LE(284)>0n&&createdAt>=start+WINDOW_SECONDS&&createdAt<start+2n*WINDOW_SECONDS,'CANDIDATE_FACTS');
  check(typedHash(3,Buffer.concat([release.domain,nativeKeyBytes(author),opId])).equals(manufactureBusiness)&&instanceId(release.domain,manufactureBusiness).equals(root)&&disclosureId(release,design).equals(b.subarray(188,220)),'CANDIDATE_IDENTITY');
  return result(r,{id,roundId:rid,family:family(),version:1,round,index,commit,instance:root,author,design,cost:b.readBigUInt64LE(180),disclosure:copy(b,188),admission:copy(b,220),manufactureOpId:opId,manufactureNonce:nonce,event:b.readBigUInt64LE(284),slot:b.readBigUInt64LE(292),createdAt,manufactureBusiness,knowledgeIndex:b.readBigUInt64LE(340),eligibilityVerified:false,rankingVerified:false});
}

/** Recognition is immutable; current Root/Position/task/K eligibility is separate. */
export async function decodeNativeWinner(release,account,id){
  const expected=asBytes(id,32),r=await record(release,account,16,1,252,['bio','winner',expected],expected),b=r.body;familyVersion(b,'WINNER_CONTEXT');
  const round=b.readBigUInt64LE(36),cost=b.readBigUInt64LE(140),commitEvent=b.readBigUInt64LE(212),revealEvent=b.readBigUInt64LE(220),event=b.readBigUInt64LE(228),createdAt=b.readBigInt64LE(244),author=wallet(b,76,'WINNER_AUTHOR'),commit=copy(b,148),instance=copy(b,44),candidate=copy(b,180);
  check(winnerId(release,round).equals(expected)&&cost>0n&&commitEvent>0n&&revealEvent>commitEvent&&event>revealEvent&&createdAt>=roundStart(release,round)+ROUND_SECONDS,'WINNER_FACTS');
  check(typedHash(18,Buffer.concat([release.domain,roundId(release,round),commit,instance])).equals(candidate),'WINNER_CANDIDATE');
  return result(r,{id:Buffer.from(expected),family:family(),version:1,round,instance,author,design:copy(b,108),cost,commit,candidate,commitEvent,revealEvent,event,slot:b.readBigUInt64LE(236),createdAt,recognized:true,kActivatable:null,kEligibilityVerified:false});
}

export async function decodeNativeDisclosure(release,account,design){
  const expected=asBytes(design,32),id=disclosureId(release,expected),r=await record(release,account,14,1,217,['bio','disclosure',id],id),b=r.body;
  check(b.subarray(0,32).equals(expected)&&b.subarray(184,216).equals(TASK_FAMILY)&&b[216]>=1&&b[216]<=22&&b.readBigUInt64LE(128)>0n&&b.readBigInt64LE(144)>=0n,'DISCLOSURE_FACTS');
  return result(r,{id,design:Buffer.from(expected),artifact:copy(b,32),graphSHA:copy(b,64),payloadSHA:copy(b,96),event:b.readBigUInt64LE(128),slot:b.readBigUInt64LE(136),createdAt:b.readBigInt64LE(144),actor:wallet(b,152,'DISCLOSURE_ACTOR'),family:family(),target:b[216]});
}

export async function decodeNativeSafety(release,account,options={}){
  fields(options,['epoch','id']);const raw=rawBody(release,account,321),epoch=raw.readBigUInt64LE(32),id=Buffer.from(asBytes(account.data).subarray(88,120));
  if(options.epoch!==undefined)check(epoch===u64(options.epoch,'SAFETY_EPOCH'),'SAFETY_EPOCH');
  if(options.id!==undefined)check(id.equals(asBytes(options.id,32)),'SAFETY_ID');
  const r=await record(release,account,20,2,321,['bio','task-safety',TASK_FAMILY,le(epoch)],id),b=r.body;
  const originalIndex=b.readBigUInt64LE(40),replayAdmission=ref(b,115,'SAFETY_ADMISSION'),priorActivation=ref(b,172,'SAFETY_ACTIVATION'),phase=b[205],cursor=b.readBigUInt64LE(206),target=b.readBigUInt64LE(214),observedCount=b.readBigUInt64LE(222),bestTag=b[230],correctedTag=b[279],correctedIndex=b.readBigUInt64LE(280),recovered=b[288],origin=b.readBigUInt64LE(313);
  check(b.subarray(0,32).equals(TASK_FAMILY)&&epoch>0n&&b[80]<=2&&b[81]<=1&&b[114]<=1&&phase<=3&&bestTag<=1&&correctedTag<=1&&recovered<=1,'SAFETY_FLAGS');
  check(cursor<=target&&target<=observedCount&&b.readBigUInt64LE(148)>0n&&b.readBigInt64LE(164)>=0n&&(b[114]===1)===(replayAdmission!==null),'SAFETY_COUNTERS');
  check(b[80]===2?b[114]===0:b[114]===1,'SAFETY_REPLAY');
  check(bestTag===1?b.readBigUInt64LE(231)>0n&&b.readBigUInt64LE(271)<cursor:zero(b.subarray(231,279)),'SAFETY_BEST');
  check(correctedTag===1?b[114]===1&&correctedIndex>originalIndex&&correctedIndex<observedCount:correctedIndex===0n,'SAFETY_CORRECTION');
  check(origin<=originalIndex||correctedTag===1&&origin===correctedIndex,'SAFETY_ORIGIN');
  check(recovered===(phase===3?1:0)&&(phase===3?b.readBigUInt64LE(289)>b.readBigUInt64LE(148)&&b.readBigUInt64LE(297)>=b.readBigUInt64LE(156)&&b.readBigInt64LE(305)>=b.readBigInt64LE(164):zero(b.subarray(288,313))),'SAFETY_RECOVERY');
  if(phase>=2)check(cursor===target,'SAFETY_SCAN_COMPLETE');
  return result(r,{id,address:account.address,businessKeyBindingVerified:options.id!==undefined,family:family(),epoch,originalIndex,claimedAdmission:copy(b,48),verdict:b[80],baseKind:b[81],baseReference:copy(b,82),replayCompleted:b[114]===1,replayAdmission,faultEvent:b.readBigUInt64LE(148),slot:b.readBigUInt64LE(156),createdAt:b.readBigInt64LE(164),priorActivation,phase,cursor,target,observedCount,best:bestTag?{cost:b.readBigUInt64LE(231),design:copy(b,239),index:b.readBigUInt64LE(271)}:null,correctedIndex:correctedTag?correctedIndex:null,recovered:recovered===1,recoveredEvent:recovered?b.readBigUInt64LE(289):null,recoveredSlot:recovered?b.readBigUInt64LE(297):null,recoveredAt:recovered?b.readBigInt64LE(305):null,origin});
}

export async function decodeNativeKnowledge(release,account,n,options={}){
  fields(options,['safetyAccount']);const index=u64(n,'KNOWLEDGE_INDEX'),r=await record(release,account,33,1,279,['bio','knowledge',TASK_FAMILY,le(index)],keyIndex(index)),b=r.body;familyVersion(b,'KNOWLEDGE_CONTEXT');
  const firstDisclosureEvent=b.readBigUInt64LE(108),event=b.readBigUInt64LE(116),cost=b.readBigUInt64LE(140),kind=b[148],revoked=b[245],fault=ref(b,246,'KNOWLEDGE_FAULT'),evidence=copy(b,149),admission=copy(b,213),design=copy(b,44);
  check(b.readBigUInt64LE(36)===index&&firstDisclosureEvent>0n&&event>firstDisclosureEvent&&b.readBigInt64LE(132)>=0n&&cost>0n&&kind<=2&&revoked<=1&&(revoked===0)===(fault===null),'KNOWLEDGE_FACTS');
  let safety=null,effectiveIndex=index;
  if(kind===2&&revoked===0){
    check(options.safetyAccount&&options.safetyAccount.address===nativeKeyAddress(evidence),'KNOWLEDGE_SAFETY_REQUIRED');
    safety=await decodeNativeSafety(release,options.safetyAccount);
    check(safety.replayCompleted&&safety.correctedIndex===index&&safety.replayAdmission.equals(admission)&&safety.origin<=index,'KNOWLEDGE_SAFETY_BINDING');effectiveIndex=safety.origin;
  }else check(options.safetyAccount===undefined,'KNOWLEDGE_UNEXPECTED_SAFETY');
  return result(r,{family:family(),version:1,index,design,disclosure:copy(b,76),disclosureIdentityMatches:disclosureId(release,design).equals(b.subarray(76,108)),firstDisclosureEvent,event,slot:b.readBigUInt64LE(124),createdAt:b.readBigInt64LE(132),cost,kind,evidence,artifact:copy(b,181),admission,revoked:revoked===1,fault,effectiveIndex,safety,eligibilityVerified:false});
}

export async function decodeNativeOpeningSnapshot(release,account){
  let policy;try{policy=openingPolicy(release.input,{localPublicFixture:release.localPublicFixture===true});}catch{check(false,'SNAPSHOT_RELEASE_BINDING');}check(release.hashes.initialSeedSetId.equals(productionOpening(release.domain).id),'SNAPSHOT_RELEASE_BINDING');
  const raw=rawBody(release,account,176),id=typedHash(15,Buffer.concat([Buffer.from([3]),release.domain,raw])),r=await record(release,account,5,1,176,['bio','seed-final',TASK_FAMILY],id),b=r.body;
  const cutoff=b.readBigInt64LE(64),seedCount=b.readBigUInt64LE(72),cost=b.readBigUInt64LE(112),event=b.readBigUInt64LE(152),createdAt=b.readBigInt64LE(168);
  check(b.subarray(0,32).equals(TASK_FAMILY)&&b.subarray(32,64).equals(release.hashes.initialSeedSetId)&&cutoff===release.rewardStart&&seedCount>=BigInt(policy.publishedKnownCount)&&cost>0n&&cost<=BigInt(policy.frontier)&&event>0n&&createdAt>=cutoff,'SNAPSHOT_FACTS');
  return result(r,{id,family:family(),initialSeedSetId:copy(b,32),cutoff,seedCount,digest:copy(b,80),best:{cost,design:copy(b,120)},event,slot:b.readBigUInt64LE(160),createdAt,sealed:true,openingBindingVerified:true});
}
