import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { getBase58Decoder } from '@solana/kit';
import { sha256 } from '../../protocol-core/src/index.mjs';
import { baseConfigR2Id } from './release.mjs';
import { nativeKeyAddress,nativeKeyBytes,encodeNativeFrame,decodeNativeFrame,nativeRequestHash,buildNativeInstruction } from './native.mjs';
import { buildV1Transaction,transactionBytes,decodeV1Transaction } from './transaction.mjs';
import { verifyWalletSignedV1 } from './wallet.mjs';
import { PendingJournal,persistJournalCAS } from './journal.mjs';
import { ReadOnlyRpc } from './rpc.mjs';
import { withRpcTimeout } from './http-timeout.mjs';
import { buildClaimLabDestinationSetup } from './lab-destination.mjs';
import { decodeNativePosition } from './accounts.mjs';
import { FileJournalStore } from './file-journal.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const max64=(1n<<64n)-1n;
const u64=v=>{check(typeof v==='bigint'&&v>=0n&&v<=max64,'SESSION_U64');return v;};
const dec=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s),'SESSION_DECIMAL');return u64(BigInt(s));};
const hex=(s,max)=>{check(typeof s==='string'&&s.length%2===0&&/^[0-9a-f]*$/.test(s)&&s.length/2<=max,'SESSION_HEX');return Buffer.from(s,'hex');};
const keys=(v,list)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...list].sort().join(','),'SESSION_FIELDS');
const resourceFields=['computeUnitLimit','loadedAccountsDataSizeLimit','heapSize','priorityFeeLamports'];
const envelopeFields=['profile','abiHash','releaseHash','domainHex','configHex','actor','nonce','operation','frameHex','suffix','dynamicAccounts','feePayer','lifetime','resources','unsignedHex','messageSHA256'];
const resourceJson=r=>({computeUnitLimit:r.computeUnitLimit,loadedAccountsDataSizeLimit:r.loadedAccountsDataSizeLimit,
  heapSize:r.heapSize??32768,priorityFeeLamports:(r.priorityFeeLamports??0n).toString()});
function rows(suffix,dynamicAccounts){
  check(Array.isArray(suffix)&&Array.isArray(dynamicAccounts),'SESSION_ACCOUNTS');
  suffix.forEach(r=>keys(r,['name','address']));dynamicAccounts.forEach(r=>keys(r,['address','writable','signer']));
  return {suffix:suffix.map(r=>({name:r.name,address:nativeKeyAddress(r.address)})),
    dynamicAccounts:dynamicAccounts.map(r=>({address:nativeKeyAddress(r.address),writable:r.writable,signer:r.signer}))};
}

/** An exported envelope contains public transaction data only. Its contents
 * are reconstructed on import; hashes and human-readable summaries are never
 * trusted in place of exact bytes. No signing or network access occurs here. */
export async function createPreparedNativeEnvelope({release,abi,frame,suffix=[],dynamicAccounts=[],feePayer,lifetime,resources,labDestinationSetup}){
  const f=decodeNativeFrame(abi,frame),accounts=rows(suffix,dynamicAccounts);
  const instruction=await buildNativeInstruction({release,abi,frame,...accounts});
  const setup=labDestinationSetup===undefined?null:await buildClaimLabDestinationSetup({release,abi,frame,labDestinationSetup});
  const built=buildV1Transaction({feePayer,lifetime,resources,instructions:setup===null?[instruction]:[setup.instruction,instruction],supportedTransactionVersions:[1]});
  return {profile:'BIOCLIENT-PREPARED1',abiHash:abi.hash,releaseHash:release.input.releaseHash,
    domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex'),actor:nativeKeyAddress(f.actor),
    nonce:f.nonce.toString(),operation:f.operation,frameHex:Buffer.from(frame).toString('hex'),...accounts,
    feePayer:nativeKeyAddress(feePayer),lifetime:{blockhash:nativeKeyAddress(lifetime.blockhash),lastValidBlockHeight:u64(lifetime.lastValidBlockHeight).toString()},
    resources:resourceJson(resources),unsignedHex:transactionBytes(built.transaction).toString('hex'),messageSHA256:sha256(built.transaction.messageBytes).toString('hex'),
    ...(setup===null?{}:{labDestinationSetup:setup.metadata})};
}
export async function inspectPreparedNativeEnvelope({release,abi,envelope}){
  const fields=Object.hasOwn(envelope??{},'labDestinationSetup')?[...envelopeFields,'labDestinationSetup']:envelopeFields;
  keys(envelope,fields);keys(envelope.lifetime,['blockhash','lastValidBlockHeight']);keys(envelope.resources,resourceFields);
  check(envelope.profile==='BIOCLIENT-PREPARED1'&&envelope.abiHash===abi.hash&&envelope.releaseHash===release.input.releaseHash
    &&envelope.domainHex===release.domain.toString('hex')&&envelope.configHex===baseConfigR2Id(release).toString('hex'),'SESSION_RELEASE');
  const frame=hex(envelope.frameHex,4096),f=decodeNativeFrame(abi,frame);dec(envelope.nonce);
  const expected=await createPreparedNativeEnvelope({release,abi,frame,suffix:envelope.suffix,dynamicAccounts:envelope.dynamicAccounts,
    feePayer:envelope.feePayer,lifetime:{blockhash:envelope.lifetime.blockhash,lastValidBlockHeight:dec(envelope.lifetime.lastValidBlockHeight)},
    resources:{...envelope.resources,priorityFeeLamports:dec(envelope.resources.priorityFeeLamports)},labDestinationSetup:envelope.labDestinationSetup});
  check(JSON.stringify(expected)===JSON.stringify(Object.fromEntries(fields.map(k=>[k,envelope[k]]))),'SESSION_ENVELOPE_CHANGED');
  const wire=hex(envelope.unsignedHex,4096),decoded=decodeV1Transaction(wire);
  return {envelope:expected,frame,nonce:f.nonce,actor:nativeKeyAddress(f.actor),unsignedBytes:wire,transaction:decoded.transaction,
    requestHash:nativeRequestHash(abi,frame),businessExecutionVerified:false};
}
async function boundedResponse(res){
  check(res?.ok===true&&res.status===200&&typeof res.body?.getReader==='function','SESSION_RPC_HTTP');
  const reader=res.body.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;check(length<=1024*1024,'SESSION_RPC_SIZE');chunks.push(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  return parseJsonWithBigInts(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length)));
}

