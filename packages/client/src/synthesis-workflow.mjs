import { ByteWriter,asBytes,sha256,typedHash,instanceId } from '../../protocol-core/src/index.mjs';
import { encodeGraph,validateGraph,members,assertChildUnchanged } from '../../biology/src/graph.mjs';
import { encodeSynthesisPayload,decodeSynthesisPayload,encodeLeafMap } from '../../composition/src/payload.mjs';
import { baseConfigR2Id,PROGRAMS } from './release.mjs';
import { decodeNativeAccountRecord,decodeNativeRoot } from './accounts.mjs';
import { planPrivateDesignCommit } from './competition.mjs';
import { nativeKeyBytes,nativeKeyAddress,nativePda,nativeBusinessKey,encodeNativeFrame,buildNativeInstruction,
  encodeArtifactPutPayload,encodeArtifactSealPayload,encodeVerifyBeginPayload,encodeVerifyStepPayload,encodeSynthFinalizePayload } from './native.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const zero=b=>b.every(v=>v===0),MAX=(1n<<64n)-1n;
const snapshots=new WeakSet();
const registrations=new WeakSet();
const delegatedWorkflows=new WeakSet(),competitionContexts=new WeakSet();
const family=Buffer.from([160,43,204,72,38,231,208,253,243,141,12,162,12,38,137,129,71,231,26,176,41,238,246,151,54,121,0,16,247,147,245,254]);
const u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'SYN_U64');return n;};
const capsule=d=>Buffer.concat([d.subarray(0,322),d.subarray(443)]);
const address=async(release,...s)=>(await nativePda(release.input.programId,...s)).address;
const artifactId=(release,actor,bytes)=>typedHash(19,new ByteWriter(134).raw(release.domain).raw(baseConfigR2Id(release)).raw(nativeKeyBytes(actor)).u16(702).u32(bytes.length).raw(sha256(bytes)).finish());
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;

/** Decoder only: program ownership/header/PDA and ordinary sealed SHA are
 * checked. A finalized RPC remains the transport trust boundary, not a proof
 * of honest RPC or authorization to manufacture anything. */
export async function decodeNativeSealedSynthesisArtifact(release,account,{expectedId}){
  const id=asBytes(expectedId,32),r=await decodeNativeAccountRecord(release,account,{kind:24,schemas:[1],seeds:['bio','artifact',id],recordKey:id,maxBodyBytes:262275});
  const b=r.body;check(b.length>=132&&b.subarray(0,32).equals(id)&&b.readUInt16LE(64)===702,'SYN_ARTIFACT_KIND');
  const owner=nativeKeyAddress(b.subarray(32,64)),total=b.readUInt32LE(66),hash=Buffer.from(b.subarray(70,102)),written=b.readUInt32LE(102),sequence=b.readBigUInt64LE(106),bytes=Buffer.from(b.subarray(131));
  check(total>0&&total<=262144&&written===total&&bytes.length===total&&sequence>0n&&b[114]===1&&b.readBigInt64LE(115)>=0n,'SYN_ARTIFACT_SEAL');
  check(sha256(bytes).equals(hash)&&artifactId(release,owner,bytes).equals(id),'SYN_ARTIFACT_SHA');
  return {id:Buffer.from(id),owner,hash,totalLength:total,sequence,bytes,payload:decodeSynthesisPayload(bytes),clientReadOnly:true};
}

/** Reads actual V4 account bytes; callers cannot supply q/PASS/cursors to the
 * step planner. Program-owned private physical/provenance state is not rerun
 * here. The chain still executes every mathematical check itself. */
