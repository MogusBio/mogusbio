// Explicit offline public-fixture signer/controller. stdin/stdout are solely
// the local Rust ProgramTest harness; no network, user wallet or private keys.
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {createKeyPairFromPrivateKeyBytes,getAddressFromPublicKey,signTransaction} from '@solana/kit';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {validateProductionRelease,PROGRAMS} from '../packages/client/src/release.mjs';
import {nativeKeyBytes,nativeKeyAddress,nativePda,loadNativeAbi,encodeNativeFrame,buildNativeInstruction,decodeNativeFrame} from '../packages/client/src/native.mjs';
import {buildV1Transaction,transactionBytes} from '../packages/client/src/transaction.mjs';
import {decodeSynthesisPayload} from '../packages/composition/src/payload.mjs';
import {encodeGraph,decodeGraph,designId,runSuite,projectGraph} from '../packages/biology/src/index.mjs';
import {ResearchWorkflowStore} from '../packages/client/src/research-manifest.mjs';
import {saveGuidedResearchWorkflow,readGuidedResearchProgress} from '../packages/client/src/research-progress.mjs';
import {FileJournalStore} from '../packages/client/src/file-journal.mjs';
import {NativePlayerSession} from '../packages/client/src/session.mjs';
import {ReadOnlyRpc} from '../packages/client/src/rpc.mjs';
import {planNextCompetitionRound} from '../packages/client/src/competition-round.mjs';
import {planActualSynthesis} from '../packages/client/src/synthesis-inputs.mjs';
import {decodeNativeEconomyConfig,decodeNativeClock} from '../packages/client/src/economy-accounts.mjs';
import {decodeNativeOriginalityTask,decodeNativeKSlot,decodeNativeOpeningSnapshot} from '../packages/client/src/originality-accounts.mjs';
import {decodeNativePriorVerification} from '../packages/client/src/synthesis-records.mjs';
import {decodeNativeActivation} from '../packages/client/src/accounts.mjs';
import {planPlayerAssetAction,planGuidedPositionAction} from '../packages/client/src/player-assets.mjs';
import {planGuidedGlobalSettlement} from '../packages/client/src/mining-dashboard.mjs';
import {planPlayerLifecycleAction} from '../packages/client/src/player-lifecycle.mjs';
import {TASK_FAMILY as F} from '../packages/originality/src/wire.mjs';

