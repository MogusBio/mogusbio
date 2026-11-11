import { ByteWriter, encodeMaterialPlan, decodeMaterialPlan, businessKey, sourceId, instanceId, sha256, typedHash } from '../../protocol-core/src/index.mjs';
import { descriptorBytes } from '../../composition/src/payload.mjs';
import { planComponentMaterials } from './material-plan.mjs';
import { baseConfigR2Id } from './release.mjs';
import { nativeKeyBytes,nativeKeyAddress,nativeNonceOpId,nativePda,encodeNativeFrame,buildNativeInstruction,
  encodeArtifactPutPayload,encodeArtifactSealPayload,encodeManufacturePartPayload } from './native.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const bytesKey=b=>Buffer.from(b).toString('hex');
const sortedUnique=values=>[...new Set(values.map(bytesKey))].sort().map(h=>Buffer.from(h,'hex'));

/** Plans one serialized upload/seal/manufacture window. This reserves no chain
 * nonce or material. A changed actor nonce requires explicit re-planning. */
export async function planManufacturePartWorkflow({release,abi,actor,initialNonce,inventory,descriptor,rentPayer=actor,maxPartRent,maxUploadRent}){
  check(typeof initialNonce==='bigint'&&initialNonce>=0n&&initialNonce<(1n<<64n),'WORKFLOW_NONCE');
  const owner=nativeKeyBytes(actor),payer=nativeKeyBytes(rentPayer),domain=release.domain,configId=baseConfigR2Id(release);
  const encodedDescriptor=descriptorBytes(descriptor);
  const makePayload=nonce=>{
    const business=businessKey(domain,owner,nativeNonceOpId(nonce)),plan=planComponentMaterials(inventory,{domain,business,owner});
    const body=new ByteWriter(3116).raw(encodedDescriptor).raw(payer).u64(maxPartRent).raw(encodeMaterialPlan(plan)).finish();
    return {business,plan,body};
  };
  const tentative=makePayload(initialNonce),chunks=Math.ceil(tentative.body.length/1024);
  const manufactureNonce=initialNonce+BigInt(chunks)+1n;
  check(manufactureNonce<(1n<<64n)-1n,'WORKFLOW_NONCE_EXHAUSTED');
  const final=makePayload(manufactureNonce);
  check(final.body.length===tentative.body.length,'WORKFLOW_NONCE_SIZE_CHANGED');
  return compileManufacturePartWorkflow({release,abi,actor,initialNonce,materialPlan:final.plan,descriptor,rentPayer,maxPartRent,maxUploadRent});
}

/** Rebuild an immutable previously selected plan. This never selects inventory,
 * renumbers Sources, reserves a nonce, or treats compilation as execution. */
