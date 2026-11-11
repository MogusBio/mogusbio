import {readFile} from 'node:fs/promises';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {sha256} from '../../protocol-core/src/index.mjs';
import {validateProductionRelease} from '../src/release.mjs';
import {loadNativeAbi,nativeKeyAddress} from '../src/native.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
const saved=async p=>readFile(new URL(`../../../${p}`,import.meta.url));
export const release=await validateProductionRelease(JSON.parse(await saved('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
export const abi=loadNativeAbi(await saved('programs/biolab-economy/operations.p0r2.json'),{expectedHash:release.input.abiHash});
export const bank=parseJsonWithBigInts((await saved('programs/transaction-transport/evidence/part-result-bank-76b35cfb-case-1.json')).toString());
export const actor=bank.actor;
const rows=values=>new Map(values.map(v=>[v.address,v.missing?null:{...v,data:Buffer.from(v.data[0],'base64')}]));
const copy=m=>new Map([...m].map(([a,v])=>[a,v===null?null:{...v,data:Buffer.from(v.data)}]));
const purchased=new Map();for(let c=1;c<=4;c++){const p=parseJsonWithBigInts((await saved(`programs/transaction-transport/evidence/purchase-result-bank-76b35cfb-class-${c}.json`)).toString());for(const [a,v]of rows(p.afterAccounts))purchased.set(a,v);}
export const projectId=Buffer.from(bank.artifactBodyHex.slice(160,224),'hex');
export const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const raw=v=>v===null?null:{owner:v.owner,executable:v.executable,lamports:v.lamports,rentEpoch:v.rentEpoch,data:[v.data.toString('base64'),'base64']};
/** Offline adapters over signed local Bank records. Absent derived addresses
 * belong to the known cold post-purchase bank, never to a live wallet scan.
 * Mutations in tests are explicitly HOST-ONLY and not new native execution. */
export function partFixture(phase='purchased',{onRead}={}){
  const maps={purchased:copy(purchased),before:rows(bank.beforeAccounts),after:rows(bank.afterAccounts),retry:rows(bank.afterRetryAccounts)},calls=[];
  let current=phase,slot=100n,reads=0;
  const fetchImpl=async(url,options)=>{
    const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(req.method==='getLatestBlockhash')result={context:{slot:++slot},value:{blockhash:nativeKeyAddress(sha256(Buffer.from('part local unsigned preparation lifetime'))),lastValidBlockHeight:1000n}};
    else if(req.method==='getMultipleAccounts'){
      if(req.params[1].commitment!=='finalized')throw new Error('TEST_FINALIZED');
      onRead?.({map:maps[current],reads:++reads,addresses:req.params[0],current});
      result={context:{slot:++slot},value:req.params[0].map(a=>raw(maps[current].get(a)??null))};
    }else throw new Error(`unexpected method ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  };
  return {maps,calls,fetchImpl,setPhase:p=>current=p,rpc:new ReadOnlyRpc({release,endpoint:'http://127.0.0.1:1',allowLocalhost:true,fetchImpl})};
}
