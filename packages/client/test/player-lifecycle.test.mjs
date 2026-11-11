import test from 'node:test';
import assert from 'node:assert/strict';
import { typedHash, sha256 } from '../../protocol-core/src/index.mjs';
import { TASK_FAMILY } from '../../originality/src/wire.mjs';
import { H_END } from '../../settlement/src/emission.mjs';
import { PROGRAMS } from '../src/release.mjs';
import { nativeKeyBytes, decodeNativeFrame } from '../src/native.mjs';
import { planPlayerLifecycleAction } from '../src/player-lifecycle.mjs';
import { checkpoint, cloneAccounts, release, abi, actor, pda, le, recordedTransport } from './synthesis-fixture.mjs';
import { recordAccount } from './account-fixture.mjs';
import { key } from './native-fixture.mjs';

const MAX=(1n<<64n)-1n;
// Defaults are unmodified genuine current76b account bytes. Alternate/open-K
// states below are explicitly HOST-only planning fixtures, never SBF execution.
async function fixture(onRead){
  const map=cloneAccounts(checkpoint),root=[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===761&&a.data.readUInt16LE(10)===12&&a.data.readUInt16LE(12)===4),instance=Buffer.from(root.data.subarray(120,152)),registration=map.get(await pda('root-reg',instance)),registry=map.get(await pda('mining')),position=map.get(await pda('reg',instance,le(registration.data.readBigUInt64LE(160)-1n))),clock=map.get(PROGRAMS.clockSysvar),nonce=map.get(await pda('actor-nonce',nativeKeyBytes(actor)));
  const transport=recordedTransport({local:map},'local',{onRead,strict:false});
  return {...transport,map,root,instance,registration,registry,position,clock,nonce,args:{release,abi,rpc:transport.rpc,actor,instance,maxRent:100000000n}};
}
function openOrdinary(f){const rr=f.registration.data.subarray(120),p=f.position.data.subarray(120);rr[80]=0;rr.fill(0,81,89);p[157]=0;p.fill(0,158,199);p.fill(0,215,231);}
async function openK(f){
  openOrdinary(f);const rr=f.registration.data.subarray(120),task=f.map.get(await pda('task',TASK_FAMILY)),generation=task.data.readBigUInt64LE(229),winner=sha256(Buffer.from('HOST-only lifecycle Winner')),id=typedHash(11,Buffer.concat([release.domain,TASK_FAMILY,winner,le(0n)])),body=Buffer.alloc(251);
  TASK_FAMILY.copy(body);winner.copy(body,32);f.instance.copy(body,64);nativeKeyBytes(actor).copy(body,96);f.position.data.subarray(88,120).copy(body,128);body.writeBigUInt64LE(generation,160);body.writeBigUInt64LE(f.position.data.readBigUInt64LE(269),184);body.writeBigUInt64LE(1n,202);body.writeBigUInt64LE(f.position.data.readBigUInt64LE(327),210);body.writeBigInt64LE(f.position.data.readBigInt64LE(319),218);
  const activation=await recordAccount(release,{kind:17,seeds:['bio','activation',id],id,body});f.map.set(activation.address,activation);rr.writeBigUInt64LE(1n,89);id.copy(rr,97);rr[129]=0;rr.fill(0,130,138);
  const slotBody=Buffer.alloc(74);TASK_FAMILY.copy(slotBody);slotBody.writeBigUInt64LE(generation,32);slotBody[40]=1;id.copy(slotBody,41);slotBody[73]=1;
  const slot=await recordAccount(release,{kind:34,seeds:['bio','k-slot',TASK_FAMILY],id:TASK_FAMILY,body:slotBody});f.map.set(slot.address,slot);f.registry.data.writeBigUInt64LE(1n,144);f.registry.data.writeBigUInt64LE(1n,152);
  return {activation,slot,task,id};
}
const call=(f,kind,extra={})=>planPlayerLifecycleAction({...f.args,kind,...extra});

