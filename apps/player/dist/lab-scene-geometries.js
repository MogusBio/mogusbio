import * as THREE from '/lab-assets/three.module.js';

const v=(x,y,z)=>new THREE.Vector3(x,y,z);
const mat=(color,options={})=>new THREE.MeshStandardMaterial({color,roughness:.48,metalness:.04,...options});
const add=(group,geometry,material,position=[0,0,0],scale=[1,1,1])=>{const m=new THREE.Mesh(geometry,material);m.position.set(...position);m.scale.set(...scale);group.add(m);return m;};
const sphere=(g,m,p,s,segments=24)=>add(g,new THREE.SphereGeometry(1,segments,16),m,p,s);
function tube(g,points,radius,material,{segments=24,sides=6}={}){const curve=new THREE.CatmullRomCurve3(points.map(p=>v(...p)));return add(g,new THREE.TubeGeometry(curve,segments,radius,sides,false),material);}
function cylinderBetween(g,a,b,r,material,segments=10){const p=v(...a),q=v(...b),d=q.clone().sub(p),m=add(g,new THREE.CylinderGeometry(r,r,d.length(),segments),material);m.position.copy(p.add(q).multiplyScalar(.5));m.quaternion.setFromUnitVectors(v(0,1,0),d.normalize());return m;}

