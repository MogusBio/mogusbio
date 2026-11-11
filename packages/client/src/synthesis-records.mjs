import {asBytes,ByteWriter,sha256,typedHash,instanceId} from '../../protocol-core/src/index.mjs';
import {decodeSynthesisPayload,encodeSynthesisPayload} from '../../composition/src/payload.mjs';
import {validateGraph,members,designId} from '../../biology/src/index.mjs';
import {decodeNativeAccountRecord} from './accounts.mjs';
import {decodeNativeSynthesisVerification} from './synthesis-workflow.mjs';
import {baseConfigR2Id,PROGRAMS} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda,decodeNativeFrame,nativeBusinessKey,validateNativeResult} from './native.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const fields=(v,names)=>check(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).every(k=>names.includes(k)),'SYN_RECORD_FIELDS');
const zero=b=>b.every(x=>x===0),MAX=(1n<<64n)-1n;
const flags={clientReadOnly:true,businessExecutionVerified:false};
const artifactKey=(release,actor,totalLength,hash)=>typedHash(19,new ByteWriter(134).raw(release.domain).raw(baseConfigR2Id(release)).raw(nativeKeyBytes(actor)).u16(702).u32(totalLength).raw(hash).finish());

/** An observed upload prefix is not a full payload or synthesis proof. */
export async function decodeNativeSynthesisArtifact(input){
  fields(input,['release','info','artifactId','actor','expectedBody']);
  const {release,info,artifactId,actor,expectedBody}=input,id=asBytes(artifactId,32),expected=expectedBody===undefined?undefined:asBytes(expectedBody);
  const record=await decodeNativeAccountRecord(release,info,{kind:24,schemas:[1],seeds:['bio','artifact',id],recordKey:id,maxBodyBytes:262275}),b=record.body;
  check(b.length>=132,'SYN_UPLOAD_SIZE');
  const actorBytes=Buffer.from(b.subarray(32,64)),kind=b.readUInt16LE(64),totalLength=b.readUInt32LE(66),artifactSHA=Buffer.from(b.subarray(70,102)),written=b.readUInt32LE(102),sequence=b.readBigUInt64LE(106),sealedAt=b.readBigInt64LE(115),sealedSlot=b.readBigUInt64LE(123),seal=b[114],payload=Buffer.from(b.subarray(131));
  check(kind===702&&totalLength>0&&totalLength<=262144&&written>0&&written<=totalLength&&payload.length===written&&sequence>0n&&(written%1024===0||written===totalLength)&&(seal===0||seal===1),'SYN_UPLOAD_COUNTERS');
  check(b.subarray(0,32).equals(id)&&artifactKey(release,actorBytes,totalLength,artifactSHA).equals(id),'SYN_UPLOAD_IDENTITY');
  if(actor!==undefined)check(actorBytes.equals(nativeKeyBytes(actor)),'SYN_UPLOAD_ACTOR');
  check(seal===1?written===totalLength&&sealedAt>=0n:sealedAt===0n&&sealedSlot===0n,'SYN_UPLOAD_SEAL');
  if(written===totalLength)check(sha256(payload).equals(artifactSHA),'SYN_UPLOAD_SHA');
  if(expected!==undefined)check(expected.length===totalLength&&sha256(expected).equals(artifactSHA)&&payload.equals(expected.subarray(0,written)),'SYN_UPLOAD_EXPECTED_BODY');
  return {...flags,schema:1,artifactId:Buffer.from(id),actor:nativeKeyAddress(actorBytes),actorBytes,kind,totalLength,artifactSHA,written,sequence,sealed:seal===1,sealedAt,sealedSlot,payload,artifactBody:written===totalLength?Buffer.from(payload):null,fullPayloadHashVerified:written===totalLength,bytes:Buffer.from(record.bytes)};
}

