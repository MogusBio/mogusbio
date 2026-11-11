import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { FileJournalStore } from '../packages/client/src/file-journal.mjs';
import { readServiceHealth } from '../apps/service/supervisor.mjs';
import { acquireServiceLease,readServiceJournal } from '../apps/service/lease.mjs';
import { publicServiceHealth,projectServiceHealth } from '../apps/service/public-health.mjs';
import { serviceFixture } from './service-fixture.mjs';

// Transport/account mutations remain HOST-only; status itself makes zero RPCs.
async function changeRecord(f,name,fn){const s=await FileJournalStore.open({directory:f.config.stateDirectory,name}),v=await s.load(),body=JSON.parse(v.payload);await s.compareAndSwap(v.revision,JSON.stringify(fn(body)));}
const held=(extra={})=>({version:'BIO-SERVICE-LEASE1',state:'HELD',host:hostname(),pid:process.pid,token:'HOST-health-test-token',...extra});
async function seed(f){const s=await f.open();await s.tick();await s.close();}

test('missing process/log/lease reads STOPPED without creating any file or contacting RPC',async()=>{
  const f=await serviceFixture({sendEnabled:false});try{
    await assert.rejects(fs.stat(f.config.stateDirectory),{code:'ENOENT'});
    const raw=await readServiceHealth(f.args),pub=await publicServiceHealth(()=>readServiceHealth(f.args));
    assert.equal(raw.processState,'STOPPED');assert.equal(raw.stopped,true);assert.equal(pub.processState,'STOPPED');assert.equal(pub.configured,true);
    await assert.rejects(fs.stat(f.config.stateDirectory),{code:'ENOENT'});assert.equal(f.calls.length,0);
    assert.deepEqual(await readServiceJournal(f.config.stateDirectory,'service-lease.json'),{revision:0n,payload:null});
  }finally{await f.cleanup();}
});

test('same-host live lease is RUNNING only after persistent tick and heartbeat; stop and release are STOPPED',async()=>{
  const f=await serviceFixture({sendEnabled:false});let s;try{
    s=await f.open();assert.equal((await readServiceHealth(f.args)).processState,'UNKNOWN');
    await s.tick();const before=await readServiceJournal(f.config.stateDirectory,'service-lease.json'),raw=await readServiceHealth(f.args);
    assert.equal(raw.processState,'RUNNING');assert.ok(Number.isSafeInteger(raw.lastTickAt));assert.ok(raw.heartbeatAt>=raw.lastTickAt);assert.equal(raw.stopped,false);
    const pub=await publicServiceHealth(()=>readServiceHealth(f.args));assert.equal(pub.processState,'RUNNING');assert.equal(pub.mode,'PLAN_ONLY');assert.equal(pub.ticks,1);assert.equal(pub.states.WAIT_OPERATOR,1);
    assert.deepEqual(await readServiceJournal(f.config.stateDirectory,'service-lease.json'),before);
    await s.stop();assert.equal((await readServiceHealth(f.args)).processState,'STOPPED');
    assert.equal(JSON.parse((await readServiceJournal(f.config.stateDirectory,'service-lease.json')).payload).state,'HELD');
    await s.close();assert.equal((await readServiceHealth(f.args)).processState,'STOPPED');assert.equal(s.health().processState,'STOPPED');
    s=await f.open();assert.equal((await readServiceHealth(f.args)).processState,'UNKNOWN');await s.tick();assert.equal((await readServiceHealth(f.args)).processState,'RUNNING');
  }finally{await s?.close();await f.cleanup();}
});

test('proven dead owner, foreign host, stale heartbeat and malformed lease never masquerade as RUNNING or steal lease',async()=>{
  const f=await serviceFixture({sendEnabled:false});try{
    await seed(f);const table=[
      [held({pid:2147483647}),'OWNER_DEAD'],
      [held({host:hostname()+'-other-host'}),'UNKNOWN'],
      [{...held(),pid:0},'UNKNOWN'],
      [held(),'RUNNING']
    ];
    for(const [owner,expected]of table){await changeRecord(f,'service-lease.json',()=>owner);const before=await readServiceJournal(f.config.stateDirectory,'service-lease.json'),calls=f.calls.length;assert.equal((await readServiceHealth(f.args)).processState,expected);assert.deepEqual(await readServiceJournal(f.config.stateDirectory,'service-lease.json'),before);assert.equal(f.calls.length,calls);await assert.rejects(acquireServiceLease(f.config.stateDirectory));}
    await changeRecord(f,'supervisor.json',v=>({...v,lastTickAt:Date.now()-30001,heartbeatAt:Date.now()-30001}));assert.equal((await readServiceHealth(f.args)).processState,'UNKNOWN');
    await changeRecord(f,'supervisor.json',v=>({...v,lastTickAt:Date.now()+60000,heartbeatAt:Date.now()+60000}));assert.equal((await readServiceHealth(f.args)).processState,'UNKNOWN');
    await changeRecord(f,'supervisor.json',v=>({...v,lastTickAt:null,heartbeatAt:null}));assert.equal((await readServiceHealth(f.args)).processState,'UNKNOWN');
    await fs.unlink(path.join(f.config.stateDirectory,'service-lease.json'));assert.equal((await readServiceHealth(f.args)).processState,'STOPPED');await assert.rejects(fs.stat(path.join(f.config.stateDirectory,'service-lease.json')),{code:'ENOENT'});
  }finally{await f.cleanup();}
});

