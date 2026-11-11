// Explicit resource-only data, not admitted Roots. The host-only test injects
// verifier state to measure the real native handler at catalog bounds. It never
// finalizes, mints a Root, burns/claims tokens, or treats this as full admission.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=b=>createHash('sha256').update(b).digest();
const reference=await readFile(new URL('../../evidence/native-cell-payload.bin',import.meta.url));
const graph=await readFile(new URL('../../../biolab-kernel/harness/positive-scope-22.bin',import.meta.url));graph.set(reference.subarray(36,164),16);
for(const variant of ['rows','blob']){
 const raw=await readFile(new URL(`../../../provenance-probe/harness/maximum-${variant}.bin`,import.meta.url));const caps=[];let at=1;for(let i=0;i<60;i++){const len=raw.readUInt16LE(at);at+=2;caps.push(raw.subarray(at,at+len));at+=len;}if(at!==raw.length)throw Error('tail');
 const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};const direct=[];
 for(let i=0;i<6;i++){const b=Buffer.alloc(74);b[0]=16+i;b.fill(0xa0+i,2,34);b.fill(0xb0+i,42,74);direct.push(b);}
 const leaves=caps.map((c,i)=>{const b=Buffer.alloc(70),role=Math.floor(i/4)+1,p=i%4+1;b.set([role,p,1,0,p,p===4?role:0]);b.fill(0xf0,6,38);b[37]=i;b.set(digest(c),38);return b;});
 const body=Buffer.concat([u32(graph.length),graph,Buffer.from([6]),...direct,Buffer.from([60]),...leaves,Buffer.from([60]),...caps.flatMap(c=>[u32(c.length),c])]);const header=Buffer.alloc(16);header.write('BIOP7D01');header.writeUInt16LE(1,8);header[10]=22;header.writeUInt32LE(body.length,12);const full=Buffer.concat([header,body]);await writeFile(new URL(`../native-bounds-${variant}.bin`,import.meta.url),full);console.log({variant,len:full.length,sha:digest(full).toString('hex')});
}
