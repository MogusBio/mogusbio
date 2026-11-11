import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleWorkbenchRequest,loadWorkbenchNativeConfig,createWorkbenchServer } from '../apps/server/main.mjs';
import { clientFixture } from '../packages/client/test/native-fixture.mjs';

async function request({method='GET',url='/api/native/config',host='127.0.0.1:4317',origin='http://127.0.0.1:4317',type='application/json',body={},site,bridge=null}={}){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body)),req=Readable.from([bytes]);
  req.method=method;req.url=url;req.socket={localPort:4317};req.headers={host,...(origin===null?{}:{origin}),'content-type':type,...(site===undefined?{}:{'sec-fetch-site':site})};
  const result={},res={writeHead(status,headers){Object.assign(result,{status,headers});},end(data){result.data=Buffer.from(data);}};
  await handleWorkbenchRequest(req,res,{nativeBridge:bridge});return {...result,body:JSON.parse(result.data.toString())};
}

test('native HTTP defaults disabled and strictly gates same-origin JSON actions before bridge dispatch',async()=>{
  const calls=[],bridge={publicConfig:()=>({enabled:true,chain:'solana:localnet'}),dispatch:async(action,body)=>{calls.push({action,body});return {decision:'PENDING',businessExecutionVerified:false};}};
  assert.equal((await request()).body.enabled,false);
  assert.equal((await request({method:'POST',url:'/api/native/prepare'})).status,503);
  for(const input of [{host:'attacker.invalid:4317'},{method:'POST',url:'/api/native/prepare',origin:'https://attacker.invalid'},
    {method:'POST',url:'/api/native/prepare',origin:null},{method:'POST',url:'/api/native/broadcast',origin:'null'},
    {method:'POST',url:'/api/native/prepare',site:'cross-site'}]){
    // Null keeps the helper's default Origin from masking an absent header.
    const result=await request({...input,origin:Object.hasOwn(input,'origin')?input.origin:'http://127.0.0.1:4317',bridge});
    assert.equal(result.status,403);
  }
  assert.equal((await request({method:'POST',url:'/api/native/broadcast',type:'text/plain',bridge})).status,415);
  assert.equal((await request({method:'POST',url:'/api/native/constructor',bridge})).status,404);
  assert.equal((await request({url:'/api/native/config?endpoint=untrusted',bridge})).status,400);
  assert.equal((await request({method:'POST',url:'/api/native/prepare',body:'x'.repeat(100001),bridge})).status,400);
  assert.equal((await request({method:'POST',url:'/api/native/prepare',body:Buffer.from([123,34,120,34,58,34,255,34,125]),bridge})).status,400);
  assert.equal(calls.length,0);
  const sent=await request({method:'POST',url:'/api/native/broadcast',body:{actor:'explicit'},bridge});
  assert.equal(sent.status,200);assert.equal(sent.body.decision,'PENDING');assert.equal(sent.body.businessExecutionVerified,false);
  assert.deepEqual(calls,[{action:'broadcast',body:{actor:'explicit'}}]);
});

test('native HTTP errors expose only bounded codes and never private paths or provider credentials',async()=>{
  for(const error of [new Error('/private/state/key https://rpc.invalid/?api-key=fixture-secret'),Object.assign(new Error('private detail'),{code:'RPC_ERROR'})]){
    const response=await request({method:'POST',url:'/api/native/status',bridge:{dispatch(){throw error;}}});
    assert.equal(response.status,400);assert.doesNotMatch(response.data.toString(),/fixture-secret|\/private\/state|private detail/);
    assert.equal(response.body.code,error.code??'NATIVE_REQUEST_FAILED');
  }
});

test('native startup configuration is explicit, pinned and redacted without contacting a wallet or RPC',async()=>{
  const dir=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-native-config-'));
  try{
    const c=await clientFixture(),releaseFile=path.join(dir,'release.json'),configFile=path.join(dir,'native.json'),stateDirectory=path.join(dir,'private-state');
    await fs.mkdir(stateDirectory,{mode:0o700});await fs.writeFile(releaseFile,JSON.stringify(c.release.input));
    const input={releaseFile,stateDirectory,endpoint:'http://127.0.0.1:8899/private-provider?api-key=fixture-secret',localPublicFixture:true};
    await fs.writeFile(configFile,JSON.stringify(input));let contacted=false;
    const bridge=await loadWorkbenchNativeConfig(configFile,{fetchImpl(){contacted=true;throw new Error('startup contacted RPC');}});
    assert.equal(contacted,false);const config=bridge.publicConfig();assert.equal(config.chain,'solana:localnet');assert.equal(config.enabled,true);
    assert.doesNotMatch(JSON.stringify(config),/private-provider|fixture-secret|private-state|release\.json/);
    assert.equal((await request({bridge})).body.walletChainKnown,true);
    await fs.writeFile(configFile,JSON.stringify({...input,privateKey:'forbidden'}));await assert.rejects(()=>loadWorkbenchNativeConfig(configFile,{fetchImpl(){}}),/NATIVE_CONFIG_FIELDS/);
    await assert.rejects(()=>loadWorkbenchNativeConfig('relative.json',{fetchImpl(){}}),/ABSOLUTE_PATH/);
    const server=createWorkbenchServer({nativeBridge:bridge});assert.equal(server.requestTimeout,60000);assert.equal(server.headersTimeout,10000);server.close();
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
