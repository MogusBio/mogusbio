import test from 'node:test';import assert from 'node:assert/strict';
import { withRpcTimeout } from '../src/http-timeout.mjs';import { ReadOnlyRpc } from '../src/rpc.mjs';import { clientFixture } from './native-fixture.mjs';
test('RPC deadline aborts actual injected request, clears timers after success and cannot hang on a noncooperating transport',async()=>{
  assert.equal(await withRpcTimeout(100,async()=>42),42);
  let aborted=false;await assert.rejects(withRpcTimeout(10,signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);}))),/RPC_TIMEOUT/);assert.equal(aborted,true);
  await assert.rejects(withRpcTimeout(10,()=>new Promise(()=>{})),/RPC_TIMEOUT/);
  await assert.rejects(withRpcTimeout(0,()=>{}),/BOUND/);
  const {release}=await clientFixture();let signal;
  const rpc=new ReadOnlyRpc({release,endpoint:'https://rpc.example.invalid',requestTimeoutMs:10,fetchImpl:async(_,options)=>{signal=options.signal;return new Promise(()=>{});}});
  await assert.rejects(rpc.verifyGenesis(),/RPC_TIMEOUT/);assert.equal(signal.aborted,true);assert.equal(rpc.contextSlot,0n);
});
