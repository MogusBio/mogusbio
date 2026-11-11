// Cards and the 3D viewer consume the same bounded construction geometry.
// A digital construction diagram is not an anatomical reconstruction or proof of viability.
import {buildLineSpecimen} from './lab-morphology.js';

const NS='http://www.w3.org/2000/svg';
const INK='#183b32',PAPER='#f8f7ed',MINT='#c9e5d1',LIME='#d5ed95',CORAL='#ed9c77',PEACH='#f3d4bb';
const COS_YAW=Math.cos(-.42),SIN_YAW=Math.sin(-.42),COS_PITCH=Math.cos(.24),SIN_PITCH=Math.sin(.24);
const int=(v,min,max)=>Number.isInteger(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;
const SCOPES=new Set(['COMPONENT','CELL','ORGAN','BIO']);
export function specimenArtKind(descriptor={}){
  if(descriptor.assetType==='MATERIAL'||descriptor.category==='MATERIAL'||descriptor.scope==='MATERIAL')return `material-${int(descriptor.class,1,4)??'unknown'}`;
  if(descriptor.scope==='COMPONENT')return `component-${int(descriptor.primitive,1,4)??'unknown'}`;
  if(descriptor.scope==='CELL')return 'cell';
  if(descriptor.scope==='ORGAN')return `organ-${int(descriptor.target,16,21)??'unknown'}`;
  if(descriptor.scope==='BIO')return 'organism';
  return 'specimen';
}
const projectedPoint=([x,y,z])=>{
  const depth=-x*SIN_YAW+z*COS_YAW;
  return[x*COS_YAW+z*SIN_YAW,-y*COS_PITCH+depth*SIN_PITCH,y*SIN_PITCH+depth*COS_PITCH];
};
const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const number=value=>String(Number(value.toFixed(3)));

function appendConstruction(svg,node,descriptor){
  const scene=buildLineSpecimen(descriptor);
  svg.setAttribute('data-art-profile',scene.profile);
  svg.setAttribute('data-art-structure',scene.structureKey);
  svg.setAttribute('data-art-specimen',scene.specimenKey??'');
  svg.setAttribute('data-source',scene.source);
  const title=({COMPONENT:'FUNCTIONAL COMPONENT',CELL:'FUNCTIONAL CELL',ORGAN:'FUNCTIONAL ORGAN',BIO:'DIGITAL ORGANISM'})[scene.scope]??'MODEL SPECIMEN';
  const description=scene.source==='construction'?'Drawn from this specimen’s recorded digital construction.':'Reference geometry only. This specimen has no valid construction appearance attached.';
  svg.append(node('title',{},title),node('desc',{},`${description} The 2D card and 3D preview use the same geometry. This is not a real anatomical or molecular reconstruction.`));
  // Fit only structural geometry. Individual markings must never rescale an identical plan.
  const points=[...scene.units.flatMap(unit=>unit.contour),...scene.connections.flatMap(connection=>connection.points)].filter(finitePoint).map(projectedPoint);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y]of points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  if(!points.length){minX=minY=-1;maxX=maxY=1;}
  const width=Math.max(maxX-minX,.001),height=Math.max(maxY-minY,.001),scale=Math.min(278/width,181/height),centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const point=p=>{const [x,y]=projectedPoint(p);return[160+(x-centerX)*scale,109+(y-centerY)*scale];};
  const path=(points,close=false)=>points.filter(finitePoint).map((p,i)=>{const [x,y]=point(p);return`${i?'L':'M'}${number(x)} ${number(y)}`;}).join(' ')+(close?' Z':'');
  const structure=node('g',{'data-art-layer':'structure',stroke:INK,'stroke-linecap':'round','stroke-linejoin':'round'}),links=node('g',{'data-art-layer':'connections',fill:'none'}),units=node('g',{'data-art-layer':'units'}),marks=node('g',{'data-art-layer':'instance-marks',fill:'none',stroke:CORAL,'stroke-width':1.15,'stroke-linecap':'round','stroke-linejoin':'round'});
  structure.append(links,units);svg.append(structure,marks);
  const connectionGroups=new Map();
  for(const connection of scene.connections){if(connection.points.length<2)continue;const key=String(connection.type);if(!connectionGroups.has(key))connectionGroups.set(key,[]);connectionGroups.get(key).push(connection);}
  for(const [type,connections]of connectionGroups){
    const width=connections.reduce((max,connection)=>Math.max(max,connection.width??.01),0);
    links.append(node('path',{d:connections.map(connection=>path(connection.points)).join(' '),'data-connection-type':type,'data-connection-count':connections.length,'stroke-width':Math.min(2.1,Math.max(.45,width*scale)),'stroke-opacity':.43}));
  }
  const order={body:0,organ:1,cell:2,component:3},colours={body:MINT,organ:PEACH,cell:LIME,component:PAPER},opacities={body:.16,organ:.26,cell:.40,component:.65},strokes={body:1.8,organ:1.1,cell:.85,component:.7};
  const sorted=[...scene.units].sort((a,b)=>(order[a.kind]??4)-(order[b.kind]??4)||projectedPoint(a.position)[2]-projectedPoint(b.position)[2]||(String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0));
  const unitGroups=new Map();for(const unit of sorted){if(!unitGroups.has(unit.kind))unitGroups.set(unit.kind,[]);unitGroups.get(unit.kind).push(unit);}
  for(const [kind,group]of unitGroups)units.append(node('path',{'data-unit-kind':kind,'data-unit-count':group.length,'data-unit-ids':group.map(unit=>unit.id).join(' '),d:group.map(unit=>path(unit.contour,true)).join(' '),fill:colours[kind]??MINT,'fill-opacity':opacities[kind]??.2,'stroke-width':strokes[kind]??1,'stroke-opacity':kind==='body'?.9:.75}));
  const marked=sorted.filter(unit=>unit.mark?.length>1);if(marked.length)marks.append(node('path',{'data-mark-count':marked.length,d:marked.map(unit=>Array.from({length:Math.floor(unit.mark.length/2)},(_,j)=>path(unit.mark.slice(j*2,j*2+2))).join(' ')).join(' '),'stroke-opacity':.7}));
  const caption=node('text',{x:160,y:226,fill:INK,stroke:'none','font-family':'Arial, sans-serif','font-size':9,'font-weight':'600','letter-spacing':.8,'text-anchor':'middle','data-art-layer':'source-caption'},`${title} / ${scene.source==='construction'?'CONSTRUCTION':'REFERENCE'}`);svg.append(caption);
}

