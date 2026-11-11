import { baseConfigR2Id } from './release.mjs';
import { NativePlayerSession } from './session.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda,encodeNativeFrame,decodeNativeFrame,nativeRequestHash,encodeSyncEmissionPayload } from './native.mjs';
const MAX=(1n<<64n)-1n;
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};

function context({release,abi,actor,primarySession,cancellationSession,nonce}){
  check(typeof nonce==='bigint'&&nonce>=0n&&nonce<MAX,'RECOVERY_NONCE');
  check(primarySession instanceof NativePlayerSession&&cancellationSession instanceof NativePlayerSession,'RECOVERY_SESSIONS');
  const expected={actor:nativeKeyAddress(actor),abiHash:abi.hash,domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex'),releaseHash:release.input.releaseHash};
  check(abi.hash===release.hashes.abiHash.toString('hex')&&[primarySession,cancellationSession].every(s=>Object.entries(expected).every(([k,v])=>s.recoveryIdentity[k]===v)),'RECOVERY_IDENTITY');
  check(primarySession.distinctStore(cancellationSession),'RECOVERY_SEPARATE_STORE_REQUIRED');
  return expected;
}
function original(abi,request,nonce){
  const frame=decodeNativeFrame(abi,request.frameBytes);check(frame.nonce===nonce&&frame.operation!=='INIT','RECOVERY_ORIGINAL_REQUEST');return frame;
}
async function maybeRequest(session,nonce){
  try{return await session.getRequest(nonce);}catch(e){if(['JOURNAL_NOT_FOUND','JOURNAL_ARCHIVE_NOT_FOUND'].includes(e.code))return null;throw e;}
}
function cancellation(abi,request,primary,nonce){
  const frame=decodeNativeFrame(abi,request.frameBytes);
  check(frame.nonce===nonce&&frame.operation==='SYNC_EMISSION'&&request.digestHex!==primary.digestHex,'RECOVERY_CANCELLATION_FRAME');
}

/** Explicitly prepare a separately signed competing SYNC at the same nonce.
 * No transaction is sent or withdrawn. Native nonce authority permits at most
 * one frame to execute; both original bytes and durable histories survive. */
export async function prepareNativeCancellation(args){
  const {release,abi,actor,primarySession,cancellationSession,nonce,maxRent,resources}=args;context(args);
  const request=await primarySession.getRequest(nonce);original(abi,request,nonce);
  const payload=encodeSyncEmissionPayload({maxRent}),frame=encodeNativeFrame(abi,{operation:'SYNC_EMISSION',domain:release.domain,
    configId:baseConfigR2Id(release),actor:nativeKeyBytes(actor),nonce,payload}),digest=nativeRequestHash(abi,frame).toString('hex');
  check(digest!==request.digestHex,'RECOVERY_IDENTICAL_REQUEST');
  const existing=await maybeRequest(cancellationSession,nonce);
  if(existing)check(existing.frameBytes.equals(frame),'RECOVERY_EXISTING_CANCELLATION_CHANGED');
  const outcome=await primarySession.reconcile(nonce);check(outcome.decision==='RETRY_SAME_FRAME','RECOVERY_NONCE_NOT_FREE');
  const suffix=[];for(const [name,seed]of Object.entries({LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'}))
    suffix.push({name,address:(await nativePda(release.input.programId,'bio',seed)).address});
  const envelope=await cancellationSession.prepare({operation:'SYNC_EMISSION',nonce,payload,suffix,resources});
  check(envelope.frameHex===frame.toString('hex'),'RECOVERY_PREPARED_FRAME');
  return {decision:'CANCELLATION_PREPARED',envelope,primaryRequestHash:request.digestHex,cancellationRequestHash:digest,nonce,
    requiresSeparateSignature:true,businessExecutionVerified:false,networkSubmitted:false};
}

/** Reconcile both competing frames. Nonce merely being past n cannot prove
 * which ran after the latest cache was overwritten. Durable known outcomes
 * remain valid, while unobserved older outcomes explicitly stay unknown. */
export async function reconcileNativeCancellation(args){
  const {abi,primarySession,cancellationSession,nonce}=args;context(args);
  const request=await primarySession.getRequest(nonce);original(abi,request,nonce);
  const competing=await maybeRequest(cancellationSession,nonce);if(competing)cancellation(abi,competing,request,nonce);
  let primary=await primarySession.reconcile(nonce),cancel=competing===null?null:await cancellationSession.reconcile(nonce);
  if(['CONFIRMED','NONCE_CONFLICT','ALREADY_PROCESSED'].includes(cancel?.decision)&&primary.decision==='RETRY_SAME_FRAME')primary=await primarySession.reconcile(nonce);
  if(primary.decision==='CONFIRMED'&&cancel?.decision==='RETRY_SAME_FRAME')cancel=await cancellationSession.reconcile(nonce);
  const p=primary.decision==='CONFIRMED',c=cancel?.decision==='CONFIRMED';
  check(!(p&&c),'RECOVERY_CONTRADICTORY_FINALITY');
  const unknown=primary.decision==='ALREADY_PROCESSED'||cancel?.decision==='ALREADY_PROCESSED'
    ||primary.decision==='NONCE_CONFLICT'&&cancel?.decision!=='CONFIRMED'
    ||cancel?.decision==='NONCE_CONFLICT'&&primary.decision!=='CONFIRMED';
  return {decision:p?'ORIGINAL_CONFIRMED':c?'CANCEL_CONFIRMED':unknown?'UNKNOWN':'CANCELLATION_PENDING',primary,cancellation:cancel,
    nonce,originalExecutionVerified:p,cancellationExecutionVerified:c===true,
    originalExecutionState:p?'EXECUTED':c||primary.decision==='NONCE_CONFLICT'?'NOT_EXECUTED':'UNVERIFIED',
    cancellationExecutionState:c?'EXECUTED':p||cancel?.decision==='NONCE_CONFLICT'?'NOT_EXECUTED':'UNVERIFIED',networkSubmitted:false,
    reason:p?'ORIGINAL_FRAME_CONFIRMED':c?'COMPETING_SYNC_CONFIRMED':unknown?'NONCE_USED_WITHOUT_MATCHING_RETAINED_RESULT':
      competing===null?'CANCELLATION_NOT_PREPARED':'NEITHER_FRAME_CONFIRMED'};
}
