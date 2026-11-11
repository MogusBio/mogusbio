import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import path from 'node:path';
import {createKeyPairFromPrivateKeyBytes,signTransaction,getBase58Decoder} from '@solana/kit';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {checkpoint,cloneAccounts,release,abi,actor,pda} from '../packages/client/test/synthesis-fixture.mjs';
import {hash,key} from '../packages/client/test/native-fixture.mjs';
import {encodeActorNonceBody} from '../packages/protocol-core/src/index.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativeRequestHash} from '../packages/client/src/native.mjs';
import {transactionBytes,decodeV1Transaction} from '../packages/client/src/transaction.mjs';
import {FileJournalStore} from '../packages/client/src/file-journal.mjs';
import {baseConfigR2Id} from '../packages/client/src/release.mjs';
import {openServiceSupervisor,readServiceHealth,readOnlyServiceAuthorStore} from '../apps/service/supervisor.mjs';
import {acquireServiceLease,recoverServiceLease} from '../apps/service/lease.mjs';
import {runServiceCLI} from '../apps/service/main.mjs';
import {NativePlayerSession} from '../packages/client/src/session.mjs';
import {prepareNativeCancellation} from '../packages/client/src/recovery.mjs';
import {ResearchWorkflowStore} from '../packages/client/src/research-manifest.mjs';
import {saveGuidedResearchWorkflow} from '../packages/client/src/research-progress.mjs';
import {recordAccount} from '../packages/client/test/account-fixture.mjs';
import {hostArtifact,hostVerification} from '../packages/client/test/synthesis-fixture.mjs';
import {hostResearchFixture,researchCranker,enterHostResearchManufacture,setHostResearchAuthorNonce} from '../packages/client/test/research-fixture.mjs';

// All sending/signature/fee/confirmation behavior in this file is HOST-only.
// Account contents default to the genuine current76b checkpoint. The signer
// uses only its documented public local-fixture seed, never a funded secret.
import {serviceFixture as fixture,resources} from './service-fixture.mjs';

test('plan-only/missing signer/network remain WAIT with genuine records and no signing/preparing/sending',async()=>{
  for(const changes of [{sendEnabled:false},{}]){const f=await fixture(changes);let s;try{s=await f.open(changes.sendEnabled===false?{}:{signer:null});const r=await s.tick();assert.equal(r.decision,changes.sendEnabled===false?'WAIT_SEND_DISABLED':'WAIT_SIGNER');assert.equal(f.signed.length,0);assert.ok(!f.calls.some(c=>c.method==='sendTransaction'||c.method==='getLatestBlockhash'));assert.equal(s.health().lanes[0].lastOperation,'APPLY_EVENT');}finally{await s?.close();await f.cleanup();}}
  const f=await fixture({endpoint:null});let s;try{s=await f.open();assert.equal((await s.tick()).decision,'WAIT_NETWORK_CONFIG');assert.equal(f.calls.length,0);}finally{await s?.close();await f.cleanup();}
});

test('HOST-only exact signing/send persists conservative charge and genuine-record planning, then confirms only matching nonce result',async()=>{
  const f=await fixture();let s;try{s=await f.open();const r=await s.tick();assert.equal(r.decision,'WAIT_PENDING_FINALITY');assert.equal(f.signed.length,1);assert.equal(f.signed[0].operation,'APPLY_EVENT');assert.equal(f.calls.filter(c=>c.method==='sendTransaction').length,1);assert.equal(s.health().conservativeCharged.fee,'5000');assert.equal(s.health().conservativeCharged.rent,'0');assert.equal(s.health().actualExpenditureVerified,false);
    const store=await FileJournalStore.open({directory:path.join(f.config.stateDirectory,'reservations'),name:'charge-1.json'});assert.equal(JSON.parse((await store.load()).payload).conservativeUpperCharge,true);await f.confirm();assert.equal((await s.tick()).decision,'CONFIRMED');assert.equal(s.health().confirmed,1);assert.equal(s.health().lanes[0].pendingNonce,null);
  }finally{await s?.close();await f.cleanup();}
});