/** A continuous tapered biological body, not a chain of disconnected spheres. */
function sweptBody(points,radii,{rings=42,sides=18,flatten=.76}={}){
  const curve=new THREE.CatmullRomCurve3(points.map(p=>v(...p))),frames=curve.computeFrenetFrames(rings,false),vertices=[],indices=[];
  for(let i=0;i<=rings;i++){
    const t=i/rings,p=curve.getPointAt(t),f=t*(radii.length-1),n=Math.min(radii.length-2,Math.floor(f)),a=f-n,r=THREE.MathUtils.lerp(radii[n],radii[n+1],a);
    for(let j=0;j<=sides;j++){const angle=j/sides*Math.PI*2,q=p.clone().addScaledVector(frames.normals[i],Math.cos(angle)*r).addScaledVector(frames.binormals[i],Math.sin(angle)*r*flatten);vertices.push(q.x,q.y,q.z);}
  }
  for(let i=0;i<rings;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+sides+1;indices.push(a,b,a+1,b,b+1,a+1);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function createOrganism(){
  const group=new THREE.Group();group.name='Procedural xenobiology specimen';
  const skin=mat(0xa5cf73,{roughness:.37,transparent:true,opacity:.93,depthWrite:true}),belly=mat(0xe2ecc0,{roughness:.55}),ridge=mat(0x4f8f5b),gills=mat(0xd68778,{roughness:.5}),eye=mat(0x172f2a,{roughness:.15}),shine=mat(0xeaf3ce,{emissive:0xb8dca1,emissiveIntensity:.25});
  const path=[[-.95,.37,0],[-.35,.18,0],[.3,-.04,.03],[.9,-.3,.01],[1.3,-.67,-.05],[1.48,-1.14,-.17],[1.22,-1.52,-.22]];
  add(group,sweptBody(path,[.61,.64,.55,.39,.23,.1,.015]),skin);
  sphere(group,skin,[-1.04,.4,0],[.8,.59,.65]);
  sphere(group,belly,[-1.25,.18,.06],[.58,.23,.52]);
  for(const side of [-1,1]){
    sphere(group,eye,[-1.58,.55,.43*side],[.125,.125,.1],16);
    sphere(group,shine,[-1.63,.6,.49*side],[.032,.032,.025],10);
    tube(group,[[-1.7,.23,.3*side],[-1.79,.2,0],[-1.7,.23,-.3*side]],.013,ridge,{segments:12,sides:4});
    for(let f=0;f<3;f++){
      const base=[-.65+f*.14,.54-f*.13,side*(.47+f*.015)],tip=[-1.06+f*.17,1.23-f*.1,side*(.86+f*.09)];
      tube(group,[base,[base[0]-.19,base[1]+.32,side*.72],tip],.045,gills,{segments:12,sides:5});
      for(let b=0;b<3;b++){const t=.4+b*.18,p=base.map((x,i)=>THREE.MathUtils.lerp(x,tip[i],t));tube(group,[p,[p[0]+.12,p[1]+.06,side*(Math.abs(p[2])+.16)],[p[0]+.17,p[1]+.18,side*(Math.abs(p[2])+.19)]],.018,gills,{segments:7,sides:4});}
    }
    for(const [x,y,z]of [[-.38,.05,.43],[.63,-.34,.29]]){
      tube(group,[[x,y,z*side],[x-.05,y-.42,.67*side],[x-.38,y-.59,.9*side]],.075,skin,{segments:15,sides:7});
      for(let toe=0;toe<3;toe++)tube(group,[[x-.36,y-.57,.88*side],[x-.52-toe*.06,y-.63,(.84+toe*.11)*side]],.023,belly,{segments:6,sides:4});
    }
    tube(group,[[-.68,.72,.12*side],[-.25,.77,.18*side],[.3,.54,.16*side],[.82,.15,.08*side],[1.29,-.66,.02*side]],.022,ridge,{segments:28,sides:5});
    for(let i=0;i<8;i++){const x=-.38+i*.16,y=.56-i*.075; tube(group,[[x,y,.18*side],[x+.09,y-.04,.38*side],[x+.12,y-.19,.4*side]],.014,ridge,{segments:7,sides:4});}
  }
  group.rotation.set(.05,Math.PI*.12,.08);group.userData.kind='organism';return group;
}

export function createHeart(){
  const g=new THREE.Group();g.name='Illustrative anatomical heart';
  const muscle=mat(0xc0695b,{roughness:.48}),shadow=mat(0x9a433e),artery=mat(0xd98871),vein=mat(0x507f93),coronary=mat(0x7c3c38);
  const left=sphere(g,muscle,[.2,-.12,0],[.66,.95,.54]);left.rotation.z=-.28;
  const right=sphere(g,shadow,[-.36,.11,.16],[.5,.74,.49]);right.rotation.z=.18;
  sphere(g,muscle,[-.43,.7,.03],[.46,.35,.42]);sphere(g,muscle,[.38,.71,-.1],[.4,.31,.34]);
  tube(g,[[.22,.62,-.1],[.48,1.05,-.08],[.22,1.44,-.11],[-.28,1.36,-.19],[-.52,.92,-.26]],.16,artery,{segments:28,sides:12});
  for(let n=0;n<3;n++)tube(g,[[.13-n*.19,1.38,-.14],[.18-n*.23,1.66,-.13],[.1-n*.24,1.83,-.1]],.06,artery,{segments:12,sides:8});
  tube(g,[[-.68,.52,-.12],[-.69,1.03,-.13],[-.78,1.42,-.17]],.15,vein,{segments:18,sides:10});
  tube(g,[[-.17,.63,.25],[.15,1.0,.32],[.72,1.07,.16]],.13,vein,{segments:20,sides:10});
  tube(g,[[-.69,.43,-.1],[-.83,.08,-.1],[-.75,-.35,-.15]],.13,vein,{segments:16,sides:10});
  tube(g,[[.26,.56,.47],[.09,.28,.54],[-.05,-.1,.54],[.03,-.53,.34],[.12,-.86,.16]],.037,coronary,{segments:26,sides:6});
  tube(g,[[.11,.27,.53],[.38,.1,.53],[.58,-.19,.34]],.028,coronary,{segments:18,sides:5});
  tube(g,[[-.02,-.11,.53],[-.34,-.23,.49],[-.46,-.44,.26]],.025,coronary,{segments:17,sides:5});
  g.rotation.set(.12,-.23,-.05);g.scale.setScalar(.96);g.userData.kind='heart';return g;
}

function brainLobe(side,material){
  const geometry=new THREE.SphereGeometry(1,40,26),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),theta=Math.atan2(z,x),phi=Math.acos(THREE.MathUtils.clamp(y,-1,1));const wrinkle=1+.035*Math.sin(theta*11+Math.sin(phi*8))+.018*Math.sin(phi*18+theta*3);p.setXYZ(i,x*.62*wrinkle+side*.34,y*.7*wrinkle,z*.86*wrinkle);}
  geometry.computeVertexNormals();return new THREE.Mesh(geometry,material);
}
export function createBrain(){
  const g=new THREE.Group();g.name='Illustrative brain with paired hemispheres';const tissue=mat(0xd5a59c,{roughness:.62}),fold=mat(0xe4b8a9,{roughness:.6}),dark=mat(0xa77473),stem=mat(0xe7ceb0);
  g.add(brainLobe(-1,tissue),brainLobe(1,tissue));
  for(const side of [-1,1]){
    for(let band=0;band<7;band++){
      const points=[];for(let j=0;j<=26;j++){const u=j/26*Math.PI,t=-1.05+band*.3,theta=u+.08*Math.sin(u*7+band);const y=Math.sin(theta)*.68,z=Math.cos(theta)*.8;const x=side*(.36+Math.sqrt(Math.max(0,1-(y/.74)**2-(z/.91)**2))*.53);points.push([x+side*.025*Math.sin(u*9+band),y+Math.sin(t)*.1,z+Math.cos(u*3+t)*.035]);}
      tube(g,points,.024,band%3===0?dark:fold,{segments:26,sides:5});
    }
  }
  tube(g,[[0,-.2,.84],[0,.45,.56],[0,.73,0],[0,.47,-.64],[0,-.25,-.82]],.025,dark,{segments:30,sides:4});
  sphere(g,tissue,[0,-.53,-.58],[.54,.28,.38]);tube(g,[[0,-.56,-.48],[.04,-.91,-.46],[.04,-1.14,-.35]],.12,stem,{segments:18,sides:8});
  g.rotation.set(.14,.15,0);g.userData.kind='brain';return g;
}

