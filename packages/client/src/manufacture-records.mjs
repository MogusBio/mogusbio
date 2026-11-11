import { asBytes, ByteWriter, sha256, typedHash, instanceId, sourceId, decodeMaterialPlan,
  encodeMaterialPlan, F1_BOM, speciesClass } from '../../protocol-core/src/index.mjs';
import { decodeDescriptor, descriptorBytes } from '../../composition/src/payload.mjs';
import { decodeNativeAccountRecord } from './accounts.mjs';
import { baseConfigR2Id } from './release.mjs';
import { nativeKeyAddress, nativeKeyBytes, nativePda, decodeNativeFrame,
  nativeBusinessKey, validateNativeResult } from './native.mjs';

const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const fields=(value,allowed)=>check(value&&Object.keys(value).every(k=>allowed.includes(k)),'MANUFACTURE_RECORD_FIELDS');
const PART_KIND=501, ARTIFACT_OFFSET=251, ARTIFACT_MAX=262144, CHUNK=1024;
const partArtifactId=(release,actor,totalLength,artifactSHA)=>typedHash(19,
  new ByteWriter(134).raw(release.domain).raw(baseConfigR2Id(release)).raw(nativeKeyBytes(actor))
    .u16(PART_KIND).u32(totalLength).raw(artifactSHA).finish());

/** Decode an observed native kind501 Artifact. A partial payload is only a
 * prefix, and even a sealed payload is not evidence of manufacture execution.
 * The coordinator must compare sequence/prefix/seal against its frozen stage. */
export async function decodeNativePartArtifact(input){
  fields(input,['release','info','artifactId','actor','expectedBody']);
  const {release,info,artifactId,actor,expectedBody}=input;
  const expectedId=asBytes(artifactId,32),record=await decodeNativeAccountRecord(release,info,{
    kind:24,schemas:[1],seeds:['bio','artifact',expectedId],recordKey:expectedId,maxBodyBytes:131+ARTIFACT_MAX});
  const b=record.body;check(b.length>=132,'PART_ARTIFACT_SIZE');
  const id=Buffer.from(b.subarray(0,32)),actorBytes=Buffer.from(b.subarray(32,64)),kind=b.readUInt16LE(64),
    totalLength=b.readUInt32LE(66),artifactSHA=Buffer.from(b.subarray(70,102)),written=b.readUInt32LE(102),
    sequence=b.readBigUInt64LE(106),seal=b[114],sealedAt=b.readBigInt64LE(115),sealedSlot=b.readBigUInt64LE(123);
  check(kind===PART_KIND&&totalLength>0&&totalLength<=ARTIFACT_MAX&&written>0&&written<=totalLength
    &&record.bytes.length===ARTIFACT_OFFSET+written&&sequence>0n&&(seal===0||seal===1)
    &&(written%CHUNK===0||written===totalLength),'PART_ARTIFACT_COUNTERS');
  check(id.equals(expectedId)&&partArtifactId(release,actorBytes,totalLength,artifactSHA).equals(id),'PART_ARTIFACT_IDENTITY');
  if(actor!==undefined)check(actorBytes.equals(nativeKeyBytes(actor)),'PART_ARTIFACT_ACTOR');
  check(seal===1?written===totalLength&&sealedAt>=0n:sealedAt===0n&&sealedSlot===0n,'PART_ARTIFACT_SEAL');
  const payload=Buffer.from(b.subarray(131));
  if(written===totalLength)check(sha256(payload).equals(artifactSHA),'PART_ARTIFACT_SHA');
  if(expectedBody!==undefined){
    const expected=asBytes(expectedBody);check(expected.length===totalLength&&sha256(expected).equals(artifactSHA)
      &&payload.equals(expected.subarray(0,written)),'PART_ARTIFACT_EXPECTED_BODY');
  }
  return {schema:1,artifactId:id,actor:nativeKeyAddress(actorBytes),actorBytes,kind,totalLength,artifactSHA,
    written,sequence,sealed:seal===1,sealedAt,sealedSlot,payload,artifactBody:written===totalLength?Buffer.from(payload):null,
    fullPayloadHashVerified:written===totalLength,bytes:Buffer.from(record.bytes),businessExecutionVerified:false};
}

/** Verify the immutable full part body and ARTREF before interpreting a receipt.
 * No existence/availability assertion is made for previously consumed Sources. */