test('pending/unknown survives restart and a live blockhash never triggers another signature or send',async()=>{
  const f=await fixture();let s;try{f.state.failSend=true;s=await f.open();assert.equal((await s.tick()).decision,'WAIT_RPC_UNKNOWN');await s.close();s=await f.open();for(let i=0;i<3;i++)assert.equal((await s.tick()).decision,'WAIT_PENDING_FINALITY');assert.equal(f.signed.length,1);assert.equal(f.calls.filter(c=>c.method==='sendTransaction').length,1);assert.ok(!JSON.stringify(s.health()).includes('secret'));await f.confirm();assert.equal((await s.tick()).decision,'CONFIRMED');}finally{await s?.close();await f.cleanup();}
});

test('finalized expiry permits bounded same-Frame refresh with a new signature; refresh limit stops retries',async()=>{
  const f=await fixture();let s;try{s=await f.open();await s.tick();const first=f.signed[0];f.state.height=201n;f.state.blockhash=key(21);f.state.lastValid=300n;assert.equal((await s.tick()).decision,'WAIT_PENDING_FINALITY');assert.equal(f.signed.length,2);assert.equal(f.signed[1].frameHex,first.frameHex);assert.notEqual(f.signed[1].unsignedHex,first.unsignedHex);assert.equal(s.health().conservativeCharged.fee,'10000');assert.equal((await s.tick()).decision,'WAIT_PENDING_FINALITY');assert.equal(f.signed.length,2);
    f.state.height=301n;f.state.blockhash=key(22);f.state.lastValid=400n;await s.tick();assert.equal(f.signed.length,3);f.state.height=401n;f.state.blockhash=key(23);f.state.lastValid=500n;assert.equal((await s.tick()).decision,'WAIT_REFRESH_LIMIT');assert.equal(f.signed.length,3);
  }finally{await s?.close();await f.cleanup();}
});

test('unavailable fees, low balance, step caps and persistent lifetime caps stop before signer and submission',async()=>{
  for(const change of ['feeNull','balance','step','lifetime']){const f=await fixture();let s;try{if(change==='feeNull')f.state.fee=null;if(change==='balance')f.state.balanceLow=true;if(change==='step')f.config.limits.stepFee='4999';if(change==='lifetime')f.config.limits.lifetimeFee='4999';s=await f.open();assert.equal((await s.tick()).decision,'WAIT_DEPENDENCY');assert.equal(f.signed.length,0);assert.ok(!f.calls.some(c=>c.method==='sendTransaction'));assert.equal(s.health().conservativeCharged.total,'0');}finally{await s?.close();await f.cleanup();}}
});

test('signing interruption is durable, sanitizes adapter errors and requires explicit unsubmitted signing recovery',async()=>{
  const f=await fixture();let s;try{s=await f.open({signer:{...f.signer,signEnvelope(){throw Object.assign(Error('private secret token'),{code:'SERVICE_SECRET_TOKEN'});}}});await s.tick();assert.ok(!JSON.stringify(s.health()).includes('SECRET_TOKEN'));assert.ok(!JSON.stringify(s.health()).includes('private secret'));await s.close();s=await f.open();assert.equal((await s.tick()).decision,'WAIT_SIGNING_RECOVERY');assert.equal(f.signed.length,0);assert.equal((await s.resumeSigning('global')).decision,'SIGNING_RECOVERY_AUTHORIZED');assert.equal((await s.tick()).decision,'WAIT_PENDING_FINALITY');assert.equal(f.signed.length,1);assert.equal(s.health().conservativeCharged.fee,'5000');await assert.rejects(s.resumeSigning('global'),/NOT_SIGNING/);}finally{await s?.close();await f.cleanup();}
});

test('single-instance lease fences concurrent opens and live-PID recovery; released process can restart',async()=>{
  const f=await fixture();let s;try{s=await f.open();await assert.rejects(f.open(),/LEASE_BUSY/);const health=await readServiceHealth(f.args);assert.equal(health.ticks,0);const lease=await FileJournalStore.open({directory:f.config.stateDirectory,name:'service-lease.json'}),owner=JSON.parse((await lease.load()).payload);await assert.rejects(recoverServiceLease({directory:f.config.stateDirectory,expectedToken:owner.token}),/OWNER_ALIVE/);await s.close();s=await f.open();assert.equal((await s.tick()).decision,'WAIT_PENDING_FINALITY');}finally{await s?.close();await f.cleanup();}
});

