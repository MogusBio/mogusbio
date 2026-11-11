import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementEngine, hourBudget, emissionPrefix, GENESIS_SEALED, TOTAL_SUPPLY,
  K_WEIGHT, W_FLOOR, normalWeight, rewardAmount } from '../src/index.mjs';
import { ActiveSettlementIndex } from '../src/event-index.mjs';

const T=3600n,at=h=>T+BigInt(h)*3600n;
const cmd=(e,name,fields,actor='crank')=>e[name]({actor,nonce:e.nextNonce(actor),...fields});
const component=(instance,owner='alice')=>({instance,owner,scope:'COMPONENT',B_int:120000n,q_ppm:1000000n,certificate:`verified:${instance}`});
const bio=()=>({instance:'bio',owner:'alice',scope:'BIO',B_int:7200000n,q_ppm:2000000n,certificate:'verified:bio'});
function ready(e,h,now){
  cmd(e,'openHour',{hour:h,now});
  while(['K_SCAN','ROOT_SCAN'].includes(e.hour(h).status)){
    const r=e.hour(h),s=e.snapshot();
    cmd(e,'scanHour',{hour:h,now,expectedPhase:r.status,expectedCursor:r.status==='K_SCAN'?s.registry.kScanSeq:r.rootCursor,workCount:1});
  }
}
function freeze(e,h,now){ready(e,h,now);cmd(e,'advanceFrozenHour',{hour:h,now});}
function allocate(e,h,id,now){return cmd(e,'materializePosition',{hour:h,intervalId:id,expectedCursor:e.hour(h).materializeCursor,now});}
function sequential(e,h,now){
  ready(e,h,now);
  while(e.hour(h).status!=='FINAL'){
    const r=e.hour(h);cmd(e,'materializeHour',{hour:h,now,expectedCursor:r.materializeCursor,rootCount:Number(r.rootCutoff-r.materializeCursor>8n?8n:r.rootCutoff-r.materializeCursor)});
  }
}

test('ECON4 partial prefix then lazy reverse allocation exactly preserves every old floor and the reserve ledger',()=>{
  const source=new SettlementEngine({rewardStart:T}),ids=[];
  for(const f of [component('p0'),component('p1'),bio()]){
    source.createVerifiedRoot(f);ids.push(cmd(source,'register',{instance:f.instance,now:0n},'alice').intervalId);
  }
  source.acceptFrontier({cost:320n,now:1n});source.acceptWinner({winnerId:'test-only-winner',instance:'bio',author:'alice',cost:320n});
  cmd(source,'activateK',{instance:'bio',winnerId:'test-only-winner',now:2n},'alice');
  const legacy=SettlementEngine.fromSnapshot(source.snapshot()),lazy=SettlementEngine.fromSnapshot(source.snapshot()),now=at(3);
  for(let h=0n;h<3n;h++)sequential(legacy,h,now);
  ready(lazy,0n,now);cmd(lazy,'materializeHour',{hour:0n,now,expectedCursor:0n,rootCount:1});
  const before=lazy.ledger();cmd(lazy,'advanceFrozenHour',{hour:0n,now});assert.deepEqual(lazy.ledger(),before);
  allocate(lazy,0n,ids[2],now);allocate(lazy,0n,ids[1],now);
  freeze(lazy,1n,now);freeze(lazy,2n,now);
  for(const h of [1n,2n])for(const id of [...ids].reverse())allocate(lazy,h,id,now);
  assert.deepEqual(lazy.ledger(),legacy.ledger());
  for(const id of ids)assert.deepEqual(lazy.position(id),legacy.position(id));
  for(let h=0n;h<3n;h++){
    assert.equal(lazy.hour(h).materializedSum,legacy.hour(h).materializedSum);
    assert.equal(lazy.hour(h).sealedResidual,legacy.hour(h).sealedResidual);
  }
  assert.equal(lazy.position(ids[2]).accrued,3n*856164n);
  assert.equal(rewardAmount(hourBudget(0n),normalWeight(bio())+K_WEIGHT,W_FLOOR),856164n);
  assert.equal(lazy.snapshot().registry.nextMaterializeHour,3n);
});

test('ECON4 Alice withholding all old debt does not block Bob exit, own coverage, transfer or future frozen hours',()=>{
  const e=new SettlementEngine({rewardStart:T});
  e.createVerifiedRoot(component('a'));e.createVerifiedRoot(component('b','bob'));
  const a=cmd(e,'register',{instance:'a',now:0n},'alice'),b=cmd(e,'register',{instance:'b',now:0n},'bob');
  cmd(e,'exit',{instance:'b',seq:0n,now:T+1n},'bob');
  freeze(e,0n,at(1));allocate(e,0n,b.intervalId,at(1));
  cmd(e,'transfer',{instance:'b',newOwner:'carol',now:at(1)},'bob');
  assert.equal(e.position(a.intervalId).accrued,0n);assert.equal(e.hour(0n).status,'MATERIALIZING');
  const replacement=cmd(e,'register',{instance:'b',now:at(1)},'carol');assert.equal(replacement.start,2n);
  freeze(e,1n,at(2));freeze(e,2n,at(3));
  allocate(e,2n,replacement.intervalId,at(3));
  for(const h of [0n,1n,2n])allocate(e,h,a.intervalId,at(3));
  assert.equal(e.snapshot().registry.nextMaterializeHour,3n);
  assert.equal(e.position(a.intervalId).accrued,7134n);assert.equal(e.position(b.intervalId).accrued,2378n);
  cmd(e,'claimPosition',{now:at(3),intervalId:b.intervalId,expectedPaid:0n,upToAccrued:2378n,destinationOwner:'bob'});
  assert.equal(e.balance('bob'),2378n);assert.equal(e.balance('carol'),0n);assert.equal(e.ledger().total,TOTAL_SUPPLY);
});