/** Explicitly invoked player actions. The constructor and preparation never
 * sign or submit. A broadcast accepts only a fully wallet-signed exact prepared
 * transaction, and persists its attempt before calling sendTransaction. */
export class NativePlayerSession{
  #release;#abi;#actor;#store;#rpc;#fetch;#id=0n;#slot=0n;#timeout;
  constructor({release,abi,actor,store,endpoint,fetchImpl,allowLocalhost=false,requestTimeoutMs=15000}){
    check(abi.hash===release.hashes.abiHash.toString('hex'),'SESSION_ABI');
    check(typeof store?.load==='function'&&typeof store?.compareAndSwap==='function','SESSION_DURABLE_STORE');
    this.#release=release;this.#abi=abi;this.#actor=nativeKeyAddress(actor);this.#store=store;this.#fetch=fetchImpl;
    this.#rpc=new ReadOnlyRpc({endpoint,release,fetchImpl,allowLocalhost,requestTimeoutMs});this.#timeout=requestTimeoutMs;
  }
  get rpc(){return this.#rpc;}
  get recoveryIdentity(){return Object.freeze({actor:this.#actor,abiHash:this.#abi.hash,domainHex:this.#release.domain.toString('hex'),
    configHex:baseConfigR2Id(this.#release).toString('hex'),releaseHash:this.#release.input.releaseHash});}
  distinctStore(other){
    check(other instanceof NativePlayerSession,'SESSION_RECOVERY_PEER');
    if(this.#store===other.#store)return false;
    if(this.#store instanceof FileJournalStore&&other.#store instanceof FileJournalStore)return this.#store.file!==other.#store.file;
    // Other adapters are trusted CAS boundaries; two wrappers must not disguise
    // one namespace. The supplied POSIX adapter enforces canonical paths.
    return true;
  }
  async getRequest(nonce){u64(nonce);return this.#entry(await this.#load(),nonce);}
  async #load(){const state=await this.#store.load();return {storageRevision:state.revision,
    journal:state.payload===null?new PendingJournal({release:this.#release,abi:this.#abi,actor:this.#actor}):
      PendingJournal.restore({release:this.#release,abi:this.#abi,actor:this.#actor},state.payload)};}
  async #save(state){
    const serialized=state.journal.serialize(),entries=JSON.parse(serialized).entries;
    if(entries.length>=512||Buffer.byteLength(serialized)>=4*1024*1024){
      const terminal=entries.filter(e=>['CONFIRMED','NONCE_CONFLICT','ALREADY_PROCESSED'].includes(e.state)).slice(0,1000);
      check(terminal.length>0&&typeof this.#store.archiveTerminals==='function','SESSION_ARCHIVE_REQUIRED');
      const receipts=await this.#store.archiveTerminals(terminal.map(e=>state.journal.exportTerminal(BigInt(e.nonce))));
      state.journal.pruneArchived(receipts,{expectedRevision:state.journal.revision});
    }
    state.storageRevision=await persistJournalCAS(state.journal,this.#store,{expectedStorageRevision:state.storageRevision});
  }
  async #entry(state,nonce){
    try{return {...state.journal.get(nonce),archived:false};}
    catch(e){if(e.code!=='JOURNAL_NOT_FOUND')throw e;return {...await state.journal.getArchived(nonce,this.#store),archived:true};}
  }
  #minimum(){return this.#slot>this.#rpc.contextSlot?this.#slot:this.#rpc.contextSlot;}
  async #request(method,params){
    check(['getLatestBlockhash','getBlockHeight','isBlockhashValid','sendTransaction'].includes(method),'SESSION_RPC_METHOD');
    check(typeof this.#fetch==='function','RPC_FETCH_NOT_INJECTED');await this.#rpc.verifyGenesis();const id=`BIOSESSION-${this.#id++}`;
    const out=await withRpcTimeout(this.#timeout,async signal=>boundedResponse(await this.#fetch(this.#rpc.endpoint,{method:'POST',redirect:'error',signal,
      headers:{'content-type':'application/json'},body:stringifyJsonWithBigInts({jsonrpc:'2.0',id,method,params})})));
    check(out&&typeof out==='object'&&!Array.isArray(out)&&out.jsonrpc==='2.0'&&out.id===id,'SESSION_RPC_ENVELOPE');
    if(Object.hasOwn(out,'error'))throw Object.assign(new Error('SESSION_RPC_ERROR'),{code:'SESSION_RPC_ERROR'});
    check(Object.keys(out).sort().join(',')==='id,jsonrpc,result','SESSION_RPC_ENVELOPE');return out.result;
  }
  async latestLifetime(){
    const minimum=this.#minimum(),r=await this.#request('getLatestBlockhash',[{commitment:'finalized',minContextSlot:minimum}]);
    const slot=u64(r?.context?.slot);check(slot>=minimum,'SESSION_CONTEXT_REGRESSION');
    const lifetime={blockhash:nativeKeyAddress(r?.value?.blockhash),lastValidBlockHeight:u64(r?.value?.lastValidBlockHeight)};this.#slot=slot;return lifetime;
  }
  async #snapshot(){await this.#rpc.verifyBaseConfig({minContextSlot:this.#minimum()});return this.#rpc.getActorNonce(this.#actor,{minContextSlot:this.#minimum()});}
  async #validateLabSetup(frame,suffix,metadata){
    if(metadata===undefined)return;
    const setup=await buildClaimLabDestinationSetup({release:this.#release,abi:this.#abi,frame,labDestinationSetup:metadata}),f=decodeNativeFrame(this.#abi,frame);
    const position=suffix.find(r=>r.name==='Position');check(position,'LAB_SETUP_POSITION');
    const {accounts:[account]}=await this.#rpc.getMultipleAccounts([position.address],{minContextSlot:this.#minimum()});check(account&&account.data.length===375,'LAB_SETUP_POSITION');
    const actual=await decodeNativePosition(this.#release,account,account.data.subarray(120,152),account.data.readBigUInt64LE(152));
    check(actual.positionId.equals(f.payload.subarray(0,32))&&actual.beneficiaryAddress===setup.beneficiary,'LAB_SETUP_BENEFICIARY');
  }
  #observeStored(state,snapshot){
    // Reconcile the newest retained entry before admitting a fresh action.
    const entries=JSON.parse(state.journal.serialize()).entries;
    if(entries.length){const latest=entries.reduce((a,b)=>BigInt(a.nonce)>BigInt(b.nonce)?a:b);state.journal.reconcile(BigInt(latest.nonce),snapshot,{expectedRevision:state.journal.revision});}
    else if(typeof state.journal.observeFinalized==='function')state.journal.observeFinalized(snapshot,{expectedRevision:state.journal.revision});
  }
  async prepare({operation,nonce,payload,suffix=[],dynamicAccounts=[],feePayer=this.#actor,resources,labDestinationSetup}){
    u64(nonce);const snapshot=await this.#snapshot();check(snapshot.nextNonce===nonce,'SESSION_NONCE_CHANGED');
    const lifetime=await this.latestLifetime(),frame=encodeNativeFrame(this.#abi,{operation,domain:this.#release.domain,
      configId:baseConfigR2Id(this.#release),actor:this.#actor,nonce,payload});
    await this.#validateLabSetup(frame,suffix,labDestinationSetup);
    const envelope=await createPreparedNativeEnvelope({release:this.#release,abi:this.#abi,frame,suffix,dynamicAccounts,feePayer,lifetime,resources,labDestinationSetup});
    const state=await this.#load();this.#observeStored(state,snapshot);
    state.journal.begin(frame,{expectedRevision:state.journal.revision,observedNextNonce:snapshot.nextNonce});await this.#save(state);return envelope;
  }
  async reconcile(nonce){
    u64(nonce);const state=await this.#load(),entry=await this.#entry(state,nonce);
    if(entry.archived)return {decision:entry.state,nonce,resultBytes:entry.resultBytes,resultSource:entry.resultSource,
      businessExecutionVerified:entry.businessExecutionVerified,executionReason:entry.executionReason,networkSubmitted:false};
    const snapshot=await this.#snapshot();const result=state.journal.reconcile(nonce,snapshot,{expectedRevision:state.journal.revision});
    await this.#save(state);return result;
  }
  async refresh(envelope){
    const original=await inspectPreparedNativeEnvelope({release:this.#release,abi:this.#abi,envelope});check(original.actor===this.#actor,'SESSION_ACTOR');
    const result=await this.reconcile(original.nonce);check(result.decision==='RETRY_SAME_FRAME','SESSION_NO_RETRY');
    return createPreparedNativeEnvelope({release:this.#release,abi:this.#abi,frame:original.frame,suffix:envelope.suffix,dynamicAccounts:envelope.dynamicAccounts,
      feePayer:envelope.feePayer,lifetime:await this.latestLifetime(),resources:{...envelope.resources,priorityFeeLamports:dec(envelope.resources.priorityFeeLamports)},labDestinationSetup:envelope.labDestinationSetup});
  }
  async broadcastSigned(envelope,signedBytes){
    const prepared=await inspectPreparedNativeEnvelope({release:this.#release,abi:this.#abi,envelope});check(prepared.actor===this.#actor,'SESSION_ACTOR');
    const verified=verifyWalletSignedV1(prepared.unsignedBytes,signedBytes),first=Object.keys(verified.transaction.signatures)[0];
    const signature=getBase58Decoder().decode(verified.transaction.signatures[first]);
    const endpoint=new URL(this.#rpc.endpoint);
    check(!this.#release.localPublicFixture||['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname),'SESSION_FIXTURE_LOOPBACK_ONLY');
    const state=await this.#load(),entry=await this.#entry(state,prepared.nonce);
    check(entry.digestHex===prepared.requestHash.toString('hex'),'SESSION_JOURNAL_FRAME');
    if(entry.archived)return {decision:entry.state,nonce:prepared.nonce,resultBytes:entry.resultBytes,resultSource:entry.resultSource,
      businessExecutionVerified:entry.businessExecutionVerified,executionReason:entry.executionReason,networkSubmitted:false};
    const snapshot=await this.#snapshot();
    await this.#validateLabSetup(prepared.frame,envelope.suffix,envelope.labDestinationSetup);
    const outcome=state.journal.reconcile(prepared.nonce,snapshot,{expectedRevision:state.journal.revision});
    if(outcome.decision!=='RETRY_SAME_FRAME'){await this.#save(state);return {...outcome,networkSubmitted:false};}
    // The last-valid height is envelope metadata, not a signed message field.
    // Check the signed blockhash itself on the selected finalized RPC as well.
    const minimum=this.#minimum(),valid=await this.#request('isBlockhashValid',[envelope.lifetime.blockhash,{commitment:'finalized',minContextSlot:minimum}]);
    const slot=u64(valid?.context?.slot);check(slot>=minimum,'SESSION_CONTEXT_REGRESSION');this.#slot=slot;
    check(valid.value===true,'SESSION_BLOCKHASH_INVALID');
    const height=u64(await this.#request('getBlockHeight',[{commitment:'finalized'}]));
    check(height<=dec(envelope.lifetime.lastValidBlockHeight),'SESSION_BLOCKHASH_EXPIRED');
    state.journal.recordAttempt(prepared.nonce,{expectedRevision:state.journal.revision,blockhash:envelope.lifetime.blockhash,
      lastValidBlockHeight:dec(envelope.lifetime.lastValidBlockHeight),frameBytes:prepared.frame,signature});await this.#save(state);
    try{
      const response=await this.#request('sendTransaction',[Buffer.from(signedBytes).toString('base64'),{encoding:'base64',skipPreflight:false,
        preflightCommitment:'finalized',maxRetries:0,minContextSlot:this.#minimum()}]);
      check(response===signature,'SESSION_RPC_SIGNATURE');
      return {decision:'PENDING',signature,networkSubmitted:true,businessExecutionVerified:false,nonce:prepared.nonce};
    }catch(error){
      // An RPC error or lost response cannot prove that a signed packet did not
      // reach a leader. Keep its original request and already durable attempt.
      state.journal.noteUnknown(prepared.nonce,{expectedRevision:state.journal.revision,reason:'TRANSPORT_RESULT_UNKNOWN'});
      let storageError=null;try{await this.#save(state);}catch(e){storageError=e.code??e.message;}
      return {decision:'UNKNOWN',signature,networkSubmitted:'UNKNOWN',businessExecutionVerified:false,nonce:prepared.nonce,
        error:error.code??error.message,storageError};
    }
  }
}
