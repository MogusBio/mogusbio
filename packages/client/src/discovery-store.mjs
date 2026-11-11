import {randomBytes} from 'node:crypto';
import {FileJournalStore} from './file-journal.mjs';
import {DISCOVERY_LIMITS as L,DISCOVERY_SECTIONS,exact,plain,hex32,decimal,validateDiscoveryRequest,failure,requireDiscovery as check,sameBinding,freshTraversal,completeScan,publicContext} from './discovery-core.mjs';

const token=()=>randomBytes(32).toString('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const scanFields=['id','actor','section','query','createdAt','expiresAt','touchedAt','cursor','pastCursor','pastResponse','traversal','pending','minSlot','maxSlot','visited','changed','tokenOverflow'];
function validateScan(s,binding){
  exact(s,scanFields);validateDiscoveryRequest({actor:s.actor,section:s.section,cursor:s.cursor,query:s.query});
  check(hex32(s.id)&&hex32(s.cursor)&&(s.pastCursor===null||hex32(s.pastCursor))&&['createdAt','expiresAt','touchedAt','visited'].every(k=>decimal(s[k])));
  check(BigInt(s.expiresAt)===BigInt(s.createdAt)+BigInt(L.ttlMs)&&BigInt(s.touchedAt)>=BigInt(s.createdAt)&&BigInt(s.touchedAt)<BigInt(s.expiresAt));
  check((s.minSlot===null&&s.maxSlot===null)||(decimal(s.minSlot)&&decimal(s.maxSlot)&&BigInt(s.minSlot)<=BigInt(s.maxSlot)));
  check(Number.isInteger(s.changed)&&s.changed>=0&&s.changed<=1000000000&&typeof s.tokenOverflow==='boolean');
  exact(s.traversal,['lane','prefix','parents']);const t=s.traversal,lanes=s.section==='roots'?4:1;
  check(Number.isInteger(t.lane)&&t.lane>=0&&t.lane<=lanes&&typeof t.prefix==='string'&&/^(?:[0-9a-f]{2}){0,32}$/.test(t.prefix)&&Array.isArray(t.parents)&&t.parents.length<=32);
  t.parents.forEach((p,i)=>{exact(p,['prefix','next']);check(p.prefix.length===i*2&&t.prefix.startsWith(p.prefix)&&Number.isInteger(p.next)&&p.next>=1&&p.next<=256);});
  check(t.prefix.length===t.parents.length*2&&Array.isArray(s.pending)&&s.pending.length<L.leafRows);
  const addresses=new Set();for(const p of s.pending){exact(p,['address','idHex','space','lane']);check(typeof p.address==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.address)&&hex32(p.idHex)&&Number.isInteger(p.space)&&p.space>=165&&p.space<=3479&&Number.isInteger(p.lane)&&p.lane>=0&&p.lane<=4&&!addresses.has(p.address));addresses.add(p.address);}
  if(s.pastResponse!==null){const r=s.pastResponse;check(plain(r)&&r.profile==='BIO-DISCOVERY1'&&r.actor===s.actor&&r.section===s.section&&JSON.stringify(r.context)===JSON.stringify(publicContext(binding))&&Array.isArray(r.rows)&&r.rows.length<=L.rows&&r.nextCursor===(completeScan(s)||s.tokenOverflow?null:s.cursor));}
  check(Buffer.byteLength(JSON.stringify(s))<=L.scanBytes,'DISCOVERY_CACHE_LIMIT');return s;
}
function decode(text,binding,now){
  if(text===null)return {version:'BIO-DISCOVERY-CACHE1',binding:{...binding},highWater:String(now),scans:[]};
  check(typeof text==='string'&&Buffer.byteLength(text)<=L.storeBytes,'DISCOVERY_CACHE_LIMIT');let s;try{s=JSON.parse(text);}catch{throw failure('DISCOVERY_INTERNAL');}
  exact(s,['version','binding','highWater','scans']);check(s.version==='BIO-DISCOVERY-CACHE1'&&sameBinding(s.binding,binding)&&decimal(s.highWater)&&now>=Number(s.highWater)&&Array.isArray(s.scans)&&s.scans.length<=L.retainedScans);
  const actors=new Map(),keys=new Set(),ids=new Set();for(const scan of s.scans){validateScan(scan,binding);const key=`${scan.actor}/${scan.section}`;check(!keys.has(key)&&!ids.has(scan.id)&&BigInt(scan.touchedAt)<=BigInt(s.highWater));keys.add(key);ids.add(scan.id);
    if(!completeScan(scan)&&!scan.tokenOverflow&&Number(scan.expiresAt)>now)actors.set(scan.actor,(actors.get(scan.actor)??0)+1);
  }
  check([...actors.values()].every(n=>n<=L.activePerActor)&&JSON.stringify(s)===text);return s;
}
function prune(state,now){state.highWater=String(now);state.scans=state.scans.filter(s=>Number(s.expiresAt)>now);return state;}
function encoded(state,protectedId){
  for(const s of state.scans)validateScan(s,state.binding);
  const evict=()=>{const candidates=state.scans.filter(s=>s.id!==protectedId&&(completeScan(s)||s.tokenOverflow)).sort((a,b)=>Number(a.touchedAt)-Number(b.touchedAt));if(!candidates.length)return false;state.scans=state.scans.filter(s=>s!==candidates[0]);return true;};
  while(state.scans.length>L.retainedScans)check(evict(),'DISCOVERY_CACHE_LIMIT');let text=JSON.stringify(state);
  while(Buffer.byteLength(text)>L.storeBytes){check(evict(),'DISCOVERY_CACHE_LIMIT');text=JSON.stringify(state);}return text;
}

