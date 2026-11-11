import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { settlementFixture } from './settlement-fixture.mjs';
import { baseAccount } from './account-fixture.mjs';
import { nativeKeyAddress } from '../src/native.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { planNextGlobalSettlement,runNativeKeeperStep } from '../src/keeper.mjs';
import { runOperator } from '../../../apps/operator/main.mjs';
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const MAX=(1n<<64n)-1n;

// Codec fixtures model finalized transport. Native execution is independently
// tested against the exact ELF; no mock return is used as mining proof here.
async function environment(){
  const f=await settlementFixture({lazy:false}),base=await baseAccount(f.release);f.clockAccount.data.writeBigUInt64LE(10n,0);
  const accounts=new Map([base,f.registryAccount,f.clockAccount,f.hourAccount].map(a=>[a.address,a])),calls=[];
  const fetchImpl=async(_,o)=>{
    const req=parseJsonWithBigInts(o.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(f.release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts')result={context:{slot:10n},value:req.params[0].map(k=>{
      const a=accounts.get(k);return !a?null:{owner:a.owner,executable:a.executable,lamports:a.lamports??0n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']};
    })};else throw new Error(`unexpected method: ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  };
  return {...f,accounts,calls,fetchImpl,rpc:new ReadOnlyRpc({release:f.release,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl})};
}
const args=f=>({release:f.release,abi:f.abi,rpc:f.rpc,actor:f.actor,maxRent:10000000n});
function active(f){
  const b=f.registryAccount.data.subarray(120);b.writeBigUInt64LE(1n,64);b.writeBigUInt64LE(0n,72);b.writeBigUInt64LE(0n,80);b.writeBigUInt64LE(f.p.weight,88);
}

test('keeper reads actual frozen frontier and advances without player scans, signing or sending',async()=>{
  const f=await environment(),plan=await planNextGlobalSettlement(args(f));
  assert.equal(plan.action.operation,'ADVANCE_FROZEN_HOUR');assert.equal(plan.action.instruction.accounts.length,10);assert.equal(plan.action.nonce,0n);
  assert.ok(f.calls.filter(c=>c.method==='getMultipleAccounts').every(c=>c.params[0].length<=2));
  const result=await runNativeKeeperStep({...args(f),session:{rpc:f.rpc,prepare(){throw new Error('dry run mutated session');}},resources,signEnvelope(){throw new Error('dry run signed');}});
  assert.equal(result.action.operation,'ADVANCE_FROZEN_HOUR');assert.equal(result.transactionExecuted,false);
  assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
});

test('keeper distinguishes Registry initialization, empty-range skip and active-hour OPEN',async()=>{
  const f=await environment();f.accounts.delete(f.registryAccount.address);
  assert.equal((await planNextGlobalSettlement(args(f))).action.operation,'SYNC_EMISSION');
  f.accounts.set(f.registryAccount.address,f.registryAccount);f.accounts.delete(f.hourAccount.address);
  const empty=await planNextGlobalSettlement(args(f));assert.equal(empty.action.operation,'EMPTY_SKIP');assert.equal(empty.action.payload.readBigUInt64LE(8),1n);
  active(f);assert.equal((await planNextGlobalSettlement(args(f))).action.operation,'OPEN_HOUR');
  f.clockAccount.data.writeBigInt64LE(BigInt(f.release.input.rewardStart)+3599n,32);
  await assert.rejects(()=>planNextGlobalSettlement(args(f)),{code:'KEEPER_CLOCK_REGRESSION'});
  f.registryAccount.data.writeBigUInt64LE(BigInt(f.release.input.rewardStart),136);
  assert.equal((await planNextGlobalSettlement(args(f))).decision,'WAIT_COMPLETED_HOUR');
});

test('keeper finalizes an already-open empty hour and refuses to relabel a legacy Hour3',async()=>{
  const f=await environment(),b=f.hourAccount.data.subarray(120);
  for(const at of [16,24,41])b.writeBigUInt64LE(0n,at);
  b.fill(0,57,73);b.fill(0,217,233);for(const at of [297,305,313,321])b.writeBigUInt64LE(MAX,at);
  assert.equal((await planNextGlobalSettlement(args(f))).action.operation,'MATERIALIZE_HOUR');
  const legacy=await settlementFixture({lazy:false,schema:3});f.accounts.set(f.hourAccount.address,legacy.hourAccount);
  assert.equal((await planNextGlobalSettlement(args(f))).decision,'LEGACY_HOUR_REQUIRES_MANUAL_COMPLETION');
});

test('keeper requires a real queued event and an explicitly injected signer for execution',async()=>{
  const f=await environment();f.registryAccount.data.writeBigUInt64LE(1n,160);
  await assert.rejects(()=>planNextGlobalSettlement(args(f)));
  f.registryAccount.data.writeBigUInt64LE(0n,160);
  await assert.rejects(()=>runNativeKeeperStep({...args(f),session:{rpc:f.rpc},resources,broadcast:true}),{code:'KEEPER_EXTERNAL_SIGNER_REQUIRED'});
  await assert.rejects(()=>runNativeKeeperStep({...args(f),session:{rpc:f.rpc,recoveryIdentity:{actor:'11111111111111111111111111111111'},prepare(){throw new Error('wrong session journaled');}},
    resources,broadcast:true,signEnvelope(){throw new Error('wrong session signed');}}),{code:'KEEPER_SESSION_IDENTITY'});
});

test('keeper-plan CLI exports a directly preparable intent without creating a session or broadcasting',async()=>{
  const f=await environment(),dir=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-keeper-plan-'));
  try{
    const releaseFile=path.join(dir,'release.json'),requestFile=path.join(dir,'request.json'),out=path.join(dir,'intent.json');
    await fs.writeFile(releaseFile,JSON.stringify(f.release.input));await fs.writeFile(requestFile,JSON.stringify({maxRent:'10000000',resources:{...resources,priorityFeeLamports:'0'}}));
    const result=await runOperator(['keeper-plan','--release',releaseFile,'--local-public-fixture','--actor',f.actor,'--endpoint','http://127.0.0.1:8899','--request',requestFile,'--out',out],{fetchImpl:f.fetchImpl});
    assert.equal(result.operation,'ADVANCE_FROZEN_HOUR');const intent=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(intent.payloadHex.length,32);assert.equal(intent.nonce,'0');
    assert.equal((await fs.stat(out)).mode&0o777,0o600);assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
