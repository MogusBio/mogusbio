import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGraph,encodeGraph,decodeGraph,designId,projectGraph} from '../packages/biology/src/index.mjs';
import {descriptorBytes} from '../packages/composition/src/index.mjs';
import {preparePlaytestCheckpoint,createLabSimulationRuntime,restoreLabSimulationRuntime} from '../apps/playtest/runtime.mjs';

const baseline=await preparePlaytestCheckpoint(),fresh=()=>createLabSimulationRuntime({checkpoint:baseline}),act=(r,action,params={})=>r.execute({action,params});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const graphOf=value=>({...structuredClone(value),...Object.fromEntries(['domain','config','catalog','rule'].map(k=>[k,Buffer.from(value[k],'hex')]))});
const publicGraph=g=>({...g,...Object.fromEntries(['domain','config','catalog','rule'].map(k=>[k,Buffer.from(g[k]).toString('hex')]))});
function nodes(appearance){const data=Buffer.from(appearance.lineage,'base64');assert.equal(data.toString('base64'),appearance.lineage);assert.equal(data.length%9,0);const rows=[];for(let i=0;i<data.length;i+=9)rows.push({id:data[i],prefix:data.subarray(i+1,i+9).toString('hex')});assert.deepEqual(rows.map(r=>r.id),rows.map(r=>r.id).sort((a,b)=>a-b));assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);return rows;}
const appearance=(state,work)=>{assert.equal(work.appearanceRef,work.workId??work.id);assert.equal(Object.hasOwn(work,'appearance'),false);const a=state.appearances[work.appearanceRef];assert.ok(a);return a;};
function checkGraph(state,work){const a=appearance(state,work);assert.equal(a.profile,'BIO-LINE-APPEARANCE1');assert.equal(a.version,1);assert.equal(a.specimenKey,work.workId??work.id);const bytes=Buffer.from(state.appearanceGraphs[a.graphKey],'base64'),g=decodeGraph(bytes);assert.equal(bytes.length<=7713,true);assert.equal(sha(bytes),a.graphKey);assert.equal(Buffer.from(designId(g)).toString('hex'),a.structureKey);return g;}
function makeCell(r,target=4){let s,ids=[];for(let primitive=1;primitive<=4;primitive++){s=act(r,'manufacture-part',{primitive,profile:primitive===4?target:0});ids.push(s.lastResult.workId);}s=act(r,'synthesize',{target,inputIds:ids});return{id:s.lastResult.workId,inputs:ids,state:s};}

test('appearance follows actual cell and organ lineage and preserves different raw port layouts under one canonical identity',async()=>{
  const r=await fresh();let s=act(r,'project-buy-kit',{projectId:r.snapshot().selectedProjectId});
  const made=act(r,'manufacture-part',{primitive:4,profile:4}),component=made.works.find(w=>w.id===made.lastResult.workId),componentAppearance=appearance(made,component);
  assert.equal(componentAppearance.graphKey,null);assert.equal(componentAppearance.structureKey,sha(descriptorBytes({primitive:4,profile:4})));assert.deepEqual(nodes(componentAppearance),[{id:79,prefix:component.id.slice(0,16)}]);
  const firstCell=makeCell(r),cellAppearance=appearance(firstCell.state,firstCell.state.works.find(w=>w.id===firstCell.id));assert.deepEqual(nodes(cellAppearance).map(n=>n.id),[4,76,77,78,79]);assert.equal(nodes(cellAppearance).find(n=>n.id===4).prefix,firstCell.id.slice(0,16));for(const [i,id]of firstCell.inputs.entries())assert.equal(nodes(cellAppearance).find(n=>n.id===76+i).prefix,id.slice(0,16));
  const copiedCell=makeCell(r),copyAppearance=appearance(copiedCell.state,copiedCell.state.works.find(w=>w.id===copiedCell.id));assert.equal(cellAppearance.structureKey,copyAppearance.structureKey);assert.equal(cellAppearance.graphKey,copyAppearance.graphKey);assert.notEqual(cellAppearance.specimenKey,copyAppearance.specimenKey);assert.notEqual(cellAppearance.lineage,copyAppearance.lineage);
  const makeOrgan=()=>{const children=[6,7,8,9].map(role=>makeCell(r,role).id),state=act(r,'synthesize',{target:18,inputIds:children});return{id:state.lastResult.workId,children,state};};
  const first=makeOrgan(),a=appearance(first.state,first.state.works.find(w=>w.id===first.id));assert.equal(nodes(a).length,21);for(const [i,id]of first.children.entries())assert.equal(nodes(a).find(n=>n.id===6+i).prefix,id.slice(0,16));
  const original=graphOf(first.state.selectedGraph),edges=original.edges.filter(e=>e.type<=3).map(e=>{const copy=structuredClone(e);if(copy.type===1&&copy.dst.role===8)copy.dst.port=copy.dst.port===1?2:1;return copy;});
  const swapped=createGraph({...original,freeEdges:edges,v:Object.fromEntries(original.cells.map(c=>[c.role,c.v])),tiers:Object.fromEntries(original.tiers.map(t=>[t.scope,t.mode]))});
  assert.equal(Buffer.from(designId(swapped)).toString('hex'),Buffer.from(designId(original)).toString('hex'));
  act(r,'design-save',{name:'Equivalent port layout',graph:publicGraph(swapped),challenge:2000000});const second=makeOrgan(),b=appearance(second.state,second.state.works.find(w=>w.id===second.id));
  assert.equal(a.structureKey,b.structureKey);assert.notEqual(a.graphKey,b.graphKey);assert.notEqual(a.specimenKey,b.specimenKey);assert.notEqual(a.lineage,b.lineage);
  assert.deepEqual(encodeGraph(checkGraph(second.state,second.state.works.find(w=>w.id===first.id))),encodeGraph(projectGraph(original,18)));assert.deepEqual(encodeGraph(checkGraph(second.state,second.state.works.find(w=>w.id===second.id))),encodeGraph(projectGraph(swapped,18)));
  const other=second.state.designs.find(d=>d.id!==second.state.selectedDesignId);s=act(r,'design-select',{designId:other.id});assert.deepEqual(appearance(s,s.works.find(w=>w.id===first.id)),a);assert.deepEqual(appearance(s,s.works.find(w=>w.id===second.id)),b);
  s=act(r,'stake',{workId:first.id});act(r,'advance-hour',{hours:2});act(r,'exit',{workId:first.id});s=act(r,'advance-hour',{hours:1});assert.deepEqual(appearance(s,s.works.find(w=>w.id===first.id)),a);
  s=act(r,'work-launch',{workId:first.id,title:'Historical cell layout',description:'Actual sealed scope and children.',priceLamports:'1000000'});const listingId=s.lastResult.listingId;assert.deepEqual(appearance(s,s.workLaunches[0]),a);assert.deepEqual(appearance(s,s.market.listings.find(l=>l.id===listingId)),a);
  s=act(r,'market-test-counterparty-buy',{listingId});assert.deepEqual(appearance(s,s.workLaunches[0]),a);assert.equal(s.workLaunches[0].status,'SOLD');const restored=await restoreLabSimulationRuntime(JSON.parse(JSON.stringify(r.exportState())));assert.deepEqual(restored.snapshot(),s);
});

