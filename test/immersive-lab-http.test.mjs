import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {handleWorkbenchRequest} from '../apps/server/main.mjs';

async function request(url,encoding){
  const req=Readable.from([]);Object.assign(req,{method:'GET',url,socket:{localPort:4317},headers:{host:'localhost:4317',...(encoding===undefined?{}:{'accept-encoding':encoding})}});
  const result={};await handleWorkbenchRequest(req,{writeHead(status,headers){Object.assign(result,{status,headers});},end(bytes){result.bytes=Buffer.from(bytes);}});return result;
}
test('isolated lab routes load complete self-contained English UI and preserve original UI bytes',async()=>{
  const previous=JSON.parse(await readFile(new URL('../releases/production/source-manifest-20261026-sample-construction.json',import.meta.url)));
  for(const old of previous.sources.filter(s=>s.path.startsWith('apps/player/dist/'))){const bytes=await readFile(new URL('../'+old.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),old.sha256,old.path);}
  const page=await request('/lab');assert.equal(page.status,200);assert.match(page.headers['content-type'],/text\/html/);assert.match(page.headers['content-security-policy'],/script-src 'self'/);
  assert.match(page.bytes.toString(),/<html lang="en"/);assert.match(page.bytes.toString(),/\/test-lab#build/);assert.doesNotMatch(page.bytes.toString(),/[\u3400-\u9fff]/);
  assert.deepEqual((await request('/lab/')).bytes,page.bytes);
  for(const route of ['/lab.css','/lab.js','/lab-model.js','/lab-scene.js','/lab-scene-geometries.js','/lab-assets/three.module.js','/lab-assets/molecules.json','/lab-assets/sources.json','/lab-assets/THREE-LICENSE.txt']){const r=await request(route);assert.equal(r.status,200,route);assert.ok(r.bytes.length>0);assert.doesNotMatch(r.headers['content-type'],/undefined/);}
  for(const route of ['/lab-assets/.env','/lab-assets/three.module.js.gz','/lab-assets/molecules.json/private','/lab/not-a-route'])assert.equal((await request(route)).status,404,route);
});
test('gzip delivery is opt-in, byte-exact and honors explicit gzip refusal',async()=>{
  for(const route of ['/lab-assets/three.module.js','/lab-assets/molecules.json']){
    const raw=await request(route),zipped=await request(route,'br, gzip');assert.equal(zipped.headers['content-encoding'],'gzip');assert.equal(zipped.headers.vary,'Accept-Encoding');assert.deepEqual(gunzipSync(zipped.bytes),raw.bytes);assert.ok(zipped.bytes.length<raw.bytes.length/3);
    for(const encoding of ['br','gzip;q=0','gzip;q=0.000, *;q=1']){const r=await request(route,encoding);assert.equal(r.headers['content-encoding'],undefined);assert.deepEqual(r.bytes,raw.bytes);}
    assert.equal((await request(route,'*;q=1')).headers['content-encoding'],'gzip');
  }
});
