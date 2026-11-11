/** Bound both connection and response-body work. An aborted write remains an
 * unknown submission; aborting HTTP cannot retract an already signed packet. */
export async function withRpcTimeout(milliseconds,work){
  if(!Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>60000)throw new Error('RPC_TIMEOUT_BOUND');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Object.assign(new Error('RPC_TIMEOUT'),{code:'RPC_TIMEOUT'});controller.abort(error);reject(error);},milliseconds);});
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),deadline]);}
  finally{clearTimeout(timer);}
}
