// Independent Node oracle for bytes produced from actually manufactured roots.
// This runs in the host harness; the on-chain program cannot access its output.
import { readFile } from 'node:fs/promises';
import { decodeSynthesisPayload, validateSourceUnion } from '../../../../packages/composition/src/payload.mjs';
import { decodeDebitPlan, F1_EFFECTIVE_SPECIES } from '../../../../packages/protocol-core/src/materials.mjs';
import { designId } from '../../../../packages/biology/src/canonical.mjs';
import { validateDesign } from '../../../../packages/biology/src/evidence.mjs';
const payload=decodeSynthesisPayload(await readFile(process.argv[2]));
const report=validateDesign(payload.graph,{challenge:Number(process.argv[3]??2_000_000)});
const leaves=payload.leaves.map((leaf,i)=>{
  const effective=[],retired=[];
  for(const group of decodeDebitPlan(payload.capsules[i].subarray(322)))for(const entry of group.entries){
    (F1_EFFECTIVE_SPECIES.includes(entry.species)?effective:retired).push({sourceId:group.sourceId,species:entry.species,lo:entry.expectedPrefix,hi:entry.expectedPrefix+entry.takeTick});
  }
  return {...leaf,effective,retired};
});
console.log([designId(payload.graph).toString('hex'),report.q_ppm.toString(),report.C.toString(),report.transcriptSHA.toString('hex'),report.positiveBitmap.toString('hex'),validateSourceUnion(leaves).effectiveUnionSHA.toString('hex')].join('\n'));
