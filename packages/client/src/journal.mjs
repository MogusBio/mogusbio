import { asBytes, decodeRecord, decodeActorNonceBody } from '../../protocol-core/src/index.mjs';
import { baseConfigR2Id, PROGRAMS } from './release.mjs';
import { decodeNativeFrame, nativeRequestHash, nativeBusinessKey, nativeKeyAddress, nativeKeyBytes, nativePda, validateNativeResult } from './native.mjs';
import { FileJournalStore } from './file-journal.mjs';

const U64_MAX=(1n<<64n)-1n, snapshots=new WeakSet();
const check=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code});};
const decimal=v=>{check(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v),'JOURNAL_DECIMAL');const n=BigInt(v);check(n<=U64_MAX,'JOURNAL_DECIMAL');return n;};
const u64=v=>{check(typeof v==='bigint'&&v>=0n&&v<=U64_MAX,'JOURNAL_U64');return v;};
const hex=(v,max)=>{check(typeof v==='string'&&v.length%2===0&&/^[0-9a-f]*$/.test(v)&&v.length/2<=max,'JOURNAL_HEX');return Buffer.from(v,'hex');};
const clone=v=>structuredClone(v);
const pending=new Set(['PREPARED','PENDING','UNKNOWN','RETRY_SAME_FRAME']);
const states=new Set([...pending,'CONFIRMED','NONCE_CONFLICT','ALREADY_PROCESSED']);
const executionFacts=state=>({businessExecutionVerified:state==='CONFIRMED',executionReason:state==='CONFIRMED'?'MATCHING_FINALIZED_FRAME_RESULT':state==='ALREADY_PROCESSED'?'NONCE_ADVANCED_RESULT_UNAVAILABLE_EXECUTION_UNKNOWN':state==='NONCE_CONFLICT'?'NONCE_USED_BY_DIFFERENT_FRAME':'BUSINESS_EXECUTION_NOT_CONFIRMED'});

/** Structural/canonical decoding of a finalized RPC response. This checks real
 * expected PDA/owner/header, but cannot prove an RPC honest or the right chain;
 * the transport must separately verify genesis and finalized context. */
export async function decodeActorNonceSnapshot({release,actor,address:requestedAddress,account,contextSlot,commitment}){
  check(commitment==='finalized','JOURNAL_FINALITY');u64(contextSlot);
  const actorAddress=nativeKeyAddress(actor), actorBytes=nativeKeyBytes(actor);
  const expected=await nativePda(release.input.programId,'bio','actor-nonce',actorBytes);
  check(requestedAddress===expected.address,'JOURNAL_NONCE_PDA');
  let decoded={nextNonce:0n,lastDigest:null,lastResult:null};
  if(account!==null){
    check(account&&account.executable===false,'JOURNAL_NONCE_OWNER');
    const data=asBytes(account.data);
    if(account.owner===PROGRAMS.systemProgram&&data.length===0){
      const out=Object.freeze({profile:'BIOP0R2-NONCE-SNAPSHOT1',domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex'),
        actor:actorAddress,address:expected.address,contextSlot,nextNonce:0n,lastDigestHex:null,lastResultHex:null});snapshots.add(out);return out;
    }
    check(account.owner===release.input.programId,'JOURNAL_NONCE_OWNER');check(data.length===418,'JOURNAL_NONCE_SIZE');
    const r=decodeRecord(data,298);
    check(r.kind===35&&r.schema===1&&r.bump===expected.bump&&r.domain.equals(release.domain)
      &&r.configId.equals(baseConfigR2Id(release))&&r.recordKey.equals(actorBytes),'JOURNAL_NONCE_HEADER');
    decoded=decodeActorNonceBody(r.body);
  }
  const out=Object.freeze({profile:'BIOP0R2-NONCE-SNAPSHOT1',domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex'),
    actor:actorAddress,address:expected.address,contextSlot,nextNonce:decoded.nextNonce,
    lastDigestHex:decoded.lastDigest?.toString('hex')??null,lastResultHex:decoded.lastResult?.toString('hex')??null});
  snapshots.add(out);return out;
}

/** Pure local journal. No transaction signature, RPC call or token operation is
 * performed. One object has revision CAS; cross-tab/process persistence must
 * also use the external atomic compareAndSwap contract below. */
