import { randomBytes } from 'node:crypto';
import { ByteWriter,businessKey,asBytes } from '../../protocol-core/src/index.mjs';
import { validateGraph,designId } from '../../biology/src/index.mjs';
import { commitmentHash,TASK_FAMILY,TASK_VERSION,ROUND_SECONDS,WINDOW_SECONDS } from '../../originality/src/wire.mjs';
import { baseConfigR2Id,publishedOpening } from './release.mjs';
import { nativeKeyBytes,nativeKeyAddress,nativeNonceOpId,nativePda,encodeNativeFrame,buildNativeInstruction } from './native.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const max=(1n<<64n)-1n;
const u64=v=>{check(typeof v==='bigint'&&v>=0n&&v<=max,'COMPETITION_U64');return v;};
export const createCompetitionSalt=()=>randomBytes(32);
export function localCompetitionWindow(release,now){
  check(typeof now==='bigint'&&now>=0n,'COMPETITION_TIME');
  if(now<release.rewardStart)return {phase:'PREWARM',round:null};
  const elapsed=now-release.rewardStart,round=elapsed/ROUND_SECONDS,offset=elapsed%ROUND_SECONDS;
  return {phase:offset<WINDOW_SECONDS?'COMMIT':offset<2n*WINDOW_SECONDS?'MANUFACTURE':'FINALIZE',round,
    phaseDeadline:release.rewardStart+round*ROUND_SECONDS+(offset<WINDOW_SECONDS?WINDOW_SECONDS:offset<2n*WINDOW_SECONDS?2n*WINDOW_SECONDS:ROUND_SECONDS),
    chainClockVerified:false};
}
/** Private/local design first, commitment transaction second, public upload
 * only after commitment is confirmed. The caller fixes its future actor nonce;
 * this function neither reserves nor silently changes that nonce. */
export async function planPrivateDesignCommit({release,abi,author,commitNonce,futureManufactureNonce,round,graph,salt,maxRent}){
  u64(commitNonce);u64(futureManufactureNonce);u64(round);u64(maxRent);
  check(futureManufactureNonce>commitNonce&&futureManufactureNonce<max,'COMPETITION_FUTURE_NONCE');
  validateGraph(graph,{domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash});
  check(graph.target===22,'COMPETITION_BIO_ONLY');
  const design=designId(graph),secret=asBytes(salt,32),authorBytes=nativeKeyBytes(author),manufactureOpId=nativeNonceOpId(futureManufactureNonce);
  const commitment=commitmentHash({domain:release.domain,round,author:authorBytes,design,manufactureOpId,salt:secret});
  const payload=new ByteWriter(116).raw(TASK_FAMILY).u32(TASK_VERSION).u64(round).raw(commitment).raw(authorBytes).u64(maxRent).finish();
  const frame=encodeNativeFrame(abi,{operation:'COMMIT',domain:release.domain,configId:baseConfigR2Id(release),actor:authorBytes,nonce:commitNonce,payload});
  const id=businessKey(release.domain,authorBytes,nativeNonceOpId(commitNonce)),program=release.input.programId;
  const n=new ByteWriter(8).u64(round).finish(),v=new ByteWriter(4).u32(TASK_VERSION).finish();
  const specs=[['Task',['bio','task',TASK_FAMILY]],['KSlot',['bio','k-slot',TASK_FAMILY]],['Snapshot',['bio','seed-final',TASK_FAMILY]],
    ['Round',['bio','round',TASK_FAMILY,v,n]],['Commit',['bio','commit',id]]];
  const suffix=await Promise.all(specs.map(async([name,seeds])=>({name,address:(await nativePda(program,...seeds)).address})));
  const instruction=await buildNativeInstruction({release,abi,frame,suffix});
  return {profile:'BIOCLIENT-PRIVATE-COMMIT1',author:nativeKeyAddress(author),round,commitNonce,futureManufactureNonce,
    commitId:id,design,commitment,payload,frame,instruction,suffix,
    knownOpeningDesign:publishedOpening(release.domain,{frontier:release.input.frontier}).rows.some(r=>r.design.equals(design)),
    eligibilityVerified:false,nonceReserved:false,
    requiredOrder:['LOCAL_DESIGN','CONFIRM_COMMIT','PUBLIC_UPLOAD_AND_VERIFY','ACTUAL_MANUFACTURE_IN_WINDOW','FINALIZE_ROUND'],
    // No salt or private graph is included in the public transaction result.
    requiresPrivateSaltRetention:true};
}
