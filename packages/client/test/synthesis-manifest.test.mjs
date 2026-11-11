import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256} from '../../protocol-core/src/index.mjs';
import {decodeGraph,members} from '../../biology/src/graph.mjs';
import {validateProductionRelease,baseConfigR2Id} from '../src/release.mjs';
import {loadNativeAbi,nativeKeyAddress,nativeKeyBytes,nativePda,encodeNativeFrame,encodeSynthFinalizePayload} from '../src/native.mjs';
import {planSynthesisPayload,planSynthesisPreparation} from '../src/synthesis-workflow.mjs';
import {FileJournalStore} from '../src/file-journal.mjs';
import {createSynthesisManifest,restoreSynthesisManifest,publicSynthesisWorkflow,SynthesisWorkflowStore} from '../src/synthesis-manifest.mjs';

const saved=p=>readFile(new URL(`../../../${p}`,import.meta.url));
const release=await validateProductionRelease(JSON.parse(await saved('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true}),actor=release.input.bootstrap;
const abi=loadNativeAbi(await saved('programs/biolab-economy/operations.p0r2.json'),{expectedHash:release.input.abiHash});
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const pda=(...s)=>nativePda(release.input.programId,'bio',...s).then(p=>p.address);
const ledger=await saved('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b1687.bin');
assert.equal(sha256(ledger).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
const checkpoint=new Map();let at=108;
for(let i=0;i<ledger.readUInt32LE(104);i++){
  const address=nativeKeyAddress(ledger.subarray(at,at+32)),lamports=ledger.readBigUInt64LE(at+32),owner=nativeKeyAddress(ledger.subarray(at+40,at+72)),executable=ledger[at+72]===1,rentEpoch=ledger.readBigUInt64LE(at+73),length=ledger.readUInt32LE(at+81);at+=85;
  checkpoint.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(ledger.subarray(at,at+length))});at+=length;
}
assert.equal(at,ledger.length);const roots=[...checkpoint.values()].filter(a=>a.owner===release.input.programId&&a.data.length>=443&&a.data.readUInt16LE(10)===12);
const copy=a=>({...a,data:Buffer.from(a.data)});
/** HOST-ONLY restored LIVE direct accounts from genuine immutable76b ledger.
 * Neither planning nor restored manifests create native outputs or prove PASS. */
async function fixture(target=1){
  const graph={...decodeGraph(await saved(`fixtures/graphs/c320-scope-${String(target).padStart(2,'0')}.bin`)),domain:Buffer.from(release.domain),config:baseConfigR2Id(release),catalog:Buffer.from(release.hashes.catalogHash),rule:Buffer.from(release.hashes.ruleHash)};
  const selected=target<=15?[1,2,3,4].map(p=>roots.find(a=>a.data.readUInt16LE(12)===1&&a.data[282]===p&&(p!==4||a.data[283]===target))):roots.filter(a=>a.data.readUInt16LE(12)===(target===22?3:2)&&(target===22?[16,17,18,19,20,21]:members(target)).includes(a.data[280]));
  const directInputs=[];
  for(const source of selected){
    const account=copy(source);account.data[362]=0;account.data.fill(0,363,443);const instance=Buffer.from(account.data.subarray(120,152));
    directInputs.push({instance,account,rootReg:null,originalArtifact:target<=15?undefined:copy(checkpoint.get(await pda('artifact',account.data.subarray(443,475))))});
  }
  const plan=await planSynthesisPayload({release,actor,graph,directInputs});
  const args={release,abi,actor,plan,directInputs,challengePpm:2000000,maxRent:100000000n,maxUploadRent:100000000n,maxFee:plan.materialFeeAtoms,resources};
  return {args,plan,directInputs,m:await createSynthesisManifest(args)};
}
const restore=(m,extra={})=>restoreSynthesisManifest({release,abi,actor,workflowId:m.workflowId,text:m.text,...extra});
function hashed(value){const text=typeof value==='string'?value:JSON.stringify(value);return {text,workflowId:createHash('sha256').update('BIOSYNTHESIS-MANIFEST1\0').update(text).digest('hex')};}
function final(m,nonce=50n,overrides={}){
  const payload=encodeSynthFinalizePayload({artifactId:m.plan.artifactId,artifactSHA:m.plan.artifactSHA,artifactLength:m.plan.bytes.length,expectedGeneration:1n,transcriptSHA:Buffer.alloc(32,7),maxFee:m.maxFee,maxRent:m.maxRent,...overrides});
  return {operation:'SYNTH_FINALIZE',nonce,frame:encodeNativeFrame(abi,{operation:'SYNTH_FINALIZE',domain:release.domain,configId:baseConfigR2Id(release),actor,nonce,payload})};
}
async function withStore(run){
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-synthesis-manifest-'));
  try{const f=await fixture(),store=new SynthesisWorkflowStore({directory});await run({...f,store,directory});}finally{await rm(directory,{recursive:true,force:true});}
}
const lookup={activationIdHex:'11'.repeat(32),rootInstanceHex:'22'.repeat(32),positionIdHex:'33'.repeat(32),nextStart:'20',ordinaryCount:'60'};

test('HOST-only canonical CELL/ORGAN/BIO manifests rebuild existing exact plan/PDA/capsules without LIVE reads during restore',async()=>{
  for(const [target,fee]of [[1,'800000'],[16,'3200000'],[18,'6400000'],[22,'12000000']]){
    const {m,plan,directInputs}=await fixture(target),restored=await restore(m);assert.equal(restored.text,m.text);assert.equal(restored.workflowId,m.workflowId);
    assert.deepEqual(restored.plan.bytes,plan.bytes);assert.deepEqual(restored.plan.payload,plan.payload);assert.deepEqual(restored.plan.directRoots,plan.directRoots);assert.deepEqual(restored.plan.parents,plan.parents);
    const publicValue=publicSynthesisWorkflow(restored);assert.equal(publicValue.materialFeeAtoms,fee);assert.equal(publicValue.predictsFinalNonce,false);assert.equal(publicValue.stepCountPredicted,false);assert.doesNotThrow(()=>JSON.stringify(publicValue));
    assert.equal(publicValue.direct.length,plan.directRoots.length);assert.equal(publicValue.parents.length,target<=15?0:plan.directRoots.length);assert.equal(publicValue.resources.priorityFeeLamports,'0');
    for(const input of directInputs){input.account.data.fill(0);if(input.originalArtifact)input.originalArtifact.data.fill(0);}
    const after=await restore(m);assert.deepEqual(after.plan.bytes,plan.bytes);assert.deepEqual(after.plan.directRoots,plan.directRoots);
    const preparation=await planSynthesisPreparation({release,abi,plan:after.plan,initialNonce:3n,expectedGeneration:0n,challengePpm:after.challengePpm,maxRent:after.maxRent,maxUploadRent:after.maxUploadRent});
    assert.equal(preparation.stages.at(-1).operation,'VERIFY_BEGIN');assert.equal(preparation.predictsFinalNonce,false);
  }
});
test('content identity, context, canonical fields, direct metadata and strict quantities reject tampering',async()=>{
  const {m}=await fixture();
  await assert.rejects(restore(m,{text:m.text+' '}),/HASH/);await assert.rejects(restore(m,{actor:release.input.programId}),/CONTEXT/);
  const changes=[
    v=>v.actor=release.input.programId,v=>v.releaseHash='00'.repeat(32),v=>v.abiHash='00'.repeat(32),v=>v.extra=true,
    v=>v.challengePpm=500001,v=>v.maxRent='01',v=>v.maxFee='0',v=>v.maxUploadRent='18446744073709551616',
    v=>v.resources.priorityFeeLamports='1e3',v=>v.resources.rpc='https://example.invalid',
    v=>v.direct[0].instanceHex='00'.repeat(32),v=>v.direct[0].fingerprintHex='00'.repeat(32),v=>v.direct[0].revision='500',
    v=>v.direct[0].createdAt=String(1n<<63n),v=>v.direct[0].createdSlot='-1',v=>v.parents.push({instanceHex:'00'.repeat(32),artifactIdHex:'11'.repeat(32)}),
  ];
  for(const mutate of changes){const v=JSON.parse(m.text);mutate(v);await assert.rejects(restore(m,hashed(v)));}
  const value=JSON.parse(m.text),noncanonical='{'+Object.entries(value).reverse().map(([k,v])=>JSON.stringify(k)+':'+JSON.stringify(v)).join(',')+'}';
  await assert.rejects(restore(m,hashed(noncanonical)),/CANONICAL/);
  const duplicate=m.text.replace('"maxRent":"100000000"','"maxRent":"100000000","maxRent":"100000000"');await assert.rejects(restore(m,hashed(duplicate)),/CANONICAL/);
  const reordered=JSON.parse(m.text);reordered.direct[0]=Object.fromEntries(Object.entries(reordered.direct[0]).reverse());await assert.rejects(restore(m,hashed(reordered)),/CANONICAL/);
});
test('create independently rechecks the actual frozen direct plan and all signed cap/challenge limits',async()=>{
  const f=await fixture();
  for(const mutate of [
    a=>a.maxFee=0n,a=>a.maxRent=-1n,a=>a.maxUploadRent=1n<<64n,a=>a.challengePpm=499000,a=>a.resources={...resources,extra:1},
    a=>a.directInputs=a.directInputs.slice(1),a=>a.directInputs[0].account.data.writeBigUInt64LE(100n,354),
    a=>nativeKeyBytes(release.input.programId).copy(a.directInputs[0].account.data,322),
  ]){
    const value={...f.args,directInputs:f.directInputs.map(i=>({...i,instance:Buffer.from(i.instance),account:copy(i.account),originalArtifact:i.originalArtifact?copy(i.originalArtifact):undefined}))};mutate(value);await assert.rejects(createSynthesisManifest(value));
  }
  const hard=await fixture(3);await assert.rejects(createSynthesisManifest({...hard.args,challengePpm:1000000}),/HARD_CHALLENGE/);
});
test('protected immutable store is idempotent and restartable; missing, altered file content and wrong actor do not restore',async()=>withStore(async({m,store,directory})=>{
  assert.deepEqual(await store.loadHints(m),{finalFrameHex:null,positionLookup:null});
  assert.equal((await store.save(m)).alreadySaved,false);assert.equal((await store.save(m)).alreadySaved,true);
  const restarted=new SynthesisWorkflowStore({directory}),restored=await restarted.load({release,abi,actor,workflowId:m.workflowId});assert.equal(restored.workflowId,m.workflowId);assert.deepEqual(restored.plan.bytes,m.plan.bytes);
  await assert.rejects(restarted.load({release,abi,actor:release.input.programId,workflowId:m.workflowId}),/CONTEXT/);
  await assert.rejects(restarted.load({release,abi,actor,workflowId:'00'.repeat(32)}),/NOT_FOUND/);
  const raw=await FileJournalStore.open({directory,name:`synthesis-${m.workflowId}.json`}),old=await raw.load();await raw.compareAndSwap(old.revision,m.text+' ');
  await assert.rejects(restarted.load({release,abi,actor,workflowId:m.workflowId}),/HASH/);await assert.rejects(store.save(m),/CONFLICT/);
}));
test('bounded latest FINAL hints bind the exact ordinary frame and never decrease or replace a nonce',async()=>withStore(async({m,store,directory})=>{
  const first=final(m);await assert.rejects(store.recordFinalAttempt(m,first),/NOT_SAVED/);await store.save(m);
  assert.equal((await store.recordFinalAttempt(m,first)).alreadySaved,false);assert.equal((await store.recordFinalAttempt(m,first)).alreadySaved,true);
  assert.equal((await store.loadHints(m)).finalFrameHex,first.frame.toString('hex'));assert.equal((await store.loadHints(m)).positionLookup,null);
  await assert.rejects(store.recordFinalAttempt(m,final(m,49n)),/NONCE_REGRESSION/);
  await assert.rejects(store.recordFinalAttempt(m,final(m,50n,{transcriptSHA:Buffer.alloc(32,8)})),/NONCE_CONFLICT/);
  for(const action of [final(m,51n,{maxFee:m.maxFee+1n}),final(m,51n,{maxRent:m.maxRent+1n}),final(m,51n,{artifactId:Buffer.alloc(32)}),final(m,51n,{expectedGeneration:0n}),final(m,51n,{competition:{commitId:Buffer.alloc(32,1),salt:Buffer.alloc(32,2)}})])await assert.rejects(store.recordFinalAttempt(m,action));
  const next=final(m,60n);await store.recordFinalAttempt(m,next);
  assert.equal((await(new SynthesisWorkflowStore({directory})).loadHints(m)).finalFrameHex,next.frame.toString('hex'));
}));
test('strict cursor hints preserve latest FINAL and FINAL changes preserve cursor; explicit clear stays bounded',async()=>withStore(async({m,store,directory})=>{
  await store.save(m);const frame=final(m);await store.recordFinalAttempt(m,frame);await store.savePositionLookup(m,lookup);
  assert.deepEqual(await store.loadHints(m),{finalFrameHex:frame.frame.toString('hex'),positionLookup:lookup});
  await store.recordFinalAttempt(m,final(m,51n));assert.deepEqual((await store.loadHints(m)).positionLookup,lookup);
  for(const value of [{...lookup,extra:1},{...lookup,activationIdHex:'AB'.repeat(32)},{...lookup,positionIdHex:'11'},{...lookup,nextStart:'60'},{...lookup,nextStart:'00'},{...lookup,ordinaryCount:'0'},{...lookup,nextStart:20}])await assert.rejects(store.savePositionLookup(m,value));
  await store.savePositionLookup(m,{...lookup,nextStart:null,ordinaryCount:'0'});assert.equal((await store.loadHints(m)).positionLookup.nextStart,null);
  await store.savePositionLookup(m,null);const stored=await store.loadHints(m);assert.equal(stored.positionLookup,null);assert.equal(stored.finalFrameHex,final(m,51n).frame.toString('hex'));
  const raw=await FileJournalStore.open({directory,name:`synthesis-${m.workflowId}-hints.json`}),loaded=await raw.load(),v=JSON.parse(loaded.payload);assert.deepEqual(Object.keys(v),['version','workflowId','finalFrameHex','positionLookup']);assert.ok(Buffer.byteLength(loaded.payload)<12288);
}));
test('concurrent protected hint updates cannot overwrite the other field; a busy writer can explicitly retry',async()=>withStore(async({m,store,directory})=>{
  await store.save(m);const second=new SynthesisWorkflowStore({directory}),action=final(m);
  const attempts=await Promise.allSettled([store.recordFinalAttempt(m,action),second.savePositionLookup(m,lookup)]);
  for(let i=0;i<attempts.length;i++)if(attempts[i].status==='rejected'){
    assert.match(attempts[i].reason.code,/FILE_CAS_(?:GATE|LOCK)_BUSY|SYN_MANIFEST_HINT_CAS_RETRY/);
    if(i===0)await store.recordFinalAttempt(m,action);else await second.savePositionLookup(m,lookup);
  }
  assert.deepEqual(await store.loadHints(m),{finalFrameHex:action.frame.toString('hex'),positionLookup:lookup});
}));
