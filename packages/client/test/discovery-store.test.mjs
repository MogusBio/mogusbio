import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DiscoveryStore,DISCOVERY_SECTIONS} from '../src/discovery.mjs';
import {discoveryBinding,responseFor,validateDiscoveryRequest,publicIssue} from '../src/discovery-core.mjs';
import {release,actor,endpoint} from './discovery-fixture.mjs';
import {key} from './native-fixture.mjs';
const binding=discoveryBinding(release,endpoint),budget={check(){}};
const temp=async t=>{const d=await realpath(await mkdtemp(path.join(os.tmpdir(),'biolab-discovery-store-')));t.after(()=>rm(d,{recursive:true,force:true}));return d;};
const request=(extra={})=>validateDiscoveryRequest({actor,section:'projects',query:'',cursor:null,...extra});
const run=(store,r,{complete=false,padding='',delay=0}={})=>store.run({binding,request:r,budget},async scan=>{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(complete)scan.traversal.lane=scan.section==='roots'?4:1;const rows=padding?[{padding}]:[];return {scan,response:responseFor(binding,r,scan,{rows})};});
test('completed sections do not consume actor active quota; unlimited same-section refresh replaces cursors',async t=>{
  const directory=await temp(t),store=new DiscoveryStore({directory});for(const section of DISCOVERY_SECTIONS){const out=await run(store,request({section}),{complete:true});assert.equal(out.nextCursor,null);}
  let prior;for(let i=0;i<8;i++){const out=await run(store,request());if(prior)await assert.rejects(run(store,request({cursor:prior})),/DISCOVERY_CURSOR_INVALID/);prior=out.nextCursor;}
  const raw=JSON.parse(await readFile(path.join(directory,'discovery-cache.json'),'utf8')),state=JSON.parse(raw.payload);assert.equal(state.scans.filter(s=>s.actor===actor&&s.section==='projects').length,1);assert.equal(state.scans.length,7);
});
test('only four unfinished sections per actor; another actor isolated; TTL and query changes fail closed',async t=>{
  let now=1700000000000;const directory=await temp(t),store=new DiscoveryStore({directory,clock:()=>now});let page;
  for(const section of ['projects','my-projects','sources','positions'])page=await run(store,request({section}));
  await assert.rejects(run(store,request({section:'roots'})),/DISCOVERY_CACHE_LIMIT/);
  const other=key(95);await run(store,request({actor:other}));await assert.rejects(run(store,request({actor:other,cursor:page.nextCursor,section:'positions'})),/DISCOVERY_CURSOR_INVALID/);
  assert.throws(()=>request({section:'positions',cursor:page.nextCursor,query:'x'}),/DISCOVERY_REQUEST_QUERY/);
  now+=1800001;await assert.rejects(run(new DiscoveryStore({directory,clock:()=>now}),request({section:'positions',cursor:page.nextCursor})),/DISCOVERY_CURSOR_INVALID/);
  const resumed=await run(new DiscoveryStore({directory,clock:()=>now}),request());assert.ok(resumed.nextCursor);const state=JSON.parse(JSON.parse(await readFile(path.join(directory,'discovery-cache.json'),'utf8')).payload);assert.equal(state.scans.length,1);
});
test('same cursor concurrency produces one durable next page and exact replay after restart',async t=>{
  const directory=await temp(t),store=new DiscoveryStore({directory}),first=await run(store,request());
  const r=request({cursor:first.nextCursor});const [a,b]=await Promise.all([run(store,r,{delay:20}),run(new DiscoveryStore({directory}),r,{delay:20})]);assert.deepEqual(a,b);const replay=await run(new DiscoveryStore({directory}),r);assert.deepEqual(replay,a);
  await run(store,request({cursor:a.nextCursor}));await assert.rejects(run(store,r),/DISCOVERY_CURSOR_INVALID/);
});
test('global retained limit is real and completed entries are evicted before an active scan is refused',async t=>{
  const directory=await temp(t),store=new DiscoveryStore({directory});for(let i=0;i<128;i++)await run(store,request({actor:key(1000+i)}));
  await assert.rejects(run(store,request({actor:key(2000)})),/DISCOVERY_CACHE_LIMIT/);
  // Complete one existing section using its actual stored cursor, then admit one.
  const state=JSON.parse(JSON.parse(await readFile(path.join(directory,'discovery-cache.json'),'utf8')).payload),old=state.scans[0];await run(store,request({actor:old.actor,cursor:old.cursor}),{complete:true});await run(store,request({actor:key(2000)}));
  const after=JSON.parse(JSON.parse(await readFile(path.join(directory,'discovery-cache.json'),'utf8')).payload);assert.equal(after.scans.length,128);assert.equal(after.scans.some(s=>s.actor===old.actor),false);
});
test('single CAS aggregate byte cap is independent of row/actor/global limits',async t=>{
  const directory=await temp(t),store=new DiscoveryStore({directory});let blocked=false;
  for(let i=0;i<50;i++){try{await run(store,request({actor:key(3000+i)}),{padding:'x'.repeat(240000)});}catch(error){assert.equal(publicIssue(error),'DISCOVERY_CACHE_LIMIT');blocked=true;break;}}
  assert.equal(blocked,true);const state=JSON.parse(await readFile(path.join(directory,'discovery-cache.json'),'utf8'));assert.ok(Buffer.byteLength(state.payload)<=8*1024*1024);assert.ok(Buffer.byteLength(state.payload)<16*1024*1024);
});
