import test from 'node:test';import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';import { tmpdir } from 'node:os';import path from 'node:path';
import { createKeyPairFromPrivateKeyBytes,signTransaction } from '@solana/kit';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { runOperator } from '../apps/operator/main.mjs';
import { clientFixture,key,hash } from '../packages/client/test/native-fixture.mjs';
import { baseAccount } from '../packages/client/test/account-fixture.mjs';
import { nativePda,nativeKeyAddress,encodeSyncEmissionPayload } from '../packages/client/src/native.mjs';
import { decodeV1Transaction,transactionBytes } from '../packages/client/src/transaction.mjs';
import { FileJournalStore } from '../packages/client/src/file-journal.mjs';

test('operator real files prepare/export/inspect/sign/import/broadcast keep exact native journal and never infer confirmation',async()=>{
  const d=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-operator-'));
  try{
    const c=await clientFixture(),base=await baseAccount(c.release),releaseFile=path.join(d,'release.json'),intentFile=path.join(d,'intent.json'),envelopeFile=path.join(d,'unsigned.json'),signedFile=path.join(d,'signed.json'),stateDir=path.join(d,'state');
    await fs.writeFile(releaseFile,JSON.stringify(c.release.input));
    const map={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'};
    const suffix=await Promise.all(c.abi.operations.find(o=>o.name==='SYNC_EMISSION').publicFixedSuffix.map(async r=>({name:r.role,address:(await nativePda(c.release.input.programId,'bio',map[r.role])).address})));
    await fs.writeFile(intentFile,JSON.stringify({operation:'SYNC_EMISSION',nonce:'0',payloadHex:encodeSyncEmissionPayload({maxRent:10000000n}).toString('hex'),suffix,
      resources:{computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'}}));
    const calls=[];const fetchImpl=async(_,options)=>{const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
      if(req.method==='getGenesisHash')result=nativeKeyAddress(c.release.hashes.genesisHash);
      else if(req.method==='getMultipleAccounts')result={context:{slot:10n},value:req.params[0].map(k=>k===base.address?{owner:base.owner,executable:false,lamports:10000000n,rentEpoch:0n,data:[base.data.toString('base64'),'base64']}:null)};
      else if(req.method==='getLatestBlockhash')result={context:{slot:10n},value:{blockhash:key(20),lastValidBlockHeight:100n}};
      else if(req.method==='isBlockhashValid')result={context:{slot:10n},value:true};
      else if(req.method==='getBlockHeight')result=5n;
      else if(req.method==='sendTransaction'){const stored=await(await FileJournalStore.open({directory:stateDir})).load(),entry=JSON.parse(stored.payload).entries[0];assert.equal(entry.state,'PENDING');result=entry.attempts.at(-1).signature;}
      else throw new Error(req.method);
      return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
    };
    const common=['--release',releaseFile,'--local-public-fixture'],online=['--actor',c.actor,'--state',stateDir,'--endpoint','http://127.0.0.1:8899'];
    const saved=await runOperator(['prepare',...common,...online,'--intent',intentFile,'--out',envelopeFile],{fetchImpl});assert.equal(saved.saved,envelopeFile);
    assert.equal((await fs.stat(envelopeFile)).mode&0o777,0o600);assert.equal(calls.some(x=>x.method==='sendTransaction'),false);
    const inspected=await runOperator(['inspect',...common,'--envelope',envelopeFile]);assert.equal(inspected.operation,'SYNC_EMISSION');assert.equal(inspected.businessExecutionVerified,false);
    const envelope=JSON.parse(await fs.readFile(envelopeFile,'utf8')),pair=await createKeyPairFromPrivateKeyBytes(hash('BIOP0R2 native SIGNING FIXTURE ONLY 1'));
    const signed=transactionBytes(await signTransaction([pair],decodeV1Transaction(Buffer.from(envelope.unsignedHex,'hex')).transaction));
    await fs.writeFile(signedFile,JSON.stringify({signedTransactionBase64:signed.toString('base64')}));
    const result=await runOperator(['broadcast',...common,...online,'--envelope',envelopeFile,'--signed',signedFile],{fetchImpl});assert.equal(result.decision,'PENDING');
    await assert.rejects(runOperator(['prepare',...common,...online,'--intent',intentFile,'--out',envelopeFile],{fetchImpl}),/EEXIST/);
    assert.equal(calls.filter(x=>x.method==='sendTransaction').length,1);
    await assert.rejects(runOperator(['inspect',...common,'--envelope',envelopeFile,'--extra','x']),/OPTIONS/);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
