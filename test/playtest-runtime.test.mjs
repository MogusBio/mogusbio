import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaytestRuntime,preparePlaytestCheckpoint,restorePlaytestRuntime} from '../apps/playtest/runtime.mjs';

const checkpoint=await preparePlaytestCheckpoint();
const fresh=()=>createPlaytestRuntime({checkpoint});
const str=v=>JSON.stringify(v);

test('ready local account is funded through real part rewards with separate unused material and exact conservation',async()=>{
  const runtime=await fresh(),s=runtime.snapshot();assert.equal(s.mode,'LOCAL_PROTOCOL_MODEL');assert.deepEqual(s.materials.map(x=>x.amount),['30','60','15','15']);assert.equal(s.works.length,60);assert.ok(s.works.every(w=>w.scope==='COMPONENT'&&!w.staked));assert.ok(BigInt(s.lab.balanceAtoms)>=48_000_000n);assert.equal(s.lab.manufactureBurnedAtoms,'0');assert.equal(s.lab.unclaimedAtoms,'0');assert.equal(s.testHour,'338');assert.equal(s.kits[0].canConsume,true);assert.equal(s.kits[1].canConsume,false);assert.equal(s.kits[0].upgradeCostAtoms,'12000000');assert.equal(s.nextActions.find(a=>a.action==='synthesize-cells').costAtoms,'12000000');assert.equal(s.ledgerInvariant.totalAtoms,'100000000000000');assert.equal(s.scope.nativeExecutionVerified,false);assert.ok(Buffer.byteLength(str(checkpoint))<12*1024*1024);assert.ok(Buffer.byteLength(str(s))<256*1024);
});
test('clickable buy manufacture cells organs bio stake time claim exit uses real module accounting',async()=>{
  const runtime=await fresh(),start=runtime.snapshot();let s=runtime.execute({action:'buy-kit'});assert.deepEqual(s.materials.map(x=>x.amount),['60','120','30','30']);assert.ok(BigInt(s.testSOL.balanceLamports)<BigInt(start.testSOL.balanceLamports));const kitId=s.selectedKitId;
  s=runtime.execute({action:'manufacture-kit',params:{kitId}});assert.deepEqual(s.materials.map(x=>x.amount),['30','60','15','15']);assert.equal(s.counts.live,120);assert.equal(s.counts.consumed,0);assert.equal(s.lab.balanceAtoms,start.lab.balanceAtoms);
  s=runtime.execute({action:'synthesize-cells',params:{kitId}});assert.equal(s.kits.find(k=>k.id===kitId).stage,'CELLS');assert.equal(s.counts.live,75);assert.equal(s.counts.consumed,60);assert.equal(s.lab.manufactureBurnedAtoms,'12000000');
  s=runtime.execute({action:'synthesize-organs',params:{kitId}});assert.equal(s.counts.live,66);assert.equal(s.counts.consumed,75);assert.equal(s.lab.manufactureBurnedAtoms,'36000000');
  s=runtime.execute({action:'synthesize-bio',params:{kitId}});assert.equal(s.counts.live,61);assert.equal(s.counts.consumed,81);assert.equal(s.lab.manufactureBurnedAtoms,'48000000');assert.equal(BigInt(start.lab.balanceAtoms)-BigInt(s.lab.balanceAtoms),48_000_000n);const bio=s.works.find(w=>w.scope==='BIO');assert.equal(bio.name,'完整生物 C310');assert.equal(bio.qualityPpm,'2000000');assert.equal(bio.weight,'95040000000000');
  s=runtime.execute({action:'stake',params:{workId:bio.id}});assert.equal(s.lastResult.startHour,'339');assert.equal(s.works.find(w=>w.id===bio.id).staked,true);assert.equal(s.lab.unclaimedAtoms,'0');
  s=runtime.execute({action:'advance-hour',params:{hours:2}});assert.ok(BigInt(s.lab.unclaimedAtoms)>0n);const reward=BigInt(s.lab.unclaimedAtoms),balance=BigInt(s.lab.balanceAtoms);s=runtime.execute({action:'claim'});assert.equal(BigInt(s.lab.balanceAtoms),balance+reward);assert.equal(s.lab.unclaimedAtoms,'0');
  const afterClaim=str(runtime.exportState());assert.throws(()=>runtime.execute({action:'claim'}),e=>e.code==='PLAYTEST_NOTHING_TO_CLAIM');assert.equal(str(runtime.exportState()),afterClaim);
  s=runtime.execute({action:'exit',params:{workId:bio.id}});assert.equal(s.lastResult.endHour,'341');s=runtime.execute({action:'advance-hour',params:{hours:1}});assert.equal(s.works.find(w=>w.id===bio.id).staked,false);assert.ok(BigInt(s.lab.unclaimedAtoms)>0n);s=runtime.execute({action:'claim'});assert.equal(s.lab.unclaimedAtoms,'0');assert.equal(s.ledgerInvariant.totalAtoms,'100000000000000');assert.equal(s.ledgerInvariant.valid,true);assert.ok(Buffer.byteLength(str(runtime.exportState()))<12*1024*1024);assert.ok(Buffer.byteLength(str(s))<256*1024);
});
test('checkpoint restores and resets are detached and malformed identity is rejected',async()=>{
  const a=await fresh(),b=await fresh(),initial=str(b.exportState());a.execute({action:'buy-kit'});assert.equal(str(b.exportState()),initial);const restored=await restorePlaytestRuntime(JSON.parse(str(a.exportState())));assert.deepEqual(restored.snapshot(),a.snapshot());restored.execute({action:'buy-kit'});assert.notDeepEqual(restored.snapshot().materials,a.snapshot().materials);const reset=await fresh();assert.equal(str(reset.exportState()),initial);await assert.rejects(restorePlaytestRuntime({...checkpoint,ruleHash:'00'.repeat(32)}),e=>e.code==='PLAYTEST_CHECKPOINT_IDENTITY');
});
test('wrong stage, material exhaustion, unknown fields and invalid time fail atomically',async()=>{
  const r=await fresh();for(const action of [{action:'synthesize-bio'},{action:'advance-hour',params:{hours:0}},{action:'advance-hour',params:{hours:25}},{action:'claim'},{action:'stake',params:{workId:'invalid'}},{action:'buy-kit',owner:'intruder'},{action:'buy-kit',params:{hours:24}},{action:'stake',params:{workId:'a'.repeat(64),target:'a'.repeat(64)}},{action:'unknown'}]){const before=str(r.exportState());assert.throws(()=>r.execute(action));assert.equal(str(r.exportState()),before);}
  r.execute({action:'manufacture-kit',params:{kitId:'kit-2'}});assert.deepEqual(r.snapshot().materials.map(x=>x.amount),['0','0','0','0']);const before=str(r.exportState());assert.throws(()=>r.execute({action:'manufacture-kit',params:{kitId:'kit-2'}}),e=>e.code==='PLAYTEST_KIT_STAGE');assert.equal(str(r.exportState()),before);
});
test('staked child blocks parent consumption and startup checkpoint is reused rather than replayed',async()=>{
  const r=await fresh(),p=r.snapshot().works[0];r.execute({action:'stake',params:{workId:p.id}});const before=str(r.exportState());assert.throws(()=>r.execute({action:'synthesize-cells',params:{kitId:'kit-1'}}));assert.equal(str(r.exportState()),before);let progress=0;const cached=await preparePlaytestCheckpoint({onProgress(){progress++;}});assert.equal(progress,0);assert.equal(str(cached),str(checkpoint));
});
test('implicit staking chooses the latest highest available work rather than an older starter part',async()=>{
  const r=await fresh();r.execute({action:'manufacture-kit',params:{kitId:'kit-2'}});const newest=r.snapshot().works[0];const s=r.execute({action:'stake'});assert.equal(s.lastResult.workId,newest.id);assert.equal(s.works.find(w=>w.id===newest.id).staked,true);
});
