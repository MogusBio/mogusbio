import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {PendingJournal,persistJournalCAS} from '../src/journal.mjs';import {FileJournalStore} from '../src/file-journal.mjs';import {encodeArtifactPutPayload,nativeRequestHash,nativeBusinessKey} from '../src/native.mjs';import {clientFixture,hash} from './native-fixture.mjs';

test('23312 large real durable terminal records keep the live journal bounded and all old results recoverable',{timeout:300000},async t=>{
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-archive-capacity-'));
  try{
    const c=await clientFixture(),store=await FileJournalStore.open({directory}),count=23312;let journal=new PendingJournal(c),storageRevision=0n,maximumLiveBytes=0;
    const payload=encodeArtifactPutPayload({kind:702,totalLength:1024,artifactSHA:hash('large fixed local archive fixture'),expectedSequence:0n,offset:0,chunk:Buffer.alloc(1024,0xa5),maxRent:1000000n});
    for(let start=0;start<count;start+=1000){const end=Math.min(start+1000,count),snapshot=JSON.parse(journal.serialize());
      for(let n=start;n<end;n++){const nonce=BigInt(n),frame=c.frame('ARTIFACT_PUT',payload,nonce),result=Buffer.alloc(45);result.writeBigUInt64LE(nonce+100n);
        const digestHex=nativeRequestHash(c.abi,frame).toString('hex'),lastObservation={contextSlot:(nonce+21n).toString(),nextNonce:(nonce+1n).toString(),lastDigestHex:digestHex,lastResultHex:result.toString('hex')};
        snapshot.entries.push({nonce:nonce.toString(),frameHex:frame.toString('hex'),digestHex,businessHex:nativeBusinessKey(c.abi,frame).toString('hex'),state:'CONFIRMED',attempts:[],resultHex:result.toString('hex'),lastObservation,lastError:null});snapshot.globalObservation=lastObservation;}
      // Restore verifies every original frame/H4/H3/schema/result/finalized
      // fact. Repeating PDA cryptography23312 times would test the same nonce
      // decoder already covered elsewhere, rather than archive capacity.
      snapshot.revision=(journal.revision+BigInt((end-start)*2)).toString();journal=PendingJournal.restore(c,JSON.stringify(snapshot));const exports=snapshot.entries.map(e=>journal.exportTerminal(BigInt(e.nonce)));
      maximumLiveBytes=Math.max(maximumLiveBytes,Buffer.byteLength(journal.serialize()));assert.ok(maximumLiveBytes<16*1024*1024);
      journal.pruneArchived(await store.archiveTerminals(exports),{expectedRevision:journal.revision});storageRevision=await persistJournalCAS(journal,store,{expectedStorageRevision:storageRevision});
      if(end%4000===0||end===count)t.diagnostic(`Durably archived ${end}/${count} terminal records; live journal ${Buffer.byteLength(journal.serialize())} bytes`);
    }
    const reopened=await FileJournalStore.open({directory}),loaded=await reopened.load(),restored=PendingJournal.restore(c,loaded.payload);assert.equal(JSON.parse(restored.serialize()).entries.length,0);assert.equal(JSON.parse(restored.serialize()).globalObservation.nextNonce,count.toString());assert.ok(Buffer.byteLength(restored.serialize())<2048);
    for(const n of [0,1,999,1000,10000,19001,count-1]){const old=await restored.getArchived(BigInt(n),reopened);assert.equal(old.resultBytes.readBigUInt64LE(0),BigInt(n)+100n);assert.equal(old.frameBytes.length,1236);assert.equal(old.resultSource,'LOCAL_DURABLE_ARCHIVE');}
    t.diagnostic(`Maximum unpruned batch ${maximumLiveBytes} bytes; ${count} durable records survived reopen; no native mining execution claimed by this storage test`);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
