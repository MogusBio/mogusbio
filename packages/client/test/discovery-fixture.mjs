import assert from 'node:assert/strict';
import {getBase58Encoder} from '@solana/kit';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {sha256,typedHash,encodeProjectBody} from '../../protocol-core/src/index.mjs';
import {release,actor,checkpoint,cloneAccounts} from './synthesis-fixture.mjs';
import {recordAccount} from './account-fixture.mjs';
import {nativePda,nativeKeyBytes,nativeKeyAddress} from '../src/native.mjs';
import {PROGRAMS} from '../src/release.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
import {DiscoveryRpc} from '../src/discovery.mjs';

export {release,actor};
export const endpoint='https://discovery-host.invalid/';
export const nativeRows=(map,kind)=>[...map.values()].filter(a=>a?.owner===release.input.programId&&a.data.length>=120&&a.data.readUInt16LE(10)===kind);
const pda=(...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
const wire=(a,slice)=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports,rentEpoch:a.rentEpoch,space:BigInt(a.data.length),data:[(slice?a.data.subarray(Number(slice.offset),Number(slice.offset)+Number(slice.length)):a.data).toString('base64'),'base64']};

/** HOST-only program-created-looking records for deterministic pagination tests.
 * Canonical encoding/PDA does not claim these records executed on chain. */
export async function addHostProject(map,{name='HOST lab',creator=actor,label=name}={}){
  const business=sha256(Buffer.from(`HOST DISCOVERY PROJECT ${label}`)),id=typedHash(17,Buffer.concat([release.domain,business])),classes=[];
  for(let c=1;c<=4;c++){
    const mint=await pda('pack',id,Buffer.from([c])),authority=await pda('pack-auth',id,Buffer.from([c])),data=Buffer.alloc(82);data.writeUInt32LE(1);nativeKeyBytes(authority).copy(data,4);data.writeBigUInt64LE(10n,36);data[45]=1;
    map.set(mint,{address:mint,owner:PROGRAMS.tokenProgram,executable:false,lamports:10000000n,rentEpoch:0n,data});classes.push({class:c,mint:nativeKeyBytes(mint),lifetimeCap:100n,priceLamports:1000n,issued:10n,intakeBurned:0n});
  }
  const clock=map.get(PROGRAMS.clockSysvar).data,body=encodeProjectBody({creator:nativeKeyBytes(creator),creationBusiness:business,catalogHash:release.hashes.catalogHash,saleRecipient:nativeKeyBytes(creator),createdAt:clock.readBigInt64LE(32)-1n,createdSlot:clock.readBigUInt64LE(0)-1n,name,classes});
  const account=await recordAccount(release,{kind:9,seeds:['bio','project',id],id,body});map.set(account.address,account);return {idHex:id.toString('hex'),account};
}
/** Real saved76b bytes plus explicitly HOST mutations. Mechanical offline RPC
 * filtering/slicing is transport evidence, never actual network gPA proof. */
export function hostDiscoveryFixture({map=cloneAccounts(checkpoint),onRequest}={}){
  const calls=[];let slot=100000n;
  const fetchImpl=async(url,options)=>{
    assert.equal(url,endpoint);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const request=parseJsonWithBigInts(options.body);calls.push(request);const override=await onRequest?.({request,map,calls});if(override instanceof Response)return override;
    let result;if(request.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(request.method==='getMultipleAccounts'){
      assert.equal(request.params[1].commitment,'finalized');assert.ok(request.params[0].length<=100);assert.ok(request.params[1].minContextSlot<=slot);result={context:{slot:++slot},value:request.params[0].map(address=>wire(map.get(address)??null))};
    }else if(request.method==='getProgramAccounts'){
      const [program,config]=request.params;assert.equal(program,release.input.programId);assert.equal(config.withContext,true);assert.equal(config.commitment,'finalized');assert.equal(config.encoding,'base64');assert.ok(config.filters.length<=4);assert.ok(config.minContextSlot<=slot);
const values=[...map.values()].filter(a=>a?.owner===program&&config.filters.every(f=>Object.hasOwn(f,'dataSize')?BigInt(a.data.length)===f.dataSize:(()=>{const bytes=f.memcmp.encoding==='base64'?Buffer.from(f.memcmp.bytes,'base64'):Buffer.from(getBase58Encoder().encode(f.memcmp.bytes)),offset=Number(f.memcmp.offset);return a.data.subarray(offset,offset+bytes.length).equals(bytes);})()));
      result={context:{slot:++slot},value:values.reverse().map(a=>({pubkey:a.address,account:wire(a,config.dataSlice)}))};
    }else if(request.method==='getTokenAccountsByOwner'){
      const [owner,filter,config]=request.params;assert.deepEqual(filter,{programId:PROGRAMS.tokenProgram});assert.equal(config.commitment,'finalized');assert.ok(config.minContextSlot<=slot);
      result={context:{slot:++slot},value:[...map.values()].filter(a=>a?.owner===PROGRAMS.tokenProgram&&a.data.length===165&&nativeKeyAddress(a.data.subarray(32,64))===owner).map(a=>({pubkey:a.address,account:wire(a,config.dataSlice)}))};
    }else assert.fail(`non-read HOST discovery method ${request.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result}));
  };
  const runtime={release,endpoint,fetchImpl,requestTimeoutMs:2000};return {map,calls,fetchImpl,runtime,rpc:new ReadOnlyRpc(runtime),discoveryRpc:new DiscoveryRpc(runtime)};
}
