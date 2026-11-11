import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {checkpoint,cloneAccounts,release,abi,actor,resources,recordedTransport} from '../../client/test/synthesis-fixture.mjs';

async function fixture(run){const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-round-bridge-')),map=cloneAccounts(checkpoint),transport=recordedTransport({saved:map},'saved',{strict:false});
  try{const make=()=>createOperatorBridge({release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:directory,allowLocalhost:true,fetchImpl:transport.fetchImpl});await run({bridge:await make(),make,transport});assert.ok(transport.calls.every(c=>['getGenesisHash','getMultipleAccounts'].includes(c.method)));}finally{await rm(directory,{recursive:true,force:true});}}
const plan={actor,round:'0',maxRent:'100000000',resources:{...resources,priorityFeeLamports:'0'}};
test('actual76b competition HTTP bridge preserves current16 seed/frontier and empty-round status without private design data',async()=>fixture(async({bridge})=>{
  const r=await bridge.dispatch('competition-read',{actor,round:'0'});assert.equal(r.decision,'OBSERVED');assert.equal(r.actor,actor);assert.equal(r.round,'0');assert.equal(r.roundExists,false);assert.equal(r.transactionExecuted,false);assert.equal(r.intent,undefined);assert.doesNotThrow(()=>JSON.stringify(r));
  const text=JSON.stringify(r);assert.equal(text.includes('salt'),false);assert.equal(text.includes('baseManifestText'),false);
}));
test('actual76b competition bridge produces the exact next102-byte round transition with independent explicit preparation',async()=>fixture(async({bridge,make})=>{
  const r=await bridge.dispatch('round-plan',plan);assert.equal(r.decision,'ACTION');assert.equal(r.intent.operation,'FINALIZE_ROUND');assert.equal(r.intent.payloadHex.length,204);assert.equal(r.action,undefined);assert.equal(r.businessExecutionVerified,false);
  const same=await(await make()).dispatch('round-plan',plan);assert.deepEqual(same.intent,r.intent);assert.equal(same.preview.activationPlanned,false);
}));
test('round/Winner bridge rejects injected rankings, cursors, release, authority and malformed IDs before RPC',async()=>fixture(async({bridge,transport})=>{
  for(const extra of [{candidateIndexHint:'0'},{candidateLookupStart:'8'},{rank:1},{endpoint:'https://evil.invalid'},{nonce:'0'},{round:'01'},{resources:{...plan.resources,priorityFeeLamports:0}}])await assert.rejects(bridge.dispatch('round-plan',{...plan,...extra}));
  for(const winnerIdHex of ['00','AB'.repeat(32),'0g'.repeat(32)])await assert.rejects(bridge.dispatch('winner-plan',{actor,winnerIdHex,maxRent:plan.maxRent,resources:plan.resources}));
  await assert.rejects(bridge.dispatch('competition-read',{actor,round:'0',maxRent:'1'}));assert.equal(transport.calls.length,0);
}));
