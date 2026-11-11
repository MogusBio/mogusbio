import { promises as fs } from 'node:fs';
import path from 'node:path';
import {serviceFixture} from './service-fixture.mjs';
import {runServiceCLI} from '../apps/service/main.mjs';

// Explicit offline evidence harness. Both RPC transport and fee/finality replies
// are HOST-only; signatures use a documented public local fixture key.
const results=[];
for(const sendEnabled of [false,true]){
  const f=await serviceFixture({sendEnabled});f.config.poll.maxDurationMs=10000;let report;
  try{const releaseFile=path.join(f.directory,'release.json'),configFile=path.join(f.directory,'service.json');await fs.writeFile(releaseFile,JSON.stringify(f.args.release.input),{mode:0o600});await fs.writeFile(configFile,JSON.stringify({releaseFile,localPublicFixture:true,service:f.config}),{mode:0o600});
    report=await runServiceCLI(['run','--config',configFile,'--ticks','3','--duration-ms','10000'],{fetchImpl:f.args.fetchImpl,adapters:sendEnabled?{signer:f.signer}:null,print:()=>{}});
    results.push({scenario:sendEnabled?'HOST_CONTROLLED_SEND_LOOP':'HOST_READ_PLAN_LOOP',command:'node apps/service/main.mjs run --config <private-fixture-config> --ticks 3 --duration-ms 10000',transport:'HOST_OFFLINE_ONLY',signer:'DOCUMENTED_PUBLIC_LOCAL_FIXTURE_ONLY',rpcMethods:[...new Set(f.calls.map(c=>c.method))],signCalls:f.signed.length,sendCalls:f.calls.filter(c=>c.method==='sendTransaction').length,result:report});
  }finally{await f.cleanup();}
}
const out={schema:'BIO-SERVICE-CLI-HOST-EVIDENCE1',genuineAccountCheckpointSHA256:'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe',networkExecutionProven:false,realFundingUsed:false,publicEndpointStarted:false,results};
if(process.argv[2]){if(!path.isAbsolute(process.argv[2]))throw Error('absolute evidence path required');await fs.writeFile(process.argv[2],JSON.stringify(out,null,2)+'\n',{mode:0o600});}else console.log(JSON.stringify(out,null,2));