function scratch(release,d,actor){
  const owner=nativeKeyBytes(actor),round=d.readUInt16LE(388),generation=d.readBigUInt64LE(380),clock=d.readBigInt64LE(390),quality=d.readUInt32LE(1564),task=d[1568],cost=d.readBigUInt64LE(1569),target=d[375],challenge=d.readUInt32LE(376);
  check(d.subarray(364,372).equals(Buffer.from('BIOVFY02'))&&d.readUInt16LE(372)===2&&round<=73&&generation>0n&&clock>=0n&&d[374]===(round===73?2:1),'SYN_PRIOR_SCRATCH');
  check(d.subarray(430,462).equals(owner)&&d.subarray(462,494).equals(baseConfigR2Id(release))&&d.subarray(494,526).equals(release.hashes.validatorHash),'SYN_PRIOR_CONTEXT');
  check(target>=1&&target<=22&&challenge>=500000&&challenge<=2000000&&challenge%1000===0&&task<=1&&(round===73||quality===0&&task===0&&cost===0n),'SYN_PRIOR_RESULT');
  return {generation,clock,physicsRound:round,qualityPpm:BigInt(quality),taskApplicable:task===1,cost,target,challengePpm:challenge};
}
const validFailure=(stage,code)=>stage===0?[0xff000001,6600,6605,6712,6737,8000].includes(code):stage===1?code===8017:stage===2?code>=8001&&code<=8016||code===0xff000002:stage===3?code===8019:false;

/** A different verification profile retains its actual actor generation. */
export async function decodeNativePriorVerification(input){
  fields(input,['release','info','actor','contextSlot']);
  const {release,info,actor,contextSlot}=input;check(typeof contextSlot==='bigint'&&contextSlot>=0n&&contextSlot<=MAX,'SYN_PRIOR_SLOT');
  const owner=nativeKeyBytes(actor),address=(await nativePda(release.input.programId,'bio','verify',owner)).address;
  const common={...flags,actor:nativeKeyAddress(owner),address,contextSlot,source:'FINALIZED_PROGRAM_ACCOUNT'};
  if(info===null||info?.owner===PROGRAMS.systemProgram&&info.executable===false&&asBytes(info.data).length===0){
    if(info!==null)check(info.address===address,'SYN_PRIOR_ADDRESS');
    return {...common,exists:false,schema:null,profile:'NONE',generation:0n,clock:0n,verification:null};
  }
  const record=await decodeNativeAccountRecord(release,info,{kind:37,schemas:[3,4,5],seeds:['bio','verify',owner],recordKey:owner,maxBodyBytes:3976}),d=record.bytes;
  check(d.length===4096,'SYN_PRIOR_SIZE');
  if(record.schema===3){
    const verification=await decodeNativeSynthesisVerification(release,info,{actor:owner,contextSlot});
    return {...common,exists:true,schema:3,profile:'SYNTHESIS',generation:verification.generation,clock:verification.clock,used:verification.used,verification};
  }
  const historical=record.schema===5;
  check(d.subarray(120,128).equals(Buffer.from(historical?'BIOHRP01':'BIOBPV01'))&&d[268]<=1&&zero(d.subarray(1577)),'SYN_PRIOR_PROFILE');
  const failure=d.readUInt32LE(302),failureStage=d[306],failureCursor=d.readUInt16LE(307);
  if(historical)check(d[269]<=1&&failureStage<=3&&failureCursor<=73&&zero(d.subarray(309,364))&&(failure!==0||zero(d.subarray(306,309))),'SYN_PRIOR_HISTORY');
  else check(zero(d.subarray(269,364)),'SYN_PRIOR_BLUEPRINT');
  const state=scratch(release,d,owner);
  check(d[268]===0||state.physicsRound===73,'SYN_PRIOR_USED');
  check(failure===0||historical&&validFailure(failureStage,failure)&&state.qualityPpm===0n&&!state.taskApplicable&&state.cost===0n,'SYN_PRIOR_FAILURE');
  return {...common,...state,exists:true,schema:record.schema,profile:historical?'HISTORICAL':'BLUEPRINT',used:d[268]===1,failure,failureStage,failureCursor,artifactId:Buffer.from(d.subarray(128,160)),artifactSHA:Buffer.from(d.subarray(160,192)),artifactLength:d.readUInt32LE(192),verification:null};
}

/** Frame binds only ARTREF and a completed transcript. Leaf provenance and
 * current spending eligibility remain actual verification/native checks. */
