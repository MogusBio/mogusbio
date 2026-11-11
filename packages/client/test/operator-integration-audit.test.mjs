import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { ByteWriter,typedHash } from '../../protocol-core/src/index.mjs';
import { encodePositionBody,encodeHourBody,emptyHourWire } from '../../settlement/src/wire.mjs';
import { normalWeight } from '../../settlement/src/weights.mjs';
import { FileJournalStore } from '../src/file-journal.mjs';
import { NativePlayerSession,inspectPreparedNativeEnvelope } from '../src/session.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { planAccruedPositionClaim } from '../src/settlement-workflow.mjs';
import { nativeKeyBytes,nativeKeyAddress,decodeNativeFrame } from '../src/native.mjs';
import { decodeV1Transaction } from '../src/transaction.mjs';
import { clientFixture,key,hash } from './native-fixture.mjs';
import { recordAccount,baseAccount } from './account-fixture.mjs';
import { settlementFixture } from './settlement-fixture.mjs';
import { runOperator } from '../../../apps/operator/main.mjs';

const le=n=>new ByteWriter(8).u64(n).finish();
const id=(c,kind,...tail)=>typedHash(14,Buffer.concat([c.release.domain,new ByteWriter(2).u16(kind).finish(),...tail]));
const rpcAccount=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports??10000000n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']};
const response=(req,result)=>new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
async function historicalPosition(c){
  const instance=hash('independent operator audit historical Root'),positionId=id(c,27,instance,le(0n));
  const p={instance,rootSeq:0n,rootDirectorySeq:0n,registrationM:hash('historical registration'),beneficiary:nativeKeyBytes(c.actor),rootRevision:0n,
    B_int:120000n,q_ppm:1000000,L_quarters:4,weight:normalWeight({scope:'COMPONENT',B_int:120000n,q_ppm:1000000n}),
    start:0n,end:1n,endReason:1,endBusiness:hash('old owner exit'),createdTime:0n,createdSlot:1n,endedTime:1n,endedSlot:2n,
    accrued:4756n,paid:2378n,nextUnsettledHour:1n};
  return {instance,p,account:await recordAccount(c.release,{kind:27,schema:2,seeds:['bio','reg',instance,le(0n)],id:positionId,body:encodePositionBody(p)})};
}

test('independent bridge: ended historical beneficiary claim plan prepares the exact two-instruction message through durable session storage',async()=>{
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-operator-audit-'));
  try{
    const c=await clientFixture(),history=await historicalPosition(c),base=await baseAccount(c.release),actor=key(17),calls=[];
    let position=history.account;
    const fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);calls.push(req.method);
      if(req.method==='getGenesisHash')return response(req,nativeKeyAddress(c.release.hashes.genesisHash));
      if(req.method==='getMultipleAccounts')return response(req,{context:{slot:100n},value:req.params[0].map(address=>rpcAccount(address===base.address?base:address===history.account.address?position:null))});
      if(req.method==='getLatestBlockhash')return response(req,{context:{slot:100n},value:{blockhash:key(20),lastValidBlockHeight:1000n}});
      throw new Error(`Unexpected write/network method ${req.method}`);
    };
    const plan=await planAccruedPositionClaim({...c,actor,nonce:0n,instance:history.instance,positionSeq:0n,positionAccount:history.account,destinationAccount:null,maxRent:1000000n});
    assert.equal(plan.previewAtoms,2378n);assert.equal(plan.beneficiary,c.actor);assert.notEqual(plan.beneficiary,actor);
    const store=await FileJournalStore.open({directory}),session=new NativePlayerSession({...c,actor,store,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl});
    const envelope=await session.prepare({...plan,resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:32768,priorityFeeLamports:0n}});
    const inspected=await inspectPreparedNativeEnvelope({...c,envelope}),decoded=decodeV1Transaction(inspected.unsignedBytes);
    assert.equal(decoded.message.numInstructions,2);assert.deepEqual(inspected.frame,plan.frame);
    assert.equal(decodeNativeFrame(c.abi,inspected.frame).nonce,0n);assert.deepEqual(envelope.labDestinationSetup,{beneficiary:c.actor});
    const before=await store.load();assert.equal(JSON.parse(before.payload).entries[0].state,'PREPARED');
    // The account reader must recheck the immutable old beneficiary. A caller's
    // planner preview or an unrelated current owner cannot replace that fact.
    position={...history.account,data:Buffer.concat([history.account.data.subarray(0,120),encodePositionBody({...history.p,beneficiary:nativeKeyBytes(actor)})])};
    await assert.rejects(session.prepare({...plan,resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:32768,priorityFeeLamports:0n}}),{code:'LAB_SETUP_BENEFICIARY'});
    assert.deepEqual(await store.load(),before);assert.equal(calls.includes('sendTransaction'),false);assert.equal(calls.includes('simulateTransaction'),false);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('independent RPC getter concurrency rejects a late older context without regressing the finalized frontier',async()=>{
  const c=await clientFixture(),history=await historicalPosition(c);let releaseFirst,markStarted;
  const started=new Promise(resolve=>{markStarted=resolve;});let accountCalls=0;
  const fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);
    if(req.method==='getGenesisHash')return response(req,nativeKeyAddress(c.release.hashes.genesisHash));
    assert.equal(req.method,'getMultipleAccounts');assert.equal(req.params[1].commitment,'finalized');accountCalls++;
    if(accountCalls===1){markStarted();return new Promise(resolve=>{releaseFirst=()=>resolve(response(req,{context:{slot:21n},value:[rpcAccount(history.account)]}));});}
    return response(req,{context:{slot:22n},value:[rpcAccount(history.account)]});
  };
  const rpc=new ReadOnlyRpc({release:c.release,endpoint:'https://rpc.example.invalid',fetchImpl});
  const first=rpc.getPosition(history.instance,0n);await started;
  const second=await rpc.getPosition(history.instance,0n);assert.equal(second.value.paid,2378n);assert.equal(second.contextSlot,22n);
  releaseFirst();await assert.rejects(first,{code:'RPC_CONTEXT_REGRESSION'});assert.equal(rpc.contextSlot,22n);
});

