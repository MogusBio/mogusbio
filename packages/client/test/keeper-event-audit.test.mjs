import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { ByteWriter,typedHash } from '../../protocol-core/src/index.mjs';
import { encodePositionBody } from '../../settlement/src/wire.mjs';
import { H_END } from '../../settlement/src/emission.mjs';
import { K_WEIGHT } from '../../settlement/src/weights.mjs';
import { settlementFixture } from './settlement-fixture.mjs';
import { baseAccount,recordAccount } from './account-fixture.mjs';
import { hash } from './native-fixture.mjs';
import { nativeKeyAddress } from '../src/native.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { planNextGlobalSettlement } from '../src/keeper.mjs';
import { decodeNativeDirectory,decodeNativeMiningEvent,decodeNativeActivation } from '../src/accounts.mjs';

const MAX=(1n<<64n)-1n;
const FAMILY=Buffer.from('a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe','hex');
const le=n=>new ByteWriter(8).u64(n).finish();
const id=(f,k,...tail)=>typedHash(14,Buffer.concat([f.release.domain,new ByteWriter(2).u16(k).finish(),...tail]));
const args=f=>({release:f.release,abi:f.abi,rpc:f.rpc,actor:f.actor,maxRent:10000000n});
function u128(b,at,n){b.writeBigUInt64LE(n&MAX,at);b.writeBigUInt64LE(n>>64n,at+8);}