export class PendingJournal{
  #abi;#release;#actor;#revision=0n;#entries=new Map();#global=null;
  constructor({abi,release,actor}){
    check(abi.hash===release.hashes.abiHash.toString('hex'),'JOURNAL_ABI');
    this.#abi=abi;this.#release=release;this.#actor=nativeKeyAddress(actor);
  }
  get revision(){return this.#revision;}
  #cas(expected){check(u64(expected)===this.#revision,'JOURNAL_CAS');check(this.#revision<U64_MAX,'JOURNAL_REVISION_EXHAUSTED');}
  #entry(nonce){const e=this.#entries.get(u64(nonce).toString());check(e,'JOURNAL_NOT_FOUND');return e;}
  #context(frame){check(frame.domain.equals(this.#release.domain)&&frame.configId.equals(baseConfigR2Id(this.#release))
    &&nativeKeyAddress(frame.actor)===this.#actor,'JOURNAL_FRAME_CONTEXT');}
  #commit(){this.#revision+=1n;}
  #validateObservation(observation){
    check(snapshots.has(observation),'JOURNAL_UNDECODED_OBSERVATION');
    check(observation.actor===this.#actor&&observation.domainHex===this.#release.domain.toString('hex')
      &&observation.configHex===baseConfigR2Id(this.#release).toString('hex'),'JOURNAL_OBSERVATION_CONTEXT');
    if(this.#global!==null){
      check(observation.contextSlot>=decimal(this.#global.contextSlot),'JOURNAL_STALE_CONTEXT');
      const prior=decimal(this.#global.nextNonce);check(observation.nextNonce>=prior,'JOURNAL_NONCE_REGRESSION');
      if(observation.contextSlot===decimal(this.#global.contextSlot))check(observation.nextNonce===prior,'JOURNAL_SAME_SLOT_NONCE_CHANGE');
      if(observation.nextNonce===prior)check(observation.lastDigestHex===this.#global.lastDigestHex
        &&observation.lastResultHex===this.#global.lastResultHex,'JOURNAL_NONCE_CACHE_REWRITE');
    }
    return {contextSlot:observation.contextSlot.toString(),nextNonce:observation.nextNonce.toString(),lastDigestHex:observation.lastDigestHex,lastResultHex:observation.lastResultHex};
  }
  observeFinalized(observation,{expectedRevision}){
    this.#cas(expectedRevision);check(![...this.#entries.values()].some(e=>pending.has(e.state)),'JOURNAL_PENDING_UNRESOLVED');
    const fact=this.#validateObservation(observation);this.#global=fact;this.#commit();return {decision:'OBSERVED_FINALIZED',nextNonce:observation.nextNonce,contextSlot:observation.contextSlot,revision:this.#revision};
  }
  #archiveContext(){return {abiHash:this.#abi.hash,domainHex:this.#release.domain.toString('hex'),configHex:baseConfigR2Id(this.#release).toString('hex'),actor:this.#actor};}
  exportTerminal(nonce){const e=this.#entry(nonce);check(!pending.has(e.state),'JOURNAL_ARCHIVE_NONTERMINAL');return {version:'BIOCLIENT-TERMINAL-EXPORT1',context:this.#archiveContext(),entry:clone(e)};}
  pruneArchived(receipts,{expectedRevision}){
    this.#cas(expectedRevision);check(Array.isArray(receipts)&&receipts.length>=1&&receipts.length<=1000,'JOURNAL_ARCHIVE_BATCH');const keys=[];
    for(const receipt of receipts){const n=decimal(receipt?.nonce),e=this.#entry(n);check(!pending.has(e.state)&&FileJournalStore.verifyArchiveReceipt(receipt,this.exportTerminal(n)),'JOURNAL_ARCHIVE_RECEIPT');keys.push(n.toString());}
    check(new Set(keys).size===keys.length,'JOURNAL_ARCHIVE_DUPLICATE');for(const key of keys)this.#entries.delete(key);this.#commit();return {pruned:keys.length,revision:this.#revision};
  }
  async getArchived(nonce,store){
    u64(nonce);check(typeof store?.readTerminal==='function','JOURNAL_ARCHIVE_STORE');const bundle=await store.readTerminal(this.#archiveContext(),nonce);check(bundle!==null,'JOURNAL_ARCHIVE_NOT_FOUND');
    check(bundle.version==='BIOCLIENT-TERMINAL-EXPORT1'&&bundle.context&&Object.keys(bundle.context).sort().join(',')==='abiHash,actor,configHex,domainHex'
      &&bundle.context.abiHash===this.#abi.hash&&bundle.context.domainHex===this.#archiveContext().domainHex&&bundle.context.configHex===this.#archiveContext().configHex&&bundle.context.actor===this.#actor
      &&bundle.entry.nonce===nonce.toString()&&!pending.has(bundle.entry.state),'JOURNAL_ARCHIVE_CONTEXT');
    const restored=PendingJournal.restore({abi:this.#abi,release:this.#release,actor:this.#actor},JSON.stringify({version:'BIOCLIENT-JOURNAL1',...this.#archiveContext(),revision:'0',globalObservation:bundle.entry.lastObservation,entries:[bundle.entry]}));
    return {...restored.get(nonce),resultSource:bundle.entry.state==='CONFIRMED'?'LOCAL_DURABLE_ARCHIVE':null};
  }
  begin(frameBytes,{expectedRevision,observedNextNonce}){
    this.#cas(expectedRevision);u64(observedNextNonce);
    const raw=asBytes(frameBytes),f=decodeNativeFrame(this.#abi,raw);this.#context(f);
    check(f.nonce<U64_MAX&&f.nonce===observedNextNonce,'JOURNAL_NONCE_GAP');
    const digest=nativeRequestHash(this.#abi,raw).toString('hex'),key=f.nonce.toString(),old=this.#entries.get(key);
    if(old){check(old.digestHex===digest&&old.frameHex===raw.toString('hex'),'JOURNAL_NONCE_CONFLICT');return this.get(f.nonce);}
    check(this.#entries.size<10000,'JOURNAL_ENTRY_LIMIT');
    check(![...this.#entries.values()].some(e=>pending.has(e.state)),'JOURNAL_PENDING_UNRESOLVED');
    if(this.#global!==null)check(observedNextNonce===decimal(this.#global.nextNonce),'JOURNAL_FRESH_NONCE_OBSERVATION_REQUIRED');
    this.#entries.set(key,{nonce:key,frameHex:raw.toString('hex'),digestHex:digest,businessHex:nativeBusinessKey(this.#abi,raw).toString('hex'),
      state:'PREPARED',attempts:[],resultHex:null,lastObservation:null,lastError:null});this.#commit();return this.get(f.nonce);
  }
  get(nonce){const e=this.#entry(nonce);return {...clone(e),...executionFacts(e.state),frameBytes:Buffer.from(e.frameHex,'hex'),digest:Buffer.from(e.digestHex,'hex'),
    resultBytes:e.resultHex===null?null:Buffer.from(e.resultHex,'hex')};}
  retryFrame(nonce){const e=this.#entry(nonce);check(pending.has(e.state),'JOURNAL_TERMINAL');return Buffer.from(e.frameHex,'hex');}
  recordAttempt(nonce,{expectedRevision,blockhash,lastValidBlockHeight,frameBytes,signature=null}){
    this.#cas(expectedRevision);const e=this.#entry(nonce);check(pending.has(e.state),'JOURNAL_TERMINAL');
    check(asBytes(frameBytes).toString('hex')===e.frameHex,'JOURNAL_RETRY_FRAME_CHANGED');
    check(e.attempts.length<10000,'JOURNAL_ATTEMPT_LIMIT');
    // A blockhash is a canonical32-byte base58 value; recording it is not a
    // promise that it is recent or that a wallet signed this exact transaction.
    const hash=nativeKeyAddress(blockhash);u64(lastValidBlockHeight);
    check(signature===null||typeof signature==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature),'JOURNAL_SIGNATURE_FORMAT');
    e.attempts.push({blockhash:hash,lastValidBlockHeight:lastValidBlockHeight.toString(),signature});
    e.state='PENDING';e.lastError=null;this.#commit();return this.get(nonce);
  }
  noteUnknown(nonce,{expectedRevision,reason='TRANSPORT_TIMEOUT'}){
    this.#cas(expectedRevision);const e=this.#entry(nonce);check(pending.has(e.state),'JOURNAL_TERMINAL');
    check(typeof reason==='string'&&reason.length>0&&reason.length<=256,'JOURNAL_REASON');
    e.state='UNKNOWN';e.lastError=reason;this.#commit();return {decision:'UNKNOWN',nonce:u64(nonce),frameBytes:Buffer.from(e.frameHex,'hex')};
  }
  reconcile(nonce,observation,{expectedRevision}){
    this.#cas(expectedRevision);const e=this.#entry(nonce);
    const fact=this.#validateObservation(observation);
    const n=u64(nonce),next=observation.nextNonce;let decision,result=null;
    if(next===n){decision='RETRY_SAME_FRAME';}
    else if(next===n+1n){
      if(observation.lastDigestHex!==e.digestHex){decision='NONCE_CONFLICT';}
      else{result=validateNativeResult(this.#abi,Buffer.from(e.frameHex,'hex'),hex(observation.lastResultHex,256));decision='CONFIRMED';}
    }else if(next>n+1n){decision='ALREADY_PROCESSED';}
    else{failGap();}
    let resultSource=result===null?null:'LATEST_NONCE_CACHE';
    // Preserve an already learned terminal fact. The account's single latest
    // cache being overwritten cannot erase a previously confirmed local result
    // or make a previously conflicting request become an unknown old request.
    if(e.state==='CONFIRMED'){decision='CONFIRMED';result=Buffer.from(e.resultHex,'hex');resultSource='LOCAL_CONFIRMED_HISTORY';}
    else if(e.state==='NONCE_CONFLICT'){decision='NONCE_CONFLICT';result=null;resultSource=null;}
    else if(e.state==='ALREADY_PROCESSED'){decision='ALREADY_PROCESSED';result=null;resultSource=null;}
    else{e.state=decision;e.lastObservation=clone(fact);if(result!==null)e.resultHex=result.toString('hex');}
    e.lastError=null;this.#global=fact;this.#commit();
    return {decision,nonce:n,...executionFacts(decision),resultBytes:result===null?null:Buffer.from(result),
      resultSource,frameBytes:decision==='RETRY_SAME_FRAME'?Buffer.from(e.frameHex,'hex'):null};
  }
  serialize(){const serialized=JSON.stringify({version:'BIOCLIENT-JOURNAL1',abiHash:this.#abi.hash,domainHex:this.#release.domain.toString('hex'),
    configHex:baseConfigR2Id(this.#release).toString('hex'),actor:this.#actor,revision:this.#revision.toString(),
    globalObservation:this.#global===null?null:clone(this.#global),entries:[...this.#entries.values()].map(clone)});check(Buffer.byteLength(serialized)<=16*1024*1024,'JOURNAL_STORAGE_SIZE');return serialized;}
  static restore({abi,release,actor},serialized){
    check(typeof serialized==='string'&&Buffer.byteLength(serialized)<=16*1024*1024,'JOURNAL_STORAGE_SIZE');
    const s=JSON.parse(serialized),out=new PendingJournal({abi,release,actor});
    check(s&&Object.keys(s).sort().join(',')==='abiHash,actor,configHex,domainHex,entries,globalObservation,revision,version'
      &&s.version==='BIOCLIENT-JOURNAL1'&&s.abiHash===abi.hash&&s.domainHex===release.domain.toString('hex')
      &&s.configHex===baseConfigR2Id(release).toString('hex')&&s.actor===nativeKeyAddress(actor),'JOURNAL_STORAGE_CONTEXT');
    out.#revision=decimal(s.revision);out.#global=s.globalObservation===null?null:validateStoredObservation(s.globalObservation);
    check(Array.isArray(s.entries)&&s.entries.length<=10000,'JOURNAL_STORAGE_ENTRIES');
    for(const e of s.entries){
      check(e&&Object.keys(e).sort().join(',')==='attempts,businessHex,digestHex,frameHex,lastError,lastObservation,nonce,resultHex,state','JOURNAL_ENTRY_FIELDS');
      const n=decimal(e.nonce),raw=hex(e.frameHex,4096),f=decodeNativeFrame(abi,raw);out.#context(f);
      check(n===f.nonce&&n<U64_MAX&&!out.#entries.has(e.nonce)&&nativeRequestHash(abi,raw).toString('hex')===e.digestHex
        &&nativeBusinessKey(abi,raw).toString('hex')===e.businessHex&&states.has(e.state),'JOURNAL_ENTRY_INTEGRITY');
      check(Array.isArray(e.attempts)&&e.attempts.length<=10000,'JOURNAL_ATTEMPTS');
      for(const a of e.attempts){check(a&&Object.keys(a).sort().join(',')==='blockhash,lastValidBlockHeight,signature','JOURNAL_ATTEMPT_FIELDS');nativeKeyBytes(a.blockhash);decimal(a.lastValidBlockHeight);
        check(a.signature===null||typeof a.signature==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(a.signature),'JOURNAL_SIGNATURE_FORMAT');}
      if(e.resultHex!==null)validateNativeResult(abi,raw,hex(e.resultHex,256));
      check(e.state!=='CONFIRMED'||e.resultHex!==null,'JOURNAL_RESULT_MISSING');
      check(e.state==='CONFIRMED'||e.resultHex===null,'JOURNAL_UNCONFIRMED_RESULT');
      check(e.lastError===null||typeof e.lastError==='string'&&e.lastError.length<=256,'JOURNAL_REASON');
      if(e.lastObservation!==null){validateStoredObservation(e.lastObservation);
        check(out.#global!==null&&decimal(e.lastObservation.contextSlot)<=decimal(out.#global.contextSlot)
          &&decimal(e.lastObservation.nextNonce)<=decimal(out.#global.nextNonce),'JOURNAL_STALE_CONTEXT');
        if(e.lastObservation.contextSlot===out.#global.contextSlot)check(e.lastObservation.nextNonce===out.#global.nextNonce
          &&e.lastObservation.lastDigestHex===out.#global.lastDigestHex&&e.lastObservation.lastResultHex===out.#global.lastResultHex,'JOURNAL_SAME_SLOT_CACHE_FACT');
        if(e.state==='CONFIRMED')check(decimal(e.lastObservation.nextNonce)===n+1n&&e.lastObservation.lastDigestHex===e.digestHex
          &&e.lastObservation.lastResultHex===e.resultHex,'JOURNAL_CONFIRMATION_FACTS');
        if(e.state==='NONCE_CONFLICT')check(decimal(e.lastObservation.nextNonce)===n+1n&&e.lastObservation.lastDigestHex!==e.digestHex,'JOURNAL_CONFLICT_FACTS');
        if(e.state==='ALREADY_PROCESSED')check(decimal(e.lastObservation.nextNonce)>n+1n,'JOURNAL_OLD_FACTS');
        if(pending.has(e.state))check(decimal(e.lastObservation.nextNonce)===n,'JOURNAL_PENDING_FACTS');
      }else check(!['CONFIRMED','NONCE_CONFLICT','ALREADY_PROCESSED'].includes(e.state),'JOURNAL_OBSERVATION_MISSING');
      out.#entries.set(e.nonce,clone(e));
    }
    check([...out.#entries.values()].filter(e=>pending.has(e.state)).length<=1,'JOURNAL_PENDING_UNRESOLVED');return out;
  }
}
const failGap=()=>{throw Object.assign(new Error('JOURNAL_OBSERVED_NONCE_BEHIND_REQUEST'),{code:'JOURNAL_OBSERVED_NONCE_BEHIND_REQUEST'});};
function validateStoredObservation(o){
  check(o&&Object.keys(o).sort().join(',')==='contextSlot,lastDigestHex,lastResultHex,nextNonce','JOURNAL_OBSERVATION_FIELDS');
  decimal(o.contextSlot);const next=decimal(o.nextNonce);
  if(next===0n)check(o.lastDigestHex===null&&o.lastResultHex===null,'JOURNAL_EMPTY_NONCE_FACT');
  else check(hex(o.lastDigestHex,32).length===32&&o.lastResultHex!==null&&hex(o.lastResultHex,256).length<=256,'JOURNAL_OBSERVATION_DIGEST');
  return clone(o);
}

/** Storage adapter must implement one atomic CAS (IndexedDB transaction, a
 * database row version, or properly locked/fsynced local file replacement).
 * A plain read-then-write pair is explicitly insufficient. */
export async function persistJournalCAS(journal,store,{expectedStorageRevision}){
  check(typeof store?.compareAndSwap==='function','JOURNAL_STORAGE_CAS_REQUIRED');
  const next=await store.compareAndSwap(expectedStorageRevision,journal.serialize());
  check(next!==false&&next!==null&&next!==undefined,'JOURNAL_STORAGE_CAS');return next;
}
