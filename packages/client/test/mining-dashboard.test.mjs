import test from 'node:test';
import assert from 'node:assert/strict';
import { typedHash, ByteWriter, sha256 } from '../../protocol-core/src/index.mjs';
import { TASK_FAMILY } from '../../originality/src/wire.mjs';
import { H_END, TOTAL_SUPPLY, emissionPrefix } from '../../settlement/src/emission.mjs';
import { K_WEIGHT, W_FLOOR } from '../../settlement/src/weights.mjs';
import { PROGRAMS } from '../src/release.mjs';
import { nativeKeyAddress, nativeKeyBytes } from '../src/native.mjs';
import { readMiningDashboard, planGuidedGlobalSettlement, planGuidedHourClosure } from '../src/mining-dashboard.mjs';
import { checkpoint, cloneAccounts, release, abi, actor, pda, le, recordedTransport } from './synthesis-fixture.mjs';
import { key } from './native-fixture.mjs';
import { recordAccount } from './account-fixture.mjs';

const MAX=(1n<<64n)-1n,hash=s=>sha256(Buffer.from(s));
// Default records are genuine unchanged current76b SBF checkpoint observations.
// Alternative books/histories/cached K states below are HOST-only read fixtures.
async function fixture(onRead){
  const map=cloneAccounts(checkpoint),root=[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===761&&a.data.readUInt16LE(12)===4),instance=Buffer.from(root.data.subarray(120,152)),registration=map.get(await pda('root-reg',instance)),registry=map.get(await pda('mining')),position=map.get(await pda('reg',instance,le(0n))),directory=map.get(await pda('mining-root',le(registration.data.readBigUInt64LE(364)))),clock=map.get(PROGRAMS.clockSysvar),nonce=map.get(await pda('actor-nonce',nativeKeyBytes(actor))),treasury=map.get(await pda('treasury')),mint=map.get(release.pdas.labMint.address),reserve=map.get(release.pdas.labReserve.address);
  const t=recordedTransport({local:map},'local',{strict:false,onRead});return {...t,map,root,instance,registration,registry,position,directory,clock,nonce,treasury,mint,reserve,read:{release,rpc:t.rpc,actor,instances:[instance]},plan:{release,abi,rpc:t.rpc,actor,maxRent:100000000n}};
}
function noActiveMembers(f){const b=f.registry.data.subarray(120);b.writeBigUInt64LE(0n,64);for(const at of [72,80])b.writeBigUInt64LE(MAX,at);b.fill(0,88,104);b.writeBigUInt64LE(b.readBigUInt64LE(40),48);const d=f.directory.data.subarray(120);d[81]=0;d.fill(0,82,122);d.writeBigUInt64LE(MAX,122);d.writeBigUInt64LE(MAX,130);}
async function oldProcessedNewPosition(f){
  const old=f.position.data.subarray(120),next=Buffer.from(old),newOwner=key(20),instance=f.instance,seq=1n;
  old.writeBigUInt64LE(old.readBigUInt64LE(231)+7n,231);f.treasury.data.writeBigUInt64LE(f.treasury.data.readBigUInt64LE(136)+7n,136);f.treasury.data.writeBigUInt64LE(f.treasury.data.readBigUInt64LE(144)-7n,144);next.writeBigUInt64LE(seq,32);hash('HOST next stake business').copy(next,48);nativeKeyBytes(newOwner).copy(next,80);next.writeBigUInt64LE(1n,112);next.writeBigUInt64LE(342n,149);next[157]=0;next.fill(0,158,199);next.writeBigInt64LE(f.clock.data.readBigInt64LE(32),199);next.writeBigUInt64LE(f.clock.data.readBigUInt64LE(0),207);next.fill(0,215,247);next.writeBigUInt64LE(342n,247);
  const id=typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(27).finish(),instance,le(seq)])),info=await recordAccount(release,{kind:27,schema:2,seeds:['bio','reg',instance,le(seq)],id,body:next});f.map.set(info.address,info);
  const rr=f.registration.data.subarray(120);rr.writeBigUInt64LE(2n,40);id.copy(rr,48);rr[80]=0;rr.fill(0,81,89);nativeKeyBytes(newOwner).copy(f.root.data,322);f.root.data.writeBigUInt64LE(1n,354);return {info,newOwner};
}
async function cachedK(f){
  const winner=hash('HOST cached K Winner'),id=typedHash(11,Buffer.concat([release.domain,TASK_FAMILY,winner,le(0n)])),b=Buffer.alloc(251);TASK_FAMILY.copy(b);winner.copy(b,32);f.instance.copy(b,64);nativeKeyBytes(actor).copy(b,96);f.position.data.subarray(88,120).copy(b,128);b.writeBigUInt64LE(1n,160);b.writeBigUInt64LE(339n,184);b[192]=1;b.writeBigUInt64LE(341n,193);b[201]=2;b.writeBigUInt64LE(1n,202);b.writeBigUInt64LE(10n,210);b.writeBigInt64LE(f.position.data.readBigInt64LE(319),218);b[226]=1;b.writeBigUInt64LE(2n,227);b.writeBigUInt64LE(10n,235);b.writeBigInt64LE(f.clock.data.readBigInt64LE(32),243);
  const info=await recordAccount(release,{kind:17,seeds:['bio','activation',id],id,body:b});f.map.set(info.address,info);const rg=f.registry.data.subarray(120);rg.writeBigUInt64LE(1n,24);rg.writeBigUInt64LE(1n,32);id.copy(rg,104);f.instance.copy(rg,136);nativeKeyBytes(actor).copy(rg,168);f.position.data.subarray(88,120).copy(rg,200);rg.writeBigUInt64LE(f.registration.data.readBigUInt64LE(364),232);rg.writeBigUInt64LE(K_WEIGHT,240);return info;
}

