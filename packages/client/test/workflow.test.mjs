import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogHash,decodeMaterialPlan,sourceId,businessKey,instanceId } from '../../protocol-core/src/index.mjs';
import { clientFixture,key } from './native-fixture.mjs';
import { nativeKeyBytes,nativePda,nativeNonceOpId,decodeNativeFrame,nativeBusinessKey } from '../src/native.mjs';
import { planManufacturePartWorkflow,locatePartWorkflowStage } from '../src/workflow.mjs';
async function inventory(release,actor){
  const state={sources:new Map(),projects:new Map(),tokens:new Map()},owner=nativeKeyBytes(actor);
  for(let c=1;c<=4;c++){
    const projectId=Buffer.alloc(32,8-c),classes=[];
    for(let i=1;i<=4;i++)classes.push({mint:nativeKeyBytes((await nativePda(release.input.programId,'bio','pack',projectId,Buffer.from([i]))).address)});
    const token=Buffer.alloc(32,50+c);state.projects.set(projectId.toString('hex'),{catalogHash:catalogHash(),classes});
    state.tokens.set(token.toString('hex'),{owner,mint:classes[c-1].mint,amount:10n,initialized:true,native:false,frozen:false});
  }
  return state;
}
test('part workflow binds canonical material source IDs to final manufacture nonce after all upload/seal operations',async()=>{
  const {release,abi,actor}=await clientFixture(),state=await inventory(release,actor),before=structuredClone(state);
  const w=await planManufacturePartWorkflow({release,abi,actor,initialNonce:20n,inventory:state,descriptor:{primitive:4,profile:1},
    maxPartRent:100000000n,maxUploadRent:100000000n});
  const chunks=Math.ceil(w.artifactBody.length/1024);assert.equal(w.stages.length,chunks+2);assert.equal(w.manufactureNonce,20n+BigInt(chunks)+1n);
  const final=w.stages.at(-1),f=decodeNativeFrame(abi,final.frame);assert.equal(f.operation,'MANUFACTURE_PART');assert.equal(f.nonce,w.manufactureNonce);
  const expectedBusiness=businessKey(release.domain,nativeKeyBytes(actor),nativeNonceOpId(w.manufactureNonce));
  assert.deepEqual(w.business,expectedBusiness);assert.deepEqual(nativeBusinessKey(abi,final.frame),expectedBusiness);
  assert.deepEqual(w.outputId,instanceId(release.domain,expectedBusiness));
  assert.deepEqual(decodeMaterialPlan(w.artifactBody.subarray(44)),w.materialPlan);
  for(const [ordinal]of w.materialPlan.intakes.entries())assert.ok(w.materialPlan.debits.some(g=>g.sourceId.equals(sourceId(release.domain,expectedBusiness,ordinal))));
  const joined=Buffer.concat(w.stages.slice(0,chunks).map(s=>decodeNativeFrame(abi,s.frame).payload.subarray(52,-8)));
  assert.deepEqual(joined,w.artifactBody);assert.deepEqual(structuredClone(state),before);
  assert.equal(w.reservesOnChainNonce,false);assert.equal(w.productionAdmission,false);
  assert.equal(locatePartWorkflowStage(w,20n).decision,'PREPARE_EXACT_STAGE');
  assert.equal(locatePartWorkflowStage(w,21n).decision,'VERIFY_COMMITTED_PREFIX_AND_ARTIFACT');
  assert.equal(locatePartWorkflowStage(w,w.nextNonce).decision,'CHECK_MANUFACTURED_OUTPUT');
  assert.equal(locatePartWorkflowStage(w,w.nextNonce+1n).decision,'NONCE_WINDOW_CHANGED_REPLAN');
});
test('part workflow keeps a distinct native rent payer as one required dynamic signer and rejects nonce exhaustion',async()=>{
  const {release,abi,actor}=await clientFixture(),state=await inventory(release,actor),rentPayer=key(9);
  const w=await planManufacturePartWorkflow({release,abi,actor,initialNonce:0n,inventory:state,descriptor:{primitive:1,profile:0},rentPayer,
    maxPartRent:100000000n,maxUploadRent:100000000n});
  const last=w.stages.at(-1).instruction.accounts.at(-1);assert.equal(last.address,rentPayer);assert.equal(last.role,3);
  await assert.rejects(planManufacturePartWorkflow({release,abi,actor,initialNonce:(1n<<64n)-2n,inventory:state,descriptor:{primitive:1,profile:0},
    maxPartRent:1n,maxUploadRent:1n}),/NONCE_EXHAUSTED/);
});
