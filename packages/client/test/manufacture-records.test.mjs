import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,createReadStream} from 'node:fs';
import {parseJsonWithBigInts} from '@solana/rpc-spec-types';
import {createInterface} from 'node:readline';
import {sha256,ByteWriter,typedHash,F1_BOM} from '../../protocol-core/src/index.mjs';
import {validateProductionRelease,baseConfigR2Id} from '../src/release.mjs';
import {loadNativeAbi,decodeNativeFrame,encodeNativeFrame,nativeKeyAddress,nativePda} from '../src/native.mjs';
import {decodeNativeRoot,decodeNativeSource,decodeNativeProject,decodeClassicMint,decodeClassicTokenAccount} from '../src/accounts.mjs';
import {decodeNativePartArtifact,decodePartManufactureBody,decodeNativeManufacturePartResult} from '../src/manufacture-records.mjs';

const root=new URL('../../../',import.meta.url);
async function fixture(){
  const release=await validateProductionRelease(JSON.parse(readFileSync(new URL('programs/biolab-economy/evidence/production-admission-fixture-result58.json',root))),{localPublicFixture:true});
  const abi=loadNativeAbi(undefined,{expectedHash:release.input.abiHash});
  const raw=readFileSync(new URL('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe.bin',root));
  assert.equal(sha256(raw).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
  const count=raw.readUInt32LE(104),accounts=new Map();let at=108;
  for(let i=0;i<count;i++){
    const address=nativeKeyAddress(raw.subarray(at,at+32)),lamports=raw.readBigUInt64LE(at+32),owner=nativeKeyAddress(raw.subarray(at+40,at+72)),
      executable=raw[at+72]===1,rentEpoch=raw.readBigUInt64LE(at+73),len=raw.readUInt32LE(at+81);at+=85;
    accounts.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(raw.subarray(at,at+len))});at+=len;
  }
  assert.equal(at,raw.length);
  const stream=createReadStream(new URL('programs/biolab-economy/evidence/econ4r1-full-chain.jsonl',root)),lines=createInterface({input:stream});
  let frame,row;
  try{for await(const line of lines){const next=JSON.parse(line);if(!next.dataHex)continue;
    try{const bytes=Buffer.from(next.dataHex,'hex'),f=decodeNativeFrame(abi,bytes);if(f.operation==='MANUFACTURE_PART'){frame=bytes;row=next;break;}}catch{}}
  }finally{lines.close();stream.destroy();}
  assert.ok(frame);assert.equal(row.expectedResult,'Ok');
  const f=decodeNativeFrame(abi,frame),artifactId=Buffer.from(f.payload.subarray(0,32)),artifactAddress=(await nativePda(release.input.programId,'bio','artifact',artifactId)).address,
    info=accounts.get(artifactAddress),artifactBody=Buffer.from(info.data.subarray(251));
  return {release,abi,accounts,frame,decoded:f,artifactId,artifactAddress,info,artifactBody};
}
const actual=fixture();
const cloneInfo=info=>({...info,data:Buffer.from(info.data)});
const resultArgs=(f,result)=>({release:f.release,abi:f.abi,frame:f.frame,artifactBody:f.artifactBody,result});
// HOST-ONLY108 receipt fixture. The accepted full-chain trace records instructions
// and genuine final accounts but does not persist this old per-op return cache.
// This encoder tests receipt binding; it is not additional native execution.
function hostReceipt(expected,{rent=0n}={}){
  const w=new ByteWriter(108).raw(expected.outputId).raw(expected.descriptorBytes).u32(1000000).u64(120000n).u64(45000n).u64(14000n);
  for(const n of expected.burned)w.u64(n);
  return w.u16(expected.intakeCount).u16(expected.debitCount).u64(rent).finish();
}

test('unchanged genuine76b kind501 ledger Artifact binds exact accepted MANUFACTURE Frame and actual part Root',async()=>{
  const f=await actual,v=await decodeNativePartArtifact({release:f.release,info:f.info,artifactId:f.artifactId,actor:f.decoded.actor,expectedBody:f.artifactBody});
  assert.equal(v.kind,501);assert.equal(v.sealed,true);assert.equal(v.written,v.totalLength);assert.equal(v.fullPayloadHashVerified,true);
  assert.equal(v.businessExecutionVerified,false);assert.deepEqual(v.artifactBody,f.artifactBody);assert.ok(v.sealedAt>=0n);
  const body=decodePartManufactureBody({release:f.release,abi:f.abi,frame:f.frame,artifactBody:f.artifactBody});
  const outputAddress=(await nativePda(f.release.input.programId,'bio','root',body.outputId)).address;
  const part=await decodeNativeRoot(f.release,f.accounts.get(outputAddress),body.outputId);
  assert.equal(part.schema,1);assert.deepEqual(part.manufactureBusiness,body.business);assert.deepEqual(part.descriptor,body.descriptorBytes);
  assert.equal(body.totalTicks,14000n);assert.equal(body.maxRent,f.decoded.payload.readBigUInt64LE(68));
});

