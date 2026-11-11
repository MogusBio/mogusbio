import { isOffCurveAddress } from '@solana/kit';
import { asBytes, ByteWriter } from '../../protocol-core/src/index.mjs';
import { H_END, TOTAL_SUPPLY, completedHours, emissionPrefix } from '../../settlement/src/emission.mjs';
import { W_FLOOR, normalWeight, denominator } from '../../settlement/src/weights.mjs';
import { ReadOnlyRpc } from './rpc.mjs';
import { PROGRAMS } from './release.mjs';
import { nativeKeyAddress, nativeKeyBytes, nativePda, nativeOperation, decodeNativeFrame } from './native.mjs';
import { decodeNativeBaseConfig, decodeNativeRoot, decodeNativeRegistry, decodeNativeDirectory,
  decodeNativePosition, decodeNativeActivation, decodeNativeHour, decodeClassicMint, decodeClassicTokenAccount } from './accounts.mjs';
import { decodeNativeEconomyConfig, decodeNativeClock, decodeNativeRootRegistration,
  decodeNativeTreasury, validateNativeTreasuryBalances } from './economy-accounts.mjs';
import { decodeActorNonceSnapshot } from './journal.mjs';
import { planNextGlobalSettlement } from './keeper.mjs';
import { planFinalHourClosure } from './settlement-workflow.mjs';

