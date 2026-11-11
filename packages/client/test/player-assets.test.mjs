import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {sha256} from '../../protocol-core/src/index.mjs';
import {validateProductionRelease,PROGRAMS} from '../src/release.mjs';
import {loadNativeAbi,nativeKeyAddress,nativePda} from '../src/native.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
import {readPlayerAsset,planPlayerAssetAction,planGuidedPositionAction} from '../src/player-assets.mjs';
import {key} from './native-fixture.mjs';
import {recordAccount} from './account-fixture.mjs';
import {baseConfigR2Id} from '../src/release.mjs';
import {TOTAL_SUPPLY,emissionPrefix,completedHours} from '../../settlement/src/emission.mjs';

// Every default record below is unchanged from the genuine76b cold ledger.
// Mutations in negative/alternate-state tests are HOST-ONLY planning fixtures;
// they are never described as a new asset, native execution or accepted stake.
async function fixture(){
 const release=await validateProductionRelease(JSON.parse(readFileSync(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url))),{localPublicFixture:true});
 const raw=readFileSync(new URL('../../../programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe.bin',import.meta.url));
 assert.equal(sha256(raw).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
 const instance=Buffer.from(raw.subarray(72,104)),count=raw.readUInt32LE(104),accounts=new Map();let at=108;
 for(let i=0;i<count;i++){const address=nativeKeyAddress(raw.subarray(at,at+32)),lamports=raw.readBigUInt64LE(at+32),owner=nativeKeyAddress(raw.subarray(at+40,at+72)),executable=raw[at+72]===1,rentEpoch=raw.readBigUInt64LE(at+73),len=raw.readUInt32LE(at+81);at+=85;
  accounts.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(raw.subarray(at,at+len))});at+=len;}
 assert.equal(at,raw.length);const abi=loadNativeAbi(undefined,{expectedHash:release.input.abiHash}),actor=release.input.bootstrap,calls=[];let beforeRead=null,reads=0;
 const fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);calls.push(req.method);let result;
  if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
  else if(req.method==='getMultipleAccounts'){reads++;if(beforeRead)await beforeRead(reads,req);result={context:{slot:1000000n+BigInt(reads)},value:req.params[0].map(k=>{const a=accounts.get(k);return !a?null:{owner:a.owner,lamports:a.lamports,executable:a.executable,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};})};}
  else throw new Error(`unexpected ${req.method}`);return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));};
 const pda=async(...s)=>(await nativePda(release.input.programId,'bio',...s)).address,root=accounts.get(await pda('root',instance)),registration=accounts.get(await pda('root-reg',instance)),registry=accounts.get(await pda('mining'));
 return {release,abi,actor,instance,accounts,calls,root,registration,registry,clock:accounts.get(PROGRAMS.clockSysvar),pda,setBeforeRead:fn=>{beforeRead=fn;},rpc:new ReadOnlyRpc({release,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl})};
}
const args=f=>({release:f.release,abi:f.abi,rpc:f.rpc,actor:f.actor,instance:f.instance,maxRent:100000000n});
function openHostPosition(f){
 const b=f.registration.data.subarray(120),seq=b.readBigUInt64LE(40)-1n;b[80]=0;b.fill(0,81,89);
 const a=[...f.accounts.values()].find(a=>a.owner===f.release.input.programId&&a.data.length===375&&a.data.readUInt16LE(10)===27&&a.data.subarray(120,152).equals(f.instance)&&a.data.readBigUInt64LE(152)===seq),p=a.data.subarray(120);
 p[157]=0;p.fill(0,158,199);p.fill(0,215,231);return a;
}

test('known-instance lookup reads unchanged genuine BIO and bounded real historical Positions without sending',async()=>{
 const f=await fixture(),r=await readPlayerAsset({...args(f),positionPageLimit:1});
 assert.equal(r.decision,'ASSET_READ');assert.equal(r.knownInstanceOnly,true);assert.equal(r.root.target,22);assert.equal(r.root.qualityPpm,2000000n);assert.equal(r.positions.length,1);assert.equal(r.positions[0].value.beneficiaryAddress,f.actor);
 assert.equal(r.nextNonce,23652n);assert.equal(r.nextPageStart,null);assert.ok(f.calls.every(m=>['getGenesisHash','getMultipleAccounts'].includes(m)));
 await assert.rejects(()=>readPlayerAsset({...args(f),positionPageLimit:21}),/ASSET_PAGE_LIMIT/);
});