test('host-only partial and complete-unsealed boundaries retain exact prefix and separate sequence from manufacture',async()=>{
  const f=await actual;
  // This actual part body exceeds one chunk; mutate only host observations.
  assert.ok(f.artifactBody.length>1024);
  const info=cloneInfo(f.info);info.data=info.data.subarray(0,251+1024);info.data.writeUInt32LE(info.data.length-120,80);
  info.data.writeUInt32LE(1024,120+102);info.data.writeBigUInt64LE(1n,120+106);info.data[120+114]=0;info.data.fill(0,120+115,120+131);
  const v=await decodeNativePartArtifact({release:f.release,info,artifactId:f.artifactId,expectedBody:f.artifactBody});
  assert.equal(v.written,1024);assert.equal(v.sealed,false);assert.equal(v.artifactBody,null);assert.equal(v.fullPayloadHashVerified,false);
  assert.deepEqual(v.payload,f.artifactBody.subarray(0,1024));
  // Native duplicate chunk writes can increment sequence without growing bytes.
  info.data.writeBigUInt64LE(77n,120+106);
  assert.equal((await decodeNativePartArtifact({release:f.release,info,artifactId:f.artifactId})).sequence,77n);
  const full=cloneInfo(f.info);full.data[120+114]=0;full.data.fill(0,120+115,120+131);
  const unsealed=await decodeNativePartArtifact({release:f.release,info:full,artifactId:f.artifactId});
  assert.equal(unsealed.sealed,false);assert.equal(unsealed.fullPayloadHashVerified,true);
});

test('host-only owner/header/PDA/identity/length/seal/prefix corruption fails closed',async()=>{
  const f=await actual;
  const mutations=[i=>i.owner=f.release.input.bootstrap,i=>i.executable=true,i=>i.address=f.release.input.bootstrap,
    i=>i.data[0]^=1,i=>i.data[10]^=1,i=>i.data[12]^=1,i=>i.data[16]^=1,i=>i.data[48]^=1,i=>i.data[84]^=1,
    i=>i.data[120]^=1,i=>i.data[152]^=1,i=>i.data.writeUInt16LE(702,184),i=>i.data.writeUInt32LE(0,186),
    i=>i.data.writeUInt32LE(262145,186),i=>i.data.writeUInt32LE(1,222),i=>i.data.writeBigUInt64LE(0n,226),
    i=>i.data[234]=2,i=>i.data.writeBigInt64LE(-1n,235),i=>i.data[251]^=1,
    i=>{i.data[234]=0;},i=>{i.data=Buffer.concat([i.data,Buffer.from([0])]);i.data.writeUInt32LE(i.data.length-120,80);}];
  for(const mutate of mutations){const info=cloneInfo(f.info);mutate(info);await assert.rejects(decodeNativePartArtifact({release:f.release,info,artifactId:f.artifactId}));}
  await assert.rejects(decodeNativePartArtifact({release:f.release,info:f.info,artifactId:f.artifactId,actor:Buffer.alloc(32,9)}),/ACTOR/);
  const wrong=Buffer.from(f.artifactBody);wrong[44]^=1;
  await assert.rejects(decodeNativePartArtifact({release:f.release,info:f.info,artifactId:f.artifactId,expectedBody:wrong}),/EXPECTED_BODY/);
  await assert.rejects(decodeNativePartArtifact({release:f.release,info:f.info,artifactId:f.artifactId,override:true}),/FIELDS/);
});