export function decodeSynthesisFinalizeBody(input){
  fields(input,['release','abi','frame','artifactBody']);const {release,abi,frame,artifactBody}=input;
  check(abi.hash===release.hashes.abiHash.toString('hex'),'SYN_FINAL_ABI');
  const f=decodeNativeFrame(abi,frame),p=f.payload,body=asBytes(artifactBody);
  check(f.operation==='SYNTH_FINALIZE'&&f.domain.equals(release.domain)&&f.configId.equals(baseConfigR2Id(release))&&(p.length===124||p.length===189&&p[124]===1),'SYN_FINAL_FRAME');
  const artifactId=Buffer.from(p.subarray(0,32)),artifactSHA=Buffer.from(p.subarray(32,64)),artifactLength=p.readUInt32LE(64),generation=p.readBigUInt64LE(68),transcriptDigest=Buffer.from(p.subarray(76,108)),maxFee=p.readBigUInt64LE(108),maxRent=p.readBigUInt64LE(116);
  check(body.length===artifactLength&&body.length<=262144&&sha256(body).equals(artifactSHA)&&artifactKey(release,f.actor,body.length,artifactSHA).equals(artifactId)&&generation>0n,'SYN_FINAL_ARTIFACT');
  const payload=decodeSynthesisPayload(body),graph=payload.graph,target=graph.target;
  check(encodeSynthesisPayload(payload).equals(body),'SYN_FINAL_CANONICAL');
  validateGraph(graph,{domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash});
  const positions=target<=15?[1,2,3,4]:target<=21?members(target):[16,17,18,19,20,21];
  check(payload.direct.length===positions.length&&payload.direct.every((d,i)=>target<=15?d.scope===target&&d.primitive===positions[i]:d.scope===positions[i]&&d.primitive===0),'SYN_FINAL_DIRECT_HIERARCHY');
  const B=BigInt(payload.leaves.length)*120000n,retired=BigInt(payload.leaves.length)*45000n,rate=target>=16&&target<=21?400000n:200000n,feeAtoms=(B*rate+119999n)/120000n;
  check(feeAtoms<=maxFee,'SYN_FINAL_FEE_CAP');
  const business=nativeBusinessKey(abi,frame),outputId=instanceId(release.domain,business);
  return {frame:f,artifactBody:body,payload,target,artifactId,artifactSHA,artifactLength,generation,transcriptDigest,maxFee,maxRent,business,outputId,B,retired,feeAtoms,semantic:designId(graph),directCount:payload.direct.length,leafCount:payload.leaves.length};
}

/** Decoding never supplies execution provenance. FINAL has no actual-rent field. */
export async function decodeNativeSynthesisFinalizeResult(input){
  fields(input,['release','abi','frame','result','artifactBody','verification']);
  const {release,abi,frame,result,artifactBody,verification}=input,expected=decodeSynthesisFinalizeBody({release,abi,frame,artifactBody}),b=validateNativeResult(abi,frame,asBytes(result));
  check(b.length===156,'SYN_FINAL_RESULT_SIZE');
  const qualityPpm=BigInt(b.readUInt32LE(32)),B=b.readBigUInt64LE(36),retired=b.readBigUInt64LE(44),feeAtoms=b.readBigUInt64LE(52),modelDigest=Buffer.from(b.subarray(60,92)),semantic=Buffer.from(b.subarray(92,124));
  check(b.subarray(0,32).equals(expected.outputId)&&b.subarray(124,156).equals(expected.artifactId),'SYN_FINAL_RESULT_IDENTITY');
  check(B===expected.B&&retired===expected.retired&&feeAtoms===expected.feeAtoms&&modelDigest.equals(expected.transcriptDigest)&&semantic.equals(expected.semantic),'SYN_FINAL_RESULT_BINDING');
  check(qualityPpm>=500000n&&qualityPpm<=2000000n&&qualityPpm%1000n===0n&&(![3,9,14,15,21].includes(expected.target)||qualityPpm===1000000n),'SYN_FINAL_RESULT_QUALITY');
  if(verification!==undefined){
    check(verification?.source==='FINALIZED_PROGRAM_ACCOUNT'&&verification.actor===nativeKeyAddress(expected.frame.actor)&&verification.generation===expected.generation&&verification.phase===6&&verification.physicsRound===73&&verification.artifactId.equals(expected.artifactId)&&verification.artifactSHA.equals(expected.artifactSHA)&&verification.artifactLength===expected.artifactLength&&verification.target===expected.target&&verification.qualityPpm===qualityPpm&&verification.B===B&&verification.retired===retired&&verification.transcriptDigest.equals(modelDigest)&&verification.semantic.equals(semantic),'SYN_FINAL_VERIFICATION_MISMATCH');
  }
  const outputAddress=(await nativePda(release.input.programId,'bio','root',expected.outputId)).address;
  return {...flags,outputId:Buffer.from(expected.outputId),outputAddress,artifactId:Buffer.from(expected.artifactId),artifactSHA:Buffer.from(expected.artifactSHA),generation:expected.generation,target:expected.target,qualityPpm,B,retired,feeAtoms,modelDigest,semantic,maxFee:expected.maxFee,maxRent:expected.maxRent,rentSufficiencyVerified:false,verificationResultMatched:verification!==undefined,bytes:Buffer.from(b)};
}

