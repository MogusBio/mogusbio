import * as THREE from '/lab-assets/three.module.js';
import {createHeart,createBrain,createCell,createLineSpecimen,createMolecule,disposeSpecimen} from './lab-scene-geometries.js';
import {buildLineSpecimen} from './lab-morphology.js';

const STATIONS=new Set(['synthesis','microscope','incubator','atlas']);
const SPECIMENS=new Set(['glycine','atp','dopc','glucose','component','cell','organ','heart','brain','organism']);
const OPERATION_POSES={assembly:{station:'synthesis',target:[0,2.65,0],offset:[7.4,4.1,10.5]},design:{station:'microscope',target:[-5.9,2.2,0],offset:[6,3.4,7.8]},workshop:{station:'synthesis',target:[-5.1,1.9,4.5],offset:[5,3.2,7.3]},energy:{station:'incubator',target:[6,2.6,-3],offset:[5,3.4,8]},atlas:{station:'atlas',target:[5.8,2.5,.5],offset:[4.5,2.8,6.9]},supplies:{station:'microscope',target:[-5.3,2,-3.5],offset:[5,3.4,7.5]},projects:{station:'synthesis',target:[-9.1,2,2.7],offset:[5,3.4,7]},market:{station:'atlas',target:[9,2,4.4],offset:[4,3.5,6]},assets:{station:'incubator',target:[9.7,2,-1.2],offset:[4.5,3.5,7]}};
const DEFAULT_OPERATION={synthesis:'assembly',microscope:'design',incubator:'energy',atlas:'atlas'};
const WALK_BLOCKS=[[-8.2,-3.6,-1.3,1.3],[-7.5,-2.7,3.3,5.7],[-7.3,-3.3,-4.6,-2.4],[3.4,7.8,-1,2],[3.5,8.5,-5.2,-2.2],[-10.5,-7.7,1.6,3.8],[7.6,10.4,3.4,5.4],[8.3,11,-2.3,-.1]];
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));

function mergeGeometries(geometries){
  const positions=[],normals=[];
  for(const geometry of geometries){const source=geometry.index?geometry.toNonIndexed():geometry,p=source.attributes.position,n=source.attributes.normal;for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n.getX(i),n.getY(i),n.getZ(i));}if(source!==geometry)source.dispose();}
  const output=new THREE.BufferGeometry();output.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));output.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));output.computeBoundingSphere();return output;
}

