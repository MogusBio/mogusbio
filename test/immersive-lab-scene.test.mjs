import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {encodeGraph,projectGraph,validateGraph,members,scopes} from '../packages/biology/src/index.mjs';
import {createPublishedC310Graph} from '../packages/biology/src/published-c310.mjs';

// Use the exact locally served vendor, rather than a separate npm Three version.
const vendorUrl=new URL('../apps/player/dist/lab-assets/three.module.js',import.meta.url);
const THREE=await import(vendorUrl.href);
const source=await readFile(new URL('../apps/player/dist/lab-scene-geometries.js',import.meta.url),'utf8');
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const geometryUrl=moduleUrl(source.replace("'/lab-assets/three.module.js'",JSON.stringify(vendorUrl.href)));
const geometries=await import(geometryUrl);
const dataset=JSON.parse(await readFile(new URL('../apps/player/dist/lab-assets/molecules.json',import.meta.url),'utf8'));
const compounds=dataset.compounds;
const biological={cell:geometries.createCell,heart:geometries.createHeart,brain:geometries.createBrain,organism:geometries.createOrganism};
const counts={glycine:[5,4],atp:[31,33],dopc:[54,53],glucose:[12,12]};
const colors={C:0x3b4746,O:0xcd6b59,N:0x6191c4,P:0xdaaa55};
const epsilon=4e-5;
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<epsilon,`${message}: ${actual} != ${expected}`);
const vectorNear=(actual,expected,message)=>near(actual.distanceTo(expected),0,message);

function resources(group){
  const geometry=new Set(),material=new Set();
  group.traverse(object=>{
    if(object.geometry)geometry.add(object.geometry);
    for(const item of Array.isArray(object.material)?object.material:object.material?[object.material]:[])material.add(item);
  });
  return {geometry,material};
}

function assertFiniteGeometry(group){
  let meshes=0,vertices=0;
  group.updateMatrixWorld(true);
  group.traverse(object=>{
    assert.ok(object.matrixWorld.elements.every(Number.isFinite),'finite world matrix');
    if(!object.isMesh)return;
    meshes++;
    const geometry=object.geometry,position=geometry.getAttribute('position');
    assert.ok(position?.count>0,'nonempty positions');
    vertices+=position.count;
    for(const [name,attribute]of Object.entries(geometry.attributes)){
      assert.ok(Array.from(attribute.array).every(Number.isFinite),`finite ${name}`);
    }
    if(geometry.index)for(const index of geometry.index.array){
      assert.ok(Number.isInteger(index)&&index>=0&&index<position.count,'valid triangle index');
    }
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    assert.ok([...geometry.boundingBox.min.toArray(),...geometry.boundingBox.max.toArray(),geometry.boundingSphere.radius].every(Number.isFinite),'finite geometry bounds');
    if(object.isInstancedMesh){
      const matrix=new THREE.Matrix4();
      for(let i=0;i<object.count;i++){object.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite),'finite instance matrix');}
    }
  });
  assert.ok(meshes>0&&vertices>0,'visible mesh geometry');
  assert.ok(vertices<30000,'specimen remains within a small procedural geometry budget');
  const bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3());
  assert.ok(size.toArray().every(n=>Number.isFinite(n)&&n>0),'visible three-dimensional bounds');
}

function normalizedAtoms(compound){
  const points=compound.atoms.map(atom=>new THREE.Vector3(atom.x,atom.y,atom.z));
  const bounds=new THREE.Box3().setFromPoints(points),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const scale=3.25/Math.max(size.x,size.y,size.z,1);
  return {points:points.map(point=>point.sub(center).multiplyScalar(scale)),scale};
}

function atomInstances(group,compound){
  const spheres=group.children.filter(object=>object.isInstancedMesh&&object.geometry.type==='SphereGeometry');
  const elements=[...new Set(compound.atoms.map(atom=>atom.element))],positions=new Array(compound.atoms.length);
  assert.equal(spheres.length,elements.length,'one instanced mesh per atomic element');
  const matrix=new THREE.Matrix4();
  for(let i=0;i<elements.length;i++){
    const element=elements[i],mesh=spheres[i],indices=compound.atoms.flatMap((atom,index)=>atom.element===element?[index]:[]);
    assert.equal(mesh.count,indices.length,'one sphere for every source atom');
    assert.equal(mesh.material.color.getHex(),colors[element],'stable chemical element color');
    for(let n=0;n<indices.length;n++){
      mesh.getMatrixAt(n,matrix);positions[indices[n]]=new THREE.Vector3().setFromMatrixPosition(matrix);
    }
  }
  assert.ok(spheres.every(mesh=>mesh.geometry===spheres[0].geometry),'atomic spheres share geometry');
  return positions;
}

test('immersive specimens use the shipped pinned Three r160 and verified molecule profile',()=>{
  assert.equal(THREE.REVISION,'160');
  assert.equal(dataset.profile,'BIOLAB-MOLECULES1');
  assert.deepEqual(Object.keys(compounds).sort(),Object.keys(counts).sort());
});

for(const [id,create]of Object.entries(biological))test(`3D ${id} specimen has finite, bounded, drawable geometry`,()=>{
  const group=create();
  try{
    assert.ok(group.isGroup);
    assert.equal(group.userData.kind,id);
    assertFiniteGeometry(group);
  }finally{geometries.disposeSpecimen(group);}
});

test('four distinct functional components render finite geometry without claiming to be cells or proteins',()=>{
  const names=new Set();
  for(let primitive=1;primitive<=4;primitive++){
    const profile=primitive===4?4:0,group=geometries.createComponent({primitive,profile});
    try{assertFiniteGeometry(group);assert.equal(group.userData.kind,'component');assert.equal(group.userData.primitive,primitive);assert.equal(group.userData.profile,profile);assert.equal(group.userData.illustration,true);names.add(group.name);}
    finally{geometries.disposeSpecimen(group);}
  }
  assert.equal(names.size,4);assert.throws(()=>geometries.createComponent({primitive:4,profile:0}),/COMPONENT_DESCRIPTOR/);
});

