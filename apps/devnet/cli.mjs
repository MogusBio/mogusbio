import {readFile,writeFile,mkdir,open,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DevnetRpc,DEVNET_RPC} from './rpc.mjs';
import {prepareDevnetRelease} from './prepare.mjs';
import {buildDevnetProgram} from './build.mjs';
import {quoteDevnetDeployment,deployDevnetProgram} from './deploy.mjs';
import {createDevnetBootstrapExecutor} from './bootstrap-executor.mjs';
import {initDevnetProtocol,seedDevnetOpening,sealDevnetOpening} from './bootstrap.mjs';
import {validateProductionRelease,nativeAbiBytesForRelease} from '../../packages/client/src/release.mjs';
import {loadNativeAbi} from '../../packages/client/src/native.mjs';
import {isDevnetRelease} from '../../packages/client/src/cluster.mjs';
import {inspectDevnetReadiness} from '../../packages/client/src/devnet-readiness.mjs';
import {ReadOnlyRpc} from '../../packages/client/src/rpc.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,null,2)+'\n';
const commands=new Set(['prepare','build','quote','deploy','init','seed','seal','opening','readiness','configure']);
export function devnetOptions(args){
  const command=args[0];check(commands.has(command),'DEVNET_COMMAND');const values={};
  for(let i=1;i<args.length;i++){const name=args[i];check(['--directory','--endpoint','--max-spend-lamports','--max-transitions','--seed-delay-seconds'].includes(name)&&args[i+1]&&!Object.hasOwn(values,name),'DEVNET_CLI_ARGUMENT');values[name]=args[++i];}
  const directory=values['--directory'];check(typeof directory==='string'&&path.isAbsolute(directory)&&path.resolve(directory)===directory,'DEVNET_CLI_DIRECTORY');
  const integer=(key,initial,min,max)=>{const v=values[key]??initial;check(/^(0|[1-9][0-9]*)$/.test(v)&&BigInt(v)>=BigInt(min)&&BigInt(v)<=BigInt(max),'DEVNET_CLI_INTEGER');return Number(v);};
  const maximum=values['--max-spend-lamports'];if(maximum!==undefined)check(/^(0|[1-9][0-9]{0,19})$/.test(maximum)&&BigInt(maximum)<1n<<64n,'DEVNET_CLI_SPEND');
  check(command!=='deploy'||maximum!==undefined,'DEVNET_CLI_SPEND_REQUIRED');
  return{command,directory,endpoint:values['--endpoint']??DEVNET_RPC,maxSpendLamports:maximum===undefined?null:BigInt(maximum),maxTransitions:integer('--max-transitions','64',1,1024),seedDelaySeconds:integer('--seed-delay-seconds','7200',3600,86400)};
}
async function save(file,body){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temporary=`${file}.${randomBytes(8).toString('hex')}.tmp`,f=await open(temporary,'wx',0o600);try{await f.writeFile(json(body));await f.sync();}finally{await f.close();}await rename(temporary,file);}
/** These commands only use the new, isolated Devnet operator identities.
 * No command accepts a player key, custom cluster genesis or mainnet fallback. */
export async function runDevnetCommand(options,{fetchImpl=globalThis.fetch,onProgress=()=>{}}={}){
  const{command,directory,endpoint,maxSpendLamports,maxTransitions,seedDelaySeconds}=options,privateRoot=path.join(ROOT,'.data/devnet'),keyDirectory=path.join(privateRoot,'keys'),identitiesFile=path.join(privateRoot,'identities-public.json'),releaseFile=path.join(directory,'release.json'),buildDirectory=path.join(directory,'build'),buildRecordPath=path.join(buildDirectory,'build-public.json'),elfPath=path.join(buildDirectory,'biolab_economy.so');
  const rpc=new DevnetRpc({endpoint,fetchImpl,allowTransactions:['deploy','init','seed','seal','opening'].includes(command)});
  if(command==='prepare')return prepareDevnetRelease({rpc,identitiesFile,directory,seedDelaySeconds});
  const release=await validateProductionRelease(JSON.parse(await readFile(releaseFile,'utf8')));check(isDevnetRelease(release),'DEVNET_CLI_RELEASE');
  if(command==='build')return buildDevnetProgram({releaseFile,directory:buildDirectory,onOutput:onProgress});
  if(command==='quote'){const q=await quoteDevnetDeployment({rpc,elfBytes:await readFile(elfPath),payer:release.input.bootstrap});await save(path.join(directory,'deployment-quote.json'),q);return q;}
  if(command==='readiness')return inspectDevnetReadiness({release,rpc:new ReadOnlyRpc({release,endpoint,fetchImpl,maxAccountDataBytes:4*1024*1024})});
  const build=JSON.parse(await readFile(buildRecordPath,'utf8'));check(build.profile==='BIO-DEVNET-BUILD1'&&build.releaseHash===release.input.releaseHash&&build.abiHash===release.input.abiHash&&build.programId===release.input.programId,'DEVNET_CLI_BUILD');
  if(command==='deploy')return deployDevnetProgram({rpc,release,elfPath,buildRecordPath,keyDirectory,directory:path.join(directory,'loader'),maxSpendLamports,onProgress});
  if(command==='configure'){const cfg={profile:'BIO-DEVNET-SERVER1',endpoint,releaseFile,identitiesFile,stateDirectory:path.join(directory,'runtime'),expectedElfSHA:build.elfSHA256,keyDirectory,servicesEnabled:true};const file=path.join(privateRoot,'server-config.json');await save(file,cfg);return{profile:'BIO-DEVNET-CONFIGURED1',serverConfig:file,programId:release.input.programId,actualDeploymentVerified:false,transactionExecuted:false,networkSubmitted:false};}
  const abi=loadNativeAbi(nativeAbiBytesForRelease(release),{expectedHash:release.input.abiHash}),executor=await createDevnetBootstrapExecutor({rpc,release,abi,keyFile:path.join(keyDirectory,'deployer.json'),directory:path.join(directory,'executor'),endpoint,fetchImpl,maxRentLamports:100000000n}),args={release,abi,rpc,actor:executor.actor,execute:executor.execute,expectedElfSHA:build.elfSHA256,storeDirectory:path.join(directory,'opening'),maxRentLamports:100000000n,maxTransitions,onProgress};
  if(command==='init')return initDevnetProtocol(args);if(command==='seed')return seedDevnetOpening(args);if(command==='seal')return sealDevnetOpening(args);
  const initialized=await initDevnetProtocol(args);if(initialized.decision!=='INITIALIZED')return initialized;const seeds=await seedDevnetOpening(args);if(seeds.decision!=='SEEDS_REGISTERED')return seeds;return sealDevnetOpening(args);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const options=devnetOptions(process.argv.slice(2)),result=await runDevnetCommand(options,{onProgress:value=>process.stderr.write(typeof value==='string'?value:json(value))});process.stdout.write(json(result));}catch(error){const code=error?.code??error?.message;console.error(typeof code==='string'&&/^[A-Z0-9_]{1,100}$/.test(code)?code:'DEVNET_COMMAND_FAILED');process.exitCode=1;}}
