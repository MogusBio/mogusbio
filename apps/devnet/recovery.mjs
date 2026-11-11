import {createHash} from 'node:crypto';
import path from 'node:path';
import {FileJournalStore} from '../../packages/client/src/file-journal.mjs';
import {intentInput} from '../../packages/bridge/src/operator-bridge.mjs';
import {nativeKeyBytes,nativeKeyAddress,encodeNativeFrame,buildNativeInstruction} from '../../packages/client/src/native.mjs';
import {baseConfigR2Id} from '../../packages/client/src/release.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x),hash=v=>createHash('sha256').update(v).digest('hex');
const terminal=v=>['CONFIRMED','ALREADY_PROCESSED','NONCE_CONFLICT'].includes(v?.decision);
const missing=e=>['JOURNAL_NOT_FOUND','JOURNAL_ARCHIVE_NOT_FOUND'].includes(e?.code);
/** One durable active envelope per actor/domain. Stored server-side only: a
 * research reveal may be present, so no payload is copied into localStorage. */
export function createDevnetRecoveryBridge({release,abi,core,directory}){
  check(path.isAbsolute(directory??'')&&core?.dispatch,'DEVNET_RECOVERY_OPTIONS');const binding={releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex')},namespace=hash(json(binding));
  const store=actor=>FileJournalStore.open({directory:path.join(directory,namespace,nativeKeyBytes(actor).toString('hex')),name:'current-envelope.json'});
  async function identity(actor,input){const intent=intentInput(input,abi),frame=encodeNativeFrame(abi,{operation:intent.operation,domain:release.domain,configId:baseConfigR2Id(release),actor,nonce:intent.nonce,payload:intent.payload}),instruction=await buildNativeInstruction({release,abi,frame,suffix:intent.suffix??[],dynamicAccounts:intent.dynamicAccounts??[]});return hash(json({frame:frame.toString('hex'),accounts:instruction.accounts,feePayer:intent.feePayer??actor,resources:intent.resources,labDestinationSetup:intent.labDestinationSetup??null}));}
  function parse(entry,actor){if(entry.payload===null)return null;const v=JSON.parse(entry.payload);check(v?.profile==='BIO-DEVNET-ENVELOPE1'&&v.actor===actor&&json(v.binding)===json(binding)&&/^(?:0|[1-9][0-9]{0,19})$/.test(v.nonce)&&typeof v.intentKey==='string'&&/^[a-f0-9]{64}$/.test(v.intentKey)&&v.body?.actor===actor&&v.body.intent?.nonce===v.nonce,'DEVNET_RECOVERY_RECORD');return v;}
  async function save(s,entry,value){const ok=await s.compareAndSwap(entry.revision,json(value));check(ok!==false,'DEVNET_RECOVERY_RACE');}
  async function complete(s,entry,record,envelope){check(envelope?.actor===record.actor&&envelope.nonce===record.nonce&&envelope.operation===record.body.intent.operation,'DEVNET_RECOVERY_ENVELOPE');await save(s,entry,{...record,envelope});return envelope;}
  async function prepare(body){check(body&&Object.keys(body).sort().join(',')==='actor,intent','DEVNET_RECOVERY_FIELDS');const actor=nativeKeyAddress(body.actor),intentKey=await identity(actor,body.intent),s=await store(actor);let entry=await s.load(),old=parse(entry,actor);
    if(old&&(old.nonce!==body.intent.nonce||old.intentKey!==intentKey)){let outcome;try{outcome=await core.dispatch('status',{actor,nonce:old.nonce,log:'primary'});}catch(error){if(!missing(error))throw error;check(old.envelope===null,'DEVNET_RECOVERY_MISSING_PRIMARY_JOURNAL');outcome={decision:'NOT_STARTED'};}check(terminal(outcome)||outcome.decision==='NOT_STARTED','DEVNET_RECOVERY_CHANGED_INTENT');old=null;}
    const record=old??{profile:'BIO-DEVNET-ENVELOPE1',binding,actor,nonce:body.intent.nonce,intentKey,body:structuredClone(body),envelope:null};
    if(!old){await save(s,entry,record);entry=await s.load();}
    // The intent is durable before the native journal can begin. Repeating the
    // same begin is idempotent; no new on-chain nonce or signature is created.
    const envelope=await core.dispatch('prepare',record.body);return complete(s,entry,record,envelope);
  }
  async function resume(body){check(body&&Object.keys(body).sort().join(',')==='actor,nonce'&&typeof body.nonce==='string','DEVNET_RECOVERY_FIELDS');const actor=nativeKeyAddress(body.actor),s=await store(actor),entry=await s.load(),record=parse(entry,actor);check(record&&record.nonce===body.nonce,'DEVNET_RECOVERY_NOT_FOUND');check(await identity(actor,record.body.intent)===record.intentKey,'DEVNET_RECOVERY_CHANGED_INTENT');let outcome;try{outcome=await core.dispatch('status',{actor,nonce:body.nonce,log:'primary'});}catch(error){if(record.envelope!==null||!missing(error))throw error;outcome={decision:'RETRY_SAME_FRAME'};}if(outcome.decision!=='RETRY_SAME_FRAME')return outcome;
    const envelope=record.envelope?await core.dispatch('refresh',{actor,envelope:record.envelope,log:'primary'}):await core.dispatch('prepare',record.body);await complete(s,entry,record,envelope);return{decision:'ENVELOPE_RESTORED',envelope,actor,nonce:record.nonce,networkSubmitted:false};
  }
  return{publicConfig:core.publicConfig,dispatch(action,body){return action==='prepare'?prepare(body):action==='resume-prepare'?resume(body):core.dispatch(action,body);}};
}
