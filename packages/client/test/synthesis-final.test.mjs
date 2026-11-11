import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {sha256,ByteWriter,typedHash} from '../../protocol-core/src/index.mjs';
import {encodeGraph} from '../../biology/src/graph.mjs';
import {decodeSynthesisPayload,encodeLeafMap} from '../../composition/src/payload.mjs';
import {validateProductionRelease,baseConfigR2Id,PROGRAMS} from '../src/release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda,loadNativeAbi,decodeNativeFrame} from '../src/native.mjs';
import {decodeNativeSynthesisVerification,planSynthesisPayload} from '../src/synthesis-workflow.mjs';
import {planActualSynthesisFinalization} from '../src/synthesis-final.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
import {recordAccount} from './account-fixture.mjs';

const root=new URL('../../../',import.meta.url),saved=p=>readFileSync(new URL(p,root));
const release=await validateProductionRelease(JSON.parse(saved('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
const abi=loadNativeAbi(undefined,{expectedHash:release.input.abiHash}),actor=release.input.bootstrap;
const FAMILY=Buffer.from('a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe','hex');
const pda=(...s)=>nativePda(release.input.programId,'bio',...s).then(p=>p.address),le=n=>new ByteWriter(8).u64(n).finish();
const raw=saved('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe.bin');
assert.equal(sha256(raw).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
const actual=new Map();let at=108;
for(let i=0;i<raw.readUInt32LE(104);i++){
  const address=nativeKeyAddress(raw.subarray(at,at+32)),lamports=raw.readBigUInt64LE(at+32),owner=nativeKeyAddress(raw.subarray(at+40,at+72)),executable=raw[at+72]===1,rentEpoch=raw.readBigUInt64LE(at+73),length=raw.readUInt32LE(at+81);at+=85;
  actual.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(raw.subarray(at,at+length))});at+=length;
}assert.equal(at,raw.length);
const copy=m=>new Map([...m].map(([a,v])=>[a,v===null?null:{...v,data:Buffer.from(v.data)}]));
const wire=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};

// Actual unchanged76b accepted records supply the model, capsules, supplies,
// mining history and LAB wallet. Restoring consumed Direct Roots and creating a
// completed V4 observation is explicitly HOST-ONLY, not new SBF execution/PASS.
async function fixture({target=1,onRead}={}){
  const map=copy(actual),cell=[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===761&&a.data.readUInt16LE(10)===12&&a.data[280]===target),artifactId=Buffer.from(cell.data.subarray(443,475));
  const artifactAddress=await pda('artifact',artifactId),artifact=map.get(artifactAddress),bytes=Buffer.from(artifact.data.subarray(251)),payload=decodeSynthesisPayload(bytes),direct=[];
  for(const d of payload.direct){const address=await pda('root',d.instance),account=map.get(address);account.data[362]=0;account.data.fill(0,363,443);account.data.writeBigUInt64LE(d.expectedRevision,354);
    direct.push({instance:d.instance,account,rootReg:map.get(await pda('root-reg',d.instance))??null,...(account.data.readUInt16LE(12)>1?{originalArtifact:map.get(await pda('artifact',account.data.subarray(443,475)))}:{})});}
  const plan=await planSynthesisPayload({release,actor,graph:payload.graph,directInputs:direct});assert.deepEqual(plan.bytes,bytes);
  const verificationAddress=await pda('verify',nativeKeyBytes(actor)),old=map.get(verificationAddress),d=Buffer.from(old.data),graphLength=bytes.readUInt32LE(16),directAt=21+graphLength,leafAt=directAt+payload.direct.length*74;
  plan.artifactId.copy(d,128);plan.artifactSHA.copy(d,160);d.writeUInt32LE(bytes.length,192);d.writeUInt32LE(20,196);d.writeUInt32LE(graphLength,200);d.writeUInt32LE(leafAt,204);d[208]=payload.leaves.length;d[209]=payload.direct.length;d[210]=0;d[211]=6;
  sha256(bytes.subarray(directAt,leafAt)).copy(d,212);sha256(encodeLeafMap(payload.leaves)).copy(d,244);cell.data.subarray(575,607).copy(d,276);
  d.writeBigUInt64LE(BigInt(payload.leaves.length)*120000n,308);d.writeBigUInt64LE(BigInt(payload.leaves.length)*45000n,316);cell.data.subarray(727,759).copy(d,332);
  d[374]=2;d[375]=target;d.writeUInt32LE(cell.data.readUInt32LE(607),376);d.writeUInt16LE(73,388);plan.graphSHA.copy(d,398);d.subarray(212,244).copy(d,526);cell.data.subarray(623,655).copy(d,928);d.writeUInt32LE(cell.data.readUInt32LE(284),1564);d[1568]=target===22?1:0;d.writeBigUInt64LE(target===22?cell.data.readBigUInt64LE(719):0n,1569);
  map.set(verificationAddress,{...old,data:d});let slot=100n,reads=0;const calls=[];
  const rpc=new ReadOnlyRpc({release,endpoint:'https://synthesis-final-recorded.invalid',fetchImpl:async(u,o)=>{
    const req=parseJsonWithBigInts(o.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts'){
      assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[0].length<=100);onRead?.({map,reads:++reads,addresses:req.params[0]});
      result={context:{slot:++slot},value:req.params[0].map(a=>wire(map.get(a)??null))};
    }else assert.fail(`non-read method ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  }});
  const verification=await decodeNativeSynthesisVerification(release,map.get(verificationAddress),{actor,artifactId:plan.artifactId,artifactSHA:plan.artifactSHA,contextSlot:1n});
  return {map,calls,plan,verification,rpc,verificationAddress,args:{release,abi,rpc,actor,plan,verification,maxRent:1000000000n,maxFee:100000000n}};
}
const read=f=>planActualSynthesisFinalization(f.args);
async function fundHost(f,extra){
  const sourceAddress=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(release.pdas.labMint.address))).address,source=f.map.get(sourceAddress),reserve=f.map.get(release.pdas.labReserve.address),treasury=f.map.get(await pda('treasury'));
  source.data.writeBigUInt64LE(source.data.readBigUInt64LE(64)+extra,64);reserve.data.writeBigUInt64LE(reserve.data.readBigUInt64LE(64)-extra,64);treasury.data.writeBigUInt64LE(treasury.data.readBigUInt64LE(120)-extra,120);
}
test('HOST-only restored CELL from genuine76b capsules plans exact fee and all actual final dependencies with no writes',async()=>{
  const f=await fixture(),out=await read(f);assert.equal(out.decision,'ACTION');assert.equal(out.action.operation,'SYNTH_FINALIZE');assert.equal(out.preview.feeAtoms,800000n);assert.equal(out.preview.availableLABAtoms,1024940n);
  assert.equal(out.action.payload.length,124);assert.equal(out.businessExecutionVerified,false);assert.equal(out.reservesOnChainNonce,false);assert.equal(out.requiresSimulation,true);
  const frame=decodeNativeFrame(abi,out.action.frame);assert.equal(frame.nonce,out.nextNonce);assert.equal(out.action.dynamicAccounts.length,11);
  assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts'].includes(c.method)));
});
test('actual LAB shortage and signed fee cap block FINAL without using unclaimed rewards',async()=>{
  const f=await fixture();f.args.maxFee=799999n;assert.equal((await read(f)).decision,'FEE_CAP_INSUFFICIENT');
  const source=(await fixture());const mint=release.pdas.labMint.address,ata=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address;
  source.map.get(ata).data.writeBigUInt64LE(0n,64);const out=await read(source);assert.equal(out.decision,'LAB_BALANCE_INSUFFICIENT');assert.equal(out.availableLABAtoms,0n);assert.equal(out.action,undefined);
});
test('HOST-only consumed inputs, open intervals and incomplete coverage block rather than manufacturing new parents',async()=>{
  const f=await fixture(),id=f.plan.payload.direct[0].instance,address=await pda('root',id);f.map.get(address).data[362]=1;
  // An actual consumed record retains its matching canonical consume fields.
  f.map.set(address,{...actual.get(address),data:Buffer.from(actual.get(address).data)});
  assert.equal((await read(f)).decision,'INPUTS_NOT_MOVABLE');
  for(const mutate of [b=>{b[80]=0;b.writeBigUInt64LE(0n,81);},b=>{b[129]=0;b.writeBigUInt64LE(0n,130);b.writeBigUInt64LE(1n,89);b[97]=1;},b=>{b.writeBigUInt64LE(0n,138);b.writeBigUInt64LE(0n,146);}]){
    const x=await fixture(),reg=await pda('root-reg',x.plan.payload.direct[0].instance);mutate(x.map.get(reg).data.subarray(120));
    const out=await read(x);assert.equal(out.decision,'INPUTS_NOT_MOVABLE');assert.equal(out.action,undefined);
  }
});
test('HOST-only nonce, V4 or current Task mutation during the final closure reread returns REPLAN',async()=>{
  for(const kind of ['nonce','V4','task']){
    const f=await fixture({onRead:({map,reads})=>{if(reads!==4)return;
      const account=kind==='nonce'?[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length>=120&&a.data.readUInt16LE(10)===35):kind==='V4'?[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===4096):[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===255&&a.data.readUInt16LE(10)===30);
      if(kind==='nonce')account.data.writeBigUInt64LE(account.data.readBigUInt64LE(120)+1n,120);else if(kind==='V4')account.data[928]^=1;else account.data.writeBigUInt64LE(account.data.readBigUInt64LE(156)+1n,156);
    }});const out=await read(f);assert.equal(out.decision,'REPLAN_STALE_STATE');assert.equal(out.action,undefined);
  }
});
test('HOST-only malformed records, unknown fields, retired payload changes and past clock fail closed',async()=>{
  const a=await fixture();await assert.rejects(planActualSynthesisFinalization({...a.args,callerPASS:true}),/FIELDS/);
  const b=await fixture();b.map.get(b.verificationAddress).data.writeBigUInt64LE(0n,316);await assert.rejects(read(b),/VERIFIED_PAYLOAD/);
  const c=await fixture();c.map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(0n,32);await assert.rejects(read(c),/CLOCK/);
  const d=await fixture();d.map.get(release.pdas.labMint.address).data[44]=0;await assert.rejects(read(d),/TOKEN_DECIMALS/);
});
test('HOST-only q2 BIO still reads Knowledge and KSlot in ordinary mode, and blocks insufficient real LAB',async()=>{
  const f=await fixture({target:22}),out=await read(f);assert.equal(out.decision,'LAB_BALANCE_INSUFFICIENT');
  const slot=await pda('k-slot',FAMILY),task=await pda('task',FAMILY),count=f.map.get(task).data.readBigUInt64LE(164),knowledge=await pda('knowledge',FAMILY,le(count));
  assert.ok(f.calls.some(c=>c.params?.[0]?.includes?.(slot)));assert.ok(f.calls.some(c=>c.params?.[0]?.includes?.(knowledge)));
});

// Synthetic K closure adds canonical header-bound records to genuine current
// account bytes. It exercises read dependencies, not a winning model or any
// newly executed native K interval. No economic rule is changed by the planner.
async function attachHostK(f,{count=1n,ended=false}={}){
  const oldRoot=[...f.map.values()].find(a=>a.owner===release.input.programId&&a.data.length===761&&a.data.readUInt16LE(10)===12&&a.data.readUInt16LE(12)===4),instance=Buffer.from(oldRoot.data.subarray(120,152)),regAddress=await pda('root-reg',instance),reg=f.map.get(regAddress),body=reg.data.subarray(120),positionAddress=await pda('reg',instance,le(0n)),position=f.map.get(positionAddress),pid=Buffer.from(position.data.subarray(88,120)),start=position.data.readBigUInt64LE(269),winner=sha256(Buffer.from('HOST-ONLY K final read closure winner'));
  const id=typedHash(11,Buffer.concat([release.domain,FAMILY,winner,le(0n)])),activation=Buffer.alloc(251),task=f.map.get(await pda('task',FAMILY)),generation=task.data.readBigUInt64LE(229);
  FAMILY.copy(activation);winner.copy(activation,32);instance.copy(activation,64);nativeKeyBytes(actor).copy(activation,96);pid.copy(activation,128);activation.writeBigUInt64LE(generation,160);activation.writeBigUInt64LE(start,184);activation.writeBigUInt64LE(1n,202);activation.writeBigUInt64LE(oldRoot.data.readBigUInt64LE(314),210);activation.writeBigInt64LE(oldRoot.data.readBigInt64LE(306),218);
  if(ended){activation[192]=1;activation.writeBigUInt64LE(start+1n,193);activation[201]=2;activation[226]=1;activation.writeBigUInt64LE(2n,227);activation.writeBigUInt64LE(oldRoot.data.readBigUInt64LE(314),235);activation.writeBigInt64LE(oldRoot.data.readBigInt64LE(306),243);}
  const record=await recordAccount(release,{kind:17,seeds:['bio','activation',id],id,body:activation});f.map.set(record.address,record);
  body.writeBigUInt64LE(count,40);typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(27).finish(),instance,le(count-1n)])).copy(body,48);body.writeBigUInt64LE(1n,89);id.copy(body,97);body[129]=ended?1:0;body.writeBigUInt64LE(ended?start+1n:0n,130);
  const slotBody=Buffer.alloc(74);FAMILY.copy(slotBody);slotBody.writeBigUInt64LE(generation,32);slotBody[40]=1;id.copy(slotBody,41);slotBody[73]=ended?2:1;const slot=await recordAccount(release,{kind:34,seeds:['bio','k-slot',FAMILY],id:FAMILY,body:slotBody});f.map.set(slot.address,slot);
  // HOST-only funded book transfer preserves Classic total supply and the
  // exact Treasury/reserve inequalities. It is not a real reward payment.
  await fundHost(f,12000000n);
  return {id,instance,pid,count,record,reg,position};
}
test('HOST-only actual-shaped prior K closure resolves original Position, even ordinary synthesis must include it',async()=>{
  const f=await fixture({target:22}),k=await attachHostK(f),out=await read(f);assert.equal(out.decision,'ACTION');assert.equal(out.preview.priorActivationIdHex,k.id.toString('hex'));assert.equal(out.preview.priorPositionSequence,0n);assert.equal(out.preview.stopsPriorK,false);assert.equal(out.preview.feeAtoms,12000000n);
  for(const address of [k.record.address,k.reg.address,k.position.address])assert.ok(out.action.dynamicAccounts.some(a=>a.address===address));
  const bad=await fixture({target:22}),old=await attachHostK(bad);old.reg.data[120+97]^=1;await assert.rejects(read(bad),/SYN_FINAL_K_LINKAGE/);
});
test('HOST-only deep prior Position lookup uses bounded ID hashing, resumable bound context, and resets stale cursor',async()=>{
  const f=await fixture({target:22}),k=await attachHostK(f,{count:300n,ended:true}),first=await read(f);
  assert.equal(first.decision,'K_POSITION_LOOKUP_REQUIRED');assert.equal(first.lookup.nextStart,'44');assert.equal(first.lookup.ordinaryCount,'300');assert.equal(first.action,undefined);
  const context={activationIdHex:first.lookup.activationIdHex,rootInstanceHex:first.lookup.rootInstanceHex,positionIdHex:first.lookup.positionIdHex,ordinaryCount:first.lookup.ordinaryCount};
  const next=await planActualSynthesisFinalization({...f.args,positionLookupStart:44n,positionLookupContext:context});assert.equal(next.decision,'ACTION');assert.equal(next.preview.priorPositionSequence,0n);
  const wrong=await planActualSynthesisFinalization({...f.args,positionLookupStart:1n,positionLookupContext:{...context,ordinaryCount:'301'}});assert.equal(wrong.decision,'K_POSITION_LOOKUP_REQUIRED');assert.equal(wrong.lookup.nextStart,'44');
  assert.ok(f.calls.every(c=>c.method!=='getMultipleAccounts'||c.params[0].length<=100));
});
test('HOST-only account adapters preserve distinct six ORGAN fees and ordinary BIO Knowledge obligations',async()=>{
  const expected=[3200000n,4800000n,6400000n,3200000n,3200000n,3200000n,12000000n];
  for(let i=0;i<expected.length;i++){
    const f=await fixture({target:16+i});await fundHost(f,12000000n);const out=await read(f);assert.equal(out.decision,'ACTION');assert.equal(out.preview.feeAtoms,expected[i]);
    assert.equal(out.action.dynamicAccounts.length,f.plan.payload.direct.length*2+(i===6?5:3));
  }
});
test('HOST-only improved account-reported cost plans prior-K stop event and refuses an occupied event PDA',async()=>{
  // Only the trusted-account read closure is exercised: changing a host V4
  // cost is not a newly validated C315 design or evidence of real eligibility.
  const f=await fixture({target:22});await attachHostK(f);f.map.get(f.verificationAddress).data.writeBigUInt64LE(315n,1569);
  const out=await read(f);assert.equal(out.decision,'ACTION');assert.equal(out.preview.stopsPriorK,true);
  const registry=f.map.get(await pda('mining')),event=await pda('mining-event',le(registry.data.readBigUInt64LE(160)));
  assert.ok(out.action.dynamicAccounts.some(a=>a.address===event));
  f.map.set(event,{address:event,owner:PROGRAMS.tokenProgram,executable:false,lamports:1n,rentEpoch:0n,data:Buffer.alloc(0)});
  await assert.rejects(read(f),/SYN_FINAL_K_STOP_EVENT/);
});
