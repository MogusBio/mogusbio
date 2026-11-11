import {randomBytes} from 'node:crypto';
import {isOffCurveAddress} from '@solana/kit';
import {asBytes,sha256,ByteWriter,typedHash,businessKey,instanceId} from '../../protocol-core/src/index.mjs';
import {encodeGraph} from '../../biology/src/graph.mjs';
import {TASK_FAMILY as F,ROUND_SECONDS,WINDOW_SECONDS} from '../../originality/src/wire.mjs';
import {ReadOnlyRpc} from './rpc.mjs';
import {PROGRAMS,baseConfigR2Id} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda,nativeNonceOpId,nativeRequestHash,encodeNativeFrame,encodeSynthFinalizePayload,decodeNativeFrame} from './native.mjs';
import {decodeNativeBaseConfig,decodeNativeRoot} from './accounts.mjs';
import {decodeNativeEconomyConfig,decodeNativeClock} from './economy-accounts.mjs';
import {decodeActorNonceSnapshot} from './journal.mjs';
import {decodeNativeOriginalityTask,decodeNativeKSlot,decodeNativeOpeningSnapshot,decodeNativeRound,decodeNativeCommit,decodeNativeCandidate} from './originality-accounts.mjs';
import {decodeNativeSynthesisArtifact,decodeNativePriorVerification} from './synthesis-records.mjs';
import {readSynthesisInputs,planActualSynthesis} from './synthesis-inputs.mjs';
import {createSynthesisManifest} from './synthesis-manifest.mjs';
import {createResearchManifest,publicResearchWorkflow} from './research-manifest.mjs';
import {planDelegatedSynthesisStep,planDelegatedSynthesisFinalization} from './synthesis-workflow.mjs';
import {planActualSynthesisFinalization} from './synthesis-final.mjs';
import {readGuidedSynthesisProgress} from './synthesis-progress.mjs';
import {nativeActionIntent} from './player-settlement.mjs';
import {validateV1Resources} from './transaction.mjs';