test('genuine current76b closed BIO transfers with exact88-byte payload, immutable history and no recipient signer',async()=>{
  const f=await fixture(),newOwner=key(20),out=await call(f,'transfer',{newOwner});assert.equal(out.decision,'ACTION');assert.equal(out.action.operation,'TRANSFER_ROOT');assert.equal(out.action.payload.length,88);assert.equal(out.action.dynamicAccounts.length,0);assert.equal(out.action.suffix.length,3);assert.equal(out.action.instruction.accounts.length,11);
  const p=decodeNativeFrame(abi,out.action.frame).payload;assert.deepEqual(p.subarray(0,32),f.instance);assert.equal(p.readBigUInt64LE(32),f.root.data.readBigUInt64LE(354));assert.equal(p.readBigUInt64LE(40),f.registration.data.readBigUInt64LE(152));assert.deepEqual(p.subarray(48,80),nativeKeyBytes(newOwner));assert.equal(p.readBigUInt64LE(80),f.args.maxRent);
  assert.equal(out.preview.oldOwner,actor);assert.equal(out.preview.newOwner,newOwner);assert.equal(out.preview.nextRootRevision,out.preview.rootRevision+1n);assert.equal(out.preview.beneficiary,actor);assert.equal(out.preview.preservesHistoricalBeneficiaries,true);assert.equal(out.preview.historicalDebtMustBeClaimed,false);assert.equal(out.transactionExecuted,false);assert.equal(out.networkSubmitted,false);assert.equal(out.rentSufficiencyVerified,false);
  assert.ok(!out.action.instruction.accounts.some(a=>a.address===newOwner));assert.ok(f.calls.every(r=>['getGenesisHash','getMultipleAccounts'].includes(r.method)));
});

test('HOST-only unpaid historical debt does not prevent transfer or move its immutable beneficiary',async()=>{
  const f=await fixture();f.position.data.writeBigUInt64LE(f.position.data.readBigUInt64LE(351)+7n,351);const out=await call(f,'transfer',{newOwner:key(20)});assert.equal(out.decision,'ACTION');assert.equal(out.preview.lastPositionUnpaid,7n);assert.equal(out.preview.beneficiary,actor);assert.equal(out.preview.historicalDebtMustBeClaimed,false);
});

test('HOST-only never-registered Root accepts missing canonical RootReg/Registry and missing recipient',async()=>{
  const f=await fixture();f.map.delete(f.registration.address);f.map.delete(f.registry.address);const out=await call(f,'transfer',{newOwner:key(20)});assert.equal(out.decision,'ACTION');assert.equal(out.preview.registrationRevision,0n);assert.equal(out.preview.nextRegistrationRevision,1n);assert.equal(out.preview.historicalPositionCount,0n);assert.equal(out.preview.beneficiary,null);
});

test('HOST-only ordinary EXIT binds last open Position and enqueues one fresh capped event with exact56-byte payload',async()=>{
  const f=await fixture();openOrdinary(f);const out=await call(f,'exit');assert.equal(out.decision,'ACTION');assert.equal(out.action.payload.length,56);assert.equal(out.action.dynamicAccounts.length,0);assert.equal(out.action.suffix.length,5);assert.equal(out.action.instruction.accounts.length,13);assert.equal(out.preview.ordinaryEnd,342n);assert.deepEqual(out.preview.events,[{kind:'ORDINARY_END',sequence:122n,due:342n}]);assert.equal(out.preview.nextRootRevision,out.preview.rootRevision);assert.equal(out.preview.nextRegistrationRevision,out.preview.registrationRevision+1n);
  assert.deepEqual(out.action.suffix.map(s=>s.name),['Registry','Root','RootReg','Position','OrdinaryEndEvent']);assert.equal(out.action.suffix[3].address,f.position.address);
});

test('HOST-only K EXIT binds Task/KSlot/Activation/current Position and appends K END before ordinary END',async()=>{
  const f=await fixture(),k=await openK(f),out=await call(f,'exit');assert.equal(out.decision,'ACTION');assert.equal(out.action.instruction.accounts.length,17);assert.equal(out.action.dynamicAccounts.length,4);assert.equal(out.preview.kEnd,342n);assert.equal(out.preview.ordinaryEnd,342n);assert.deepEqual(out.preview.events,[{kind:'K_END',sequence:122n,due:342n},{kind:'ORDINARY_END',sequence:123n,due:342n}]);
  assert.deepEqual(out.action.dynamicAccounts.map(a=>a.address),[k.task.address,k.slot.address,k.activation.address,await pda('mining-event',le(122n))]);assert.ok(out.action.dynamicAccounts.every(a=>a.writable&&!a.signer));assert.equal(out.action.suffix[4].address,await pda('mining-event',le(123n)));assert.equal(new Set(out.action.instruction.accounts.map(a=>a.address)).size,17);
});

test('HOST-only EXIT past emission end preserves physical ordinary end while capping K and both event due values',async()=>{
  const f=await fixture();await openK(f);f.clock.data.writeBigInt64LE(release.rewardStart+(H_END+5n)*3600n+1n,32);const out=await call(f,'exit');assert.equal(out.decision,'ACTION');assert.equal(out.preview.ordinaryEnd,H_END+6n);assert.equal(out.preview.kEnd,H_END);assert.ok(out.preview.events.every(e=>e.due===H_END));
});

