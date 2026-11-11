import { writeFile } from 'node:fs/promises';import path from 'node:path';
import { currentReleaseBinding } from '../packages/client/src/binding.mjs';
const binding=await currentReleaseBinding(),[output]=process.argv.slice(2);
if(output){if(!path.isAbsolute(output))throw new Error('absolute output path required');await writeFile(output,binding.bytes,{flag:'wx'});}
console.log(JSON.stringify({releaseHash:binding.releaseHash,policyHashes:binding.policyHashes,files:binding.manifest.sources.length,
  output:output??null,productionAdmission:false},null,2));