export async function decodeNativeSynthesisVerification(release,account,{actor,artifactId:expectedId,artifactSHA,contextSlot,commitment='finalized'}){
  u64(contextSlot);check(commitment==='finalized','SYN_FINALIZED_REQUIRED');const owner=nativeKeyBytes(actor);
  const r=await decodeNativeAccountRecord(release,account,{kind:37,schemas:[3],seeds:['bio','verify',owner],recordKey:owner,maxBodyBytes:3976}),d=r.bytes;
  check(d.length===4096&&d.subarray(120,128).equals(Buffer.from('BIOVFY04'))&&d[210]<=1&&d[211]<=6&&zero(d.subarray(328,332))&&zero(d.subarray(2532)),'SYN_VERIFY_SCHEMA');
  check(d.subarray(364,372).equals(Buffer.from('BIOVFY02'))&&d.readUInt16LE(372)===2&&d.subarray(430,462).equals(owner)
    &&d.subarray(462,494).equals(baseConfigR2Id(release))&&d.subarray(494,526).equals(release.hashes.validatorHash)&&d.subarray(526,558).equals(d.subarray(212,244)),'SYN_VERIFY_CONTEXT');
  const generation=d.readBigUInt64LE(380),physicsRound=d.readUInt16LE(388),phase=d[211],workSequence=d.readUInt16LE(324),progress=d.readUInt16LE(326),quality=d.readUInt32LE(1564),task=d[1568],cost=d.readBigUInt64LE(1569),clock=d.readBigInt64LE(390);
  check(generation>0n&&clock>=0n&&physicsRound<=73&&workSequence<=1024&&progress<=7680&&task<=1&&d[374]===(physicsRound===73?2:1)
    &&(phase<5?physicsRound===0:phase===5?physicsRound<73:physicsRound===73)&&(!d[210]||phase===6),'SYN_VERIFY_CURSOR');
  check(d[375]>=1&&d[375]<=22&&(physicsRound===73?quality>=500000&&quality<=2000000&&quality%1000===0:quality===0&&task===0&&cost===0n),'SYN_VERIFY_EARLY_RESULT');
  check(!task||(d[375]===22&&quality===2000000&&cost>0n),'SYN_VERIFY_TASK');
  const id=Buffer.from(d.subarray(128,160)),hash=Buffer.from(d.subarray(160,192));
  if(expectedId!==undefined)check(id.equals(asBytes(expectedId,32)),'SYN_VERIFY_ARTIFACT');if(artifactSHA!==undefined)check(hash.equals(asBytes(artifactSHA,32)),'SYN_VERIFY_ARTIFACT');
  const value=Object.freeze({actor:nativeKeyAddress(owner),address:account.address,contextSlot,generation,phase,workSequence,progress,physicsRound,clock,target:d[375],challengePpm:d.readUInt32LE(376),domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex'),
    artifactId:id,artifactSHA:hash,artifactLength:d.readUInt32LE(192),graphSHA:Buffer.from(d.subarray(398,430)),semantic:Buffer.from(d.subarray(332,364)),
    directSHA:Buffer.from(d.subarray(212,244)),leafSHA:Buffer.from(d.subarray(244,276)),unionSHA:Buffer.from(d.subarray(276,308)),leafCount:d[208],directCount:d[209],B:d.readBigUInt64LE(308),retired:d.readBigUInt64LE(316),
    transcriptDigest:Buffer.from(d.subarray(928,960)),qualityPpm:BigInt(quality),taskApplicable:task===1,cost,used:d[210]===1,source:'FINALIZED_PROGRAM_ACCOUNT',clientExecutionVerified:false});
  snapshots.add(value);return value;
}

/** All Direct Roots are actual decoded accounts. Upper inputs bring their
 * original sealed702 Artifact, retaining the exact historical leaf capsules. */
