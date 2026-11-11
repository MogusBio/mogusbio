import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { ByteWriter,typedHash } from '../../protocol-core/src/index.mjs';
import { encodePositionBody } from '../../settlement/src/wire.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { nativePda,nativeKeyAddress,nativeKeyBytes } from '../src/native.mjs';
import { PROGRAMS } from '../src/release.mjs';
import { planPlayerPositionAction,nativeActionIntent } from '../src/player-settlement.mjs';
import { settlementFixture } from './settlement-fixture.mjs';
import { baseAccount,recordAccount } from './account-fixture.mjs';
import { key } from './native-fixture.mjs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOperator } from '../../../apps/operator/main.mjs';

async function environment(f){
  const base=await baseAccount(f.release),accounts=new Map([base,f.positionAccount,f.registryAccount,f.rootRegAccount,f.directoryAccount,f.hourAccount].map(a=>[a.address,a])),calls=[];
  const fetchImpl=async(_,options)=>{
    const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(f.release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts')result={context:{slot:10n},value:req.params[0].map(k=>{
      const a=accounts.get(k);return !a?null:{owner:a.owner,executable:a.executable,lamports:a.lamports??0n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']};
    })};else throw new Error(`unexpected write: ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  };
  return {accounts,calls,fetchImpl,rpc:new ReadOnlyRpc({release:f.release,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl})};
}
const args=(f,e,kind)=>({release:f.release,abi:f.abi,rpc:e.rpc,actor:f.actor,instance:f.instance,positionSeq:0n,kind,maxRent:1000000n});
const setPosition=f=>{f.positionAccount.data=Buffer.concat([f.positionAccount.data.subarray(0,120),encodePositionBody(f.p)]);};

test('personal accrual reads actual finalized batch and the ended historical next hour without sending',async()=>{
  const f=await settlementFixture(),e=await environment(f),result=await planPlayerPositionAction(args(f,e,'accrue'));
  assert.equal(result.decision,'ACTION');assert.equal(result.action.operation,'MATERIALIZE_HOUR');assert.equal(result.hour,0n);assert.equal(result.previewAtoms,2378n);
  assert.equal(result.action.nonce,0n);assert.equal(result.transactionExecuted,false);
  const batches=e.calls.filter(c=>c.method==='getMultipleAccounts');assert.ok(batches.some(c=>c.params[0].length===4));
  assert.ok(batches.every(c=>c.params[1].commitment==='finalized'));
  const intent=nativeActionIntent(result.action,{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n});
  assert.equal(intent.payloadHex,result.action.payload.toString('hex'));assert.equal(intent.nonce,'0');
  e.accounts.delete(f.hourAccount.address);
  await assert.rejects(()=>planPlayerPositionAction(args(f,e,'accrue')),{code:'RPC_ACCOUNT_MISSING'});
});

test('personal claim keeps the historical beneficiary and first ATA setup, then rejects a wrong token authority',async()=>{
  const f=await settlementFixture();f.p.accrued=7134n;f.p.paid=2378n;setPosition(f);
  const e=await environment(f),result=await planPlayerPositionAction({...args(f,e,'claim'),actor:key(17)});
  assert.equal(result.decision,'ACTION');assert.equal(result.previewAtoms,4756n);assert.equal(result.beneficiary,f.actor);
  assert.deepEqual(result.action.labDestinationSetup,{beneficiary:f.actor});
  const mint=await nativePda(f.release.input.programId,'bio','lab-mint'),ata=await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(f.actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint.address));
  assert.equal(result.action.suffix.at(-1).address,ata.address);
  // Sending lamports to the derived ATA must not suppress its idempotent setup.
  e.accounts.set(ata.address,{address:ata.address,owner:PROGRAMS.systemProgram,executable:false,lamports:1n,data:Buffer.alloc(0)});
  assert.deepEqual((await planPlayerPositionAction(args(f,e,'claim'))).action.labDestinationSetup,{beneficiary:f.actor});
  const d=Buffer.alloc(165);nativeKeyBytes(mint.address).copy(d);nativeKeyBytes(key(17)).copy(d,32);d[108]=1;
  e.accounts.set(ata.address,{address:ata.address,owner:PROGRAMS.tokenProgram,executable:false,data:d});
  await assert.rejects(()=>planPlayerPositionAction(args(f,e,'claim')),{code:'TOKEN_AUTHORITY'});
});

test('personal wait states preserve unfrozen history, completed coverage and zero actual debt',async()=>{
  const f=await settlementFixture(),e=await environment(f);
  assert.equal((await planPlayerPositionAction(args(f,e,'claim'))).decision,'NO_ACCRUED_DEBT');
  f.registryAccount.data.writeBigUInt64LE(0n,128);
  assert.equal((await planPlayerPositionAction(args(f,e,'accrue'))).decision,'WAIT_FROZEN_FRONTIER');
  f.p.nextUnsettledHour=1n;setPosition(f);
  assert.equal((await planPlayerPositionAction(args(f,e,'accrue'))).decision,'COVERAGE_COMPLETE');
  assert.equal(e.calls.some(c=>c.method==='sendTransaction'),false);
});

test('personal coordinator does not skip an older interval belonging to the same Root',async()=>{
  const f=await settlementFixture(),seq=new ByteWriter(8).u64(1n).finish();f.p.rootSeq=1n;
  const pid=typedHash(14,Buffer.concat([f.release.domain,new ByteWriter(2).u16(27).finish(),f.instance,seq]));
  f.positionAccount=await recordAccount(f.release,{kind:27,schema:2,seeds:['bio','reg',f.instance,seq],id:pid,body:encodePositionBody(f.p)});
  const e=await environment(f),result=await planPlayerPositionAction({...args(f,e,'accrue'),positionSeq:1n});
  assert.equal(result.decision,'WAIT_PRIOR_POSITION');assert.equal(result.priorPositionSeq,0n);assert.equal(result.action,undefined);
});

test('position-plan CLI exports a new directly preparable intent and produces no fake intent while waiting',async()=>{
  const f=await settlementFixture(),e=await environment(f),dir=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-position-plan-'));
  try{
    const releaseFile=path.join(dir,'release.json'),requestFile=path.join(dir,'request.json'),intentFile=path.join(dir,'intent.json');
    await fs.writeFile(releaseFile,JSON.stringify(f.release.input));
    const request={instanceHex:f.instance.toString('hex'),positionSeq:'0',kind:'accrue',maxRent:'1000000',resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'}};
    await fs.writeFile(requestFile,JSON.stringify(request));
    const command=['position-plan','--release',releaseFile,'--local-public-fixture','--actor',f.actor,'--endpoint','http://127.0.0.1:8899','--request',requestFile,'--out',intentFile];
    const result=await runOperator(command,{fetchImpl:e.fetchImpl});assert.equal(result.operation,'MATERIALIZE_HOUR');assert.equal(result.intentSaved,intentFile);
    const intent=JSON.parse(await fs.readFile(intentFile,'utf8'));assert.equal(intent.nonce,'0');assert.equal(intent.operation,'MATERIALIZE_HOUR');assert.equal(typeof intent.payloadHex,'string');
    assert.equal((await fs.stat(intentFile)).mode&0o777,0o600);
    await assert.rejects(()=>runOperator(command,{fetchImpl:e.fetchImpl}),/EEXIST/);
    f.registryAccount.data.writeBigUInt64LE(0n,128);
    const absent=path.join(dir,'wait.json'),waiting=await runOperator(command.slice(0,-1).concat(absent),{fetchImpl:e.fetchImpl});
    assert.equal(waiting.decision,'WAIT_FROZEN_FRONTIER');await assert.rejects(()=>fs.stat(absent),/ENOENT/);
    assert.equal(e.calls.some(c=>c.method==='sendTransaction'),false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
