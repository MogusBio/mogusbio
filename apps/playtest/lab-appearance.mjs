import {sha256} from '../../packages/protocol-core/src/index.mjs';
import {descriptorBytes,readSealedArtifact,decodeSynthesisPayload} from '../../packages/composition/src/index.mjs';
import {encodeGraph,designId,assertChildUnchanged,ORGAN_CELLS} from '../../packages/biology/src/index.mjs';

const key=value=>Buffer.from(value).toString('hex');
const requireAppearance=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const same=(a,b)=>Buffer.from(a??[]).equals(Buffer.from(b??[]));
const MAX_NODES=82,MAX_GRAPH_BYTES=7713,MAX_REGISTRY_BYTES=512*1024;

/** Read-only provenance projection. It never reads the current editor graph,
 * creates children, changes ownership or contributes to reward calculations. */
export function createLabAppearanceIndex({protocol,base}){
  const walks=new Map(),graphs=new Map(),appearances=new Map();let registryBytes=2;
  function walk(id,cellRole=null,path=new Set()){
    requireAppearance(typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)&&!path.has(id),'LAB_APPEARANCE_CYCLE');
    const facts=protocol.compositionRoots.get(id),root=protocol.settlement.roots.get(id);
    requireAppearance(facts&&root&&key(facts.instance)===id&&facts.scope===root.scope&&facts.B_int===root.B_int&&facts.q_ppm===root.q_ppm,'LAB_APPEARANCE_ROOT');
    const cacheKey=`${id}:${facts.scope==='COMPONENT'?(cellRole??(facts.profile||1)):0}`;
    if(walks.has(cacheKey))return walks.get(cacheKey);
    const nextPath=new Set(path);nextPath.add(id);requireAppearance(nextPath.size<=4,'LAB_APPEARANCE_DEPTH');
    const nodes=new Map(),instances=new Set();
    const add=(node,instance)=>{requireAppearance(Number.isInteger(node)&&node>=1&&node<=123&&!nodes.has(node)&&!instances.has(instance),'LAB_APPEARANCE_DUPLICATE');nodes.set(node,Buffer.from(instance,'hex').subarray(0,8));instances.add(instance);};
    if(facts.scope==='COMPONENT'){
      const descriptor=descriptorBytes({primitive:facts.primitive,profile:facts.profile}),role=cellRole??(facts.profile||1);
      requireAppearance(role>=1&&role<=15&&(facts.primitive!==4||facts.profile===role),'LAB_APPEARANCE_PROFILE');
      add(64+4*(role-1)+facts.primitive-1,id);
      const value={nodes,instances,graph:null,graphBytes:null,graphKey:null,structureKey:key(sha256(descriptor))};walks.set(cacheKey,value);return value;
    }
    const artifact=readSealedArtifact(protocol,facts.artifactId,base),payload=decodeSynthesisPayload(artifact.written),graph=payload.graph,bytes=encodeGraph(graph),graphKey=key(sha256(bytes)),structureKey=key(designId(graph));
    requireAppearance(bytes.length<=MAX_GRAPH_BYTES&&same(artifact.payloadSHA,facts.artifactSHA)&&same(facts.graphSHA,Buffer.from(graphKey,'hex'))&&same(facts.semantic,Buffer.from(structureKey,'hex'))&&graph.target===facts.target,'LAB_APPEARANCE_GRAPH');
    const target=facts.target,expected=target<=15?[1,2,3,4]:target<=21?ORGAN_CELLS[target-16]:[16,17,18,19,20,21];
    requireAppearance(Number.isInteger(target)&&target>=1&&target<=22&&facts.scope===(target<=15?'CELL':target<=21?'ORGAN':'BIO')&&payload.direct.length===expected.length,'LAB_APPEARANCE_SCOPE');
    add(target,id);
    for(const [index,direct]of payload.direct.entries()){
      const childId=key(direct.instance),childFacts=protocol.compositionRoots.get(childId);
      requireAppearance(childFacts&&same(direct.fingerprint,childFacts.fingerprint),'LAB_APPEARANCE_CHILD');
      if(target<=15)requireAppearance(childFacts.scope==='COMPONENT'&&childFacts.primitive===expected[index]&&direct.primitive===expected[index]&&direct.scope===target&&(childFacts.primitive!==4||childFacts.profile===target),'LAB_APPEARANCE_PROFILE');
      else requireAppearance(childFacts.scope===(target<=21?'CELL':'ORGAN')&&childFacts.target===expected[index]&&direct.scope===expected[index]&&direct.primitive===0,'LAB_APPEARANCE_SCOPE');
      const child=walk(childId,target<=15?target:null,nextPath);
      if(child.graph)assertChildUnchanged(graph,child.graph);
      for(const [node,prefix]of child.nodes){requireAppearance(!nodes.has(node),'LAB_APPEARANCE_DUPLICATE');nodes.set(node,prefix);}
      for(const instance of child.instances){requireAppearance(!instances.has(instance),'LAB_APPEARANCE_DUPLICATE');instances.add(instance);}
    }
    const expectedNodes=target<=15?5:target<=21?1+expected.length*5:82;
    requireAppearance(nodes.size===expectedNodes&&nodes.size<=MAX_NODES,'LAB_APPEARANCE_NODES');
    const value={nodes,instances,graph,graphBytes:bytes,graphKey,structureKey};walks.set(cacheKey,value);return value;
  }
  function forWork(id){
    if(appearances.has(id))return appearances.get(id);
    const data=walk(id);
    if(data.graphKey&&!graphs.has(data.graphKey)){
      const encoded=data.graphBytes.toString('base64');registryBytes+=Buffer.byteLength(data.graphKey)+Buffer.byteLength(encoded)+5+(graphs.size?1:0);
      requireAppearance(registryBytes<=MAX_REGISTRY_BYTES,'LAB_APPEARANCE_REGISTRY_SIZE');graphs.set(data.graphKey,encoded);
    }
    const lineage=Buffer.alloc(data.nodes.size*9);let offset=0;
    for(const [node,prefix]of [...data.nodes].sort(([a],[b])=>a-b)){lineage[offset]=node;prefix.copy(lineage,offset+1);offset+=9;}
    requireAppearance(lineage.length<=MAX_NODES*9,'LAB_APPEARANCE_LINEAGE_SIZE');
    const value={profile:'BIO-LINE-APPEARANCE1',version:1,structureKey:data.structureKey,specimenKey:id,graphKey:data.graphKey,lineage:lineage.toString('base64')};appearances.set(id,value);return value;
  }
  return{forWork,reference(id){forWork(id);return id;},get appearances(){return Object.fromEntries(appearances);},get graphs(){return Object.fromEntries(graphs);},get registryBytes(){return registryBytes;}};
}
