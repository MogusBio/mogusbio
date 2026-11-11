import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {sha256} from '../../protocol-core/src/index.mjs';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {validateProductionRelease,baseConfigR2Id} from '../../client/src/release.mjs';
import {loadNativeAbi,nativeKeyAddress,encodeNativeFrame,decodeNativeFrame} from '../../client/src/native.mjs';
import {decodeCreatePayload} from '../../launchpad/src/codec.mjs';
import {key} from '../../client/test/native-fixture.mjs';

const release=await validateProductionRelease(JSON.parse(await fs.readFile(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url),'utf8')),{localPublicFixture:true});
const abi=loadNativeAbi(undefined,{expectedHash:release.input.abiHash});
const sample=parseJsonWithBigInts(await fs.readFile(new URL('../../../programs/transaction-transport/evidence/create-project-bank-76b35cfb-case-1.json',import.meta.url),'utf8'));
const frame=Buffer.from(sample.frameHex,'hex'),decoded=decodeNativeFrame(abi,frame),payload=decodeCreatePayload(decoded.payload);
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
const body={actor:sample.actor,name:payload.name,seller:nativeKeyAddress(payload.saleRecipient),classes:payload.classes.map(c=>({class:c.class,cap:c.lifetimeCap.toString(),unitPrice:c.priceLamports.toString()})),maxCreationFee:payload.maxProtocolLamports.toString(),maxRent:payload.maxRentLamports.toString(),resources};
const rows=values=>new Map(values.map(a=>[a.address,a.missing===true?null:{...a,data:Buffer.from(a.data[0],'base64')}]));

async function ledger(){
 const bytes=await fs.readFile(new URL('../../../programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe.bin',import.meta.url));
 assert.equal(sha256(bytes).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
 const map=new Map();let at=108;for(let i=0;i<bytes.readUInt32LE(104);i++){
  const address=nativeKeyAddress(bytes.subarray(at,at+32)),lamports=bytes.readBigUInt64LE(at+32),owner=nativeKeyAddress(bytes.subarray(at+40,at+72)),executable=bytes[at+72]===1,rentEpoch=bytes.readBigUInt64LE(at+73),len=bytes.readUInt32LE(at+81);at+=85;
  map.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(bytes.subarray(at,at+len))});at+=len;
 }assert.equal(at,bytes.length);return map;
}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-project-bridge-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const state={map:rows(sample.beforeAccounts),slot:1000000n},calls=[];
 const endpoint='https://project-fixture.invalid/private?api-key=fixture-secret';
 const fetchImpl=async(url,options)=>{
  assert.equal(url,endpoint);const req=parseJsonWithBigInts(options.body);calls.push(req.method);let result;
  if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
  else if(req.method==='getMultipleAccounts')result={context:{slot:++state.slot},value:req.params[0].map(address=>{
   const a=state.map.get(address);return !a?null:{owner:a.owner,lamports:a.lamports,executable:a.executable,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};
  })};
  else if(req.method==='getLatestBlockhash')result={context:{slot:++state.slot},value:{blockhash:key(20),lastValidBlockHeight:100n}};
  else throw new Error(`unexpected ${req.method}`);
  return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
 };
 const bridge=await createOperatorBridge({release,abi,endpoint,stateDirectory:directory,fetchImpl});
 return {bridge,state,calls,directory};
}
function safe(result,f){const serialized=JSON.stringify(result);assert.deepEqual(JSON.parse(serialized),result);assert.doesNotMatch(serialized,/fixture-secret|project-fixture.invalid|\/private\/|pending-journal/);assert.equal(serialized.includes(f.directory),false);}
async function planned(f){return f.bridge.dispatch('project-plan',structuredClone(body));}
async function prepared(f){const plan=await planned(f);return f.bridge.dispatch('prepare',{actor:body.actor,intent:plan.intent});}
const status={actor:body.actor,nonce:decoded.nonce.toString()};

