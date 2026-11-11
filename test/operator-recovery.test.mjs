import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { runOperator } from '../apps/operator/main.mjs';
import { clientFixture,key } from '../packages/client/test/native-fixture.mjs';
import { baseAccount } from '../packages/client/test/account-fixture.mjs';
import { nativePda,nativeKeyAddress,encodeSyncEmissionPayload,decodeNativeFrame } from '../packages/client/src/native.mjs';
import { inspectPreparedNativeEnvelope } from '../packages/client/src/session.mjs';
import { FileJournalStore } from '../packages/client/src/file-journal.mjs';

test('operator cancellation uses a separate durable namespace, preserves the old frame and only exports an unsigned competitor',async()=>{
  const dir=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-recovery-operator-'));
  try{
    const c=await clientFixture(),base=await baseAccount(c.release),releaseFile=path.join(dir,'release.json'),intentFile=path.join(dir,'intent.json'),requestFile=path.join(dir,'cancel-request.json'),
      originalFile=path.join(dir,'original.json'),cancellationFile=path.join(dir,'cancel.json'),state=path.join(dir,'state'),recoveryState=path.join(dir,'cancellation-state');
    await fs.writeFile(releaseFile,JSON.stringify(c.release.input));
    const map={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'};
    const suffix=await Promise.all(Object.entries(map).map(async([name,seed])=>({name,address:(await nativePda(c.release.input.programId,'bio',seed)).address})));
    const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
    await fs.writeFile(intentFile,JSON.stringify({operation:'SYNC_EMISSION',nonce:'0',payloadHex:encodeSyncEmissionPayload({maxRent:5000000n}).toString('hex'),suffix,resources}));
    await fs.writeFile(requestFile,JSON.stringify({maxRent:'10000000',resources}));
    const calls=[],fetchImpl=async(_,o)=>{
      const req=parseJsonWithBigInts(o.body);calls.push(req);let result;
      if(req.method==='getGenesisHash')result=nativeKeyAddress(c.release.hashes.genesisHash);
      else if(req.method==='getMultipleAccounts')result={context:{slot:10n},value:req.params[0].map(k=>k===base.address?{owner:base.owner,executable:false,lamports:10000000n,rentEpoch:0n,data:[base.data.toString('base64'),'base64']}:null)};
      else if(req.method==='getLatestBlockhash')result={context:{slot:10n},value:{blockhash:key(20),lastValidBlockHeight:100n}};
      else throw new Error(`unexpected write: ${req.method}`);
      return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
    };
    const common=['--release',releaseFile,'--local-public-fixture','--actor',c.actor,'--state',state,'--endpoint','http://127.0.0.1:8899'];
    await runOperator(['prepare',...common,'--intent',intentFile,'--out',originalFile],{fetchImpl});
    const before=JSON.parse((await(await FileJournalStore.open({directory:state})).load()).payload).entries[0];
    const args=['--nonce','0','--recovery-state',recoveryState];
    const prepared=await runOperator(['cancel-prepare',...common,...args,'--request',requestFile,'--out',cancellationFile],{fetchImpl});
    assert.equal(prepared.decision,'CANCELLATION_PREPARED');assert.equal(prepared.requiresSeparateSignature,true);assert.equal(prepared.businessExecutionVerified,false);
    const envelope=JSON.parse(await fs.readFile(cancellationFile,'utf8')),inspected=await inspectPreparedNativeEnvelope({...c,envelope});
    assert.equal(decodeNativeFrame(c.abi,inspected.frame).operation,'SYNC_EMISSION');assert.equal(inspected.nonce,0n);assert.notEqual(inspected.frame.toString('hex'),before.frameHex);
    const after=JSON.parse((await(await FileJournalStore.open({directory:state})).load()).payload).entries[0];assert.equal(after.frameHex,before.frameHex);
    assert.equal((await fs.stat(cancellationFile)).mode&0o777,0o600);
    assert.equal((await runOperator(['cancel-status',...common,...args],{fetchImpl})).decision,'CANCELLATION_PENDING');
    const same=path.join(dir,'bad-cancel.json');
    await assert.rejects(()=>runOperator(['cancel-prepare',...common,'--nonce','0','--recovery-state',state,'--request',requestFile,'--out',same],{fetchImpl}));
    await assert.rejects(()=>fs.stat(same),/ENOENT/);assert.equal(calls.some(c=>c.method==='sendTransaction'),false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
