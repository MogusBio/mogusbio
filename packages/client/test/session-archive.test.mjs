import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {NativePlayerSession} from '../src/session.mjs';import {PendingJournal} from '../src/journal.mjs';import {FileJournalStore} from '../src/file-journal.mjs';
import {nativePda,nativeKeyBytes,nativeKeyAddress,nativeRequestHash,nativeBusinessKey,encodeSyncEmissionPayload} from '../src/native.mjs';
import {encodeRecord,encodeActorNonceBody} from '../../protocol-core/src/index.mjs';import {baseConfigR2Id} from '../src/release.mjs';import {clientFixture,key} from './native-fixture.mjs';import {baseAccount} from './account-fixture.mjs';

test('actual session compacts512 terminal entries, reopens old result and admits another device nonce with an empty retained journal',async()=>{
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-session-archive-'));
  try{
    const c=await clientFixture(),store=await FileJournalStore.open({directory}),payload=encodeSyncEmissionPayload({maxRent:1000000n}),s=JSON.parse(new PendingJournal(c).serialize());
    for(let n=0;n<512;n++){const nonce=BigInt(n),frame=c.frame('SYNC_EMISSION',payload,nonce),digestHex=nativeRequestHash(c.abi,frame).toString('hex'),result=Buffer.alloc(8);result.writeBigUInt64LE(nonce+10n);
      const observation={contextSlot:(nonce+21n).toString(),nextNonce:(nonce+1n).toString(),lastDigestHex:digestHex,lastResultHex:result.toString('hex')};
      s.entries.push({nonce:nonce.toString(),frameHex:frame.toString('hex'),digestHex,businessHex:nativeBusinessKey(c.abi,frame).toString('hex'),state:n===511?'PREPARED':'CONFIRMED',attempts:[],resultHex:n===511?null:result.toString('hex'),lastObservation:n===511?null:observation,lastError:null});if(n!==511)s.globalObservation=observation;}
    s.revision='1023';const initial=PendingJournal.restore(c,JSON.stringify(s));await store.compareAndSwap(0n,initial.serialize());
    const base=await baseAccount(c.release),noncePda=await nativePda(c.release.input.programId,'bio','actor-nonce',nativeKeyBytes(c.actor));let next=512n,slot=600n,calls=[];
    const rpcAccount=a=>({owner:a.owner,executable:a.executable,lamports:10000000n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']});
    const fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);calls.push(req.method);let result;
      if(req.method==='getGenesisHash')result=nativeKeyAddress(c.release.hashes.genesisHash);
      else if(req.method==='getLatestBlockhash')result={context:{slot},value:{blockhash:key(20),lastValidBlockHeight:1000n}};
      else if(req.method==='getMultipleAccounts'){const frame=c.frame('SYNC_EMISSION',payload,next-1n),r=Buffer.alloc(8);r.writeBigUInt64LE(next-1n+10n);const data=encodeRecord({kind:35,schema:1,domain:c.release.domain,configId:baseConfigR2Id(c.release),recordKey:nativeKeyBytes(c.actor),bump:noncePda.bump,body:encodeActorNonceBody({nextNonce:next,lastDigest:nativeRequestHash(c.abi,frame),lastResult:r})});
        result={context:{slot},value:req.params[0].map(address=>rpcAccount(address===base.address?base:{owner:c.release.input.programId,executable:false,data}))};}
      else throw new Error(`Unexpected network call ${req.method}`);return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));};
    const session=()=>new NativePlayerSession({...c,store,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl});
    assert.equal((await session().reconcile(511n)).decision,'CONFIRMED');let stored=await store.load();assert.equal(JSON.parse(stored.payload).entries.length,0);assert.equal(JSON.parse(stored.payload).globalObservation.nextNonce,'512');
    calls=[];const historical=await session().reconcile(0n);assert.equal(historical.decision,'CONFIRMED');assert.equal(historical.resultSource,'LOCAL_DURABLE_ARCHIVE');assert.equal(historical.resultBytes.readBigUInt64LE(),10n);assert.equal(historical.networkSubmitted,false);assert.deepEqual(calls,[]);
    next=520n;slot=700n;const seeds={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'},suffix=await Promise.all(c.abi.operations.find(o=>o.name==='SYNC_EMISSION').publicFixedSuffix.map(async r=>({name:r.role,address:(await nativePda(c.release.input.programId,'bio',seeds[r.role])).address})));
    const envelope=await session().prepare({operation:'SYNC_EMISSION',nonce:520n,payload,suffix,resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:32768,priorityFeeLamports:0n}});assert.equal(envelope.nonce,'520');stored=await store.load();assert.equal(JSON.parse(stored.payload).entries.length,1);assert.equal(JSON.parse(stored.payload).globalObservation.nextNonce,'520');assert.equal(JSON.parse(stored.payload).entries[0].state,'PREPARED');assert.equal(calls.includes('sendTransaction'),false);
    assert.equal((await session().reconcile(0n)).resultBytes.readBigUInt64LE(),10n);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
