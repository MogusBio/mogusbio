import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';
import {sha256,typedHash,ByteWriter}from'../../protocol-core/src/index.mjs';import {decodeGraph,encodeGraph}from'../../biology/src/graph.mjs';
import {validateProductionRelease,baseConfigR2Id,PROGRAMS}from'../src/release.mjs';
import {loadNativeAbi,nativeKeyAddress,nativeKeyBytes,nativePda,decodeNativeFrame}from'../src/native.mjs';
import {recordAccount}from'./account-fixture.mjs';
import {key}from'./native-fixture.mjs';
import {planSynthesisPayload,planSynthesisPreparation,planNextSynthesisStep,planSynthesisFinalization,planSynthesisRegistration,decodeNativeSynthesisVerification,decodeNativeSealedSynthesisArtifact,
  planDelegatedSynthesisCompetition,planDelegatedSynthesisStep,resumeDelegatedSynthesisPreparation,planDelegatedSynthesisFinalization}from'../src/synthesis-workflow.mjs';
const FAMILY=Buffer.from([160,43,204,72,38,231,208,253,243,141,12,162,12,38,137,129,71,231,26,176,41,238,246,151,54,121,0,16,247,147,245,254]);
// Codec/planning fixtures copied from an actual accepted local SBF ledger.
// Restoring LIVE flags below is HOST-ONLY; no test claims new native authority,
// manufacturing, physical PASS or asset creation from these restored fixtures.
async function fixture(){
  const raw=readFileSync(new URL('../../../programs/biolab-economy/operations.p0r2.json',import.meta.url)),abi=loadNativeAbi(raw,{expectedHash:sha256(raw).toString("hex")}),input=JSON.parse(readFileSync(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url),'utf8'));
  const release=await validateProductionRelease(input,{localPublicFixture:true}),actor=input.bootstrap;
  const b=readFileSync(new URL('../../../programs/biolab-economy/evidence/actual-final-bio-7fa418ac-a247b6eef233.bin',import.meta.url));assert.equal(sha256(b).toString('hex'),'a247b6eef23398840a0ed15b81738aa8cdf9e38efc425ce047d889cfe3210279');
  const accounts=new Map();let at=104,n=b.readUInt32LE(at);at+=4;for(let i=0;i<n;i++){const address=nativeKeyAddress(b.subarray(at,at+32));at+=32;const lamports=b.readBigUInt64LE(at);at+=8;const owner=nativeKeyAddress(b.subarray(at,at+32));at+=32;const executable=b[at++]===1,rentEpoch=b.readBigUInt64LE(at);at+=8;const len=b.readUInt32LE(at);at+=4;const data=Buffer.from(b.subarray(at,at+len));at+=len;accounts.set(address,{address,lamports,owner,executable,rentEpoch,data});}assert.equal(at,b.length);
  const roots=[...accounts.values()].filter(a=>a.owner===input.programId&&a.data.length>=443&&a.data.readUInt16LE(10)===12);
  const original=a=>{const id=a.data.subarray(443,475);return accounts.get([...accounts.keys()].find(k=>accounts.get(k).data.length>=251&&accounts.get(k).data.subarray(120,152).equals(id)));};
  const live=a=>{const x={...a,data:Buffer.from(a.data)};x.data[362]=0;x.data.fill(0,363,443);return {instance:Buffer.from(x.data.subarray(120,152)),account:x,rootReg:[...accounts.values()].find(a=>a.owner===input.programId&&a.data.length===380&&a.data.readUInt16LE(10)===25&&a.data.subarray(120,152).equals(x.data.subarray(120,152)))??null,originalArtifact:x.data.length===761?original(x):undefined};};
  const graph=target=>{const g=decodeGraph(readFileSync(new URL(`../../../fixtures/graphs/c320-scope-${String(target).padStart(2,'0')}.bin`,import.meta.url)));return {...g,domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash};};
  // Authoritative frozen membership is imported rather than duplicating a map.
  const {members}=await import('../../biology/src/graph.mjs');
  const direct=target=>target<=15?[1,2,3,4].map(p=>live(roots.find(a=>a.data.readUInt16LE(12)===1&&a.data[282]===p&&(p!==4||a.data[283]===target)))):roots.filter(a=>a.data.readUInt16LE(12)===(target===22?3:2)&&(target===22?[16,17,18,19,20,21]:members(target)).includes(a.data[280])).map(live);
  return {release,abi,actor,accounts,graph,direct};
}
async function state(f,plan,{phase=5,round=72,used=0,progress=0,seq=11,quality=0,task=false,cost=0n,rawOnly=false,semantic=Buffer.alloc(32,7)}={}){
  const d=Buffer.alloc(4096);d.write('BIOVFY04',120);plan.artifactId.copy(d,128);plan.artifactSHA.copy(d,160);d.writeUInt32LE(plan.bytes.length,192);d[208]=plan.payload.leaves.length;d[209]=plan.payload.direct.length;d[210]=used;d[211]=phase;d.writeUInt16LE(seq,324);d.writeUInt16LE(progress,326);semantic.copy(d,332);
  d.write('BIOVFY02',364);d.writeUInt16LE(2,372);d[374]=round===73?2:1;d[375]=plan.target;d.writeUInt32LE(2000000,376);d.writeBigUInt64LE(3n,380);d.writeUInt16LE(round,388);d.writeBigInt64LE(100000n,390);plan.graphSHA.copy(d,398);nativeKeyBytes(f.actor).copy(d,430);baseConfigR2Id(f.release).copy(d,462);f.release.hashes.validatorHash.copy(d,494);Buffer.alloc(32,9).copy(d,928);d.writeUInt32LE(quality,1564);d[1568]=Number(task);d.writeBigUInt64LE(cost,1569);
  const a=await recordAccount(f.release,{kind:37,schema:3,seeds:['bio','verify',nativeKeyBytes(f.actor)],id:nativeKeyBytes(f.actor),body:d.subarray(120)});
  if(rawOnly)return a;
  return decodeNativeSynthesisVerification(f.release,a,{actor:f.actor,artifactId:plan.artifactId,artifactSHA:plan.artifactSHA,contextSlot:20n});
}
test('CELL, ORGAN and BIO payload plans preserve exact original historical capsules and hierarchy',async()=>{
  const f=await fixture();for(const target of [1,16,22]){const p=await planSynthesisPayload({...f,graph:f.graph(target),directInputs:f.direct(target)});assert.equal(p.target,target);assert.equal(p.clientPlanOnly,true);assert.equal(p.payload.leaves.length,target===1?4:target===16?8:60);assert.equal(p.materialFeeAtoms,target===1?800000n:target===16?3200000n:12000000n);assert.deepEqual(sha256(encodeGraph(p.payload.graph)),p.graphSHA);
    const prep=await planSynthesisPreparation({...f,plan:p,initialNonce:10n,expectedGeneration:0n,challengePpm:2000000,maxRent:100000000n,maxUploadRent:100000000n});assert.equal(prep.stages.at(-1).operation,'VERIFY_BEGIN');assert.equal(prep.predictsFinalNonce,false);assert.equal(prep.stages.at(-1).instruction.accounts.length,8+2+p.payload.direct.length);
    if(target>15){const original=await decodeNativeSealedSynthesisArtifact(f.release,f.direct(target)[0].originalArtifact,{expectedId:f.direct(target)[0].account.data.subarray(443,475)});assert.ok(p.payload.capsules.some(c=>c.equals(original.payload.capsules[0])));}
  }
});

