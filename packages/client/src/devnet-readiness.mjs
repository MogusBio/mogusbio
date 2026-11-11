import {createHash} from 'node:crypto';
import {isDevnetRelease,DEVNET_GENESIS_BASE58} from './cluster.mjs';
import {ReadOnlyRpc} from './rpc.mjs';
import {PROGRAMS} from './release.mjs';
import {nativePda,nativeKeyBytes,nativeKeyAddress} from './native.mjs';
import {decodeNativeBaseConfig,decodeClassicMint,decodeClassicTokenAccount} from './accounts.mjs';
import {decodeNativeEconomyConfig,decodeNativeClock,decodeNativeTreasury,validateNativeTreasuryBalances} from './economy-accounts.mjs';
import {decodeNativeOriginalityTask,decodeNativeOpeningSnapshot} from './originality-accounts.mjs';
import {TASK_FAMILY} from '../../originality/src/wire.mjs';
import {walletV1Capability} from './wallet-capability.mjs';

const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const absent=a=>a===null||a?.owner===PROGRAMS.systemProgram&&a.executable===false&&a.data?.length===0;
const unknown=()=>({status:'UNKNOWN'});
const safeCode=error=>typeof error?.code==='string'&&/^(?:RPC|ACCOUNT|ECONOMY|TREASURY|TOKEN|TASK|SNAPSHOT|ORIGINALITY|DEVNET)_[A-Z0-9_]{1,70}$/.test(error.code)?error.code:'DEVNET_READ_UNAVAILABLE';
function walletStatus(wallet){
  if(!wallet)return {status:'NOT_PROVIDED',version:1,accountAuthorizationChecked:false};
  const value=walletV1Capability(wallet,'solana:devnet');return {status:!value.v1?'V1_UNSUPPORTED':!value.network?'NETWORK_UNSUPPORTED':!value.canConnect||!value.canSign?'SIGNING_UNAVAILABLE':'CAPABLE',version:1,versionAdvertised:value.v1,networkAdvertised:value.network,accountAuthorizationChecked:false};
}
/** Read-only finalized facts, not deployment, wallet authorization or a transaction.
 * Use a reader allowing the deployed ProgramData allocation (commonly >1MiB).
 * Reward phase always uses the actual Clock sysvar, never the host's wall clock. */
