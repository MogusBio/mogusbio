import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ByteWriter, sha256, typedHash, instanceId } from '../../protocol-core/src/index.mjs';
import { TASK_FAMILY as F, ROUND_SECONDS, WINDOW_SECONDS } from '../../originality/src/wire.mjs';
import { validateProductionRelease, baseConfigR2Id, PROGRAMS } from '../src/release.mjs';
import { nativeKeyAddress, nativeKeyBytes, nativeNonceOpId } from '../src/native.mjs';
import * as a from '../src/originality-accounts.mjs';
import { clientFixture, hash } from './native-fixture.mjs';
import { recordAccount } from './account-fixture.mjs';

const le=n=>new ByteWriter(8).u64(n).finish(),v1=new ByteWriter(4).u32(1).finish();
const rid=(r,n)=>typedHash(9,Buffer.concat([r.domain,F,v1,le(n)]));
const did=(r,d)=>typedHash(8,Buffer.concat([r.domain,d]));
const wid=(r,n)=>typedHash(10,Buffer.concat([r.domain,rid(r,n)]));
const clone=x=>({...x,data:Buffer.from(x.data)});
const mutate=(x,fn)=>{const y=clone(x);fn(y.data.subarray(120));return y;};
const setRef=(b,at,id)=>{b.fill(0,at,at+33);if(id){b[at]=1;id.copy(b,at+1);}};
const context=(size)=>{const b=Buffer.alloc(size);F.copy(b);v1.copy(b,32);return b;};

// Unmodified records from genuine current76b SBF checkpoint. No account bytes,
// owner, lifecycle or fields are restored to invent a new result.
const genuine=(async()=>{
  const release=await validateProductionRelease(JSON.parse(readFileSync(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url),'utf8')),{localPublicFixture:true});
  const b=readFileSync(new URL('../../../programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b1687.bin',import.meta.url));
  assert.equal(sha256(b).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
  assert.deepEqual(b.subarray(8,40),baseConfigR2Id(release));const records=[];let at=108;
  for(let i=0;i<b.readUInt32LE(104);i++){
    const address=nativeKeyAddress(b.subarray(at,at+32)),lamports=b.readBigUInt64LE(at+32),owner=nativeKeyAddress(b.subarray(at+40,at+72)),executable=b[at+72]===1,rentEpoch=b.readBigUInt64LE(at+73),length=b.readUInt32LE(at+81);at+=85;
    const data=Buffer.from(b.subarray(at,at+length));at+=length;
    if(owner===release.input.programId&&data.length>=120)records.push({address,lamports,owner,executable,rentEpoch,data});
  }
  assert.equal(at,b.length);return {release,kind:k=>records.filter(r=>r.data.readUInt16LE(10)===k)};
})();

test('genuine76b Task, KSlot, current16 Snapshot, open Round and all Knowledge/Disclosure records decode without manufacturing eligibility',async()=>{
  const f=await genuine,t=await a.decodeNativeOriginalityTask(f.release,f.kind(30)[0]);
  assert.equal(t.count,17n);assert.equal(t.event,55n);assert.equal(t.generation,15n);assert.equal(t.best.cost,316n);assert.equal(t.best.index,15n);assert.equal(t.opening,true);assert.equal(t.paused,false);
  const s=await a.decodeNativeKSlot(f.release,f.kind(34)[0],{generation:t.generation});assert.equal(s.current,null);assert.equal(s.statusName,'EMPTY');assert.equal(s.activationStateVerified,false);
  const snapshot=await a.decodeNativeOpeningSnapshot(f.release,f.kind(5)[0]);assert.equal(snapshot.seedCount,16n);assert.equal(snapshot.best.cost,316n);assert.equal(snapshot.sealed,true);assert.equal(snapshot.businessExecutionVerified,false);
  const roundInfo=f.kind(15)[0],round=await a.decodeNativeRound(f.release,roundInfo,roundInfo.data.readBigUInt64LE(156));assert.equal(round.phase,0);assert.equal(round.startCount,16n);assert.equal(round.endCount,17n);assert.equal(round.scanCount,16n);
  for(const info of f.kind(33)){const k=await a.decodeNativeKnowledge(f.release,info,info.data.readBigUInt64LE(156));assert.equal(k.disclosureIdentityMatches,true);assert.equal(k.effectiveIndex,k.index);assert.equal(k.eligibilityVerified,false);}
  for(const info of f.kind(14)){const d=await a.decodeNativeDisclosure(f.release,info,info.data.subarray(120,152));assert.ok(d.event>0n);assert.ok(d.target>=1&&d.target<=22);}
});

