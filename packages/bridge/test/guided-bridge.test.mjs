import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {validateProductionRelease,baseConfigR2Id} from '../../client/src/release.mjs';
import {loadNativeAbi,nativeKeyAddress,nativeKeyBytes,decodeNativeFrame,encodeNativeFrame,buildNativeInstruction} from '../../client/src/native.mjs';
import {decodeBuyPayload} from '../../launchpad/src/codec.mjs';

const checkpointSHA='6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
const release=await validateProductionRelease(JSON.parse(await fs.readFile(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url),'utf8')),{localPublicFixture:true});
const abi=loadNativeAbi(await fs.readFile(new URL('../../../programs/biolab-economy/operations.p0r2.json',import.meta.url)),{expectedHash:release.input.abiHash});
const bankCase=parseJsonWithBigInts(await fs.readFile(new URL('../../../programs/transaction-transport/evidence/purchase-result-bank-76b35cfb-class-1.json',import.meta.url),'utf8'));
const buyPayload=decodeBuyPayload(decodeNativeFrame(abi,Buffer.from(bankCase.frameHex,'hex')).payload);
const purchaseBody={actor:bankCase.actor,projectIdHex:buyPayload.projectId.toString('hex'),class:1,quantity:buyPayload.quantity.toString(),
  maxPayment:buyPayload.maxProtocolLamports.toString(),maxRent:buyPayload.maxRentLamports.toString(),resources};
const recordRows=rows=>new Map(rows.map(row=>[row.address,row.missing===true?null:{...row,data:Buffer.from(row.data[0],'base64')}]));
const rpcAccount=a=>!a?null:{owner:a.owner,lamports:a.lamports,executable:a.executable,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};

// These fixtures retain actual saved Bank/checkpoint data unchanged. Only the
// JSON-RPC envelope/context slots and genesis reply are local adapter inputs;
// no test reaches an external RPC, creates a transaction journal, or sends.
async function genuineLedger(){
  const raw=await fs.readFile(new URL(`../../../programs/biolab-economy/evidence/actual-final-bio-76b35cfb-${checkpointSHA}.bin`,import.meta.url));
  assert.equal(hash(raw),checkpointSHA);assert.equal(raw.subarray(0,8).toString(),'BIOFIN01');
  const instance=Buffer.from(raw.subarray(72,104)),count=raw.readUInt32LE(104),accounts=new Map();let at=108;
  for(let i=0;i<count;i++){
    const address=nativeKeyAddress(raw.subarray(at,at+32)),lamports=raw.readBigUInt64LE(at+32),owner=nativeKeyAddress(raw.subarray(at+40,at+72)),
      executable=raw[at+72]===1,rentEpoch=raw.readBigUInt64LE(at+73),length=raw.readUInt32LE(at+81);at+=85;
    accounts.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(raw.subarray(at,at+length))});at+=length;
  }
  assert.equal(at,raw.length);return {accounts,instance};
}
async function fixture(t,source='bank'){
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-guided-bridge-'));await fs.chmod(directory,0o700);
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));assert.equal((await fs.stat(directory)).mode&0o777,0o700);
  const ledger=source==='ledger'?await genuineLedger():null,accounts=ledger?.accounts??recordRows(bankCase.beforeAccounts),calls=[];
  const endpoint='https://guided-bridge.invalid/provider-private?api-key=fixture-secret';let slot=1000000n;
  const fetchImpl=async(url,options)=>{
    assert.equal(url,endpoint);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const request=parseJsonWithBigInts(options.body);calls.push(request);let result;
    if(request.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else{
      assert.equal(request.method,'getMultipleAccounts','guided routes must use account reads exclusively');
      assert.equal(request.params[1].commitment,'finalized');assert.ok(request.params[1].minContextSlot<=slot);
      assert.ok(request.params[0].length<=100);assert.equal(new Set(request.params[0]).size,request.params[0].length);
      result={context:{slot:++slot},value:request.params[0].map(address=>{
        if(source==='bank')assert.ok(accounts.has(address),`unrecorded Bank read ${address}`);
        return rpcAccount(accounts.get(address));
      })};
    }
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result}),{status:200});
  };
  const bridge=await createOperatorBridge({release,abi,endpoint,stateDirectory:directory,fetchImpl});
  assert.deepEqual(calls,[]);assert.deepEqual(await fs.readdir(directory),[]);
  return {bridge,calls,directory,endpoint,accounts,instance:ledger?.instance,actor:release.input.bootstrap};
}
function jsonSafe(value,f){
  const walk=v=>{
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'){assert.ok(Number.isSafeInteger(v));return;}
    assert.equal(typeof v,'object','planner values must already be JSON safe');assert.equal(v instanceof Uint8Array,false);
    if(Array.isArray(v)){for(const child of v)walk(child);return;}
    assert.equal(Object.getPrototypeOf(v),Object.prototype);
    for(const [name,child]of Object.entries(v)){
      assert.equal(['endpoint','stateDirectory','privateKey','release','abi','fetchImpl','store','modulePath','storagePath'].includes(name),false,`private runtime field ${name}`);walk(child);
    }
  };
  walk(value);const text=JSON.stringify(value);assert.deepEqual(JSON.parse(text),value);
  for(const secret of [f.directory,f.endpoint,'provider-private','fixture-secret','file://','node_modules/','packages/client/src/'])assert.equal(text.includes(secret),false,`private path or endpoint disclosure: ${secret}`);
  assert.equal(Object.hasOwn(value,'action'),false,'bridge must expose only the normalized unsigned intent');
}
async function onlyReadsAndNoJournal(f){
  assert.ok(f.calls.every(call=>['getGenesisHash','getMultipleAccounts'].includes(call.method)));
  assert.equal(f.calls.some(call=>call.method==='sendTransaction'),false);assert.deepEqual(await fs.readdir(f.directory),[],'planning must not open FileJournalStore or create any actor state');
}
function assetBody(f){return {actor:f.actor,instanceHex:f.instance.toString('hex')};}
function stakeBody(f){return {...assetBody(f),kind:'stake',beneficiary:f.actor,maxRent:'100000000',resources};}
function positionBody(f){return {...assetBody(f),positionSeq:'0',kind:'claim',maxRent:'100000000',resources};}
function frameForIntent(intent,actor){
  return encodeNativeFrame(abi,{operation:intent.operation,domain:release.domain,configId:baseConfigR2Id(release),actor,nonce:BigInt(intent.nonce),payload:Buffer.from(intent.payloadHex,'hex')});
}
async function rejectBeforeFetch(f,action,body,expected){
  const before=f.calls.length;await assert.rejects(f.bridge.dispatch(action,body),expected);assert.equal(f.calls.length,before,'invalid browser input must fail before fetching');
}