test('genuine76b dashboard shows processed frontier, exact0.941780LAB BIO history, book and shared floor without payout promises',async()=>{
  const f=await fixture(),r=await readMiningDashboard(f.read),s=r.summary;assert.equal(r.decision,'MINING_READ');assert.equal(s.emission.totalSupplyLAB,'100000000');assert.equal(s.emission.totalSupplyAtoms,String(TOTAL_SUPPLY));assert.equal(s.emission.processedFrontier,'341');assert.equal(s.emission.maturedHours,'341');assert.equal(s.emission.backlogHours,'0');assert.equal(s.processedWeights.normalWeight,'95040000000000');assert.equal(s.processedWeights.denominator,String(W_FLOOR));assert.equal(s.processedWeights.sharedFloorApplications,1);assert.equal(s.processedWeights.currentWallClockDenominatorGuaranteed,false);assert.equal(s.futureDailyPayoutGuaranteed,false);
  assert.equal(s.roots[0].positions[0].accruedAtoms,'941780');assert.equal(s.roots[0].positions[0].paidAtoms,'941780');assert.equal(s.claimable.actorAtoms,'0');assert.equal(s.treasury.manufactureBurnedAtoms,'48000000');assert.equal(s.knownProcessedOrdinaryWeight,'95040000000000');assert.equal(s.roots[0].ordinaryEnd,'341');assert.equal(s.roots[0].activeProcessedDirectory.currentSequence,'0');assert.doesNotThrow(()=>JSON.stringify(s));assert.ok(f.calls.every(r=>['getGenesisHash','getMultipleAccounts'].includes(r.method)));
});

test('global overview permits no IDs and pages disclose only bounded known rows',async()=>{
  const f=await fixture(),r=await readMiningDashboard({...f.read,instances:[]});assert.equal(r.decision,'MINING_READ');assert.equal(r.summary.roots.length,0);assert.equal(r.summary.knownRootsOnly,true);assert.equal(r.summary.walletDiscoveryComplete,false);assert.equal(r.summary.claimable.walletTotalKnown,false);assert.equal(r.summary.claimable.listedPositionCount,0);
  const page=await readMiningDashboard({...f.read,positionPageStart:1n});assert.equal(page.summary.roots[0].positions.length,0);assert.equal(page.summary.claimable.actorAtoms,'0');
});

