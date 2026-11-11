import { randomUUID,createHash } from 'node:crypto';
import { promises as fs,constants as C } from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { FileJournalStore } from '../../packages/client/src/file-journal.mjs';
import { check } from './policy.mjs';

const owner=v=>check(v&&v.version==='BIO-SERVICE-LEASE1'&&['HELD','RELEASED'].includes(v.state)&&typeof v.host==='string'&&Number.isInteger(v.pid)&&v.pid>0&&typeof v.token==='string','SERVICE_LEASE_CORRUPT');
/** Existing CAS format, read without FileJournalStore.open's directory creation.
 * This trusted-local-filesystem observer never acquires or recovers a lease. */
export async function readServiceJournal(directory,name){
  check(typeof directory==='string'&&path.isAbsolute(directory)&&path.normalize(directory)===directory&&['supervisor.json','service-lease.json'].includes(name),'SERVICE_HEALTH_PATH');
  let at=path.parse(directory).root;
  for(const part of directory.slice(at.length).split(path.sep).filter(Boolean)){
    at=path.join(at,part);let s;try{s=await fs.lstat(at);}catch(e){if(e.code==='ENOENT')return {revision:0n,payload:null};throw e;}
    check(s.isDirectory()&&!s.isSymbolicLink(),'SERVICE_HEALTH_DIRECTORY');
    if(at===directory)check(s.uid===process.getuid()&&(s.mode&0o077)===0,'SERVICE_HEALTH_DIRECTORY');
  }
  let h;try{h=await fs.open(path.join(directory,name),C.O_RDONLY|C.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return {revision:0n,payload:null};throw e;}
  try{
    const s=await h.stat();check(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s.size<=32*1024*1024+4096,'SERVICE_HEALTH_FILE');
    const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await h.readFile()));
    check(v&&Object.keys(v).sort().join(',')==='payload,revision,sha256,version'&&v.version==='BIOCLIENT-FILE-CAS1'&&typeof v.payload==='string'&&Buffer.byteLength(v.payload)<=16*1024*1024&&typeof v.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(v.revision)&&BigInt(v.revision)<=(1n<<64n)-1n&&typeof v.sha256==='string'&&v.sha256===createHash('sha256').update(v.payload,'utf8').digest('hex'),'SERVICE_HEALTH_CORRUPT');
    return {revision:BigInt(v.revision),payload:v.payload};
  }finally{await h.close();}
}
/** Returns only an observation; never a token, PID, hostname or permission to act. */
export function observeServiceLease(record){
  if(record.payload===null)return 'STOPPED';
  try{const v=JSON.parse(record.payload);owner(v);if(v.state==='RELEASED')return 'STOPPED';if(v.host!==hostname())return 'UNKNOWN';
    try{process.kill(v.pid,0);return 'ALIVE';}catch(e){return e.code==='ESRCH'?'OWNER_DEAD':'UNKNOWN';}
  }catch{return 'UNKNOWN';}
}
export async function acquireServiceLease(directory){
  const store=await FileJournalStore.open({directory,name:'service-lease.json'}),old=await store.load(),previous=old.payload===null?null:JSON.parse(old.payload);if(previous){owner(previous);check(previous.state==='RELEASED','SERVICE_LEASE_BUSY');}
  const held={version:'BIO-SERVICE-LEASE1',state:'HELD',host:hostname(),pid:process.pid,token:randomUUID()},text=JSON.stringify(held);check(await store.compareAndSwap(old.revision,text)!==false,'SERVICE_LEASE_BUSY');let closed=false;
  const assert=async()=>{check(!closed,'SERVICE_LEASE_CLOSED');const v=await store.load();check(v.payload===text,'SERVICE_LEASE_LOST');};
  return {assert,token:held.token,async close(){if(closed)return;await assert();const current=await store.load();check(await store.compareAndSwap(current.revision,JSON.stringify({...held,state:'RELEASED'}))!==false,'SERVICE_LEASE_LOST');closed=true;}};
}
/** Never steal by age. Only an explicit token and proven dead local PID permit recovery. */
export async function recoverServiceLease({directory,expectedToken}){
  const store=await FileJournalStore.open({directory,name:'service-lease.json'}),old=await store.load();check(old.payload!==null,'SERVICE_LEASE_MISSING');const v=JSON.parse(old.payload);owner(v);check(v.state==='HELD'&&v.token===expectedToken&&v.host===hostname(),'SERVICE_LEASE_RECOVERY_OWNER');let dead=false;try{process.kill(v.pid,0);}catch(e){check(e.code==='ESRCH','SERVICE_LEASE_OWNER_UNKNOWN');dead=true;}check(dead,'SERVICE_LEASE_OWNER_ALIVE');check(await store.compareAndSwap(old.revision,JSON.stringify({...v,state:'RELEASED'}))!==false,'SERVICE_LEASE_CHANGED');return {recovered:true,priorPid:v.pid};
}
