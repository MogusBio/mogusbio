// Synthetic stream stress only: no real Source/Root or manufacturing claim.
import { writeFile } from 'node:fs/promises';
import { encodeDebitPlan, F1_BOM, F1_EFFECTIVE_SPECIES } from '../../../packages/protocol-core/src/materials.mjs';
import { validateSourceUnion } from '../../../packages/composition/src/payload.mjs';
for(const variant of ['rows','blob']){
 const leaves=[],parts=[Buffer.from([60])];
 for(let leaf=0;leaf<60;leaf++){
  const tables=new Map();
  for(let s=1;s<=32;s++){
   if(F1_BOM[s-1]===0n)continue;
   const klass=s<=20?1:s<=28?2:s<=31?3:4;
   const splits=variant==='rows'?(s===25||s===32?1:s<=18?5:4):(klass===1?4:klass===3?4:5);
   const groupCount=variant==='rows'?(klass===1?5:klass===4?1:4):(klass<=2?10:5);
   const start=variant==='rows'?0:klass===1?s-1:klass===2?(s-21)*2:klass===3?s-29:0;
   for(let j=0;j<splits;j++){
    const group=(start+j)%groupCount,key=`${klass}:${group}`;
    let row=tables.get(key);if(!row){const sourceId=Buffer.alloc(32);sourceId[0]=klass;sourceId[1]=group+1;row={sourceId,entries:[]};tables.set(key,row);}
    const base=F1_BOM[s-1]/BigInt(splits),extra=F1_BOM[s-1]%BigInt(splits);
    row.entries.push({species:s,expectedPrefix:10_000n+BigInt(leaf)*1000n,takeTick:base+(BigInt(j)<extra?1n:0n)});
   }
  }
  const groups=[...tables.values()].sort((a,b)=>Buffer.compare(a.sourceId,b.sourceId));groups.forEach(g=>g.entries.sort((a,b)=>a.species-b.species));
  const rows=groups.flatMap(g=>g.entries.map(e=>({sourceId:g.sourceId,species:e.species,lo:e.expectedPrefix,hi:e.expectedPrefix+e.takeTick})));
  if(rows.length!==(variant==='rows'?128:122))throw Error(`rows ${rows.length}`);
  const cap=Buffer.concat([Buffer.alloc(322),encodeDebitPlan(groups)]);if(variant==='blob'&&cap.length!==3358)throw Error(`blob ${cap.length}`);
  const len=Buffer.alloc(2);len.writeUInt16LE(cap.length);parts.push(len,cap);
  leaves.push({effective:rows.filter(r=>F1_EFFECTIVE_SPECIES.includes(r.species)),retired:rows.filter(r=>!F1_EFFECTIVE_SPECIES.includes(r.species))});
 }
 const union=validateSourceUnion(leaves),digest=union.effectiveUnionSHA.toString('hex'),rows=variant==='rows'?7680:7320;
 await writeFile(new URL(`./maximum-${variant}.bin`,import.meta.url),Buffer.concat(parts));
 await writeFile(new URL(`./expected-${variant}.txt`,import.meta.url),`${digest}\n${union.effective.length}\n${4+50*union.effective.length}\n${rows}\n`);
 console.log({variant,rows,segments:union.effective.length,bytes:Buffer.concat(parts).length,digest});
}
