import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encodeGraph} from '../../biology/src/graph.mjs';
import {businessKey,instanceId} from '../../protocol-core/src/index.mjs';
import {FileJournalStore} from '../src/file-journal.mjs';
import {NativePlayerSession} from '../src/session.mjs';
import {SynthesisWorkflowStore} from '../src/synthesis-manifest.mjs';
import {bindSynthesisDesignGraph,saveGuidedSynthesisWorkflow,readGuidedSynthesisProgress} from '../src/synthesis-progress.mjs';
import {decodeNativeFrame,nativeKeyBytes,nativeNonceOpId,buildNativeInstruction,nativePda} from '../src/native.mjs';
import {PROGRAMS} from '../src/release.mjs';
import {release,abi,actor,resources,pda,checkpoint,hostSynthesisFixture,hostArtifact,hostVerification,actualSynthesisFixture,attachHostK} from './synthesis-fixture.mjs';

async function withProgress(f,run){
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-synthesis-progress-'));
  try{
    const store=new SynthesisWorkflowStore({directory:path.join(directory,'workflows')}),journal=await FileJournalStore.open({directory:path.join(directory,'journal')}),session=()=>new NativePlayerSession({release,abi,actor,store:journal,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:f.fetchImpl});
    const saved=await saveGuidedSynthesisWorkflow({...f.args,store});assert.equal(saved.decision,'WORKFLOW_SAVED');const workflowId=saved.workflow.workflowId;
    const progress=()=>readGuidedSynthesisProgress({release,abi,session:session(),actor,workflowId,store});
    await run({f,directory,store,journal,session,saved,workflowId,progress});
    assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts','getLatestBlockhash'].includes(c.method)));
  }finally{await rm(directory,{recursive:true,force:true});}
}
function prepare(session,intent){return session.prepare({...intent,nonce:BigInt(intent.nonce),payload:Buffer.from(intent.payloadHex,'hex'),resources});}

