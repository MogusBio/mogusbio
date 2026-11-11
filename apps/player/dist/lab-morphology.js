// A bounded, read-only visual grammar. These lines illustrate verified protocol
// composition; they do not create biological functions, assets or rewards.
export const MORPHOLOGY_PROFILE='BIO-LINE-GEOMETRY1';
const ORGANS=[[1,2],[3,4,5],[6,7,8,9],[10,11],[12,13],[14,15]];
const HEX=/^[a-f0-9]{64}$/;
const n=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const assert=(v)=>{if(!v)throw Error('APPEARANCE_INVALID');};
const members=t=>t<=15?[t]:t<=21?[...ORGANS[t-16]]:Array.from({length:15},(_,i)=>i+1);
const scopes=t=>t<=15?[t]:t<=21?[...members(t),t]:Array.from({length:22},(_,i)=>i+1);
const parent=r=>16+ORGANS.findIndex(xs=>xs.includes(r));
const leaf=(r,p)=>64+4*(r-1)+p-1;
const zero='0'.repeat(64),cache=new Map();
const copy=v=>structuredClone(v);
export function clearMorphologyCache(){cache.clear();}
function bytes64(value,max){assert(typeof value==='string'&&value.length<=Math.ceil(max/3)*4&&value.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));const s=atob(value);assert(s.length<=max&&btoa(s)===value);return Uint8Array.from(s,c=>c.charCodeAt(0));}
// Small synchronous display-integrity checksum, not a transaction signer.
export function appearanceSHA256(bytes){
 assert(bytes instanceof Uint8Array&&bytes.length<=7713);
 const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],size=Math.ceil((bytes.length+9)/64)*64,padded=new Uint8Array(size);padded.set(bytes);padded[bytes.length]=128;const v=new DataView(padded.buffer);v.setUint32(size-4,bytes.length*8,false);const w=new Uint32Array(64),rotate=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let offset=0;offset<size;offset+=64){for(let i=0;i<16;i++)w[i]=v.getUint32(offset+i*4,false);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],a=rotate(x,7)^rotate(x,18)^(x>>>3),b=rotate(y,17)^rotate(y,19)^(y>>>10);w[i]=(w[i-16]+a+w[i-7]+b)>>>0;}let[a,b,c,d,e,f,g,j]=h;for(let i=0;i<64;i++){const t1=(j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^((~e)&g))+constants[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,j].forEach((x,i)=>h[i]=(h[i]+x)>>>0);}
 return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
