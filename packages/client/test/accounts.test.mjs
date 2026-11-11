import test from 'node:test';import assert from 'node:assert/strict';
import { ByteWriter, encodeRecord, encodeProjectBody, encodeSourceBody, sourceId, instanceId, typedHash, catalogHash, encodeDebitPlan, F1_BOM, initialTicks } from '../../protocol-core/src/index.mjs';
import { members } from '../../biology/src/graph.mjs';
import { encodeBaseConfigR2, baseConfigR2Id, PROGRAMS } from '../src/release.mjs';
import { nativePda,nativeKeyBytes } from '../src/native.mjs';
import * as a from '../src/accounts.mjs';import {clientFixture,key,hash} from './native-fixture.mjs';
import {recordAccount,baseAccount} from './account-fixture.mjs';
const tokenAccount=data=>({address:key(20),owner:PROGRAMS.tokenProgram,executable:false,data});
test('Classic mint/token exact lengths, owners, COption tags and frozen/delegated reserve policy',()=>{
  const m=Buffer.alloc(82);m.writeBigUInt64LE((1n<<64n)-1n,36);m[44]=6;m[45]=1;const mint=a.decodeClassicMint(tokenAccount(m),{expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null});assert.equal(mint.supply,(1n<<64n)-1n);
  for(const mutate of [b=>b[45]=0,b=>b.writeUInt32LE(2,0),b=>b.writeUInt32LE(2,46)]){const b=Buffer.from(m);mutate(b);assert.throws(()=>a.decodeClassicMint(tokenAccount(b)));}
  assert.throws(()=>a.decodeClassicMint({...tokenAccount(m),owner:key(21)}),/OWNER/);assert.throws(()=>a.decodeClassicMint(tokenAccount(Buffer.concat([m,Buffer.from([0])]))),/SIZE/);
  const t=Buffer.alloc(165);nativeKeyBytes(key(21)).copy(t);nativeKeyBytes(key(22)).copy(t,32);t.writeBigUInt64LE(9007199254740993n,64);t[108]=1;
  assert.equal(a.decodeClassicTokenAccount(tokenAccount(t),{expectedMint:key(21),expectedOwner:key(22),reserve:true}).amount,9007199254740993n);
  for(const mutate of [b=>b[108]=2,b=>b.writeUInt32LE(1,109),b=>b.writeUInt32LE(2,72),b=>b.writeBigUInt64LE(1n,121),b=>b.writeUInt32LE(1,129)]){const b=Buffer.from(t);mutate(b);assert.throws(()=>a.decodeClassicTokenAccount(tokenAccount(b),{reserve:true}));}
});
test('Base1048/body928 is exact actual release/PDA/domain and explicit fixture mode0 only',async()=>{
  const {release}=await clientFixture(),account=await baseAccount(release),out=await a.decodeNativeBaseConfig(release,account);assert.equal(out.deploymentMode,0);assert.equal(account.data.length,1048);
  for(const mutate of [b=>b[16]^=1,b=>b[84]^=1,b=>b[88]^=1,b=>b[120+925]=1,b=>b[120+924]=4]){const data=Buffer.from(account.data);mutate(data);await assert.rejects(a.decodeNativeBaseConfig(release,{...account,data}));}
  await assert.rejects(a.decodeNativeBaseConfig(release,{...account,address:key(20)}),/PDA/);await assert.rejects(a.decodeNativeBaseConfig({...release,localPublicFixture:false},account));
});
test('Project and Source read canonical actual native identities, catalog, mint, counters and spent prefixes',async()=>{
  const {release}=await clientFixture(),M=hash('projectBusiness'),id=typedHash(17,Buffer.concat([release.domain,M]));
  const classes=await Promise.all([1,2,3,4].map(async c=>({class:c,mint:nativeKeyBytes((await nativePda(release.input.programId,'bio','pack',id,Buffer.from([c]))).address),lifetimeCap:100n,priceLamports:1500000n,issued:20n,intakeBurned:1n})));
  const p={creator:nativeKeyBytes(key(20)),creationBusiness:M,catalogHash:catalogHash(),saleRecipient:nativeKeyBytes(key(21)),createdAt:7200n,createdSlot:5n,name:'测试',classes};
  const pa=await recordAccount(release,{kind:9,seeds:['bio','project',id],id,body:encodeProjectBody(p)});assert.equal((await a.decodeNativeProject(release,pa,id)).classes[1].issued,20n);
  const s={inventoryOwner:nativeKeyBytes(key(22)),projectId:id,mint:classes[0].mint,catalogHash:catalogHash(),manufactureBusiness:hash('P5'),sourceTokenAccount:nativeKeyBytes(key(23)),class:1,unitCount:1n,intakeOrdinal:0n,createdAt:7201n,createdSlot:6n,initialTick:initialTicks(1,1n),spentPrefix:Array(32).fill(0n)};s.spentPrefix[0]=500n;
  const sid=sourceId(release.domain,s.manufactureBusiness,0),sa=await recordAccount(release,{kind:11,seeds:['bio','source',sid],id:sid,body:encodeSourceBody(s)});
  assert.equal((await a.decodeNativeSource(release,sa,sid)).remainingTick[0],500n);
  const bad=Buffer.from(sa.data);bad.writeBigUInt64LE(1001n,120+480);await assert.rejects(a.decodeNativeSource(release,{...sa,data:bad},sid));
  const wrong=Buffer.from(pa.data);wrong[120+148+Buffer.byteLength(p.name)+1]^=1;await assert.rejects(a.decodeNativeProject(release,{...pa,data:wrong},id),/MINT/);
});
test('Root schema1-4 readers preserve immutable fingerprint across actual consume fields and enforce fixed BOM/scope',async()=>{
  const {release}=await clientFixture();
  for(const schema of [1,2,3,4]){
    const M=hash(`root${schema}`),id=instanceId(release.domain,M);let body;
    if(schema===1){const entries=F1_BOM.flatMap((takeTick,i)=>takeTick?[{species:i+1,expectedPrefix:0n,takeTick}]:[]);body=Buffer.alloc(323+encodeDebitPlan([{sourceId:hash('source'),entries}]).length);encodeDebitPlan([{sourceId:hash('source'),entries}]).copy(body,323);Buffer.from([1,0,1,0]).copy(body,160);body.writeUInt32LE(1000000,164);body.writeBigUInt64LE(120000n,168);body.writeBigUInt64LE(45000n,176);body[184]=1;}
    else{body=Buffer.alloc(641);const target=schema===2?3:schema===3?21:22,leaves=members(target).length*4;Buffer.from([target,schema-1,target===22?0:schema===3?target-15:target,0]).copy(body,160);body.writeUInt32LE(1000000,164);body.writeBigUInt64LE(BigInt(leaves)*120000n,168);body.writeBigUInt64LE(BigInt(leaves)*45000n,176);body[184]=2;body.writeUInt32LE(2000000,487);body.writeUInt32LE(2,491);body.writeUInt32LE(1,495);body.writeUInt32LE(1,499);body[639]=schema===2?4:schema===3?members(target).length:6;body[640]=leaves;}
    id.copy(body);M.copy(body,32);release.hashes.catalogHash.copy(body,96);release.hashes.validatorHash.copy(body,128);body.writeBigInt64LE(7200n,186);body.writeBigUInt64LE(5n,194);nativeKeyBytes(key(22)).copy(body,202);
    const ra=await recordAccount(release,{kind:12,schema,seeds:['bio','root',id],id,body}),live=await a.decodeNativeRoot(release,ra,id);assert.equal(live.lifecycle,0);assert.equal(live.qualityPpm,1000000n);
    const consumed=Buffer.from(ra.data);consumed.writeBigUInt64LE(1n,120+234);consumed[120+242]=1;hash('parent').copy(consumed,120+243);hash('consume').copy(consumed,120+275);consumed.writeBigInt64LE(7300n,120+307);consumed.writeBigUInt64LE(6n,120+315);
    const old=await a.decodeNativeRoot(release,{...ra,data:consumed},id);assert.deepEqual(old.fingerprint,live.fingerprint);assert.equal(old.lifecycle,1);
    const bad=Buffer.from(ra.data);bad[120+168]^=1;await assert.rejects(a.decodeNativeRoot(release,{...ra,data:bad},id));
    if(schema!==1){const wrong=Buffer.from(ra.data);wrong.writeUInt32LE(1000000,120+487);if(schema!==4)await assert.rejects(a.decodeNativeRoot(release,{...ra,data:wrong},id),/EVIDENCE_VERSION/);}
  }
});
