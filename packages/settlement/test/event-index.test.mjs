import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementEngine } from '../src/engine.mjs';
import { ActiveSettlementIndex } from '../src/event-index.mjs';
import { H_END, HOURS_PER_EPOCH, TOTAL_SUPPLY, GENESIS_SEALED, emissionPrefix } from '../src/emission.mjs';

function fixture(){const e=new SettlementEngine({rewardStart:100n,saleStart:0n}),i=new ActiveSettlementIndex();let now=0n;
  const cmd=(name,fields={})=>{now=fields.now??now;const r=e[name]({actor:fields.actor??'alice',nonce:e.nextNonce(fields.actor??'alice'),now,...fields});i.observe(e.snapshot());return r;};
  const root=(instance,scope='COMPONENT')=>{e.createVerifiedRoot({instance,owner:'alice',scope,B_int:scope==='COMPONENT'?120000n:7200000n,q_ppm:scope==='COMPONENT'?1000000n:2000000n,certificate:'trusted-test-ingress'});};
  const hour=(h)=>{now=100n+(h+1n)*3600n;const actual=i.settle(h);e.openHour({actor:'crank',nonce:e.nextNonce('crank'),now,hour:h});
    let s=e.snapshot(),r=s.hours.get(h);while(['K_SCAN','ROOT_SCAN'].includes(r.status)){e.scanHour({actor:'crank',nonce:e.nextNonce('crank'),now,hour:h,expectedPhase:r.status,expectedCursor:r.status==='K_SCAN'?s.registry.kScanSeq:r.rootCursor,workCount:1});s=e.snapshot();r=s.hours.get(h);}
    while(r.status!=='FINAL'){e.materializeHour({actor:'crank',nonce:e.nextNonce('crank'),now,hour:h,expectedCursor:r.materializeCursor,rootCount:Number(r.rootCutoff-r.materializeCursor>8n?8n:r.rootCutoff-r.materializeCursor)});s=e.snapshot();r=s.hours.get(h);}
    assert.equal(actual.denominator,r.denominator);assert.equal(actual.residual,r.sealedResidual);assert.equal(actual.count,r.members);
    for(const [id,p]of s.intervals)assert.equal(i.positions.get(id)?.accrued,p.accrued,`accrued ${id} h${h}`);return actual;};
  return {e,i,cmd,root,hour};}

test('ECON3 removes dead component roots from every later hour, exactly retaining ECON2 floors',()=>{
  const {e,i,cmd,root,hour}=fixture();for(let n=0;n<60;n++){root(`part${n}`);cmd('register',{instance:`part${n}`,now:0n});}
  hour(0n);for(let n=0;n<60;n++)cmd('exit',{instance:`part${n}`,seq:0n,now:3700n});hour(1n);
  for(let n=0;n<60;n++)e.consume({actor:'alice',nonce:e.nextNonce('alice'),now:7300n,instances:[`part${n}`],outputInstance:`other${n}`,outputFacts:{instance:`other${n}`,owner:'alice',scope:'COMPONENT',B_int:120000n,q_ppm:1000000n,certificate:'trusted-test-ingress'}});
  i.observe(e.snapshot());root('bio','BIO');cmd('register',{instance:'bio',now:7300n});
  const before=i.work.roots;hour(2n);hour(3n);hour(4n);assert.equal(i.work.roots-before,2);assert.equal(i.nodes.size,61);assert.equal(e.snapshot().registry.roots.length,61);assert.equal(i.count,1n);
});

test('ECON3 combines same-root H+K once, handles stronger frontier and old beneficiary after transfer',()=>{
  const {e,i,cmd,root,hour}=fixture();root('bio','BIO');cmd('register',{instance:'bio',now:0n});
  e.acceptFrontier({cost:324n,now:1n});e.acceptWinner({winnerId:'winner',instance:'bio',author:'alice',cost:324n});i.observe(e.snapshot());cmd('activateK',{instance:'bio',winnerId:'winner',now:2n});
  const a=hour(0n);assert.equal([...a.amounts.values()][0],856164n);
  e.acceptFrontier({cost:320n,now:3700n});i.observe(e.snapshot());cmd('exit',{instance:'bio',seq:0n,now:3700n});hour(1n);hour(2n);
  cmd('transfer',{instance:'bio',newOwner:'bob',now:10900n});cmd('register',{actor:'bob',instance:'bio',now:10900n});hour(3n);hour(4n);
  const s=e.snapshot();for(const[id,p]of s.intervals)assert.equal(i.positions.get(id).beneficiary,p.beneficiary);assert.equal(i.count,1n);assert.equal(i.k,null);
});

