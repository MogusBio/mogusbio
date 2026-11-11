import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createPrivateKey,createHash,sign} from 'node:crypto';
import {mkdtemp,realpath,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOperatorBridge} from '../packages/bridge/src/operator-bridge.mjs';
import {createPublicAuth} from '../packages/bridge/src/public-auth.mjs';
import {createPublicGateway} from '../apps/gateway/main.mjs';
import {nativeKeyBytes} from '../packages/client/src/native.mjs';
import {key} from '../packages/client/test/native-fixture.mjs';
import {opening310DiscoveryFixture} from './discovery-native-fixture.mjs';

const query=(actor,section,cursor=null,text='')=>({actor,section,cursor,query:text});
async function fixture(run){
  const f=await opening310DiscoveryFixture(),directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-discovery-bridge-'));
  const options={release:f.release,abi:f.abi,endpoint:f.endpoint,stateDirectory:directory,allowLocalhost:true,fetchImpl:f.fetchImpl};
  try{const bridge=await createOperatorBridge(options);await run({...f,directory,bridge,options});}
  finally{await rm(directory,{recursive:true,force:true});}
}
async function allPages(bridge,actor,section){
  const rows=[];let cursor=null,last;
  for(let i=0;i<256;i++){
    last=await bridge.dispatch('discovery-read',query(actor,section,cursor));
    assert.equal(last.decision,'DISCOVERY_PAGE',JSON.stringify(last));
    rows.push(...last.rows);cursor=last.nextCursor;
    if(cursor===null)return {rows,last};
  }
  assert.fail('bounded actual fixture did not exhaust traversal');
}
function assertReadOnly(value){
  assert.deepEqual(value.readFlags,{transactionExecuted:false,networkSubmitted:false,reservesOnChainNonce:false,discoveryOnly:true,actionEligibilityVerified:false});
  assert.equal(value.intent,undefined);assert.equal(value.envelope,undefined);
  assert.equal(value.coverage.cryptographicComplete,false);assert.equal(value.coverage.fullWallet,false);
}

test('HOST actual67c project discovery finds a chain-created project without known IDs or transaction journals and reconnects strict project reading',async()=>fixture(async f=>{
  const info=f.bridge.publicConfig();assert.equal(info.discovery.profile,'BIO-DISCOVERY1');assert.equal(info.discovery.readOnly,true);
  assert.ok(info.discovery.sections.includes('projects'));
  const result=await f.bridge.dispatch('discovery-read',query(f.actor,'projects'));
  assert.equal(result.decision,'DISCOVERY_PAGE');assert.equal(result.rows.length,1);assert.equal(result.nextCursor,null);assertReadOnly(result);
  const p=result.rows[0];assert.equal(p.type,'PROJECT');assert.equal(p.recordVerified,true);assert.equal(p.creator,f.actor);assert.equal(p.classes.length,4);
  assert.deepEqual(p.classes.map(c=>c.issued),['30','60','15','15']);assert.deepEqual(p.classes.map(c=>c.intakeBurned),['30','60','15','15']);
  const read=await f.bridge.dispatch('project-read',{actor:f.actor,projectIdHex:p.projectIdHex});
  assert.equal(read.projectRecordVerified,true);assert.equal(read.project.projectIdHex,p.projectIdHex);
  const search=await f.bridge.dispatch('discovery-read',query(f.actor,'projects',null,p.projectIdHex.toUpperCase()));
  assert.deepEqual(search.rows.map(r=>r.projectIdHex),[p.projectIdHex]);
  const noMatch=await f.bridge.dispatch('discovery-read',query(f.actor,'projects',null,'does-not-match-this-project'));
  assert.equal(noMatch.rows.length,0);assert.equal(noMatch.nextCursor,null);assert.equal(noMatch.coverage.state,'TRAVERSAL_EXHAUSTED');
  const binding={releaseHash:info.releaseHash,abiHash:info.abiHash,domainHex:info.domainHex,configHex:info.configHex};
  const namespace=createHash('sha256').update(JSON.stringify(binding)).digest('hex');
  assert.equal((await readdir(path.join(f.directory,namespace))).includes(nativeKeyBytes(f.actor).toString('hex')),false);
  assert.ok(f.calls.every(c=>['getGenesisHash','getMultipleAccounts','getProgramAccounts'].includes(c.method)));
}));

