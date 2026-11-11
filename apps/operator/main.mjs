import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';import { pathToFileURL } from 'node:url';
import { validateProductionRelease,nativeAbiBytesForRelease } from '../../packages/client/src/release.mjs';
import { loadNativeAbi } from '../../packages/client/src/native.mjs';
import { NativePlayerSession,inspectPreparedNativeEnvelope } from '../../packages/client/src/session.mjs';
import { FileJournalStore } from '../../packages/client/src/file-journal.mjs';
import { ReadOnlyRpc } from '../../packages/client/src/rpc.mjs';
import { planPlayerPositionAction,nativeActionIntent } from '../../packages/client/src/player-settlement.mjs';
import { validateV1Resources } from '../../packages/client/src/transaction.mjs';
import { planNextGlobalSettlement } from '../../packages/client/src/keeper.mjs';
import { planFinalHourClosure } from '../../packages/client/src/settlement-workflow.mjs';
import { nativePda } from '../../packages/client/src/native.mjs';
import { PROGRAMS } from '../../packages/client/src/release.mjs';
import { prepareNativeCancellation,reconcileNativeCancellation } from '../../packages/client/src/recovery.mjs';

const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const check=(v,c)=>{if(!v)fail(c);};
const stringify=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():Buffer.isBuffer(x)?x.toString('hex'):x,2);
const decimal=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s),'CLI_DECIMAL');return BigInt(s);};
async function jsonFile(file){check(typeof file==='string'&&path.isAbsolute(file),'CLI_ABSOLUTE_PATH_REQUIRED');const data=await readFile(file);check(data.length<=2*1024*1024,'CLI_INPUT_TOO_LARGE');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}
async function output(file,value){const text=stringify(value)+'\n';if(file){check(path.isAbsolute(file),'CLI_ABSOLUTE_PATH_REQUIRED');await writeFile(file,text,{flag:'wx',mode:0o600});return {saved:file};}return value;}
function resourceInput(r,explicit=false){
  check(r&&typeof r==='object'&&!Array.isArray(r)&&(!explicit||Object.keys(r).length===4)
    &&Object.keys(r).every(k=>['computeUnitLimit','loadedAccountsDataSizeLimit','heapSize','priorityFeeLamports'].includes(k)),'CLI_RESOURCES');
  return validateV1Resources({...r,priorityFeeLamports:decimal(r.priorityFeeLamports)});
}
async function exportPlan(result,outFile,resources,print){
  if(result.decision!=='ACTION'){print(stringify(result));return result;}
  const intent=nativeActionIntent(result.action,resources),exported=await output(outFile,intent);
  const out={decision:result.decision,contextSlot:result.contextSlot,operation:intent.operation,nonce:intent.nonce,
    ...(result.previewAtoms===undefined?{}:{previewAtoms:result.previewAtoms}),...(result.hour===undefined?{}:{hour:result.hour}),
    clientPlanOnly:true,transactionExecuted:false,...(outFile?{intentSaved:exported.saved}:{intent})};
  print(stringify(out));return out;
}
function options(args){const o={};for(let i=0;i<args.length;i++){
  const k=args[i];check(/^--[a-z-]+$/.test(k)&&!(k.slice(2)in o),'CLI_OPTION');
  if(k==='--local-public-fixture')o[k.slice(2)]=true;else{check(i+1<args.length&&!args[i+1].startsWith('--'),'CLI_OPTION_VALUE');o[k.slice(2)]=args[++i];}
}return o;}
const help=`BioLab 原生客户端（不保存私钥）
catalog                         列出精确 ABI、账户表和载荷长度
release --release /absolute.json 核对发布输入
inspect --release ... --envelope /absolute.json
prepare --release ... --intent /absolute.json --actor ADDRESS --state /absolute/dir --endpoint HTTPS_RPC --out /absolute/new.json
simulate --release ... --envelope ... --endpoint HTTPS_RPC
refresh --release ... --envelope ... --actor ... --state ... --endpoint ... --out ...
status --release ... --actor ... --nonce N --state ... --endpoint ...
position-plan --release ... --actor ... --request /absolute.json --endpoint ... --out /absolute/new-intent.json
keeper-plan --release ... --actor ... --request /absolute.json --endpoint ... --out /absolute/new-intent.json
cancel-prepare --release ... --actor ... --nonce N --state ... --recovery-state /absolute/separate-dir --request ... --endpoint ... --out ...
cancel-status --release ... --actor ... --nonce N --state ... --recovery-state ... --endpoint ...
broadcast --release ... --envelope ... --signed /absolute.json --actor ... --state ... --endpoint ...

prepare/refresh 只导出未签名交易；simulate 不执行。broadcast 是唯一发送命令，
只接收外部钱包完整签名的 {"signedTransactionBase64":"..."}，并检查原消息及恢复记录。
RPC 收到只表示 PENDING；status 以 finalized ActorNonce 恢复业务结果。
position-plan 读取真实已确认账本，导出一次补记或领取的未签名 intent；
需另行 prepare、外部钱包签名和显式 broadcast。等待状态不生成 intent 文件。
keeper-plan 只计划一步全局事件/冻结推进；不替玩家扫描全部作品或领取收益。
cancel-prepare 只准备另签的同 nonce SYNC 取消交易，保留原请求。它不会撤回
已发送交易；原请求和取消只能竞争一个序号。cancel-status 核对两份真实日志。
首次 CLAIM 可选 labDestinationSetup:{beneficiary:ADDRESS}，只前置固定 LAB ATA
CreateIdempotent；由 actor 支付实际 ATA 租存，BIO maxRent 不覆盖该前置成本。
公开测试身份必须显式 --local-public-fixture，且发送端点仅限 loopback。
输出文件必须是新文件，不能覆盖旧签名或旧恢复材料。`;