test('genuine76b foreign owner/header/PDA/context/schema/truncation never becomes an initialized record',async()=>{
  const f=await genuine,info=f.kind(30)[0],read=x=>a.decodeNativeOriginalityTask(f.release,x);
  for(const change of [x=>x.owner=PROGRAMS.systemProgram,x=>x.executable=true,x=>x.address=f.kind(34)[0].address,x=>x.data[0]^=1,x=>x.data[16]^=1,x=>x.data[48]^=1,x=>x.data[84]^=1,x=>x.data[88]^=1,x=>x.data.writeUInt16LE(2,12),x=>x.data=x.data.subarray(0,-1),x=>x.data[85]=1]){const bad=clone(info);change(bad);await assert.rejects(read(bad));}
  await assert.rejects(read(null));await assert.rejects(read({...info,owner:PROGRAMS.systemProgram,data:Buffer.alloc(0)}));
  const other=(await clientFixture()).release;await assert.rejects(a.decodeNativeOriginalityTask(other,info),/DOMAIN_CONFIG|PDA/);
});

test('genuine76b Task flags, absent best fields, high-water and best/counter bounds fail closed',async()=>{
  const f=await genuine,info=f.kind(30)[0];
  for(const change of [b=>b[60]=2,b=>b[117]=2,b=>b[118]=2,b=>b.writeBigInt64LE(-1n,127),b=>b.writeBigUInt64LE(0n,61),b=>b.writeBigUInt64LE(17n,101),b=>b[60]=0,b=>b.writeBigUInt64LE(56n,44),b=>b.writeBigUInt64LE(56n,109),b=>b.writeBigUInt64LE(16n,119),b=>b[118]=1])await assert.rejects(a.decodeNativeOriginalityTask(f.release,mutate(info,change)));
  await assert.rejects(a.decodeNativeKSlot(f.release,f.kind(34)[0],{generation:14n}),/GENERATION/);
  for(const change of [b=>b[73]=5,b=>b[40]=2,b=>b[41]=1,b=>b[73]=1])await assert.rejects(a.decodeNativeKSlot(f.release,mutate(f.kind(34)[0],change)));
});

