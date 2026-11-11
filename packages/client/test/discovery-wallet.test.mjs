import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {opening310DiscoveryFixture} from '../../../test/discovery-native-fixture.mjs';
import {ReadOnlyRpc} from '../src/rpc.mjs';
import {DiscoveryRpc,DiscoveryStore,readDiscoveryPage,DISCOVERY_SECTIONS} from '../src/discovery.mjs';
import {nativeKeyBytes,nativeKeyAddress} from '../src/native.mjs';
import {PROGRAMS} from '../src/release.mjs';
import {key} from './native-fixture.mjs';
import {hostDiscoveryFixture,addHostProject,nativeRows,release as legacyRelease,actor as legacyActor} from './discovery-fixture.mjs';
import {normalWeight} from '../../settlement/src/weights.mjs';
import {nativePda} from '../src/native.mjs';
const temp=async t=>{const d=await realpath(await mkdtemp(path.join(os.tmpdir(),'biolab-discovery-wallet-')));t.after(()=>rm(d,{recursive:true,force:true}));return d;};
const args=(f,store,section,cursor=null,extra={})=>{const runtime={release:f.release,endpoint:f.endpoint,fetchImpl:f.fetchImpl,allowLocalhost:true,requestTimeoutMs:2000};return {release:f.release,rpc:new ReadOnlyRpc(runtime),discoveryRpc:new DiscoveryRpc(runtime),store,actor:f.actor,section,cursor,...extra};};
async function all(f,store,section){let cursor=null,rows=[],pages=0;do{const before=f.calls.length,out=await readDiscoveryPage(args(f,store,section,cursor));assert.equal(out.decision,'DISCOVERY_PAGE',`${section}: ${JSON.stringify(out.issues)}`);assert.ok(out.rows.length<=8);const calls=f.calls.slice(before);assert.ok(calls.filter(c=>c.method==='getMultipleAccounts').length<=3);assert.ok(calls.filter(c=>c.method==='getProgramAccounts'||c.method==='getTokenAccountsByOwner').length<=4);assert.ok(calls.filter(c=>c.method==='getGenesisHash').length<=1);rows.push(...out.rows);cursor=out.nextCursor;pages++;assert.ok(pages<100);}while(cursor);return {rows,pages};}
test('untouched real67c terminal: one LIVE BIO,120 Sources/remaining300000ticks,61 beneficiary Positions and zero material ATAs',async t=>{
  const f=await opening310DiscoveryFixture(),store=new DiscoveryStore({directory:await temp(t)}),results={};
  for(const section of DISCOVERY_SECTIONS)results[section]=await all(f,store,section);
  assert.equal(results.projects.rows.length,1);assert.equal(results['my-projects'].rows.length,1);
  assert.equal(results.roots.rows.length,1);assert.equal(results.roots.rows[0].target,22);assert.equal(results.roots.rows[0].lifecycle,'LIVE');assert.equal(results.roots.pages,1);
  assert.equal(results.sources.rows.length,120);assert.equal(results.sources.pages,15);assert.equal(new Set(results.sources.rows.map(r=>r.sourceIdHex)).size,120);
  const units=[0n,0n,0n,0n];let remaining=0n;for(const s of results.sources.rows){units[s.class-1]+=BigInt(s.unitCount);s.remainingTick.forEach((n,i)=>{assert.equal(BigInt(n),BigInt(s.initialTick[i])-BigInt(s.spentPrefix[i]));remaining+=BigInt(n);});}
  assert.deepEqual(units,[30n,60n,15n,15n]);assert.equal(remaining,300000n);
  assert.equal(results.positions.rows.length,61);assert.ok(results.positions.rows.some(p=>p.rootLifecycle==='CONSUMED'));assert.equal(results['material-atas'].rows.length,0);
  assert.ok(results['token-owner-hints'].rows.some(r=>r.protocolMatch==='LAB'));assert.ok(results['token-owner-hints'].rows.every(r=>r.manufactureIncluded===false));
  const scans=f.calls.filter(c=>c.method==='getProgramAccounts'),rootScans=scans.filter(c=>Buffer.from(c.params[1].filters[0].memcmp.bytes,'base64').readUInt16LE(10)===12);
  assert.equal(rootScans.length,4);for(let i=0;i<4;i++){const cfg=rootScans[i].params[1],h=Buffer.from(cfg.filters[0].memcmp.bytes,'base64');assert.equal(h.readUInt16LE(12),i+1);assert.ok(cfg.filters.some(x=>x.memcmp?.offset===362n&&x.memcmp.bytes==='AA=='));assert.ok(!cfg.filters.some(x=>x.memcmp?.offset===88n));}
  assert.equal(scans.filter(c=>Buffer.from(c.params[1].filters[0].memcmp.bytes,'base64').readUInt16LE(10)===11).length,1);
});
test('real67c field filters isolate another authenticated wallet without caller-known IDs',async t=>{
  const f=await opening310DiscoveryFixture(),store=new DiscoveryStore({directory:await temp(t)}),other=key(808);
  for(const section of ['my-projects','roots','sources','positions','material-atas','token-owner-hints']){const out=await readDiscoveryPage(args(f,store,section,null,{actor:other}));assert.equal(out.decision,'DISCOVERY_PAGE',JSON.stringify(out.issues));assert.deepEqual(out.rows,[]);assert.equal(out.nextCursor,null);}
});
test('HOST-only Root transfer retains actual old Position beneficiary discovery; Source spend race emits no stale rows',async t=>{
  const moved=await opening310DiscoveryFixture(),other=key(809),root=[...moved.accounts.values()].find(a=>a?.owner===moved.release.input.programId&&a.data.length>=443&&a.data.readUInt16LE(10)===12&&a.data[362]===1);
  nativeKeyBytes(other).copy(root.data,322);root.data.writeBigUInt64LE(root.data.readBigUInt64LE(354)+1n,354);const store=new DiscoveryStore({directory:await temp(t)}),positions=await all(moved,store,'positions');assert.equal(positions.rows.length,61);assert.ok(positions.rows.some(p=>p.instanceHex===root.data.subarray(88,120).toString('hex')&&p.rootOwner===other&&p.beneficiary===moved.actor));
  let gma=0;const race=await opening310DiscoveryFixture({onRequest:({request,accounts})=>{if(request.method==='getMultipleAccounts'&&++gma===3){const source=request.params[0].map(a=>accounts.get(a)).find(a=>a?.owner===moved.release.input.programId&&a.data.length===856&&a.data.readUInt16LE(10)===11);source.data[source.data.length-1]^=1;}}}),out=await readDiscoveryPage(args(race,new DiscoveryStore({directory:await temp(t)}),'sources'));
  assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.coverage.state,'CHANGED');assert.deepEqual(out.rows,[]);assert.ok(out.nextCursor);
});
test('unchanged saved four-purchase prefix discovers positive material ATAs without manufacturing authority',async t=>{
  const f=hostDiscoveryFixture();for(let c=1;c<=4;c++){const p=parseJsonWithBigInts((await readFile(new URL(`../../../programs/transaction-transport/evidence/purchase-result-bank-76b35cfb-class-${c}.json`,import.meta.url),'utf8')));for(const a of p.afterAccounts)f.map.set(a.address,a.missing?null:{...a,data:Buffer.from(a.data[0],'base64')});}
  const out=await readDiscoveryPage({release:legacyRelease,rpc:f.rpc,discoveryRpc:f.discoveryRpc,store:new DiscoveryStore({directory:await temp(t)}),actor:legacyActor,section:'material-atas'});
  assert.equal(out.decision,'DISCOVERY_PAGE',JSON.stringify(out.issues));assert.equal(out.rows.length,4);assert.deepEqual(out.rows.map(r=>r.amount),['30','60','15','15']);assert.ok(out.rows.every(r=>r.manufactureIncluded===false&&r.recordVerified));assert.equal(out.nextCursor,null);assert.ok(f.calls.filter(c=>c.method==='getMultipleAccounts').every(c=>c.params[0].length<=100));
});
test('HOST-only consumed candidate between scan and strict read is CHANGED, not a wallet asset or complete LIVE coverage',async t=>{
  let changed=false;const f=await opening310DiscoveryFixture({onRequest:({request,accounts})=>{if(request.method==='getMultipleAccounts'&&!changed){changed=true;const root=[...accounts.values()].find(a=>a?.owner===f.release.input.programId&&a.data.length===761&&a.data.readUInt16LE(10)===12&&a.data[362]===0);root.data[362]=1;root.data.fill(1,363,427);const clock=accounts.get(PROGRAMS.clockSysvar).data;root.data.writeBigInt64LE(clock.readBigInt64LE(32),427);root.data.writeBigUInt64LE(clock.readBigUInt64LE(0),435);}}}),out=await readDiscoveryPage(args(f,new DiscoveryStore({directory:await temp(t)}),'roots'));
  assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.coverage.state,'CHANGED');assert.deepEqual(out.rows,[]);assert.ok(out.nextCursor);
});
test('HOST-only many identical non-ATA SPL accounts produce explicit OVERFLOW without invented partitioning or manufacture balance',async t=>{
  const f=await opening310DiscoveryFixture(),source=[...f.accounts.values()].find(a=>a?.owner===PROGRAMS.tokenProgram&&a.data.length===165&&nativeKeyAddress(a.data.subarray(32,64))===f.actor);
  for(let i=0;i<260;i++){const address=key(5000+i);f.accounts.set(address,{...source,address,data:Buffer.from(source.data)});}
  const out=await readDiscoveryPage(args(f,new DiscoveryStore({directory:await temp(t)}),'token-owner-hints'));assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.coverage.state,'OVERFLOW');assert.equal(out.nextCursor,null);assert.deepEqual(out.rows,[]);assert.equal(out.issues[0].code,'DISCOVERY_TOKEN_OWNER_OVERFLOW');assert.equal(f.calls.filter(c=>c.method==='getTokenAccountsByOwner').length,1);assert.equal(f.calls.filter(c=>c.method==='getProgramAccounts').length,0);
});
test('HOST-only mathematically self-consistent Position weight cannot diverge from Root B/q/scope, or latest RootReg end',async t=>{
  for(const mode of ['weight','latest-end']){
    const f=await opening310DiscoveryFixture(),position=[...f.accounts.values()].filter(a=>a?.owner===f.release.input.programId&&a.data.length===375&&a.data.readUInt16LE(10)===27).sort((a,b)=>Buffer.compare(a.data.subarray(88,120),b.data.subarray(88,120)))[0];
    if(mode==='weight'){
      const B=position.data.readBigUInt64LE(240)-1n,q=BigInt(position.data.readUInt32LE(248)),weight=normalWeight({scope:'CELL',B_int:B,q_ppm:q});position.data.writeBigUInt64LE(B,240);position.data[252]=6;position.data.writeBigUInt64LE(weight&((1n<<64n)-1n),253);position.data.writeBigUInt64LE(weight>>64n,261);
    }else{
      const instance=position.data.subarray(120,152),address=(await nativePda(f.release.input.programId,'bio','root-reg',instance)).address,rr=f.accounts.get(address);assert.equal(rr.data[200],1);rr.data.writeBigUInt64LE(rr.data.readBigUInt64LE(201)+1n,201);
    }
    const out=await readDiscoveryPage(args(f,new DiscoveryStore({directory:await temp(t)}),'positions'));assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.deepEqual(out.rows,[]);assert.equal(out.issues[0].code,'DISCOVERY_RECORD_INVALID');
  }
});
test('HOST-only more than two funded projects produce at most eight material rows per page without lost projects',async t=>{
  const f=hostDiscoveryFixture();for(const row of nativeRows(f.map,9))f.map.delete(row.address);
  for(let j=0;j<3;j++){const p=await addHostProject(f.map,{name:`HOST funded [${j}]`});for(let c=1;c<=4;c++){
    const mint=(await nativePda(legacyRelease.input.programId,'bio','pack',Buffer.from(p.idHex,'hex'),Buffer.from([c]))).address,address=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(legacyActor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address,data=Buffer.alloc(165);nativeKeyBytes(mint).copy(data);nativeKeyBytes(legacyActor).copy(data,32);data.writeBigUInt64LE(1n,64);data[108]=1;f.map.set(address,{address,owner:PROGRAMS.tokenProgram,executable:false,lamports:10000000n,rentEpoch:0n,data});
  }}
  const store=new DiscoveryStore({directory:await temp(t)}),base={release:legacyRelease,rpc:f.rpc,discoveryRpc:f.discoveryRpc,store,actor:legacyActor,section:'material-atas'},first=await readDiscoveryPage(base);assert.equal(first.decision,'DISCOVERY_PAGE');assert.equal(first.rows.length,8);assert.ok(first.nextCursor);
  const second=await readDiscoveryPage({...base,cursor:first.nextCursor});assert.equal(second.decision,'DISCOVERY_PAGE');assert.equal(second.rows.length,4);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.rows,...second.rows].map(r=>`${r.projectIdHex}/${r.class}`)).size,12);
});
test('HOST-only bounded non-ATA hints remain separate from canonical manufacture balances',async t=>{
  const f=await opening310DiscoveryFixture(),zeroAta=[...f.accounts.values()].find(a=>a?.owner===PROGRAMS.tokenProgram&&a.data.length===165&&nativeKeyAddress(a.data.subarray(32,64))===f.actor&&a.data.readBigUInt64LE(64)===0n),address=key(7001);f.accounts.set(address,{...zeroAta,address,data:Buffer.from(zeroAta.data)});
  const store=new DiscoveryStore({directory:await temp(t)}),hints=await all(f,store,'token-owner-hints'),extra=hints.rows.find(r=>r.address===address);assert.equal(extra.isStandardAta,false);assert.equal(extra.manufactureIncluded,false);assert.equal(extra.protocolMatch,'UNRESOLVED');assert.equal((await all(f,store,'material-atas')).rows.length,0);
});
test('HOST-only wrong Source PDA or substituted Root directory is rejected by the actual closure reader',async t=>{
  for(const mode of ['source-pda','directory']){
    const f=await opening310DiscoveryFixture();
    if(mode==='source-pda'){const source=[...f.accounts.values()].filter(a=>a?.owner===f.release.input.programId&&a.data.length===856&&a.data.readUInt16LE(10)===11).sort((a,b)=>Buffer.compare(a.data.subarray(88,120),b.data.subarray(88,120)))[0],address=key(8500);f.accounts.delete(source.address);f.accounts.set(address,{...source,address});}
    else{
      const root=[...f.accounts.values()].find(a=>a?.owner===f.release.input.programId&&a.data.length===761&&a.data.readUInt16LE(10)===12&&a.data[362]===0),rrAddress=(await nativePda(f.release.input.programId,'bio','root-reg',root.data.subarray(88,120))).address,seq=f.accounts.get(rrAddress).data.subarray(364,372),dirAddress=(await nativePda(f.release.input.programId,'bio','mining-root',seq)).address,dir=f.accounts.get(dirAddress);dir.data.fill(1,129,193);
    }
    const out=await readDiscoveryPage(args(f,new DiscoveryStore({directory:await temp(t)}),mode==='source-pda'?'sources':'roots'));assert.equal(out.decision,'DISCOVERY_BLOCKED');assert.equal(out.issues[0].code,'DISCOVERY_RECORD_INVALID');assert.deepEqual(out.rows,[]);
  }
});