test('functional organs contain their exact fixed cell roles and remain separate from human anatomy',()=>{
  const expected=[[1,2],[3,4,5],[6,7,8,9],[10,11],[12,13],[14,15]];
  for(let target=16;target<=21;target++){
    const group=geometries.createFunctionalOrgan({target});
    try{assertFiniteGeometry(group);assert.equal(group.userData.kind,'organ');assert.equal(group.userData.target,target);assert.deepEqual(group.userData.cellRoles,expected[target-16]);assert.deepEqual(group.children.filter(child=>child.userData.kind==='cell').map(child=>child.userData.role),expected[target-16]);assert.ok(group.children.every(child=>child.userData.kind!=='heart'),'functional organ is not the illustrative human heart');}
    finally{geometries.disposeSpecimen(group);}
  }
  for(const target of [15,22,'17',16.5])assert.throws(()=>geometries.createFunctionalOrgan({target}),/ORGAN_DESCRIPTOR/);
});

function lineUnit(id,kind,position=[0,0,0],radii=[1,.7,.4],parent=null){
  const contour=Array.from({length:32},(_,index)=>{const angle=index/32*Math.PI*2;return[position[0]+Math.cos(angle)*radii[0],position[1]+Math.sin(angle)*radii[1],position[2]];});
  return{id,kind,parent,position,radii,role:kind==='cell'?4:undefined,target:kind==='organ'?17:undefined,contour,mark:[[position[0]-.1,position[1],position[2]+.1],[position[0],position[1]+.08,position[2]+.1],[position[0]+.05,position[1]-.1,position[2]+.12],[position[0]+.12,position[1]-.02,position[2]+.12]]};
}
function lineModel(){return{profile:'BIO-LINE-GEOMETRY1',scope:'BIO',structureKey:'struct-a',specimenKey:'specimen-a',source:'construction',units:[lineUnit('body','body'),lineUnit('cell4','cell',[.3,.1,.15],[.3,.23,.2],'body')],connections:[{owner:'body',type:1,width:.02,points:[[0,0,0],[.15,.2,.1],[.3,.1,.15]]}],bounds:{min:[-1,-.7,-.4],max:[1,.7,.4]}};}
const linePositions=group=>group.children.filter(child=>child.isLineSegments).flatMap(child=>Array.from(child.geometry.attributes.position.array));
const faceMatrices=group=>group.children.filter(child=>child.isInstancedMesh).flatMap(child=>Array.from(child.instanceMatrix.array));

test('construction renderer uses the supplied contours, independent mark pairs and actual 3D radii',()=>{
  const model=lineModel(),before=JSON.stringify(model),group=geometries.createLineSpecimen(model);
  try{
    assert.equal(group.userData.profile,model.profile);assert.equal(group.userData.source,'construction');assert.equal(group.userData.structureKey,model.structureKey);assert.equal(group.userData.specimenKey,model.specimenKey);assert.equal(group.userData.unitCount,2);
    const body=group.children.find(child=>child.isLineSegments&&child.userData.layer==='body'),positions=body.geometry.attributes.position.array;
    assert.deepEqual(Array.from(positions.slice(0,3)),model.units[0].contour[0]);
    const markStart=32*6;for(let i=0;i<12;i++)near(positions[markStart+i],model.units[0].mark.flat()[i],'independent mark segment endpoints are preserved without joining pairs');
    const faces=group.children.filter(child=>child.isInstancedMesh);assert.equal(faces.length,2);assert.equal(new Set(faces.map(face=>face.geometry)).size,1,'all kind layers share one low-poly volume geometry');
    const box=new THREE.Box3().setFromObject(group),size=box.getSize(new THREE.Vector3());assert.ok(size.x>0&&size.y>0&&size.z>.7,'the construction has real depth rather than a flat canvas');
    const matrix=new THREE.Matrix4();faces.find(face=>face.userData.layer==='cell').getMatrixAt(0,matrix);vectorNear(new THREE.Vector3().setFromMatrixPosition(matrix),new THREE.Vector3(...model.units[1].position),'cell position comes from the construction');
    assert.equal(JSON.stringify(model),before,'rendering never mutates the construction record');
  }finally{geometries.disposeSpecimen(group);}
});

test('structure and width changes alter geometry while individual marks leave the body layout unchanged',()=>{
  const base=lineModel(),changed=structuredClone(base),individual=structuredClone(base);changed.structureKey='struct-b';changed.units[1].radii[0]=.5;changed.connections[0].width=.04;individual.specimenKey='specimen-b';individual.units[0].mark[0][1]+=.12;
  const groups=[base,changed,individual].map(model=>geometries.createLineSpecimen(model));
  try{assert.notDeepEqual(linePositions(groups[0]),linePositions(groups[1]));assert.notDeepEqual(faceMatrices(groups[0]),faceMatrices(groups[1]),'capacity-derived radius changes affect visible 3D volume');assert.notDeepEqual(linePositions(groups[0]),linePositions(groups[2]),'individual line marks are visible');assert.deepEqual(faceMatrices(groups[0]),faceMatrices(groups[2]),'an instance mark does not rescale or replace the structural body');}
  finally{for(const group of groups)geometries.disposeSpecimen(group);}
});