test('pending zero-length K cancellation and downtime preserve exact ordinary earnings',()=>{
  const {e,i,cmd,root,hour}=fixture();root('bio','BIO');cmd('register',{instance:'bio',now:101n});
  e.acceptFrontier({cost:324n,now:102n});e.acceptWinner({winnerId:'w',instance:'bio',author:'alice',cost:324n});i.observe(e.snapshot());cmd('activateK',{instance:'bio',winnerId:'w',now:103n});e.acceptFrontier({cost:320n,now:104n});i.observe(e.snapshot());
  for(let h=0n;h<20n;h++)hour(h);assert.equal(i.k,null);assert.equal(i.positions.values().next().value.accrued,e.snapshot().intervals.values().next().value.accrued);
});

test('new interval may be queued while an older historical interval is still active in replay',()=>{
  const {i,cmd,root,hour}=fixture();root('part');cmd('register',{instance:'part',now:0n});hour(0n);
  cmd('exit',{instance:'part',seq:0n,now:3700n});
  cmd('register',{instance:'part',now:7300n}); // h1 not materialized yet; end2 already physically passed
  hour(1n);hour(2n);hour(3n);assert.equal(i.nodes.size,1);assert.equal(i.count,1n);
});

test('cold import of already closed or zero-length records rejects atomically; stored ECON3 event order restores',()=>{
  const {e,i,cmd,root,hour}=fixture();root('bio','BIO');cmd('register',{instance:'bio',now:101n});
  e.acceptFrontier({cost:324n,now:102n});e.acceptWinner({winnerId:'w',instance:'bio',author:'alice',cost:324n});i.observe(e.snapshot());cmd('activateK',{instance:'bio',winnerId:'w',now:103n});e.acceptFrontier({cost:320n,now:104n});i.observe(e.snapshot());
  const cold=new ActiveSettlementIndex(),before=cold.snapshot();assert.throws(()=>cold.observe(e.snapshot()),{code:'INDEX_REQUIRES_EVENT_HISTORY'});assert.deepEqual(cold.snapshot(),before);
  const checkpoint=i.snapshot(),restored=ActiveSettlementIndex.fromSnapshot(checkpoint);assert.deepEqual(restored.events.map(e=>e.type),['START','K_START','K_END']);
  assert.deepEqual(restored.settle(0n),hour(0n));assert.deepEqual(restored.settle(1n),hour(1n));assert.deepEqual(restored.snapshot(),i.snapshot());
  cmd('exit',{instance:'bio',seq:0n,now:7300n});const closed=new ActiveSettlementIndex();assert.throws(()=>closed.observe(e.snapshot()),{code:'INDEX_REQUIRES_EVENT_HISTORY'});
});

test('skipping EXIT then restake observation cannot guess tied END/START order',()=>{
  const {e,i,cmd,root,hour}=fixture();root('part');cmd('register',{instance:'part',now:0n});hour(0n);
  e.exit({actor:'alice',nonce:e.nextNonce('alice'),now:3700n,instance:'part',seq:0n});
  e.register({actor:'alice',nonce:e.nextNonce('alice'),now:7300n,instance:'part'});
  const before=i.snapshot();assert.throws(()=>i.observe(e.snapshot()),{code:'INDEX_REQUIRES_EVENT_HISTORY'});assert.deepEqual(i.snapshot(),before);
});

test('EMPTY_SKIP with historical Roots exactly equals ordinary empty hours and preserves unpaid debt',()=>{
  const {e,i,cmd,root,hour}=fixture();root('part');cmd('register',{instance:'part',now:0n});hour(0n);cmd('exit',{instance:'part',seq:0n,now:3700n});hour(1n);hour(2n);
  assert.equal(i.count,0n);assert.equal(i.nodes.size,1);const accelerated=ActiveSettlementIndex.fromSnapshot(i.snapshot());
  const accrued=e.snapshot().intervals.values().next().value.accrued;assert(accrued>0n);
  const result=accelerated.skipEmpty({expectedNextHour:3n,targetExclusive:31n,now:100n+31n*3600n,rewardStart:100n});
  const sealedBefore=e.snapshot().treasury.sealed;for(let h=3n;h<31n;h++)hour(h);
  assert.equal(e.snapshot().treasury.sealed-sealedBefore,result.sealedAtoms);assert.equal(accelerated.nextHour,i.nextHour);assert.deepEqual(accelerated.positions,i.positions);assert.equal(e.snapshot().intervals.values().next().value.accrued,accrued);
});

