import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {actor,release,abi,bank,resources,projectId,partFixture} from '../../client/test/part-fixture.mjs';
import {baseConfigR2Id} from '../../client/src/release.mjs';
import {decodeNativeFrame,encodeNativeFrame} from '../../client/src/native.mjs';

// Genuine signed Bank records are read through an offline RPC adapter. No
// transaction is simulated, signed or submitted by this integration suite.
const budget={...resources,priorityFeeLamports:resources.priorityFeeLamports.toString()};
const inventoryBody={actor,projectIdsHex:[projectId.toString('hex')],sourceIdsHex:[]};
const planBody={...inventoryBody,descriptor:{primitive:1,profile:0},maxPartRent:'100000000',maxUploadRent:'100000000',resources:budget};
const endpoint='https://manufacture-fixture.invalid/private?api-key=fixture-secret';

async function fixture(t,phase='purchased'){
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-manufacture-bridge-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const rpc=partFixture(phase),options={release,abi,endpoint,stateDirectory:directory,fetchImpl:rpc.fetchImpl};
  return {directory,rpc,bridge:await createOperatorBridge(options),restart:()=>createOperatorBridge(options)};
}
async function files(directory,prefix=''){
  const entries=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){const rel=path.join(prefix,entry.name);if(entry.isDirectory())entries.push(...await files(path.join(directory,entry.name),rel));else entries.push(rel);}return entries;
}
function safe(result,f){const serialized=JSON.stringify(result);assert.deepEqual(JSON.parse(serialized),result);assert.doesNotMatch(serialized,/fixture-secret|manufacture-fixture.invalid|\/private\/|pending-journal/);assert.equal(serialized.includes(f.directory),false);}
function noExecution(f){const methods=f.rpc.calls.map(r=>r.method);assert.ok(methods.every(name=>['getGenesisHash','getMultipleAccounts','getLatestBlockhash'].includes(name)));assert.equal(methods.includes('simulateTransaction'),false);assert.equal(methods.includes('sendTransaction'),false);}
async function save(f){return f.bridge.dispatch('manufacture-plan',structuredClone(planBody));}
const nextBody=saved=>({actor,workflowId:saved.workflow.workflowId});
function exactFrame(intent){return encodeNativeFrame(abi,{operation:intent.operation,domain:release.domain,configId:baseConfigR2Id(release),actor,nonce:BigInt(intent.nonce),payload:Buffer.from(intent.payloadHex,'hex')});}
function recordedManufactureIntent(){
  const frame=decodeNativeFrame(abi,Buffer.from(bank.frameHex,'hex'));
  return {operation:'MANUFACTURE_PART',nonce:frame.nonce.toString(),payloadHex:frame.payload.toString('hex'),resources:budget,
    suffix:[{name:'Artifact',address:bank.instruction.accounts[8].pubkey},{name:'NewRoot',address:bank.instruction.accounts[9].pubkey}],
    dynamicAccounts:bank.instruction.accounts.slice(10).map(a=>({address:a.pubkey,writable:a.isWritable,signer:a.isSigner}))};
}

test('inventory bridge reads actual purchased standard units without exposing Maps, request journals or execution',async t=>{
  const f=await fixture(t),out=await f.bridge.dispatch('inventory-read',structuredClone(inventoryBody));
  assert.equal(out.decision,'INVENTORY_READ');assert.equal(out.actor,actor);assert.equal(out.actualInventoryVerified,true);assert.equal(out.nextNonce,'6');
  assert.equal(out.inventory,undefined);assert.equal(out.summary.standardUnits.length,4);assert.deepEqual(out.summary.standardUnits.map(row=>row.amount),['30','60','15','15']);assert.deepEqual(out.summary.sourceBudgets,[]);
  assert.equal(out.summary.totals.totalTick,'1140000');assert.equal(out.clientPlanOnly,true);assert.equal(out.transactionExecuted,false);assert.equal(out.networkSubmitted,false);assert.equal(out.intent,undefined);
  safe(out,f);assert.deepEqual(await fs.readdir(f.directory),[]);noExecution(f);
});