export async function compileManufacturePartWorkflow({release,abi,actor,initialNonce,materialPlan,descriptor,rentPayer=actor,maxPartRent,maxUploadRent}){
  for(const value of [initialNonce,maxPartRent,maxUploadRent])check(typeof value==='bigint'&&value>=0n&&value<(1n<<64n),'WORKFLOW_U64');
  const owner=nativeKeyBytes(actor),payer=nativeKeyBytes(rentPayer),domain=release.domain,configId=baseConfigR2Id(release);
  const plan=decodeMaterialPlan(encodeMaterialPlan(materialPlan));
  const body=new ByteWriter(3116).raw(descriptorBytes(descriptor)).raw(payer).u64(maxPartRent).raw(encodeMaterialPlan(plan)).finish();
  const chunks=Math.ceil(body.length/1024),manufactureNonce=initialNonce+BigInt(chunks)+1n;
  check(manufactureNonce<(1n<<64n)-1n,'WORKFLOW_NONCE_EXHAUSTED');
  const final={plan,body,business:businessKey(domain,owner,nativeNonceOpId(manufactureNonce))};
  const artifactSHA=sha256(final.body),artifactId=typedHash(19,new ByteWriter(134).raw(domain).raw(configId).raw(owner)
    .u16(501).u32(final.body.length).raw(artifactSHA).finish());
  const program=release.input.programId,artifact=await nativePda(program,'bio','artifact',artifactId);
  const outputId=instanceId(domain,final.business),output=await nativePda(program,'bio','root',outputId);
  const frame=(operation,nonce,payload)=>encodeNativeFrame(abi,{operation,domain,configId,actor:owner,nonce,payload});
  const stages=[];
  for(let i=0;i<chunks;i++){
    const payload=encodeArtifactPutPayload({kind:501,totalLength:final.body.length,artifactSHA,expectedSequence:BigInt(i),
      offset:i*1024,chunk:final.body.subarray(i*1024,(i+1)*1024),maxRent:maxUploadRent});
    const data=frame('ARTIFACT_PUT',initialNonce+BigInt(i),payload);
    const suffix=[{name:'Artifact',address:artifact.address}];
    stages.push({kind:'UPLOAD',operation:'ARTIFACT_PUT',payload,suffix,dynamicAccounts:[],clientPlanOnly:true,nonce:initialNonce+BigInt(i),frame:data,instruction:await buildNativeInstruction({release,abi,frame:data,suffix})});
  }
  const sealPayload=encodeArtifactSealPayload({kind:501,artifactId,expectedSequence:BigInt(chunks),maxRent:maxUploadRent}),sealSuffix=[{name:'Artifact',address:artifact.address}];
  const seal=frame('ARTIFACT_SEAL',manufactureNonce-1n,sealPayload);
  stages.push({kind:'SEAL',operation:'ARTIFACT_SEAL',payload:sealPayload,suffix:sealSuffix,dynamicAccounts:[],clientPlanOnly:true,nonce:manufactureNonce-1n,frame:seal,instruction:await buildNativeInstruction({release,abi,frame:seal,suffix:sealSuffix})});
  const dynamic=[];
  const append=async(seed,values,writable=true)=>dynamic.push({address:(await nativePda(program,'bio',seed,...values)).address,writable,signer:false});
  for(const project of sortedUnique(final.plan.intakes.map(i=>i.projectId)))await append('project',[project]);
  const pairs=sortedUnique(final.plan.intakes.map(i=>Buffer.concat([i.projectId,Buffer.from([i.class])])));
  for(const pair of pairs)await append('pack',[pair.subarray(0,32),pair.subarray(32)]);
  for(const intake of final.plan.intakes)dynamic.push({address:nativeKeyAddress(intake.sourceTokenAccount),writable:true,signer:false});
  const sourceIds=sortedUnique(final.plan.debits.map(d=>d.sourceId).concat(final.plan.intakes.map((_,i)=>sourceId(domain,final.business,i))));
  for(const id of sourceIds)await append('source',[id]);
  if(!payer.equals(owner))dynamic.push({address:nativeKeyAddress(payer),writable:true,signer:true});
  const manufacturePayload=encodeManufacturePartPayload({artifactId,artifactSHA,artifactLength:final.body.length,maxRent:maxPartRent}),manufactureSuffix=[{name:'Artifact',address:artifact.address},{name:'NewRoot',address:output.address}];
  const manufacture=frame('MANUFACTURE_PART',manufactureNonce,manufacturePayload);
  stages.push({kind:'MANUFACTURE',operation:'MANUFACTURE_PART',payload:manufacturePayload,suffix:manufactureSuffix,dynamicAccounts:dynamic,clientPlanOnly:true,nonce:manufactureNonce,frame:manufacture,instruction:await buildNativeInstruction({release,abi,frame:manufacture,suffix:manufactureSuffix,dynamicAccounts:dynamic})});
  return {profile:'BIOP0R2-PART-WORKFLOW1',initialNonce,manufactureNonce,nextNonce:manufactureNonce+1n,
    materialPlan:final.plan,artifactId,artifactSHA,artifactBody:final.body,outputId,outputAddress:output.address,
    business:final.business,stages,requiresExclusiveActorWorkflow:true,reservesOnChainNonce:false,productionAdmission:false};
}

/** Resume decisions consume authoritative finalized nonce facts from the RPC
 * layer. They never renumber material source IDs inside an immutable Artifact. */
export function locatePartWorkflowStage(workflow,nextNonce){
  check(typeof nextNonce==='bigint','WORKFLOW_NONCE');
  const stage=workflow.stages.find(s=>s.nonce===nextNonce);
  if(stage)return {decision:nextNonce===workflow.initialNonce?'PREPARE_EXACT_STAGE':'VERIFY_COMMITTED_PREFIX_AND_ARTIFACT',stage};
  if(nextNonce===workflow.nextNonce)return {decision:'CHECK_MANUFACTURED_OUTPUT',outputId:Buffer.from(workflow.outputId)};
  return {decision:'NONCE_WINDOW_CHANGED_REPLAN',materialConsumedByPlanner:false};
}