/** Original, self-contained procedural room. No game code/assets are copied. */
export async function createLabScene({canvas,onSelect=()=>{},quality='auto',reducedMotion=false,moleculeData=null}={}){
  if(!canvas?.getContext)throw Error('LAB_CANVAS_REQUIRED');
  let renderer;try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});}catch{throw Error('WEBGL_UNAVAILABLE');}
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;renderer.setClearColor(0xf3f0e3,1);renderer.shadowMap.enabled=false;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xf3f0e3);scene.fog=new THREE.Fog(0xf3f0e3,24,53);
  const camera=new THREE.PerspectiveCamera(40,1,.1,90);camera.position.set(0,2.55,9.5);camera.lookAt(0,2.55,-1);
  const target=V(0,2.55,-1),targetGoal=target.clone(),cameraGoal=camera.position.clone();
  const room=new THREE.Group(),central=new THREE.Group(),staticGeo=new Set(),staticMats=new Set(),clickables=[],beacons=new Map();scene.add(room,central);
  let disposed=false,station='synthesis',operation='assembly',navigationMode='walk',overview=false,specimenId='organism',specimen=null,activeWork=null,stage='assembly',manualPaused=false,visible=!document.hidden,intersecting=true,frameId=0,lastTime=0,elapsed=0,lastMetricTime=null,frameCount=0,lastDrawTime=0,fps=0,averageFrame=16.7,qualityMode=['auto','low','high'].includes(quality)?quality:'auto',adaptiveLow=false,contextLost=false;
  const geo={box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,24),smallCylinder:new THREE.CylinderGeometry(1,1,1,12),sphere:new THREE.SphereGeometry(1,18,12),torus:new THREE.TorusGeometry(1,.045,6,48)};Object.values(geo).forEach(g=>staticGeo.add(g));
  const material=(color,options={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.02,...options});staticMats.add(m);return m;};
  const M={bone:material(0xeeeedd),porcelain:material(0xfaf8eb,{roughness:.9}),steel:material(0xb5c5b3,{metalness:.08,roughness:.85}),dark:material(0x697c65),graphite:material(0xb8cbb2),teal:material(0xb7d6bc),sage:material(0xc2d5ab),lime:material(0xd4ed85),ochre:material(0xd8c295),coral:material(0xe0aa91),water:material(0xa1d4bb,{transparent:true,opacity:.28,depthWrite:false,roughness:.8}),glass:material(0xb6d8c7,{transparent:true,opacity:.07,depthWrite:false,roughness:.9,side:THREE.DoubleSide}),light:material(0xe7f3be,{emissive:0xb2cc6a,emissiveIntensity:.08,roughness:.9}),amber:material(0xe7d99c,{emissive:0xc3bd75,emissiveIntensity:.06}),black:material(0x596950,{roughness:.9}),screen:material(0xdeebc5,{emissive:0xa3b98c,emissiveIntensity:.04})};
  const edgeCache=new Map(),ink=new THREE.LineBasicMaterial({color:0x38523e,transparent:true,opacity:.73});staticMats.add(ink);
  function cachedEdges(geometry){if(!edgeCache.has(geometry)){const edges=new THREE.EdgesGeometry(geometry,22);edgeCache.set(geometry,edges);staticGeo.add(edges);}return edgeCache.get(geometry);}
  function sketchSpecimen(group){
    if(group.userData.kind==='molecule'||group.userData.profile==='BIO-LINE-GEOMETRY1')return group;group.updateMatrixWorld(true);const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert(),buckets=new Map(),originals=new Set(),remove=[];
    group.traverse(object=>{if(!object.isMesh||object.isInstancedMesh||object.material.transparent)return;const geometry=object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld));if(!buckets.has(object.material))buckets.set(object.material,[]);buckets.get(object.material).push(geometry);originals.add(object.geometry);remove.push(object);});
    for(const object of remove)object.removeFromParent();const outlineMaterial=new THREE.MeshBasicMaterial({color:0x344b39,side:THREE.BackSide});
    for(const [surface,geometries]of buckets){const geometry=mergeGeometries(geometries),body=new THREE.Mesh(geometry,surface),outline=new THREE.Mesh(geometry,outlineMaterial);outline.scale.setScalar(1.016);outline.userData.pickThrough=true;group.add(outline,body);for(const item of geometries)item.dispose();}
    const retained=new Set();group.traverse(object=>{if(object.geometry)retained.add(object.geometry);});for(const geometry of originals)if(!retained.has(geometry))geometry.dispose();return group;
  }
  function mesh(parent,geometry,mat,position=[0,0,0],scale=[1,1,1],rotation){const m=new THREE.Mesh(geometry,mat);m.position.set(...position);m.scale.set(...scale);if(rotation)m.rotation.set(...rotation);parent.add(m);return m;}
  const box=(g,m,p,s,r)=>mesh(g,geo.box,m,p,s,r);
  const cyl=(g,m,p,s,r)=>mesh(g,geo.cylinder,m,p,s,r);
  const ball=(g,m,p,s)=>mesh(g,geo.sphere,m,p,s);
  function ring(g,m,p,radius,tube=.04,rotate=[Math.PI/2,0,0]){const geometry=new THREE.TorusGeometry(radius,tube,8,64);staticGeo.add(geometry);return mesh(g,geometry,m,p,[1,1,1],rotate);}
  function pipe(g,points,radius,mat){const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>V(...p))),Math.max(8,points.length*5),radius,6,false);staticGeo.add(geometry);return mesh(g,geometry,mat);}
  function selectable(group,id,defaultId,operation=DEFAULT_OPERATION[id]){group.userData.station=id;group.userData.specimen=defaultId;group.userData.operation=operation;clickables.push(group);return group;}
  function beacon(g,id,p){const b=ring(g,M.light,p,.3,.025);b.userData.noBatch=true;beacons.set(id,b);return b;}
  function contact(g,x,z,sx,sz,opacity=.07){const m=new THREE.MeshBasicMaterial({color:0x233a2c,transparent:true,opacity,depthWrite:false});staticMats.add(m);const geometry=new THREE.CircleGeometry(1,48);staticGeo.add(geometry);const shadow=mesh(g,geometry,m,[x,.026,z],[sx,sz,1],[-Math.PI/2,0,0]);shadow.userData.pickThrough=true;return shadow;}
  function outlinedBox(g,mat,p,s){const m=box(g,mat,p,s),edgeMaterial=new THREE.LineBasicMaterial({color:0x385047,transparent:true,opacity:.65}),edgeGeo=new THREE.EdgesGeometry(geo.box);staticMats.add(edgeMaterial);staticGeo.add(edgeGeo);const lines=new THREE.LineSegments(edgeGeo,edgeMaterial);lines.userData.pickThrough=true;lines.position.copy(m.position);lines.scale.copy(m.scale);g.add(lines);return m;}
  function bench(g,x,z,width=3.4,depth=1.65){contact(g,x,z,width*.62,depth*.85);outlinedBox(g,M.bone,[x,.63,z],[width,1.17,depth]);box(g,M.porcelain,[x,1.26,z],[width+.16,.16,depth+.14]);box(g,M.graphite,[x,.12,z],[width-.12,.18,depth-.08]);for(let i=0;i<3;i++){box(g,M.steel,[x-width*.28+i*width*.28,.78,z+depth*.507],[width*.2,.025,.04]);box(g,M.teal,[x-width*.3+i*width*.3,.48,z+depth*.509],[.012,.65,.015]);}}
  function vials(g,x,y,z,amount=8){for(let i=0;i<amount;i++){const p=x+(i%4)*.24,q=z+Math.floor(i/4)*.3; cyl(g,M.glass,[p,y+.23,q],[.065,.43,.065]);cyl(g,[M.water,M.coral,M.amber,M.lime][i%4],[p,y+.15,q],[.052,.27,.052]);cyl(g,M.dark,[p,y+.47,q],[.074,.065,.074]);}box(g,M.steel,[x+.36,y-.01,z+.15],[1.1,.09,.7]);}

  scene.add(new THREE.HemisphereLight(0xfffdf1,0xd8ddcb,2.6));
  const keyLight=new THREE.DirectionalLight(0xfffae6,2.4);keyLight.position.set(5,12,8);scene.add(keyLight);
  const fill=new THREE.DirectionalLight(0xdbead9,.9);fill.position.set(-8,6,-5);scene.add(fill);
  const reactorLight=new THREE.PointLight(0xe3f0b9,3,12,2);reactorLight.position.set(0,4,.4);scene.add(reactorLight);

  // Open architectural shell, daylight windows and a botanical service wall.
  box(room,M.bone,[0,-.13,0],[26,.25,22]);
  const grid=new THREE.GridHelper(26,26,0x68844b,0x304a32);grid.position.y=.012;grid.material.transparent=true;grid.material.opacity=.22;room.add(grid);staticMats.add(grid.material);staticGeo.add(grid.geometry);
  const hatch=[];for(let i=0;i<78;i++){const x=-10.5+(i%13)*1.7,z=-5+Math.floor(i/13)*2.2;hatch.push(x,.018,z,x+.24,.018,z+.16,x+.08,.018,z-.02,x+.3,.018,z+.13);}const paperGeometry=new THREE.BufferGeometry();paperGeometry.setAttribute('position',new THREE.Float32BufferAttribute(hatch,3));const paperInk=new THREE.LineBasicMaterial({color:0x71836b,transparent:true,opacity:.12});staticGeo.add(paperGeometry);staticMats.add(paperInk);room.add(new THREE.LineSegments(paperGeometry,paperInk));
  box(room,M.porcelain,[0,4.3,-6.4],[24,8.6,.35]);box(room,M.bone,[-11.6,3.1,.2],[.35,6.2,13.2]);
  box(room,M.graphite,[0,3.9,-6.18],[16.8,4.2,.13]);
  for(let i=0;i<5;i++){box(room,M.teal,[-6.6+i*3.3,3.94,-6.07],[3.08,3.96,.06]);box(room,M.steel,[-8.23+i*3.3,3.93,-5.99],[.045,4.12,.1]);}
  box(room,M.bone,[0,1.7,-6.02],[17.2,.2,.26]);box(room,M.bone,[0,6.02,-6.02],[17.2,.18,.28]);
  const plantMat=material(0x8fa78a,{roughness:.86}),leafMat=material(0xb4c795,{roughness:.83});
  for(let i=0;i<17;i++){
    const x=-8.1+i*.99,z=-5.87,y=2.16+(i%4)*.32;pipe(room,[[x,1.9,z],[x+.12,y+.8,z-.1],[x-.09,y+1.6,z]],.018,plantMat);
    for(let n=0;n<4;n++){const side=n%2?1:-1,l=ball(room,n%3?leafMat:plantMat,[x+side*.2,y+n*.29,z+.03],[.36,.115,.095]);l.rotation.z=side*.55;}
  }
  for(let x=-9;x<=9;x+=3){box(room,M.steel,[x,7.1,-1.4],[.07,.08,9.5]);box(room,M.light,[x+.5,7.03,-1.4],[1.7,.04,3.6]);}
  box(room,M.graphite,[-10.96,2.7,-2.1],[.1,2,2.3]);box(room,M.screen,[-10.87,2.76,-2.1],[.03,1.38,1.86]);
  for(let i=0;i<5;i++)box(room,M.light,[-10.81,2.25+i*.22,-2.1],[.025,.025,1.2-(i%3)*.21]);
  pipe(room,[[-11,6.5,-5.8],[-6,6.5,-5.8],[-5,5.8,-5.8],[-5,2,-5.8]],.07,M.steel);
  pipe(room,[[10,0,-5.8],[10,6.7,-5.8],[8,6.7,-5.8]],.09,M.ochre);

  // The large central reactor is the scene's silhouette and primary workspace.
  const reactor=selectable(new THREE.Group(),'synthesis','organism');central.add(reactor);
  contact(reactor,0,0,3.2,2.7,.12);
  cyl(reactor,M.graphite,[0,.28,0],[2.46,.5,2.46]);cyl(reactor,M.bone,[0,.64,0],[2.35,.28,2.35]);cyl(reactor,M.steel,[0,.83,0],[2.22,.12,2.22]);
  ring(reactor,M.light,[0,.93,0],2.12,.04);ring(reactor,M.steel,[0,5.2,0],2.13,.11);ring(reactor,M.bone,[0,5.35,0],2.2,.13);ring(reactor,M.light,[0,5.15,0],2.05,.026);
  const glassGeo=new THREE.CylinderGeometry(2.12,2.12,4.14,64,1,true);staticGeo.add(glassGeo);const enclosure=mesh(reactor,glassGeo,M.glass,[0,3.04,0]);enclosure.userData.pickThrough=true;
  for(const side of [-1,1]){cyl(reactor,M.steel,[side*2.07,3.05,-.22],[.055,4.22,.055]);box(reactor,M.light,[side*2.03,3.05,-.17],[.026,3.63,.026]);}
  cyl(reactor,M.glass,[0,1.02,0],[2.06,.025,2.06]);
  const baseControls=box(reactor,M.dark,[0,.77,2.1],[1.2,.24,.24],[-.18,0,0]);
  for(let i=0;i<5;i++)ball(reactor,i===0?M.amber:M.light,[-.4+i*.2,.84,2.24],[.025,.025,.018]);
  pipe(reactor,[[-2.2,.6,-.8],[-2.8,.6,-.8],[-3.2,1.1,-1.7],[-3.2,1.1,-4.5]],.09,M.steel);
  pipe(reactor,[[2.16,4.8,-.5],[2.8,4.8,-1.1],[3.3,3.7,-2.6],[4.4,3.7,-3.5]],.065,M.ochre);
  beacon(reactor,'assembly',[0,1.02,2.15]);

  // A real, recognisable microscope and wet-chemistry bench.
  const microscopy=selectable(new THREE.Group(),'microscope','glycine','design');room.add(microscopy);bench(microscopy,-5.9,.0,4.1,2.1);
  box(microscopy,M.graphite,[-5.8,1.4,.2],[1.22,.16,1.08]);box(microscopy,M.porcelain,[-5.9,1.94,-.17],[.29,1.05,.36],[0,0,-.22]);
  box(microscopy,M.graphite,[-5.55,2.32,.05],[1,.14,.7]);cyl(microscopy,M.steel,[-5.57,2.56,.19],[.11,.35,.11]);
  cyl(microscopy,M.bone,[-5.56,3.01,-.02],[.25,.59,.25],[.38,0,0]);cyl(microscopy,M.black,[-5.56,3.37,-.16],[.14,.19,.14],[.38,0,0]);
  box(microscopy,M.glass,[-5.54,2.42,.2],[.51,.025,.26]);cyl(microscopy,M.light,[-5.54,1.78,.2],[.15,.045,.15]);
  for(const side of [-1,1])cyl(microscopy,M.black,[-5.9+side*.25,2.03,-.04],[.12,.15,.12],[0,0,Math.PI/2]);
  vials(microscopy,-7.65,1.37,-.48,8);
  const beaker=cyl(microscopy,M.glass,[-4.42,1.66,.24],[.27,.64,.27]);cyl(microscopy,M.water,[-4.42,1.52,.24],[.24,.34,.24]);ring(microscopy,M.steel,[-4.42,2,.24],.27,.018);
  beacon(microscopy,'design',[-5.9,1.4,1.01]);

  // Atlas display: a small heart under a bell jar, clearly an anatomical study.
  const atlas=selectable(new THREE.Group(),'atlas','heart');room.add(atlas);bench(atlas,5.6,.5,3.65,2.25);
  cyl(atlas,M.dark,[5.85,1.47,.5],[.91,.15,.91]);const atlasHeart=sketchSpecimen(createHeart());atlasHeart.scale.setScalar(.62);atlasHeart.position.set(5.85,2.35,.48);atlas.add(atlasHeart);
  const domeGeo=new THREE.SphereGeometry(1,32,20,0,Math.PI*2,0,Math.PI/2);staticGeo.add(domeGeo);mesh(atlas,domeGeo,M.glass,[5.85,2.5,.5],[1.04,1.2,1.04]);cyl(atlas,M.glass,[5.85,1.97,.5],[1.04,1.06,1.04]);ring(atlas,M.steel,[5.85,1.48,.5],1.04,.035);
  const tray=box(atlas,M.steel,[4.28,1.4,.4],[.5,.055,1.4]);vials(atlas,4.17,1.48,-.06,4);beacon(atlas,'atlas',[5.5,1.41,1.62]);

  // An incubator cabinet and fluid culture cylinders in the back of the room.
  const incubator=selectable(new THREE.Group(),'incubator','organism','energy');room.add(incubator);
  outlinedBox(incubator,M.bone,[6,2.22,-3.9],[4.2,4.35,1.65]);box(incubator,M.graphite,[6,2.51,-2.99],[3.8,3.45,.14]);
  for(let i=0;i<3;i++){
    const x=4.9+i*1.13;cyl(incubator,M.steel,[x,1.1,-2.82],[.41,.16,.41]);cyl(incubator,M.glass,[x,2.36,-2.82],[.37,2.4,.37]);cyl(incubator,i===1?M.amber:M.water,[x,2.15,-2.82],[.32,1.97,.32]);cyl(incubator,M.steel,[x,3.61,-2.82],[.41,.2,.41]);
    for(let k=0;k<3;k++)ball(incubator,i===1?M.coral:M.lime,[x+Math.sin(k*2)*.1,1.5+k*.52,-2.78],[.16,.22,.16]);
  }
  box(incubator,M.screen,[6,4.01,-2.99],[2.8,.34,.03]);for(let i=0;i<6;i++)box(incubator,M.light,[4.93+i*.4,4.02,-2.96],[.2,.026,.02]);beacon(incubator,'energy',[7.72,1.45,-2.98]);

  // Left-hand synthesis instrument, robotic arm, petri dishes and molecular rack.
  const instrument=selectable(new THREE.Group(),'synthesis','cell','workshop');room.add(instrument);bench(instrument,-5.1,4.5,4.35,1.75);
  cyl(instrument,M.dark,[-5.25,1.42,4.4],[.57,.17,.57]);cyl(instrument,M.steel,[-5.25,1.93,4.4],[.13,.98,.13]);
  pipe(instrument,[[-5.25,2.3,4.4],[-4.8,2.7,4.4],[-3.9,2.7,4.4],[-3.73,2.12,4.4]],.105,M.porcelain);ball(instrument,M.dark,[-4.8,2.7,4.4],[.19,.19,.19]);cyl(instrument,M.dark,[-3.73,2.02,4.4],[.07,.28,.07]);
  for(let i=0;i<4;i++){cyl(instrument,M.glass,[-6.69+i*.57,1.43,4.8],[.21,.12,.21]);cyl(instrument,i%2?M.water:M.coral,[-6.69+i*.57,1.46,4.8],[.17,.025,.17]);}
  box(instrument,M.screen,[-5.43,1.77,3.83],[1.14,.7,.09],[-.1,0,0]);for(let i=0;i<4;i++)box(instrument,M.light,[-5.43,1.56+i*.12,3.89],[.76-(i%2)*.2,.02,.01]);
  beacon(instrument,'workshop',[-5.1,1.42,5.36]);

  // Distinct apparatus are real operational anchors, rather than decorative
  // objects sending every click back to the same four specimen tabs.
  const reagents=selectable(new THREE.Group(),'microscope','atp','supplies');room.add(reagents);bench(reagents,-5.3,-3.5,3.5,1.65);vials(reagents,-6.6,1.37,-3.9,8);
  for(let i=0;i<4;i++){const x=-4.9+i*.48;cyl(reagents,M.glass,[x,1.82,-3.45],[.14,.85,.14]);cyl(reagents,[M.coral,M.lime,M.amber,M.water][i],[x,1.65,-3.45],[.115,.5,.115]);cyl(reagents,M.steel,[x,2.27,-3.45],[.16,.07,.16]);}beacon(reagents,'supplies',[-5.3,1.41,-2.68]);
  function terminal(parent,x,z){bench(parent,x,z,2.15,1.5);box(parent,M.steel,[x,1.63,z-.12],[.12,.65,.12]);box(parent,M.dark,[x,2.14,z-.22],[1.8,1.15,.13],[-.12,0,0]);box(parent,M.screen,[x,2.14,z-.13],[1.64,.99,.025],[-.12,0,0]);for(let i=0;i<5;i++)box(parent,M.light,[x-.57,2.46-i*.15,z-.06],[1.1-(i%3)*.25,.027,.025]);box(parent,M.steel,[x,1.39,z+.38],[1.34,.04,.42]);}
  const launch=selectable(new THREE.Group(),'synthesis','organism','projects');room.add(launch);terminal(launch,-9.1,2.7);beacon(launch,'projects',[-9.1,1.42,3.45]);
  const exchange=selectable(new THREE.Group(),'atlas','organism','market');room.add(exchange);terminal(exchange,9,4.4);beacon(exchange,'market',[9,1.42,5.14]);
  const storage=selectable(new THREE.Group(),'incubator','cell','assets');room.add(storage);outlinedBox(storage,M.bone,[9.7,1.58,-1.2],[2.15,3.1,1.4]);
  for(let i=0;i<4;i++){box(storage,M.graphite,[9.7,.53+i*.7,-.46],[1.88,.55,.08]);box(storage,M.steel,[9.7,.56+i*.7,-.38],[.55,.035,.05]);box(storage,M.light,[10.4,.55+i*.7,-.37],[.1,.1,.025]);}beacon(storage,'assets',[9.7,.13,-.25]);

  // Static batching reduces dozens of cabinets, leaves and vial parts to a
  // small material count. Station roots retain their clickable ancestry.
  function batch(group,{skipStations=false}={}){group.updateMatrixWorld(true);const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert(),buckets=new Map(),remove=[],lines=[];group.traverse(o=>{if(!o.isMesh||o.userData.noBatch||o.parent===atlasHeart)return;let p=o.parent,insideAnatomy=false;while(p&&p!==group){if(p===atlasHeart)insideAnatomy=true;p=p.parent;}if(insideAnatomy)return;if(skipStations){let ancestor=o.parent,selected=false;while(ancestor&&ancestor!==group){if(ancestor.userData.station)selected=true;ancestor=ancestor.parent;}if(selected)return;}
      const surface=o.material;if(Array.isArray(surface))return;const transform=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld),edges=cachedEdges(o.geometry).clone().applyMatrix4(transform);lines.push(...edges.attributes.position.array);edges.dispose();if(surface.transparent)return;const geometry=o.geometry.clone().applyMatrix4(transform);if(!buckets.has(surface))buckets.set(surface,[]);buckets.get(surface).push(geometry);remove.push(o);
    });for(const mesh of remove)mesh.removeFromParent();for(const [mat,geometries]of buckets){const merged=mergeGeometries(geometries);staticGeo.add(merged);group.add(new THREE.Mesh(merged,mat));for(const g of geometries)g.dispose();}const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));staticGeo.add(lineGeometry);const contours=new THREE.LineSegments(lineGeometry,ink);contours.userData.pickThrough=true;group.add(contours);}
  // Batch architecture separately while retaining descendant station roots.
  for(const g of [microscopy,incubator,instrument,reactor,atlas,reagents,launch,exchange,storage])batch(g);batch(room,{skipStations:true});

  const dustCount=28,dustGeometry=new THREE.BufferGeometry(),dustPositions=new Float32Array(dustCount*3);for(let i=0;i<dustCount;i++){const a=i*2.39996;dustPositions[i*3]=Math.cos(a)*(.6+(i%6)*.23);dustPositions[i*3+1]=1.2+(i%11)*.29;dustPositions[i*3+2]=Math.sin(a)*(.6+(i%6)*.23);}dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));staticGeo.add(dustGeometry);const dustMaterial=new THREE.PointsMaterial({color:0xb0d69d,size:.028,transparent:true,opacity:.65,depthWrite:false});staticMats.add(dustMaterial);const particles=new THREE.Points(dustGeometry,dustMaterial);central.add(particles);
  const scanRing=ring(central,M.light,[0,1.05,0],1.9,.016);scanRing.visible=false;
  const specimenMount=new THREE.Group();specimenMount.position.set(0,2.95,0);central.add(specimenMount);

  let compounds=moleculeData?.compounds??moleculeData??{};
  if(!moleculeData){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch('/lab-assets/molecules.json',{credentials:'omit',cache:'force-cache',signal:controller.signal});if(response.ok){const body=await response.text();if(body.length>350000)throw Error('MOLECULE_DATA_SIZE');const value=JSON.parse(body);compounds=value.compounds??value;}}catch{}finally{clearTimeout(timer);}}

  function mountSpecimen(id,next,work=null){if(specimen){specimenMount.remove(specimen);disposeSpecimen(specimen);}specimen=sketchSpecimen(next);activeWork=work;specimenId=id;reactor.userData.specimen=id;specimenMount.scale.setScalar(1);specimenMount.add(specimen);schedule();return true;}
  function setSpecimen(id){if(disposed||!SPECIMENS.has(id))return false;let next;
    if(['glycine','atp','dopc','glucose'].includes(id)){if(!compounds[id])return false;next=createMolecule(compounds[id]);}
    else if(id==='heart'||id==='brain'||id==='cell'&&station==='atlas')next=({cell:createCell,heart:createHeart,brain:createBrain})[id]();
    else{const descriptor={component:{scope:'COMPONENT',primitive:1,profile:0},cell:{scope:'CELL',target:4},organ:{scope:'ORGAN',target:17},organism:{scope:'BIO',target:22}}[id];try{next=createLineSpecimen(buildLineSpecimen(descriptor));}catch{return false;}}
    return mountSpecimen(id,next);
  }
  function setWork(work){if(disposed||!work||typeof work!=='object')return false;let id,next;const {scope,target,primitive,profile}=work;
    if(scope==='COMPONENT'){if(!Number.isInteger(primitive)||primitive<1||primitive>4||!Number.isInteger(profile)||(primitive===4?profile<1||profile>15:profile!==0))return false;id='component';}
    else if(scope==='CELL'){if(!Number.isInteger(target)||target<1||target>15)return false;id='cell';}
    else if(scope==='ORGAN'){if(!Number.isInteger(target)||target<16||target>21)return false;id='organ';}
    else if(scope==='BIO'){if(target!==undefined&&target!==22)return false;id='organism';}
    else return false;try{next=createLineSpecimen(buildLineSpecimen(work));Object.assign(next.userData,{target,primitive,componentProfile:profile});}catch{return false;}setNavigationMode('inspect');return mountSpecimen(id,next,{scope,target,primitive,profile,id:typeof work.id==='string'?work.id:null});
  }
  const walkPosition=V(0,2.55,9.5),heldKeys=new Set();let walkYaw=0,walkPitch=0;
  function fitProjection(){camera.fov=navigationMode==='walk'?65:THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(40)/2)*Math.max(1,1/camera.aspect)));camera.updateProjectionMatrix();}
  function walkTarget(){return V(-Math.sin(walkYaw)*Math.cos(walkPitch),Math.sin(walkPitch),-Math.cos(walkYaw)*Math.cos(walkPitch)).multiplyScalar(8).add(walkPosition);}
  function canStand(x,z){return x>=-10.7&&x<=10.7&&z>=-5.5&&z<=10.2&&x*x+z*z>=2.75*2.75&&!WALK_BLOCKS.some(([left,right,back,front])=>x>left&&x<right&&z>back&&z<front);}
  function walkStep(strafe,forward){const dx=Math.cos(walkYaw)*strafe-Math.sin(walkYaw)*forward,dz=-Math.sin(walkYaw)*strafe-Math.cos(walkYaw)*forward;if(canStand(walkPosition.x+dx,walkPosition.z))walkPosition.x+=dx;if(canStand(walkPosition.x,walkPosition.z+dz))walkPosition.z+=dz;}
  function movePlayer(direction,amount=.45){if(disposed||navigationMode!=='walk'||!Number.isFinite(amount)||amount<=0||amount>2)return false;const moves={forward:[0,amount],backward:[0,-amount],left:[-amount,0],right:[amount,0]};if(Object.hasOwn(moves,direction))walkStep(...moves[direction]);else if(direction==='up'||direction==='down')walkPitch=clamp(walkPitch+(direction==='up'?1:-1)*amount*.22,-.8,.8);else return false;schedule();return true;}
  function setNavigationMode(mode){if(disposed||!['walk','inspect'].includes(mode))return false;heldKeys.clear();navigationMode=mode;overview=false;if(mode==='walk'){camera.position.copy(walkPosition);target.copy(walkTarget());}else{cameraGoal.set(6.6,4.6,8.3);targetGoal.set(0,2.85,0);camera.position.copy(cameraGoal);target.copy(targetGoal);orbitYaw=0;orbitPitch=0;}camera.lookAt(target);fitProjection();schedule();return true;}
  function resetView(){if(disposed)return false;walkPosition.set(0,2.55,9.5);walkYaw=0;walkPitch=0;return setNavigationMode('walk');}
  function getHotspots(){const rect=canvas.getBoundingClientRect();camera.updateMatrixWorld(true);return Object.entries(OPERATION_POSES).map(([operation,pose])=>{const point=V(...pose.target).project(camera);return{operation,x:(point.x+1)*rect.width/2,y:(1-point.y)*rect.height/2,visible:point.z>=-1&&point.z<=1&&Math.abs(point.x)<=1&&Math.abs(point.y)<=1};});}
  function keyboardAllowed(event){const tag=event?.target?.tagName?.toUpperCase();return document.activeElement===canvas&&!canvas.inert&&!canvas.closest?.('[inert]')&&!['INPUT','TEXTAREA','SELECT'].includes(tag)&&!event?.target?.isContentEditable&&!document.querySelector?.('dialog[open], [role="dialog"]:not([hidden])');}
  const keyDirections={w:'forward',ArrowUp:'forward',s:'backward',ArrowDown:'backward',a:'left',ArrowLeft:'left',d:'right',ArrowRight:'right'};
  function keyDown(event){const direction=keyDirections[event.key?.length===1?event.key.toLowerCase():event.key];if(!direction||navigationMode!=='walk'||!keyboardAllowed(event))return;event.preventDefault();heldKeys.add(direction);schedule();}
  function keyUp(event){const direction=keyDirections[event.key?.length===1?event.key.toLowerCase():event.key];if(direction)heldKeys.delete(direction);}
  function clearKeys(){heldKeys.clear();}
  document.addEventListener('keydown',keyDown);document.addEventListener('keyup',keyUp);window.addEventListener('blur',clearKeys);
  function enterInspection(){navigationMode='inspect';heldKeys.clear();}
  function setStation(id){if(disposed||!STATIONS.has(id))return false;enterInspection();station=id;operation=DEFAULT_OPERATION[id];overview=true;fitProjection();const poses={synthesis:[6.6,4.6,8.3],microscope:[6.4,4.5,8.8],incubator:[8.8,6.3,12.1],atlas:[7.2,4.9,9.6]};cameraGoal.set(...poses[id]);targetGoal.set(0,id==='microscope'?2.95:2.75,0);orbitYaw=0;orbitPitch=0;for(const [key,b]of beacons)b.visible=key===operation;if(reducedMotion){camera.position.copy(cameraGoal);target.copy(targetGoal);}schedule();return true;}
  function setOperation(id){if(disposed||!Object.hasOwn(OPERATION_POSES,id))return false;enterInspection();const pose=OPERATION_POSES[id];operation=id;station=pose.station;overview=false;fitProjection();targetGoal.set(...pose.target);cameraGoal.copy(targetGoal).add(V(...pose.offset));orbitYaw=0;orbitPitch=0;for(const [key,b]of beacons)b.visible=key===id;if(reducedMotion){camera.position.copy(cameraGoal);target.copy(targetGoal);}schedule();return true;}
  function setStage(id){stage=String(id);scanRing.visible=['experiment','validation','synthesis','running'].includes(stage);reactorLight.intensity=scanRing.visible?4:3;schedule();}
  function pixelRatio(){return qualityMode==='low'||adaptiveLow?1:Math.min(window.devicePixelRatio||1,1.5);}
  function resize(){if(disposed)return;const rect=canvas.getBoundingClientRect(),width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));renderer.setPixelRatio(pixelRatio());renderer.setSize(width,height,false);camera.aspect=width/height;fitProjection();schedule();}
  function setQuality(value){if(!['auto','low','high'].includes(value)||disposed)return false;qualityMode=value;adaptiveLow=false;resize();return true;}

  let orbitYaw=0,orbitPitch=0,drag=null,travel=0;const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  function pageScrollMode(){const action=window.getComputedStyle?.(canvas)?.touchAction??canvas.style.touchAction;return /(?:^|\s)(?:auto|manipulation|pan-y|pan-up|pan-down)(?:\s|$)/.test(action??'');}
  function point(event){const r=canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
  function down(event){if(event.button!==0||disposed||drag)return;canvas.focus?.({preventScroll:true});drag={...point(event),startX:event.clientX,startY:event.clientY,pointerType:event.pointerType,pointerId:event.pointerId};travel=0;canvas.setPointerCapture?.(event.pointerId);canvas.style.cursor='grabbing';schedule();}
  function move(event){if(!drag||disposed||event.pointerId!==drag.pointerId)return;const scrollTouch=drag.pointerType==='touch'&&pageScrollMode();if(scrollTouch&&Math.abs(event.clientY-drag.startY)>Math.max(6,Math.abs(event.clientX-drag.startX))){cancel();canvas.releasePointerCapture?.(event.pointerId);return;}const p=point(event),dx=p.x-drag.x,dy=p.y-drag.y;if(navigationMode==='walk'){walkYaw-=dx*.0045;if(!scrollTouch)walkPitch=clamp(walkPitch-dy*.0035,-.8,.8);}else{orbitYaw=clamp(orbitYaw-dx*.0035,-.6,.6);if(!scrollTouch)orbitPitch=clamp(orbitPitch+dy*.003,-.2,.24);}travel=Math.max(travel,Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY));drag.x=p.x;drag.y=p.y;schedule();}
  function pick(event){const r=canvas.getBoundingClientRect();if(r.width<=0||r.height<=0)return;pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);
    const hits=raycaster.intersectObjects(clickables,true).filter(hit=>{for(let object=hit.object;object;object=object.parent)if(!object.visible)return false;return true;});
    // The enclosing reactor glass must not steal clicks on equipment visible
    // through it. Small glass vials are real equipment and remain direct hits.
    const hit=hits.find(hit=>!hit.object.userData.pickThrough)??hits.find(hit=>hit.object.material===M.glass);let object=hit?.object;while(object&&!object.userData.station)object=object.parent;
    if(object?.userData.station)onSelect({station:object.userData.station,id:object.userData.specimen??specimenId,operation:object.userData.operation??DEFAULT_OPERATION[object.userData.station]});
  }
  function up(event){if(!drag||event.pointerId!==drag.pointerId)return;drag=null;canvas.style.cursor='grab';canvas.releasePointerCapture?.(event.pointerId);if(travel<7)pick(event);schedule();}
  function cancel(){drag=null;canvas.style.cursor='grab';}
  function wheel(event){if(disposed||navigationMode==='walk'||pageScrollMode()||!Number.isFinite(event.deltaY)||event.deltaY===0)return;event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?Math.max(1,canvas.getBoundingClientRect().height):1,offset=cameraGoal.clone().sub(targetGoal),distance=clamp(offset.length()*Math.exp(clamp(event.deltaY*unit,-600,600)*.0012),6,24);cameraGoal.copy(targetGoal).add(offset.setLength(distance));schedule();}
  canvas.style.cursor='grab';canvas.style.touchAction='none';canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('wheel',wheel,{passive:false});

  function running(){return !disposed&&!manualPaused&&!contextLost&&visible&&intersecting;}
  function schedule(){if(running()&&!frameId)frameId=requestAnimationFrame(render);}
  function render(time){frameId=0;if(!running())return;const dt=lastTime?clamp(time-lastTime,1,75):16.7;lastTime=time;elapsed+=dt/1000;averageFrame=averageFrame*.96+dt*.04;const low=qualityMode==='low'||adaptiveLow;if(low&&time-lastDrawTime<32){schedule();return;}lastDrawTime=time;
    if(!keyboardAllowed())heldKeys.clear();if(navigationMode==='walk'&&heldKeys.size){let x=Number(heldKeys.has('right'))-Number(heldKeys.has('left')),z=Number(heldKeys.has('forward'))-Number(heldKeys.has('backward'));const length=Math.hypot(x,z)||1;walkStep(x/length*dt*.0031,z/length*dt*.0031);}
    const orbitBase=cameraGoal.clone().sub(targetGoal),radius=orbitBase.length(),theta=Math.atan2(orbitBase.x,orbitBase.z)+orbitYaw,phi=clamp(Math.acos(clamp(orbitBase.y/radius,-1,1))+orbitPitch,.5,1.5),desired=navigationMode==='walk'?walkPosition:V(Math.sin(phi)*Math.sin(theta)*radius,Math.cos(phi)*radius,Math.sin(phi)*Math.cos(theta)*radius).add(targetGoal),gaze=navigationMode==='walk'?walkTarget():targetGoal;
    const ease=navigationMode==='walk'||reducedMotion?1:1-Math.exp(-dt*.004);camera.position.lerp(desired,ease);target.lerp(gaze,ease);camera.lookAt(target);
    if(specimen&&!reducedMotion){specimenMount.rotation.y=Math.sin(elapsed*.17)*.12;specimenMount.position.y=2.93+Math.sin(elapsed*.65)*.045;const rigid=specimen.userData.profile==='BIO-LINE-GEOMETRY1'||['molecule','component'].includes(specimen.userData.kind),breathe=rigid?1:1+Math.sin(elapsed*(specimenId==='heart'?6.8:1.35))*(specimenId==='heart'?.023:.009);specimenMount.scale.set(1,breathe,1);}
    if(!reducedMotion){particles.rotation.y=elapsed*.035;particles.position.y=Math.sin(elapsed*.42)*.055;if(scanRing.visible)scanRing.position.y=1.12+(Math.sin(elapsed*1.35)*.5+.5)*3.83;}
    renderer.render(scene,camera);if(lastMetricTime===null){lastMetricTime=time;frameCount=0;}else frameCount++;if(time-lastMetricTime>650){fps=Math.round(frameCount*1000/Math.max(1,time-lastMetricTime));frameCount=0;lastMetricTime=time;if(qualityMode==='auto'&&!adaptiveLow&&elapsed>5&&averageFrame>27){adaptiveLow=true;resize();}}
    const transitioning=camera.position.distanceTo(desired)>.015||target.distanceTo(gaze)>.01;if(!reducedMotion||drag||heldKeys.size||transitioning)schedule();
  }
  function resetTiming(){lastTime=0;lastDrawTime=0;lastMetricTime=null;frameCount=0;fps=0;averageFrame=16.7;}
  function stopFrame(){cancelAnimationFrame(frameId);frameId=0;heldKeys.clear();resetTiming();}
  function setPaused(value){const next=!!value;if(next===manualPaused)return;manualPaused=next;if(manualPaused)stopFrame();else{resetTiming();schedule();}}
  const onVisibility=()=>{visible=!document.hidden;if(!visible)stopFrame();else{resetTiming();schedule();}};document.addEventListener('visibilitychange',onVisibility);
  const onResize=()=>resize();window.addEventListener('resize',onResize);const observer=typeof ResizeObserver==='function'?new ResizeObserver(onResize):null;observer?.observe(canvas.parentElement??canvas);
  const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(rows=>{const next=rows[0]?.isIntersecting!==false;if(next===intersecting)return;intersecting=next;if(intersecting){resetTiming();schedule();}else stopFrame();}):null;intersection?.observe(canvas);
  const lost=event=>{event.preventDefault();contextLost=true;stopFrame();},restored=()=>{contextLost=false;resetTiming();schedule();};canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
  function getMetrics(){return{engine:'Three.js r160',navigationMode,position:{x:walkPosition.x,y:walkPosition.y,z:walkPosition.z},station,operation,specimen:specimenId,workScope:activeWork?.scope??null,workId:activeWork?.id??null,morphologySource:specimen?.userData.source??null,structureKey:specimen?.userData.structureKey??null,specimenKey:specimen?.userData.specimenKey??null,stage,quality:qualityMode,adaptiveLow,dpr:renderer.getPixelRatio(),fps,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,paused:!running(),moleculeDataReady:['glycine','atp','dopc','glucose'].every(id=>!!compounds[id])};}
  function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frameId);heldKeys.clear();observer?.disconnect();intersection?.disconnect();document.removeEventListener('keydown',keyDown);document.removeEventListener('keyup',keyUp);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('blur',clearKeys);window.removeEventListener('resize',onResize);for(const [event,fn]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['wheel',wheel],['webglcontextlost',lost],['webglcontextrestored',restored]])canvas.removeEventListener(event,fn);if(specimen)disposeSpecimen(specimen);disposeSpecimen(atlasHeart);for(const g of staticGeo)g.dispose();for(const m of staticMats)m.dispose();edgeCache.clear();renderer.dispose();}
  setSpecimen('organism');resetView();resize();schedule();
  return Object.freeze({setStation,setOperation,setSpecimen,setWork,setStage,setPaused,setQuality,setNavigationMode,move:movePlayer,resetView,getHotspots,getMetrics,resize,dispose});
}
