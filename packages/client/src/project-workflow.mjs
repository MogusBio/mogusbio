import { asBytes,typedHash,businessKey } from '../../protocol-core/src/index.mjs';
import { CREATE_FEE,MAX_UNIT_PRICE,materialSeason } from '../../launchpad/src/index.mjs';
import { ReadOnlyRpc } from './rpc.mjs';
import { baseConfigR2Id,PROGRAMS } from './release.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda,nativePrefix,nativeNonceOpId,nativeBusinessKey,nativeOperation,
  encodeNativeFrame,decodeNativeFrame,validateNativeResult,encodeCreateProjectPayload,buildNativeInstruction,canonicalNativeWalletTable } from './native.mjs';
import { decodeNativeAccountRecord,decodeNativeBaseConfig } from './accounts.mjs';
import { decodeNativeEconomyConfig,decodeNativeClock } from './economy-accounts.mjs';
import { decodeActorNonceSnapshot } from './journal.mjs';

const MAX=(1n<<64n)-1n;
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
function fields(value,required,optional=[]){
  check(value&&typeof value==='object'&&!Array.isArray(value),'PROJECT_FIELDS');
  const keys=Reflect.ownKeys(value);
  check(keys.every(key=>typeof key==='string'&&[...required,...optional].includes(key))&&required.every(key=>Object.hasOwn(value,key)),'PROJECT_FIELDS');
}
const u64=value=>{check(typeof value==='bigint'&&value>=0n&&value<=MAX,'PROJECT_U64');return value;};
const fresh=account=>account===null||account.owner===PROGRAMS.systemProgram&&account.executable===false&&account.data.length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable
  &&a.lamports===b.lamports&&a.data.equals(b.data);
const pda=async(release,...seeds)=>(await nativePda(release.input.programId,'bio',...seeds)).address;
function ordinary(account){
  check(account!==null&&account.owner===PROGRAMS.systemProgram&&account.executable===false&&account.data.length===0,'PROJECT_ORDINARY_WALLET');
  return account;
}
function seasonAt(release,clock){
  try{return materialSeason(clock.unixTimestamp,release.seedOpen);}catch(error){if(error.code===6311)return null;throw error;}
}
async function identity(release,actor,nonce){
  const business=businessKey(release.domain,nativeKeyBytes(actor),nativeNonceOpId(nonce));
  const id=typedHash(17,Buffer.concat([release.domain,business])),address=await pda(release,'project',id);
  const mints=await Promise.all([1,2,3,4].map(async classId=>({class:classId,address:await pda(release,'pack',id,Buffer.from([classId])),
    authority:await pda(release,'pack-auth',id,Buffer.from([classId]))})));
  return {id,business,address,mints};
}
const result=(decision,preview,reason)=>({decision,...(reason===undefined?{}:{reason}),contextSlot:preview.contextSlot,preview,
  clientPlanOnly:true,transactionExecuted:false,businessExecutionVerified:false,networkSubmitted:false,requiresSimulation:true,
  rentSufficiencyVerified:false,aggregateFundingVerified:false,networkFeeQuote:null});

/** One unsigned CREATE_PROJECT proposal from actual finalized inputs. Actor
 * owns creator, creation-fee, rent and network-fee roles. An optional seller is
 * a passive actual ordinary wallet. No nonce reservation or execution occurs. */