// All records below are HOST-only typed fixtures for native kinds absent from
// the saved current76b ledger. Their decoder success is not execution evidence.
const host=(async()=>{
  const f=await clientFixture(),r=f.release,n=2n,index=0n,design=hash('HOST-only originality design'),commitId=hash('HOST-only commit business'),nonce=19n,opId=nativeNonceOpId(nonce),business=typedHash(3,Buffer.concat([r.domain,nativeKeyBytes(f.actor),opId])),instance=instanceId(r.domain,business),candidateId=typedHash(18,Buffer.concat([r.domain,rid(r,n),commitId,instance])),admission=hash('HOST-only admission'),artifact=hash('HOST-only artifact'),start=r.rewardStart+n*ROUND_SECONDS;
  const cb=context(207);cb.writeBigUInt64LE(n,36);nativeKeyBytes(f.actor).copy(cb,44);hash('HOST-only commitment').copy(cb,76);commitId.copy(cb,108);cb.writeBigUInt64LE(40n,140);cb.writeBigUInt64LE(50n,148);cb.writeBigInt64LE(start+1n,156);
  const commit=await recordAccount(r,{kind:31,seeds:['bio','commit',commitId],id:commitId,body:cb});
  const candidateBody=context(348);candidateBody.writeBigUInt64LE(n,36);candidateBody.writeBigUInt64LE(index,44);for(const [at,b]of [[52,commitId],[84,instance],[116,nativeKeyBytes(f.actor)],[148,design],[188,did(r,design)],[220,admission],[252,opId],[308,business]])b.copy(candidateBody,at);candidateBody.writeBigUInt64LE(315n,180);candidateBody.writeBigUInt64LE(43n,284);candidateBody.writeBigUInt64LE(51n,292);candidateBody.writeBigInt64LE(start+WINDOW_SECONDS+1n,300);candidateBody.writeBigUInt64LE(17n,340);
  const candidate=await recordAccount(r,{kind:32,seeds:['bio','candidate',rid(r,n),le(index)],id:candidateId,body:candidateBody});
  const wb=context(252);wb.writeBigUInt64LE(n,36);for(const [at,b]of [[44,instance],[76,nativeKeyBytes(f.actor)],[108,design],[148,commitId],[180,candidateId]])b.copy(wb,at);wb.writeBigUInt64LE(315n,140);wb.writeBigUInt64LE(40n,212);wb.writeBigUInt64LE(43n,220);wb.writeBigUInt64LE(44n,228);wb.writeBigUInt64LE(52n,236);wb.writeBigInt64LE(start+ROUND_SECONDS,244);
  const winner=await recordAccount(r,{kind:16,seeds:['bio','winner',wid(r,n)],id:wid(r,n),body:wb});
  const rb=context(389);rb.writeBigUInt64LE(n,36);rb[44]=1;rb.writeBigUInt64LE(316n,45);hash('HOST baseline design').copy(rb,53);rb.writeBigUInt64LE(17n,85);rb.writeBigUInt64LE(18n,93);rb.writeBigUInt64LE(1n,101);rb.writeBigUInt64LE(1n,109);rb.writeBigUInt64LE(17n,381);
  const round=body=>recordAccount(r,{kind:15,schema:2,seeds:['bio','round',F,v1,le(n)],id:rid(r,n),body});
  const kb=context(279);kb.writeBigUInt64LE(18n,36);design.copy(kb,44);did(r,design).copy(kb,76);kb.writeBigUInt64LE(41n,108);kb.writeBigUInt64LE(43n,116);kb.writeBigUInt64LE(51n,124);kb.writeBigInt64LE(start+WINDOW_SECONDS+1n,132);kb.writeBigUInt64LE(315n,140);kb[148]=2;artifact.copy(kb,181);admission.copy(kb,213);
  const sb=Buffer.alloc(321);F.copy(sb);sb.writeBigUInt64LE(1n,32);sb.writeBigUInt64LE(17n,40);hash('HOST claimed bad admission').copy(sb,48);sb[80]=1;sb[81]=1;instance.copy(sb,82);sb[114]=1;setRef(sb,115,admission);sb.writeBigUInt64LE(42n,148);sb.writeBigUInt64LE(51n,156);sb.writeBigInt64LE(start+WINDOW_SECONDS+1n,164);sb.writeBigUInt64LE(19n,214);sb.writeBigUInt64LE(19n,222);sb[279]=1;sb.writeBigUInt64LE(18n,280);sb.writeBigUInt64LE(17n,313);
  const safetyId=hash('HOST safety business'),safety=await recordAccount(r,{kind:20,schema:2,seeds:['bio','task-safety',F,le(1n)],id:safetyId,body:sb});nativeKeyBytes(safety.address).copy(kb,149);
  const knowledge=body=>recordAccount(r,{kind:33,seeds:['bio','knowledge',F,le(18n)],id:Buffer.concat([le(18n),Buffer.alloc(24)]),body});
  return {...f,n,index,design,commitId,nonce,instance,candidateId,admission,start,commit,candidate,winner,round,rb,safety,safetyId,sb,kb,knowledge};
})();

test('HOST-only Commit used/candidate index is exact and timestamps bind recorded COMMIT window',async()=>{
  const f=await host,c=await a.decodeNativeCommit(f.release,f.commit,f.commitId);assert.equal(c.used,false);assert.equal(c.candidate,null);assert.equal(c.candidateIndex,null);assert.equal(c.author,f.actor);
  const used=mutate(f.commit,b=>{b[164]=1;setRef(b,165,f.candidateId);b[198]=1;b.writeBigUInt64LE(0n,199);});const v=await a.decodeNativeCommit(f.release,used,f.commitId);assert.equal(v.used,true);assert.equal(v.candidateIndex,0n);
  for(const change of [b=>b[164]=2,b=>b[165]=2,b=>b[166]=1,b=>b[198]=1,b=>b.writeBigUInt64LE(1n,199),b=>b.writeBigInt64LE(f.start-1n,156),b=>b.writeBigInt64LE(f.start+WINDOW_SECONDS,156),b=>b[108]^=1,b=>nativeKeyBytes(f.release.pdas.labMint.address).copy(b,44)])await assert.rejects(a.decodeNativeCommit(f.release,mutate(f.commit,change),f.commitId));
});

