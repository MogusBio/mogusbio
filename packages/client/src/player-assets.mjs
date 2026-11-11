import { isOffCurveAddress } from '@solana/kit';
import { asBytes,ByteWriter } from '../../protocol-core/src/index.mjs';
import { H_END,emissionPrefix,completedHours,nextStakeHour } from '../../settlement/src/emission.mjs';
import { normalWeight } from '../../settlement/src/weights.mjs';
import { PROGRAMS } from './release.mjs';
import { nativePda,nativeKeyBytes,nativeKeyAddress,nativeOperation,encodeNativeFrame,encodeRegisterOrdinaryPayload,encodeExitOrdinaryPayload,buildNativeInstruction } from './native.mjs';
import { decodeNativeRoot,decodeNativeRegistry,decodeNativePosition,decodeNativeDirectory,decodeNativeHour,decodeClassicMint,decodeClassicTokenAccount } from './accounts.mjs';
import { decodeNativeRootRegistration,decodeNativeEconomyConfig,decodeNativeTreasury,validateNativeTreasuryBalances,decodeNativeClock } from './economy-accounts.mjs';
import { decodeActorNonceSnapshot } from './journal.mjs';
import { baseConfigR2Id } from './release.mjs';
import { planPlayerPositionAction } from './player-settlement.mjs';
import { planAccruedPositionClaim } from './settlement-workflow.mjs';

const MAX=(1n<<64n)-1n;
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const u64=v=>{check(typeof v==='bigint'&&v>=0n&&v<=MAX,'ASSET_U64');return v;};
const le=v=>new ByteWriter(8).u64(v).finish();
const pda=async(r,...seeds)=>(await nativePda(r.input.programId,'bio',...seeds)).address;
const absent=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const equalAccount=(a,b)=>a===null?b===null:b!==null&&a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&asBytes(a.data).equals(asBytes(b.data));
const state=(decision,contextSlot,extra={})=>({decision,contextSlot,clientPlanOnly:true,transactionExecuted:false,...extra});
const blankRegistry=()=>({rootCount:0n,nextHour:0n,highWater:0n,eventCount:0n,lastEventDue:0n});
const blankRegistration=()=>({revision:0n,ordinaryCount:0n,ordinaryEnd:0n,kEnd:0n,activationCount:0n,coverageSequence:0n,nextCoverageHour:MAX,certificateFault:false,directorySequence:MAX});
const actualBoundary=(now,start)=>now<start?0n:(now-start)/3600n;
async function keysFor(release,actor,instance){return {Root:await pda(release,'root',instance),RootReg:await pda(release,'root-reg',instance),Registry:await pda(release,'mining'),
  EconomyConfig:await pda(release,'econ-config'),Clock:'SysvarC1ock11111111111111111111111111111111',ActorNonce:await pda(release,'actor-nonce',nativeKeyBytes(actor)),Actor:actor};}
async function batch(rpc,keys){const names=Object.keys(keys),{contextSlot,accounts}=await rpc.getMultipleAccounts(Object.values(keys));return {contextSlot,accounts:Object.fromEntries(names.map((n,i)=>[n,accounts[i]]))};}
async function decode(release,actor,instance,read){
  const a=read.accounts,root=await decodeNativeRoot(release,a.Root,instance),registrationExists=!absent(a.RootReg),registryExists=!absent(a.Registry);
  return {...read,root,registrationExists,registryExists,registration:registrationExists?await decodeNativeRootRegistration(release,a.RootReg,instance):blankRegistration(),
    registry:registryExists?await decodeNativeRegistry(release,a.Registry):blankRegistry(),economy:await decodeNativeEconomyConfig(release,a.EconomyConfig),clock:decodeNativeClock(a.Clock),
    nonce:await decodeActorNonceSnapshot({release,actor,address:await pda(release,'actor-nonce',nativeKeyBytes(actor)),account:a.ActorNonce,contextSlot:read.contextSlot,commitment:'finalized'})};
}
function publicFacts(v){return {root:v.root,registrationExists:v.registrationExists,registration:v.registration,registryExists:v.registryExists,
  registry:v.registry,clock:v.clock,nextNonce:v.nonce.nextNonce,knownInstanceOnly:true};}
function ownedWallet(a,actor){check(a&&a.address===actor&&a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0&&!isOffCurveAddress(actor),'ASSET_ACTOR_WALLET');}
function stable(first,last,common){return Object.keys(common).filter(k=>k!=='Clock'&&k!=='ActorNonce'&&k!=='Actor').every(k=>equalAccount(first.accounts[k],last.accounts[k]));}
function clockForward(first,last){check(last.clock.slot>=first.clock.slot&&last.clock.unixTimestamp>=first.clock.unixTimestamp,'ASSET_CLOCK_REGRESSION');}