export function createSpecimenArt(document,descriptor={},options={}){
  if(!document||typeof document.createElement!=='function')throw Error('SPECIMEN_ART_DOCUMENT');
  const node=(tag,attrs={},text)=>{const e=typeof document.createElementNS==='function'?document.createElementNS(NS,tag):document.createElement(tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=String(text);return e;};
  const kind=specimenArtKind(descriptor),svg=node('svg',{viewBox:'0 0 320 240',role:'img','aria-label':options.label??`${kind.replaceAll('-',' ')} — digital model diagram`,class:`lab-specimen-art${options.compact?' lab-specimen-art--compact':''}`,'data-art-kind':kind,focusable:'false'});
  if(SCOPES.has(descriptor.scope)&&!kind.startsWith('material-')){appendConstruction(svg,node,descriptor);return svg;}
  svg.setAttribute('data-source',kind.startsWith('material-')?'chemical-schematic':'reference');
  svg.append(node('title',{},options.label??'Representative chemical schematic'),node('desc',{},'Representative catalogue chemistry. A material class contains the fixed protocol species; this image is not a complete inventory or molecular conformer. This is not a real anatomical or molecular reconstruction.'));
  const g=node('g',{'stroke':INK,'stroke-width':2.6,'stroke-linecap':'round','stroke-linejoin':'round',fill:'none'});svg.append(g);
  const add=(tag,attrs,text)=>{const e=node(tag,attrs,text);g.append(e);return e;};
  const path=(d,fill='none',attrs={})=>add('path',{d,fill,...attrs});
  const circle=(cx,cy,r,fill='none',attrs={})=>add('circle',{cx,cy,r,fill,...attrs});
  const line=(x1,y1,x2,y2,attrs={})=>add('line',{x1,y1,x2,y2,...attrs});
  const label=(x,y,text,size=14,attrs={})=>add('text',{x,y,fill:INK,stroke:'none','font-family':'Arial, sans-serif','font-size':size,'font-weight':'600','text-anchor':'middle',...attrs},text);
  path('M53 72C76 28 169 23 224 51s71 78 31 126-129 49-184 20S23 117 53 72Z',LIME,{'stroke':'none','fill-opacity':.7});
  if(kind==='material-1'){
    line(81,123,139,95);line(139,95,194,124);line(194,124,236,101);line(197,130,240,107);line(194,124,194,171);
    circle(139,95,17,PAPER);circle(194,124,15,PAPER);circle(81,123,21,MINT);circle(243,99,20,CORAL);circle(194,177,20,CORAL);
    label(81,128,'H₂N',13);label(139,100,'CH₂',12);label(194,129,'C',13);label(243,104,'O',14);label(194,182,'OH',12);label(158,223,'AMINO-ACID FAMILY',10,{'letter-spacing':1.5});
  }else if(kind==='material-2'){
    path('m90 88 29-18 30 18v32l-30 18-29-18Z',MINT);path('m149 88 28-20 27 23-11 31h-44Z',PAPER);
    path('m110 149 19-10 19 13-6 23h-25Z',PEACH);line(119,138,129,139);line(142,174,170,181);line(170,181,202,166);line(202,166,236,181);
    for(const [x,y]of [[170,181],[202,166],[236,181]]){circle(x,y,13,CORAL);label(x,y+4,'P',11);}label(118,110,'A',18);label(130,163,'R',11);label(158,223,'NUCLEOTIDE FAMILY',10,{'letter-spacing':1.5});
  }else if(kind==='material-3'){
    circle(159,75,29,MINT);circle(159,75,17,PAPER);label(159,80,'P',15);
    path('m144 104-18 19 15 20-20 19 15 22-18 18','none',{'stroke-width':7});path('m175 104 17 19-15 20 21 19-15 22 17 18','none',{'stroke-width':7});
    path('m143 105-18 19 15 20-20 19 15 22-18 17','none',{'stroke':MINT,'stroke-width':3});path('m175 105 16 19-15 20 21 19-15 22 17 17','none',{'stroke':CORAL,'stroke-width':3});label(158,223,'LIPID FAMILY',10,{'letter-spacing':1.5});
  }else if(kind==='material-4'){
    path('m113 93 48-26 49 27v55l-49 26-48-26Z',PAPER);line(113,93,85,78);line(113,149,88,167);line(161,175,161,197);line(210,149,236,164);line(210,94,232,78);
    circle(210,94,16,CORAL);label(210,99,'O',15);label(78,77,'OH',12);label(80,179,'OH',12);label(161,210,'OH',12);label(246,175,'OH',12);label(241,72,'CH₂OH',11);label(158,231,'SUGAR FAMILY',10,{'letter-spacing':1.5});
  }else{
    path('M124 49h72M139 49v57l-44 72q-7 14 10 14h110q17 0 10-14l-44-72V49',PAPER);path('M115 154h91l15 25q3 6-5 6H108q-7 0-4-6Z',MINT);circle(151,144,5,CORAL);circle(176,126,8,LIME);label(160,220,'REFERENCE / MODEL SPECIMEN',10,{'letter-spacing':1});
  }
  return svg;
}