const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const receive=async()=>{const next=await lines.next();assert.ok(!next.done,'Bank harness stopped');return JSON.parse(next.value);};
const talk=async command=>{process.stdout.write(JSON.stringify(command)+'\n');const r=await receive();if(r.error)throw new Error(r.error);return r;};
const init=await receive();assert.equal(init.schema,'BIO-RESEARCH-BANK-DRIVER-1');
const release=await validateProductionRelease(JSON.parse(await readFile('programs/biolab-economy/evidence/production-admission-fixture-result58.json','utf8')),{localPublicFixture:true}),abi=loadNativeAbi(undefined,{expectedHash:release.input.abiHash});
const pair=n=>createKeyPairFromPrivateKeyBytes(createHash('sha256').update(`BIOP0R2 native SIGNING FIXTURE ONLY ${n}`).digest()),authorPair=await pair(1),crankerPair=await pair(8),author=await getAddressFromPublicKey(authorPair.publicKey),cranker=await getAddressFromPublicKey(crankerPair.publicKey);
assert.equal(author,release.input.bootstrap);assert.equal(cranker,init.cranker);assert.equal(release.input.programId,init.programId);
const fixture=JSON.parse(await readFile('programs/transaction-transport/evidence/synthesis-result-bank-76b35cfb-target-22.json','utf8')),old=decodeSynthesisPayload(Buffer.from(fixture.artifactBodyHex,'hex')),positive=init.design==='C310',graph=positive?decodeGraph(await readFile('programs/transaction-transport/evidence/research-c310-graph-76b35cfb.bin')):structuredClone(old.graph),expectedCost=positive?310:320;
if(!positive)graph.slots=graph.slots.map(v=>({...v,x:4-v.x}));assert.notDeepEqual(encodeGraph(graph),encodeGraph(old.graph));if(!positive)assert.deepEqual(designId(graph),designId(old.graph));for(let t=16;t<=21;t++)assert.deepEqual(encodeGraph(projectGraph(graph,t)),encodeGraph(projectGraph(old.graph,t)));const model=runSuite(graph,{challenge:2000000});assert.equal(model.quality,2000000);assert.equal(model.cost,expectedCost);
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const fetchImpl=async(_url,options)=>{const q=parseJsonWithBigInts(options.body);let result;if(q.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);else if(q.method==='getMultipleAccounts'){const r=await talk({command:'accounts',addresses:q.params[0]});result={context:{slot:BigInt(r.slot)},value:r.accounts.map(a=>a===null?null:{...a,lamports:BigInt(a.lamports),rentEpoch:BigInt(a.rentEpoch)})};}else throw new Error(`BANK_READ_METHOD_${q.method}`);return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:q.id,result}));};
const rpc=()=>new ReadOnlyRpc({release,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl});
const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-current-research-bank-')),workflowDirectory=path.join(directory,'workflows'),store=new ResearchWorkflowStore({directory:workflowDirectory});
const sessions=new Map();
async function session(actor){if(!sessions.has(actor)){const journal=await FileJournalStore.open({directory:path.join(directory,nativeKeyBytes(actor).toString('hex'))});sessions.set(actor,new NativePlayerSession({release,abi,actor,store:journal,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl}));}return sessions.get(actor);}
async function execute(intent,actor,label,{expectSuccess=true,cache=false,corruptFee=false}={}){
  const payload=Buffer.from(intent.payloadHex,'hex');if(corruptFee)payload.writeBigUInt64LE(11999999n,108);
  const frame=encodeNativeFrame(abi,{operation:intent.operation,domain:release.domain,configId:release.hashes.baseConfigId??Buffer.from(init.configHex,'hex'),actor,nonce:BigInt(intent.nonce),payload});
  const instruction=await buildNativeInstruction({release,abi,frame,suffix:intent.suffix??[],dynamicAccounts:intent.dynamicAccounts??[]}),life=await talk({command:'lifetime'}),chosen={...resources,computeUnitLimit:cache?1399999:1400000};
  const built=buildV1Transaction({feePayer:actor,supportedTransactionVersions:[1],instructions:[instruction],lifetime:{blockhash:life.blockhash,lastValidBlockHeight:BigInt(life.lastValidBlockHeight)},resources:chosen}),signed=await signTransaction([actor===author?authorPair:crankerPair],built.transaction);
  return talk({command:'execute',label,actor,operation:intent.operation,frameHex:frame.toString('hex'),instruction:{programId:instruction.programAddress,dataHex:frame.toString('hex'),accounts:instruction.accounts.map(a=>({pubkey:a.address,isSigner:Boolean(a.role&2),isWritable:Boolean(a.role&1)}))},bytesHex:transactionBytes(signed).toString('hex'),expectSuccess,cache});
}
const actionIntent=a=>({operation:a.operation,nonce:a.nonce.toString(),payloadHex:Buffer.from(a.payload).toString('hex'),suffix:a.suffix,dynamicAccounts:a.dynamicAccounts});
try{
  const initialClock=BigInt(init.unixTimestamp),round=(initialClock-release.rewardStart)/259200n+1n,commitAt=release.rewardStart+round*259200n+100n;await talk({command:'clock',unixTimestamp:commitAt.toString()});
  const preflight=rpc(),pk=async(...seeds)=>(await nativePda(release.input.programId,'bio',...seeds)).address;await preflight.verifyBaseConfig();await preflight.getActorNonce(author);await preflight.getActorNonce(cranker);
  const probe=await preflight.getMultipleAccounts([await pk('econ-config'),PROGRAMS.clockSysvar,await pk('task',F),await pk('k-slot',F),await pk('seed-final',F),await pk('verify',nativeKeyBytes(author))]);await decodeNativeEconomyConfig(release,probe.accounts[0]);decodeNativeClock(probe.accounts[1]);const task=await decodeNativeOriginalityTask(release,probe.accounts[2]);await decodeNativeKSlot(release,probe.accounts[3],{generation:task.generation});await decodeNativeOpeningSnapshot(release,probe.accounts[4]);await decodeNativePriorVerification({release,info:probe.accounts[5],actor:author,contextSlot:probe.contextSlot});const planned=await planActualSynthesis({release,abi,rpc:preflight,actor:author,graph,directIds:old.direct.map(d=>d.instance),challengePpm:2000000});assert.equal(planned.decision,'SYNTHESIS_PLANNED');
  const saved=await saveGuidedResearchWorkflow({release,abi,rpc:rpc(),author,cranker,graph,directIds:old.direct.map(d=>d.instance),maxRent:1000000000n,maxUploadRent:1000000000n,maxFee:12000000n,resources,requestId:createHash('sha256').update(`CURRENT76B ACTUAL SIGNED RESEARCH BANK ACCEPTANCE ${init.design}`).digest('hex'),store});assert.equal(saved.decision,'WORKFLOW_SAVED',saved.decision);const workflowId=saved.workflow.workflowId,m=await store.load({release,abi,author,workflowId});
  assert.notDeepEqual(m.baseManifest.plan.artifactId,Buffer.from(fixture.frameHex,'hex').subarray(152,184));
  const progress=async(actor=author)=>readGuidedResearchProgress({release,abi,authorSession:await session(author),executorSession:await session(actor),actor,author,workflowId,store:new ResearchWorkflowStore({directory:workflowDirectory})});
  let out=await progress();assert.equal(out.stage.kind,'COMMIT');const committed=await execute(out.intent,author,'COMMIT');const cachedCommit=await execute(out.intent,author,'COMMIT_CACHE',{cache:true});assert.equal(cachedCommit.returnDataHex,committed.returnDataHex);
  out=await progress();assert.equal(out.decision,'WAIT_MANUFACTURE_WINDOW');assert.equal(out.intent,undefined);
  await talk({command:'clock',unixTimestamp:(release.rewardStart+round*259200n+86400n+100n).toString()});let steps=0,restarted=false,stages=[];
  for(let iteration=0;iteration<3000;iteration++){
    out=await progress();if(out.decision==='CRANKER_REQUIRED')out=await progress(cranker);assert.equal(out.decision,'ACTION',JSON.stringify({decision:out.decision,preview:out.preview}));const kind=out.stage.kind;stages.push(kind);
    if(kind==='FINAL'){
      assert.equal(out.verification.physicsRound,73);assert.equal(out.verification.cost,String(expectedCost));assert.equal(out.intent.payloadHex.length,378);await execute(out.intent,author,'FINAL_FEE_CAP_ROLLBACK',{expectSuccess:false,corruptFee:true});
      const final=await execute(out.intent,author,'FINAL_189'),cached=await execute(out.intent,author,'FINAL_CACHE',{cache:true});assert.equal(cached.returnDataHex,final.returnDataHex);assert.equal(final.returnDataHex.length,312);break;
    }
    await execute(out.intent,kind==='STEP'?cranker:author,kind);if(kind==='STEP')steps++;
    if(steps===7&&!restarted){await talk({command:'restart',label:'mid_variable_STEP'});sessions.clear();restarted=true;}
    if(iteration===2999)throw new Error('RESEARCH_BANK_STEP_BOUND');
  }
  await talk({command:'restart',label:'after_FINAL_and_cache'});sessions.clear();out=await progress();assert.equal(out.decision,'OUTPUT_READ');assert.equal(out.outputVerified,true);assert.equal(out.competitionCandidateVerified,true);assert.equal(out.winnerRecognized,false);assert.equal(out.exactRequestExecutionVerified,false);
  const actualOutput=out.root,rootInstance=Buffer.from(actualOutput.instanceHex,'hex');
  if(positive){const stake=await planPlayerAssetAction({release,abi,rpc:rpc(),actor:author,instance:rootInstance,kind:'stake',beneficiary:author,maxRent:1000000000n});assert.equal(stake.decision,'ACTION',stake.decision);await execute(actionIntent(stake.action),author,'REGISTER_ORDINARY');}
  await talk({command:'clock',unixTimestamp:(release.rewardStart+(round+1n)*259200n+100n).toString()});const roundPhases=[];
  for(let n=0n;n<=round;n++)for(let i=0;i<100;i++){
    const plan=await planNextCompetitionRound({release,abi,rpc:rpc(),actor:author,round:n,maxRent:1000000000n,limit:8});
    if(plan.decision==='ROUND_COMPLETE'){if(n===round){assert.equal(plan.winnerRecognized,positive);assert.equal(plan.activationRecorded,positive);}break;}
    assert.equal(plan.decision,'ACTION',plan.decision);roundPhases.push({round:n.toString(),phase:plan.phase,candidateCursor:plan.preview.candidateCursor.toString(),scanCursor:plan.preview.scanCursor.toString()});const intent=actionIntent(plan.action);await execute(intent,author,`ROUND_${n}_PHASE_${plan.phase}`);if(positive&&n===round&&plan.phase===3)await execute(intent,author,'WINNER_K_CACHE',{cache:true});if(i===99)throw new Error('ROUND_STEP_BOUND');
  }
  let mining=null;
  if(positive){
    const chain=rpc(),slotInfo=await chain.getMultipleAccounts([await pk('k-slot',F)]),ks=await decodeNativeKSlot(release,slotInfo.accounts[0]),activationInfo=await chain.getMultipleAccounts([await pk('activation',ks.current)]),activation=await decodeNativeActivation(release,activationInfo.accounts[0],ks.current);assert.equal(ks.status,1);assert.equal(activation.end,null);assert.deepEqual(activation.instance,rootInstance);
    const kHour=activation.start,source=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(author),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(release.pdas.labMint.address))).address;
    const wallet=async()=>{const r=await rpc().getMultipleAccounts([source]);return r.accounts[0].data.readBigUInt64LE(64);},balanceBefore=await wallet();
    async function crank(){for(let i=0;i<1000;i++){const p=await planGuidedGlobalSettlement({release,abi,rpc:rpc(),actor:author,maxRent:1000000000n});if(p.decision==='WAIT_COMPLETED_HOUR')return;if(p.decision!=='ACTION')throw new Error(`GLOBAL_${p.decision}`);await execute(actionIntent(p.action),author,`GLOBAL_${p.action.operation}`);}throw new Error('GLOBAL_BOUND');}
    async function accrue(){let kPaid=0n;for(let i=0;i<200;i++){const p=await planGuidedPositionAction({release,abi,rpc:rpc(),actor:author,instance:rootInstance,positionSeq:0n,kind:'accrue',maxRent:1000000000n});if(['WAIT_FROZEN_FRONTIER','COVERAGE_COMPLETE'].includes(p.decision))return {decision:p.decision,kPaid};assert.equal(p.decision,'ACTION',p.decision);if(p.hour===kHour){kPaid=p.previewAtoms;assert.equal(kPaid,856164n);}await execute(actionIntent(p.action),author,`ACCRUE_${p.hour}`);}throw new Error('ACCRUE_BOUND');}
    async function claim(label){const p=await planGuidedPositionAction({release,abi,rpc:rpc(),actor:author,instance:rootInstance,positionSeq:0n,kind:'claim',maxRent:1000000000n});assert.equal(p.decision,'ACTION',p.decision);const b=await wallet();await execute(actionIntent(p.action),author,label);await execute(actionIntent(p.action),author,`${label}_CACHE`,{cache:true});const after=await wallet();assert.equal(after-b,p.previewAtoms);return p.previewAtoms;}
    await talk({command:'clock',unixTimestamp:(release.rewardStart+(kHour+1n)*3600n+100n).toString()});await crank();const first=await accrue();assert.equal(first.kPaid,856164n);const claim1=await claim('CLAIM_NORMAL_PLUS_K');
    const exit=await planPlayerLifecycleAction({release,abi,rpc:rpc(),actor:author,instance:rootInstance,kind:'exit',maxRent:1000000000n});assert.equal(exit.decision,'ACTION',exit.decision);await execute(actionIntent(exit.action),author,'EXIT_OPEN_K');await execute(actionIntent(exit.action),author,'EXIT_OPEN_K_CACHE',{cache:true});await talk({command:'restart',label:'after_openK_exit_before_last_accrue'});sessions.clear();
    await talk({command:'clock',unixTimestamp:(release.rewardStart+(kHour+3n)*3600n+100n).toString()});await crank();assert.equal((await accrue()).decision,'COVERAGE_COMPLETE');const claim2=await claim('CLAIM_FINAL_K_HOUR'),last=await planGuidedPositionAction({release,abi,rpc:rpc(),actor:author,instance:rootInstance,positionSeq:0n,kind:'claim',maxRent:1000000000n});assert.equal(last.decision,'NO_ACCRUED_DEBT');assert.equal(claim1+claim2,24315048n);assert.equal(await wallet()-balanceBefore,24315048n);
    const ended=await rpc().getMultipleAccounts([await pk('activation',ks.current),await pk('k-slot',F)]),actualEnd=await decodeNativeActivation(release,ended.accounts[0],ks.current),endedSlot=await decodeNativeKSlot(release,ended.accounts[1]);assert.equal(actualEnd.end,kHour+2n);assert.equal(endedSlot.status,2);assert.deepEqual(endedSlot.current,ks.current);
    mining={actualKStart:kHour.toString(),actualKEnd:actualEnd.end.toString(),actualCombinedKHourAtoms:'856164',actualFirstClaimAtoms:claim1.toString(),actualFinalClaimAtoms:claim2.toString(),actualTotalClaimedAtoms:(claim1+claim2).toString(),actualWalletDeltaAtoms:(await wallet()-balanceBefore).toString(),historicalCoverageComplete:true,oldKReferenceRetainedStopped:true,noUnclaimedDebtAfterSecondClaim:true};
  }
  await talk({command:'complete',summary:{scope:positive?'actual frozen76b/current16 signed Bank C310 Candidate Winner K mining claim and exit':'actual frozen76b/current16 signed Bank warm continuation; known canonical C320 candidate is not a Winner',workflowId,author,cranker,round:round.toString(),rawGraphSHA256:createHash('sha256').update(encodeGraph(graph)).digest('hex'),oldGraphSHA256:createHash('sha256').update(encodeGraph(old.graph)).digest('hex'),canonicalDesignHex:designId(graph).toString('hex'),predictedModelCost:String(expectedCost),currentOpeningCost:'316',actualSteps:steps,stages,roundPhases,actualOutput,actualCandidateVerified:true,actualWinner:positive,actualK:positive,mining,publicDiscoveryNotUnpublishedFutureProductionReward:true,privatePreimageNeverUsedAsExecutionProof:true}});
}finally{await rm(directory,{recursive:true,force:true});}
