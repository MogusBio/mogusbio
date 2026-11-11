import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { nativePda,nativeKeyBytes,decodeNativeFrame } from '../../packages/client/src/native.mjs';
import { PROGRAMS } from '../../packages/client/src/release.mjs';
import { decodeActorNonceSnapshot } from '../../packages/client/src/journal.mjs';
import { inspectPreparedNativeEnvelope } from '../../packages/client/src/session.mjs';
import { check } from './policy.mjs';

const MAX=(1n<<64n)-1n,u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'SERVICE_QUOTE_U64');return n;};
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&!a.executable&&a.data.length===0;
/** Extra allowlisted read-only RPC methods. No broadcast or signing capability. */
export function serviceQuoteAdapter({release,abi,fetchImpl,endpoint}){
  let sequence=0;
  async function request(method,params){
    check(['getFeeForMessage','getMinimumBalanceForRentExemption','getBlockHeight','isBlockhashValid'].includes(method),'SERVICE_QUOTE_METHOD');const id=`BIOSERVICE-${++sequence}`,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{const r=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:stringifyJsonWithBigInts({jsonrpc:'2.0',id,method,params})});check(r?.status===200&&r.ok&&typeof r.body?.getReader==='function','SERVICE_QUOTE_HTTP');const reader=r.body.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;check(size<=65536,'SERVICE_QUOTE_SIZE');chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}const v=parseJsonWithBigInts(Buffer.concat(chunks).toString('utf8'));check(v?.jsonrpc==='2.0'&&v.id===id&&!v.error&&Object.hasOwn(v,'result'),'SERVICE_QUOTE_RPC');return v.result;}finally{clearTimeout(timer);}
  }
  async function lifetime(envelope,rpc){await rpc.verifyBaseConfig();const min=rpc.contextSlot,result=await request('isBlockhashValid',[envelope.lifetime.blockhash,{commitment:'finalized',minContextSlot:min}]);check(u64(result.context?.slot)>=min&&typeof result.value==='boolean','SERVICE_LIFETIME_CONTEXT');const height=u64(await request('getBlockHeight',[{commitment:'finalized'}]));return {valid:result.value,height,expired:result.value===false&&height>BigInt(envelope.lifetime.lastValidBlockHeight)};}
  async function quote(envelope,rpc){
    const inspected=await inspectPreparedNativeEnvelope({release,abi,envelope}),f=decodeNativeFrame(abi,inspected.frame);check(envelope.actor===envelope.feePayer,'SERVICE_FEE_PAYER');
    const nonce=(await nativePda(release.input.programId,'bio','actor-nonce',nativeKeyBytes(envelope.actor))).address,creates=[{address:nonce,bytes:418}];
    if(f.operation==='SYNC_EMISSION')creates.push({address:envelope.suffix.find(r=>r.name==='Registry').address,bytes:376});
    if(f.operation==='OPEN_HOUR')creates.push({address:envelope.suffix.find(r=>r.name==='Hour').address,bytes:482});
    await rpc.verifyBaseConfig();const {contextSlot,accounts}=await rpc.getMultipleAccounts([envelope.actor,...creates.map(c=>c.address)]),wallet=accounts[0];check(wallet&&wallet.owner===PROGRAMS.systemProgram&&!wallet.executable&&wallet.data.length===0,'SERVICE_BALANCE_ACCOUNT');
    const observed=await decodeActorNonceSnapshot({release,actor:envelope.actor,address:nonce,account:accounts[1],contextSlot,commitment:'finalized'});check(observed.nextNonce===f.nonce,'SERVICE_QUOTE_NONCE_CHANGED');
    let rent=0n;for(let i=0;i<creates.length;i++)if(fresh(accounts[i+1])){const minimum=u64(await request('getMinimumBalanceForRentExemption',[creates[i].bytes,{commitment:'finalized'}])),balance=accounts[i+1]?.lamports??0n;rent+=minimum>balance?minimum-balance:0n;}
    const fee=await request('getFeeForMessage',[Buffer.from(inspected.transaction.messageBytes).toString('base64'),{commitment:'finalized',minContextSlot:contextSlot}]);check(fee?.value!==null&&u64(fee?.context?.slot)>=contextSlot,'SERVICE_FEE_QUOTE_UNAVAILABLE');
    return {source:'FINALIZED_RPC_MESSAGE_AND_RENT',messageSHA256:envelope.messageSHA256,contextSlot:u64(fee.context.slot),balanceContextSlot:contextSlot,feeLamports:u64(fee.value),rentLamports:u64(rent),balanceLamports:u64(wallet.lamports),fundsSufficientGuaranteed:false};
  }
  return Object.freeze({quote,lifetime});
}
