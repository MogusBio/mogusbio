import { ByteWriter,asBytes,typedHash } from '../../protocol-core/src/index.mjs';
import { H_END } from '../../settlement/src/emission.mjs';
import { PROGRAMS } from './release.mjs';
import { nativeKeyBytes,nativeKeyAddress,nativePda } from './native.mjs';
import { decodeNativeAccountRecord,decodeNativeRegistry,decodeNativePosition } from './accounts.mjs';
import { planLazyPositionAccrual,planAccruedPositionClaim } from './settlement-workflow.mjs';
import { validateV1Resources } from './transaction.mjs';

const MAX=(1n<<64n)-1n;
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const le=n=>new ByteWriter(8).u64(n).finish();
const pda=async(release,...seeds)=>(await nativePda(release.input.programId,...seeds)).address;
const state=(decision,contextSlot,extra={})=>({decision,contextSlot,clientPlanOnly:true,transactionExecuted:false,...extra});

/** Convert a reviewed native action to the operator's exact, unsigned intent.
 * Resource choices remain explicit and are checked by NativePlayerSession. */
export function nativeActionIntent(action,resources){
  check(action?.clientPlanOnly===true&&Buffer.isBuffer(action.payload),'PLAYER_ACTION_REQUIRED');
  const validated=validateV1Resources(resources);
  return {operation:action.operation,nonce:action.nonce.toString(),payloadHex:action.payload.toString('hex'),
    suffix:action.suffix,dynamicAccounts:action.dynamicAccounts??[],resources:{...validated,priorityFeeLamports:validated.priorityFeeLamports.toString()},
    ...(action.labDestinationSetup===undefined?{}:{labDestinationSetup:action.labDestinationSetup})};
}

/** Read-driven personal settlement. Each call produces at most one unsigned
 * action; a later session must still recheck nonce and native execution CAS.
 * The caller chooses claim or accrue rather than silently sending either. */
export async function planPlayerPositionAction({release,abi,rpc,actor,instance,positionSeq,kind,maxRent}){
  check(kind==='claim'||kind==='accrue','PLAYER_ACTION_KIND');
  check(typeof positionSeq==='bigint'&&positionSeq>=0n&&positionSeq<MAX,'PLAYER_POSITION_SEQUENCE');
  const id=asBytes(instance,32),actorAddress=nativeKeyAddress(actor);
  await rpc.verifyBaseConfig();
  const observed=await rpc.getActorNonce(actorAddress),first=await rpc.getPosition(id,positionSeq);
  const common={release,abi,actor:actorAddress,nonce:observed.nextNonce,instance:id,positionSeq,maxRent};
  if(kind==='claim'){
    if(first.value.accrued===first.value.paid)return state('NO_ACCRUED_DEBT',first.contextSlot,{nextUnsettledHour:first.value.nextUnsettledHour});
    const mint=await pda(release,'bio','lab-mint'),destination=(await nativePda(PROGRAMS.associatedTokenProgram,
      first.value.beneficiary,nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address;
    const {contextSlot,accounts:[positionAccount,destinationAccount]}=await rpc.getMultipleAccounts([first.account.address,destination]);
    // Reread the paid CAS and debt together with the selected destination.
    const position=await decodeNativePosition(release,positionAccount,id,positionSeq);
    check(position.beneficiary.equals(first.value.beneficiary),'PLAYER_POSITION_IDENTITY_CHANGED');
    if(position.accrued===position.paid)return state('NO_ACCRUED_DEBT',contextSlot,{nextUnsettledHour:position.nextUnsettledHour});
    const uninitialized=destinationAccount!==null&&destinationAccount.owner===PROGRAMS.systemProgram
      &&destinationAccount.executable===false&&asBytes(destinationAccount.data).length===0;
    const action=await planAccruedPositionClaim({...common,positionAccount,destinationAccount:uninitialized?null:destinationAccount});
    return state('ACTION',contextSlot,{action,previewAtoms:action.previewAtoms,beneficiary:action.beneficiary});
  }
  const directory=first.value.rootDirectorySeq,rootReg=await pda(release,'bio','root-reg',id),dir=await pda(release,'bio','mining-root',le(directory)),registry=await pda(release,'bio','mining');
  const {contextSlot,accounts:[positionAccount,registryAccount,rootRegAccount,directoryAccount]}=await rpc.getMultipleAccounts([first.account.address,registry,rootReg,dir]);
  const position=await decodeNativePosition(release,positionAccount,id,positionSeq),reg=await decodeNativeRegistry(release,registryAccount);
  check(position.rootDirectorySeq===directory,'PLAYER_POSITION_IDENTITY_CHANGED');
  const rr=await decodeNativeAccountRecord(release,rootRegAccount,{kind:25,schemas:[1],seeds:['bio','root-reg',id],recordKey:id,maxBodyBytes:260}),b=rr.body;
  check(b.length===260&&b.subarray(0,32).equals(id)&&b.readBigUInt64LE(244)===directory,'PLAYER_ROOT_REG_IDENTITY');
  const directoryId=typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(28).finish(),Buffer.from([0]),le(directory)]));
  const d=await decodeNativeAccountRecord(release,directoryAccount,{kind:28,schemas:[2],seeds:['bio','mining-root',le(directory)],recordKey:directoryId,maxBodyBytes:138});
  check(d.body.length===138&&d.body.readBigUInt64LE(0)===directory&&d.body[8]===0&&d.body.subarray(9,41).equals(id)
    &&d.body.subarray(41,73).equals(id)&&d.body.readBigUInt64LE(73)===0n&&directory<reg.rootCount,'PLAYER_DIRECTORY_IDENTITY');
  const end=position.end===null||position.end>H_END?H_END:position.end,hour=position.nextUnsettledHour;
  if(hour>=end)return state('COVERAGE_COMPLETE',contextSlot,{accrued:position.accrued,paid:position.paid});
  const coverageSeq=b.readBigUInt64LE(138);
  if(coverageSeq<positionSeq)return state('WAIT_PRIOR_POSITION',contextSlot,{priorPositionSeq:coverageSeq});
  check(coverageSeq===positionSeq,'PLAYER_COVERAGE_SEQUENCE');
  if(hour>=reg.nextHour)return state('WAIT_FROZEN_FRONTIER',contextSlot,{hour,nextHour:reg.nextHour});
  const actualHour=await rpc.getHour(hour);
  const action=await planLazyPositionAccrual({...common,hour,registryAccount,hourAccount:actualHour.account,positionAccount,rootRegAccount,directoryAccount});
  return state('ACTION',actualHour.contextSlot,{action,hour,previewAtoms:action.previewAtoms});
}