export function createCell(){
  const g=new THREE.Group();g.name='Illustrative eukaryotic cell';const membrane=mat(0x8bc9ac,{transparent:true,opacity:.22,depthWrite:false,roughness:.32,side:THREE.DoubleSide}),nucleus=mat(0xb491b0,{roughness:.44}),dark=mat(0x7d6989),mito=mat(0xcf9674),reticulum=mat(0x9fcfb8);
  sphere(g,membrane,[0,0,0],[1.35,1.06,1.16],32);sphere(g,nucleus,[-.3,.12,.02],[.55,.5,.5]);sphere(g,dark,[-.42,.18,.32],[.16,.17,.15],16);
  for(let i=0;i<7;i++){const points=[];for(let j=0;j<=22;j++){const t=j/22*Math.PI*1.6;points.push([Math.cos(t)*(.64+i*.047)-.21,Math.sin(t)*(.38+i*.028),Math.sin(t*2.1+i*.55)*.12-.17+i*.035]);}tube(g,points,.035,reticulum,{segments:22,sides:5});}
  for(let i=0;i<5;i++){const a=i/5*Math.PI*2,p=[Math.cos(a)*.93,Math.sin(a)*.64,Math.sin(a*1.7)*.5];const m=sphere(g,mito,p,[.28,.12,.13],18);m.rotation.z=a+.4;}
  g.rotation.y=.22;g.userData.kind='cell';return g;
}

/** A protocol-scale functional component, deliberately not an invented protein
 * conformation. Its housing and connectors make the four primitive roles legible. */
export function createComponent({primitive=1,profile=0}={}){
  if(!Number.isInteger(primitive)||primitive<1||primitive>4||!Number.isInteger(profile)||(primitive===4?profile<1||profile>15:profile!==0))throw Error('COMPONENT_DESCRIPTOR');
  const g=new THREE.Group(),labels=['Exchange','Processing','Transport','Functional'];g.name=`${labels[primitive-1]} component${primitive===4?` / C${String(profile).padStart(2,'0')}`:''}`;
  const shell=mat(0x6b9f78,{roughness:.32,metalness:.12}),dark=mat(0x203b2d,{roughness:.44,metalness:.2}),light=mat(0xc8f184,{emissive:0x75b944,emissiveIntensity:.22}),amber=mat(0xd6b872),glass=mat(0xa3d0ac,{transparent:true,opacity:.25,depthWrite:false,side:THREE.DoubleSide});
  function port(position,axis){const tube=add(g,new THREE.CylinderGeometry(.16,.16,.29,16),dark,position);tube.quaternion.setFromUnitVectors(v(0,1,0),v(...axis));const lip=add(g,new THREE.TorusGeometry(.16,.035,6,22),light,position);lip.quaternion.setFromUnitVectors(v(0,0,1),v(...axis));}
  if(primitive===1){
    sphere(g,shell,[0,0,0],[.88,.34,.72]);sphere(g,glass,[0,.1,0],[.81,.34,.66]);
    for(let i=0;i<7;i++){const a=i/7*Math.PI*2;sphere(g,light,[Math.cos(a)*.58,.22,Math.sin(a)*.46],[.11,.09,.1],12);}
    port([-.91,0,0],[-1,0,0]);port([.91,0,0],[1,0,0]);
  }else if(primitive===2){
    add(g,new THREE.CylinderGeometry(.66,.66,1.18,24),glass);for(const y of [-.63,.63])add(g,new THREE.CylinderGeometry(.72,.72,.12,24),shell,[0,y,0]);
    for(let i=0;i<5;i++){const a=i/5*Math.PI*2;cylinderBetween(g,[Math.cos(a)*.35,-.48,Math.sin(a)*.35],[Math.cos(a)*.35,.48,Math.sin(a)*.35],.07,i%2?light:amber,10);}
    port([-.76,-.22,0],[-1,0,0]);port([.76,.22,0],[1,0,0]);
  }else if(primitive===3){
    for(const z of [-.25,.25]){cylinderBetween(g,[-.9,0,z],[.9,0,z],.16,shell,18);cylinderBetween(g,[-.7,.04,z],[.7,.04,z],.065,light,12);}
    for(const x of [-.7,0,.7])add(g,new THREE.BoxGeometry(.12,.44,.89),dark,[x,0,0]);port([-1.02,0,0],[-1,0,0]);port([1.02,0,0],[1,0,0]);
  }else{
    const roleColor=[0x8dbb81,0xbaa672,0x87bfc0,0xc28b82][(profile-1)%4],core=mat(roleColor,{roughness:.38});
    sphere(g,shell,[0,0,0],[.74,.56,.66]);sphere(g,core,[0,.14,.18],[.47,.37,.43]);
    for(let i=0;i<3;i++)tube(g,[[-.49,-.3+i*.17,.43],[0,-.4+i*.19,.58],[.49,-.23+i*.18,.43]],.035,light,{segments:12,sides:5});
    port([-.84,0,0],[-1,0,0]);port([.84,0,0],[1,0,0]);
  }
  g.rotation.set(.13,.22,-.04);g.userData={kind:'component',primitive,profile,illustration:true};return g;
}