test('ECON4 first real registration preserves the whole budget of an earlier advanced empty hour',()=>{
  const e=new SettlementEngine({rewardStart:T});freeze(e,0n,at(2));
  assert.equal(e.hour(0n).sealedResidual,0n);
  e.createVerifiedRoot(component('p'));cmd(e,'register',{instance:'p',now:at(2)},'alice');
  assert.equal(e.ledger().pending,hourBudget(0n));assert.equal(e.snapshot().registry.nextMaterializeHour,2n);
  allocate(e,0n,null,at(2));
  assert.equal(e.ledger().pending,0n);assert.equal(e.ledger().sealed,GENESIS_SEALED+emissionPrefix(2n));
  assert.equal(e.snapshot().registry.nextMaterializeHour,2n);
});

test('ECON4 failed eligibility, duplicate members and stale processed cursors roll back; checkpoint restart preserves latest replay',()=>{
  let e=new SettlementEngine({rewardStart:T});
  for(const id of ['a','b']){e.createVerifiedRoot(component(id));cmd(e,'register',{instance:id,now:0n},'alice');}
  const ids=[...e.snapshot().intervals.keys()];freeze(e,0n,at(1));freeze(e,1n,at(2));
  for(const fields of [{hour:1n,intervalId:ids[0],expectedCursor:0n},{hour:0n,intervalId:'fake',expectedCursor:0n}]){
    const before=e.snapshot();assert.throws(()=>cmd(e,'materializePosition',{now:at(2),...fields}));assert.deepEqual(e.snapshot(),before);
  }
  const request={actor:'crank',nonce:e.nextNonce('crank'),hour:0n,intervalId:ids[1],expectedCursor:0n,now:at(2)};
  const first=e.materializePosition(request);e=SettlementEngine.fromSnapshot(e.snapshot());assert.deepEqual(e.materializePosition(request),first);
  for(const fields of [{intervalId:ids[1],expectedCursor:1n},{intervalId:ids[0],expectedCursor:0n}]){
    const before=e.snapshot();assert.throws(()=>cmd(e,'materializePosition',{hour:0n,now:at(2),...fields}));assert.deepEqual(e.snapshot(),before);
  }
  allocate(e,0n,ids[0],at(2));allocate(e,1n,ids[1],at(2));allocate(e,1n,ids[0],at(2));
  assert.equal(e.ledger().certified,9512n);assert.equal(e.ledger().total,TOTAL_SUPPLY);
});

test('ECON4 re-staking during old backlog queues a nonoverlapping interval; it cannot skip its own old coverage',()=>{
  const e=new SettlementEngine({rewardStart:T});e.createVerifiedRoot(component('p'));
  const old=cmd(e,'register',{instance:'p',now:0n},'alice');cmd(e,'exit',{instance:'p',seq:0n,now:T+1n},'alice');
  freeze(e,0n,at(1));const next=cmd(e,'register',{instance:'p',now:at(1)},'alice');
  freeze(e,1n,at(2));freeze(e,2n,at(3));
  const before=e.snapshot();assert.throws(()=>allocate(e,2n,next.intervalId,at(3)),{code:'COVERAGE_SEQUENCE'});assert.deepEqual(e.snapshot(),before);
  allocate(e,0n,old.intervalId,at(3));allocate(e,1n,null,at(3));allocate(e,2n,next.intervalId,at(3));
  assert.equal(e.position(old.intervalId).accrued,2378n);assert.equal(e.position(next.intervalId).accrued,2378n);
});

test('ECON4 active event index freezes without writing any member and matches independent historical allocation after END',()=>{
  const e=new SettlementEngine({rewardStart:T}),i=new ActiveSettlementIndex();
  const observe=()=>i.observe(e.snapshot());
  e.createVerifiedRoot(component('a'));e.createVerifiedRoot(component('b','bob'));
  const a=cmd(e,'register',{instance:'a',now:0n},'alice');observe();
  const b=cmd(e,'register',{instance:'b',now:0n},'bob');observe();
  cmd(e,'exit',{instance:'b',seq:0n,now:T+1n},'bob');observe();
  freeze(e,0n,at(1));const frozen=i.freeze(0n);assert.equal(frozen.count,2n);assert.equal(i.work.roots,0);
  freeze(e,1n,at(2));i.freeze(1n);assert.equal(i.count,1n);assert.equal(i.work.roots,0);
  allocate(e,0n,b.intervalId,at(2));i.materialize(0n,b.intervalId,0n);
  for(const h of [0n,1n]){allocate(e,h,a.intervalId,at(2));i.materialize(h,a.intervalId,h===0n?1n:0n);}
  assert.equal(i.nextHour,2n);assert.equal(i.work.roots,3);
  for(const id of [a.intervalId,b.intervalId])assert.equal(i.positions.get(id).accrued,e.position(id).accrued);
  for(const h of [0n,1n])assert.equal(i.hours.get(h).residual,e.hour(h).sealedResidual);
});