test('HOST-only Candidate binds H3 nonce opId, H8 Root, H18, disclosure, exact index and reveal window',async()=>{
  const f=await host,c=await a.decodeNativeCandidate(f.release,f.candidate,{round:f.n,index:0n});assert.equal(c.manufactureNonce,19n);assert.equal(c.cost,315n);assert.equal(c.eligibilityVerified,false);assert.equal(c.rankingVerified,false);
  for(const change of [b=>b.writeBigUInt64LE(1n,44),b=>b[52]^=1,b=>b[84]^=1,b=>b[188]^=1,b=>b[260]=1,b=>b[308]^=1,b=>b.writeBigUInt64LE(0n,180),b=>b.writeBigInt64LE(f.start+WINDOW_SECONDS-1n,300),b=>b.writeBigInt64LE(f.start+2n*WINDOW_SECONDS,300)])await assert.rejects(a.decodeNativeCandidate(f.release,mutate(f.candidate,change),{round:f.n,index:0n}));
  await assert.rejects(a.decodeNativeCandidate(f.release,f.candidate,{round:f.n,index:1n}));await assert.rejects(a.decodeNativeCandidate(f.release,f.candidate,{round:f.n,index:0n,pass:true}));
});

test('HOST-only Winner recognition does not assert K activation and rejects identity/event inconsistencies',async()=>{
  const f=await host,w=await a.decodeNativeWinner(f.release,f.winner,wid(f.release,f.n));assert.equal(w.recognized,true);assert.equal(w.kActivatable,null);assert.equal(w.kEligibilityVerified,false);
  for(const change of [b=>b[180]^=1,b=>b.writeBigUInt64LE(40n,220),b=>b.writeBigUInt64LE(43n,228),b=>b.writeBigUInt64LE(0n,140),b=>b.writeBigInt64LE(f.start+ROUND_SECONDS-1n,244)])await assert.rejects(a.decodeNativeWinner(f.release,mutate(f.winner,change),wid(f.release,f.n)));
});

test('HOST-only bounded Round phases preserve frozen knowledge count/cursors and exact winner/activation refs',async()=>{
  const f=await host,read=async b=>a.decodeNativeRound(f.release,await f.round(b),f.n);
  assert.equal((await read(f.rb)).phase,0);const phase1=Buffer.from(f.rb);phase1[117]=1;phase1.writeBigUInt64LE(18n,381);assert.equal((await read(phase1)).scanCount,18n);
  const phase2=Buffer.from(phase1);phase2[117]=2;phase2.writeBigUInt64LE(18n,126);phase2[134]=1;phase2.writeBigUInt64LE(316n,135);hash('HOST scan best').copy(phase2,143);assert.equal((await read(phase2)).baselineBest.cost,316n);
  const done=Buffer.from(phase2);done[117]=4;done.writeBigUInt64LE(1n,175);setRef(done,200,f.candidateId);done.writeBigUInt64LE(315n,233);done.writeBigUInt64LE(40n,241);f.candidate.data.subarray(428,460).copy(done,249);done[281]=1;done.writeBigUInt64LE(45n,282);done.writeBigUInt64LE(52n,290);done.writeBigInt64LE(f.start+ROUND_SECONDS,298);setRef(done,306,wid(f.release,f.n));setRef(done,339,hash('HOST activation'));done[372]=1;done.writeBigUInt64LE(220n,373);
  const v=await read(done);assert.equal(v.completed,true);assert.equal(v.activationStart,220n);assert.equal(v.candidateCursor,1n);assert.equal(v.scanCount,18n);
  for(const change of [b=>b[44]=3,b=>b[117]=5,b=>b[134]=2,b=>b[191]=2,b=>b[200]=2,b=>b[306]=2,b=>b[339]=2,b=>b[372]=2,b=>b.writeBigUInt64LE(2n,109),b=>b.writeBigUInt64LE(19n,126),b=>b.writeBigUInt64LE(2n,175),b=>b.writeBigUInt64LE(19n,93),b=>b[281]=0,b=>b[307]^=1,b=>setRef(b,306,null),b=>b[372]=0]){const bad=Buffer.from(done);change(bad);await assert.rejects(read(bad));}
});

