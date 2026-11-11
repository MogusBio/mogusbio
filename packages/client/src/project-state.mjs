import {asBytes,typedHash} from '../../protocol-core/src/index.mjs';
import {decodeCreatePayload} from '../../launchpad/src/codec.mjs';
import {ReadOnlyRpc} from './rpc.mjs';
import {decodeNativeBaseConfig,decodeNativeProject,decodeClassicMint} from './accounts.mjs';
import {decodeNativeEconomyConfig,decodeNativeClock} from './economy-accounts.mjs';
import {nativeKeyAddress,nativePda,nativeBusinessKey,decodeNativeFrame} from './native.mjs';
import {PROGRAMS,baseConfigR2Id} from './release.mjs';
import {decodeNativeCreateProjectResult} from './project-workflow.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const pda=(release,...s)=>nativePda(release.input.programId,'bio',...s).then(p=>p.address);
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const readFlags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false};

/** Coherent bounded known-project read, independent of local creation logs.
 * The actual record can be found after a lost response, but its existence does
 * not prove that a particular unobserved old request Frame executed. */
export async function readProjectState({release,rpc,projectId}){
  check(rpc instanceof ReadOnlyRpc,'PROJECT_READ_RPC');const id=asBytes(projectId,32),projectAddress=await pda(release,'project',id);
  const mintAddresses=await Promise.all([1,2,3,4].map(c=>pda(release,'pack',id,Buffer.from([c]))));
  const authorities=await Promise.all([1,2,3,4].map(c=>pda(release,'pack-auth',id,Buffer.from([c]))));
  const keys=[release.pdas.baseConfig.address,await pda(release,'econ-config'),PROGRAMS.clockSysvar,projectAddress,...mintAddresses];
  const {contextSlot,accounts}=await rpc.getMultipleAccounts(keys);
  await decodeNativeBaseConfig(release,accounts[0]);await decodeNativeEconomyConfig(release,accounts[1]);const clock=decodeNativeClock(accounts[2]);
  const common={...readFlags,contextSlot,projectIdHex:id.toString('hex'),knownProjectOnly:true,clock};
  if(fresh(accounts[3]))return {...common,decision:'PROJECT_NOT_FOUND',projectRecordVerified:false,project:null,mints:[]};
  const actual=await decodeNativeProject(release,accounts[3],id);check(actual.createdAt<=clock.unixTimestamp&&actual.createdSlot<=clock.slot,'PROJECT_READ_FUTURE_RECORD');
  const mints=accounts.slice(4).map((account,i)=>{
    const mint=decodeClassicMint(account,{expectedAddress:mintAddresses[i],expectedDecimals:0,expectedMintAuthority:authorities[i],expectedFreezeAuthority:null}),c=actual.classes[i];
    check(mint.supply<=c.issued-c.intakeBurned,'PROJECT_READ_MINT_SUPPLY');
    return {class:i+1,address:mint.address,authority:authorities[i],supply:mint.supply,decimals:0};
  });
  const project={projectIdHex:id.toString('hex'),address:projectAddress,name:actual.name,creator:nativeKeyAddress(actual.creator),seller:nativeKeyAddress(actual.saleRecipient),
    creationBusinessHex:actual.creationBusiness.toString('hex'),createdAt:actual.createdAt,createdSlot:actual.createdSlot,
    classes:actual.classes.map(c=>({class:c.class,mint:nativeKeyAddress(c.mint),cap:c.lifetimeCap,unitPrice:c.priceLamports,issued:c.issued,intakeBurned:c.intakeBurned}))};
  return {...common,decision:'PROJECT_READ',projectRecordVerified:true,project,mints};
}

/** Exact request association requires immutable creation fields to agree.
 * Mutable issuance/burn counters and current mint supplies are not reset. */
export function projectRecordMatchesCreation({release,abi,frame,record}){
  const bytes=asBytes(frame),f=decodeNativeFrame(abi,bytes);check(f.operation==='CREATE_PROJECT'&&f.domain.equals(release.domain)&&f.configId.equals(baseConfigR2Id(release)),'PROJECT_CREATE_CONTEXT');
  if(record?.decision!=='PROJECT_READ'||record.projectRecordVerified!==true)return false;
  const payload=decodeCreatePayload(f.payload),business=nativeBusinessKey(abi,bytes),id=typedHash(17,Buffer.concat([release.domain,business])),p=record.project;
  return payload.catalogHash.equals(release.hashes.catalogHash)&&record.projectIdHex===id.toString('hex')&&p.creator===nativeKeyAddress(f.actor)&&p.creationBusinessHex===business.toString('hex')&&p.name===payload.name
    &&p.seller===nativeKeyAddress(payload.saleRecipient)&&p.classes.length===4&&p.classes.every((c,i)=>c.class===i+1&&c.cap===payload.classes[i].lifetimeCap&&c.unitPrice===payload.classes[i].priceLamports);
}

/** Reconciliation may update the local durable journal, never chain state.
 * Do not silently infer old request success from a Project with the same ID. */
export async function reconcileProjectCreation({release,abi,session,actor,nonce}){
  check(typeof nonce==='bigint'&&nonce>=0n&&nonce<(1n<<64n),'PROJECT_STATUS_NONCE');const address=nativeKeyAddress(actor),identity=session?.recoveryIdentity;
  check(identity?.actor===address&&identity.abiHash===abi.hash&&identity.domainHex===release.domain.toString('hex')&&identity.configHex===baseConfigR2Id(release).toString('hex')&&identity.releaseHash===release.input.releaseHash,'PROJECT_STATUS_SESSION');
  const entry=await session.getRequest(nonce),frame=asBytes(entry.frameBytes),f=decodeNativeFrame(abi,frame);
  check(f.operation==='CREATE_PROJECT'&&f.nonce===nonce&&nativeKeyAddress(f.actor)===address,'PROJECT_STATUS_OPERATION');
  const outcome=await session.reconcile(nonce),id=typedHash(17,Buffer.concat([release.domain,nativeBusinessKey(abi,frame)]));
  const record=await readProjectState({release,rpc:session.rpc,projectId:id}),matches=projectRecordMatchesCreation({release,abi,frame,record});
  const exact=outcome.decision==='CONFIRMED'&&outcome.businessExecutionVerified===true;
  let receipt=null;
  if(exact){
    check(matches,'PROJECT_CONFIRMED_RECORD_MISMATCH');const result=await decodeNativeCreateProjectResult({release,abi,frame,result:outcome.resultBytes});
    receipt={projectIdHex:result.projectId.toString('hex'),projectAddress:result.projectAddress,mints:result.mints,creationFeeLamports:result.creationFeeLamports,rentLamports:result.rentLamports};
  }
  return {...readFlags,lookupOnly:true,decision:outcome.decision,actor:address,nonce,contextSlot:record.contextSlot,projectIdHex:id.toString('hex'),
    businessExecutionVerified:exact,exactRequestExecutionVerified:exact,projectRecordVerified:record.projectRecordVerified,recordMatchesRequest:matches,
    resultSource:outcome.resultSource??null,receipt,project:record.project,mints:record.mints};
}
