import test from 'node:test';import assert from 'node:assert/strict';
import { createKeyPairFromPrivateKeyBytes,signTransaction } from '@solana/kit';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { encodeRecord,encodeActorNonceBody } from '../../protocol-core/src/index.mjs';
import { NativePlayerSession,inspectPreparedNativeEnvelope } from '../src/session.mjs';
import { nativePda,nativeKeyBytes,nativeKeyAddress,nativeRequestHash,encodeSyncEmissionPayload } from '../src/native.mjs';
import { baseConfigR2Id } from '../src/release.mjs';
import { transactionBytes,decodeV1Transaction } from '../src/transaction.mjs';
import { clientFixture,key,hash } from './native-fixture.mjs';import { baseAccount } from './account-fixture.mjs';
const pair=await createKeyPairFromPrivateKeyBytes(hash('BIOP0R2 native SIGNING FIXTURE ONLY 1'));
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const rpcAccount=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:10000000n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']};
class MemoryStore{revision=0n;payload=null;reject=false;async load(){return {revision:this.revision,payload:this.payload};}async compareAndSwap(expected,payload){if(this.reject||expected!==this.revision)return false;this.payload=payload;return ++this.revision;}}
async function fixture(endpoint='http://127.0.0.1:8899'){
  const c=await clientFixture(),base=await baseAccount(c.release),store=new MemoryStore(),p=await nativePda(c.release.input.programId,'bio','actor-nonce',nativeKeyBytes(c.actor));
  const state={slot:10n,nextNonce:0n,digest:null,result:null,blockhash:key(20),height:100n,lastValid:200n,valid:true,failSend:false,wrongGenesis:false},calls=[];
  const nonceAccount=()=>state.nextNonce===0n?null:{owner:c.release.input.programId,executable:false,data:encodeRecord({kind:35,schema:1,domain:c.release.domain,
    configId:baseConfigR2Id(c.release),bump:p.bump,recordKey:nativeKeyBytes(c.actor),body:encodeActorNonceBody({nextNonce:state.nextNonce,lastDigest:state.digest,lastResult:state.result})})};
  const fetchImpl=async(_,opts)=>{assert.equal(opts.redirect,'error');const req=parseJsonWithBigInts(opts.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=state.wrongGenesis?key(22):nativeKeyAddress(c.release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts'){assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[1].minContextSlot<=state.slot);result={context:{slot:state.slot},value:req.params[0].map(k=>rpcAccount(k===base.address?base:k===p.address?nonceAccount():null))};}
    else if(req.method==='getLatestBlockhash')result={context:{slot:state.slot},value:{blockhash:state.blockhash,lastValidBlockHeight:state.lastValid}};
    else if(req.method==='getBlockHeight')result=state.height;
    else if(req.method==='isBlockhashValid')result={context:{slot:state.slot},value:state.valid};
    else if(req.method==='sendTransaction'){
      const entry=JSON.parse(store.payload).entries[0];assert.equal(entry.state,'PENDING');assert.equal(entry.attempts.length>=1,true);
      assert.equal(req.params[1].skipPreflight,false);assert.equal(req.params[1].maxRetries,0n);
      if(state.failSend)throw new Error('simulated socket lost after leader accepted');result=entry.attempts.at(-1).signature;
    }else throw new Error(req.method);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}),{status:200});
  };
  const session=()=>new NativePlayerSession({...c,endpoint,fetchImpl,store,allowLocalhost:true});
  const seeds={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'};
  const suffix=await Promise.all(c.abi.operations.find(o=>o.name==='SYNC_EMISSION').publicFixedSuffix.map(async r=>({name:r.role,address:(await nativePda(c.release.input.programId,'bio',seeds[r.role])).address})));
  const intent={operation:'SYNC_EMISSION',nonce:0n,payload:encodeSyncEmissionPayload({maxRent:100000000n}),suffix,resources};
  const sign=async e=>transactionBytes(await signTransaction([pair],decodeV1Transaction(Buffer.from(e.unsignedHex,'hex')).transaction));
  const confirm=e=>{state.nextNonce=BigInt(e.nonce)+1n;state.digest=nativeRequestHash(c.abi,Buffer.from(e.frameHex,'hex'));state.result=Buffer.alloc(8);state.result.writeBigUInt64LE(42n);state.slot++;};
  return {...c,store,state,calls,session,intent,sign,confirm};
}
test('prepare reconstructs exact native action, records pending before real-signed send and accepts only finalized business confirmation',async()=>{
  const f=await fixture(),s=f.session();assert.equal(f.calls.length,0);const e=await s.prepare(f.intent);
  assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);assert.equal(JSON.parse(f.store.payload).entries[0].state,'PREPARED');
  assert.equal((await inspectPreparedNativeEnvelope({...f,envelope:JSON.parse(JSON.stringify(e))})).businessExecutionVerified,false);
  const signed=await f.sign(e),sent=await s.broadcastSigned(e,signed);assert.equal(sent.decision,'PENDING');assert.equal(sent.businessExecutionVerified,false);
  f.confirm(e);const outcome=await f.session().reconcile(0n);assert.equal(outcome.decision,'CONFIRMED');assert.equal(outcome.resultBytes.readBigUInt64LE(),42n);
  const duplicate=await f.session().broadcastSigned(e,signed);assert.equal(duplicate.decision,'CONFIRMED');assert.equal(duplicate.networkSubmitted,false);
  assert.equal(f.calls.filter(c=>c.method==='sendTransaction').length,1);
});
test('timeout survives restart; fresh blockhash preserves exact frame/nonce and old signature cannot sign new message',async()=>{
  const f=await fixture(),e=await f.session().prepare(f.intent);f.state.failSend=true;
  const out=await f.session().broadcastSigned(e,await f.sign(e));assert.equal(out.decision,'UNKNOWN');assert.equal(JSON.parse(f.store.payload).entries[0].state,'UNKNOWN');
  const oldSigned=await f.sign(e);f.state.slot++;f.state.blockhash=key(21);f.state.lastValid=300n;const refreshed=await f.session().refresh(e);
  assert.equal(refreshed.frameHex,e.frameHex);assert.equal(refreshed.nonce,e.nonce);assert.notEqual(refreshed.unsignedHex,e.unsignedHex);
  await assert.rejects(f.session().broadcastSigned(refreshed,oldSigned),/CHANGED_TRANSACTION_MESSAGE/);
  f.state.failSend=false;assert.equal((await f.session().broadcastSigned(refreshed,await f.sign(refreshed))).decision,'PENDING');
  assert.equal(JSON.parse(f.store.payload).entries[0].attempts.length,2);f.confirm(refreshed);assert.equal((await f.session().reconcile(0n)).decision,'CONFIRMED');
});
test('changed payload/account/fees, expired lifetime, missing signatures and public fixture endpoints fail before any submission',async()=>{
  const f=await fixture(),e=await f.session().prepare(f.intent),signed=await f.sign(e);
  for(const change of [x=>x.frameHex=x.frameHex.slice(0,-2)+'01',x=>x.resources.priorityFeeLamports='1',x=>x.operation='OPEN_HOUR',
    x=>x.dynamicAccounts.push({address:key(25),writable:true,signer:false}),x=>x.unsignedHex=x.unsignedHex.slice(0,-2)+'ff',x=>x.extra=true]){
    const bad=structuredClone(e);change(bad);await assert.rejects(f.session().broadcastSigned(bad,signed));
  }
  await assert.rejects(f.session().broadcastSigned(e,Buffer.from(e.unsignedHex,'hex')),/SIGNATURE/);
  f.state.height=201n;await assert.rejects(f.session().broadcastSigned(e,signed),/BLOCKHASH_EXPIRED/);assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
  f.state.height=100n;f.state.valid=false;const forgedHeight=structuredClone(e);forgedHeight.lifetime.lastValidBlockHeight='999999';
  await assert.rejects(f.session().broadcastSigned(forgedHeight,signed),/BLOCKHASH_INVALID/);
  const pub=await fixture('https://rpc.example.invalid'),ep=await pub.session().prepare(pub.intent);await assert.rejects(pub.session().broadcastSigned(ep,await pub.sign(ep)),/FIXTURE_LOOPBACK_ONLY/);
});
test('journal CAS and wrong genesis prevent wallet preparation or sending unrecorded requests',async()=>{
  const f=await fixture();f.store.reject=true;await assert.rejects(f.session().prepare(f.intent),/STORAGE_CAS/);assert.equal(f.store.payload,null);
  assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
  const bad=await fixture();bad.state.wrongGenesis=true;await assert.rejects(bad.session().prepare(bad.intent),/GENESIS/);assert.equal(bad.store.payload,null);
  const noFetch=new NativePlayerSession({...bad,store:bad.store,endpoint:'https://rpc.example.invalid'});await assert.rejects(noFetch.prepare(bad.intent),/NOT_INJECTED/);
});