test('project bridge plans the exact genuine CREATE without a journal or send and distinguishes draft IDs from actual records',async t=>{
 const f=await fixture(t),plan=await planned(f);assert.equal(plan.decision,'ACTION');assert.equal(plan.intent.operation,'CREATE_PROJECT');assert.equal(plan.preview.predictionOnly,true);
 const built=encodeNativeFrame(abi,{operation:plan.intent.operation,domain:release.domain,configId:baseConfigR2Id(release),actor:body.actor,nonce:BigInt(plan.intent.nonce),payload:Buffer.from(plan.intent.payloadHex,'hex')});assert.deepEqual(built,frame);
 assert.equal(plan.projectRecordVerified,undefined);assert.equal(plan.businessExecutionVerified,false);assert.deepEqual(await fs.readdir(f.directory),[]);safe(plan,f);
 const missing=await f.bridge.dispatch('project-read',{actor:body.actor,projectIdHex:plan.projectIdHex});assert.equal(missing.decision,'PROJECT_NOT_FOUND');assert.equal(missing.projectRecordVerified,false);safe(missing,f);
 f.state.map=rows(sample.afterAccounts);const observed=await f.bridge.dispatch('project-read',{actor:body.actor,projectIdHex:plan.projectIdHex});
 assert.equal(observed.decision,'PROJECT_READ');assert.equal(observed.projectRecordVerified,true);assert.equal(observed.businessExecutionVerified,false);assert.equal(observed.mints.length,4);assert.ok(observed.mints.every(m=>m.decimals===0&&m.supply==='0'));safe(observed,f);
 assert.equal(f.calls.includes('sendTransaction'),false);assert.deepEqual(await fs.readdir(f.directory),[]);
});

test('project status reconciles the exact208 result from actual Bank bytes and retains confirmed history after newer real operations',async t=>{
 const f=await fixture(t),envelope=await prepared(f);assert.equal(envelope.frameHex,sample.frameHex);f.state.map=rows(sample.afterAccounts);
 const result=await f.bridge.dispatch('project-status',status);assert.equal(result.decision,'CONFIRMED');assert.equal(result.exactRequestExecutionVerified,true);assert.equal(result.recordMatchesRequest,true);
 assert.equal(result.projectRecordVerified,true);assert.equal(result.receipt.creationFeeLamports,'10000000');assert.equal(result.receipt.rentLamports,'12284400');assert.equal(result.receipt.mints.length,4);safe(result,f);
 f.state.map=await ledger();const after=await f.bridge.dispatch('project-status',status);assert.equal(after.decision,'CONFIRMED');assert.equal(after.exactRequestExecutionVerified,true);assert.equal(after.resultSource,'LOCAL_CONFIRMED_HISTORY');
 assert.ok(after.project.classes.some(c=>BigInt(c.issued)>0n));safe(after,f);assert.equal(f.calls.includes('sendTransaction'),false);
});

test('an overwritten old nonce cache may verify the Project record but never invent exact request confirmation or historical cost',async t=>{
 const f=await fixture(t);await prepared(f);f.state.map=await ledger();const out=await f.bridge.dispatch('project-status',status);
 assert.equal(out.decision,'ALREADY_PROCESSED');assert.equal(out.exactRequestExecutionVerified,false);assert.equal(out.businessExecutionVerified,false);assert.equal(out.projectRecordVerified,true);assert.equal(out.recordMatchesRequest,true);assert.equal(out.receipt,null);safe(out,f);
 assert.equal(f.calls.includes('sendTransaction'),false);
});

test('a matching nonce receipt cannot hide a changed immutable Project record',async t=>{
 const f=await fixture(t);await prepared(f);f.state.map=rows(sample.afterAccounts);const project=f.state.map.get(sample.instruction.accounts[8].pubkey);project.data[120+148]=0x42;
 await assert.rejects(f.bridge.dispatch('project-status',status),/PROJECT_CONFIRMED_RECORD_MISMATCH/);assert.equal(f.calls.includes('sendTransaction'),false);
});

test('project endpoints reject caller runtime fields, IDs, malformed classes and resources before fetching',async t=>{
 const f=await fixture(t);for(const [action,original]of [['project-plan',body],['project-read',{actor:body.actor,projectIdHex:'00'.repeat(32)}],['project-status',status]]){
  for(const name of ['endpoint','stateDirectory','privateKey','nonceOverride','release','modulePath']){const before=f.calls.length;await assert.rejects(f.bridge.dispatch(action,{...original,[name]:'forbidden'}),/BRIDGE_FIELDS/);assert.equal(f.calls.length,before);}
 }
 for(const input of [{...body,classes:[...body.classes].reverse()},{...body,classes:body.classes.slice(0,3)},{...body,classes:body.classes.map((c,i)=>i?c:{...c,cap:'00'})},{...body,resources:{...resources,computeUnitLimit:0}}]){
  const before=f.calls.length;await assert.rejects(f.bridge.dispatch('project-plan',input));assert.equal(f.calls.length,before);
 }
 const before=f.calls.length;await assert.rejects(f.bridge.dispatch('project-read',{actor:body.actor,projectIdHex:'ab'}),/BRIDGE_ID32/);await assert.rejects(f.bridge.dispatch('project-status',{...status,nonce:'01'}),/BRIDGE_DECIMAL/);assert.equal(f.calls.length,before);
 assert.deepEqual(await fs.readdir(f.directory),[]);
});
