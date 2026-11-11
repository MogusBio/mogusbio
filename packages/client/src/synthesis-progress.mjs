import {asBytes,sha256,decodeDebitPlan,F1_EFFECTIVE_SPECIES} from '../../protocol-core/src/index.mjs';
import {decodeGraph,validateGraph} from '../../biology/src/graph.mjs';
import {designId} from '../../biology/src/canonical.mjs';
import {encodeLeafMap,validateSourceUnion} from '../../composition/src/payload.mjs';
import {PROGRAMS,baseConfigR2Id} from './release.mjs';
import {decodeNativeBaseConfig,decodeNativeRoot} from './accounts.mjs';
import {decodeNativeClock,decodeNativeEconomyConfig} from './economy-accounts.mjs';
import {decodeActorNonceSnapshot} from './journal.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda,nativeRequestHash,decodeNativeFrame,encodeNativeFrame,buildNativeInstruction,encodeArtifactPutPayload,encodeArtifactSealPayload,encodeVerifyBeginPayload} from './native.mjs';
import {readSynthesisInputs,planActualSynthesis} from './synthesis-inputs.mjs';
import {createSynthesisManifest,publicSynthesisWorkflow} from './synthesis-manifest.mjs';
import {decodeNativeSynthesisArtifact,decodeNativePriorVerification,decodeNativeSynthesisFinalizeResult} from './synthesis-records.mjs';
import {planNextSynthesisStep} from './synthesis-workflow.mjs';
import {planActualSynthesisFinalization} from './synthesis-final.mjs';
import {nativeActionIntent} from './player-settlement.mjs';
import {validateV1Resources} from './transaction.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const hex=b=>Buffer.from(b).toString('hex');
const pda=(r,...s)=>nativePda(r.input.programId,'bio',...s).then(p=>p.address);
const absent=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&asBytes(a.data).equals(asBytes(b.data));
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,reservesOnChainNonce:false};
const readArgs=(release,rpc,m)=>({release,rpc,actor:m.actor,target:m.plan.target,directIds:m.plan.payload.direct.map(d=>d.instance)});

/** A local graph is explicitly rebound only from the known zero deployment
 * context. Foreign nonzero deployments are never silently imported. */