test('STOP, bounded loops and invalid policy prevent unbounded service work',async()=>{
  const f=await fixture({sendEnabled:false});let s;try{s=await f.open();const run=await s.run({maxTicks:2,maxDurationMs:1000});assert.ok(['RUN_BOUND_REACHED','STOPPED'].includes(run.decision));assert.ok(s.health().ticks>=1&&s.health().ticks<=2);await fs.writeFile(path.join(f.config.stateDirectory,'STOP'),'stop',{mode:0o600});assert.equal((await s.tick()).decision,'STOPPED');assert.equal(s.health().stopped,true);await assert.rejects(s.run({maxTicks:10001}),/RUN_BOUND/);}finally{await s?.close();await f.cleanup();}
  const bad=await fixture();try{bad.config.researchJobs=[{name:'bad',author:actor,cranker:actor,workflowId:'11'.repeat(32),manifestDirectory:bad.directory,authorJournalDirectory:bad.directory,delegated:true}];await assert.rejects(bad.open(),/AUTHOR_CRANKER/);assert.equal(bad.calls.length,0);}finally{await bad.cleanup();}
});

test('health/CLI status are public allowlists without endpoint/config paths/packets and CLI runs bounded read-only',async()=>{
  const f=await fixture({sendEnabled:false});try{const releaseFile=path.join(f.directory,'release.json'),configFile=path.join(f.directory,'service.json');await fs.writeFile(releaseFile,JSON.stringify(release.input),{mode:0o600});await fs.writeFile(configFile,JSON.stringify({releaseFile,localPublicFixture:true,service:f.config}),{mode:0o600});const printed=[];const r=await runServiceCLI(['run','--config',configFile,'--ticks','1','--duration-ms','100'],{fetchImpl:f.args.fetchImpl,print:v=>printed.push(v)});assert.equal(r.health.ticks,1);assert.equal(r.health.processState,'STOPPED');const status=await runServiceCLI(['status','--config',configFile],{fetchImpl:()=>{throw Error('status must not use RPC');},print:v=>printed.push(v)});assert.equal(status.ticks,1);assert.equal(status.processState,'STOPPED');const text=printed.join('');for(const forbidden of [f.directory,'http://','signedHex','unsignedHex','salt','endpoint'])assert.ok(!text.includes(forbidden));assert.equal(f.signed.length,0);}finally{await f.cleanup();}
});

test('HOST-only cancellation winner is distinguished from original work and pauses the lane until explicit resume',async()=>{
  const f=await fixture();let s;try{s=await f.open();await s.tick();const directory=path.join(f.config.stateDirectory,'actors',nativeKeyBytes(actor).toString('hex')),runtime={release,abi,actor,endpoint:f.config.endpoint,fetchImpl:f.args.fetchImpl,allowLocalhost:true},primarySession=new NativePlayerSession({...runtime,store:await FileJournalStore.open({directory,name:'primary.json'})}),cancellationSession=new NativePlayerSession({...runtime,store:await FileJournalStore.open({directory,name:'cancellation.json'})}),nonce=BigInt(f.signed[0].nonce),cancel=await prepareNativeCancellation({release,abi,actor,primarySession,cancellationSession,nonce,maxRent:10000000n,resources:{...resources,priorityFeeLamports:0n}});
    const address=await pda('actor-nonce',nativeKeyBytes(actor)),old=f.map.get(address);f.map.set(address,{...old,data:Buffer.concat([old.data.subarray(0,120),encodeActorNonceBody({nextNonce:nonce+1n,lastDigest:nativeRequestHash(abi,Buffer.from(cancel.envelope.frameHex,'hex')),lastResult:Buffer.alloc(8)})])});assert.equal((await s.tick()).decision,'CANCEL_CONFIRMED');assert.equal(s.health().confirmed,0);assert.equal((await s.tick()).decision,'WAIT_CANCELLED');assert.equal(f.signed.length,1);assert.equal((await s.resumeCancelled('global')).decision,'CANCELLED_LANE_RESUME_AUTHORIZED');
  }finally{await s?.close();await f.cleanup();}
});