test('maximum construction stays within 18 draw layers and a bounded line/volume budget, then disposes once',()=>{
  const model=lineModel();model.units=Array.from({length:82},(_,i)=>lineUnit(`unit-${i}`,i===0?'body':i<=6?'organ':i<=21?'cell':'component',[(i%9-4)*.15,(Math.floor(i/9)-4)*.13,(i%5-2)*.08],[.11,.1,.08],i?'unit-0':null));
  for(const [index,unit]of model.units.entries())unit.mark=Array.from({length:index===0?512:32},(_,i)=>[unit.position[0]+(i%8)*.002,unit.position[1]+Math.floor(i/8)*.001,unit.position[2]+.002]);
  model.connections=Array.from({length:440},(_,i)=>{const a=model.units[i%82].position,b=model.units[(i*7+5)%82].position;return{owner:'unit-0',type:i%10+1,width:.008+i%5*.003,points:Array.from({length:9},(_,j)=>a.map((value,axis)=>value+(b[axis]-value)*j/8))};});
  const group=geometries.createLineSpecimen(model);
  try{
    assert.ok(group.children.length<=18,'at most four kind outlines, ten connection types and four instanced face layers');let vertices=0;
    for(const child of group.children){const positions=child.geometry.attributes.position;assert.ok(Array.from(positions.array).every(Number.isFinite));vertices+=positions.count;if(child.isLineSegments)assert.equal(positions.count%2,0,'paired line endpoints');}
    assert.ok(vertices<50000,'82 units and 440 links do not expand into per-edge tube meshes');
    const {geometry,material}=resources(group),counts=new Map();for(const item of [...geometry,...material]){counts.set(item,0);item.addEventListener('dispose',()=>counts.set(item,counts.get(item)+1));}geometries.disposeSpecimen(group);for(const count of counts.values())assert.equal(count,1);
  }catch(error){geometries.disposeSpecimen(group);throw error;}
});

test('malformed construction geometry is rejected before any render resource is created',()=>{
  const bad=mutate=>{const model=lineModel();mutate(model);assert.throws(()=>geometries.createLineSpecimen(model),/LINE_SPECIMEN_/);};
  bad(model=>model.units=Array(83).fill(model.units[0]));bad(model=>model.connections=Array(441).fill(model.connections[0]));bad(model=>model.units[0].contour[0][0]=NaN);bad(model=>model.units[0].radii[2]=0);bad(model=>model.units[1].id=model.units[0].id);bad(model=>model.units[0].mark.pop());bad(model=>model.source='actual');bad(model=>model.connections[0].width=-1);
});

for(const [id,[atoms,bonds]]of Object.entries(counts))test(`${id} preserves source atoms, rigid bond lengths and bond multiplicity`,()=>{
  const compound=compounds[id],before=JSON.stringify(compound),group=geometries.createMolecule(compound);
  try{
    assert.equal(compound.atoms.length,atoms);assert.equal(compound.bonds.length,bonds);
    assert.equal(group.userData.kind,'molecule');assert.equal(group.userData.compound,compound);
    assertFiniteGeometry(group);
    const {points,scale}=normalizedAtoms(compound),positions=atomInstances(group,compound);
    for(let i=0;i<points.length;i++)vectorNear(positions[i],points[i],`source atom ${i}`);
    for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
      const a=compound.atoms[i],b=compound.atoms[j],sourceDistance=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
      near(positions[i].distanceTo(positions[j]),sourceDistance*scale,`rigid atomic distance ${i}/${j}`);
    }
    const sticks=group.children.filter(object=>object.isInstancedMesh&&object.geometry.type==='CylinderGeometry');
    assert.equal(sticks.length,1,'bonds share one instanced mesh');
    const mesh=sticks[0],matrix=new THREE.Matrix4();
    assert.equal(mesh.count,compound.bonds.reduce((sum,[,,order=1])=>sum+order,0),'one cylinder per bond-order stroke');
    let cursor=0;
    for(const [a,b,order=1]of compound.bonds){
      const direction=points[b].clone().sub(points[a]),center=points[a].clone().add(points[b]).multiplyScalar(.5),midpoints=[];
      const length=direction.length();direction.normalize();
      for(let stroke=0;stroke<order;stroke++){
        mesh.getMatrixAt(cursor++,matrix);
        const start=new THREE.Vector3(0,-.5,0).applyMatrix4(matrix),end=new THREE.Vector3(0,.5,0).applyMatrix4(matrix);
        near(start.distanceTo(end),length,'cylinder retains source bond length');
        vectorNear(end.clone().sub(start).normalize(),direction,'cylinder follows source bond direction');
        const midpoint=start.add(end).multiplyScalar(.5);midpoints.push(midpoint);
        near(midpoint.clone().sub(center).dot(direction),0,'parallel strokes stay perpendicular to the bond');
      }
      const average=midpoints.reduce((sum,point)=>sum.add(point),new THREE.Vector3()).multiplyScalar(1/order);
      vectorNear(average,center,'bond strokes are centered on the source connection');
      for(let i=1;i<midpoints.length;i++)assert.ok(midpoints[i].distanceTo(midpoints[i-1])>epsilon,'multiple bonds have distinct strokes');
    }
    assert.equal(JSON.stringify(compound),before,'display construction does not mutate scientific data');
  }finally{geometries.disposeSpecimen(group);}
});

test('DOPC keeps its official 2D atom graph and the other compounds retain 3D coordinates',()=>{
  for(const [id,compound]of Object.entries(compounds)){
    const group=geometries.createMolecule(compound);
    try{
      const positions=atomInstances(group,compound);
      if(id==='dopc'){
        assert.equal(compound.coordinateType,'2D');
        assert.ok(compound.atoms.every(atom=>atom.z===0));
        assert.ok(positions.every(point=>Math.abs(point.z)<epsilon),'no invented out-of-plane atom coordinates');
      }else{
        assert.equal(compound.coordinateType,'3D');
        assert.ok(positions.some(point=>Math.abs(point.z)>epsilon),'source conformer retains depth');
      }
    }finally{geometries.disposeSpecimen(group);}
  }
});

test('specimen disposal releases every unique material and geometry once, including shared atomic spheres',()=>{
  const groups=[...Object.values(biological).map(create=>create()),geometries.createComponent(),geometries.createFunctionalOrgan({target:18}),...Object.values(compounds).map(compound=>geometries.createMolecule(compound))];
  for(const group of groups){
    const {geometry,material}=resources(group),events=new Map();
    for(const resource of [...geometry,...material]){events.set(resource,0);resource.addEventListener('dispose',()=>events.set(resource,events.get(resource)+1));}
    geometries.disposeSpecimen(group);
    assert.ok(events.size>0);
    for(const count of events.values())assert.equal(count,1,'shared resources must not be disposed multiple times');
  }
});

