import {nativeKeyAddress} from '../../client/src/native.mjs';
import {inspectPreparedNativeEnvelope} from '../../client/src/session.mjs';

const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export const PUBLIC_NATIVE_ACTIONS=Object.freeze(['inspect','prepare','simulate','refresh','status','broadcast','cancel-prepare','cancel-status','purchase-plan','asset-read','asset-plan','position-plan','project-plan','project-read','project-status','inventory-read','manufacture-plan','manufacture-next','synthesis-inputs','synthesis-plan','synthesis-next','mining-read','global-plan','hour-close-plan','lifecycle-plan','research-create','research-next','competition-read','round-plan','winner-plan','discovery-read','market-read','market-list-plan','market-buy-plan','market-cancel-plan','work-launch-plan','resume-prepare']);

/** Trusted gateway session only. Authentication never replaces the transaction
 * signatures, state-dependent account gates or immutable historical payee. */
export async function authorizeNativeRequest({release,abi,action,body,session}){
  check(PUBLIC_NATIVE_ACTIONS.includes(action),'PUBLIC_ACTION_UNKNOWN');
  check(object(body),'PUBLIC_BODY');check(session&&typeof session.actor==='string','PUBLIC_AUTH_REQUIRED');
  const actor=nativeKeyAddress(session.actor);
  if(action==='inspect'||action==='simulate'){
    check(object(body.envelope),'PUBLIC_ENVELOPE');
    const prepared=await inspectPreparedNativeEnvelope({release,abi,envelope:body.envelope});
    check(prepared.actor===actor||Object.hasOwn(prepared.transaction.signatures,actor),'PUBLIC_SIGNER_REQUIRED');
    return {actor,principal:prepared.actor,coSigner:prepared.actor!==actor};
  }
  check(typeof body.actor==='string'&&nativeKeyAddress(body.actor)===actor,'PUBLIC_ACTOR_MISMATCH');
  if(Object.hasOwn(body,'envelope'))check(object(body.envelope)&&body.envelope.actor===actor,'PUBLIC_ENVELOPE_ACTOR');
  // The private coordinator checks author/cranker membership against the frozen
  // server manifest before any original author transaction session is opened.
  return {actor,principal:actor,coSigner:false};
}
