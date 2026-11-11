import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {checkpoint,cloneAccounts,release,abi,actor,resources,recordedTransport} from '../../client/test/synthesis-fixture.mjs';
import {key} from '../../client/test/native-fixture.mjs';

const publicResources={...resources,priorityFeeLamports:'0'};
async function fixture(run){
  const map=cloneAccounts(checkpoint),transport=recordedTransport({saved:map},'saved',{strict:false}),directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-mining-bridge-'));
  const instanceHex=[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===761&&a.data.readUInt16LE(12)===4).data.subarray(120,152).toString('hex');
  try{const bridge=await createOperatorBridge({release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:directory,allowLocalhost:true,fetchImpl:transport.fetchImpl});await run({bridge,instanceHex,transport});
    assert.ok(transport.calls.every(c=>['getGenesisHash','getMultipleAccounts'].includes(c.method)));
  }finally{await rm(directory,{recursive:true,force:true});}
}
test('actual76b mining bridge returns bounded JSON-safe overview with no raw accounts or future-payout guarantee',async()=>fixture(async({bridge,instanceHex})=>{
  const read=await bridge.dispatch('mining-read',{actor,instancesHex:[instanceHex],positionPageStart:'0',positionPageLimit:5});
  assert.equal(read.decision,'MINING_READ');assert.equal(read.summary.emission.totalSupplyLAB,'100000000');assert.equal(read.summary.treasury.manufactureBurnedAtoms,'48000000');
  assert.equal(read.summary.claimable.actorAtoms,'0');assert.equal(read.summary.futureDailyPayoutGuaranteed,false);assert.equal(read.summary.roots.length,1);
  for(const key of ['roots','book','registry','currentK','clock','intent'])assert.equal(Object.hasOwn(read,key),false);
  assert.doesNotThrow(()=>JSON.stringify(read));assert.equal(read.businessExecutionVerified,false);
}));
test('actual76b mining bridge plans exactly one keeper transition and returns original payer hour closure intent',async()=>fixture(async({bridge})=>{
  const next=await bridge.dispatch('global-plan',{actor,maxRent:'100000000',resources:publicResources});assert.equal(next.decision,'ACTION');assert.equal(next.intent.operation,'APPLY_EVENT');assert.equal(next.oneStepOnly,true);assert.equal(next.action,undefined);
  const close=await bridge.dispatch('hour-close-plan',{actor,hour:'340',maxRent:'100000000',resources:publicResources});assert.equal(close.decision,'ACTION');assert.equal(close.intent.operation,'CLOSE_FINAL_HOUR');assert.equal(close.preview.refundRecipient,actor);assert.equal(close.preview.observedRefundLamports,'4245600');
}));
test('actual76b lifecycle bridge plans transfer while retaining old-beneficiary debt semantics',async()=>fixture(async({bridge,instanceHex})=>{
  const transfer=await bridge.dispatch('lifecycle-plan',{actor,instanceHex,kind:'transfer',newOwner:key(20),maxRent:'100000000',resources:publicResources});
  assert.equal(transfer.decision,'ACTION');assert.equal(transfer.intent.operation,'TRANSFER_ROOT');assert.equal(transfer.preview.preservesHistoricalBeneficiaries,true);assert.equal(transfer.preview.historicalDebtMustBeClaimed,false);assert.equal(transfer.action,undefined);
  const exit=await bridge.dispatch('lifecycle-plan',{actor,instanceHex,kind:'exit',maxRent:'100000000',resources:publicResources});assert.equal(exit.decision,'ALREADY_EXITED');assert.equal(exit.intent,undefined);
}));
test('mining/lifecycle bridge rejects injected authority and malformed pagination before RPC',async()=>fixture(async({bridge,instanceHex,transport})=>{
  const base={actor,instancesHex:[instanceHex],positionPageStart:'0',positionPageLimit:5};
  for(const change of [{endpoint:'https://evil.invalid'},{instancesHex:[instanceHex,instanceHex]},{instancesHex:Array(5).fill(instanceHex)},{positionPageStart:'01'},{positionPageLimit:6},{instancesHex:['AB'.repeat(32)]}])await assert.rejects(bridge.dispatch('mining-read',{...base,...change}));
  for(const change of [{nonce:'1'},{newOwner:key(20)},{kind:'stake'}])await assert.rejects(bridge.dispatch('lifecycle-plan',{actor,instanceHex,kind:'exit',maxRent:'1000',resources:publicResources,...change}));
  assert.equal(transport.calls.length,0);
}));