export async function planSynthesisPayload({release,actor,graph,directInputs}){
  const owner=nativeKeyAddress(actor);validateGraph(graph,{domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash});
  const target=graph.target,expected=target<=15?[1,2,3,4]:target<=21?members(target):[16,17,18,19,20,21];check(Array.isArray(directInputs)&&directInputs.length===expected.length,'SYN_DIRECT_COUNT');
  const rows=[];for(const input of directInputs){const facts=await decodeNativeRoot(release,input.account,input.instance);check(facts.owner===owner&&facts.lifecycle===0,'SYN_DIRECT_OWNER_LIVE');rows.push({input,facts});}
  rows.sort((a,b)=>(target<=15?a.facts.descriptor[2]:a.facts.target)-(target<=15?b.facts.descriptor[2]:b.facts.target));
  const direct=[],leaves=[],capsules=[],parents=[];
  for(let n=0;n<rows.length;n++){
    const {input,facts}=rows[n],key=target<=15?facts.descriptor[2]:facts.target;check(key===expected[n]&&(target<=15?facts.schema===1:target<=21?facts.schema===2:facts.schema===3),'SYN_DIRECT_HIERARCHY');
    direct.push({scope:target<=15?target:key,primitive:target<=15?key:0,instance:facts.instance,expectedRevision:facts.revision,fingerprint:facts.fingerprint});
    if(target<=15){check(key!==4||facts.descriptor[3]===target,'SYN_SERVICE_PROFILE');leaves.push({role:target,primitive:key,descriptor:facts.descriptor,instance:facts.instance,fingerprint:facts.fingerprint});capsules.push(capsule(asBytes(input.account.data)));}
    else{
      const raw=asBytes(input.account.data),id=raw.subarray(443,475),art=await decodeNativeSealedSynthesisArtifact(release,input.originalArtifact,{expectedId:id});
      check(art.hash.equals(raw.subarray(475,507))&&art.totalLength===raw.readUInt32LE(507)&&sha256(encodeGraph(art.payload.graph)).equals(raw.subarray(511,543))
        &&sha256(encodeLeafMap(art.payload.leaves)).equals(raw.subarray(543,575))&&art.payload.graph.target===key,'SYN_PARENT_ARTIFACT_BINDING');
      assertChildUnchanged(graph,art.payload.graph);for(let j=0;j<art.payload.leaves.length;j++){leaves.push(art.payload.leaves[j]);capsules.push(art.payload.capsules[j]);}parents.push({instance:Buffer.from(facts.instance),rootAddress:input.account.address,artifactAddress:input.originalArtifact.address});
    }
  }
  const zipped=leaves.map((leaf,n)=>({leaf,bytes:capsules[n]})).sort((a,b)=>a.leaf.role-b.leaf.role||a.leaf.primitive-b.leaf.primitive);
  const payload={graph,direct,leaves:zipped.map(x=>x.leaf),capsules:zipped.map(x=>x.bytes)},bytes=encodeSynthesisPayload(payload);
  return {profile:'BIOP0R2-SYN-PLAN1',domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex'),actor:owner,target,payload:decodeSynthesisPayload(bytes),bytes,artifactId:artifactId(release,owner,bytes),artifactSHA:sha256(bytes),
    graphSHA:sha256(encodeGraph(graph)),directRoots:rows.map(x=>({instance:Buffer.from(x.facts.instance),address:x.input.account.address,revision:x.facts.revision,fingerprint:Buffer.from(x.facts.fingerprint),createdAt:x.facts.createdAt,createdSlot:x.facts.createdSlot})),parents,
    materialFeeAtoms:BigInt(leaves.length)*(target>=16&&target<=21?400000n:200000n),clientPlanOnly:true,productionAdmission:false};
}
async function action(release,abi,actor,nonce,operation,payload,suffix,dynamicAccounts=[]){
  check(u64(nonce)<MAX,'SYN_NONCE_EXHAUSTED');
  const frame=encodeNativeFrame(abi,{operation,domain:release.domain,configId:baseConfigR2Id(release),actor:nativeKeyBytes(actor),nonce:u64(nonce),payload});
  return {operation,nonce,frame,payload:Buffer.from(payload),suffix,dynamicAccounts,instruction:await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts}),clientPlanOnly:true};
}
async function common(release,plan){check(plan.domainHex===release.domain.toString('hex')&&plan.configHex===baseConfigR2Id(release).toString('hex'),'SYN_RELEASE_CONTEXT');return {artifact:await address(release,'bio','artifact',plan.artifactId),verification:await address(release,'bio','verify',nativeKeyBytes(plan.actor))};}
function bind(plan,state){check(snapshots.has(state)&&state.actor===plan.actor&&state.domainHex===plan.domainHex&&state.configHex===plan.configHex&&state.artifactId.equals(plan.artifactId)&&state.artifactSHA.equals(plan.artifactSHA)
  &&state.artifactLength===plan.bytes.length&&state.graphSHA.equals(plan.graphSHA),'SYN_FRESH_VERIFICATION_REQUIRED');check(!state.used,'SYN_VERIFICATION_USED');}

/** Ordinary mode only: upload is public. Competition must COMMIT with the
 * caller-fixed future manufacture nonce and salt BEFORE invoking this plan. */
