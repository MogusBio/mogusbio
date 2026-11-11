import fs from 'node:fs';
import { decodeGraph, encodeGraph, edge, leaf, edgeKey, compareEdges } from '../../../packages/biology/src/graph.mjs';
import { validateDesign } from '../../../packages/biology/src/evidence.mjs';
const graph=decodeGraph(fs.readFileSync(new URL('../../../fixtures/graphs/candidate-c320.bin',import.meta.url)));
const keys=new Set(graph.edges.map(edgeKey));
for(let role=1;role<=15;role++)for(const type of [1,2,3])for(const source of type===1?[6,7]:[1,2])for(let port=0;port<2;port++){
  const row=type===3?edge(type,leaf(role,1,5+port),leaf(source,4,18),0):edge(type,leaf(source,4,17),leaf(role,1,(type===1?1:3)+port),0);
  if(!keys.has(edgeKey(row))){graph.edges.push(row);keys.add(edgeKey(row));}
}
graph.edges.sort(compareEdges);const bytes=encodeGraph(graph);
if(graph.edges.length!==440||bytes.length!==7713)throw Error('Maximum actual graph fixture differs');
const result=validateDesign(graph);
fs.writeFileSync(new URL('./stress-maximum440.bin',import.meta.url),bytes);
fs.writeFileSync(new URL('./stress-expected.json',import.meta.url),JSON.stringify({q:result.q_ppm.toString(),cost:result.C.toString(),digest:result.transcriptSHA.toString('hex'),bitmap:result.positiveBitmap.toString('hex'),graphSHA:result.graphSHA.toString('hex'),edges:440,bytes:7713},null,2)+'\n');
console.log({edges:440,bytes:bytes.length,C:result.C.toString(),q:result.q_ppm.toString()});
