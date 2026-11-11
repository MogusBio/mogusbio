import { promises as fs,constants as C } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProductionRelease,nativeAbiBytesForRelease } from '../../packages/client/src/release.mjs';
import { loadNativeAbi } from '../../packages/client/src/native.mjs';
import { openServiceSupervisor,readServiceHealth } from './supervisor.mjs';
import { recoverServiceLease } from './lease.mjs';
import { check,exact,publicError } from './policy.mjs';

async function fileJSON(file,privateFile=false){check(typeof file==='string'&&path.isAbsolute(file),'SERVICE_CONFIG_ABSOLUTE');const h=await fs.open(file,C.O_RDONLY|C.O_NOFOLLOW);try{const s=await h.stat();check(s.isFile()&&s.nlink===1&&s.size<=262144&&(!privateFile||(s.mode&0o077)===0&&s.uid===process.getuid()),'SERVICE_CONFIG_FILE_POLICY');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await h.readFile()));}finally{await h.close();}}
function options(args){const o={};for(let i=0;i<args.length;i++){const key=args[i];check(/^--(?:config|adapter|ticks|duration-ms|lane|token)$/.test(key)&&!Object.hasOwn(o,key)&&i+1<args.length,'SERVICE_CLI_OPTIONS');o[key]=args[++i];}return o;}
export async function runServiceCLI(argv,{fetchImpl=globalThis.fetch,adapters=null,print=console.log}={}){
  const [command,...rest]=argv;check(['run','tick','status','recover-lease','resume-signing','resume-cancelled'].includes(command),'SERVICE_CLI_COMMAND');const o=options(rest),doc=await fileJSON(o['--config'],true);exact(doc,['releaseFile','localPublicFixture','service']);const release=await validateProductionRelease(await fileJSON(doc.releaseFile),{localPublicFixture:doc.localPublicFixture}),abi=loadNativeAbi(nativeAbiBytesForRelease(release),{expectedHash:release.input.abiHash}),config=doc.service;
  let out;if(command==='status')out=await readServiceHealth({release,abi,config});else if(command==='recover-lease')out=await recoverServiceLease({directory:config.stateDirectory,expectedToken:o['--token']});else{
    let injected=adapters??{};if(o['--adapter']){check(adapters===null&&path.isAbsolute(o['--adapter']),'SERVICE_ADAPTER_PATH');const st=await fs.lstat(o['--adapter']);check(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o022)===0,'SERVICE_ADAPTER_FILE_POLICY');const module=await import(pathToFileURL(o['--adapter']).href);check(typeof module.createServiceAdapters==='function','SERVICE_ADAPTER_EXPORT');injected=await module.createServiceAdapters({release,abi});}
    const supervisor=await openServiceSupervisor({release,abi,config,fetchImpl:injected.fetchImpl??fetchImpl,signer:injected.signer??null,quoteAdapter:injected.quoteAdapter??null}),controller=new AbortController(),stop=()=>{supervisor.stop();controller.abort();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
    try{if(command==='resume-signing')out=await supervisor.resumeSigning(o['--lane']);else if(command==='resume-cancelled')out=await supervisor.resumeCancelled(o['--lane']);else if(command==='tick')out=await supervisor.tick();else{const positive=(v,max)=>{check(/^[1-9][0-9]*$/.test(v)&&Number(v)<=max,'SERVICE_CLI_BOUND');return Number(v);};out=await supervisor.run({maxTicks:o['--ticks']?positive(o['--ticks'],config.poll.maxTicks):config.poll.maxTicks,maxDurationMs:o['--duration-ms']?positive(o['--duration-ms'],config.poll.maxDurationMs):config.poll.maxDurationMs,signal:controller.signal});}}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await supervisor.close();if(out?.health)out={...out,health:supervisor.health()};}
  }
  print(JSON.stringify(out));return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runServiceCLI(process.argv.slice(2)).catch(e=>{console.error(publicError(e));process.exitCode=1;});