test('field/runtime injection, invalid recipient/ABI/RPC and unknown kind reject before any fetch',async()=>{
  const f=await fixture();
  for(const extra of [{kind:'transfer',newOwner:actor},{kind:'transfer',newOwner:PROGRAMS.systemProgram},{kind:'transfer',newOwner:release.input.programId},{kind:'transfer',newOwner:PROGRAMS.tokenProgram},{kind:'transfer',newOwner:release.pdas.labMint.address},{kind:'transfer'},{kind:'exit',newOwner:undefined},{kind:'exit',quality:2000000},{kind:'exit',runtime:{}},{kind:'stake'},{kind:'exit',maxRent:1},{kind:'exit',rpc:{}},{kind:'exit',abi:{hash:abi.hash}}])await assert.rejects(planPlayerLifecycleAction({...f.args,...extra}));
  assert.equal(f.calls.length,0);
});

test('HOST-only transfer enforces end boundaries and coverage, without requiring prior claims',async()=>{
  {const f=await fixture();openOrdinary(f);assert.equal((await call(f,'transfer',{newOwner:key(20)})).decision,'ORDINARY_EXIT_REQUIRED');}
  {const f=await fixture();await openK(f);assert.equal((await call(f,'transfer',{newOwner:key(20)})).decision,'K_AWARE_EXIT_REQUIRED');}
  {const f=await fixture();f.registration.data.writeBigUInt64LE(342n,201);f.position.data.writeBigUInt64LE(342n,278);assert.equal((await call(f,'transfer',{newOwner:key(20)})).decision,'WAIT_ORDINARY_END');}
  {const f=await fixture();f.registration.data.writeBigUInt64LE(0n,258);f.registration.data.writeBigUInt64LE(340n,266);assert.equal((await call(f,'transfer',{newOwner:key(20)})).decision,'HISTORICAL_COVERAGE_REQUIRED');}
  {const f=await fixture();f.position.data.writeBigUInt64LE(340n,367);await assert.rejects(call(f,'transfer',{newOwner:key(20)}),/COVERED_POSITION/);}
});

test('HOST-only owner/consumption/certificate/waiting conditions return no action',async()=>{
  {const f=await fixture();nativeKeyBytes(key(20)).copy(f.root.data,322);const out=await call(f,'transfer',{newOwner:key(21)});assert.equal(out.decision,'OWNER_MISMATCH');assert.equal(out.action,undefined);}
  {const f=await fixture();f.root.data[362]=1;hash('HOST parent').copy(f.root.data,363);hash('HOST consume').copy(f.root.data,395);f.root.data.writeBigInt64LE(f.root.data.readBigInt64LE(306),427);f.root.data.writeBigUInt64LE(f.root.data.readBigUInt64LE(314),435);assert.equal((await call(f,'transfer',{newOwner:key(20)})).decision,'INPUT_ALREADY_CONSUMED');}
  {const f=await fixture();f.registration.data[323]=1;hash('HOST certificate fault').copy(f.registration.data,324);assert.equal((await call(f,'transfer',{newOwner:key(20)})).decision,'CERTIFICATE_FAULT');}
  {const f=await fixture();openOrdinary(f);f.position.data.writeBigUInt64LE(342n,269);f.position.data.writeBigUInt64LE(342n,367);assert.equal((await call(f,'exit')).decision,'WAIT_POSITION_START');}
  {const f=await fixture();assert.equal((await call(f,'exit')).decision,'ALREADY_EXITED');}
});

test('HOST-only malformed K crosslinks, stale slot generation, unqueued start and reused events fail closed',async()=>{
  for(const change of [k=>k.slot.data.writeBigUInt64LE(14n,152),k=>k.slot.data[161]^=1,k=>k.activation.data[248]^=1,k=>k.activation.data[216]^=1,k=>k.activation.data.writeBigUInt64LE(2n,288)]){const f=await fixture(),k=await openK(f);change(k);await assert.rejects(call(f,'exit'));}
  {const f=await fixture();await openK(f);f.registry.data.writeBigUInt64LE(0n,152);await assert.rejects(call(f,'exit'),/K_COUNTERS/);}
  {const f=await fixture();await openK(f);const address=await pda('mining-event',le(122n));f.map.set(address,{address,owner:release.input.programId,executable:false,data:Buffer.from([1]),lamports:1n,rentEpoch:0n});await assert.rejects(call(f,'exit'),/EVENT_NOT_FRESH/);}
  {const f=await fixture();openOrdinary(f);f.registry.data.writeBigUInt64LE(343n,176);await assert.rejects(call(f,'exit'),/EVENT_ORDER/);}
});