test('guided bridge purchase-plan reproduces the exact actual Bank class1 frame/metas using only recorded account reads',async t=>{
  const f=await fixture(t),out=await f.bridge.dispatch('purchase-plan',structuredClone(purchaseBody));
  assert.equal(out.decision,'ACTION');assert.equal(out.actor,bankCase.actor);assert.equal(out.intent.operation,'BUY_MATERIAL');
  assert.equal(out.intent.nonce,bankCase.purchaseResult.nativeNonceBefore.toString());assert.equal(out.intent.payloadHex,bankCase.frameHex.slice(304));
  assert.deepEqual(out.intent.resources,resources);assert.deepEqual(out.intent.dynamicAccounts,[]);
  const frame=frameForIntent(out.intent,out.actor);assert.equal(frame.toString('hex'),bankCase.frameHex);
  const instruction=await buildNativeInstruction({release,abi,frame,suffix:out.intent.suffix,dynamicAccounts:out.intent.dynamicAccounts});
  assert.deepEqual(instruction.accounts.map(a=>({pubkey:a.address,isSigner:Boolean(a.role&2),isWritable:Boolean(a.role&1)})),bankCase.instruction.accounts);
  assert.equal(out.preview.project.unitPrice,'500000');assert.equal(out.preview.destination.creationRequired,true);assert.equal(out.preview.principal.totalLamports,'18000000');
  assert.equal(out.clientPlanOnly,true);assert.equal(out.transactionExecuted,false);assert.equal(out.businessExecutionVerified,false);assert.equal(out.networkSubmitted,false);
  assert.equal(out.requiresSimulation,true);assert.equal(out.rentSufficiencyVerified,false);assert.equal(out.networkFeeQuote,null);
  assert.equal(f.calls.filter(call=>call.method==='getMultipleAccounts').length,5);jsonSafe(out,f);await onlyReadsAndNoJournal(f);
});