const MAX=(1n<<64n)-1n;
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const hex=b=>Buffer.from(b).toString('hex'),le=n=>new ByteWriter(8).u64(n).finish();
const pda=(r,...s)=>nativePda(r.input.programId,'bio',...s).then(v=>v.address);
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&a.lamports===b.lamports&&asBytes(a.data).equals(asBytes(b.data));
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,reservesOnChainNonce:false,readStateVerified:true,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null};
const state=(decision,contextSlot,extra={})=>({decision,contextSlot,...flags,...extra});
const u64=(n,c)=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,c);return n;};
const boundary=(v)=>v.clock.unixTimestamp<v.economy.rewardStart?0n:(v.clock.unixTimestamp-v.economy.rewardStart)/3600n;
function exact(input,required,optional=[]){check(input&&Object.getPrototypeOf(input)===Object.prototype&&Reflect.ownKeys(input).every(k=>typeof k==='string'&&[...required,...optional].includes(k))&&required.every(k=>Object.hasOwn(input,k)),'MINING_FIELDS');check(input.rpc instanceof ReadOnlyRpc,'MINING_READ_ONLY_RPC');}
function actorValue(value){const a=nativeKeyAddress(value);check(a!==PROGRAMS.systemProgram&&!isOffCurveAddress(a),'MINING_ACTOR');return a;}
function wallet(a,actor){check(a&&a.address===actor&&a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0,'MINING_ACTOR_WALLET');}
async function coreKeys(release,actor){return {Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar,Nonce:await pda(release,'actor-nonce',nativeKeyBytes(actor)),Actor:actor,Registry:await pda(release,'mining'),LABMint:release.pdas.labMint.address,LABReserve:release.pdas.labReserve.address,Treasury:await pda(release,'treasury')};}
async function batch(rpc,keys){const addresses=[...new Set(Object.values(keys))];check(addresses.length>=1&&addresses.length<=100,'MINING_ACCOUNT_BOUND');const {contextSlot,accounts}=await rpc.getMultipleAccounts(addresses);return {contextSlot,accounts:new Map(addresses.map((a,i)=>[a,accounts[i]]))};}
async function core(release,actor,keys,read){
  const get=n=>read.accounts.get(keys[n]);await decodeNativeBaseConfig(release,get('Base'));const economy=await decodeNativeEconomyConfig(release,get('Economy')),clock=decodeNativeClock(get('Clock'));wallet(get('Actor'),actor);
  check(clock.unixTimestamp>=economy.initializedAt,'MINING_CLOCK_BEFORE_INIT');
  const nonce=await decodeActorNonceSnapshot({release,actor,address:keys.Nonce,account:get('Nonce'),contextSlot:read.contextSlot,commitment:'finalized'}),registry=fresh(get('Registry'))?null:await decodeNativeRegistry(release,get('Registry'));
  const mint=decodeClassicMint(get('LABMint'),{expectedAddress:keys.LABMint,expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null}),reserve=decodeClassicTokenAccount(get('LABReserve'),{expectedAddress:keys.LABReserve,expectedMint:keys.LABMint,expectedOwner:release.pdas.labAuthority.address,reserve:true}),treasury=await decodeNativeTreasury(release,get('Treasury'));
  const book=validateNativeTreasuryBalances(release,treasury,{mint,reserve}),maturedHours=completedHours(clock.unixTimestamp,economy.rewardStart);
  check(treasury.asOf<=maturedHours,'MINING_TREASURY_FUTURE');check(!registry||clock.unixTimestamp>=registry.highWater&&registry.nextHour<=maturedHours,'MINING_REGISTRY_CLOCK');
  return {economy,clock,nonce,registry,mint,reserve,treasury,book,maturedHours};
}
function drift(first,last,keys){
  const a=first.value,b=last.value;check(b.clock.slot>=a.clock.slot&&b.clock.unixTimestamp>=a.clock.unixTimestamp,'MINING_CLOCK_REGRESSION');check(b.nonce.nextNonce>=a.nonce.nextNonce,'MINING_NONCE_REGRESSION');
  if(boundary(a)!==boundary(b)||(a.clock.unixTimestamp<a.economy.rewardStart)!==(b.clock.unixTimestamp<b.economy.rewardStart))return 'CLOCK_BOUNDARY_CHANGED';
  for(const [name,address]of Object.entries(keys))if(name!=='Clock'&&!same(first.read.accounts.get(address),last.read.accounts.get(address)))return `${name.toUpperCase()}_CHANGED`;
  return null;
}
function overview(value,actor,contextSlot){
  const {registry:r,treasury:t,book:b,mint,reserve,maturedHours}=value,frontier=r?.nextHour??0n,total=(r?.normalWeight??0n)+(r?.kWeight??0n);
  return {actor,contextSlot:String(contextSlot),nextNonce:String(value.nonce.nextNonce),knownRootsOnly:true,walletDiscoveryComplete:false,futureDailyPayoutGuaranteed:false,
    clock:{slot:String(value.clock.slot),unixTimestamp:String(value.clock.unixTimestamp),currentBoundary:String(boundary(value))},
    emission:{totalSupplyAtoms:String(TOTAL_SUPPLY),totalSupplyLAB:'100000000',decimals:6,maturedHours:String(maturedHours),processedFrontier:String(frontier),backlogHours:String(maturedHours-frontier),scheduleEnded:maturedHours===H_END,emissionClosed:frontier===H_END&&(r?.eventCursor??0n)===(r?.eventCount??0n),endHour:String(H_END),scheduledDueAtoms:String(emissionPrefix(maturedHours)),notYetSynchronizedAtoms:String(emissionPrefix(maturedHours)-emissionPrefix(t.asOf))},
    processedWeights:{asOfHour:String(frontier),meaning:'PROCESSED_REGISTRY_FRONTIER',currentWallClockDenominatorGuaranteed:false,registryInitialized:r!==null,rootCount:String(r?.rootCount??0n),activeDirectoryCount:String(r?.activeCount??0n),normalWeight:String(r?.normalWeight??0n),kWeight:String(r?.kWeight??0n),combinedWeight:String(total),denominator:String(denominator(total)),denominatorFloor:String(W_FLOOR),sharedFloorApplications:1,eventCount:String(r?.eventCount??0n),eventCursor:String(r?.eventCursor??0n)},
    treasury:{asOfHour:String(t.asOf),lockedAtoms:String(t.locked),pendingAtoms:String(t.pending),certifiedAtoms:String(t.certified),sealedAtoms:String(t.sealed),manufactureBurnedAtoms:String(t.burned),paidAtoms:String(t.paid),bookSumAtoms:String(t.bookSum),mintSupplyAtoms:String(mint.supply),reserveAtoms:String(reserve.amount),circulatingOutsideReserveAtoms:String(mint.supply-reserve.amount),unsolicitedReserveAtoms:String(b.inboundSealed),externalBurnedAtoms:String(TOTAL_SUPPLY-t.burned-mint.supply),donationsCreateRewards:false,externalBurnsCreateRewards:false}};
}
async function roots(release,ids,keys,read){
  const out=[];for(const id of ids){const h=hex(id),root=await decodeNativeRoot(release,read.accounts.get(keys[`Root:${h}`]),id),info=read.accounts.get(keys[`RootReg:${h}`]),registration=fresh(info)?null:await decodeNativeRootRegistration(release,info,id);out.push({instance:id,root,registration});}return out;
}
function positionView(p,sequence){return {sequence:String(sequence),positionIdHex:hex(p.positionId),rootRevision:String(p.rootRevision),beneficiary:p.beneficiaryAddress,start:String(p.start),end:p.end===null?null:String(p.end),accruedAtoms:String(p.accrued),paidAtoms:String(p.paid),claimableAtoms:String(p.accrued-p.paid),nextUnsettledHour:String(p.nextUnsettledHour),weight:String(p.weight)};}
function positionTime(p,value){check(p.createdTime<=value.clock.unixTimestamp&&p.createdSlot<=value.clock.slot&&(p.end===null||p.endedTime<=value.clock.unixTimestamp&&p.endedSlot<=value.clock.slot),'MINING_POSITION_TIME');}
async function completeDashboard(release,actor,ids,pageStart,pageLimit,keys,read,value){
  const rows=await roots(release,ids,keys,read),r=value.registry,summary=overview(value,actor,read.contextSlot);let actorClaimable=0n,listedClaimable=0n,knownProcessedWeight=0n,listedCount=0;
  const processedIds=new Set(),views=[];
  for(const row of rows){
    const {instance,root,registration:rr}=row,h=hex(instance),positions=[];let directory=null,processedPosition=null;
    check(root.createdAt<=value.clock.unixTimestamp&&root.createdSlot<=value.clock.slot,'MINING_ROOT_TIME');
    if(root.lifecycle===1){const b=read.accounts.get(keys[`Root:${h}`]).data;check(b.readBigInt64LE(427)<=value.clock.unixTimestamp&&b.readBigUInt64LE(435)<=value.clock.slot,'MINING_CONSUMPTION_TIME');}
    check(!rr||rr.revocationCause===0||rr.revocationTime<=value.clock.unixTimestamp&&rr.revocationSlot<=value.clock.slot,'MINING_REVOCATION_TIME');
    if(rr?.ordinaryCount>0n){
      check(r&&rr.directorySequence<r.rootCount,'MINING_DIRECTORY_RANGE');directory=await decodeNativeDirectory(release,read.accounts.get(keys[`Directory:${h}`]),rr.directorySequence);check(directory.instance.equals(instance),'MINING_DIRECTORY_INSTANCE');
      if(directory.active){
        check(directory.currentSequence<rr.ordinaryCount,'MINING_PROCESSED_SEQUENCE');processedPosition=await decodeNativePosition(release,read.accounts.get(keys[`Processed:${h}`]),instance,directory.currentSequence);
        check(processedPosition.rootDirectorySeq===rr.directorySequence&&processedPosition.positionId.equals(directory.positionId)&&processedPosition.start<=r.nextHour&&(processedPosition.end===null||processedPosition.end>=r.nextHour)&&processedPosition.rootRevision<=root.revision&&processedPosition.B_int===root.B&&BigInt(processedPosition.q_ppm)===root.qualityPpm,'MINING_PROCESSED_POSITION');positionTime(processedPosition,value);
        check(!processedIds.has(hex(processedPosition.positionId)),'MINING_DUPLICATE_PROCESSED_POSITION');processedIds.add(hex(processedPosition.positionId));knownProcessedWeight+=processedPosition.weight;
      }
      const end=pageStart+BigInt(pageLimit)<rr.ordinaryCount?pageStart+BigInt(pageLimit):rr.ordinaryCount;
      for(let n=pageStart;n<end;n++){
        const p=await decodeNativePosition(release,read.accounts.get(keys[`Position:${h}:${n}`]),instance,n);check(p.rootDirectorySeq===rr.directorySequence,'MINING_POSITION_DIRECTORY');
        positionTime(p,value);check(p.rootRevision<=root.revision&&p.B_int===root.B&&BigInt(p.q_ppm)===root.qualityPpm,'MINING_POSITION_ROOT');
        if(n+1n===rr.ordinaryCount)check(p.positionId.equals(rr.lastPositionId)&&p.end===rr.ordinaryEnd,'MINING_LATEST_POSITION_LINK');
        const claimable=p.accrued-p.paid;listedClaimable+=claimable;if(p.beneficiaryAddress===actor)actorClaimable+=claimable;listedCount++;positions.push({sequence:n,value:p});
      }
    }
    const intrinsic=normalWeight({scope:['','COMPONENT','CELL','ORGAN','BIO'][root.schema],B_int:root.B,q_ppm:root.qualityPpm}),future=root.lifecycle===0&&!rr?.certificateFault&&value.maturedHours<H_END?intrinsic:0n;
    const pageEnd=rr?(pageStart+BigInt(pageLimit)<rr.ordinaryCount?pageStart+BigInt(pageLimit):rr.ordinaryCount):0n;
    views.push({instanceHex:h,owner:root.owner,lifecycle:root.lifecycle,schema:root.schema,target:root.target,qualityPpm:String(root.qualityPpm),B:String(root.B),intrinsicOrdinaryWeight:String(intrinsic),futureOrdinaryWeight:String(future),actorFutureOrdinaryWeight:String(root.owner===actor?future:0n),futureWeightIsPotentialOnly:true,
      registered:rr!==null,ordinaryCount:String(rr?.ordinaryCount??0n),ordinaryEnd:rr?.ordinaryEnd===null?null:String(rr?.ordinaryEnd??0n),ordinaryIntervalOpen:rr?.ordinaryEnd===null,kEnd:rr?.kEnd===null?null:String(rr?.kEnd??0n),kIntervalOpen:rr?.kEnd===null,kActivationCount:String(rr?.activationCount??0n),lastActivationIdHex:rr&&rr.activationCount>0n?hex(rr.lastActivationId):null,kStatusSource:'ROOT_REG_MIRROR',coverageSequence:String(rr?.coverageSequence??0n),nextCoverageHour:String(rr?.nextCoverageHour??MAX),certificateFault:rr?.certificateFault??false,
      activeProcessedDirectory:directory?.active?{sequence:String(directory.sequence),currentSequence:String(directory.currentSequence),position:positionView(processedPosition,directory.currentSequence)}:null,
      positions:positions.map(p=>positionView(p.value,p.sequence)),positionPageStart:String(pageStart),nextPageStart:rr&&pageEnd<rr.ordinaryCount?String(pageEnd):null,historicalDebtMustBeClaimed:false});
    Object.assign(row,{directory,processedPosition,positions});
  }
  check(knownProcessedWeight<=(r?.normalWeight??0n),'MINING_KNOWN_WEIGHT_EXCEEDS_GLOBAL');
  let currentK=null;
  if(r&&r.kWeight>0n){
    const activation=await decodeNativeActivation(release,read.accounts.get(keys.KActivation),r.kActivationId),directory=await decodeNativeDirectory(release,read.accounts.get(keys.KDirectory),r.kDirectory);
    check(directory.active&&directory.instance.equals(r.kInstance)&&directory.positionId.equals(r.kPositionId),'MINING_K_DIRECTORY');
    const position=await decodeNativePosition(release,read.accounts.get(keys.KPosition),r.kInstance,directory.currentSequence);
    check(position.rootDirectorySeq===r.kDirectory&&position.positionId.equals(r.kPositionId)&&position.beneficiary.equals(r.kBeneficiary)&&activation.instance.equals(r.kInstance)&&activation.author.equals(r.kBeneficiary)&&activation.ordinaryPosition.equals(position.positionId)&&activation.start>=position.start&&activation.start<=r.nextHour&&activation.global<r.nextKSequence&&activation.global<r.nextKScanSequence&&(activation.end===null||activation.end>=r.nextHour)&&(position.end===null||position.end>=r.nextHour),'MINING_K_LINK');positionTime(position,value);
    check(activation.body.readBigUInt64LE(210)<=value.clock.slot&&activation.body.readBigInt64LE(218)<=value.clock.unixTimestamp&&(activation.end===null||activation.body.readBigUInt64LE(235)<=value.clock.slot&&activation.body.readBigInt64LE(243)<=value.clock.unixTimestamp),'MINING_K_TIME');
    currentK={activation,directory,position};summary.currentK={activationIdHex:hex(activation.id),instanceHex:hex(activation.instance),beneficiary:nativeKeyAddress(activation.author),ordinaryPositionIdHex:hex(activation.ordinaryPosition),processedActive:true,start:String(activation.start),end:activation.end===null?null:String(activation.end),physicalIntervalOpen:activation.end===null,withinWallClockInterval:boundary(value)>=activation.start&&(activation.end===null||boundary(value)<activation.end)&&boundary(value)<H_END,globalSequence:String(activation.global),directorySequence:String(directory.sequence),ordinarySequence:String(directory.currentSequence),weight:String(r.kWeight),source:'ACTUAL_PROCESSED_REGISTRY_AND_ACTIVATION'};
  }else summary.currentK=null;
  check(listedClaimable<=value.treasury.certified,'MINING_LISTED_DEBT_EXCEEDS_CERTIFIED');
  summary.roots=views;summary.knownProcessedOrdinaryWeight=String(knownProcessedWeight);summary.claimable={actorAtoms:String(actorClaimable),allListedBeneficiariesAtoms:String(listedClaimable),listedPositionCount:listedCount,scope:'LISTED_POSITION_PAGES_ONLY',walletTotalKnown:false,immutableBeneficiaryRequired:true};
  return {rows,currentK,summary};
}

