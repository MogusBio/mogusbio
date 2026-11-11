import { readFile,writeFile,mkdtemp,realpath,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { validateProductionRelease,baseConfigR2Id } from '../packages/client/src/release.mjs';
import { loadNativeAbi,decodeNativeFrame,nativeOperation,nativeKeyAddress,nativeRequestHash,validateNativeResult,buildNativeInstruction } from '../packages/client/src/native.mjs';
import { NativePlayerSession,inspectPreparedNativeEnvelope } from '../packages/client/src/session.mjs';
import { FileJournalStore } from '../packages/client/src/file-journal.mjs';
import { decodeActorNonceSnapshot } from '../packages/client/src/journal.mjs';
import { decodeBuyPayload,decodeBuyResult } from '../packages/launchpad/src/codec.mjs';
import { decodeV1Transaction } from '../packages/client/src/transaction.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const hash=b=>createHash('sha256').update(b).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hex=(v,max)=>{check(typeof v==='string'&&v.length<=max*2&&/^(?:[0-9a-f]{2})*$/.test(v),'PURCHASE_CASE_HEX');return Buffer.from(v,'hex');};
const u64=v=>{const n=typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)?BigInt(v):v;
  check(typeof n==='bigint'&&n>=0n&&n<(1n<<64n),'PURCHASE_CASE_U64');return n;};