/** Bounded known-ID read, not wallet-wide discovery. Every returned Position
 * is selected from the actual registration count and decoded independently. */
export async function readPlayerAsset({release,rpc,actor,instance,positionPageStart=0n,positionPageLimit=20}){
  const id=asBytes(instance,32),address=nativeKeyAddress(actor);u64(positionPageStart);
  check(Number.isInteger(positionPageLimit)&&positionPageLimit>=1&&positionPageLimit<=20,'ASSET_PAGE_LIMIT');await rpc.verifyBaseConfig();
  const common=await keysFor(release,address,id),first=await decode(release,address,id,await batch(rpc,common)),keys={...common};
  const count=first.registration.ordinaryCount,end=positionPageStart+BigInt(positionPageLimit)<count?positionPageStart+BigInt(positionPageLimit):count;
  for(let i=positionPageStart;i<end;i++)keys[`Position${i}`]=await pda(release,'reg',id,le(i));
  const last=await decode(release,address,id,await batch(rpc,keys));clockForward(first,last);if(!stable(first,last,common))return state('REPLAN_STALE_STATE',last.contextSlot);
  const positions=[];for(let i=positionPageStart;i<end;i++){
    const value=await decodeNativePosition(release,last.accounts[`Position${i}`],id,i);check(value.rootDirectorySeq===last.registration.directorySequence,'ASSET_POSITION_DIRECTORY');positions.push({sequence:i,value});
  }
  return state('ASSET_READ',last.contextSlot,{...publicFacts(last),positions,nextPageStart:end<count?end:null});
}

/** Read-driven ordinary stake/exit proposal. No transaction is executed and
 * no nonce is reserved. Unsupported K exit is explicit rather than guessed. */