test('EMPTY_SKIP uses half-open frontier: stop at START, never cross it or omit zero-length K events',()=>{
  const {e,i,cmd,root,hour}=fixture();root('part','BIO');cmd('register',{instance:'part',now:0n});hour(0n);cmd('exit',{instance:'part',seq:0n,now:3700n});hour(1n);hour(2n);
  cmd('register',{instance:'part',now:32501n});e.acceptFrontier({cost:324n,now:32502n});e.acceptWinner({winnerId:'future',instance:'part',author:'alice',cost:324n});i.observe(e.snapshot());cmd('activateK',{instance:'part',winnerId:'future',now:32502n});e.acceptFrontier({cost:320n,now:32503n});i.observe(e.snapshot());
  assert.equal(i.events[i.eventCursor].due,10n);const before=i.snapshot();
  assert.throws(()=>i.skipEmpty({expectedNextHour:3n,targetExclusive:11n,now:100n+12n*3600n,rewardStart:100n}),{code:'INDEX_PENDING_EVENT'});assert.deepEqual(i.snapshot(),before);
  i.skipEmpty({expectedNextHour:3n,targetExclusive:10n,now:100n+12n*3600n,rewardStart:100n});
  assert.throws(()=>i.skipEmpty({expectedNextHour:10n,targetExclusive:11n,now:100n+12n*3600n,rewardStart:100n}),{code:'INDEX_PENDING_EVENT'});
  const eventCursor=i.eventCursor;i.settle(10n);assert.equal(i.eventCursor,eventCursor+3);assert.equal(i.count,1n);assert.equal(i.k,null);
  assert.throws(()=>i.skipEmpty({expectedNextHour:11n,targetExclusive:12n,now:100n+12n*3600n,rewardStart:100n}),{code:'INDEX_NOT_EMPTY'});
});

test('EMPTY_SKIP prefix arithmetic crosses all46 epochs without per-hour records or terminal double allocation',()=>{
  const index=new ActiveSettlementIndex();const slices=[1n,HOURS_PER_EPOCH-1n,HOURS_PER_EPOCH+1n,HOURS_PER_EPOCH*20n+3n,H_END];let total=0n;
  for(const to of slices){const from=index.nextHour;const r=index.skipEmpty({expectedNextHour:from,targetExclusive:to,now:H_END*3600n,rewardStart:0n});assert.equal(r.sealedAtoms,emissionPrefix(to)-emissionPrefix(from));total+=r.sealedAtoms;}
  assert.equal(total,TOTAL_SUPPLY-GENESIS_SEALED);assert.equal(index.hours.size,0);assert.equal(index.work.roots,0);assert.equal(index.work.events,0);
  const before=index.snapshot();assert.throws(()=>index.skipEmpty({expectedNextHour:H_END,targetExclusive:H_END+1n,now:(H_END+1n)*3600n,rewardStart:0n}),{code:'INDEX_EMPTY_RANGE'});assert.deepEqual(index.snapshot(),before);
});

test('EMPTY_SKIP rejects stale CAS, Clock rollback, active membership, opened cursor and future target atomically',()=>{
  const index=new ActiveSettlementIndex();index.skipEmpty({expectedNextHour:0n,targetExclusive:1n,now:7200n,rewardStart:0n});
  for(const fields of [{expectedNextHour:0n,targetExclusive:2n,now:7200n},{expectedNextHour:1n,targetExclusive:3n,now:7200n},{expectedNextHour:1n,targetExclusive:2n,now:3600n}]){const before=index.snapshot();assert.throws(()=>index.skipEmpty({...fields,rewardStart:0n}));assert.deepEqual(index.snapshot(),before);}
  const {i,cmd,root,hour}=fixture();root('part');cmd('register',{instance:'part',now:0n});hour(0n);const before=i.snapshot();assert.throws(()=>i.skipEmpty({expectedNextHour:1n,targetExclusive:2n,now:7300n,rewardStart:100n}),{code:'INDEX_NOT_EMPTY'});assert.deepEqual(i.snapshot(),before);
  // A damaged reference checkpoint cannot turn an opened cursor into absence.
  index.hours.set(1n,{status:'READY'});const opened=index.snapshot();assert.throws(()=>index.skipEmpty({expectedNextHour:1n,targetExclusive:2n,now:7200n,rewardStart:0n}),{code:'INDEX_EMPTY_HOUR_OPEN'});assert.deepEqual(index.snapshot(),opened);
});
