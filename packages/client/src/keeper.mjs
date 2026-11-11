import { ByteWriter } from '../../protocol-core/src/index.mjs';
import { H_END,completedHours } from '../../settlement/src/emission.mjs';
import { baseConfigR2Id,PROGRAMS } from './release.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda,encodeNativeFrame,buildNativeInstruction,
  encodeApplyEventPayload,encodeEmptySkipPayload,encodeOpenHourPayload,encodeMaterializeHourPayload,encodeSyncEmissionPayload } from './native.mjs';
import { decodeNativeRegistry,decodeNativeHour,decodeNativeMiningEvent,decodeNativeDirectory,decodeNativePosition,decodeNativeActivation } from './accounts.mjs';
import { planFrozenHourAdvance } from './settlement-workflow.mjs';
import { validateV1Resources } from './transaction.mjs';
const MAX=(1n<<64n)-1n,check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const le=n=>new ByteWriter(8).u64(n).finish();
const pda=async(release,...s)=>(await nativePda(release.input.programId,...s)).address;
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&!a.executable&&a.data.length===0;
async function read(rpc,address){const r=await rpc.getMultipleAccounts([address]);check(r.accounts[0]!==null,'KEEPER_ACCOUNT_MISSING');return r.accounts[0];}
async function build(args,operation,payload,suffix,dynamicAccounts=[]){
  const {release,abi,actor,nonce}=args;check(nonce<MAX,'KEEPER_NONCE_EXHAUSTED');
  const frame=encodeNativeFrame(abi,{operation,domain:release.domain,configId:baseConfigR2Id(release),actor:nativeKeyBytes(actor),nonce,payload});
  return {operation,nonce,payload,suffix,dynamicAccounts,frame,instruction:await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts}),clientPlanOnly:true,transactionExecuted:false};
}
async function rewards(release,registry,hour){
  const pairs=[['LABMint','lab-mint'],['LABReserve','lab-reserve'],['LABAuth','lab-auth'],['Treasury','treasury']];
  const rows=[];for(const [name,seed]of pairs)rows.push({name,address:await pda(release,'bio',seed)});
  return rows.concat([{name:'Registry',address:registry}],hour===null?[]:[{name:'Hour',address:hour}]);
}
function clock(account){
  check(account?.address===PROGRAMS.clockSysvar&&account.owner==='Sysvar1111111111111111111111111111111111111'&&!account.executable&&account.data.length===40,'KEEPER_CLOCK_ACCOUNT');
  const now=account.data.readBigInt64LE(32);check(now>=0n,'KEEPER_CLOCK');return {now,slot:account.data.readBigUInt64LE(0)};
}

/** Plan one actual global transition. It never enumerates historical Roots,
 * materializes a player's debt, signs, journals or submits a transaction. */