test('public graph import rebinds exact local zero context while rejecting foreign nonzero deployments',async()=>{
  const f=await hostSynthesisFixture(),local={...f.graph,domain:Buffer.alloc(32),config:Buffer.alloc(32)},bound=bindSynthesisDesignGraph({release,graphBytes:encodeGraph(local)});
  assert.deepEqual(bound.domain,release.domain);assert.deepEqual(bound.config,f.graph.config);
  assert.throws(()=>bindSynthesisDesignGraph({release,graphBytes:encodeGraph({...local,domain:Buffer.alloc(32,9)})}),{code:'IDENTITY'});
});
test('HOST fixed public workflow save is idempotent/restartable and generates no intent, request journal or reservation',async()=>withProgress(await hostSynthesisFixture(),async({f,store,journal,saved,directory,workflowId,progress})=>{
  assert.equal(saved.intent,undefined);assert.equal(saved.requiresExplicitNextRead,true);assert.equal(saved.reservesOnChainNonce,false);assert.equal((await journal.load()).payload,null);
  const again=await saveGuidedSynthesisWorkflow({...f.args,store});assert.equal(again.workflow.workflowId,workflowId);assert.equal(again.alreadySaved,true);
  assert.equal((await(new SynthesisWorkflowStore({directory:path.join(directory,'workflows')})).load({release,abi,actor,workflowId})).workflowId,workflowId);
  const out=await progress();assert.equal(out.decision,'ACTION');assert.equal(out.stage.kind,'UPLOAD');assert.equal(out.intent.operation,'ARTIFACT_PUT');assert.equal((await journal.load()).payload,null);assert.equal(out.verification,null);
}));
test('HOST partial702 resumes actual offset and sequence after unrelated author nonce movement without renumbering design',async()=>withProgress(await hostSynthesisFixture(),async({f,saved,progress,store,workflowId})=>{
  const first=await progress(),beforeNonce=BigInt(first.intent.nonce);await hostArtifact(f,{written:1024,sequence:3n});
  f.map.get(await pda('actor-nonce',nativeKeyBytes(actor))).data.writeBigUInt64LE(beforeNonce+5n,120);
  const next=await progress();assert.equal(next.decision,'ACTION');assert.equal(next.stage.kind,'UPLOAD');assert.equal(next.intent.nonce,String(beforeNonce+5n));
  const payload=Buffer.from(next.intent.payloadHex,'hex');assert.equal(payload.readBigUInt64LE(38),3n);assert.equal(payload.readUInt32LE(46),1024);assert.deepEqual(payload.subarray(52,-8),f.plan.bytes.subarray(1024,2048));
  assert.equal(next.workflow.artifactIdHex,saved.workflow.artifactIdHex);assert.deepEqual((await store.load({release,abi,actor,workflowId})).plan.bytes,f.plan.bytes);
  await hostArtifact(f,{written:f.plan.bytes.length,sequence:40n,sealed:false});const seal=await progress();assert.equal(seal.stage.kind,'SEAL');assert.equal(Buffer.from(seal.intent.payloadHex,'hex').readBigUInt64LE(34),40n);
}));
test('HOST sealed state uses actual prior generation, then actual branded variable STEP cursor including last round count1',async()=>withProgress(await hostSynthesisFixture(),async({f,progress})=>{
  await hostArtifact(f,{sealed:true});const before=f.map.get(await pda('verify',nativeKeyBytes(actor))).data.readBigUInt64LE(380),begin=await progress();
  assert.equal(begin.stage.kind,'BEGIN');assert.equal(Buffer.from(begin.intent.payloadHex,'hex').readBigUInt64LE(72),before);
  await hostVerification(f,{phase:5,round:70,seq:12});let step=await progress();assert.equal(step.stage.kind,'STEP');assert.equal(Buffer.from(step.intent.payloadHex,'hex')[42],2);
  await hostVerification(f,{phase:5,round:72,seq:17});step=await progress();const p=Buffer.from(step.intent.payloadHex,'hex');assert.equal(p.readUInt16LE(40),17);assert.equal(p[42],1);assert.equal(step.verification.physicsRound,72);
  assert.equal(step.intent.nonce,begin.intent.nonce);assert.equal(step.verification.generation,before+2n);
}));
test('HOST prepared current request requires original session recovery and never silently prepares another stage',async()=>withProgress(await hostSynthesisFixture(),async({progress,session,journal})=>{
  const first=await progress();await prepare(session(),first.intent);const second=await progress();assert.equal(second.decision,'RECOVER_CURRENT_REQUEST');assert.equal(second.intent,undefined);assert.equal(second.recoveryNonce,BigInt(first.intent.nonce));assert.equal(JSON.parse((await journal.load()).payload).entries.length,1);
}));
test('HOST immutable input revision/fingerprint changes and cross-read nonce or Clock regression fail closed',async()=>{
  for(const kind of ['revision','fingerprint'])await withProgress(await hostSynthesisFixture(),async({f,progress})=>{
    const input=f.map.get(await pda('root',f.directIds[0]));if(kind==='revision')input.data.writeBigUInt64LE(input.data.readBigUInt64LE(354)+1n,354);else input.data.writeBigInt64LE(input.data.readBigInt64LE(306)+1n,306);
    await assert.rejects(progress(),/SYN_PROGRESS_DIRECT_CHANGED/);
  });
  for(const kind of ['nonce','clock']){
    let armed=false,hit=false;const f=await hostSynthesisFixture({onRead:({map,addresses})=>{
      if(!armed||hit||addresses.length!==6)return;hit=true;
      if(kind==='clock'){const a=map.get(PROGRAMS.clockSysvar);a.data.writeBigInt64LE(a.data.readBigInt64LE(32)-1n,32);}else{const a=[...map.values()].find(v=>v?.owner===release.input.programId&&v.data.length>=120&&v.data.readUInt16LE(10)===35);a.data.writeBigUInt64LE(a.data.readBigUInt64LE(120)-1n,120);}
    }});
    await withProgress(f,async({progress})=>{armed=true;await assert.rejects(progress(),/SYN_PROGRESS_STATE_REGRESSION/);assert.equal(hit,true);});
  }
});
test('HOST deep K lookup persists bounded cursor and passes only four-field resume context into the real FINAL planner',async()=>withProgress(await hostSynthesisFixture({target:22}),async({f,store,workflowId,progress})=>{
  await hostArtifact(f,{sealed:true});await hostVerification(f,{phase:6,round:73,quality:2000000,task:true,cost:f.originalOutput.data.readBigUInt64LE(719)});const k=await attachHostK(f);
  const first=await progress();assert.equal(first.decision,'K_POSITION_LOOKUP_REQUIRED');assert.equal(first.lookup.nextStart,'44');assert.equal(first.intent,undefined);
  const m=await store.load({release,abi,actor,workflowId});assert.equal((await store.loadHints(m)).positionLookup.nextStart,'44');
  const next=await progress();assert.equal(next.decision,'ACTION');assert.equal(next.stage.kind,'FINAL');assert.equal(next.preview.priorPositionSequence,0n);assert.ok(next.intent.dynamicAccounts.some(a=>a.address===k.position.address));
}));

