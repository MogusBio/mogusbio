import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createOriginalityCoordinator } from '../../packages/originality/src/index.mjs';
import { catalogHash, materialClass } from '../../packages/protocol-core/src/materials.mjs';
import { validateGraph, encodeGraph, decodeGraph, projectGraph, validateDesign, designId } from '../../packages/biology/src/index.mjs';
import { normalWeight, hourBudget, rewardAmount, W_FLOOR } from '../../packages/settlement/src/index.mjs';
import { createOperatorBridge } from '../../packages/bridge/src/operator-bridge.mjs';
import { validateProductionRelease,nativeAbiBytesForRelease } from '../../packages/client/src/release.mjs';
import {walletChainForRelease} from '../../packages/client/src/cluster.mjs';
import { loadNativeAbi,nativeKeyAddress } from '../../packages/client/src/native.mjs';
import {createPublishedC310Graph} from '../../packages/biology/src/published-c310.mjs';

const release = JSON.parse(await readFile(new URL('../../releases/func2r2/manifest.json', import.meta.url), 'utf8'));
const base = { domain: Buffer.alloc(32), config: Buffer.alloc(32), catalog: catalogHash(),
  rule: Buffer.from(release.ruleHash, 'hex') };
const references = [...createOriginalityCoordinator({ ...base, rewardStart: 86400n }).initialGraphs(),createPublishedC310Graph(base)];
const costs = [413,394,375,347,343,341,340,336,332,330,330,328,324,320,318,316,310];
const publicGraph = graph => ({ ...graph, ...Object.fromEntries(['domain','config','catalog','rule'].map(k=>[k,Buffer.from(graph[k]).toString('hex')])) });
const fromJson = value => {
  if (!value || typeof value !== 'object') throw new Error('图必须是对象');
  const fields=(record,keys)=>{
    if(!record||typeof record!=='object'||Array.isArray(record)
      ||Object.keys(record).sort().join(',')!==[...keys].sort().join(','))throw new Error('图包含未知或缺失字段');
  };
  fields(value,['domain','config','catalog','rule','target','nodes','cells','tiers','edges','opens','slots']);
  for(const [name,keys] of [['nodes',['scope','kind','role','parent']],['cells',['role','v']],
    ['tiers',['scope','mode']],['opens',['role','species','remaining']],['slots',['role','x','y']],
    ['edges',['owner','type','src','dst','fraction']]]){
    if(!Array.isArray(value[name])||value[name].length>440)throw new Error('非法图列表');
    for(const row of value[name]){fields(row,keys);if(name==='edges'){fields(row.src,['kind','role','sub','port']);fields(row.dst,['kind','role','sub','port']);}}
  }
  const graph = { ...value };
  for (const k of ['domain','config','catalog','rule']) {
    if (typeof graph[k] !== 'string' || !/^[0-9a-f]{64}$/.test(graph[k])) throw new Error(`非法${k}标识`);
    graph[k]=Buffer.from(graph[k],'hex');
  }
  validateGraph(graph, base); return decodeGraph(encodeGraph(graph));
};
const json = (res, status, body) => {
  const bytes = Buffer.from(JSON.stringify(body, (_,v)=>typeof v==='bigint'?v.toString():v));
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'});res.end(bytes);
};
const receive = async req => {
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>100_000)throw new Error('提交过大');chunks.push(chunk);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
};
const nativeActions=new Set(['inspect','prepare','simulate','refresh','status','broadcast','cancel-prepare','cancel-status','purchase-plan','asset-read','asset-plan','position-plan','project-plan','project-read','project-status','inventory-read','manufacture-plan','manufacture-next','synthesis-inputs','synthesis-plan','synthesis-next','mining-read','global-plan','hour-close-plan','lifecycle-plan','research-create','research-next','competition-read','round-plan','winner-plan','discovery-read']);
export async function loadWorkbenchNativeConfig(file,{fetchImpl}={}){
  if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('NATIVE_CONFIG_ABSOLUTE_PATH');
  const raw=await readFile(file);if(raw.length>131072)throw new Error('NATIVE_CONFIG_SIZE');
  const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const fields=['releaseFile','endpoint','stateDirectory','localPublicFixture'];
  if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).sort().join(',')!==fields.sort().join(',')
    ||!path.isAbsolute(config.releaseFile??'')||!path.isAbsolute(config.stateDirectory??'')||typeof config.localPublicFixture!=='boolean')throw new Error('NATIVE_CONFIG_FIELDS');
  const releaseBytes=await readFile(config.releaseFile);if(releaseBytes.length>131072)throw new Error('NATIVE_RELEASE_SIZE');
  const nativeRelease=await validateProductionRelease(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(releaseBytes)),{localPublicFixture:config.localPublicFixture});
  const abi=loadNativeAbi(nativeAbiBytesForRelease(nativeRelease),{expectedHash:nativeRelease.input.abiHash});
  const bridge=await createOperatorBridge({release:nativeRelease,abi,endpoint:config.endpoint,stateDirectory:config.stateDirectory,fetchImpl,allowLocalhost:config.localPublicFixture});
  const chain=walletChainForRelease(nativeRelease);
  return Object.freeze({dispatch:bridge.dispatch,publicConfig:()=>({...bridge.publicConfig(),chain,walletChainKnown:chain!==null})});
}
export async function handleWorkbenchRequest(req,res,{nativeBridge=null,requestPolicy=null}={}){
  try{
    const trustedOrigin=requestPolicy?.origin??null;
    if(requestPolicy!==null&&(!trustedOrigin||Object.keys(requestPolicy).some(k=>k!=='origin')||new URL(trustedOrigin).origin!==trustedOrigin))throw new Error('TRUSTED_REQUEST_POLICY');
    const allowedHosts = new Set(trustedOrigin?[new URL(trustedOrigin).host]:[`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`]);
    const expectedOrigin=trustedOrigin??`http://${req.headers.host}`;
    if(!allowedHosts.has(req.headers.host))return json(res,403,{error:'仅接受本地工作台地址'});
    if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))return json(res,400,{error:'非法请求路径'});
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    if(req.method==='GET'&&(path==='/api/auth/config'||path==='/api/auth/session'))return json(res,200,{enabled:false,authenticationRequired:false,authenticated:false,session:null});
    if(path.startsWith('/api/native/')){
      if(url.search)return json(res,400,{error:'NATIVE_QUERY_DISABLED'});
      if(req.method==='GET'&&path==='/api/native/config')return json(res,200,nativeBridge?.publicConfig()??{enabled:false,productionAdmission:false,reason:'原生发布尚未配置'});
      if(req.method!=='POST')return json(res,405,{error:'NATIVE_POST_REQUIRED'});
      if(req.headers.origin!==expectedOrigin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return json(res,403,{error:'NATIVE_SAME_ORIGIN_REQUIRED'});
      if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{error:'NATIVE_JSON_REQUIRED'});
      const action=path.slice('/api/native/'.length);if(!nativeActions.has(action))return json(res,404,{error:'NATIVE_ACTION_UNKNOWN'});
      if(nativeBridge===null)return json(res,503,{error:'NATIVE_NOT_CONFIGURED'});
      try{return json(res,200,await nativeBridge.dispatch(action,await receive(req)));}
      catch(error){const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'NATIVE_REQUEST_FAILED';
        return json(res,400,{status:'FAIL',code,error:'原生请求未完成；请核对请求、状态或本地服务日志。',productionAdmission:false});}
    }
    if(req.method==='GET'&&path==='/api/config')return json(res,200,{mode:'local-reference',productionAdmission:false,
      release:release.release,ruleHash:release.ruleHash,validatorHash:release.validatorHash,
      materials:[1,2,3,4].map(c=>{const m=materialClass(c);return{class:c,name:['AA','NUC','LIPID','SUGAR'][c-1],species:m.species.length};}),
      publicOpening:{profile:'OPEN310',requiredSeedCount:16,publishedKnownCount:17,frontier:310},
      references:references.map((g,i)=>({index:i,name:`C${costs[i]}${i===9?' A':i===10?' B':''}`,cost:costs[i],openingRole:i<16?'REQUIRED16':'PUBLISHED_EXTRA',graph:publicGraph(g)}))});
    if(req.method==='POST'&&path==='/api/validate'){
      const host=req.headers.host,origin=req.headers.origin;
      if(origin&&origin!==expectedOrigin)return json(res,403,{error:'不接受跨站提交'});
      if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{error:'需要JSON提交'});
      const input=await receive(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['graph','challenge','target'].includes(k)))throw new Error('提交包含未知字段');
      const graph=fromJson(input.graph);
      const challenge=input.challenge;
      if(!Number.isSafeInteger(challenge)||challenge<500000||challenge>2000000||challenge%1000)throw new Error('挑战须为0.5–2.0、步长0.001');
      const target=input.target??22;
      if(!Number.isInteger(target)||target<1||target>22)throw new Error('非法构造层');
      const actual=target===graph.target?graph:projectGraph(graph,target), report=validateDesign(actual,{challenge});
      const B=BigInt(actual.cells.length)*480000n;
      const scope=target<=15?'CELL':target<=21?'ORGAN':'BIO';
      const weight=normalWeight({scope,B_int:B,q_ppm:report.q_ppm});
      let daily=0n;for(let h=0n;h<24n;h++)daily+=rewardAmount(hourBudget(h),weight,W_FLOOR);
      return json(res,200,{status:'PASS',productionAdmission:false,requestSHA:createHash('sha256').update(JSON.stringify(input)).digest('hex'),target,scope,q:report.q_ppm,
        taskApplicable:report.taskApplicable,cost:report.C,graphBytes:encodeGraph(actual).length,
        graphSHA:report.graphSHA.toString('hex'),designId:designId(actual).toString('hex'),
        transcriptSHA:report.transcriptSHA.toString('hex'),steps:report.report.rounds,
        ordinaryWeight:weight,isolatedDailyAtoms:daily,
        referenceCases:report.report.cases.map(c=>({name:c.name,rounds:c.rounds.length,
          energy:c.rounds[0].totals.energy,work:c.rounds[0].totals.work,heat:c.rounds[0].totals.heat})),
        graph:publicGraph(actual)});
    }
    if(req.method==='POST'&&path==='/api/design-encode'){
      if(req.headers.origin!==expectedOrigin)return json(res,403,{error:'不接受跨站设计提交'});
      if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{error:'需要JSON提交'});
      const input=await receive(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='graph,target')throw new Error('设计编码包含未知或缺失字段');
      if(!Number.isInteger(input.target)||input.target<1||input.target>22)throw new Error('非法构造层');
      const graph=fromJson(input.graph),actual=graph.target===input.target?graph:projectGraph(graph,input.target),bytes=encodeGraph(actual);
      return json(res,200,{localDesignOnly:true,transactionExecuted:false,networkSubmitted:false,target:actual.target,graphHex:bytes.toString('hex'),graphSHA:createHash('sha256').update(bytes).digest('hex')});
    }
    if(req.method==='GET'&&path==='/api/economy')return json(res,200,JSON.parse(await readFile(new URL('../../evidence/economy-model.json',import.meta.url),'utf8')));
    if(req.method!=='GET')return json(res,405,{error:'不支持此操作'});
    const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/wallet-panel.js':'wallet-panel.js','/wallet-catalog.js':'wallet-catalog.js','/player-shell.js':'player-shell.js','/player-routing.js':'player-routing.js','/market-panel.js':'market-panel.js','/player-navigation.css':'player-navigation.css','/visual-designer.js':'visual-designer.js','/asset-handoff.js':'asset-handoff.js','/app-state.js':'app-state.js','/auth-panel.js':'auth-panel.js','/auth-session.js':'auth-session.js','/native-console.js':'native-console.js','/guided-operations.js':'guided-operations.js','/project-operations.js':'project-operations.js','/manufacture-operations.js':'manufacture-operations.js','/synthesis-operations.js':'synthesis-operations.js','/mining-operations.js':'mining-operations.js','/research-operations.js':'research-operations.js','/discovery-contract.js':'discovery-contract.js','/project-directory.js':'project-directory.js','/wallet-discovery.js':'wallet-discovery.js',
      '/lab':'lab.html','/lab/':'lab.html','/lab.js':'lab.js','/lab-model.js':'lab-model.js','/lab.css':'lab.css',
      '/lab-network.js':'lab-network.js','/lab-devnet-client.js':'lab-devnet-client.js','/lab-devnet-wallet.js':'lab-devnet-wallet.js','/lab-devnet-ops.js':'lab-devnet-ops.js','/lab-devnet.css':'lab-devnet.css','/lab-morphology.js':'lab-morphology.js','/lab-market.css':'lab-market.css','/lab-specimen-art.js':'lab-specimen-art.js','/lab-panels-launch.js':'lab-panels-launch.js','/lab-ops.js':'lab-ops.js','/lab-ops.css':'lab-ops.css','/lab-ui.js':'lab-ui.js','/lab-sim-client.js':'lab-sim-client.js','/lab-designer.js':'lab-designer.js','/lab-designer.css':'lab-designer.css','/lab-panels-supply.js':'lab-panels-supply.js','/lab-panels-production.js':'lab-panels-production.js','/lab-panels-market.js':'lab-panels-market.js','/lab-assets/mogusbio-logo.png':'lab-assets/mogusbio-logo.png','/lab-scene.js':'lab-scene.js','/lab-scene-geometries.js':'lab-scene-geometries.js',
      '/lab-assets/three.module.js':'lab-assets/three.module.js','/lab-assets/molecules.json':'lab-assets/molecules.json',
      '/lab-assets/sources.json':'lab-assets/sources.json','/lab-assets/THREE-LICENSE.txt':'lab-assets/THREE-LICENSE.txt',
      '/wallet-capability.js':'../../../packages/client/src/wallet-capability.mjs',
      '/vendor/wallets.js':'../../../node_modules/@wallet-standard/app/lib/esm/wallets.js'};
    if(!files[path])return json(res,404,{error:'页面不存在'});
    const compressible=['/lab-assets/three.module.js','/lab-assets/molecules.json'].includes(path);
    const encodings=String(req.headers['accept-encoding']??'').split(',').map(s=>s.trim().toLowerCase());
    const gzipOffer=encodings.find(s=>/^gzip(?:\s*;|$)/.test(s))??encodings.find(s=>/^\*(?:\s*;|$)/.test(s));
    const gzip=compressible&&gzipOffer!==undefined&&!/;\s*q\s*=\s*0(?:\.0*)?\s*$/.test(gzipOffer);
    const ext=files[path].split('.').at(-1),data=await readFile(new URL(`../player/dist/${files[path]}${gzip?'.gz':''}`,import.meta.url));
    res.writeHead(200,{'content-type':({'html':'text/html','js':'text/javascript','mjs':'text/javascript','css':'text/css','json':'application/json','txt':'text/plain','png':'image/png'})[ext]+'; charset=utf-8',
      ...(compressible?{'vary':'Accept-Encoding'}:{}),...(gzip?{'content-encoding':'gzip'}:{}),
      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
      'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(data);
  }catch(error){json(res,400,{status:'FAIL',error:error.message,code:error.code??'INVALID_INPUT',productionAdmission:false});}
}
export const createWorkbenchServer = ({nativeBridge=null}={}) => {
  const server=createServer((req,res)=>handleWorkbenchRequest(req,res,{nativeBridge}));server.requestTimeout=60000;server.headersTimeout=10000;return server;
};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.BIOLAB_PORT??4317);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('非法本地端口');
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--native-config'))throw new Error('Usage: main.mjs [--native-config /absolute/config.json]');
  const nativeBridge=args.length?await loadWorkbenchNativeConfig(args[1],{fetchImpl:globalThis.fetch}):null;
  const server=createWorkbenchServer({nativeBridge});
  server.on('error',error=>{console.error(`BioLab workbench failed: ${error.code??error.message}`);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`BioLab local workbench http://127.0.0.1:${server.address().port}`));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));
}