export async function planSynthesisPreparation({release,abi,plan,initialNonce,expectedGeneration,challengePpm,maxRent,maxUploadRent}){
  const {artifact,verification}=await common(release,plan),stages=[];let nonce=u64(initialNonce);const chunks=Math.ceil(plan.bytes.length/1024);
  check(nonce+BigInt(chunks)+2n<MAX,'SYN_NONCE_EXHAUSTED');
  for(let i=0;i<chunks;i++)stages.push(await action(release,abi,plan.actor,nonce++,'ARTIFACT_PUT',encodeArtifactPutPayload({kind:702,totalLength:plan.bytes.length,artifactSHA:plan.artifactSHA,expectedSequence:BigInt(i),offset:i*1024,chunk:plan.bytes.subarray(i*1024,(i+1)*1024),maxRent:maxUploadRent}),[{name:'Artifact',address:artifact}]));
  stages.push(await action(release,abi,plan.actor,nonce++,'ARTIFACT_SEAL',encodeArtifactSealPayload({kind:702,artifactId:plan.artifactId,expectedSequence:BigInt(chunks),maxRent:maxUploadRent}),[{name:'Artifact',address:artifact}]));
  check(![3,9,14,15,21].includes(plan.target)||challengePpm===2000000,'SYN_HARD_CHALLENGE');
  stages.push(await action(release,abi,plan.actor,nonce++,'VERIFY_BEGIN',encodeVerifyBeginPayload({artifactId:plan.artifactId,artifactSHA:plan.artifactSHA,artifactLength:plan.bytes.length,challengePpm,expectedGeneration,maxRent}),[{name:'Artifact',address:artifact},{name:'Verification',address:verification}],plan.directRoots.map(r=>({address:r.address,writable:false,signer:false}))));
  return {stages,nextNonce:nonce,requiresActualVerificationRead:true,predictsFinalNonce:false,clientPlanOnly:true};
}

/** Plans exactly one next on-chain step, never fabricated physical state or
 * an assumed number of provenance calls. Anyone may crank the original PDA. */
export async function planNextSynthesisStep({release,abi,plan,verification,actor=plan.actor,nonce,maxRent}){
  bind(plan,verification);check(verification.phase<6,'SYN_ALREADY_COMPLETE');const keys=await common(release,plan),dynamic=[];
  if(verification.phase===0){check(verification.progress<plan.payload.direct.length,'SYN_INHERIT_CURSOR');const row=plan.payload.direct[verification.progress],parent=plan.parents.find(p=>p.instance.equals(row.instance));check(parent,'SYN_PARENT_ARTIFACT_REQUIRED');dynamic.push({address:parent.rootAddress,writable:false,signer:false},{address:parent.artifactAddress,writable:false,signer:false});}
  const count=verification.phase===5?Math.min(2,73-verification.physicsRound):1;
  return action(release,abi,actor,nonce,'VERIFY_STEP',encodeVerifyStepPayload({artifactId:plan.artifactId,expectedGeneration:verification.generation,expectedWorkSequence:verification.workSequence,count,previousDigest:verification.transcriptDigest,maxRent}),[{name:'Artifact',address:keys.artifact},{name:'Verification',address:keys.verification}],dynamic);
}

/** Derive ordinary Disclosure/Knowledge and the exact optional prior-K stop
 * tail from actual Task/K records. This never grants a client-created reward. */
