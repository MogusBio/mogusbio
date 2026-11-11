import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKeyPairFromPrivateKeyBytes,signTransaction,getBase58Decoder } from '@solana/kit';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { encodeRecord,encodeActorNonceBody } from '../../protocol-core/src/index.mjs';
import { createOperatorBridge } from '../src/operator-bridge.mjs';
import { nativePda,nativeKeyAddress,nativeKeyBytes,nativeRequestHash,encodeSyncEmissionPayload } from '../../client/src/native.mjs';
import { baseConfigR2Id,validateProductionRelease } from '../../client/src/release.mjs';
import { decodeV1Transaction,transactionBytes } from '../../client/src/transaction.mjs';
import { FileJournalStore } from '../../client/src/file-journal.mjs';
import { clientFixture,key,hash } from '../../client/test/native-fixture.mjs';
import { baseAccount } from '../../client/test/account-fixture.mjs';

const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
const pair=await createKeyPairFromPrivateKeyBytes(hash('BIOP0R2 native SIGNING FIXTURE ONLY 1'));
const sign=async envelope=>transactionBytes(await signTransaction([pair],decodeV1Transaction(Buffer.from(envelope.unsignedHex,'hex')).transaction)).toString('base64');
const rpcAccount=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:10000000n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']};
async function fixture(t,endpoint='http://127.0.0.1:8899'){
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-http-bridge-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const c=await clientFixture(),base=await baseAccount(c.release),noncePda=await nativePda(c.release.input.programId,'bio','actor-nonce',nativeKeyBytes(c.actor));
  const state={slot:10n,nextNonce:0n,digest:null,result:null,blockhash:key(20),height:5n,lastValid:100n,wrongGenesis:false,sendError:false},calls=[];
  const nonceAccount=()=>state.nextNonce===0n?null:{owner:c.release.input.programId,executable:false,data:encodeRecord({kind:35,schema:1,domain:c.release.domain,
    configId:baseConfigR2Id(c.release),bump:noncePda.bump,recordKey:nativeKeyBytes(c.actor),body:encodeActorNonceBody({nextNonce:state.nextNonce,lastDigest:state.digest,lastResult:state.result})})};
  async function journalFiles(){
    const walk=async dir=>(await Promise.all((await fs.readdir(dir,{withFileTypes:true})).map(async d=>d.isDirectory()?walk(path.join(dir,d.name)):path.join(dir,d.name)))).flat();
    return(await walk(directory)).filter(f=>path.basename(f)==='pending-journal.json');
  }
  const fetchImpl=async(url,opts)=>{
    assert.equal(url,new URL(endpoint).href);assert.equal(opts.redirect,'error');assert.equal(opts.method,'POST');assert.ok(opts.signal instanceof AbortSignal);
    const req=parseJsonWithBigInts(opts.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=state.wrongGenesis?key(22):nativeKeyAddress(c.release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts'){
      assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[1].minContextSlot<=state.slot);
      result={context:{slot:state.slot},value:req.params[0].map(k=>rpcAccount(k===base.address?base:k===noncePda.address?nonceAccount():null))};
    }else if(req.method==='getLatestBlockhash')result={context:{slot:state.slot},value:{blockhash:state.blockhash,lastValidBlockHeight:state.lastValid}};
    else if(req.method==='getBlockHeight')result=state.height;
    else if(req.method==='isBlockhashValid')result={context:{slot:state.slot},value:true};
    else if(req.method==='simulateTransaction'){
      assert.equal(req.params[1].commitment,'finalized');assert.equal(req.params[1].sigVerify,false);
      result={context:{slot:state.slot},value:{err:null,unitsConsumed:300n,logs:['mock finalized simulation'],replacementBlockhash:null}};
    }else if(req.method==='sendTransaction'){
      assert.equal(req.params[1].skipPreflight,false);assert.equal(req.params[1].maxRetries,0n);
      const tx=decodeV1Transaction(Buffer.from(req.params[0],'base64')).transaction;
      result=getBase58Decoder().decode(Object.values(tx.signatures)[0]);
      const all=await Promise.all((await journalFiles()).map(async file=>JSON.parse((await(await FileJournalStore.open({directory:path.dirname(file)})).load()).payload)));
      assert.ok(all.some(j=>j.entries.some(e=>e.state==='PENDING'&&e.attempts.at(-1).signature===result)),'attempt must be durable before send');
      if(state.sendError)throw new Error(state.sendError===true?'mock response lost':state.sendError);
    }else throw new Error(`Unexpected RPC ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}),{status:200});
  };
  const options={...c,endpoint,stateDirectory:directory,fetchImpl,allowLocalhost:true};
  const seeds={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'};
  const suffix=await Promise.all(Object.entries(seeds).map(async([name,seed])=>({name,address:(await nativePda(c.release.input.programId,'bio',seed)).address})));
  const intent={operation:'SYNC_EMISSION',nonce:'0',payloadHex:encodeSyncEmissionPayload({maxRent:5000000n}).toString('hex'),suffix,resources};
  const confirm=envelope=>{state.nextNonce=1n;state.digest=nativeRequestHash(c.abi,Buffer.from(envelope.frameHex,'hex'));state.result=Buffer.alloc(8);state.result.writeBigUInt64LE(42n);state.slot++;};
  return {...c,directory,options,bridge:await createOperatorBridge(options),state,calls,intent,confirm,journalFiles};
}

test('HTTP bridge uses persistent SDK preparation, inspection, simulation, exact signed PENDING send and finalized status',async t=>{
  const f=await fixture(t);assert.deepEqual(f.calls,[]);assert.deepEqual(await fs.readdir(f.directory),[]);
  const envelope=await f.bridge.dispatch('prepare',{actor:f.actor,intent:f.intent});
  assert.equal(envelope.nonce,'0');assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
  const files=await f.journalFiles();assert.equal(files.length,1);assert.equal((await fs.stat(files[0])).mode&0o777,0o600);
  const inspected=await f.bridge.dispatch('inspect',{envelope});assert.equal(inspected.actor,f.actor);assert.equal(inspected.nonce,'0');
  assert.match(inspected.requestHash,/^[0-9a-f]{64}$/);assert.equal(inspected.businessExecutionVerified,false);
  const sim=await f.bridge.dispatch('simulate',{envelope});assert.equal(sim.simulationOnly,true);assert.equal(sim.transactionExecuted,false);assert.equal(sim.unitsConsumed,'300');
  const signedTransactionBase64=await sign(envelope);
  const sent=await f.bridge.dispatch('broadcast',{actor:f.actor,envelope,signedTransactionBase64,log:'primary'});
  assert.equal(sent.decision,'PENDING');assert.equal(sent.nonce,'0');assert.equal(sent.networkSubmitted,true);assert.equal(sent.businessExecutionVerified,false);
  const restarted=await createOperatorBridge(f.options);
  assert.equal((await restarted.dispatch('status',{actor:f.actor,nonce:'0',log:'primary'})).decision,'RETRY_SAME_FRAME');
  f.confirm(envelope);const status=await restarted.dispatch('status',{actor:f.actor,nonce:'0',log:'primary'});
  assert.equal(status.decision,'CONFIRMED');assert.equal(status.resultBytes,'2a00000000000000');assert.equal(status.businessExecutionVerified,true);
  const duplicate=await restarted.dispatch('broadcast',{actor:f.actor,envelope,signedTransactionBase64,log:'primary'});
  assert.equal(duplicate.decision,'CONFIRMED');assert.equal(duplicate.networkSubmitted,false);assert.equal(f.calls.filter(c=>c.method==='sendTransaction').length,1);
  assert.doesNotThrow(()=>JSON.stringify({inspected,sim,sent,status}));
});

test('uncertain broadcast redacts provider diagnostics while preserving the durable unknown result',async t=>{
  const f=await fixture(t),envelope=await f.bridge.dispatch('prepare',{actor:f.actor,intent:f.intent});
  f.state.sendError='mock provider https://rpc.example.invalid/?api-key=fixture-private-value';
  const result=await f.bridge.dispatch('broadcast',{actor:f.actor,envelope,signedTransactionBase64:await sign(envelope),log:'primary'});
  assert.equal(result.decision,'UNKNOWN');assert.equal(result.error,'TRANSPORT_ERROR');assert.doesNotMatch(JSON.stringify(result),/fixture-private-value/);
  assert.equal((await f.bridge.dispatch('status',{actor:f.actor,nonce:'0',log:'primary'})).decision,'RETRY_SAME_FRAME');
});

test('refresh and cancellation preserve original bytes in separate fixed FileStore namespaces and never send',async t=>{
  const f=await fixture(t),envelope=await f.bridge.dispatch('prepare',{actor:f.actor,intent:f.intent});
  const before=JSON.parse((await(await FileJournalStore.open({directory:path.dirname((await f.journalFiles())[0])})).load()).payload).entries[0];
  f.state.blockhash=key(21);f.state.lastValid=200n;f.state.slot++;
  const refreshed=await f.bridge.dispatch('refresh',{actor:f.actor,envelope,log:'primary'});
  assert.equal(refreshed.frameHex,envelope.frameHex);assert.notEqual(refreshed.unsignedHex,envelope.unsignedHex);
  await assert.rejects(f.bridge.dispatch('broadcast',{actor:f.actor,envelope:refreshed,signedTransactionBase64:await sign(envelope),log:'primary'}),/CHANGED_TRANSACTION_MESSAGE/);
  const cancelled=await f.bridge.dispatch('cancel-prepare',{actor:f.actor,nonce:'0',maxRent:'10000000',resources});
  assert.equal(cancelled.decision,'CANCELLATION_PREPARED');assert.equal(cancelled.requiresSeparateSignature,true);
  assert.equal(cancelled.envelope.nonce,'0');assert.notEqual(cancelled.envelope.frameHex,envelope.frameHex);
  const files=await f.journalFiles();assert.equal(files.length,2);assert.deepEqual(files.map(f=>path.basename(path.dirname(f))).sort(),['cancellation','primary']);
  assert.equal(new Set(files.map(f=>path.dirname(path.dirname(f)))).size,1);
  for(const file of files){assert.ok(file.startsWith(f.directory+path.sep));assert.equal((await fs.stat(path.dirname(file))).mode&0o777,0o700);}
  const original=files.find(f=>path.basename(path.dirname(f))==='primary');
  assert.equal(JSON.parse((await(await FileJournalStore.open({directory:path.dirname(original)})).load()).payload).entries[0].frameHex,before.frameHex);
  assert.equal((await f.bridge.dispatch('status',{actor:f.actor,nonce:'0',log:'cancellation'})).decision,'RETRY_SAME_FRAME');
  const status=await f.bridge.dispatch('cancel-status',{actor:f.actor,nonce:'0'});assert.equal(status.decision,'CANCELLATION_PENDING');
  assert.equal(status.networkSubmitted,false);assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
});

test('browser replacement runtime, unknown fields, invalid decimals/hex/addresses/logs, changed envelopes and signed packets fail closed',async t=>{
  const f=await fixture(t),envelope=await f.bridge.dispatch('prepare',{actor:f.actor,intent:f.intent}),signedTransactionBase64=await sign(envelope),before=f.calls.length;
  for(const extra of ['endpoint','release','abi','stateDirectory','privateKey','state','path'])await assert.rejects(f.bridge.dispatch('prepare',{actor:f.actor,intent:f.intent,[extra]:'../outside'}),/BRIDGE_FIELDS/);
  for(const bad of [null,[],{actor:f.actor},{actor:f.actor,intent:{...f.intent,nonce:'00'}},{actor:f.actor,intent:{...f.intent,payloadHex:'AB'}},
    {actor:'../../outside',intent:f.intent},{actor:f.actor,intent:{...f.intent,nonce:0}},
    {actor:f.actor,intent:{...f.intent,resources:{...resources,extra:1}}},{actor:f.actor,intent:{...f.intent,instructions:[]}},
    {actor:f.actor,intent:{...f.intent,labDestinationSetup:{beneficiary:f.actor,programId:key(20)}}}])await assert.rejects(f.bridge.dispatch('prepare',bad));
  for(const log of ['../primary','PRIMARY','',null,{},'primary/../../outside'])await assert.rejects(f.bridge.dispatch('status',{actor:f.actor,nonce:'0',log}),/BRIDGE_LOG/);
  await assert.rejects(f.bridge.dispatch('status',{actor:f.actor,nonce:'18446744073709551616',log:'primary'}),/BRIDGE_U64/);
  await assert.rejects(f.bridge.dispatch('refresh',{actor:key(2),envelope,log:'primary'}),/ACTOR_MISMATCH/);
  for(const change of [e=>e.releaseHash='00'.repeat(32),e=>e.abiHash='00'.repeat(32),e=>e.actor=key(2),e=>e.resources.priorityFeeLamports='1',e=>e.unsignedHex=e.unsignedHex.slice(0,-2)+'ff',e=>e.extra=true]){
    const bad=structuredClone(envelope);change(bad);await assert.rejects(f.bridge.dispatch('broadcast',{actor:f.actor,envelope:bad,signedTransactionBase64,log:'primary'}));
  }
  for(const signed of ['',signedTransactionBase64+'\n',Buffer.from(envelope.unsignedHex,'hex').toString('base64')])await assert.rejects(f.bridge.dispatch('broadcast',{actor:f.actor,envelope,signedTransactionBase64:signed,log:'primary'}));
  await assert.rejects(f.bridge.dispatch('broadcast',{actor:key(2),envelope,signedTransactionBase64,log:'primary'}),/ACTOR_MISMATCH/);
  await assert.rejects(f.bridge.dispatch('broadcast',{actor:f.actor,envelope,signedTransactionBase64,log:'cancellation'}),/JOURNAL/);
  await assert.rejects(f.bridge.dispatch('sendTransaction',{}),/BRIDGE_ACTION/);
  assert.equal(f.calls.length,before);assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
});

test('private canonical configured root and injected endpoint are admitted locally; config never discloses paths or endpoint credentials',async t=>{
  const f=await fixture(t,'https://rpc.example.invalid/provider-secret?api-key=hidden');
  const config=f.bridge.publicConfig(),text=JSON.stringify(config);assert.equal(config.enabled,true);assert.equal(config.programId,f.release.input.programId);
  assert.equal(config.endpoint.origin,'https://rpc.example.invalid');assert.equal(config.network.genesisHash,f.release.input.genesisHash);
  assert.equal(text.includes(f.directory),false);assert.equal(text.includes('provider-secret'),false);assert.equal(text.includes('api-key'),false);
  config.network.genesisHash='changed';assert.equal(f.bridge.publicConfig().network.genesisHash,f.release.input.genesisHash);
  await assert.rejects(createOperatorBridge({...f.options,fetchImpl:undefined}),/BRIDGE_RUNTIME/);
  await assert.rejects(createOperatorBridge({...f.options,endpoint:'http://rpc.example.invalid'}),/RPC_ENDPOINT_POLICY/);
  await assert.rejects(createOperatorBridge({...f.options,endpoint:'https://user:secret@rpc.example.invalid'}),/RPC_ENDPOINT_POLICY/);
  await assert.rejects(createOperatorBridge({...f.options,stateDirectory:path.join(f.directory,'..','not-canonical')}));
  const publicDir=path.join(f.directory,'public');await fs.mkdir(publicDir,{mode:0o755});await assert.rejects(createOperatorBridge({...f.options,stateDirectory:publicDir}),/BRIDGE_STATE_ROOT/);
  const alias=path.join(f.directory,'alias');await fs.symlink(f.directory,alias);await assert.rejects(createOperatorBridge({...f.options,stateDirectory:alias}),/BRIDGE_STATE_ROOT/);
  assert.deepEqual(f.calls,[]);
});

test('RPC genesis mismatch and oversized bounded response fail without preparing or sending',async t=>{
  const f=await fixture(t);f.state.wrongGenesis=true;
  await assert.rejects(f.bridge.dispatch('prepare',{actor:f.actor,intent:f.intent}),/GENESIS_MISMATCH/);
  assert.equal((await f.journalFiles()).length,0);assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
  const bridge=await createOperatorBridge({...f.options,fetchImpl:async()=>new Response('x'.repeat(8*1024*1024+1))});
  await assert.rejects(bridge.dispatch('prepare',{actor:f.actor,intent:f.intent}),/RESPONSE_SIZE/);
});

test('journal paths are derived independently for each admitted actor and release',async t=>{
  const f=await fixture(t);
  await f.bridge.dispatch('prepare',{actor:f.actor,intent:f.intent});
  await f.bridge.dispatch('prepare',{actor:key(2),intent:f.intent});
  const files=await f.journalFiles();assert.equal(files.length,2);
  assert.equal(new Set(files.map(file=>path.basename(path.dirname(path.dirname(file))))).size,2);
  assert.equal(new Set(files.map(file=>path.dirname(path.dirname(path.dirname(file))))).size,1);
  const input=structuredClone(f.release.input);input.releaseHash=hash('another explicitly local bridge release').toString('hex');
  const release=await validateProductionRelease(input,{localPublicFixture:true}),base=await baseAccount(release);
  const bridge=await createOperatorBridge({...f.options,release,fetchImpl:async(url,opts)=>{
    const req=parseJsonWithBigInts(opts.body);
    if(req.method!=='getMultipleAccounts')return f.options.fetchImpl(url,opts);
    const result={context:{slot:10n},value:req.params[0].map(k=>rpcAccount(k===base.address?base:null))};
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  }});
  await bridge.dispatch('prepare',{actor:f.actor,intent:f.intent});
  const all=await f.journalFiles();assert.equal(all.length,3);
  assert.equal(new Set(all.map(file=>path.dirname(path.dirname(path.dirname(file))))).size,2);
  assert.equal(f.calls.some(c=>c.method==='sendTransaction'),false);
});