export async function planCreateProject(args){
  fields(args,['release','abi','rpc','actor','name','classes','maxCreationFee','maxRent'],['seller']);
  const {release,abi,rpc}=args;check(rpc instanceof ReadOnlyRpc,'PROJECT_READ_ONLY_RPC');
  check(abi.hash===release.hashes.abiHash.toString('hex'),'PROJECT_ABI');const op=nativeOperation(abi,'CREATE_PROJECT');
  const actor=nativeKeyAddress(args.actor),seller=Object.hasOwn(args,'seller')?nativeKeyAddress(args.seller):actor;
  const maxCreationFee=u64(args.maxCreationFee),maxRent=u64(args.maxRent),name=args.name;
  check(typeof name==='string','PROJECT_NAME');const nameBytes=Buffer.from(name,'utf8');
  check(nameBytes.length>=1&&nameBytes.length<=64&&nameBytes.toString('utf8')===name&&!/[\u0000-\u001f\u007f]/.test(name),'PROJECT_NAME');
  check(Array.isArray(args.classes)&&args.classes.length===4,'PROJECT_CLASSES');
  const classes=Array.from(args.classes,(value,i)=>{
    fields(value,['class','cap','unitPrice']);const {class:classId,cap,unitPrice}=value;
    check(classId===i+1&&typeof classId==='number','PROJECT_CLASSES');u64(cap);u64(unitPrice);
    check(cap>=1n&&cap<=1000000n&&unitPrice<=MAX_UNIT_PRICE,'PROJECT_CLASSES');return {class:classId,cap,unitPrice};
  });
  // Validate the signing actor before any transport is used; seller need not
  // sign, as in native ordinary_wallet(seller, false).
  const prefix=await nativePrefix(release,actor);
  await rpc.verifyBaseConfig();const observed=await rpc.getActorNonce(actor);
  const predicted=await identity(release,actor,observed.nextNonce),econAddress=prefix[2].address,nonceAddress=prefix[1].address,
    opsAddress=await pda(release,'ops');
  const fixed=[...prefix.map(row=>row.address),predicted.address,...predicted.mints.map(m=>m.address),...predicted.mints.map(m=>m.authority),opsAddress];
  check(!fixed.slice(1).includes(actor)&&!fixed.slice(1).includes(seller),'PROJECT_WALLET_ALIAS');
  check(new Set(fixed).size===fixed.length,'PROJECT_ACCOUNT_ALIAS');
  const addresses=[...new Set([release.pdas.baseConfig.address,econAddress,PROGRAMS.clockSysvar,nonceAddress,actor,seller,
    predicted.address,...predicted.mints.map(m=>m.address),...predicted.mints.map(m=>m.authority),opsAddress])];
  const batch=await rpc.getMultipleAccounts(addresses),map=new Map(addresses.map((address,i)=>[address,batch.accounts[i]]));
  await decodeNativeBaseConfig(release,map.get(release.pdas.baseConfig.address));await decodeNativeEconomyConfig(release,map.get(econAddress));
  const clock=decodeNativeClock(map.get(PROGRAMS.clockSysvar)),season=seasonAt(release,clock);
  const nonce=await decodeActorNonceSnapshot({release,actor,address:nonceAddress,account:map.get(nonceAddress),contextSlot:batch.contextSlot,commitment:'finalized'});
  const preview={contextSlot:batch.contextSlot,actor,creator:actor,principalPayer:actor,rentPayer:actor,feePayer:actor,seller,
    maxCreationFee,maxRent,observedNextNonce:nonce.nextNonce,clock,season,projectId:predicted.id.toString('hex'),
    creationBusiness:predicted.business.toString('hex'),project:{address:predicted.address,name,seller,classes},mints:predicted.mints,
    predictionOnly:true,unverifiedNativeChecks:['rentExemption','aggregateRentAndCreationFeeFunding','networkFees','runtimeProgramExecutability']};
  if(nonce.nextNonce!==observed.nextNonce)return result('REPLAN_STALE_STATE',preview,'ACTOR_NONCE_CHANGED');
  if(nonce.nextNonce===MAX)return result('BLOCKED',preview,'ACTOR_NONCE_EXHAUSTED');
  const actorAccount=ordinary(map.get(actor));ordinary(map.get(seller));
  const opsAccount=map.get(opsAddress),newOps=fresh(opsAccount);
  if(!newOps){
    const ops=await decodeNativeAccountRecord(release,opsAccount,{kind:7,schemas:[1],seeds:['bio','ops'],recordKey:baseConfigR2Id(release),maxBodyBytes:16});
    check(ops.body.length===16,'PROJECT_OPS_STATE');
  }
  // Native CREATE always allocates Project and all four mints. Existing native
  // or token records cannot be mistaken for a successful retry or new target.
  check(fresh(map.get(predicted.address)),'PROJECT_TARGET_NOT_FRESH');
  for(const mint of predicted.mints)check(fresh(map.get(mint.address)),'PROJECT_MINT_NOT_FRESH');
  const allocation=(address,bytes)=>({address,bytes,prefundedLamports:map.get(address)?.lamports??0n,creationRequired:true});
  preview.allocations=[allocation(predicted.address,528+nameBytes.length),...predicted.mints.map(m=>allocation(m.address,82)),
    ...(fresh(map.get(nonceAddress))?[allocation(nonceAddress,418)]:[]),...(newOps?[allocation(opsAddress,136)]:[])];
  preview.authorities=predicted.mints.map(m=>({class:m.class,address:m.authority,exists:map.get(m.authority)!==null,allocationRequired:false}));
  preview.ops={address:opsAddress,creationRequired:newOps,prefundedLamports:newOps?(opsAccount?.lamports??0n):0n};
  preview.principal={creationFeeLamports:CREATE_FEE,actorLamports:actorAccount.lamports,includesUnknownRent:false,includesNetworkFees:false};
  if(season===null)return result('BLOCKED',preview,'OUTSIDE_ISSUANCE_WINDOW');
  if(maxCreationFee<CREATE_FEE)return result('BLOCKED',preview,'CREATION_FEE_CAP_TOO_LOW');
  if(actorAccount.lamports<CREATE_FEE)return result('BLOCKED',preview,'CREATION_FEE_BALANCE_TOO_LOW');
  const last=await rpc.getMultipleAccounts(addresses),lastMap=new Map(addresses.map((address,i)=>[address,last.accounts[i]]));
  preview.contextSlot=last.contextSlot;const lastClock=decodeNativeClock(lastMap.get(PROGRAMS.clockSysvar));
  check(lastClock.slot>=clock.slot&&lastClock.unixTimestamp>=clock.unixTimestamp,'PROJECT_CLOCK_REGRESSION');
  if(seasonAt(release,lastClock)!==season||addresses.some(address=>address!==PROGRAMS.clockSysvar&&!same(map.get(address),lastMap.get(address))))
    return result('REPLAN_STALE_STATE',preview,'FINALIZED_INPUT_CHANGED');
  preview.clock=lastClock;
  const payload=encodeCreateProjectPayload({catalogHash:release.hashes.catalogHash,seller,feePayer:actor,rentPayer:actor,maxCreationFee,maxRent,name,classes});
  const keys={Project:predicted.address,OpsVault:opsAddress};
  for(const [i,label]of ['AA','NUC','LIPID','SUGAR'].entries()){
    keys[`${label}_Mint`]=predicted.mints[i].address;keys[`${label}_Auth`]=predicted.mints[i].authority;
  }
  const suffix=op.publicFixedSuffix.map(row=>({name:row.role,address:keys[row.role]}));
  const dynamicAccounts=canonicalNativeWalletTable(actor,[{address:seller,writable:false,signer:false}]);
  const frame=encodeNativeFrame(abi,{operation:'CREATE_PROJECT',domain:release.domain,configId:baseConfigR2Id(release),actor,nonce:nonce.nextNonce,payload});
  const instruction=await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts});
  const action={operation:'CREATE_PROJECT',nonce:nonce.nextNonce,payload,suffix,dynamicAccounts,frame,instruction,clientPlanOnly:true,transactionExecuted:false};
  return {...result('ACTION',preview),action};
}