test('actual BIO lineage contains 82 real nodes and 49 designs plus the full 100-listing history remain below one MiB',async t=>{
  const r=await fresh();let s=act(r,'project-buy-kit',{projectId:r.snapshot().selectedProjectId});s=act(r,'manufacture-reference');const kitId=s.lastResult.kitId;
  s=act(r,'synthesize-cells',{kitId});for(const w of s.works)assert.equal(nodes(appearance(s,w)).length,5);
  s=act(r,'synthesize-organs',{kitId});for(const w of s.works){const graph=checkGraph(s,w);assert.equal(nodes(appearance(s,w)).length,1+graph.cells.length*5);}
  s=act(r,'synthesize-bio',{kitId});const bio=s.works[0],a=appearance(s,bio),original=structuredClone(s.selectedGraph);assert.equal(nodes(a).length,82);assert.deepEqual(nodes(a).map(n=>n.id),[...Array.from({length:22},(_,i)=>i+1),...Array.from({length:60},(_,i)=>i+64)]);checkGraph(s,bio);
  for(let i=0;i<32;i++){const graph=structuredClone(original);graph.cells.find(c=>c.role===4).v=999000-i*1000;s=act(r,'design-save',{name:`Saved variant ${i+1}`,graph,challenge:500000});}
  assert.equal(s.designs.length,49);assert.equal(s.designs.filter(d=>d.graph).length,0);assert.deepEqual(appearance(s,s.works[0]),a);
  for(let i=s.market.listings.length;i<100;i++){s=act(r,'work-launch',{workId:bio.id,title:'X'.repeat(48),description:'D'.repeat(160),priceLamports:'1000000'});s=act(r,'market-cancel',{listingId:s.lastResult.listingId});}
  assert.equal(s.market.listings.length,100);assert.equal(s.workLaunches.length,95);assert.equal(Object.keys(s.appearanceGraphs).length,1);assert.deepEqual(appearance(s,s.works[0]),a);
  const bytes=Buffer.byteLength(JSON.stringify({profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,runId:'a'.repeat(64),revision:'999999999',state:s}));assert.ok(bytes<1024*1024,`snapshot envelope ${bytes}`);assert.ok(Buffer.byteLength(JSON.stringify(s.appearanceGraphs))<=512*1024);t.diagnostic(`Maximum ordinary snapshot envelope: ${bytes} bytes; encoded graph registry: ${Buffer.byteLength(JSON.stringify(s.appearanceGraphs))} bytes; saved designs: ${s.designs.length}; listings: ${s.market.listings.length}.`);
});