test('unavailable or malformed molecule data cannot produce a selectable specimen',()=>{
  for(const compound of [null,{}, {atoms:[],bonds:[]},{atoms:Array(601).fill({element:'C',x:0,y:0,z:0}),bonds:[]}]){
    assert.throws(()=>geometries.createMolecule(compound),/MOLECULE_DATA_UNAVAILABLE/);
  }
  assert.throws(()=>geometries.createMolecule({atoms:[{element:'C',x:NaN,y:0,z:0}],bonds:[]}),/MOLECULE_COORDINATES/);
  const atoms=[{element:'C',x:0,y:0,z:0},{element:'O',x:1,y:1,z:0}];
  for(const bond of [[0,0,1],[0,2,1],[-1,1,1],[.5,1,1],[0,1,4]]){
    assert.throws(()=>geometries.createMolecule({atoms,bonds:[bond]}),/MOLECULE_BOND/);
  }
});

// Keep all real Three geometry/camera behavior. Only the GPU renderer and browser
// scheduling surfaces are replaced so input/lifecycle can run deterministically.
const rendererKey=Symbol.for('biolab.immersiveSceneTestRenderer');
const rendererAdapter=moduleUrl(`export * from ${JSON.stringify(vendorUrl.href)}; export class WebGLRenderer { constructor(options) { return new globalThis[Symbol.for('biolab.immersiveSceneTestRenderer')](options); } }`);
const sceneSource=await readFile(new URL('../apps/player/dist/lab-scene.js',import.meta.url),'utf8');
const morphologyUrl=new URL('../apps/player/dist/lab-morphology.js',import.meta.url);
const {buildLineSpecimen}=await import(morphologyUrl.href);
const {createLabScene}=await import(moduleUrl(sceneSource.replace("'/lab-assets/three.module.js'",JSON.stringify(rendererAdapter)).replace("'./lab-scene-geometries.js'",JSON.stringify(geometryUrl)).replace("'./lab-morphology.js'",JSON.stringify(morphologyUrl.href))));

function constructionDescriptor({scope='BIO',target=22,primitive=4,profile=4,graph=createPublishedC310Graph(),id='ab'.repeat(32)}={}){
  const partNode=role=>64+4*(role-1)+primitive-1,rootNode=scope==='COMPONENT'?partNode(profile||1):target,actual=scope==='COMPONENT'?null:target===22?graph:projectGraph(graph,target),bytes=actual?Buffer.from(encodeGraph(actual)):null;
  const nodes=scope==='COMPONENT'?[rootNode]:[...scopes(target),...members(target).flatMap(role=>[1,2,3,4].map(p=>64+4*(role-1)+p-1))].sort((a,b)=>a-b);
  const lineage=Buffer.concat(nodes.map(node=>Buffer.concat([Buffer.from([node]),node===rootNode?Buffer.from(id.slice(0,16),'hex'):createHash('sha256').update(`child:${node}`).digest().subarray(0,8)]))).toString('base64');
  return{scope,target,primitive:scope==='COMPONENT'?primitive:undefined,profile:scope==='COMPONENT'?profile:undefined,id,appearance:{profile:'BIO-LINE-APPEARANCE1',version:1,structureKey:createHash('sha256').update(bytes??Buffer.from([1,0,primitive,profile])).digest('hex'),specimenKey:id,graphKey:bytes?createHash('sha256').update(bytes).digest('hex'):null,...(bytes?{graph:bytes.toString('base64')}:{}),lineage}};
}

test('real encoded construction graphs drive all four scopes instead of preset animal geometry',()=>{
  for(const [scope,target,count]of [['COMPONENT',0,1],['CELL',4,5],['ORGAN',17,16],['BIO',22,82]]){
    const descriptor=constructionDescriptor({scope,target}),model=buildLineSpecimen(descriptor),group=geometries.createLineSpecimen(model);
    try{assert.equal(model.source,'construction',`${scope} decoder accepts the actual graph/lineage`);assert.equal(group.userData.source,'construction');assert.equal(group.userData.unitCount,count);assert.equal(group.userData.specimenKey,descriptor.id);assert.ok(model.units.find(unit=>unit.parent===null).mark.length===512,'root marks preserve the complete individual key');assert.ok(group.children.every(child=>child.isLineSegments||child.isInstancedMesh),'actual specimens contain only construction layers, not the illustrative animal template');}
    finally{geometries.disposeSpecimen(group);}
  }
});

test('actual graph capacity/layout changes affect 3D construction, while instance-only changes affect marks',()=>{
  const graph=createPublishedC310Graph(),capacity=structuredClone(graph),layout=structuredClone(graph);capacity.cells.find(cell=>cell.role===4).v=900000;
  const a=layout.slots.find(slot=>slot.role===4),b=layout.slots.find(slot=>slot.role===10);[a.x,b.x]=[b.x,a.x];[a.y,b.y]=[b.y,a.y];validateGraph(capacity);validateGraph(layout);
  const descriptors=[constructionDescriptor({graph}),constructionDescriptor({graph:capacity,id:'cd'.repeat(32)}),constructionDescriptor({graph:layout,id:'ef'.repeat(32)}),constructionDescriptor({graph,id:'91'.repeat(32)})],models=descriptors.map(buildLineSpecimen),groups=models.map(geometries.createLineSpecimen);
  try{assert.ok(models.every(model=>model.source==='construction'));assert.notDeepEqual(faceMatrices(groups[0]),faceMatrices(groups[1]),'actual capacity is visible in radii and volume');assert.notDeepEqual(faceMatrices(groups[0]),faceMatrices(groups[2]),'actual occupied positions control the 3D layout');assert.deepEqual(faceMatrices(groups[0]),faceMatrices(groups[3]),'a new individual does not replace the graph-derived body');assert.notDeepEqual(linePositions(groups[0]),linePositions(groups[3]),'the individual still has distinct full-key line marks');}
  finally{for(const group of groups)geometries.disposeSpecimen(group);}
});

