import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountLabDesigner} from '../apps/player/dist/lab-designer.js';
import {createReferenceGraph,encodeGraph,validateGraph} from '../packages/biology/src/index.mjs';
import {catalogHash} from '../packages/protocol-core/src/materials.mjs';
import {Element} from './discovery-ui-fixture.mjs';

const release=JSON.parse(await readFile(new URL('../releases/func2r2/manifest.json',import.meta.url),'utf8'));
const reference=()=>createReferenceGraph({domain:Buffer.alloc(32),config:Buffer.alloc(32),catalog:catalogHash(),rule:Buffer.from(release.ruleHash,'hex')});
const bytes=graph=>Buffer.from(encodeGraph(graph)),fixed=graph=>graph.edges.filter(edge=>edge.type>3),flatten=element=>[element,...element.children.flatMap(flatten)];
class TestElement extends Element{
  append(...children){super.append(...children);for(const child of children)child.parentElement=this;}
  dispatchEvent(event){const input={preventDefault(){},stopPropagation(){},...event,target:this};for(const listener of this.listeners[event.type]??[])listener(input);return true;}
}
function fixture(options={}){
  const document={createElement:tag=>new TestElement(tag),createElementNS:(_,tag)=>new TestElement(tag)},host=new TestElement('section');host.ownerDocument=document;
  const graph=reference(),changes=[],mounted=mountLabDesigner(host,{graph,onChange:value=>changes.push(value),...options});
  const all=()=>flatten(host),field=name=>all().find(element=>element.id?.endsWith(`-${name}`)),button=text=>all().find(element=>element.tagName==='button'&&element.textContent===text),text=()=>all().map(element=>element.textContent).join(' ');
  const input=(name,value)=>{const element=field(name);assert.ok(element,`field ${name}`);element.value=String(value);element.dispatchEvent({type:element.tagName==='select'?'change':'input'});return element;};
  const submit=name=>{const element=field(name);let parent=element.parentElement;while(parent&&parent.tagName!=='form')parent=parent.parentElement;assert.ok(parent,`form for ${name}`);parent.dispatchEvent({type:'submit'});};
  const flow=(peer,socket,allocation)=>{input('peer',peer);input('socket',socket);input('fraction',allocation);submit('fraction');};
  return {document,host,graph,changes,mounted,all,field,button,text,input,submit,flow};
}

test('English blueprint shows all 15 real cells and ports without changing the frozen source graph',()=>{
  const f=fixture(),before=bytes(f.graph);
  try{
    assert.equal(f.all().filter(element=>element.attributes['data-role']).length,15);
    assert.equal(f.field('scope').children.length,22);
    assert.equal(f.all().filter(element=>element.attributes['data-port']).length,32);
    assert.match(f.text(),/Blueprint editor/);assert.doesNotMatch(f.text(),/[\u3400-\u9fff]/);
    assert.ok(f.all().every(element=>element.tagName!=='style'&&element.tagName!=='script'&&element.attributes.style===undefined),'CSP-safe DOM does not inject inline styles or script');
    assert.deepEqual(bytes(f.mounted.getGraph()),before);assert.equal(f.changes.length,0);
    const copy=f.mounted.getGraph();copy.cells[0].v=0;assert.notEqual(f.mounted.getGraph().cells[0].v,0,'getGraph is defensive');
  }finally{f.mounted.dispose();}
});

test('capability edits produce a changed serializable graph while preserving fixed hierarchy and links',()=>{
  const f=fixture(),before=bytes(f.graph);
  try{
    f.input('capacity','70.1');f.submit('capacity');
    const changed=f.mounted.getGraph();assert.equal(changed.cells.find(cell=>cell.role===4).v,701000);validateGraph(changed);
    assert.notDeepEqual(bytes(changed),before);assert.deepEqual(bytes(f.graph),before);assert.deepEqual(fixed(changed),fixed(f.graph));assert.deepEqual(changed.nodes,f.graph.nodes);
    assert.equal(f.changes.length,1);f.changes[0].cells[0].v=0;assert.notEqual(f.mounted.getGraph().cells[0].v,0,'host callback receives a defensive clone');
    f.input('capacity','70.15');f.submit('capacity');assert.equal(f.changes.length,1);assert.match(f.text(),/Edit refused/);assert.doesNotMatch(f.text(),/EXPERIMENT PASSED/);
    f.input('role',3);assert.equal(f.field('capacity').disabled,true);assert.ok(f.button('Fixed by protocol').disabled);
  }finally{f.mounted.dispose();}
});