export async function planNextGlobalSettlement({release,abi,rpc,actor,maxRent}){
  check(typeof maxRent==='bigint'&&maxRent>=0n&&maxRent<=MAX,'KEEPER_RENT_LIMIT');
  actor=nativeKeyAddress(actor);await rpc.verifyBaseConfig();const observed=await rpc.getActorNonce(actor);
  const registryAddress=await pda(release,'bio','mining'),batch=await rpc.getMultipleAccounts([registryAddress,PROGRAMS.clockSysvar]);
  const [registryAccount,clockAccount]=batch.accounts;
  const {now,slot}=clock(clockAccount),mature=completedHours(now,BigInt(release.input.rewardStart));
  const args={release,abi,actor,nonce:observed.nextNonce};
  const finalAction=async(action,hour)=>{
    const last=await rpc.getMultipleAccounts([registryAddress,PROGRAMS.clockSysvar]),latestClock=clock(last.accounts[1]);
    check(latestClock.now>=now&&latestClock.slot>=slot,'KEEPER_CLOCK_REGRESSION');
    const wasFresh=fresh(registryAccount),isFresh=fresh(last.accounts[0]);
    if(!isFresh)await decodeNativeRegistry(release,last.accounts[0]);
    check(wasFresh||!isFresh,'KEEPER_REGISTRY_DISAPPEARED');
    const changed=wasFresh!==isFresh||!wasFresh&&!last.accounts[0].data.equals(registryAccount.data);
    return {decision:changed?'REPLAN_STALE_REGISTRY':'ACTION',contextSlot:last.contextSlot,hour,matureHours:mature,
      clientPlanOnly:true,transactionExecuted:false,...(changed?{}:{action})};
  };
  if(fresh(registryAccount)){
    const suffix=await rewards(release,registryAddress,null);
    return finalAction(await build(args,'SYNC_EMISSION',encodeSyncEmissionPayload({maxRent}),suffix),null);
  }
  const reg=await decodeNativeRegistry(release,registryAccount),hour=reg.nextHour;
  check(now>=reg.highWater,'KEEPER_CLOCK_REGRESSION');
  const done=(decision,extra={})=>({decision,contextSlot:rpc.contextSlot,hour,matureHours:mature,clientPlanOnly:true,transactionExecuted:false,...extra});
  const actionResult=action=>finalAction(action,hour);
  // Due H_END events must be consumed even when no future reward hour exists.
  const nextEvent=await pda(release,'bio','mining-event',le(reg.eventCursor));
  const observedEvent=(await rpc.getMultipleAccounts([nextEvent])).accounts[0];let event=null;
  if(reg.eventCursor<reg.eventCount){event=await decodeNativeMiningEvent(release,observedEvent,reg.eventCursor);check(now>=event.createdTime&&slot>=event.createdSlot,'KEEPER_EVENT_CLOCK');}
  else check(fresh(observedEvent),'KEEPER_UNEXPECTED_EVENT');
  if(event&&event.due<=hour){
    const directoryAddress=await pda(release,'bio','mining-root',le(event.directory)),positionAddress=await pda(release,'bio','reg',event.instance,le(event.positionSequence));
    const rows=await rpc.getMultipleAccounts([directoryAddress,positionAddress]);
    const dir=await decodeNativeDirectory(release,rows.accounts[0],event.directory),position=await decodeNativePosition(release,rows.accounts[1],event.instance,event.positionSequence);
    check(dir.instance.equals(event.instance)&&position.rootDirectorySeq===event.directory&&position.positionId.equals(event.positionId),'KEEPER_EVENT_POSITION');
    const dynamic=[];
    if(event.kind===0){
      check(!dir.active&&position.start===event.due,'KEEPER_START_FACTS');
      if(reg.tailDirectory!==MAX){
        const tailAddress=await pda(release,'bio','mining-root',le(reg.tailDirectory)),tail=await decodeNativeDirectory(release,await read(rpc,tailAddress),reg.tailDirectory);
        check(tail.active&&tail.next===MAX,'KEEPER_TAIL_FACTS');dynamic.push({address:tailAddress,writable:true,signer:false});
      }
    }else if(event.kind===1){
      const end=position.end===null?null:position.end>H_END?H_END:position.end;
      check(dir.active&&dir.positionId.equals(event.positionId)&&end===event.due,'KEEPER_END_FACTS');
      check(reg.kWeight===0n||!reg.kPositionId.equals(event.positionId),'KEEPER_K_MUST_END_FIRST');
      for(const [seq,isPrevious]of [[dir.previous,true],[dir.next,false]])if(seq!==MAX){
        const address=await pda(release,'bio','mining-root',le(seq)),neighbor=await decodeNativeDirectory(release,await read(rpc,address),seq);
        check(neighbor.active&&(isPrevious?neighbor.next:neighbor.previous)===event.directory,'KEEPER_NEIGHBOR_FACTS');dynamic.push({address,writable:true,signer:false});
      }
    }else{
      const address=await pda(release,'bio','activation',event.activationId),activation=await decodeNativeActivation(release,await read(rpc,address),event.activationId);
      check(activation.instance.equals(event.instance)&&activation.ordinaryPosition.equals(event.positionId)&&activation.author.equals(position.beneficiary),'KEEPER_K_IDENTITY');
      check(event.kind===2?activation.start===event.due&&reg.kWeight===0n&&dir.active&&dir.positionId.equals(event.positionId):
        activation.end===event.due&&reg.kActivationId.equals(event.activationId),'KEEPER_K_FACTS');
      dynamic.push({address,writable:false,signer:false});
    }
    return actionResult(await build(args,'APPLY_EVENT',encodeApplyEventPayload({eventSequence:reg.eventCursor,boundary:hour,maxRent}),
      [{name:'Registry',address:registryAddress},{name:'Event',address:nextEvent},{name:'Directory',address:directoryAddress},{name:'Position',address:positionAddress}],dynamic));
  }
  if(hour>=H_END)return done('EMISSION_FRONTIER_COMPLETE');
  if(hour>=mature)return done('WAIT_COMPLETED_HOUR');
  const hourAddress=await pda(release,'bio','hour',le(hour)),hourAccount=(await rpc.getMultipleAccounts([hourAddress])).accounts[0];
  if(!fresh(hourAccount)){
    const h=await decodeNativeHour(release,hourAccount,hour);check(!h.lazy&&[2,3].includes(h.status),'KEEPER_FRONTIER_HOUR_STATE');
    if(h.schema!==4)return done('LEGACY_HOUR_REQUIRES_MANUAL_COMPLETION');
    if(h.members===0n)return actionResult(await build(args,'MATERIALIZE_HOUR',encodeMaterializeHourPayload({hour,expectedCursor:0n,positionSeq:0n,maxRent}),await rewards(release,registryAddress,hourAddress)));
    return actionResult(await planFrozenHourAdvance({...args,hour,registryAccount,hourAccount,clockAccount,maxRent}));
  }
  const suffix=(await rewards(release,registryAddress,hourAddress)).concat({name:'NextEvent',address:nextEvent});
  if(reg.activeCount===0n&&reg.kWeight===0n){
    const targetExclusive=event&&event.due<mature?event.due:mature;check(targetExclusive>hour,'KEEPER_EMPTY_RANGE');
    return actionResult(await build(args,'EMPTY_SKIP',encodeEmptySkipPayload({expectedNextHour:hour,targetExclusive,maxRent}),
      suffix.map(row=>row.name==='Hour'?{...row,name:'CurrentHour'}:row)));
  }
  return actionResult(await build(args,'OPEN_HOUR',encodeOpenHourPayload({hour,maxRent}),suffix));
}