export function bindSynthesisDesignGraph({release,graphBytes}){
  const graph=decodeGraph(asBytes(graphBytes));
  if(graph.domain.every(n=>n===0)&&graph.config.every(n=>n===0)){graph.domain=Buffer.from(release.domain);graph.config=baseConfigR2Id(release);}
  validateGraph(graph,{domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash});
  return graph;
}
export async function saveGuidedSynthesisWorkflow({release,abi,rpc,actor,graph,directIds,challengePpm,maxRent,maxUploadRent,maxFee,resources,store}){
  validateV1Resources(resources);for(const n of [maxRent,maxUploadRent,maxFee])check(typeof n==='bigint'&&n>=0n&&n<(1n<<64n),'SYN_PROGRESS_U64');
  const read=await planActualSynthesis({release,abi,rpc,actor,graph,directIds,challengePpm});
  const common={...flags,actor:nativeKeyAddress(actor),decision:read.decision,contextSlot:read.contextSlot,...(read.summary?{summary:read.summary,eligibility:read.eligibility}:{})};
  if(read.decision!=='SYNTHESIS_PLANNED')return common;
  const m=await createSynthesisManifest({release,abi,actor,plan:read.plan,directInputs:read.directInputs,challengePpm,maxRent,maxUploadRent,maxFee,resources}),saved=await store.save(m);
  return {...common,decision:'WORKFLOW_SAVED',workflow:publicSynthesisWorkflow(m),alreadySaved:saved.alreadySaved,requiresExplicitNextRead:true,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null};
}
async function snapshot(release,rpc,m){
  const keys=[release.pdas.baseConfig.address,await pda(release,'econ-config'),PROGRAMS.clockSysvar,await pda(release,'actor-nonce',nativeKeyBytes(m.actor)),await pda(release,'artifact',m.plan.artifactId),await pda(release,'verify',nativeKeyBytes(m.actor))];
  const {accounts,contextSlot}=await rpc.getMultipleAccounts(keys);await decodeNativeBaseConfig(release,accounts[0]);await decodeNativeEconomyConfig(release,accounts[1]);
  const clock=decodeNativeClock(accounts[2]),nonce=await decodeActorNonceSnapshot({release,actor:m.actor,address:keys[3],account:accounts[3],contextSlot,commitment:'finalized'});
  const artifact=absent(accounts[4])?null:await decodeNativeSynthesisArtifact({release,info:accounts[4],artifactId:m.plan.artifactId,actor:m.actor,expectedBody:m.plan.bytes});
  const prior=await decodeNativePriorVerification({release,info:accounts[5],actor:m.actor,contextSlot});
  check(prior.clock<=clock.unixTimestamp&&(!artifact?.sealed||artifact.sealedAt<=clock.unixTimestamp&&artifact.sealedSlot<=clock.slot),'SYN_PROGRESS_FUTURE_STATE');
  return {accounts,clock,nonce,artifact,prior,contextSlot,keys};
}
function forward(a,b){check(b.clock.slot>=a.clock.slot&&b.clock.unixTimestamp>=a.clock.unixTimestamp&&b.nextNonce>=a.nextNonce,'SYN_PROGRESS_STATE_REGRESSION');}
const observation=s=>({clock:s.clock,nextNonce:s.nonce.nextNonce});
async function knownRequest(session,n){try{return await session.getRequest(n);}catch(e){if(['JOURNAL_NOT_FOUND','JOURNAL_ARCHIVE_NOT_FOUND'].includes(e.code))return null;throw e;}}
function sessionContext(release,abi,actor,session){const c=session?.recoveryIdentity;check(c?.actor===nativeKeyAddress(actor)&&c.releaseHash===release.input.releaseHash&&c.abiHash===abi.hash&&c.domainHex===hex(release.domain)&&c.configHex===hex(baseConfigR2Id(release)),'SYN_PROGRESS_SESSION');}
async function frozenInputs(release,m,read,{consumed=false}={}){
  const facts=[];
  for(const d of m.plan.payload.direct){
    const row=read.directInputs.find(i=>i.instance.equals(d.instance));check(row,'SYN_PROGRESS_DIRECT_MISSING');
    const root=await decodeNativeRoot(release,row.account,d.instance),frozen=m.plan.directRoots.find(r=>r.instance.equals(d.instance));
    check(root.fingerprint.equals(d.fingerprint)&&root.owner===m.actor&&root.revision===d.expectedRevision+(consumed?1n:0n)&&root.lifecycle===(consumed?1:0)&&root.createdAt===frozen.createdAt&&root.createdSlot===frozen.createdSlot,'SYN_PROGRESS_DIRECT_CHANGED');
    facts.push({row,root});
  }
  return facts;
}
function inputRecordsSame(a,b){
  return a.directInputs.every(row=>{const other=b.directInputs.find(i=>i.instance.equals(row.instance));return other&&same(row.account,other.account)&&same(row.rootReg,other.rootReg)&&(row.originalArtifact===undefined?other.originalArtifact===undefined:same(row.originalArtifact,other.originalArtifact));});
}
const publicVerification=v=>v?{generation:v.generation,phase:v.phase,workSequence:v.workSequence,progress:v.progress,physicsRound:v.physicsRound,target:v.target,challengePpm:v.challengePpm,qualityPpm:v.qualityPpm,taskApplicable:v.taskApplicable,cost:v.cost,used:v.used}:null;
const boundVerification=(m,v)=>v&&v.artifactId.equals(m.plan.artifactId)&&v.artifactSHA.equals(m.plan.artifactSHA)&&v.target===m.plan.target&&v.challengePpm===m.challengePpm?v:null;
const rootPublic=(r,m)=>({instanceHex:hex(r.instance),owner:r.owner,lifecycle:r.lifecycle,schema:r.schema,target:r.target,artifactIdHex:hex(m.plan.artifactId),descriptorHex:hex(r.descriptor),qualityPpm:r.qualityPpm,B:r.B,retired:r.retired});
function assertOutputVerification(m,root,data,unionSHA,v){
  if(!v?.artifactId.equals(m.plan.artifactId))return;
  const directAt=21+m.plan.bytes.readUInt32LE(16),leafAt=directAt+m.plan.payload.direct.length*74;
  check(v.used&&v.phase===6&&v.physicsRound===73&&v.qualityPpm===root.qualityPpm&&v.transcriptDigest.equals(data.subarray(623,655))&&v.artifactSHA.equals(m.plan.artifactSHA)&&v.artifactLength===m.plan.bytes.length&&v.target===m.plan.target&&v.challengePpm===m.challengePpm&&v.graphSHA.equals(m.plan.graphSHA)&&v.B===root.B&&v.retired===root.retired&&v.leafCount===m.plan.payload.leaves.length&&v.directCount===m.plan.payload.direct.length&&v.directSHA.equals(sha256(m.plan.bytes.subarray(directAt,leafAt)))&&v.leafSHA.equals(data.subarray(543,575))&&v.unionSHA.equals(unionSHA)&&v.taskApplicable===(root.admission===1)&&v.cost===root.cost,'SYN_OUTPUT_VERIFICATION');
}
async function outputState(release,abi,session,m,hints,read,s){
  const facts=await frozenInputs(release,m,read,{consumed:true}),first=facts[0].root,id=first.parent;
  check(facts.every(({root})=>root.parent.equals(id)&&root.consumedBusiness.equals(first.consumedBusiness)),'SYN_OUTPUT_DIFFERENT_PARENTS');
  const address=await pda(release,'root',id),{accounts:[info],contextSlot}=await session.rpc.getMultipleAccounts([address]),root=await decodeNativeRoot(release,info,id),data=info.data;
  check(root.schema===(m.plan.target<=15?2:m.plan.target<=21?3:4)&&root.target===m.plan.target&&root.manufactureBusiness.equals(first.consumedBusiness)&&data.subarray(443,475).equals(m.plan.artifactId)&&data.subarray(475,507).equals(m.plan.artifactSHA)&&data.readUInt32LE(507)===m.plan.bytes.length&&data.subarray(511,543).equals(m.plan.graphSHA)&&data.subarray(543,575).equals(sha256(encodeLeafMap(m.plan.payload.leaves)))&&root.challengePpm===m.challengePpm&&data.subarray(727,759).equals(designId(m.plan.payload.graph)),'SYN_OUTPUT_BINDING');
  check(root.B===BigInt(m.plan.payload.leaves.length)*120000n&&root.retired===BigInt(m.plan.payload.leaves.length)*45000n&&root.createdAt<=s.clock.unixTimestamp&&root.createdSlot<=s.clock.slot,'SYN_OUTPUT_FACTS');
  const leaves=m.plan.payload.capsules.map(capsule=>{
    const rows=decodeDebitPlan(capsule.subarray(322)).flatMap(group=>group.entries.map(e=>({sourceId:group.sourceId,species:e.species,lo:e.expectedPrefix,hi:e.expectedPrefix+e.takeTick})));
    return {effective:rows.filter(r=>F1_EFFECTIVE_SPECIES.includes(r.species)),retired:rows.filter(r=>!F1_EFFECTIVE_SPECIES.includes(r.species))};
  }),unionSHA=validateSourceUnion(leaves).effectiveUnionSHA;
  check(data.subarray(575,607).equals(unionSHA),'SYN_OUTPUT_UNION');
  check(facts.every(({row})=>row.account.data.readBigInt64LE(427)===root.createdAt&&row.account.data.readBigUInt64LE(435)===root.createdSlot),'SYN_OUTPUT_CONSUMPTION_TIME');
  check(s.artifact?.sealed===true&&s.artifact.fullPayloadHashVerified&&s.artifact.sealedAt<=root.createdAt&&s.artifact.sealedSlot<=root.createdSlot,'SYN_OUTPUT_ARTIFACT');
  const v=s.prior.verification;
  assertOutputVerification(m,root,data,unionSHA,v);
  let exact=false,receipt=null,resultSource=null;
  if(hints.finalFrameHex){
    const frame=Buffer.from(hints.finalFrameHex,'hex'),f=decodeNativeFrame(abi,frame);
    if(nativeRequestHash(abi,frame).equals(root.requestHash)){
      const entry=await knownRequest(session,f.nonce);
      if(entry&&asBytes(entry.frameBytes).equals(frame)){
        const result=await session.reconcile(f.nonce);
        if(result.decision==='CONFIRMED'&&result.businessExecutionVerified===true){
          receipt=await decodeNativeSynthesisFinalizeResult({release,abi,frame,result:result.resultBytes,artifactBody:m.plan.bytes});
          check(receipt.outputId.equals(id)&&receipt.qualityPpm===root.qualityPpm&&receipt.modelDigest.equals(data.subarray(623,655)),'SYN_OUTPUT_RECEIPT');exact=true;resultSource=result.resultSource??null;
        }
      }
    }
  }
  const finalInputs=await readSynthesisInputs(readArgs(release,session.rpc,m));
  if(finalInputs.decision!=='INPUTS_READ')return {decision:finalInputs.decision,outputVerified:false,root:null,contextSlot:finalInputs.contextSlot};
  const last=await snapshot(release,session.rpc,m),{accounts:[again],contextSlot:lastSlot}=await session.rpc.getMultipleAccounts([address]);
  forward(read,observation(s));forward(observation(s),finalInputs);forward(finalInputs,observation(last));
  if(!inputRecordsSame(read,finalInputs)||!same(info,again)||!same(s.accounts[4],last.accounts[4]))return {decision:'REPLAN_STALE_STATE',outputVerified:false,root:null,contextSlot:lastSlot};
  assertOutputVerification(m,root,data,unionSHA,last.prior.verification);
  return {decision:'OUTPUT_READ',contextSlot:lastSlot,outputVerified:true,workflowComplete:true,exactRequestExecutionVerified:exact,businessExecutionVerified:exact,resultSource,receipt,root:rootPublic(root,m),summary:finalInputs.summary,verification:publicVerification(boundVerification(m,last.prior.verification)),previousVerificationReplaced:!boundVerification(m,last.prior.verification),actualOutputCreatedAt:root.createdAt};
}
async function action(release,abi,m,nonce,operation,payload,suffix,dynamicAccounts=[]){
  const frame=encodeNativeFrame(abi,{operation,domain:release.domain,configId:baseConfigR2Id(release),actor:nativeKeyBytes(m.actor),nonce,payload});
  return {operation,nonce,payload,frame,suffix,dynamicAccounts,clientPlanOnly:true,instruction:await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts})};
}

