import { asBytes } from '../../protocol-core/src/index.mjs';
import { RESOURCE_FEE_PER_UNIT,SEASON_CAPS,LIFETIME_CAPS,materialSeason,quotaKey } from '../../launchpad/src/index.mjs';
import { ReadOnlyRpc } from './rpc.mjs';
import { baseConfigR2Id,PROGRAMS } from './release.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda,nativeOperation,encodeNativeFrame,encodeBuyMaterialPayload,buildNativeInstruction,canonicalNativeWalletTable } from './native.mjs';
import { decodeNativeAccountRecord,decodeNativeBaseConfig,decodeNativeProject,decodeClassicMint,decodeClassicTokenAccount } from './accounts.mjs';
import { decodeNativeEconomyConfig,decodeNativeClock } from './economy-accounts.mjs';
import { decodeActorNonceSnapshot } from './journal.mjs';

const MAX=(1n<<64n)-1n;
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const fields=(v,list)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...list].sort().join(','),'PURCHASE_FIELDS');
const u64=v=>{check(typeof v==='bigint'&&v>=0n&&v<=MAX,'PURCHASE_U64');return v;};
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&a.data.length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&a.lamports===b.lamports&&a.data.equals(b.data);
const pda=(release,...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
function ordinary(account){check(account!==null&&account.owner===PROGRAMS.systemProgram&&account.executable===false&&account.data.length===0,'PURCHASE_ORDINARY_WALLET');return account;}
function checkedAdd(a,b){const n=u64(a)+u64(b);check(n<=MAX,'PURCHASE_OVERFLOW');return n;}
function checkedMul(a,b){const n=u64(a)*u64(b);check(n<=MAX,'PURCHASE_OVERFLOW');return n;}
async function quota(release,account,classId,season,lifetime){
  if(fresh(account))return {issued:0n,fresh:true};
  const c=Buffer.from([classId]),s=Buffer.alloc(2);s.writeUInt16LE(season);
  const r=await decodeNativeAccountRecord(release,account,{kind:lifetime?22:21,schemas:[1],seeds:lifetime?['bio','issued',c]:['bio','season',c,s],
    recordKey:quotaKey(release.domain,lifetime?2:1,classId,lifetime?65535:season),maxBodyBytes:lifetime?9:11});
  check(r.body.length===(lifetime?9:11)&&r.body[0]===classId&&(lifetime||r.body.readUInt16LE(1)===season),'PURCHASE_QUOTA_STATE');
  const issued=r.body.readBigUInt64LE(lifetime?1:3);check(issued<=(lifetime?LIFETIME_CAPS:SEASON_CAPS)[classId-1],'PURCHASE_QUOTA_STATE');
  return {issued,fresh:false};
}
function seasonAt(release,clock){
  try{return materialSeason(clock.unixTimestamp,release.seedOpen);}catch(error){if(error.code===6311)return null;throw error;}
}
const result=(decision,observations,reason)=>({decision,...(reason===undefined?{}:{reason}),contextSlot:observations.contextSlot,preview:observations,
  clientPlanOnly:true,transactionExecuted:false,businessExecutionVerified:false,networkSubmitted:false,requiresSimulation:true,
  rentSufficiencyVerified:false,networkFeeQuote:null});

/** One unsigned self-purchase proposal from actual finalized accounts. The
 * actor pays principal, rent and network fees and receives its canonical ATA.
 * This does not certify rent/gross funding or reserve the observed nonce. */
export async function planSelfPurchase(args){
  fields(args,['release','abi','rpc','actor','projectId','class','quantity','maxPayment','maxRent']);
  const {release,abi,rpc}=args;check(rpc instanceof ReadOnlyRpc,'PURCHASE_READ_ONLY_RPC');
  check(abi.hash===release.hashes.abiHash.toString('hex'),'PURCHASE_ABI');const op=nativeOperation(abi,'BUY_MATERIAL');
  const actor=nativeKeyAddress(args.actor),projectId=Buffer.from(asBytes(args.projectId,32)),classId=args.class;
  check(Number.isInteger(classId)&&classId>=1&&classId<=4,'PURCHASE_CLASS');
  const quantity=u64(args.quantity),maxPayment=u64(args.maxPayment),maxRent=u64(args.maxRent);
  check(quantity>=1n&&quantity<=1000n,'PURCHASE_QUANTITY');
  const projectAddress=await pda(release,'project',projectId),econAddress=await pda(release,'econ-config'),nonceAddress=await pda(release,'actor-nonce',nativeKeyBytes(actor)),opsAddress=await pda(release,'ops');
  await rpc.verifyBaseConfig();const observed=await rpc.getActorNonce(actor);
  const discovery=await rpc.getMultipleAccounts([projectAddress,econAddress,PROGRAMS.clockSysvar]);
  const observations={contextSlot:discovery.contextSlot,actor,projectId:projectId.toString('hex'),class:classId,quantity,observedNextNonce:observed.nextNonce,
    selfPurchaseOnly:true,principalPayer:actor,rentPayer:actor,recipient:actor,feePayer:actor,
    maxPayment,maxRent,unverifiedNativeChecks:['rentExemption','aggregateRentAndGrossFunding','networkFees','runtimeProgramExecutability']};
  if(discovery.accounts[0]===null)return result('BLOCKED',observations,'PROJECT_NOT_FOUND');
  const firstProject=await decodeNativeProject(release,discovery.accounts[0],projectId);
  await decodeNativeEconomyConfig(release,discovery.accounts[1]);const firstClock=decodeNativeClock(discovery.accounts[2]),season=seasonAt(release,firstClock);
  observations.clock=firstClock;observations.season=season;
  if(season===null)return result('BLOCKED',observations,'OUTSIDE_ISSUANCE_WINDOW');
  const seller=nativeKeyAddress(firstProject.saleRecipient),mintAddress=await pda(release,'pack',projectId,Buffer.from([classId]));
  const authorityAddress=await pda(release,'pack-auth',projectId,Buffer.from([classId])),s=Buffer.alloc(2);s.writeUInt16LE(season);
  const seasonAddress=await pda(release,'season',Buffer.from([classId]),s),lifetimeAddress=await pda(release,'issued',Buffer.from([classId]));
  const destination=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mintAddress))).address;
  const addresses=[...new Set([release.pdas.baseConfig.address,econAddress,PROGRAMS.clockSysvar,nonceAddress,actor,seller,projectAddress,mintAddress,authorityAddress,seasonAddress,lifetimeAddress,opsAddress,destination])];
  const batch=await rpc.getMultipleAccounts(addresses),map=new Map(addresses.map((address,i)=>[address,batch.accounts[i]]));
  observations.contextSlot=batch.contextSlot;
  await decodeNativeBaseConfig(release,map.get(release.pdas.baseConfig.address));await decodeNativeEconomyConfig(release,map.get(econAddress));
  const clock=decodeNativeClock(map.get(PROGRAMS.clockSysvar)),currentSeason=seasonAt(release,clock);
  if(clock.slot<firstClock.slot||clock.unixTimestamp<firstClock.unixTimestamp)check(false,'PURCHASE_CLOCK_REGRESSION');
  if(currentSeason!==season||!same(discovery.accounts[0],map.get(projectAddress)))return result('REPLAN_STALE_STATE',observations,'DISCOVERY_CHANGED');
  const nonce=await decodeActorNonceSnapshot({release,actor,address:nonceAddress,account:map.get(nonceAddress),contextSlot:batch.contextSlot,commitment:'finalized'});
  if(nonce.nextNonce!==observed.nextNonce)return result('REPLAN_STALE_STATE',observations,'ACTOR_NONCE_CHANGED');
  if(nonce.nextNonce===MAX)return result('BLOCKED',observations,'ACTOR_NONCE_EXHAUSTED');
  const project=await decodeNativeProject(release,map.get(projectAddress),projectId),c=project.classes[classId-1];
  const actorAccount=ordinary(map.get(actor)),sellerAccount=ordinary(map.get(seller));
  const mint=decodeClassicMint(map.get(mintAddress),{expectedAddress:mintAddress,expectedDecimals:0,expectedMintAuthority:authorityAddress,expectedFreezeAuthority:null});
  check(mint.supply<=c.issued-c.intakeBurned,'PURCHASE_MINT_SUPPLY');
  const seasonal=await quota(release,map.get(seasonAddress),classId,season,false),lifetime=await quota(release,map.get(lifetimeAddress),classId,season,true);
  check(lifetime.issued>=seasonal.issued&&lifetime.issued>=c.issued&&(!lifetime.fresh||seasonal.issued===0n&&c.issued===0n),'PURCHASE_QUOTA_HEALTH');
  const destinationAccount=map.get(destination),newDestination=fresh(destinationAccount);
  const token=newDestination?{amount:0n}:decodeClassicTokenAccount(destinationAccount,{expectedAddress:destination,expectedMint:mintAddress,expectedOwner:actor});
  if(fresh(map.get(opsAddress)))return result('BLOCKED',observations,'OPS_NOT_INITIALIZED');
  const ops=await decodeNativeAccountRecord(release,map.get(opsAddress),{kind:7,schemas:[1],seeds:['bio','ops'],recordKey:baseConfigR2Id(release),maxBodyBytes:16});
  check(ops.body.length===16,'PURCHASE_OPS_STATE');
  const sale=checkedMul(quantity,c.priceLamports),resource=checkedMul(quantity,RESOURCE_FEE_PER_UNIT),principal=checkedAdd(sale,resource);
  observations.clock=clock;observations.season=season;observations.observedNextNonce=nonce.nextNonce;
  observations.project={address:projectAddress,name:project.name,seller,unitPrice:c.priceLamports,cap:c.lifetimeCap,issued:c.issued,intakeBurned:c.intakeBurned};
  observations.mint={address:mintAddress,authority:authorityAddress,supply:mint.supply,decimals:mint.decimals};
  observations.destination={address:destination,owner:actor,mode:1,creationRequired:newDestination,prefundedLamports:newDestination?(destinationAccount?.lamports??0n):0n,amount:token.amount};
  observations.quotas={seasonal:{address:seasonAddress,issued:seasonal.issued,cap:SEASON_CAPS[classId-1],fresh:seasonal.fresh},
    lifetime:{address:lifetimeAddress,issued:lifetime.issued,cap:LIFETIME_CAPS[classId-1],fresh:lifetime.fresh}};
  observations.principal={saleLamports:sale,resourceLamports:resource,resourceFeePerUnit:RESOURCE_FEE_PER_UNIT,totalLamports:principal,
    actorLamports:actorAccount.lamports,includesUnknownRent:false,includesNetworkFees:false,selfSaleStillRequiresGrossPrincipal:seller===actor};
  if(principal>maxPayment)return result('BLOCKED',observations,'PAYMENT_CAP_TOO_LOW');
  if(actorAccount.lamports<principal)return result('BLOCKED',observations,'PRINCIPAL_BALANCE_TOO_LOW');
  if(quantity>c.lifetimeCap-c.issued)return result('BLOCKED',observations,'PROJECT_CAP_EXCEEDED');
  if(quantity>SEASON_CAPS[classId-1]-seasonal.issued)return result('BLOCKED',observations,'SEASON_CAP_EXCEEDED');
  if(quantity>LIFETIME_CAPS[classId-1]-lifetime.issued)return result('BLOCKED',observations,'LIFETIME_CAP_EXCEEDED');
  checkedAdd(token.amount,quantity);checkedAdd(mint.supply,quantity);if(seller!==actor)checkedAdd(sellerAccount.lamports,sale);
  const last=await rpc.getMultipleAccounts(addresses),lastMap=new Map(addresses.map((address,i)=>[address,last.accounts[i]]));
  observations.contextSlot=last.contextSlot;const lastClock=decodeNativeClock(lastMap.get(PROGRAMS.clockSysvar));
  check(lastClock.slot>=clock.slot&&lastClock.unixTimestamp>=clock.unixTimestamp,'PURCHASE_CLOCK_REGRESSION');
  if(seasonAt(release,lastClock)!==season||addresses.some(address=>address!==PROGRAMS.clockSysvar&&!same(map.get(address),lastMap.get(address))))
    return result('REPLAN_STALE_STATE',observations,'FINALIZED_INPUT_CHANGED');
  observations.clock=lastClock;
  const payload=encodeBuyMaterialPayload({projectId,class:classId,mint:mintAddress,catalogHash:release.hashes.catalogHash,quantity,
    payer:actor,recipient:actor,destination,destinationMode:1,seller,unitPrice:c.priceLamports,resourceFee:RESOURCE_FEE_PER_UNIT,maxPayment,rentPayer:actor,maxRent,season});
  const keys={Project:projectAddress,Mint:mintAddress,PackAuthority:authorityAddress,SeasonQuota:seasonAddress,LifetimeQuota:lifetimeAddress,
    OpsVault:opsAddress,Destination:destination,AssociatedTokenProgram:PROGRAMS.associatedTokenProgram};
  const suffix=op.publicFixedSuffix.map(row=>({name:row.role,address:keys[row.role]}));
  const dynamicAccounts=canonicalNativeWalletTable(actor,[{address:seller,writable:true,signer:false}]);
  const frame=encodeNativeFrame(abi,{operation:'BUY_MATERIAL',domain:release.domain,configId:baseConfigR2Id(release),actor,nonce:nonce.nextNonce,payload});
  const instruction=await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts});
  const action={operation:'BUY_MATERIAL',nonce:nonce.nextNonce,payload,suffix,dynamicAccounts,frame,instruction,clientPlanOnly:true,transactionExecuted:false};
  return {...result('ACTION',observations),action};
}