test('BIO ink prioritizes its outer structure without hiding real links or dimming standalone cells',()=>{
  const bioModel=buildLineSpecimen(constructionDescriptor()),cellModel=buildLineSpecimen(constructionDescriptor({scope:'CELL',target:4})),bio=geometries.createLineSpecimen(bioModel),cell=geometries.createLineSpecimen(cellModel);
  const layer=(group,name)=>group.children.find(child=>child.isLineSegments&&child.userData.layer===name);
  try{
    const expected={body:[.95,'2f4b39'],organ:[.50,'617454'],cell:[.24,'7c9a80'],component:[.10,'9fb38b']};
    for(const [kind,[opacity,color]]of Object.entries(expected)){assert.equal(layer(bio,kind).material.opacity,opacity);assert.equal(layer(bio,kind).material.color.getHexString(),color);}
    assert.ok(layer(bio,'body').material.opacity>layer(bio,'organ').material.opacity&&layer(bio,'organ').material.opacity>layer(bio,'cell').material.opacity&&layer(bio,'cell').material.opacity>layer(bio,'component').material.opacity,'outer body and organs read before internal component detail');
    const links=bio.children.filter(child=>child.isLineSegments&&child.userData.layer.startsWith('link:'));assert.equal(links.length,new Set(bioModel.connections.map(connection=>connection.type)).size,'every actual connection type is retained');for(const link of links)assert.equal(link.material.opacity,.10);
    const actualLinkVertices=links.reduce((sum,link)=>sum+link.geometry.attributes.position.count,0),expectedLinkVertices=bioModel.connections.reduce((sum,connection)=>sum+(connection.points.length-1)*2*3,0);assert.equal(actualLinkVertices,expectedLinkVertices,'style hierarchy does not remove, simplify or filter connections');
    assert.equal(bio.userData.unitCount,82);assert.ok(layer(cell,'cell').material.opacity>=.9);assert.ok(layer(cell,'component').material.opacity>=.6,'a standalone cell still reveals its components');for(const link of cell.children.filter(child=>child.isLineSegments&&child.userData.layer.startsWith('link:')))assert.ok(link.material.opacity>=.4,'standalone functional connections remain readable');
  }finally{geometries.disposeSpecimen(bio);geometries.disposeSpecimen(cell);}
});

class TrackedEvents extends EventTarget{
  listeners=new Map();
  addEventListener(type,callback,options){super.addEventListener(type,callback,options);if(!this.listeners.has(type))this.listeners.set(type,new Map());this.listeners.get(type).set(callback,options);}
  removeEventListener(type,callback,options){super.removeEventListener(type,callback,options);this.listeners.get(type)?.delete(callback);}
  listenerCount(){return [...this.listeners.values()].reduce((sum,entries)=>sum+entries.size,0);}
}

async function runtimeFixture(options={}){
  const saved=new Map(),frames=new Map(),observers=[];let nextFrame=1,clock=100,renderer;
  const document=new TrackedEvents();document.hidden=false;
  const window=new TrackedEvents();window.devicePixelRatio=1;window.getComputedStyle=()=>({touchAction:options.touchAction??'none'});
  const rect={left:options.left??0,top:options.top??0,width:options.width??800,height:options.height??600};
  const canvas=new TrackedEvents();canvas.style={};canvas.getContext=()=>null;canvas.getBoundingClientRect=()=>({...rect});canvas.focus=()=>document.activeElement=canvas;document.activeElement=canvas;document.querySelector=()=>options.dialogOpen?{}:null;
  const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  const restore=()=>{for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
  set('window',window);set('document',document);
  set('requestAnimationFrame',callback=>{const id=nextFrame++;frames.set(id,callback);return id;});set('cancelAnimationFrame',id=>frames.delete(id));
  set('ResizeObserver',class{observe(){}disconnect(){this.disconnected=true;}});
  set('IntersectionObserver',class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}});
  set(rendererKey,class{
    constructor(){renderer=this;this.shadowMap={};this.info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};this.ratio=1;this.disposals=0;}
    setClearColor(){}setSize(){}setPixelRatio(value){this.ratio=value;}getPixelRatio(){return this.ratio;}
    render(scene,camera){scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);this.scene=scene;this.camera=camera.clone();this.info.render.calls=1;}
    dispose(){this.disposals++;}
  });
  let api;
  try{api=await createLabScene({canvas,moleculeData:dataset,quality:'high',...options});}catch(error){restore();throw error;}
  const tick=(time=clock+1000/60)=>{clock=time;const callbacks=[...frames.values()];frames.clear();assert.ok(callbacks.length<=1,'only one animation callback is scheduled');for(const callback of callbacks)callback(time);};
  return {api,canvas,document,window,frames,observers,get renderer(){return renderer;},tick,
    advance(count){for(let i=0;i<count;i++)tick();},
    wheel(deltaY,deltaMode=0){const event=new Event('wheel',{cancelable:true});Object.assign(event,{deltaY,deltaMode});canvas.dispatchEvent(event);return event;},
    close(){try{api.dispose();}finally{restore();}}
  };
}

function clickWorldPoint(fixture,point){
  const projected=new THREE.Vector3(...point).project(fixture.renderer.camera),rect=fixture.canvas.getBoundingClientRect();
  assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1,'apparatus anchor is inside the actual canvas');
  for(const type of ['pointerdown','pointerup']){const event=new Event(type);Object.assign(event,{button:0,pointerId:1,clientX:rect.left+(projected.x+1)/2*rect.width,clientY:rect.top+(1-projected.y)/2*rect.height});fixture.canvas.dispatchEvent(event);}
  return projected;
}