test('HOST-only processed Directory can retain old sequence while latest RootReg belongs to a later stake and different owner',async()=>{
  const f=await fixture(),alt=await oldProcessedNewPosition(f),r=await readMiningDashboard(f.read),s=r.summary;assert.equal(s.roots[0].owner,alt.newOwner);assert.equal(s.roots[0].ordinaryCount,'2');assert.equal(s.roots[0].activeProcessedDirectory.currentSequence,'0');assert.equal(s.roots[0].positions[1].sequence,'1');assert.equal(s.roots[0].positions[1].beneficiary,alt.newOwner);assert.equal(s.claimable.actorAtoms,'7');assert.equal(s.roots[0].actorFutureOrdinaryWeight,'0');assert.equal(s.knownProcessedOrdinaryWeight,s.processedWeights.normalWeight);
  const page=await readMiningDashboard({...f.read,positionPageStart:1n,positionPageLimit:1});assert.equal(page.summary.claimable.actorAtoms,'0');assert.equal(page.summary.claimable.scope,'LISTED_POSITION_PAGES_ONLY');assert.equal(page.summary.roots[0].activeProcessedDirectory.position.claimableAtoms,'7');
});

test('genuine consumed component retains historical Position while future eligible weight is zero',async()=>{
  const f=await fixture(),part=[...f.map.values()].find(a=>a.owner===release.input.programId&&a.data.length>443&&a.data.readUInt16LE(10)===12&&a.data.readUInt16LE(12)===1&&a.data[362]===1),id=part.data.subarray(120,152),r=await readMiningDashboard({...f.read,instances:[id]});assert.equal(r.summary.roots[0].lifecycle,1);assert.equal(r.summary.roots[0].futureOrdinaryWeight,'0');assert.equal(r.summary.roots[0].actorFutureOrdinaryWeight,'0');assert.equal(r.summary.roots[0].positions.length,1);assert.equal(r.summary.roots[0].intrinsicOrdinaryWeight,'480000000000');
});

test('HOST-only corruption of genuine checkpoint debt beyond actual certified treasury is rejected',async()=>{
  const f=await fixture();assert.equal(f.treasury.data.readBigUInt64LE(136),0n);f.position.data.writeBigUInt64LE(f.position.data.readBigUInt64LE(351)+1n,351);await assert.rejects(readMiningDashboard(f.read),/MINING_LISTED_DEBT_EXCEEDS_CERTIFIED/);
});

test('HOST-only cached K validates actual Activation/Directory/beneficiary and shares exactly one combined floor',async()=>{
  const f=await fixture(),info=await cachedK(f),r=await readMiningDashboard(f.read),s=r.summary;assert.equal(s.currentK.processedActive,true);assert.equal(s.currentK.physicalIntervalOpen,false);assert.equal(s.currentK.withinWallClockInterval,false);assert.equal(s.currentK.ordinarySequence,'0');assert.equal(s.processedWeights.kWeight,String(K_WEIGHT));assert.equal(s.processedWeights.combinedWeight,String(95040000000000n+K_WEIGHT));assert.equal(s.processedWeights.denominator,String(W_FLOOR));assert.equal(s.processedWeights.sharedFloorApplications,1);assert.equal(s.claimable.actorAtoms,'0');
  info.data[216]^=1;await assert.rejects(readMiningDashboard(f.read),/K_LINK/);
});

test('HOST-only reserve donations and external burns are visible but create no reward entitlement',async()=>{
  const f=await fixture(),before=(await readMiningDashboard(f.read)).summary;f.reserve.data.writeBigUInt64LE(f.reserve.data.readBigUInt64LE(64)+7n,64);f.mint.data.writeBigUInt64LE(f.mint.data.readBigUInt64LE(36)-5n,36);const r=await readMiningDashboard(f.read),s=r.summary;assert.equal(s.treasury.unsolicitedReserveAtoms,'7');assert.equal(s.treasury.externalBurnedAtoms,'5');assert.equal(s.treasury.certifiedAtoms,before.treasury.certifiedAtoms);assert.equal(s.treasury.pendingAtoms,before.treasury.pendingAtoms);assert.equal(s.claimable.actorAtoms,'0');assert.equal(s.treasury.donationsCreateRewards,false);assert.equal(s.treasury.externalBurnsCreateRewards,false);
});

