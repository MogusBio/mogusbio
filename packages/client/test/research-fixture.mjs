import {sha256,typedHash,ByteWriter} from '../../protocol-core/src/index.mjs';
import {nativeKeyBytes,nativeNonceOpId,nativeRequestHash,encodeNativeFrame,encodeSynthFinalizePayload} from '../src/native.mjs';
import {PROGRAMS,baseConfigR2Id} from '../src/release.mjs';
import {planActualSynthesis} from '../src/synthesis-inputs.mjs';
import {createSynthesisManifest} from '../src/synthesis-manifest.mjs';
import {createResearchManifest} from '../src/research-manifest.mjs';
import {recordAccount} from './account-fixture.mjs';
import {key} from './native-fixture.mjs';
import {release,abi,actor,resources,pda,FAMILY,le,checkpoint,hostSynthesisFixture,actualSynthesisFixture} from './synthesis-fixture.mjs';

export const researchCranker=key(8),researchRequestId=sha256(Buffer.from('PUBLIC HOST research progress request')).toString('hex');
export async function setHostResearchAuthorNonce(f,n){f.map.get(await pda('actor-nonce',nativeKeyBytes(actor))).data.writeBigUInt64LE(n,120);}
export function setHostResearchClock(f,now){f.map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(now,32);}
/** HOST lifecycle restoration of genuine captured materials only. These
 * synthetic Commit/Round/nonce/Clock changes are never signed native evidence. */
export async function hostResearchFixture({onRead}={}){
  const f=await hostSynthesisFixture({target:22,onRead});f.map.set(researchCranker,{address:researchCranker,owner:PROGRAMS.systemProgram,executable:false,lamports:1000000000n,rentEpoch:0n,data:Buffer.alloc(0)});setHostResearchClock(f,release.rewardStart+5n*259200n+100n);
  return {...f,researchArgs:{release,abi,rpc:f.rpc,author:actor,cranker:researchCranker,graph:f.graph,directIds:f.directIds,maxRent:f.args.maxRent,maxUploadRent:f.args.maxUploadRent,maxFee:f.args.maxFee,resources,requestId:researchRequestId}};
}
export async function attachHostResearchCommit(f,m){
  const now=release.rewardStart+m.round*259200n+100n,slot=f.map.get(PROGRAMS.clockSysvar).data.readBigUInt64LE(0),task=f.map.get(await pda('task',FAMILY)).data,body=Buffer.alloc(207);
  FAMILY.copy(body);body.writeUInt32LE(1,32);body.writeBigUInt64LE(m.round,36);nativeKeyBytes(actor).copy(body,44);m.workflow.commit.commitment.copy(body,76);m.workflow.commit.commitId.copy(body,108);body.writeBigUInt64LE(task.readBigUInt64LE(156),140);body.writeBigUInt64LE(slot,148);body.writeBigInt64LE(now,156);
  const info=await recordAccount(release,{kind:31,seeds:['bio','commit',m.workflow.commit.commitId],id:m.workflow.commit.commitId,body});f.map.set(info.address,info);
  const rb=Buffer.alloc(389),count=task.readBigUInt64LE(164);FAMILY.copy(rb);rb.writeUInt32LE(1,32);rb.writeBigUInt64LE(m.round,36);rb.writeBigUInt64LE(count,85);rb.writeBigUInt64LE(count,93);rb.writeBigUInt64LE(1n,101);rb.writeBigUInt64LE(count,381);
  const rid=typedHash(9,Buffer.concat([release.domain,FAMILY,new ByteWriter(4).u32(1).finish(),le(m.round)])),round=await recordAccount(release,{kind:15,schema:2,seeds:['bio','round',FAMILY,Buffer.from([1,0,0,0]),le(m.round)],id:rid,body:rb});f.map.set(round.address,round);await setHostResearchAuthorNonce(f,m.commitNonce+1n);return info;
}
export async function enterHostResearchManufacture(f,m){await attachHostResearchCommit(f,m);setHostResearchClock(f,release.rewardStart+m.round*259200n+86400n+100n);}

/** HOST-only competition output: retain the genuine ordinary22 payload/root
 * mathematics and lifecycle, then explicitly reconstruct fake program records,
 * timestamps and a189 request binding. Never native candidate/receipt evidence. */