const MAX=(1n<<64n)-1n,safeErrors=new WeakSet(),flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,reservesOnChainNonce:false};
const failure=code=>{const e=Object.assign(new Error(code),{code});safeErrors.add(e);return e;};
const check=(v,c)=>{if(!v)throw failure(c);};
const privateWork=async f=>{try{return await f();}catch(e){throw failure(safeErrors.has(e)?e.code:'RESEARCH_PRIVATE_OPERATION_FAILED');}};
const hex=b=>Buffer.from(b).toString('hex'),le=n=>new ByteWriter(8).u64(n).finish(),v1=new ByteWriter(4).u32(1).finish();
const pda=(r,...s)=>nativePda(r.input.programId,'bio',...s).then(v=>v.address);
const u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'RESEARCH_PROGRESS_U64');return n;};
const fields=(v,allowed)=>check(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).every(k=>allowed.includes(k)),'RESEARCH_PROGRESS_FIELDS');
const absent=a=>a===null||a.owner===PROGRAMS.systemProgram&&!a.executable&&asBytes(a.data).length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&a.lamports===b.lamports&&asBytes(a.data).equals(asBytes(b.data));
const json=v=>typeof v==='bigint'?v.toString():Buffer.isBuffer(v)||v instanceof Uint8Array?hex(v):Array.isArray(v)?v.map(json):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,json(x)])):v;
const phase=(release,clock)=>{if(clock.unixTimestamp<release.rewardStart)return {phase:'PREWARM',round:null};const elapsed=clock.unixTimestamp-release.rewardStart,n=elapsed/ROUND_SECONDS,offset=elapsed%ROUND_SECONDS;return {phase:offset<WINDOW_SECONDS?'COMMIT':offset<2n*WINDOW_SECONDS?'MANUFACTURE':'FINALIZE',round:n};};
const forward=(a,b)=>check(b.clock.slot>=a.clock.slot&&b.clock.unixTimestamp>=a.clock.unixTimestamp&&b.nonce.nextNonce>=a.nonce.nextNonce,'RESEARCH_OBSERVATION_REGRESSION');
function sessionContext(release,abi,actor,session){const c=session?.recoveryIdentity;check(c?.actor===actor&&c.releaseHash===release.input.releaseHash&&c.abiHash===abi.hash&&c.domainHex===hex(release.domain)&&c.configHex===hex(baseConfigR2Id(release)),'RESEARCH_SESSION_CONTEXT');}
async function knownRequest(session,n){try{return await session.getRequest(n);}catch(e){if(['JOURNAL_NOT_FOUND','JOURNAL_ARCHIVE_NOT_FOUND'].includes(e.code))return null;throw e;}}
async function batch(rpc,keys){const addresses=[...new Set(Object.values(keys))];check(addresses.length<=100,'RESEARCH_ACCOUNT_BOUND');const {accounts,contextSlot}=await rpc.getMultipleAccounts(addresses);return {accounts:new Map(addresses.map((a,i)=>[a,accounts[i]])),contextSlot};}
const get=(s,k)=>s.accounts.get(s.keys[k]);
const stable=(a,b)=>Object.keys(a.keys).filter(k=>k!=='Clock').every(k=>b.keys[k]===a.keys[k]&&same(get(a,k),get(b,k)));
async function snapshot({release,rpc,author,cranker,m=null}){
  check(rpc instanceof ReadOnlyRpc,'RESEARCH_READ_ONLY_RPC');
  const keys={Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar,Author:author,AuthorNonce:await pda(release,'actor-nonce',nativeKeyBytes(author)),Cranker:cranker,CrankerNonce:await pda(release,'actor-nonce',nativeKeyBytes(cranker)),Verification:await pda(release,'verify',nativeKeyBytes(author)),Task:await pda(release,'task',F),KSlot:await pda(release,'k-slot',F),Snapshot:await pda(release,'seed-final',F)};
  if(m){keys.Artifact=await pda(release,'artifact',m.baseManifest.plan.artifactId);keys.Commit=await pda(release,'commit',m.workflow.commit.commitId);keys.Round=await pda(release,'round',F,v1,le(m.round));}
  const read=await batch(rpc,keys),s={...read,keys};await decodeNativeBaseConfig(release,get(s,'Base'));s.economy=await decodeNativeEconomyConfig(release,get(s,'Economy'));s.clock=decodeNativeClock(get(s,'Clock'));
  const ordinary=name=>{const wallet=get(s,name);return !!wallet&&wallet.address===keys[name]&&wallet.owner===PROGRAMS.systemProgram&&!wallet.executable&&asBytes(wallet.data).length===0&&!isOffCurveAddress(keys[name]);};
  check(ordinary('Author'),'RESEARCH_ORDINARY_WALLET');s.crankerWalletAvailable=ordinary('Cranker');if(!m)check(s.crankerWalletAvailable,'RESEARCH_ORDINARY_WALLET');
  s.nonce=await decodeActorNonceSnapshot({release,actor:author,address:keys.AuthorNonce,account:get(s,'AuthorNonce'),contextSlot:s.contextSlot,commitment:'finalized'});
  s.crankerNonce=await decodeActorNonceSnapshot({release,actor:cranker,address:keys.CrankerNonce,account:get(s,'CrankerNonce'),contextSlot:s.contextSlot,commitment:'finalized'});
  s.prior=await decodeNativePriorVerification({release,info:get(s,'Verification'),actor:author,contextSlot:s.contextSlot});
  s.task=absent(get(s,'Task'))?null:await decodeNativeOriginalityTask(release,get(s,'Task'));
  s.slot=absent(get(s,'KSlot'))?null:await decodeNativeKSlot(release,get(s,'KSlot'),{generation:s.task?.generation??0n});
  s.opening=absent(get(s,'Snapshot'))?null:await decodeNativeOpeningSnapshot(release,get(s,'Snapshot'));
  check(s.prior.clock<=s.clock.unixTimestamp&&(!s.task||s.task.highWater<=s.clock.unixTimestamp)&&(!s.opening||s.opening.createdAt<=s.clock.unixTimestamp&&s.opening.slot<=s.clock.slot),'RESEARCH_FUTURE_STATE');
  if(m){
    s.artifact=absent(get(s,'Artifact'))?null:await decodeNativeSynthesisArtifact({release,info:get(s,'Artifact'),artifactId:m.baseManifest.plan.artifactId,actor:author,expectedBody:m.baseManifest.plan.bytes});
    s.commit=absent(get(s,'Commit'))?null:await decodeNativeCommit(release,get(s,'Commit'),m.workflow.commit.commitId);
    s.round=absent(get(s,'Round'))?null:await decodeNativeRound(release,get(s,'Round'),m.round);
    if(s.commit)check(s.commit.author===author&&s.commit.round===m.round&&s.commit.commitment.equals(m.workflow.commit.commitment)&&s.commit.createdAt<=s.clock.unixTimestamp&&s.commit.slot<=s.clock.slot&&s.commit.event<=(s.task?.event??0n),'RESEARCH_COMMIT_BINDING');
    if(s.artifact?.sealed)check(s.artifact.sealedAt<=s.clock.unixTimestamp&&s.artifact.sealedSlot<=s.clock.slot,'RESEARCH_ARTIFACT_FUTURE');
  }
  return s;
}
function gate(s){return !s.task?'TASK_NOT_INITIALIZED':!s.opening||!s.task.opening?'OPENING_NOT_FINALIZED':s.task.paused?'TASK_PAUSED':null;}
const inputArgs=(release,rpc,m)=>({release,rpc,actor:m.author,target:22,directIds:m.baseManifest.plan.payload.direct.map(d=>d.instance)});
function inputSame(a,b){return a.directInputs.every(row=>{const other=b.directInputs.find(i=>i.instance.equals(row.instance));return other&&same(row.account,other.account)&&same(row.rootReg,other.rootReg)&&(row.originalArtifact===undefined?other.originalArtifact===undefined:same(row.originalArtifact,other.originalArtifact));});}
async function frozenInputs(release,m,read){for(const d of m.baseManifest.plan.payload.direct){const row=read.directInputs.find(r=>r.instance.equals(d.instance)),f=m.baseManifest.plan.directRoots.find(r=>r.instance.equals(d.instance));check(row&&f,'RESEARCH_DIRECT_MISSING');const root=await decodeNativeRoot(release,row.account,d.instance);check(root.owner===m.author&&root.lifecycle===0&&root.revision===d.expectedRevision&&root.fingerprint.equals(d.fingerprint)&&root.createdAt===f.createdAt&&root.createdSlot===f.createdSlot,'RESEARCH_DIRECT_CHANGED');}}
const verificationPublic=v=>v?{generation:v.generation,phase:v.phase,workSequence:v.workSequence,progress:v.progress,physicsRound:v.physicsRound,qualityPpm:v.qualityPpm,taskApplicable:v.taskApplicable,cost:v.cost,used:v.used}:null;
function matching(m,v){return v&&v.artifactId.equals(m.baseManifest.plan.artifactId)&&v.artifactSHA.equals(m.baseManifest.plan.artifactSHA)&&v.graphSHA.equals(m.baseManifest.plan.graphSHA)&&v.target===22&&v.challengePpm===2000000&&v.generation===m.expectedGeneration+1n;}
function canonicalRequest({release,abi,author,cranker,graph,directIds,maxRent,maxUploadRent,maxFee,resources}){
  const r=validateV1Resources(resources);for(const n of [maxRent,maxUploadRent,maxFee])u64(n);
  check(Array.isArray(directIds)&&directIds.length===6,'RESEARCH_DIRECT_COUNT');const ids=directIds.map(v=>hex(asBytes(v,32)));check(new Set(ids).size===ids.length,'RESEARCH_DIRECT_DUPLICATE');
  return sha256(Buffer.from(JSON.stringify({version:'BIORESEARCH-CREATE1',releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:hex(release.domain),configHex:hex(baseConfigR2Id(release)),author,cranker,graphHex:hex(encodeGraph(graph)),directIds:ids,maxRent:maxRent.toString(),maxUploadRent:maxUploadRent.toString(),maxFee:maxFee.toString(),resources:{computeUnitLimit:r.computeUnitLimit,loadedAccountsDataSizeLimit:r.loadedAccountsDataSizeLimit,heapSize:r.heapSize,priorityFeeLamports:r.priorityFeeLamports.toString()}}))).toString('hex');
}

