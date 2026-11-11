import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLabSimClient,readSimJSON,formatLabUnits,decimalLabUnits,labErrorMessage} from '../apps/player/dist/lab-sim-client.js';

const RUN='ab'.repeat(32),REQUEST='01'.repeat(32),KEY='mogusbio:lab-sim:pending:v1';
const config={enabled:true,referenceModel:true,networkSubmitted:false};
const state=(revision='1',extra={})=>({profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,authenticated:true,runId:RUN,revision,state:{profile:'BIO-PLAYTEST-SNAPSHOT1',scope:{networkSubmitted:false},lab:{balanceAtoms:'1000000'}},...extra});
const anonymous=()=>({profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,authenticated:false});
const json=(value,status=200)=>new Response(JSON.stringify(status>=400?{profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,...value}:value),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(route,{saved}={}){
  const map=new Map(saved?[[KEY,JSON.stringify(saved)]]:[]),calls=[],changes=[],statuses=[];let randomCount=0;
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
  const fetchImpl=async(url,init)=>{calls.push({url,init});return route(url,init,calls);};
  const client=createLabSimClient({fetchImpl,storage,randomBytes:()=>{randomCount++;return new Uint8Array(32).fill(randomCount);},onChange:s=>changes.push(s),onStatus:(...args)=>statuses.push(args)});
  return{client,map,calls,changes,statuses,get randomCount(){return randomCount;}};
}

test('LAB and SOL amounts preserve every atomic unit above Number precision',()=>{
  assert.equal(formatLabUnits('18446744073709551615',9),'18446744073.709551615');
  assert.equal(formatLabUnits('9007199254740993',6),'9007199254.740993');
  assert.equal(formatLabUnits('1000000',6),'1');assert.equal(formatLabUnits('1',9),'0.000000001');
  assert.equal(formatLabUnits('0',9),'0');assert.equal(formatLabUnits('123',0),'123');
  assert.equal(decimalLabUnits('18446744073.709551615',9),'18446744073709551615');
  assert.equal(decimalLabUnits('9007199.254740993',9),'9007199254740993');
  assert.equal(decimalLabUnits('0.000001',6),'1');assert.equal(decimalLabUnits('0',9),'0');
  for(const invalid of ['','01','-1','+1','1e3','NaN','0.0000000001','18446744073.709551616','1.0000000000',' 1','1 ', '1.'])assert.throws(()=>decimalLabUnits(invalid,9),error=>error.code==='PLAYTEST_FIELDS',invalid);
  for(const invalid of [1,'-1','01','1.5','1e6',null])assert.equal(formatLabUnits(invalid),'—');
});

test('discovery remains inside the isolated same-origin simulator and refuses a chain identity',async()=>{
  const f=fixture(url=>json(url.endsWith('/config')?config:state()));
  await f.client.refresh();assert.equal(f.client.snapshot.enabled,true);assert.equal(f.client.snapshot.current.revision,'1');
  for(const {url,init}of f.calls){assert.match(url,/^\/api\/lab-sim\/(config|state)$/);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.accept,'application/json');assert.ok(init.signal instanceof AbortSignal);}
  const wrong=fixture(url=>json(url.endsWith('/config')?config:state('1',{networkSubmitted:true})));
  await wrong.client.refresh();assert.equal(wrong.client.snapshot.enabled,false);assert.equal(wrong.client.snapshot.current,null);
  const disabled=fixture(()=>json({...config,referenceModel:false}));await disabled.client.start();assert.equal(disabled.client.snapshot.enabled,false);assert.equal(disabled.calls.length,1);assert.equal(disabled.randomCount,0);
});

test('concurrent Start clicks create one account request and busy blocks competing mutations',async()=>{
  const post=deferred();const f=fixture((url,init)=>init.method==='POST'?post.promise:json(url.endsWith('/config')?config:anonymous()));
  await f.client.refresh();const a=f.client.start(),b=f.client.start();await flush();
  assert.equal(f.client.snapshot.busy,true);assert.equal(f.client.snapshot.pending.kind,'start');
  await f.client.act('claim');await f.client.reset();await f.client.retry();await f.client.refresh();
  assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);assert.equal(f.randomCount,1);
  post.resolve(json(state('0')));await Promise.all([a,b]);assert.equal(f.client.snapshot.pending,null);assert.equal(f.client.snapshot.busy,false);assert.equal(f.map.has(KEY),false);
  await f.client.start();assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1,'an existing account cannot be started twice');
});