test('manufacture bridge saves immutable genuine four-step window idempotently and only offers explicit current-stage prepare',async t=>{
  const f=await fixture(t),first=await save(f);assert.equal(first.decision,'WORKFLOW_SAVED');assert.equal(first.requiresExplicitNextRead,true);assert.equal(first.intent,undefined);assert.equal(first.alreadySaved,false);
  const w=first.workflow;assert.equal(w.initialNonce,'6');assert.equal(w.manufactureNonce,'9');assert.equal(w.nextNonce,'10');assert.equal(w.stageCount,4);assert.equal(w.artifactIdHex,bank.window.artifactIdHex);assert.equal(w.artifactSHAHex,bank.window.artifactSHAHex);assert.equal(w.outputIdHex,bank.window.outputIdHex);
  assert.equal(w.newSourceIdsHex.length,4);assert.equal(w.materialPlan.intakes.length,4);assert.equal(w.materialPlan.debits.length,4);assert.ok(w.materialPlan.intakes.every(i=>i.unitCount==='1'));assert.deepEqual(w.resources,budget);
  const second=await save(f);assert.equal(second.alreadySaved,true);assert.deepEqual(second.workflow,first.workflow);safe(first,f);safe(second,f);
  const savedFiles=await files(f.directory);assert.ok(savedFiles.some(p=>p.endsWith(`part-${w.workflowId}.json`)));assert.ok(savedFiles.every(p=>!p.split(path.sep).includes('primary')));
  const current=await f.bridge.dispatch('manufacture-next',nextBody(first));assert.equal(current.decision,'ACTION');assert.equal(current.stage.kind,'UPLOAD');assert.equal(current.stage.index,0);assert.equal(current.stage.nonce,'6');assert.equal(current.outputVerified,false);assert.equal(current.exactRequestExecutionVerified,false);
  assert.equal(exactFrame(current.intent).toString('hex'),bank.window.stages[0].dataHex);safe(current,f);
  const beforePrepare=f.rpc.calls.length,envelope=await f.bridge.dispatch('prepare',{actor,intent:current.intent});assert.equal(envelope.frameHex,bank.window.stages[0].dataHex);assert.ok(f.rpc.calls.length>beforePrepare);
  const recover=await f.bridge.dispatch('manufacture-next',nextBody(first));assert.equal(recover.decision,'RECOVER_CURRENT_REQUEST');assert.equal(recover.intent,undefined);assert.equal(recover.recoveryNonce,'6');assert.equal(recover.stage.nonce,'6');safe(recover,f);
  const restarted=await f.restart(),again=await restarted.dispatch('manufacture-next',nextBody(first));assert.equal(again.decision,'RECOVER_CURRENT_REQUEST');assert.deepEqual(again.workflow,first.workflow);safe(again,f);noExecution(f);
});

test('actual sealed Artifact without original prefix requests stays unverified and cannot skip to manufacture',async t=>{
  const f=await fixture(t),saved=await save(f);f.rpc.setPhase('before');const progress=await f.bridge.dispatch('manufacture-next',nextBody(saved));
  assert.equal(progress.decision,'WAIT_UNVERIFIED_PREFIX');assert.equal(progress.blockingNonce,'6');assert.equal(progress.intent,undefined);assert.equal(progress.outputVerified,false);assert.equal(progress.exactRequestExecutionVerified,false);assert.equal(progress.root,null);safe(progress,f);noExecution(f);
});

test('actual manufactured Root is independent from an unobserved final-request receipt',async t=>{
  const f=await fixture(t),saved=await save(f);f.rpc.setPhase('after');const progress=await f.bridge.dispatch('manufacture-next',nextBody(saved));
  assert.equal(progress.decision,'OUTPUT_READ');assert.equal(progress.outputVerified,true);assert.equal(progress.exactRequestExecutionVerified,false);assert.equal(progress.businessExecutionVerified,false);assert.equal(progress.receipt,null);assert.equal(progress.intent,undefined);
  assert.deepEqual(progress.root,{instanceHex:bank.window.outputIdHex,owner:actor,lifecycle:0,schema:1,descriptorHex:bank.manufactureResult.descriptorHex,qualityPpm:'1000000',B:'120000',retired:'45000'});
  assert.equal(progress.sourceBudgets.length,4);assert.deepEqual(progress.summary.standardUnits.map(r=>r.amount),['29','59','14','14']);safe(progress,f);noExecution(f);
});