test('delegated private COMMIT fixes author FINAL n+C+3 while arbitrary STEP count spends only cranker nonces',async()=>{
  const f=await fixture(),plan=await planSynthesisPayload({...f,graph:f.graph(22),directInputs:f.direct(22)}),salt=sha256(Buffer.from('private local delegated synthesis salt')),n=20n,round=10n,cranker=key(8);
  const args={...f,plan,cranker,commitNonce:n,round,salt,expectedGeneration:0n,challengePpm:2000000,maxRent:100000000n,maxUploadRent:100000000n};
  const workflow=await planDelegatedSynthesisCompetition(args),C=BigInt(Math.ceil(plan.bytes.length/1024)),future=n+C+3n;assert.equal(workflow.futureManufactureNonce,future);assert.equal(workflow.preparation.nextNonce,future);assert.equal(workflow.stepCountPredicted,false);assert.equal(workflow.authorNonceReserved,false);assert.equal(workflow.requiresCommitConfirmationBeforeUpload,true);
  assert.equal(decodeNativeFrame(f.abi,workflow.commit.frame).nonce,n);assert.equal(workflow.commit.payload.includes(salt),false);assert.equal(workflow.commit.payload.includes(workflow.commit.design),false);
  for(const [i,stage]of workflow.preparation.stages.entries()){const frame=decodeNativeFrame(f.abi,stage.frame);assert.equal(frame.nonce,n+1n+BigInt(i));assert.deepEqual(frame.actor,nativeKeyBytes(f.actor));}
  assert.equal(workflow.preparation.stages.at(-1).operation,'VERIFY_BEGIN');assert.equal(workflow.preparation.stages.at(-1).nonce,future-1n);
  for(const [i,phase]of [0,1,2,3,4,5].entries()){
    const v=await state(f,plan,{phase,round:phase===5?72:0,seq:i,progress:0});const step=await planDelegatedSynthesisStep({...f,workflow,verification:v,crankerNonce:300n+BigInt(i),maxRent:100000000n});const frame=decodeNativeFrame(f.abi,step.frame);assert.deepEqual(frame.actor,nativeKeyBytes(cranker));assert.equal(frame.nonce,300n+BigInt(i));assert.equal(workflow.futureManufactureNonce,future);
  }
  await assert.rejects(planDelegatedSynthesisCompetition({...args,cranker:f.actor}),/DISTINCT_CRANKER/);await assert.rejects(planDelegatedSynthesisCompetition({...args,commitNonce:(1n<<64n)-2n}),/NONCE_EXHAUSTED/);
  const commitBody=Buffer.alloc(207);FAMILY.copy(commitBody);commitBody.writeUInt32LE(1,32);commitBody.writeBigUInt64LE(round,36);nativeKeyBytes(f.actor).copy(commitBody,44);workflow.commit.commitment.copy(commitBody,76);workflow.commit.commitId.copy(commitBody,108);commitBody.writeBigUInt64LE(100n,140);commitBody.writeBigInt64LE(BigInt(f.release.input.rewardStart)+round*259200n+1n,156);
  const commitAccount=await recordAccount(f.release,{kind:31,seeds:['bio','commit',workflow.commit.commitId],id:workflow.commit.commitId,body:commitBody});
  assert.equal((await resumeDelegatedSynthesisPreparation({release:f.release,workflow,commitAccount,authorNextNonce:n+1n})).nextNonce,future);
  await assert.rejects(resumeDelegatedSynthesisPreparation({release:f.release,workflow,commitAccount,authorNextNonce:n+2n}),/AUTHOR_NONCE_CHANGED/);
  const badCommit={...commitAccount,data:Buffer.from(commitAccount.data)};badCommit.data[120+76]^=1;await assert.rejects(resumeDelegatedSynthesisPreparation({release:f.release,workflow,commitAccount:badCommit,authorNextNonce:n+1n}),/COMMIT_NOT_CONFIRMED/);
  const done=await state(f,plan,{phase:6,round:73,quality:2000000,task:true,cost:320n,semantic:workflow.commit.design}),clock={...f.accounts.get(PROGRAMS.clockSysvar),data:Buffer.from(f.accounts.get(PROGRAMS.clockSysvar).data)};clock.data.writeBigInt64LE(BigInt(f.release.input.rewardStart)+round*259200n+86401n,32);
  const taskAddress=(await nativePda(f.release.input.programId,'bio','task',FAMILY)).address,slotAddress=(await nativePda(f.release.input.programId,'bio','k-slot',FAMILY)).address;
  const registration=await planSynthesisRegistration({release:f.release,verification:done,clockAccount:clock,taskAccount:f.accounts.get(taskAddress),kSlotAccount:f.accounts.get(slotAddress)});
  const rid=typedHash(9,Buffer.concat([f.release.domain,FAMILY,new ByteWriter(4).u32(1).finish(),new ByteWriter(8).u64(round).finish()])),roundBody=Buffer.alloc(389);FAMILY.copy(roundBody);roundBody.writeUInt32LE(1,32);roundBody.writeBigUInt64LE(round,36);roundBody.writeBigUInt64LE(3n,109);
  const roundAccount=await recordAccount(f.release,{kind:15,schema:2,seeds:['bio','round',FAMILY,new ByteWriter(4).u32(1).finish(),new ByteWriter(8).u64(round).finish()],id:rid,body:roundBody}),snapshotAccount=[...f.accounts.values()].find(a=>a.owner===f.release.input.programId&&a.data.length===296&&a.data.readUInt16LE(10)===5);
  const mint=nativeKeyBytes((await nativePda(f.release.input.programId,'bio','lab-mint')).address),labSource=[...f.accounts.values()].find(a=>a.owner===PROGRAMS.tokenProgram&&a.data.length===165&&a.data.subarray(0,32).equals(mint)&&a.data.subarray(32,64).equals(nativeKeyBytes(f.actor))).address;
  const finish={...f,workflow,verification:done,authorNextNonce:future,salt,commitAccount,roundAccount,snapshotAccount,registration,freshDirectInputs:f.direct(22),maxRent:100000000n,maxFee:12000000n,labSource};
  const final=await planDelegatedSynthesisFinalization(finish),frame=decodeNativeFrame(f.abi,final.frame);assert.equal(frame.nonce,future);assert.deepEqual(frame.actor,nativeKeyBytes(f.actor));assert.equal(frame.payload.length,189);assert.equal(frame.payload[124],1);assert.deepEqual(frame.payload.subarray(125,157),workflow.commit.commitId);assert.deepEqual(frame.payload.subarray(157),salt);assert.equal(final.instruction.accounts.at(-3).address,snapshotAccount.address);assert.equal(final.instruction.accounts.at(-2).address,commitAccount.address);
  await assert.rejects(planDelegatedSynthesisFinalization({...finish,authorNextNonce:future+1n}),/AUTHOR_NONCE_CHANGED/);await assert.rejects(planDelegatedSynthesisFinalization({...finish,salt:Buffer.alloc(32)}),/COMMITMENT_CHANGED/);
});
test('next STEP follows branded actual phase/cursor/digest, terminal round uses count1 and inheritance needs real parent',async()=>{
  const f=await fixture(),p=await planSynthesisPayload({...f,graph:f.graph(22),directInputs:f.direct(22)}),v=await state(f,p);const s=await planNextSynthesisStep({...f,plan:p,verification:v,nonce:99n,maxRent:100000000n});const payload=decodeNativeFrame(f.abi,s.frame).payload;assert.equal(payload[42],1);assert.equal(payload.readUInt16LE(40),11);assert.deepEqual(payload.subarray(44,76),v.transcriptDigest);assert.equal(s.instruction.accounts.length,10);
  const inherited=await state(f,p,{phase:0,round:0,progress:2,seq:2});const next=await planNextSynthesisStep({...f,plan:p,verification:inherited,nonce:100n,maxRent:100000000n});assert.equal(next.instruction.accounts.length,12);assert.equal(next.instruction.accounts.at(-2).address,p.parents[2].rootAddress);assert.equal(next.instruction.accounts.at(-1).address,p.parents[2].artifactAddress);
  await assert.rejects(planNextSynthesisStep({...f,plan:p,verification:{...v,qualityPpm:2000000n},nonce:1n,maxRent:1n}),/FRESH_VERIFICATION/);
  const complete=await state(f,p,{phase:6,round:73,quality:2000000,task:true,cost:320n});await assert.rejects(planNextSynthesisStep({...f,plan:p,verification:complete,nonce:1n,maxRent:1n}),/ALREADY_COMPLETE/);
  const cranked=await planNextSynthesisStep({...f,plan:p,verification:v,actor:key(8),nonce:0n,maxRent:1n});assert.equal(decodeNativeFrame(f.abi,cranked.frame).actor.toString('hex'),nativeKeyBytes(key(8)).toString('hex'));assert.equal(cranked.instruction.accounts[9].address,v.address);assert.notEqual(cranked.instruction.accounts[9].address,(await nativePda(f.release.input.programId,'bio','verify',nativeKeyBytes(key(8)))).address);
});

