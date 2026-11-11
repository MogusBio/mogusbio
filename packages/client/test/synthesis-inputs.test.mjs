import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {sha256} from '../../protocol-core/src/index.mjs';
import {decodeGraph,members} from '../../biology/src/graph.mjs';
import {validateProductionRelease,baseConfigR2Id,PROGRAMS} from '../src/release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda,loadNativeAbi} from '../src/native.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
import {key} from './native-fixture.mjs';
import {readSynthesisInputs,planActualSynthesis,SYNTHESIS_INPUT_LIMITS} from '../src/synthesis-inputs.mjs';

const saved=p=>readFile(new URL(`../../../${p}`,import.meta.url));
const release=await validateProductionRelease(JSON.parse(await saved('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
const abi=loadNativeAbi(await saved('programs/biolab-economy/operations.p0r2.json'),{expectedHash:release.input.abiHash}),actor=release.input.bootstrap;
const pda=(...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
const ledger=await saved('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b1687.bin');
assert.equal(sha256(ledger).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
assert.deepEqual(ledger.subarray(8,40),baseConfigR2Id(release));
const checkpoint=new Map();let at=108;
for(let i=0;i<ledger.readUInt32LE(104);i++){
  const address=nativeKeyAddress(ledger.subarray(at,at+32)),lamports=ledger.readBigUInt64LE(at+32),owner=nativeKeyAddress(ledger.subarray(at+40,at+72)),executable=ledger[at+72]===1,rentEpoch=ledger.readBigUInt64LE(at+73),length=ledger.readUInt32LE(at+81);at+=85;
  checkpoint.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(ledger.subarray(at,at+length))});at+=length;
}
assert.equal(at,ledger.length);assert.equal(checkpoint.size,1081);
const allRoots=[...checkpoint.values()].filter(a=>a.owner===release.input.programId&&a.data.length>=443&&a.data.readUInt16LE(10)===12);
const rootsFor=target=>target<=15?[1,2,3,4].map(p=>allRoots.find(a=>a.data.readUInt16LE(12)===1&&a.data[282]===p&&(p!==4||a.data[283]===target))):allRoots.filter(a=>a.data.readUInt16LE(12)===(target===22?3:2)&&(target===22?[16,17,18,19,20,21]:members(target)).includes(a.data[280]));
const graph=async target=>({...decodeGraph(await saved(`fixtures/graphs/c320-scope-${String(target).padStart(2,'0')}.bin`)),domain:Buffer.from(release.domain),config:baseConfigR2Id(release),catalog:Buffer.from(release.hashes.catalogHash),rule:Buffer.from(release.hashes.ruleHash)});
const cloneMap=()=>new Map([...checkpoint].map(([k,a])=>[k,{...a,data:Buffer.from(a.data)}]));
const raw=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};
/** Original ledger unchanged by default. Restored LIVE/movement/clock states
 * below are explicitly HOST-ONLY; never new native output or spend authority. */
async function fixture(target=1,{hostLive=false,onRead}={}){
  const map=cloneMap(),selected=rootsFor(target),ids=selected.map(a=>Buffer.from(a.data.subarray(120,152))),regAddresses=await Promise.all(ids.map(id=>pda('root-reg',id)));
  if(hostLive)for(const a of selected){const current=map.get(a.address);current.data[362]=0;current.data.fill(0,363,443);}
  const calls=[];let slot=100n,reads=0;
  const rpc=new ReadOnlyRpc({release,endpoint:'https://synthesis-recorded.invalid',fetchImpl:async(url,options)=>{
    assert.equal(url,'https://synthesis-recorded.invalid/');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const request=parseJsonWithBigInts(options.body);calls.push(request);let result;
    if(request.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(request.method==='getMultipleAccounts'){
      assert.equal(request.params[1].commitment,'finalized');assert.ok(request.params[0].length<=100);
      onRead?.({map,reads:++reads,addresses:request.params[0]});
      result={context:{slot:++slot},value:request.params[0].map(address=>{assert.ok(map.has(address),`unrecorded account ${address}`);return raw(map.get(address));})};
    }else assert.fail(`non-read transport method ${request.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result}));
  }});
  return {map,calls,args:{release,rpc,actor,target,directIds:ids},selected,regAddresses};
}
const read=f=>readSynthesisInputs(f.args);
const plan=async f=>planActualSynthesis({release,abi,rpc:f.args.rpc,actor,graph:await graph(f.args.target),directIds:f.args.directIds,challengePpm:2000000});

test('unchanged genuine76b consumed inputs remain observed records but cannot produce a new plan',async()=>{
  const f=await fixture(22),r=await read(f);assert.equal(r.decision,'INPUTS_READ');assert.equal(r.inputRecordsVerified,true);assert.equal(r.allEligible,false);
  assert.ok(r.eligibility.every(v=>v.blockingReason==='INPUT_ALREADY_CONSUMED'));assert.equal(r.directInputs.length,6);assert.ok(r.directInputs.every(v=>v.originalArtifact));
  assert.equal(r.summary.materialFeeAtoms,'12000000');assert.doesNotThrow(()=>JSON.stringify(r.summary));assert.equal(r.businessExecutionVerified,false);
  assert.equal((await plan(f)).decision,'INPUTS_BLOCKED');assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts'].includes(c.method)));
  assert.equal(Math.max(...f.calls.filter(c=>c.method==='getMultipleAccounts').map(c=>c.params[0].length)),23);assert.equal(SYNTHESIS_INPUT_LIMITS.accounts,23);
});
test('HOST-only restored LIVE CELL/ORGAN/BIO inputs preserve actual parent capsules and exact per-target fees',async()=>{
  for(const [target,fee,leaves]of [[1,'800000',4],[16,'3200000',8],[17,'4800000',12],[18,'6400000',16],[22,'12000000',60]]){
    const f=await fixture(target,{hostLive:true}),r=await plan(f);assert.equal(r.decision,'SYNTHESIS_PLANNED');assert.equal(r.allEligible,true);assert.equal(r.summary.materialFeeAtoms,fee);
    assert.equal(r.plan.materialFeeAtoms.toString(),fee);assert.equal(r.plan.payload.leaves.length,leaves);assert.equal(r.plan.clientPlanOnly,true);assert.equal(r.requiresSimulation,true);assert.equal(r.rentSufficiencyVerified,false);
    assert.ok(r.eligibility.every(v=>v.movable));assert.equal(r.summary.historicalDebtMustBeClaimed,false);
    assert.equal(r.plan.payload.direct.length,f.args.directIds.length);assert.ok(r.plan.payload.capsules.every(b=>Buffer.isBuffer(b)));
  }
});
test('HOST-only actual registration absence and prefunded empty System PDA are movable without fabricating records',async()=>{
  const f=await fixture(1,{hostLive:true});for(const address of f.regAddresses)f.map.set(address,null);
  const r=await read(f);assert.equal(r.allEligible,true);assert.ok(r.eligibility.every(v=>!v.registered&&v.ordinaryCount==='0'&&v.nextCoverageHour===String((1n<<64n)-1n)));
  const prefunded=await fixture(1,{hostLive:true});for(const address of prefunded.regAddresses)prefunded.map.set(address,{address,owner:PROGRAMS.systemProgram,executable:false,lamports:5000n,rentEpoch:0n,data:Buffer.alloc(0)});
  assert.equal((await plan(prefunded)).decision,'SYNTHESIS_PLANNED');
});
test('HOST-only owner, hierarchy, service profile and consumed state yield explicit blocks',async()=>{
  const wrongOwner=await fixture(1,{hostLive:true});nativeKeyBytes(key(20)).copy(wrongOwner.map.get(wrongOwner.selected[0].address).data,322);
  assert.equal((await read(wrongOwner)).eligibility.find(v=>!v.movable).blockingReason,'OWNER_MISMATCH');
  const hierarchy=await fixture(1,{hostLive:true});hierarchy.args.directIds[0]=Buffer.from(rootsFor(1)[3].data.subarray(120,152));hierarchy.args.directIds[3]=Buffer.from(rootsFor(2)[3].data.subarray(120,152));
  assert.ok((await read(hierarchy)).eligibility.every(v=>v.blockingReasons.includes('DIRECT_HIERARCHY_MISMATCH')));
  const profile=await fixture(2,{hostLive:true});profile.args.directIds[3]=Buffer.from(rootsFor(1)[3].data.subarray(120,152));const a=profile.map.get(rootsFor(1)[3].address);a.data[362]=0;a.data.fill(0,363,443);
  assert.ok((await read(profile)).eligibility.some(v=>v.blockingReasons.includes('SERVICE_PROFILE_MISMATCH')));
});
test('HOST-only certificate fault, open K/ordinary intervals, end waits and historical coverage block movement without inspecting paid debt',async()=>{
  const cases=[
    {name:'K_AWARE_EXIT_REQUIRED',mutate:b=>{b[129]=0;b.writeBigUInt64LE(0n,130);b.writeBigUInt64LE(1n,89);Buffer.alloc(32,3).copy(b,97);}},
    {name:'ORDINARY_EXIT_REQUIRED',mutate:b=>{b[80]=0;b.writeBigUInt64LE(0n,81);}},
    {name:'WAIT_K_END',mutate:(b,clock)=>{b[129]=1;b.writeBigUInt64LE(999999999n,130);b.writeBigUInt64LE(1n,89);Buffer.alloc(32,3).copy(b,97);}},
    {name:'WAIT_ORDINARY_END',mutate:b=>{b[80]=1;b.writeBigUInt64LE(999999999n,81);}},
    {name:'HISTORICAL_COVERAGE_REQUIRED',mutate:b=>{b.writeBigUInt64LE(0n,138);b.writeBigUInt64LE(0n,146);}},
    {name:'CERTIFICATE_FAULT',mutate:b=>{b[203]=1;Buffer.alloc(32,4).copy(b,204);}},
  ];
  for(const c of cases){
    const f=await fixture(1,{hostLive:true}),a=f.map.get(f.regAddresses[0]);assert.ok(a,'actual registration required');c.mutate(a.data.subarray(120),f.map.get(PROGRAMS.clockSysvar));
    const r=await read(f);assert.equal(r.allEligible,false);assert.ok(r.eligibility.some(v=>v.blockingReasons.includes(c.name)),c.name);assert.equal((await plan(f)).decision,'INPUTS_BLOCKED');
  }
  const f=await fixture(1,{hostLive:true}),r=await read(f);assert.equal(r.allEligible,true);
  // This reader intentionally never reads Position debt/paid or requires a
  // claim. Actual covered RootReg facts are enough for the native move guard.
  const queried=new Set(f.calls.filter(c=>c.method==='getMultipleAccounts').flatMap(c=>c.params[0]));
  const positionAddresses=[...f.map.values()].filter(a=>a&&a.owner===release.input.programId&&a.data.length>=120&&a.data.readUInt16LE(10)===27).map(a=>a.address);
  assert.ok(positionAddresses.length>0);assert.ok(positionAddresses.every(address=>!queried.has(address)));
});
test('bounds, duplicates, caller runtime/capsules, wrong release context and challenge lattice reject before transport',async()=>{
  for(const mutate of [a=>a.target=0,a=>a.target=23,a=>a.directIds=a.directIds.slice(1),a=>a.directIds[1]=a.directIds[0],a=>a.directIds[0]=a.directIds[0].toString('hex'),a=>a.directInputs=[],a=>a.nonce=0n,a=>a.rpc={getMultipleAccounts(){assert.fail('fake rpc');}}]){
    const f=await fixture();mutate(f.args);await assert.rejects(read(f));assert.equal(f.calls.length,0);
  }
  for(const mutation of [a=>a.graph.domain=Buffer.alloc(32),a=>a.challengePpm=500001,a=>a.challengePpm=2000001,a=>a.capsules=[]]){
    const f=await fixture(3,{hostLive:true}),args={release,abi,rpc:f.args.rpc,actor,graph:await graph(3),directIds:f.args.directIds,challengePpm:2000000};mutation(args);
    await assert.rejects(planActualSynthesis(args));assert.equal(f.calls.length,0);
  }
  const f=await fixture(3,{hostLive:true});await assert.rejects(planActualSynthesis({release,abi,rpc:f.args.rpc,actor,graph:await graph(3),directIds:f.args.directIds,challengePpm:1000000}),/HARD_CHALLENGE/);assert.equal(f.calls.length,0);
});
test('HOST-only malformed Root/RootReg/parent artifact and future times fail closed instead of becoming blocked usable inputs',async()=>{
  for(const change of [
    f=>f.map.get(f.selected[0].address).owner=PROGRAMS.systemProgram,
    f=>f.map.get(f.selected[0].address).data[88]^=1,
    f=>f.map.get(f.regAddresses[0]).owner=PROGRAMS.systemProgram,
    f=>f.map.get(f.regAddresses[0]).data[120]^=1,
    f=>f.map.get(f.selected[0].address).data.writeBigInt64LE(9999999999n,306),
    f=>f.map.get(PROGRAMS.clockSysvar).owner=PROGRAMS.systemProgram,
    f=>f.map.get(actor).owner=PROGRAMS.tokenProgram,
  ]){const f=await fixture(1,{hostLive:true});change(f);await assert.rejects(read(f));}
  for(const change of [a=>a.data[251]^=1,a=>a.data[234]=0,a=>a.data.writeBigInt64LE(9999999999n,235),a=>a.owner=PROGRAMS.systemProgram]){
    const f=await fixture(22,{hostLive:true}),id=f.selected[0].data.subarray(443,475),address=await pda('artifact',id);change(f.map.get(address));await assert.rejects(read(f));
  }
});
test('HOST-only changed Root revision, nonce, actor funding or parent Artifact returns REPLAN with no trusted inputs/plan',async()=>{
  const changes=[
    f=>f.map.get(f.selected[0].address).data.writeBigUInt64LE(99n,354),
    f=>f.map.get(actor).lamports+=1n,
  ];
  for(const change of changes){let f,mutated=false;f=await fixture(1,{hostLive:true,onRead:({reads})=>{if(reads===3){const value=change(f);assert.equal(value instanceof Promise,false,'mutation must be synchronous');mutated=true;}}});
    const r=await read(f);assert.equal(mutated,true);assert.equal(r.decision,'REPLAN_STALE_STATE');assert.equal(r.directInputs,undefined);assert.equal(r.plan,undefined);
  }
  const nonceAddress=await pda('actor-nonce',nativeKeyBytes(actor));let f;f=await fixture(1,{hostLive:true,onRead:({map,reads})=>{if(reads===3)map.get(nonceAddress).data.writeBigUInt64LE(999999n,120);}});
  assert.equal((await read(f)).decision,'REPLAN_STALE_STATE');
  let upper,artifactAddress;upper=await fixture(22,{hostLive:true,onRead:({map,reads})=>{if(reads===3){const a=map.get(artifactAddress);a.data.writeBigUInt64LE(a.data.readBigUInt64LE(226)+1n,226);}}});
  artifactAddress=await pda('artifact',upper.selected[0].data.subarray(443,475));
  assert.equal((await read(upper)).decision,'REPLAN_STALE_STATE');
});
test('HOST-only increasing RPC context cannot hide Clock or Actor nonce regression; caller graph and IDs are copied before awaits',async()=>{
  const nonceAddress=await pda('actor-nonce',nativeKeyBytes(actor));
  for(const mutate of [map=>{const a=map.get(PROGRAMS.clockSysvar);a.data.writeBigInt64LE(a.data.readBigInt64LE(32)-1n,32);},map=>{const a=map.get(nonceAddress);a.data.writeBigUInt64LE(a.data.readBigUInt64LE(120)-1n,120);}]){
    const f=await fixture(1,{hostLive:true,onRead:({map,reads})=>{if(reads===3)mutate(map);}});
    await assert.rejects(read(f),/SYN_INPUT_(CLOCK|NONCE)_REGRESSION/);
  }
  const originalGraph=await graph(1),expectedV=originalGraph.cells[0].v;let originalIds,mutated=false;
  const f=await fixture(1,{hostLive:true,onRead:({reads})=>{if(reads===1){originalGraph.cells[0].v=expectedV===0?1000:0;originalIds[0].fill(0);mutated=true;}}});originalIds=f.args.directIds.map(Buffer.from);
  const r=await planActualSynthesis({release,abi,rpc:f.args.rpc,actor,graph:originalGraph,directIds:originalIds,challengePpm:2000000});
  assert.equal(mutated,true);assert.equal(r.decision,'SYNTHESIS_PLANNED');assert.equal(r.plan.payload.graph.cells[0].v,expectedV);assert.ok(r.plan.payload.direct.every(d=>!d.instance.equals(Buffer.alloc(32))));
});
