import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {ByteWriter,sha256} from '../../protocol-core/src/index.mjs';
import {validateProductionRelease,PROGRAMS} from '../src/release.mjs';
import {loadNativeAbi,decodeNativeFrame,nativeKeyAddress,nativeKeyBytes,nativePda,nativeRequestHash} from '../src/native.mjs';
import {decodeNativeRoot} from '../src/accounts.mjs';
import {decodeNativeSynthesisVerification} from '../src/synthesis-workflow.mjs';
import {decodeNativeSynthesisArtifact,decodeNativePriorVerification,decodeSynthesisFinalizeBody,decodeNativeSynthesisFinalizeResult,decodeNativeSynthesisVerificationResult} from '../src/synthesis-records.mjs';
import {recordAccount} from './account-fixture.mjs';
import {initialWitnessDigest} from '../../biology/src/evidence.mjs';

const root=new URL('../../../',import.meta.url),clone=a=>({...a,data:Buffer.from(a.data)});
const rawFile=p=>readFileSync(new URL(p,root));
const actual=(async()=>{
  const release=await validateProductionRelease(JSON.parse(rawFile('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
  const abi=loadNativeAbi(rawFile('programs/biolab-economy/operations.p0r2.json'),{expectedHash:release.input.abiHash});
  const b=rawFile('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b1687.bin');
  assert.equal(sha256(b).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
  const map=new Map();let at=108;
  for(let i=0;i<b.readUInt32LE(104);i++){
    const address=nativeKeyAddress(b.subarray(at,at+32)),lamports=b.readBigUInt64LE(at+32),owner=nativeKeyAddress(b.subarray(at+40,at+72)),executable=b[at+72]===1,rentEpoch=b.readBigUInt64LE(at+73),length=b.readUInt32LE(at+81);at+=85;
    map.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(b.subarray(at,at+length))});at+=length;
  }
  assert.equal(at,b.length);
  const verify=[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===4096&&a.data.readUInt16LE(10)===37&&a.data.readUInt16LE(12)===3);
  assert.ok(verify);const actor=nativeKeyAddress(verify.data.subarray(88,120)),wanted=verify.data.subarray(128,160),frames=[];let lastStep,beginFrame;
  const stream=createReadStream(new URL('programs/biolab-economy/evidence/econ4r1-full-chain.jsonl',root)),lines=createInterface({input:stream});
  try{for await(const line of lines){const row=JSON.parse(line);if(!row.dataHex)continue;const frame=Buffer.from(row.dataHex,'hex');let f;
    try{f=decodeNativeFrame(abi,frame);}catch{continue;}
    if(f.operation==='VERIFY_BEGIN'&&f.payload.subarray(0,32).equals(wanted))beginFrame=frame;
    if(f.operation==='VERIFY_STEP'&&f.payload.subarray(0,32).equals(wanted))lastStep=frame;
    if(f.operation==='SYNTH_FINALIZE'){assert.equal(row.expectedResult,'Ok');frames.push(frame);if(f.payload.subarray(0,32).equals(wanted))break;}
  }}finally{lines.close();stream.destroy();}
  assert.ok(frames.length>=22);
  const frame=frames.at(-1),f=decodeNativeFrame(abi,frame),artifactId=Buffer.from(f.payload.subarray(0,32)),artifactAddress=(await nativePda(release.input.programId,'bio','artifact',artifactId)).address,info=map.get(artifactAddress),artifactBody=Buffer.from(info.data.subarray(251));
  const expected=decodeSynthesisFinalizeBody({release,abi,frame,artifactBody}),outputAddress=(await nativePda(release.input.programId,'bio','root',expected.outputId)).address,output=map.get(outputAddress);
  assert.ok(output);const facts=await decodeNativeRoot(release,output,expected.outputId);assert.deepEqual(facts.requestHash,nativeRequestHash(abi,frame));
  const verification=await decodeNativeSynthesisVerification(release,verify,{actor,artifactId,contextSlot:1n});
  return {release,abi,actor,map,verify,verification,frames,frame,f,artifactId,artifactAddress,info,artifactBody,expected,output,facts,lastStep,beginFrame};
})();
// This old return cache is not retained by the accepted trace. Reconstruct an
// explicitly HOST-only156 receipt from genuine immutable Root facts; this tests
// binding, not newly executed native FINAL or public RPC finality.
function hostReceipt(f){
  return new ByteWriter(156).raw(f.expected.outputId).u32(Number(f.facts.qualityPpm)).u64(f.facts.B).u64(f.facts.retired).u64(f.expected.feeAtoms)
    .raw(f.output.data.subarray(623,655)).raw(f.output.data.subarray(727,759)).raw(f.artifactId).finish();
}
const resultArgs=(f,result,verification=f.verification)=>({release:f.release,abi:f.abi,frame:f.frame,artifactBody:f.artifactBody,result,verification});

test('genuine76b sealed702 Artifact and completed used V4 retain exact immutable hashes, amounts and actual generation',async()=>{
  const f=await actual,a=await decodeNativeSynthesisArtifact({release:f.release,info:f.info,artifactId:f.artifactId,actor:f.actor,expectedBody:f.artifactBody});
  assert.equal(a.kind,702);assert.equal(a.sealed,true);assert.equal(a.fullPayloadHashVerified,true);assert.deepEqual(a.artifactBody,f.artifactBody);assert.equal(a.businessExecutionVerified,false);
  const v=f.verification;assert.equal(v.leafCount,60);assert.equal(v.directCount,6);assert.equal(v.B,7200000n);assert.equal(v.retired,2700000n);assert.equal(v.used,true);assert.equal(v.phase,6);assert.equal(v.physicsRound,73);
  assert.deepEqual(v.leafSHA,f.output.data.subarray(543,575));assert.deepEqual(v.unionSHA,f.output.data.subarray(575,607));assert.deepEqual(v.transcriptDigest,f.output.data.subarray(623,655));
  const prior=await decodeNativePriorVerification({release:f.release,info:f.verify,actor:f.actor,contextSlot:10n});
  assert.equal(prior.profile,'SYNTHESIS');assert.equal(prior.generation,v.generation);assert.equal(prior.clock,v.clock);assert.equal(prior.verification.used,true);
});

test('HOST-only partial/full-unsealed upload observations preserve prefixes and never supply synthesis success',async()=>{
  const f=await actual,partial=clone(f.info);partial.data=partial.data.subarray(0,251+1024);partial.data.writeUInt32LE(partial.data.length-120,80);partial.data.writeUInt32LE(1024,222);partial.data.writeBigUInt64LE(1n,226);partial.data[234]=0;partial.data.fill(0,235,251);
  const p=await decodeNativeSynthesisArtifact({release:f.release,info:partial,artifactId:f.artifactId,expectedBody:f.artifactBody});assert.equal(p.artifactBody,null);assert.equal(p.sealed,false);assert.equal(p.written,1024);assert.equal(p.fullPayloadHashVerified,false);assert.deepEqual(p.payload,f.artifactBody.subarray(0,1024));
  partial.data.writeBigUInt64LE(99n,226);assert.equal((await decodeNativeSynthesisArtifact({release:f.release,info:partial,artifactId:f.artifactId})).sequence,99n);
  const full=clone(f.info);full.data[234]=0;full.data.fill(0,235,251);const unsealed=await decodeNativeSynthesisArtifact({release:f.release,info:full,artifactId:f.artifactId});assert.equal(unsealed.fullPayloadHashVerified,true);assert.equal(unsealed.sealed,false);
});

test('HOST-only upload owner/header/id/kind/count/seal/hash/prefix corruption fails closed',async()=>{
  const f=await actual,mutations=[a=>a.owner=PROGRAMS.systemProgram,a=>a.executable=true,a=>a.address=f.actor,a=>a.data[0]^=1,a=>a.data[16]^=1,a=>a.data[48]^=1,a=>a.data[84]^=1,a=>a.data[120]^=1,a=>a.data[152]^=1,a=>a.data.writeUInt16LE(501,184),a=>a.data.writeUInt32LE(0,186),a=>a.data.writeUInt32LE(262145,186),a=>a.data.writeUInt32LE(0,222),a=>a.data.writeBigUInt64LE(0n,226),a=>a.data[234]=2,a=>a.data[251]^=1,a=>{a.data[234]=0;},a=>{a.data=Buffer.concat([a.data,Buffer.alloc(1)]);a.data.writeUInt32LE(a.data.length-120,80);}];
  for(const mutate of mutations){const info=clone(f.info);mutate(info);await assert.rejects(decodeNativeSynthesisArtifact({release:f.release,info,artifactId:f.artifactId}));}
  await assert.rejects(decodeNativeSynthesisArtifact({release:f.release,info:f.info,artifactId:f.artifactId,actor:Buffer.alloc(32,9)}),/ACTOR/);
  const wrong=Buffer.from(f.artifactBody);wrong[20]^=1;await assert.rejects(decodeNativeSynthesisArtifact({release:f.release,info:f.info,artifactId:f.artifactId,expectedBody:wrong}),/EXPECTED_BODY/);
  await assert.rejects(decodeNativeSynthesisArtifact({release:f.release,info:f.info,artifactId:f.artifactId,override:true}),/FIELDS/);
});

test('fresh generation0 is admitted only for canonical missing or empty System verify PDA',async()=>{
  const f=await actual,address=(await nativePda(f.release.input.programId,'bio','verify',nativeKeyBytes(f.actor))).address;
  const args={release:f.release,actor:f.actor,contextSlot:20n},missing=await decodeNativePriorVerification({...args,info:null});assert.equal(missing.generation,0n);assert.equal(missing.exists,false);
  const empty={address,owner:PROGRAMS.systemProgram,executable:false,data:Buffer.alloc(0),lamports:99n};assert.equal((await decodeNativePriorVerification({...args,info:empty})).profile,'NONE');
  for(const info of [{...empty,address:f.actor},{...empty,owner:f.release.input.programId},{...empty,executable:true},{...empty,data:Buffer.alloc(1)}])await assert.rejects(decodeNativePriorVerification({...args,info}));
  await assert.rejects(decodeNativePriorVerification({...args,info:null,contextSlot:20}),/SLOT/);
});

async function hostOtherProfile(f,schema){
  const d=Buffer.alloc(4096);d.write(schema===4?'BIOBPV01':'BIOHRP01',120);f.verify.data.copy(d,128,128,204);f.verification.directSHA.copy(d,204);f.verification.semantic.copy(d,236);d[268]=1;f.verify.data.copy(d,364,364,1577);
  return recordAccount(f.release,{kind:37,schema,seeds:['bio','verify',nativeKeyBytes(f.actor)],id:nativeKeyBytes(f.actor),body:d.subarray(120)});
}
test('HOST-only valid blueprint/history prior profiles preserve actual Scratch generation and reject counterfeit resets/failures',async()=>{
  const f=await actual,args={release:f.release,actor:f.actor,contextSlot:30n};
  for(const schema of [4,5]){
    const info=await hostOtherProfile(f,schema),v=await decodeNativePriorVerification({...args,info});assert.equal(v.schema,schema);assert.equal(v.generation,f.verification.generation);assert.equal(v.verification,null);assert.equal(v.used,true);
    const changes=[a=>a.data[120]^=1,a=>a.data.writeBigUInt64LE(0n,380),a=>a.data[430]^=1,a=>a.data[462]^=1,a=>a.data[494]^=1,a=>a.data[3000]=1,a=>a.data[268]=2,a=>a.data.writeUInt16LE(74,388),a=>a.data.writeBigInt64LE(-1n,390),a=>a.data[269]=2];
    for(const mutate of changes){const bad=clone(info);mutate(bad);await assert.rejects(decodeNativePriorVerification({...args,info:bad}));}
    const failed=clone(info);failed.data.writeUInt32LE(8017,302);failed.data[306]=1;failed.data.writeUInt16LE(20,307);
    await assert.rejects(decodeNativePriorVerification({...args,info:failed}));
    if(schema===5){failed.data.writeUInt32LE(0,1564);failed.data[1568]=0;failed.data.writeBigUInt64LE(0n,1569);const history=await decodeNativePriorVerification({...args,info:failed});assert.equal(history.failure,8017);assert.equal(history.generation,v.generation);}
  }
});

test('genuine accepted FINAL frame/body derives exact BIO identities, fixed fee and semantic independently of result',async()=>{
  const f=await actual,e=decodeSynthesisFinalizeBody({release:f.release,abi:f.abi,frame:f.frame,artifactBody:f.artifactBody});assert.equal(e.target,22);assert.equal(e.B,7200000n);assert.equal(e.retired,2700000n);assert.equal(e.feeAtoms,12000000n);assert.deepEqual(e.outputId,f.facts.instance);assert.deepEqual(e.transcriptDigest,f.output.data.subarray(623,655));assert.deepEqual(e.semantic,f.output.data.subarray(727,759));
});

test('HOST-only156 receipt reconstructed from genuine Root binds exact final request and real completed V4 without execution claim',async()=>{
  const f=await actual,b=hostReceipt(f),v=await decodeNativeSynthesisFinalizeResult(resultArgs(f,b));assert.equal(v.qualityPpm,f.facts.qualityPpm);assert.equal(v.B,7200000n);assert.equal(v.retired,2700000n);assert.equal(v.feeAtoms,12000000n);assert.equal(v.verificationResultMatched,true);assert.equal(v.businessExecutionVerified,false);assert.equal(v.rentSufficiencyVerified,false);assert.equal('rentLamports'in v,false);
  assert.equal((await decodeNativeSynthesisFinalizeResult({...resultArgs(f,b),verification:undefined})).verificationResultMatched,false);
  await assert.rejects(decodeNativeSynthesisFinalizeResult({...resultArgs(f,b),trusted:true}),/FIELDS/);
});

test('HOST-only156 receipt identity, amounts, fee, digest, semantic, q and verification mismatch are rejected',async()=>{
  const f=await actual,good=hostReceipt(f);
  for(const result of [good.subarray(0,155),Buffer.concat([good,Buffer.alloc(1)])])await assert.rejects(decodeNativeSynthesisFinalizeResult(resultArgs(f,result)));
  for(const at of [0,32,36,44,52,60,92,124]){const result=Buffer.from(good);result[at]^=1;await assert.rejects(decodeNativeSynthesisFinalizeResult(resultArgs(f,result)));}
  const validOtherQ=Buffer.from(good);validOtherQ.writeUInt32LE(1999000,32);await assert.rejects(decodeNativeSynthesisFinalizeResult(resultArgs(f,validOtherQ)),/VERIFICATION_MISMATCH/);
  const wrongState={...f.verification,generation:f.verification.generation+1n};await assert.rejects(decodeNativeSynthesisFinalizeResult(resultArgs(f,good,wrongState)),/VERIFICATION_MISMATCH/);
  const body=Buffer.from(f.artifactBody);body[20]^=1;await assert.rejects(decodeNativeSynthesisFinalizeResult({...resultArgs(f,good),artifactBody:body}),/ARTIFACT/);
});

function hostStepReceipt(f){
  const v=f.verification,d=f.verify.data;
  return new ByteWriter(80).raw(Buffer.from('BIOVSR03')).u64(v.generation).u16(v.workSequence).u8(v.phase).u8(v.target).u32(Number(v.qualityPpm)).u8(Number(v.taskApplicable)).u16(v.physicsRound).raw(Buffer.alloc(5)).u64(v.cost).raw(v.transcriptDigest).u16(d.readUInt16LE(558)).u8(d[560]).raw(Buffer.alloc(5)).finish();
}
test('HOST-only80 STEP receipt reconstructed from genuine used V4 binds accepted final STEP counters and transcript',async()=>{
  const f=await actual,receipt=hostStepReceipt(f),v=decodeNativeSynthesisVerificationResult({release:f.release,abi:f.abi,frame:f.lastStep,result:receipt,verification:f.verification});
  assert.equal(v.phase,6);assert.equal(v.physicsRound,73);assert.equal(v.businessExecutionVerified,false);assert.equal(v.verificationResultMatched,true);assert.deepEqual(v.transcriptDigest,f.expected.transcriptDigest);
});
test('HOST-only80 STEP receipt corrupt magic/reserved/counters/early q and state mismatches fail closed',async()=>{
  const f=await actual,good=hostStepReceipt(f),args={release:f.release,abi:f.abi,frame:f.lastStep,verification:f.verification};
  for(const at of [0,8,16,18,19,20,24,25,27,32,40,72,74,75]){const result=Buffer.from(good);result[at]^=1;assert.throws(()=>decodeNativeSynthesisVerificationResult({...args,result}));}
  assert.throws(()=>decodeNativeSynthesisVerificationResult({...args,result:good.subarray(0,79)}));
});
test('HOST-only80 BEGIN acknowledgement binds accepted generation reset and initial zero-result phase',async()=>{
  const f=await actual,p=decodeNativeFrame(f.abi,f.beginFrame).payload,generation=p.readBigUInt64LE(72)+1n,digest=initialWitnessDigest(f.verification.graphSHA,p.readUInt32LE(68));
  const result=new ByteWriter(80).raw(Buffer.from('BIOVSR03')).u64(generation).u16(0).u8(0).u8(22).u32(0).u8(0).u16(0).raw(Buffer.alloc(5)).u64(0n).raw(digest).u16(65535).u8(0).raw(Buffer.alloc(5)).finish();
  const args={release:f.release,abi:f.abi,frame:f.beginFrame,result},v=decodeNativeSynthesisVerificationResult(args);assert.equal(v.generation,generation);assert.equal(v.operation,'VERIFY_BEGIN');assert.equal(v.phase,0);assert.equal(v.businessExecutionVerified,false);
  for(const at of [8,16,18,20,24,25,32,72,74]){const bad=Buffer.from(result);bad[at]^=1;assert.throws(()=>decodeNativeSynthesisVerificationResult({...args,result:bad}));}
});
