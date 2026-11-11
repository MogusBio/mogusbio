import { promises as fs,constants as C } from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { hostname } from 'node:os';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const u64max=(1n<<64n)-1n,maxPayload=16*1024*1024,maxEnvelope=32*1024*1024+4096;
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const archiveReceipts=new WeakMap();
function canonical(value){if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;check(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'FILE_ARCHIVE_VALUE');return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;}
function archiveContext(value){check(value&&Object.keys(value).sort().join(',')==='abiHash,actor,configHex,domainHex'&&['abiHash','domainHex','configHex'].every(k=>typeof value[k]==='string'&&/^[0-9a-f]{64}$/.test(value[k]))&&typeof value.actor==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.actor),'FILE_ARCHIVE_CONTEXT');return {abiHash:value.abiHash,domainHex:value.domainHex,configHex:value.configHex,actor:value.actor};}
function terminalBundle(value){
  check(value&&Object.keys(value).sort().join(',')==='context,entry,version'&&value.version==='BIOCLIENT-TERMINAL-EXPORT1','FILE_ARCHIVE_FORMAT');archiveContext(value.context);
  check(value.entry&&['CONFIRMED','NONCE_CONFLICT','ALREADY_PROCESSED'].includes(value.entry.state),'FILE_ARCHIVE_NONTERMINAL');decimal(value.entry.nonce);
  const text=canonical(value);check(Buffer.byteLength(text)<=maxPayload,'FILE_ARCHIVE_SIZE');return {text,hash:digest(text),namespace:digest(canonical(value.context)),nonce:value.entry.nonce};
}
async function archivePage(directory,namespace,page){
  let text;try{text=await readSafeFile(path.join(directory,`${page}.page.index.json`),262144);}catch(e){if(e.code==='ENOENT')return new Map();throw e;}
  const p=JSON.parse(text);check(p&&Object.keys(p).sort().join(',')==='namespace,page,rows,version'&&p.version==='BIOCLIENT-TERMINAL-PAGE2'&&p.namespace===namespace&&p.page===page.toString()&&Array.isArray(p.rows)&&p.rows.length<=1024&&canonical(p)===text,'FILE_ARCHIVE_PAGE');
  const rows=new Map();let previous=-1n;for(const r of p.rows){check(r&&Object.keys(r).sort().join(',')==='entrySHA,nonce,segmentSHA'&&typeof r.entrySHA==='string'&&/^[0-9a-f]{64}$/.test(r.entrySHA)&&typeof r.segmentSHA==='string'&&/^[0-9a-f]{64}$/.test(r.segmentSHA),'FILE_ARCHIVE_PAGE');const n=decimal(r.nonce);check(n>previous&&n/1024n===page,'FILE_ARCHIVE_PAGE');previous=n;rows.set(r.nonce,r);}return rows;
}
const ownUid=s=>typeof process.getuid!=='function'||s.uid===process.getuid();
const validRevision=v=>typeof v==='bigint'&&v>=0n&&v<=u64max;
const decimal=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s),'FILE_CAS_CORRUPT');const n=BigInt(s);check(validRevision(n),'FILE_CAS_CORRUPT');return n;};
async function maybeStat(p){try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function safeDirectory(directory,{create=false}={}){
  check(process.platform!=='win32'&&typeof C.O_NOFOLLOW==='number'&&typeof C.O_DIRECTORY==='number','FILE_CAS_POSIX_REQUIRED');
  check(typeof directory==='string'&&path.isAbsolute(directory)&&path.normalize(directory)===directory,'FILE_CAS_PATH');
  const parts=directory.slice(path.parse(directory).root.length).split(path.sep).filter(Boolean);let at=path.parse(directory).root;
  for(const part of parts){at=path.join(at,part);let s=await maybeStat(at);if(s===null){check(create,'FILE_CAS_DIRECTORY_MISSING');try{await fs.mkdir(at,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}s=await fs.lstat(at);}check(s.isDirectory()&&!s.isSymbolicLink(),'FILE_CAS_SYMLINK_OR_DIRECTORY');}
  const s=await fs.lstat(directory);check(ownUid(s)&&(s.mode&0o077)===0,'FILE_CAS_DIRECTORY_MODE');
}
async function syncDirectory(directory){const h=await fs.open(directory,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}}
async function readSafeFile(file,limit){
  const h=await fs.open(file,C.O_RDONLY|C.O_NOFOLLOW);try{const s=await h.stat();check(s.isFile()&&s.nlink===1&&ownUid(s)&&(s.mode&0o077)===0&&s.size<=limit,'FILE_CAS_FILE_POLICY');
    return new TextDecoder('utf-8',{fatal:true}).decode(await h.readFile());}finally{await h.close();}
}
async function writeNewFile(file,text){const h=await fs.open(file,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);try{await h.writeFile(text,'utf8');await h.sync();}finally{await h.close();}}
async function readOwner(lock){const s=await fs.lstat(lock);check(s.isDirectory()&&!s.isSymbolicLink()&&ownUid(s)&&(s.mode&0o077)===0,'FILE_CAS_LOCK_POLICY');
  const o=JSON.parse(await readSafeFile(path.join(lock,'owner.json'),4096));check(o&&Object.keys(o).sort().join(',')==='host,pid,token,version'&&o.version==='BIOCLIENT-LOCK1'&&typeof o.host==='string'&&Number.isSafeInteger(o.pid)&&o.pid>0&&typeof o.token==='string'&&/^[0-9a-f-]{36}$/.test(o.token),'FILE_CAS_LOCK_CORRUPT');return o;
}
async function removeOwnedLock(lock,token){const o=await readOwner(lock);check(o.token===token,'FILE_CAS_LOCK_CHANGED');await fs.unlink(path.join(lock,'owner.json'));await fs.rmdir(lock);}

/** POSIX trusted-local-filesystem adapter. No private keys or chain authority.
 * The gate serializes lock acquisition and explicit abandoned-lock recovery;
 * it is never reclaimed by age. A crashed gate requires manual inspection. */
export class FileJournalStore{
  #directory;#file;#lock;#gate;#name;
  static async open({directory,name='pending-journal.json'}){
    check(typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)&&!name.includes('..'),'FILE_CAS_NAME');await safeDirectory(directory,{create:true});
    const store=new FileJournalStore();store.#directory=directory;store.#name=name;store.#file=path.join(directory,name);store.#lock=path.join(directory,`.${name}.lock`);store.#gate=path.join(directory,`.${name}.gate`);
    const s=await maybeStat(store.#file);if(s!==null)check(s.isFile()&&!s.isSymbolicLink(),'FILE_CAS_SYMLINK_OR_FILE');return store;
  }
  get file(){return this.#file;}
  static verifyArchiveReceipt(receipt,exported){const held=archiveReceipts.get(receipt);if(held===undefined)return false;try{return held.text===terminalBundle(exported).text;}catch{return false;}}
  async #acquire(directory,busyCode){
    try{await fs.mkdir(directory,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Object.assign(new Error(busyCode),{code:busyCode});throw e;}
    const owner={version:'BIOCLIENT-LOCK1',host:hostname(),pid:process.pid,token:randomUUID()};
    // Any crash here leaves a fail-closed lock, rather than an unlocked write.
    await writeNewFile(path.join(directory,'owner.json'),JSON.stringify(owner));await syncDirectory(directory);await syncDirectory(this.#directory);return owner;
  }
  async #withGate(work){await safeDirectory(this.#directory);const gate=await this.#acquire(this.#gate,'FILE_CAS_GATE_BUSY');try{return await work();}finally{await removeOwnedLock(this.#gate,gate.token);await syncDirectory(this.#directory);}}
  async #withLock(work){const lock=await this.#withGate(()=>this.#acquire(this.#lock,'FILE_CAS_LOCK_BUSY'));try{return await work(lock);}finally{await removeOwnedLock(this.#lock,lock.token);await syncDirectory(this.#directory);}}
  async #load(){
    let text;try{text=await readSafeFile(this.#file,maxEnvelope);}catch(e){if(e.code==='ENOENT')return {revision:0n,payload:null};throw e;}
    const x=JSON.parse(text);check(x&&Object.keys(x).sort().join(',')==='payload,revision,sha256,version'&&x.version==='BIOCLIENT-FILE-CAS1'&&typeof x.payload==='string'&&Buffer.byteLength(x.payload)<=maxPayload&&typeof x.sha256==='string'&&x.sha256===digest(x.payload),'FILE_CAS_CORRUPT');
    return {revision:decimal(x.revision),payload:x.payload};
  }
  async load(){await safeDirectory(this.#directory);return this.#load();}
  async compareAndSwap(expectedRevision,payload){
    check(validRevision(expectedRevision)&&typeof payload==='string'&&Buffer.byteLength(payload)<=maxPayload,'FILE_CAS_INPUT');
    return this.#withLock(async lock=>{const old=await this.#load();if(old.revision!==expectedRevision)return false;check(old.revision<u64max,'FILE_CAS_REVISION_EXHAUSTED');const next=old.revision+1n;
      const temp=path.join(this.#directory,`.${this.#name}.tmp.${lock.token}`),text=JSON.stringify({version:'BIOCLIENT-FILE-CAS1',revision:next.toString(),payload,sha256:digest(payload)});
      check(Buffer.byteLength(text)<=maxEnvelope,'FILE_CAS_INPUT');try{await writeNewFile(temp,text);const s=await maybeStat(this.#file);if(s!==null)check(s.isFile()&&!s.isSymbolicLink(),'FILE_CAS_SYMLINK_OR_FILE');await fs.rename(temp,this.#file);await syncDirectory(this.#directory);return next;}
      finally{try{await fs.unlink(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
    });
  }
  async inspectLock(){await safeDirectory(this.#directory);if(await maybeStat(this.#gate)!==null)return {state:'GATE_BLOCKED_MANUAL_INSPECTION'};
    if(await maybeStat(this.#lock)===null)return {state:'UNLOCKED'};const owner=await readOwner(this.#lock);return {state:'LOCKED',...owner};}
  async recoverAbandonedLock({expectedToken}){
    check(typeof expectedToken==='string','FILE_CAS_RECOVERY_TOKEN');return this.#withGate(async()=>{const owner=await readOwner(this.#lock);check(owner.token===expectedToken&&owner.host===hostname(),'FILE_CAS_RECOVERY_OWNER');
      let dead=false;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')dead=true;else throw Object.assign(new Error('FILE_CAS_OWNER_NOT_PROVEN_DEAD'),{code:'FILE_CAS_OWNER_NOT_PROVEN_DEAD'});}check(dead,'FILE_CAS_OWNER_ALIVE');
      const temp=path.join(this.#directory,`.${this.#name}.tmp.${owner.token}`),s=await maybeStat(temp);if(s!==null){check(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&ownUid(s),'FILE_CAS_TEMP_POLICY');await fs.unlink(temp);}
      await removeOwnedLock(this.#lock,owner.token);await syncDirectory(this.#directory);return {recovered:true,priorPid:owner.pid,revision:(await this.#load()).revision};
    });
  }
  async #archiveDirectory(namespace){
    const root=path.join(this.#directory,`${this.#name}.archive`),directory=path.join(root,namespace);
    for(const d of [root,directory]){const existed=await maybeStat(d);if(existed===null){await fs.mkdir(d,{mode:0o700});await syncDirectory(path.dirname(d));}await safeDirectory(d);}return directory;
  }
  async archiveTerminals(exportedEntries){
    check(Array.isArray(exportedEntries)&&exportedEntries.length>=1&&exportedEntries.length<=1000,'FILE_ARCHIVE_BATCH');
    const rows=exportedEntries.map(value=>{const r=terminalBundle(value);return {...r,value:JSON.parse(r.text)};});check(new Set(rows.map(r=>`${r.namespace}:${r.nonce}`)).size===rows.length,'FILE_ARCHIVE_DUPLICATE');
    return this.#withLock(async lock=>{
      const groups=new Map();for(const r of rows){if(!groups.has(r.namespace))groups.set(r.namespace,[]);groups.get(r.namespace).push(r);}
      for(const [namespace,group]of groups){group.sort((a,b)=>BigInt(a.nonce)<BigInt(b.nonce)?-1:1);const directory=await this.#archiveDirectory(namespace),pages=new Map();
        const segmentText=canonical({version:'BIOCLIENT-TERMINAL-SEGMENT2',namespace,entries:group.map(r=>r.value)}),segmentSHA=digest(segmentText);check(Buffer.byteLength(segmentText)<=maxPayload,'FILE_ARCHIVE_SEGMENT_SIZE');
        for(const r of group){const page=BigInt(r.nonce)/1024n;if(!pages.has(page))pages.set(page,await archivePage(directory,namespace,page));const contents=pages.get(page),prior=contents.get(r.nonce);
          if(prior!==undefined)check(prior.entrySHA===r.hash,'FILE_ARCHIVE_NONCE_CONFLICT');else{const legacy=await this.#readLegacy(directory,namespace,BigInt(r.nonce));if(legacy!==null)check(terminalBundle(legacy).text===r.text,'FILE_ARCHIVE_NONCE_CONFLICT');contents.set(r.nonce,{nonce:r.nonce,entrySHA:r.hash,segmentSHA});}}
        const replace=async(name,text)=>{const temp=path.join(directory,`.archive.tmp.${lock.token}`);try{await writeNewFile(temp,text);await fs.rename(temp,path.join(directory,name));}finally{try{await fs.unlink(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}};
        const segment=path.join(directory,`${segmentSHA}.segment.json`);if(await maybeStat(segment)===null)await replace(`${segmentSHA}.segment.json`,segmentText);else check(await readSafeFile(segment,maxPayload)===segmentText,'FILE_ARCHIVE_CONTENT_CONFLICT');
        for(const [page,contents]of pages){const values=[...contents.values()].sort((a,b)=>BigInt(a.nonce)<BigInt(b.nonce)?-1:1);await replace(`${page}.page.index.json`,canonical({version:'BIOCLIENT-TERMINAL-PAGE2',namespace,page:page.toString(),rows:values}));}
        // Only a complete fsynced segment plus every updated page can issue a
        // pruning receipt. Pages preserve all old mappings and reject changes.
        await syncDirectory(directory);
      }
      return rows.map(r=>{const receipt=Object.freeze({version:'BIOCLIENT-TERMINAL-RECEIPT2',namespace:r.namespace,nonce:r.nonce,contentSHA:r.hash});archiveReceipts.set(receipt,{text:r.text});return receipt;});
    });
  }
  async readTerminal(context,nonce){
    check(validRevision(nonce),'FILE_ARCHIVE_NONCE');const ctx=archiveContext(context),namespace=digest(canonical(ctx));await safeDirectory(this.#directory);
    const root=path.join(this.#directory,`${this.#name}.archive`),directory=path.join(root,namespace);
    if(await maybeStat(root)===null)return null;await safeDirectory(root);if(await maybeStat(directory)===null)return null;await safeDirectory(directory);
    const page=await archivePage(directory,namespace,nonce/1024n),row=page.get(nonce.toString());if(row===undefined)return this.#readLegacy(directory,namespace,nonce);
    const text=await readSafeFile(path.join(directory,`${row.segmentSHA}.segment.json`),maxPayload);check(digest(text)===row.segmentSHA,'FILE_ARCHIVE_DIGEST');const segment=JSON.parse(text);
    check(segment&&Object.keys(segment).sort().join(',')==='entries,namespace,version'&&segment.version==='BIOCLIENT-TERMINAL-SEGMENT2'&&segment.namespace===namespace&&Array.isArray(segment.entries)&&segment.entries.length>=1&&segment.entries.length<=1000&&canonical(segment)===text,'FILE_ARCHIVE_SEGMENT');
    let found=null,previous=-1n;for(const entry of segment.entries){const r=terminalBundle(entry),n=decimal(r.nonce);check(r.namespace===namespace&&n>previous,'FILE_ARCHIVE_BINDING');previous=n;if(n===nonce){check(r.hash===row.entrySHA,'FILE_ARCHIVE_DIGEST');found=entry;}}
    check(found!==null,'FILE_ARCHIVE_BINDING');return found;
  }
  async #readLegacy(directory,namespace,nonce){
    let indexText;try{indexText=await readSafeFile(path.join(directory,`${nonce}.index.json`),4096);}catch(e){if(e.code==='ENOENT')return null;throw e;}
    const index=JSON.parse(indexText);check(index&&Object.keys(index).sort().join(',')==='contentSHA,namespace,nonce,version'&&index.version==='BIOCLIENT-TERMINAL-INDEX1'&&index.namespace===namespace&&index.nonce===nonce.toString()&&typeof index.contentSHA==='string'&&/^[0-9a-f]{64}$/.test(index.contentSHA)&&canonical(index)===indexText,'FILE_ARCHIVE_INDEX');
    const text=await readSafeFile(path.join(directory,`${index.contentSHA}.json`),maxPayload);check(digest(text)===index.contentSHA,'FILE_ARCHIVE_DIGEST');const bundle=JSON.parse(text),row=terminalBundle(bundle);
    check(row.namespace===namespace&&row.nonce===nonce.toString()&&row.hash===index.contentSHA&&row.text===text,'FILE_ARCHIVE_BINDING');return bundle;
  }
}