export function decodeMorphologyGraph(encoded){
 const bytes=bytes64(encoded,7713);assert(bytes.length>=149);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let i=0;
 const u8=()=>{assert(i<bytes.length);return view.getUint8(i++);},u16=()=>{assert(i+2<=bytes.length);const v=view.getUint16(i,true);i+=2;return v;},u32=()=>{assert(i+4<=bytes.length);const v=view.getUint32(i,true);i+=4;return v;};
 let magic='';for(let k=0;k<8;k++)magic+=String.fromCharCode(u8());assert(magic==='BIOP6G01'&&u16()===1);const target=u8();assert(n(target,1,22)&&u8()===0&&u32()===bytes.length-16);i+=128;assert(i<bytes.length);
 const list=(max,read,wide=false)=>{const length=wide?u16():u8();assert(length<=max);return Array.from({length},read);};
 const nodes=list(22,()=>({scope:u8(),kind:u8(),role:u8(),parent:u8()}));const expected=scopes(target);assert(nodes.length===expected.length&&nodes.every((x,j)=>x.scope===expected[j]&&x.kind===(x.scope<=15?1:x.scope<=21?2:3)&&x.role===(x.scope<=15?x.scope:x.scope<=21?x.scope-15:0)&&x.parent===(x.scope===target?0:x.scope<=15?parent(x.scope):22)));
 const cells=list(15,()=>({role:u8(),v:u32()})),roles=members(target);assert(cells.length===roles.length&&cells.every((c,j)=>c.role===roles[j]&&n(c.v,0,1000000)&&c.v%1000===0));
 const tiers=list(22,()=>({scope:u8(),mode:u8()}));assert(tiers.length===expected.length&&tiers.every((t,j)=>t.scope===expected[j]&&n(t.mode,0,1)));
 const endpoint=()=>{const e={kind:u8(),role:u8(),sub:u8(),port:u16()};assert(n(e.kind,0,8)&&n(e.role,0,15)&&n(e.sub,0,4));return e;};
 const edges=list(440,()=>{const owner=u8(),type=u8(),src=endpoint(),dst=endpoint(),fraction=u32();assert(n(owner,0,22)&&n(type,1,10)&&n(fraction,0,1000000)&&(type<=3||fraction===0));return{owner,type,src,dst,fraction};},true);
 const opens=list(45,()=>({role:u8(),species:u8(),remaining:u32()}));assert(opens.length===roles.length*3&&opens.every((x,j)=>x.role===roles[Math.floor(j/3)]&&x.species===j%3+1&&n(x.remaining,0,1000000)));
 const slots=list(15,()=>({role:u8(),x:u8(),y:u8()}));assert((target===22?slots.length===15&&slots.every((s,j)=>s.role===j+1&&n(s.x,0,4)&&n(s.y,0,2))&&new Set(slots.map(s=>`${s.x},${s.y}`)).size===15:slots.length===0)&&i===bytes.length);
 return{target,nodes,cells,tiers,edges,slots};
}
function expectedLineage(scope,target,primitive,profile){if(scope==='COMPONENT')return[leaf(profile||1,primitive)];const roles=members(target);return[...scopes(target),...roles.flatMap(r=>[1,2,3,4].map(p=>leaf(r,p)))].sort((a,b)=>a-b);}
function provenance(d){
 const scope=d.scope,target=d.target,primitive=d.primitive,profile=d.profile;
 assert(['COMPONENT','CELL','ORGAN','BIO'].includes(scope));if(scope==='COMPONENT')assert(n(primitive,1,4)&&n(profile??0,0,15)&&(primitive===4?(profile>=1):!profile));else assert(n(target,1,22)&&(scope==='CELL'?target<=15:scope==='ORGAN'?target>=16&&target<=21:target===22));
 const a=d.appearance,rootId=d.workId??d.id;
 assert(a?.profile==='BIO-LINE-APPEARANCE1'&&a.version===1&&HEX.test(a.structureKey)&&HEX.test(a.specimenKey)&&a.specimenKey===rootId);
 let graph=null;if(scope==='COMPONENT')assert(a.graphKey===null&&a.structureKey===appearanceSHA256(Uint8Array.of(1,0,primitive,profile??0)));else{assert(HEX.test(a.graphKey)&&typeof a.graph==='string'&&appearanceSHA256(bytes64(a.graph,7713))===a.graphKey);graph=decodeMorphologyGraph(a.graph);assert(graph.target===target);}
 const expected=expectedLineage(scope,target,primitive,profile??0),bytes=bytes64(a.lineage,82*9);assert(bytes.length===expected.length*9);const lineage=new Map();for(let j=0;j<expected.length;j++){assert(bytes[j*9]===expected[j]);lineage.set(expected[j],[...bytes.subarray(j*9+1,j*9+9)].map(x=>x.toString(16).padStart(2,'0')).join(''));}
 const rootNode=scope==='COMPONENT'?leaf(profile||1,primitive):target;assert(lineage.get(rootNode)===a.specimenKey.slice(0,16));
 return{scope,target,primitive,profile:profile??0,graph,lineage,structureKey:a.structureKey,specimenKey:a.specimenKey,source:'construction'};
}
function reference(d){
 const scope=['COMPONENT','CELL','ORGAN','BIO'].includes(d?.scope)?d.scope:'BIO',target=scope==='CELL'?(n(d.target,1,15)?d.target:4):scope==='ORGAN'?(n(d.target,16,21)?d.target:17):scope==='BIO'?22:0,primitive=n(d?.primitive,1,4)?d.primitive:1,profile=primitive===4&&n(d?.profile,1,15)?d.profile:0;
 const roles=scope==='COMPONENT'?[]:members(target),graph=scope==='COMPONENT'?null:{target,cells:roles.map(role=>({role,v:[3,9,14,15].includes(role)?0:1000000})),tiers:scopes(target).map(scope=>({scope,mode:0})),slots:target===22?roles.map((role,j)=>({role,x:j%5,y:Math.floor(j/5)})):[],edges:[]};
 return{scope,target,primitive,profile,graph,lineage:new Map(),structureKey:zero,specimenKey:null,source:'reference'};
}
const round=x=>Math.round(x*1e6)/1e6;
const add=(a,b)=>a.map((x,j)=>x+b[j]);
function contour(position,radii,code,mode=0){return Array.from({length:32},(_,j)=>{const t=j*Math.PI/16,ruffle=1+.045*Math.sin((3+code%4)*t+code*.7)+.02*mode*Math.cos(7*t);return[position[0]+radii[0]*Math.cos(t)*ruffle,position[1]+radii[1]*Math.sin(t)*ruffle,position[2]+radii[2]*.07*Math.sin(3*t+code)];});}
function hull(points){const sorted=points.map(p=>[p[0],p[1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);const low=[],high=[];for(const p of sorted){while(low.length>1&&cross(low.at(-2),low.at(-1),p)<=0)low.pop();low.push(p);}for(const p of [...sorted].reverse()){while(high.length>1&&cross(high.at(-2),high.at(-1),p)<=0)high.pop();high.push(p);}return[...low.slice(0,-1),...high.slice(0,-1)];}
function envelope(children,margin,code){
 const cloud=children.flatMap(c=>c.contour),position=[0,1,2].map(j=>children.reduce((n,c)=>n+c.position[j],0)/children.length),poly=hull(cloud),radii=[0,1,2].map(j=>Math.max(...children.map(c=>Math.abs(c.position[j]-position[j])+c.radii[j]))+margin);
 const points=Array.from({length:32},(_,j)=>{const t=j*Math.PI/16,d=[Math.cos(t),Math.sin(t)];let distance=Infinity;for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length],e=[b[0]-a[0],b[1]-a[1]],p=[a[0]-position[0],a[1]-position[1]],den=d[0]*e[1]-d[1]*e[0];if(Math.abs(den)<1e-9)continue;const r=(p[0]*e[1]-p[1]*e[0])/den,u=(p[0]*d[1]-p[1]*d[0])/den;if(r>=0&&u>=0&&u<=1)distance=Math.min(distance,r);}if(!Number.isFinite(distance))distance=Math.max(radii[0],radii[1]);const out=distance+margin*(1+.1*Math.sin(5*t+code));return[position[0]+d[0]*out,position[1]+d[1]*out,position[2]+.07*Math.sin(3*t+code)];});
 radii[0]=Math.max(...points.map(p=>Math.abs(p[0]-position[0])));radii[1]=Math.max(...points.map(p=>Math.abs(p[1]-position[1])));return{position,radii,contour:points};
}
function marks(unit,value,root=false){if(!value)return[];const bits=[...value.slice(0,root?64:4)].flatMap(x=>parseInt(x,16).toString(2).padStart(4,'0').split('').map(Number)),out=[];for(let j=0;j<bits.length;j++){const f=j/bits.length*32,k=Math.floor(f)%32,u=f-k,a=unit.contour[k],b=unit.contour[(k+1)%32],p=a.map((x,t)=>x+(b[t]-x)*u),factor=.84,base=p.map((x,t)=>unit.position[t]+(x-unit.position[t])*factor),length=root?(bits[j]?.028:.008):(bits[j]?.055:.018),dx=p[0]-unit.position[0],dy=p[1]-unit.position[1],mag=Math.hypot(dx,dy)||1;out.push(base,[base[0]+dx/mag*length,base[1]+dy/mag*length,base[2]+.015]);}return out;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
export function buildLineSpecimen(descriptor={}){
 descriptor=descriptor&&typeof descriptor==='object'&&!Array.isArray(descriptor)?descriptor:{};const a=descriptor.appearance,scalar=v=>typeof v==='string'?(v.length<=10300?v:'<oversized>'):typeof v==='number'?(Number.isFinite(v)?v:'<nonfinite>'):v===null?null:`<${typeof v}>`,key=JSON.stringify([descriptor.scope,descriptor.target,descriptor.primitive,descriptor.profile,descriptor.workId??descriptor.id,a?.profile,a?.version,a?.structureKey,a?.specimenKey,a?.graphKey,a?.graph,a?.lineage].map(scalar));if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
 let p;try{p=provenance(descriptor);}catch{p=reference(descriptor);}const g=p.graph,units=[],connections=[],byNode=new Map(),modes=new Map(g?.tiers.map(t=>[t.scope,t.mode])??[]),caps=new Map(g?.cells.map(c=>[c.role,c.v/1000000])??[]),rootNode=p.scope==='COMPONENT'?leaf(p.profile||1,p.primitive):p.target;
 const unit=(node,kind,position,radii,fields={})=>{const value={id:`n${node}`,nodeId:node,kind,parent:fields.parent===null?null:`n${fields.parent}`,role:fields.role??0,target:fields.target??0,primitive:fields.primitive??0,profile:fields.profile??0,position,radii,contour:contour(position,radii,fields.role??node,modes.get(fields.role??node)??0),mark:[]};units.push(value);byNode.set(node,value);return value;};
 const makePart=(role,primitive,position,radii,parentNode)=>{const node=leaf(role||1,primitive);const part=unit(node,'component',position,radii,{role,primitive,profile:primitive===4?role:0,parent:parentNode});part.contour=contour(position,radii,primitive*7+role,modes.get(role)??0);return part;};
 if(p.scope==='COMPONENT'){
   const radii=({1:[1.25,.7,.62],2:[.95,.95,.73],3:[1.35,.6,.55],4:[.83,1.05,.72]})[p.primitive];const leafRole=p.profile||1;const part=makePart(leafRole,p.primitive,[0,0,0],radii,null);part.role=p.profile;part.profile=p.profile;
 }else{
   const roles=members(p.target),count=roles.length;
   for(const [j,role]of roles.entries()){
     const v=caps.get(role)??0,mode=modes.get(role)??0;let position;
     if(p.scope==='BIO'){const slot=g.slots.find(s=>s.role===role);position=[(slot.x-2)*1.03+.1*v*Math.cos(role),(1-slot.y)*1.04+.1*v*Math.sin(role),((role%3)-1)*.21+mode*.12];}
     else if(p.scope==='ORGAN'){const theta=j/count*Math.PI*2-.5*Math.PI,rad=count===2?.63:.82;position=[Math.cos(theta)*rad,Math.sin(theta)*rad,((j%2)-.5)*.24];}
     else position=[0,0,0];
     const strength=1+.17*v+.08*mode,radii=[.43*strength*([10,11].includes(role)?1.35:1),.39*strength*([12,13].includes(role)?1.18:1),.32+.06*mode];
     const cell=unit(role,'cell',position,radii,{role,target:role,parent:p.scope==='CELL'?null:parent(role)});
     const offsets=[[-.42,0,.07],[0,.38,.09],[.42,0,.07],[0,-.38,.11]];
     for(let primitive=1;primitive<=4;primitive++){const q=offsets[primitive-1],pos=add(position,q.map((x,k)=>x*radii[k])),sz=[radii[0]*.23*(primitive===3?1.3:1),radii[1]*.23*(primitive===2?1.15:1),radii[2]*.23];makePart(role,primitive,pos,sz,role);}
   }
   if(p.scope!=='CELL')for(const organTarget of p.scope==='BIO'?[16,17,18,19,20,21]:[p.target]){const children=ORGANS[organTarget-16].map(r=>byNode.get(r)),shell=envelope(children,.16+.04*(modes.get(organTarget)??0),organTarget);const organ=unit(organTarget,'organ',shell.position,shell.radii,{target:organTarget,parent:p.scope==='BIO'?22:null});organ.contour=shell.contour;}
   if(p.scope==='BIO'){const shell=envelope([16,17,18,19,20,21].map(t=>byNode.get(t)),.32+.06*(modes.get(22)??0),22),body=unit(22,'body',shell.position,shell.radii,{target:22,parent:null});body.contour=shell.contour;}
 }
 const outer=byNode.get(rootNode);
 const endpointPosition=e=>{
  let node;if(e.kind===0)node=leaf(e.role,e.sub);else if(e.kind===1){const theta=(e.port%12)/12*2*Math.PI;return[outer.position[0]+outer.radii[0]*1.12*Math.cos(theta),outer.position[1]+outer.radii[1]*1.12*Math.sin(theta),outer.position[2]];}else if(e.kind===2)node=leaf(e.role,2);else if(e.kind===3)node=leaf(e.role,3);else if([4,5,6].includes(e.kind))node=leaf(e.role+9,4);else if(e.kind===7)node=leaf(12,4);else node=leaf(e.role,4);
  const u=byNode.get(node);if(!u)return null;const theta=(e.port%12)/12*Math.PI*2;return[u.position[0]+u.radii[0]*.5*Math.cos(theta),u.position[1]+u.radii[1]*.5*Math.sin(theta),u.position[2]];
 };
 const line=(src,dst,type,owner,fraction=0,portCode=0)=>{if(!src||!dst)return;const dx=dst[0]-src[0],dy=dst[1]-src[1],length=Math.hypot(dx,dy)||1,bend=((portCode%5)-2)*.055+(type<=3?.1+.12*fraction/1000000:0),control=[(src[0]+dst[0])/2-dy/length*bend,(src[1]+dst[1])/2+dx/length*bend,(src[2]+dst[2])/2+((type%3)-1)*.08];connections.push({owner,type,width:type<=3?.008+.025*fraction/1000000:.012,points:Array.from({length:9},(_,j)=>{const t=j/8;return src.map((x,k)=>(1-t)*(1-t)*x+2*(1-t)*t*control[k]+t*t*dst[k]);})});};
 if(g?.edges.length)for(const edge of g.edges){if(edge.type<=3&&edge.fraction===0)continue;line(endpointPosition(edge.src),endpointPosition(edge.dst),edge.type,edge.owner,edge.fraction,edge.src.port*3+edge.dst.port*5);}
 else if(p.scope!=='COMPONENT'){
   for(const role of members(p.target))for(let primitive=1;primitive<=4;primitive++)line(byNode.get(leaf(role,primitive)).position,byNode.get(leaf(role,primitive%4+1)).position,primitive+3,role);
   const cells=members(p.target);for(let j=1;j<cells.length;j++)line(byNode.get(cells[j-1]).position,byNode.get(cells[j]).position,4,p.target);
 }
 for(const u of units)u.mark=marks(u,u.nodeId===rootNode?p.specimenKey:p.lineage.get(u.nodeId),u.nodeId===rootNode);
 const cloud=[...units.flatMap(u=>[...u.contour,...[0,1,2].flatMap(k=>[-1,1].map(sign=>u.position.map((x,j)=>x+(j===k?u.radii[k]*sign:0))))]),...connections.flatMap(c=>c.points)],min=[0,1,2].map(k=>Math.min(...cloud.map(q=>q[k]))),max=[0,1,2].map(k=>Math.max(...cloud.map(q=>q[k]))),centre=min.map((x,k)=>(x+max[k])/2),scale=4/Math.max(...min.map((x,k)=>max[k]-x),.01),transform=q=>q.map((x,k)=>round((x-centre[k])*scale));
 for(const u of units){u.position=transform(u.position);u.radii=u.radii.map(x=>round(x*scale));u.contour=u.contour.map(transform);u.mark=u.mark.map(transform);}for(const c of connections){c.width=round(c.width*scale);c.points=c.points.map(transform);}
 const order={body:0,organ:1,cell:2,component:3};units.sort((a,b)=>order[a.kind]-order[b.kind]||a.nodeId-b.nodeId);
 const result=freeze({profile:MORPHOLOGY_PROFILE,scope:p.scope,structureKey:p.structureKey,specimenKey:p.specimenKey,source:p.source,units,connections,bounds:{min:transform(min),max:transform(max)}});assert(units.length<=82&&connections.length<=440);
 cache.set(key,result);while(cache.size>8)cache.delete(cache.keys().next().value);return result;
}
/** Hydrate references after bounded transport; no extra network request or state mutation. */
export function hydrateAppearanceState(state){
 if(!state||typeof state!=='object')return state;
 const rows=value=>Array.isArray(value)?value:[],launches=new Map(rows(state.workLaunches).map(row=>[row?.id,row]));
 if(state.market?.listingCollections==='DERIVED_FROM_CATEGORY')for(const [key,category]of [['materials','MATERIAL'],['products','PRODUCT'],['bios','BIO']])state.market[key]=rows(state.market.listings).filter(row=>row?.category===category);
 for(const name of ['listings','products','bios'])for(const row of rows(state.market?.[name])){if(!row||typeof row!=='object')continue;const launch=launches.get(row.launchRef);if(launch&&HEX.test(launch.id)&&launch.workId===row.workId&&launch.listingId===row.id)row.launch={...launch};}
 for(const design of rows(state.designs))if(design&&typeof design==='object'&&design.id===state.selectedDesignId&&state.selectedGraph)design.graph=state.selectedGraph;
 const graphs=state.appearanceGraphs,appearances=state.appearances;
 if(!graphs||typeof graphs!=='object'||Array.isArray(graphs))return state;
 const attach=row=>{if(!row||typeof row!=='object')return;const a=row.appearance??(HEX.test(row.appearanceRef)&&appearances&&Object.hasOwn(appearances,row.appearanceRef)?appearances[row.appearanceRef]:null);if(a?.profile!=='BIO-LINE-APPEARANCE1'||a.version!==1||a.specimenKey!==(row.workId??row.id))return;const graph=a.graphKey===null?null:Object.hasOwn(graphs,a.graphKey)?graphs[a.graphKey]:undefined;if(a.graphKey!==null&&(typeof graph!=='string'||graph.length>10284))return;row.appearance={...a,...(graph!==null?{graph}:{})};};
 for(const row of rows(state.works))attach(row);for(const name of ['listings','products','bios','sellableWorks'])for(const row of rows(state.market?.[name]))attach(row);for(const row of rows(state.workLaunches))attach(row);return state;
}
