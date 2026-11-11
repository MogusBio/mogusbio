import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Element,allText} from './discovery-ui-fixture.mjs';
import {createSpecimenArt} from '../apps/player/dist/lab-specimen-art.js';
import {buildLineSpecimen} from '../apps/player/dist/lab-morphology.js';
import {createSeed,createFurtherImprovement,projectGraph,encodeGraph,designId,validateDesign,ORGAN_CELLS} from '../packages/biology/src/index.mjs';
import {descriptorBytes} from '../packages/composition/src/index.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
const flatten=e=>[e,...e.children.flatMap(flatten)],serial=e=>({tag:e.tagName,attributes:e.attributes,text:e.textContent,children:e.children.map(serial)});
const group=(svg,name)=>flatten(svg).find(e=>e.attributes['data-art-layer']===name);
const body=svg=>JSON.stringify(flatten(group(svg,'structure')).filter(e=>e.tagName==='path').map(e=>Object.fromEntries(Object.entries(e.attributes).filter(([key])=>['d','fill','fill-opacity','stroke','stroke-width','stroke-opacity','data-unit-kind','data-connection-type'].includes(key))))),marks=svg=>JSON.stringify(serial(group(svg,'instance-marks')));
const planA=createFurtherImprovement({stage:2}),planB=createSeed(11);
const graphIDs=target=>{
  const roles=target<=15?[target]:target<=21?ORGAN_CELLS[target-16]:Array.from({length:15},(_,i)=>i+1);
  return[...(target===22?[22,16,17,18,19,20,21]:target>15?[target]:[]),...roles,...roles.flatMap(role=>[0,1,2,3].map(i=>64+4*(role-1)+i))].sort((a,b)=>a-b);
};
function descriptor(graph=planA,{target=22,seed='specimen-a'}={}){
  const selected=target===22?graph:projectGraph(graph,target),id=hash(seed),lineage=Buffer.alloc(graphIDs(target).length*9);
  for(const [index,node]of graphIDs(target).entries()){lineage[index*9]=node;Buffer.from(node===target?id:hash(`${seed}:child:${node}`),'hex').copy(lineage,index*9+1,0,8);}
  const encoded=encodeGraph(selected);
  return{id,scope:target<=15?'CELL':target<=21?'ORGAN':'BIO',target,appearance:{profile:'BIO-LINE-APPEARANCE1',version:1,structureKey:Buffer.from(designId(selected)).toString('hex'),specimenKey:id,graphKey:hash(encoded),lineage:lineage.toString('base64'),graph:Buffer.from(encoded).toString('base64')}};
}
function component(primitive=1,profile=0,seed='component-a'){
  const id=hash(seed),role=profile||1,lineage=Buffer.alloc(9);lineage[0]=64+4*(role-1)+primitive-1;Buffer.from(id,'hex').copy(lineage,1,0,8);
  return{id,scope:'COMPONENT',primitive,profile,appearance:{profile:'BIO-LINE-APPEARANCE1',version:1,structureKey:hash(descriptorBytes({primitive,profile})),specimenKey:id,graphKey:null,lineage:lineage.toString('base64')}};
}

test('same validated plan preserves every projected structural path while real instance lineage changes its marks',()=>{
  assert.equal(validateDesign(planA).status,'PASS');
  const first=descriptor(),second=descriptor(planA,{seed:'specimen-b'}),a=createSpecimenArt(document,first),b=createSpecimenArt(document,second);
  assert.equal(a.attributes['data-source'],'construction');assert.equal(b.attributes['data-source'],'construction');assert.equal(a.attributes['data-art-structure'],b.attributes['data-art-structure']);assert.notEqual(a.attributes['data-art-specimen'],b.attributes['data-art-specimen']);assert.equal(body(a),body(b));assert.notEqual(marks(a),marks(b));
});

test('different validated biological compositions change the structural drawing, rather than only its colour or label',()=>{
  assert.equal(validateDesign(planB).status,'PASS');
  const a=createSpecimenArt(document,descriptor()),b=createSpecimenArt(document,descriptor(planB,{seed:'seed-b'}));assert.equal(a.attributes['data-source'],'construction');assert.equal(b.attributes['data-source'],'construction');assert.notEqual(a.attributes['data-art-structure'],b.attributes['data-art-structure']);assert.notEqual(body(a),body(b));
});