test('host-only108 receipt binds exact authentic body/frame without claiming actual execution',async()=>{
  const f=await actual,expected=decodePartManufactureBody({release:f.release,abi:f.abi,frame:f.frame,artifactBody:f.artifactBody}),
    result=hostReceipt(expected,{rent:expected.maxRent}),v=await decodeNativeManufacturePartResult(resultArgs(f,result));
  assert.deepEqual(v.outputId,expected.outputId);assert.deepEqual(v.burned,expected.burned);assert.equal(v.qualityPpm,1000000n);
  assert.equal(v.B,120000n);assert.equal(v.retired,45000n);assert.equal(v.totalTicks,14000n);
  assert.equal(v.intakeCount,expected.intakeCount);assert.equal(v.debitCount,expected.debitCount);assert.equal(v.rentLamports,expected.maxRent);
  assert.equal(v.businessExecutionVerified,false);
  const noBody=resultArgs(f,result);delete noBody.artifactBody;await assert.rejects(decodeNativeManufacturePartResult(noBody));
  await assert.rejects(decodeNativeManufacturePartResult({...resultArgs(f,result),fakeExecution:true}),/FIELDS/);
});

test('host-only receipt fields, rent cap, ARTREF and full body tampering cannot produce matching success',async()=>{
  const f=await actual,expected=decodePartManufactureBody({release:f.release,abi:f.abi,frame:f.frame,artifactBody:f.artifactBody}),good=hostReceipt(expected);
  for(const result of [good.subarray(0,107),Buffer.concat([good,Buffer.alloc(1)])])await assert.rejects(decodeNativeManufacturePartResult(resultArgs(f,result)));
  for(const at of [0,32,36,40,48,56,64,72,80,88,96,98]){const bad=Buffer.from(good);bad[at]^=1;await assert.rejects(decodeNativeManufacturePartResult(resultArgs(f,bad)));}
  const rent=Buffer.from(good);rent.writeBigUInt64LE(expected.maxRent+1n,100);
  await assert.rejects(decodeNativeManufacturePartResult(resultArgs(f,rent)),/PART_RESULT_RENT/);
  for(const at of [0,32,64,68]){const payload=Buffer.from(f.decoded.payload);payload[at]^=1;
    const frame=encodeNativeFrame(f.abi,{...{operation:'MANUFACTURE_PART',domain:f.decoded.domain,configId:f.decoded.configId,actor:f.decoded.actor,nonce:f.decoded.nonce},payload});
    await assert.rejects(decodeNativeManufacturePartResult({...resultArgs(f,good),frame}));}
  for(const at of [0,4,36,44,80]){const artifactBody=Buffer.from(f.artifactBody);artifactBody[at]^=1;
    await assert.rejects(decodeNativeManufacturePartResult({...resultArgs(f,good),artifactBody}));}
});

// HOST-ONLY rebind a tampered full body to its own ARTREF: semantic validation
// must still reject it after legitimate hash/identity checks have passed.
function hostReframe(f,artifactBody){
  const artifactSHA=sha256(artifactBody),artifactId=typedHash(19,new ByteWriter(134).raw(f.release.domain).raw(baseConfigR2Id(f.release)).raw(f.decoded.actor)
    .u16(501).u32(artifactBody.length).raw(artifactSHA).finish());
  const payload=new ByteWriter(76).raw(artifactId).raw(artifactSHA).u32(artifactBody.length).u64(f.decoded.payload.readBigUInt64LE(68)).finish();
  return encodeNativeFrame(f.abi,{operation:'MANUFACTURE_PART',domain:f.decoded.domain,configId:f.decoded.configId,actor:f.decoded.actor,nonce:f.decoded.nonce,payload});
}
test('host-only correctly rehashed malformed descriptors, catalogs, BOM and new-source identity remain invalid',async()=>{
  const f=await actual;
  for(const at of [0,2,3,36,44,80]){const artifactBody=Buffer.from(f.artifactBody);artifactBody[at]^=1;
    assert.throws(()=>decodePartManufactureBody({release:f.release,abi:f.abi,frame:hostReframe(f,artifactBody),artifactBody}));}
  const expected=decodePartManufactureBody({release:f.release,abi:f.abi,frame:f.frame,artifactBody:f.artifactBody});
  assert.equal(expected.materialPlan.intakes.length,4);assert.equal(expected.materialPlan.debits.length,4);
  // First intake's unit count and first debit Source ID are exact-offset body fields.
  for(const at of [44+36+97,44+36+4*105+4]){const artifactBody=Buffer.from(f.artifactBody);artifactBody[at]^=1;
    assert.throws(()=>decodePartManufactureBody({release:f.release,abi:f.abi,frame:hostReframe(f,artifactBody),artifactBody}));}
});


