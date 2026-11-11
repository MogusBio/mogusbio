import { ByteReader, ByteWriter, asBytes, sha256, typedHash, instanceId, decodeDebitPlan, F1_BOM, decodeProjectBody, decodeSourceBody } from '../../protocol-core/src/index.mjs';
import { members } from '../../biology/src/graph.mjs';
import { nativeKeyAddress, nativeKeyBytes, nativePda } from './native.mjs';
import { PROGRAMS, baseConfigR2Id, encodeBaseConfigR2, decodeBaseConfigR2 } from './release.mjs';
import { decodePositionBody } from '../../settlement/src/wire.mjs';
import { H_END,hourBudget,TOTAL_SUPPLY } from '../../settlement/src/emission.mjs';
import { K_WEIGHT,W_FLOOR } from '../../settlement/src/weights.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const zero=b=>b.every(x=>x===0);
const u64max=(1n<<64n)-1n;
const read128=(b,at)=>b.readBigUInt64LE(at)+(b.readBigUInt64LE(at+8)<<64n);
const nativeId=(release,kind,tail)=>{const tag=Buffer.alloc(2);tag.writeUInt16LE(kind);return typedHash(14,Buffer.concat([release.domain,tag,...tail]));};
function owned(account,owner,length){check(account&&account.owner===owner&&account.executable===false,'ACCOUNT_OWNER');const d=asBytes(account.data);check(length===undefined||d.length===length,'ACCOUNT_SIZE');return d;}
function option32(d,at){const tag=d.readUInt32LE(at);check(tag===0||tag===1,'TOKEN_COPTION');return tag===1?nativeKeyAddress(d.subarray(at+4,at+36)):null;}

/** Classic SPL state only. Token2022 and extensions are deliberately rejected. */
export function decodeClassicMint(account,{expectedAddress,expectedDecimals,expectedMintAuthority,expectedFreezeAuthority}={}){
  const d=owned(account,PROGRAMS.tokenProgram,82);if(expectedAddress!==undefined)check(account.address===nativeKeyAddress(expectedAddress),'TOKEN_ADDRESS');
  const mintAuthority=option32(d,0),freezeAuthority=option32(d,46);check(d[45]===1,'TOKEN_UNINITIALIZED');
  if(expectedDecimals!==undefined)check(d[44]===expectedDecimals,'TOKEN_DECIMALS');
  if(expectedMintAuthority!==undefined)check(mintAuthority===(expectedMintAuthority===null?null:nativeKeyAddress(expectedMintAuthority)),'TOKEN_MINT_AUTHORITY');
  if(expectedFreezeAuthority!==undefined)check(freezeAuthority===(expectedFreezeAuthority===null?null:nativeKeyAddress(expectedFreezeAuthority)),'TOKEN_FREEZE_AUTHORITY');
  return {address:account.address,mintAuthority,supply:d.readBigUInt64LE(36),decimals:d[44],freezeAuthority};
}
export function decodeClassicTokenAccount(account,{expectedAddress,expectedMint,expectedOwner,reserve=false}={}){
  const d=owned(account,PROGRAMS.tokenProgram,165);if(expectedAddress!==undefined)check(account.address===nativeKeyAddress(expectedAddress),'TOKEN_ADDRESS');
  const mint=nativeKeyAddress(d.subarray(0,32)),owner=nativeKeyAddress(d.subarray(32,64));
  const delegate=option32(d,72),closeAuthority=option32(d,129),nativeTag=d.readUInt32LE(109);
  check(nativeTag===0||nativeTag===1,'TOKEN_COPTION');check(nativeTag===0,'TOKEN_NATIVE_UNSUPPORTED');check(d[108]===1,'TOKEN_FROZEN_OR_UNINITIALIZED');
  const delegatedAmount=d.readBigUInt64LE(121);if(reserve)check(delegate===null&&closeAuthority===null&&delegatedAmount===0n,'TOKEN_RESERVE_AUTHORITY');
  if(expectedMint!==undefined)check(mint===nativeKeyAddress(expectedMint),'TOKEN_MINT');if(expectedOwner!==undefined)check(owner===nativeKeyAddress(expectedOwner),'TOKEN_AUTHORITY');
  return {address:account.address,mint,owner,amount:d.readBigUInt64LE(64),delegate,delegatedAmount,closeAuthority};
}

/** Native header reader, explicitly admitting only each caller's supplied
 * schema. This does not relabel old core record schemas as the native release. */
