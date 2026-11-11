import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRecord, encodeActorNonceBody } from '../../protocol-core/src/index.mjs';
import { baseConfigR2Id, PROGRAMS } from '../src/release.mjs';
import { nativePda, nativeKeyBytes, nativeRequestHash } from '../src/native.mjs';
import { PendingJournal, decodeActorNonceSnapshot, persistJournalCAS } from '../src/journal.mjs';
import { clientFixture,key,hash } from './native-fixture.mjs';

async function observation(c,nextNonce,{digest=null,result=null,slot=20n,actor=c.actor,accountOverride,commitment='finalized'}={}){
  const p=await nativePda(c.release.input.programId,'bio','actor-nonce',nativeKeyBytes(actor));
  const body=encodeActorNonceBody({nextNonce,lastDigest:nextNonce===0n?null:digest??hash('other request'),lastResult:nextNonce===0n?null:result??Buffer.alloc(8)});
  const account=accountOverride===undefined?{owner:c.release.input.programId,executable:false,
    data:encodeRecord({kind:35,schema:1,domain:c.release.domain,configId:baseConfigR2Id(c.release),bump:p.bump,recordKey:nativeKeyBytes(actor),body})}:accountOverride;
  return decodeActorNonceSnapshot({release:c.release,actor,address:p.address,account,contextSlot:slot,commitment});
}
const journal=c=>new PendingJournal({abi:c.abi,release:c.release,actor:c.actor});
const revive=(c,s)=>PendingJournal.restore({abi:c.abi,release:c.release,actor:c.actor},s);

