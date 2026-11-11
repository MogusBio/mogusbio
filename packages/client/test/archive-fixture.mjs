import { encodeActorNonceBody, encodeRecord } from '../../protocol-core/src/index.mjs';
import { nativeRequestHash,nativePda,nativeKeyBytes } from '../src/native.mjs';
import { decodeActorNonceSnapshot } from '../src/journal.mjs';
import { baseConfigR2Id } from '../src/release.mjs';
export async function nonceProof(c,nextNonce,{frame,result=Buffer.alloc(8),slot=nextNonce+20n}={}){
  const pda=await nativePda(c.release.input.programId,'bio','actor-nonce',nativeKeyBytes(c.actor));
  const body=encodeActorNonceBody({nextNonce,lastDigest:nextNonce===0n?null:nativeRequestHash(c.abi,frame??c.frame('SYNC_EMISSION',Buffer.alloc(8),nextNonce-1n)),lastResult:nextNonce===0n?null:result});
  const data=encodeRecord({kind:35,schema:1,domain:c.release.domain,configId:baseConfigR2Id(c.release),recordKey:nativeKeyBytes(c.actor),bump:pda.bump,body});
  return decodeActorNonceSnapshot({release:c.release,actor:c.actor,address:pda.address,account:{owner:c.release.input.programId,executable:false,data},contextSlot:slot,commitment:'finalized'});
}
export async function confirm(c,j,nonce){const frame=c.frame('SYNC_EMISSION',Buffer.alloc(8),nonce),result=Buffer.alloc(8);result.writeBigUInt64LE(nonce+10n);j.begin(frame,{expectedRevision:j.revision,observedNextNonce:nonce});j.reconcile(nonce,await nonceProof(c,nonce+1n,{frame,result}),{expectedRevision:j.revision});return result;}
