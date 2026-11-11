import {open,lstat,realpath} from 'node:fs/promises';
import {constants as C} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createKeyPairFromPrivateKeyBytes,getAddressFromPublicKey,signTransaction} from '@solana/kit';
import {isDevnetRelease} from '../../packages/client/src/cluster.mjs';
import {decodeNativeFrame,nativeKeyAddress,nativeKeyBytes} from '../../packages/client/src/native.mjs';
import {inspectPreparedNativeEnvelope} from '../../packages/client/src/session.mjs';
import {decodeV1Transaction,transactionBytes,validateV1Resources} from '../../packages/client/src/transaction.mjs';
import {verifyWalletSignedV1} from '../../packages/client/src/wallet.mjs';
import {restoreResearchManifest} from '../../packages/client/src/research-manifest.mjs';
import {GLOBAL_OPS,servicePolicy} from '../service/policy.mjs';
import {serviceQuoteAdapter} from '../service/quote.mjs';
import {DevnetRpc,DEVNET_RPC} from './rpc.mjs';

const PROJECT=fileURLToPath(new URL('../../',import.meta.url)),KEYS=path.join(PROJECT,'.data/devnet/keys'),HEX=/^[a-f0-9]{64}$/,NAMES=/^(?:deployer|ops-[1-5])\.json$/;
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},sha=s=>createHash('sha256').update(s).digest('hex');
const own=s=>typeof process.getuid!=='function'||s.uid===process.getuid(),safe=e=>Object.assign(Error(typeof e?.code==='string'&&/^SERVICE_DEVNET_[A-Z0-9_]+$/.test(e.code)?e.code:'SERVICE_DEVNET_SIGNING_REFUSED'),{code:typeof e?.code==='string'&&/^SERVICE_DEVNET_[A-Z0-9_]+$/.test(e.code)?e.code:'SERVICE_DEVNET_SIGNING_REFUSED'});
const abort=signal=>check(!signal?.aborted,'SERVICE_DEVNET_ABORTED');
async function privateBytes(file,max){check(path.isAbsolute(file),'SERVICE_DEVNET_PRIVATE_PATH');const h=await open(file,C.O_RDONLY|C.O_NOFOLLOW);try{const s=await h.stat();check(s.isFile()&&s.nlink===1&&own(s)&&(s.mode&0o077)===0&&s.size<=max,'SERVICE_DEVNET_PRIVATE_FILE');return await h.readFile();}finally{await h.close();}}
async function privateDirectory(directory){check(path.isAbsolute(directory),'SERVICE_DEVNET_PRIVATE_PATH');const s=await lstat(directory);check(s.isDirectory()&&!s.isSymbolicLink()&&own(s)&&(s.mode&0o077)===0,'SERVICE_DEVNET_PRIVATE_DIRECTORY');check(await realpath(directory)===path.resolve(directory),'SERVICE_DEVNET_PRIVATE_DIRECTORY');}
const resourceArray=r=>[r.computeUnitLimit,r.loadedAccountsDataSizeLimit,r.heapSize,String(r.priorityFeeLamports)];
export async function readDevnetServiceManifest({release,abi,author,cranker,workflowId,manifestDirectory}){
 check(isDevnetRelease(release)&&author!==cranker&&HEX.test(workflowId),'SERVICE_DEVNET_RESEARCH_DELEGATION');await privateDirectory(manifestDirectory);const file=path.join(manifestDirectory,`research-${workflowId}.json`),bytes=await privateBytes(file,1300000);let stored;try{stored=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
 check(stored&&Object.keys(stored).sort().join(',')==='payload,revision,sha256,version'&&stored.version==='BIOCLIENT-FILE-CAS1'&&typeof stored.payload==='string'&&Buffer.byteLength(stored.payload)<=600000&&stored.sha256===sha(stored.payload)&&typeof stored.revision==='string'&&/^(?:0|[1-9][0-9]*)$/.test(stored.revision),'SERVICE_DEVNET_RESEARCH_JOURNAL');
 const manifest=await restoreResearchManifest({release,abi,author,workflowId,text:stored.payload});check(manifest.author===author&&manifest.cranker===cranker,'SERVICE_DEVNET_RESEARCH_BINDING');return manifest;
}
async function existingManifest({release,abi,job,actor,frame,envelope}){
 check(job.delegated===true&&job.cranker===actor,'SERVICE_DEVNET_RESEARCH_DELEGATION');const manifest=await readDevnetServiceManifest({release,abi,...job});check(frame.payload.subarray(0,32).equals(manifest.baseManifest.plan.artifactId)&&frame.payload.readBigUInt64LE(32)===manifest.expectedGeneration+1n,'SERVICE_DEVNET_RESEARCH_BINDING');check(frame.payload.readBigUInt64LE(76)<=manifest.maxRent,'SERVICE_DEVNET_RESEARCH_RENT');check(JSON.stringify(resourceArray(envelope.resources))===JSON.stringify(resourceArray(manifest.resources)),'SERVICE_DEVNET_RESEARCH_RESOURCES');
 const allowed=new Set([...manifest.baseManifest.plan.directRoots.map(r=>r.address),...manifest.baseManifest.plan.parents.map(r=>r.artifactAddress)]);for(const account of envelope.dynamicAccounts)check(allowed.has(account.address)&&account.writable===false&&account.signer===false,'SERVICE_DEVNET_RESEARCH_ACCOUNTS');return manifest;
}
/** Trusted local construction. Keys are dedicated Devnet test identities only.
 * The returned signer has no broadcast method and will never sign player ops. */
export async function createDevnetServiceAdapters({release,abi,serviceConfig,keyDirectory=KEYS,keyFiles=['ops-2.json','ops-1.json'],endpoint,fetchImpl=globalThis.fetch,globalActor,researchJobs=[],maxRent=10000000n,resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n}}={}){
 try{
  check(isDevnetRelease(release)&&abi?.hash===release.input.abiHash,'SERVICE_DEVNET_RELEASE');const policy=serviceConfig===undefined?null:servicePolicy({release,abi,config:serviceConfig});if(policy){check(endpoint===undefined||new URL(endpoint).href===new URL(policy.endpoint??DEVNET_RPC).href,'SERVICE_DEVNET_ENDPOINT_CHANGED');endpoint=policy.endpoint??DEVNET_RPC;globalActor=policy.globalActor;researchJobs=policy.jobs;maxRent=policy.maxRent;resources=policy.resources;}endpoint??=DEVNET_RPC;check(typeof fetchImpl==='function'&&Array.isArray(keyFiles)&&keyFiles.length>=1&&keyFiles.length<=6&&new Set(keyFiles).size===keyFiles.length&&keyFiles.every(name=>typeof name==='string'&&NAMES.test(name)),'SERVICE_DEVNET_KEY_SELECTION');check(Array.isArray(researchJobs)&&researchJobs.length<=8&&typeof maxRent==='bigint'&&maxRent>=0n&&maxRent<(1n<<64n),'SERVICE_DEVNET_POLICY');const caps=validateV1Resources(resources);await privateDirectory(keyDirectory);const pairs=new Map();
  for(const name of keyFiles){const raw=await privateBytes(path.join(keyDirectory,name),4096);let values;try{values=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));check(Array.isArray(values)&&values.length===64&&values.every(v=>Number.isInteger(v)&&v>=0&&v<=255),'SERVICE_DEVNET_KEY_FORMAT');const bytes=Uint8Array.from(values);try{const pair=await createKeyPairFromPrivateKeyBytes(bytes.subarray(0,32)),actor=await getAddressFromPublicKey(pair.publicKey);check(Buffer.from(nativeKeyBytes(actor)).equals(Buffer.from(bytes.subarray(32))),'SERVICE_DEVNET_KEY_PUBLIC_MATCH');check(!pairs.has(actor),'SERVICE_DEVNET_KEY_DUPLICATE');pairs.set(actor,pair);}finally{bytes.fill(0);}}finally{raw.fill(0);if(Array.isArray(values))values.fill(0);}}
  const global=globalActor===undefined?[...pairs.keys()][0]:globalActor===null?null:nativeKeyAddress(globalActor),jobs=researchJobs.map(job=>{check(job&&job.delegated===true&&HEX.test(job.workflowId)&&path.isAbsolute(job.manifestDirectory??''),'SERVICE_DEVNET_RESEARCH_POLICY');return Object.freeze({...job,author:nativeKeyAddress(job.author),cranker:nativeKeyAddress(job.cranker)});});check(new Set(jobs.map(j=>`${j.author}:${j.workflowId}`)).size===jobs.length,'SERVICE_DEVNET_RESEARCH_POLICY');check((global===null||pairs.has(global))&&jobs.every(job=>pairs.has(job.cranker)),'SERVICE_DEVNET_ROLE_KEY_MISSING');
  const probe=new DevnetRpc({endpoint,fetchImpl,allowTransactions:false}),target=probe.endpoint;
  const verifiedFetch=async(url,init)=>{check(new URL(url).href===target,'SERVICE_DEVNET_ENDPOINT_CHANGED');await probe.verifyNetwork();return fetchImpl(target,init);};
  const signer=Object.freeze({actors:Object.freeze([...pairs.keys()]),signOnly:true,async signEnvelope(envelope,context){try{
   abort(context?.signal);check(policy===null||policy.sendEnabled,'SERVICE_DEVNET_SEND_DISABLED');check(context&&pairs.has(context.actor)&&context.requestId===envelope?.messageSHA256&&envelope.actor===context.actor&&envelope.feePayer===context.actor&&!envelope.labDestinationSetup,'SERVICE_DEVNET_ACTOR');const frame=decodeNativeFrame(abi,Buffer.from(envelope.frameHex,'hex'));check(frame.operation===envelope.operation,'SERVICE_DEVNET_OPERATION');
   if(GLOBAL_OPS.includes(frame.operation))check(context.role==='global'&&context.actor===global,'SERVICE_DEVNET_GLOBAL_ROLE');else check(frame.operation==='VERIFY_STEP'&&context.role==='research','SERVICE_DEVNET_OPERATION');
   const inspected=await inspectPreparedNativeEnvelope({release,abi,envelope}),required=Object.keys(inspected.transaction.signatures);check(required.length===1&&required[0]===context.actor&&inspected.actor===context.actor,'SERVICE_DEVNET_REQUIRED_SIGNER');check(frame.payload.length>=8&&frame.payload.readBigUInt64LE(frame.payload.length-8)<=maxRent,'SERVICE_DEVNET_RENT_CAP');const actual=envelope.resources;check(actual.computeUnitLimit<=caps.computeUnitLimit&&actual.loadedAccountsDataSizeLimit<=caps.loadedAccountsDataSizeLimit&&actual.heapSize<=caps.heapSize&&BigInt(actual.priorityFeeLamports)<=caps.priorityFeeLamports,'SERVICE_DEVNET_RESOURCE_CAP');
   if(frame.operation==='VERIFY_STEP'){let matched=false;for(const job of jobs.filter(j=>j.cranker===context.actor)){try{await existingManifest({release,abi,job,actor:context.actor,frame,envelope});matched=true;break;}catch{}}check(matched,'SERVICE_DEVNET_RESEARCH_NOT_AUTHORIZED');}
   abort(context.signal);await probe.verifyNetwork();abort(context.signal);const signed=transactionBytes(await signTransaction([pairs.get(context.actor)],decodeV1Transaction(inspected.unsignedBytes).transaction));abort(context.signal);verifyWalletSignedV1(inspected.unsignedBytes,signed);return signed;
  }catch(error){throw safe(error);}}});
  return Object.freeze({signer,quoteAdapter:serviceQuoteAdapter({release,abi,endpoint:target,fetchImpl:verifiedFetch}),fetchImpl:verifiedFetch});
 }catch(error){throw safe(error);}
}
/** CLI adapter entry point; deliberately never searches personal wallet paths. */
export async function createServiceAdapters({release,abi}){
 try{let config=null;const file=process.env.BIO_DEVNET_SERVICE_CONFIG;if(file){check(path.isAbsolute(file),'SERVICE_DEVNET_CONFIG_PATH');const bytes=await privateBytes(file,32768);let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}check(document?.localPublicFixture===false&&document.service,'SERVICE_DEVNET_CONFIG');config=document.service;}
  const names=process.env.BIO_DEVNET_SERVICE_KEY_FILES?JSON.parse(process.env.BIO_DEVNET_SERVICE_KEY_FILES):['ops-2.json','ops-1.json'];return await createDevnetServiceAdapters({release,abi,keyDirectory:KEYS,keyFiles:names,endpoint:config?.endpoint??process.env.BIO_DEVNET_RPC??DEVNET_RPC,...(config?{serviceConfig:config}:{})});
 }catch(error){throw safe(error);}
}
