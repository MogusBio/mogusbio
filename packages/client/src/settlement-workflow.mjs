import { ByteWriter,asBytes,typedHash } from '../../protocol-core/src/index.mjs';
import { H_END,completedHours } from '../../settlement/src/emission.mjs';
import { rewardAmount } from '../../settlement/src/weights.mjs';
import { baseConfigR2Id,PROGRAMS } from './release.mjs';
import { decodeNativeAccountRecord,decodeNativeRegistry,decodeNativeHour,decodeNativePosition,decodeClassicTokenAccount } from './accounts.mjs';
import { nativeKeyBytes,nativeKeyAddress,nativePda,encodeNativeFrame,buildNativeInstruction,
  encodeAdvanceFrozenHourPayload,encodeMaterializeHourPayload,encodeClaimPositionPayload,encodeCloseFinalHourPayload } from './native.mjs';

const MAX=(1n<<64n)-1n,check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const u64=n=>{check(typeof n==='bigint'&&n>=0n&&n<=MAX,'SETTLEMENT_U64');return n;};
const le=n=>new ByteWriter(8).u64(u64(n)).finish();
const pda=async(release,...seeds)=>(await nativePda(release.input.programId,...seeds)).address;
const keyId=(release,kind,...tail)=>typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(kind).finish(),...tail]));
function clockTime(account){
  check(account?.address===PROGRAMS.clockSysvar&&account.owner==='Sysvar1111111111111111111111111111111111111'
    &&account.executable===false&&asBytes(account.data).length===40,'SETTLEMENT_CLOCK_ACCOUNT');
  const now=asBytes(account.data).readBigInt64LE(32);check(now>=0n,'SETTLEMENT_CLOCK');return now;
}
async function action({release,abi,actor,nonce,operation,payload,suffix,dynamicAccounts=[]}){
  check(u64(nonce)<MAX,'SETTLEMENT_NONCE_EXHAUSTED');
  const frame=encodeNativeFrame(abi,{operation,domain:release.domain,configId:baseConfigR2Id(release),actor,nonce,payload});
  return {operation,nonce,frame,payload,suffix,dynamicAccounts,instruction:await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts}),
    clientPlanOnly:true,transactionExecuted:false,productionAdmission:false};
}
async function rewardSuffix(release,registryAccount,hourAccount){
  return [{name:'LABMint',address:await pda(release,'bio','lab-mint')},{name:'LABReserve',address:await pda(release,'bio','lab-reserve')},
    {name:'LABAuth',address:await pda(release,'bio','lab-auth')},{name:'Treasury',address:await pda(release,'bio','treasury')},
    {name:'Registry',address:registryAccount.address},{name:'Hour',address:hourAccount.address}];
}

/** Independently advances only the global frozen-hour frontier. No balance or
 * token account is part of this instruction. A finalized RPC is still a trust
 * boundary; the native handler rechecks all facts at actual execution. */
export async function planFrozenHourAdvance({release,abi,actor,nonce,hour,registryAccount,hourAccount,clockAccount,maxRent}){
  u64(hour);const registry=await decodeNativeRegistry(release,registryAccount),record=await decodeNativeHour(release,hourAccount,hour),now=clockTime(clockAccount);
  check(now>=registry.highWater&&hour<completedHours(now,BigInt(release.input.rewardStart)),'SETTLEMENT_HOUR_NOT_MATURE');
  check(registry.nextHour===hour,'SETTLEMENT_FRONTIER');
  check(record.schema===4&&!record.lazy&&[2,3].includes(record.status),'SETTLEMENT_ADVANCE_PHASE');
  return action({release,abi,actor,nonce,operation:'ADVANCE_FROZEN_HOUR',payload:encodeAdvanceFrozenHourPayload({hour,maxRent}),
    suffix:[{name:'Registry',address:registryAccount.address},{name:'Hour',address:hourAccount.address}]});
}

/** One chosen real historical Position, even after the current node has ended.
 * All accounts come from the caller's explicit read, never an invented current
 * neighbor. No old Root ownership is needed to redirect or authorize a claim. */