test('explicit final prepare followed by genuine Bank state confirms exact108-byte receipt and preserves it after restart',async t=>{
  const f=await fixture(t),saved=await save(f);f.rpc.setPhase('before');
  // Use the exact final intent recorded in the signed Bank fixture. This
  // advanced-console prepare is separate from prefix coordinator eligibility.
  const envelope=await f.bridge.dispatch('prepare',{actor,intent:recordedManufactureIntent()});assert.equal(envelope.frameHex,bank.frameHex);
  f.rpc.setPhase('after');const progress=await f.bridge.dispatch('manufacture-next',nextBody(saved));
  assert.equal(progress.decision,'OUTPUT_READ');assert.equal(progress.outputVerified,true);assert.equal(progress.exactRequestExecutionVerified,true);assert.equal(progress.businessExecutionVerified,true);assert.equal(progress.receipt.bytes,bank.manufactureResult.resultHex);assert.equal(progress.receipt.bytes.length,216);
  assert.equal(progress.receipt.totalTicks,'14000');assert.equal(progress.receipt.rentLamports,'35628240');assert.deepEqual(progress.receipt.burned,['1','1','1','1']);assert.equal(progress.receipt.intakeCount,4);assert.equal(progress.receipt.debitCount,4);safe(progress,f);
  const bridge=await f.restart();f.rpc.setPhase('retry');const retained=await bridge.dispatch('manufacture-next',nextBody(saved));assert.equal(retained.exactRequestExecutionVerified,true);assert.equal(retained.receipt.bytes,progress.receipt.bytes);assert.deepEqual(retained.root,progress.root);safe(retained,f);noExecution(f);
});

test('manufacture endpoints reject runtime overrides, malformed exact fields and IDs/resources before fetching',async t=>{
  const f=await fixture(t);for(const [action,body]of [['inventory-read',inventoryBody],['manufacture-plan',planBody],['manufacture-next',{actor,workflowId:'ab'.repeat(32)}]]){
    for(const field of ['endpoint','release','stateDirectory','privateKey','modulePath','nonce','inventory']){const before=f.rpc.calls.length;await assert.rejects(f.bridge.dispatch(action,{...structuredClone(body),[field]:'forbidden'}),/BRIDGE_FIELDS/);assert.equal(f.rpc.calls.length,before);}
  }
  for(const [action,body]of [
    ['inventory-read',{...inventoryBody,projectIdsHex:[...inventoryBody.projectIdsHex,...inventoryBody.projectIdsHex]}],
    ['inventory-read',{...inventoryBody,sourceIdsHex:['cd'.repeat(32),'cd'.repeat(32)]}],
    ['inventory-read',{...inventoryBody,projectIdsHex:Array(9).fill('ab'.repeat(32))}],
    ['inventory-read',{...inventoryBody,sourceIdsHex:['AB'.repeat(32)]}],
    ['manufacture-next',{actor,workflowId:'ab'}],['manufacture-next',{actor,workflowId:'AB'.repeat(32)}],
    ['manufacture-plan',{...planBody,maxPartRent:'01'}],['manufacture-plan',{...planBody,maxUploadRent:'18446744073709551616'}],
    ['manufacture-plan',{...planBody,descriptor:{...planBody.descriptor,override:true}}],
    ['manufacture-plan',{...planBody,resources:{...budget,computeUnitLimit:0}}],
    ['manufacture-plan',{...planBody,resources:{...budget,priorityFeeLamports:0}}],
    ['manufacture-plan',{...planBody,resources:{...budget,endpoint:'forbidden'}}]
  ]){const before=f.rpc.calls.length;await assert.rejects(f.bridge.dispatch(action,structuredClone(body)));assert.equal(f.rpc.calls.length,before);}
  assert.deepEqual(await fs.readdir(f.directory),[]);noExecution(f);
});
