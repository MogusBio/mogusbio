import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,realpath,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { sha256 } from '../../protocol-core/src/index.mjs';
import { validateProductionRelease,baseConfigR2Id,PROGRAMS } from '../src/release.mjs';
import { loadNativeAbi,decodeNativeFrame,nativeKeyAddress,nativeKeyBytes,nativePda,nativeOperation,buildNativeInstruction } from '../src/native.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { NativePlayerSession,inspectPreparedNativeEnvelope } from '../src/session.mjs';
import { FileJournalStore } from '../src/file-journal.mjs';
import { PendingJournal } from '../src/journal.mjs';
import { readProjectState,reconcileProjectCreation,projectRecordMatchesCreation } from '../src/project-state.mjs';
import { key } from './native-fixture.mjs';

// Immutable local Bank evidence, never a claimed live RPC response. Host-only
// corruptions below are explicitly negative fixtures, not executed native state.
const saved=async name=>readFile(new URL(`../../../${name}`,import.meta.url));
const release=await validateProductionRelease(JSON.parse(await saved('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
const abi=loadNativeAbi(await saved('programs/biolab-economy/operations.p0r2.json'),{expectedHash:release.input.abiHash});
const bank=parseJsonWithBigInts((await saved('programs/transaction-transport/evidence/create-project-bank-76b35cfb-case-1.json')).toString('utf8'));
assert.equal(bank.schema,'BIO-BANK-CREATE-PROJECT-RESULT-CASE-1');
assert.equal(bank.elfSHA256,'76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e');
assert.equal(bank.abiSHA256,abi.hash);
const frame=Buffer.from(bank.frameHex,'hex'),decoded=decodeNativeFrame(abi,frame),nonce=decoded.nonce;
const projectId=Buffer.from(bank.createResult.projectIdHex,'hex'),projectAddress=bank.createResult.projectAddress;
const mintAddresses=bank.createResult.classes.map(c=>c.mint);
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const mapRows=rows=>new Map(rows.map(row=>[row.address,row.missing===true?null:{...row,data:Buffer.from(row.data[0],'base64')}]));
const cloneMap=map=>new Map([...map].map(([a,v])=>[a,v===null?null:{...v,data:Buffer.from(v.data)}]));
const raw=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};

async function fullCheckpoint(){
  const bytes=await saved('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b1687.bin');
  assert.equal(sha256(bytes).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
  assert.equal(bytes.subarray(0,8).toString(),'BIOFIN01');assert.deepEqual(bytes.subarray(8,40),baseConfigR2Id(release));
  assert.equal(bytes.subarray(40,72).toString('hex'),bank.elfSHA256);
  const count=bytes.readUInt32LE(104),accounts=new Map();let at=108;
  for(let i=0;i<count;i++){
    const address=nativeKeyAddress(bytes.subarray(at,at+32)),lamports=bytes.readBigUInt64LE(at+32),owner=nativeKeyAddress(bytes.subarray(at+40,at+72));
    assert.ok(bytes[at+72]<=1);const executable=bytes[at+72]===1,rentEpoch=bytes.readBigUInt64LE(at+73),length=bytes.readUInt32LE(at+81);at+=85;
    assert.ok(at+length<=bytes.length&&!accounts.has(address));accounts.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(bytes.subarray(at,at+length))});at+=length;
  }
  assert.equal(at,bytes.length);assert.ok(accounts.get(bank.actorNonceAddress).data.readBigUInt64LE(120)>nonce+1n);
  return accounts;
}
const checkpoint=await fullCheckpoint();

function provider(phase='afterAccounts'){
  const maps={beforeAccounts:mapRows(bank.beforeAccounts),afterAccounts:mapRows(bank.afterAccounts),afterRetryAccounts:mapRows(bank.afterRetryAccounts),checkpoint:cloneMap(checkpoint)};
  let current=phase,slot=100n;const calls=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:1/');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(req.method==='getLatestBlockhash'){
      assert.equal(req.params[0].commitment,'finalized');assert.ok(req.params[0].minContextSlot<=slot);
      // Unsigned preparation uses an explicit synthetic local lifetime only.
      result={context:{slot:++slot},value:{blockhash:nativeKeyAddress(sha256(Buffer.from('CREATE recorded-read unsigned local lifetime only'))),lastValidBlockHeight:1000n}};
    }else if(req.method==='getMultipleAccounts'){
      assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[1].minContextSlot<=slot);
      result={context:{slot:++slot},value:req.params[0].map(address=>{assert.ok(maps[current].has(address),`unrecorded account ${address}`);return raw(maps[current].get(address));})};
    }else assert.fail(`non-read or unsupported method ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  };
  return {maps,calls,fetchImpl,setPhase:value=>{current=value;},rpc:new ReadOnlyRpc({release,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl})};
}
async function withSession(work){
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-create-state-'));
  try{
    const transport=provider('beforeAccounts'),store=await FileJournalStore.open({directory});
    const session=()=>new NativePlayerSession({release,abi,actor:bank.actor,store,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl:transport.fetchImpl});
    const derived={Project:(await nativePda(release.input.programId,'bio','project',projectId)).address,OpsVault:(await nativePda(release.input.programId,'bio','ops')).address};
    for(const [i,label]of ['AA','NUC','LIPID','SUGAR'].entries()){
      derived[`${label}_Mint`]=(await nativePda(release.input.programId,'bio','pack',projectId,Buffer.from([i+1]))).address;
      derived[`${label}_Auth`]=(await nativePda(release.input.programId,'bio','pack-auth',projectId,Buffer.from([i+1]))).address;
    }
    const suffix=nativeOperation(abi,'CREATE_PROJECT').publicFixedSuffix.map(row=>({name:row.role,address:derived[row.role]}));
    const instruction=await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts:[]});
    assert.deepEqual(instruction.accounts.map(a=>({pubkey:a.address,isSigner:Boolean(a.role&2),isWritable:Boolean(a.role&1)})),bank.instruction.accounts);
    const envelope=await session().prepare({operation:'CREATE_PROJECT',nonce,payload:decoded.payload,suffix,resources});
    assert.equal(envelope.frameHex,bank.frameHex);assert.deepEqual((await inspectPreparedNativeEnvelope({release,abi,envelope})).frame,frame);
    await work({transport,store,session,envelope});
    assert.equal(transport.calls.some(c=>['sendTransaction','simulateTransaction','getProgramAccounts'].includes(c.method)),false);
  }finally{await rm(directory,{recursive:true,force:true});}
}
const status=session=>reconcileProjectCreation({release,abi,session,actor:bank.actor,nonce});

test('actual created Project and all four Classic mints read together, while before-CREATE and prefunded System targets remain not found',async()=>{
  const f=provider(),out=await readProjectState({release,rpc:f.rpc,projectId});
  assert.equal(out.decision,'PROJECT_READ');assert.equal(out.projectRecordVerified,true);assert.equal(out.businessExecutionVerified,false);
  assert.equal(out.project.name,'Alpha');assert.equal(out.project.creator,bank.actor);assert.equal(out.project.creationBusinessHex,bank.createResult.creationBusinessHex);
  assert.deepEqual(out.mints.map(m=>m.address),mintAddresses);assert.deepEqual(out.mints.map(m=>m.supply),[0n,0n,0n,0n]);
  assert.deepEqual(out.project.classes.map(c=>[c.class,c.cap,c.unitPrice,c.issued,c.intakeBurned]),[1,2,3,4].map(i=>[i,1000000n,500000n,0n,0n]));
  const batch=f.calls.find(c=>c.method==='getMultipleAccounts');assert.equal(batch.params[0].length,8);assert.ok(mintAddresses.every(a=>batch.params[0].includes(a)));
  f.setPhase('beforeAccounts');assert.equal((await readProjectState({release,rpc:f.rpc,projectId})).decision,'PROJECT_NOT_FOUND');
  f.maps.beforeAccounts.set(projectAddress,{address:projectAddress,owner:PROGRAMS.systemProgram,executable:false,lamports:123n,rentEpoch:0n,data:Buffer.alloc(0)});
  assert.equal((await readProjectState({release,rpc:f.rpc,projectId})).projectRecordVerified,false);
});

test('real FileJournalStore/session confirms exact208 and keeps its original confirmation after restart and genuine nonce-cache overwrite',async()=>{
  await withSession(async({transport,store,session})=>{
    let stored=JSON.parse((await store.load()).payload);assert.equal(stored.entries[0].state,'PREPARED');assert.equal(stored.entries[0].frameHex,bank.frameHex);
    transport.setPhase('afterAccounts');const confirmed=await status(session());
    assert.equal(confirmed.decision,'CONFIRMED');assert.equal(confirmed.exactRequestExecutionVerified,true);assert.equal(confirmed.recordMatchesRequest,true);
    assert.equal(confirmed.resultSource,'LATEST_NONCE_CACHE');assert.equal(confirmed.receipt.creationFeeLamports,10000000n);assert.equal(confirmed.receipt.rentLamports,12284400n);
    assert.deepEqual(confirmed.receipt.mints,mintAddresses);assert.equal(confirmed.mints.length,4);assert.equal(confirmed.transactionExecuted,false);
    stored=JSON.parse((await store.load()).payload);const original=structuredClone(stored.entries[0].lastObservation);
    assert.equal(original.nextNonce,'2');assert.equal(original.lastDigestHex,bank.requestH4);assert.equal(original.lastResultHex,bank.execution.returnDataHex);
    transport.setPhase('checkpoint');const restored=await status(session());
    assert.equal(restored.decision,'CONFIRMED');assert.equal(restored.resultSource,'LOCAL_CONFIRMED_HISTORY');assert.equal(restored.exactRequestExecutionVerified,true);
    assert.equal(restored.receipt.rentLamports,12284400n);assert.ok(restored.project.classes.some(c=>c.issued>0n));
    stored=JSON.parse((await store.load()).payload);assert.deepEqual(stored.entries[0].lastObservation,original);assert.ok(BigInt(stored.globalObservation.nextNonce)>2n);
    assert.equal(stored.entries[0].resultHex,bank.execution.returnDataHex);
    // Real durable archive receipts retain the same historical fact. No fake
    // ActorNonce snapshot is introduced when the latest native cache is newer.
    const state=await store.load(),journal=PendingJournal.restore({release,abi,actor:bank.actor},state.payload);
    const receipts=await store.archiveTerminals([journal.exportTerminal(nonce)]);journal.pruneArchived(receipts,{expectedRevision:journal.revision});
    assert.notEqual(await store.compareAndSwap(state.revision,journal.serialize()),false);
    const archived=await status(session());assert.equal(archived.decision,'CONFIRMED');assert.equal(archived.resultSource,'LOCAL_DURABLE_ARCHIVE');
    assert.equal(archived.exactRequestExecutionVerified,true);assert.equal(archived.receipt.rentLamports,12284400n);
  });
});

test('a fresh pending journal that first observes the genuine full checkpoint cannot manufacture an old CREATE result',async()=>{
  await withSession(async({transport,store,session})=>{
    transport.setPhase('checkpoint');const out=await status(session());
    assert.equal(out.decision,'ALREADY_PROCESSED');assert.equal(out.exactRequestExecutionVerified,false);assert.equal(out.businessExecutionVerified,false);
    assert.equal(out.projectRecordVerified,true);assert.equal(out.recordMatchesRequest,true);assert.equal(out.receipt,null);assert.equal(out.resultSource,null);
    assert.equal(JSON.parse((await store.load()).payload).entries[0].resultHex,null);
  });
});

test('host-only conflicting H4 at the CREATE nonce stays NONCE_CONFLICT even though its durable Project matches',async()=>{
  await withSession(async({transport,store,session})=>{
    transport.maps.afterAccounts.get(bank.actorNonceAddress).data[128]^=1;transport.setPhase('afterAccounts');
    const out=await status(session());assert.equal(out.decision,'NONCE_CONFLICT');assert.equal(out.exactRequestExecutionVerified,false);
    assert.equal(out.projectRecordVerified,true);assert.equal(out.recordMatchesRequest,true);assert.equal(out.receipt,null);
    transport.setPhase('checkpoint');const later=await status(session());assert.equal(later.decision,'NONCE_CONFLICT');assert.equal(later.exactRequestExecutionVerified,false);
    assert.equal(JSON.parse((await store.load()).payload).entries[0].resultHex,null);
  });
});

test('host-only malformed ownership, catalog, name, class and each mint authority/decimals are rejected rather than treated as absence',async()=>{
  const changes=[
    f=>f.maps.afterAccounts.get(projectAddress).owner=PROGRAMS.tokenProgram,
    f=>f.maps.afterAccounts.get(projectAddress).data[184]^=1,
    f=>f.maps.afterAccounts.get(projectAddress).data[268]=0,
    f=>f.maps.afterAccounts.get(projectAddress).data[273]=2,
    f=>f.maps.afterAccounts.get(projectAddress).data.writeBigUInt64LE(11n,256),
    ...mintAddresses.flatMap(a=>[
      f=>f.maps.afterAccounts.get(a).owner=PROGRAMS.systemProgram,
      f=>nativeKeyBytes(key(20)).copy(f.maps.afterAccounts.get(a).data,4),
      f=>f.maps.afterAccounts.get(a).data[44]=1,
      f=>f.maps.afterAccounts.get(a).data.writeBigUInt64LE(1n,36),
      f=>f.maps.afterAccounts.set(a,null),
    ]),
  ];
  for(const mutate of changes){const f=provider();mutate(f);await assert.rejects(readProjectState({release,rpc:f.rpc,projectId}));}
});

test('host-only valid immutable name, seller, creator, cap and price changes cannot associate a confirmed receipt to another Project record',async()=>{
  const changes=[
    f=>Buffer.from('Other').copy(f.maps.afterAccounts.get(projectAddress).data,268),
    f=>nativeKeyBytes(key(20)).copy(f.maps.afterAccounts.get(projectAddress).data,216),
    f=>nativeKeyBytes(key(20)).copy(f.maps.afterAccounts.get(projectAddress).data,120),
    f=>f.maps.afterAccounts.get(projectAddress).data.writeBigUInt64LE(999999n,273+33),
    f=>f.maps.afterAccounts.get(projectAddress).data.writeBigUInt64LE(500001n,273+41),
  ];
  for(const mutate of changes){
    await withSession(async({transport,session})=>{
      mutate(transport);transport.setPhase('afterAccounts');const record=await readProjectState({release,rpc:transport.rpc,projectId});
      assert.equal(record.projectRecordVerified,true);assert.equal(projectRecordMatchesCreation({release,abi,frame,record}),false);
      await assert.rejects(status(session()),/PROJECT_CONFIRMED_RECORD_MISMATCH/);
    });
  }
});
