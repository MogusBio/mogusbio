import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {asBytes,sha256,decodeDebitPlan,F1_EFFECTIVE_SPECIES,ByteWriter,typedHash} from '../../protocol-core/src/index.mjs';
import {decodeGraph,encodeGraph,members} from '../../biology/src/graph.mjs';
import {decodeSynthesisPayload,encodeLeafMap,validateSourceUnion} from '../../composition/src/payload.mjs';
import {validateProductionRelease,baseConfigR2Id,PROGRAMS} from '../src/release.mjs';
import {loadNativeAbi,nativeKeyAddress,nativeKeyBytes,nativePda,decodeNativeFrame} from '../src/native.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
import {planSynthesisPayload} from '../src/synthesis-workflow.mjs';
import {recordAccount} from './account-fixture.mjs';

const saved=p=>readFile(new URL(`../../../${p}`,import.meta.url));
export const release=await validateProductionRelease(JSON.parse(await saved('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
export const abi=loadNativeAbi(await saved('programs/biolab-economy/operations.p0r2.json'),{expectedHash:release.input.abiHash});
export const actor=release.input.bootstrap,resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
export const FAMILY=Buffer.from('a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe','hex');
export const pda=(...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
export const le=n=>new ByteWriter(8).u64(n).finish();
const rawLedger=await saved('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b1687.bin');
assert.equal(sha256(rawLedger).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');assert.deepEqual(rawLedger.subarray(8,40),baseConfigR2Id(release));
export const checkpoint=new Map();let at=108;
for(let i=0;i<rawLedger.readUInt32LE(104);i++){
  const address=nativeKeyAddress(rawLedger.subarray(at,at+32)),lamports=rawLedger.readBigUInt64LE(at+32),owner=nativeKeyAddress(rawLedger.subarray(at+40,at+72)),executable=rawLedger[at+72]===1,rentEpoch=rawLedger.readBigUInt64LE(at+73),length=rawLedger.readUInt32LE(at+81);at+=85;
  checkpoint.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(rawLedger.subarray(at,at+length))});at+=length;
}
assert.equal(at,rawLedger.length);
export const cloneAccounts=map=>new Map([...map].map(([a,v])=>[a,v===null?null:{...v,data:Buffer.from(v.data)}]));
export const accountRows=rows=>new Map(rows.map(row=>[row.address,row.missing?null:{...row,data:Buffer.from(row.data[0],'base64')}]));
const wire=v=>v===null?null:{owner:v.owner,executable:v.executable,lamports:v.lamports,rentEpoch:v.rentEpoch,data:[v.data.toString('base64'),'base64']};

/** Explicit offline transport only. Actual case maps are strict; host fixture
 * unknown canonical addresses are absent in the known checkpoint namespace. */
export function recordedTransport(maps,initial,{onRead,strict=true}={}){
  let current=initial,slot=100000n,reads=0;const calls=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:1/');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(req.method==='getLatestBlockhash')result={context:{slot:++slot},value:{blockhash:nativeKeyAddress(sha256(Buffer.from('synthesis unsigned local fixture lifetime'))),lastValidBlockHeight:999999n}};
    else if(req.method==='getMultipleAccounts'){
      assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[0].length<=100);assert.ok(req.params[1].minContextSlot<=slot);
      onRead?.({map:maps[current],maps,current,reads:++reads,addresses:req.params[0]});
      result={context:{slot:++slot},value:req.params[0].map(address=>{
        if(strict)assert.ok(maps[current].has(address),`unrecorded synthesis ${current} account ${address}`);
        return wire(maps[current].get(address)??null);
      })};
    }else assert.fail(`unexpected synthesis method ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  };
  return {maps,calls,fetchImpl,setPhase:value=>current=value,get phase(){return current;},rpc:new ReadOnlyRpc({release,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl})};
}
const roots=[...checkpoint.values()].filter(a=>a.owner===release.input.programId&&a.data.length>=443&&a.data.readUInt16LE(10)===12);
export async function hostSynthesisFixture({target=1,freshArtifact=true,onRead}={}){
  const map=cloneAccounts(checkpoint),output=roots.find(a=>a.data.readUInt16LE(12)===(target<=15?2:target<=21?3:4)&&a.data[280]===target);
  assert.ok(output,`actual target ${target}`);const originalArtifact=map.get(await pda('artifact',output.data.subarray(443,475))),originalBody=Buffer.from(originalArtifact.data.subarray(251)),payload=decodeSynthesisPayload(originalBody),directInputs=[];
  for(const d of payload.direct){
    const address=await pda('root',d.instance),account=map.get(address);account.data[362]=0;account.data.fill(0,363,443);account.data.writeBigUInt64LE(d.expectedRevision+(freshArtifact?1n:0n),354);
    directInputs.push({instance:Buffer.from(d.instance),account,rootReg:map.get(await pda('root-reg',d.instance))??null,...(account.data.readUInt16LE(12)>1?{originalArtifact:map.get(await pda('artifact',account.data.subarray(443,475)))}:{})});
  }
  const plan=await planSynthesisPayload({release,actor,graph:payload.graph,directInputs}),transport=recordedTransport({host:map},'host',{onRead,strict:false});
  return {...transport,map,plan,directInputs,graph:plan.payload.graph,directIds:plan.payload.direct.map(d=>Buffer.from(d.instance)),target,output:map.get(output.address),originalOutput:output,
    args:{release,abi,rpc:transport.rpc,actor,graph:plan.payload.graph,directIds:plan.payload.direct.map(d=>Buffer.from(d.instance)),challengePpm:output.data.readUInt32LE(607),maxRent:1000000000n,maxUploadRent:1000000000n,maxFee:100000000n,resources}};
}
export async function hostArtifact(f,{written=f.plan.bytes.length,sequence=BigInt(Math.ceil(written/1024)),sealed=false}={}){
  const p=f.plan,body=Buffer.alloc(131+written);p.artifactId.copy(body);nativeKeyBytes(actor).copy(body,32);body.writeUInt16LE(702,64);body.writeUInt32LE(p.bytes.length,66);p.artifactSHA.copy(body,70);body.writeUInt32LE(written,102);body.writeBigUInt64LE(sequence,106);body[114]=Number(sealed);
  if(sealed){const clock=f.map.get(PROGRAMS.clockSysvar).data;body.writeBigInt64LE(clock.readBigInt64LE(32),115);body.writeBigUInt64LE(clock.readBigUInt64LE(0),123);}
  p.bytes.subarray(0,written).copy(body,131);const info=await recordAccount(release,{kind:24,seeds:['bio','artifact',p.artifactId],id:p.artifactId,body});f.map.set(info.address,info);return info;
}
export function unionSHA(plan){
  const leaves=plan.payload.capsules.map(c=>{const rows=decodeDebitPlan(c.subarray(322)).flatMap(g=>g.entries.map(e=>({sourceId:g.sourceId,species:e.species,lo:e.expectedPrefix,hi:e.expectedPrefix+e.takeTick})));return {effective:rows.filter(r=>F1_EFFECTIVE_SPECIES.includes(r.species)),retired:rows.filter(r=>!F1_EFFECTIVE_SPECIES.includes(r.species))};});
  return validateSourceUnion(leaves).effectiveUnionSHA;
}
export async function hostVerification(f,{phase=5,round=72,used=false,generation,quality=0,task=false,cost=0n,seq=12,progress=0}={}){
  const p=f.plan,address=await pda('verify',nativeKeyBytes(actor)),old=f.map.get(address),d=Buffer.from(old.data),graphLength=p.bytes.readUInt32LE(16),directAt=21+graphLength,leafAt=directAt+74*p.payload.direct.length;
  p.artifactId.copy(d,128);p.artifactSHA.copy(d,160);d.writeUInt32LE(p.bytes.length,192);d.writeUInt32LE(20,196);d.writeUInt32LE(graphLength,200);d.writeUInt32LE(leafAt,204);d[208]=p.payload.leaves.length;d[209]=p.payload.direct.length;d[210]=Number(used);d[211]=phase;
  sha256(p.bytes.subarray(directAt,leafAt)).copy(d,212);sha256(encodeLeafMap(p.payload.leaves)).copy(d,244);unionSHA(p).copy(d,276);d.writeBigUInt64LE(BigInt(p.payload.leaves.length)*120000n,308);d.writeBigUInt64LE(BigInt(p.payload.leaves.length)*45000n,316);d.writeUInt16LE(seq,324);d.writeUInt16LE(progress,326);
  f.originalOutput.data.subarray(727,759).copy(d,332);d[374]=round===73?2:1;d[375]=p.target;d.writeUInt32LE(f.args.challengePpm,376);d.writeBigUInt64LE(generation??d.readBigUInt64LE(380)+1n,380);d.writeUInt16LE(round,388);d.writeBigInt64LE(f.map.get(PROGRAMS.clockSysvar).data.readBigInt64LE(32),390);p.graphSHA.copy(d,398);d.subarray(212,244).copy(d,526);
  (round===73?f.originalOutput.data.subarray(623,655):Buffer.alloc(32,9)).copy(d,928);d.writeUInt32LE(quality,1564);d[1568]=Number(task);d.writeBigUInt64LE(cost,1569);
  const info={...old,data:d};f.map.set(address,info);return info;
}
export async function actualSynthesisFixture(target,{onRead}={}){
  const bank=parseJsonWithBigInts((await saved(`programs/transaction-transport/evidence/synthesis-result-bank-76b35cfb-target-${target}.json`)).toString());
  assert.equal(bank.schema,'BIO-BANK-SYNTHESIS-RESULT-CASE-1');assert.equal(bank.abiSHA256,abi.hash);assert.equal(bank.elfSHA256,'76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e');assert.equal(bank.actor,actor);
  const frame=Buffer.from(bank.frameHex,'hex'),decoded=decodeNativeFrame(abi,frame),body=Buffer.from(bank.artifactBodyHex,'hex'),payload=decodeSynthesisPayload(body),before=accountRows(bank.beforeAccounts),after=accountRows(bank.afterAccounts);
  assert.equal(payload.graph.target,target);assert.equal(decoded.operation,'SYNTH_FINALIZE');assert.equal(decoded.payload.length,124);
  const transport=recordedTransport({before,after},'before',{onRead,strict:true}),args={release,abi,rpc:transport.rpc,actor,graph:payload.graph,directIds:payload.direct.map(d=>Buffer.from(d.instance)),challengePpm:before.get(await pda('verify',nativeKeyBytes(actor))).data.readUInt32LE(376),maxRent:decoded.payload.readBigUInt64LE(116),maxUploadRent:decoded.payload.readBigUInt64LE(116),maxFee:decoded.payload.readBigUInt64LE(108),resources};
  return {...transport,bank,frame,decoded,body,payload,target,args};
}
/** Synthetic K dependency closure only, never a new actual winner/reward. */
export async function attachHostK(f,{count=300n,ended=true}={}){
  const oldRoot=[...f.map.values()].find(a=>a?.owner===release.input.programId&&a.data.length===761&&a.data.readUInt16LE(10)===12&&a.data.readUInt16LE(12)===4),instance=Buffer.from(oldRoot.data.subarray(120,152)),reg=f.map.get(await pda('root-reg',instance)),b=reg.data.subarray(120),position=f.map.get(await pda('reg',instance,le(0n))),pid=Buffer.from(position.data.subarray(88,120)),start=position.data.readBigUInt64LE(269),winner=sha256(Buffer.from('HOST-ONLY guided K lookup'));
  const id=typedHash(11,Buffer.concat([release.domain,FAMILY,winner,le(0n)])),body=Buffer.alloc(251),task=f.map.get(await pda('task',FAMILY)),generation=task.data.readBigUInt64LE(229);
  FAMILY.copy(body);winner.copy(body,32);instance.copy(body,64);nativeKeyBytes(actor).copy(body,96);pid.copy(body,128);body.writeBigUInt64LE(generation,160);body.writeBigUInt64LE(start,184);body.writeBigUInt64LE(1n,202);body.writeBigUInt64LE(oldRoot.data.readBigUInt64LE(314),210);body.writeBigInt64LE(oldRoot.data.readBigInt64LE(306),218);
  if(ended){body[192]=1;body.writeBigUInt64LE(start+1n,193);body[201]=2;body[226]=1;body.writeBigUInt64LE(2n,227);body.writeBigUInt64LE(oldRoot.data.readBigUInt64LE(314),235);body.writeBigInt64LE(oldRoot.data.readBigInt64LE(306),243);}
  const activation=await recordAccount(release,{kind:17,seeds:['bio','activation',id],id,body});f.map.set(activation.address,activation);
  b.writeBigUInt64LE(count,40);typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(27).finish(),instance,le(count-1n)])).copy(b,48);b.writeBigUInt64LE(1n,89);id.copy(b,97);b[129]=ended?1:0;b.writeBigUInt64LE(ended?start+1n:0n,130);
  const slotBody=Buffer.alloc(74);FAMILY.copy(slotBody);slotBody.writeBigUInt64LE(generation,32);slotBody[40]=1;id.copy(slotBody,41);slotBody[73]=ended?2:1;
  const slot=await recordAccount(release,{kind:34,seeds:['bio','k-slot',FAMILY],id:FAMILY,body:slotBody});f.map.set(slot.address,slot);
  const ata=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(release.pdas.labMint.address))).address,source=f.map.get(ata),reserve=f.map.get(release.pdas.labReserve.address),treasury=f.map.get(await pda('treasury')),extra=12000000n;
  source.data.writeBigUInt64LE(source.data.readBigUInt64LE(64)+extra,64);reserve.data.writeBigUInt64LE(reserve.data.readBigUInt64LE(64)-extra,64);treasury.data.writeBigUInt64LE(treasury.data.readBigUInt64LE(120)-extra,120);
  return {id,instance,pid,activation,reg,position};
}
