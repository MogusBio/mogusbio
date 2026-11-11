import { requireThat, min, u64, time } from './arithmetic.mjs';
import { H_END, hourBudget, emissionPrefix, completedHours } from './emission.mjs';
import { K_WEIGHT, denominator, rewardAmount } from './weights.mjs';

/** ECON4 trusted-state differential kernel. Its ingress is a validated host
 * snapshot, never an authorization mechanism or caller-supplied PASS. */
export class ActiveSettlementIndex {
  constructor() {
    this.version='ECON-SETTLE4/1'; this.nextHour=0n; this.events=[]; this.eventCursor=0;
    this.positions=new Map(); this.activations=new Map(); this.nodes=new Map();
    this.head=null; this.tail=null; this.count=0n; this.weight=0n; this.k=null;
    this.hours=new Map(); this.work={events:0, roots:0}; this.highWater=0n;
  }
  snapshot(){return structuredClone({...this});}
  static fromSnapshot(s){
    requireThat(['ECON-SETTLE3/1','ECON-SETTLE4/1'].includes(s?.version),'INDEX_CHECKPOINT_VERSION');
    const out=Object.assign(new ActiveSettlementIndex(),structuredClone(s));
    if(s.version==='ECON-SETTLE3/1')out.version='ECON-SETTLE4/1';
    requireThat(Number.isInteger(out.eventCursor)&&out.eventCursor>=0&&out.eventCursor<=out.events.length,'INDEX_CHECKPOINT_CURSOR');
    out.events.forEach((e,n)=>requireThat(e.seq===n&&(n===0||e.due>=out.events[n-1].due),'INDEX_CHECKPOINT_EVENTS'));
    let at=out.head,previous=null,count=0n,weight=0n;const seen=new Set();
    while(at!==null){requireThat(!seen.has(at),'INDEX_CHECKPOINT_CYCLE');seen.add(at);const n=out.nodes.get(at),p=out.positions.get(n?.position);requireThat(n?.active&&n.prev===previous&&p?.instance===at,'INDEX_CHECKPOINT_NODE');count++;weight+=p.weight;previous=at;at=n.next;}
    requireThat(count===out.count&&weight===out.weight&&previous===out.tail&&[...out.nodes.values()].filter(n=>n.active).length===seen.size,'INDEX_CHECKPOINT_MEMBERSHIP');return out;
  }
  observe(s){const before=this.snapshot();try{this.#observeFreshChanges(s);}catch(error){Object.assign(this,before);throw error;}}
  #observeFreshChanges(s) {
    requireThat(['ECON-SETTLE2/1','ECON-SETTLE4/1'].includes(s?.version) && s.registry.highWater>=this.highWater,'INDEX_TRUSTED_SNAPSHOT');
    // This adapter is a fresh-genesis, per-transition differential oracle. An
    // arbitrary completed ECON2 snapshot has lost the original append order.
    // Restore the ECON3 checkpoint instead; never reconstruct tied events by sort.
    for(const [id,p]of s.intervals)if(!this.positions.has(id))requireThat(p.end===null&&p.accrued===0n&&p.paid===0n&&p.nextUnsettledHour===p.start,'INDEX_REQUIRES_EVENT_HISTORY');
    for(const[id,k]of s.activations)if(!this.activations.has(id))requireThat(k.end===null,'INDEX_REQUIRES_EVENT_HISTORY');
    this.highWater=s.registry.highWater;
    if(this.nodes.size===0 && this.positions.size===0) this.nextHour=s.registry.nextMaterializeHour;
    const additions=[];
    for(const [id,p] of s.intervals){
      let old=this.positions.get(id);
      if(!old){old={...structuredClone(p),end:null,accrued:0n,nextUnsettledHour:p.start};this.positions.set(id,old);
        if(!this.nodes.has(p.instance))this.nodes.set(p.instance,{instance:p.instance,active:false,position:null,prev:null,next:null});
        additions.push({type:'START',due:p.start,id,instance:p.instance});}
      if(p.end!==null && old.end===null){old.end=p.end;additions.push({type:'END',due:min(p.end,H_END),id,instance:p.instance});}
      else requireThat(old.end===p.end,'INDEX_END_REWRITE');
    }
    for(const [id,k] of s.activations){let old=this.activations.get(id);
      if(!old){old={...structuredClone(k),end:null};this.activations.set(id,old);additions.push({type:'K_START',due:k.start,id});}
      if(k.end!==null&&old.end===null){old.end=k.end;additions.push({type:'K_END',due:min(k.end,H_END),id});}
      else requireThat(old.end===k.end,'INDEX_K_END_REWRITE');
    }
    // Observing both an old END and a replacement START for the same Root
    // means at least two business transitions were skipped. Their tied order
    // cannot be recovered from final intervals; reject before queuing anything.
    const ended=new Set(additions.filter(e=>e.type==='END').map(e=>e.instance));
    requireThat(!additions.some(e=>e.type==='START'&&ended.has(e.instance)),'INDEX_REQUIRES_EVENT_HISTORY');
    const priority={START:0,K_END:1,END:2,K_START:3};
    additions.sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:priority[a.type]-priority[b.type]);
    for(const e of additions){requireThat(e.due>=this.nextHour&&(!this.events.length||e.due>=this.events.at(-1).due),'INDEX_EVENT_ORDER');this.events.push(Object.freeze({...e,seq:this.events.length}));}
  }
  #apply(e){
    if(e.type==='START'){
      const n=this.nodes.get(e.instance),p=this.positions.get(e.id);requireThat(!n.active&&p.start===e.due,'INDEX_START');
      n.active=true;n.position=e.id;n.prev=this.tail;n.next=null;
      if(this.tail!==null){const tail=this.nodes.get(this.tail);requireThat(tail.active&&tail.next===null,'INDEX_TAIL');tail.next=e.instance;}else requireThat(this.head===null&&this.count===0n,'INDEX_EMPTY');
      this.head??=e.instance;this.tail=e.instance;this.count++;this.weight+=p.weight;
    }else if(e.type==='END'){
      const n=this.nodes.get(e.instance),p=this.positions.get(e.id);requireThat(n.active&&n.position===e.id&&p.end!==null&&min(p.end,H_END)===e.due,'INDEX_END');
      if(n.prev===null){requireThat(this.head===e.instance,'INDEX_HEAD');this.head=n.next;}else{const prev=this.nodes.get(n.prev);requireThat(prev.active&&prev.next===e.instance,'INDEX_PREV');prev.next=n.next;}
      if(n.next===null){requireThat(this.tail===e.instance,'INDEX_TAIL');this.tail=n.prev;}else{const next=this.nodes.get(n.next);requireThat(next.active&&next.prev===e.instance,'INDEX_NEXT');next.prev=n.prev;}
      n.active=false;n.position=null;n.prev=null;n.next=null;this.count--;this.weight-=p.weight;
    }else if(e.type==='K_START'){
      requireThat(this.k===null,'INDEX_K_OVERLAP');this.k=e.id;
    }else{requireThat(this.k===e.id,'INDEX_K_END');this.k=null;}
    this.work.events++;
  }
  /** Trusted-state differential counterpart to native EMPTY_SKIP. The caller
   * obtains Clock/rewardStart from the runtime/config, never an RPC absence
   * claim. This index returns the exact ledger delta; it cannot mint/pay LAB. */
  skipEmpty({expectedNextHour,targetExclusive,now,rewardStart}){
    u64(expectedNextHour,'expectedNextHour');u64(targetExclusive,'targetExclusive');time(now);time(rewardStart);
    requireThat(now>=this.highWater,'INDEX_CLOCK_ROLLBACK');
    const from=this.nextHour,to=targetExclusive;
    requireThat(expectedNextHour===from&&from<to&&to<=completedHours(now,rewardStart),'INDEX_EMPTY_RANGE');
    requireThat(this.count===0n&&this.weight===0n&&this.head===null&&this.tail===null&&this.k===null,'INDEX_NOT_EMPTY');
    requireThat(!this.hours.has(from),'INDEX_EMPTY_HOUR_OPEN');
    requireThat(Number.isInteger(this.eventCursor)&&this.eventCursor>=0&&this.eventCursor<=this.events.length,'INDEX_CHECKPOINT_CURSOR');
    const frontier=this.events[this.eventCursor];
    if(frontier)requireThat(frontier.seq===this.eventCursor&&frontier.due>=to,'INDEX_PENDING_EVENT');
    const sealedAtoms=emissionPrefix(to)-emissionPrefix(from);
    this.nextHour=to;this.highWater=now;
    return {from,to,sealedAtoms};
  }
  freeze(h){
    const before=this.snapshot();
    try{return this.#freeze(h);}catch(error){Object.assign(this,before);throw error;}
  }
  #freeze(h){
    requireThat(h===this.nextHour&&h<H_END,'INDEX_HOUR_ORDER');
    while(this.eventCursor<this.events.length&&this.events[this.eventCursor].due<=h){this.#apply(this.events[this.eventCursor++]);}
    const k=this.k===null?null:this.activations.get(this.k);
    if(k){const n=this.nodes.get(k.instance);requireThat(n?.active&&n.position===k.intervalId&&this.positions.get(n.position).beneficiary===k.beneficiary,'INDEX_K_ORDINARY');}
    const total=this.weight+(k?K_WEIGHT:0n),D=denominator(total),budget=hourBudget(h);
    const result={h,budget,count:this.count,weight:this.weight,totalWeight:total,denominator:D,
      amounts:new Map(),allocated:0n,residual:0n,k:this.k,status:'READY'};
    this.hours.set(h,result);this.nextHour=h+1n;return structuredClone(result);
  }
  /** Allocate one real historical Position; no reliance on current node links. */
  materialize(h,id,expectedCount){
    u64(h);u64(expectedCount);
    const record=this.hours.get(h);
    requireThat(record&&h<this.nextHour&&record.status==='READY','INDEX_HOUR_PHASE');
    requireThat(BigInt(record.amounts.size)===expectedCount,'INDEX_MATERIALIZE_CAS');
    if(record.count===0n)requireThat(id===null&&expectedCount===0n,'INDEX_EMPTY_MEMBER');
    else{
      const p=this.positions.get(id);
      requireThat(p&&p.start<=h&&h<min(p.end??H_END,H_END)&&p.nextUnsettledHour===h
        &&!record.amounts.has(id),'INDEX_MEMBER');
      // Root coverage remains ordered even if it already has a newer stake.
      for(const previous of this.positions.values())if(previous.instance===p.instance&&previous.seq<p.seq)
        requireThat(previous.nextUnsettledHour===min(previous.end??H_END,H_END),'INDEX_COVERAGE');
      const k=record.k===null?null:this.activations.get(record.k);
      if(k?.instance===p.instance)requireThat(k.intervalId===id&&k.beneficiary===p.beneficiary,'INDEX_K_ORDINARY');
      const amount=rewardAmount(record.budget,p.weight+(k?.instance===p.instance?K_WEIGHT:0n),record.denominator);
      requireThat(record.allocated+amount<=record.budget&&expectedCount<record.count,'INDEX_COMPLETE');
      p.accrued+=amount;p.nextUnsettledHour=h+1n;record.amounts.set(id,amount);record.allocated+=amount;this.work.roots++;
    }
    if(BigInt(record.amounts.size)===record.count){record.residual=record.budget-record.allocated;record.status='FINAL';}
    return structuredClone(record);
  }
  settle(h){
    this.freeze(h);
    // Convenience complete path used by the original differential tests.
    // The freeze frontier itself no longer requires these per-root writes.
    let at=this.head,previous=null,count=0n;
    while(at!==null){const n=this.nodes.get(at);requireThat(n.active&&n.prev===previous,'INDEX_MEMBER');
      this.materialize(h,n.position,count++);previous=at;at=n.next;requireThat(count<=this.count,'INDEX_CYCLE');}
    requireThat(count===this.count&&previous===this.tail,'INDEX_COMPLETE');
    if(count===0n)this.materialize(h,null,0n);
    return structuredClone(this.hours.get(h));
  }
}
