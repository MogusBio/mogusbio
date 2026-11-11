// Bounded local experiments only. No wallet, native intent or transaction API.
const message='实验请求未完成，请重试；构造仍保留。';
function stopped(signal){return new Promise((_,reject)=>{if(signal.aborted){reject(new Error('EXPERIMENT_ABORTED'));return;}signal.addEventListener('abort',()=>reject(new Error('EXPERIMENT_ABORTED')),{once:true});});}
export function createExperimentRunner({fetchImpl=globalThis.fetch,timeoutMs=20000,maxResponseBytes=65536}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>131072)throw Error('EXPERIMENT_LIMITS');
  let active=null,sequence=0;
  const current=run=>active===run&&sequence===run.sequence;
  function cancel(){sequence++;const previous=active;active=null;if(previous){clearTimeout(previous.timer);previous.controller.abort();}}
  async function run(input){
    if(active)return{decision:'BUSY'};
    const controller=new AbortController(),record={controller,sequence:++sequence,timedOut:false,timer:null};active=record;
    record.timer=setTimeout(()=>{record.timedOut=true;controller.abort();},timeoutMs);
    const abort=stopped(controller.signal),bounded=p=>Promise.race([Promise.resolve(p),abort]);let reader;
    try{
      const response=await bounded(fetchImpl('/api/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:controller.signal}));
      if(!current(record))return{decision:'STALE'};
      if(!/\bapplication\/json\b/i.test(response.headers?.get('content-type')??'')||!response.body?.getReader)throw Error('EXPERIMENT_RESPONSE');
      const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxResponseBytes))throw Error('EXPERIMENT_RESPONSE');
      reader=response.body.getReader();const chunks=[];let size=0;
      while(true){const {done,value}=await bounded(reader.read());if(done)break;size+=value.byteLength;if(size>maxResponseBytes)throw Error('EXPERIMENT_RESPONSE');chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('EXPERIMENT_RESPONSE');
      return current(record)?{decision:'RESULT',ok:response.ok,data}:{decision:'STALE'};
    }catch{return !current(record)?{decision:'STALE'}:record.timedOut?{decision:'TIMEOUT',message:'实验请求超时，请重试；构造仍保留。'}:{decision:'ERROR',message};}
    finally{clearTimeout(record.timer);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}if(active===record)active=null;}
  }
  return{run,cancel,get busy(){return active!==null;}};
}
