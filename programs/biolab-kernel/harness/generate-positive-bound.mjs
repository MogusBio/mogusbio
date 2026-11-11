// Data-only stress fixture: every one of the 180 legal free endpoint pairs is
// present and carries positive flow, instead of padding with zero fractions.
import {readFile,writeFile} from 'node:fs/promises';
import {decodeGraph,createGraph,encodeGraph,projectGraph,edge} from '../../../packages/biology/src/graph.mjs';
import {validateDesign} from '../../../packages/biology/src/evidence.mjs';
const base=decodeGraph(await readFile(new URL('../../../fixtures/graphs/candidate-c320.bin',import.meta.url)));
const leaf=(role,sub,port)=>({kind:0,role,sub,port});const free=[];
for(let role=1;role<=15;role++){
 for(const src of [6,7])for(const port of [1,2])free.push(edge(1,leaf(src,4,17),leaf(role,1,port),250000));
 for(const src of [1,2])for(const port of [3,4])free.push(edge(2,leaf(src,4,17),leaf(role,1,port),250000));
 for(const dst of [1,2])for(const port of [5,6])free.push(edge(3,leaf(role,1,port),leaf(dst,4,18),250000));
}
const full=createGraph({freeEdges:free,v:Object.fromEntries(base.cells.map(c=>[c.role,c.v])),tiers:Object.fromEntries(base.tiers.map(t=>[t.scope,t.mode])),slots:base.slots,domain:base.domain,config:base.config,catalog:base.catalog,rule:base.rule});
const rows=[];for(let target=1;target<=22;target++){const g=target===22?full:projectGraph(full,target);const report=validateDesign(g,{challenge:2000000});const name=`positive-scope-${String(target).padStart(2,'0')}.bin`;await writeFile(new URL(name,import.meta.url),encodeGraph(g));rows.push({file:name,target,bytes:encodeGraph(g).length,q:report.q_ppm.toString(),C:report.C.toString(),digest:report.transcriptSHA.toString('hex'),bitmap:report.positiveBitmap.toString('hex')});}
await writeFile(new URL('positive-expected.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify({fullEdges:full.edges.length,fullBytes:encodeGraph(full).length,fixtures:rows.length}));