test('independent getHour rejects another canonical Hour header returned under the requested RPC address',async()=>{
  const c=await clientFixture(),h=emptyHourWire(1n),extension=Buffer.alloc(65),MAX=(1n<<64n)-1n;
  for(const at of [0,8,16,24])extension.writeBigUInt64LE(MAX,at);nativeKeyBytes(c.actor).copy(extension,32);
  const other=await recordAccount(c.release,{kind:18,schema:4,seeds:['bio','hour',le(1n)],id:id(c,18,le(1n)),body:Buffer.concat([encodeHourBody(h),extension])});
  const fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);return response(req,req.method==='getGenesisHash'?nativeKeyAddress(c.release.hashes.genesisHash):{context:{slot:31n},value:[rpcAccount(other)]});};
  const rpc=new ReadOnlyRpc({release:c.release,endpoint:'https://rpc.example.invalid',fetchImpl});
  await assert.rejects(rpc.getHour(0n),{code:'ACCOUNT_PDA_KEY'});assert.equal(rpc.contextSlot,31n);
});

test('position-plan refuses incomplete or invalid message resources before writing a supposedly preparable intent',async()=>{
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-position-resource-audit-'));
  try{
    const f=await settlementFixture(),base=await baseAccount(f.release),accounts=new Map([base,f.positionAccount,f.registryAccount,f.rootRegAccount,f.directoryAccount,f.hourAccount].map(a=>[a.address,a]));
    const calls=[],fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);calls.push(req.method);
      if(req.method==='getGenesisHash')return response(req,nativeKeyAddress(f.release.hashes.genesisHash));
      assert.equal(req.method,'getMultipleAccounts');return response(req,{context:{slot:100n},value:req.params[0].map(address=>rpcAccount(accounts.get(address)??null))});
    };
    const releaseFile=path.join(directory,'release.json'),requestFile=path.join(directory,'request.json');await fs.writeFile(releaseFile,JSON.stringify(f.release.input));
    const valid={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
    const invalid=[{priorityFeeLamports:'0'},{...valid,computeUnitLimit:0},{...valid,computeUnitLimit:'1400000'},
      {...valid,loadedAccountsDataSizeLimit:0},{...valid,heapSize:33000},{...valid,priorityFeeLamports:'18446744073709551616'},
      {...valid,priorityFeeLamports:'-1'},{...valid,arbitraryConfig:true}];
    for(let i=0;i<invalid.length;i++){
      const out=path.join(directory,`invalid-intent-${i}.json`);
      await fs.writeFile(requestFile,JSON.stringify({instanceHex:f.instance.toString('hex'),positionSeq:'0',kind:'accrue',maxRent:'1000000',resources:invalid[i]}));
      await assert.rejects(runOperator(['position-plan','--release',releaseFile,'--local-public-fixture','--actor',f.actor,'--endpoint','http://127.0.0.1:8899','--request',requestFile,'--out',out],{fetchImpl}),`resource case ${i} must fail before export`);
      await assert.rejects(fs.stat(out),{code:'ENOENT'});
    }
    assert.equal(calls.includes('sendTransaction'),false);assert.equal(calls.includes('simulateTransaction'),false);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