export async function decodeNativeAccountRecord(release,account,{kind,schemas,seeds,recordKey,maxBodyBytes}){
  const d=owned(account,release.input.programId);check(d.length>=120&&d.length<=120+maxBodyBytes,'ACCOUNT_SIZE');
  const r=new ByteReader(d,maxBodyBytes+120);check(r.raw(8).equals(Buffer.from('BIOLAB\0\0'))&&r.u16()===1,'ACCOUNT_MAGIC');
  check(r.u16()===kind,'ACCOUNT_KIND');const schema=r.u16();check(schemas.includes(schema),'ACCOUNT_SCHEMA');r.zero(2);
  check(r.raw(32).equals(release.domain)&&r.raw(32).equals(baseConfigR2Id(release)),'ACCOUNT_DOMAIN_CONFIG');
  const len=r.u32(),bump=r.u8();r.zero(3);const key=r.raw(32);check(len===r.remaining,'ACCOUNT_SIZE');
  const pda=await nativePda(release.input.programId,...seeds);check(account.address===pda.address&&bump===pda.bump&&key.equals(asBytes(recordKey,32)),'ACCOUNT_PDA_KEY');
  const body=r.raw(len);r.finish();return {schema,body,bytes:d,bump,key};
}
export async function decodeNativeBaseConfig(release,account){
  const configId=baseConfigR2Id(release),r=await decodeNativeAccountRecord(release,account,{kind:1,schemas:[2],seeds:['bio','config'],recordKey:configId,maxBodyBytes:928});
  check(r.bytes.length===1048&&r.body.equals(encodeBaseConfigR2(release)),'ACCOUNT_BASE_RELEASE');
  return {...decodeBaseConfigR2(r.body,{localPublicFixture:release.localPublicFixture===true}),configId};
}
export async function decodeNativeRegistry(release,account){
  const r=await decodeNativeAccountRecord(release,account,{kind:26,schemas:[2],seeds:['bio','mining'],recordKey:baseConfigR2Id(release),maxBodyBytes:256});check(r.body.length===256,'REGISTRY_SIZE');const b=r.body;
  const v={schema:2,body:Buffer.from(b),rootCount:b.readBigUInt64LE(0),nextHour:b.readBigUInt64LE(8),highWater:b.readBigUInt64LE(16),nextKSequence:b.readBigUInt64LE(24),nextKScanSequence:b.readBigUInt64LE(32),eventCount:b.readBigUInt64LE(40),eventCursor:b.readBigUInt64LE(48),lastEventDue:b.readBigUInt64LE(56),activeCount:b.readBigUInt64LE(64),headDirectory:b.readBigUInt64LE(72),tailDirectory:b.readBigUInt64LE(80),normalWeight:read128(b,88),kActivationId:Buffer.from(b.subarray(104,136)),kInstance:Buffer.from(b.subarray(136,168)),kBeneficiary:Buffer.from(b.subarray(168,200)),kPositionId:Buffer.from(b.subarray(200,232)),kDirectory:b.readBigUInt64LE(232),kWeight:read128(b,240)};
  check(v.nextHour<=H_END&&v.highWater<=9223372036854775807n&&v.nextKScanSequence<=v.nextKSequence&&v.eventCursor<=v.eventCount&&v.lastEventDue<=H_END&&v.activeCount<=v.rootCount,'REGISTRY_COUNTERS');
  check(v.activeCount===0n?v.headDirectory===u64max&&v.tailDirectory===u64max&&v.normalWeight===0n:v.headDirectory<v.rootCount&&v.tailDirectory<v.rootCount,'REGISTRY_MEMBERSHIP');
  check(v.kWeight===0n||v.kWeight===K_WEIGHT,'REGISTRY_K_WEIGHT');check(v.kWeight===0n?zero(b.subarray(104,232))&&v.kDirectory===u64max:!zero(v.kActivationId)&&v.kDirectory<v.rootCount,'REGISTRY_K_FACTS');return v;
}
export async function decodeNativeHour(release,account,hour){
  check(typeof hour==='bigint'&&hour>=0n&&hour<H_END,'HOUR_DOMAIN');const h=Buffer.alloc(8);h.writeBigUInt64LE(hour);
  const r=await decodeNativeAccountRecord(release,account,{kind:18,schemas:[3,4],seeds:['bio','hour',h],recordKey:nativeId(release,18,[h]),maxBodyBytes:362});check(r.body.length===(r.schema===3?361:362),'HOUR_SIZE');const b=r.body;
  const v={schema:r.schema,body:Buffer.from(b),hour:b.readBigUInt64LE(0),budget:b.readBigUInt64LE(8),rootCutoff:b.readBigUInt64LE(16),rootCursor:b.readBigUInt64LE(24),materializeCursor:b.readBigUInt64LE(32),status:b[40],members:b.readBigUInt64LE(41),materializedCount:b.readBigUInt64LE(49),normalWeight:read128(b,57),kActivationId:Buffer.from(b.subarray(73,105)),kInstance:Buffer.from(b.subarray(105,137)),kBeneficiary:Buffer.from(b.subarray(137,169)),kIntervalId:Buffer.from(b.subarray(169,201)),kWeight:read128(b,201),totalWeight:read128(b,217),denominator:read128(b,233),materializedSum:b.readBigUInt64LE(249),sealedResidual:b.readBigUInt64LE(265),openedTime:b.readBigInt64LE(273),openedSlot:b.readBigUInt64LE(281),kCutoff:b.readBigUInt64LE(289),headDirectory:b.readBigUInt64LE(297),tailDirectory:b.readBigUInt64LE(305),nextDirectory:b.readBigUInt64LE(313),previousDirectory:b.readBigUInt64LE(321),rentPayer:nativeKeyAddress(b.subarray(329,361)),lazy:r.schema===4?b[361]===1:false};
  check(v.hour===hour&&v.budget===hourBudget(hour)&&[2,3,4].includes(v.status)&&v.rootCutoff===v.rootCursor&&v.members===v.rootCutoff&&v.materializeCursor<=v.rootCutoff&&v.materializedCount===v.materializeCursor&&v.materializedSum<=v.budget&&b.readBigUInt64LE(257)===0n&&v.openedTime>=0n,'HOUR_COUNTERS');
  check(r.schema===3||b[361]<=1,'HOUR_LAZY');check(!v.lazy||(v.nextDirectory===u64max&&v.previousDirectory===u64max),'HOUR_LAZY_SENTINELS');
  check((v.kWeight===0n||v.kWeight===K_WEIGHT)&&v.totalWeight===v.normalWeight+v.kWeight&&v.totalWeight<(1n<<128n)&&v.denominator===(v.totalWeight>W_FLOOR?v.totalWeight:W_FLOOR),'HOUR_DENOMINATOR');
  check(v.kWeight===0n?zero(b.subarray(73,201)):!zero(v.kActivationId),'HOUR_K_FACTS');
  check(v.status===4?v.materializeCursor===v.rootCutoff&&v.materializedCount===v.members&&v.materializedSum+v.sealedResidual===v.budget&&v.nextDirectory===u64max:v.sealedResidual===0n,'HOUR_CONSERVATION');return v;
}
export async function decodeNativePosition(release,account,instance,seq){
  const id=asBytes(instance,32);check(typeof seq==='bigint'&&seq>=0n&&seq<=u64max,'POSITION_SEQUENCE');const n=Buffer.alloc(8);n.writeBigUInt64LE(seq);const positionId=nativeId(release,27,[id,n]);
  const r=await decodeNativeAccountRecord(release,account,{kind:27,schemas:[2],seeds:['bio','reg',id,n],recordKey:positionId,maxBodyBytes:255});check(r.body.length===255,'POSITION_SIZE');const v=decodePositionBody(r.body);
  check(v.instance.equals(id)&&v.rootSeq===seq&&v.B_int<=2400000000000n&&v.accrued<=TOTAL_SUPPLY,'POSITION_FACTS');return {...v,schema:2,body:Buffer.from(r.body),positionId,beneficiaryAddress:nativeKeyAddress(v.beneficiary)};
}
export async function decodeNativeDirectory(release,account,seq){
  check(typeof seq==='bigint'&&seq>=0n&&seq<=u64max,'DIRECTORY_SEQUENCE');const s=Buffer.alloc(8);s.writeBigUInt64LE(seq);
  const r=await decodeNativeAccountRecord(release,account,{kind:28,schemas:[2],seeds:['bio','mining-root',s],recordKey:nativeId(release,28,[Buffer.from([0]),s]),maxBodyBytes:138}),b=r.body;
  check(b.length===138&&b.readBigUInt64LE(0)===seq&&b[8]===0&&b.subarray(9,41).equals(b.subarray(41,73))&&b.readBigUInt64LE(73)===0n&&b[81]<=1,'DIRECTORY_FACTS');
  const instance=Buffer.from(b.subarray(9,41)),currentSequence=b.readBigUInt64LE(114),previous=b.readBigUInt64LE(122),next=b.readBigUInt64LE(130),positionId=Buffer.from(b.subarray(82,114));
  check(b[81]===0?zero(b.subarray(82,122))&&previous===u64max&&next===u64max:
    positionId.equals(nativeId(release,27,[instance,new ByteWriter(8).u64(currentSequence).finish()]))&&previous!==seq&&next!==seq,'DIRECTORY_MEMBERSHIP');
  return {sequence:seq,instance,active:b[81]===1,positionId,currentSequence,previous,next,body:Buffer.from(b)};
}
export async function decodeNativeMiningEvent(release,account,seq){
  check(typeof seq==='bigint'&&seq>=0n&&seq<=u64max,'EVENT_SEQUENCE');const s=Buffer.alloc(8);s.writeBigUInt64LE(seq);
  const r=await decodeNativeAccountRecord(release,account,{kind:38,schemas:[1],seeds:['bio','mining-event',s],recordKey:nativeId(release,38,[s]),maxBodyBytes:177}),b=r.body;
  check(b.length===177&&b.readBigUInt64LE(0)===seq&&b.readBigUInt64LE(8)<=H_END&&b[16]<=3,'EVENT_FACTS');
  const instance=Buffer.from(b.subarray(17,49)),positionSequence=b.readBigUInt64LE(89),positionId=Buffer.from(b.subarray(49,81)),activationId=Buffer.from(b.subarray(97,129));
  check(positionId.equals(nativeId(release,27,[instance,new ByteWriter(8).u64(positionSequence).finish()]))
    &&(b[16]<2?zero(activationId):!zero(activationId))&&b.readBigInt64LE(161)>=0n,'EVENT_IDENTITY');
  return {sequence:seq,due:b.readBigUInt64LE(8),kind:b[16],instance,positionId,directory:b.readBigUInt64LE(81),positionSequence,activationId,
    business:Buffer.from(b.subarray(129,161)),createdTime:b.readBigInt64LE(161),createdSlot:b.readBigUInt64LE(169),body:Buffer.from(b)};
}
const BIO_TASK_FAMILY=Buffer.from('a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe','hex');
export async function decodeNativeActivation(release,account,id){
  const expected=asBytes(id,32),r=await decodeNativeAccountRecord(release,account,{kind:17,schemas:[1],seeds:['bio','activation',expected],recordKey:expected,maxBodyBytes:251}),b=r.body;
  check(b.length===251&&b.subarray(0,32).equals(BIO_TASK_FAMILY)&&b[192]<=1&&b.readBigUInt64LE(184)<H_END
    &&b.readBigUInt64LE(202)>0n&&b.readBigInt64LE(218)>=0n,'ACTIVATION_FACTS');
  check(typedHash(11,Buffer.concat([release.domain,BIO_TASK_FAMILY,b.subarray(32,64),b.subarray(168,176)])).equals(expected),'ACTIVATION_IDENTITY');
  const start=b.readBigUInt64LE(184),end=b[192]===0?null:b.readBigUInt64LE(193);
  check(end===null?b.readBigUInt64LE(193)===0n&&b[201]===0&&zero(b.subarray(226,251)):
    end>=start&&end<=H_END&&b[201]>=1&&b[201]<=6&&b[226]===1&&b.readBigUInt64LE(227)>=b.readBigUInt64LE(202)
      &&b.readBigUInt64LE(235)>=b.readBigUInt64LE(210)&&b.readBigInt64LE(243)>=b.readBigInt64LE(218),'ACTIVATION_END');
  return {id:Buffer.from(expected),winner:Buffer.from(b.subarray(32,64)),instance:Buffer.from(b.subarray(64,96)),author:Buffer.from(b.subarray(96,128)),ordinaryPosition:Buffer.from(b.subarray(128,160)),
    generation:b.readBigUInt64LE(160),local:b.readBigUInt64LE(168),global:b.readBigUInt64LE(176),start,end,body:Buffer.from(b)};
}
export async function decodeNativeProject(release,account,projectId){
  const id=asBytes(projectId,32),r=await decodeNativeAccountRecord(release,account,{kind:9,schemas:[1],seeds:['bio','project',id],recordKey:id,maxBodyBytes:472});
  const p=decodeProjectBody(r.body);check(typedHash(17,Buffer.concat([release.domain,p.creationBusiness])).equals(id),'PROJECT_ID');
  for(const c of p.classes){check(c.priceLamports<=u64max-100000n,'PROJECT_PRICE');check(nativeKeyAddress(c.mint)===(await nativePda(release.input.programId,'bio','pack',id,Buffer.from([c.class]))).address,'PROJECT_MINT');}
  return {...p,projectId:Buffer.from(id)};
}
export async function decodeNativeSource(release,account,sourceId){
  const id=asBytes(sourceId,32),r=await decodeNativeAccountRecord(release,account,{kind:11,schemas:[1],seeds:['bio','source',id],recordKey:id,maxBodyBytes:736});
  check(r.body.length===736,'SOURCE_SIZE');const p=decodeSourceBody(r.body,{domain:release.domain,expectedId:id});
  const mint=await nativePda(release.input.programId,'bio','pack',p.projectId,Buffer.from([p.class]));check(nativeKeyAddress(p.mint)===mint.address,'SOURCE_MINT');
  return {...p,sourceId:Buffer.from(id),remainingTick:p.initialTick.map((n,i)=>n-p.spentPrefix[i])};
}
export async function decodeNativeRoot(release,account,instance){
  const id=asBytes(instance,32),r=await decodeNativeAccountRecord(release,account,{kind:12,schemas:[1,2,3,4],seeds:['bio','root',id],recordKey:id,maxBodyBytes:3359});
  const b=r.body;check(b.length>=327&&b.subarray(0,32).equals(id)&&instanceId(release.domain,b.subarray(32,64)).equals(id),'ROOT_ID');
  check(b.subarray(96,128).equals(release.hashes.catalogHash)&&b.subarray(128,160).equals(release.hashes.validatorHash),'ROOT_MODEL');
  const descriptor=Buffer.from(b.subarray(160,164)),q=b.readUInt32LE(164),base=b.readBigUInt64LE(168),retired=b.readBigUInt64LE(176),createdAt=b.readBigInt64LE(186),createdSlot=b.readBigUInt64LE(194);
  check(createdAt>=0n,'ROOT_TIME');let target=null,challenge=null,cost=0n;
  if(r.schema===1){
    check(descriptor.readUInt16LE(0)===1&&descriptor[2]>=1&&descriptor[2]<=4&&(descriptor[2]===4?descriptor[3]>=1&&descriptor[3]<=15:descriptor[3]===0),'ROOT_DESCRIPTOR');
    check(q===1000000&&base===120000n&&retired===45000n&&b[184]===1&&b[185]===0,'ROOT_COMPONENT');
    const dp=decodeDebitPlan(b.subarray(323)),totals=Array(32).fill(0n);for(const g of dp)for(const e of g.entries)totals[e.species-1]+=e.takeTick;
    check(totals.every((n,i)=>n===F1_BOM[i]),'ROOT_BOM');
  }else{
    check(b.length===641,'ROOT_SIZE');target=descriptor[0];
    check(r.schema===2?target>=1&&target<=15&&descriptor.equals(Buffer.from([target,1,target,0])):r.schema===3?target>=16&&target<=21&&descriptor.equals(Buffer.from([target,2,target-15,0])):descriptor.equals(Buffer.from([22,3,0,0])),'ROOT_DESCRIPTOR');
    const leaves=members(target).length*4,direct=target<=15?4:target<=21?members(target).length:6;
    check(base===BigInt(leaves)*120000n&&retired===BigInt(leaves)*45000n&&q>=500000&&q<=2000000&&q%1000===0&&b[184]===2&&b[185]<=1&&b[639]===direct&&b[640]===leaves,'ROOT_SYNTHESIS');
    challenge=b.readUInt32LE(487);check(challenge>=500000&&challenge<=2000000&&challenge%1000===0&&(![3,9,14,15,21].includes(target)||challenge===2000000)
      &&b.readUInt32LE(491)===2&&b.readUInt32LE(495)===1&&b.readUInt32LE(499)===1,'ROOT_EVIDENCE_VERSION');
    cost=b.readBigUInt64LE(599);check(b[185]===1?r.schema===4&&q===2000000&&cost>0n:cost===0n,'ROOT_COST');
  }
  const lifecycle=b[242];check(lifecycle===0||lifecycle===1,'ROOT_LIFECYCLE');
  if(lifecycle===0)check(zero(b.subarray(243,323)),'ROOT_LIFECYCLE');
  else check(!zero(b.subarray(243,275))&&!zero(b.subarray(275,307))&&b.readBigInt64LE(307)>=createdAt&&b.readBigUInt64LE(315)>=createdSlot,'ROOT_LIFECYCLE');
  return {schema:r.schema,instance:Buffer.from(id),manufactureBusiness:Buffer.from(b.subarray(32,64)),requestHash:Buffer.from(b.subarray(64,96)),descriptor,target,
    qualityPpm:BigInt(q),B:base,retired,scope:b[184],admission:b[185],createdAt,createdSlot,owner:nativeKeyAddress(b.subarray(202,234)),revision:b.readBigUInt64LE(234),lifecycle,
    parent:Buffer.from(b.subarray(243,275)),consumedBusiness:Buffer.from(b.subarray(275,307)),challengePpm:challenge,cost,
    fingerprint:sha256(Buffer.concat([r.bytes.subarray(0,322),r.bytes.subarray(443)]))};
}