/** Organ containers in the digital model contain a fixed set of functional
 * cells. They are not equivalent to the separate human-anatomy atlas models. */
export function createFunctionalOrgan({target=17}={}){
  if(!Number.isInteger(target)||target<16||target>21)throw Error('ORGAN_DESCRIPTOR');const roles=[[1,2],[3,4,5],[6,7,8,9],[10,11],[12,13],[14,15]][target-16];
  const g=new THREE.Group();g.name=`Functional organ O${String(target-15).padStart(2,'0')}`;
  const positions=roles.length===2?[[-.65,0,0],[.65,0,0]]:roles.length===3?[[-.65,.36,0],[.65,.36,0],[0,-.61,.08]]:[[-.65,.48,.16],[.65,.48,-.16],[-.65,-.48,-.16],[.65,-.48,.16]];
  const sheath=mat(0x7ba677,{transparent:true,opacity:.14,depthWrite:false,side:THREE.DoubleSide,roughness:.4}),vessel=mat(0x80a66a),flow=mat(0xc6e88e,{emissive:0x659537,emissiveIntensity:.15});
  sphere(g,sheath,[0,0,0],[1.57,roles.length===2?.84:1.28,.96],30);
  roles.forEach((role,index)=>{const cell=createCell();cell.position.set(...positions[index]);cell.scale.setScalar(.46);cell.userData.role=role;g.add(cell);});
  for(let i=1;i<positions.length;i++){const a=positions[i-1],b=positions[i];tube(g,[a,[(a[0]+b[0])/2,(a[1]+b[1])/2-.15,.32],b],.055,vessel,{segments:15,sides:6});}
  for(const side of [-1,1]){tube(g,[[side*.95,0,0],[side*1.37,0,0],[side*1.6,.15,0]],.075,flow,{segments:12,sides:7});}
  g.rotation.set(.08,.19,0);g.userData={kind:'organ',target,cellRoles:[...roles],illustration:true};return g;
}

/** Render only the normalized construction geometry supplied by morphology.
 * The renderer never derives a genotype, invents units, or substitutes an animal. */