test('actual closed BIO plans an exact restake while existing unpaid history does not become a prohibition',async()=>{
 const f=await fixture(),r=await planPlayerAssetAction({...args(f),kind:'stake'});
 assert.equal(r.decision,'ACTION');assert.equal(r.action.operation,'REGISTER_ORDINARY');assert.equal(r.preview.positionSequence,1n);assert.equal(r.preview.ordinaryWeight,95040000000000n);assert.equal(r.action.dynamicAccounts.length,2);
 assert.equal(r.action.dynamicAccounts[0].writable,false);assert.equal(r.rentSufficiencyVerified,false);assert.equal(r.networkFeeQuote,null);assert.equal(r.requiresSimulation,true);
 // HOST-ONLY backlog alteration, preserving the previous ended Position.
 f.registration.data.writeBigUInt64LE(0n,120+138);f.registration.data.writeBigUInt64LE(1n,120+146);
 assert.equal((await planPlayerAssetAction({...args(f),kind:'stake'})).decision,'ACTION');
});

test('alternate ordinary-open planning refuses duplicate stake and schedules exact latest-position exit',async()=>{
 const f=await fixture();openHostPosition(f);
 assert.equal((await planPlayerAssetAction({...args(f),kind:'stake'})).decision,'ALREADY_STAKED');
 const r=await planPlayerAssetAction({...args(f),kind:'exit'});assert.equal(r.decision,'ACTION');assert.equal(r.action.operation,'EXIT_ORDINARY');assert.equal(r.preview.positionSequence,0n);assert.equal(r.action.dynamicAccounts.length,0);
 assert.equal(r.action.suffix.at(-1).name,'OrdinaryEndEvent');assert.equal(r.action.payload.readBigUInt64LE(32),0n);
});

test('open K, future interval, other owner and consumed output are explicit blockers without an action',async()=>{
 {const f=await fixture();openHostPosition(f);const b=f.registration.data.subarray(120);b.writeBigUInt64LE(1n,89);b.fill(1,97,129);b[129]=0;b.fill(0,130,138);
  const r=await planPlayerAssetAction({...args(f),kind:'exit'});assert.equal(r.decision,'K_AWARE_EXIT_REQUIRED');assert.equal(r.action,undefined);}
 {const f=await fixture();f.registration.data.writeBigUInt64LE(10000n,120+81);assert.equal((await planPlayerAssetAction({...args(f),kind:'stake'})).decision,'WAIT_ORDINARY_END');}
 {const f=await fixture();const other=key(20);const {nativeKeyBytes}=await import('../src/native.mjs');nativeKeyBytes(other).copy(f.root.data,120+202);assert.equal((await planPlayerAssetAction({...args(f),kind:'stake'})).decision,'OWNER_MISMATCH');}
 {const f=await fixture();f.root.data[362]=1;f.root.data.fill(1,363,427);f.root.data.writeBigInt64LE(f.root.data.readBigInt64LE(306),427);f.root.data.writeBigUInt64LE(f.root.data.readBigUInt64LE(314),435);
  assert.equal((await planPlayerAssetAction({...args(f),kind:'stake'})).decision,'INPUT_ALREADY_CONSUMED');}
});

test('reread registration/registry drift prevents stale dependent pointers from producing an intent',async()=>{
 const f=await fixture();f.setBeforeRead(n=>{if(n===3)f.registration.data.writeBigUInt64LE(f.registration.data.readBigUInt64LE(152)+1n,152);});
 const r=await planPlayerAssetAction({...args(f),kind:'stake'});assert.equal(r.decision,'REPLAN_STALE_STATE');assert.equal(r.action,undefined);
});

test('page reader rejects an individually valid Position with the wrong lifetime directory and regressing Clock observations',async()=>{
 {const f=await fixture(),pos=[...f.accounts.values()].find(a=>a.owner===f.release.input.programId&&a.data.length===375&&a.data.readUInt16LE(10)===27&&a.data.subarray(120,152).equals(f.instance));pos.data.writeBigUInt64LE(pos.data.readBigUInt64LE(160)+1n,160);
  await assert.rejects(()=>readPlayerAsset(args(f)),/ASSET_POSITION_DIRECTORY/);}
 {const f=await fixture();f.setBeforeRead(n=>{if(n===3)f.clock.data.writeBigInt64LE(f.clock.data.readBigInt64LE(32)-1n,32);});
  await assert.rejects(()=>readPlayerAsset(args(f)),/ASSET_CLOCK_REGRESSION/);}
});

