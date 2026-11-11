import {mkdtemp,mkdir,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPublicAuth} from '../packages/bridge/src/public-auth.mjs';
import {createOperatorBridge} from '../packages/bridge/src/operator-bridge.mjs';
import {createPublicGateway,createGatewayServer} from '../apps/gateway/main.mjs';
import {nativeKeyBytes} from '../packages/client/src/native.mjs';
import {key} from '../packages/client/test/native-fixture.mjs';
import {opening310DiscoveryFixture} from '../test/discovery-native-fixture.mjs';
import {createPlaytestHTTP} from '../apps/playtest/http.mjs';

// Explicit offline fixture only. The fetch adapter reads actual same-config
// account captures and rejects every non-read method. It cannot use a network.
const raw=process.argv.slice(2),demo=raw.includes('--demo-wallet'),interactive=raw.includes('--playtest'),args=raw.filter(a=>!['--demo-wallet','--playtest'].includes(a));
if(args[0]!=='--local-public-fixture'||args.length>2||['--demo-wallet','--playtest'].some(flag=>raw.filter(a=>a===flag).length>1))throw Error('LOCAL_PUBLIC_FIXTURE_FLAG_REQUIRED');
const port=args[1]===undefined?4318:Number(args[1]);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('LOCAL_PREVIEW_PORT');
const f=await opening310DiscoveryFixture(),{release,abi}=f,origin=`http://localhost:${port}`;
const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-discovery-preview-'));await mkdir(path.join(directory,'business'),{mode:0o700});
const bridge=await createOperatorBridge({release,abi,endpoint:f.endpoint,stateDirectory:path.join(directory,'business'),fetchImpl:f.fetchImpl,allowLocalhost:true});
const nativeBridge={publicConfig:()=>({...bridge.publicConfig(),chain:'solana:localnet',offlineRecordPreview:true}),dispatch(action,body){
  if(['broadcast','refresh','cancel-prepare'].includes(action))throw Object.assign(Error('OFFLINE_PREVIEW_NO_SUBMISSION'),{code:'OFFLINE_PREVIEW_NO_SUBMISSION'});
  return bridge.dispatch(action,body);
}};
const auth=await createPublicAuth({release,abi,origin,stateDirectory:path.join(directory,'auth'),allowLocalhost:true});
const runtime=createPublicGateway({release,abi,nativeBridge,auth,origin,allowLocalhost:true});
const playtest=interactive?await createPlaytestHTTP({origin,directory:path.resolve(new URL('../.data/playtest/',import.meta.url).pathname),onProgress:p=>console.log(`[本地体验准备] ${p.label}${p.hour===undefined?'':` ${p.hour}/${p.total}`}`)}):null;
const labSim=interactive?await createPlaytestHTTP({origin,directory:path.resolve(new URL('../.data/mogusbio-lab-sim/',import.meta.url).pathname),checkpoint:playtest.baseline,basePath:'/api/lab-sim'}):null;
const demoAccounts=[1,8].map(index=>({index,address:key(index),publicKeyHex:nativeKeyBytes(key(index)).toString('hex')}));
if(demoAccounts[0].address!==f.actor)throw Error('LOCAL_FIXTURE_ACTOR');
const server=createGatewayServer({handler:async(req,res)=>{
  if(labSim&&await labSim.handler(req,res))return;
  if(playtest&&await playtest.handler(req,res))return;
  const playAssets={'/test-lab':'test-lab.html','/test-lab.js':'test-lab.js','/test-lab.css':'test-lab.css','/test-market.js':'test-market.js','/sample-construction.js':'sample-construction.js'};
  if(playtest&&req.method==='GET'&&req.headers.host===new URL(origin).host&&playAssets[req.url]){
    const name=playAssets[req.url],type=name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript';
    res.writeHead(200,{'content-type':`${type}; charset=utf-8`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(await readFile(new URL(`../apps/player/dist/${name}`,import.meta.url)));return;
  }
  if(demo&&req.headers.host===new URL(origin).host&&req.method==='GET'&&req.url==='/offline-discovery-wallet.js'){
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(await readFile(new URL('./fixtures/offline-discovery-wallet.js',import.meta.url)));return;
  }
  if(demo&&req.headers.host===new URL(origin).host&&req.method==='GET'&&req.url==='/offline-discovery-wallet-config'){
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(JSON.stringify({fixtureOnly:true,messageOnly:true,origin,accounts:demoAccounts}));return;
  }
  if((demo||playtest)&&req.url==='/'){
    const end=res.end.bind(res);res.end=(data,...rest)=>{let html=Buffer.from(data).toString();if(demo)html=html.replace('</body>','<script type="module" src="/offline-discovery-wallet.js"></script></body>');if(playtest)html=html.replace('</head>','<link rel="stylesheet" href="/test-lab.css"></head>').replace(/(<body[^>]*>)/,'$1<div class="tl-preview-banner"><a href="/test-lab">一键进入测试账号 →</a>不用钱包或地址 · 本地测试数据 · 可重置并保留进度</div>');end(html,...rest);};
  }
  await runtime.handler(req,res);
}});
let closing=false;
async function close(){if(closing)return;closing=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
server.once('error',async()=>{await rm(directory,{recursive:true,force:true});process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`BioLab actual OPEN310 offline discovery preview ${origin}${playtest?`; interactive local test account ${origin}/test-lab`:''}; no chain submission`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close());
