import {isOffCurveAddress} from '@solana/kit';
import {asBytes,sha256} from '../../protocol-core/src/index.mjs';
import {members,validateGraph,encodeGraph} from '../../biology/src/graph.mjs';
import {encodeLeafMap} from '../../composition/src/payload.mjs';
import {ReadOnlyRpc} from './rpc.mjs';
import {PROGRAMS,baseConfigR2Id} from './release.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativePda} from './native.mjs';
import {decodeNativeBaseConfig,decodeNativeRoot} from './accounts.mjs';
import {decodeNativeClock,decodeNativeEconomyConfig,decodeNativeRootRegistration} from './economy-accounts.mjs';
import {decodeActorNonceSnapshot} from './journal.mjs';
import {decodeNativeSealedSynthesisArtifact,planSynthesisPayload} from './synthesis-workflow.mjs';

export const SYNTHESIS_INPUT_LIMITS=Object.freeze({direct:6,accounts:23});
const MAX=(1n<<64n)-1n;
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const hex=value=>Buffer.from(value).toString('hex');
const pda=(release,...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
const fields=(value,names)=>check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...names].sort().join(','),'SYN_INPUT_FIELDS');
const fresh=account=>account===null||account.owner===PROGRAMS.systemProgram&&account.executable===false&&asBytes(account.data).length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable&&a.lamports===b.lamports&&asBytes(a.data).equals(asBytes(b.data));
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,reservesOnChainNonce:false,knownInputsOnly:true};
const expectedDirect=target=>target<=15?[1,2,3,4]:target<=21?members(target):[16,17,18,19,20,21];
function targetValue(target){check(Number.isInteger(target)&&target>=1&&target<=22,'SYN_INPUT_TARGET');return target;}
function directValues(values,target){
  check(Array.isArray(values)&&values.length===expectedDirect(target).length&&values.length<=SYNTHESIS_INPUT_LIMITS.direct,'SYN_INPUT_COUNT');
  const copied=values.map(value=>Buffer.from(asBytes(value,32)));check(new Set(copied.map(hex)).size===copied.length,'SYN_INPUT_DUPLICATE_ID');return copied.sort(Buffer.compare);
}
async function batch(rpc,keys){
  const addresses=[...new Set(Object.values(keys))];check(addresses.length<=SYNTHESIS_INPUT_LIMITS.accounts,'SYN_INPUT_ACCOUNT_BOUND');
  const {contextSlot,accounts}=await rpc.getMultipleAccounts(addresses);return {contextSlot,accounts:new Map(addresses.map((a,i)=>[a,accounts[i]]))};
}
async function common(release,actor,keys,read){
  const get=name=>read.accounts.get(keys[name]);await decodeNativeBaseConfig(release,get('Base'));
  const economy=await decodeNativeEconomyConfig(release,get('Economy')),clock=decodeNativeClock(get('Clock')),wallet=get('Actor');
  check(wallet&&wallet.address===actor&&wallet.owner===PROGRAMS.systemProgram&&wallet.executable===false&&asBytes(wallet.data).length===0&&actor!==PROGRAMS.systemProgram&&!isOffCurveAddress(actor),'SYN_INPUT_ACTOR_WALLET');
  check(clock.unixTimestamp>=economy.initializedAt,'SYN_INPUT_CLOCK_BEFORE_INIT');
  const nonce=await decodeActorNonceSnapshot({release,actor,address:keys.Nonce,account:get('Nonce'),contextSlot:read.contextSlot,commitment:'finalized'});
  return {economy,clock,nonce,actorLamports:wallet.lamports};
}
function forward(first,last){
  check(last.clock.slot>=first.clock.slot&&last.clock.unixTimestamp>=first.clock.unixTimestamp,'SYN_INPUT_CLOCK_REGRESSION');
  check(last.nonce.nextNonce>=first.nonce.nextNonce,'SYN_INPUT_NONCE_REGRESSION');
}
function stable(first,last,keys){return Object.entries(keys).every(([name,address])=>name==='Clock'||same(first.accounts.get(address),last.accounts.get(address)));}
async function roots(release,keys,read,ids,commonFacts){
  const rows=[];
  for(const instance of ids){
    const account=read.accounts.get(keys[`Root:${hex(instance)}`]),root=await decodeNativeRoot(release,account,instance),rootReg=read.accounts.get(keys[`RootReg:${hex(instance)}`]);
    check(root.createdAt>=commonFacts.economy.initializedAt&&root.createdAt<=commonFacts.clock.unixTimestamp&&root.createdSlot<=commonFacts.clock.slot,'SYN_INPUT_ROOT_TIME');
    if(root.lifecycle===1)check(account.data.readBigInt64LE(427)<=commonFacts.clock.unixTimestamp&&account.data.readBigUInt64LE(435)<=commonFacts.clock.slot,'SYN_INPUT_CONSUMPTION_TIME');
    const registration=fresh(rootReg)?null:await decodeNativeRootRegistration(release,rootReg,instance);
    if(registration){
      check(registration.revocationCause===0||registration.revocationTime<=commonFacts.clock.unixTimestamp&&registration.revocationSlot<=commonFacts.clock.slot,'SYN_INPUT_REGISTRATION_TIME');
    }
    rows.push({instance,account,rootReg,root,registration});
  }
  return rows;
}
async function complete(release,actor,target,keys,read,ids){
  const facts=await common(release,actor,keys,read),rows=await roots(release,keys,read,ids,facts);
  const expected=expectedDirect(target),schema=target<=15?1:target<=21?2:3,key=root=>target<=15?root.descriptor[2]:root.target;
  rows.sort((a,b)=>(key(a.root)??0)-(key(b.root)??0)||Buffer.compare(a.instance,b.instance));
  const hierarchy=rows.every((row,i)=>row.root.schema===schema&&key(row.root)===expected[i]);
  const boundary=facts.clock.unixTimestamp<facts.economy.rewardStart?0n:(facts.clock.unixTimestamp-facts.economy.rewardStart)/3600n;
  const directInputs=[],eligibility=[],summaries=[];
  for(const row of rows){
    const {instance,account,rootReg,root,registration:r}=row;let originalArtifact;
    if(root.schema>1){
      const id=account.data.subarray(443,475);originalArtifact=read.accounts.get(keys[`Artifact:${hex(id)}`]);
      check(originalArtifact!==undefined,'SYN_INPUT_ARTIFACT_CLOSURE');
      const artifact=await decodeNativeSealedSynthesisArtifact(release,originalArtifact,{expectedId:id});
      check(artifact.hash.equals(account.data.subarray(475,507))&&artifact.totalLength===account.data.readUInt32LE(507)
        &&sha256(encodeGraph(artifact.payload.graph)).equals(account.data.subarray(511,543))
        &&sha256(encodeLeafMap(artifact.payload.leaves)).equals(account.data.subarray(543,575))
        &&artifact.payload.graph.target===root.target,'SYN_INPUT_ARTIFACT_BINDING');
      const sealedAt=originalArtifact.data.readBigInt64LE(235),sealedSlot=originalArtifact.data.readBigUInt64LE(243);
      check(sealedAt<=root.createdAt&&sealedSlot<=root.createdSlot&&sealedAt>=facts.economy.initializedAt,'SYN_INPUT_ARTIFACT_TIME');
    }
    const reasons=[];
    if(root.owner!==actor)reasons.push('OWNER_MISMATCH');
    if(root.lifecycle!==0)reasons.push('INPUT_ALREADY_CONSUMED');
    if(!hierarchy)reasons.push('DIRECT_HIERARCHY_MISMATCH');
    if(target<=15&&root.schema===1&&root.descriptor[2]===4&&root.descriptor[3]!==target)reasons.push('SERVICE_PROFILE_MISMATCH');
    if(r){
      if(r.certificateFault)reasons.push('CERTIFICATE_FAULT');
      if(r.kEnd===null)reasons.push('K_AWARE_EXIT_REQUIRED');else if(boundary<r.kEnd)reasons.push('WAIT_K_END');
      if(r.ordinaryEnd===null)reasons.push('ORDINARY_EXIT_REQUIRED');else if(boundary<r.ordinaryEnd)reasons.push('WAIT_ORDINARY_END');
      if(r.coverageSequence!==r.ordinaryCount||r.nextCoverageHour!==MAX)reasons.push('HISTORICAL_COVERAGE_REQUIRED');
    }
    const value={instanceHex:hex(instance),owner:root.owner,revision:String(root.revision),lifecycle:root.lifecycle,
      registered:r!==null,ordinaryEnd:r?.ordinaryEnd===null?null:String(r?.ordinaryEnd??0n),kEnd:r?.kEnd===null?null:String(r?.kEnd??0n),
      ordinaryCount:String(r?.ordinaryCount??0n),coverageSequence:String(r?.coverageSequence??0n),nextCoverageHour:String(r?.nextCoverageHour??MAX),certificateFault:r?.certificateFault??false,
      movable:reasons.length===0,blockingReason:reasons[0]??null,blockingReasons:reasons};
    eligibility.push(value);directInputs.push({instance:Buffer.from(instance),account,rootReg,originalArtifact});
    summaries.push({...value,address:account.address,schema:root.schema,target:root.target??null,descriptorHex:hex(root.descriptor),fingerprintHex:hex(root.fingerprint),qualityPpm:String(root.qualityPpm),B:String(root.B),retired:String(root.retired),createdAt:String(root.createdAt),createdSlot:String(root.createdSlot),originalArtifactIdHex:root.schema>1?hex(account.data.subarray(443,475)):null});
  }
  const leafCount=members(target).length*4,materialFeeAtoms=BigInt(leafCount)*(target>=16&&target<=21?400000n:200000n),allEligible=eligibility.every(row=>row.movable);
  const summary={actor,target,directCount:directInputs.length,leafCount,allEligible,currentBoundary:String(boundary),actorLamports:String(facts.actorLamports),contextSlot:String(read.contextSlot),nextNonce:String(facts.nonce.nextNonce),clock:{slot:String(facts.clock.slot),unixTimestamp:String(facts.clock.unixTimestamp)},materialFeeAtoms:String(materialFeeAtoms),inputs:summaries,noLABBalanceIncluded:true,historicalDebtMustBeClaimed:false,knownInputsOnly:true};
  return {...facts,directInputs,eligibility,summary,allEligible};
}