/** A single protected CAS file: no per-wallet journals or chain authority.
 * Clock injection is constructor-only test/runtime policy, never HTTP input. */
export class DiscoveryStore{
  #directory;#clock;#store=null;
  constructor({directory,clock=()=>Date.now()}){check(typeof directory==='string'&&typeof clock==='function');this.#directory=directory;this.#clock=clock;}
  #now(){const n=this.#clock();check(Number.isSafeInteger(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER-L.ttlMs);return n;}
  async #file(){this.#store??=FileJournalStore.open({directory:this.#directory,name:'discovery-cache.json'});return this.#store;}
  async #update(binding,budget,change){
    const file=await this.#file();
    for(let attempt=0;attempt<12;attempt++){
      budget.check();const now=this.#now(),old=await file.load(),s=prune(decode(old.payload,binding,now),now),out=change(s,now);
      if(out.noWrite)return out.value;const text=encoded(s,out.protectedId);budget.check();let result;
      try{result=await file.compareAndSwap(old.revision,text);}catch{if(attempt===11)throw failure('DISCOVERY_INTERNAL');await new Promise(resolve=>setTimeout(resolve,10+attempt*5));continue;}
      if(result!==false)return out.value;await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw failure('DISCOVERY_INTERNAL');
  }
  async run({binding,request,budget},work){
    validateDiscoveryRequest(request);check(typeof work==='function');let selected;
    try{
      selected=await this.#update(binding,budget,(state,now)=>{
        if(request.cursor!==null){
          const s=state.scans.find(s=>s.actor===request.actor&&s.section===request.section&&s.query===request.query&&(s.cursor===request.cursor||s.pastCursor===request.cursor));
          check(s,'DISCOVERY_CURSOR_INVALID');if(s.pastCursor===request.cursor&&s.pastResponse!==null)return {noWrite:true,value:{replay:clone(s.pastResponse)}};
          return {noWrite:true,value:{scan:clone(s)}};
        }
        state.scans=state.scans.filter(s=>!(s.actor===request.actor&&s.section===request.section));
        check(state.scans.filter(s=>s.actor===request.actor&&!completeScan(s)&&!s.tokenOverflow).length<L.activePerActor,'DISCOVERY_CACHE_LIMIT');
        const s={id:token(),actor:request.actor,section:request.section,query:request.query,createdAt:String(now),expiresAt:String(now+L.ttlMs),touchedAt:String(now),cursor:token(),pastCursor:null,pastResponse:null,traversal:freshTraversal(),pending:[],minSlot:null,maxSlot:null,visited:'0',changed:0,tokenOverflow:false};
        state.scans.push(s);return {protectedId:s.id,value:{scan:clone(s)}};
      });
      if(selected.replay)return selected.replay;const original=selected.scan,computed=await work(clone(original));budget.check();
      check(plain(computed)&&plain(computed.scan)&&plain(computed.response)&&computed.scan.id===original.id);const updated=computed.scan;
      return await this.#update(binding,budget,(state,now)=>{
        const prior=state.scans.find(s=>s.id===original.id);check(prior,'DISCOVERY_CURSOR_INVALID');
        if(prior.cursor!==original.cursor){check(prior.pastCursor===original.cursor&&prior.pastResponse!==null,'DISCOVERY_CURSOR_INVALID');return {noWrite:true,value:clone(prior.pastResponse)};}
        check(now<Number(prior.expiresAt),'DISCOVERY_CURSOR_EXPIRED');updated.cursor=token();updated.pastCursor=request.cursor??original.cursor;updated.touchedAt=String(now);
        computed.response.nextCursor=completeScan(updated)||updated.tokenOverflow?null:updated.cursor;updated.pastResponse=clone(computed.response);validateScan(updated,binding);
        state.scans=state.scans.map(s=>s.id===original.id?updated:s);return {protectedId:updated.id,value:clone(computed.response)};
      });
    }catch(error){throw error;}
  }
}