export async function planSynthesisRegistration({release,verification,clockAccount,taskAccount,kSlotAccount,priorActivation=null}){
  check(snapshots.has(verification)&&verification.phase===6&&!verification.used,'SYN_COMPLETE_STATE_REQUIRED');
  check(verification.domainHex===release.domain.toString('hex')&&verification.configHex===baseConfigR2Id(release).toString('hex'),'SYN_RELEASE_CONTEXT');
  check(clockAccount?.address===PROGRAMS.clockSysvar&&clockAccount.owner==='Sysvar1111111111111111111111111111111111111'&&!clockAccount.executable&&asBytes(clockAccount.data).length===40,'SYN_CLOCK_ACCOUNT');
  const now=asBytes(clockAccount.data).readBigInt64LE(32),reward=BigInt(release.input.rewardStart);check(now>=reward&&now>=verification.clock,'SYN_CLOCK_RANGE');
  check(taskAccount!==undefined,'SYN_TASK_OBSERVATION_REQUIRED');const round=(now-reward)/259200n,taskAddress=await address(release,'bio','task',family);if(taskAccount!==null)check(taskAccount.address===taskAddress,'SYN_TASK_PDA');let count=0n,best=null,generation=0n;
  if(!fresh(taskAccount)){const t=await decodeNativeAccountRecord(release,taskAccount,{kind:30,schemas:[1],seeds:['bio','task',family],recordKey:family,maxBodyBytes:135}),b=t.body;check(b.length===135&&b.subarray(0,32).equals(family)&&b.readUInt32LE(32)===1&&b[60]<=1,'SYN_TASK');count=b.readBigUInt64LE(44);generation=b.readBigUInt64LE(109);best=b[60]?b.readBigUInt64LE(61):null;}
  const did=typedHash(8,Buffer.concat([release.domain,verification.semantic]));
  const tail=[{address:taskAddress,writable:true,signer:false},{address:await address(release,'bio','round',family,new ByteWriter(4).u32(1).finish(),new ByteWriter(8).u64(round).finish()),writable:true,signer:false},{address:await address(release,'bio','disclosure',did),writable:true,signer:false}];
  if(verification.taskApplicable){
    check(kSlotAccount!==undefined,'SYN_K_SLOT_OBSERVATION_REQUIRED');
    if(kSlotAccount!==null)check(kSlotAccount.address===await address(release,'bio','k-slot',family),'SYN_K_SLOT_PDA');
    check(verification.qualityPpm===2000000n&&verification.cost>0n,'SYN_TASK_RESULT');tail.push({address:await address(release,'bio','knowledge',family,new ByteWriter(8).u64(count).finish()),writable:true,signer:false},{address:await address(release,'bio','k-slot',family),writable:true,signer:false});
    if(!fresh(kSlotAccount)){
      const s=await decodeNativeAccountRecord(release,kSlotAccount,{kind:34,schemas:[1],seeds:['bio','k-slot',family],recordKey:family,maxBodyBytes:74}),b=s.body;check(b.length===74&&b.subarray(0,32).equals(family)&&b.readBigUInt64LE(32)===generation&&b[40]<=1&&b[73]<=4&&((b[40]===0)===(b[73]===0)),'SYN_K_SLOT');
      if(b[40]){
        check(priorActivation?.activation&&priorActivation.rootReg&&priorActivation.ordinaryPosition&&priorActivation.root,'SYN_K_STOP_INPUTS_REQUIRED');const id=b.subarray(41,73),a=priorActivation;
        const ar=await decodeNativeAccountRecord(release,a.activation,{kind:17,schemas:[1],seeds:['bio','activation',id],recordKey:id,maxBodyBytes:251}),ab=ar.body;check(ab.length===251&&ab.subarray(0,32).equals(family)&&ab[192]<=1,'SYN_K_ACTIVATION');
        const derived=typedHash(11,Buffer.concat([release.domain,family,ab.subarray(32,64),ab.subarray(168,176)]));check(derived.equals(id),'SYN_K_ACTIVATION_ID');const instance=ab.subarray(64,96);await decodeNativeRoot(release,a.root,instance);
        const rr=await decodeNativeAccountRecord(release,a.rootReg,{kind:25,schemas:[1],seeds:['bio','root-reg',instance],recordKey:instance,maxBodyBytes:260});check(rr.body.length===260&&rr.body.subarray(97,129).equals(id),'SYN_K_ROOT_REG');
        const raw=asBytes(a.ordinaryPosition.data);check(raw.length===375,'SYN_K_POSITION');const seq=raw.subarray(152,160),pid=typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(27).finish(),instance,seq]));
        await decodeNativeAccountRecord(release,a.ordinaryPosition,{kind:27,schemas:[2],seeds:['bio','reg',instance,seq],recordKey:pid,maxBodyBytes:255});check(pid.equals(ab.subarray(128,160)),'SYN_K_POSITION');
        tail.push({address:a.activation.address,writable:true,signer:false},{address:a.rootReg.address,writable:true,signer:false},{address:a.ordinaryPosition.address,writable:false,signer:false},{address:a.root.address,writable:false,signer:false});
        if((best===null||verification.cost<best)&&ab[192]===0){
          const reg=await decodeNativeAccountRecord(release,a.registry,{kind:26,schemas:[2],seeds:['bio','mining'],recordKey:baseConfigR2Id(release),maxBodyBytes:256});check(reg.body.length===256,'SYN_K_REGISTRY');tail.push({address:await address(release,'bio','mining-event',reg.body.subarray(40,48)),writable:true,signer:false});
        }
      }else check(zero(b.subarray(41,73)),'SYN_K_SLOT');
    }
  }
  const out=Object.freeze({tail,semanticHex:verification.semantic.toString('hex'),generation:verification.generation,artifactHex:verification.artifactId.toString('hex'),round,clock:now,clockSlot:asBytes(clockAccount.data).readBigUInt64LE(0),source:'PROGRAM_ACCOUNTS',clientPlanOnly:true});registrations.add(out);return out;
}

