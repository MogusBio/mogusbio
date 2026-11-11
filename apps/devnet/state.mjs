import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isOffCurveAddress} from '@solana/kit';
import {isDevnetRelease,DEVNET_GENESIS_BASE58} from '../../packages/client/src/cluster.mjs';
import {ReadOnlyRpc} from '../../packages/client/src/rpc.mjs';
import {PROGRAMS,baseConfigR2Id} from '../../packages/client/src/release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda} from '../../packages/client/src/native.mjs';
import {decodeClassicMint,decodeClassicTokenAccount} from '../../packages/client/src/accounts.mjs';
import {normalWeight} from '../../packages/settlement/src/weights.mjs';
import {TOTAL_SUPPLY} from '../../packages/settlement/src/emission.mjs';
import {readDevnetAppearances} from './appearance.mjs';

const U64=(1n<<64n)-1n,MAX_ROWS=1024,MAX_PAGES=16,DEADLINE_MS=22000,PAGE_TIMEOUT_MS=19000;
const SECTIONS=['projects','roots','sources','positions','material-atas'],stores=new WeakMap();
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});},copy=v=>structuredClone(v),hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),dec=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=20&&BigInt(v)<=U64;
const safeCode=e=>typeof e?.code==='string'&&/^(?:DEVNET|DISCOVERY|RPC|TOKEN|ACCOUNT|ROOT)_[A-Z0-9_]{1,70}$/.test(e.code)?e.code:'DEVNET_STATE_READ_UNAVAILABLE';
const absent=a=>a===null||a?.owner===PROGRAMS.systemProgram&&!a.executable&&a.data?.length===0;
const code=c=>Object.assign(Error(c),{code:c});
const context=r=>({releaseHash:r.input.releaseHash,abiHash:r.input.abiHash,domainHex:Buffer.from(r.domain).toString('hex'),configHex:baseConfigR2Id(r).toString('hex')});
const scopeKey=(r,rpc,actor)=>JSON.stringify({...context(r),actor,endpointSHA:createHash('sha256').update(rpc.endpoint).digest('hex')});
const freshScan=()=>({sections:Object.fromEntries(SECTIONS.map(section=>[section,{rows:new Map(),cursor:null,coverage:null,pages:0,complete:false,started:false}])),running:null,touched:performance.now()});
function scopeStore(bridge,release,rpc,actor){let cache=stores.get(bridge);if(!cache){cache=new Map();stores.set(bridge,cache);}const key=scopeKey(release,rpc,actor);if(!cache.has(key)){if(cache.size>=64){const oldest=[...cache].filter(([,v])=>!v.running).sort((a,b)=>a[1].touched-b[1].touched)[0];check(oldest,'DEVNET_STATE_CACHE_LIMIT');cache.delete(oldest[0]);}cache.set(key,freshScan());}return{cache,key};}
export function clearDevnetStateCache({release,bridge,rpc,actor}){const cache=stores.get(bridge);if(cache)cache.delete(scopeKey(release,rpc,nativeKeyAddress(actor)));}
function rowKey(section,row){return section==='projects'?row.projectIdHex:section==='roots'?row.instanceHex:section==='sources'?row.sourceIdHex:section==='positions'?row.positionIdHex:row.address;}
function validateRow(section,row,actor){
 check(row&&typeof row==='object'&&!Array.isArray(row)&&row.recordVerified===true&&dec(row.observedSlot),'DEVNET_STATE_ROW_INVALID');const id=rowKey(section,row);check(section==='material-atas'?typeof id==='string'&&nativeKeyAddress(id)===id:hex(id),'DEVNET_STATE_ROW_INVALID');
 if(section==='projects'){check(row.type==='PROJECT'&&typeof row.name==='string'&&Buffer.byteLength(row.name)<=128&&Array.isArray(row.classes)&&row.classes.length===4,'DEVNET_STATE_PROJECT');nativeKeyAddress(row.creator);nativeKeyAddress(row.seller);for(const [i,c]of row.classes.entries()){check(c.class===i+1&&dec(c.cap)&&dec(c.issued)&&BigInt(c.issued)<=BigInt(c.cap)&&dec(c.unitPriceLamports),'DEVNET_STATE_PROJECT');nativeKeyAddress(c.mint);}}
 else if(section==='roots'){check(row.type==='ROOT'&&row.owner===actor&&row.lifecycle==='LIVE'&&/^[a-f0-9]{8}$/.test(row.descriptorHex)&&dec(row.qualityPpm)&&dec(row.B)&&dec(row.revision),'DEVNET_STATE_ROOT');const d=Buffer.from(row.descriptorHex,'hex');if(d.readUInt16LE(0)===1)check(row.target===null&&d[2]>=1&&d[2]<=4&&(d[2]===4?d[3]>=1&&d[3]<=15:d[3]===0),'DEVNET_STATE_ROOT');else check(Number.isInteger(row.target)&&row.target>=1&&row.target<=22&&d.equals(Buffer.from([row.target,row.target<=15?1:row.target<=21?2:3,row.target<=15?row.target:row.target<=21?row.target-15:0,0])),'DEVNET_STATE_ROOT');}
 else if(section==='sources'){check(row.type==='SOURCE'&&row.owner===actor&&hex(row.projectIdHex)&&Number.isInteger(row.class)&&row.class>=1&&row.class<=4&&dec(row.unitCount)&&Array.isArray(row.remainingTick)&&row.remainingTick.length===32&&row.remainingTick.every(dec),'DEVNET_STATE_SOURCE');}
 else if(section==='positions'){check(row.type==='POSITION'&&row.beneficiary===actor&&hex(row.instanceHex)&&dec(row.positionSeq)&&dec(row.start)&&(row.end===null||dec(row.end)&&BigInt(row.end)>=BigInt(row.start))&&dec(row.accrued)&&dec(row.paid)&&BigInt(row.paid)<=BigInt(row.accrued),'DEVNET_STATE_POSITION');}
 else check(row.type==='MATERIAL_ATA'&&row.owner===actor&&hex(row.projectIdHex)&&Number.isInteger(row.class)&&row.class>=1&&row.class<=4&&dec(row.amount)&&typeof row.mint==='string','DEVNET_STATE_MATERIAL');
 return copy(row);
}
function verifyPage(page,section,release,actor){check(page?.profile==='BIO-DISCOVERY1'&&page.actor===actor&&page.section===section&&Object.entries(context(release)).every(([k,v])=>page.context?.[k]===v)&&Array.isArray(page.rows)&&page.rows.length<=8&&page.coverage?.commitment==='finalized'&&typeof page.coverage.pending==='boolean'&&page.coverage.cryptographicComplete===false&&page.readFlags?.networkSubmitted===false&&page.readFlags.transactionExecuted===false&&page.readFlags.discoveryOnly===true,'DEVNET_STATE_DISCOVERY_BINDING');check(page.nextCursor===null||hex(page.nextCursor),'DEVNET_STATE_CURSOR');}
async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(code('DEVNET_STATE_READ_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
function boundResponse(result){
 const maximum=900000,bytes=()=>Buffer.byteLength(JSON.stringify(result));if(bytes()<=maximum)return result;
 result.partial=true;result.pagination.pending=true;result.responseWindowed=true;result.issues.push({section:'state',code:'DEVNET_STATE_RESPONSE_LIMIT'});
 for(const [section,key]of [['sources','sources'],['positions','positions'],['material-atas','materials'],['projects','projects'],['roots','works']]){
  const meta=result.pagination.sections[section];meta.responseRows=result[key].length;
  while(result[key].length&&bytes()>maximum){const removed=result[key].splice(Math.max(0,result[key].length-Math.max(1,Math.ceil(result[key].length/8))));meta.responseOmitted=(meta.responseOmitted??0)+removed.length;meta.responseRows=result[key].length;meta.traversalComplete??=meta.complete;meta.complete=false;meta.readRange='PARTIAL_RESPONSE';if(key==='works')for(const w of removed)delete result.appearances[w.id];}
  if(bytes()<=maximum)break;
 }
 if(result.pagination.sections['material-atas'].responseOmitted)result.rawMaterialBalances=[1,2,3,4].map(classId=>({class:classId,observedUnits:result.materials.filter(m=>m.class===classId).reduce((sum,m)=>sum+BigInt(m.amount),0n).toString(),complete:false}));
 check(bytes()<=maximum,'DEVNET_STATE_RESPONSE_LIMIT');return result;
}
function workRow(row){const d=Buffer.from(row.descriptorHex,'hex'),scope=d.readUInt16LE(0)===1?'COMPONENT':row.target<=15?'CELL':row.target<=21?'ORGAN':'BIO',q=BigInt(row.qualityPpm);return{id:row.instanceHex,address:row.address,scope,target:row.target,primitive:scope==='COMPONENT'?d[2]:null,profile:scope==='COMPONENT'?d[3]:null,owner:row.owner,qualityPpm:row.qualityPpm,quality:(Number(q)/1000000).toFixed(3),weight:normalWeight({scope,B_int:BigInt(row.B),q_ppm:q}).toString(),B:row.B,retired:row.retired,descriptor:row.descriptorHex,revision:row.revision,registration:copy(row.registration),recordVerified:true,observedSlot:row.observedSlot,actionEligibilityVerified:false,appearanceStatus:'MISSING',appearanceIssue:scope==='COMPONENT'?'ROOT_NOT_REREAD':'SEALED_LINEAGE_NOT_LOADED'};}
/** Bounded protocol-specific discovery, never a complete-wallet or transaction
 * eligibility claim. One actor's scans progress strictly in order, at most one
 * unfinished section at a time; concurrent calls share one read-only run. */
export async function readDevnetState({release,bridge,rpc,actor,getBalance}={}){
 check(isDevnetRelease(release),'DEVNET_STATE_RELEASE');check(bridge&&typeof bridge==='object'&&typeof bridge.dispatch==='function'&&rpc instanceof ReadOnlyRpc&&typeof getBalance==='function','DEVNET_STATE_RUNTIME');actor=nativeKeyAddress(actor);check(actor!==PROGRAMS.systemProgram&&!isOffCurveAddress(actor),'DEVNET_STATE_ACTOR');const{cache,key}=scopeStore(bridge,release,rpc,actor);let scan=cache.get(key);if(scan.running)return copy(await scan.running);if(SECTIONS.every(s=>scan.sections[s].complete)){scan=freshScan();cache.set(key,scan);}scan.touched=performance.now();
 const run=async()=>{
  const started=performance.now(),issues=[],wallet={solLamports:null,labAtoms:null,labMint:null,labBalanceScope:'PROTOCOL_STANDARD_ATA'},result={profile:'BIO-DEVNET-STATE1',chain:'solana:devnet',genesisHash:DEVNET_GENESIS_BASE58,actor,context:context(release),wallet,projects:[],works:[],sources:[],positions:[],materials:[],rawMaterialBalances:[],partial:true,issues,pagination:{sections:{},pending:true},readFlags:{networkSubmitted:false,transactionExecuted:false,discoveryOnly:true,actionEligibilityVerified:false,fullWallet:false,cryptographicComplete:false,consistency:'MULTI_SLOT_BEST_EFFORT'},appearances:{},appearanceGraphs:{}};
  const issue=(section,e)=>issues.push({section,code:safeCode(e)});
  try{await bounded(rpc.verifyGenesis(),Math.min(15000,DEADLINE_MS));}catch(error){issue('network',error);for(const section of SECTIONS)result.pagination.sections[section]={nextCursor:null,pages:0,complete:false,readRange:'NOT_STARTED',coverage:null};return result;}
  const balances=await Promise.allSettled([bounded(Promise.resolve().then(()=>getBalance(actor)),Math.max(1,Math.min(10000,DEADLINE_MS-(performance.now()-started)))),bounded((async()=>{const ata=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(release.pdas.labMint.address))).address,{accounts:[mintInfo,tokenInfo]}=await rpc.getMultipleAccounts([release.pdas.labMint.address,ata]);if(absent(mintInfo))throw code('DEVNET_STATE_LAB_UNINITIALIZED');const mint=decodeClassicMint(mintInfo,{expectedAddress:release.pdas.labMint.address,expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null});check(mint.supply<=TOTAL_SUPPLY,'DEVNET_STATE_LAB_SUPPLY');wallet.labMint=mint.address;if(absent(tokenInfo))return 0n;const token=decodeClassicTokenAccount(tokenInfo,{expectedAddress:ata,expectedMint:mint.address,expectedOwner:actor});check(token.amount<=mint.supply,'DEVNET_STATE_LAB_BALANCE');return token.amount;})(),Math.max(1,DEADLINE_MS-(performance.now()-started)))]);
  if(balances[0].status==='fulfilled'&&typeof balances[0].value==='bigint'&&balances[0].value>=0n&&balances[0].value<=U64)wallet.solLamports=balances[0].value.toString();else issue('sol',balances[0].status==='rejected'?balances[0].reason:code('DEVNET_STATE_SOL_BALANCE'));
  if(balances[1].status==='fulfilled')wallet.labAtoms=balances[1].value.toString();else issue('lab',balances[1].reason);
  let pages=0;
  for(const section of SECTIONS){const state=scan.sections[section];if(state.complete)continue;
   while(!state.complete&&pages<MAX_PAGES&&performance.now()-started<DEADLINE_MS){const prior=state.cursor;let page;try{page=await bounded(bridge.dispatch('discovery-read',{actor,section,cursor:prior,query:''}),Math.min(PAGE_TIMEOUT_MS,Math.max(1,DEADLINE_MS-(performance.now()-started))));pages++;verifyPage(page,section,release,actor);if(page.decision!=='DISCOVERY_PAGE'||page.issues?.length){state.coverage=copy(page.coverage);for(const entry of page.issues??[])issue(section,code(entry.code));if(!page.issues?.length)issue(section,code('DEVNET_STATE_DISCOVERY_BLOCKED'));break;}const rows=page.rows.map(row=>validateRow(section,row,actor)),count=SECTIONS.reduce((n,s)=>n+scan.sections[s].rows.size,0),add=rows.filter(row=>!state.rows.has(rowKey(section,row))).length;check(count+add<=MAX_ROWS,'DEVNET_STATE_ROW_LIMIT');if(page.coverage.pending)check(hex(page.nextCursor)&&page.nextCursor!==prior,'DEVNET_STATE_CURSOR_STALLED');else check(page.nextCursor===null&&page.coverage.state==='TRAVERSAL_EXHAUSTED','DEVNET_STATE_COVERAGE');for(const row of rows)state.rows.set(rowKey(section,row),row);state.cursor=page.nextCursor;state.coverage=copy(page.coverage);state.pages++;state.started=true;state.complete=!page.coverage.pending;}catch(error){issue(section,error);break;}}
   if(!state.complete)break;
  }
  for(const section of SECTIONS){const state=scan.sections[section];result.pagination.sections[section]={nextCursor:state.cursor,pages:state.pages,complete:state.complete,readRange:state.complete?'TRAVERSAL_EXHAUSTED':state.started?'PARTIAL_TRAVERSAL':'NOT_STARTED',coverage:copy(state.coverage)};}
  const rows=section=>[...scan.sections[section].rows.values()].map(copy);
  result.projects=rows('projects').map(row=>({...row,id:row.projectIdHex,isOwn:row.creator===actor,saleRecipient:row.seller,classes:row.classes.map(c=>({...c,lifetimeCap:c.cap,priceLamports:c.unitPriceLamports,remaining:(BigInt(c.cap)-BigInt(c.issued)).toString()}))}));
  for(const row of rows('roots'))try{result.works.push(workRow(row));}catch(error){issue('roots',error);}
  result.sources=rows('sources');result.positions=rows('positions').map(row=>({...row,id:row.positionIdHex,workId:row.instanceHex,unclaimedAtoms:(BigInt(row.accrued)-BigInt(row.paid)).toString()}));result.materials=rows('material-atas');result.rawMaterialBalances=[1,2,3,4].map(classId=>({class:classId,observedUnits:result.materials.filter(m=>m.class===classId).reduce((sum,m)=>sum+BigInt(m.amount),0n).toString(),complete:scan.sections['material-atas'].complete}));
  const remaining=Math.floor(DEADLINE_MS-(performance.now()-started));
  if(result.works.length&&remaining>0)try{
   const appearance=await readDevnetAppearances({release,rpc,works:result.works,deadlineMs:Math.min(15000,remaining)});result.appearances=appearance.appearances;result.appearanceGraphs=appearance.graphs;result.appearanceReadStats=appearance.readStats;
   for(const w of result.works){const status=appearance.statusById[w.id];if(status?.status==='VERIFIED'){w.appearanceRef=w.id;w.appearanceStatus='VERIFIED';delete w.appearanceIssue;}else{w.appearanceIssue=status?.issue??'DEVNET_APPEARANCE_NOT_READ';if(status?.stale){w.observationStale=true;w.recordVerified=false;issue('roots',code('DEVNET_STATE_ROOT_CHANGED'));}}}
  }catch(error){for(const w of result.works)w.appearanceIssue=safeCode(error);}
  result.appearancePartial=result.works.some(w=>w.appearanceStatus!=='VERIFIED');result.pagination.pending=!SECTIONS.every(s=>scan.sections[s].complete);result.partial=result.pagination.pending||wallet.solLamports===null||wallet.labAtoms===null||issues.length>0;return boundResponse(result);
 };
 scan.running=run();try{return copy(await scan.running);}finally{scan.running=null;scan.touched=performance.now();}
}
