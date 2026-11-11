import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {FileJournalStore} from '../src/file-journal.mjs';import {PendingJournal,persistJournalCAS} from '../src/journal.mjs';import {clientFixture} from './native-fixture.mjs';
const moduleURL=new URL('../src/file-journal.mjs',import.meta.url).href;
const temp=async()=>fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-journal-'));
const cleanup=d=>fs.rm(d,{recursive:true,force:true});
function worker(code,args=[]){const p=spawn(process.execPath,['--input-type=module','-e',code,...args],{stdio:['ignore','pipe','pipe','ipc']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',(code,signal)=>resolve({code,signal,stdout,stderr}));});return p;}
const ready=p=>new Promise((resolve,reject)=>{p.once('message',resolve);p.once('error',reject);});
test('file CAS writes restrictive POSIX fsynced envelopes and journal survives real adapter restart',async()=>{
  const d=await temp();try{const store=await FileJournalStore.open({directory:d});assert.deepEqual(await store.load(),{revision:0n,payload:null});
    const {abi,release,actor,frame}=await clientFixture(),j=new PendingJournal({abi,release,actor});j.begin(frame('SYNC_EMISSION',Buffer.alloc(8)),{expectedRevision:0n,observedNextNonce:0n});
    assert.equal(await persistJournalCAS(j,store,{expectedStorageRevision:0n}),1n);assert.equal(await store.compareAndSwap(0n,'stale'),false);
    const reopened=await FileJournalStore.open({directory:d}),read=await reopened.load(),restored=PendingJournal.restore({abi,release,actor},read.payload);assert.equal(read.revision,1n);assert.deepEqual(restored.retryFrame(0n),j.retryFrame(0n));
    assert.equal((await fs.stat(d)).mode&0o777,0o700);assert.equal((await fs.stat(store.file)).mode&0o777,0o600);assert.deepEqual(await store.inspectLock(),{state:'UNLOCKED'});
  }finally{await cleanup(d);}
});
test('two actual Node processes cannot both win one storage revision; a loser retries by reading rather than overwriting',async()=>{
  const d=await temp();try{const code=`import {FileJournalStore} from ${JSON.stringify(moduleURL)};const store=await FileJournalStore.open({directory:process.argv[1]});process.send('ready');process.once('message',async()=>{try{const r=await store.compareAndSwap(0n,process.argv[2]);console.log(r===false?'CAS_CONFLICT':r.toString());}catch(e){console.log(e.code);}process.disconnect();});`;
    const a=worker(code,[d,'A']),b=worker(code,[d,'B']);await Promise.all([ready(a),ready(b)]);a.send('go');b.send('go');const results=await Promise.all([a.done,b.done]);assert.equal(results.filter(r=>r.stdout.trim()==='1').length,1);assert.ok(results.every(r=>r.code===0&&['1','CAS_CONFLICT','FILE_CAS_GATE_BUSY','FILE_CAS_LOCK_BUSY'].includes(r.stdout.trim())));
    const store=await FileJournalStore.open({directory:d}),s=await store.load();assert.equal(s.revision,1n);assert.ok(['A','B'].includes(s.payload));assert.equal(await store.compareAndSwap(1n,'next'),2n);
  }finally{await cleanup(d);}
});
test('real process crash before/after atomic rename preserves old/new full state and requires explicit dead-owner recovery',async()=>{
  for(const phase of ['before','after']){const d=await temp();try{const store=await FileJournalStore.open({directory:d});await store.compareAndSwap(0n,'old');
    const code=`import {promises as fs} from 'node:fs';import {FileJournalStore} from ${JSON.stringify(moduleURL)};const store=await FileJournalStore.open({directory:process.argv[1]});const orig=fs.rename.bind(fs);fs.rename=async(src,dst)=>{if(dst===store.file){if(process.argv[2]==='before')process.exit(41);await orig(src,dst);process.exit(42);}return orig(src,dst);};await store.compareAndSwap(1n,'new');`;
    const p=worker(code,[d,phase]),result=await p.done;assert.equal(result.code,phase==='before'?41:42,result.stderr);const observed=await store.load();assert.deepEqual(observed,phase==='before'?{revision:1n,payload:'old'}:{revision:2n,payload:'new'});
    const lock=await store.inspectLock();assert.equal(lock.state,'LOCKED');assert.equal(lock.pid,p.pid);await assert.rejects(store.compareAndSwap(observed.revision,'illegal'),/LOCK_BUSY/);await assert.rejects(store.recoverAbandonedLock({expectedToken:'wrong'}),/RECOVERY_OWNER/);
    const recovered=await store.recoverAbandonedLock({expectedToken:lock.token});assert.equal(recovered.revision,observed.revision);assert.equal(await store.compareAndSwap(observed.revision,'resumed'),observed.revision+1n);assert.deepEqual(await store.inspectLock(),{state:'UNLOCKED'});
    assert.equal((await fs.readdir(d)).filter(n=>n.includes('.tmp.')).length,0);
  }finally{await cleanup(d);}}
});
test('a live owner cannot be reclaimed by age or explicit token; killed owner can recover without an ABA unlock race',async()=>{
  const d=await temp();let p;try{const store=await FileJournalStore.open({directory:d});await store.compareAndSwap(0n,'old');
    const code=`import {promises as fs} from 'node:fs';import {FileJournalStore} from ${JSON.stringify(moduleURL)};const store=await FileJournalStore.open({directory:process.argv[1]});fs.rename=async()=>{process.send('locked');await new Promise(()=>{});};setInterval(()=>{},1000);await store.compareAndSwap(1n,'blocked');`;
    p=worker(code,[d]);await ready(p);const lock=await store.inspectLock();await assert.rejects(store.recoverAbandonedLock({expectedToken:lock.token}),/OWNER_ALIVE/);assert.equal((await store.inspectLock()).token,lock.token);
    p.kill('SIGKILL');await p.done;await store.recoverAbandonedLock({expectedToken:lock.token});assert.deepEqual(await store.load(),{revision:1n,payload:'old'});
  }finally{if(p&&p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');await cleanup(d);}
});
test('symlink paths, permissive data files, digest corruption and malformed abandoned gates fail closed',async()=>{
  const d=await temp(),other=await temp();try{await fs.symlink(other,path.join(d,'link'));await assert.rejects(FileJournalStore.open({directory:path.join(d,'link')}),/SYMLINK/);
    const store=await FileJournalStore.open({directory:other});await store.compareAndSwap(0n,'good');await fs.chmod(store.file,0o644);await assert.rejects(store.load(),/FILE_POLICY/);await fs.chmod(store.file,0o600);
    const x=JSON.parse(await fs.readFile(store.file,'utf8'));x.payload='corrupt';await fs.writeFile(store.file,JSON.stringify(x));await assert.rejects(store.load(),/CORRUPT/);await assert.rejects(store.compareAndSwap(1n,'new'),/CORRUPT/);
    await fs.unlink(store.file);await fs.symlink(path.join(d,'target'),store.file);await assert.rejects(FileJournalStore.open({directory:other}),/SYMLINK/);await assert.rejects(store.load());await fs.unlink(store.file);
    await fs.mkdir(path.join(other,'.pending-journal.json.gate'),{mode:0o700});assert.equal((await store.inspectLock()).state,'GATE_BLOCKED_MANUAL_INSPECTION');await assert.rejects(store.compareAndSwap(0n,'new'),/GATE_BUSY/);
  }finally{await cleanup(d);await cleanup(other);}
});