test('SVG consumes exactly the shared line-scene units and connections at every constructed layer',()=>{
  for(const value of [component(1),component(4,4),descriptor(planA,{target:4}),descriptor(planA,{target:16}),descriptor()]){
    const scene=buildLineSpecimen(value),svg=createSpecimenArt(document,value);assert.equal(scene.profile,'BIO-LINE-GEOMETRY1');assert.equal(scene.source,'construction');assert.equal(svg.attributes['data-art-profile'],scene.profile);assert.equal(svg.attributes['data-art-structure'],scene.structureKey);assert.equal(svg.attributes['data-art-specimen'],scene.specimenKey);
    const shapes=group(svg,'units').children;assert.equal(shapes.reduce((n,e)=>n+Number(e.attributes['data-unit-count']),0),scene.units.length);assert.deepEqual(new Set(shapes.flatMap(e=>e.attributes['data-unit-ids'].split(' '))),new Set(scene.units.map(unit=>String(unit.id))));
    const connections=group(svg,'connections').children;assert.equal(connections.reduce((n,e)=>n+Number(e.attributes['data-connection-count']),0),scene.connections.filter(link=>link.points.length>=2).length);assert.equal(shapes.reduce((n,e)=>n+(e.attributes.d.match(/\bM/g)??[]).length,0),scene.units.length);
    for(const element of [...shapes,...connections,...group(svg,'instance-marks').children]){assert.doesNotMatch(element.attributes.d,/NaN|Infinity|undefined/);const coordinates=element.attributes.d.match(/-?\d+(?:\.\d+)?/g).map(Number);assert.ok(coordinates.every(Number.isFinite));}
    assert.ok(flatten(svg).length<=30,`bounded SVG DOM for ${value.scope}: ${flatten(svg).length}`);assert.match(allText(svg),/CONSTRUCTION/);assert.doesNotMatch(allText(svg),/real anatomical reconstruction/);
  }
});

test('a hundred organism cards retain bounded DOM rather than allocating a separate element for every connection',()=>{
  const value=descriptor(),scene=buildLineSpecimen(value);assert.ok(scene.units.length<=82);assert.ok(scene.connections.length<=440);let total=0;
  for(let i=0;i<100;i++){const svg=createSpecimenArt(document,value);total+=flatten(svg).length;assert.equal(svg.attributes['data-art-structure'],scene.structureKey);}
  assert.ok(total<=3000,`100 cards generated ${total} DOM elements`);
});

test('an owned work and its marketplace listing render the same existing specimen, not the listing identity',()=>{
  const owned=descriptor(),listing={...structuredClone(owned),id:hash('listing-id'),workId:owned.id,assetType:'WORK'};const a=createSpecimenArt(document,owned),b=createSpecimenArt(document,listing);assert.equal(b.attributes['data-source'],'construction');assert.equal(a.attributes['data-art-specimen'],b.attributes['data-art-specimen']);assert.equal(body(a),body(b));assert.equal(marks(a),marks(b));
});

test('missing or unbound appearance uses the same explicit reference geometry as the 3D consumer',()=>{
  const invalid=descriptor();invalid.appearance.specimenKey=hash('some-other-work');
  for(const value of [{scope:'BIO'},{scope:'CELL',target:4},{scope:'ORGAN',target:16},invalid]){
    const scene=buildLineSpecimen(value),svg=createSpecimenArt(document,value);assert.equal(scene.source,'reference');assert.equal(svg.attributes['data-source'],'reference');assert.equal(svg.attributes['data-art-structure'],scene.structureKey);assert.equal(svg.attributes['data-art-specimen'],scene.specimenKey??'');assert.equal(svg.attributes['data-art-specimen'],'');assert.match(allText(svg),/REFERENCE/);assert.match(allText(svg),/no valid construction appearance/);
  }
});

test('construction rendering never mutates the immutable shared scene or source appearance',()=>{
  const value=descriptor(),before=JSON.stringify(value),scene=buildLineSpecimen(value),snapshot=JSON.stringify(scene);assert.ok(Object.isFrozen(scene));assert.ok(Object.isFrozen(scene.units));assert.ok(Object.isFrozen(scene.units[0].contour));createSpecimenArt(document,value);createSpecimenArt(document,value,{compact:true});assert.equal(JSON.stringify(value),before);assert.equal(JSON.stringify(scene),snapshot);
});

test('BIO remains an organism and a material remains a chemistry schematic, without structural identity fabrication',()=>{
  const bio=createSpecimenArt(document,descriptor());assert.equal(bio.attributes['data-art-kind'],'organism');assert.match(allText(bio),/DIGITAL ORGANISM/);assert.doesNotMatch(allText(bio),/FUNCTIONAL ORGAN/);
  const chemical=createSpecimenArt(document,{assetType:'MATERIAL',class:1});assert.equal(chemical.attributes['data-source'],'chemical-schematic');assert.equal(chemical.attributes['data-art-structure'],undefined);assert.match(allText(chemical),/AMINO-ACID FAMILY/);
});

test('individual line marks stay independent segment pairs in the SVG projection',()=>{const value=descriptor(),scene=buildLineSpecimen(value),svg=createSpecimenArt(document,value),layer=group(svg,'instance-marks'),d=layer.children.map(p=>p.attributes.d).join(' ');assert.equal((d.match(/\bM/g)??[]).length,scene.units.reduce((n,u)=>n+u.mark.length/2,0));assert.equal((d.match(/\bL/g)??[]).length,scene.units.reduce((n,u)=>n+u.mark.length/2,0));});