/** Bounded actual inputs only. This returns observed blocked records without
 * granting movement; the native FINAL guard remains the final atomic check. */
export async function readSynthesisInputs(args){
  fields(args,['release','rpc','actor','target','directIds']);const {release,rpc}=args;check(rpc instanceof ReadOnlyRpc,'SYN_INPUT_READ_ONLY_RPC');
  const actor=nativeKeyAddress(args.actor),target=targetValue(args.target),ids=directValues(args.directIds,target);
  const keys={Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar,Nonce:await pda(release,'actor-nonce',nativeKeyBytes(actor)),Actor:actor};
  for(const id of ids){keys[`Root:${hex(id)}`]=await pda(release,'root',id);keys[`RootReg:${hex(id)}`]=await pda(release,'root-reg',id);}
  const discovery=await batch(rpc,keys),first=await common(release,actor,keys,discovery),initial=await roots(release,keys,discovery,ids,first);
  for(const row of initial)if(row.root.schema>1){const id=row.account.data.subarray(443,475);keys[`Artifact:${hex(id)}`]=await pda(release,'artifact',id);}
  const expanded=await batch(rpc,keys),middle=await complete(release,actor,target,keys,expanded,ids);forward(first,middle);
  const known=Object.fromEntries(Object.entries(keys).filter(([,address])=>discovery.accounts.has(address)));
  const stale=(contextSlot,reason)=>({profile:'BIOP0R2-SYNTHESIS-INPUTS1',decision:'REPLAN_STALE_STATE',actor,target,contextSlot,reason,...flags});
  if(!stable(discovery,expanded,known))return stale(expanded.contextSlot,'DISCOVERY_CHANGED');
  const final=await batch(rpc,keys),last=await complete(release,actor,target,keys,final,ids);forward(middle,last);
  if(!stable(expanded,final,keys))return stale(final.contextSlot,'INPUTS_CHANGED');
  return {profile:'BIOP0R2-SYNTHESIS-INPUTS1',decision:'INPUTS_READ',actor,target,contextSlot:final.contextSlot,nextNonce:last.nonce.nextNonce,clock:last.clock,directInputs:last.directInputs,
    eligibility:last.eligibility,allEligible:last.allEligible,summary:last.summary,inputRecordsVerified:true,...flags};
}