/** Bounded known-ID overview. No wallet-wide index or future payout is inferred. */
export async function readMiningDashboard(input){
  exact(input,['release','rpc','actor','instances'],['positionPageStart','positionPageLimit']);const {release,rpc}=input,actor=actorValue(input.actor),pageStart=u64(input.positionPageStart??0n,'MINING_PAGE_START'),pageLimit=input.positionPageLimit??5;
  check(Number.isInteger(pageLimit)&&pageLimit>=1&&pageLimit<=5,'MINING_PAGE_LIMIT');check(Array.isArray(input.instances)&&input.instances.length<=4,'MINING_INSTANCE_LIMIT');const ids=input.instances.map(v=>Buffer.from(asBytes(v,32)));check(new Set(ids.map(hex)).size===ids.length,'MINING_DUPLICATE_INSTANCE');
  const keys=await coreKeys(release,actor);for(const id of ids){const h=hex(id);keys[`Root:${h}`]=await pda(release,'root',id);keys[`RootReg:${h}`]=await pda(release,'root-reg',id);}
  const discovery=await batch(rpc,keys),firstValue=await core(release,actor,keys,discovery),initial=await roots(release,ids,keys,discovery),known={...keys};
  for(const row of initial)if(row.registration?.ordinaryCount>0n){const h=hex(row.instance),rr=row.registration;keys[`Directory:${h}`]=await pda(release,'mining-root',le(rr.directorySequence));const end=pageStart+BigInt(pageLimit)<rr.ordinaryCount?pageStart+BigInt(pageLimit):rr.ordinaryCount;for(let n=pageStart;n<end;n++)keys[`Position:${h}:${n}`]=await pda(release,'reg',row.instance,le(n));}
  if(firstValue.registry?.kWeight>0n){keys.KActivation=await pda(release,'activation',firstValue.registry.kActivationId);keys.KDirectory=await pda(release,'mining-root',le(firstValue.registry.kDirectory));}
  const expanded=await batch(rpc,keys),middleValue=await core(release,actor,keys,expanded),stale1=drift({read:discovery,value:firstValue},{read:expanded,value:middleValue},known);if(stale1)return state('REPLAN_STALE_STATE',expanded.contextSlot,{reason:stale1});
  const expandedKeys={...keys};for(const row of initial)if(row.registration?.ordinaryCount>0n){const h=hex(row.instance),d=await decodeNativeDirectory(release,expanded.accounts.get(keys[`Directory:${h}`]),row.registration.directorySequence);if(d.active)keys[`Processed:${h}`]=await pda(release,'reg',row.instance,le(d.currentSequence));}
  if(keys.KDirectory){const d=await decodeNativeDirectory(release,expanded.accounts.get(keys.KDirectory),middleValue.registry.kDirectory);check(d.active,'MINING_K_DIRECTORY');keys.KPosition=await pda(release,'reg',middleValue.registry.kInstance,le(d.currentSequence));}
  const full=await batch(rpc,keys),fullValue=await core(release,actor,keys,full),stale2=drift({read:expanded,value:middleValue},{read:full,value:fullValue},expandedKeys);if(stale2)return state('REPLAN_STALE_STATE',full.contextSlot,{reason:stale2});
  await completeDashboard(release,actor,ids,pageStart,pageLimit,keys,full,fullValue);
  const final=await batch(rpc,keys),value=await core(release,actor,keys,final),stale3=drift({read:full,value:fullValue},{read:final,value},keys);if(stale3)return state('REPLAN_STALE_STATE',final.contextSlot,{reason:stale3});
  const complete=await completeDashboard(release,actor,ids,pageStart,pageLimit,keys,final,value);
  return state('MINING_READ',final.contextSlot,{actor,nextNonce:value.nonce.nextNonce,clock:value.clock,registry:value.registry,book:value.book,roots:complete.rows,currentK:complete.currentK,summary:complete.summary,knownRootsOnly:true});
}