/** Decode and bind native's 208-byte CREATE result to an exact frame. The
 * caller must independently establish finalized execution/result provenance. */
export async function decodeNativeCreateProjectResult({release,abi,frame,result:bytes}){
  check(abi.hash===release.hashes.abiHash.toString('hex'),'PROJECT_ABI');
  const f=decodeNativeFrame(abi,frame);check(f.operation==='CREATE_PROJECT'&&f.domain.equals(release.domain)
    &&f.configId.equals(baseConfigR2Id(release)),'PROJECT_RESULT_FRAME');
  const b=validateNativeResult(abi,frame,asBytes(bytes)),predicted=await identity(release,nativeKeyAddress(f.actor),f.nonce);
  check(predicted.business.equals(nativeBusinessKey(abi,frame))&&b.subarray(0,32).equals(predicted.id)
    &&nativeKeyAddress(b.subarray(32,64))===predicted.address,'PROJECT_RESULT_IDENTITY');
  for(let i=0;i<4;i++)check(nativeKeyAddress(b.subarray(64+i*32,96+i*32))===predicted.mints[i].address,'PROJECT_RESULT_MINT');
  const creationFeeLamports=b.readBigUInt64LE(192),rentLamports=b.readBigUInt64LE(200);
  check(creationFeeLamports===CREATE_FEE&&creationFeeLamports<=f.payload.readBigUInt64LE(128)
    &&rentLamports<=f.payload.readBigUInt64LE(136),'PROJECT_RESULT_COST');
  return {projectId:Buffer.from(predicted.id),projectAddress:predicted.address,mints:predicted.mints.map(m=>m.address),
    creationFeeLamports,rentLamports,bytes:Buffer.from(b),businessExecutionVerified:false};
}