test('HOST ordinary FINAL rechecks full dependencies after its later input reads before recording an attempt',async()=>{
  for(const kind of ['Task','Registry','LAB','NewRoot','ClockHour']){
    let armed=false,closureSeen=false,hit=false,newRoot,task,registry,source;
    const f=await hostSynthesisFixture({onRead:({map,addresses})=>{
      if(!armed)return;
      if(addresses.includes(newRoot)&&addresses.includes(release.pdas.labMint.address)){closureSeen=true;return;}
      if(!closureSeen||hit)return;hit=true;
      if(kind==='Task'){const a=map.get(task);a.data.writeBigUInt64LE(a.data.readBigUInt64LE(156)+1n,156);}
      if(kind==='Registry'){const a=map.get(registry);a.data.writeBigUInt64LE(a.data.readBigUInt64LE(160)+1n,160);}
      if(kind==='LAB'){const a=map.get(source);a.data.writeBigUInt64LE(a.data.readBigUInt64LE(64)-1n,64);}
      if(kind==='NewRoot')map.set(newRoot,{address:newRoot,owner:PROGRAMS.tokenProgram,executable:false,lamports:1n,rentEpoch:0n,data:Buffer.alloc(0)});
      if(kind==='ClockHour'){const a=map.get(PROGRAMS.clockSysvar);a.data.writeBigInt64LE(a.data.readBigInt64LE(32)+3600n,32);}
    }});
    await withProgress(f,async({store,workflowId,progress})=>{
      await hostArtifact(f,{sealed:true});await hostVerification(f,{phase:6,round:73,quality:2000000});
      const n=f.map.get(await pda('actor-nonce',nativeKeyBytes(actor))).data.readBigUInt64LE(120),output=instanceId(release.domain,businessKey(release.domain,nativeKeyBytes(actor),nativeNonceOpId(n)));
      newRoot=await pda('root',output);task=await pda('task',Buffer.from('a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe','hex'));registry=await pda('mining');source=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(release.pdas.labMint.address))).address;armed=true;
      const result=await progress();assert.equal(hit,true,kind);assert.equal(result.decision,'REPLAN_STALE_STATE',kind);assert.equal(result.intent,undefined);
      const m=await store.load({release,abi,actor,workflowId});assert.equal((await store.loadHints(m)).finalFrameHex,null,kind);
    });
  }
});

