import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {createPublicAuth} from '../packages/bridge/src/public-auth.mjs';
import {createOperatorBridge} from '../packages/bridge/src/operator-bridge.mjs';
import {createPublicGateway,createGatewayServer} from '../apps/gateway/main.mjs';
import {release,abi,checkpoint,cloneAccounts,recordedTransport} from '../packages/client/test/synthesis-fixture.mjs';

// An explicitly named, disposable, offline fixture preview. The injected
// transport reads captured program accounts and cannot contact any network.
const rawArgs=process.argv.slice(2),demo=rawArgs.includes('--demo-wallet'),args=rawArgs.filter(a=>a!=='--demo-wallet');if(args[0]!=='--local-public-fixture'||args.length>2||rawArgs.filter(a=>a==='--demo-wallet').length>1)throw Error('LOCAL_PUBLIC_FIXTURE_FLAG_REQUIRED');
const port=args[1]===undefined?4318:Number(args[1]);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('LOCAL_PREVIEW_PORT');
const origin=`http://localhost:${port}`,directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-auth-preview-'));await mkdir(path.join(directory,'business'),{mode:0o700});
const transport=recordedTransport({captured:cloneAccounts(checkpoint)},'captured',{strict:false}),baseBridge=await createOperatorBridge({release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:path.join(directory,'business'),fetchImpl:transport.fetchImpl,allowLocalhost:true});
const nativeBridge={publicConfig:()=>({...baseBridge.publicConfig(),chain:'solana:localnet',offlineRecordPreview:true}),dispatch(action,body){if(['broadcast','refresh','cancel-prepare'].includes(action))throw Object.assign(Error('OFFLINE_PREVIEW_NO_SUBMISSION'),{code:'OFFLINE_PREVIEW_NO_SUBMISSION'});return baseBridge.dispatch(action,body);}},auth=await createPublicAuth({release,abi,origin,stateDirectory:path.join(directory,'auth'),allowLocalhost:true}),runtime=createPublicGateway({release,abi,nativeBridge,auth,origin,allowLocalhost:true});
const server=createGatewayServer({handler:async(req,res)=>{if(demo&&req.headers.host===new URL(origin).host&&req.method==='GET'&&req.url==='/offline-auth-wallet.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(await readFile(new URL('./fixtures/offline-auth-wallet.js',import.meta.url)));return;}if(demo&&req.url==='/'){const end=res.end.bind(res);res.end=(data,...rest)=>end(Buffer.from(data).toString().replace('</body>','<script type="module" src="/offline-auth-wallet.js"></script></body>'),...rest);}await runtime.handler(req,res);}});
let closing=false;async function close(){if(closing)return;closing=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
server.once('error',async()=>{await rm(directory,{recursive:true,force:true});process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log(`BioLab offline authentication preview ${origin}; no chain submission`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close());
