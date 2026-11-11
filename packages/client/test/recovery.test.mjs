import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createKeyPairFromPrivateKeyBytes,signTransaction } from '@solana/kit';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { encodeRecord,encodeActorNonceBody } from '../../protocol-core/src/index.mjs';
import { NativePlayerSession } from '../src/session.mjs';
import { FileJournalStore } from '../src/file-journal.mjs';
import { prepareNativeCancellation,reconcileNativeCancellation } from '../src/recovery.mjs';
import { nativePda,nativeKeyAddress,nativeKeyBytes,nativeRequestHash,decodeNativeFrame,encodeSyncEmissionPayload } from '../src/native.mjs';
import { decodeV1Transaction,transactionBytes } from '../src/transaction.mjs';
import { baseConfigR2Id } from '../src/release.mjs';
import { clientFixture,key,hash } from './native-fixture.mjs';
import { baseAccount } from './account-fixture.mjs';

const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const rpcAccount=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:10000000n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']};
const signingPair=await createKeyPairFromPrivateKeyBytes(hash('BIOP0R2 native SIGNING FIXTURE ONLY 1'));
async function environment(){
  const c=await clientFixture(),directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-cancellation-'));
  const primaryDir=path.join(directory,'primary'),cancellationDir=path.join(directory,'cancellation');
  const primaryStore=await FileJournalStore.open({directory:primaryDir}),cancellationStore=await FileJournalStore.open({directory:cancellationDir});
  const base=await baseAccount(c.release),noncePda=await nativePda(c.release.input.programId,'bio','actor-nonce',nativeKeyBytes(c.actor));
  const state={nextNonce:0n,digest:null,result:null,slot:10n,blockhash:key(20),lastValid:1000n,sendTimeout:false},calls=[];
  const nonceAccount=()=>state.nextNonce===0n?null:{owner:c.release.input.programId,executable:false,data:encodeRecord({kind:35,schema:1,domain:c.release.domain,
    configId:baseConfigR2Id(c.release),bump:noncePda.bump,recordKey:nativeKeyBytes(c.actor),body:encodeActorNonceBody({nextNonce:state.nextNonce,lastDigest:state.digest,lastResult:state.result})})};
  const fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(c.release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts'){
      const slot=state.slot,value=req.params[0].map(address=>rpcAccount(address===base.address?base:address===noncePda.address?nonceAccount():null));
      if(req.params[0].includes(noncePda.address)&&state.afterNonceRead)state.afterNonceRead();
      result={context:{slot},value};
    }
    else if(req.method==='getLatestBlockhash')result={context:{slot:state.slot},value:{blockhash:state.blockhash,lastValidBlockHeight:state.lastValid}};
    else if(req.method==='getBlockHeight')result=100n;
    else if(req.method==='isBlockhashValid')result={context:{slot:state.slot},value:true};
    else if(req.method==='sendTransaction'){
      if(state.sendTimeout)throw new Error('socket timeout after possible leader receipt');
      const tx=decodeV1Transaction(Buffer.from(req.params[0],'base64')).transaction;
      const {getBase58Decoder}=await import('@solana/kit');result=getBase58Decoder().decode(Object.values(tx.signatures)[0]);
    }else throw new Error(`Unexpected RPC method ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  };
  const session=store=>new NativePlayerSession({...c,store,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl});
  let primarySession=session(primaryStore),cancellationSession=session(cancellationStore);
  const seeds={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'};
  const suffix=await Promise.all(c.abi.operations.find(o=>o.name==='SYNC_EMISSION').publicFixedSuffix.map(async r=>({name:r.role,address:(await nativePda(c.release.input.programId,'bio',seeds[r.role])).address})));
  const original=await primarySession.prepare({operation:'SYNC_EMISSION',nonce:0n,payload:encodeSyncEmissionPayload({maxRent:99999999n}),suffix,resources});
  const args=()=>({...c,primarySession,cancellationSession,nonce:0n,maxRent:1000000n,resources});
  const confirm=envelope=>{state.nextNonce=BigInt(envelope.nonce)+1n;state.digest=nativeRequestHash(c.abi,Buffer.from(envelope.frameHex,'hex'));state.result=Buffer.alloc(8);state.result.writeBigUInt64LE(42n);state.slot++;};
  const reopen=async()=>{primarySession=session(await FileJournalStore.open({directory:primaryDir}));cancellationSession=session(await FileJournalStore.open({directory:cancellationDir}));};
  const sign=async envelope=>transactionBytes(await signTransaction([signingPair],decodeV1Transaction(Buffer.from(envelope.unsignedHex,'hex')).transaction));
  return {...c,directory,primaryDir,cancellationDir,primaryStore,cancellationStore,state,calls,fetchImpl,base,session,original,args,confirm,reopen,sign,
    cleanup:()=>fs.rm(directory,{recursive:true,force:true})};
}

test('separate durable cancellation retains the original Frame, fixed SYNC suffix and original nonce without signing or sending',async()=>{
  const e=await environment();try{
    const before=await e.args().primarySession.getRequest(0n),prepared=await prepareNativeCancellation(e.args());
    assert.equal(prepared.decision,'CANCELLATION_PREPARED');assert.equal(prepared.requiresSeparateSignature,true);assert.equal(prepared.businessExecutionVerified,false);
    const f=decodeNativeFrame(e.abi,Buffer.from(prepared.envelope.frameHex,'hex'));
    assert.equal(f.operation,'SYNC_EMISSION');assert.equal(f.nonce,0n);assert.equal(prepared.envelope.nonce,'0');
    assert.notEqual(prepared.envelope.frameHex,e.original.frameHex);assert.equal(prepared.envelope.dynamicAccounts.length,0);
    assert.deepEqual(prepared.envelope.suffix.map(r=>r.name),['LABMint','LABReserve','LABAuth','Treasury','Registry']);
    assert.deepEqual((await e.args().primarySession.getRequest(0n)).frameBytes,before.frameBytes);
    assert.equal(JSON.parse((await e.primaryStore.load()).payload).entries.length,1);assert.equal(JSON.parse((await e.cancellationStore.load()).payload).entries.length,1);
    const pending=await reconcileNativeCancellation(e.args());assert.equal(pending.decision,'CANCELLATION_PENDING');
    assert.equal(e.calls.some(c=>c.method==='sendTransaction'),false);
  }finally{await e.cleanup();}
});

test('matching original finalized result wins, cancellation conflicts and a later cache overwrite does not erase the known original result',async()=>{
  const e=await environment();try{
    await prepareNativeCancellation(e.args());e.confirm(e.original);await e.reopen();
    let result=await reconcileNativeCancellation(e.args());assert.equal(result.decision,'ORIGINAL_CONFIRMED');
    assert.equal(result.originalExecutionVerified,true);assert.equal(result.cancellationExecutionVerified,false);
    assert.equal(result.primary.decision,'CONFIRMED');assert.equal(result.cancellation.decision,'NONCE_CONFLICT');
    e.state.nextNonce=2n;e.state.digest=hash('next unrelated request');e.state.result=Buffer.alloc(8);e.state.slot++;
    await e.reopen();result=await reconcileNativeCancellation(e.args());assert.equal(result.decision,'ORIGINAL_CONFIRMED');
    assert.equal(result.primary.resultBytes.readBigUInt64LE(),42n);assert.equal(result.cancellation.decision,'NONCE_CONFLICT');
  }finally{await e.cleanup();}
});

test('matching cancellation finalized result wins without rewriting primary and permits a new primary request at the actual next nonce',async()=>{
  const e=await environment();try{
    const prepared=await prepareNativeCancellation(e.args());e.confirm(prepared.envelope);await e.reopen();
    const result=await reconcileNativeCancellation(e.args());assert.equal(result.decision,'CANCEL_CONFIRMED');
    assert.equal(result.originalExecutionVerified,false);assert.equal(result.cancellationExecutionVerified,true);
    assert.equal(result.primary.decision,'NONCE_CONFLICT');assert.equal(result.cancellation.decision,'CONFIRMED');
    assert.equal((await e.args().primarySession.getRequest(0n)).frameBytes.toString('hex'),e.original.frameHex);
    const next=await e.args().primarySession.prepare({operation:'SYNC_EMISSION',nonce:1n,payload:encodeSyncEmissionPayload({maxRent:99999999n}),suffix:e.original.suffix,resources});
    assert.equal(next.nonce,'1');assert.equal(JSON.parse((await e.primaryStore.load()).payload).entries.length,2);
  }finally{await e.cleanup();}
});

test('overwritten latest cache establishes neither original nor cancellation execution and cannot manufacture old results',async()=>{
  const e=await environment();try{
    await prepareNativeCancellation(e.args());e.state.nextNonce=2n;e.state.digest=hash('later request before reconciliation');e.state.result=Buffer.alloc(8);e.state.slot++;
    await e.reopen();const result=await reconcileNativeCancellation(e.args());assert.equal(result.decision,'UNKNOWN');
    assert.equal(result.originalExecutionVerified,false);assert.equal(result.cancellationExecutionVerified,false);
    assert.equal(result.primary.decision,'ALREADY_PROCESSED');assert.equal(result.cancellation.decision,'ALREADY_PROCESSED');
    assert.equal(result.primary.resultBytes,null);assert.equal(result.cancellation.resultBytes,null);
  }finally{await e.cleanup();}
});

test('original execution between the two finalized reads cannot leave recovery falsely reporting an open pending nonce',async()=>{
  const e=await environment();try{
    await prepareNativeCancellation(e.args());
    e.state.afterNonceRead=()=>{e.state.afterNonceRead=null;e.confirm(e.original);};
    const result=await reconcileNativeCancellation(e.args());
    assert.equal(result.decision,'ORIGINAL_CONFIRMED');assert.equal(result.originalExecutionVerified,true);
    assert.equal(result.primary.decision,'CONFIRMED');assert.equal(result.cancellation.decision,'NONCE_CONFLICT');
  }finally{await e.cleanup();}
});

test('a lagging original RPC cannot turn a cancellation already known to conflict into a supposedly open nonce',async()=>{
  const e=await environment();try{
    await prepareNativeCancellation(e.args());const lagSlot=e.state.slot;e.confirm(e.original);
    const laggingFetch=async(url,o)=>{const req=parseJsonWithBigInts(o.body),actual=await e.fetchImpl(url,o);
      if(req.method!=='getMultipleAccounts')return actual;
      const body=parseJsonWithBigInts(await actual.text());body.result.context.slot=lagSlot;
      body.result.value=req.params[0].map((address,i)=>address===e.base.address?body.result.value[i]:null);
      return new Response(stringifyJsonWithBigInts(body));
    };
    const laggingPrimary=new NativePlayerSession({...e,store:await FileJournalStore.open({directory:e.primaryDir}),endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl:laggingFetch});
    const result=await reconcileNativeCancellation({...e.args(),primarySession:laggingPrimary});
    assert.equal(result.decision,'UNKNOWN');assert.equal(result.primary.decision,'RETRY_SAME_FRAME');assert.equal(result.cancellation.decision,'NONCE_CONFLICT');
    assert.equal(result.originalExecutionVerified,false);assert.equal(result.cancellationExecutionVerified,false);
    assert.equal(result.cancellationExecutionState,'NOT_EXECUTED');
  }finally{await e.cleanup();}
});

test('same durable namespace, wrong actor/domain identity and identical Frame are refused before a competing request is admitted',async()=>{
  const e=await environment();try{
    const alias=e.session(await FileJournalStore.open({directory:e.primaryDir}));
    await assert.rejects(prepareNativeCancellation({...e.args(),cancellationSession:alias}));
    await assert.rejects(prepareNativeCancellation({...e.args(),cancellationSession:e.args().primarySession}));
    await assert.rejects(prepareNativeCancellation({...e.args(),actor:key(17)}));
    const wrongRelease={...e.release,domain:hash('different recovery domain')};
    await assert.rejects(prepareNativeCancellation({...e.args(),release:wrongRelease}));
    await assert.rejects(prepareNativeCancellation({...e.args(),maxRent:99999999n}));
    assert.equal((await e.cancellationStore.load()).payload,null);assert.equal((await e.args().primarySession.getRequest(0n)).frameBytes.toString('hex'),e.original.frameHex);
  }finally{await e.cleanup();}
});

test('transport timeout and refreshed signature preserve the exact cancellation Frame and nonce across actual journal reopening',async()=>{
  const e=await environment();try{
    const prepared=await prepareNativeCancellation(e.args()),oldSigned=await e.sign(prepared.envelope);e.state.sendTimeout=true;
    const timeout=await e.args().cancellationSession.broadcastSigned(prepared.envelope,oldSigned);assert.equal(timeout.decision,'UNKNOWN');
    await e.reopen();e.state.slot++;e.state.blockhash=key(21);e.state.lastValid=2000n;
    const refreshed=await e.args().cancellationSession.refresh(prepared.envelope);
    assert.equal(refreshed.frameHex,prepared.envelope.frameHex);assert.equal(refreshed.nonce,'0');assert.notEqual(refreshed.unsignedHex,prepared.envelope.unsignedHex);
    await assert.rejects(e.args().cancellationSession.broadcastSigned(refreshed,oldSigned),/CHANGED_TRANSACTION_MESSAGE/);
    e.state.sendTimeout=false;assert.equal((await e.args().cancellationSession.broadcastSigned(refreshed,await e.sign(refreshed))).decision,'PENDING');
    assert.equal((await e.args().primarySession.getRequest(0n)).frameBytes.toString('hex'),e.original.frameHex);
    e.confirm(refreshed);assert.equal((await reconcileNativeCancellation(e.args())).decision,'CANCEL_CONFIRMED');
    assert.equal(e.calls.filter(c=>c.method==='sendTransaction').length,2);
  }finally{await e.cleanup();}
});