export function decodePartManufactureBody({release,abi,frame,artifactBody}){
  check(abi.hash===release.hashes.abiHash.toString('hex'),'PART_RESULT_ABI');
  const f=decodeNativeFrame(abi,frame);check(f.operation==='MANUFACTURE_PART'&&f.domain.equals(release.domain)
    &&f.configId.equals(baseConfigR2Id(release)),'PART_RESULT_FRAME');
  const body=asBytes(artifactBody);check(body.length>=84&&body.length<=3116&&f.payload.length===76,'PART_BODY_SIZE');
  const artifactId=Buffer.from(f.payload.subarray(0,32)),artifactSHA=Buffer.from(f.payload.subarray(32,64)),
    artifactLength=f.payload.readUInt32LE(64),maxRent=f.payload.readBigUInt64LE(68);
  check(body.length===artifactLength&&sha256(body).equals(artifactSHA)
    &&partArtifactId(release,f.actor,artifactLength,artifactSHA).equals(artifactId),'PART_RESULT_ARTIFACT');
  const descriptor=decodeDescriptor(body.subarray(0,4)),rentPayer=nativeKeyAddress(body.subarray(4,36));
  check(body.readBigUInt64LE(36)===maxRent,'PART_RESULT_RENT_CAP');
  const materialPlan=decodeMaterialPlan(body.subarray(44));
  check(materialPlan.catalogHash.equals(release.hashes.catalogHash)
    &&encodeMaterialPlan(materialPlan).equals(body.subarray(44)),'PART_RESULT_MATERIAL_PLAN');
  const business=nativeBusinessKey(abi,frame),outputId=instanceId(release.domain,business),burned=Array(4).fill(0n),totals=Array(32).fill(0n);
  for(const group of materialPlan.debits)for(const e of group.entries)totals[e.species-1]+=e.takeTick;
  check(totals.every((n,i)=>n===F1_BOM[i]),'PART_RESULT_BOM');
  const sourceIds=materialPlan.intakes.map((item,i)=>{
    const id=sourceId(release.domain,business,i),group=materialPlan.debits.find(g=>g.sourceId.equals(id));
    check(group&&group.entries.every(e=>e.expectedPrefix===0n&&speciesClass(e.species)===item.class),'PART_RESULT_NEW_SOURCE');
    const maximum=group.entries.reduce((m,e)=>e.takeTick>m?e.takeTick:m,0n);
    check(item.unitCount===(maximum+999n)/1000n,'PART_RESULT_INTAKE_MINIMUM');
    burned[item.class-1]+=item.unitCount;return id;
  });
  check(new Set([...materialPlan.debits.map(g=>g.sourceId),...sourceIds].map(id=>id.toString('hex'))).size<=32,'PART_RESULT_SOURCE_COUNT');
  return {frame:f,artifactId,artifactSHA,artifactLength,artifactBody:Buffer.from(body),descriptor,
    descriptorBytes:descriptorBytes(descriptor),rentPayer,maxRent,materialPlan,business,outputId,newSourceIds:sourceIds,burned,
    intakeCount:materialPlan.intakes.length,debitCount:materialPlan.debits.length,totalTicks:totals.reduce((sum,n)=>sum+n,0n)};
}

/** Exact108-byte result binding. The full body is required because Frame stores
 * only an ARTREF. Callers must independently establish execution provenance. */
export async function decodeNativeManufacturePartResult(input){
  fields(input,['release','abi','frame','result','artifactBody']);
  const {release,abi,frame,result,artifactBody}=input,expected=decodePartManufactureBody({release,abi,frame,artifactBody}),
    b=validateNativeResult(abi,frame,asBytes(result));
  check(b.length===108,'PART_RESULT_SIZE');
  check(b.subarray(0,32).equals(expected.outputId)&&b.subarray(32,36).equals(expected.descriptorBytes),'PART_RESULT_IDENTITY');
  const qualityPpm=BigInt(b.readUInt32LE(36)),B=b.readBigUInt64LE(40),retired=b.readBigUInt64LE(48),totalTicks=b.readBigUInt64LE(56),
    burned=Array.from({length:4},(_,i)=>b.readBigUInt64LE(64+i*8)),intakeCount=b.readUInt16LE(96),debitCount=b.readUInt16LE(98),rentLamports=b.readBigUInt64LE(100);
  check(qualityPpm===1000000n&&B===120000n&&retired===45000n&&totalTicks===14000n
    &&totalTicks===expected.totalTicks,'PART_RESULT_FIXED_FACTS');
  check(burned.every((n,i)=>n===expected.burned[i])&&intakeCount===expected.intakeCount
    &&debitCount===expected.debitCount,'PART_RESULT_MATERIALS');
  check(rentLamports<=expected.maxRent,'PART_RESULT_RENT');
  const outputAddress=(await nativePda(release.input.programId,'bio','root',expected.outputId)).address;
  return {outputId:Buffer.from(expected.outputId),outputAddress,artifactId:Buffer.from(expected.artifactId),
    descriptor:expected.descriptor,descriptorBytes:Buffer.from(expected.descriptorBytes),qualityPpm,B,retired,totalTicks,
    burned,intakeCount,debitCount,rentLamports,bytes:Buffer.from(b),businessExecutionVerified:false};
}