test('inspection wheel zoom schedules idle rendering, respects units and distance bounds, and cleans up its listener',async()=>{
  const fixture=await runtimeFixture({reducedMotion:true}),target=new THREE.Vector3(0,2.85,0);fixture.api.setNavigationMode('inspect');
  try{
    const distance=()=>fixture.renderer.camera.position.distanceTo(target);
    assert.equal([...fixture.canvas.listeners.get('wheel').values()][0].passive,false);
    fixture.tick();assert.equal(fixture.frames.size,0,'reduced-motion scene becomes idle');
    const initial=distance();
    assert.equal(fixture.wheel(-1).defaultPrevented,true);assert.equal(fixture.frames.size,1,'wheel wakes an idle scene');fixture.tick();
    const pixelChange=initial-distance(),beforeLine=distance();
    fixture.wheel(-1,1);fixture.tick();assert.ok(beforeLine-distance()>pixelChange*10,'line-mode wheels use their larger unit');
    for(let i=0;i<20;i++)fixture.wheel(-1e9,2);fixture.tick();near(distance(),6,'closest view is bounded');
    for(let i=0;i<20;i++)fixture.wheel(1e9);fixture.tick();near(distance(),24,'farthest view is bounded');
    for(const delta of [NaN,Infinity,-Infinity,0])assert.equal(fixture.wheel(delta).defaultPrevented,false,'invalid/empty wheel input leaves normal scrolling alone');
    assert.equal(fixture.frames.size,0,'invalid input does not schedule a frame');
    fixture.api.dispose();fixture.api.dispose();
    assert.equal(fixture.renderer.disposals,1,'renderer disposal is idempotent');
    assert.equal(fixture.canvas.listenerCount(),0);assert.equal(fixture.document.listenerCount(),0);assert.equal(fixture.window.listenerCount(),0);
    assert.equal(fixture.frames.size,0);assert.ok(fixture.observers.every(observer=>observer.disconnected));
    assert.equal(fixture.wheel(200).defaultPrevented,false,'disposed canvas no longer captures scrolling');
  }finally{fixture.close();}
});

test('page-flow canvas leaves wheel and vertical touch to scrolling while keeping horizontal orbit',async()=>{
  const selections=[],fixture=await runtimeFixture({reducedMotion:true,touchAction:'pan-y',onSelect:value=>selections.push(value)});
  const pointer=(type,x,y)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerType:'touch',pointerId:1,clientX:x,clientY:y});fixture.canvas.dispatchEvent(event);assert.equal(event.defaultPrevented,false,'vertical page gestures are never prevented');};
  try{
    fixture.tick();const initial=fixture.renderer.camera.position.clone(),initialDirection=fixture.renderer.camera.getWorldDirection(new THREE.Vector3());
    assert.equal(fixture.wheel(-300).defaultPrevented,false);assert.equal(fixture.frames.size,0,'page wheel does not zoom or schedule scene rendering');
    pointer('pointerdown',400,300);pointer('pointermove',401,340);pointer('pointerup',401,340);fixture.tick();
    vectorNear(fixture.renderer.camera.position,initial,'vertical touch preserves the viewing angle');assert.equal(selections.length,0,'scrolling cannot accidentally activate equipment');
    pointer('pointerdown',400,300);pointer('pointermove',460,301);pointer('pointerup',460,301);fixture.tick();assert.ok(fixture.renderer.camera.getWorldDirection(new THREE.Vector3()).distanceTo(initialDirection)>.1,'horizontal touch still looks around the room');
    const rotated=fixture.renderer.camera.position.clone();assert.equal(fixture.wheel(300).defaultPrevented,false);assert.equal(fixture.frames.size,0);vectorNear(fixture.renderer.camera.position,rotated,'page wheel does not change camera distance');
  }finally{fixture.close();}
});

test('FPS is measured from active frames and restarts after pause, hidden, offscreen or context loss',async()=>{
  const fixture=await runtimeFixture();
  const metric=()=>fixture.api.getMetrics();
  const freshEpoch=time=>{fixture.tick(time);assert.equal(metric().fps,0,'first resumed frame has no fabricated rate');fixture.advance(41);assert.equal(metric().fps,60,'only active frame intervals contribute to FPS');};
  try{
    assert.equal(metric().fps,0,'no rate is claimed before measurement');freshEpoch(100000);
    fixture.api.setPaused(true);assert.equal(metric().paused,true);assert.equal(metric().fps,0);assert.equal(fixture.frames.size,0);
    fixture.api.setPaused(false);freshEpoch(1000000);
    fixture.document.hidden=true;fixture.document.dispatchEvent(new Event('visibilitychange'));assert.equal(metric().fps,0);assert.equal(fixture.frames.size,0);
    fixture.document.hidden=false;fixture.document.dispatchEvent(new Event('visibilitychange'));freshEpoch(2000000);
    fixture.observers[0].callback([{isIntersecting:false}]);assert.equal(metric().paused,true);assert.equal(metric().fps,0);
    fixture.observers[0].callback([{isIntersecting:true}]);freshEpoch(3000000);
    const lost=new Event('webglcontextlost',{cancelable:true});fixture.canvas.dispatchEvent(lost);assert.equal(lost.defaultPrevented,true);assert.equal(metric().paused,true);assert.equal(metric().fps,0);
    fixture.api.setPaused(true);fixture.canvas.dispatchEvent(new Event('webglcontextrestored'));assert.equal(metric().paused,true);assert.equal(fixture.frames.size,0,'context restoration keeps the manual pause');
    fixture.api.setPaused(false);freshEpoch(4000000);
  }finally{fixture.close();}
});

test('nine physical workstations route operations, preserve specimens and retain legacy station navigation',async()=>{
  const selections=[],fixture=await runtimeFixture({reducedMotion:true,onSelect:value=>selections.push(value)});
  const ids=['projects','supplies','design','workshop','assembly','energy','market','assets','atlas'];
  try{
    fixture.tick();const roots=[];fixture.renderer.scene.traverse(object=>{if(object.userData.operation)roots.push(object);});
    assert.deepEqual(roots.map(root=>root.userData.operation).sort(),[...ids].sort(),'each operation has its own actual scene object');
    assert.ok(fixture.renderer.scene.background.getHSL({}).l>.8,'paper laboratory has a bright cream background');
    assert.equal(fixture.api.setSpecimen('glycine'),true);
    for(const id of ids){assert.equal(fixture.api.setOperation(id),true);fixture.tick();assert.equal(fixture.api.getMetrics().operation,id);assert.equal(fixture.api.getMetrics().specimen,'glycine','camera focus does not substitute the selected specimen');}
    assert.equal(fixture.api.setOperation('__proto__'),false);assert.equal(fixture.api.setOperation('unknown'),false);
    fixture.api.setOperation('assembly');fixture.tick();
    for(const type of ['pointerdown','pointerup']){const event=new Event(type);Object.assign(event,{button:0,pointerId:1,clientX:400,clientY:300});fixture.canvas.dispatchEvent(event);}
    assert.equal(selections.length,1,'real raycast hit dispatches one operation');assert.deepEqual(selections[0],{station:'synthesis',id:'glycine',operation:'assembly'});
    assert.equal(fixture.api.setStation('microscope'),true);fixture.tick();assert.equal(fixture.api.getMetrics().station,'microscope');assert.equal(fixture.api.getMetrics().operation,'design');
  }finally{fixture.close();}
});