export function createLineSpecimen(model){
  const point=p=>Array.isArray(p)&&p.length===3&&p.every(value=>Number.isFinite(value)&&Math.abs(value)<=32),path=(value,min,max)=>Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(point),kindNames=new Set(['body','organ','cell','component']);
  if(model?.profile!=='BIO-LINE-GEOMETRY1'||!['COMPONENT','CELL','ORGAN','BIO'].includes(model.scope)||!['construction','reference'].includes(model.source)||typeof model.structureKey!=='string'||!(typeof model.specimenKey==='string'||model.source==='reference'&&model.specimenKey===null)||!Array.isArray(model.units)||model.units.length<1||model.units.length>82||!Array.isArray(model.connections)||model.connections.length>440)throw Error('LINE_SPECIMEN_PROFILE');
  const ids=new Set();let markPoints=0;for(const unit of model.units){if(!unit||!['string','number'].includes(typeof unit.id)||ids.has(unit.id)||!kindNames.has(unit.kind)||!point(unit.position)||!point(unit.radii)||unit.radii.some(radius=>radius<=0)||!path(unit.contour,3,64)||!path(unit.mark??[],0,512)||(unit.mark??[]).length%2!==0)throw Error('LINE_SPECIMEN_UNIT');ids.add(unit.id);markPoints+=(unit.mark??[]).length;}if(markPoints>4096)throw Error('LINE_SPECIMEN_MARK_BUDGET');
  for(const connection of model.connections)if(!connection||!Number.isInteger(connection.type)||connection.type<1||connection.type>10||!Number.isFinite(connection.width)||connection.width<=0||connection.width>32||!path(connection.points,2,64))throw Error('LINE_SPECIMEN_CONNECTION');
  if(!point(model.bounds?.min)||!point(model.bounds?.max)||model.bounds.min.some((value,index)=>value>model.bounds.max[index])||model.bounds.min.every((value,index)=>value===model.bounds.max[index]))throw Error('LINE_SPECIMEN_BOUNDS');
  const group=new THREE.Group(),buckets=new Map(),colors=model.scope==='BIO'?{body:0x2f4b39,organ:0x617454,cell:0x7c9a80,component:0x9fb38b}:{body:0x3a5845,organ:0x6d7351,cell:0x46775d,component:0x748743},typeColors={1:0x91a84d,2:0x53898b,3:0xb38468,4:0x9e9465,5:0x66816e,6:0x8b7897,7:0x739285,8:0xa39173,9:0x6b8173,10:0x8c9a72};
  const append=(key,points,closed=false)=>{if(points.length<2)return;if(!buckets.has(key))buckets.set(key,[]);const out=buckets.get(key);for(let i=1;i<points.length;i++)out.push(...points[i-1],...points[i]);if(closed)out.push(...points.at(-1),...points[0]);};
  for(const unit of model.units){append(unit.kind,unit.contour,true);const marks=unit.mark??[];if(marks.length){if(!buckets.has(unit.kind))buckets.set(unit.kind,[]);for(let i=0;i<marks.length;i+=2)buckets.get(unit.kind).push(...marks[i],...marks[i+1]);}const [x,y,z]=unit.position,[rx,ry,rz]=unit.radii;
    // Both meridians retain real depth when the supplied primary contour is
    // viewed edge-on. They use the same supplied position and radii as its face.
    for(const plane of ['xz','yz']){const meridian=[];for(let i=0;i<16;i++){const angle=i/16*Math.PI*2;meridian.push(plane==='xz'?[x+Math.cos(angle)*rx,y,z+Math.sin(angle)*rz]:[x,y+Math.cos(angle)*ry,z+Math.sin(angle)*rz]);}append(unit.kind,meridian,true);}
  }
  for(const connection of model.connections){const key=`link:${connection.type}`;append(key,connection.points);for(const side of [-1,1]){const stroke=connection.points.map((p,index)=>{const before=connection.points[Math.max(0,index-1)],after=connection.points[Math.min(connection.points.length-1,index+1)],direction=v(...after).sub(v(...before)),offset=v(0,0,1).cross(direction);if(offset.lengthSq()<1e-10)offset.set(0,1,0).cross(direction);return v(...p).add(offset.normalize().multiplyScalar(connection.width*.6*side)).toArray();});append(key,stroke);}}
  for(const [key,positions]of buckets){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeBoundingSphere();const opacity=model.scope==='BIO'?(key.startsWith('link:')?.10:{body:.95,organ:.50,cell:.24,component:.10}[key]):key.startsWith('link:')?.58:key==='body'?.8:.92,material=new THREE.LineBasicMaterial({color:key.startsWith('link:')?typeColors[Number(key.slice(5))]:colors[key],transparent:true,opacity});const lines=new THREE.LineSegments(geometry,material);lines.name=`Construction ${key}`;lines.userData.layer=key;group.add(lines);}
  const faceGeometry=new THREE.SphereGeometry(1,12,8),matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
  for(const kind of kindNames){const units=model.units.filter(unit=>unit.kind===kind);if(!units.length)continue;const material=new THREE.MeshBasicMaterial({color:kind==='component'?0xdfe9b8:kind==='cell'?0xc7e3cf:kind==='organ'?0xe4e8ca:0xe6eddd,transparent:true,opacity:kind==='body'?.035:kind==='organ'?.045:.075,depthWrite:false,side:THREE.DoubleSide}),faces=new THREE.InstancedMesh(faceGeometry,material,units.length);faces.name=`Construction ${kind} volume`;faces.userData.layer=kind;units.forEach((unit,index)=>{matrix.compose(v(...unit.position),rotation,v(...unit.radii));faces.setMatrixAt(index,matrix);});faces.instanceMatrix.needsUpdate=true;group.add(faces);}
  group.name=`${model.source==='reference'?'Reference':'Constructed'} ${model.scope.toLowerCase()} line specimen`;
  group.userData={kind:{COMPONENT:'component',CELL:'cell',ORGAN:'organ',BIO:'organism'}[model.scope],profile:model.profile,scope:model.scope,source:model.source,structureKey:model.structureKey,specimenKey:model.specimenKey,unitCount:model.units.length,connectionCount:model.connections.length,units:model.units.map(({id,kind,parent,role,target,primitive,profile})=>({id,kind,parent,role,target,primitive,profile})),illustration:true};return group;
}

