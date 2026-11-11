import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {nativeKeyAddress,nativeKeyBytes} from './native.mjs';
import {PROGRAMS} from './release.mjs';
import {ReadOnlyRpc,validateReadOnlyRpcEndpoint} from './rpc.mjs';
import {DISCOVERY_LIMITS as L,requireDiscovery as check,failure,publicIssue,discoveryBinding,sameBinding,plain} from './discovery-core.mjs';

const u64=n=>typeof n==='bigint'&&n>=0n&&n<(1n<<64n);
const mem=(offset,bytes)=>({memcmp:{offset,encoding:'base64',bytes:Buffer.from(bytes).toString('base64')}});
const ascii=(a,b)=>a<b?-1:a>b?1:0;
const sizeOK=(section,n)=>Number.isSafeInteger(n)&&(section==='roots'?n>=445&&n<=3479:section==='sources'?n===856:section==='positions'?n===375:section==='token-owner-hints'?n===165:n>=529&&n<=592);
function header(binding,kind,schema){const b=Buffer.alloc(80);Buffer.from('BIOLAB\0\0').copy(b);b.writeUInt16LE(1,8);b.writeUInt16LE(kind,10);b.writeUInt16LE(schema,12);Buffer.from(binding.domainHex,'hex').copy(b,16);Buffer.from(binding.configHex,'hex').copy(b,48);return b;}
async function boundedBody(response){
  check(response?.ok===true&&response.status===200,'DISCOVERY_RPC_UNAVAILABLE');const len=response.headers?.get('content-length');
  if(len!==null&&len!==undefined){check(/^[0-9]{1,20}$/.test(len),'DISCOVERY_RPC_INVALID_RESPONSE');check(BigInt(len)<=BigInt(L.responseBytes),'DISCOVERY_RPC_OVERFLOW');}
  check(typeof response.body?.getReader==='function','DISCOVERY_RPC_INVALID_RESPONSE');const reader=response.body.getReader(),chunks=[];let n=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;check(value instanceof Uint8Array,'DISCOVERY_RPC_INVALID_RESPONSE');n+=value.byteLength;check(n<=L.responseBytes,'DISCOVERY_RPC_OVERFLOW');chunks.push(Buffer.from(value));}return new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks,n));}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Discovery-only transport. No public arbitrary-program/filter escape hatch;
 * full account/state reads remain in the existing small ReadOnlyRpc. */