for(const target of [1,16,22])test(`actual signed Bank target${target} plans exact FINAL, confirms156 and retains output after restart`,async()=>withProgress(await actualSynthesisFixture(target),async({f,store,workflowId,progress,session,directory})=>{
  const next=await progress();assert.equal(next.decision,'ACTION');assert.equal(next.stage.kind,'FINAL');const prepared=await prepare(session(),next.intent);assert.equal(prepared.frameHex,f.bank.frameHex);
  const instruction=await buildNativeInstruction({release,abi,frame:f.frame,suffix:next.intent.suffix,dynamicAccounts:next.intent.dynamicAccounts});
  assert.deepEqual(instruction.accounts.map(a=>({pubkey:a.address,isSigner:Boolean(a.role&2),isWritable:Boolean(a.role&1)})),f.bank.instruction.accounts);
  const manifest=await store.load({release,abi,actor,workflowId});assert.deepEqual(manifest.plan.bytes,f.body);assert.equal((await store.loadHints(manifest)).finalFrameHex,f.bank.frameHex);
  f.setPhase('after');const out=await progress();assert.equal(out.decision,'OUTPUT_READ');assert.equal(out.outputVerified,true);assert.equal(out.exactRequestExecutionVerified,true);assert.equal(out.receipt.bytes.length,156);assert.equal(out.receipt.outputId.toString('hex'),out.root.instanceHex);assert.equal(out.root.target,target);
  const restartedStore=new SynthesisWorkflowStore({directory:path.join(directory,'workflows')}),journal=await FileJournalStore.open({directory:path.join(directory,'journal')}),restartedSession=new NativePlayerSession({release,abi,actor,store:journal,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:f.fetchImpl});
  const restored=await readGuidedSynthesisProgress({release,abi,actor,workflowId,store:restartedStore,session:restartedSession});assert.equal(restored.exactRequestExecutionVerified,true);assert.equal(restored.root.instanceHex,out.root.instanceHex);
}));
test('actual signed Bank output is observable without a local final hint or old request success fabrication',async()=>withProgress(await actualSynthesisFixture(1),async({f,store,workflowId,progress})=>{
  const m=await store.load({release,abi,actor,workflowId});assert.deepEqual(await store.loadHints(m),{finalFrameHex:null,positionLookup:null});
  f.setPhase('after');const out=await progress();assert.equal(out.outputVerified,true);assert.equal(out.exactRequestExecutionVerified,false);assert.equal(out.receipt,null);assert.equal(out.businessExecutionVerified,false);
  // HOST-only later account observation: genuine end-ledger BIO verification
  // replaces the original CELL verification; this is not a new native run.
  const verificationAddress=await pda('verify',nativeKeyBytes(actor)),prior=checkpoint.get(verificationAddress);f.maps.after.set(verificationAddress,{...prior,data:Buffer.from(prior.data)});
  const clock=f.maps.after.get(PROGRAMS.clockSysvar),endClock=checkpoint.get(PROGRAMS.clockSysvar);if(clock.data.readBigInt64LE(32)<prior.data.readBigInt64LE(390))clock.data=Buffer.from(endClock.data);
  const replaced=await progress();assert.equal(replaced.outputVerified,true);assert.equal(replaced.verification,null);assert.equal(replaced.previousVerificationReplaced,true);
}));
test('actual output HOST-only union, parent/time/hash, seal and matching V4 changes cannot remain verified',async()=>{
  for(const kind of ['union','parentId','parentTime','artifactHash','modelDigest','sealTime','V4'])await withProgress(await actualSynthesisFixture(1),async({f,progress})=>{
    f.setPhase('after');const outputAddress=await pda('root',Buffer.from(f.bank.execution.returnDataHex,'hex').subarray(0,32)),root=f.maps.after.get(outputAddress);
    if(kind==='union')root.data[575]^=1;
    else if(kind==='parentId')f.maps.after.get(await pda('root',f.args.directIds[0])).data[363]^=1;
    else if(kind==='parentTime'){const input=f.maps.after.get(await pda('root',f.args.directIds[0]));input.data.writeBigInt64LE(input.data.readBigInt64LE(427)+1n,427);}
    else if(kind==='artifactHash')root.data[475]^=1;
    else if(kind==='modelDigest')root.data[623]^=1;
    else if(kind==='sealTime'){const a=f.maps.after.get(await pda('artifact',Buffer.from(f.decoded.payload.subarray(0,32))));a.data.writeBigInt64LE(root.data.readBigInt64LE(306)+1n,235);const clock=f.maps.after.get(PROGRAMS.clockSysvar);clock.data.writeBigInt64LE(root.data.readBigInt64LE(306)+2n,32);}
    else f.maps.after.get(await pda('verify',nativeKeyBytes(actor))).data[276]^=1;
    await assert.rejects(progress(),/SYN_(OUTPUT_(UNION|DIFFERENT_PARENTS|CONSUMPTION_TIME|BINDING|ARTIFACT|VERIFICATION)|INPUT_CONSUMPTION_TIME)/);
  });
});