/** Private creation is idempotent before any new observed nonce or random salt
 * is chosen. This stores a local plan, never a prepared chain request. */
export async function saveGuidedResearchWorkflow(args){return privateWork(async()=>{
  fields(args,['release','abi','rpc','author','cranker','graph','directIds','maxRent','maxUploadRent','maxFee','resources','requestId','store']);const {release,abi,rpc,graph,directIds,maxRent,maxUploadRent,maxFee,resources,requestId,store}=args,author=nativeKeyAddress(args.author),cranker=nativeKeyAddress(args.cranker);
  check(author!==cranker&&!isOffCurveAddress(author)&&!isOffCurveAddress(cranker),'RESEARCH_DISTINCT_ROLES');const requestDigest=canonicalRequest({...args,author,cranker});let blocked=null;
  let saved;try{saved=await store.createRequest({release,abi,author,requestId,requestDigest,build:async()=>{
    const first=await snapshot({release,rpc,author,cranker}),window=phase(release,first.clock),reason=gate(first);
    if(reason||window.phase!=='COMMIT'){blocked=json({...flags,decision:reason??'WAIT_COMMIT_WINDOW',contextSlot:first.contextSlot,window});throw failure('RESEARCH_CREATE_BLOCKED');}
    const read=await planActualSynthesis({release,abi,rpc,actor:author,graph,directIds,challengePpm:2000000});
    if(read.decision!=='SYNTHESIS_PLANNED'){blocked=json({...flags,decision:read.decision,contextSlot:read.contextSlot});throw failure('RESEARCH_CREATE_BLOCKED');}
    check(read.nextNonce>=first.nonce.nextNonce&&read.clock.slot>=first.clock.slot&&read.clock.unixTimestamp>=first.clock.unixTimestamp,'RESEARCH_OBSERVATION_REGRESSION');
    const baseManifest=await createSynthesisManifest({release,abi,actor:author,plan:read.plan,directInputs:read.directInputs,challengePpm:2000000,maxRent,maxUploadRent,maxFee,resources});
    const provisional=await createResearchManifest({release,abi,author,cranker,baseManifest,commitNonce:first.nonce.nextNonce,round:window.round,salt:randomBytes(32),expectedGeneration:first.prior.generation,maxRent,maxUploadRent,maxFee,resources}),last=await snapshot({release,rpc,author,cranker,m:provisional});forward(first,last);forward({clock:read.clock,nonce:{nextNonce:read.nextNonce}},last);
    if(!stable(first,last)||last.nonce.nextNonce!==first.nonce.nextNonce||last.artifact!==null||last.commit!==null||phase(release,last.clock).phase!=='COMMIT'||phase(release,last.clock).round!==window.round||last.round&&last.round.phase!==0){blocked=json({...flags,decision:last.artifact?'ARTIFACT_ALREADY_PRESENT':'REPLAN_STALE_STATE',contextSlot:last.contextSlot});throw failure('RESEARCH_CREATE_BLOCKED');}
    const again=await readSynthesisInputs(inputArgs(release,rpc,provisional));if(again.decision!=='INPUTS_READ'||!again.allEligible||!inputSame(read,again)){blocked=json({...flags,decision:'REPLAN_STALE_STATE',contextSlot:again.contextSlot});throw failure('RESEARCH_CREATE_BLOCKED');}
    const final=await snapshot({release,rpc,author,cranker,m:provisional});forward(last,final);forward({clock:again.clock,nonce:{nextNonce:again.nextNonce}},final);if(!stable(last,final)||final.nonce.nextNonce!==first.nonce.nextNonce||phase(release,final.clock).phase!=='COMMIT'||phase(release,final.clock).round!==window.round){blocked=json({...flags,decision:'REPLAN_STALE_STATE',contextSlot:final.contextSlot});throw failure('RESEARCH_CREATE_BLOCKED');}
    return provisional;
  }});}catch(error){if(blocked)return blocked;throw error;}
  return json({...flags,decision:'WORKFLOW_SAVED',workflow:publicResearchWorkflow(saved.manifest),alreadySaved:saved.alreadySaved,requiresExplicitNextRead:true,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null});
});}

