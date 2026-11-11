import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {encodeGraph} from '../../biology/src/graph.mjs';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {ResearchWorkflowStore} from '../../client/src/research-manifest.mjs';
import {nativeKeyBytes} from '../../client/src/native.mjs';
import {release,abi,actor,resources,hostArtifact,hostVerification,attachHostK} from '../../client/test/synthesis-fixture.mjs';
import {hostResearchFixture,researchCranker,researchRequestId,enterHostResearchManufacture,setHostResearchAuthorNonce} from '../../client/test/research-fixture.mjs';
import {researchCreateRequest,checkedResearchSaved,checkedResearchNext} from '../../../apps/player/dist/research-operations.js';
async function fixture(run){const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-private-bridge-')),f=await hostResearchFixture();
  try{const make=()=>createOperatorBridge({release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:directory,allowLocalhost:true,fetchImpl:f.fetchImpl}),bridge=await make(),info=bridge.publicConfig(),binding={releaseHash:info.releaseHash,abiHash:info.abiHash,domainHex:info.domainHex,configHex:info.configHex},namespace=createHash('sha256').update(JSON.stringify(binding)).digest('hex'),store=new ResearchWorkflowStore({directory:path.join(directory,namespace,nativeKeyBytes(actor).toString('hex'),'research')}),values={actor,cranker:researchCranker,graphHex:encodeGraph(f.graph).toString('hex'),directIdsHex:f.directIds.map(b=>b.toString('hex')),maxRent:f.args.maxRent.toString(),maxUploadRent:f.args.maxUploadRent.toString(),maxFee:f.args.maxFee.toString(),resources:JSON.stringify({...resources,priorityFeeLamports:'0'})},body=researchCreateRequest(values,researchRequestId);
    await run({f,bridge,make,store,body});assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts','getLatestBlockhash'].includes(c.method)));
  }finally{await rm(directory,{recursive:true,force:true});}}
test('HOST private HTTP→browser contract: idempotent confidential save, actual COMMIT gate, restart and explicit request recovery',async()=>fixture(async({f,bridge,make,store,body})=>{
  const saved=await bridge.dispatch('research-create',body),w=checkedResearchSaved(saved,body),m=await store.load({release,abi,author:actor,workflowId:w.workflowId}),q={actor,author:actor,workflowId:w.workflowId};
  assert.equal(saved.workflow.synthesis,undefined);assert.equal(saved.intent,undefined);assert.equal(JSON.stringify(saved).includes(m.salt.toString('hex')),false);
  const readCount=f.calls.length,retry=await(await make()).dispatch('research-create',body);assert.equal(retry.workflow.workflowId,w.workflowId);assert.equal(retry.alreadySaved,true);assert.equal(f.calls.length,readCount);
  const commit=await bridge.dispatch('research-next',q);assert.equal(checkedResearchNext(commit,q,w).plan.stage.kind,'COMMIT');assert.equal(JSON.stringify(commit).includes(m.baseManifest.plan.artifactId.toString('hex')),false);
  await bridge.dispatch('prepare',{actor,intent:commit.intent});const pending=await(await make()).dispatch('research-next',q);assert.equal(pending.decision,'RECOVER_CURRENT_REQUEST');assert.equal(checkedResearchNext(pending,q,w).plan,null);
  await enterHostResearchManufacture(f,m);const upload=await(await make()).dispatch('research-next',q);assert.equal(checkedResearchNext(upload,q,w).plan.stage.kind,'UPLOAD');assert.equal(JSON.stringify(upload).includes(m.salt.toString('hex')),false);
}));
test('HOST private HTTP→browser exact189 FINAL uses real-read branded closure and never asserts Winner qualification',async()=>fixture(async({f,bridge,store,body})=>{
  const saved=await bridge.dispatch('research-create',body),m=await store.load({release,abi,author:actor,workflowId:saved.workflow.workflowId});await enterHostResearchManufacture(f,m);await hostArtifact(f,{sequence:BigInt(m.workflow.chunkCount),sealed:true});await setHostResearchAuthorNonce(f,m.workflow.futureManufactureNonce);await hostVerification(f,{phase:6,round:73,generation:m.expectedGeneration+1n,quality:2000000,task:true,cost:f.originalOutput.data.readBigUInt64LE(719)});
  const q={actor,author:actor,workflowId:m.workflowId},insufficient=await bridge.dispatch('research-next',q);assert.equal(insufficient.decision,'LAB_BALANCE_INSUFFICIENT');assert.equal(checkedResearchNext(insufficient,q).plan,null);
  await attachHostK(f,{count:1n}); // Explicit HOST closure and source balance, no native reward claim.
  const final=await bridge.dispatch('research-next',q);assert.equal(final.decision,'ACTION');assert.equal(checkedResearchNext(final,q).plan.stage.kind,'FINAL');assert.equal(final.intent.payloadHex.length,378);assert.equal(final.preview.winnerGuaranteed,false);assert.equal(final.finalizationContext,undefined);assert.equal(final.action,undefined);
  assert.equal((await store.loadHints(m)).finalFrameHex.endsWith(m.salt.toString('hex')),true);
}));
test('private bridge rejects caller salts, nonces, paths and mutable runtime before reading any actual account',async()=>fixture(async({f,bridge,body})=>{
  for(const extra of [{salt:'00'.repeat(32)},{nonce:'0'},{expectedGeneration:'0'},{directory:'/private/tmp/else'},{endpoint:'https://evil.invalid'},{requestId:'AB'.repeat(32)},{requestId:'00'},{directIdsHex:Array(6).fill(body.directIdsHex[0])}])await assert.rejects(bridge.dispatch('research-create',{...body,...extra}));assert.equal(f.calls.length,0);
}));
