import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {FileJournalStore} from '../src/file-journal.mjs';import {PendingJournal,persistJournalCAS} from '../src/journal.mjs';import {clientFixture} from './native-fixture.mjs';import {confirm,nonceProof} from './archive-fixture.mjs';
const moduleURL=new URL('../src/file-journal.mjs',import.meta.url).href;
const temp=async()=>fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-archive-'));
const clean=d=>fs.rm(d,{recursive:true,force:true});
const journal=c=>new PendingJournal(c);
function child(code,args){const p=spawn(process.execPath,['--input-type=module','-e',code,...args],{stdio:['ignore','pipe','pipe']});let stderr='';p.stderr.on('data',b=>stderr+=b);return new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>resolve({code,stderr}));});}
test('terminal archive requires actual durable branded exact receipt and preserves old confirmation/global facts through prune+reopen',async()=>{
  const d=await temp();try{const c=await clientFixture(),j=journal(c),store=await FileJournalStore.open({directory:d});const result=await confirm(c,j,0n);await persistJournalCAS(j,store,{expectedStorageRevision:0n});const original=j.exportTerminal(0n);
    assert.throws(()=>j.pruneArchived([{nonce:'0',durable:true}],{expectedRevision:j.revision}),/RECEIPT/);
    const mutable=j.exportTerminal(0n),archiving=store.archiveTerminals([mutable]);mutable.entry.resultHex='ff'.repeat(8);const receipts=await archiving;
    assert.deepEqual((await j.getArchived(0n,store)).resultBytes,result);assert.throws(()=>j.pruneArchived([structuredClone(receipts[0])],{expectedRevision:j.revision}),/RECEIPT/);
    assert.throws(()=>j.pruneArchived([receipts[0],receipts[0]],{expectedRevision:j.revision}),/DUPLICATE/);
    const beforeGlobal=JSON.parse(j.serialize()).globalObservation;j.pruneArchived(receipts,{expectedRevision:j.revision});assert.equal(JSON.parse(j.serialize()).entries.length,0);assert.deepEqual(JSON.parse(j.serialize()).globalObservation,beforeGlobal);
    assert.equal(await persistJournalCAS(j,store,{expectedStorageRevision:0n}).catch(e=>e.code),'JOURNAL_STORAGE_CAS');const old=PendingJournal.restore(c,(await store.load()).payload);assert.deepEqual(old.get(0n).resultBytes,result);assert.deepEqual((await old.getArchived(0n,store)).resultBytes,result);
    await persistJournalCAS(j,store,{expectedStorageRevision:1n});const reopened=await FileJournalStore.open({directory:d}),restored=PendingJournal.restore(c,(await reopened.load()).payload);assert.throws(()=>restored.get(0n),/NOT_FOUND/);const historical=await restored.getArchived(0n,reopened);assert.deepEqual(historical.resultBytes,result);assert.equal(historical.resultSource,'LOCAL_DURABLE_ARCHIVE');
    const res2=await confirm(c,restored,1n);assert.deepEqual((await restored.getArchived(0n,reopened)).resultBytes,result);assert.deepEqual(restored.get(1n).resultBytes,res2);
    const conflicting=structuredClone(original);conflicting.entry.lastError='rewrite';await assert.rejects(reopened.archiveTerminals([conflicting]),/NONCE_CONFLICT/);assert.deepEqual((await restored.getArchived(0n,reopened)).resultBytes,result);
  }finally{await clean(d);}
});
test('observeFinalized advances empty archived history for another device, but cannot hide pending or rewrite/regress cached facts',async()=>{
  const d=await temp();try{const c=await clientFixture(),j=journal(c),s=await FileJournalStore.open({directory:d});await confirm(c,j,0n);j.pruneArchived(await s.archiveTerminals([j.exportTerminal(0n)]),{expectedRevision:j.revision});
    j.observeFinalized(await nonceProof(c,9n),{expectedRevision:j.revision});assert.equal(JSON.parse(j.serialize()).globalObservation.nextNonce,'9');assert.deepEqual((await j.getArchived(0n,s)).resultBytes,Buffer.from('0a00000000000000','hex'));
    const raw=c.frame('SYNC_EMISSION',Buffer.alloc(8),9n);j.begin(raw,{expectedRevision:j.revision,observedNextNonce:9n});const before=j.serialize();assert.throws(()=>j.observeFinalized(awaitFake(),{expectedRevision:j.revision}),/PENDING/);assert.equal(j.serialize(),before);
    const actual=await nonceProof(c,10n,{frame:raw});assert.throws(()=>j.observeFinalized(actual,{expectedRevision:j.revision}),/PENDING/);assert.equal(j.get(9n).state,'PREPARED');j.reconcile(9n,actual,{expectedRevision:j.revision});
    const old=await nonceProof(c,8n,{slot:100n});assert.throws(()=>j.observeFinalized(old,{expectedRevision:j.revision}),/REGRESSION/);const rewrite=await nonceProof(c,10n,{frame:c.frame('SYNC_EMISSION',Buffer.alloc(8),50n),slot:101n});assert.throws(()=>j.observeFinalized(rewrite,{expectedRevision:j.revision}),/CACHE_REWRITE/);
  }finally{await clean(d);}
});
const awaitFake=()=>({nextNonce:10n});
test('ALREADY_PROCESSED first terminal fact survives archive plus failed main CAS and a newer nonce observation',async()=>{
  const d=await temp();try{const c=await clientFixture(),j=journal(c),s=await FileJournalStore.open({directory:d}),raw=c.frame('SYNC_EMISSION',Buffer.alloc(8),0n);
    j.begin(raw,{expectedRevision:0n,observedNextNonce:0n});j.reconcile(0n,await nonceProof(c,3n),{expectedRevision:j.revision});await persistJournalCAS(j,s,{expectedStorageRevision:0n});const exported=j.exportTerminal(0n);await s.archiveTerminals([exported]);
    await assert.rejects(persistJournalCAS(j,s,{expectedStorageRevision:0n}),/STORAGE_CAS/);const restored=PendingJournal.restore(c,(await s.load()).payload);restored.reconcile(0n,await nonceProof(c,9n),{expectedRevision:restored.revision});
    assert.deepEqual(restored.exportTerminal(0n),exported);assert.equal(restored.get(0n).businessExecutionVerified,false);assert.match(restored.get(0n).executionReason,/EXECUTION_UNKNOWN/);assert.equal(JSON.parse(restored.serialize()).globalObservation.nextNonce,'9');restored.pruneArchived(await s.archiveTerminals([restored.exportTerminal(0n)]),{expectedRevision:restored.revision});await persistJournalCAS(restored,s,{expectedStorageRevision:1n});const old=await restored.getArchived(0n,s);assert.equal(old.state,'ALREADY_PROCESSED');assert.equal(old.resultBytes,null);assert.equal(old.lastObservation.nextNonce,'3');assert.equal(old.businessExecutionVerified,false);assert.match(old.executionReason,/EXECUTION_UNKNOWN/);
  }finally{await clean(d);}
});
test('actual child crashes at archive-index and main-journal renames never lose prior or durably archived result',async()=>{
  for(const phase of ['before-index','after-index','after-main']){const d=await temp();try{const c=await clientFixture(),j=journal(c),s=await FileJournalStore.open({directory:d}),expected=await confirm(c,j,0n);await persistJournalCAS(j,s,{expectedStorageRevision:0n});
    const exportPath=path.join(d,'terminal-export.json');await fs.writeFile(exportPath,JSON.stringify(j.exportTerminal(0n)),{mode:0o600});
    if(phase==='after-main'){j.pruneArchived(await s.archiveTerminals([j.exportTerminal(0n)]),{expectedRevision:j.revision});await fs.writeFile(path.join(d,'new-main.json'),j.serialize(),{mode:0o600});}
    const code=`import {promises as fs} from 'node:fs';import {FileJournalStore} from ${JSON.stringify(moduleURL)};const store=await FileJournalStore.open({directory:process.argv[1]}),phase=process.argv[2],rename=fs.rename.bind(fs);fs.rename=async(src,dst)=>{if(dst.endsWith('.index.json')){if(phase==='before-index')process.exit(51);await rename(src,dst);if(phase==='after-index')process.exit(52);return;}if(phase==='after-main'&&dst===store.file){await rename(src,dst);process.exit(53);}return rename(src,dst);};if(phase==='after-main')await store.compareAndSwap(1n,await fs.readFile(process.argv[1]+'/new-main.json','utf8'));else await store.archiveTerminals([JSON.parse(await fs.readFile(process.argv[1]+'/terminal-export.json','utf8'))]);`;
    const result=await child(code,[d,phase]);assert.equal(result.code,phase==='before-index'?51:phase==='after-index'?52:53,result.stderr);const lock=await s.inspectLock();await s.recoverAbandonedLock({expectedToken:lock.token});const reopened=await FileJournalStore.open({directory:d}),restored=PendingJournal.restore(c,(await reopened.load()).payload);
    if(phase==='before-index'){assert.deepEqual(restored.get(0n).resultBytes,expected);await assert.rejects(restored.getArchived(0n,reopened),/NOT_FOUND/);await reopened.archiveTerminals([restored.exportTerminal(0n)]);}
    if(phase!=='after-main')assert.deepEqual(restored.get(0n).resultBytes,expected);else assert.equal(JSON.parse(restored.serialize()).entries.length,0);
    assert.deepEqual((await restored.getArchived(0n,reopened)).resultBytes,expected);assert.equal(JSON.parse(restored.serialize()).globalObservation.nextNonce,'1');
  }finally{await clean(d);}}
});