/** Read-only role-aware progression. Only explicit existing P10.1 console
 * preparation may turn this returned intent into a signed transaction. */
export async function readGuidedResearchProgress(args){return privateWork(async()=>{
  fields(args,['release','abi','authorSession','executorSession','actor','author','workflowId','store']);const {release,abi,authorSession,executorSession,workflowId,store}=args,author=nativeKeyAddress(args.author),actor=nativeKeyAddress(args.actor);sessionContext(release,abi,author,authorSession);sessionContext(release,abi,actor,executorSession);
  const m=await store.load({release,abi,author,workflowId});check(actor===m.author||actor===m.cranker,'RESEARCH_EXECUTOR_ROLE');const rpc=authorSession.rpc,s=await snapshot({release,rpc,author,cranker:m.cranker,m}),window=phase(release,s.clock),reveal=!!s.commit&&(s.commit.used||window.phase==='MANUFACTURE'&&window.round===m.round);
  const common={...flags,actor,author,workflow:publicResearchWorkflow(m,{reveal}),outputVerified:false,exactRequestExecutionVerified:false,root:null,lookupOnly:true,window},out=(decision,extra={})=>json({...common,decision,contextSlot:s.contextSlot,...extra});
  const read=await readSynthesisInputs(inputArgs(release,rpc,m));if(read.decision!=='INPUTS_READ')return out(read.decision);forward(s,{clock:read.clock,nonce:{nextNonce:read.nextNonce}});
  if(read.eligibility.every(r=>r.lifecycle===1)){
    check(s.commit?.used&&s.commit.candidateIndex!==null,'RESEARCH_OUTPUT_COMMIT_REQUIRED');const business=businessKey(release.domain,nativeKeyBytes(author),nativeNonceOpId(m.workflow.futureManufactureNonce)),expectedOutput=instanceId(release.domain,business);
    for(const row of read.directInputs){const root=await decodeNativeRoot(release,row.account,row.instance);check(root.parent.equals(expectedOutput)&&root.consumedBusiness.equals(business),'RESEARCH_OUTPUT_NONCE_BINDING');}
    const rid=typedHash(9,Buffer.concat([release.domain,F,v1,le(m.round)])),candidateAddress=await pda(release,'candidate',rid,le(s.commit.candidateIndex)),outputAddress=await pda(release,'root',expectedOutput),candidateRead=await rpc.getMultipleAccounts([candidateAddress,outputAddress]),candidate=await decodeNativeCandidate(release,candidateRead.accounts[0],{round:m.round,index:s.commit.candidateIndex}),outputRoot=await decodeNativeRoot(release,candidateRead.accounts[1],expectedOutput);
    check(candidate.id.equals(s.commit.candidate)&&candidate.commit.equals(s.commit.id)&&candidate.instance.equals(expectedOutput)&&candidate.author===author&&candidate.manufactureNonce===m.workflow.futureManufactureNonce&&candidate.design.equals(m.workflow.commit.design)&&candidate.event>s.commit.event&&candidate.event<=(s.task?.event??0n)&&candidate.knowledgeIndex<(s.task?.count??0n)&&candidate.slot<=s.clock.slot&&candidate.createdAt<=s.clock.unixTimestamp,'RESEARCH_OUTPUT_CANDIDATE');
    const payload=encodeSynthFinalizePayload({artifactId:m.baseManifest.plan.artifactId,artifactSHA:m.baseManifest.plan.artifactSHA,artifactLength:m.baseManifest.plan.bytes.length,expectedGeneration:m.expectedGeneration+1n,transcriptSHA:candidateRead.accounts[1].data.subarray(623,655),maxFee:m.maxFee,maxRent:m.maxRent,competition:{commitId:m.workflow.commit.commitId,salt:m.salt}}),exactFrame=encodeNativeFrame(abi,{operation:'SYNTH_FINALIZE',domain:release.domain,configId:baseConfigR2Id(release),actor:author,nonce:m.workflow.futureManufactureNonce,payload});
    check(nativeRequestHash(abi,exactFrame).equals(outputRoot.requestHash)&&candidate.manufactureBusiness.equals(outputRoot.manufactureBusiness)&&candidate.createdAt===outputRoot.createdAt&&candidate.slot===outputRoot.createdSlot&&candidate.cost===outputRoot.cost,'RESEARCH_OUTPUT_FINAL_189');
    const adapter={load:async()=>m.baseManifest,loadHints:async()=>({finalFrameHex:(await store.loadHints(m)).finalFrameHex,positionLookup:null})},result=await readGuidedSynthesisProgress({release,abi,session:authorSession,actor:author,workflowId:m.baseManifest.workflowId,store:adapter}),last=await snapshot({release,rpc,author,cranker:m.cranker,m}),lastCandidate=await rpc.getMultipleAccounts([candidateAddress,outputAddress]);forward(s,last);
    if(!stable(s,last)||!candidateRead.accounts.every((a,i)=>same(a,lastCandidate.accounts[i])))return out('REPLAN_STALE_STATE');
    return json({...common,...result,workflow:publicResearchWorkflow(m,{reveal:true}),actor,author,competitionCandidateVerified:true,winnerRecognized:false});
  }
  const blocked=gate(s);if(blocked)return out(blocked);if(actor===m.cranker&&!s.crankerWalletAvailable)return out('CRANKER_WALLET_UNAVAILABLE');if(!read.allEligible)return out('INPUTS_BLOCKED',reveal?{summary:read.summary,eligibility:read.eligibility}:{});await frozenInputs(release,m,read);
  const executorNonce=actor===author?s.nonce.nextNonce:s.crankerNonce.nextNonce,pending=await knownRequest(executorSession,executorNonce);
  if(pending)return out('RECOVER_CURRENT_REQUEST',{recoveryNonce:executorNonce,requestOperation:decodeNativeFrame(abi,pending.frameBytes).operation});
  let proposed,kind,preview={},requiredActor=author,finalContext=null;
  if(!s.commit){
    if(window.phase!=='COMMIT'||window.round!==m.round)return out('COMMIT_WINDOW_CLOSED');
    if(s.nonce.nextNonce!==m.commitNonce||s.prior.generation!==m.expectedGeneration||s.artifact!==null||s.round&&s.round.phase!==0)return out('AUTHOR_NONCE_WINDOW_BROKEN');kind='COMMIT';proposed={...m.workflow.commit,operation:'COMMIT',nonce:m.commitNonce,clientPlanOnly:true};
  }else{
    if(s.commit.used)return out('COMMIT_USED_WITH_LIVE_INPUTS');if(window.round!==m.round||window.phase==='FINALIZE'||window.phase==='PREWARM')return out('MANUFACTURE_WINDOW_CLOSED');if(window.phase==='COMMIT')return out('WAIT_MANUFACTURE_WINDOW');
    const n=s.nonce.nextNonce,start=m.commitNonce+1n,end=m.workflow.futureManufactureNonce,index=n-start,C=BigInt(m.workflow.chunkCount),a=s.artifact;
    if(n<start||n>end)return out('AUTHOR_NONCE_WINDOW_BROKEN');
    if(index<C){
      const written=Number(index)*1024;if(index===0n?a!==null:!a||a.written!==written||a.sequence!==index||a.sealed)return out('AUTHOR_NONCE_WINDOW_BROKEN');
      if(s.prior.generation!==m.expectedGeneration)return out('AUTHOR_NONCE_WINDOW_BROKEN');kind='UPLOAD';proposed=m.workflow.preparation.stages[Number(index)];preview={written,total:m.baseManifest.plan.bytes.length};
    }else if(index===C){
      if(!a||a.written!==m.baseManifest.plan.bytes.length||a.sequence!==C||a.sealed||s.prior.generation!==m.expectedGeneration)return out('AUTHOR_NONCE_WINDOW_BROKEN');kind='SEAL';proposed=m.workflow.preparation.stages[m.workflow.chunkCount];
    }else if(index===C+1n){
      if(!a?.sealed||a.sequence!==C||s.prior.generation!==m.expectedGeneration)return out('AUTHOR_NONCE_WINDOW_BROKEN');kind='BEGIN';proposed=m.workflow.preparation.stages[m.workflow.chunkCount+1];
    }else{
      const v=s.prior.verification;if(!a?.sealed||a.sequence!==C||!matching(m,v))return out('AUTHOR_NONCE_WINDOW_BROKEN');if(v.used)return out('USED_VERIFICATION_WITH_LIVE_INPUTS');
      if(v.phase<6){kind='STEP';requiredActor=m.cranker;if(actor===requiredActor)proposed=await planDelegatedSynthesisStep({release,abi,workflow:m.workflow,verification:v,crankerNonce:s.crankerNonce.nextNonce,maxRent:m.maxRent});}
      else{
        if(!v.taskApplicable||v.qualityPpm!==2000000n||v.cost===0n)return out('RESEARCH_RESULT_INELIGIBLE',{verification:verificationPublic(v),ordinaryManufactureAvailableSeparately:true});kind='FINAL';
        if(actor===author){
          const lookup=await store.loadPositionLookup(m),final=await planActualSynthesisFinalization({release,abi,rpc,actor:author,plan:m.baseManifest.plan,verification:v,maxRent:m.maxRent,maxFee:m.maxFee,...(!lookup?{}:{positionLookupStart:BigInt(lookup.nextStart??'0'),positionLookupContext:{activationIdHex:lookup.activationIdHex,rootInstanceHex:lookup.rootInstanceHex,positionIdHex:lookup.positionIdHex,ordinaryCount:lookup.ordinaryCount}})});
          if(final.decision!=='ACTION'){if(final.lookup)await store.savePositionLookup(m,final.lookup);return out(final.decision,{...(final.lookup?{lookup:final.lookup}:{}),preview:final.preview??null,verification:verificationPublic(v)});}
          check(final.nextNonce===m.workflow.futureManufactureNonce&&final.finalizationContext,'RESEARCH_FINAL_CONTEXT');finalContext=final.finalizationContext;
          proposed=await planDelegatedSynthesisFinalization({release,abi,workflow:m.workflow,verification:final.verification,authorNextNonce:final.nextNonce,salt:m.salt,commitAccount:get(s,'Commit'),roundAccount:get(s,'Round'),snapshotAccount:get(s,'Snapshot'),maxRent:m.maxRent,maxFee:m.maxFee,registration:finalContext.registration,freshDirectInputs:finalContext.freshDirectInputs,labSource:finalContext.labSource});preview={...final.preview,knownOpeningDesign:m.workflow.commit.knownOpeningDesign,winnerGuaranteed:false};
        }
      }
    }
  }
  if(actor!==requiredActor)return out(requiredActor===author?'AUTHOR_REQUIRED':'CRANKER_REQUIRED',{stage:{kind,requiredActor}});
  check(proposed&&proposed.nonce===executorNonce,'RESEARCH_ACTION_NONCE');const again=await readSynthesisInputs(inputArgs(release,rpc,m)),last=await snapshot({release,rpc,author,cranker:m.cranker,m});forward(s,last);if(again.decision==='INPUTS_READ'){forward({clock:read.clock,nonce:{nextNonce:read.nextNonce}},{clock:again.clock,nonce:{nextNonce:again.nextNonce}});forward({clock:again.clock,nonce:{nextNonce:again.nextNonce}},last);}
  check(last.crankerNonce.nextNonce>=s.crankerNonce.nextNonce,'RESEARCH_OBSERVATION_REGRESSION');
  if(again.decision!=='INPUTS_READ'||!again.allEligible||!inputSame(read,again)||!stable(s,last)||phase(release,last.clock).phase!==window.phase||phase(release,last.clock).round!==window.round)return out('REPLAN_STALE_STATE');
  if(finalContext){const reread=await rpc.getMultipleAccounts(finalContext.observedAddresses);if(!finalContext.observedAccounts.every((a,i)=>finalContext.observedAddresses[i]===PROGRAMS.clockSysvar||same(a,reread.accounts[i])))return out('REPLAN_STALE_STATE');const clockIndex=finalContext.observedAddresses.indexOf(PROGRAMS.clockSysvar),clock=decodeNativeClock(reread.accounts[clockIndex]);check(clock.slot>=last.clock.slot&&clock.unixTimestamp>=last.clock.unixTimestamp,'RESEARCH_OBSERVATION_REGRESSION');const w=phase(release,clock);if(w.phase!=='MANUFACTURE'||w.round!==m.round)return out('REPLAN_STALE_STATE');}
  const lastPending=await knownRequest(executorSession,executorNonce);if(lastPending)return out('RECOVER_CURRENT_REQUEST',{recoveryNonce:executorNonce,requestOperation:decodeNativeFrame(abi,lastPending.frameBytes).operation});
  if(finalContext)await store.recordFinalAttempt(m,proposed);
  return json({...common,decision:'ACTION',contextSlot:last.contextSlot,stage:{kind,requiredActor,nonce:executorNonce},intent:nativeActionIntent(proposed,m.resources),preview,...(reveal?{summary:again.summary,verification:verificationPublic(matching(m,last.prior.verification)?last.prior.verification:null)}:{}),requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null});
});}