export async function planLazyPositionAccrual({release,abi,actor,nonce,hour,registryAccount,hourAccount,
  instance=null,positionSeq=0n,positionAccount=null,rootRegAccount=null,directoryAccount=null,maxRent}){
  u64(hour);u64(positionSeq);const registry=await decodeNativeRegistry(release,registryAccount),record=await decodeNativeHour(release,hourAccount,hour);
  check(record.schema===4&&record.lazy&&[2,3].includes(record.status)&&hour<registry.nextHour,'SETTLEMENT_LAZY_PHASE');
  const dynamicAccounts=[];let previewAtoms=0n;
  if(record.members===0n){
    check(instance===null&&positionSeq===0n&&positionAccount===null&&rootRegAccount===null&&directoryAccount===null,'SETTLEMENT_EMPTY_MEMBERS');
  }else{
    check(record.materializeCursor<record.members,'SETTLEMENT_MEMBER_COUNT');
    const id=asBytes(instance,32),position=await decodeNativePosition(release,positionAccount,id,positionSeq),dir=position.rootDirectorySeq;
    const rr=await decodeNativeAccountRecord(release,rootRegAccount,{kind:25,schemas:[1],seeds:['bio','root-reg',id],recordKey:id,maxBodyBytes:260}),b=rr.body;
    const directory=await decodeNativeAccountRecord(release,directoryAccount,{kind:28,schemas:[2],seeds:['bio','mining-root',le(dir)],recordKey:keyId(release,28,Buffer.from([0]),le(dir)),maxBodyBytes:138}),d=directory.body;
    check(b.length===260&&d.length===138&&b.subarray(0,32).equals(id)&&b.readBigUInt64LE(244)===dir
      &&b.readBigUInt64LE(138)===positionSeq&&positionSeq<b.readBigUInt64LE(40)
      &&(b.readBigUInt64LE(146)===hour||b.readBigUInt64LE(146)===MAX&&position.start===hour),'SETTLEMENT_OWN_COVERAGE');
    check(d.readBigUInt64LE(0)===dir&&d[8]===0&&d.subarray(9,41).equals(id)&&d.subarray(41,73).equals(id)
      &&d.readBigUInt64LE(73)===0n&&dir<registry.rootCount,'SETTLEMENT_DIRECTORY_IDENTITY');
    check(position.start<=hour&&hour<(position.end===null?H_END:position.end<H_END?position.end:H_END)
      &&position.nextUnsettledHour===hour,'SETTLEMENT_POSITION_HOUR');
    let weight=position.weight;
    if(record.kWeight>0n&&record.kInstance.equals(id)){
      check(record.kIntervalId.equals(position.positionId)&&record.kBeneficiary.equals(position.beneficiary),'SETTLEMENT_K_IDENTITY');weight+=record.kWeight;
    }
    previewAtoms=rewardAmount(record.budget,weight,record.denominator);
    check(record.materializedSum+previewAtoms<=record.budget,'SETTLEMENT_ALLOCATION_LIMIT');
    dynamicAccounts.push({address:directoryAccount.address,writable:false,signer:false},{address:rootRegAccount.address,writable:true,signer:false},{address:positionAccount.address,writable:true,signer:false});
  }
  return {...await action({release,abi,actor,nonce,operation:'MATERIALIZE_HOUR',payload:encodeMaterializeHourPayload({hour,expectedCursor:record.materializeCursor,positionSeq,maxRent}),
    suffix:await rewardSuffix(release,registryAccount,hourAccount),dynamicAccounts}),previewAtoms,previewOnly:true};
}

/** Permissionless trigger, immutable beneficiary destination, actual accrued
 * wallet funds only. This does not merge unmaterialized hours into a claim. */
export async function planAccruedPositionClaim({release,abi,actor,nonce,instance,positionSeq,positionAccount,destinationAccount,upToAccrued,maxRent}){
  const position=await decodeNativePosition(release,positionAccount,asBytes(instance,32),u64(positionSeq)),mint=await pda(release,'bio','lab-mint');
  let destination,labDestinationSetup;
  if(destinationAccount===null){
    destination=(await nativePda(PROGRAMS.associatedTokenProgram,position.beneficiary,nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address;
    labDestinationSetup={beneficiary:nativeKeyAddress(position.beneficiary)};
  }else{
    decodeClassicTokenAccount(destinationAccount,{expectedMint:mint,expectedOwner:position.beneficiary});destination=destinationAccount.address;
  }
  const upper=upToAccrued===undefined?position.accrued:u64(upToAccrued);
  check(position.paid<=upper&&upper<=position.accrued,'SETTLEMENT_UNACCRUED_CLAIM');
  const suffix=[{name:'LABMint',address:mint},{name:'LABReserve',address:await pda(release,'bio','lab-reserve')},
    {name:'LABAuth',address:await pda(release,'bio','lab-auth')},{name:'Treasury',address:await pda(release,'bio','treasury')},
    {name:'Position',address:positionAccount.address},{name:'Destination',address:destination}];
  return {...await action({release,abi,actor,nonce,operation:'CLAIM_POSITION',payload:encodeClaimPositionPayload({positionId:position.positionId,
    expectedPaid:position.paid,upToAccrued:upper,destination,rentPayer:actor,maxRent}),suffix}),
    ...(labDestinationSetup?{labDestinationSetup}:{}),beneficiary:nativeKeyAddress(position.beneficiary),previewAtoms:upper-position.paid,previewOnly:true};
}

/** Close only a fully allocated historical snapshot. The saved original
 * opener receives its SOL, independently of who triggers this operation. */
export async function planFinalHourClosure({release,abi,actor,nonce,hour,registryAccount,hourAccount,clockAccount,maxRent}){
  const reg=await decodeNativeRegistry(release,registryAccount),h=await decodeNativeHour(release,hourAccount,hour);
  check(clockTime(clockAccount)>=reg.highWater,'SETTLEMENT_CLOCK_REGRESSION');
  check(h.status===4&&hour<reg.nextHour&&(h.lazy||h.previousDirectory===h.tailDirectory),'SETTLEMENT_HOUR_NOT_CLOSABLE');
  check(h.members!==0n||h.headDirectory===MAX&&h.tailDirectory===MAX,'SETTLEMENT_EMPTY_HOUR_LINKS');
  const dynamicAccounts=h.rentPayer===nativeKeyAddress(actor)?[]:[{address:h.rentPayer,writable:true,signer:false}];
  return {...await action({release,abi,actor,nonce,operation:'CLOSE_FINAL_HOUR',payload:encodeCloseFinalHourPayload({hour,maxRent}),
    suffix:[{name:'Registry',address:registryAccount.address},{name:'Hour',address:hourAccount.address}],dynamicAccounts}),
    refundRecipient:h.rentPayer,previewRefundLamports:hourAccount.lamports,previewOnly:true};
}
