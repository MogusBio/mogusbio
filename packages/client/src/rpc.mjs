import { parseJsonWithBigInts, stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { asBytes } from '../../protocol-core/src/index.mjs';
import { nativeKeyAddress, nativeKeyBytes, nativePda } from './native.mjs';
import { decodeActorNonceSnapshot } from './journal.mjs';
import { decodeNativeBaseConfig, decodeNativeProject, decodeNativeSource, decodeNativeRoot, decodeNativeRegistry, decodeNativeHour, decodeNativePosition, decodeClassicMint, decodeClassicTokenAccount } from './accounts.mjs';
import { decodeV1Transaction } from './transaction.mjs';
import { withRpcTimeout } from './http-timeout.mjs';
import { decodeNativeSealedSynthesisArtifact,decodeNativeSynthesisVerification } from './synthesis-workflow.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const maxU64=(1n<<64n)-1n;
const u64=v=>{check(typeof v==='bigint'&&v>=0n&&v<=maxU64,'RPC_U64');return v;};
const bounded=(n,lo,hi)=>{check(Number.isSafeInteger(n)&&n>=lo&&n<=hi,'RPC_BOUND');return n;};
const allowedMethods=new Set(['getGenesisHash','getMultipleAccounts','simulateTransaction']);
export function validateReadOnlyRpcEndpoint(endpoint,{allowLocalhost=false}={}){
  check(typeof endpoint==='string'&&typeof allowLocalhost==='boolean','RPC_ENDPOINT');let u;try{u=new URL(endpoint);}catch{check(false,'RPC_ENDPOINT');}
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  check(!u.username&&!u.password&&!u.hash&&(u.protocol==='https:'||(allowLocalhost&&local&&u.protocol==='http:')),'RPC_ENDPOINT_POLICY');
  return u.href;
}
async function readBounded(response,limit){
  check(response&&response.ok===true&&response.status===200,'RPC_HTTP_STATUS');
  const content=response.headers?.get('content-length');if(content!==null&&content!==undefined){check(content.length<=20&&/^[0-9]+$/.test(content)&&BigInt(content)<=BigInt(limit),'RPC_RESPONSE_SIZE');}
  check(typeof response.body?.getReader==='function','RPC_STREAM_REQUIRED');const reader=response.body.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;check(length<=limit,'RPC_RESPONSE_SIZE');chunks.push(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length));
}
function decodeRpcAccount(value,address,maxBytes){
  if(value===null)return null;
  check(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.executable==='boolean','RPC_ACCOUNT');
  const owner=nativeKeyAddress(value.owner),lamports=u64(value.lamports),rentEpoch=u64(value.rentEpoch);
  check(Array.isArray(value.data)&&value.data.length===2&&value.data[1]==='base64'&&typeof value.data[0]==='string','RPC_ACCOUNT_ENCODING');
  const encoded=value.data[0];check(encoded.length<=4*Math.ceil(maxBytes/3)&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),'RPC_ACCOUNT_DATA');
  const data=Buffer.from(encoded,'base64');check(data.length<=maxBytes&&data.toString('base64')===encoded,'RPC_ACCOUNT_DATA');
  if(value.space!==undefined)check(u64(value.space)===BigInt(data.length),'RPC_ACCOUNT_SPACE');
  return {address,owner,executable:value.executable,lamports,rentEpoch,data};
}

/** No global fetch fallback. An application must explicitly inject its trusted
 * transport. Only allowlisted reads/simulation can cross this boundary. */