export class DiscoveryRpc{
  #endpoint;#binding;#fetch;#id=0n;#slot=0n;#reader=null;
  constructor({release,endpoint,fetchImpl,allowLocalhost=false}){
    this.#endpoint=validateReadOnlyRpcEndpoint(endpoint,{allowLocalhost});check(typeof fetchImpl==='function','DISCOVERY_RPC_UNAVAILABLE');this.#fetch=fetchImpl;this.#binding=discoveryBinding(release,this.#endpoint);
  }
  get endpoint(){return this.#endpoint;}get binding(){return {...this.#binding};}get contextSlot(){return this.#slot;}
  async bindReader(rpc){
    check(rpc instanceof ReadOnlyRpc&&rpc.endpoint===this.#endpoint,'DISCOVERY_BASE_MISMATCH');let result;try{result=await rpc.verifyGenesis();}catch{throw failure('DISCOVERY_GENESIS_MISMATCH');}
    check(result?.verified===true&&Buffer.from(result.genesisHash).toString('hex')===this.#binding.genesisHex,'DISCOVERY_GENESIS_MISMATCH');this.#reader=rpc;
  }
  matches(release){return sameBinding(this.#binding,discoveryBinding(release,this.#endpoint));}
  async #request(method,params,timeoutMs){
    check(this.#reader instanceof ReadOnlyRpc,'DISCOVERY_BASE_MISMATCH');check(['getProgramAccounts','getTokenAccountsByOwner'].includes(method),'DISCOVERY_INTERNAL');
    check(Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=L.rpcTimeoutMs,'DISCOVERY_DEADLINE');const id=`BIO-DISCOVERY-${this.#id++}`,c=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(failure('DISCOVERY_RPC_TIMEOUT'));},timeoutMs);});
    try{
      return await Promise.race([timeout,(async()=>{
        const res=await this.#fetch(this.#endpoint,{method:'POST',redirect:'error',signal:c.signal,headers:{'content-type':'application/json'},body:stringifyJsonWithBigInts({jsonrpc:'2.0',id,method,params})});
        let out;try{out=parseJsonWithBigInts(await boundedBody(res));}catch(error){throw failure(publicIssue(error,'DISCOVERY_RPC_INVALID_RESPONSE'));}
        check(plain(out)&&out.jsonrpc==='2.0'&&out.id===id,'DISCOVERY_RPC_INVALID_RESPONSE');
        if(Object.hasOwn(out,'error'))throw failure('DISCOVERY_RPC_UNAVAILABLE');check(Object.keys(out).sort().join(',')==='id,jsonrpc,result','DISCOVERY_RPC_INVALID_RESPONSE');return out.result;
      })()]);
    }catch(error){throw failure(publicIssue(error,'DISCOVERY_RPC_UNAVAILABLE'));}finally{clearTimeout(timer);c.abort();}
  }
  #decode(result,{section,prefix,minContextSlot}){
    check(plain(result)&&plain(result.context)&&u64(result.context.slot)&&result.context.slot>=minContextSlot&&result.context.slot>=this.#slot&&Array.isArray(result.value),'DISCOVERY_RPC_INVALID_RESPONSE');
    this.#slot=result.context.slot;if(result.value.length>=L.leafRows)return {overflow:true,contextSlot:this.#slot,candidates:[]};
    const addresses=new Set(),ids=new Set(),token=section==='token-owner-hints';
    const candidates=result.value.map(row=>{
      check(plain(row)&&plain(row.account),'DISCOVERY_RPC_INVALID_RESPONSE');const a=row.account;let address;try{address=nativeKeyAddress(row.pubkey);}catch{throw failure('DISCOVERY_RPC_INVALID_RESPONSE');}
      check(!addresses.has(address)&&a.owner===(token?PROGRAMS.tokenProgram:this.#binding.programId)&&a.executable===false&&u64(a.lamports)&&u64(a.rentEpoch),'DISCOVERY_RPC_INVALID_RESPONSE');addresses.add(address);
      check(Array.isArray(a.data)&&a.data.length===2&&a.data[1]==='base64'&&typeof a.data[0]==='string','DISCOVERY_RPC_INVALID_RESPONSE');const b=Buffer.from(a.data[0],'base64');
      check(b.length===32&&b.toString('base64')===a.data[0]&&u64(a.space)&&a.space<=1000000n&&sizeOK(section,Number(a.space)),'DISCOVERY_RPC_INVALID_RESPONSE');
      const idHex=b.toString('hex');check(idHex.startsWith(prefix)&&(token||!ids.has(idHex)),'DISCOVERY_RPC_INVALID_RESPONSE');ids.add(idHex);return {address,idHex,space:Number(a.space)};
    }).sort((a,b)=>ascii(a.idHex,b.idHex)||ascii(a.address,b.address));
    return {overflow:false,contextSlot:this.#slot,candidates};
  }
  async scanPartition({section,actor,lane=0,prefixHex='',minContextSlot=0n,timeoutMs=L.rpcTimeoutMs}){
    check(['projects','my-projects','material-atas','roots','sources','positions'].includes(section)&&typeof prefixHex==='string'&&/^(?:[0-9a-f]{2}){0,32}$/.test(prefixHex)&&u64(minContextSlot),'DISCOVERY_INTERNAL');
    const filters=[];let h;
    if(section==='roots'){check([1,2,3,4].includes(lane),'DISCOVERY_INTERNAL');h=header(this.#binding,12,lane);filters.push(mem(0,h),mem(322,nativeKeyBytes(actor)),mem(362,Buffer.from([0])));}
    else{
      check(lane===0,'DISCOVERY_INTERNAL');const [kind,schema]=section==='sources'?[11,1]:section==='positions'?[27,2]:[9,1];h=header(this.#binding,kind,schema);filters.push(mem(0,h));
      if(section==='sources')filters.push({dataSize:856},mem(120,nativeKeyBytes(actor)));
      else if(section==='positions')filters.push({dataSize:375},mem(200,nativeKeyBytes(actor)));
      else if(section==='my-projects')filters.push(mem(120,nativeKeyBytes(actor)));
    }
    if(prefixHex)filters.push(mem(88,Buffer.from(prefixHex,'hex')));check(filters.length<=4,'DISCOVERY_INTERNAL');
    const minimum=minContextSlot>this.#slot?minContextSlot:this.#slot;
    try{const result=await this.#request('getProgramAccounts',[this.#binding.programId,{encoding:'base64',commitment:'finalized',withContext:true,minContextSlot:minimum,dataSlice:{offset:88,length:32},filters}],timeoutMs);return this.#decode(result,{section,prefix:prefixHex,minContextSlot:minimum});}
    catch(error){if(publicIssue(error)==='DISCOVERY_RPC_OVERFLOW')return {overflow:true,contextSlot:null,candidates:[]};throw error;}
  }
  async scanTokenOwner({actor,minContextSlot=0n,timeoutMs=L.rpcTimeoutMs}){
    const minimum=minContextSlot>this.#slot?minContextSlot:this.#slot;
    try{const result=await this.#request('getTokenAccountsByOwner',[nativeKeyAddress(actor),{programId:PROGRAMS.tokenProgram},{encoding:'base64',commitment:'finalized',minContextSlot:minimum,dataSlice:{offset:0,length:32}}],timeoutMs);return this.#decode(result,{section:'token-owner-hints',prefix:'',minContextSlot:minimum});}
    catch(error){if(publicIssue(error)==='DISCOVERY_RPC_OVERFLOW')return {overflow:true,contextSlot:null,candidates:[]};throw error;}
  }
}
