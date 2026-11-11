import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {devnetOptions,runDevnetCommand} from '../apps/devnet/cli.mjs';
const options=devnetOptions(['opening',...process.argv.slice(2)]),started=Date.now(),directory=options.directory;let stopped=false,timer=null,previous=null;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;clearTimeout(timer);});
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,null,2)+'\n';
await mkdir(directory,{recursive:true,mode:0o700});
// Each bounded pass resumes the same private journal. Time always comes from
// the real Devnet Clock; this process has no Clock, LAB or material override.
while(!stopped&&Date.now()-started<48*60*60*1000){
  let result;try{result=await runDevnetCommand(options,{onProgress:value=>{if(value?.stage==='SEED_VERIFIED')console.log(json(value).trim());}});}
  catch(error){const code=error.code??error.message;result={decision:'WAIT_DEPENDENCY',code:/^[A-Z0-9_]{1,100}$/.test(code??'')?code:'DEVNET_OPENING_DEPENDENCY',networkSuccessNotAssumed:true};if(['DEVNET_BOOTSTRAP_PREWARM_CLOSED','DEVNET_BOOTSTRAP_INIT_WINDOW_CLOSED','RELEASE_SOURCE_BINDING'].includes(code))stopped=true;}
  await writeFile(path.join(directory,'opening-watch-public.json'),json({profile:'BIO-DEVNET-OPENING-WATCH1',updatedAt:new Date().toISOString(),result}),{mode:0o600});
  const text=json(result);if(text!==previous){console.log(text.trim());previous=text;}
  if(result.decision==='OPENING_SEALED')break;
  if(!stopped)await new Promise(resolve=>{timer=setTimeout(resolve,result.decision==='CONTINUE'?1000:30000);});
}