test('actual endpoint controls keep allocations exact and refuse overflow atomically',()=>{
  const f=fixture();
  try{
    f.flow(6,1,'25');f.flow(7,2,'75');const legal=f.mounted.getGraph();validateGraph(legal);
    assert.equal(legal.opens.find(open=>open.role===4&&open.species===1).remaining,0);
    assert.equal(legal.edges.find(edge=>edge.type===1&&edge.src.role===6&&edge.dst.role===4&&edge.dst.port===1).fraction,250000);
    assert.deepEqual(fixed(legal),fixed(f.graph));const before=bytes(legal),count=f.changes.length;
    f.flow(7,2,'75.0001');assert.deepEqual(bytes(f.mounted.getGraph()),before);assert.equal(f.changes.length,count);assert.match(f.text(),/Connection refused/);
    f.input('fraction','1e2');f.submit('fraction');assert.deepEqual(bytes(f.mounted.getGraph()),before);assert.match(f.text(),/at most four decimal places/);
  }finally{f.mounted.dispose();}
});

test('clicking legal SVG source and inlet ports adds a real canonical graph connection',()=>{
  const f=fixture();
  try{
    f.flow(6,1,'25');f.input('fraction','25');
    const clickPort=id=>{const element=f.all().find(item=>item.attributes['data-port']===id);assert.ok(element,id);element.click();};
    clickPort('7:source:0');clickPort('4:destination:1');
    const changed=f.mounted.getGraph();validateGraph(changed);
    const added=changed.edges.find(edge=>edge.type===1&&edge.src.role===7&&edge.dst.role===4&&edge.dst.port===1);
    assert.ok(added);assert.equal(added.fraction,250000);assert.equal(added.owner,22);
    assert.equal(changed.opens.find(open=>open.role===4&&open.species===1).remaining,0);assert.deepEqual(fixed(changed),fixed(f.graph));
  }finally{f.mounted.dispose();}
});

test('tier modes and occupied-slot swaps remain inside the fixed tree',()=>{
  const f=fixture();
  try{
    f.input('scope',18);const previous=f.graph.tiers.find(tier=>tier.scope===18).mode;f.button(`Mode ${previous?'A':'B'}`).click();
    assert.equal(f.mounted.getGraph().tiers.find(tier=>tier.scope===18).mode,1-previous);
    f.input('position',10);f.button('Swap cell positions').click();const changed=f.mounted.getGraph();validateGraph(changed);
    assert.equal(new Set(changed.slots.map(slot=>`${slot.x},${slot.y}`)).size,15);
    assert.deepEqual(changed.slots.find(slot=>slot.role===4),{...f.graph.slots.find(slot=>slot.role===10),role:4});assert.deepEqual(changed.nodes,f.graph.nodes);
  }finally{f.mounted.dispose();}
});

test('only validation of the exact current graph can display a passing experiment',async()=>{
  let resolve,received;const f=fixture({onValidate:graph=>{received=graph;return new Promise(done=>{resolve=done;});}});
  try{
    f.button('Run functional experiment').click();assert.match(f.text(),/Testing draft/);assert.deepEqual(bytes(received),bytes(f.graph));
    received.cells[0].v=0;assert.notEqual(f.mounted.getGraph().cells[0].v,0,'validation input is a clone');
    f.input('capacity','80');f.submit('capacity');resolve({status:'PASS'});await new Promise(done=>setImmediate(done));assert.doesNotMatch(f.text(),/EXPERIMENT PASSED/,'old graph PASS cannot certify a new graph');
    f.button('Run functional experiment').click();resolve({status:'PASS'});await new Promise(done=>setImmediate(done));assert.match(f.text(),/EXPERIMENT PASSED/);
    f.button('Run functional experiment').click();f.mounted.dispose();resolve({status:'PASS'});await new Promise(done=>setImmediate(done));assert.equal(f.host.children.length,0,'late validation cannot remount a disposed editor');
  }finally{f.mounted.dispose();}
});

test('setGraph checks the required graph shape and disposal removes the isolated editor',()=>{
  const f=fixture();
  const before=bytes(f.mounted.getGraph());assert.throws(()=>f.mounted.setGraph({...f.graph,slots:[]}),/LAB_DESIGNER_GRAPH/);assert.deepEqual(bytes(f.mounted.getGraph()),before);
  const next=structuredClone(f.graph);next.cells.find(cell=>cell.role===4).v=800000;assert.equal(f.mounted.setGraph(next),true);assert.deepEqual(bytes(f.mounted.getGraph()),bytes(next));
  f.mounted.dispose();f.mounted.dispose();assert.equal(f.host.children.length,0);assert.equal(f.mounted.setGraph(f.graph),false);
});