test('HOST delegated research signs only VERIFY_STEP, never changes author nonce and waits for author FINAL',async()=>{
  const f=await fixture(),research=await hostResearchFixture(),manifestDirectory=path.join(f.directory,'research'),store=new ResearchWorkflowStore({directory:manifestDirectory});let s;
  try{const saved=await saveGuidedResearchWorkflow({...research.researchArgs,maxRent:10000000n,maxUploadRent:10000000n,store}),workflowId=saved.workflow.workflowId,m=await store.load({release,abi,author:actor,workflowId});await enterHostResearchManufacture(research,m);await hostArtifact(research,{sequence:BigInt(m.workflow.chunkCount),sealed:true});await setHostResearchAuthorNonce(research,m.workflow.futureManufactureNonce);await hostVerification(research,{phase:5,round:72,generation:m.expectedGeneration+1n,seq:17});
    f.map.clear();for(const [k,v]of research.map)f.map.set(k,v);f.config.globalActor=null;f.config.researchJobs=[{name:'delegated',author:actor,cranker:researchCranker,workflowId,manifestDirectory,authorJournalDirectory:path.join(f.directory,'author'),delegated:true}];const pair=await createKeyPairFromPrivateKeyBytes(hash('BIOCLIENT pure unit key 8')),signer={signOnly:true,actors:[researchCranker],async signEnvelope(envelope,context){assert.equal(envelope.operation,'VERIFY_STEP');assert.equal(context.role,'research');f.signed.push(envelope);return transactionBytes(await signTransaction([pair],decodeV1Transaction(Buffer.from(envelope.unsignedHex,'hex')).transaction));}};
    s=await f.open({signer});assert.equal((await s.tick()).decision,'WAIT_PENDING_FINALITY');assert.equal(f.signed.length,1);assert.equal(f.signed[0].actor,researchCranker);assert.equal(f.map.get(await pda('actor-nonce',nativeKeyBytes(actor))).data.readBigUInt64LE(120),m.workflow.futureManufactureNonce);assert.equal(s.health().conservativeCharged.rent,'4180');
    const address=await pda('actor-nonce',nativeKeyBytes(researchCranker)),nonceRecord=await recordAccount(release,{kind:35,seeds:['bio','actor-nonce',nativeKeyBytes(researchCranker)],id:nativeKeyBytes(researchCranker),body:encodeActorNonceBody({nextNonce:1n,lastDigest:nativeRequestHash(abi,Buffer.from(f.signed[0].frameHex,'hex')),lastResult:Buffer.alloc(80)})});f.map.set(address,nonceRecord);assert.equal((await s.tick()).decision,'CONFIRMED');await hostVerification(research,{phase:6,round:73,generation:m.expectedGeneration+1n,quality:2000000,task:true,cost:320n});f.map.set(await pda('verify',nativeKeyBytes(actor)),research.map.get(await pda('verify',nativeKeyBytes(actor))));assert.equal((await s.tick()).decision,'AUTHOR_REQUIRED');assert.equal(f.signed.length,1);assert.ok(!JSON.stringify(s.health()).includes(m.salt.toString('hex')));
  }finally{await s?.close();await f.cleanup();}
});

test('explicit dead local lease recovery is token bound and never resets durable spending or native journals',async()=>{
  const f=await fixture();try{const store=await FileJournalStore.open({directory:f.config.stateDirectory,name:'service-lease.json'}),old=await store.load(),owner={version:'BIO-SERVICE-LEASE1',state:'HELD',host:hostname(),pid:2147483647,token:'dead-local-fixture'};await store.compareAndSwap(old.revision,JSON.stringify(owner));await assert.rejects(recoverServiceLease({directory:f.config.stateDirectory,expectedToken:'wrong'}),/RECOVERY_OWNER/);assert.equal((await recoverServiceLease({directory:f.config.stateDirectory,expectedToken:owner.token})).recovered,true);const lease=await acquireServiceLease(f.config.stateDirectory);await lease.close();}finally{await f.cleanup();}
});