test('HOST-only inactive backlog and missing initial registry/RootReg remain explicit valid states',async()=>{
  {const f=await fixture();noActiveMembers(f);f.clock.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)+7200n,32);const r=await readMiningDashboard(f.read);assert.equal(r.summary.emission.backlogHours,'2');assert.equal(r.summary.processedWeights.normalWeight,'0');assert.equal(r.summary.roots[0].activeProcessedDirectory,null);assert.equal(r.summary.emission.notYetSynchronizedAtoms,String(emissionPrefix(343n)-emissionPrefix(341n)));}
  {const f=await fixture(),part=[...f.map.values()].find(a=>a.owner===release.input.programId&&a.data.length>443&&a.data.readUInt16LE(10)===12&&a.data.readUInt16LE(12)===1),id=part.data.subarray(120,152);part.data[362]=0;part.data.fill(0,363,443);f.map.delete(f.registry.address);f.map.delete(await pda('root-reg',id));const r=await readMiningDashboard({...f.read,instances:[id]});assert.equal(r.summary.processedWeights.registryInitialized,false);assert.equal(r.summary.processedWeights.rootCount,'0');assert.equal(r.summary.roots[0].registered,false);assert.equal(r.summary.roots[0].ordinaryCount,'0');assert.equal(r.summary.roots[0].futureOrdinaryWeight,'480000000000');}
});

test('HOST-only fully processed emission end is distinct from merely elapsed time and stops potential future weight',async()=>{
  const f=await fixture();noActiveMembers(f);f.clock.data.writeBigInt64LE(release.rewardStart+H_END*3600n+1n,32);f.registry.data.writeBigUInt64LE(H_END,128);const t=f.treasury.data.subarray(120);t.fill(0,0,24);t.writeBigUInt64LE(f.reserve.data.readBigUInt64LE(64),24);t.writeBigUInt64LE(H_END,40);
  const r=await readMiningDashboard(f.read);assert.equal(r.summary.emission.scheduleEnded,true);assert.equal(r.summary.emission.emissionClosed,true);assert.equal(r.summary.emission.backlogHours,'0');assert.equal(r.summary.roots[0].futureOrdinaryWeight,'0');const planned=await planGuidedGlobalSettlement(f.plan);assert.equal(planned.decision,'EMISSION_FRONTIER_COMPLETE');assert.equal(planned.action,undefined);
});

test('malformed fields/duplicate IDs/RPC/ABI are rejected before fetch; invalid account books fail closed',async()=>{
  const f=await fixture();for(const x of [{instances:[f.instance,f.instance]},{instances:Array(5).fill(f.instance)},{positionPageLimit:6},{positionPageStart:0},{runtime:{}},{rpc:{}}])await assert.rejects(readMiningDashboard({...f.read,...x}));for(const x of [{maxRent:1},{runtime:{}},{abi:{hash:abi.hash}},{rpc:{}}])await assert.rejects(planGuidedGlobalSettlement({...f.plan,...x}));assert.equal(f.calls.length,0);
  f.reserve.data.writeBigUInt64LE(0n,64);await assert.rejects(readMiningDashboard(f.read),/TREASURY_BALANCES/);
});

test('HOST-only dashboard detects final nonce/book/Clock/dependent-record races without returning a stale summary',async()=>{
  for(const mutate of [f=>f.nonce.data.writeBigUInt64LE(f.nonce.data.readBigUInt64LE(120)+1n,120),f=>f.reserve.data.writeBigUInt64LE(f.reserve.data.readBigUInt64LE(64)+1n,64),f=>f.position.data.writeBigUInt64LE(f.position.data.readBigUInt64LE(351)+1n,351),f=>f.clock.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)+3600n,32)]){let f;f=await fixture(({reads})=>{if(reads===4)mutate(f);});const r=await readMiningDashboard(f.read);assert.equal(r.decision,'REPLAN_STALE_STATE');assert.equal(r.summary,undefined);}
  let f;f=await fixture(({reads})=>{if(reads===4)f.clock.data.writeBigUInt64LE(9n,0);});await assert.rejects(readMiningDashboard(f.read),/CLOCK_REGRESSION/);
});