test('guided bridge asset-read returns decimal positionSeq from the genuine BIO with bounded known-instance pages',async t=>{
  const f=await fixture(t,'ledger'),body={...assetBody(f),positionPageStart:'0',positionPageLimit:1};
  const out=await f.bridge.dispatch('asset-read',body);assert.equal(out.decision,'ASSET_READ');assert.equal(out.knownInstanceOnly,true);
  assert.equal(out.root.target,22);assert.equal(out.root.qualityPpm,'2000000');assert.equal(out.nextNonce,'23652');assert.equal(out.positions.length,1);
  assert.equal(out.positions[0].positionSeq,'0');assert.equal(typeof out.positions[0].positionSeq,'string');assert.equal(out.positions[0].rootSeq,'0');
  assert.equal(out.positions[0].beneficiaryAddress,f.actor);assert.equal(out.nextPageStart,null);assert.equal(out.transactionExecuted,false);jsonSafe(out,f);
  const after=await f.bridge.dispatch('asset-read',{...body,positionPageStart:'1',positionPageLimit:20});
  assert.equal(after.positions.length,0);assert.equal(after.nextPageStart,null);jsonSafe(after,f);
  const beyond=await f.bridge.dispatch('asset-read',{...body,positionPageStart:'18446744073709551615',positionPageLimit:20});
  assert.deepEqual(beyond.positions,[]);assert.equal(beyond.nextPageStart,null);jsonSafe(beyond,f);await onlyReadsAndNoJournal(f);
});

test('guided bridge asset-plan proposes REGISTER_ORDINARY for the unchanged genuine BIO without executing or reserving a nonce',async t=>{
  const f=await fixture(t,'ledger'),out=await f.bridge.dispatch('asset-plan',stakeBody(f));
  assert.equal(out.decision,'ACTION');assert.equal(out.actor,f.actor);assert.equal(out.intent.operation,'REGISTER_ORDINARY');assert.equal(out.intent.nonce,'23652');
  assert.equal(out.preview.positionSequence,'1');assert.equal(out.preview.ordinaryWeight,'95040000000000');assert.equal(out.preview.beneficiary,f.actor);
  assert.equal(out.intent.dynamicAccounts.length,2);assert.equal(out.intent.dynamicAccounts[0].writable,false);assert.equal(out.intent.dynamicAccounts[0].signer,false);
  const frame=frameForIntent(out.intent,out.actor),decoded=decodeNativeFrame(abi,frame);assert.equal(decoded.operation,'REGISTER_ORDINARY');assert.ok(decoded.payload.subarray(0,32).equals(f.instance));
  assert.equal(decoded.payload.readBigUInt64LE(40),1n);assert.ok(decoded.payload.subarray(56,88).equals(nativeKeyBytes(f.actor)));assert.equal(decoded.payload.readBigUInt64LE(88),100000000n);
  assert.deepEqual(out.intent.resources,resources);assert.equal(out.clientPlanOnly,true);assert.equal(out.transactionExecuted,false);assert.equal(out.requiresSimulation,true);
  assert.equal(out.rentSufficiencyVerified,false);assert.equal(out.networkFeeQuote,null);jsonSafe(out,f);await onlyReadsAndNoJournal(f);
});

test('guided bridge position-plan claim reads genuine fully paid history and returns NO_ACCRUED_DEBT without an intent',async t=>{
  const f=await fixture(t,'ledger'),position=[...f.accounts.values()].find(a=>a.owner===release.input.programId&&a.data.length===375&&a.data.readUInt16LE(10)===27&&a.data.subarray(120,152).equals(f.instance)&&a.data.readBigUInt64LE(152)===0n);
  assert.ok(position);assert.equal(position.data.readBigUInt64LE(351),position.data.readBigUInt64LE(359));
  const out=await f.bridge.dispatch('position-plan',positionBody(f));assert.equal(out.decision,'NO_ACCRUED_DEBT');assert.equal(out.actor,f.actor);assert.equal(out.beneficiary,f.actor);
  assert.equal(out.nextUnsettledHour,position.data.readBigUInt64LE(367).toString());assert.equal(Object.hasOwn(out,'intent'),false);
  assert.equal(out.clientPlanOnly,true);assert.equal(out.transactionExecuted,false);jsonSafe(out,f);await onlyReadsAndNoJournal(f);
});

