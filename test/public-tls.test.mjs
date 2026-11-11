import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as tlsServer,request as tlsRequest} from 'node:https';
import {request as httpRequest} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash,createPrivateKey,sign} from 'node:crypto';
import {mkdtemp,realpath,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPublicAuth} from '../packages/bridge/src/public-auth.mjs';
import {createOperatorBridge} from '../packages/bridge/src/operator-bridge.mjs';
import {createPublicGateway,createGatewayServer} from '../apps/gateway/main.mjs';
import {release,abi,actor,cloneAccounts,checkpoint,recordedTransport} from '../packages/client/test/synthesis-fixture.mjs';

test('actual local TLS proxy verifies certificate, forwards fixed origin, and preserves secure authentication without public deployment',async()=>{
  const dir=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-tls-')),certFile=path.join(dir,'test-cert.pem'),keyFile=path.join(dir,'test-key.pem');let gateway,proxy;
  try{
    // Ephemeral TLS-only identity, trusted by this test client only. No system
    // trust store, browser exception, real wallet or production secret is used.
    execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=biolab.example','-addext','subjectAltName=DNS:biolab.example'],{stdio:'ignore',timeout:15000});
    const cert=await readFile(certFile),key=await readFile(keyFile),state=path.join(dir,'state');await mkdir(state,{mode:0o700});const transport=recordedTransport({actual:cloneAccounts(checkpoint)},'actual',{strict:false}),bridge=await createOperatorBridge({release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:state,fetchImpl:transport.fetchImpl,allowLocalhost:true}),auth=await createPublicAuth({release,abi,origin:'https://biolab.example',stateDirectory:path.join(dir,'auth')}),runtime=createPublicGateway({release,abi,nativeBridge:bridge,auth,origin:'https://biolab.example'});
    gateway=createGatewayServer(runtime);await new Promise((r,j)=>{gateway.once('error',j);gateway.listen(0,'127.0.0.1',r);});
    proxy=tlsServer({key,cert},(req,res)=>{const upstream=httpRequest({hostname:'127.0.0.1',port:gateway.address().port,path:req.url,method:req.method,headers:{...req.headers,host:'biolab.example'}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});await new Promise((r,j)=>{proxy.once('error',j);proxy.listen(0,'127.0.0.1',r);});
    const call=(url,body,cookie,trust=true)=>new Promise((resolve,reject)=>{const encoded=body===undefined?null:Buffer.from(JSON.stringify(body)),req=tlsRequest({hostname:'127.0.0.1',port:proxy.address().port,servername:'biolab.example',path:url,method:body===undefined?'GET':'POST',agent:false,...(trust?{ca:cert}:{}),headers:{host:'biolab.example',...(encoded?{origin:'https://biolab.example','content-type':'application/json','content-length':encoded.length}:{}),...(cookie?{cookie}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.once('error',reject);req.end(encoded);});
    await assert.rejects(call('/api/auth/config',undefined,undefined,false),e=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code));
    const c=await call('/api/auth/challenge',{actor}),fixtureSeed=createHash('sha256').update('BIOP0R2 native SIGNING FIXTURE ONLY 1').digest(),fixtureKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),fixtureSeed]),format:'der',type:'pkcs8'}),login=await call('/api/auth/login',{challengeId:c.body.challengeId,signatureBase64:sign(null,Buffer.from(c.body.message),fixtureKey).toString('base64')});
    assert.equal(login.status,200);const cookie=login.headers['set-cookie'][0].split(';')[0];assert.match(login.headers['set-cookie'][0],/^__Host-biolab_session=.*; HttpOnly; Secure; SameSite=Strict$/);assert.equal(login.headers['strict-transport-security'],'max-age=31536000');assert.equal((await call('/api/auth/session',undefined,cookie)).body.session.actor,actor);await call('/api/auth/logout',{},cookie);assert.equal((await call('/api/auth/session',undefined,cookie)).body.authenticated,false);
    assert.equal(transport.calls.length,0);
  }finally{for(const server of [proxy,gateway])if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(dir,{recursive:true,force:true});}
});