export class ReadOnlyRpc{
  #release;#fetch;#endpoint;#id=0n;#slot=0n;#genesis=false;#maxResponse;#maxData;#maxTotal;#busyGenesis=null;#timeout;
  constructor({endpoint,release,fetchImpl,allowLocalhost=false,maxResponseBytes=8*1024*1024,maxAccountDataBytes=1024*1024,maxTotalAccountDataBytes=4*1024*1024,requestTimeoutMs=15000}){
    this.#endpoint=validateReadOnlyRpcEndpoint(endpoint,{allowLocalhost});this.#release=release;
    check(fetchImpl===undefined||typeof fetchImpl==='function','RPC_FETCH');this.#fetch=fetchImpl;
    this.#maxResponse=bounded(maxResponseBytes,256,16*1024*1024);this.#maxData=bounded(maxAccountDataBytes,0,10*1024*1024);
    this.#maxTotal=bounded(maxTotalAccountDataBytes,0,10*1024*1024);
    this.#timeout=bounded(requestTimeoutMs,1,60000);
  }
  get endpoint(){return this.#endpoint;}get contextSlot(){return this.#slot;}
  async #request(method,params){
    check(allowedMethods.has(method),'RPC_METHOD_DISABLED');check(this.#fetch,'RPC_FETCH_NOT_INJECTED');const id=`BIOCLIENT-${this.#id++}`;
    const out=await withRpcTimeout(this.#timeout,async signal=>{
      const res=await this.#fetch(this.#endpoint,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},body:stringifyJsonWithBigInts({jsonrpc:'2.0',id,method,params})});
      return parseJsonWithBigInts(await readBounded(res,this.#maxResponse));
    });
    check(out&&typeof out==='object'&&!Array.isArray(out)&&out.jsonrpc==='2.0'&&out.id===id,'RPC_ENVELOPE');
    if(Object.hasOwn(out,'error')){check(!Object.hasOwn(out,'result')&&typeof out.error?.code==='bigint'&&typeof out.error?.message==='string','RPC_ERROR_ENVELOPE');throw Object.assign(new Error('RPC_ERROR'),{code:'RPC_ERROR',rpcCode:out.error.code});}
    check(Object.hasOwn(out,'result')&&Object.keys(out).every(k=>['jsonrpc','id','result'].includes(k)),'RPC_ENVELOPE');return out.result;
  }
  async verifyGenesis(){
    if(this.#genesis)return {verified:true,genesisHash:Buffer.from(this.#release.hashes.genesisHash)};
    if(this.#busyGenesis)return this.#busyGenesis;
    this.#busyGenesis=(async()=>{const result=await this.#request('getGenesisHash',[]),actual=nativeKeyBytes(result);
      check(actual.equals(this.#release.hashes.genesisHash),'RPC_GENESIS_MISMATCH');this.#genesis=true;return {verified:true,genesisHash:Buffer.from(actual)};})();
    try{return await this.#busyGenesis;}finally{this.#busyGenesis=null;}
  }
  #minimum(minContextSlot){const min=minContextSlot===undefined?this.#slot:u64(minContextSlot);check(min>=this.#slot,'RPC_MIN_CONTEXT_REGRESSION');return min;}
  #observe(result,minimum){check(result&&typeof result==='object'&&!Array.isArray(result),'RPC_CONTEXT');const slot=u64(result.context?.slot);
    check(slot>=minimum&&slot>=this.#slot,'RPC_CONTEXT_REGRESSION');return slot;}
  async getMultipleAccounts(addresses,{minContextSlot}={}){
    check(Array.isArray(addresses)&&addresses.length>=1&&addresses.length<=100,'RPC_ACCOUNT_COUNT');
    const keys=addresses.map(nativeKeyAddress);check(new Set(keys).size===keys.length,'RPC_ACCOUNT_DUPLICATE');const minimum=this.#minimum(minContextSlot);
    await this.verifyGenesis();const result=await this.#request('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized',minContextSlot:minimum}]);
    const slot=this.#observe(result,minimum);check(Array.isArray(result.value)&&result.value.length===keys.length,'RPC_ACCOUNT_COUNT');
    const accounts=result.value.map((v,i)=>decodeRpcAccount(v,keys[i],this.#maxData));check(accounts.reduce((n,a)=>n+(a?.data.length??0),0)<=this.#maxTotal,'RPC_TOTAL_ACCOUNT_DATA');
    this.#slot=slot;return {contextSlot:slot,accounts};
  }
  async verifyBaseConfig(options={}){
    const {contextSlot,accounts:[account]}=await this.getMultipleAccounts([this.#release.pdas.baseConfig.address],options);
    check(account!==null,'RPC_BASE_MISSING');const value=await decodeNativeBaseConfig(this.#release,account);return {contextSlot,account,value};
  }
  async getActorNonce(actor,options={}){
    const pda=await nativePda(this.#release.input.programId,'bio','actor-nonce',nativeKeyBytes(actor));
    const {contextSlot,accounts:[account]}=await this.getMultipleAccounts([pda.address],options);
    return decodeActorNonceSnapshot({release:this.#release,actor,address:pda.address,account,contextSlot,commitment:'finalized'});
  }
  async #read(address,decode,options){const {contextSlot,accounts:[account]}=await this.getMultipleAccounts([address],options);check(account!==null,'RPC_ACCOUNT_MISSING');return {contextSlot,account,value:await decode(account)};}
  async getRoot(instance,options={}){const p=await nativePda(this.#release.input.programId,'bio','root',asBytes(instance,32));return this.#read(p.address,a=>decodeNativeRoot(this.#release,a,instance),options);}
  async getProject(id,options={}){const p=await nativePda(this.#release.input.programId,'bio','project',asBytes(id,32));return this.#read(p.address,a=>decodeNativeProject(this.#release,a,id),options);}
  async getSource(id,options={}){const p=await nativePda(this.#release.input.programId,'bio','source',asBytes(id,32));return this.#read(p.address,a=>decodeNativeSource(this.#release,a,id),options);}
  async getRegistry(options={}){const p=await nativePda(this.#release.input.programId,'bio','mining');return this.#read(p.address,a=>decodeNativeRegistry(this.#release,a),options);}
  async getHour(hour,options={}){const n=Buffer.alloc(8);n.writeBigUInt64LE(u64(hour));const p=await nativePda(this.#release.input.programId,'bio','hour',n);return this.#read(p.address,a=>decodeNativeHour(this.#release,a,hour),options);}
  async getPosition(instance,seq,options={}){const n=Buffer.alloc(8);n.writeBigUInt64LE(u64(seq));const p=await nativePda(this.#release.input.programId,'bio','reg',asBytes(instance,32),n);return this.#read(p.address,a=>decodeNativePosition(this.#release,a,instance,seq),options);}
  async getSealedSynthesisArtifact(id,options={}){const p=await nativePda(this.#release.input.programId,'bio','artifact',asBytes(id,32));return this.#read(p.address,a=>decodeNativeSealedSynthesisArtifact(this.#release,a,{expectedId:id}),options);}
  async getSynthesisVerification(actor,{artifactId,artifactSHA,minContextSlot}={}){
    const p=await nativePda(this.#release.input.programId,'bio','verify',nativeKeyBytes(actor));
    const {contextSlot,accounts:[account]}=await this.getMultipleAccounts([p.address],{minContextSlot});check(account!==null,'RPC_ACCOUNT_MISSING');
    const value=await decodeNativeSynthesisVerification(this.#release,account,{actor,artifactId,artifactSHA,contextSlot,commitment:'finalized'});
    return {contextSlot,account,value};
  }
  async getClassicMint(address,decodeOptions={},options={}){return this.#read(nativeKeyAddress(address),a=>decodeClassicMint(a,{...decodeOptions,expectedAddress:address}),options);}
  async getClassicTokenAccount(address,decodeOptions={},options={}){return this.#read(nativeKeyAddress(address),a=>decodeClassicTokenAccount(a,{...decodeOptions,expectedAddress:address}),options);}
  async simulatePreparedV1(wire,{supportedTransactionVersions,minContextSlot}={}){
    check(supportedTransactionVersions?.includes(1),'RPC_V1_UNSUPPORTED');const bytes=asBytes(wire),{message,transaction}=decodeV1Transaction(bytes);
    check(Object.keys(transaction.signatures).length<=12,'RPC_V1_SIGNATURE_LIMIT');
    check(message.configMask===31&&message.configValues.length===4,'RPC_V1_EXPLICIT_BUDGETS');
    const [priorityFee,computeUnits,loadedBytes,heapBytes]=message.configValues.map(x=>x.value);
    u64(priorityFee);check(Number.isInteger(computeUnits)&&computeUnits>=1&&computeUnits<=1400000&&Number.isInteger(loadedBytes)&&loadedBytes>=1&&loadedBytes<=67108864
      &&Number.isInteger(heapBytes)&&heapBytes>=32768&&heapBytes<=262144&&heapBytes%1024===0,'RPC_V1_BUDGETS');
    const base=await this.verifyBaseConfig({minContextSlot});const minimum=base.contextSlot;
    const result=await this.#request('simulateTransaction',[bytes.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'finalized',minContextSlot:minimum}]);
    const slot=this.#observe(result,minimum),value=result.value;check(value&&typeof value==='object'&&Object.hasOwn(value,'err'),'RPC_SIMULATION_RESULT');
    check(value.err===null,'RPC_SIMULATION_FAILED');const unitsConsumed=u64(value.unitsConsumed);check(unitsConsumed<=BigInt(computeUnits),'RPC_SIMULATION_UNITS');
    check(value.logs===null||Array.isArray(value.logs)&&value.logs.length<=4096&&value.logs.every(s=>typeof s==='string')&&Buffer.byteLength(value.logs.join('\n'))<=1024*1024,'RPC_SIMULATION_LOGS');
    let replacementBlockhash=null;if(value.replacementBlockhash!==null&&value.replacementBlockhash!==undefined){replacementBlockhash={blockhash:nativeKeyAddress(value.replacementBlockhash.blockhash),lastValidBlockHeight:u64(value.replacementBlockhash.lastValidBlockHeight)};}
    this.#slot=slot;return {contextSlot:slot,simulationOnly:true,transactionExecuted:false,signatureVerified:false,unitsConsumed,logs:value.logs===null?null:[...value.logs],replacementBlockhash,
      resources:{priorityFeeLamports:priorityFee,computeUnitLimit:computeUnits,loadedAccountsDataSizeLimit:loadedBytes,heapSize:heapBytes}};
  }
}