function plannerArgs(input,kind){exact(input,['release','abi','rpc','actor','maxRent',...(kind==='close'?['hour']:[])]);u64(input.maxRent,'MINING_MAX_RENT');if(kind==='close')check(u64(input.hour,'MINING_HOUR')<H_END,'MINING_HOUR');check(input.abi?.hash===input.release.hashes.abiHash.toString('hex'),'MINING_ABI');nativeOperation(input.abi,kind==='close'?'CLOSE_FINAL_HOUR':'SYNC_EMISSION');return actorValue(input.actor);}

/** Existing keeper semantics, one explicitly requested transition only. */
export async function planGuidedGlobalSettlement(input){
  const actor=plannerArgs(input,'global'),{release,abi,rpc,maxRent}=input,keys=await coreKeys(release,actor),firstRead=await batch(rpc,keys),firstValue=await core(release,actor,keys,firstRead),history=[];let keeperNonce=null;
  const recordRead=(addresses,accounts)=>{check(history.length<64,'MINING_READ_BOUND');history.push(...addresses.map((address,i)=>({address,account:accounts[i]})));check(new Set(history.map(h=>h.address)).size<=100,'MINING_ACCOUNT_BOUND');};
  const observed={get contextSlot(){return rpc.contextSlot;},async verifyBaseConfig(){const r=await rpc.verifyBaseConfig();recordRead([r.account.address],[r.account]);return r;},async getActorNonce(a){const n=await rpc.getActorNonce(a);keeperNonce=n;return n;},async getMultipleAccounts(addresses,options){const r=await rpc.getMultipleAccounts(addresses,options);recordRead(addresses,r.accounts);return r;}};
  const planned=await planNextGlobalSettlement({release,abi,rpc:observed,actor,maxRent});
  for(const h of history)if(!Object.values(keys).includes(h.address))keys[`Observed:${h.address}`]=h.address;
  const expanded=await batch(rpc,keys),middleValue=await core(release,actor,keys,expanded),stale1=drift({read:firstRead,value:firstValue},{read:expanded,value:middleValue},Object.fromEntries(Object.entries(keys).filter(([,a])=>firstRead.accounts.has(a))));
  if(stale1)return state('REPLAN_STALE_STATE',expanded.contextSlot,{reason:stale1});
  let observedClock=firstValue.clock;for(const h of history){if(h.address===keys.Clock){const c=decodeNativeClock(h.account);check(c.slot>=observedClock.slot&&c.unixTimestamp>=observedClock.unixTimestamp&&middleValue.clock.slot>=c.slot&&middleValue.clock.unixTimestamp>=c.unixTimestamp,'MINING_CLOCK_REGRESSION');observedClock=c;}else if(!same(h.account,expanded.accounts.get(h.address)))return state('REPLAN_STALE_STATE',expanded.contextSlot,{reason:'KEEPER_DEPENDENCY_CHANGED'});}
  if(keeperNonce?.nextNonce!==middleValue.nonce.nextNonce||keeperNonce.lastDigestHex!==middleValue.nonce.lastDigestHex||keeperNonce.lastResultHex!==middleValue.nonce.lastResultHex||planned.action&&decodeNativeFrame(abi,planned.action.frame).nonce!==middleValue.nonce.nextNonce)return state('REPLAN_STALE_STATE',expanded.contextSlot,{reason:'KEEPER_NONCE_CHANGED'});
  const final=await batch(rpc,keys),value=await core(release,actor,keys,final),stale2=drift({read:expanded,value:middleValue},{read:final,value},keys);if(stale2)return state('REPLAN_STALE_STATE',final.contextSlot,{reason:stale2});
  if(planned.decision!=='ACTION')return state(planned.decision,final.contextSlot,{hour:planned.hour??null,summary:overview(value,actor,final.contextSlot)});
  check(planned.action.nonce===value.nonce.nextNonce,'MINING_FINAL_NONCE');return state('ACTION',final.contextSlot,{action:planned.action,hour:planned.hour??null,summary:overview(value,actor,final.contextSlot),oneStepOnly:true});
}

