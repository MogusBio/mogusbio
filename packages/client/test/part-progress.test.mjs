import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readMaterialInventory} from '../src/material-inventory.mjs';
import {planManufacturePartWorkflow,compileManufacturePartWorkflow} from '../src/workflow.mjs';
import {createPartManifest,restorePartManifest,publicPartWorkflow,PartWorkflowStore} from '../src/part-manifest.mjs';
import {savePartManufactureWorkflow,readPartManufactureProgress} from '../src/part-progress.mjs';
import {NativePlayerSession} from '../src/session.mjs';
import {FileJournalStore} from '../src/file-journal.mjs';
import {nativeActionIntent} from '../src/player-settlement.mjs';
import {decodeNativeFrame} from '../src/native.mjs';
import {abi,release,actor,bank,resources,projectId,partFixture} from './part-fixture.mjs';
const args=f=>({release,abi,actor,rpc:f.rpc,projectIds:[projectId],sourceIds:[],descriptor:{primitive:1,profile:0},maxPartRent:100000000n,maxUploadRent:100000000n,resources});
async function work(run){
  const dir=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-part-progress-'));
  try{const f=partFixture(),store=new PartWorkflowStore({directory:path.join(dir,'workflows')}),journal=await FileJournalStore.open({directory:path.join(dir,'journal')});
    const session=()=>new NativePlayerSession({release,abi,actor,store:journal,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:f.fetchImpl});
    const saved=await savePartManufactureWorkflow({...args(f),store}),id=saved.workflow.workflowId,progress=()=>readPartManufactureProgress({release,abi,actor,workflowId:id,store,session:session()});
    await run({dir,f,store,journal,session,saved,id,progress});assert.equal(f.calls.some(c=>['sendTransaction','simulateTransaction','getProgramAccounts'].includes(c.method)),false);
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('actual purchased inventory compiles immutable window identical to signed Bank part construction and all stage intents',async()=>{
  const f=partFixture(),read=await readMaterialInventory({release,rpc:f.rpc,actor,projectIds:[projectId],sourceIds:[]}),w=await planManufacturePartWorkflow({...args(f),initialNonce:read.nextNonce,inventory:read.inventory});
  assert.equal(w.artifactBody.toString('hex'),bank.artifactBodyHex);assert.equal(w.stages.length,4);
  const fixed=await compileManufacturePartWorkflow({...args(f),initialNonce:w.initialNonce,materialPlan:w.materialPlan});
  for(let i=0;i<w.stages.length;i++){
    assert.equal(w.stages[i].frame.toString('hex'),bank.window.stages[i].dataHex);assert.deepEqual(fixed.stages[i].instruction,w.stages[i].instruction);
    const intent=nativeActionIntent(w.stages[i],resources);assert.equal(intent.payloadHex,w.stages[i].payload.toString('hex'));assert.equal(intent.operation,w.stages[i].operation);
  }
  const m=await createPartManifest({release,abi,actor,workflow:w,resources}),restored=await restorePartManifest({release,abi,actor,workflowId:m.workflowId,text:m.text});
  assert.equal(restored.workflow.artifactBody.toString('hex'),bank.artifactBodyHex);assert.deepEqual(publicPartWorkflow(restored),publicPartWorkflow(m));
  await assert.rejects(restorePartManifest({release,abi,actor,workflowId:m.workflowId,text:m.text+' '}),/HASH/);
  await assert.rejects(restorePartManifest({release,abi,actor:release.input.programId,workflowId:m.workflowId,text:m.text}),/CONTEXT/);
});
test('manifest save is idempotent, survives restart and first progress yields exactly one unsigned upload with no journal reservation',async()=>work(async({dir,f,store,journal,saved,id,progress})=>{
  assert.equal(saved.decision,'WORKFLOW_SAVED');assert.equal(saved.intent,undefined);assert.equal((await journal.load()).payload,null);
  const again=await savePartManufactureWorkflow({...args(f),store});assert.equal(again.workflow.workflowId,id);assert.equal(again.alreadySaved,true);
  const restored=new PartWorkflowStore({directory:path.join(dir,'workflows')});assert.equal((await restored.load({release,abi,actor,workflowId:id})).workflowId,id);
  const next=await progress();assert.equal(next.decision,'ACTION');assert.equal(next.stage.kind,'UPLOAD');assert.equal(next.intent.operation,'ARTIFACT_PUT');assert.equal(next.intent.nonce,'6');assert.equal(next.intent.payloadHex,decodeNativeFrame(abi,Buffer.from(bank.window.stages[0].dataHex,'hex')).payload.toString('hex'));assert.equal((await journal.load()).payload,null);
}));
test('prepared current exact request requires explicit existing-session recovery; original immutable manifest is not replaced',async()=>work(async({session,journal,progress,id})=>{
  const next=await progress();const prepared=await session().prepare({...next.intent,nonce:BigInt(next.intent.nonce),payload:Buffer.from(next.intent.payloadHex,'hex'),resources});
  assert.equal(prepared.frameHex,bank.window.stages[0].dataHex);
  const pending=await progress();assert.equal(pending.decision,'RECOVER_CURRENT_REQUEST');assert.equal(pending.intent,undefined);assert.equal(pending.workflow.workflowId,id);
  assert.equal(JSON.parse((await journal.load()).payload).entries.length,1);
}));
test('actual sealed Bank prefix cannot invent missing original upload confirmations or skip directly to manufacture',async()=>work(async({f,progress})=>{
  f.setPhase('before');const out=await progress();assert.equal(out.decision,'WAIT_UNVERIFIED_PREFIX');assert.equal(out.blockingNonce,6n);assert.equal(out.intent,undefined);assert.equal(out.outputVerified,false);
}));
test('actual Bank Root and sources prove output separately from unobserved old request; exact durable final request survives restart/retry',async()=>work(async({f,store,session,id,progress})=>{
  f.setPhase('after');const actual=await progress();assert.equal(actual.decision,'OUTPUT_READ');assert.equal(actual.outputVerified,true);assert.equal(actual.exactRequestExecutionVerified,false);assert.equal(actual.receipt,null);
  assert.equal(actual.root.instanceHex,bank.window.outputIdHex);assert.equal(actual.root.B,120000n);assert.equal(actual.root.lifecycle,0);
  const m=await store.load({release,abi,actor,workflowId:id}),final=m.workflow.stages.at(-1);f.setPhase('before');await session().prepare({...nativeActionIntent(final,resources),nonce:final.nonce,payload:final.payload,resources});
  f.setPhase('after');const confirmed=await progress();assert.equal(confirmed.exactRequestExecutionVerified,true);assert.equal(confirmed.receipt.rentLamports,35628240n);
  f.setPhase('retry');assert.equal((await progress()).exactRequestExecutionVerified,true);
}));
test('HOST-only stale material and outside nonce window never reselect frozen sources or return intent',async()=>work(async({f,progress})=>{
  const token=[...f.maps.purchased.values()].find(a=>a?.data.length===165);token.data.writeBigUInt64LE(0n,64);
  const stale=await progress();assert.equal(stale.decision,'MATERIAL_PLAN_STALE');assert.equal(stale.intent,undefined);
  f.maps.purchased.get(bank.actorNonceAddress).data.writeBigUInt64LE(1000n,120);
  const changed=await progress();assert.equal(changed.decision,'NONCE_WINDOW_CHANGED_REPLAN');assert.equal(changed.intent,undefined);
}));
test('HOST-only output debit identity and Root changes during later inventory reads fail closed',async()=>{
  await work(async({f,progress,store,id})=>{
    f.setPhase('after');f.maps.after.get(bank.window.outputAddress).data[443+4]^=1;
    await assert.rejects(progress(),/PART_OUTPUT_DEBIT_PLAN/);
  });
  await work(async({f,progress,store,id})=>{
    f.setPhase('after');let changed=false;const original=f.fetchImpl;
    // A separate read adapter mutates the actual Root revision during the
    // later inventory pass; all mutated observations remain HOST-ONLY.
    const from=f.maps.after.get(bank.window.outputAddress);const old=from.data.readBigUInt64LE(354);
    const dir=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-part-race-'));
    try{
      const session=new NativePlayerSession({release,abi,actor,store:await FileJournalStore.open({directory:dir}),endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:async(u,o)=>{
        const request=JSON.parse(o.body);if(request.method==='getMultipleAccounts'&&request.params[0].length>10&&!changed){from.data.writeBigUInt64LE(old+1n,354);changed=true;}return original(u,o);
      }});
      // The inventory reader may reject the observed change itself, or the
      // coordinator's final snapshot rejects stale Root ownership/revision.
      const m=await readPartManufactureProgress({release,abi,actor,workflowId:id,store,session});assert.equal(changed,true);assert.equal(m.decision,'REPLAN_STALE_STATE');assert.equal(m.outputVerified,false);assert.equal(m.root,null);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  await work(async({f,store,id})=>{
    f.setPhase('after');const original=f.fetchImpl,nonce=f.maps.after.get(bank.actorNonceAddress);let snapshots=0,inventoryReads=0;
    const dir=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-part-nonce-regression-'));
    try{
      const session=new NativePlayerSession({release,abi,actor,store:await FileJournalStore.open({directory:dir}),endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:async(u,o)=>{
        const request=JSON.parse(o.body);
        if(request.method==='getMultipleAccounts'){
          if(request.params[0].includes(bank.window.outputAddress)){snapshots++;nonce.data.writeBigUInt64LE(snapshots===1?10n:12n,120);}
          else if(request.params[0].includes(bank.actorNonceAddress)){inventoryReads++;nonce.data.writeBigUInt64LE(15n,120);}
        }
        return original(u,o);
      }});
      await assert.rejects(readPartManufactureProgress({release,abi,actor,workflowId:id,store,session}),/PART_PROGRESS_CLOCK_REGRESSION/);
      assert.equal(snapshots,2);assert.ok(inventoryReads>=3);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