test('HOST actual67c wallet discovery returns one LIVE BIO and all61 historical beneficiaries while preserving consumed parents and exact paid debts',async()=>fixture(async f=>{
  const begin=f.calls.length,roots=await allPages(f.bridge,f.actor,'roots');
  assert.equal(roots.rows.length,1);assert.equal(roots.rows[0].type,'ROOT');assert.equal(roots.rows[0].target,22);
  assert.equal(roots.rows[0].lifecycle,'LIVE');assert.equal(roots.rows[0].owner,f.actor);assert.equal(roots.rows[0].qualityPpm,'2000000');
  assert.ok(f.calls.length-begin<=8,'a standard wallet must not scan256 consumed-ancestor partitions');
  const asset=await f.bridge.dispatch('asset-read',{actor:f.actor,instanceHex:roots.rows[0].instanceHex,positionPageStart:'0',positionPageLimit:10});
  assert.equal(asset.root.owner,f.actor);assert.equal(asset.positions.length,1);
  const first=await f.bridge.dispatch('discovery-read',query(f.actor,'positions'));
  assert.equal(first.rows.length,8);assert.notEqual(first.nextCursor,null);assertReadOnly(first);
  const second=await f.bridge.dispatch('discovery-read',query(f.actor,'positions',first.nextCursor));
  const replay=await f.bridge.dispatch('discovery-read',query(f.actor,'positions',first.nextCursor));assert.deepEqual(replay,second);
  const rows=[...first.rows,...second.rows];let last=second;
  for(let i=0;last.nextCursor!==null&&i<32;i++){
    last=await f.bridge.dispatch('discovery-read',query(f.actor,'positions',last.nextCursor));assert.equal(last.decision,'DISCOVERY_PAGE');rows.push(...last.rows);
  }
  assert.equal(last.nextCursor,null);assert.equal(rows.length,61);assert.equal(new Set(rows.map(r=>r.positionIdHex)).size,61);
  assert.ok(rows.some(r=>r.rootLifecycle==='CONSUMED'));assert.ok(rows.some(r=>r.rootLifecycle==='LIVE'));
  assert.ok(rows.every(r=>r.beneficiary===f.actor&&r.end!==null&&r.nextUnsettledHour===r.end&&r.accrued===r.paid));
  assert.equal(rows.reduce((n,r)=>n+BigInt(r.paid),0n),49024940n);
  assert.equal(last.coverage.state,'TRAVERSAL_EXHAUSTED');
}));

test('HOST actual67c source discovery accounts120 original units and300000 remaining ticks without recreating burned material tokens or paid LAB',async()=>fixture(async f=>{
  const sources=await allPages(f.bridge,f.actor,'sources');assert.equal(sources.rows.length,120);
  assert.equal(new Set(sources.rows.map(r=>r.sourceIdHex)).size,120);
  const units=Array(4).fill(0n),remaining=Array(32).fill(0n);
  for(const row of sources.rows){assert.equal(row.type,'SOURCE');assert.equal(row.owner,f.actor);units[row.class-1]+=BigInt(row.unitCount);row.remainingTick.forEach((n,i)=>{remaining[i]+=BigInt(n);});}
  assert.deepEqual(units,[30n,60n,15n,15n]);assert.equal(remaining.reduce((a,b)=>a+b,0n),300000n);
  const material=await allPages(f.bridge,f.actor,'material-atas');assert.equal(material.rows.length,0);assert.equal(material.last.coverage.state,'TRAVERSAL_EXHAUSTED');
  const hints=await allPages(f.bridge,f.actor,'token-owner-hints'),lab=hints.rows.find(r=>r.protocolMatch==='LAB');
  assert.ok(lab);assert.equal(lab.amount,'1024940');assert.equal(lab.manufactureIncluded,false);
  assertReadOnly(material.last);assertReadOnly(hints.last);
}));

test('discovery bridge rejects runtime replacement and malformed exact request fields before any fetch or cache allocation',async()=>fixture(async f=>{
  const before=await readdir(f.directory),body=query(f.actor,'projects');
  for(const bad of [{...body,endpoint:'https://evil.example'},{...body,owner:key(8)},{...body,programId:key(2)},
    {...body,section:'getProgramAccounts'},{...body,cursor:'../private'},{...body,query:'\u0000'},
    {...body,section:'roots',query:'not-empty'},{...body,query:'a'.repeat(129)},{actor:f.actor,section:'projects',cursor:null}])
    await assert.rejects(f.bridge.dispatch('discovery-read',bad));
  assert.equal(f.calls.length,0);assert.deepEqual(await readdir(f.directory),before);
}));

