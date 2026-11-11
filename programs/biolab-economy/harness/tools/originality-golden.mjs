import { readFile } from 'node:fs/promises';
import { catalogHash } from '../../../../packages/protocol-core/src/materials.mjs';
import { designId } from '../../../../packages/biology/src/canonical.mjs';
import { createSeed, createImprovement, createFurtherImprovement, FROZEN_SEED_COSTS } from '../../../../packages/biology/src/seeds.mjs';
import { initialSeedSetId, encodeBlueprint, computeAdmissionH16 } from '../../../../packages/originality/src/wire.mjs';
import { validateDesign } from '../../../../packages/biology/src/evidence.mjs';
const release=JSON.parse(await readFile(new URL('../../../../releases/func2r2/manifest.json',import.meta.url)));
const base={domain:Buffer.alloc(32),config:Buffer.alloc(32),catalog:catalogHash(),rule:Buffer.from(release.ruleHash,'hex')};
const graphs=Array.from({length:12},(_,n)=>createSeed(n,base)).concat([createImprovement({...base,surfaces:false}),createImprovement({...base,surfaces:true}),createFurtherImprovement({...base,stage:1}),createFurtherImprovement({...base,stage:2})]);
const rows=graphs.map((g,n)=>({design:designId(g),C:BigInt([...FROZEN_SEED_COSTS,324,320,318,316][n])})).sort((a,b)=>Buffer.compare(a.design,b.design));
if(process.argv[2]==='rows')console.log(JSON.stringify(rows.map(r=>({design:r.design.toString('hex'),C:Number(r.C)}))));
else if(process.argv[2]==='verify'){
 const { decodeBlueprint }=await import('../../../../packages/originality/src/wire.mjs');
 const bytes=await readFile(process.argv[3]),{graph,challenge,descriptorMapSHA}=decodeBlueprint(bytes),r=validateDesign(graph,{challenge});
 const {sha256}=await import('../../../../packages/protocol-core/src/p0.mjs');
 const artifact=Buffer.from(process.argv[4],'hex');
 const h16=computeAdmissionH16({...graph,graphSHA:r.graphSHA,leafMapSHA:descriptorMapSHA,evidenceRef:artifact,evidenceKind:0,target:graph.target,c_ppm:BigInt(challenge),q_ppm:r.q_ppm,taskApplicable:r.taskApplicable,C:r.C,suite:2,fixture:1,load:1,dutMask:0x7fff,transcriptSHA:r.transcriptSHA,positiveBitmap:r.positiveBitmap});
 console.log(JSON.stringify({design:designId(graph).toString('hex'),q:String(r.q_ppm),C:String(r.C),h16:h16.toString('hex'),transcript:r.transcriptSHA.toString('hex')}));
}else throw new Error('expected rows or verify');
