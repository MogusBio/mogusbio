import {performance} from 'node:perf_hooks';
import {asBytes} from '../../protocol-core/src/index.mjs';
import {ReadOnlyRpc} from './rpc.mjs';
import {PROGRAMS} from './release.mjs';
import {nativePda,nativeKeyBytes,nativeKeyAddress} from './native.mjs';
import {decodeNativeBaseConfig,decodeNativeProject,decodeNativeRoot,decodeNativeSource,decodeNativePosition,decodeNativeDirectory,decodeClassicMint,decodeClassicTokenAccount} from './accounts.mjs';
import {decodeNativeEconomyConfig,decodeNativeClock,decodeNativeRootRegistration} from './economy-accounts.mjs';
import {DiscoveryRpc} from './discovery-rpc.mjs';
import {DiscoveryStore} from './discovery-store.mjs';
import {DISCOVERY_SECTIONS,DISCOVERY_LIMITS as L,validateDiscoveryRequest,discoveryBinding,sameBinding,requireDiscovery as check,failure,publicIssue,sublanes,completeScan,splitPrefix,advancePrefix,matchProject,observe,responseFor,freshTraversal} from './discovery-core.mjs';

export {DiscoveryRpc,DiscoveryStore,DISCOVERY_SECTIONS,validateDiscoveryRequest};
const clone=v=>JSON.parse(JSON.stringify(v));
const pda=(r,...seeds)=>nativePda(r.input.programId,'bio',...seeds).then(p=>p.address);
const le=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const absent=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const zero=b=>b.every(x=>x===0);
const equal=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&a.lamports===b.lamports&&a.rentEpoch===b.rentEpoch&&asBytes(a.data).equals(asBytes(b.data));
class Budget{
  constructor(){this.start=performance.now();this.scans=0;this.reads=0;this.cancelled=false;}
  check(){check(!this.cancelled&&performance.now()-this.start<L.pageDeadlineMs,'DISCOVERY_DEADLINE');}
  scanTime(){return !this.cancelled&&this.scans<L.scanCalls&&performance.now()-this.start<L.scanDeadlineMs;}
  async wait(work,code){
    this.check();const ms=Math.min(L.rpcTimeoutMs,Math.floor(L.pageDeadlineMs-(performance.now()-this.start)));check(ms>0,'DISCOVERY_DEADLINE');let timer;
    try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(code)),ms);})]);}
    catch(error){throw failure(publicIssue(error,code));}finally{clearTimeout(timer);}
  }
}
async function wrapped(work,code){try{return await work();}catch(error){throw failure(publicIssue(error,code));}}
async function commonKeys(release){return {Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar};}
async function readBatch(rpc,keys,scan,budget){
  budget.check();check(budget.reads<L.factCalls,'DISCOVERY_DEADLINE');budget.reads++;const addresses=[...new Set(Object.values(keys))];check(addresses.length>=1&&addresses.length<=100);
  const min=BigInt(scan.maxSlot??'0')>rpc.contextSlot?BigInt(scan.maxSlot??'0'):rpc.contextSlot;
  const out=await budget.wait(()=>rpc.getMultipleAccounts(addresses,{minContextSlot:min}),'DISCOVERY_RPC_UNAVAILABLE');observe(scan,out.contextSlot);
  return {slot:out.contextSlot,accounts:new Map(addresses.map((key,i)=>[key,out.accounts[i]]))};
}
async function commonFacts(release,read,keys){return wrapped(async()=>{
  const get=name=>read.accounts.get(keys[name]);await decodeNativeBaseConfig(release,get('Base'));const economy=await decodeNativeEconomyConfig(release,get('Economy')),clock=decodeNativeClock(get('Clock'));
  check(clock.unixTimestamp>=economy.initializedAt&&clock.slot<=read.slot,'DISCOVERY_BASE_MISMATCH');return {economy,clock};
},'DISCOVERY_BASE_MISMATCH');}
function forward(a,b){check(b.clock.slot>=a.clock.slot&&b.clock.unixTimestamp>=a.clock.unixTimestamp,'DISCOVERY_RECORD_CHANGED');}
function stable(first,last,keys){check(Object.entries(keys).every(([name,address])=>name==='Clock'||equal(first.accounts.get(address),last.accounts.get(address))),'DISCOVERY_RECORD_CHANGED');}
function projectRow(p,candidate,mints,slot){return {type:'PROJECT',projectIdHex:candidate.idHex,address:candidate.address,name:p.name,creator:nativeKeyAddress(p.creator),seller:nativeKeyAddress(p.saleRecipient),createdAt:String(p.createdAt),createdSlot:String(p.createdSlot),classes:p.classes.map((c,i)=>({class:c.class,mint:nativeKeyAddress(c.mint),cap:String(c.lifetimeCap),unitPriceLamports:String(c.priceLamports),issued:String(c.issued),intakeBurned:String(c.intakeBurned),supply:String(mints[i].supply)})),recordVerified:true,observedSlot:String(slot)};}
async function projectRecords({release,rpc,request,scan,budget,candidates}){
  const keys=await commonKeys(release);for(const c of candidates)keys[`Project:${c.idHex}`]=c.address;
  const first=await readBatch(rpc,keys,scan,budget),a=await commonFacts(release,first,keys),parsed=[];
  await wrapped(async()=>{for(const candidate of candidates){const p=await decodeNativeProject(release,first.accounts.get(candidate.address),Buffer.from(candidate.idHex,'hex'));
    check(p.createdAt>=a.economy.initializedAt&&p.createdAt<=a.clock.unixTimestamp&&p.createdSlot<=a.clock.slot,'DISCOVERY_RECORD_INVALID');
    if(request.section==='my-projects')check(nativeKeyAddress(p.creator)===request.actor,'DISCOVERY_RECORD_CHANGED');const classes=[];
    for(let i=1;i<=4;i++){const mint=await pda(release,'pack',Buffer.from(candidate.idHex,'hex'),Buffer.from([i])),authority=await pda(release,'pack-auth',Buffer.from(candidate.idHex,'hex'),Buffer.from([i]));const x={mint,authority};classes.push(x);keys[`Mint:${candidate.idHex}:${i}`]=mint;
      if(request.section==='material-atas'){x.ata=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(request.actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address;keys[`ATA:${candidate.idHex}:${i}`]=x.ata;}
    }
    parsed.push({candidate,p,classes});
  }},'DISCOVERY_RECORD_INVALID');
  if(candidates.length===0)return [];
  const middle=await readBatch(rpc,keys,scan,budget),b=await commonFacts(release,middle,keys);forward(a,b);stable(first,middle,Object.fromEntries(Object.entries(keys).filter(([,address])=>first.accounts.has(address))));
  const last=await readBatch(rpc,keys,scan,budget),c=await commonFacts(release,last,keys);forward(b,c);stable(middle,last,keys);
  return wrapped(async()=>{
    const rows=[];for(const {candidate,classes}of parsed){const p=await decodeNativeProject(release,last.accounts.get(candidate.address),Buffer.from(candidate.idHex,'hex'));
      check(p.createdAt>=c.economy.initializedAt&&p.createdAt<=c.clock.unixTimestamp&&p.createdSlot<=c.clock.slot,'DISCOVERY_RECORD_INVALID');const mints=classes.map((x,i)=>{const m=decodeClassicMint(last.accounts.get(x.mint),{expectedAddress:x.mint,expectedDecimals:0,expectedMintAuthority:x.authority,expectedFreezeAuthority:null});check(m.supply<=p.classes[i].issued-p.classes[i].intakeBurned,'DISCOVERY_RECORD_INVALID');return m;});
      if(request.section==='material-atas'){
        for(let i=0;i<4;i++){const x=classes[i],info=last.accounts.get(x.ata);if(absent(info))continue;const token=decodeClassicTokenAccount(info,{expectedAddress:x.ata,expectedOwner:request.actor,expectedMint:x.mint});check(token.amount<=mints[i].supply,'DISCOVERY_RECORD_INVALID');
          if(token.amount>0n)rows.push({type:'MATERIAL_ATA',projectIdHex:candidate.idHex,class:i+1,mint:x.mint,address:x.ata,owner:request.actor,amount:String(token.amount),manufactureIncluded:false,recordVerified:true,observedSlot:String(last.slot)});
        }
      }else if(matchProject(p,candidate.idHex,request.query))rows.push(projectRow(p,candidate,mints,last.slot));
    }return rows;
  },'DISCOVERY_RECORD_INVALID');
}
function rootTime(root,account,facts){
  check(root.createdAt>=facts.economy.initializedAt&&root.createdAt<=facts.clock.unixTimestamp&&root.createdSlot<=facts.clock.slot,'DISCOVERY_RECORD_INVALID');
  if(root.lifecycle===1){const d=asBytes(account.data);check(d.readBigInt64LE(427)<=facts.clock.unixTimestamp&&d.readBigUInt64LE(435)<=facts.clock.slot,'DISCOVERY_RECORD_INVALID');}
}
async function registration(release,read,keys,id,facts){
  const info=read.accounts.get(keys[`Reg:${id}`]);if(absent(info))return null;const rr=await decodeNativeRootRegistration(release,info,Buffer.from(id,'hex'));
  if(rr.revocationCause!==0)check(rr.revocationTime<=facts.clock.unixTimestamp&&rr.revocationSlot<=facts.clock.slot,'DISCOVERY_RECORD_INVALID');return rr;
}
async function directory(release,read,keys,id,rr){
  if(!rr||rr.ordinaryCount===0n)return null;const d=await decodeNativeDirectory(release,read.accounts.get(keys[`Directory:${id}`]),rr.directorySequence);check(d.instance.toString('hex')===id,'DISCOVERY_RECORD_INVALID');
  if(d.active)check(d.currentSequence<rr.ordinaryCount,'DISCOVERY_RECORD_INVALID');return d;
}
async function walletRecords({release,rpc,request,scan,budget,candidates}){
  const keys=await commonKeys(release);for(const c of candidates){keys[`Candidate:${c.address}`]=c.address;if(request.section==='roots')keys[`Reg:${c.idHex}`]=await pda(release,'root-reg',Buffer.from(c.idHex,'hex'));}
  const first=await readBatch(rpc,keys,scan,budget),a=await commonFacts(release,first,keys);if(candidates.length===0)return [];
  const parsed=[];
  await wrapped(async()=>{
    for(const candidate of candidates){
      const info=first.accounts.get(candidate.address);check(!absent(info),'DISCOVERY_RECORD_CHANGED');
      if(request.section==='sources'){
        const value=await decodeNativeSource(release,info,Buffer.from(candidate.idHex,'hex'));check(value.inventoryOwner.equals(nativeKeyBytes(request.actor)),'DISCOVERY_RECORD_CHANGED');
        check(value.createdAt<=a.clock.unixTimestamp&&value.createdSlot<=a.clock.slot,'DISCOVERY_RECORD_INVALID');const project=value.projectId.toString('hex');keys[`Project:${project}`]=await pda(release,'project',value.projectId);keys[`Mint:${candidate.idHex}`]=nativeKeyAddress(value.mint);
        const authority=await pda(release,'pack-auth',value.projectId,Buffer.from([value.class]));parsed.push({candidate,value,project,authority});
      }else if(request.section==='roots'){
        const value=await decodeNativeRoot(release,info,Buffer.from(candidate.idHex,'hex'));rootTime(value,info,a);check(value.owner===request.actor&&value.lifecycle===0,'DISCOVERY_RECORD_CHANGED');check(value.schema===candidate.lane,'DISCOVERY_RECORD_INVALID');
        const rr=await registration(release,first,keys,candidate.idHex,a);if(rr&&rr.ordinaryCount>0n)keys[`Directory:${candidate.idHex}`]=await pda(release,'mining-root',le(rr.directorySequence));parsed.push({candidate,value});
      }else if(request.section==='positions'){
        const raw=asBytes(info.data);check(raw.length===375,'DISCOVERY_RECORD_INVALID');const id=Buffer.from(raw.subarray(120,152)),seq=raw.readBigUInt64LE(152),value=await decodeNativePosition(release,info,id,seq);check(value.beneficiaryAddress===request.actor,'DISCOVERY_RECORD_CHANGED');const instance=id.toString('hex');
        keys[`Root:${instance}`]=await pda(release,'root',id);keys[`Reg:${instance}`]=await pda(release,'root-reg',id);keys[`Directory:${instance}`]=await pda(release,'mining-root',le(value.rootDirectorySeq));parsed.push({candidate,value,instance,seq});
      }else if(request.section==='token-owner-hints'){
        const value=decodeClassicTokenAccount(info,{expectedAddress:candidate.address,expectedOwner:request.actor,expectedMint:Buffer.from(candidate.idHex,'hex')});keys[`Mint:${candidate.idHex}`]=value.mint;parsed.push({candidate,value});
      }else throw failure('DISCOVERY_INTERNAL');
    }
  },'DISCOVERY_RECORD_INVALID');
  const middle=await readBatch(rpc,keys,scan,budget),b=await commonFacts(release,middle,keys);forward(a,b);stable(first,middle,Object.fromEntries(Object.entries(keys).filter(([,address])=>first.accounts.has(address))));
  const last=await readBatch(rpc,keys,scan,budget),c=await commonFacts(release,last,keys);forward(b,c);stable(middle,last,keys);
  return wrapped(async()=>{
    const rows=[],selectedSourceUnits=new Map(),selectedTokenAmounts=new Map();
    for(const row of parsed){const {candidate}=row,info=last.accounts.get(candidate.address),base={recordVerified:true,observedSlot:String(last.slot)};
      if(request.section==='sources'){
        const v=await decodeNativeSource(release,info,Buffer.from(candidate.idHex,'hex'));check(v.inventoryOwner.equals(nativeKeyBytes(request.actor)),'DISCOVERY_RECORD_CHANGED');const project=await decodeNativeProject(release,last.accounts.get(keys[`Project:${row.project}`]),v.projectId),cl=project.classes[v.class-1];
        check(project.createdAt>=c.economy.initializedAt&&project.createdAt<=v.createdAt&&project.createdSlot<=v.createdSlot&&v.createdAt<=c.clock.unixTimestamp&&v.createdSlot<=c.clock.slot&&v.mint.equals(cl.mint),'DISCOVERY_RECORD_INVALID');
        const mint=decodeClassicMint(last.accounts.get(keys[`Mint:${candidate.idHex}`]),{expectedAddress:nativeKeyAddress(v.mint),expectedDecimals:0,expectedMintAuthority:row.authority,expectedFreezeAuthority:null});check(mint.supply<=cl.issued-cl.intakeBurned,'DISCOVERY_RECORD_INVALID');
        const pair=`${row.project}/${v.class}`,sum=(selectedSourceUnits.get(pair)??0n)+v.unitCount;selectedSourceUnits.set(pair,sum);check(sum<=cl.intakeBurned,'DISCOVERY_RECORD_INVALID');
        rows.push({type:'SOURCE',sourceIdHex:candidate.idHex,address:candidate.address,owner:request.actor,projectIdHex:row.project,class:v.class,mint:nativeKeyAddress(v.mint),unitCount:String(v.unitCount),initialTick:v.initialTick.map(String),spentPrefix:v.spentPrefix.map(String),remainingTick:v.remainingTick.map(String),createdAt:String(v.createdAt),createdSlot:String(v.createdSlot),...base});
      }else if(request.section==='roots'){
        const v=await decodeNativeRoot(release,info,Buffer.from(candidate.idHex,'hex'));rootTime(v,info,c);check(v.owner===request.actor&&v.lifecycle===0,'DISCOVERY_RECORD_CHANGED');check(v.schema===candidate.lane,'DISCOVERY_RECORD_INVALID');const rr=await registration(release,last,keys,candidate.idHex,c);await directory(release,last,keys,candidate.idHex,rr);
        rows.push({type:'ROOT',instanceHex:candidate.idHex,address:candidate.address,owner:v.owner,descriptorHex:v.descriptor.toString('hex'),target:v.target,qualityPpm:String(v.qualityPpm),B:String(v.B),retired:String(v.retired),revision:String(v.revision),lifecycle:'LIVE',parentInstanceHex:zero(v.parent)?null:v.parent.toString('hex'),registration:rr?{exists:true,ordinaryCount:String(rr.ordinaryCount),directorySequence:rr.directorySequence===(1n<<64n)-1n?null:String(rr.directorySequence),certificateFault:rr.certificateFault}:{exists:false,ordinaryCount:'0',directorySequence:null,certificateFault:false},...base});
      }else if(request.section==='positions'){
        const v=await decodeNativePosition(release,info,Buffer.from(row.instance,'hex'),row.seq),rootInfo=last.accounts.get(keys[`Root:${row.instance}`]),root=await decodeNativeRoot(release,rootInfo,Buffer.from(row.instance,'hex'));rootTime(root,rootInfo,c);const rr=await registration(release,last,keys,row.instance,c);check(rr&&v.rootSeq<rr.ordinaryCount&&v.rootDirectorySeq===rr.directorySequence,'DISCOVERY_RECORD_INVALID');await directory(release,last,keys,row.instance,rr);
        check(v.beneficiaryAddress===request.actor,'DISCOVERY_RECORD_CHANGED');check(v.positionId.toString('hex')===candidate.idHex&&v.rootRevision<=root.revision&&v.createdTime>=root.createdAt&&v.createdSlot>=root.createdSlot&&v.createdTime<=c.clock.unixTimestamp&&v.createdSlot<=c.clock.slot&&v.endedTime<=c.clock.unixTimestamp&&v.endedSlot<=c.clock.slot,'DISCOVERY_RECORD_INVALID');
        check(v.B_int===root.B&&BigInt(v.q_ppm)===root.qualityPpm&&v.L_quarters===({1:4,2:6,3:10,4:12})[root.schema],'DISCOVERY_RECORD_INVALID');
        if(v.rootSeq===rr.ordinaryCount-1n)check(v.positionId.equals(rr.lastPositionId)&&v.end===rr.ordinaryEnd,'DISCOVERY_RECORD_INVALID');
        else check(v.end!==null,'DISCOVERY_RECORD_INVALID');
        if(v.end===null)check(root.lifecycle===0&&v.rootRevision===root.revision,'DISCOVERY_RECORD_INVALID');
        rows.push({type:'POSITION',positionIdHex:candidate.idHex,address:candidate.address,instanceHex:row.instance,positionSeq:String(row.seq),beneficiary:v.beneficiaryAddress,start:String(v.start),end:v.end===null?null:String(v.end),accrued:String(v.accrued),paid:String(v.paid),nextUnsettledHour:String(v.nextUnsettledHour),rootOwner:root.owner,rootLifecycle:root.lifecycle===0?'LIVE':'CONSUMED',...base});
      }else{
        const v=decodeClassicTokenAccount(info,{expectedAddress:candidate.address,expectedOwner:request.actor,expectedMint:Buffer.from(candidate.idHex,'hex')}),lab=v.mint===release.pdas.labMint.address;
        const mint=decodeClassicMint(last.accounts.get(keys[`Mint:${candidate.idHex}`]),{expectedAddress:v.mint,...(lab?{expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null}:{})}),sum=(selectedTokenAmounts.get(v.mint)??0n)+v.amount;selectedTokenAmounts.set(v.mint,sum);check(sum<=mint.supply,'DISCOVERY_RECORD_INVALID');
        const ata=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(request.actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(v.mint))).address;
        rows.push({type:'CLASSIC_TOKEN_HINT',address:candidate.address,mint:v.mint,owner:request.actor,amount:String(v.amount),isStandardAta:candidate.address===ata,protocolMatch:lab?'LAB':'UNRESOLVED',manufactureIncluded:false,...base});
      }
    }
    return rows;
  },'DISCOVERY_RECORD_INVALID');
}
async function enumerate({rpc,discoveryRpc,request,scan,budget}){
  while(scan.pending.length===0&&!completeScan(scan)&&budget.scanTime()){
    const t=scan.traversal;budget.scans++;const out=request.section==='token-owner-hints'?await discoveryRpc.scanTokenOwner({actor:request.actor,minContextSlot:BigInt(scan.maxSlot??'0'),timeoutMs:L.rpcTimeoutMs}):await discoveryRpc.scanPartition({section:request.section,actor:request.actor,lane:sublanes(request.section)[t.lane],prefixHex:t.prefix,minContextSlot:BigInt(scan.maxSlot??'0'),timeoutMs:L.rpcTimeoutMs});
    if(out.contextSlot!==null)observe(scan,out.contextSlot);
    if(out.overflow){if(request.section==='token-owner-hints'){scan.tokenOverflow=true;t.lane=1;break;}splitPrefix(scan);continue;}
    scan.pending=out.candidates.map(c=>({...c,lane:sublanes(request.section)[t.lane]}));scan.visited=String(BigInt(scan.visited)+1n);advancePrefix(scan);
  }
}
function emptyScan(request){return {actor:request.actor,section:request.section,cursor:null,traversal:{...freshTraversal(),lane:sublanes(request.section).length},pending:[],minSlot:null,maxSlot:null,visited:'0',changed:0,tokenOverflow:false};}

