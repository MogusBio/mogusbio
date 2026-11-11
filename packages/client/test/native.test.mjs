import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountRole } from '@solana/kit';
import { typedHash, sha256, businessKey } from '../../protocol-core/src/index.mjs';
import { baseConfigR2Id } from '../src/release.mjs';
import * as n from '../src/native.mjs';
import { clientFixture,abiBytes,key,hash } from './native-fixture.mjs';
import { buildV1Transaction } from '../src/transaction.mjs';

test('ABI pins exact bytes and rejects duplicate/schema/profile/length-table drift',()=>{
  const raw=abiBytes(),pin=sha256(raw).toString('hex'),abi=n.loadNativeAbi(raw,{expectedHash:pin});
  assert.equal(abi.profile,'BIOP0R2');assert.equal(Object.isFrozen(abi.operations[0].publicFixedSuffix),true);
  assert.throws(()=>n.loadNativeAbi(Buffer.concat([raw,Buffer.from('\n')]),{expectedHash:pin}),/HASH_MISMATCH/);
  assert.throws(()=>n.loadNativeAbi(raw),/HASH_FORMAT/);
  for(const mutate of [a=>a.operations.push(a.operations[0]),a=>a.wireVersion=1,a=>a.operations[0].payloadBytes={oneOf:[40,40]},
    a=>a.operations[0].publicFixedSuffix.reverse(),a=>a.prefix[7].writable=true]){
    const o=JSON.parse(raw);mutate(o);const b=Buffer.from(JSON.stringify(o));assert.throws(()=>n.loadNativeAbi(b,{expectedHash:sha256(b).toString('hex')}));}
  assert.throws(()=>n.nativeOperation(abi,{module:501,opcode:1,schema:1}),/OPERATION_OR_SCHEMA/);
});
test('ExactFrame R2 has independent152-byte golden and H4 hashes original signed bytes',async()=>{
  const {abi,release,actor,frame}=await clientFixture(),p=Buffer.alloc(8);p.writeBigUInt64LE(91n);
  const raw=frame('SYNC_EMISSION',p,0x0102030405060708n),expected=Buffer.alloc(160);
  Buffer.from('BIOIX\0\0\0').copy(expected);expected.writeUInt16LE(1,8);expected.writeUInt16LE(1101,10);expected.writeUInt16LE(1,12);expected.writeUInt16LE(2,14);
  release.domain.copy(expected,16);baseConfigR2Id(release).copy(expected,48);n.nativeKeyBytes(actor).copy(expected,80);expected.writeBigUInt64LE(0x0102030405060708n,112);
  expected.writeUInt32LE(8,144);p.copy(expected,152);assert.deepEqual(raw,expected);
  const decoded=n.decodeNativeFrame(abi,raw);assert.equal(decoded.nonce,0x0102030405060708n);assert.equal(decoded.operation,'SYNC_EMISSION');
  assert.deepEqual(n.nativeRequestHash(abi,raw),typedHash(4,raw));assert.notDeepEqual(n.nativeRequestHash(abi,raw),typedHash(4,raw.subarray(24)));
  assert.deepEqual(n.nativeBusinessKey(abi,raw),businessKey(release.domain,n.nativeKeyBytes(actor),n.nativeNonceOpId(decoded.nonce)));
  for(const at of [0,8,14,120,148]){const b=Buffer.from(raw);b[at]^=1;assert.throws(()=>n.decodeNativeFrame(abi,b));}
  assert.throws(()=>n.decodeNativeFrame(abi,Buffer.concat([raw,Buffer.from([0])])));
  assert.throws(()=>n.encodeNativeFrame(abi,{operation:'SYNC_EMISSION',module:1,domain:release.domain,configId:baseConfigR2Id(release),actor,nonce:0n,payload:p}),/CONFLICT/);
  for(const nonce of [-1n,1,1n<<64n])assert.throws(()=>n.nativeNonceOpId(nonce));
});
test('formal prefix8 and INIT moved BaseConfig use real program PDA identities and exact flags',async()=>{
  const {abi,release,frame}=await clientFixture(),roles=n.nativeOperation(abi,'SYNC_EMISSION').publicFixedSuffix;
  const names={'LABMint':'lab-mint','LABReserve':'lab-reserve','LABAuth':'lab-auth','Treasury':'treasury','Registry':'mining'};
  const suffix=await Promise.all(roles.map(async r=>({name:r.role,address:(await n.nativePda(release.input.programId,'bio',names[r.role])).address})));
  const raw=frame('SYNC_EMISSION',Buffer.alloc(8));const ix=await n.buildNativeInstruction({release,abi,frame:raw,suffix});
  assert.equal(ix.accounts.length,13);assert.equal(ix.accounts[7].address,release.pdas.baseConfig.address);
  assert.deepEqual(ix.accounts.slice(0,8).map(x=>x.role),[3,1,0,0,0,0,0,0]);assert.equal(ix.localPublicFixture,true);assert.equal(ix.productionAdmission,false);
  const initRows=n.nativeOperation(abi,'INIT').publicFixedSuffix;
  const initSuffix=await Promise.all(initRows.map(async r=>({name:r.role,address:r.role==='Program'?release.input.programId:r.role==='ProgramData'?release.programDataAddress:
    (await n.nativePda(release.input.programId,'bio',({labMint:'lab-mint',labReserve:'lab-reserve',labAuthority:'lab-auth',Treasury:'treasury'})[r.role])).address})));
  const init=await n.buildNativeInstruction({release,abi,frame:frame('INIT',Buffer.alloc(40)),suffix:initSuffix});
  assert.equal(init.accounts.length,14);assert.equal(init.accounts[2].role,AccountRole.WRITABLE);assert.equal(init.accounts[7].role,AccountRole.WRITABLE);
  assert.equal(init.accounts.filter(a=>a.address===release.pdas.baseConfig.address).length,1);
  const wrong=suffix.map(v=>({...v}));wrong[0].writable=true;await assert.rejects(n.buildNativeInstruction({release,abi,frame:raw,suffix:wrong}),/FLAGS/);
  const foreign=suffix.map(v=>({...v}));foreign[0].address=key(20);await assert.rejects(n.buildNativeInstruction({release,abi,frame:raw,suffix:foreign}),/PDA/);
  await assert.rejects(n.buildNativeInstruction({release,abi,frame:raw,suffix:[...suffix].reverse()}),/ORDER/);
  await assert.rejects(n.buildNativeInstruction({release,abi,frame:raw,suffix,dynamicAccounts:[{address:key(21),writable:false,signer:false}]}),/NO_DYNAMIC/);
});
test('builder rejects duplicate dynamic accounts, wrong domain, ABI context and offcurve native signers',async()=>{
  const {abi,release,actor,frame}=await clientFixture(),p=n.encodeExitOrdinaryPayload({instance:hash('root'),positionSeq:0n,rootRevision:0n,maxRent:0n});
  const raw=frame('EXIT_ORDINARY',p),rows=n.nativeOperation(abi,'EXIT_ORDINARY').publicFixedSuffix;
  const seeds=[['mining'],['root',p.subarray(0,32)],['root-reg',p.subarray(0,32)],['reg',p.subarray(0,32),Buffer.alloc(8)],['mining-event',Buffer.alloc(8)]];
  const suffix=await Promise.all(rows.map(async(r,i)=>({name:r.role,address:(await n.nativePda(release.input.programId,'bio',...seeds[i])).address})));
  await assert.rejects(n.buildNativeInstruction({release,abi,frame:raw,suffix,dynamicAccounts:[{address:actor,writable:true,signer:true}]}),/DUPLICATE/);
  await assert.rejects(n.buildNativeInstruction({release,abi,frame:raw,suffix,dynamicAccounts:[{address:release.pdas.labAuthority.address,writable:false,signer:true}]}),/DYNAMIC_SIGNER/);
  const bad=Buffer.from(raw);bad[16]^=1;await assert.rejects(n.buildNativeInstruction({release,abi,frame:bad,suffix}),/DOMAIN_CONFIG/);
  await assert.rejects(n.buildNativeInstruction({release:{...release,hashes:{...release.hashes,abiHash:Buffer.alloc(32)}},abi,frame:raw,suffix}),/RELEASE_ABI/);
});
test('official V1 transaction blockhash replacement changes message but preserves the original native Frame',async()=>{
  const {abi,release,actor,frame}=await clientFixture(),raw=frame('SYNC_EMISSION',Buffer.alloc(8));
  const names={'LABMint':'lab-mint','LABReserve':'lab-reserve','LABAuth':'lab-auth','Treasury':'treasury','Registry':'mining'};
  const suffix=await Promise.all(n.nativeOperation(abi,'SYNC_EMISSION').publicFixedSuffix.map(async r=>({name:r.role,address:(await n.nativePda(release.input.programId,'bio',names[r.role])).address})));
  const ix=await n.buildNativeInstruction({release,abi,frame:raw,suffix});
  const build=blockhash=>buildV1Transaction({feePayer:actor,lifetime:{blockhash,lastValidBlockHeight:90n},instructions:[ix],supportedTransactionVersions:[1],
    resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:32768,priorityFeeLamports:0n}});
  const a=build(key(20)),b=build(key(21));assert.notDeepEqual(a.transaction.messageBytes,b.transaction.messageBytes);
  assert.deepEqual(Buffer.from(a.message.instructions[0].data),raw);assert.deepEqual(Buffer.from(b.message.instructions[0].data),raw);
  assert.deepEqual(n.nativeRequestHash(abi,a.message.instructions[0].data),n.nativeRequestHash(abi,b.message.instructions[0].data));
});
test('typed material purchase encodes all payment roles, limits and season at Rust offsets',()=>{
  const p=n.encodeBuyMaterialPayload({projectId:hash('p'),class:2,mint:key(20),catalogHash:hash('catalog'),quantity:19n,payer:key(21),recipient:key(22),destination:key(23),destinationMode:1,
    seller:key(24),unitPrice:700000n,resourceFee:100000n,maxPayment:15200000n,rentPayer:key(25),maxRent:9000000n,season:99});
  assert.equal(p.length,300);assert.equal(p[32],2);assert.equal(p.readBigUInt64LE(97),19n);assert.deepEqual(p.subarray(105,137),n.nativeKeyBytes(key(21)));
  assert.equal(p[201],1);assert.equal(p.readBigUInt64LE(234),700000n);assert.equal(p.readBigUInt64LE(242),100000n);assert.equal(p.readBigUInt64LE(250),15200000n);
  assert.deepEqual(p.subarray(258,290),n.nativeKeyBytes(key(25)));assert.equal(p.readBigUInt64LE(290),9000000n);assert.equal(p.readUInt16LE(298),99);
});
test('project issuance fields and alias wallet sorting match exact native variable layout',async()=>{
  const {abi,frame}=await clientFixture();const classes=[1,2,3,4].map(classId=>({class:classId,cap:500000n,unitPrice:1000000n}));
  const p=n.encodeCreateProjectPayload({catalogHash:hash('catalog'),seller:key(20),feePayer:key(21),rentPayer:key(21),maxCreationFee:10000000n,maxRent:9000000n,name:'实验室',classes});
  const size=Buffer.byteLength('实验室');assert.equal(p.length,216+size);assert.equal(p.readUInt32LE(144),size);assert.equal(p.readBigUInt64LE(128),10000000n);
  for(let i=0;i<4;i++){const at=148+size+i*17;assert.equal(p[at],i+1);assert.equal(p.readBigUInt64LE(at+1),500000n);assert.equal(p.readBigUInt64LE(at+9),1000000n);}
  assert.equal(n.decodeNativeFrame(abi,frame('CREATE_PROJECT',p)).payload.length,p.length);
  const table=n.canonicalNativeWalletTable(key(1),[{address:key(20),writable:false,signer:false},{address:key(21),writable:true,signer:true},
    {address:key(20),writable:true,signer:false},{address:key(1),writable:true,signer:true}]);
  assert.equal(table.length,2);assert.ok(Buffer.compare(n.nativeKeyBytes(table[0].address),n.nativeKeyBytes(table[1].address))<0);
  assert.equal(table.find(r=>r.address===key(20)).writable,true);assert.equal(table.find(r=>r.address===key(21)).signer,true);
});
test('hour settlement and transfer typed helpers bind every CAS/cursor and original rent cap field',()=>{
  assert.equal(n.encodeSyncEmissionPayload({maxRent:17n}).readBigUInt64LE(0),17n);
  assert.deepEqual([0,8].map(at=>n.encodeOpenHourPayload({hour:450n,maxRent:18n}).readBigUInt64LE(at)),[450n,18n]);
  const e=n.encodeApplyEventPayload({eventSequence:79n,boundary:452n,maxRent:19n});assert.equal(e.length,24);assert.deepEqual([0,8,16].map(at=>e.readBigUInt64LE(at)),[79n,452n,19n]);
  const m=n.encodeMaterializeHourPayload({hour:452n,expectedCursor:9n,positionSeq:6n,maxRent:20n});assert.deepEqual([0,8,16,24].map(at=>m.readBigUInt64LE(at)),[452n,9n,6n,20n]);
  const c=n.encodeCloseFinalHourPayload({hour:451n,maxRent:21n});assert.equal(c.length,16);assert.equal(c.readBigUInt64LE(8),21n);
  const skip=n.encodeEmptySkipPayload({expectedNextHour:452n,targetExclusive:100000n,maxRent:23n});assert.deepEqual([0,8,16].map(at=>skip.readBigUInt64LE(at)),[452n,100000n,23n]);assert.throws(()=>n.encodeEmptySkipPayload({expectedNextHour:2n,targetExclusive:2n,maxRent:0n}),/RANGE/);
  const t=n.encodeTransferRootPayload({instance:hash('root'),rootRevision:90n,registrationRevision:188n,newOwner:key(20),maxRent:22n});
  assert.equal(t.length,88);assert.equal(t.readBigUInt64LE(32),90n);assert.equal(t.readBigUInt64LE(40),188n);assert.deepEqual(t.subarray(48,80),n.nativeKeyBytes(key(20)));assert.equal(t.readBigUInt64LE(80),22n);
});
test('typed P5/stake/exit/claim preserve full u64 fields and no client quality claim exists',()=>{
  const max=(1n<<64n)-1n,h=hash('id'),s=hash('sha');
  const p5=n.encodeManufacturePartPayload({artifactId:h,artifactSHA:s,artifactLength:3116,maxRent:max});assert.equal(p5.length,76);assert.equal(p5.readUInt32LE(64),3116);assert.equal(p5.readBigUInt64LE(68),max);
  assert.throws(()=>n.encodeManufacturePartPayload({artifactId:h,artifactSHA:s,artifactLength:3116,maxRent:0n,quality:2000000}),/PAYLOAD_FIELDS/);
  const stake=n.encodeRegisterOrdinaryPayload({instance:h,rootRevision:7n,positionSeq:8n,directorySeq:9n,beneficiary:key(22),maxRent:max});assert.equal(stake.length,96);assert.deepEqual([32,40,48,88].map(at=>stake.readBigUInt64LE(at)),[7n,8n,9n,max]);
  const exit=n.encodeExitOrdinaryPayload({instance:h,positionSeq:8n,rootRevision:7n,maxRent:max});assert.equal(exit.length,56);assert.equal(exit.readBigUInt64LE(40),7n);
  const claim=n.encodeClaimPositionPayload({positionId:h,expectedPaid:9007199254740993n,upToAccrued:max,destination:key(22),rentPayer:key(23),maxRent:0n});
  assert.equal(claim.length,120);assert.equal(claim.readBigUInt64LE(32),9007199254740993n);assert.equal(claim.readBigUInt64LE(40),max);
  assert.throws(()=>n.encodeClaimPositionPayload({positionId:h,expectedPaid:2n,upToAccrued:1n}),/PAID_CAS/);
});
test('Artifact chunks and staged verification/finalization use actual variable offsets and exact modes',async()=>{
  const {abi,frame}=await clientFixture(),h=hash('id'),s=hash('sha');
  const put=n.encodeArtifactPutPayload({kind:702,totalLength:1025,artifactSHA:s,expectedSequence:0n,offset:0,chunk:Buffer.alloc(1024,7),maxRent:92n});
  assert.equal(put.length,1084);assert.equal(put.readUInt16LE(50),1024);assert.equal(put.readBigUInt64LE(1076),92n);assert.equal(n.decodeNativeFrame(abi,frame('ARTIFACT_PUT',put)).payload.length,1084);
  const tail=n.encodeArtifactPutPayload({kind:702,totalLength:1025,artifactSHA:s,expectedSequence:1n,offset:1024,chunk:Buffer.from([8]),maxRent:93n});assert.equal(tail.length,61);assert.equal(tail.readBigUInt64LE(53),93n);
  assert.throws(()=>n.encodeArtifactPutPayload({kind:702,totalLength:1025,artifactSHA:s,expectedSequence:1n,offset:1,chunk:Buffer.from([8]),maxRent:0n}),/CHUNK/);
  const seal=n.encodeArtifactSealPayload({kind:702,artifactId:h,expectedSequence:2n,maxRent:19n});assert.equal(seal.length,50);assert.equal(seal.readBigUInt64LE(34),2n);
  const begin=n.encodeVerifyBeginPayload({artifactId:h,artifactSHA:s,artifactLength:262144,challengePpm:1002000,expectedGeneration:45n,maxRent:91n});assert.equal(begin.length,88);assert.equal(begin.readUInt32LE(68),1002000);assert.equal(begin.readBigUInt64LE(72),45n);
  const step=n.encodeVerifyStepPayload({artifactId:h,expectedGeneration:45n,expectedWorkSequence:644,count:2,previousDigest:s,maxRent:10n});assert.equal(step.length,84);assert.equal(step.readUInt16LE(40),644);assert.equal(step[42],2);assert.equal(step[43],0);
  const f={artifactId:h,artifactSHA:s,artifactLength:90000,expectedGeneration:45n,transcriptSHA:hash('trace'),maxFee:12000000n,maxRent:11n};
  const common=n.encodeSynthFinalizePayload(f),candidate=n.encodeSynthFinalizePayload({...f,competition:{commitId:hash('commit'),salt:hash('salt')}});
  assert.equal(common.length,124);assert.equal(common.readBigUInt64LE(108),12000000n);assert.equal(candidate.length,189);assert.equal(candidate[124],1);assert.deepEqual(candidate.subarray(125,157),hash('commit'));
  assert.throws(()=>frame('SYNTH_FINALIZE',Buffer.alloc(125)),/LENGTH/);const bad=Buffer.from(candidate);bad[124]=0;assert.throws(()=>frame('SYNTH_FINALIZE',bad),/MODE/);
  assert.throws(()=>n.validateNativeResult(abi,frame('ARTIFACT_PUT',tail),Buffer.alloc(44)),/RESULT_LENGTH/);assert.equal(n.validateNativeResult(abi,frame('ARTIFACT_PUT',tail),Buffer.alloc(45)).length,45);
});
