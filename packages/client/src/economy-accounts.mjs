import { ByteWriter,asBytes,typedHash } from '../../protocol-core/src/index.mjs';
import { TOTAL_SUPPLY } from '../../settlement/src/emission.mjs';
import { decodeNativeAccountRecord } from './accounts.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda } from './native.mjs';
import { baseConfigR2Id,PROGRAMS } from './release.mjs';

const MAX=(1n<<64n)-1n,MAX_I64=(1n<<63n)-1n;
const SYSVAR_OWNER='Sysvar1111111111111111111111111111111111111';
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const zero=bytes=>bytes.every(byte=>byte===0);
const u64=value=>{check(typeof value==='bigint'&&value>=0n&&value<=MAX,'ECONOMY_ACCOUNT_U64');return value;};
const le64=value=>new ByteWriter(8).u64(value).finish();
const positionId=(release,instance,sequence)=>typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(27).finish(),instance,le64(sequence)]));

/** Exact native RootReg25/schema1. Physical end boundaries are not capped at
 * H_END. This decoder establishes record facts, not current action eligibility. */
export async function decodeNativeRootRegistration(release,account,instance){
  const id=asBytes(instance,32),record=await decodeNativeAccountRecord(release,account,{kind:25,schemas:[1],
    seeds:['bio','root-reg',id],recordKey:id,maxBodyBytes:260}),b=record.body;
  check(b.length===260,'ROOT_REG_SIZE');
  const count=b.readBigUInt64LE(40),coverage=b.readBigUInt64LE(138),ordinaryTag=b[80],kTag=b[129],faultTag=b[203],cause=b[154];
  check(b.subarray(0,32).equals(id)&&coverage<=count&&b.readBigUInt64LE(252)===0n
    &&ordinaryTag<=1&&kTag<=1&&faultTag<=1&&cause<=3
    &&(coverage<count||b.readBigUInt64LE(146)===MAX),'ROOT_REG_FACTS');
  const ordinaryEnd=b.readBigUInt64LE(81),activationCount=b.readBigUInt64LE(89),kEnd=b.readBigUInt64LE(130),directory=b.readBigUInt64LE(244);
  check(count>0n||directory===MAX&&zero(b.subarray(48,80))&&ordinaryTag===1&&ordinaryEnd===0n,'ROOT_REG_EMPTY');
  check(ordinaryTag!==0||ordinaryEnd===0n,'ROOT_REG_ORDINARY_END');
  check(kTag!==0||kEnd===0n,'ROOT_REG_K_END');
  check(activationCount!==0n||zero(b.subarray(97,129))&&kTag===1&&kEnd===0n,'ROOT_REG_EMPTY_K');
  if(count>0n)check(directory!==MAX&&b.subarray(48,80).equals(positionId(release,id,count-1n)),'ROOT_REG_LAST_POSITION');
  check(cause===0?zero(b.subarray(155,203)):!zero(b.subarray(155,187))&&b.readBigInt64LE(187)>=0n,'ROOT_REG_REVOCATION');
  check(faultTag===0?zero(b.subarray(204,244)):!zero(b.subarray(204,236)),'ROOT_REG_CERTIFICATE_FAULT');
  return {schema:1,body:Buffer.from(b),instance:Buffer.from(id),revision:b.readBigUInt64LE(32),ordinaryCount:count,
    lastPositionId:Buffer.from(b.subarray(48,80)),ordinaryEndTag:ordinaryTag,ordinaryEnd:ordinaryTag===0?null:ordinaryEnd,
    activationCount,lastActivationId:Buffer.from(b.subarray(97,129)),kEndTag:kTag,kEnd:kTag===0?null:kEnd,
    coverageSequence:coverage,nextCoverageHour:b.readBigUInt64LE(146),revocationCause:cause,
    revocationBusiness:Buffer.from(b.subarray(155,187)),revocationTime:b.readBigInt64LE(187),revocationSlot:b.readBigUInt64LE(195),
    certificateFault:faultTag===1,certificateFaultBusiness:Buffer.from(b.subarray(204,236)),certificateFaultEvent:b.readBigUInt64LE(236),directorySequence:directory};
}

/** Runtime EconConfig36/schema3 consumed by native economic handlers. Explicit
 * public local fixtures still use the admitted production-admission schedule;
 * the historical acceptance-test adapter is not silently admitted here. */
