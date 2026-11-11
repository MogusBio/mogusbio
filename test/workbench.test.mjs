import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleWorkbenchRequest } from '../apps/server/main.mjs';

async function request({ method='GET', url='/api/config', host='127.0.0.1:4317', origin, type='application/json', body='' }={}) {
  const bytes = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from([Buffer.from(bytes)]); req.method=method; req.url=url;
  req.socket={localPort:4317};req.headers={host,'content-type':type,...(origin===undefined?{}:{origin})};
  const result={};const res={writeHead(status,headers){result.status=status;result.headers=headers;},end(bytes){result.bytes=Buffer.from(bytes);}};
  await handleWorkbenchRequest(req,res);
  result.body=result.headers['content-type'].startsWith('application/json')?JSON.parse(result.bytes.toString()):null;
  return result;
}
test('workbench uses real fixed references and FUNC2 output, including support q1 and genuine failed food path',async()=>{
  const config=await request();assert.equal(config.status,200);assert.equal(config.body.references.length,17);assert.equal(config.body.productionAdmission,false);
  const graph=config.body.references.at(-1).graph;
  const pass=await request({method:'POST',url:'/api/validate',body:{graph,challenge:2000000,target:22}});
  assert.equal(pass.status,200);assert.equal(pass.body.steps,73);assert.equal(pass.body.q,'2000000');assert.equal(pass.body.cost,'310');
  assert.equal(config.body.publicOpening.requiredSeedCount,16);assert.equal(config.body.publicOpening.publishedKnownCount,17);assert.equal(config.body.references.at(-1).openingRole,'PUBLISHED_EXTRA');
  assert.equal(pass.body.isolatedDailyAtoms,'11301360');assert.equal(pass.body.productionAdmission,false);
  const support=await request({method:'POST',url:'/api/validate',body:{graph,challenge:2000000,target:3}});
  assert.equal(support.status,200);assert.equal(support.body.q,'1000000');
  const broken=structuredClone(graph);broken.cells.find(c=>c.role===4).v=0;
  const failed=await request({method:'POST',url:'/api/validate',body:{graph:broken,challenge:2000000,target:22}});
  assert.equal(failed.status,400);assert.equal(failed.body.status,'FAIL');assert.equal(failed.body.code,'PROCESSOR');
});
test('local API rejects DNS rebinding/cross-site, unknown fields, oversized or noncanonical graph input',async()=>{
  assert.equal((await request({host:'attacker.example:4317'})).status,403);
  assert.equal((await request({url:'//attacker.example/api/config'})).status,400);
  assert.equal((await request({method:'POST',url:'/api/validate',origin:'https://attacker.example'})).status,403);
  assert.equal((await request({method:'POST',url:'/api/validate',type:'text/plain'})).status,415);
  const graph=(await request()).body.references.at(-1).graph;
  for(const body of [{graph,challenge:2000000,paid:true},{graph:{...graph,credit:Infinity},challenge:2000000},
    {graph,challenge:2000001},'x'.repeat(100001)]){
    assert.equal((await request({method:'POST',url:'/api/validate',body})).status,400);
  }
  const file=await request({url:'/'});assert.equal(file.status,200);assert.match(file.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal((await request({url:'/.env'})).status,404);assert.equal((await request({url:'/api/economy'})).status,200);
});
test('player shell, visual editor and mainstream wallet catalog load only through explicit static routes',async()=>{
  for(const [url,marker]of [['/player-shell.js','mountPlayerShell'],['/visual-designer.js','mountVisualDesigner'],['/wallet-catalog.js','SOLANA_WALLET_CHOICES'],['/asset-handoff.js','handoff'],['/app-state.js','export'],['/player-routing.js','mountPlayerRoutes'],['/market-panel.js','mountMarketPanels']]){const r=await request({url});assert.equal(r.status,200,url);assert.match(r.headers['content-type'],/javascript/);assert.ok(r.bytes.toString().includes(marker),url);}
  const navigation=await request({url:'/player-navigation.css'});assert.equal(navigation.status,200);assert.match(navigation.headers['content-type'],/text\/css/);assert.equal((await request({url:'/offline-discovery-wallet.js'})).status,404);
  assert.equal((await request({url:'/offline-discovery-wallet-config'})).status,404);
});