const signedBank=parseJsonWithBigInts(readFileSync(new URL('programs/transaction-transport/evidence/part-result-bank-76b35cfb-case-1.json',root),'utf8'));
const bankAccounts=rows=>new Map(rows.map(row=>[row.address,row.missing?null:{...row,data:Buffer.from(row.data[0],'base64')}]));
test('actual22 signed Bank scoped acceptance yields strict108 receipt/cache and native part record',async()=>{
  const f=await actual,frame=Buffer.from(signedBank.frameHex,'hex'),artifactBody=Buffer.from(signedBank.artifactBodyHex,'hex'),
    result=Buffer.from(signedBank.manufactureResult.resultHex,'hex'),after=bankAccounts(signedBank.afterAccounts),before=bankAccounts(signedBank.beforeAccounts),
    receipt=await decodeNativeManufacturePartResult({release:f.release,abi:f.abi,frame,artifactBody,result});
  assert.equal(signedBank.elfSHA256,'76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e');
  assert.equal(signedBank.abiSHA256,f.abi.hash);assert.equal(signedBank.fixtureOnly,true);assert.equal(signedBank.networkBroadcast,false);
  assert.equal(receipt.bytes.toString('hex'),signedBank.execution.returnDataHex);assert.equal(receipt.bytes.length,108);
  const n=after.get(signedBank.actorNonceAddress).data;
  assert.equal(n.readBigUInt64LE(120),10n);assert.equal(n.readUInt16LE(160),108);assert.deepEqual(n.subarray(162,270),result);
  assert.ok(n.subarray(270).every(x=>x===0));
  assert.equal(receipt.rentLamports,35628240n);assert.equal(receipt.businessExecutionVerified,false);
  assert.deepEqual(receipt.burned,[1n,1n,1n,1n]);assert.equal(before.get(receipt.outputAddress),null);
  const part=await decodeNativeRoot(f.release,after.get(receipt.outputAddress),receipt.outputId);
  assert.equal(part.schema,1);assert.equal(part.lifecycle,0);assert.equal(part.owner,signedBank.actor);
  assert.deepEqual(part.requestHash,typedHash(4,frame));assert.deepEqual(part.descriptor,receipt.descriptorBytes);
  const artifactAddress=(await nativePda(f.release.input.programId,'bio','artifact',receipt.artifactId)).address;
  const artifact=await decodeNativePartArtifact({release:f.release,info:after.get(artifactAddress),artifactId:receipt.artifactId,actor:signedBank.actor,expectedBody:artifactBody});
  assert.equal(artifact.sequence,2n);assert.equal(artifact.sealed,true);
});