export async function hostResearchOutputFixture({store}){
  const f=await actualSynthesisFixture(22),crankNonce=await pda('actor-nonce',nativeKeyBytes(researchCranker)),openingAddress=await pda('seed-final',FAMILY);for(const map of Object.values(f.maps)){map.set(researchCranker,{address:researchCranker,owner:PROGRAMS.systemProgram,executable:false,lamports:1000000000n,rentEpoch:0n,data:Buffer.alloc(0)});map.set(crankNonce,null);if(!map.has(openingAddress)){const opening=checkpoint.get(openingAddress);map.set(openingAddress,{...opening,data:Buffer.from(opening.data)});}}
  const read=await planActualSynthesis({release,abi,rpc:f.rpc,actor,graph:f.args.graph,directIds:f.args.directIds,challengePpm:2000000}),baseManifest=await createSynthesisManifest({release,abi,actor,plan:read.plan,directInputs:read.directInputs,challengePpm:2000000,maxRent:f.args.maxRent,maxUploadRent:f.args.maxUploadRent,maxFee:f.args.maxFee,resources}),chunkCount=BigInt(Math.ceil(baseManifest.plan.bytes.length/1024)),futureNonce=f.decoded.nonce,expectedGeneration=f.maps.before.get(await pda('verify',nativeKeyBytes(actor))).data.readBigUInt64LE(380)-1n;
  const m=await createResearchManifest({release,abi,author:actor,cranker:researchCranker,baseManifest,commitNonce:futureNonce-chunkCount-3n,round:5n,salt:sha256(Buffer.from('PUBLIC HOST output salt only')),expectedGeneration,maxRent:f.args.maxRent,maxUploadRent:f.args.maxUploadRent,maxFee:f.args.maxFee,resources});await store.save(m);
  f.setPhase('after');f.map=f.maps.after;setHostResearchClock(f,release.rewardStart+m.round*259200n+86400n+100n);await attachHostResearchCommit(f,m);await setHostResearchAuthorNonce(f,futureNonce+1n);
  const instance=Buffer.from(f.bank.execution.returnDataHex,'hex').subarray(0,32),outputAddress=await pda('root',instance),root=f.map.get(outputAddress),now=f.map.get(PROGRAMS.clockSysvar).data.readBigInt64LE(32),slot=root.data.readBigUInt64LE(314),task=f.map.get(await pda('task',FAMILY)).data,event=task.readBigUInt64LE(156),index=task.readBigUInt64LE(164)-1n,commit=f.map.get(await pda('commit',m.workflow.commit.commitId));root.data.writeBigInt64LE(now,306);
  for(const d of m.baseManifest.plan.payload.direct)f.map.get(await pda('root',d.instance)).data.writeBigInt64LE(now,427);
  const payload=encodeSynthFinalizePayload({artifactId:baseManifest.plan.artifactId,artifactSHA:baseManifest.plan.artifactSHA,artifactLength:baseManifest.plan.bytes.length,expectedGeneration:expectedGeneration+1n,transcriptSHA:root.data.subarray(623,655),maxFee:m.maxFee,maxRent:m.maxRent,competition:{commitId:m.workflow.commit.commitId,salt:m.salt}}),frame=encodeNativeFrame(abi,{operation:'SYNTH_FINALIZE',domain:release.domain,configId:baseConfigR2Id(release),actor,nonce:futureNonce,payload});nativeRequestHash(abi,frame).copy(root.data,184);
  const rid=typedHash(9,Buffer.concat([release.domain,FAMILY,new ByteWriter(4).u32(1).finish(),le(m.round)])),candidateId=typedHash(18,Buffer.concat([release.domain,rid,m.workflow.commit.commitId,instance])),body=Buffer.alloc(348);FAMILY.copy(body);body.writeUInt32LE(1,32);body.writeBigUInt64LE(m.round,36);m.workflow.commit.commitId.copy(body,52);instance.copy(body,84);nativeKeyBytes(actor).copy(body,116);m.workflow.commit.design.copy(body,148);body.writeBigUInt64LE(root.data.readBigUInt64LE(719),180);typedHash(8,Buffer.concat([release.domain,m.workflow.commit.design])).copy(body,188);f.map.get(await pda('knowledge',FAMILY,le(index))).data.subarray(333,365).copy(body,220);nativeNonceOpId(futureNonce).copy(body,252);body.writeBigUInt64LE(event,284);body.writeBigUInt64LE(slot,292);body.writeBigInt64LE(now,300);root.data.subarray(152,184).copy(body,308);body.writeBigUInt64LE(index,340);
  const candidate=await recordAccount(release,{kind:32,seeds:['bio','candidate',rid,le(0n)],id:candidateId,body});f.map.set(candidate.address,candidate);commit.data.writeBigUInt64LE(event-1n,260);commit.data[284]=1;commit.data[285]=1;candidateId.copy(commit.data,286);commit.data[318]=1;const round=f.map.get(await pda('round',FAMILY,Buffer.from([1,0,0,0]),le(m.round)));round.data.writeBigUInt64LE(1n,229);
  return {...f,m,outputAddress,frame};
}