// Independent canonical byte fixtures for client planning only. Mutating these
// host records neither executes a native event nor establishes mining rights.
async function environment(){
  const f=await settlementFixture({lazy:false});f.clockAccount.data.writeBigUInt64LE(10n,0);
  const accounts=new Map([await baseAccount(f.release),f.registryAccount,f.clockAccount].map(a=>[a.address,a]));
  const calls=[];let hook=()=>{};
  const fetchImpl=async(_,options)=>{
    const request=parseJsonWithBigInts(options.body);calls.push(request);let result;
    if(request.method==='getGenesisHash')result=nativeKeyAddress(f.release.hashes.genesisHash);
    else if(request.method==='getMultipleAccounts'){
      await hook(request.params[0]);
      result={context:{slot:10n},value:request.params[0].map(address=>{
        const a=accounts.get(address);return a?{owner:a.owner,executable:a.executable,lamports:a.lamports??0n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']}:null;
      })};
    }else throw new Error(`forbidden or unexpected RPC method ${request.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result}));
  };
  return {...f,accounts,calls,setHook(fn){hook=fn;},rpc:new ReadOnlyRpc({release:f.release,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl})};
}
function registry(f,{hour=0n,count=3n,active=0n,head=MAX,tail=MAX,eventCount=1n,eventCursor=0n,due=hour}={}){
  const b=f.registryAccount.data.subarray(120);b.fill(0);b.writeBigUInt64LE(count,0);b.writeBigUInt64LE(hour,8);
  b.writeBigUInt64LE(BigInt(f.release.input.rewardStart),16);b.writeBigUInt64LE(eventCount,40);b.writeBigUInt64LE(eventCursor,48);b.writeBigUInt64LE(due,56);
  b.writeBigUInt64LE(active,64);b.writeBigUInt64LE(head,72);b.writeBigUInt64LE(tail,80);u128(b,88,f.p.weight*active);b.writeBigUInt64LE(MAX,232);
}
async function directory(f,seq,{active=false,previous=MAX,next=MAX,instance=hash(`audit-root-${seq}`),positionSequence=0n}={}){
  const b=Buffer.alloc(138);b.writeBigUInt64LE(seq);instance.copy(b,9);instance.copy(b,41);b[81]=active?1:0;
  if(active){id(f,27,instance,le(positionSequence)).copy(b,82);b.writeBigUInt64LE(positionSequence,114);}
  b.writeBigUInt64LE(previous,122);b.writeBigUInt64LE(next,130);
  const a=await recordAccount(f.release,{kind:28,schema:2,seeds:['bio','mining-root',le(seq)],id:id(f,28,Buffer.from([0]),le(seq)),body:b});
  f.accounts.set(a.address,a);return {account:a,instance,seq,pid:id(f,27,instance,le(positionSequence))};
}
async function position(f,d,{start=0n,end=1n,coverage=start}={}){
  const p={...f.p,instance:d.instance,rootDirectorySeq:d.seq,start,end,nextUnsettledHour:coverage};
  if(end===start)p.endReason=2;
  if(end===null)Object.assign(p,{endReason:0,endBusiness:Buffer.alloc(32),endedTime:0n,endedSlot:0n});
  const a=await recordAccount(f.release,{kind:27,schema:2,seeds:['bio','reg',d.instance,le(0n)],id:d.pid,body:encodePositionBody(p)});
  f.accounts.set(a.address,a);return a;
}
async function event(f,d,{kind=0,due=0n,sequence=0n,activation=Buffer.alloc(32)}={}){
  const b=Buffer.alloc(177);b.writeBigUInt64LE(sequence);b.writeBigUInt64LE(due,8);b[16]=kind;d.instance.copy(b,17);d.pid.copy(b,49);
  b.writeBigUInt64LE(d.seq,81);activation.copy(b,97);hash('audit-event-business').copy(b,129);b.writeBigInt64LE(1n,161);b.writeBigUInt64LE(1n,169);
  const a=await recordAccount(f.release,{kind:38,seeds:['bio','mining-event',le(sequence)],id:id(f,38,le(sequence)),body:b});f.accounts.set(a.address,a);return a;
}
async function activation(f,d,{start=0n,end=null}={}){
  const b=Buffer.alloc(251),winner=hash('audit-winner'),local=4n;
  FAMILY.copy(b);winner.copy(b,32);d.instance.copy(b,64);f.p.beneficiary.copy(b,96);d.pid.copy(b,128);b.writeBigUInt64LE(3n,160);b.writeBigUInt64LE(local,168);b.writeBigUInt64LE(2n,176);b.writeBigUInt64LE(start,184);
  b.writeBigUInt64LE(1n,202);b.writeBigUInt64LE(1n,210);b.writeBigInt64LE(1n,218);
  if(end!==null){b[192]=1;b.writeBigUInt64LE(end,193);b[201]=1;b[226]=1;b.writeBigUInt64LE(2n,227);b.writeBigUInt64LE(2n,235);b.writeBigInt64LE(2n,243);}
  const aid=typedHash(11,Buffer.concat([f.release.domain,FAMILY,winner,le(local)]));
  const a=await recordAccount(f.release,{kind:17,seeds:['bio','activation',aid],id:aid,body:b});f.accounts.set(a.address,a);return {id:aid,account:a};
}
function assertBounded(f){
  assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts'].includes(c.method)));
  assert.ok(f.calls.filter(c=>c.method==='getMultipleAccounts').every(c=>c.params[0].length<=2));
  assert.ok(f.calls.length<14,'event frontier reads must not enumerate the Root directory');
}

test('audit START appends exactly the current tail Directory W with a large historical directory',async()=>{
  const f=await environment();registry(f,{count:1000000000n,active:1n,head:2n,tail:2n});
  const d=await directory(f,0n),tail=await directory(f,2n,{active:true});await position(f,d);await event(f,d);
  const result=await planNextGlobalSettlement(args(f));assert.equal(result.decision,'ACTION');const a=result.action;
  assert.equal(a.operation,'APPLY_EVENT');assert.deepEqual(a.suffix.map(v=>v.name),['Registry','Event','Directory','Position']);
  assert.deepEqual(a.dynamicAccounts,[{address:tail.account.address,writable:true,signer:false}]);
  assert.equal(a.instruction.accounts.at(-1).address,tail.account.address);assert.equal(a.instruction.accounts.at(-1).role,1);
  assert.equal(a.payload.readBigUInt64LE(0),0n);assert.equal(a.payload.readBigUInt64LE(8),0n);assertBounded(f);
});

test('audit END uses previous then next W and does not require private historical debt completion',async()=>{
  const f=await environment();registry(f,{hour:1n,active:3n,head:0n,tail:2n});
  const prev=await directory(f,0n,{active:true,next:1n}),d=await directory(f,1n,{active:true,previous:0n,next:2n}),next=await directory(f,2n,{active:true,previous:1n});
  await position(f,d,{end:1n,coverage:0n});await event(f,d,{kind:1,due:1n});
  const result=await planNextGlobalSettlement(args(f));assert.equal(result.action.operation,'APPLY_EVENT');
  assert.deepEqual(result.action.dynamicAccounts,[prev,next].map(d=>({address:d.account.address,writable:true,signer:false})));assertBounded(f);
});

test('audit K_START and K_END take one actual Activation R and preserve the native offsets',async()=>{
  for(const kind of [2,3]){
    const f=await environment(),due=kind===2?0n:1n;registry(f,{hour:due,active:1n,head:0n,tail:0n});
    const d=await directory(f,0n,{active:true});await position(f,d,{end:null});const k=await activation(f,d,{end:kind===3?1n:null});
    if(kind===3){const b=f.registryAccount.data.subarray(120);k.id.copy(b,104);d.instance.copy(b,136);f.p.beneficiary.copy(b,168);d.pid.copy(b,200);b.writeBigUInt64LE(0n,232);u128(b,240,K_WEIGHT);}
    const e=await event(f,d,{kind,due,activation:k.id}),decoded=await decodeNativeMiningEvent(f.release,e,0n),ka=await decodeNativeActivation(f.release,k.account,k.id);
    assert.equal(decoded.kind,kind);assert.equal(decoded.due,due);assert.equal(decoded.directory,0n);assert.deepEqual(decoded.activationId,k.id);
    assert.equal(ka.generation,3n);assert.equal(ka.local,4n);assert.equal(ka.global,2n);assert.equal(ka.end,kind===3?1n:null);
    const result=await planNextGlobalSettlement(args(f));assert.equal(result.action.operation,'APPLY_EVENT');
    assert.deepEqual(result.action.dynamicAccounts,[{address:k.account.address,writable:false,signer:false}]);
    assert.equal(result.action.instruction.accounts.at(-1).role,0);assertBounded(f);
  }
});

test('audit H_END applies a terminal END before declaring the emission frontier complete',async()=>{
  const f=await environment();registry(f,{hour:H_END,active:1n,head:0n,tail:0n,due:H_END});
  f.clockAccount.data.writeBigInt64LE(BigInt(f.release.input.rewardStart)+(H_END+1n)*3600n,32);
  const d=await directory(f,0n,{active:true});await position(f,d,{end:H_END,coverage:0n});await event(f,d,{kind:1,due:H_END});
  assert.equal((await planNextGlobalSettlement(args(f))).action.operation,'APPLY_EVENT');
  registry(f,{hour:H_END,eventCount:1n,eventCursor:1n,due:H_END});
  assert.equal((await planNextGlobalSettlement(args(f))).decision,'EMISSION_FRONTIER_COMPLETE');
});

test('audit zero-length START and END at one boundary precede an empty-range skip',async()=>{
  const f=await environment();registry(f,{eventCount:2n});const d=await directory(f,0n);await position(f,d,{end:0n});
  await event(f,d);await event(f,d,{kind:1,sequence:1n});
  assert.equal((await planNextGlobalSettlement(args(f))).action.payload.readBigUInt64LE(0),0n);
  // Model only the canonical byte results of the first event to inspect the
  // next client plan; this does not substitute for the native event tests.
  registry(f,{active:1n,head:0n,tail:0n,eventCount:2n,eventCursor:1n});await directory(f,0n,{active:true});
  const end=await planNextGlobalSettlement(args(f));assert.equal(end.action.operation,'APPLY_EVENT');assert.equal(end.action.payload.readBigUInt64LE(0),1n);
  registry(f,{eventCount:2n,eventCursor:2n});await directory(f,0n);
  const skip=await planNextGlobalSettlement(args(f));assert.equal(skip.action.operation,'EMPTY_SKIP');assert.equal(skip.action.payload.readBigUInt64LE(8),1n);
});

test('audit ordinary event/Directory and K Activation codecs reject identity, sentinel and stop corruption',async()=>{
  const f=await environment(),d=await directory(f,0n,{active:true});const e=await event(f,d),k=await activation(f,d,{end:1n});
  const badEvent={...e,data:Buffer.from(e.data)};badEvent.data[120+49]^=1;
  await assert.rejects(()=>decodeNativeMiningEvent(f.release,badEvent,0n),{code:'EVENT_IDENTITY'});
  const badDirectory={...d.account,data:Buffer.from(d.account.data)};badDirectory.data.writeBigUInt64LE(0n,120+122);
  await assert.rejects(()=>decodeNativeDirectory(f.release,badDirectory,0n),{code:'DIRECTORY_MEMBERSHIP'});
  const badActivation={...k.account,data:Buffer.from(k.account.data)};badActivation.data[120+226]=0;
  await assert.rejects(()=>decodeNativeActivation(f.release,badActivation,k.id),{code:'ACTIVATION_END'});
  const wrongFamily={...k.account,data:Buffer.from(k.account.data)};wrongFamily.data[120]^=1;
  await assert.rejects(()=>decodeNativeActivation(f.release,wrongFamily,k.id),{code:'ACTIVATION_FACTS'});
});

test('audit concurrent Registry mutation returns REPLAN_STALE_REGISTRY without a ready action',async()=>{
  const f=await environment();registry(f,{active:1n,head:2n,tail:2n});const d=await directory(f,0n);await directory(f,2n,{active:true});await position(f,d);await event(f,d);
  f.setHook(addresses=>{if(addresses.includes(d.account.address))f.registryAccount.data.writeBigUInt64LE(1n,120+48);});
  const result=await planNextGlobalSettlement(args(f));assert.equal(result.decision,'REPLAN_STALE_REGISTRY');assert.equal(result.action,undefined);
  // Registry creation races use the same decision, rather than preparing a
  // second initialization against a newly initialized actual Registry.
  const g=await environment();g.accounts.delete(g.registryAccount.address);let registryReads=0;
  g.setHook(addresses=>{if(addresses.includes(g.registryAccount.address)&&++registryReads===2)g.accounts.set(g.registryAccount.address,g.registryAccount);});
  assert.equal((await planNextGlobalSettlement(args(g))).decision,'REPLAN_STALE_REGISTRY');
});

test('audit Event timestamp and final Clock regression are refused before returning an action',async()=>{
  const f=await environment();registry(f);const d=await directory(f,0n);await position(f,d);const e=await event(f,d);
  e.data.writeBigUInt64LE(11n,120+169);await assert.rejects(()=>planNextGlobalSettlement(args(f)),{code:'KEEPER_EVENT_CLOCK'});
  e.data.writeBigUInt64LE(1n,120+169);f.setHook(addresses=>{if(addresses.includes(d.account.address))f.clockAccount.data.writeBigUInt64LE(9n,0);});
  await assert.rejects(()=>planNextGlobalSettlement(args(f)),{code:'KEEPER_CLOCK_REGRESSION'});
});