/** An explicitly invoked, single-step external-signer runner. The service owner
 * supplies a funded signer and durable session; no key, timer or retry policy
 * is hidden here. PENDING/UNKNOWN requires explicit reconciliation/recovery. */
export async function runNativeKeeperStep({session,release,abi,actor,maxRent,resources,broadcast=false,signEnvelope}){
  check(typeof broadcast==='boolean','KEEPER_BROADCAST_OPTION');const limits=validateV1Resources(resources);
  const plan=await planNextGlobalSettlement({release,abi,rpc:session.rpc,actor,maxRent});
  if(plan.decision!=='ACTION'||!broadcast)return plan;
  check(typeof signEnvelope==='function','KEEPER_EXTERNAL_SIGNER_REQUIRED');
  const identity=session.recoveryIdentity;
  check(identity?.actor===nativeKeyAddress(actor)&&identity.abiHash===abi.hash&&identity.domainHex===release.domain.toString('hex')
    &&identity.configHex===baseConfigR2Id(release).toString('hex')&&identity.releaseHash===release.input.releaseHash,'KEEPER_SESSION_IDENTITY');
  const envelope=await session.prepare({...plan.action,resources:limits});
  check(envelope.frameHex===plan.action.frame.toString('hex'),'KEEPER_SESSION_FRAME');
  await session.rpc.simulatePreparedV1(Buffer.from(envelope.unsignedHex,'hex'),{supportedTransactionVersions:[1]});
  const signedBytes=await signEnvelope(envelope);
  return {plan,submission:await session.broadcastSigned(envelope,signedBytes)};
}