export async function planPlayerAssetAction({release,abi,rpc,actor,instance,kind,beneficiary=actor,maxRent}){
  check(kind==='stake'||kind==='exit','ASSET_ACTION_KIND');u64(maxRent);const id=asBytes(instance,32),address=nativeKeyAddress(actor),recipient=nativeKeyAddress(beneficiary);
  check(recipient!==PROGRAMS.systemProgram,'ASSET_ZERO_BENEFICIARY');await rpc.verifyBaseConfig();
  const common=await keysFor(release,address,id),first=await decode(release,address,id,await batch(rpc,common)),count=first.registration.ordinaryCount;
  const keys={...common},dir=count===0n?first.registry.rootCount:first.registration.directorySequence,seq=kind==='stake'?count:count>0n?count-1n:0n;
  if(count>0n)keys.PreviousPosition=await pda(release,'reg',id,le(count-1n));
  keys.Directory=await pda(release,'mining-root',le(dir));keys.Event=await pda(release,'mining-event',le(first.registry.eventCount));
  if(kind==='stake'){
    keys.NewPosition=await pda(release,'reg',id,le(seq));keys.CurrentHour=await pda(release,'hour',le(first.registry.nextHour));
    keys.LABMint=await pda(release,'lab-mint');keys.LABReserve=await pda(release,'lab-reserve');keys.Treasury=await pda(release,'treasury');
  }
  const v=await decode(release,address,id,await batch(rpc,keys));clockForward(first,v);if(!stable(first,v,common))return state('REPLAN_STALE_STATE',v.contextSlot);
  const {root,registration:rr,registry:rg,economy,clock,accounts:a}=v,facts=publicFacts(v);ownedWallet(a.Actor,address);
  if(root.owner!==address)return state('OWNER_MISMATCH',v.contextSlot,facts);
  if(root.lifecycle!==0)return state('INPUT_ALREADY_CONSUMED',v.contextSlot,facts);
  if(rr.certificateFault)return state('CERTIFICATE_FAULT',v.contextSlot,facts);
  if(clock.unixTimestamp<root.createdAt||clock.slot<root.createdSlot||clock.unixTimestamp<rg.highWater)return state('WAIT_CLOCK',v.contextSlot,facts);
  check(v.nonce.nextNonce<MAX,'ASSET_NONCE_EXHAUSTED');check(absent(a.Event),'ASSET_EVENT_NOT_FRESH');
  const current=actualBoundary(clock.unixTimestamp,economy.rewardStart);let payload,operation,dynamicAccounts=[],fixed,preview;
  if(kind==='stake'){
    if(rr.kEnd===null)return state('K_INTERVAL_OPEN',v.contextSlot,facts);
    if(current<rr.kEnd)return state('WAIT_K_END',v.contextSlot,{...facts,end:rr.kEnd});
    if(count>0n&&(rr.ordinaryEnd===null||current<rr.ordinaryEnd))return state(rr.ordinaryEnd===null?'ALREADY_STAKED':'WAIT_ORDINARY_END',v.contextSlot,{...facts,end:rr.ordinaryEnd});
    if(count>0n){
      const previous=await decodeNativePosition(release,a.PreviousPosition,id,count-1n);check(previous.rootDirectorySeq===dir&&previous.end===rr.ordinaryEnd,'ASSET_PREVIOUS_POSITION');
      const directory=await decodeNativeDirectory(release,a.Directory,dir);check(directory.instance.equals(id),'ASSET_DIRECTORY_IDENTITY');
      dynamicAccounts.push({address:keys.PreviousPosition,writable:false,signer:false});
    }else check(absent(a.Directory),'ASSET_DIRECTORY_NOT_FRESH');
    check(count<MAX&&rr.revision<MAX&&rg.eventCount<MAX&&(count!==0n||rg.rootCount<MAX),'ASSET_COUNTER_EXHAUSTED');check(absent(a.NewPosition),'ASSET_POSITION_NOT_FRESH');
    if(clock.unixTimestamp>=economy.rewardStart&&current+1n>=H_END)return state('REWARD_DOMAIN_CLOSED',v.contextSlot,facts);
    const start=nextStakeHour(clock.unixTimestamp,economy.rewardStart),mint=decodeClassicMint(a.LABMint,{expectedAddress:keys.LABMint,expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null}),labAuth=await pda(release,'lab-auth');
    const reserve=decodeClassicTokenAccount(a.LABReserve,{expectedAddress:keys.LABReserve,expectedMint:keys.LABMint,expectedOwner:labAuth,reserve:true}),treasury=await decodeNativeTreasury(release,a.Treasury);
    validateNativeTreasuryBalances(release,treasury,{mint,reserve});
    let coldPrefixAtoms=0n;
    if(rg.rootCount===0n){
      const completed=completedHours(clock.unixTimestamp,economy.rewardStart);check(completed>=treasury.asOf&&rg.nextHour<=completed,'ASSET_COLD_CLOCK');
      const newlyDue=emissionPrefix(completed)-emissionPrefix(treasury.asOf);check(treasury.locked>=newlyDue&&treasury.pending+newlyDue<=MAX,'ASSET_COLD_BOOK');
      coldPrefixAtoms=emissionPrefix(completed)-emissionPrefix(rg.nextHour);check(treasury.certified===0n&&treasury.pending+newlyDue>=coldPrefixAtoms,'ASSET_COLD_PENDING');
      if(!absent(a.CurrentHour)){
        const h=await decodeNativeHour(release,a.CurrentHour,rg.nextHour),b=h.body;
        check(rg.nextHour<completed&&h.status===2&&b.subarray(16,40).every(x=>x===0)&&b.subarray(41,233).every(x=>x===0)&&b.subarray(249,273).every(x=>x===0),'ASSET_COLD_HOUR');
      }
    }
    check(rg.lastEventDue<=start&&rg.nextHour<=start,'ASSET_EVENT_ORDER');dynamicAccounts.push({address:keys.Event,writable:true,signer:false});
    operation='REGISTER_ORDINARY';payload=encodeRegisterOrdinaryPayload({instance:id,rootRevision:root.revision,positionSeq:seq,directorySeq:dir,beneficiary:recipient,maxRent});
    fixed={LABMint:keys.LABMint,LABReserve:keys.LABReserve,LABAuth:labAuth,Treasury:keys.Treasury,Registry:keys.Registry,Root:keys.Root,RootReg:keys.RootReg,Directory:keys.Directory,NewPosition:keys.NewPosition,CurrentHour:keys.CurrentHour};
    preview={positionSequence:seq,directorySequence:dir,start,beneficiary:recipient,ordinaryWeight:normalWeight({scope:['','COMPONENT','CELL','ORGAN','BIO'][root.schema],B_int:root.B,q_ppm:root.qualityPpm}),coldPrefixAtoms};
  }else{
    if(count===0n)return state('NO_POSITION',v.contextSlot,facts);
    if(rr.kEnd===null)return state('K_AWARE_EXIT_REQUIRED',v.contextSlot,facts);
    if(rr.ordinaryEnd!==null)return state('ALREADY_EXITED',v.contextSlot,facts);
    const position=await decodeNativePosition(release,a.PreviousPosition,id,seq);check(position.rootDirectorySeq===dir&&position.end===null,'ASSET_POSITION_IDENTITY');
    if(clock.unixTimestamp<economy.rewardStart||current<position.start)return state('WAIT_POSITION_START',v.contextSlot,{...facts,start:position.start});
    check(current<MAX&&rr.revision<MAX&&rg.eventCount<MAX,'ASSET_COUNTER_EXHAUSTED');const end=current+1n,due=end<H_END?end:H_END;check(rg.lastEventDue<=due&&rg.nextHour<=due,'ASSET_EVENT_ORDER');
    operation='EXIT_ORDINARY';payload=encodeExitOrdinaryPayload({instance:id,positionSeq:seq,rootRevision:root.revision,maxRent});fixed={Registry:keys.Registry,Root:keys.Root,RootReg:keys.RootReg,Position:keys.PreviousPosition,OrdinaryEndEvent:keys.Event};preview={positionSequence:seq,end,eventDue:due,beneficiary:position.beneficiaryAddress};
  }
  const suffix=nativeOperation(abi,operation).publicFixedSuffix.map(r=>({name:r.role,address:fixed[r.role]})),nonce=v.nonce.nextNonce,frame=encodeNativeFrame(abi,{operation,domain:release.domain,configId:baseConfigR2Id(release),actor:address,nonce,payload});
  const instruction=await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts}),action={clientPlanOnly:true,operation,nonce,payload,suffix,dynamicAccounts,frame,instruction};
  return state('ACTION',v.contextSlot,{...facts,action,preview,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null});
}

