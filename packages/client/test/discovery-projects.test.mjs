import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {DISCOVERY_SECTIONS,validateDiscoveryRequest,DiscoveryStore,readDiscoveryPage,DiscoveryRpc} from '../src/discovery.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
import {nativeKeyBytes} from '../src/native.mjs';
import {release,actor,endpoint,hostDiscoveryFixture,addHostProject,nativeRows} from './discovery-fixture.mjs';
import {key} from './native-fixture.mjs';

const temp=async t=>{const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'biolab-discovery-')));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;};
const read=(f,store,extra={})=>readDiscoveryPage({release,rpc:f.rpc,discoveryRpc:f.discoveryRpc,store,actor,section:'projects',...extra});
function freshTransport(f){return {...f,rpc:new ReadOnlyRpc(f.runtime),discoveryRpc:new DiscoveryRpc(f.runtime)};}
test('pure exact request validation, seven fixed sections and UTF8/query/cursor policy reject before IO',()=>{
  assert.deepEqual(DISCOVERY_SECTIONS,['projects','my-projects','roots','sources','positions','material-atas','token-owner-hints']);
  assert.equal(validateDiscoveryRequest({actor,section:'projects',cursor:null,query:' e\u0301 '} ).query,'é');
  assert.throws(()=>validateDiscoveryRequest({actor,section:'projects',cursor:null}),/DISCOVERY_REQUEST_FIELDS/);
  for(const query of ['\n','a'.repeat(129),'😀'.repeat(33),'\ud800'])assert.throws(()=>validateDiscoveryRequest({actor,section:'projects',cursor:null,query}),/DISCOVERY_REQUEST_QUERY/);
  assert.throws(()=>validateDiscoveryRequest({actor,section:'roots',cursor:null,query:' '}),/DISCOVERY_REQUEST_QUERY/);
  assert.throws(()=>validateDiscoveryRequest({actor,section:'projects',cursor:'AA'.repeat(32),query:''}),/DISCOVERY_REQUEST_CURSOR/);
  assert.throws(()=>validateDiscoveryRequest({actor:'nope',section:'projects',cursor:null,query:''}),/DISCOVERY_REQUEST_ACTOR/);
});
test('unchanged saved76b Project is truly found without supplied IDs; exact slice filters and bounded full closure',async t=>{
  const directory=await temp(t),f=hostDiscoveryFixture(),store=new DiscoveryStore({directory}),out=await read(f,store);
  assert.equal(out.decision,'DISCOVERY_PAGE');assert.equal(out.rows.length,1);assert.equal(out.nextCursor,null);assert.equal(out.coverage.state,'TRAVERSAL_EXHAUSTED');assert.equal(out.coverage.fullWallet,false);
  assert.equal(out.rows[0].projectIdHex,nativeRows(f.map,9)[0].data.subarray(88,120).toString('hex'));assert.equal(out.rows[0].classes.length,4);assert.equal(out.rows[0].recordVerified,true);assert.doesNotThrow(()=>JSON.stringify(out));
  assert.deepEqual(f.calls.map(c=>c.method),['getGenesisHash','getProgramAccounts','getMultipleAccounts','getMultipleAccounts','getMultipleAccounts']);
  const scan=f.calls[1].params[1];assert.deepEqual(scan.dataSlice,{offset:88n,length:32n});assert.equal(scan.filters.length,1);assert.equal(scan.filters[0].memcmp.encoding,'base64');const header=Buffer.from(scan.filters[0].memcmp.bytes,'base64');assert.equal(header.length,80);assert.equal(header.readUInt16LE(10),9);assert.equal(header.readUInt16LE(12),1);
  assert.equal((await stat(path.join(directory,'discovery-cache.json'))).mode&0o777,0o600);const disk=await readFile(path.join(directory,'discovery-cache.json'),'utf8');assert.ok(!disk.includes('frameHex'));assert.ok(!disk.includes('NativePlayerSession'));
});
test('empty deployment finishes with one precise small probe, not256 calls',async t=>{
  const f=hostDiscoveryFixture();for(const a of nativeRows(f.map,9))f.map.delete(a.address);const out=await read(f,new DiscoveryStore({directory:await temp(t)}));
  assert.equal(out.decision,'DISCOVERY_PAGE');assert.deepEqual(out.rows,[]);assert.equal(out.nextCursor,null);assert.equal(f.calls.filter(c=>c.method==='getProgramAccounts').length,1);assert.equal(f.calls.filter(c=>c.method==='getMultipleAccounts').length,1);
});
test('server query searches beyond first eight candidates and binds cursor across restart; replay makes no RPC',async t=>{
  const f=hostDiscoveryFixture();for(const a of nativeRows(f.map,9))f.map.delete(a.address);const projects=[];for(let i=0;i<12;i++)projects.push(await addHostProject(f.map,{name:`HOST unique [${i}]`,label:`paged-${i}`}));projects.sort((a,b)=>a.idHex<b.idHex?-1:1);
  const wanted=projects[10];
  const projectQuery=(await import('../../protocol-core/src/index.mjs')).decodeProjectBody(wanted.account.data.subarray(120)).name;
  const directory=await temp(t),store=new DiscoveryStore({directory}),first=await read(f,store,{query:projectQuery});assert.equal(first.rows.length,0);assert.ok(first.nextCursor);assert.equal(first.coverage.pending,true);
  const second=await read(freshTransport(f),new DiscoveryStore({directory}),{query:projectQuery,cursor:first.nextCursor});assert.deepEqual(second.rows.map(r=>r.projectIdHex),[wanted.idHex]);assert.equal(second.nextCursor,null);
  const count=f.calls.length,replay=await read(freshTransport(f),new DiscoveryStore({directory}),{query:projectQuery,cursor:first.nextCursor});assert.deepEqual(replay,second);assert.equal(f.calls.length,count);
  const wrong=await read(freshTransport(f),store,{query:'changed query',cursor:first.nextCursor});assert.equal(wrong.decision,'DISCOVERY_RESTART_REQUIRED');assert.deepEqual(wrong.rows,[]);assert.equal(wrong.coverage.pending,false);assert.equal(wrong.nextCursor,null);assert.equal(f.calls.length,count);
});
test('creator scope is precise, complete-ID/address searches work and refresh replaces prior cursor',async t=>{
  const f=hostDiscoveryFixture(),foreign=key(81),p=await addHostProject(f.map,{name:'foreign creator lab',creator:foreign});for(let i=0;i<9;i++)await addHostProject(f.map,{name:`other ${i}`});const directory=await temp(t),store=new DiscoveryStore({directory});
  const own=await read(f,store,{section:'my-projects'});assert.ok(own.rows.every(r=>r.creator===actor));const filter=f.calls.find(c=>c.method==='getProgramAccounts').params[1].filters.find(f=>f.memcmp?.offset===120n);assert.equal(filter.memcmp.encoding,'base64');assert.deepEqual(Buffer.from(filter.memcmp.bytes,'base64'),nativeKeyBytes(actor));
  const first=await read(freshTransport(f),store);assert.ok(first.nextCursor);await read(freshTransport(f),store);const old=await read(freshTransport(f),store,{cursor:first.nextCursor});assert.equal(old.decision,'DISCOVERY_RESTART_REQUIRED');
  for(const query of [p.idHex.toUpperCase(),foreign]){let page=await read(freshTransport(f),store,{query}),rows=[...page.rows];while(page.nextCursor){page=await read(freshTransport(f),store,{query,cursor:page.nextCursor});rows.push(...page.rows);}assert.deepEqual(rows.map(r=>r.projectIdHex),[p.idHex]);}
});
test('RPC errors and external sensitive-looking error codes cannot become empty success or public secrets',async t=>{
  for(const mode of ['throw','rpc','owner','duplicate']){
    const f=hostDiscoveryFixture({onRequest:({request,map})=>{
      if(request.method!=='getProgramAccounts')return;
      if(mode==='throw')throw Object.assign(new Error('PRIVATE_SENSITIVE_DETAIL'),{code:'PRIVATE_SENSITIVE_CODE'});
      if(mode==='rpc')return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,error:{code:-32000n,message:'PRIVATE_RPC_DETAIL'}}));
      const a=nativeRows(map,9)[0],row={pubkey:a.address,account:{owner:mode==='owner'?actor:a.owner,executable:false,lamports:a.lamports,rentEpoch:a.rentEpoch,space:BigInt(a.data.length),data:[a.data.subarray(88,120).toString('base64'),'base64']}};
      return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result:{context:{slot:100001n},value:mode==='duplicate'?[row,row]:[row]}}));
    }}),out=await read(f,new DiscoveryStore({directory:await temp(t)}));assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.coverage.state,'UNAVAILABLE');assert.deepEqual(out.rows,[]);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
  }
});
test('project or mint changes during final reread return CHANGED without consuming the candidate buffer',async t=>{
  let reads=0;const f=hostDiscoveryFixture({onRequest:({request,map})=>{if(request.method==='getMultipleAccounts'&&++reads===3){const p=nativeRows(map,9)[0];p.data[p.data.length-1]^=1;}}}),store=new DiscoveryStore({directory:await temp(t)}),out=await read(f,store);
  assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.coverage.state,'CHANGED');assert.deepEqual(out.rows,[]);assert.ok(out.nextCursor);assert.equal(out.issues[0].code,'DISCOVERY_RECORD_CHANGED');
});