test('author store delegates archive reads but rejects journal/archive writes',async()=>{
  let reads=0;const source={load:async()=>({revision:0n,payload:null}),readTerminal:async(c,n)=>{reads++;return {context:c,nonce:n};},inspectLock:async()=>({state:'UNLOCKED'})},store=readOnlyServiceAuthorStore(source);assert.equal((await store.load()).payload,null);assert.deepEqual(await store.readTerminal({actor},7n),{context:{actor},nonce:7n});assert.equal(reads,1);assert.equal((await store.inspectLock()).state,'UNLOCKED');assert.throws(()=>store.compareAndSwap(0n,'x'),/AUTHOR_WRITE_FORBIDDEN/);assert.throws(()=>store.archiveTerminals([]),/AUTHOR_WRITE_FORBIDDEN/);
});

test('operational plan/send restart preserves immutable budget/journals and status reports actual runtime mode',async()=>{
  const f=await fixture({sendEnabled:false});let s;try{s=await f.open();await s.tick();assert.equal(s.health().automaticSubmissionEnabled,false);assert.equal(s.health().signerSendForbidden,true);await s.close();f.config.sendEnabled=true;f.config.poll.minMs=11;s=await f.open();assert.equal(s.health().automaticSubmissionEnabled,true);await s.tick();assert.equal(s.health().conservativeCharged.fee,'5000');f.config.sendEnabled=false;const observed=await readServiceHealth(f.args);assert.equal(observed.automaticSubmissionEnabled,true);await s.close();s=await f.open();assert.equal(s.health().automaticSubmissionEnabled,false);assert.equal(s.health().conservativeCharged.fee,'5000');await s.close();f.config.limits.lifetimeFee='2000000';await assert.rejects(f.open(),/STATE_BINDING/);}finally{await s?.close();await f.cleanup();}
});

test('HOST OPEN_HOUR quotes exactly482-byte snapshot rent',async()=>{
  const f=await fixture();let s;try{const registry=f.map.get(await pda('mining'));registry.data.writeBigUInt64LE(registry.data.readBigUInt64LE(160),168);const clock=f.map.get('SysvarC1ock11111111111111111111111111111111');clock.data.writeBigInt64LE(clock.data.readBigInt64LE(32)+3600n,32);s=await f.open();assert.equal((await s.tick()).decision,'WAIT_PENDING_FINALITY');assert.equal(f.signed[0].operation,'OPEN_HOUR');assert.equal(s.health().conservativeCharged.rent,'4820');assert.deepEqual(f.calls.filter(c=>c.method==='getMinimumBalanceForRentExemption').map(c=>c.params[0]),[482n,482n]);}finally{await s?.close();await f.cleanup();}
});

test('stop aborts an in-flight signer before broadcast and retains explicit signing recovery', {timeout:15000},async()=>{
  const f=await fixture();let s,entered,signerSignal;const ready=new Promise(r=>entered=r);try{s=await f.open({signer:{actors:[actor],signOnly:true,signEnvelope(_,context){signerSignal=context.signal;entered();return new Promise(()=>{});}}});const pending=s.tick();await ready;s.stop();assert.equal((await pending).decision,'STOPPED');assert.equal(signerSignal.aborted,true);assert.equal(f.calls.filter(c=>c.method==='sendTransaction').length,0);assert.equal(s.health().conservativeCharged.fee,'5000');await s.close();s=await f.open();assert.equal((await s.tick()).decision,'WAIT_SIGNING_RECOVERY');}finally{await s?.close();await f.cleanup();}
});

test('run deadline aborts stalled RPC instead of waiting for its normal timeout', {timeout:10000},async()=>{
  const f=await fixture({sendEnabled:false});let s;try{const fetchImpl=async(url,options)=>{const req=parseJsonWithBigInts(options.body);if(req.method!=='getMultipleAccounts')return f.args.fetchImpl(url,options);return new Promise((_,reject)=>{const end=()=>reject(Error('HOST aborted fetch'));if(options.signal.aborted)end();else options.signal.addEventListener('abort',end,{once:true});});};s=await f.open({fetchImpl});const start=Date.now(),r=await s.run({maxTicks:2,maxDurationMs:50});assert.equal(r.decision,'STOPPED');assert.ok(Date.now()-start<2000);assert.equal(f.signed.length,0);}finally{await s?.close();await f.cleanup();}
});