test('changing the trusted RPC preserves business namespaces but restarts only endpoint-bound read discovery',async()=>fixture(async f=>{
  const a=await f.bridge.dispatch('discovery-read',query(f.actor,'positions'));assert.equal(a.decision,'DISCOVERY_PAGE');assert.notEqual(a.nextCursor,null);
  const other=await createOperatorBridge({...f.options,endpoint:'http://127.0.0.1:2/',fetchImpl:(_url,options)=>f.fetchImpl(f.endpoint,options)});
  const old=await other.dispatch('discovery-read',query(f.actor,'positions',a.nextCursor));assert.equal(old.decision,'DISCOVERY_RESTART_REQUIRED');assert.deepEqual(old.rows,[]);
  const fresh=await other.dispatch('discovery-read',query(f.actor,'positions'));assert.equal(fresh.decision,'DISCOVERY_PAGE');assert.equal(fresh.rows.length,8);
  const resumed=await f.bridge.dispatch('discovery-read',query(f.actor,'positions',a.nextCursor));assert.equal(resumed.decision,'DISCOVERY_PAGE');assert.equal(resumed.rows.length,8);
  assert.equal(other.publicConfig().releaseHash,f.bridge.publicConfig().releaseHash);assert.equal(other.publicConfig().configHex,f.bridge.publicConfig().configHex);
}));

const origin='https://biolab.example';
async function http(runtime,{url,body,headers={}}){
  const req=Readable.from([Buffer.from(JSON.stringify(body??{}))]);req.method='POST';req.url=url;req.headers={host:'biolab.example',origin,'content-type':'application/json',...headers};req.socket={remoteAddress:'127.0.0.1',localPort:4318};
  const out={headers:{}},res={setHeader(k,v){out.headers[k]=v;},writeHead(status,h){out.status=status;Object.assign(out.headers,h);},end(b){out.body=JSON.parse(Buffer.from(b).toString());}};
  await runtime.handler(req,res);return out;
}
async function login(runtime,n){
  const actor=key(n),challenge=await http(runtime,{url:'/api/auth/challenge',body:{actor}});assert.equal(challenge.status,200);
  const seed=createHash('sha256').update(n<7?`BIOP0R2 native SIGNING FIXTURE ONLY ${n}`:`BIOCLIENT pure unit key ${n}`).digest();
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
  const signatureBase64=sign(null,Buffer.from(challenge.body.message),privateKey).toString('base64');
  const logged=await http(runtime,{url:'/api/auth/login',body:{challengeId:challenge.body.challengeId,signatureBase64}});assert.equal(logged.status,200);
  return logged.headers['set-cookie'].split(';')[0];
}
test('HOST actual67c public HTTP discovery requires the right wallet and does not leak an author cursor to another authenticated actor',async()=>fixture(async f=>{
  const auth=await createPublicAuth({release:f.release,abi:f.abi,origin,stateDirectory:path.join(f.directory,'auth')});
  const nativeBridge={dispatch:f.bridge.dispatch,publicConfig:()=>({...f.bridge.publicConfig(),chain:'solana:localnet'})};
  const runtime=createPublicGateway({release:f.release,abi:f.abi,nativeBridge,auth,origin});
  const body=query(f.actor,'positions');let response=await http(runtime,{url:'/api/native/discovery-read',body});assert.equal(response.status,401);assert.equal(f.calls.length,0);
  const a=await login(runtime,1),b=await login(runtime,8);assert.equal(key(1),f.actor);
  response=await http(runtime,{url:'/api/native/discovery-read',body,headers:{cookie:a}});assert.equal(response.status,200);assert.equal(response.body.rows.length,8);
  const calls=f.calls.length;
  const wrong=await http(runtime,{url:'/api/native/discovery-read',body,headers:{cookie:b}});assert.equal(wrong.status,403);assert.equal(wrong.body.code,'PUBLIC_ACTOR_MISMATCH');assert.equal(f.calls.length,calls);
  const foreign=await http(runtime,{url:'/api/native/discovery-read',body:query(key(8),'positions',response.body.nextCursor),headers:{cookie:b}});
  assert.equal(foreign.status,200);assert.equal(foreign.body.decision,'DISCOVERY_RESTART_REQUIRED');assert.deepEqual(foreign.body.rows,[]);
  const csrf=await http(runtime,{url:'/api/native/discovery-read',body,headers:{cookie:a,origin:'https://evil.example'}});assert.equal(csrf.status,403);
  await http(runtime,{url:'/api/auth/logout',body:{},headers:{cookie:a}});
  assert.equal((await http(runtime,{url:'/api/native/discovery-read',body,headers:{cookie:a}})).status,401);
}));