test('genuine one-step global wrapper plans queued END only, validates full book and does not send or promise player accrual',async()=>{
  const f=await fixture(),out=await planGuidedGlobalSettlement(f.plan);assert.equal(out.decision,'ACTION');assert.equal(out.action.operation,'APPLY_EVENT');assert.equal(out.action.nonce,23652n);assert.equal(out.oneStepOnly,true);assert.equal(out.summary.processedWeights.eventCursor,'121');assert.equal(out.transactionExecuted,false);assert.equal(out.rentSufficiencyVerified,false);assert.ok(f.calls.every(r=>['getGenesisHash','getMultipleAccounts'].includes(r.method)));
});

test('HOST-only one-step global distinguishes WAIT, empty skip and initial SYNC using the existing keeper',async()=>{
  {const f=await fixture();noActiveMembers(f);const r=await planGuidedGlobalSettlement(f.plan);assert.equal(r.decision,'WAIT_COMPLETED_HOUR');assert.equal(r.action,undefined);}
  {const f=await fixture();noActiveMembers(f);f.clock.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)+7200n,32);const r=await planGuidedGlobalSettlement(f.plan);assert.equal(r.action.operation,'EMPTY_SKIP');assert.equal(r.action.payload.readBigUInt64LE(8),343n);}
  {const f=await fixture();f.map.delete(f.registry.address);const r=await planGuidedGlobalSettlement(f.plan);assert.equal(r.action.operation,'SYNC_EMISSION');}
});

test('HOST-only keeper final closure notices raw nonce cache and dependent Event drift beyond keeper Registry-only guard',async()=>{
  for(const phase of [2,3]){let f,fullReads=0;f=await fixture(({addresses})=>{if(addresses.includes(release.pdas.labMint.address)&&++fullReads===phase){if(phase===2)f.nonce.data[129]^=1;else{const event=[...f.map.values()].find(a=>a.owner===release.input.programId&&a.data.length===297&&a.data.readUInt16LE(10)===38&&a.data.readBigUInt64LE(120)===121n);event.data[249]^=1;}}});const r=await planGuidedGlobalSettlement(f.plan);assert.equal(r.decision,'REPLAN_STALE_STATE');assert.equal(r.action,undefined);}
});

test('genuine complete Hour closure returns actual saved balance exclusively to original opener even with another cranker',async()=>{
  const f=await fixture(),cranker=key(20);f.map.set(cranker,{address:cranker,owner:PROGRAMS.systemProgram,executable:false,data:Buffer.alloc(0),lamports:100000000n,rentEpoch:0n});const r=await planGuidedHourClosure({...f.plan,actor:cranker,hour:340n});assert.equal(r.decision,'ACTION');assert.equal(r.action.operation,'CLOSE_FINAL_HOUR');assert.equal(r.preview.refundRecipient,actor);assert.equal(r.action.refundRecipient,actor);assert.equal(r.preview.observedRefundLamports,4245600n);assert.equal(r.preview.rentMinimumQuoted,false);assert.equal(r.preview.rewardsChanged,false);assert.deepEqual(r.action.dynamicAccounts,[{address:actor,writable:true,signer:false}]);
});

test('HOST-only incomplete/missing Hour blocks closure and refund/nonce races or overflow fail safely',async()=>{
  {const f=await fixture(),h=f.map.get(await pda('hour',le(340n)));h.data[160]=3;h.data.writeBigUInt64LE(0n,385);const r=await planGuidedHourClosure({...f.plan,hour:340n});assert.equal(r.decision,'HOUR_NOT_CLOSABLE');assert.equal(r.action,undefined);}
  {const f=await fixture(),r=await planGuidedHourClosure({...f.plan,hour:342n});assert.equal(r.decision,'HOUR_UNAVAILABLE');}
  {let f;f=await fixture(({reads})=>{if(reads===3)f.nonce.data[129]^=1;});const r=await planGuidedHourClosure({...f.plan,hour:340n});assert.equal(r.decision,'REPLAN_STALE_STATE');assert.equal(r.action,undefined);}
  {const f=await fixture();f.map.get(actor).lamports=MAX;await assert.rejects(planGuidedHourClosure({...f.plan,hour:340n}),/REFUND_OVERFLOW/);}
});
