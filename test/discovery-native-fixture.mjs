// HOST read transport over untouched OPEN310 signed-Bank account captures.
// RPC envelopes/filter execution here are test adapters, not public RPC proof.
import {readFile} from 'node:fs/promises';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {validateProductionRelease} from '../packages/client/src/release.mjs';
import {loadNativeAbi,nativeKeyBytes,nativeKeyAddress} from '../packages/client/src/native.mjs';
import {PROGRAMS} from '../packages/client/src/release.mjs';

const projectRoot=new URL('../',import.meta.url);
export const opening310Input=JSON.parse(await readFile(new URL('programs/biolab-economy/evidence/production-admission-fixture.opening310.json',projectRoot),'utf8'));
export const opening310Release=await validateProductionRelease(opening310Input,{localPublicFixture:true});
export const opening310Abi=loadNativeAbi(await readFile(new URL('programs/biolab-economy/operations.p0r2.json',projectRoot)),{expectedHash:opening310Input.abiHash});
export const opening310Actor=opening310Input.bootstrap;
export const opening310Endpoint='http://127.0.0.1:1/';
export const opening310TerminalFile=new URL('programs/transaction-transport/evidence/opening310-full-lifecycle-bank-67c79ff7-terminal.json',projectRoot);

function decodeRow(row){
  if(row.missing)return null;
  return {address:row.address,owner:row.owner,executable:row.executable,
    lamports:BigInt(row.lamports),rentEpoch:BigInt(row.rentEpoch),data:Buffer.from(row.data[0],'base64')};
}
function rpcAccount(a,slice){
  if(a===null)return null;const full=Buffer.from(a.data),data=slice?full.subarray(Number(slice.offset),Number(slice.offset)+Number(slice.length)):full;
  return {owner:a.owner,executable:a.executable,lamports:a.lamports,rentEpoch:a.rentEpoch,space:BigInt(full.length),data:[data.toString('base64'),'base64']};
}
function matches(a,filters){
  return filters.every(f=>{
    if(Object.hasOwn(f,'dataSize'))return BigInt(a.data.length)===BigInt(f.dataSize);
    if(!f.memcmp||Object.keys(f).length!==1)throw new Error('HOST_UNSUPPORTED_FILTER');
    const {offset,bytes,encoding}=f.memcmp;
    if(encoding!=='base64')throw new Error('HOST_EXPECT_BASE64_FILTER');
    const needle=Buffer.from(bytes,'base64');if(needle.toString('base64')!==bytes)throw new Error('HOST_NONCANONICAL_FILTER');
    const at=Number(offset);if(!Number.isSafeInteger(at)||at<0)throw new Error('HOST_FILTER_OFFSET');
    return a.data.subarray(at,at+needle.length).equals(needle);
  });
}

export async function opening310DiscoveryFixture({file=opening310TerminalFile,phase='after',onRequest=null}={}){
  const evidence=JSON.parse(await readFile(file,'utf8'));
  if(evidence.elfSHA256!=='67c79ff71e977ade39d0823b561c7d8d13c0669060d0ed83dff4a2031afad100'
    ||evidence.inputSHA256!=='88de3e368ddbb23dff9960eac935b3d2b0c2c2da4fc77c717806fa36b1c780db')throw new Error('HOST_CAPTURE_IDENTITY');
  const rows=evidence.accounts??(phase==='before'?evidence.actualLedgerBefore:evidence.actualLedgerAfter)??(phase==='before'?evidence.beforeAccounts:evidence.afterAccounts);
  if(!Array.isArray(rows))throw new Error('HOST_CAPTURE_ACCOUNTS');
  const accounts=new Map(rows.map(row=>[row.address,decodeRow(row)]));
  const rawClock=accounts.get(PROGRAMS.clockSysvar);
  const contextSlot=BigInt(evidence.clock?.slot??evidence.instruction?.clock?.slot??(rawClock?rawClock.data.readBigUInt64LE(0):10n));
  const calls=[];
  const fetchImpl=async(url,options)=>{
    if(url!==opening310Endpoint)throw new Error('HOST_OFFLINE_ONLY');
    const request=parseJsonWithBigInts(options.body);calls.push(request);await onRequest?.({request,accounts,calls});
    const {method,params,id}=request;let result;
    if(method==='getGenesisHash')result=nativeKeyAddress(Buffer.from(opening310Input.genesisHash,'hex'));
    else if(method==='getMultipleAccounts'){
      if(params[1].commitment!=='finalized')throw new Error('HOST_FINALIZED_REQUIRED');
      if(BigInt(params[1].minContextSlot??0n)>contextSlot)throw new Error('HOST_MIN_CONTEXT');
      result={context:{slot:contextSlot},value:params[0].map(address=>rpcAccount(accounts.get(address)??null))};
    }else if(method==='getProgramAccounts'){
      if(params[0]!==opening310Input.programId||params[1].commitment!=='finalized'||params[1].withContext!==true)throw new Error('HOST_NATIVE_CONTEXT');
      if(BigInt(params[1].minContextSlot??0n)>contextSlot)throw new Error('HOST_MIN_CONTEXT');
      const value=[...accounts.values()].filter(a=>a!==null&&a.owner===params[0]&&matches(a,params[1].filters??[]))
        .reverse().map(a=>({pubkey:a.address,account:rpcAccount(a,params[1].dataSlice)}));
      result={context:{slot:contextSlot},value};
    }else if(method==='getTokenAccountsByOwner'){
      if(params[1]?.programId!==PROGRAMS.tokenProgram||params[2]?.commitment!=='finalized')throw new Error('HOST_CLASSIC_FINALIZED_ONLY');
      if(BigInt(params[2].minContextSlot??0n)>contextSlot)throw new Error('HOST_MIN_CONTEXT');
      const owner=nativeKeyBytes(params[0]);const value=[...accounts.values()].filter(a=>a!==null&&a.owner===PROGRAMS.tokenProgram&&a.data.length===165&&a.data.subarray(32,64).equals(owner))
        .reverse().map(a=>({pubkey:a.address,account:rpcAccount(a,params[2].dataSlice)}));
      result={context:{slot:contextSlot},value};
    }else throw new Error('HOST_READ_METHOD_ONLY');
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id,result}),{status:200,headers:{'content-type':'application/json'}});
  };
  return {release:opening310Release,abi:opening310Abi,actor:opening310Actor,endpoint:opening310Endpoint,fetchImpl,calls,accounts,evidence,contextSlot};
}
