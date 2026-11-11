// Public browser identity only. Cookies/signatures/tokens never enter this store.
let current=null;
const keys=['releaseHash','abiHash','domainHex','configHex'];
export function setBrowserAuthSession(session,context){
  if(session===null){current=null;return;}
  if(typeof session?.actor!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(session.actor)||!context||keys.some(k=>typeof context[k]!=='string'||!/^[0-9a-f]{64}$/.test(context[k])))throw Error('BROWSER_AUTH_CONTEXT');
  current=Object.freeze({actor:session.actor,context:Object.freeze(Object.fromEntries(keys.map(k=>[k,context[k]])))});
}
export function browserAuthMatches(config){return current!==null&&config?.sessionAuthenticated===true&&config.sessionActor===current.actor&&keys.every(k=>config[k]===current.context[k]);}