/** Final mode0 construction needs a freshly decoded completed session and
 * fresh current Root snapshots. Actual coverage/fees/Task/K are rechecked on
 * chain; no client q/PASS grants eligibility. Tail accounts are explicit. */
export async function planSynthesisFinalization({release,abi,plan,verification,nonce,maxRent,maxFee,labSource,registration,freshDirectInputs,competition=null}){
  bind(plan,verification);check(verification.phase===6&&verification.physicsRound===73,'SYN_INCOMPLETE');check(u64(maxFee)>=plan.materialFeeAtoms,'SYN_FEE_CAP');
  const freshPlan=await planSynthesisPayload({release,actor:plan.actor,graph:plan.payload.graph,directInputs:freshDirectInputs});check(freshPlan.bytes.equals(plan.bytes),'SYN_DIRECT_CHANGED');
  check(registrations.has(registration)&&registration.generation===verification.generation&&registration.semanticHex===verification.semantic.toString('hex')&&registration.artifactHex===verification.artifactId.toString('hex'),'SYN_FRESH_REGISTRATION_REQUIRED');
  const reward=BigInt(release.input.rewardStart),boundary=(registration.clock-reward)/3600n;
  for(const input of freshDirectInputs){
    check(Object.hasOwn(input,'rootReg'),'SYN_COVERAGE_OBSERVATION_REQUIRED');const id=asBytes(input.instance,32);if(input.rootReg!==null)check(input.rootReg?.address===await address(release,'bio','root-reg',id),'SYN_ROOT_REG_PDA');if(fresh(input.rootReg))continue;
    const r=await decodeNativeAccountRecord(release,input.rootReg,{kind:25,schemas:[1],seeds:['bio','root-reg',id],recordKey:id,maxBodyBytes:260}),b=r.body;
    check(b.length===260&&b[203]===0&&b[80]===1&&b[129]===1&&boundary>=b.readBigUInt64LE(81)&&boundary>=b.readBigUInt64LE(130)
      &&b.readBigUInt64LE(138)===b.readBigUInt64LE(40)&&b.readBigUInt64LE(146)===MAX,'SYN_INPUT_COVERAGE_REQUIRED');
  }
  for(const root of freshPlan.directRoots)check(registration.clock>=root.createdAt&&registration.clockSlot>=root.createdSlot,'SYN_ROOT_CLOCK');
  check(competition===null||competitionContexts.has(competition),'SYN_COMPETITION_CONTEXT');
  const keys=await common(release,plan),payload=encodeSynthFinalizePayload({artifactId:plan.artifactId,artifactSHA:plan.artifactSHA,artifactLength:plan.bytes.length,expectedGeneration:verification.generation,transcriptSHA:verification.transcriptDigest,maxFee,maxRent,...(competition?{competition:{commitId:competition.commitId,salt:competition.salt}}:{})});
  const preliminary=encodeNativeFrame(abi,{operation:'SYNTH_FINALIZE',domain:release.domain,configId:baseConfigR2Id(release),actor:nativeKeyBytes(plan.actor),nonce,payload}),output=instanceId(release.domain,nativeBusinessKey(abi,preliminary));
  const suffix=[{name:'Artifact',address:keys.artifact},{name:'Verification',address:keys.verification},{name:'NewRoot',address:await address(release,'bio','root',output)},
    {name:'LABMint',address:await address(release,'bio','lab-mint')},{name:'LABSource',address:nativeKeyAddress(labSource)},{name:'Treasury',address:await address(release,'bio','treasury')},
    {name:'LABReserve',address:await address(release,'bio','lab-reserve')},{name:'Registry',address:await address(release,'bio','mining')}];
  const dynamic=plan.directRoots.map(r=>({address:r.address,writable:true,signer:false}));for(const row of plan.directRoots)dynamic.push({address:await address(release,'bio','root-reg',row.instance),writable:true,signer:false});dynamic.push(...registration.tail);
  if(competition)dynamic.push(...competition.tail);
  return {...await action(release,abi,plan.actor,nonce,'SYNTH_FINALIZE',payload,suffix,dynamic),outputId:output,requiresFreshCoverageAndTaskState:true};
}