/** Ordinary public payload planning only. The caller cannot provide capsules,
 * runtime state, a trusted physical result or a replacement release context. */
export async function planActualSynthesis(args){
  fields(args,['release','abi','rpc','actor','graph','directIds','challengePpm']);
  const {release,abi,rpc}=args;check(abi?.hash===release.hashes.abiHash.toString('hex'),'SYN_INPUT_ABI');
  const graph=structuredClone(args.graph),target=targetValue(graph?.target),challengePpm=args.challengePpm;
  validateGraph(graph,{domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash});
  check(Number.isInteger(challengePpm)&&challengePpm>=500000&&challengePpm<=2000000&&challengePpm%1000===0,'SYN_INPUT_CHALLENGE');
  check(![3,9,14,15,21].includes(target)||challengePpm===2000000,'SYN_INPUT_HARD_CHALLENGE');
  const directIds=directValues(args.directIds,target),read=await readSynthesisInputs({release,rpc,actor:args.actor,target,directIds});
  if(read.decision!=='INPUTS_READ')return read;
  if(!read.allEligible)return {...read,decision:'INPUTS_BLOCKED'};
  const plan=await planSynthesisPayload({release,actor:read.actor,graph,directInputs:read.directInputs});
  return {...read,decision:'SYNTHESIS_PLANNED',plan,challengePpm,requiresSimulation:true,rentSufficiencyVerified:false,networkFeeQuote:null};
}