test('timeout, durable restart and new blockhash preserve exact business Frame/nonce/H4',async()=>{
  const c=await clientFixture(),j=journal(c),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8));
  j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  j.recordAttempt(0n,{expectedRevision:1n,blockhash:key(20),lastValidBlockHeight:30n,frameBytes:raw});
  const unknown=j.noteUnknown(0n,{expectedRevision:2n,reason:'RPC timed out after send'});assert.equal(unknown.decision,'UNKNOWN');
  const restored=revive(c,j.serialize());assert.equal(restored.revision,3n);assert.deepEqual(restored.retryFrame(0n),raw);
  const absent=await observation(c,0n,{slot:31n});const outcome=restored.reconcile(0n,absent,{expectedRevision:3n});
  assert.equal(outcome.decision,'RETRY_SAME_FRAME');assert.deepEqual(outcome.frameBytes,raw);
  restored.recordAttempt(0n,{expectedRevision:4n,blockhash:key(21),lastValidBlockHeight:90n,frameBytes:raw});
  assert.equal(restored.get(0n).attempts.length,2);assert.equal(restored.get(0n).digestHex,nativeRequestHash(c.abi,raw).toString('hex'));
  const altered=Buffer.from(raw);altered[152]^=1;assert.throws(()=>restored.recordAttempt(0n,{expectedRevision:5n,blockhash:key(22),lastValidBlockHeight:100n,frameBytes:altered}),/FRAME_CHANGED/);
  assert.throws(()=>restored.begin(c.frame('SYNC_EMISSION',Buffer.alloc(8),1n),{expectedRevision:5n,observedNextNonce:1n}),/PENDING_UNRESOLVED/);
  assert.equal(restored.revision,5n);const detached=restored.get(0n);detached.frameBytes.fill(255);assert.deepEqual(restored.retryFrame(0n),raw);
});
test('only latest matching original H4 recovers exact registered result, without another payment',async()=>{
  const c=await clientFixture(),j=journal(c),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8)),result=Buffer.alloc(8);result.writeBigUInt64LE(519n);
  j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  const proof=await observation(c,1n,{digest:nativeRequestHash(c.abi,raw),result,slot:15n});
  const out=j.reconcile(0n,proof,{expectedRevision:1n});assert.equal(out.decision,'CONFIRMED');assert.deepEqual(out.resultBytes,result);
  assert.throws(()=>j.retryFrame(0n),/TERMINAL/);assert.deepEqual(revive(c,j.serialize()).get(0n).resultBytes,result);
  const malformed=await observation(c,1n,{digest:nativeRequestHash(c.abi,raw),result:Buffer.alloc(7),slot:16n});
  const badJournal=journal(c);badJournal.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  const before=badJournal.serialize();assert.throws(()=>badJournal.reconcile(0n,malformed,{expectedRevision:1n}),/RESULT_LENGTH/);assert.equal(badJournal.serialize(),before);
  const old=await observation(c,4n,{slot:17n});const oldOut=j.reconcile(0n,old,{expectedRevision:2n});
  assert.equal(oldOut.decision,'CONFIRMED');assert.deepEqual(oldOut.resultBytes,result);assert.equal(oldOut.resultSource,'LOCAL_CONFIRMED_HISTORY');
});
test('latest conflicting request and older unavailable cache are terminal and never allocate a replacement nonce',async()=>{
  const c=await clientFixture(),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8)),j=journal(c);j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  const out=j.reconcile(0n,await observation(c,1n),{expectedRevision:1n});assert.equal(out.decision,'NONCE_CONFLICT');assert.equal(out.resultBytes,null);
  assert.throws(()=>j.retryFrame(0n),/TERMINAL/);assert.equal(j.get(0n).nonce,'0');
  const k=journal(c);k.begin(raw,{expectedRevision:0n,observedNextNonce:0n});const done=k.reconcile(0n,await observation(c,2n),{expectedRevision:1n});
  assert.equal(done.decision,'ALREADY_PROCESSED');assert.equal(done.resultBytes,null);assert.equal(k.get(0n).resultBytes,null);
});
test('a finalized nonce cache cannot change its digest or result without advancing nonce',async()=>{
  const c=await clientFixture(),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8)),j=journal(c);j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  j.reconcile(0n,await observation(c,1n,{slot:30n}),{expectedRevision:1n});
  const before=j.serialize();const impossible=await observation(c,1n,{digest:nativeRequestHash(c.abi,raw),slot:31n});
  assert.throws(()=>j.reconcile(0n,impossible,{expectedRevision:2n}),/CACHE_REWRITE/);assert.equal(j.serialize(),before);
  const k=journal(c);k.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  k.reconcile(0n,await observation(c,1n,{digest:nativeRequestHash(c.abi,raw),slot:30n}),{expectedRevision:1n});
  const changed=await observation(c,1n,{digest:nativeRequestHash(c.abi,raw),result:Buffer.alloc(8,1),slot:31n});
  assert.throws(()=>k.reconcile(0n,changed,{expectedRevision:2n}),/CACHE_REWRITE/);
});
test('confirmed history survives a newer business and restart while global nonce facts never regress across entries',async()=>{
  const c=await clientFixture(),j=journal(c),zero=c.frame('SYNC_EMISSION',Buffer.alloc(8),0n),one=c.frame('SYNC_EMISSION',Buffer.alloc(8,1),1n);
  const result0=Buffer.alloc(8,7),result1=Buffer.alloc(8,9);
  j.begin(zero,{expectedRevision:0n,observedNextNonce:0n});j.reconcile(0n,await observation(c,1n,{digest:nativeRequestHash(c.abi,zero),result:result0,slot:10n}),{expectedRevision:1n});
  const confirmation=j.get(0n).lastObservation;
  j.begin(one,{expectedRevision:2n,observedNextNonce:1n});j.reconcile(1n,await observation(c,2n,{digest:nativeRequestHash(c.abi,one),result:result1,slot:20n}),{expectedRevision:3n});
  const out=j.reconcile(0n,await observation(c,2n,{digest:nativeRequestHash(c.abi,one),result:result1,slot:21n}),{expectedRevision:4n});
  assert.equal(out.decision,'CONFIRMED');assert.equal(out.resultSource,'LOCAL_CONFIRMED_HISTORY');assert.deepEqual(out.resultBytes,result0);assert.deepEqual(j.get(0n).lastObservation,confirmation);
  const restored=revive(c,j.serialize());assert.equal(restored.get(0n).state,'CONFIRMED');assert.deepEqual(restored.get(0n).resultBytes,result0);assert.deepEqual(restored.get(1n).resultBytes,result1);
  const before=restored.serialize();const regressed=await observation(c,1n,{digest:nativeRequestHash(c.abi,zero),result:result0,slot:22n});
  assert.throws(()=>restored.reconcile(0n,regressed,{expectedRevision:5n}),/NONCE_REGRESSION/);assert.equal(restored.serialize(),before);
  const inconsistent=await observation(c,2n,{digest:nativeRequestHash(c.abi,one),result:result0,slot:21n});
  assert.throws(()=>restored.reconcile(0n,inconsistent,{expectedRevision:5n}),/CACHE_REWRITE/);assert.equal(restored.serialize(),before);
});
test('the same finalized slot cannot report a different next nonce for another pending entry',async()=>{
  const c=await clientFixture(),j=journal(c),zero=c.frame('SYNC_EMISSION',Buffer.alloc(8),0n),one=c.frame('SYNC_EMISSION',Buffer.alloc(8,1),1n);
  j.begin(zero,{expectedRevision:0n,observedNextNonce:0n});j.reconcile(0n,await observation(c,1n,{digest:nativeRequestHash(c.abi,zero),slot:10n}),{expectedRevision:1n});
  j.begin(one,{expectedRevision:2n,observedNextNonce:1n});const before=j.serialize();
  const sameSlot=await observation(c,2n,{digest:nativeRequestHash(c.abi,one),slot:10n});
  assert.throws(()=>j.reconcile(1n,sameSlot,{expectedRevision:3n}),/SAME_SLOT_NONCE_CHANGE/);assert.equal(j.serialize(),before);
});
test('local and external storage CAS reject racing tabs instead of last-write-wins overwrite',async()=>{
  const c=await clientFixture(),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8)),j=journal(c);j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  assert.throws(()=>j.noteUnknown(0n,{expectedRevision:0n}),/JOURNAL_CAS/);assert.equal(j.revision,1n);
  const other=revive(c,j.serialize());j.noteUnknown(0n,{expectedRevision:1n,reason:'first tab'});other.noteUnknown(0n,{expectedRevision:1n,reason:'second tab'});
  let version=0,stored=null;
  const store={async compareAndSwap(expected,value){if(expected!==version)return false;stored=value;version++;return version;}};
  const results=await Promise.allSettled([persistJournalCAS(j,store,{expectedStorageRevision:0}),persistJournalCAS(other,store,{expectedStorageRevision:0})]);
  assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(version,1);assert.equal(revive(c,stored).get(0n).lastError,'first tab');
  await assert.rejects(persistJournalCAS(j,{},{expectedStorageRevision:1}),/CAS_REQUIRED/);
});
test('nonce snapshots require canonical actual PDA/owner/domain/header, finalized context and no stale regression',async()=>{
  const c=await clientFixture(),j=journal(c),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8));j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  await assert.rejects(observation(c,0n,{commitment:'processed'}),/FINALITY/);
  await assert.rejects(observation(c,0n,{accountOverride:{owner:PROGRAMS.systemProgram,executable:false,data:Buffer.alloc(418)}}),/OWNER/);
  const prefunded=await observation(c,0n,{accountOverride:{owner:PROGRAMS.systemProgram,executable:false,data:Buffer.alloc(0)}});assert.equal(prefunded.nextNonce,0n);
  const missing=await observation(c,0n,{accountOverride:null});assert.equal(missing.nextNonce,0n);
  const wrongActor=await observation(c,1n,{actor:key(20)});assert.throws(()=>j.reconcile(0n,wrongActor,{expectedRevision:1n}),/CONTEXT/);
  assert.throws(()=>j.reconcile(0n,{nextNonce:1n},{expectedRevision:1n}),/UNDECODED/);
  const good=await observation(c,1n,{digest:nativeRequestHash(c.abi,raw),slot:22n});j.reconcile(0n,good,{expectedRevision:1n});
  assert.throws(()=>j.reconcile(0n,prefunded,{expectedRevision:2n}),/STALE_CONTEXT/);
  assert.throws(()=>j.reconcile(0n,awaitedFake(),{expectedRevision:2n}),/UNDECODED/);
  const regressed=await observation(c,0n,{slot:23n});assert.throws(()=>j.reconcile(0n,regressed,{expectedRevision:2n}),/REGRESSION/);assert.equal(j.revision,2n);
});
const awaitedFake=()=>({profile:'BIOP0R2-NONCE-SNAPSHOT1'});
test('retry attempt bound rejects before creating a persisted journal that its restart decoder cannot read',async()=>{
  const c=await clientFixture(),j=journal(c),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8));j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});const s=JSON.parse(j.serialize());
  s.entries[0].attempts=Array.from({length:10000},()=>({blockhash:key(20),lastValidBlockHeight:'100',signature:null}));s.entries[0].state='UNKNOWN';const full=revive(c,JSON.stringify(s)),before=full.serialize();
  assert.throws(()=>full.recordAttempt(0n,{expectedRevision:full.revision,blockhash:key(21),lastValidBlockHeight:101n,frameBytes:raw}),/ATTEMPT_LIMIT/);assert.equal(full.serialize(),before);assert.equal(revive(c,before).get(0n).attempts.length,10000);
});
test('restart rejects frame/hash/operation/ABI mutations and invalid nonce inputs atomically',async()=>{
  const c=await clientFixture(),j=journal(c),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8));j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});
  for(const mutate of [s=>s.entries[0].frameHex=s.entries[0].frameHex.slice(0,-2)+'01',s=>s.entries[0].digestHex='00'.repeat(32),
    s=>s.abiHash='00'.repeat(32),s=>s.entries.push(s.entries[0]),s=>s.revision='01',s=>s.entries[0].nonce='1',s=>s.entries[0].resultHex='00'.repeat(8)]){
    const s=JSON.parse(j.serialize());mutate(s);assert.throws(()=>revive(c,JSON.stringify(s)));}
  assert.throws(()=>journal(c).begin(raw,{expectedRevision:0n,observedNextNonce:1n}),/NONCE_GAP/);
  assert.throws(()=>journal(c).begin(raw,{expectedRevision:0n,observedNextNonce:0}),/U64/);
  const future=c.frame('SYNC_EMISSION',Buffer.alloc(8),4n),k=journal(c);k.begin(future,{expectedRevision:0n,observedNextNonce:4n});
  const before=k.serialize();assert.throws(()=>k.reconcile(4n,awaitedFake(),{expectedRevision:1n}),/UNDECODED/);assert.equal(k.serialize(),before);
  const old=await observation(c,0n);assert.throws(()=>k.reconcile(4n,old,{expectedRevision:1n}),/BEHIND_REQUEST/);assert.equal(k.serialize(),before);
  j.reconcile(0n,await observation(c,1n,{digest:nativeRequestHash(c.abi,raw)}),{expectedRevision:1n});const fakePending=JSON.parse(j.serialize());fakePending.entries[0].state='UNKNOWN';fakePending.entries[0].resultHex=null;
  assert.throws(()=>revive(c,JSON.stringify(fakePending)),/PENDING_FACTS/);
});