test('100 real listings with 49 distinct manufactured scoped graphs use unique-root references within the bounded wire budget',async t=>{
  const r=await fresh();let s=r.snapshot();const projectId=s.selectedProjectId,original=structuredClone(s.selectedGraph),originalDesign=s.selectedDesignId;
  for(const [i,quantity]of ['124','248','62','62'].entries())s=act(r,'project-buy',{projectId,class:i+1,quantity});
  s=act(r,'manufacture-reference');const kitId=s.lastResult.kitId;s=act(r,'synthesize-cells',{kitId});
  const baseCells=new Map(s.works.filter(w=>w.scope==='CELL').map(w=>[w.target,w.id]));
  const launch=id=>{s=act(r,'work-launch',{workId:id,title:'T'.repeat(48),description:'D'.repeat(160),priceLamports:'1000000'});return s.lastResult.listingId;};
  for(const id of baseCells.values()){const listingId=launch(id);s=act(r,'market-cancel',{listingId});}
  for(let i=0;i<32;i++){
    const graph=structuredClone(original);graph.cells.find(c=>c.role===4).v=999000-i*1000;s=act(r,'design-save',{name:`Actual variant ${i+1}`,graph,challenge:500000});
    const cell=makeCell(r);launch(cell.id);
  }
  act(r,'design-select',{designId:originalDesign});
  for(const [target,roles]of [[16,[1,2]],[17,[3,4,5]]]){s=act(r,'synthesize',{target,inputIds:roles.map(role=>baseCells.get(role))});launch(s.lastResult.workId);}
  s=act(r,'manufacture-reference');const components=s.works.filter(w=>w.scope==='COMPONENT'&&w.canCompose).slice(0,46);assert.equal(components.length,46);for(const w of components)launch(w.id);
  assert.equal(s.designs.length,49);assert.equal(s.designs.filter(d=>d.graph).length,0);assert.equal(s.market.listingCollections,'DERIVED_FROM_CATEGORY');for(const field of ['materials','products','bios'])assert.equal(Object.hasOwn(s.market,field),false);assert.equal(s.market.listings.length,100);assert.equal(s.workLaunches.length,95);assert.equal(Object.keys(s.appearanceGraphs).length,49);
  const refs=new Set();for(const row of [...s.works,...s.market.listings.filter(l=>l.assetType==='WORK'),...s.market.sellableWorks,...s.workLaunches]){appearance(s,row);refs.add(row.appearanceRef);}
  assert.equal(Object.keys(s.appearances).length,refs.size);for(const l of s.market.listings)if(l.launchRef){assert.equal(Object.hasOwn(l,'launch'),false);assert.equal(s.workLaunches.find(record=>record.id===l.launchRef).appearanceRef,l.workId);}
  for(const [graphKey,encoded]of Object.entries(s.appearanceGraphs)){const bytes=Buffer.from(encoded,'base64');assert.equal(sha(bytes),graphKey);assert.ok(bytes.length<=7713);}
  const wireBytes=Buffer.byteLength(JSON.stringify({profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,runId:'a'.repeat(64),revision:'999999999',state:s})),registryBytes=Buffer.byteLength(JSON.stringify(s.appearanceGraphs));
  assert.ok(wireBytes<1024*1024,`wire ${wireBytes}`);assert.ok(registryBytes<=512*1024);assert.equal(s.ledgerInvariant.valid,true);
  t.diagnostic(`Distinct-work snapshot envelope: ${wireBytes} bytes; actual graph registry: ${registryBytes} bytes; distinct scoped graphs: ${Object.keys(s.appearanceGraphs).length}; unique referenced roots: ${refs.size}; full saved designs: ${s.designs.length}; market listings: ${s.market.listings.length}.`);
  // Serialization-length projection only. The padding is deliberately not
  // decoded, admitted, manufactured or described as valid biological evidence.
  const projected=structuredClone(s),maxGraph=Buffer.alloc(7713).toString('base64'),maxLineage=Buffer.alloc(82*9).toString('base64');
  projected.appearanceGraphs=Object.fromEntries(Array.from({length:49},(_,i)=>[i.toString(16).padStart(64,'0'),maxGraph]));
  for(const value of Object.values(projected.appearances)){value.lineage=maxLineage;value.graphKey='0'.repeat(64);}
  for(const launch of projected.workLaunches){launch.title='\\'.repeat(48);launch.description='"'.repeat(160);launch.priceLamports='18446744073709551615';}
  for(const listing of projected.market.listings)listing.priceLamports='18446744073709551615';
  const projectedBytes=Buffer.byteLength(JSON.stringify({profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,runId:'a'.repeat(64),revision:'999999999',state:projected}));
  t.diagnostic(`Conservative serialization-only projection: ${projectedBytes} bytes; 49 padded maximum graph payloads, every unique Root padded to 82-node lineage, longest escaped launch text and maximum asking-price strings. This is not a joint economic or biology validation.`);
  assert.ok(projectedBytes<1024*1024,`maximum wire-length projection ${projectedBytes}`);
});
