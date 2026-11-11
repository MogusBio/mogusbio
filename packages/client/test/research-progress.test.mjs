import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NativePlayerSession} from '../src/session.mjs';
import {FileJournalStore} from '../src/file-journal.mjs';
import {ResearchWorkflowStore} from '../src/research-manifest.mjs';
import {saveGuidedResearchWorkflow,readGuidedResearchProgress} from '../src/research-progress.mjs';
import {nativeKeyBytes} from '../src/native.mjs';
import {PROGRAMS} from '../src/release.mjs';
import {release,abi,actor,resources,pda,FAMILY,checkpoint,hostArtifact,hostVerification,attachHostK} from './synthesis-fixture.mjs';
import {researchCranker as cranker,hostResearchFixture,hostResearchOutputFixture,setHostResearchAuthorNonce as nonce,setHostResearchClock as clock,attachHostResearchCommit as commitHost,enterHostResearchManufacture as manufacture} from './research-fixture.mjs';

async function withResearch(run,{onRead}={}){
  const f=await hostResearchFixture({onRead}),directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-research-progress-'));
  try{
    const store=new ResearchWorkflowStore({directory:path.join(directory,'workflows')}),authorJournal=await FileJournalStore.open({directory:path.join(directory,'author')}),crankerJournal=await FileJournalStore.open({directory:path.join(directory,'cranker')}),session=(who=actor)=>new NativePlayerSession({release,abi,actor:who,store:who===actor?authorJournal:crankerJournal,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:f.fetchImpl});
    const args={...f.researchArgs,store},saved=await saveGuidedResearchWorkflow(args);assert.equal(saved.decision,'WORKFLOW_SAVED');
    const workflowId=saved.workflow.workflowId,m=await store.load({release,abi,author:actor,workflowId}),progress=(who=actor)=>readGuidedResearchProgress({release,abi,authorSession:session(),executorSession:session(who),actor:who,author:actor,workflowId,store});
    await run({f,directory,store,authorJournal,crankerJournal,session,args,saved,m,workflowId,progress});
    assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts','getLatestBlockhash'].includes(c.method)));
  }finally{await rm(directory,{recursive:true,force:true});}
}
const prepare=(s,intent)=>s.prepare({...intent,nonce:BigInt(intent.nonce),payload:Buffer.from(intent.payloadHex,'hex'),resources});