export async function decodeNativeEconomyConfig(release,account){
  const record=await decodeNativeAccountRecord(release,account,{kind:36,schemas:[3],seeds:['bio','econ-config'],
    recordKey:baseConfigR2Id(release),maxBodyBytes:304}),b=record.body;
  check(b.length===304,'ECONOMY_CONFIG_SIZE');
  const [mint,reserve,authority]=await Promise.all(['lab-mint','lab-reserve','lab-auth'].map(seed=>nativePda(release.input.programId,'bio',seed)));
  check(b.subarray(0,8).equals(Buffer.from('ECOCFG03'))&&b.subarray(8,40).equals(release.hashes.releaseHash)
    &&b.subarray(40,72).equals(nativeKeyBytes(release.input.bootstrap))
    &&b.subarray(72,104).equals(nativeKeyBytes(mint.address))&&b.subarray(104,136).equals(nativeKeyBytes(reserve.address))
    &&b.subarray(136,168).equals(nativeKeyBytes(authority.address))&&b.readBigUInt64LE(168)===TOTAL_SUPPLY
    &&b[176]===6&&zero(b.subarray(177,184))&&b.subarray(192,224).equals(release.hashes.validatorHash)
    &&b.subarray(224,256).equals(release.hashes.ruleHash)&&b.subarray(272,304).equals(release.hashes.initialSeedSetId),'ECONOMY_CONFIG_RELEASE');
  const initializedAt=b.readBigInt64LE(184),seedOpen=b.readBigInt64LE(256),rewardStart=b.readBigInt64LE(264);
  check(initializedAt>=0n&&initializedAt>=release.initNotBefore&&initializedAt<=release.seedOpen
    &&seedOpen===release.seedOpen&&rewardStart===release.rewardStart&&seedOpen<=MAX_I64-86400n&&rewardStart===seedOpen+86400n,'ECONOMY_CONFIG_SCHEDULE');
  return {schema:3,body:Buffer.from(b),releaseHash:Buffer.from(b.subarray(8,40)),bootstrap:nativeKeyAddress(b.subarray(40,72)),
    labMint:mint.address,labReserve:reserve.address,labAuthority:authority.address,totalSupply:TOTAL_SUPPLY,decimals:6,initializedAt,
    validatorHash:Buffer.from(b.subarray(192,224)),ruleHash:Buffer.from(b.subarray(224,256)),seedOpen,rewardStart,
    initialSeedSetId:Buffer.from(b.subarray(272,304))};
}

function treasuryFields(values){
  check(Array.isArray(values)&&values.length===8,'TREASURY_FIELDS');values.forEach(u64);
  const [locked,pending,certified,sealed,burned,asOf,paid,reserved]=values;
  let bookSum=0n;for(const value of values.slice(0,4)){bookSum+=value;check(bookSum<=MAX,'TREASURY_BOOK_OVERFLOW');}
  check(burned<=TOTAL_SUPPLY&&reserved===0n,'TREASURY_FACTS');
  return {values:[...values],locked,pending,certified,sealed,burned,asOf,paid,reserved,bookSum};
}

/** Header and intrinsic book validation only. Native financial parity also
 * requires validateNativeTreasuryBalances with mint/reserve from the same read. */
export async function decodeNativeTreasury(release,account){
  const record=await decodeNativeAccountRecord(release,account,{kind:6,schemas:[1],seeds:['bio','treasury'],
    recordKey:baseConfigR2Id(release),maxBodyBytes:64}),b=record.body;
  check(b.length===64,'TREASURY_SIZE');
  return {schema:1,body:Buffer.from(b),...treasuryFields(Array.from({length:8},(_,i)=>b.readBigUInt64LE(i*8)))};
}

/** Inputs are actual outputs of the strict Classic SPL decoders. Obtain all
 * three records in one finalized batch; this pure check cannot prove finality.
 * Unsolicited reserve deposits stay sealed and never become reward budget. */
export function validateNativeTreasuryBalances(release,treasury,{mint,reserve}){
  const fields=treasuryFields(treasury?.values);
  check(mint?.address===release.pdas.labMint.address&&mint.decimals===6&&mint.mintAuthority===null&&mint.freezeAuthority===null,'TREASURY_MINT');
  check(reserve?.address===release.pdas.labReserve.address&&reserve.mint===release.pdas.labMint.address
    &&reserve.owner===release.pdas.labAuthority.address&&reserve.delegate===null&&reserve.delegatedAmount===0n&&reserve.closeAuthority===null,'TREASURY_RESERVE');
  const supply=u64(mint.supply),amount=u64(reserve.amount);
  check(fields.bookSum<=amount&&supply<=TOTAL_SUPPLY-fields.burned&&amount<=supply,'TREASURY_BALANCES');
  return {...treasury,...fields,reserveAmount:amount,mintSupply:supply,inboundSealed:amount-fields.bookSum};
}

/** Canonical raw Clock sysvar, not a native record header. Signed timestamp
 * fields remain signed; only the observed current timestamp must be nonnegative. */
export function decodeNativeClock(account){
  check(account?.address===PROGRAMS.clockSysvar&&account.owner===SYSVAR_OWNER&&account.executable===false,'ECONOMY_CLOCK_ACCOUNT');
  const b=asBytes(account.data);check(b.length===40,'ECONOMY_CLOCK_SIZE');
  const unixTimestamp=b.readBigInt64LE(32);check(unixTimestamp>=0n,'ECONOMY_CLOCK_TIME');
  return {slot:b.readBigUInt64LE(0),epochStartTimestamp:b.readBigInt64LE(8),epoch:b.readBigUInt64LE(16),
    leaderScheduleEpoch:b.readBigUInt64LE(24),unixTimestamp,bytes:Buffer.from(b)};
}
