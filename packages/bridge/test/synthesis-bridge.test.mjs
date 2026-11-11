import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encodeGraph} from '../../biology/src/graph.mjs';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {release,abi,actor,resources,pda,hostSynthesisFixture,hostArtifact,hostVerification,actualSynthesisFixture,attachHostK} from '../../client/test/synthesis-fixture.mjs';
import {nativeKeyBytes} from '../../client/src/native.mjs';

const publicResources={...resources,priorityFeeLamports:'0'};
const body=f=>({actor,graphHex:encodeGraph(f.args.graph).toString('hex'),directIdsHex:f.args.directIds.map(b=>b.toString('hex')),challengePpm:f.args.challengePpm,maxRent:f.args.maxRent.toString(),maxUploadRent:f.args.maxUploadRent.toString(),maxFee:f.args.maxFee.toString(),resources:publicResources});
async function withBridge(f,run){
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-synthesis-bridge-'));
  try{
    const make=()=>createOperatorBridge({release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:directory,allowLocalhost:true,fetchImpl:f.fetchImpl}),bridge=await make();
    await run({f,bridge,make,directory});assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts','getLatestBlockhash'].includes(c.method)));
  }finally{await rm(directory,{recursive:true,force:true});}
}
test('HOST synthesis bridge reads actual-shaped inputs, strips raw authority records and saves immutable public workflow without execution',async()=>withBridge(await hostSynthesisFixture(),async({f,bridge})=>{
  const read=await bridge.dispatch('synthesis-inputs',{actor,target:f.target,directIdsHex:body(f).directIdsHex});assert.equal(read.decision,'INPUTS_READ');assert.equal(read.allEligible,true);assert.equal(read.directInputs,undefined);assert.equal(read.plan,undefined);assert.equal(read.businessExecutionVerified,false);
  assert.equal(read.summary.inputs.length,4);assert.equal(read.summary.materialFeeAtoms,'800000');assert.doesNotThrow(()=>JSON.stringify(read));
  const saved=await bridge.dispatch('synthesis-plan',body(f));assert.equal(saved.decision,'WORKFLOW_SAVED');assert.equal(saved.intent,undefined);assert.equal(saved.workflow.predictsFinalNonce,false);assert.equal(saved.reservesOnChainNonce,false);assert.equal(saved.workflow.resources.priorityFeeLamports,'0');assert.equal(saved.plan,undefined);
  const again=await bridge.dispatch('synthesis-plan',body(f));assert.equal(again.workflow.workflowId,saved.workflow.workflowId);assert.equal(again.alreadySaved,true);
  const text=JSON.stringify(saved);assert.equal(text.includes('stateDirectory'),false);assert.equal(text.includes('payload702Hex'),false);assert.equal(text.includes('directory'),false);
}));
test('HOST bridge exact upload handoff requires explicit prepare then preserves original pending request on restart',async()=>withBridge(await hostSynthesisFixture(),async({f,bridge,make})=>{
  const saved=await bridge.dispatch('synthesis-plan',body(f)),request={actor,workflowId:saved.workflow.workflowId};
  const next=await bridge.dispatch('synthesis-next',request);assert.equal(next.decision,'ACTION');assert.equal(next.stage.kind,'UPLOAD');assert.equal(next.intent.operation,'ARTIFACT_PUT');assert.equal(next.businessExecutionVerified,false);
  const prepared=await bridge.dispatch('prepare',{actor,intent:next.intent});assert.equal(prepared.operation,'ARTIFACT_PUT');
  const pending=await bridge.dispatch('synthesis-next',request);assert.equal(pending.decision,'RECOVER_CURRENT_REQUEST');assert.equal(pending.intent,undefined);assert.equal(pending.recoveryNonce,next.intent.nonce);
  const restarted=await make();assert.equal((await restarted.dispatch('synthesis-next',request)).decision,'RECOVER_CURRENT_REQUEST');
}));
test('HOST bridge follows observed partial Artifact with unrelated nonce and uses actual prior generation for BEGIN',async()=>withBridge(await hostSynthesisFixture(),async({f,bridge})=>{
  const saved=await bridge.dispatch('synthesis-plan',body(f)),request={actor,workflowId:saved.workflow.workflowId};await hostArtifact(f,{written:1024,sequence:5n});
  const nonce=f.map.get(await pda('actor-nonce',nativeKeyBytes(actor)));nonce.data.writeBigUInt64LE(nonce.data.readBigUInt64LE(120)+3n,120);
  const upload=await bridge.dispatch('synthesis-next',request),p=Buffer.from(upload.intent.payloadHex,'hex');assert.equal(upload.stage.kind,'UPLOAD');assert.equal(p.readUInt32LE(46),1024);assert.equal(p.readBigUInt64LE(38),5n);
  await hostArtifact(f,{sealed:true});const prior=f.map.get(await pda('verify',nativeKeyBytes(actor))).data.readBigUInt64LE(380),begin=await bridge.dispatch('synthesis-next',request);assert.equal(begin.stage.kind,'BEGIN');assert.equal(Buffer.from(begin.intent.payloadHex,'hex').readBigUInt64LE(72),prior);
}));
test('HOST bridge persists exact bounded K lookup context and resumes the real ordinary FINAL without extra-field mismatch',async()=>withBridge(await hostSynthesisFixture({target:22}),async({f,bridge})=>{
  const saved=await bridge.dispatch('synthesis-plan',body(f)),request={actor,workflowId:saved.workflow.workflowId};await hostArtifact(f,{sealed:true});await hostVerification(f,{phase:6,round:73,quality:2000000,task:true,cost:f.originalOutput.data.readBigUInt64LE(719)});await attachHostK(f);
  const blocked=await bridge.dispatch('synthesis-next',request);assert.equal(blocked.decision,'K_POSITION_LOOKUP_REQUIRED');assert.equal(blocked.lookup.nextStart,'44');assert.equal(blocked.intent,undefined);
  const final=await bridge.dispatch('synthesis-next',request);assert.equal(final.decision,'ACTION');assert.equal(final.stage.kind,'FINAL');assert.equal(final.intent.operation,'SYNTH_FINALIZE');assert.equal(final.preview.feeAtoms,'12000000');
}));
test('synthesis bridge rejects runtime replacement, unknown fields, duplicate IDs, bad resources and foreign graph before fetching',async()=>{
  const f=await hostSynthesisFixture();await withBridge(f,async({bridge})=>{
    for(const mutation of [b=>b.endpoint='https://evil.invalid',b=>b.release={},b=>b.directory='/private/tmp/elsewhere',b=>b.nonce='0',b=>b.callerPASS=true,b=>b.directIdsHex[1]=b.directIdsHex[0],b=>b.directIdsHex[0]='00',b=>b.maxFee=1,b=>b.maxRent='01',b=>b.challengePpm=500001,b=>b.resources={...b.resources,heapSize:32769}]){
      const value=structuredClone(body(f));mutation(value);await assert.rejects(bridge.dispatch('synthesis-plan',value));assert.equal(f.calls.length,0);
    }
    await assert.rejects(bridge.dispatch('synthesis-plan',{...body(f),graphHex:encodeGraph({...f.args.graph,domain:Buffer.alloc(32,8)}).toString('hex')}));assert.equal(f.calls.length,0);
    for(const value of [{actor,workflowId:'AB'.repeat(32)},{actor,workflowId:'00'.repeat(32),resources:publicResources},{actor,workflowId:'00'.repeat(32),rpc:'https://evil.invalid'}]){await assert.rejects(bridge.dispatch('synthesis-next',value));assert.equal(f.calls.length,0);}
    await assert.rejects(bridge.dispatch('synthesis-inputs',{actor,target:'1',directIdsHex:body(f).directIdsHex}));assert.equal(f.calls.length,0);
  });
});
for(const target of [1,16,22])test(`actual Bank bridge target${target} plans exact FINAL and reports156-byte confirmation separately from actual Root`,async()=>withBridge(await actualSynthesisFixture(target),async({f,bridge,make})=>{
  const read=await bridge.dispatch('synthesis-inputs',{actor,target,directIdsHex:body(f).directIdsHex});assert.equal(read.allEligible,true);assert.equal(read.directInputs,undefined);
  const saved=await bridge.dispatch('synthesis-plan',body(f)),request={actor,workflowId:saved.workflow.workflowId},next=await bridge.dispatch('synthesis-next',request);assert.equal(next.decision,'ACTION');assert.equal(next.stage.kind,'FINAL');
  const prepared=await bridge.dispatch('prepare',{actor,intent:next.intent});assert.equal(prepared.frameHex,f.bank.frameHex);
  f.setPhase('after');const confirmed=await bridge.dispatch('synthesis-next',request);assert.equal(confirmed.decision,'OUTPUT_READ');assert.equal(confirmed.outputVerified,true);assert.equal(confirmed.exactRequestExecutionVerified,true);assert.equal(confirmed.receipt.bytes.length,312);assert.equal(confirmed.root.target,target);
  const restarted=await make(),same=await restarted.dispatch('synthesis-next',request);assert.equal(same.exactRequestExecutionVerified,true);assert.equal(same.root.instanceHex,confirmed.root.instanceHex);
}));
test('actual Bank bridge output lookup without original preparation never fabricates a confirmed old request',async()=>withBridge(await actualSynthesisFixture(1),async({f,bridge,make})=>{
  const saved=await bridge.dispatch('synthesis-plan',body(f)),request={actor,workflowId:saved.workflow.workflowId};
  f.setPhase('after');const actual=await bridge.dispatch('synthesis-next',request);assert.equal(actual.outputVerified,true);assert.equal(actual.exactRequestExecutionVerified,false);assert.equal(actual.receipt,null);assert.equal(actual.businessExecutionVerified,false);
  const restarted=await make();assert.equal((await restarted.dispatch('synthesis-next',request)).outputVerified,true);
  await assert.rejects(restarted.dispatch('synthesis-next',{actor:release.input.programId,workflowId:saved.workflow.workflowId}),/SYN_MANIFEST_NOT_FOUND/);
}));
