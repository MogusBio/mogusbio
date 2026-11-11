import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {request as httpRequest} from 'node:http';
import {createPrivateKey,sign,createHash} from 'node:crypto';
import {mkdtemp,realpath,rm,readdir,writeFile,mkdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPublicGateway,createGatewayServer,loadGatewayConfig} from '../apps/gateway/main.mjs';
import {createPublicAuth} from '../packages/bridge/src/public-auth.mjs';
import {createOperatorBridge} from '../packages/bridge/src/operator-bridge.mjs';
import {nativePda,nativeKeyBytes} from '../packages/client/src/native.mjs';
import {encodeGraph} from '../packages/biology/src/graph.mjs';
import {hostResearchFixture,researchRequestId} from '../packages/client/test/research-fixture.mjs';
import {release,abi,actor,checkpoint,cloneAccounts,recordedTransport,resources} from '../packages/client/test/synthesis-fixture.mjs';
import {key} from '../packages/client/test/native-fixture.mjs';

// Only the already-public mode0 signing recipe, reconstructed in memory.
const signer=n=>createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),createHash('sha256').update(n<7?`BIOP0R2 native SIGNING FIXTURE ONLY ${n}`:`BIOCLIENT pure unit key ${n}`).digest()]),format:'der',type:'pkcs8'});
const cookie=value=>value.split(';')[0],origin='https://biolab.example';
async function request(runtime,{url='/api/auth/config',method='GET',body={},headers={},peer='127.0.0.1'}={}){
  const encoded=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body)),req=Readable.from([encoded]);req.method=method;req.url=url;req.headers={host:'biolab.example',...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers};req.socket={localPort:4318,remoteAddress:peer};
  const result={headers:{}},res={setHeader(k,v){result.headers[k]=v;},writeHead(status,h){result.status=status;Object.assign(result.headers,h);},end(value){result.raw=Buffer.from(value);}};await runtime.handler(req,res);try{result.body=JSON.parse(result.raw.toString());}catch{}return result;
}
async function fixture(run,{limits,fetchImpl}={}){
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-public-gateway-')),transport=recordedTransport({actual:cloneAccounts(checkpoint)},'actual',{strict:false});let now=Date.UTC(2026,9,25,12);
  try{const authOptions={release,abi,origin,stateDirectory:path.join(directory,'auth'),clock:()=>now},bridgeOptions={release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:directory,allowLocalhost:true,fetchImpl:fetchImpl??transport.fetchImpl},make=async()=>{const auth=await createPublicAuth(authOptions),bridge=await createOperatorBridge(bridgeOptions),nativeBridge={dispatch:bridge.dispatch,publicConfig:()=>({...bridge.publicConfig(),chain:'solana:localnet'})};return createPublicGateway({release,abi,nativeBridge,auth,origin,clock:()=>now,...(limits?{limits}:{})});},runtime=await make();
    await run({runtime,make,directory,transport,setTime:n=>{now=n;},now:()=>now});
  }finally{await rm(directory,{recursive:true,force:true});}
}
async function login(runtime,n,prior){const a=key(n),challenge=await request(runtime,{url:'/api/auth/challenge',method:'POST',body:{actor:a}});assert.equal(challenge.status,200);const signatureBase64=sign(null,Buffer.from(challenge.body.message),signer(n)).toString('base64'),r=await request(runtime,{url:'/api/auth/login',method:'POST',body:{challengeId:challenge.body.challengeId,signatureBase64},headers:prior?{cookie:prior}:{}});assert.equal(r.status,200);assert.equal(r.body.session.actor,a);assert.equal(JSON.stringify(r.body).includes(r.headers['set-cookie'].split('=')[1].split(';')[0]),false);return {cookie:cookie(r.headers['set-cookie']),challenge:challenge.body,signatureBase64,result:r};}
async function intent(feePayer){const suffix=await Promise.all(Object.entries({LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'}).map(async([name,s])=>({name,address:(await nativePda(release.input.programId,'bio',s)).address})));const p=Buffer.alloc(8);p.writeBigUInt64LE(100000000n);const nonce=checkpoint.get((await nativePda(release.input.programId,'bio','actor-nonce',nativeKeyBytes(actor))).address).data.readBigUInt64LE(120);return {operation:'SYNC_EMISSION',nonce:nonce.toString(),payloadHex:p.toString('hex'),suffix,resources:{...resources,priorityFeeLamports:'0'},...(feePayer?{feePayer}:{})};}

test('public auth HTTP binds correct wallet, opaque HttpOnly cookie, one-use message, revoked restart and enabled-state gating',async()=>fixture(async({runtime,make})=>{
  const before=await request(runtime,{url:'/api/native/config'});assert.equal(before.body.authenticationRequired,true);assert.equal(before.body.sessionAuthenticated,false);
  assert.equal((await request(runtime,{url:'/api/native/status',method:'POST',body:{actor,nonce:'0',log:'primary'}})).status,401);
  const a=await login(runtime,1);assert.match(a.result.headers['set-cookie'],/^__Host-biolab_session=.*HttpOnly; Secure; SameSite=Strict$/);assert.equal(a.result.headers['cache-control'],'no-store');
  const read=await request(await make(),{url:'/api/auth/session',headers:{cookie:a.cookie}});assert.equal(read.body.authenticated,true);assert.equal(read.body.session.actor,actor);
  const replay=await request(runtime,{url:'/api/auth/login',method:'POST',body:{challengeId:a.challenge.challengeId,signatureBase64:a.signatureBase64}});assert.equal(replay.status,400);assert.equal(replay.body.code,'AUTH_CHALLENGE_UNAVAILABLE');
  const enabled=await request(runtime,{url:'/api/native/config',headers:{cookie:a.cookie}});assert.equal(enabled.body.sessionAuthenticated,true);assert.equal(enabled.body.sessionActor,actor);
  await request(runtime,{url:'/api/auth/logout',method:'POST',body:{},headers:{cookie:a.cookie}});assert.equal((await request(await make(),{url:'/api/auth/session',headers:{cookie:a.cookie}})).body.authenticated,false);
}));
test('real bridge namespaces cannot be read, prepared, cancelled or broadcast by an authenticated different actor; same actor shares durable history',async()=>fixture(async({runtime,make,directory})=>{
  const a=await login(runtime,1),b=await login(runtime,8),a2=await login(runtime,1),payload=await intent(),prepared=await request(runtime,{url:'/api/native/prepare',method:'POST',body:{actor,intent:payload},headers:{cookie:a.cookie}});assert.equal(prepared.status,200);assert.equal(prepared.body.actor,actor);
  const baseline=await readdir(directory);
  for(const [operation,body]of [['prepare',{actor,intent:payload}],['status',{actor,nonce:'0',log:'primary'}],['cancel-prepare',{actor,nonce:'0',maxRent:'1000000',resources:payload.resources}],['broadcast',{actor,envelope:prepared.body,signedTransactionBase64:'AA==',log:'primary'}],['research-create',{actor,cranker:key(8)}]]){
    const r=await request(runtime,{url:`/api/native/${operation}`,method:'POST',body,headers:{cookie:b.cookie}});assert.equal(r.status,403);assert.equal(r.body.code,'PUBLIC_ACTOR_MISMATCH');
  }
  assert.deepEqual(await readdir(directory),baseline);const same=await request(await make(),{url:'/api/native/prepare',method:'POST',body:{actor,intent:payload},headers:{cookie:a2.cookie}});assert.equal(same.status,200);assert.equal(same.body.frameHex,prepared.body.frameHex);assert.equal(same.body.requestHash,prepared.body.requestHash);
}));
test('co-signer may inspect an actual required-signature message but cannot take over principal journal or fake claimed signers',async()=>fixture(async({runtime})=>{
  const a=await login(runtime,1),b=await login(runtime,2),outsider=await login(runtime,8),prepared=await request(runtime,{url:'/api/native/prepare',method:'POST',body:{actor,intent:await intent(key(2))},headers:{cookie:a.cookie}});assert.equal(prepared.status,200);
  const good=await request(runtime,{url:'/api/native/inspect',method:'POST',body:{envelope:prepared.body},headers:{cookie:b.cookie}});assert.equal(good.status,200);assert.ok(good.body.requiredSigners.includes(key(2)));
  const bad=await request(runtime,{url:'/api/native/inspect',method:'POST',body:{envelope:prepared.body},headers:{cookie:outsider.cookie}});assert.equal(bad.status,403);assert.equal(bad.body.code,'PUBLIC_SIGNER_REQUIRED');
  const takeover=await request(runtime,{url:'/api/native/refresh',method:'POST',body:{actor,envelope:prepared.body,log:'primary'},headers:{cookie:b.cookie}});assert.equal(takeover.status,403);
}));
test('Host/Origin/CSRF, oversized input, query injection, actor cookie and proxy headers do not bypass auth',async()=>fixture(async({runtime,transport})=>{
  for(const headers of [{host:'evil.example'},{origin:'https://evil.example'},{origin:undefined},{'sec-fetch-site':'cross-site'}]){const r=await request(runtime,{url:'/api/auth/challenge',method:'POST',body:{actor},headers});assert.equal(r.status,403);}
  const forged=await request(runtime,{url:'/api/native/status',method:'POST',body:{actor,nonce:'0',log:'primary'},headers:{cookie:`actor=${actor}`,'x-forwarded-for':'127.0.0.1','x-forwarded-host':'biolab.example'}});assert.equal(forged.status,401);
  for(const req of [{url:'/api/auth/config?actor=1'},{url:'/api/auth/challenge',method:'POST',body:Buffer.alloc(5000,65)},{url:'/api/auth/challenge',method:'POST',body:Buffer.from([123,34,255,34,58,49,125])}])assert.equal((await request(runtime,req)).status,400);
  const fail=await request(runtime,{url:'/api/auth/login',method:'POST',body:{challengeId:'00'.repeat(32),signatureBase64:'PRIVATE_SIGNATURE_PATH'}});assert.equal(fail.status,400);assert.equal(fail.raw.toString().includes('PRIVATE_SIGNATURE_PATH'),false);assert.equal(transport.calls.length,0);
}));
test('fixed rate, memory key and active request bounds fail closed without trusting spoofed forwarded identity',async()=>fixture(async({runtime,setTime,now})=>{
  assert.equal((await request(runtime)).status,200);assert.equal((await request(runtime,{headers:{'x-forwarded-for':'other'}})).status,429);setTime(now()+60001);assert.equal((await request(runtime)).status,200);assert.ok(runtime.health().active===0);
},{limits:{perPeer:1,maxKeys:2}}));
test('public server configures bounded HTTP deadlines without binding a public socket',async()=>fixture(async({runtime})=>{
  const server=createGatewayServer(runtime);assert.equal(server.requestTimeout,30000);assert.equal(server.headersTimeout,10000);assert.equal(server.maxHeadersCount,40);assert.equal(server.maxRequestsPerSocket,100);assert.equal(server.listening,false);server.close();
}));
test('HOST private research is owned by authenticated author, and only its frozen named cranker can read delegated progress',async()=>{
  const f=await hostResearchFixture();await fixture(async({runtime,directory})=>{
    const author=await login(runtime,1),cranker=await login(runtime,8),outsider=await login(runtime,2),body={actor,cranker:key(8),graphHex:encodeGraph(f.graph).toString('hex'),directIdsHex:f.directIds.map(x=>x.toString('hex')),maxRent:f.args.maxRent.toString(),maxUploadRent:f.args.maxUploadRent.toString(),maxFee:f.args.maxFee.toString(),resources:{...resources,priorityFeeLamports:'0'},requestId:researchRequestId};
    const saved=await request(runtime,{url:'/api/native/research-create',method:'POST',body,headers:{cookie:author.cookie}});assert.equal(saved.status,200);assert.equal(saved.body.decision,'WORKFLOW_SAVED');assert.equal(saved.body.workflow.synthesis,undefined);
    const foreign=await request(runtime,{url:'/api/native/research-next',method:'POST',body:{actor:key(2),author:actor,workflowId:saved.body.workflow.workflowId},headers:{cookie:outsider.cookie}});assert.equal(foreign.status,400);assert.equal(foreign.body.code,'RESEARCH_EXECUTOR_ROLE');assert.equal(foreign.body.workflow,undefined);
    const binding={releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:release.domain.toString('hex'),configHex:saved.body.workflow.domainHex};const info=runtime.publicConfig();binding.configHex=info.configHex;const namespace=createHash('sha256').update(JSON.stringify(binding)).digest('hex'),authorDirectory=path.join(directory,namespace,nativeKeyBytes(actor).toString('hex'));assert.deepEqual(await readdir(authorDirectory),['research']);
    const delegated=await request(runtime,{url:'/api/native/research-next',method:'POST',body:{actor:key(8),author:actor,workflowId:saved.body.workflow.workflowId},headers:{cookie:cranker.cookie}});assert.equal(delegated.status,200);assert.equal(delegated.body.decision,'AUTHOR_REQUIRED');assert.equal(delegated.body.workflow.synthesis,undefined);assert.equal(delegated.body.intent,undefined);
  },{fetchImpl:f.fetchImpl});
});

test('actual loopback HTTP transport simulates the fixed-host TLS proxy without deployment, preserves cookies and rejects concurrent replay',async()=>fixture(async({runtime})=>{
  const server=createGatewayServer(runtime);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const call=(url,body,headers={})=>new Promise((resolve,reject)=>{const encoded=body===undefined?null:Buffer.from(JSON.stringify(body)),req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:url,method:body===undefined?'GET':'POST',headers:{host:'biolab.example',...(body===undefined?{}:{origin,'content-type':'application/json','content-length':encoded.length}),...headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(encoded);});
  try{const challenge=await call('/api/auth/challenge',{actor}),args={challengeId:challenge.body.challengeId,signatureBase64:sign(null,Buffer.from(challenge.body.message),signer(1)).toString('base64')},results=await Promise.all([call('/api/auth/login',args),call('/api/auth/login',args)]),good=results.filter(r=>r.status===200);assert.equal(good.length,1);assert.equal(results.filter(r=>r.status===400).length,1);
    const header=cookie(good[0].headers['set-cookie'][0]),session=await call('/api/auth/session',undefined,{cookie:header});assert.equal(session.body.session.actor,actor);assert.equal((await call('/api/native/config',undefined,{cookie:header})).body.sessionAuthenticated,true);await call('/api/auth/logout',{}, {cookie:header});assert.equal((await call('/api/auth/session',undefined,{cookie:header})).body.authenticated,false);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));
test('public config loads offline from protected files, rejects fixture exposure, writable secrets and caller key injection',async()=>{
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-public-config-'));try{const releaseFile=path.join(directory,'release.json'),nativeFile=path.join(directory,'native.json'),file=path.join(directory,'gateway.json'),state=path.join(directory,'state');await mkdir(state,{mode:0o700});await writeFile(releaseFile,JSON.stringify(release.input));await writeFile(nativeFile,JSON.stringify({releaseFile,stateDirectory:state,endpoint:'http://127.0.0.1:1',localPublicFixture:true}),{mode:0o600});const input={publicOrigin:'http://localhost:4318',nativeConfigFile:nativeFile,authStateDirectory:path.join(directory,'auth'),port:4318,localPublicFixture:true};await writeFile(file,JSON.stringify(input),{mode:0o600});let called=false;const loaded=await loadGatewayConfig(file,{fetchImpl(){called=true;throw Error('unexpected network');}});assert.equal(loaded.port,4318);assert.equal(called,false);assert.equal(loaded.runtime.publicConfig().authenticationRequired,true);
    await writeFile(file,JSON.stringify({...input,publicOrigin:'https://biolab.example'}));await assert.rejects(loadGatewayConfig(file),/PUBLIC_FIXTURE_LOCAL_ONLY/);await writeFile(file,JSON.stringify({...input,privateKey:'forbidden'}));await assert.rejects(loadGatewayConfig(file),/PUBLIC_FIELDS/);await writeFile(file,JSON.stringify(input));await chmod(file,0o644);await assert.rejects(loadGatewayConfig(file),/PUBLIC_CONFIG_POLICY/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('bounded in-flight authenticated work cannot grow beyond the configured maximum and releases capacity after completion',async()=>fixture(async({runtime,directory,now})=>{
  const a=await login(runtime,1),auth=await createPublicAuth({release,abi,origin,stateDirectory:path.join(directory,'auth'),clock:now});let started=0,releaseWork,allStarted;const gate=new Promise(r=>{releaseWork=r;}),ready=new Promise(r=>{allStarted=r;}),slow=createPublicGateway({release,abi,auth,origin,clock:now,limits:{maxActive:4},nativeBridge:{publicConfig:runtime.publicConfig,async dispatch(){if(++started===4)allStarted();await gate;return {decision:'WAIT',transactionExecuted:false};}}});
  const pending=Array.from({length:4},()=>request(slow,{url:'/api/native/status',method:'POST',body:{actor,nonce:'0',log:'primary'},headers:{cookie:a.cookie}}));await ready;assert.equal(slow.health().active,4);const blocked=await request(slow,{url:'/api/native/status',method:'POST',body:{actor,nonce:'0',log:'primary'},headers:{cookie:a.cookie,'x-forwarded-for':'spoof'}});assert.equal(blocked.status,429);releaseWork();assert.ok((await Promise.all(pending)).every(r=>r.status===200));assert.equal(slow.health().active,0);
}));
test('explicit loopback proxy separates rate buckets by its replaced client-IP header without changing any auth identity',async()=>fixture(async({runtime,directory,now})=>{
  const auth=await createPublicAuth({release,abi,origin,stateDirectory:path.join(directory,'auth'),clock:now}),proxy=createPublicGateway({release,abi,auth,origin,clock:now,trustedProxyClientIP:true,limits:{perPeer:1},nativeBridge:{publicConfig:runtime.publicConfig,dispatch(){assert.fail('rate test must not reach native');}}});
  assert.equal((await request(proxy,{headers:{'x-biolab-client-ip':'203.0.113.1'}})).status,200);assert.equal((await request(proxy,{headers:{'x-biolab-client-ip':'203.0.113.2'}})).status,200);assert.equal((await request(proxy,{headers:{'x-biolab-client-ip':'203.0.113.1','x-forwarded-for':'203.0.113.99'}})).status,429);
  assert.equal((await request(proxy,{headers:{'x-biolab-client-ip':'203.0.113.3'},peer:'198.51.100.2'})).status,403);assert.equal((await request(proxy,{headers:{'x-biolab-client-ip':'203.0.113.3, 203.0.113.4'}})).status,400);
}));
test('authenticated service status exposes only bounded aggregate health and never grants an HTTP service-control operation',async()=>fixture(async({runtime,directory,now})=>{
  const a=await login(runtime,1),auth=await createPublicAuth({release,abi,origin,stateDirectory:path.join(directory,'auth'),clock:now});let reads=0;const observed=createPublicGateway({release,abi,auth,origin,clock:now,nativeBridge:{publicConfig:runtime.publicConfig,dispatch(){assert.fail('health never dispatches a transaction');}},serviceHealth:async()=>{reads++;return {version:'BIO-SERVICE-HEALTH1',configured:true,processState:'RUNNING',mode:'PLAN_ONLY',ticks:12,confirmed:3,token:'PRIVATE_TOKEN',endpoint:'PRIVATE_RPC',lanes:[{name:'PRIVATE_RESEARCH',actor,kind:'global',state:'WAIT_QUOTE',backlogHours:'4',errorCode:'SERVICE_QUOTE_RPC'}]};}});
  assert.equal((await request(observed,{url:'/api/service/status'})).status,401);const first=await request(observed,{url:'/api/service/status',headers:{cookie:a.cookie}});assert.equal(first.status,200);assert.equal(first.body.processState,'RUNNING');assert.equal(first.body.backlog,'4');assert.equal(first.body.quoteUnavailable,1);assert.equal(first.raw.toString().includes('PRIVATE'),false);assert.equal(first.raw.toString().includes(actor),false);await request(observed,{url:'/api/service/status',headers:{cookie:a.cookie}});assert.equal(reads,1);const write=await request(observed,{url:'/api/service/stop',method:'POST',body:{},headers:{cookie:a.cookie}});assert.equal(write.status,405);
}));