test('HOST-only final coherent reread detects nonce/cache/account/event races and boundary crossings',async()=>{
  for(const change of [f=>f.nonce.data.writeBigUInt64LE(f.nonce.data.readBigUInt64LE(120)+1n,120),f=>f.nonce.data[129]^=1,f=>f.root.lamports+=1n,f=>f.registry.data.writeBigUInt64LE(123n,160),f=>f.clock.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)+3600n,32)]){
    let f;f=await fixture(({reads})=>{if(reads===3)change(f);});const out=await call(f,'transfer',{newOwner:key(20)});assert.equal(out.decision,'REPLAN_STALE_STATE');assert.equal(out.action,undefined);
  }
  let f;f=await fixture(({reads})=>{if(reads===3)f.clock.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)-1n,32);});await assert.rejects(call(f,'transfer',{newOwner:key(20)}),/CLOCK_REGRESSION/);
});

test('HOST-only existing nonwallet recipient, foreign RootReg and exhausted counters cannot produce an action',async()=>{
  {const f=await fixture(),newOwner=key(20);f.map.set(newOwner,{address:newOwner,owner:PROGRAMS.tokenProgram,executable:false,data:Buffer.alloc(0),lamports:0n,rentEpoch:0n});await assert.rejects(call(f,'transfer',{newOwner}),/RECIPIENT_WALLET/);}
  {const f=await fixture();f.registration.owner=PROGRAMS.tokenProgram;await assert.rejects(call(f,'transfer',{newOwner:key(20)}),/ACCOUNT_OWNER/);}
  {const f=await fixture();openOrdinary(f);f.registration.data.writeBigUInt64LE(MAX,152);await assert.rejects(call(f,'exit'),/COUNTER_EXHAUSTED/);}
  {const f=await fixture();await openK(f);f.registry.data.writeBigUInt64LE(MAX-1n,160);await assert.rejects(call(f,'exit'),/COUNTER_EXHAUSTED/);}
});

test('HOST-only Task high-water and counter room, pending K end and final event race remain explicit',async()=>{
  {const f=await fixture(),k=await openK(f);k.task.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)+1n,247);const out=await call(f,'exit');assert.equal(out.decision,'WAIT_CLOCK');assert.equal(out.action,undefined);}
  {const f=await fixture(),k=await openK(f);k.task.data.writeBigUInt64LE(MAX,156);k.task.data.writeBigUInt64LE(MAX,229);k.slot.data.writeBigUInt64LE(MAX,152);await assert.rejects(call(f,'exit'),/COUNTER_EXHAUSTED/);}
  {const f=await fixture(),b=f.registration.data.subarray(120);b.writeBigUInt64LE(1n,89);hash('HOST ended K').copy(b,97);b.writeBigUInt64LE(342n,130);const out=await call(f,'transfer',{newOwner:key(20)});assert.equal(out.decision,'WAIT_K_END');assert.equal(out.action,undefined);}
  {let f;f=await fixture(({reads})=>{if(reads===3){const address=f.eventAddress;f.map.set(address,{address,owner:PROGRAMS.systemProgram,executable:false,data:Buffer.alloc(0),lamports:1n,rentEpoch:0n});}});openOrdinary(f);f.eventAddress=await pda('mining-event',le(122n));const out=await call(f,'exit');assert.equal(out.decision,'REPLAN_STALE_STATE');assert.equal(out.action,undefined);}
});

test('forward Clock within the same hour uses final observed time while normal slot advancement remains usable',async()=>{
  let f;f=await fixture(({reads})=>{if(reads===3){f.clock.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)+1n,32);f.clock.data.writeBigUInt64LE(f.clock.data.readBigUInt64LE(0)+1n,0);}});const out=await call(f,'transfer',{newOwner:key(20)});assert.equal(out.decision,'ACTION');assert.equal(out.preview.newOwner,key(20));
});

test('repeated read-only lifecycle requests preserve exact nonce/frame and never reserve, pay or send',async()=>{
  const f=await fixture(),before=Buffer.from(f.root.data),x=await call(f,'transfer',{newOwner:key(20)}),y=await call(f,'transfer',{newOwner:key(20)});assert.deepEqual(x.action.frame,y.action.frame);assert.equal(x.action.nonce,y.action.nonce);assert.equal(x.reservesOnChainNonce,false);assert.deepEqual(f.root.data,before);assert.ok(f.calls.every(r=>['getGenesisHash','getMultipleAccounts'].includes(r.method)));
});

const hash=label=>sha256(Buffer.from(label));