/** Explicit command entry point. Importing this file never calls a network,
 * wallet or command. Tests and applications can inject a bounded mock fetch. */
export async function runOperator(argv,{fetchImpl,print=()=>{}}={}){
  const [command,...args]=argv;if(!command||command==='help'){print(help);return {help:true};}
  const o=options(args),allowed={catalog:[],release:['release','local-public-fixture'],
    inspect:['release','envelope','local-public-fixture'],prepare:['release','intent','actor','state','endpoint','out','local-public-fixture'],
    simulate:['release','envelope','endpoint','local-public-fixture'],refresh:['release','envelope','actor','state','endpoint','out','local-public-fixture'],
    status:['release','actor','nonce','state','endpoint','local-public-fixture'],broadcast:['release','envelope','signed','actor','state','endpoint','local-public-fixture'],
    'position-plan':['release','actor','request','endpoint','out','local-public-fixture'],
    'keeper-plan':['release','actor','request','endpoint','out','local-public-fixture'],
    'cancel-prepare':['release','actor','nonce','state','recovery-state','request','endpoint','out','local-public-fixture'],
    'cancel-status':['release','actor','nonce','state','recovery-state','endpoint','local-public-fixture']}[command];
  check(allowed&&Object.keys(o).every(k=>allowed.includes(k)),'CLI_COMMAND_OR_OPTIONS');
  if(command==='catalog'){const abi=JSON.parse(await readFile(new URL('../../programs/biolab-economy/operations.p0r2.json',import.meta.url)));const result={profile:abi.profile,wireVersion:abi.wireVersion,prefix:abi.prefix,operations:abi.operations};print(stringify(result));return result;}
  const release=await validateProductionRelease(await jsonFile(o.release),{localPublicFixture:o['local-public-fixture']===true});
  const abi=loadNativeAbi(nativeAbiBytesForRelease(release),{expectedHash:release.hashes.abiHash.toString('hex')});
  if(command==='release'){const result={validInput:true,profile:release.input.profile,program:release.input.programId,
    localPublicFixture:release.localPublicFixture,productionAdmission:false};print(stringify(result));return result;}
  let envelope=null,prepared=null;
  if(o.envelope){envelope=await jsonFile(o.envelope);prepared=await inspectPreparedNativeEnvelope({release,abi,envelope});}
  if(command==='inspect'){const result={operation:envelope.operation,actor:prepared.actor,nonce:prepared.nonce,bytes:prepared.unsignedBytes.length,
    requestHash:prepared.requestHash.toString('hex'),requiredSigners:Object.keys(prepared.transaction.signatures),resources:envelope.resources,
    businessExecutionVerified:false,...(envelope.labDestinationSetup===undefined?{}:{labDestinationSetup:envelope.labDestinationSetup})};print(stringify(result));return result;}
  const actor=o.actor??prepared?.actor;check(actor,'CLI_ACTOR_REQUIRED');
  if(command==='position-plan'){
    const request=await jsonFile(o.request),fields=['instanceHex','positionSeq','kind','maxRent','resources'];
    check(request&&Object.keys(request).length===fields.length&&Object.keys(request).every(k=>fields.includes(k))
      &&typeof request.instanceHex==='string'&&/^[0-9a-f]{64}$/.test(request.instanceHex),'CLI_POSITION_REQUEST');
    const resources=resourceInput(request.resources,true);
    const rpc=new ReadOnlyRpc({release,endpoint:o.endpoint,fetchImpl,allowLocalhost:release.localPublicFixture});
    const result=await planPlayerPositionAction({release,abi,rpc,actor,instance:Buffer.from(request.instanceHex,'hex'),positionSeq:decimal(request.positionSeq),kind:request.kind,maxRent:decimal(request.maxRent)});
    return exportPlan(result,o.out,resources,print);
  }
  if(command==='keeper-plan'){
    const request=await jsonFile(o.request);
    check(request&&['maxRent,resources','closeHour,maxRent,resources'].includes(Object.keys(request).sort().join(',')),'CLI_KEEPER_REQUEST');
    const resources=resourceInput(request.resources,true),rpc=new ReadOnlyRpc({release,endpoint:o.endpoint,fetchImpl,allowLocalhost:release.localPublicFixture});
    if(request.closeHour!==undefined){
      const hour=decimal(request.closeHour);await rpc.verifyBaseConfig();const observed=await rpc.getActorNonce(actor);
      const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(hour);
      const registry=await nativePda(release.input.programId,'bio','mining'),hourPda=await nativePda(release.input.programId,'bio','hour',bytes);
      const {contextSlot,accounts:[registryAccount,hourAccount,clockAccount]}=await rpc.getMultipleAccounts([registry.address,hourPda.address,PROGRAMS.clockSysvar]);
      const action=await planFinalHourClosure({release,abi,actor,nonce:observed.nextNonce,hour,registryAccount,hourAccount,clockAccount,maxRent:decimal(request.maxRent)});
      return exportPlan({decision:'ACTION',contextSlot,hour,action},o.out,resources,print);
    }
    return exportPlan(await planNextGlobalSettlement({release,abi,rpc,actor,maxRent:decimal(request.maxRent)}),o.out,resources,print);
  }
  // Simulation has no persistent mutation; all other online commands require
  // actual CAS storage, never an ephemeral stand-in.
  const store=command==='simulate'?{load(){fail('CLI_SIMULATION_NO_STORE');},compareAndSwap(){fail('CLI_SIMULATION_NO_STORE');}}:
    await FileJournalStore.open({directory:o.state});
  const session=new NativePlayerSession({release,abi,actor,store,endpoint:o.endpoint,fetchImpl,
    allowLocalhost:release.localPublicFixture});let result;
  if(command==='cancel-prepare'||command==='cancel-status'){
    const cancellationStore=await FileJournalStore.open({directory:o['recovery-state']}),cancellationSession=new NativePlayerSession({release,abi,actor,store:cancellationStore,
      endpoint:o.endpoint,fetchImpl,allowLocalhost:release.localPublicFixture});
    const params={release,abi,actor,primarySession:session,cancellationSession,nonce:decimal(o.nonce)};
    if(command==='cancel-status')result=await reconcileNativeCancellation(params);
    else{
      const request=await jsonFile(o.request);check(request&&Object.keys(request).sort().join(',')==='maxRent,resources','CLI_CANCELLATION_REQUEST');
      const prepared=await prepareNativeCancellation({...params,maxRent:decimal(request.maxRent),resources:resourceInput(request.resources,true)});
      const saved=await output(o.out,prepared.envelope);result={decision:prepared.decision,nonce:prepared.nonce,
        requiresSeparateSignature:true,businessExecutionVerified:false,primaryRequestHash:prepared.primaryRequestHash,cancellationRequestHash:prepared.cancellationRequestHash,
        ...(o.out?{saved:saved.saved}:{envelope:saved})};
    }
  }else if(command==='prepare'){
    const intent=await jsonFile(o.intent),fields=['operation','nonce','payloadHex','suffix','dynamicAccounts','feePayer','resources','labDestinationSetup'];
    check(intent&&Object.keys(intent).every(k=>fields.includes(k))&&typeof intent.payloadHex==='string'&&/^(?:[0-9a-f]{2})*$/.test(intent.payloadHex),'CLI_INTENT');
    const resources=resourceInput(intent.resources);
    result=await session.prepare({...intent,payload:Buffer.from(intent.payloadHex,'hex'),nonce:decimal(intent.nonce),
      resources});
    result=await output(o.out,result);
  }else if(command==='simulate')result=await session.rpc.simulatePreparedV1(prepared.unsignedBytes,{supportedTransactionVersions:[1]});
  else if(command==='refresh')result=await output(o.out,await session.refresh(envelope));
  else if(command==='status')result=await session.reconcile(decimal(o.nonce));
  else if(command==='broadcast'){
    const signed=await jsonFile(o.signed);check(signed&&Object.keys(signed).join(',')==='signedTransactionBase64'
      &&typeof signed.signedTransactionBase64==='string','CLI_SIGNED_FILE');const bytes=Buffer.from(signed.signedTransactionBase64,'base64');
    check(bytes.length<=4096&&bytes.toString('base64')===signed.signedTransactionBase64,'CLI_SIGNED_BASE64');result=await session.broadcastSigned(envelope,bytes);
  }else fail('CLI_COMMAND');
  print(stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runOperator(process.argv.slice(2),{fetchImpl:globalThis.fetch,print:console.log}).catch(e=>{console.error(e.code??e.message);process.exitCode=1;});
}