test('V4 read rejects counterfeit owner/profile/early q and stale artifacts; upper graph cannot rewrite inherited child',async()=>{
  const f=await fixture(),p=await planSynthesisPayload({...f,graph:f.graph(1),directInputs:f.direct(1)}),original=await state(f,p,{rawOnly:true});
  for(const mutate of [a=>a.owner=PROGRAMS.systemProgram,a=>a.data[120]^=1,a=>a.data.writeBigUInt64LE(0n,380),a=>a.data.writeUInt16LE(73,388),a=>a.data.writeUInt32LE(2000000,1564),a=>a.data[494]^=1,a=>a.data[3000]=1]){
    const bad={...original,data:Buffer.from(original.data)};mutate(bad);await assert.rejects(decodeNativeSynthesisVerification(f.release,bad,{actor:f.actor,artifactId:p.artifactId,artifactSHA:p.artifactSHA,contextSlot:20n}));
  }
  await assert.rejects(decodeNativeSynthesisVerification(f.release,original,{actor:f.actor,artifactId:Buffer.alloc(32),artifactSHA:p.artifactSHA,contextSlot:20n}),/VERIFY_ARTIFACT/);
  const graph=f.graph(16);graph.cells=graph.cells.map(c=>c.role===1?{...c,v:c.v===0?1000:0}:c);await assert.rejects(planSynthesisPayload({...f,graph,directInputs:f.direct(16)}),{code:"CHILD_CHANGED"});
});
test('FINAL rechecks fresh Direct revisions and requires completed real state plus explicit Task tail',async()=>{
  const f=await fixture(),p=await planSynthesisPayload({...f,graph:f.graph(1),directInputs:f.direct(1)}),done=await state(f,p,{phase:6,round:73,quality:2000000});const taskAddress=(await nativePda(f.release.input.programId,'bio','task',Buffer.from([160,43,204,72,38,231,208,253,243,141,12,162,12,38,137,129,71,231,26,176,41,238,246,151,54,121,0,16,247,147,245,254]))).address;const registration=await planSynthesisRegistration({release:f.release,verification:done,clockAccount:f.accounts.get(PROGRAMS.clockSysvar),taskAccount:f.accounts.get(taskAddress)});
  const final=await planSynthesisFinalization({...f,plan:p,verification:done,nonce:101n,maxRent:100000000n,maxFee:800000n,labSource:f.actor,registration,freshDirectInputs:f.direct(1)}).catch(e=>e);
  // A fee token account cannot alias the signing wallet/prefix. The generic
  // builder must reject this malformed final account table before submission.
  assert.match(final.code,/DUPLICATE_ACCOUNT/);
  const mint=nativeKeyBytes((await nativePda(f.release.input.programId,'bio','lab-mint')).address),token=[...f.accounts.values()].find(a=>a.owner===PROGRAMS.tokenProgram&&a.data.length===165&&a.data.subarray(0,32).equals(mint)&&a.data.subarray(32,64).equals(nativeKeyBytes(f.actor)));const positive=await planSynthesisFinalization({...f,plan:p,verification:done,nonce:101n,maxRent:100000000n,maxFee:800000n,labSource:token.address,registration,freshDirectInputs:f.direct(1)});assert.equal(positive.operation,'SYNTH_FINALIZE');assert.equal(positive.instruction.accounts.length,8+8+8+3);
  const changed=f.direct(1);changed[0].account.data.writeBigUInt64LE(99n,354);await assert.rejects(planSynthesisFinalization({...f,plan:p,verification:done,nonce:101n,maxRent:100000000n,maxFee:800000n,labSource:f.actor,registration,freshDirectInputs:changed}),/DIRECT_CHANGED/);
  await assert.rejects(planSynthesisFinalization({...f,plan:p,verification:await state(f,p),nonce:101n,maxRent:1n,maxFee:800000n,labSource:f.actor,registration,freshDirectInputs:f.direct(1)}),/INCOMPLETE/);
});