/** Guided personal accounting additionally validates the actual initialized
 * economy and reserve book. Historical claims remain permissionless and keep
 * their immutable beneficiary even after the underlying Root is consumed. */
export async function planGuidedPositionAction({release,abi,rpc,actor,instance,positionSeq,kind,maxRent}){
  check(kind==='claim'||kind==='accrue','ASSET_POSITION_KIND');u64(positionSeq);u64(maxRent);
  const id=asBytes(instance,32),address=nativeKeyAddress(actor);await rpc.verifyBaseConfig();
  const first=await rpc.getPosition(id,positionSeq),mintAddress=await pda(release,'lab-mint'),authority=await pda(release,'lab-auth'),reserveAddress=await pda(release,'lab-reserve');
  const destination=(await nativePda(PROGRAMS.associatedTokenProgram,first.value.beneficiary,nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mintAddress))).address;
  const keys={Position:first.account.address,Destination:destination,LABMint:mintAddress,LABReserve:reserveAddress,Treasury:await pda(release,'treasury'),EconomyConfig:await pda(release,'econ-config'),
    ActorNonce:await pda(release,'actor-nonce',nativeKeyBytes(address)),Actor:address};
  const {contextSlot,accounts:a}=await batch(rpc,keys);ownedWallet(a.Actor,address);
  const position=await decodeNativePosition(release,a.Position,id,positionSeq);check(position.beneficiary.equals(first.value.beneficiary),'ASSET_BENEFICIARY_CHANGED');
  await decodeNativeEconomyConfig(release,a.EconomyConfig);
  const mint=decodeClassicMint(a.LABMint,{expectedAddress:mintAddress,expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null}),reserve=decodeClassicTokenAccount(a.LABReserve,{expectedAddress:reserveAddress,expectedMint:mintAddress,expectedOwner:authority,reserve:true});
  const treasury=await decodeNativeTreasury(release,a.Treasury);validateNativeTreasuryBalances(release,treasury,{mint,reserve});
  const nonce=await decodeActorNonceSnapshot({release,actor:address,address:keys.ActorNonce,account:a.ActorNonce,contextSlot,commitment:'finalized'});
  if(kind==='accrue'){
    const planned=await planPlayerPositionAction({release,abi,rpc,actor:address,instance:id,positionSeq,kind,maxRent});
    return {...planned,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null};
  }
  if(position.accrued===position.paid)return state('NO_ACCRUED_DEBT',contextSlot,{nextUnsettledHour:position.nextUnsettledHour,beneficiary:position.beneficiaryAddress});
  check(nonce.nextNonce<MAX,'ASSET_NONCE_EXHAUSTED');const amount=position.accrued-position.paid;
  check(treasury.certified>=amount&&reserve.amount>=amount&&treasury.paid+amount<=MAX,'ASSET_CLAIM_BOOK');
  check(destination!==reserveAddress,'ASSET_CLAIM_RESERVE_DESTINATION');
  let destinationAccount=a.Destination;
  if(absent(destinationAccount))destinationAccount=null;
  else{const token=decodeClassicTokenAccount(destinationAccount,{expectedAddress:destination,expectedMint:mintAddress,expectedOwner:position.beneficiary});check(token.amount+amount<=MAX,'ASSET_CLAIM_OVERFLOW');}
  const action=await planAccruedPositionClaim({release,abi,actor:address,nonce:nonce.nextNonce,instance:id,positionSeq,positionAccount:a.Position,destinationAccount,maxRent});
  return state('ACTION',contextSlot,{action,previewAtoms:amount,beneficiary:position.beneficiaryAddress,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null,
    ataCreationRequired:destinationAccount===null,ataRentCoveredByNativeMaxRent:false});
}