/** Complete actual Hour only; its original payer receives the account balance. */
export async function planGuidedHourClosure(input){
  const actor=plannerArgs(input,'close'),{release,abi,rpc,hour,maxRent}=input,keys={...await coreKeys(release,actor),Hour:await pda(release,'hour',le(hour))},discovery=await batch(rpc,keys),firstValue=await core(release,actor,keys,discovery),known={...keys};
  const initial=fresh(discovery.accounts.get(keys.Hour))?null:await decodeNativeHour(release,discovery.accounts.get(keys.Hour),hour);if(initial&&initial.rentPayer!==actor)keys.RefundRecipient=initial.rentPayer;
  const expanded=await batch(rpc,keys),middleValue=await core(release,actor,keys,expanded),stale1=drift({read:discovery,value:firstValue},{read:expanded,value:middleValue},known);if(stale1)return state('REPLAN_STALE_STATE',expanded.contextSlot,{reason:stale1});
  const final=await batch(rpc,keys),value=await core(release,actor,keys,final),stale2=drift({read:expanded,value:middleValue},{read:final,value},keys);if(stale2)return state('REPLAN_STALE_STATE',final.contextSlot,{reason:stale2});
  const summary=overview(value,actor,final.contextSlot),hourAccount=final.accounts.get(keys.Hour);if(fresh(hourAccount))return state('HOUR_UNAVAILABLE',final.contextSlot,{hour,summary});
  const h=await decodeNativeHour(release,hourAccount,hour),r=value.registry;if(!r)return state('REGISTRY_UNINITIALIZED',final.contextSlot,{hour,summary});
  if(h.status!==4||hour>=r.nextHour||!h.lazy&&h.previousDirectory!==h.tailDirectory)return state('HOUR_NOT_CLOSABLE',final.contextSlot,{hour,summary});
  check(h.rentPayer!==PROGRAMS.systemProgram&&!isOffCurveAddress(h.rentPayer),'MINING_HOUR_REFUND_RECIPIENT');
  const recipient=final.accounts.get(h.rentPayer===actor?keys.Actor:keys.RefundRecipient),balance=recipient?.lamports??0n;check(balance+hourAccount.lamports<=MAX,'MINING_REFUND_OVERFLOW');check(value.nonce.nextNonce<MAX,'MINING_NONCE_EXHAUSTED');
  const action=await planFinalHourClosure({release,abi,actor,nonce:value.nonce.nextNonce,hour,registryAccount:final.accounts.get(keys.Registry),hourAccount,clockAccount:final.accounts.get(keys.Clock),maxRent});
  return state('ACTION',final.contextSlot,{hour,action,summary,preview:{refundRecipient:h.rentPayer,observedRefundLamports:hourAccount.lamports,refundIsObservedBalance:true,rentMinimumQuoted:false,rewardsChanged:false},oneStepOnly:true});
}