test('hostile malformed RootReg and nonfresh output/Event fail closed before proposal',async()=>{
 {const f=await fixture();f.registration.data[120+80]=2;await assert.rejects(()=>planPlayerAssetAction({...args(f),kind:'stake'}),/ROOT_REG_FACTS/);}
 {const f=await fixture(),event=await f.pda('mining-event',new (await import('../../protocol-core/src/index.mjs')).ByteWriter(8).u64(f.registry.data.readBigUInt64LE(160)).finish());f.accounts.set(event,{address:event,owner:f.release.input.programId,data:Buffer.from([1]),lamports:1n,executable:false,rentEpoch:0n});
  await assert.rejects(()=>planPlayerAssetAction({...args(f),kind:'stake'}),/ASSET_EVENT_NOT_FRESH/);}
});

test('HOST-ONLY cold-prefix model retains earlier lazy budgets and refuses an inconsistent first-stake book',async()=>{
 const f=await fixture(),MAX=(1n<<64n)-1n,b=f.registration.data.subarray(120);b.fill(0,32);b[80]=1;b[129]=1;b.writeBigUInt64LE(MAX,146);b.writeBigUInt64LE(MAX,244);
 const rb=Buffer.alloc(256);rb.writeBigUInt64LE(3n,8);for(const at of [72,80,232])rb.writeBigUInt64LE(MAX,at);
 const reg=await recordAccount(f.release,{kind:26,schema:2,seeds:['bio','mining'],id:baseConfigR2Id(f.release),body:rb});f.accounts.set(reg.address,reg);
 const seq=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
 for(const address of [await f.pda('mining-root',seq(0n)),await f.pda('mining-event',seq(0n)),await f.pda('reg',f.instance,seq(0n)),await f.pda('hour',seq(3n))])f.accounts.delete(address);
 const mint=f.accounts.get(await f.pda('lab-mint')),reserve=f.accounts.get(await f.pda('lab-reserve')),treasury=f.accounts.get(await f.pda('treasury'));mint.data.writeBigUInt64LE(TOTAL_SUPPLY,36);reserve.data.writeBigUInt64LE(TOTAL_SUPPLY,64);
 treasury.data.fill(0,120);treasury.data.writeBigUInt64LE(TOTAL_SUPPLY-17n,120);treasury.data.writeBigUInt64LE(17n,144);
 const planned=await planPlayerAssetAction({...args(f),kind:'stake'});assert.equal(planned.decision,'ACTION');assert.equal(planned.preview.positionSequence,0n);assert.equal(planned.action.dynamicAccounts.length,1);
 const completed=completedHours(f.clock.data.readBigInt64LE(32),f.release.rewardStart);assert.equal(planned.preview.coldPrefixAtoms,emissionPrefix(completed)-emissionPrefix(3n));
 assert.ok(emissionPrefix(completed)-planned.preview.coldPrefixAtoms>0n,'older lazy prefix remains pending');
 treasury.data.writeBigUInt64LE(1n,136);treasury.data.writeBigUInt64LE(TOTAL_SUPPLY-18n,120);
 await assert.rejects(()=>planPlayerAssetAction({...args(f),kind:'stake'}),/ASSET_COLD_PENDING/);
});

test('guided zero-debt result does not promise settled history, and historical claim checks actual reserve book without Root ownership',async()=>{
 const f=await fixture();assert.equal((await planGuidedPositionAction({...args(f),kind:'claim',positionSeq:0n})).decision,'NO_ACCRUED_DEBT');
 const pos=[...f.accounts.values()].find(a=>a.owner===f.release.input.programId&&a.data.length===375&&a.data.readUInt16LE(10)===27&&a.data.subarray(120,152).equals(f.instance));
 pos.data.writeBigUInt64LE(pos.data.readBigUInt64LE(351)+7n,351);
 const treasury=f.accounts.get(await f.pda('treasury'));treasury.data.writeBigUInt64LE(treasury.data.readBigUInt64LE(136)+7n,136);treasury.data.writeBigUInt64LE(treasury.data.readBigUInt64LE(144)-7n,144);
 f.accounts.delete(f.root.address);f.accounts.delete(f.registration.address);f.accounts.delete(f.registry.address);
 const r=await planGuidedPositionAction({...args(f),kind:'claim',positionSeq:0n});assert.equal(r.decision,'ACTION');assert.equal(r.previewAtoms,7n);assert.equal(r.beneficiary,f.actor);assert.equal(r.action.operation,'CLAIM_POSITION');assert.equal(r.ataRentCoveredByNativeMaxRent,false);
 treasury.data.writeBigUInt64LE(0n,136);await assert.rejects(()=>planGuidedPositionAction({...args(f),kind:'claim',positionSeq:0n}),/ASSET_CLAIM_BOOK/);
});