test('actual raycasts reach the reagent bench through reactor glass, including scrolled narrow canvases',async()=>{
  for(const rect of [{width:1366,height:600},{width:490,height:390,left:21,top:-127}]){
    const selections=[],fixture=await runtimeFixture({...rect,reducedMotion:true,onSelect:value=>selections.push(value)});
    try{
      fixture.api.setOperation('assembly');fixture.tick();
      for(const point of [[-6.36,1.6,-3.9],[-4.42,2.1,-3.45]]){clickWorldPoint(fixture,point);assert.equal(selections.at(-1)?.operation,'supplies','transparent reactor must not steal a visible reagent-bottle click, including its empty glass portion');}
      clickWorldPoint(fixture,[0,2.65,0]);assert.equal(selections.at(-1)?.operation,'assembly','empty glass chamber still provides its own assembly selection');
    }finally{fixture.close();}
  }
});

test('narrow canvases can inspect every workstation and projected hotspots use canvas CSS coordinates',async()=>{
  const anchors={assembly:[0,2.65,0],design:[-5.9,2.2,0],workshop:[-5.1,1.9,4.5],energy:[6,2.6,-3],atlas:[5.8,2.5,.5],supplies:[-5.3,2,-3.5],projects:[-9.1,2,2.7],market:[9,2,4.4],assets:[9.7,2,-1.2]};
  for(const width of [320,490,800]){
    const height=width===800?600:844,selections=[],fixture=await runtimeFixture({width,height,left:23,top:-90,reducedMotion:true,onSelect:value=>selections.push(value)});
    try{
      fixture.tick();assert.equal(fixture.api.getMetrics().navigationMode,'walk');near(fixture.renderer.camera.position.y,2.55,'human eye height');
      for(const id of Object.keys(anchors)){fixture.api.setOperation(id);fixture.tick();const hotspots=fixture.api.getHotspots(),hotspot=hotspots.find(h=>h.operation===id);assert.equal(hotspots.length,9);assert.equal(hotspot.visible,true,`${id} can be inspected at ${width}px`);near(hotspot.x,width/2,'canvas-local horizontal coordinate');near(hotspot.y,height/2,'canvas-local vertical coordinate');for(const item of hotspots)assert.ok(Number.isFinite(item.x)&&Number.isFinite(item.y));}
      for(const id of ['market','assets']){fixture.api.setOperation(id);fixture.tick();clickWorldPoint(fixture,anchors[id]);assert.equal(selections.at(-1)?.operation,id,'outer workstations are actually selectable');}
      fixture.api.resetView();fixture.tick();assert.equal(fixture.api.getMetrics().navigationMode,'walk');near(fixture.renderer.camera.fov,65,'walk uses an eye-level lens rather than distant model zoom');
    }finally{fixture.close();}
  }
});

test('setWork displays each manufactured scope as itself and clears ownership context for atlas specimens',async()=>{
  const fixture=await runtimeFixture({reducedMotion:true});
  try{
    for(let primitive=1;primitive<=4;primitive++){
      const work={scope:'COMPONENT',primitive,profile:primitive===4?4:0,id:`part-${primitive}`};assert.equal(fixture.api.setWork(work),true);fixture.tick();const metric=fixture.api.getMetrics();assert.equal(metric.specimen,'component');assert.equal(metric.workScope,'COMPONENT');assert.equal(metric.workId,work.id);
      const component=[];fixture.renderer.scene.traverse(object=>{if(object.userData.kind==='component')component.push(object);});assert.equal(component.length,1);assert.equal(component[0].userData.primitive,primitive);
    }
    assert.equal(fixture.api.setWork({scope:'CELL',target:4,id:'cell-4'}),true);fixture.tick();assert.equal(fixture.api.getMetrics().specimen,'cell');
    for(let target=16;target<=21;target++){assert.equal(fixture.api.setWork({scope:'ORGAN',target,id:`organ-${target}`}),true);fixture.tick();assert.equal(fixture.api.getMetrics().specimen,'organ');assert.equal(fixture.api.getMetrics().workScope,'ORGAN');}
    assert.equal(fixture.api.setWork({scope:'BIO',target:22,id:'organism-22'}),true);fixture.tick();assert.equal(fixture.api.getMetrics().specimen,'organism');
    for(const work of [null,{scope:'CELL',target:22},{scope:'ORGAN',target:4},{scope:'BIO',target:18},{scope:'COMPONENT',primitive:4,profile:0},{scope:'UNKNOWN'}])assert.equal(fixture.api.setWork(work),false);
    assert.equal(fixture.api.getMetrics().workId,'organism-22','invalid scopes do not replace the inspected work');
    fixture.api.setSpecimen('heart');fixture.tick();assert.equal(fixture.api.getMetrics().specimen,'heart');assert.equal(fixture.api.getMetrics().workScope,null);assert.equal(fixture.api.getMetrics().workId,null);
  }finally{fixture.close();}
});