/** Private local composition: author COMMIT at n, C PUTs at n+1..n+C,
 * SEAL n+C+1, BEGIN n+C+2, then author FINAL n+C+3. Every variable-length
 * STEP uses a distinct cranker and its own unrelated nonce stream. No graph,
 * salt or material is broadcast by planning this object. */
export async function planDelegatedSynthesisCompetition({release,abi,plan,cranker,commitNonce,round,salt,expectedGeneration,challengePpm=2000000,maxRent,maxUploadRent}){
  await common(release,plan);check(plan.target===22,'SYN_COMPETITION_BIO_ONLY');const crank=nativeKeyAddress(cranker);check(crank!==plan.actor,'SYN_DISTINCT_CRANKER_REQUIRED');u64(commitNonce);
  const chunkCount=Math.ceil(plan.bytes.length/1024),futureManufactureNonce=commitNonce+BigInt(chunkCount)+3n;check(futureManufactureNonce<MAX,'SYN_NONCE_EXHAUSTED');
  const commit=await planPrivateDesignCommit({release,abi,author:plan.actor,commitNonce,futureManufactureNonce,round,graph:plan.payload.graph,salt,maxRent});
  const preparation=await planSynthesisPreparation({release,abi,plan,initialNonce:commitNonce+1n,expectedGeneration,challengePpm,maxRent,maxUploadRent});check(preparation.nextNonce===futureManufactureNonce,'SYN_AUTHOR_NONCE_ACCOUNTING');
  const workflow=Object.freeze({profile:'BIOCLIENT-DELEGATED-SYN1',author:plan.actor,cranker:crank,commitNonce,round,chunkCount,futureManufactureNonce,commit,preparation,plan,
    requiresCommitConfirmationBeforeUpload:true,requiresExclusiveAuthorNonceWindow:true,authorNonceReserved:false,stepCountPredicted:false,privateSaltRetainedByCaller:true,
    requiredOrder:['CONFIRM_COMMIT','AUTHOR_UPLOAD_SEAL_BEGIN','CRANKER_STEPS_UNTIL_ACTUAL_COMPLETE','AUTHOR_FINAL_IN_MANUFACTURE_WINDOW'],clientPlanOnly:true});
  delegatedWorkflows.add(workflow);return workflow;
}
export async function planDelegatedSynthesisStep({release,abi,workflow,verification,crankerNonce,maxRent}){
  check(delegatedWorkflows.has(workflow),'SYN_DELEGATED_WORKFLOW');
  return planNextSynthesisStep({release,abi,plan:workflow.plan,verification,actor:workflow.cranker,nonce:crankerNonce,maxRent});
}
async function confirmedDelegatedCommit(release,workflow,commitAccount){
  const id=workflow.commit.commitId,r=await decodeNativeAccountRecord(release,commitAccount,{kind:31,schemas:[1],seeds:['bio','commit',id],recordKey:id,maxBodyBytes:207}),b=r.body;
  check(b.length===207&&b.subarray(0,32).equals(family)&&b.readUInt32LE(32)===1&&b.readBigUInt64LE(36)===workflow.round
    &&b.subarray(44,76).equals(nativeKeyBytes(workflow.author))&&b.subarray(76,108).equals(workflow.commit.commitment)&&b.subarray(108,140).equals(id)
    &&b.readBigUInt64LE(140)>0n&&b[164]===0&&zero(b.subarray(165,207)),'SYN_COMMIT_NOT_CONFIRMED_OR_USED');return b;
}
/** Caller reads the actual confirmed commitment before exposing upload bytes.
 * An author's unrelated action changes this nonce window and must abort/replan;
 * it is never repaired with filler operations or by replacing the author. */