test('HOST private save/retry freezes original salt/window without intent, nonce reservation or repeat actual reads',async()=>withResearch(async({f,args,saved,m,authorJournal,progress})=>{
  assert.equal(saved.intent,undefined);assert.equal(saved.reservesOnChainNonce,false);assert.equal(saved.workflow.synthesis,undefined);assert.equal((await authorJournal.load()).payload,null);const count=f.calls.length;
  await nonce(f,m.commitNonce+50n);const retry=await saveGuidedResearchWorkflow(args);assert.equal(retry.alreadySaved,true);assert.equal(retry.workflow.workflowId,m.workflowId);assert.equal(f.calls.length,count);
  const broken=await progress();assert.equal(broken.decision,'AUTHOR_NONCE_WINDOW_BROKEN');assert.equal(broken.intent,undefined);assert.equal(broken.workflow.synthesis,undefined);
}));
test('HOST only exact confirmed COMMIT and actual manufacture window permit public upload; current request requires recovery',async()=>withResearch(async({f,m,progress,session,authorJournal})=>{
  const before=await progress();assert.equal(before.decision,'ACTION');assert.equal(before.stage.kind,'COMMIT');assert.equal(before.intent.operation,'COMMIT');assert.equal(before.workflow.synthesis,undefined);assert.equal(before.intent.payloadHex.includes(m.salt.toString('hex')),false);assert.equal(JSON.stringify(before).includes(m.baseManifest.plan.artifactId.toString('hex')),false);
  const wrong=await progress(cranker);assert.equal(wrong.decision,'AUTHOR_REQUIRED');assert.equal(wrong.intent,undefined);
  await prepare(session(),before.intent);assert.equal((await progress()).decision,'RECOVER_CURRENT_REQUEST');assert.equal(JSON.parse((await authorJournal.load()).payload).entries.length,1);
  await commitHost(f,m);const waiting=await progress();assert.equal(waiting.decision,'WAIT_MANUFACTURE_WINDOW');assert.equal(waiting.workflow.synthesis,undefined);
  clock(f,release.rewardStart+m.round*259200n+86400n+100n);const upload=await progress();assert.equal(upload.stage.kind,'UPLOAD');assert.equal(upload.intent.nonce,(m.commitNonce+1n).toString());assert.equal(upload.workflow.synthesis.artifactIdHex,m.baseManifest.plan.artifactId.toString('hex'));assert.equal(JSON.stringify(upload).includes(m.salt.toString('hex')),false);
}));
test('HOST fixed author upload/seal/begin window rejects gaps and never renumbers around unrelated author actions',async()=>withResearch(async({f,m,progress})=>{
  await manufacture(f,m);await hostArtifact(f,{written:1024,sequence:1n});await nonce(f,m.commitNonce+2n);const second=await progress();assert.equal(second.stage.kind,'UPLOAD');assert.equal(Buffer.from(second.intent.payloadHex,'hex').readUInt32LE(46),1024);
  await nonce(f,m.commitNonce+3n);assert.equal((await progress()).decision,'AUTHOR_NONCE_WINDOW_BROKEN');
  const C=BigInt(m.workflow.chunkCount);await hostArtifact(f,{written:m.baseManifest.plan.bytes.length,sequence:C});await nonce(f,m.commitNonce+C+1n);assert.equal((await progress()).stage.kind,'SEAL');
  await hostArtifact(f,{sequence:C,sealed:true});await nonce(f,m.commitNonce+C+2n);const begin=await progress();assert.equal(begin.stage.kind,'BEGIN');assert.equal(Buffer.from(begin.intent.payloadHex,'hex').readBigUInt64LE(72),m.expectedGeneration);assert.equal(begin.intent.nonce,(m.workflow.futureManufactureNonce-1n).toString());
}));
test('HOST named cranker alone advances actual branded STEP while preserving author future nonce',async()=>withResearch(async({f,m,progress,session})=>{
  await manufacture(f,m);await hostArtifact(f,{sequence:BigInt(m.workflow.chunkCount),sealed:true});await nonce(f,m.workflow.futureManufactureNonce);await hostVerification(f,{phase:5,round:72,generation:m.expectedGeneration+1n,seq:17});
  const author=await progress();assert.equal(author.decision,'CRANKER_REQUIRED');assert.equal(author.intent,undefined);
  const step=await progress(cranker);assert.equal(step.stage.kind,'STEP');assert.equal(step.intent.nonce,'0');assert.equal(Buffer.from(step.intent.payloadHex,'hex').readUInt16LE(40),17);assert.equal(Buffer.from(step.intent.payloadHex,'hex')[42],1);assert.equal(step.workflow.futureManufactureNonce,m.workflow.futureManufactureNonce.toString());
  await prepare(session(cranker),step.intent);assert.equal((await progress(cranker)).decision,'RECOVER_CURRENT_REQUEST');
}));
test('HOST actual FINAL closure produces private189 reveal and known or worse cost never promises a winner',async()=>withResearch(async({f,m,progress,store})=>{
  await manufacture(f,m);await hostArtifact(f,{sequence:BigInt(m.workflow.chunkCount),sealed:true});await nonce(f,m.workflow.futureManufactureNonce);await hostVerification(f,{phase:6,round:73,generation:m.expectedGeneration+1n,quality:2000000,task:true,cost:f.originalOutput.data.readBigUInt64LE(719)});await attachHostK(f,{count:1n});
  const final=await progress();assert.equal(final.decision,'ACTION');assert.equal(final.stage.kind,'FINAL');const payload=Buffer.from(final.intent.payloadHex,'hex');assert.equal(payload.length,189);assert.equal(payload[124],1);assert.deepEqual(payload.subarray(125,157),m.workflow.commit.commitId);assert.deepEqual(payload.subarray(157),m.salt);assert.equal(final.preview.winnerGuaranteed,false);assert.equal(final.finalizationContext,undefined);assert.equal(final.action,undefined);assert.equal(final.directInputs,undefined);assert.equal(final.plan,undefined);assert.equal((await store.loadHints(m)).finalFrameHex.endsWith(m.salt.toString('hex')),true);
  assert.equal((await progress(cranker)).decision,'AUTHOR_REQUIRED');
}));
test('HOST deep K lookup persists across restart, removes cursor from exact context, and resets when actual count changes',async()=>withResearch(async({f,m,progress,store,directory,session,workflowId})=>{
  await manufacture(f,m);await hostArtifact(f,{sequence:BigInt(m.workflow.chunkCount),sealed:true});await nonce(f,m.workflow.futureManufactureNonce);await hostVerification(f,{phase:6,round:73,generation:m.expectedGeneration+1n,quality:2000000,task:true,cost:f.originalOutput.data.readBigUInt64LE(719)});await attachHostK(f,{count:300n});
  const first=await progress();assert.equal(first.decision,'K_POSITION_LOOKUP_REQUIRED');assert.equal(first.lookup.nextStart,'44');assert.equal((await store.loadPositionLookup(m)).ordinaryCount,'300');assert.equal(first.intent,undefined);
  const restarted=new ResearchWorkflowStore({directory:path.join(directory,'workflows')}),next=()=>readGuidedResearchProgress({release,abi,authorSession:session(),executorSession:session(),actor,author:actor,workflowId,store:restarted});
  const final=await next();assert.equal(final.decision,'ACTION');assert.equal(final.stage.kind,'FINAL');assert.equal(final.preview.priorPositionSequence,'0');
  await attachHostK(f,{count:301n});const changed=await next();assert.equal(changed.decision,'K_POSITION_LOOKUP_REQUIRED');assert.equal(changed.lookup.nextStart,'45');assert.equal(changed.lookup.ordinaryCount,'301');assert.equal((await restarted.loadPositionLookup(m)).nextStart,'45');assert.equal((await next()).stage.kind,'FINAL');
}));
test('HOST unrelated ordinary consumed outputs cannot become a competition success without a native used Commit',async()=>withResearch(async({f,m,progress})=>{
  await manufacture(f,m);for(const id of f.directIds){const address=await pda('root',id),original=checkpoint.get(address);f.map.set(address,{...original,data:Buffer.from(original.data)});}
  await assert.rejects(progress(),/RESEARCH_OUTPUT_COMMIT_REQUIRED/);
}));
test('HOST-only candidate/output reconstruction binds actual-shaped189 and never fabricates signed ordinary receipt provenance',async()=>{
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-research-output-'));try{
    const store=new ResearchWorkflowStore({directory:path.join(directory,'workflows')}),f=await hostResearchOutputFixture({store}),journal=await FileJournalStore.open({directory:path.join(directory,'journal')}),session=()=>new NativePlayerSession({release,abi,actor,store:journal,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:f.fetchImpl}),progress=()=>readGuidedResearchProgress({release,abi,authorSession:session(),executorSession:session(),actor,author:actor,workflowId:f.m.workflowId,store});
    const out=await progress();assert.equal(out.decision,'OUTPUT_READ');assert.equal(out.outputVerified,true);assert.equal(out.competitionCandidateVerified,true);assert.equal(out.exactRequestExecutionVerified,false);assert.equal(out.businessExecutionVerified,false);assert.equal(out.receipt,null);assert.equal(out.winnerRecognized,false);assert.equal(JSON.stringify(out).includes(f.m.salt.toString('hex')),false);
    f.map.set(cranker,null);assert.equal((await progress()).outputVerified,true);f.map.get(f.outputAddress).data[184]^=1;await assert.rejects(progress(),/RESEARCH_OUTPUT_FINAL_189/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('HOST changing author nonce or regressing Clock between final observations never returns a stale intent',async()=>{
  for(const kind of ['nonce','clock']){
    let armed=false,hits=0,commitAddress;await withResearch(async({f,m,progress})=>{commitAddress=await pda('commit',m.workflow.commit.commitId);armed=true;if(kind==='nonce'){const result=await progress();assert.equal(result.decision,'REPLAN_STALE_STATE');assert.equal(result.intent,undefined);}else await assert.rejects(progress(),/RESEARCH_OBSERVATION_REGRESSION/);assert.equal(hits,2);},{onRead:({map,addresses})=>{if(!armed||!addresses.includes(commitAddress))return;if(++hits!==2)return;if(kind==='clock'){const value=map.get(PROGRAMS.clockSysvar);value.data.writeBigInt64LE(value.data.readBigInt64LE(32)-1n,32);}else{const value=[...map.values()].find(v=>v?.owner===release.input.programId&&v.data.length===418&&v.data.readUInt16LE(10)===35);value.data.writeBigUInt64LE(value.data.readBigUInt64LE(120)+1n,120);}}});
  }
});
test('HOST manufacture boundary crossed on the final snapshot blocks upload without exposing another intent',async()=>{
  let armed=false,hits=0,commitAddress,deadline;await withResearch(async({f,m,progress})=>{await manufacture(f,m);commitAddress=await pda('commit',m.workflow.commit.commitId);deadline=release.rewardStart+m.round*259200n+172800n;armed=true;const result=await progress();assert.equal(result.decision,'REPLAN_STALE_STATE');assert.equal(result.intent,undefined);assert.equal(hits,2);},{onRead:({map,addresses})=>{if(armed&&addresses.includes(commitAddress)&&++hits===2)map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(deadline,32);}});
});
test('HOST request prepared in the local journal during the last read switches to explicit recovery before returning an intent',async()=>withResearch(async({m,store,workflowId,session,progress})=>{
  const first=await progress(),real=session();let reads=0;const executor={recoveryIdentity:real.recoveryIdentity,rpc:real.rpc,getRequest:async n=>{if(++reads===2)await prepare(real,first.intent);return real.getRequest(n);}},result=await readGuidedResearchProgress({release,abi,authorSession:session(),executorSession:executor,actor,author:actor,workflowId,store});
  assert.equal(reads,2);assert.equal(result.decision,'RECOVER_CURRENT_REQUEST');assert.equal(result.intent,undefined);assert.equal(result.recoveryNonce,m.commitNonce.toString());assert.equal(result.workflow.synthesis,undefined);
}));
test('HOST clock windows, immutable revisions, matching generation, commitment and paused task fail closed without secret error data',async()=>{
  for(const kind of ['commitment','revision','generation','paused','closed'])await withResearch(async({f,m,progress})=>{
    await manufacture(f,m);
    if(kind==='commitment')f.map.get(await pda('commit',m.workflow.commit.commitId)).data[196]^=1;
    else if(kind==='revision'){const root=f.map.get(await pda('root',f.directIds[0]));root.data.writeBigUInt64LE(root.data.readBigUInt64LE(354)+1n,354);}
    else if(kind==='generation'){const v=f.map.get(await pda('verify',nativeKeyBytes(actor)));v.data.writeBigUInt64LE(m.expectedGeneration+1n,380);}
    else if(kind==='paused'){const task=f.map.get(await pda('task',FAMILY));task.data[238]=1;task.data.writeBigUInt64LE(1n,239);}
    else clock(f,release.rewardStart+m.round*259200n+172800n);
    if(kind==='commitment'||kind==='revision')await assert.rejects(progress(),e=>{assert.equal(JSON.stringify(e).includes(m.salt.toString('hex')),false);return /^RESEARCH_/.test(e.code);});
    else{const result=await progress();assert.equal(result.intent,undefined);assert.equal(result.decision,kind==='generation'?'AUTHOR_NONCE_WINDOW_BROKEN':kind==='paused'?'TASK_PAUSED':'MANUFACTURE_WINDOW_CLOSED');assert.equal(JSON.stringify(result).includes(m.salt.toString('hex')),false);}
  });
});
