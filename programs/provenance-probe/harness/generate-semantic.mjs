import { readdir,readFile,writeFile } from 'node:fs/promises';
import { decodeGraph } from '../../../packages/biology/src/graph.mjs';
import { designId } from '../../../packages/biology/src/canonical.mjs';
const directory=new URL('../../../fixtures/graphs/',import.meta.url),rows=[];
for(const file of (await readdir(directory)).filter(f=>f.endsWith('.bin')).sort())rows.push(`${file} ${designId(decodeGraph(await readFile(new URL(file,directory)))).toString('hex')}`);
rows.push(`MAX440 ${designId(decodeGraph(await readFile(new URL('../../biolab-kernel/harness/stress-maximum440.bin',import.meta.url)))).toString('hex')}`);
await writeFile(new URL('./expected-semantic.txt',import.meta.url),rows.join('\n')+'\n');
