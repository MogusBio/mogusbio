import {createServer} from 'node:http';
import {readFile,open} from 'node:fs/promises';
import {constants as C} from 'node:fs';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {handleWorkbenchRequest,loadWorkbenchNativeConfig} from '../server/main.mjs';
import {validateProductionRelease,baseConfigR2Id,nativeAbiBytesForRelease} from '../../packages/client/src/release.mjs';
import {loadNativeAbi} from '../../packages/client/src/native.mjs';
import {authorizeNativeRequest,PUBLIC_NATIVE_ACTIONS} from '../../packages/bridge/src/authorization.mjs';
import {createPublicAuth} from '../../packages/bridge/src/public-auth.mjs';
import {isDevnetRelease} from '../../packages/client/src/cluster.mjs';
import {publicServiceHealth,projectServiceHealth} from '../service/public-health.mjs';
import {readServiceHealth} from '../service/supervisor.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>check(object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(','),'PUBLIC_FIELDS');
const safeCode=e=>typeof e?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'PUBLIC_REQUEST_FAILED';
const security={
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
function send(res,status,body,headers={}){res.writeHead(status,{...security,'content-type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(body));}
async function receive(req,max=100000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;check(size<=max,'PUBLIC_BODY_LIMIT');chunks.push(chunk);}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{check(false,'PUBLIC_JSON');}}
function originValue(value,allowLocalhost){check(typeof value==='string'&&value.length<=256,'PUBLIC_ORIGIN');const u=new URL(value);check(u.origin===value&&!u.username&&!u.password&&(u.protocol==='https:'||allowLocalhost&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)),'PUBLIC_HTTPS_ORIGIN');return u;}

/** Counts are bounded. Proxy headers never select an identity or bypass a
 * socket-based limit. Actor limits complement shared reverse-proxy peer limits. */
function limiter(options,clock){
  const o={windowMs:60000,perPeer:120,perActor:180,global:1200,experimentsPerPeer:12,maxKeys:4096,maxActive:16,...options};
  check(Object.keys(o).every(k=>['windowMs','perPeer','perActor','global','experimentsPerPeer','maxKeys','maxActive'].includes(k))&&Object.values(o).every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1000000),'PUBLIC_LIMITS');
  const rows=new Map();let active=0,window=-1,total=0;
  function take(key,cap){const now=clock();check(Number.isSafeInteger(now)&&now>=0,'PUBLIC_CLOCK');const w=Math.floor(now/o.windowMs);if(w!==window){check(w>window,'PUBLIC_CLOCK_REGRESSION');window=w;total=0;rows.clear();}check(total<o.global,'PUBLIC_RATE_LIMIT');const prior=rows.get(key)??0;check(prior<cap,'PUBLIC_RATE_LIMIT');check(rows.has(key)||rows.size<o.maxKeys,'PUBLIC_RATE_LIMIT');rows.set(key,prior+1);total++;}
  return {enter(peer){check(active<o.maxActive,'PUBLIC_BUSY');take(`peer:${peer}`,o.perPeer);active++;let closed=false;return()=>{if(!closed){active--;closed=true;}};},actor(a){take(`actor:${a}`,o.perActor);},experiment(p){take(`experiment:${p}`,o.experimentsPerPeer);},health:()=>({active,maxActive:o.maxActive,rateWindowMs:o.windowMs})};
}
function publicResponse(res){let status=200;return {writeHead(code,headers){status=code;res.writeHead(code,{...headers,...security});},end(data){if(status>=400){let value;try{value=JSON.parse(Buffer.from(data).toString('utf8'));}catch{}const code=safeCode(value);res.end(JSON.stringify({status:'FAIL',code,error:'请求未完成；请核对输入或当前状态。',productionAdmission:false}));}else res.end(data);}};}

/** An explicit deployable HTTP handler behind a trusted TLS reverse proxy.
 * Construction is offline. This module never deploys, creates keys or signs. */
export function createPublicGateway({release,abi,nativeBridge,auth,origin,allowLocalhost=false,devnetLocalOrigin=false,trustedProxyClientIP=false,serviceHealth=null,limits={},clock=()=>Date.now()}){
  check(release&&abi&&nativeBridge&&auth&&typeof clock==='function','PUBLIC_RUNTIME');check(typeof allowLocalhost==='boolean'&&typeof devnetLocalOrigin==='boolean','PUBLIC_LOCAL_ORIGIN_POLICY');check(!allowLocalhost||release.localPublicFixture===true,'PUBLIC_LOCAL_FIXTURE_ONLY');check(!devnetLocalOrigin||isDevnetRelease(release),'PUBLIC_DEVNET_LOCAL_ONLY');const url=originValue(origin,allowLocalhost||devnetLocalOrigin),publicAuth=auth.publicConfig(),info=nativeBridge.publicConfig();
  check(typeof trustedProxyClientIP==='boolean','PUBLIC_PROXY_POLICY');
  check(serviceHealth===null||typeof serviceHealth==='function','PUBLIC_SERVICE_PROVIDER');
  check(publicAuth.origin===origin&&info.releaseHash===release.input.releaseHash&&info.abiHash===abi.hash&&info.domainHex===release.domain.toString('hex')&&info.configHex===baseConfigR2Id(release).toString('hex'),'PUBLIC_RUNTIME_BINDING');
  const expected={releaseHash:info.releaseHash,abiHash:info.abiHash,domainHex:info.domainHex,configHex:info.configHex};check(object(publicAuth.context)&&Object.entries(expected).every(([k,v])=>publicAuth.context[k]===v),'PUBLIC_AUTH_CONTEXT');
  const guard=limiter(limits,clock),started=clock();
  let servicePending=null,serviceCached=null,serviceCachedAt=0;
  async function serviceStatus(){if(serviceHealth===null)return projectServiceHealth(null);if(serviceCached&&clock()-serviceCachedAt>=0&&clock()-serviceCachedAt<1000)return serviceCached;if(!servicePending){servicePending=publicServiceHealth(serviceHealth).then(value=>{serviceCached=value;serviceCachedAt=clock();return value;}).finally(()=>{servicePending=null;});}let timer;try{return await Promise.race([servicePending,new Promise(resolve=>{timer=setTimeout(()=>resolve(projectServiceHealth(null)),3000);})]);}finally{clearTimeout(timer);}}
  const config=()=>({...info,authenticationRequired:true,publicOrigin:origin,productionAdmission:false});
  const health=()=>({status:'OK',authenticationRequired:true,nativeConfigured:true,uptimeSeconds:Math.max(0,Math.floor((clock()-started)/1000)),...guard.health(),productionAdmission:false});
  async function handler(req,res){let leave;
    try{
      check(req.headers.host===url.host,'PUBLIC_HOST');check(typeof req.url==='string'&&req.url.startsWith('/')&&!req.url.startsWith('//')&&req.url.length<=1024,'PUBLIC_PATH');const requestUrl=new URL(req.url,origin),pathname=requestUrl.pathname;check(!requestUrl.search,'PUBLIC_QUERY_DISABLED');
      check(!req.headers.origin||req.headers.origin===origin,'PUBLIC_ORIGIN_MISMATCH');check(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin'||req.headers['sec-fetch-site']==='none','PUBLIC_CROSS_SITE');
      let peer=req.socket.remoteAddress??'unknown';if(trustedProxyClientIP){check(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer),'PUBLIC_PROXY_PEER');const client=req.headers['x-biolab-client-ip'];check(typeof client==='string'&&client.length<=64&&isIP(client)!==0,'PUBLIC_PROXY_CLIENT');peer=client;}
      leave=guard.enter(peer);if(url.protocol==='https:')res.setHeader?.('strict-transport-security','max-age=31536000');
      if(req.method==='POST'){check(req.headers.origin===origin,'PUBLIC_SAME_ORIGIN_REQUIRED');check(req.headers['content-type']?.split(';')[0]==='application/json','PUBLIC_JSON_REQUIRED');if(req.headers['content-length']!==undefined)check(/^(0|[1-9][0-9]*)$/.test(req.headers['content-length'])&&Number(req.headers['content-length'])<=100000,'PUBLIC_BODY_LIMIT');}
      if(req.method==='GET'&&pathname==='/healthz')return send(res,200,health());
      if(req.method==='GET'&&pathname==='/api/auth/config')return send(res,200,{...publicAuth,authenticationRequired:true,localPublicFixture:info.localPublicFixture});
      if(req.method==='GET'&&pathname==='/api/native/config'){const s=await auth.authenticate({cookieHeader:req.headers.cookie});return send(res,200,{...config(),sessionAuthenticated:s!==null,sessionActor:s?.actor??null});}
      if(req.method==='GET'&&pathname==='/api/auth/session'){const s=await auth.authenticate({cookieHeader:req.headers.cookie});return send(res,200,{enabled:true,authenticated:s!==null,session:s?{actor:s.actor,expiresAt:s.expiresAt}:null,context:expected});}
      if(req.method==='GET'&&pathname==='/api/service/status'){const s=await auth.authenticate({cookieHeader:req.headers.cookie});check(s,'PUBLIC_AUTH_REQUIRED');guard.actor(s.actor);return send(res,200,await serviceStatus());}
      if(pathname.startsWith('/api/auth/')){
        check(req.method==='POST','PUBLIC_POST_REQUIRED');const body=await receive(req,4096);
        if(pathname==='/api/auth/challenge'){exact(body,['actor']);guard.actor(body.actor);return send(res,200,await auth.issueChallenge(body));}
        if(pathname==='/api/auth/login'){exact(body,['challengeId','signatureBase64']);const result=await auth.login({...body,cookieHeader:req.headers.cookie});return send(res,200,{authenticated:true,session:result.publicSession},{'set-cookie':result.cookie});}
        if(pathname==='/api/auth/logout'){exact(body,[]);const result=await auth.revoke({cookieHeader:req.headers.cookie});return send(res,200,{authenticated:false,revoked:true},{'set-cookie':result.cookie});}
        check(false,'PUBLIC_ROUTE_UNKNOWN');
      }
      if(pathname.startsWith('/api/native/')){
        check(req.method==='POST','PUBLIC_POST_REQUIRED');const action=pathname.slice('/api/native/'.length);check(PUBLIC_NATIVE_ACTIONS.includes(action),'PUBLIC_ACTION_UNKNOWN');
        const session=await auth.authenticate({cookieHeader:req.headers.cookie});check(session,'PUBLIC_AUTH_REQUIRED');guard.actor(session.actor);const body=await receive(req);
        await authorizeNativeRequest({release,abi,action,body,session});return send(res,200,await nativeBridge.dispatch(action,body));
      }
      if(pathname==='/api/validate')guard.experiment(peer);
      return await handleWorkbenchRequest(req,publicResponse(res),{nativeBridge:null,requestPolicy:{origin}});
    }catch(e){const code=safeCode(e),status=code==='PUBLIC_AUTH_REQUIRED'?401:code==='PUBLIC_RATE_LIMIT'||code==='PUBLIC_BUSY'?429:code==='PUBLIC_HOST'||code==='PUBLIC_ORIGIN_MISMATCH'||code==='PUBLIC_SAME_ORIGIN_REQUIRED'||code==='PUBLIC_CROSS_SITE'||code.startsWith('PUBLIC_ACTOR_')||code==='PUBLIC_SIGNER_REQUIRED'||code==='PUBLIC_ENVELOPE_ACTOR'?403:400;
      return send(res,code==='PUBLIC_PROXY_PEER'?403:status,{status:'FAIL',code,error:'请求未完成；请登录正确账户并核对输入或状态。',productionAdmission:false},status===429?{'retry-after':'60'}:{});
    }finally{leave?.();}
  }
  return Object.freeze({handler,publicConfig:config,health});
}
export function createGatewayServer(runtime){const server=createServer(runtime.handler);server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=40;server.maxRequestsPerSocket=100;server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));return server;}