/** Structured80-byte acknowledgement only. Physical results still come from
 * actual verification/native execution, never a self-asserted receipt. */
export function decodeNativeSynthesisVerificationResult(input){
  fields(input,['release','abi','frame','result','verification']);
  const {release,abi,frame,result,verification}=input;
  check(abi.hash===release.hashes.abiHash.toString('hex'),'SYN_VERIFY_RESULT_ABI');
  const f=decodeNativeFrame(abi,frame),p=f.payload;
  check(['VERIFY_BEGIN','VERIFY_STEP'].includes(f.operation)&&f.domain.equals(release.domain)&&f.configId.equals(baseConfigR2Id(release)),'SYN_VERIFY_RESULT_FRAME');
  const b=validateNativeResult(abi,frame,asBytes(result));
  check(b.length===80&&b.subarray(0,8).equals(Buffer.from('BIOVSR03'))&&zero(b.subarray(27,32))&&zero(b.subarray(75)),'SYN_VERIFY_RESULT_SCHEMA');
  const generation=b.readBigUInt64LE(8),workSequence=b.readUInt16LE(16),phase=b[18],target=b[19],qualityPpm=BigInt(b.readUInt32LE(20)),taskApplicable=b[24]===1,physicsRound=b.readUInt16LE(25),cost=b.readBigUInt64LE(32),transcriptDigest=Buffer.from(b.subarray(40,72)),lastFrom=b.readUInt16LE(72),lastCount=b[74];
  check(generation>0n&&workSequence<=1024&&phase<=6&&target>=1&&target<=22&&b[24]<=1&&physicsRound<=73&&(phase<5?physicsRound===0:phase===5?physicsRound<73:physicsRound===73),'SYN_VERIFY_RESULT_CURSOR');
  check(physicsRound===73?qualityPpm>=500000n&&qualityPpm<=2000000n&&qualityPpm%1000n===0n:qualityPpm===0n&&!taskApplicable&&cost===0n,'SYN_VERIFY_RESULT_EARLY');
  check(taskApplicable?target===22&&qualityPpm===2000000n&&cost>0n:cost===0n,'SYN_VERIFY_RESULT_TASK');
  if(f.operation==='VERIFY_BEGIN')check(generation===p.readBigUInt64LE(72)+1n&&workSequence===0&&phase===(target<=15?1:0)&&physicsRound===0&&lastFrom===65535&&lastCount===0,'SYN_VERIFY_RESULT_BEGIN');
  else check(generation===p.readBigUInt64LE(32)&&workSequence===p.readUInt16LE(40)+1&&lastFrom===p.readUInt16LE(40)&&lastCount===p[42],'SYN_VERIFY_RESULT_STEP');
  if(verification!==undefined)check(verification?.source==='FINALIZED_PROGRAM_ACCOUNT'&&verification.artifactId.equals(p.subarray(0,32))&&verification.generation===generation&&verification.workSequence===workSequence&&verification.phase===phase&&verification.target===target&&verification.physicsRound===physicsRound&&verification.qualityPpm===qualityPpm&&verification.taskApplicable===taskApplicable&&verification.cost===cost&&verification.transcriptDigest.equals(transcriptDigest),'SYN_VERIFY_RESULT_STATE');
  return {...flags,operation:f.operation,artifactId:Buffer.from(p.subarray(0,32)),generation,workSequence,phase,target,qualityPpm,taskApplicable,physicsRound,cost,transcriptDigest,lastFrom,lastCount,verificationResultMatched:verification!==undefined,bytes:Buffer.from(b)};
}