test('all guided bridge routes reject browser runtime, path, state and extra fields before any fetch or journal creation',async t=>{
  const f=await fixture(t,'ledger'),routes=[['purchase-plan',purchaseBody],['asset-read',{...assetBody(f),positionPageStart:'0',positionPageLimit:1}],['asset-plan',stakeBody(f)],['position-plan',positionBody(f)]];
  for(const [action,body]of routes){
    for(const field of ['endpoint','stateDirectory','state','path','privateKey','release','abi','fetchImpl','intent','nonce','instructions','modulePath'])
      await rejectBeforeFetch(f,action,{...body,[field]:'../../outside'},/BRIDGE_FIELDS/);
    await rejectBeforeFetch(f,action,null);await rejectBeforeFetch(f,action,[]);await rejectBeforeFetch(f,action,{actor:f.actor});
  }
  assert.deepEqual(f.calls,[]);await onlyReadsAndNoJournal(f);
});

test('guided bridge validates IDs, kinds, bounded pages, canonical decimals and resource budgets before any fetch',async t=>{
  const f=await fixture(t,'ledger'),read={...assetBody(f),positionPageStart:'0',positionPageLimit:1},stake=stakeBody(f),position=positionBody(f);
  for(const projectIdHex of ['AB'.repeat(32),'0'.repeat(63),'00'.repeat(31),'gg'.repeat(32),null])await rejectBeforeFetch(f,'purchase-plan',{...purchaseBody,projectIdHex});
  for(const instanceHex of ['AB'.repeat(32),'0'.repeat(63),'00'.repeat(31),'gg'.repeat(32),null]){
    for(const [action,body]of [['asset-read',read],['asset-plan',stake],['position-plan',position]])await rejectBeforeFetch(f,action,{...body,instanceHex});
  }
  for(const kind of ['STAKE','claim','',null,{}])await rejectBeforeFetch(f,'asset-plan',{...stake,kind},/BRIDGE_ASSET_KIND/);
  for(const kind of ['CLAIM','stake','',null,{}])await rejectBeforeFetch(f,'position-plan',{...position,kind},/ASSET_POSITION_KIND/);
  for(const positionPageLimit of [0,21,1.5,'1',null])await rejectBeforeFetch(f,'asset-read',{...read,positionPageLimit},/ASSET_PAGE_LIMIT/);
  for(const bad of ['00','-1','1.0','1e1',' 1','18446744073709551616',0,null]){
    for(const [action,body,name]of [['purchase-plan',purchaseBody,'quantity'],['purchase-plan',purchaseBody,'maxPayment'],['purchase-plan',purchaseBody,'maxRent'],
      ['asset-read',read,'positionPageStart'],['asset-plan',stake,'maxRent'],['position-plan',position,'positionSeq'],['position-plan',position,'maxRent']])
      await rejectBeforeFetch(f,action,{...body,[name]:bad},/BRIDGE_DECIMAL|BRIDGE_U64/);
  }
  for(const patch of [{class:0},{class:5},{class:'1'},{quantity:'0'},{quantity:'1001'}])await rejectBeforeFetch(f,'purchase-plan',{...purchaseBody,...patch},/PURCHASE_CLASS|PURCHASE_QUANTITY/);
  for(const badResources of [null,[],{...resources,extra:1},{...resources,computeUnitLimit:0},{...resources,computeUnitLimit:1400001},
    {...resources,loadedAccountsDataSizeLimit:0},{...resources,heapSize:32769},{...resources,heapSize:262145},{...resources,heapSize:'262144'},
    {...resources,priorityFeeLamports:0},{...resources,priorityFeeLamports:'00'},{...resources,priorityFeeLamports:'18446744073709551616'}]){
    for(const [action,body]of [['purchase-plan',purchaseBody],['asset-plan',stake],['position-plan',position]])await rejectBeforeFetch(f,action,{...body,resources:badResources});
  }
  for(const [action,body]of [['purchase-plan',purchaseBody],['asset-read',read],['asset-plan',stake],['position-plan',position]])
    await rejectBeforeFetch(f,action,{...body,actor:'../../outside'});
  assert.deepEqual(f.calls,[]);await onlyReadsAndNoJournal(f);
});