test('unknown mutation outcome retains exactly the same request across retry and reload',async()=>{
  let postCount=0;const f=fixture((url,init)=>{
    if(init.method==='POST'){postCount++;return postCount===1?json({code:'PLAYTEST_BUSY',outcome:'UNKNOWN'},503):json(state('2'));}
    return json(url.endsWith('/config')?config:state());
  });
  await f.client.refresh();await f.client.act('project-buy',{projectId:'11'.repeat(32),class:1,quantity:'7'});
  const saved=JSON.parse(f.map.get(KEY)),first=f.calls.find(call=>call.init.method==='POST');
  assert.equal(saved.body.revision,'1');assert.equal(saved.kind,'action');assert.equal(f.client.snapshot.pending.body.requestId,REQUEST);
  assert.match(f.statuses.at(-1)[0],/exact same request/);assert.equal(f.client.snapshot.current.revision,'1');
  await f.client.act('claim');await f.client.reset();assert.equal(postCount,1,'unknown request blocks new writes');
  const resumed=fixture((url,init)=>{assert.equal(url,'/api/lab-sim/action');assert.equal(init.body,first.init.body);return json(state('2'));},{saved});
  await resumed.client.retry();assert.equal(resumed.randomCount,0);assert.equal(resumed.client.snapshot.pending,null);assert.equal(resumed.map.has(KEY),false);assert.equal(resumed.client.snapshot.current.revision,'2');
  assert.equal(JSON.parse(first.init.body).requestId,REQUEST);
});

test('a confirmed rejection clears the operation and refreshes authoritative balances',async()=>{
  let rejected=false;const f=fixture((url,init)=>{if(init.method==='POST'){rejected=true;return json({code:'PLAYTEST_REVISION'},409);}return json(url.endsWith('/config')?config:state(rejected?'4':'1'));});
  await f.client.refresh();await f.client.act('claim');assert.equal(f.client.snapshot.pending,null);assert.equal(f.map.has(KEY),false);assert.equal(f.client.snapshot.current.revision,'4');assert.match(f.statuses.at(-1)[0],/Another operation updated/);
  await f.client.act('claim');assert.equal(f.randomCount,2,'a new authoritative revision can receive a new operation ID');
});

test('successful HTTP with untrusted response identity must preserve the unresolved mutation',async()=>{
  let mutated=false;const f=fixture((url,init)=>{if(init.method==='POST'){mutated=true;return json({...state('2'),networkSubmitted:true});}return json(url.endsWith('/config')?config:state(mutated?'2':'1'));});
  await f.client.refresh();await f.client.act('claim');
  assert.equal(f.client.snapshot.pending?.kind,'action','a transport-level success cannot confirm an untrusted protocol response');
  assert.ok(f.map.has(KEY),'the same request ID remains recoverable after a reload');
});

test('late older refresh cannot replace a newer same-run ledger; snapshots are defensive',async()=>{
  let revision='7';const f=fixture(url=>json(url.endsWith('/config')?config:state(revision)));
  await f.client.refresh();const snapshot=f.client.snapshot;snapshot.current.state.lab.balanceAtoms='0';assert.equal(f.client.snapshot.current.state.lab.balanceAtoms,'1000000');
  const emitted=f.changes.at(-1);emitted.current.revision='999';assert.equal(f.client.snapshot.current.revision,'7');
  revision='5';await f.client.refresh();assert.equal(f.client.snapshot.current.revision,'7');
  revision='8';await f.client.refresh();assert.equal(f.client.snapshot.current.revision,'8');
});

test('closing a client prevents late refresh responses from mutating a disposed session',async()=>{
  const pending=deferred();const f=fixture(url=>url.endsWith('/config')?json(config):pending.promise);
  const refreshing=f.client.refresh();await flush();const changes=f.changes.length,statuses=f.statuses.length;f.client.close();pending.resolve(json(state()));await refreshing;
  assert.equal(f.changes.length,changes);assert.equal(f.statuses.length,statuses,'disposed callbacks must remain quiet');assert.equal(f.client.snapshot.current,null);
  await f.client.start();await f.client.act('claim');await f.client.reset();assert.equal(f.calls.length,2);
});

test('closing during Start discovery does not create a new unsubmitted pending request',async()=>{
  const pending=deferred();const f=fixture(url=>url.endsWith('/config')?json(config):pending.promise);
  const starting=f.client.start();await flush();f.client.close();pending.resolve(json(anonymous()));await starting;
  assert.equal(f.randomCount,0);assert.equal(f.map.has(KEY),false);assert.equal(f.calls.filter(call=>call.init.method==='POST').length,0);
});

