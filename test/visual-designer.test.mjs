import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {percentToFraction,fractionToPercent,editDraft,mountVisualDesigner,checkDraftForEditor} from '../apps/player/dist/visual-designer.js';
import {createGraph,createReferenceGraph,encodeGraph,validateGraph,validateDesign} from '../packages/biology/src/index.mjs';
import {createOriginalityCoordinator} from '../packages/originality/src/index.mjs';
import {createPublishedC310Graph} from '../packages/biology/src/published-c310.mjs';
import {catalogHash} from '../packages/protocol-core/src/materials.mjs';
import {Element} from './discovery-ui-fixture.mjs';
const release=JSON.parse(await readFile(new URL('../releases/func2r2/manifest.json',import.meta.url),'utf8'));
const base={domain:Buffer.alloc(32),config:Buffer.alloc(32),catalog:catalogHash(),rule:Buffer.from(release.ruleHash,'hex')};
const refs=[...createOriginalityCoordinator({...base,rewardStart:86400n}).initialGraphs(),createPublishedC310Graph(base)];
const bytes=g=>Buffer.from(encodeGraph(g));
const fixed=g=>g.edges.filter(e=>e.type>3);
const action=(extra={})=>({kind:'flow',type:1,role:4,peer:6,socket:1,fraction:500000,...extra});

test('percentages preserve exact one-ppm lattice without floats or extra protocol units',()=>{
  for(const [text,n]of [['0',0],['0.0001',1],['0.1',1000],['12.3456',123456],['50',500000],['100.0000',1000000]]){assert.equal(percentToFraction(text),n);assert.equal(percentToFraction(fractionToPercent(n)),n);}
  for(const text of ['-1','+1','1e2','.5','00','01','100.0001','0.00001','Infinity','50%',' 1'])assert.throws(()=>percentToFraction(text));
});
test('all17 frozen public references retain exact initial bytes on no-op flow edits',()=>{
  for(const g of refs){const e=g.edges.find(e=>e.type===1&&e.dst.role===4),next=editDraft(g,action({peer:e.src.role,socket:e.dst.port,fraction:e.fraction}));validateGraph(next);assert.deepEqual(bytes(next),bytes(g));assert.deepEqual(fixed(next),fixed(g));assert.equal(next.domain.length,32);}
});
test('editable real endpoints derive authoritative canonical owner and open fractions',()=>{
  let g=createReferenceGraph({...base});const original=bytes(g);
  g=editDraft(g,action({fraction:250000}));assert.equal(g.opens.find(o=>o.role===4&&o.species===1).remaining,250000);
  g=editDraft(g,action({peer:7,socket:2,fraction:750000}));validateGraph(g);assert.equal(g.edges.find(e=>e.type===1&&e.dst.role===4&&e.dst.port===1).owner,22);assert.equal(g.opens.find(o=>o.role===4&&o.species===1).remaining,0);
  const expected=createGraph({...base,freeEdges:g.edges.filter(e=>e.type<=3),v:Object.fromEntries(g.cells.map(c=>[c.role,c.v])),tiers:Object.fromEntries(g.tiers.map(t=>[t.scope,t.mode])),slots:g.slots});assert.deepEqual(bytes(g),bytes(expected));assert.notDeepEqual(bytes(g),original);
  assert.throws(()=>validateDesign(g,{challenge:2000000,target:22}),e=>e.code==='PORT_CAP');
});
test('unfilled or overloaded edits cannot claim success or silently rebalance another connection',()=>{
  const g=createReferenceGraph({...base}),original=bytes(g),empty=editDraft(g,action({fraction:0}));assert.equal(empty.opens.find(o=>o.role===4&&o.species===1).remaining,500000);assert.throws(()=>validateGraph(empty),e=>e.code==='DEAD_INTERFACE');
  assert.deepEqual(bytes(editDraft(empty,action())),original);
  for(const a of [action({fraction:500001}),action({peer:1}),action({socket:3}),action({type:4}),action({fraction:-1}),action({fraction:1.1}),{kind:'tier',scope:23,mode:0},{kind:'tier',scope:4,mode:2},{kind:'capability',role:3,value:1000},{kind:'swap',role:4,peer:16}])assert.throws(()=>editDraft(g,a));assert.deepEqual(bytes(g),original);
});
test('oxygen and waste use their distinct fixed sockets and retain every fixed edge',()=>{
  const g=createReferenceGraph({...base});for(const e of g.edges.filter(e=>[2,3].includes(e.type))){const role=e.type===3?e.src.role:e.dst.role,peer=e.type===3?e.dst.role:e.src.role,socket=e.type===3?e.src.port-4:e.dst.port-2;const next=editDraft(g,{kind:'flow',type:e.type,role,peer,socket,fraction:e.fraction});assert.deepEqual(bytes(next),bytes(g));}
  assert.deepEqual(fixed(editDraft(g,{kind:'tier',scope:22,mode:1})),fixed(g));
});
test('layout swaps preserve15 unique occupied cells and tier changes stay within existing tree',()=>{
  const g=refs.at(-1),next=editDraft(g,{kind:'swap',role:4,peer:10});validateGraph(next);assert.equal(new Set(next.slots.map(s=>`${s.x},${s.y}`)).size,15);assert.deepEqual(next.edges,g.edges);assert.deepEqual(bytes(editDraft(next,{kind:'swap',role:10,peer:4})),bytes(g));
  const tier=editDraft(g,{kind:'tier',scope:18,mode:1-g.tiers.find(t=>t.scope===18).mode});validateGraph(tier);assert.equal(tier.tiers.filter((t,i)=>t.mode!==g.tiers[i].mode).length,1);
});
test('visual controls change only the local draft and report refused overflow atomically',()=>{
  let graph=createReferenceGraph({...base}),edits=0;const container=new Element('section');const document={getElementById:id=>id==='visual-designer'?container:null,createElement:tag=>new Element(tag)};
  const mounted=mountVisualDesigner(document,{getGraph:()=>graph,getSelectedRole:()=>4,onEdit:g=>{edits++;graph=g;}}),flatten=el=>[el,...el.children.flatMap(flatten)],findText=text=>flatten(container).find(e=>e.textContent===text),findId=id=>flatten(container).find(e=>e.id===id);
  findId('designer-percent').value='60';const form=flatten(container).find(e=>e.tagName==='form');for(const fn of form.listeners.submit)fn({preventDefault(){}});assert.equal(edits,0);assert.match(flatten(container).map(e=>e.textContent).join(' '),/总和不能超过/);
  findText('布局').click();const swap=flatten(container).find(e=>e.tagName==='button'&&e.textContent.startsWith('C10 '));swap.click();assert.equal(edits,1);validateGraph(graph);mounted.close();assert.equal(container.children.length,0);
});
test('malformed advanced metadata cannot replace an editable draft or crash tier controls',()=>{
  const g=refs.at(-1);for(const value of [{...g,tiers:undefined},{...g,tiers:[]},{...g,nodes:null},{...g,tiers:g.tiers.map(t=>({...t,scope:1}))},{...g,opens:[]},{...g,slots:g.slots.map(s=>({...s,x:0,y:0}))}])assert.throws(()=>checkDraftForEditor(value));assert.equal(checkDraftForEditor(g),g);
});