const elementColors={C:0x3b4746,H:0xf6f2e7,O:0xcd6b59,N:0x6191c4,P:0xdaaa55,S:0xdac65c,F:0x91b77a,Cl:0x73aa7a};
const atomRadii={C:.18,H:.115,O:.168,N:.17,P:.23,S:.215,F:.16,Cl:.22};
export function createMolecule(compound){
  if(!compound||!Array.isArray(compound.atoms)||!Array.isArray(compound.bonds)||!compound.atoms.length||compound.atoms.length>600)throw Error('MOLECULE_DATA_UNAVAILABLE');
  const atoms=compound.atoms,points=atoms.map(a=>v(a.x,a.y,a.z));if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)))throw Error('MOLECULE_COORDINATES');
  const box=new THREE.Box3().setFromPoints(points),center=box.getCenter(v(0,0,0)),size=box.getSize(v(0,0,0)),scale=3.25/Math.max(size.x,size.y,size.z,1),g=new THREE.Group();g.name=compound.name??'Verified molecular structure';
  for(const p of points)p.sub(center).multiplyScalar(scale);
  const sphereGeo=new THREE.SphereGeometry(1,16,12),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
  for(const element of [...new Set(atoms.map(a=>a.element))]){
    const selected=atoms.map((a,i)=>({a,i})).filter(x=>x.a.element===element),material=mat(elementColors[element]??0x9ba19c,{roughness:.32,metalness:.05}),mesh=new THREE.InstancedMesh(sphereGeo,material,selected.length);
    selected.forEach(({i},n)=>{const r=(atomRadii[element]??.18)*Math.max(.55,Math.min(1.22,scale));matrix.compose(points[i],q,v(r,r,r));mesh.setMatrixAt(n,matrix);});mesh.instanceMatrix.needsUpdate=true;g.add(mesh);
  }
  const sticks=[];for(const bond of compound.bonds){const [a,b,order=1]=bond;if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=atoms.length||b>=atoms.length||a===b||![1,2,3].includes(order))throw Error('MOLECULE_BOND');const direction=points[b].clone().sub(points[a]),offset=v(0,1,0).cross(direction);if(offset.lengthSq()<.00001)offset.set(0,0,1).cross(direction);offset.normalize().multiplyScalar(.065);for(let n=0;n<order;n++){const shift=offset.clone().multiplyScalar(n-(order-1)/2),start=points[a].clone().add(shift),end=points[b].clone().add(shift);sticks.push([start,end]);}}
  if(sticks.length){const geo=new THREE.CylinderGeometry(.033,.033,1,7),mesh=new THREE.InstancedMesh(geo,mat(0x83908a,{roughness:.65}),sticks.length);sticks.forEach(([start,end],i)=>{const d=end.clone().sub(start);matrix.compose(start.clone().add(end).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(v(0,1,0),d.clone().normalize()),v(1,d.length(),1));mesh.setMatrixAt(i,matrix);});mesh.instanceMatrix.needsUpdate=true;g.add(mesh);}
  g.rotation.set(.16,-.2,.08);g.userData.kind='molecule';g.userData.compound=compound;return g;
}

export function disposeSpecimen(group){const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