export async function resumeDelegatedSynthesisPreparation({release,workflow,commitAccount,authorNextNonce}){
  check(delegatedWorkflows.has(workflow),'SYN_DELEGATED_WORKFLOW');check(u64(authorNextNonce)===workflow.commitNonce+1n,'SYN_AUTHOR_NONCE_CHANGED');await confirmedDelegatedCommit(release,workflow,commitAccount);return workflow.preparation;
}
export async function planDelegatedSynthesisFinalization({release,abi,workflow,verification,authorNextNonce,salt,commitAccount,roundAccount,snapshotAccount,maxRent,maxFee,labSource,registration,freshDirectInputs}){
  check(delegatedWorkflows.has(workflow),'SYN_DELEGATED_WORKFLOW');check(u64(authorNextNonce)===workflow.futureManufactureNonce,'SYN_AUTHOR_NONCE_CHANGED');bind(workflow.plan,verification);
  check(verification.phase===6&&verification.taskApplicable&&verification.qualityPpm===2000000n&&verification.cost>0n,'SYN_COMPETITION_RESULT');
  check(verification.semantic.equals(workflow.commit.design),'SYN_COMMITTED_DESIGN_CHANGED');
  const repeated=await planPrivateDesignCommit({release,abi,author:workflow.author,commitNonce:workflow.commitNonce,futureManufactureNonce:workflow.futureManufactureNonce,round:workflow.round,graph:workflow.plan.payload.graph,salt,maxRent});
  check(repeated.commitment.equals(workflow.commit.commitment),'SYN_COMMITMENT_CHANGED');const commit=await confirmedDelegatedCommit(release,workflow,commitAccount);
  const n=new ByteWriter(8).u64(workflow.round).finish(),v=new ByteWriter(4).u32(1).finish(),rid=typedHash(9,Buffer.concat([release.domain,family,v,n]));
  const r=await decodeNativeAccountRecord(release,roundAccount,{kind:15,schemas:[2],seeds:['bio','round',family,v,n],recordKey:rid,maxBodyBytes:389}),b=r.body;
  check(b.length===389&&b.subarray(0,32).equals(family)&&b.readUInt32LE(32)===1&&b.readBigUInt64LE(36)===workflow.round&&b[117]!==4,'SYN_COMPETITION_ROUND');
  check(registrations.has(registration)&&registration.round===workflow.round,'SYN_COMPETITION_WINDOW');const start=BigInt(release.input.rewardStart)+workflow.round*259200n,now=registration.clock;
  check(now>=start+86400n&&now<start+172800n&&commit.readBigInt64LE(156)>=start&&commit.readBigInt64LE(156)<start+86400n,'SYN_COMPETITION_WINDOW');
  const raw=asBytes(snapshotAccount?.data),body=raw.subarray(120);check(body.length===176,'SYN_COMPETITION_SNAPSHOT');const sid=typedHash(15,Buffer.concat([Buffer.from([3]),release.domain,body]));
  await decodeNativeAccountRecord(release,snapshotAccount,{kind:5,schemas:[1],seeds:['bio','seed-final',family],recordKey:sid,maxBodyBytes:176});
  check(body.subarray(0,32).equals(family)&&body.subarray(32,64).equals(Buffer.from(release.input.initialSeedSetId,'hex'))&&body.readBigInt64LE(64)===BigInt(release.input.rewardStart),'SYN_COMPETITION_SNAPSHOT');
  const index=b.subarray(109,117),competition={commitId:Buffer.from(workflow.commit.commitId),salt:Buffer.from(asBytes(salt,32)),tail:[
    {address:snapshotAccount.address,writable:false,signer:false},{address:commitAccount.address,writable:true,signer:false},{address:await address(release,'bio','candidate',rid,index),writable:true,signer:false}]};competitionContexts.add(competition);
  return planSynthesisFinalization({release,abi,plan:workflow.plan,verification,nonce:authorNextNonce,competition,maxRent,maxFee,labSource,registration,freshDirectInputs});
}