test('setWork renders the hydrated actual graph, exposes its source and replaces old geometry on a real variant',async()=>{
  const fixture=await runtimeFixture({reducedMotion:true}),first=constructionDescriptor();
  const active=()=>{let found;fixture.renderer.scene.traverse(object=>{if(object.userData.profile==='BIO-LINE-GEOMETRY1')found=object;});return found;};
  try{
    assert.equal(fixture.api.setWork(first),true);fixture.tick();const previous=active(),positions=linePositions(previous);assert.equal(previous.userData.source,'construction');assert.equal(previous.userData.unitCount,82);assert.equal(fixture.api.getMetrics().specimenKey,first.id);assert.equal(fixture.api.getMetrics().structureKey,first.appearance.structureKey);
    const resourcesBefore=resources(previous),released=new Map();for(const item of resourcesBefore.geometry){released.set(item,0);item.addEventListener('dispose',()=>released.set(item,released.get(item)+1));}
    const graph=createPublishedC310Graph();graph.cells.find(cell=>cell.role===4).v=900000;const variant=constructionDescriptor({graph,id:'cd'.repeat(32)});assert.equal(fixture.api.setWork(variant),true);fixture.tick();assert.notDeepEqual(linePositions(active()),positions);assert.equal(fixture.api.getMetrics().morphologySource,'construction');for(const count of released.values())assert.equal(count,1,'replaced construction geometries are released once');
    assert.equal(fixture.api.setWork({scope:'BIO',target:22,id:'ef'.repeat(32)}),true);fixture.tick();assert.equal(active().userData.source,'reference','missing provenance is visibly a reference rather than an invented owned genotype');assert.equal(fixture.api.getMetrics().specimenKey,null);
    fixture.api.setStation('atlas');fixture.api.setSpecimen('cell');fixture.tick();assert.equal(fixture.api.getMetrics().morphologySource,null,'anatomical cell remains an independent atlas study');
  }finally{fixture.close();}
});

test('first-person walking keeps eye height, respects apparatus boundaries and never turns wheel into diorama zoom',async()=>{
  const fixture=await runtimeFixture({reducedMotion:true});
  const key=(type,value)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{key:value});fixture.document.dispatchEvent(event);return event;};
  try{
    fixture.tick();assert.equal(fixture.api.getMetrics().navigationMode,'walk');const first=fixture.api.getMetrics().position;
    assert.equal(first.y,2.55);assert.equal(fixture.wheel(500).defaultPrevented,false);assert.equal(fixture.frames.size,0);
    assert.equal(key('keydown','w').defaultPrevented,true);fixture.advance(35);key('keyup','w');assert.ok(fixture.api.getMetrics().position.z<first.z-1,'held W physically advances into the room');
    key('keydown','ArrowUp');fixture.advance(240);key('keyup','ArrowUp');const nearReactor=fixture.api.getMetrics().position;assert.ok(Math.hypot(nearReactor.x,nearReactor.z)>=2.75,'walk cannot pass into the central reactor');assert.equal(nearReactor.y,2.55);
    fixture.api.resetView();fixture.tick();for(let i=0;i<40;i++)fixture.api.move('right',.45);fixture.tick();assert.ok(fixture.api.getMetrics().position.x<=10.7,'walk remains within the room boundary');assert.equal(fixture.api.getMetrics().position.y,2.55);
    assert.equal(fixture.api.move('forward',Infinity),false);assert.equal(fixture.api.move('unknown'),false);fixture.api.setNavigationMode('inspect');assert.equal(fixture.api.move('forward'),false);assert.equal(key('keydown','w').defaultPrevented,false,'inspection does not consume movement keys');
  }finally{fixture.close();}
});

test('walk keyboard respects focus, input, dialogs and inert content, and removes its listeners',async()=>{
  const options={reducedMotion:true},fixture=await runtimeFixture(options);
  const press=()=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'w'});fixture.document.dispatchEvent(event);return event;};
  try{
    fixture.tick();const initial={...fixture.api.getMetrics().position};
    fixture.document.activeElement={tagName:'INPUT'};assert.equal(press().defaultPrevented,false);fixture.tick();assert.deepEqual(fixture.api.getMetrics().position,initial);
    fixture.document.activeElement=fixture.canvas;options.dialogOpen=true;assert.equal(press().defaultPrevented,false);fixture.tick();assert.deepEqual(fixture.api.getMetrics().position,initial);
    options.dialogOpen=false;fixture.canvas.inert=true;assert.equal(press().defaultPrevented,false);fixture.canvas.inert=false;
    assert.equal(press().defaultPrevented,true);fixture.advance(8);options.dialogOpen=true;fixture.tick();const stopped={...fixture.api.getMetrics().position};fixture.advance(10);assert.deepEqual(fixture.api.getMetrics().position,stopped,'opening a dialog clears an already-held movement key');
    options.dialogOpen=false;fixture.api.dispose();assert.equal(fixture.document.listenerCount(),0);assert.equal(fixture.window.listenerCount(),0);assert.equal(press().defaultPrevented,false);
  }finally{fixture.close();}
});

test('paper room keeps construction contours separate from atlas anatomy and releases shared resources once',async()=>{
  const fixture=await runtimeFixture({reducedMotion:true});
  try{
    fixture.tick();const scene=fixture.renderer.scene,lines=[];scene.traverse(object=>{if(object.isLineSegments)lines.push(object);});assert.ok(lines.length>=10&&lines.length<60,'real ink contours are batched by apparatus and construction layer');
    let organism,heart;scene.traverse(object=>{if(object.userData.kind==='organism')organism=object;if(object.userData.kind==='heart')heart=object;});assert.equal(organism.userData.profile,'BIO-LINE-GEOMETRY1');assert.equal(organism.userData.source,'reference','unowned default is an explicit reference construction');
    const hulls=[];heart.traverse(object=>{if(object.isMesh&&object.material.side===THREE.BackSide)hulls.push(object);});assert.ok(hulls.length>=3,'anatomical heart retains its independent shape study');
    for(const hull of hulls)assert.ok(heart.children.some(object=>object!==hull&&object.isMesh&&object.geometry===hull.geometry),'anatomy outline and surface share merged geometry');
    const {geometry,material}=resources(scene),counts=new Map();for(const item of [...geometry,...material]){counts.set(item,0);item.addEventListener('dispose',()=>counts.set(item,counts.get(item)+1));}fixture.api.dispose();for(const count of counts.values())assert.equal(count,1,'every visible shared outline/surface resource is released exactly once');
  }finally{fixture.close();}
});