test('closing during rejection recovery cannot update the disposed session or emit status',async()=>{
  const recovery=deferred();
  const g=fixture((url,init)=>{if(init.method==='POST')return json({code:'PLAYTEST_REVISION'},409);if(url.endsWith('/config'))return json(config);if(g.calls.length>2)return recovery.promise;return json(state());});
  await g.client.refresh();const action=g.client.act('claim');await flush();assert.equal(g.calls.at(-1).url,'/api/lab-sim/state');
  const statusCount=g.statuses.length;g.client.close();recovery.resolve(json(state('8')));await action;
  assert.equal(g.statuses.length,statusCount);assert.equal(g.client.snapshot.current.revision,'1');
});

test('accepted mutation results are returned defensively for the exact experiment callback',async()=>{
  const f=fixture((url,init)=>json(init.method==='POST'?state('2',{result:{status:'PASS',qualityPpm:'1500000'}}):url.endsWith('/config')?config:state()));
  await f.client.refresh();const result=await f.client.act('design-test',{challenge:1500000});assert.equal(result.result.status,'PASS');assert.equal(result.revision,'2');
  result.state.lab.balanceAtoms='0';assert.equal(f.client.snapshot.current.state.lab.balanceAtoms,'1000000');
});

test('bounded JSON reader rejects non-JSON, excessive bodies and invalid UTF-8',async()=>{
  await assert.rejects(readSimJSON(async()=>new Response('<html>wrong origin</html>',{headers:{'content-type':'text/html'}}),'/api/lab-sim/action',{method:'POST'}),error=>error.uncertain===true);
  await assert.rejects(readSimJSON(async()=>new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}}),'/api/lab-sim/state'),error=>error.uncertain===false);
  await assert.rejects(readSimJSON(async()=>new Response(Uint8Array.of(0xff),{headers:{'content-type':'application/json'}}),'/api/lab-sim/action',{method:'POST'}),error=>error.uncertain===true);
  await assert.rejects(readSimJSON(async()=>json([]),'/api/lab-sim/state'),error=>error.uncertain===false);
});

test('JSON reader timeout bounds both a stalled request and a stalled body',async()=>{
  const begin=Date.now();await assert.rejects(readSimJSON(()=>new Promise(()=>{}),'/api/lab-sim/action',{method:'POST'},12),error=>error.uncertain===true);assert.ok(Date.now()-begin<1000);
  let cancelled=false;const stalled=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}});
  await assert.rejects(readSimJSON(async()=>new Response(stalled,{headers:{'content-type':'application/json'}}),'/api/lab-sim/action',{method:'POST'},12),error=>error.uncertain===true);await flush();assert.equal(cancelled,true);
});

test('protocol errors are English and server-provided messages never become trusted UI text',()=>{
  for(const code of ['PLAYTEST_FIELDS','MARKET_SELF_TRADE','PORT_CAP','MECHANICAL','SOME_NEW_ERROR']){const text=labErrorMessage({code,message:'<script>dangerous</script>'});assert.doesNotMatch(text,/[\u3400-\u9fff]|script|dangerous/);assert.match(text,/[a-z]/i);}
  assert.match(labErrorMessage({code:'<img onerror=evil>'}),/local service is unavailable/);
});

test('simulation UI modules contain no wallet signing, real RPC submission or inline executable HTML',async()=>{
  for(const name of ['lab-sim-client','lab-ui','lab-panels-supply','lab-panels-production','lab-panels-market']){
    const source=await readFile(new URL(`../apps/player/dist/${name}.js`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(?:signTransaction|signAllTransactions|signAndSendTransaction|sendRawTransaction|requestAirdrop)\b|window\.solana|https:\/\/api\.(?:mainnet|devnet)|\.innerHTML\s*=|\.insertAdjacentHTML\s*\(/,name);
  }
});

test('a JSON error from an unrelated proxy cannot discard a potentially committed operation',async()=>{
  const f=fixture((url,init)=>init.method==='POST'?new Response(JSON.stringify({profile:'PROXY',code:'PLAYTEST_REVISION'}),{status:400,headers:{'content-type':'application/json'}}):json(url.endsWith('/config')?config:state()));
  await f.client.refresh();await f.client.act('claim',{});assert.ok(f.client.snapshot.pending);assert.equal(f.client.snapshot.pending.body.action,'claim');assert.ok(f.map.has(KEY));f.client.close();
});