/** Ordinary read-driven synthesis. Local hint writes and session reconciliation
 * retain recovery facts; only the existing explicit console can send anything. */
export async function readGuidedSynthesisProgress({release,abi,session,actor,workflowId,store}){
  sessionContext(release,abi,actor,session);const m=await store.load({release,abi,actor,workflowId}),hints=await store.loadHints(m),rpc=session.rpc;
  const common={...flags,actor:m.actor,workflow:publicSynthesisWorkflow(m),outputVerified:false,exactRequestExecutionVerified:false,root:null,lookupOnly:true};
  const read=await readSynthesisInputs(readArgs(release,rpc,m));if(read.decision!=='INPUTS_READ')return {...common,decision:read.decision,contextSlot:read.contextSlot};
  const s=await snapshot(release,rpc,m);forward(read,observation(s));
  if(read.eligibility.every(r=>r.lifecycle===1))return {...common,...await outputState(release,abi,session,m,hints,read,s)};
  if(!read.allEligible)return {...common,decision:'INPUTS_BLOCKED',contextSlot:read.contextSlot,summary:read.summary,eligibility:read.eligibility};
  await frozenInputs(release,m,read);const n=s.nonce.nextNonce,pending=await knownRequest(session,n);
  if(pending!==null)return {...common,decision:'RECOVER_CURRENT_REQUEST',contextSlot:s.contextSlot,recoveryNonce:n,requestOperation:decodeNativeFrame(abi,pending.frameBytes).operation,summary:read.summary};
  check(n<(1n<<64n)-1n,'SYN_PROGRESS_NONCE_EXHAUSTED');const artifactAddress=s.keys[4],verifyAddress=s.keys[5];let proposed,kind,preview={},finalContext=null,finalClock=null;
  if(s.artifact===null||s.artifact.written<m.plan.bytes.length){
    kind='UPLOAD';const offset=s.artifact?.written??0,sequence=s.artifact?.sequence??0n;
    proposed=await action(release,abi,m,n,'ARTIFACT_PUT',encodeArtifactPutPayload({kind:702,totalLength:m.plan.bytes.length,artifactSHA:m.plan.artifactSHA,expectedSequence:sequence,offset,chunk:m.plan.bytes.subarray(offset,offset+1024),maxRent:m.maxUploadRent}),[{name:'Artifact',address:artifactAddress}]);
    preview={written:offset,total:m.plan.bytes.length,sequence};
  }else if(!s.artifact.sealed){
    kind='SEAL';proposed=await action(release,abi,m,n,'ARTIFACT_SEAL',encodeArtifactSealPayload({kind:702,artifactId:m.plan.artifactId,expectedSequence:s.artifact.sequence,maxRent:m.maxUploadRent}),[{name:'Artifact',address:artifactAddress}]);
  }else{
    const v=s.prior.verification,matching=v?.artifactId.equals(m.plan.artifactId)&&v.artifactSHA.equals(m.plan.artifactSHA)&&v.challengePpm===m.challengePpm;
    if(!matching){
      if(s.prior.generation===(1n<<64n)-1n)return {...common,decision:'VERIFICATION_GENERATION_EXHAUSTED',contextSlot:s.contextSlot};
      kind='BEGIN';proposed=await action(release,abi,m,n,'VERIFY_BEGIN',encodeVerifyBeginPayload({artifactId:m.plan.artifactId,artifactSHA:m.plan.artifactSHA,artifactLength:m.plan.bytes.length,challengePpm:m.challengePpm,expectedGeneration:s.prior.generation,maxRent:m.maxRent}),[{name:'Artifact',address:artifactAddress},{name:'Verification',address:verifyAddress}],m.plan.directRoots.map(r=>({address:r.address,writable:false,signer:false})));
      preview={priorGeneration:s.prior.generation,replacesPreviousVerification:s.prior.exists};
    }else if(v.used)return {...common,decision:'USED_VERIFICATION_WITH_LIVE_INPUTS',contextSlot:s.contextSlot,verification:publicVerification(boundVerification(m,v))};
    else if(v.phase<6){kind='STEP';proposed=await planNextSynthesisStep({release,abi,plan:m.plan,verification:v,nonce:n,maxRent:m.maxRent});}
    else{
      kind='FINAL';const lookup=hints.positionLookup;
      const final=await planActualSynthesisFinalization({release,abi,rpc,actor:m.actor,plan:m.plan,verification:v,maxRent:m.maxRent,maxFee:m.maxFee,...(lookup?.nextStart===null||!lookup?{}:{positionLookupStart:BigInt(lookup.nextStart),positionLookupContext:{activationIdHex:lookup.activationIdHex,rootInstanceHex:lookup.rootInstanceHex,positionIdHex:lookup.positionIdHex,ordinaryCount:lookup.ordinaryCount}})});
      if(final.decision!=='ACTION'){
        if(final.decision==='K_POSITION_LOOKUP_REQUIRED'&&final.lookup)await store.savePositionLookup(m,final.lookup);
        return {...common,decision:final.decision,contextSlot:final.contextSlot??s.contextSlot,preview:final.preview??null,...(final.lookup?{lookup:final.lookup}:{}),summary:read.summary,verification:publicVerification(v)};
      }
      check(final.finalizationContext,'SYN_PROGRESS_FINAL_CONTEXT');proposed=final.action;preview=final.preview??{};finalContext=final.finalizationContext;finalClock=final.clock;
    }
  }
  const finalInputs=await readSynthesisInputs(readArgs(release,rpc,m));
  if(finalInputs.decision!=='INPUTS_READ')return {...common,decision:finalInputs.decision,contextSlot:finalInputs.contextSlot};
  const last=await snapshot(release,rpc,m);forward(observation(s),finalInputs);forward(finalInputs,observation(last));
  if(!finalInputs.allEligible||!inputRecordsSame(read,finalInputs)||last.nonce.nextNonce!==n||proposed.nonce!==n||!same(s.accounts[4],last.accounts[4])||!same(s.accounts[5],last.accounts[5]))return {...common,decision:'REPLAN_STALE_STATE',contextSlot:last.contextSlot};
  let contextSlot=last.contextSlot;
  if(finalContext){
    // Later input/snapshot reads must not let an old Task/K/LAB/Registry tail
    // escape the FINAL planner's full observation. Missing output accounts are
    // part of the same closure, including a missing→created NewRoot race.
    const reread=await rpc.getMultipleAccounts(finalContext.observedAddresses);contextSlot=reread.contextSlot;
    if(!finalContext.observedAccounts.every((before,i)=>finalContext.observedAddresses[i]===PROGRAMS.clockSysvar||same(before,reread.accounts[i])&&(before===null||before.lamports===reread.accounts[i].lamports)))return {...common,decision:'REPLAN_STALE_STATE',contextSlot};
    const clock=decodeNativeClock(reread.accounts[finalContext.observedAddresses.indexOf(PROGRAMS.clockSysvar)]);forward(observation(last),{clock,nextNonce:n});
    const hour=t=>(t-release.rewardStart)/3600n,round=t=>(t-release.rewardStart)/259200n;
    if(hour(clock.unixTimestamp)!==hour(finalClock.unixTimestamp)||round(clock.unixTimestamp)!==round(finalClock.unixTimestamp))return {...common,decision:'REPLAN_STALE_STATE',contextSlot};
    await store.recordFinalAttempt(m,proposed);
  }
  return {...common,decision:'ACTION',contextSlot,stage:{kind,nonce:n},intent:nativeActionIntent(proposed,m.resources),preview,summary:finalInputs.summary,verification:publicVerification(boundVerification(m,last.prior.verification)),requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null};
}