test('actual Bank per-material burn,Source prefix,project counters,rent and exact retry all reconcile',async()=>{
  const f=await actual,before=bankAccounts(signedBank.beforeAccounts),after=bankAccounts(signedBank.afterAccounts),retry=bankAccounts(signedBank.afterRetryAccounts),
    body=decodePartManufactureBody({release:f.release,abi:f.abi,frame:Buffer.from(signedBank.frameHex,'hex'),artifactBody:Buffer.from(signedBank.artifactBodyHex,'hex')});
  let rented=after.get(signedBank.manufactureResult.outputAddress).lamports,ticks=0n,remaining=0n;
  const projectIds=new Map();
  for(const [ordinal,intake]of body.materialPlan.intakes.entries()){
    const projectId=intake.projectId,projectAddress=(await nativePda(f.release.input.programId,'bio','project',projectId)).address,
      mintAddress=(await nativePda(f.release.input.programId,'bio','pack',projectId,Buffer.from([intake.class]))).address,
      authority=(await nativePda(f.release.input.programId,'bio','pack-auth',projectId,Buffer.from([intake.class]))).address,
      mintOptions={expectedAddress:mintAddress,expectedDecimals:0,expectedMintAuthority:authority,expectedFreezeAuthority:null},
      mintBefore=decodeClassicMint(before.get(mintAddress),mintOptions),mintAfter=decodeClassicMint(after.get(mintAddress),mintOptions),
      tokenAddress=nativeKeyAddress(intake.sourceTokenAccount),tokenOptions={expectedAddress:tokenAddress,expectedOwner:signedBank.actor,expectedMint:mintAddress},
      tokenBefore=decodeClassicTokenAccount(before.get(tokenAddress),tokenOptions),tokenAfter=decodeClassicTokenAccount(after.get(tokenAddress),tokenOptions);
    assert.equal(mintBefore.supply-mintAfter.supply,intake.unitCount);assert.equal(tokenBefore.amount-tokenAfter.amount,intake.unitCount);
    const id=body.newSourceIds[ordinal],address=(await nativePda(f.release.input.programId,'bio','source',id)).address;
    assert.equal(before.get(address),null);const source=await decodeNativeSource(f.release,after.get(address),id),group=body.materialPlan.debits.find(g=>g.sourceId.equals(id));
    assert.equal(nativeKeyAddress(source.inventoryOwner),signedBank.actor);assert.equal(source.class,intake.class);assert.equal(source.unitCount,intake.unitCount);
    assert.deepEqual(source.manufactureBusiness,body.business);assert.deepEqual(source.projectId,projectId);
    for(let i=0;i<32;i++){const debit=group.entries.find(e=>e.species===i+1);assert.equal(source.spentPrefix[i],debit?.takeTick??0n);ticks+=source.spentPrefix[i];remaining+=source.remainingTick[i];}
    rented+=after.get(address).lamports;projectIds.set(projectAddress,projectId);
  }
  assert.equal(ticks,F1_BOM.reduce((a,b)=>a+b,0n));assert.equal(ticks,14000n);assert.equal(remaining,18000n);
  for(const [address,id]of projectIds){const p0=await decodeNativeProject(f.release,before.get(address),id),p1=await decodeNativeProject(f.release,after.get(address),id);
    for(let i=0;i<4;i++){assert.equal(p1.classes[i].intakeBurned-p0.classes[i].intakeBurned,1n);assert.equal(p1.classes[i].issued,p0.classes[i].issued);}}
  assert.equal(rented,BigInt(signedBank.manufactureResult.actualRentLamports));
  assert.equal(before.get(signedBank.actor).lamports-after.get(signedBank.actor).lamports,rented+5000n);
  assert.notEqual(signedBank.execution.actualSignature,signedBank.retry.actualSignature);assert.notEqual(signedBank.execution.blockhash,signedBank.retry.blockhash);
  assert.equal(signedBank.execution.returnDataHex,signedBank.retry.returnDataHex);
  const omitted=new Set([signedBank.actor,'Sysvar1nstructions1111111111111111111111111','SysvarC1ock11111111111111111111111111111111']);
  for(const [address,a]of after)if(!omitted.has(address))assert.deepEqual(retry.get(address),a);
  assert.equal(after.get(signedBank.actor).lamports-retry.get(signedBank.actor).lamports,5000n);
});

test('actual signed authenticatedcap0 and later-instruction failures roll all business accounts back',async()=>{
  const f=await actual;
  assert.equal(signedBank.negativeCases.length,2);
  for(const failure of signedBank.negativeCases){
    assert.equal(failure.businessStateRolledBack,true);assert.equal(Number(failure.execution.returnDataBytes),0);assert.equal(failure.execution.result,'Err');
    const before=bankAccounts(failure.beforeAccounts),after=bankAccounts(failure.afterAccounts),omitted=new Set([signedBank.actor,'Sysvar1nstructions1111111111111111111111111','SysvarC1ock11111111111111111111111111111111']);
    for(const [address,a]of before)if(!omitted.has(address))assert.deepEqual(after.get(address),a);
    assert.equal(before.get(signedBank.actor).lamports-after.get(signedBank.actor).lamports,5000n);
    if(failure.name==='AUTHENTICATED_MANUFACTURE_RENT_CAP_ZERO'){
      assert.match(failure.execution.bankResult,/6109/);const window=failure.window,body=Buffer.from(window.artifactBodyHex,'hex'),frame=Buffer.from(window.stages.at(-1).dataHex,'hex'),
        expected=decodePartManufactureBody({release:f.release,abi:f.abi,frame,artifactBody:body}),address=(await nativePda(f.release.input.programId,'bio','artifact',expected.artifactId)).address,
        record=await decodeNativePartArtifact({release:f.release,info:before.get(address),artifactId:expected.artifactId,actor:signedBank.actor,expectedBody:body});
      assert.equal(expected.maxRent,0n);assert.equal(record.sealed,true);assert.equal(before.get(window.outputAddress),null);assert.equal(after.get(window.outputAddress),null);
    }else assert.match(failure.execution.bankResult,/InstructionError\(1/);
  }
});
