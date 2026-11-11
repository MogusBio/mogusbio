import test from 'node:test';import assert from 'node:assert/strict';
import { stringifyJsonWithBigInts,parseJsonWithBigInts } from '@solana/rpc-spec-types';
import { ReadOnlyRpc,validateReadOnlyRpcEndpoint } from '../src/rpc.mjs';
import {nativeKeyAddress} from '../src/native.mjs';import {buildV1Transaction,transactionBytes} from '../src/transaction.mjs';
import {createTransactionMessage,setTransactionMessageFeePayer,setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstructions,compileTransaction} from '@solana/kit';
import {clientFixture,key} from './native-fixture.mjs';import {baseAccount} from './account-fixture.mjs';

const rpcAccount=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports??10000000n,rentEpoch:a.rentEpoch??0n,space:BigInt(a.data.length),data:[a.data.toString('base64'),'base64']};
function transport(release,handler){const calls=[];return {calls,fetch:async(url,options)=>{assert.equal(options.redirect,'error');const req=parseJsonWithBigInts(options.body);calls.push(req);const value=req.method==='getGenesisHash'?nativeKeyAddress(release.hashes.genesisHash):await handler(req);return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result:value}),{status:200});}};}
test('RPC requires injected transport and fixed HTTPS or explicitly allowed loopback, without redirects or write methods',async()=>{
  const {release}=await clientFixture();for(const endpoint of ['http://example.com','file:///tmp/x','https://user:pass@example.com','https://example.com/#x','http://127.0.0.2:8899'])assert.throws(()=>validateReadOnlyRpcEndpoint(endpoint));
  assert.equal(validateReadOnlyRpcEndpoint('http://127.0.0.1:8899',{allowLocalhost:true}),'http://127.0.0.1:8899/');assert.throws(()=>validateReadOnlyRpcEndpoint('http://localhost:8899'));
  const rpc=new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release});await assert.rejects(rpc.verifyGenesis(),/NOT_INJECTED/);assert.equal(typeof rpc.sendTransaction,'undefined');assert.equal(typeof rpc.call,'undefined');
});
test('finalized account reads bind genesis, context highwater/minimum and exact bounded canonical base64 with lossless u64',async()=>{
  const {release}=await clientFixture();let slot=9007199254740993n;const tr=transport(release,req=>{assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[1].minContextSlot<=slot);return {context:{slot},value:[{owner:key(20),executable:false,lamports:(1n<<64n)-1n,rentEpoch:(1n<<64n)-1n,data:['AQID','base64'],space:3n}]};});
  const rpc=new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release,fetchImpl:tr.fetch,maxAccountDataBytes:3});const out=await rpc.getMultipleAccounts([key(21)]);assert.equal(out.contextSlot,slot);assert.equal(out.accounts[0].lamports,(1n<<64n)-1n);assert.deepEqual(out.accounts[0].data,Buffer.from([1,2,3]));
  slot--;await assert.rejects(rpc.getMultipleAccounts([key(21)]),/ERR_ASSERTION|CONTEXT/);assert.equal(rpc.contextSlot,9007199254740993n);await assert.rejects(rpc.getMultipleAccounts([key(21)],{minContextSlot:0n}),/MIN_CONTEXT/);
  const wrong=new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release,fetchImpl:async(_,o)=>new Response(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(o.body).id,result:key(30)}))});await assert.rejects(wrong.getMultipleAccounts([key(21)]),/GENESIS/);
  for(const data of [['AQI','base64'],['AQI=','base64+zstd'],['AQIDBA==','base64']]){const t=transport(release,()=>({context:{slot:1n},value:[{owner:key(20),executable:false,lamports:1n,rentEpoch:0n,data}]}));await assert.rejects(new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release,fetchImpl:t.fetch,maxAccountDataBytes:3}).getMultipleAccounts([key(21)]),/ENCODING|DATA/);}
});
test('actual BaseConfig and ActorNonce reuse release/native decoders; null/PDA/owner/fixture mutations fail closed',async()=>{
  const {release,actor}=await clientFixture(),base=await baseAccount(release);let bad=false;
  const tr=transport(release,req=>({context:{slot:5n},value:req.params[0].map(k=>k===base.address?rpcAccount(bad?{...base,owner:key(20)}:base):null)}));
  const rpc=new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release,fetchImpl:tr.fetch});assert.equal((await rpc.verifyBaseConfig()).value.deploymentMode,0);assert.equal((await rpc.getActorNonce(actor)).nextNonce,0n);
  bad=true;await assert.rejects(rpc.verifyBaseConfig(),/OWNER/);
});
test('RPC rejects wrong JSON-RPC IDs/errors/HTTP and streamed response byte limits atomically',async()=>{
  const {release}=await clientFixture();for(const fetchImpl of [async()=>new Response('{}',{status:503}),async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:'wrong',result:key(1)})),async(_,o)=>new Response(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(o.body).id,error:{code:-32000,message:'unsupported version'}})),async()=>new Response(' '.repeat(1000))]){
    const rpc=new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release,fetchImpl,maxResponseBytes:256});await assert.rejects(rpc.verifyGenesis());assert.equal(rpc.contextSlot,0n);}
});
test('simulation uses actual V1 wire and explicit budgets, verifies actual Base, and never signs/broadcasts or reports execution',async()=>{
  const {release,actor}=await clientFixture(),base=await baseAccount(release);let fail=false;
  const tr=transport(release,req=>{if(req.method==='getMultipleAccounts')return {context:{slot:7n},value:[rpcAccount(base)]};assert.equal(req.method,'simulateTransaction');assert.equal(req.params[1].sigVerify,false);assert.equal(req.params[1].replaceRecentBlockhash,true);assert.equal(req.params[1].commitment,'finalized');assert.equal(req.params[1].minContextSlot,7n);assert.equal(Buffer.from(req.params[0],'base64')[0],0x81);
    return {context:{slot:8n},value:{err:fail?{InstructionError:[0n,'Custom']}:null,unitsConsumed:1200000n,logs:['Program success'],replacementBlockhash:{blockhash:key(21),lastValidBlockHeight:100n}}};});
  const rpc=new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release,fetchImpl:tr.fetch});const prepared=buildV1Transaction({feePayer:actor,lifetime:{blockhash:key(20),lastValidBlockHeight:99n},supportedTransactionVersions:[1],resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n},instructions:[{programAddress:key(22),accounts:[],data:Buffer.from([1])}]});
  const wire=transactionBytes(prepared.transaction);await assert.rejects(rpc.simulatePreparedV1(wire,{supportedTransactionVersions:[0]}),/UNSUPPORTED/);
  let noBudget=createTransactionMessage({version:1});noBudget=setTransactionMessageFeePayer(actor,noBudget);noBudget=setTransactionMessageLifetimeUsingBlockhash({blockhash:key(20),lastValidBlockHeight:99n},noBudget);noBudget=appendTransactionMessageInstructions([{programAddress:key(22),accounts:[],data:Buffer.from([1])}],noBudget);
  await assert.rejects(rpc.simulatePreparedV1(transactionBytes(compileTransaction(noBudget)),{supportedTransactionVersions:[1]}),/EXPLICIT_BUDGETS/);
  const out=await rpc.simulatePreparedV1(wire,{supportedTransactionVersions:[1]});assert.equal(out.unitsConsumed,1200000n);assert.equal(out.transactionExecuted,false);assert.equal(out.signatureVerified,false);assert.equal(out.simulationOnly,true);assert.deepEqual(wire,transactionBytes(prepared.transaction));assert.equal(tr.calls.some(c=>c.method==='getVersion'||c.method==='sendTransaction'),false);
  // A subsequent finalized account read must not move behind the simulation.
  await assert.rejects(rpc.simulatePreparedV1(wire,{supportedTransactionVersions:[1]}),/CONTEXT_REGRESSION/);
  const another=new ReadOnlyRpc({endpoint:'https://rpc.example.invalid',release,fetchImpl:tr.fetch});fail=true;await assert.rejects(another.simulatePreparedV1(wire,{supportedTransactionVersions:[1]}),/SIMULATION_FAILED/);assert.equal(another.contextSlot,7n);
  const legacy=Buffer.from(wire);legacy[0]=0x80;await assert.rejects(another.simulatePreparedV1(legacy,{supportedTransactionVersions:[1]}),/V1/);
});