test('STOP file overrides a live lease without acquiring or changing it; corrupted state fails closed',async()=>{
  const f=await serviceFixture({sendEnabled:false});try{
    await seed(f);await changeRecord(f,'service-lease.json',()=>held());const before=await readServiceJournal(f.config.stateDirectory,'service-lease.json');await fs.writeFile(path.join(f.config.stateDirectory,'STOP'),'HOST stop',{mode:0o600});assert.equal((await readServiceHealth(f.args)).processState,'STOPPED');assert.deepEqual(await readServiceJournal(f.config.stateDirectory,'service-lease.json'),before);
    await fs.writeFile(path.join(f.config.stateDirectory,'supervisor.json'),'private-corrupt-path-token',{mode:0o600});const pub=await publicServiceHealth(()=>readServiceHealth(f.args));assert.equal(pub.processState,'UNKNOWN');assert.equal(pub.configured,false);assert.equal(pub.ticks,null);assert.ok(!JSON.stringify(pub).includes('private-corrupt'));
  }finally{await f.cleanup();}
});

test('public projection has a closed schema and fixed state keys, strips all identities/secrets and counts current quote/budget blockers',async()=>{
  const secret='PRIVATE-author-job-workflow-path-salt-token';
  const raw={version:'BIO-SERVICE-HEALTH1',configured:true,processState:'RUNNING',mode:'AUTHORIZED_SEND',ticks:30,confirmed:4,privatePath:secret,author:secret,salt:secret,lanes:[
    {name:secret,actor:secret,kind:'global',state:'WAIT_DEPENDENCY',errorCode:'SERVICE_FEE_QUOTE_UNAVAILABLE',backlogHours:'13',workflowId:secret},
    {name:secret,actor:secret,kind:'research',state:'WAIT_DEPENDENCY',errorCode:'SERVICE_SPENDING_LIMIT'},
    {name:secret,state:'WAIT_QUOTE'},
    {name:secret,state:secret,errorCode:secret},
    {state:'WAIT_PENDING_FINALITY'},
    {state:'CANCEL_CONFIRMED'},
    {state:'CONFIRMED'}
  ]};
  const p=projectServiceHealth(raw);assert.deepEqual(Object.keys(p).sort(),['backlog','budgetBlocked','configured','confirmed','mode','processState','quoteUnavailable','states','ticks']);assert.equal(p.backlog,'13');assert.equal(p.quoteUnavailable,2);assert.equal(p.budgetBlocked,1);assert.equal(p.states.WAIT_DEPENDENCY,3);assert.equal(p.states.UNKNOWN,1);assert.equal(p.states.PENDING,1);assert.equal(p.states.CANCELLED,1);assert.equal(p.states.CONFIRMED,1);assert.ok(!JSON.stringify(p).includes(secret));assert.ok(!JSON.stringify(p).includes('actor'));assert.deepEqual(await publicServiceHealth(()=>raw),p);
  for(const provider of [undefined,{},()=>null,()=>{throw Error(secret);}]){const u=await publicServiceHealth(provider);assert.equal(u.processState,'UNKNOWN');assert.equal(u.configured,false);assert.equal(u.ticks,null);assert.equal(u.quoteUnavailable,null);assert.ok(!JSON.stringify(u).includes(secret));}
  assert.equal(projectServiceHealth({...raw,processState:secret}).processState,'UNKNOWN');assert.equal(projectServiceHealth({...raw,ticks:-1}).processState,'UNKNOWN');assert.equal(projectServiceHealth({...raw,lanes:Array(10).fill({})}).processState,'UNKNOWN');assert.equal(projectServiceHealth({...raw,lanes:[{kind:'global',backlogHours:secret}]}).backlog,null);
});