test('HOST-only Safety correction is authoritative for active kind2 Knowledge; missing/foreign/mismatched proof fails',async()=>{
  const f=await host,proof=await a.decodeNativeSafety(f.release,f.safety,{epoch:1n,id:f.safetyId});assert.equal(proof.origin,17n);assert.equal(proof.correctedIndex,18n);assert.equal(proof.replayCompleted,true);
  const info=await f.knowledge(f.kb),k=await a.decodeNativeKnowledge(f.release,info,18n,{safetyAccount:f.safety});assert.equal(k.effectiveIndex,17n);assert.equal(k.safety.address,f.safety.address);assert.equal(k.disclosureIdentityMatches,true);assert.equal(k.eligibilityVerified,false);
  await assert.rejects(a.decodeNativeKnowledge(f.release,info,18n),/SAFETY_REQUIRED/);
  for(const change of [b=>b[115]=0,b=>b[116]^=1,b=>b[279]=0,b=>b.writeBigUInt64LE(19n,280),b=>b.writeBigUInt64LE(19n,313)])await assert.rejects(a.decodeNativeKnowledge(f.release,info,18n,{safetyAccount:mutate(f.safety,change)}));
  await assert.rejects(a.decodeNativeKnowledge(f.release,info,17n,{safetyAccount:f.safety}));await assert.rejects(a.decodeNativeSafety(f.release,f.safety,{epoch:2n}));await assert.rejects(a.decodeNativeSafety(f.release,f.safety,{id:hash('wrong')}));
});

test('HOST-only revoked Knowledge preserves faulty historical semantic links without restoring effective eligibility',async()=>{
  const f=await host,b=Buffer.from(f.kb);b[245]=1;setRef(b,246,nativeKeyBytes(f.safety.address));b[76]^=1;
  const k=await a.decodeNativeKnowledge(f.release,await f.knowledge(b),18n);assert.equal(k.revoked,true);assert.equal(k.effectiveIndex,18n);assert.equal(k.disclosureIdentityMatches,false);assert.equal(k.eligibilityVerified,false);
  for(const change of [b=>b[148]=3,b=>b[245]=2,b=>b[246]=2,b=>b[245]=0,b=>b.writeBigUInt64LE(41n,116)]){const bad=Buffer.from(b);change(bad);await assert.rejects(a.decodeNativeKnowledge(f.release,await f.knowledge(bad),18n));}
});

test('HOST-only Safety audit, recovered state, flags, count ranges and reserved ref encodings are checked',async()=>{
  const f=await host,read=async b=>a.decodeNativeSafety(f.release,await recordAccount(f.release,{kind:20,schema:2,seeds:['bio','task-safety',F,le(1n)],id:f.safetyId,body:b}));
  const done=Buffer.from(f.sb);done[205]=3;done.writeBigUInt64LE(19n,206);done[288]=1;done.writeBigUInt64LE(44n,289);done.writeBigUInt64LE(52n,297);done.writeBigInt64LE(f.start+WINDOW_SECONDS+2n,305);assert.equal((await read(done)).recovered,true);
  for(const change of [b=>b[80]=3,b=>b[81]=2,b=>b[114]=2,b=>b[115]=2,b=>b[172]=2,b=>b[205]=4,b=>b[230]=2,b=>b[279]=2,b=>b[288]=2,b=>b.writeBigUInt64LE(20n,206),b=>b.writeBigUInt64LE(18n,222),b=>b.writeBigUInt64LE(0n,148),b=>b[231]=1,b=>b[288]=0,b=>b.writeBigUInt64LE(42n,289),b=>b.writeBigInt64LE(-1n,164)]){const bad=Buffer.from(done);change(bad);await assert.rejects(read(bad));}
});

test('genuine16 Snapshot rejects historical14 relabeling, malformed digest/key and wrong cutoff/frontier/count',async()=>{
  const f=await genuine,info=f.kind(5)[0];
  for(const change of [b=>b.writeBigUInt64LE(14n,72),b=>b.writeBigUInt64LE(317n,112),b=>b.writeBigInt64LE(f.release.rewardStart-1n,64),b=>b.writeBigInt64LE(f.release.rewardStart-1n,168),b=>b[32]^=1,b=>b[80]^=1,b=>b.writeBigUInt64LE(0n,152)])await assert.rejects(a.decodeNativeOpeningSnapshot(f.release,mutate(info,change)));
  await assert.rejects(a.decodeNativeOpeningSnapshot({...f.release,input:{...f.release.input,seedCount:14,frontier:320}},info),/RELEASE_BINDING/);
});
