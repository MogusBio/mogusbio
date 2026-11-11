import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {DiscoveryStore,readDiscoveryPage} from '../src/discovery.mjs';
import {release,actor,hostDiscoveryFixture,nativeRows} from './discovery-fixture.mjs';
const temp=async t=>{const d=await realpath(await mkdtemp(path.join(os.tmpdir(),'biolab-discovery-rpc-')));t.after(()=>rm(d,{recursive:true,force:true}));return d;};
const read=(f,store,section='projects')=>readDiscoveryPage({release,rpc:f.rpc,discoveryRpc:f.discoveryRpc,store,actor,section});
test('oversize sliced response is subdivided under exact four-scan budget, never accepted as truncated or empty complete',async t=>{
  const f=hostDiscoveryFixture({onRequest:({request})=>request.method==='getProgramAccounts'?new Response('x'.repeat(65537),{headers:{'content-length':'65537'}}):undefined});
  const out=await read(f,new DiscoveryStore({directory:await temp(t)}));assert.equal(out.decision,'DISCOVERY_PAGE');assert.deepEqual(out.rows,[]);assert.ok(out.nextCursor);assert.equal(out.coverage.pending,true);assert.equal(out.coverage.prefixesVisited,'0');assert.equal(f.calls.filter(c=>c.method==='getProgramAccounts').length,4);assert.equal(f.calls.filter(c=>c.method==='getGenesisHash').length,1);assert.equal(f.calls.filter(c=>c.method==='getMultipleAccounts').length,1);
  const scans=f.calls.filter(c=>c.method==='getProgramAccounts');assert.deepEqual(scans.map(c=>c.params[1].filters.filter(f=>f.memcmp?.offset===88n).map(f=>Buffer.from(f.memcmp.bytes,'base64').length)),[[],[1],[2],[3]]);
});
test('row threshold>=256 also subdivides a full parseable response without treating count as a server cursor',async t=>{
  const f=hostDiscoveryFixture({onRequest:({request,map})=>{if(request.method!=='getProgramAccounts')return;const a=nativeRows(map,9)[0],row={pubkey:a.address,account:{owner:a.owner,executable:false,lamports:0n,rentEpoch:0n,space:BigInt(a.data.length),data:[a.data.subarray(88,120).toString('base64'),'base64']}};return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result:{context:{slot:100000n},value:Array(256).fill(row)}}));}});
  const out=await read(f,new DiscoveryStore({directory:await temp(t)}));assert.equal(out.decision,'DISCOVERY_PAGE');assert.equal(out.coverage.pending,true);assert.equal(out.rows.length,0);assert.equal(f.calls.filter(c=>c.method==='getProgramAccounts').length,4);
});
test('abort-ignoring discovery transport is bounded and becomes explicit unavailable rather than an empty wallet',async t=>{
  const f=hostDiscoveryFixture({onRequest:({request})=>request.method==='getProgramAccounts'?new Promise(()=>{}):undefined});const start=performance.now(),out=await read(f,new DiscoveryStore({directory:await temp(t)}));assert.ok(performance.now()-start<5000);assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.coverage.state,'UNAVAILABLE');assert.equal(out.issues[0].code,'DISCOVERY_RPC_TIMEOUT');assert.equal(f.calls.filter(c=>c.method==='getProgramAccounts').length,1);
});
test('a Clock sysvar from beyond its RPC context cannot validate future records',async t=>{
  const f=hostDiscoveryFixture();const clock=[...f.map.values()].find(a=>a?.address==='SysvarC1ock11111111111111111111111111111111');clock.data.writeBigUInt64LE(1n<<63n);const out=await read(f,new DiscoveryStore({directory:await temp(t)}));assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.issues[0].code,'DISCOVERY_BASE_MISMATCH');assert.deepEqual(out.rows,[]);
});
test('persistent overflow reaches full32-byte prefix and fails closed rather than expanding an unbounded queue',async t=>{
  const f=hostDiscoveryFixture({onRequest:({request})=>request.method==='getProgramAccounts'?new Response('x',{headers:{'content-length':'65537'}}):undefined}),store=new DiscoveryStore({directory:await temp(t)});let cursor=null,out;
  for(let i=0;i<9;i++){out=await readDiscoveryPage({release,rpc:f.rpc,discoveryRpc:f.discoveryRpc,store,actor,section:'projects',cursor});if(i<8){assert.equal(out.decision,'DISCOVERY_PAGE');assert.ok(out.nextCursor);}cursor=out.nextCursor;}
  assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.issues[0].code,'DISCOVERY_RPC_INVALID_RESPONSE');assert.equal(f.calls.filter(c=>c.method==='getProgramAccounts').length,33);assert.deepEqual(out.rows,[]);
});
test('truncated JSON, HTTP denial and malformed context are unavailable, never successful empty leaves',async t=>{
  for(const mode of ['json','http','context']){
    const f=hostDiscoveryFixture({onRequest:({request})=>{
      if(request.method!=='getProgramAccounts')return;
      if(mode==='json')return new Response('{"jsonrpc":"2.0",');
      if(mode==='http')return new Response('PRIVATE_PROVIDER_DETAIL',{status:429});
      return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result:{context:{slot:-1n},value:[]}}));
    }}),out=await read(f,new DiscoveryStore({directory:await temp(t)}));assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.deepEqual(out.rows,[]);assert.equal(out.coverage.state,'UNAVAILABLE');assert.equal(out.coverage.prefixesVisited,'0');assert.ok(!JSON.stringify(out).includes('PRIVATE'));
  }
});
