// Public aggregate only. The provider owns local process/lease observation;
// this module never reads a journal, signs, submits, stops or recovers a service.
const processStates=new Set(['RUNNING','STOPPED','OWNER_DEAD','UNKNOWN']);
const modes=new Set(['AUTHORIZED_SEND','PLAN_ONLY']);
const categories=['READY','CONFIRMED','PENDING','WAIT_DEPENDENCY','WAIT_OPERATOR','CANCELLED','STOPPED','UNKNOWN'];
const pending=new Set(['WAIT_PENDING_FINALITY','WAIT_RPC_UNKNOWN','WAIT_BUSY']);
const operator=new Set(['WAIT_SEND_DISABLED','WAIT_SIGNER','WAIT_NETWORK_CONFIG','WAIT_SIGNING_RECOVERY','WAIT_ENVELOPE_RECOVERY','WAIT_NONCE_CONFLICT','WAIT_OLD_EXECUTION_UNKNOWN','WAIT_REFRESH_LIMIT']);
const dependencies=new Set(['WAIT_DEPENDENCY','WAIT_QUOTE','WAIT_LIFETIME_PROOF','WAIT_NO_LANES','WAIT_GLOBAL_FRONTIER','WAIT_CLOCK','WAIT_K_POSITION','WAIT_RESEARCH_WINDOW']);
const quotes=new Set(['SERVICE_FEE_QUOTE_UNAVAILABLE','SERVICE_QUOTE_RPC','SERVICE_QUOTE_HTTP','SERVICE_QUOTE_UNAVAILABLE','SERVICE_QUOTE_BINDING','SERVICE_QUOTE_SIZE','SERVICE_QUOTE_U64']);
const budgets=new Set(['SERVICE_STEP_LIMIT','SERVICE_SPENDING_LIMIT','SERVICE_SIGNED_RENT_CAP','SERVICE_RESERVED_QUOTE_CHANGED']);
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=(1n<<64n)-1n?v:null;
const unknown=()=>({configured:false,processState:'UNKNOWN',mode:'UNKNOWN',ticks:null,confirmed:null,backlog:null,states:Object.fromEntries(categories.map(s=>[s,0])),quoteUnavailable:null,budgetBlocked:null});
function category(state){if(['READY','CONFIRMED','STOPPED'].includes(state))return state;if(['CANCEL_CONFIRMED','WAIT_CANCELLED'].includes(state))return 'CANCELLED';if(pending.has(state))return 'PENDING';if(operator.has(state))return 'WAIT_OPERATOR';if(dependencies.has(state))return 'WAIT_DEPENDENCY';return 'UNKNOWN';}

/** Discard every non-allowlisted field/string, including operator lane identities.
 * null counters mean no trustworthy observation, not a healthy observed zero.
 * quote/budget counts describe the latest state of lanes, not historical totals. */
export function projectServiceHealth(raw){
  try{
    if(!raw||raw.version!=='BIO-SERVICE-HEALTH1'||raw.configured!==true)return unknown();
    const out={...unknown(),configured:true,processState:processStates.has(raw.processState)?raw.processState:'UNKNOWN',mode:modes.has(raw.mode)?raw.mode:'UNKNOWN',ticks:count(raw.ticks),confirmed:count(raw.confirmed)};
    if(out.ticks===null||out.confirmed===null||out.mode==='UNKNOWN')out.processState='UNKNOWN';
    if(!Array.isArray(raw.lanes)||raw.lanes.length>9)return {...out,processState:'UNKNOWN'};
    out.quoteUnavailable=0;out.budgetBlocked=0;
    for(const lane of raw.lanes){
      if(!lane||typeof lane!=='object'){out.states.UNKNOWN++;continue;}
      out.states[category(lane.state)]++;
      if(lane.state==='WAIT_QUOTE'||quotes.has(lane.errorCode))out.quoteUnavailable++;
      if(budgets.has(lane.errorCode))out.budgetBlocked++;
    }
    const global=raw.lanes.filter(l=>l?.kind==='global');
    if(global.length===1)out.backlog=decimal(global[0].backlogHours);
    return out;
  }catch{return unknown();}
}

/** Optional read-only callback. Exceptions never disclose private paths/errors. */
export async function publicServiceHealth(provider){
  if(typeof provider!=='function')return unknown();
  try{return projectServiceHealth(await provider());}catch{return unknown();}
}
