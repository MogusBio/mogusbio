import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../apps/player/dist/player-navigation.css',import.meta.url),'utf8');
const oldViews=['builder','flow','economy','native','guided','project','manufacture','synthesis','mining','research','directory','wallet-discovery'];
const markets=['market-material','market-product','market-bio'];
const nav=html.match(/<nav aria-label="工作区">([\s\S]*?)<\/nav>/)?.[1];
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));

test('seven main groups retain each old route once and add three distinct same-document market routes',()=>{
  assert.ok(nav);const groups=[...nav.matchAll(/<(?:div|details)\b[^>]*\bdata-nav-group="([^"]+)"[^>]*>/g)];
  assert.deepEqual(groups.map(m=>m[1]),['economy','projects','workshop','mining','assets','market','research']);
  for(const m of groups){assert.doesNotMatch(m[0],/\bdata-view=/);assert.ok(!attrs(m[0]).class.split(/\s+/).includes('nav-item'));}
  const routes=[...nav.matchAll(/\bdata-view="([^"]+)"/g)].map(m=>m[1]);assert.equal(routes.length,15);assert.equal(new Set(routes).size,15);
  assert.deepEqual(new Set(routes),new Set([...oldViews,...markets]));
  for(const view of routes){assert.equal([...html.matchAll(new RegExp(`\\bid="${view}-view"`,'g'))].length,1);}
});

test('group summaries only expand; business buttons remain original leaf routes without hard navigation',()=>{
  const summaries=[...nav.matchAll(/<summary\b[^>]*>[\s\S]*?<\/summary>/g)];assert.equal(summaries.length,4);
  for(const [name,id]of [['实验室项目','projects'],['生物工坊','workshop'],['交易市场','market']]){assert.match(nav,new RegExp(`<details[^>]*id="player-nav-${id}"[^>]*>[\\s\\S]*?<summary>`));assert.ok(summaries.some(m=>m[0].includes(name)));}
  for(const [summary]of summaries)assert.doesNotMatch(summary,/\b(?:data-view|onclick|href)=|\bnav-item\b/);
  assert.match(nav,/<details[^>]*id="player-nav-workshop"[^>]*\bopen>/);
  assert.doesNotMatch(nav,/<a\b|\bonclick=/);
  for(const [tag]of nav.matchAll(/<button\b[^>]*\bdata-view="[^"]+"[^>]*>/g))assert.equal(attrs(tag).type,'button');
});

test('help and precise tools stay in the bottom disclosure, and first issuance is not labeled the raw resale market',()=>{
  const tools=nav.match(/<details[^>]*id="player-nav-more"[^>]*>([\s\S]*?)<\/details>/)?.[1];assert.ok(tools);
  assert.deepEqual([...tools.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),['flow','guided','native']);
  assert.match(tools,/<summary>说明与高级工具<\/summary>/);
  const directory=nav.match(/<button[^>]*data-view="directory"[^>]*>([\s\S]*?)<\/button>/)[1];assert.match(directory,/浏览与购料/);assert.doesNotMatch(directory,/市场/);
  assert.match(html,/<h1 id="directory-heading">实验室项目/);assert.match(html,/<h1 id="wallet-discovery-heading">我的资产/);
  assert.match(nav,/data-view="mining"[^>]*>[\s\S]*?生物能<\/button>/);
});

test('three market panels have separate categories and hide all local-test links by default',()=>{
  const expected={material:['AA','NUC','LIPID','SUGAR'],product:['部件','细胞','器官'],bio:['完整生物']};
  for(const [kind,terms]of Object.entries(expected)){
    const id=`market-${kind}`,panel=html.match(new RegExp(`<section id="${id}-view"[^>]*>([\\s\\S]*?)<\\/section>`));assert.ok(panel,id);assert.match(panel[0],/^<section[^>]*\bhidden\b/);
    for(const term of terms)assert.ok(panel[1].includes(term),`${id}: ${term}`);
    assert.match(panel[1],/正式市场尚未开放/);assert.match(panel[1],new RegExp(`id="${id}-mode"[^>]*role="status"`));
    const a=panel[1].match(new RegExp(`<a\\b[^>]*id="${id}-test-link"[^>]*>`))?.[0];assert.ok(a);const v=attrs(a);assert.equal(v.href,`/test-lab#${id}`);assert.equal(v.target,'_blank');assert.ok(v.rel.split(/\s+/).includes('noopener'));assert.match(a,/\bhidden\b/);
    assert.doesNotMatch(panel[1],/<(?:input|form|textarea)\b|\bonclick=/);
  }
  const assets=html.match(/<a\b[^>]*id="player-test-assets-link"[^>]*>/)?.[0];assert.ok(assets);assert.equal(attrs(assets).href,'/test-lab#assets');assert.equal(attrs(assets).target,'_blank');assert.equal(attrs(assets).rel,'noopener');assert.match(assets,/\bhidden\b/);
});

test('business field IDs remain unique and final routing loads after the original controllers',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  for(const id of ['guided-actor','manufacture-projects','manufacture-sources','synthesis-direct','synthesis-graph-hex','synthesis-workflow-id','native-intent','graph-json','visual-designer'])assert.equal(ids.filter(v=>v===id).length,1);
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1]);assert.ok(scripts.indexOf('/player-routing.js')>scripts.indexOf('/player-shell.js'));assert.ok(scripts.indexOf('/market-panel.js')>scripts.indexOf('/player-routing.js'));
  assert.match(html,/<link rel="stylesheet" href="\/player-navigation\.css">/);
});

test('group styling stays accessible on narrow screens and retains a visible current parent',()=>{
  assert.match(css,/\.player-nav-section>summary:focus-visible/);assert.match(css,/:has\(\.nav-item\.active\)>summary/);
  const mobile=css.slice(css.indexOf('@media(max-width:620px)'));
  assert.match(mobile,/\.sidebar \.player-nav-primary\{[^}]*display:flex;[^}]*flex-wrap:nowrap;[^}]*overflow:auto;/);
  assert.match(mobile,/\.player-nav-section\{[^}]*flex:0 0 auto;/);
  assert.doesNotMatch(css,/\.view\s*\{|#(?:graph|result|native|manufacture|synthesis)/);
});