async function privateConfig(file,max){const h=await open(file,C.O_RDONLY|C.O_NOFOLLOW);try{const s=await h.stat();check(s.isFile()&&s.nlink===1&&(s.mode&0o077)===0&&(typeof process.getuid!=='function'||s.uid===process.getuid())&&s.size<=max,'PUBLIC_CONFIG_POLICY');return await h.readFile();}finally{await h.close();}}

export async function loadGatewayConfig(file,{fetchImpl=globalThis.fetch,clock}={}){
  check(typeof file==='string'&&path.isAbsolute(file),'PUBLIC_CONFIG_PATH');const bytes=await privateConfig(file,32768);const config=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));exact(config,['publicOrigin','nativeConfigFile','authStateDirectory','port','localPublicFixture',...(Object.hasOwn(config,'devnetLocalOrigin')?['devnetLocalOrigin']:[]),...(Object.hasOwn(config,'trustedProxyClientIP')?['trustedProxyClientIP']:[]),...(Object.hasOwn(config,'serviceConfigFile')?['serviceConfigFile']:[])]);check(config.trustedProxyClientIP===undefined||typeof config.trustedProxyClientIP==='boolean','PUBLIC_PROXY_POLICY');check(config.devnetLocalOrigin===undefined||typeof config.devnetLocalOrigin==='boolean','PUBLIC_LOCAL_ORIGIN_POLICY');
  check(path.isAbsolute(config.nativeConfigFile??'')&&path.isAbsolute(config.authStateDirectory??'')&&Number.isInteger(config.port)&&config.port>=0&&config.port<=65535&&typeof config.localPublicFixture==='boolean','PUBLIC_CONFIG');const configuredOrigin=originValue(config.publicOrigin,config.localPublicFixture||config.devnetLocalOrigin===true);if(config.localPublicFixture)check(['localhost','127.0.0.1','[::1]'].includes(configuredOrigin.hostname),'PUBLIC_FIXTURE_LOCAL_ONLY');
  const nativeBytes=await privateConfig(config.nativeConfigFile,131072);const nativeConfig=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(nativeBytes));check(nativeConfig.localPublicFixture===config.localPublicFixture,'PUBLIC_FIXTURE_MISMATCH');check(path.isAbsolute(nativeConfig.releaseFile??''),'PUBLIC_RELEASE_PATH');const releaseBytes=await readFile(nativeConfig.releaseFile);check(releaseBytes.length<=131072,'PUBLIC_RELEASE_SIZE');
  const release=await validateProductionRelease(JSON.parse(releaseBytes.toString('utf8')),{localPublicFixture:config.localPublicFixture}),abi=loadNativeAbi(nativeAbiBytesForRelease(release),{expectedHash:release.input.abiHash}),nativeBridge=await loadWorkbenchNativeConfig(config.nativeConfigFile,{fetchImpl}),auth=await createPublicAuth({release,abi,origin:config.publicOrigin,stateDirectory:config.authStateDirectory,allowLocalhost:config.localPublicFixture,devnetLocalOrigin:config.devnetLocalOrigin??false,...(clock?{clock}:{})});
  let serviceHealth=null;if(config.serviceConfigFile!==undefined){check(typeof config.serviceConfigFile==='string'&&path.isAbsolute(config.serviceConfigFile),'PUBLIC_SERVICE_CONFIG');const doc=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await privateConfig(config.serviceConfigFile,32768)));exact(doc,['releaseFile','localPublicFixture','service']);check(doc.releaseFile===nativeConfig.releaseFile&&doc.localPublicFixture===config.localPublicFixture,'PUBLIC_SERVICE_CONTEXT');serviceHealth=()=>readServiceHealth({release,abi,config:doc.service});}
  return {runtime:createPublicGateway({release,abi,nativeBridge,auth,origin:config.publicOrigin,allowLocalhost:config.localPublicFixture,devnetLocalOrigin:config.devnetLocalOrigin??false,trustedProxyClientIP:config.trustedProxyClientIP??false,serviceHealth,...(clock?{clock}:{})}),port:config.port};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const args=process.argv.slice(2);check(args.length===2&&args[0]==='--config','PUBLIC_USAGE');const {runtime,port}=await loadGatewayConfig(args[1]),server=createGatewayServer(runtime);server.on('error',error=>{console.error(safeCode(error));process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log(`BioLab gateway listening on loopback port ${server.address().port}; public TLS proxy not started`));for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{server.closeIdleConnections();server.close(()=>process.exit(0));});}
  catch(error){console.error(safeCode(error));process.exitCode=1;}
}