export async function inspectDevnetReadiness({release,rpc,wallet=null}={}){
  check(isDevnetRelease(release),'DEVNET_RELEASE_REQUIRED');check(rpc instanceof ReadOnlyRpc,'DEVNET_READ_ONLY_RPC');
  const out={profile:'BIO-DEVNET-READINESS1',chain:'solana:devnet',genesis:DEVNET_GENESIS_BASE58,programId:release.input.programId,readOnly:true,networkSubmitted:false,transactionExecuted:false,productionAdmission:false,contextSlot:null,state:'UNAVAILABLE',readyForFunctionalTests:false,readyForWalletTest:false,checks:{network:unknown(),program:unknown(),base:unknown(),economy:unknown(),treasury:unknown(),opening:unknown(),clock:unknown(),rewards:{status:'UNKNOWN',rewardStart:release.rewardStart.toString()},wallet:walletStatus(wallet)}};
  try{await rpc.verifyGenesis();out.checks.network={status:'VERIFIED'};}catch(error){out.checks.network={status:error?.code==='RPC_GENESIS_MISMATCH'?'MISMATCH':'UNAVAILABLE',code:safeCode(error)};return out;}
  const pda=(...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address),keys={Program:release.input.programId,ProgramData:release.programDataAddress,Base:release.pdas.baseConfig.address,Economy:await pda('econ-config'),Clock:PROGRAMS.clockSysvar,Task:await pda('task',TASK_FAMILY),Snapshot:await pda('seed-final',TASK_FAMILY),Mint:release.pdas.labMint.address,Reserve:release.pdas.labReserve.address,Treasury:release.pdas.treasury.address};
  let read;try{read=await rpc.getMultipleAccounts(Object.values(keys));}catch(error){out.state='READ_UNAVAILABLE';out.readError=safeCode(error);return out;}
  out.contextSlot=read.contextSlot.toString();const accounts=new Map(Object.keys(keys).map((name,i)=>[name,read.accounts[i]])),get=name=>accounts.get(name);let clock=null,economy=null;
  try{clock=decodeNativeClock(get('Clock'));check(clock.slot<=read.contextSlot,'DEVNET_CLOCK_FUTURE');out.checks.clock={status:'VERIFIED',slot:clock.slot.toString(),unixTimestamp:clock.unixTimestamp.toString()};out.checks.rewards={status:clock.unixTimestamp<release.rewardStart?'WAIT_REWARD_START':'STARTED',rewardStart:release.rewardStart.toString(),secondsUntil:(clock.unixTimestamp<release.rewardStart?release.rewardStart-clock.unixTimestamp:0n).toString(),timeSource:'SOLANA_CLOCK'};}catch(error){out.checks.clock={status:'INVALID',code:safeCode(error)};}
  try{
    const p=get('Program'),d=get('ProgramData');if(absent(p))out.checks.program={status:'MISSING'};else{
      check(p.address===keys.Program&&p.owner===PROGRAMS.loaderProgram&&p.executable===true&&p.data.length===36&&p.data.readUInt32LE(0)===2&&p.data.subarray(4).equals(nativeKeyBytes(keys.ProgramData)),'DEVNET_PROGRAM_METADATA');
      check(!absent(d)&&d.address===keys.ProgramData&&d.owner===PROGRAMS.loaderProgram&&!d.executable&&d.data.length>45&&d.data.readUInt32LE(0)===3&&d.data[12]<=1,'DEVNET_PROGRAM_DATA_METADATA');const deployedSlot=d.data.readBigUInt64LE(4);check(deployedSlot<read.contextSlot,'DEVNET_PROGRAM_DEPLOY_SLOT');
      out.checks.program={status:d.data[12]===0?'IMMUTABLE':'UPGRADEABLE',deployedSlot:deployedSlot.toString(),...(d.data[12]===1?{upgradeAuthority:nativeKeyAddress(d.data.subarray(13,45))}:{}),programDataPayloadSha256:createHash('sha256').update(d.data.subarray(45)).digest('hex'),bytecodeBuildMatchVerified:false};
    }
  }catch(error){out.checks.program={status:'INVALID',code:safeCode(error)};}
  if(absent(get('Base')))out.checks.base={status:'MISSING'};else try{await decodeNativeBaseConfig(release,get('Base'));out.checks.base={status:'VERIFIED'};}catch(error){out.checks.base={status:'INVALID',code:safeCode(error)};}
  if(absent(get('Economy')))out.checks.economy={status:'MISSING'};else try{economy=await decodeNativeEconomyConfig(release,get('Economy'));check(!clock||economy.initializedAt<=clock.unixTimestamp,'DEVNET_INIT_FUTURE');out.checks.economy={status:'VERIFIED',initializedAt:economy.initializedAt.toString()};}catch(error){out.checks.economy={status:'INVALID',code:safeCode(error)};}
  if(['Mint','Reserve','Treasury'].some(name=>absent(get(name))))out.checks.treasury={status:'MISSING'};else try{const treasury=await decodeNativeTreasury(release,get('Treasury')),mint=decodeClassicMint(get('Mint'),{expectedAddress:keys.Mint,expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null}),reserve=decodeClassicTokenAccount(get('Reserve'),{expectedAddress:keys.Reserve,expectedMint:keys.Mint,expectedOwner:release.pdas.labAuthority.address,reserve:true}),balances=validateNativeTreasuryBalances(release,treasury,{mint,reserve});out.checks.treasury={status:'VERIFIED',mintSupply:balances.mintSupply.toString(),reserveAmount:balances.reserveAmount.toString()};}catch(error){out.checks.treasury={status:'INVALID',code:safeCode(error)};}
  try{
    if(absent(get('Task'))){check(absent(get('Snapshot')),'DEVNET_OPENING_WITHOUT_TASK');out.checks.opening={status:'NOT_INITIALIZED'};}
    else{const task=await decodeNativeOriginalityTask(release,get('Task'));check(!clock||task.highWater<=clock.unixTimestamp,'DEVNET_TASK_FUTURE');if(!task.opening){check(absent(get('Snapshot')),'DEVNET_OPENING_INCONSISTENT');out.checks.opening={status:task.paused?'PAUSED':'UNSEALED',knownCount:task.count.toString()};}else{check(!absent(get('Snapshot')),'DEVNET_OPENING_SNAPSHOT_MISSING');const snapshot=await decodeNativeOpeningSnapshot(release,get('Snapshot'));check(!clock||snapshot.createdAt<=clock.unixTimestamp&&snapshot.slot<=clock.slot,'DEVNET_OPENING_FUTURE');check(snapshot.seedCount<=task.count,'DEVNET_OPENING_COUNT');out.checks.opening={status:task.paused?'PAUSED':'SEALED',knownCount:task.count.toString(),sealedSeedCount:snapshot.seedCount.toString(),frontier:snapshot.best.cost.toString()};}}
  }catch(error){out.checks.opening={status:'INVALID',code:safeCode(error)};}
  const c=out.checks;
  out.state=c.program.status==='MISSING'?'PROGRAM_UNDEPLOYED':c.program.status!=='IMMUTABLE'?`PROGRAM_${c.program.status}`:c.base.status==='MISSING'?'BASE_NOT_INITIALIZED':c.base.status!=='VERIFIED'?'BASE_CONFIG_INVALID':c.economy.status==='MISSING'?'ECONOMY_NOT_INITIALIZED':c.economy.status!=='VERIFIED'?'ECONOMY_INVALID':c.treasury.status!=='VERIFIED'?`TREASURY_${c.treasury.status}`:c.clock.status!=='VERIFIED'?'CLOCK_INVALID':c.opening.status==='PAUSED'?'TASK_PAUSED':c.opening.status!=='SEALED'?'OPENING_NOT_FINALIZED':c.rewards.status!=='STARTED'?'WAIT_REWARD_START':'READY';
  out.readyForFunctionalTests=out.state==='READY';out.readyForWalletTest=out.readyForFunctionalTests&&c.wallet.status==='CAPABLE';return out;
}