/** Actual chain discovery candidates, followed by strict bounded state reads.
 * Cache files hold only traversal hints; no transaction session is created. */
export async function readDiscoveryPage({release,rpc,discoveryRpc,store,actor,section,cursor=null,query=''}){
  const request=validateDiscoveryRequest({actor,section,cursor,query}),budget=new Budget();check(rpc instanceof ReadOnlyRpc&&discoveryRpc instanceof DiscoveryRpc&&store instanceof DiscoveryStore,'DISCOVERY_INTERNAL');
  const binding=discoveryBinding(release,rpc.endpoint);check(rpc.endpoint===discoveryRpc.endpoint&&sameBinding(binding,discoveryRpc.binding)&&discoveryRpc.matches(release),'DISCOVERY_BASE_MISMATCH');
  let timer;
  const work=async()=>store.run({binding,request,budget},async original=>{
    const scan=clone(original);
    try{
      await budget.wait(()=>discoveryRpc.bindReader(rpc),'DISCOVERY_GENESIS_MISMATCH');await enumerate({rpc,discoveryRpc,request,scan,budget});
      const candidates=scan.pending.slice(0,request.section==='material-atas'?2:L.rows),args={release,rpc,request,scan,budget,candidates};
      const rows=['projects','my-projects','material-atas'].includes(request.section)?await projectRecords(args):await walletRecords(args);scan.pending.splice(0,candidates.length);
      if(scan.tokenOverflow)return {scan,response:responseFor(binding,request,scan,{decision:'DISCOVERY_BLOCKED',state:'OVERFLOW',issue:'DISCOVERY_TOKEN_OWNER_OVERFLOW'})};
      return {scan,response:responseFor(binding,request,scan,{rows})};
    }catch(error){const issue=publicIssue(error);return {scan:original,response:responseFor(binding,request,original,{decision:'DISCOVERY_BLOCKED',issue,state:issue==='DISCOVERY_RECORD_CHANGED'?'CHANGED':'UNAVAILABLE'})};}
  });
  try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{budget.cancelled=true;reject(failure('DISCOVERY_DEADLINE'));},L.pageDeadlineMs);})]);}
  catch(error){const code=publicIssue(error),restart=code==='DISCOVERY_CURSOR_INVALID'||code==='DISCOVERY_CURSOR_EXPIRED';return responseFor(binding,request,emptyScan(request),{decision:restart?'DISCOVERY_RESTART_REQUIRED':'DISCOVERY_BLOCKED',issue:code,state:restart?'CHANGED':'UNAVAILABLE'});}
  finally{clearTimeout(timer);}
}
