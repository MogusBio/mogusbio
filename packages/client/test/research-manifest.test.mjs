import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,stat,readdir,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256} from '../../protocol-core/src/index.mjs';
import {createSynthesisManifest} from '../src/synthesis-manifest.mjs';
import {createResearchManifest,restoreResearchManifest,publicResearchWorkflow,ResearchWorkflowStore} from '../src/research-manifest.mjs';
import {encodeNativeFrame,encodeSynthFinalizePayload,decodeNativeFrame} from '../src/native.mjs';
import {baseConfigR2Id} from '../src/release.mjs';
import {FileJournalStore} from '../src/file-journal.mjs';
import {key} from './native-fixture.mjs';
import {release,abi,actor,resources,hostSynthesisFixture} from './synthesis-fixture.mjs';

const cranker=key(8),fixtureSalt=sha256(Buffer.from('PUBLIC TEST FIXTURE ONLY research salt'));
async function fixture(){
  const f=await hostSynthesisFixture({target:22}),baseManifest=await createSynthesisManifest({release,abi,actor,plan:f.plan,directInputs:f.directInputs,challengePpm:2000000,maxRent:f.args.maxRent,maxUploadRent:f.args.maxUploadRent,maxFee:f.args.maxFee,resources});
  const args={release,abi,author:actor,cranker,baseManifest,commitNonce:20n,round:5n,salt:Buffer.from(fixtureSalt),expectedGeneration:7n,maxRent:baseManifest.maxRent,maxUploadRent:baseManifest.maxUploadRent,maxFee:baseManifest.maxFee,resources};
  return {f,args,m:await createResearchManifest(args)};
}
const restore=(m,extra={})=>restoreResearchManifest({release,abi,author:actor,workflowId:m.workflowId,text:m.text,...extra});
function hashed(value){const text=typeof value==='string'?value:JSON.stringify(value);return {text,workflowId:createHash('sha256').update('BIORESEARCH-MANIFEST1\0').update(text).digest('hex')};}
function final(m,changes={}){
  const {nonce=m.workflow.futureManufactureNonce,...payloadChanges}=changes,payload=encodeSynthFinalizePayload({artifactId:m.baseManifest.plan.artifactId,artifactSHA:m.baseManifest.plan.artifactSHA,artifactLength:m.baseManifest.plan.bytes.length,expectedGeneration:m.expectedGeneration+1n,transcriptSHA:Buffer.alloc(32,9),maxFee:m.maxFee,maxRent:m.maxRent,competition:{commitId:m.workflow.commit.commitId,salt:m.salt},...payloadChanges});
  return {operation:'SYNTH_FINALIZE',nonce,frame:encodeNativeFrame(abi,{operation:'SYNTH_FINALIZE',domain:release.domain,configId:baseConfigR2Id(release),actor,nonce,payload})};
}
async function withStore(run){const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-research-manifest-'));try{const f=await fixture(),store=new ResearchWorkflowStore({directory});await run({...f,store,directory});}finally{await rm(directory,{recursive:true,force:true});}}
const requestId=sha256(Buffer.from('public research create requestId')).toString('hex'),requestDigest=sha256(Buffer.from('canonical public research request body')).toString('hex');
const requestArgs={release,abi,author:actor,requestId,requestDigest};

test('HOST private research restore rebuilds the exact fixed author window and branded delegated workflow without current LIVE reads',async()=>{
  const {m,f}=await fixture(),r=await restore(m),chunks=BigInt(Math.ceil(m.baseManifest.plan.bytes.length/1024));
  assert.equal(r.workflow.futureManufactureNonce,20n+chunks+3n);assert.equal(r.workflow.preparation.nextNonce,r.workflow.futureManufactureNonce);assert.equal(r.workflow.preparation.stages[0].nonce,21n);assert.equal(r.workflow.preparation.stages.at(-1).nonce,r.workflow.futureManufactureNonce-1n);
  assert.equal(r.workflow.commit.frame.toString('hex'),m.workflow.commit.frame.toString('hex'));assert.deepEqual(r.baseManifest.plan.bytes,m.baseManifest.plan.bytes);assert.equal(r.expectedGeneration,7n);
  assert.equal(decodeNativeFrame(abi,r.workflow.commit.frame).operation,'COMMIT');assert.equal(decodeNativeFrame(abi,r.workflow.commit.frame).nonce,20n);assert.equal(r.workflow.authorNonceReserved,false);assert.equal(r.workflow.stepCountPredicted,false);
  for(const input of f.directInputs)input.account.data.fill(0);assert.equal((await restore(m)).workflow.futureManufactureNonce,r.workflow.futureManufactureNonce);
});
test('public metadata omits salt/design/Artifact/input fields before confirmation and never publishes salt after explicit reveal',async()=>{
  const {m}=await fixture(),before=publicResearchWorkflow(m),text=JSON.stringify(before);
  assert.deepEqual(Object.keys(before),['workflowId','author','cranker','round','commitNonce','futureManufactureNonce','chunkCount','maxRent','maxUploadRent','maxFee','resources']);
  for(const privateValue of [fixtureSalt.toString('hex'),m.baseManifest.plan.artifactId.toString('hex'),m.baseManifest.plan.artifactSHA.toString('hex'),m.baseManifest.plan.graphSHA.toString('hex'),m.baseManifest.plan.payload.direct[0].instance.toString('hex'),m.workflow.commit.design.toString('hex')])assert.equal(text.includes(privateValue),false);
  assert.equal(before.salt,undefined);assert.equal(before.synthesis,undefined);assert.equal(before.commitmentHex,undefined);assert.equal(text.includes('payload702Hex'),false);
  const revealed=publicResearchWorkflow(m,{reveal:true}),after=JSON.stringify(revealed);assert.equal(revealed.synthesis.target,22);assert.equal(revealed.synthesis.artifactIdHex,m.baseManifest.plan.artifactId.toString('hex'));assert.equal(after.includes(fixtureSalt.toString('hex')),false);assert.equal(after.includes('baseManifestText'),false);
  assert.equal(m.workflow.commit.payload.includes(fixtureSalt),false);assert.equal(m.workflow.commit.payload.includes(m.baseManifest.plan.bytes),false);
  await assert.rejects(restore(m,{text:m.text+' '}),/RESEARCH_MANIFEST_HASH/);assert.throws(()=>publicResearchWorkflow(m,{reveal:'true'}),/RESEARCH_REVEAL_FLAG/);
});
test('private canonical fields, author/cranker, caps, commitment and future nonce cannot be weakened or renumbered',async()=>{
  const {m,args}=await fixture();
  for(const change of [v=>v.commitNonce='21',v=>v.round='6',v=>v.saltHex='00'.repeat(32),v=>v.futureManufactureNonce='900',v=>v.chunkCount++,v=>v.commitIdHex='00'.repeat(32),v=>v.commitmentHex='00'.repeat(32),v=>v.commitFrameHex=(v.commitFrameHex[0]==='0'?'1':'0')+v.commitFrameHex.slice(1),v=>v.extra=true,v=>v.maxFee='0']){
    const v=JSON.parse(m.text);change(v);await assert.rejects(restore(m,hashed(v)));
  }
  const generation=JSON.parse(m.text);generation.expectedGeneration='8';await assert.rejects(restore(m,{text:JSON.stringify(generation)}),/HASH/);
  const reordered=JSON.parse(m.text);reordered.resources=Object.fromEntries(Object.entries(reordered.resources).reverse());await assert.rejects(restore(m,hashed(reordered)),/CANONICAL/);
  for(const change of [a=>a.cranker=actor,a=>a.expectedGeneration=(1n<<64n)-1n,a=>a.commitNonce=(1n<<64n)-2n,a=>a.maxRent+=1n,a=>a.maxUploadRent+=1n,a=>a.maxFee+=1n,a=>a.resources={...resources,priorityFeeLamports:1n},a=>a.commitment=Buffer.alloc(32)]){
    const a={...args};change(a);await assert.rejects(createResearchManifest(a));
  }
  const missing={...args};delete missing.expectedGeneration;await assert.rejects(createResearchManifest(missing),/FIELDS/);
  await assert.rejects(restore(m,{author:cranker}),/CONTEXT/);
});
test('private manifest and single competition FINAL hint persist0600, bind exact189 reveal, and cannot be replaced at the frozen nonce',async()=>withStore(async({m,store,directory})=>{
  assert.deepEqual(await store.loadHints(m),{finalFrameHex:null});await store.save(m);assert.equal((await store.save(m)).alreadySaved,true);
  const valid=final(m);assert.equal((await store.recordFinalAttempt(m,valid)).alreadySaved,false);assert.equal((await store.recordFinalAttempt(m,valid)).alreadySaved,true);
  const restarted=new ResearchWorkflowStore({directory}),r=await restarted.load({release,abi,author:actor,workflowId:m.workflowId});assert.equal((await restarted.loadHints(r)).finalFrameHex,valid.frame.toString('hex'));
  assert.equal(Buffer.from((await restarted.loadHints(r)).finalFrameHex,'hex').subarray(-32).equals(fixtureSalt),true);
  for(const changes of [{nonce:m.workflow.futureManufactureNonce+1n},{expectedGeneration:m.expectedGeneration+2n},{maxFee:m.maxFee+1n},{maxRent:m.maxRent+1n},{competition:null},{competition:{commitId:Buffer.alloc(32),salt:m.salt}},{competition:{commitId:m.workflow.commit.commitId,salt:Buffer.alloc(32)}}])await assert.rejects(store.recordFinalAttempt(m,final(m,changes)));
  await assert.rejects(store.recordFinalAttempt(m,final(m,{transcriptSHA:Buffer.alloc(32,8)})),/NONCE_CONFLICT/);
  for(const file of await readdir(directory))if(file.endsWith('.json'))assert.equal((await stat(path.join(directory,file))).mode&0o777,0o600);assert.equal((await stat(directory)).mode&0o777,0o700);
}));
test('separate bounded position lookup survives restart without changing private salt, manifest or FINAL hint',async()=>withStore(async({m,store,directory})=>{
  await store.save(m);assert.equal(await store.loadPositionLookup(m),null);const value={activationIdHex:'01'.repeat(32),rootInstanceHex:'02'.repeat(32),positionIdHex:'03'.repeat(32),nextStart:'44',ordinaryCount:'300'};
  await Promise.all([store.savePositionLookup(m,value),store.recordFinalAttempt(m,final(m))]);assert.deepEqual(await store.loadPositionLookup(m),value);assert.equal((await store.loadHints(m)).finalFrameHex,final(m).frame.toString('hex'));
  const restarted=new ResearchWorkflowStore({directory}),loaded=await restarted.load({release,abi,author:actor,workflowId:m.workflowId});assert.deepEqual(await restarted.loadPositionLookup(loaded),value);assert.deepEqual(loaded.salt,m.salt);assert.equal(loaded.text,m.text);
  for(const bad of [{...value,nextStart:'300'},{...value,nextStart:'-1'},{...value,nextStart:'01'},{...value,ordinaryCount:'0'},{...value,extra:true}])await assert.rejects(store.savePositionLookup(m,bad));
  await store.savePositionLookup(m,{...value,nextStart:null});assert.equal((await store.loadPositionLookup(m)).nextStart,null);await store.savePositionLookup(m,null);assert.equal(await store.loadPositionLookup(m),null);assert.equal((await store.loadHints(m)).finalFrameHex,final(m).frame.toString('hex'));
}));
test('createRequest retry reuses first private salt/window before rebuilding after state changes and repairs a missing workflow index',async()=>withStore(async({args,store,directory})=>{
  let builds=0;const first=await store.createRequest({...requestArgs,build:async()=>{builds++;return createResearchManifest({...args,salt:randomBytes(32)});}});
  const second=await(new ResearchWorkflowStore({directory})).createRequest({...requestArgs,build:async()=>{builds++;return createResearchManifest({...args,commitNonce:999n,salt:randomBytes(32)});}});
  assert.equal(builds,1);assert.equal(second.alreadySaved,true);assert.equal(second.manifest.workflowId,first.manifest.workflowId);assert.deepEqual(second.manifest.salt,first.manifest.salt);assert.equal(second.manifest.commitNonce,20n);
  await assert.rejects(store.createRequest({...requestArgs,requestDigest:'00'.repeat(32),build:async()=>{assert.fail('conflicting digest must not build');}}),/DIGEST_CONFLICT/);
  await unlink(path.join(directory,`research-${first.manifest.workflowId}.json`));
  const repaired=await store.createRequest({...requestArgs,build:async()=>{assert.fail('repair must reuse stored winner');}});assert.equal(repaired.manifest.workflowId,first.manifest.workflowId);assert.equal((await store.load({release,abi,author:actor,workflowId:first.manifest.workflowId})).workflowId,first.manifest.workflowId);
  const requestFile=path.join(directory,`research-${requestId}-request.json`);assert.equal((await stat(requestFile)).mode&0o777,0o600);
}));
test('concurrent same-request builds select one protected private winner without persisting losing manifests',async()=>withStore(async({args,store,directory})=>{
  let builds=0,unblock;const ready=new Promise(resolve=>{unblock=resolve;}),secondStore=new ResearchWorkflowStore({directory});
  const build=nonce=>async()=>{builds++;if(builds===2)unblock();await ready;return createResearchManifest({...args,commitNonce:nonce,salt:randomBytes(32)});};
  const results=await Promise.all([store.createRequest({...requestArgs,build:build(30n)}),secondStore.createRequest({...requestArgs,build:build(31n)})]);
  assert.equal(builds,2);assert.equal(results[0].manifest.workflowId,results[1].manifest.workflowId);assert.deepEqual(results[0].manifest.salt,results[1].manifest.salt);assert.equal(results.filter(r=>!r.alreadySaved).length,1);
  const files=(await readdir(directory)).filter(name=>name.endsWith('.json'));assert.deepEqual(files.sort(),[`research-${requestId}-request.json`,`research-${results[0].manifest.workflowId}.json`].sort());
}));
test('private parser/build failures redact source snippets, arbitrary error codes and salt from every error field',async()=>withStore(async({m,store})=>{
  const secret='SALT_PRIVATE_NEVER_LOG_1234567890',malformed=`{"saltHex":"${secret}",`;
  let parseError;try{await restore(m,hashed(malformed));}catch(error){parseError=error;}
  assert.equal(parseError.code,'RESEARCH_PRIVATE_ENCODING');assert.equal(String(parseError.stack).includes(secret),false);assert.equal(JSON.stringify(parseError).includes(secret),false);
  let buildError;try{await store.createRequest({...requestArgs,build:async()=>{throw Object.assign(new Error(secret),{code:fixtureSalt.toString('hex').toUpperCase(),privateSalt:secret});}});}catch(error){buildError=error;}
  assert.equal(buildError.code,'RESEARCH_REQUEST_BUILD_FAILED');assert.equal(buildError.message,'RESEARCH_REQUEST_BUILD_FAILED');assert.equal(String(buildError.stack).includes(secret),false);assert.equal(JSON.stringify(buildError).includes(fixtureSalt.toString('hex').toUpperCase()),false);assert.equal(Object.hasOwn(buildError,'cause'),false);assert.deepEqual(Object.keys(buildError),['code']);
}));