function jsonSafe(v){
  if(typeof v==='bigint')return v.toString();if(v instanceof Uint8Array)return Buffer.from(v).toString('hex');
  if(Array.isArray(v))return v.map(jsonSafe);if(object(v))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,jsonSafe(x)]));return v;
}
async function readJson(file,max=16*1024*1024){
  check(typeof file==='string'&&path.isAbsolute(file),'PURCHASE_ABSOLUTE_PATH');const bytes=await readFile(file);
  check(bytes.length<=max,'PURCHASE_CASE_SIZE');return {bytes,value:parseJsonWithBigInts(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
}
function accounts(rows){
  check(Array.isArray(rows)&&rows.length>=2&&rows.length<=64,'PURCHASE_CASE_ACCOUNTS');const map=new Map();
  for(const row of rows){
    check(object(row),'PURCHASE_CASE_ACCOUNT');const address=nativeKeyAddress(row.address);check(!map.has(address),'PURCHASE_CASE_ACCOUNT_DUPLICATE');
    if(row.missing===true){check(Object.keys(row).sort().join(',')==='address,missing','PURCHASE_CASE_ACCOUNT');map.set(address,null);continue;}
    check(Object.keys(row).sort().join(',')==='address,data,executable,lamports,owner,rentEpoch'&&typeof row.executable==='boolean'
      &&Array.isArray(row.data)&&row.data.length===2&&row.data[1]==='base64'&&typeof row.data[0]==='string'&&row.data[0].length<=1400000,'PURCHASE_CASE_ACCOUNT');
    const data=Buffer.from(row.data[0],'base64');check(data.toString('base64')===row.data[0],'PURCHASE_CASE_ACCOUNT_BASE64');
    map.set(address,{address,owner:nativeKeyAddress(row.owner),lamports:u64(row.lamports),rentEpoch:u64(row.rentEpoch),executable:row.executable,data});
  }
  return map;
}
const rpcAccount=a=>a===null?null:{owner:a.owner,lamports:a.lamports,rentEpoch:a.rentEpoch,executable:a.executable,data:[a.data.toString('base64'),'base64']};
async function loadCases(file){
  const input=await readJson(file),value=input.value;check(object(value)&&value.fixtureOnly===true,'PURCHASE_FIXTURE_ONLY');
  if(value.schema==='BIO-BANK-PURCHASE-RESULT-CASE-1')return {input,cases:[{...input,file}]};
  check(Array.isArray(value.cases)&&value.cases.length>=1&&value.cases.length<=8,'PURCHASE_CASE_LIST');const cases=[];
  for(const entry of value.cases){
    check(object(entry)&&typeof entry.file==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(entry.file)
      &&!entry.file.includes('..')&&typeof entry.sha256==='string'&&/^[0-9a-f]{64}$/.test(entry.sha256),'PURCHASE_CASE_REFERENCE');
    const name=path.join(path.dirname(file),entry.file),loaded=await readJson(name);check(hash(loaded.bytes)===entry.sha256,'PURCHASE_CASE_SHA256');
    check(loaded.value.elfSHA256===value.elfSHA256&&loaded.value.abiSHA256===value.abiSHA256,'PURCHASE_CASE_BINDING');cases.push({...loaded,file:name});
  }
  return {input,cases};
}
function expectRejected(work,code){let rejected=false;try{work();}catch(error){check(code===undefined||error.code===code,'PURCHASE_REJECTION_CODE');rejected=true;}check(rejected,'PURCHASE_RESULT_SHOULD_REJECT');}
function actualExecution(row,resultHex){
  check(object(row)&&row.result==='Ok'&&row.verifiedEd25519===true&&u64(row.version)===1n&&u64(row.returnDataBytes)===58n
    &&row.returnDataHex===resultHex,'PURCHASE_BANK_EXECUTION');
  const signed=hex(row.signedTransactionHex,4096);check(signed.length===Number(u64(row.packetBytes))&&hash(signed)===row.signedTransactionSHA256,'PURCHASE_BANK_PACKET');
  const decoded=decodeV1Transaction(signed);check(BigInt(Object.keys(decoded.transaction.signatures).length)===u64(row.signatureCount),'PURCHASE_BANK_SIGNATURE_COUNT');
  return {actualSignature:row.actualSignature,signedTransactionSHA256:row.signedTransactionSHA256,packetBytes:u64(row.packetBytes),computeUnits:u64(row.computeUnits)};
}

/** Replays recorded Bank reads through the real SDK's finalized RPC gates.
 * This is offline evidence checking: its context slots, genesis response and
 * unsigned preparation lifetime are labelled fixture adapter inputs. Nothing
 * signs, sends, contacts a wallet/RPC, or establishes live network finality. */
export async function checkPurchaseBankSession({caseFile,releaseFile,abiFile,reportFile}){
  for(const file of [caseFile,releaseFile,abiFile])check(typeof file==='string'&&path.isAbsolute(file),'PURCHASE_ABSOLUTE_PATH');
  if(reportFile!==undefined)check(typeof reportFile==='string'&&path.isAbsolute(reportFile),'PURCHASE_ABSOLUTE_PATH');
  const [{input,cases},releaseInput,abiRaw]=await Promise.all([loadCases(caseFile),readJson(releaseFile,131072),readFile(abiFile)]);
  const release=await validateProductionRelease(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(releaseInput.bytes)),{localPublicFixture:true});
  const abi=loadNativeAbi(abiRaw,{expectedHash:release.input.abiHash});check(nativeOperation(abi,'BUY_MATERIAL').resultBytes===58,'PURCHASE_ABI_RESULT');
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-purchase-session-check-')),reports=[];
  try{
    for(const [index,loaded]of cases.entries()){
      const c=loaded.value;check(c.schema==='BIO-BANK-PURCHASE-RESULT-CASE-1'&&c.fixtureOnly===true&&c.networkBroadcast===false
        &&c.productionAdmission===false&&c.programId===release.input.programId&&c.abiSHA256===abi.hash,'PURCHASE_CASE_PROFILE');
      const frame=hex(c.frameHex,4096),decoded=decodeNativeFrame(abi,frame),actor=nativeKeyAddress(decoded.actor),nonce=decoded.nonce;
      check(decoded.operation==='BUY_MATERIAL'&&actor===c.actor&&decoded.domain.equals(release.domain)&&decoded.configId.equals(baseConfigR2Id(release))
        &&hash(frame)===c.frameSHA256&&nativeRequestHash(abi,frame).toString('hex')===c.requestH4,'PURCHASE_FRAME_BINDING');
      const instruction=c.instruction,op=nativeOperation(abi,'BUY_MATERIAL');
      check(object(instruction)&&instruction.programId===c.programId&&instruction.dataHex===c.frameHex&&instruction.expectedResult==='Ok'
        &&u64(instruction.seq)===u64(c.traceSequence)&&Array.isArray(instruction.accounts)&&instruction.accounts.length>=8+op.publicFixedSuffix.length,'PURCHASE_TRACE_INSTRUCTION');
      check(instruction.accounts[0].pubkey===actor&&instruction.accounts[1].pubkey===c.actorNonceAddress
        &&instruction.accounts[2].pubkey===c.econConfigAddress&&instruction.accounts[7].pubkey===c.baseConfigAddress
        &&c.baseConfigAddress===release.pdas.baseConfig.address,'PURCHASE_CASE_ADDRESSES');
      const suffix=op.publicFixedSuffix.map((r,i)=>({name:r.role,address:instruction.accounts[8+i].pubkey}));
      const dynamicAccounts=instruction.accounts.slice(8+suffix.length).map(a=>({address:a.pubkey,writable:a.isWritable,signer:a.isSigner}));
      const built=await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts});
      for(const [i,meta]of built.accounts.entries())check(meta.address===instruction.accounts[i].pubkey&&Boolean(meta.role&1)===instruction.accounts[i].isWritable
        &&Boolean(meta.role&2)===instruction.accounts[i].isSigner,'PURCHASE_TRACE_METAS');
      const snapshots=[accounts(c.beforeAccounts),accounts(c.afterAccounts),accounts(c.afterRetryAccounts)];
      for(const snapshot of snapshots)for(const address of [c.baseConfigAddress,c.actorNonceAddress])check(snapshot.has(address),'PURCHASE_SNAPSHOT_MISSING');
      const observations=[];for(const [i,snapshot]of snapshots.entries())observations.push(await decodeActorNonceSnapshot({release,actor,address:c.actorNonceAddress,
        account:snapshot.get(c.actorNonceAddress),contextSlot:BigInt(i+1),commitment:'finalized'}));
      check(observations[0].nextNonce===nonce&&observations[1].nextNonce===nonce+1n&&observations[2].nextNonce===nonce+1n
        &&observations[1].lastDigestHex===c.requestH4&&observations[2].lastDigestHex===c.requestH4,'PURCHASE_ACTUAL_NONCE_CACHE');
      const result=hex(observations[1].lastResultHex,256),resultHex=result.toString('hex'),purchase=decodeBuyResult(validateNativeResult(abi,frame,result));
      check(result.length===58&&observations[2].lastResultHex===resultHex&&resultHex===c.purchaseResult.resultHex
        &&u64(c.purchaseResult.cacheBytes)===58n&&u64(c.purchaseResult.nativeNonceBefore)===nonce&&u64(c.purchaseResult.nativeNonceAfter)===nonce+1n,'PURCHASE_ACTUAL_RESULT');
      const p=decodeBuyPayload(decoded.payload),expected=c.purchaseResult;
      for(const [name,evidence]of [['quantity','quantity'],['saleLamports','saleLamports'],['resourceLamports','resourceLamports'],['rentLamports','rentLamports'],
        ['season','season'],['projectIssued','projectIssued'],['seasonIssued','seasonalIssued'],['lifetimeIssued','lifetimeIssued']])check(BigInt(purchase[name])===u64(expected[evidence]),'PURCHASE_DECODED_RESULT');
      check(p.quantity===purchase.quantity&&p.expectedSeason===purchase.season&&BigInt(p.class)===u64(expected.class),'PURCHASE_PAYLOAD_RESULT');
      const execution=actualExecution(c.execution,resultHex),retry=actualExecution(c.retry,resultHex);
      const padded=Buffer.concat([result,Buffer.alloc(6)]);expectRejected(()=>validateNativeResult(abi,frame,padded),'NATIVE_RESULT_LENGTH');expectRejected(()=>decodeBuyResult(padded));
      let phase=0,slot=10n,sendCalls=0;const methods=[];
      const fetchImpl=async(url,options)=>{
        check(url==='http://127.0.0.1:1/'&&options.method==='POST'&&options.redirect==='error'&&options.signal instanceof AbortSignal,'PURCHASE_OFFLINE_TRANSPORT');
        const request=parseJsonWithBigInts(options.body);methods.push(request.method);let answer;
        if(request.method==='sendTransaction'){sendCalls++;check(false,'PURCHASE_SEND_FORBIDDEN');}
        if(request.method==='getGenesisHash')answer=nativeKeyAddress(release.hashes.genesisHash);
        else if(request.method==='getMultipleAccounts'){
          check(request.params[1].commitment==='finalized'&&u64(request.params[1].minContextSlot)<=slot,'PURCHASE_FINALIZED_CONTEXT');
          answer={context:{slot:++slot},value:request.params[0].map(address=>{check(snapshots[phase].has(address),'PURCHASE_UNRECORDED_READ');return rpcAccount(snapshots[phase].get(address));})};
        }else if(request.method==='getLatestBlockhash'){
          check(request.params[0].commitment==='finalized'&&u64(request.params[0].minContextSlot)<=slot,'PURCHASE_FINALIZED_CONTEXT');
          answer={context:{slot:++slot},value:{blockhash:nativeKeyAddress(createHash('sha256').update('BIO offline recorded Bank unsigned preparation lifetime only').digest()),lastValidBlockHeight:1000n}};
        }else check(false,'PURCHASE_UNEXPECTED_RPC');
        return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result:answer}),{status:200});
      };
      const stateDirectory=path.join(directory,`case-${index}`),store=await FileJournalStore.open({directory:stateDirectory});
      const session=()=>new NativePlayerSession({release,abi,actor,store,endpoint:'http://127.0.0.1:1',fetchImpl,allowLocalhost:true});
      const envelope=await session().prepare({operation:'BUY_MATERIAL',nonce,payload:decoded.payload,suffix,dynamicAccounts,
        resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n}});
      const inspected=await inspectPreparedNativeEnvelope({release,abi,envelope});
      check(envelope.frameHex===c.frameHex&&inspected.requestHash.toString('hex')===c.requestH4,'PURCHASE_PREPARED_ORIGINAL_FRAME');
      const prepared=(await store.load()).payload;check(JSON.parse(prepared).entries[0].state==='PREPARED','PURCHASE_DURABLE_PREPARATION');
      phase=1;const confirmed=await session().reconcile(nonce);check(confirmed.decision==='CONFIRMED'&&confirmed.businessExecutionVerified===true
        &&confirmed.resultBytes.equals(result),'PURCHASE_SESSION_CONFIRMATION');
      const duplicate=await session().reconcile(nonce);check(duplicate.decision==='CONFIRMED'&&duplicate.resultBytes.equals(result),'PURCHASE_DUPLICATE_RECONCILIATION');
      phase=2;const replayed=await session().reconcile(nonce);check(replayed.decision==='CONFIRMED'&&replayed.resultBytes.equals(result),'PURCHASE_BANK_RETRY_RECONCILIATION');
      const reopened=await FileJournalStore.open({directory:stateDirectory}),restored=new NativePlayerSession({release,abi,actor,store:reopened,
        endpoint:'http://127.0.0.1:1',fetchImpl,allowLocalhost:true});
      const persisted=await restored.getRequest(nonce);check(persisted.state==='CONFIRMED'&&persisted.frameBytes.equals(frame)&&persisted.resultBytes.equals(result)
        &&persisted.digestHex===c.requestH4&&persisted.attempts.length===0&&sendCalls===0,'PURCHASE_DURABLE_CONFIRMATION');
      reports.push({class:u64(expected.class),traceSequence:u64(c.traceSequence),caseSHA256:hash(loaded.bytes),elfSHA256:c.elfSHA256,
        actor,nonce,frameSHA256:c.frameSHA256,requestH4:c.requestH4,actualCachedResultBytes:result.length,actualCachedResultHex:resultHex,
        decodedBuyResult:purchase,actualBankExecution:execution,actualBankRetry:retry,
        sdkDecision:confirmed.decision,businessExecutionVerified:true,duplicateDecision:duplicate.decision,afterBankRetryDecision:replayed.decision,
        exactOriginalFrame:true,realFileJournalStore:true,reopenedDurableConfirmation:true,padded64Rejected:true,sendTransactionCalls:sendCalls,rpcShapedMethods:methods});
    }
  }finally{await rm(directory,{recursive:true,force:true});}
  const report=jsonSafe({schema:'BIO-BANK-PURCHASE-SESSION-CHECK-1',fixtureOnly:true,productionAdmission:false,networkBroadcast:false,liveRPC:false,cold:false,
    scope:'offline finalized-shaped recorded Bank reads through NativePlayerSession and actual FileJournalStore; not live RPC finality or an additional cold-chain execution',
    adapterInputs:'genesis response uses the explicitly local fixture identity; monotonically increasing context slots and unsigned preparation lifetime are synthetic local adapter inputs only; no packet is signed or submitted by this checker',
    caseInputSHA256:hash(input.bytes),releaseInputSHA256:hash(releaseInput.bytes),abiSHA256:abi.hash,cases:reports,success:true});
  if(reportFile)await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [caseFile,releaseFile,abiFile,reportFile,...extra]=process.argv.slice(2);
  check(caseFile&&releaseFile&&abiFile&&reportFile&&extra.length===0,'usage: absoluteCaseOrManifest absoluteRelease absoluteABI absoluteNewReport');
  console.log(JSON.stringify(await checkPurchaseBankSession({caseFile,releaseFile,abiFile,reportFile}),null,2));
}
