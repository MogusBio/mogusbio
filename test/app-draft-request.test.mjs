import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {handleWorkbenchRequest} from '../apps/server/main.mjs';
import {createExperimentRunner} from '../apps/player/dist/app-state.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function localApi(url,options={}){const req=Readable.from([Buffer.from(options.body??'')]);req.method=options.method??'GET';req.url=url;req.socket={localPort:4317};req.headers={host:'127.0.0.1:4317','content-type':'application/json'};let response;const res={writeHead(status,headers){response={status,headers};},end(body){response.body=Buffer.from(body);}};await handleWorkbenchRequest(req,res);return new Response(response.body,{status:response.status,headers:response.headers});}

class Element{
  constructor(tag,document){this.tagName=tag;this.document=document;this.children=[];this.listeners={};this.dataset={};this.attributes={};this.className='';this.hidden=false;this.disabled=false;this.textContent='';this._value='';this.classList={toggle:(name,on)=>{const set=new Set(this.className.split(' ').filter(Boolean));on?set.add(name):set.delete(name);this.className=[...set].join(' ');}};}
  set id(value){this._id=value;this.document?.els.set(value,this);}get id(){return this._id;}
  get value(){return this._value;}set value(value){const v=String(value);this._value=this.tagName==='select'&&!this.options.some(o=>o.value===v)?'':v;}
  get options(){return this.children.filter(c=>c.tagName==='option');}
  append(...children){this.children.push(...children);if(this.tagName==='select'&&this._value==='')this._value=this.options[0]?.value??'';}
  replaceChildren(...children){this.children=[];this.append(...children);}
  set innerHTML(value){this._html=value;this.children=[];}get innerHTML(){return this._html??'';}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  dispatchEvent(event){for(const fn of this.listeners[event.type]??[])fn({type:event.type,target:this,preventDefault(){}});return true;}
  click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  setAttribute(name,value){this.attributes[name]=value;}
  after(node){this.document.loose.push(node);}
  querySelector(){return this.subnode??=new Element('span',this.document);}
  scrollIntoView(){}focus(){}
}
async function appFixture(validate=localApi){
  const html=await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8'),doc={els:new Map(),nav:[],loose:[]};
  doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=value=>{const e=doc.createElement('#text');e.textContent=value;return e;};doc.getElementById=id=>doc.els.get(id);
  doc.querySelectorAll=selector=>selector==='.nav-item'?doc.nav:[];doc.querySelector=selector=>selector.includes('data-view=')?doc.nav.find(n=>n.dataset.view===selector.match(/data-view=["']([^"']+)/)?.[1]):null;
  for(const [,tag,attrs]of html.matchAll(/<([a-z-]+)\b([^>]*)>/g)){const el=doc.createElement(tag),id=attrs.match(/\bid="([^"]+)"/)?.[1];if(id)el.id=id;el.className=attrs.match(/\bclass="([^"]+)"/)?.[1]??'';el.disabled=/\bdisabled\b/.test(attrs);el.hidden=/\bhidden\b/.test(attrs);el._value=attrs.match(/\bvalue="([^"]*)"/)?.[1]??'';const view=attrs.match(/\bdata-view="([^"]+)"/)?.[1];if(view){el.dataset.view=view;doc.nav.push(el);}}
  for(const [,attrs,body]of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){const id=attrs.match(/\bid="([^"]+)"/)?.[1],select=doc.els.get(id);if(!select)continue;for(const [,oa,text]of body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)){const o=doc.createElement('option');o.value=oa.match(/\bvalue="([^"]*)"/)?.[1]??text;o.textContent=text;select.append(o);if(/\bselected\b/.test(oa))select.value=o.value;}}
  let calls=0;const oldDocument=globalThis.document,oldFetch=globalThis.fetch;globalThis.document=doc;globalThis.fetch=async(url,options)=>url==='/api/validate'?(calls++,validate(url,options)):localApi(url,options);
  await import(`../apps/player/dist/app.js?draft-test=${Math.random()}`);
  const flatten=el=>[el,...el.children.flatMap(flatten)],el=id=>doc.els.get(id),clickText=text=>{const b=flatten(el('visual-designer')).find(n=>n.tagName==='button'&&n.textContent===text);assert.ok(b,text);b.click();};
  return{doc,el,clickText,get calls(){return calls;},async input(id,value){el(id).value=value;el(id).dispatchEvent(new Event('input'));await tick();},async click(id){el(id).click();await tick();},async settle(){for(let i=0;i<10;i++)await tick();},close(){globalThis.document=oldDocument;globalThis.fetch=oldFetch;}};
}

test('experiment transport times out even when a provider ignores AbortSignal, then retries',async()=>{
  let calls=0,resolve;const runner=createExperimentRunner({timeoutMs:10,fetchImpl:()=>++calls===1?new Promise(r=>resolve=r):Promise.resolve(new Response('{"status":"PASS"}',{headers:{'content-type':'application/json'}}))});
  const expired=await runner.run({graph:{},challenge:2000000,target:22});assert.equal(expired.decision,'TIMEOUT');assert.equal(runner.busy,false);assert.equal((await runner.run({graph:{}})).decision,'RESULT');resolve(new Response('{"status":"PASS"}'));await tick();assert.equal(runner.busy,false);
});
test('experiment body reads are bounded and cancellation never returns a stale PASS',async()=>{
  let resolve;const runner=createExperimentRunner({timeoutMs:100,fetchImpl:()=>new Promise(r=>resolve=r)}),pending=runner.run({graph:{}});runner.cancel();resolve(new Response('{"status":"PASS"}',{headers:{'content-type':'application/json'}}));assert.equal((await pending).decision,'STALE');assert.equal(runner.busy,false);
  const tooLarge=createExperimentRunner({maxResponseBytes:10,fetchImpl:async()=>new Response(JSON.stringify({data:'x'.repeat(100)}),{headers:{'content-type':'application/json'}})});assert.equal((await tooLarge.run({})).decision,'ERROR');
});
test('real app preserves unapplied JSON across capability, flow, layout and tier edits until explicit discard',async()=>{
  const f=await appFixture();try{const original=f.el('graph-json').value,draft=JSON.parse(original);draft.cells.find(c=>c.role===4).v=500000;const text=JSON.stringify(draft,null,2);await f.input('graph-json',text);await f.input('capability','500000');assert.equal(f.el('graph-json').value,text);assert.equal(f.el('capability').value,'1000000');
    const form=f.el('designer-percent').document.els.get('visual-designer').children[0].children.find(c=>c.tagName==='form');assert.ok(form);f.el('designer-percent').value='25';form.dispatchEvent(new Event('submit'));assert.equal(f.el('graph-json').value,text);
    f.clickText('布局');f.clickText('C10 运动执行');assert.equal(f.el('graph-json').value,text);f.clickText('层级模式');f.clickText('模式 B');assert.equal(f.el('graph-json').value,text);
    await f.click('discard-json-draft');assert.equal(f.el('graph-json').value,original);assert.equal(f.el('discard-json-draft').disabled,true);assert.equal(f.calls,0);
  }finally{f.close();}
});
test('real app navigation cancels a hung experiment, preserves graph and ignores late PASS',async()=>{
  let resolve,signal;const f=await appFixture((_url,options)=>{signal=options.signal;return new Promise(r=>resolve=r);});try{const graph=f.el('graph-json').value;await f.click('validate');assert.equal(f.el('validate').disabled,true);f.doc.nav.find(n=>n.dataset.view==='directory').click();await f.settle();assert.equal(signal.aborted,true);assert.equal(f.el('validate').disabled,false);assert.equal(f.el('graph-json').value,graph);resolve(new Response('{"status":"PASS"}',{headers:{'content-type':'application/json'}}));await f.settle();assert.notEqual(f.el('result-status').textContent,'PASS · 73/73');assert.equal(f.el('result').hidden,true);
  }finally{f.close();}
});
test('real app PASS handoff opens synthesis plan and removes stale encoded graph without executing a chain action',async()=>{
  const f=await appFixture();try{let plan=0,nav=0;f.el('synthesis-tab-plan').addEventListener('click',()=>plan++);f.doc.nav.find(n=>n.dataset.view==='synthesis').addEventListener('click',()=>nav++);f.el('synthesis-graph-hex').value='old-encoding';await f.click('validate');await f.settle();assert.equal(f.el('result-status').textContent,'PASS · 73/73');const next=f.el('result').children.find(n=>n.tagName==='button');assert.ok(next);next.click();assert.equal(plan,1);assert.equal(nav,1);assert.equal(f.el('synthesis-target').value,'22');assert.equal(f.el('synthesis-graph-hex').value,'');assert.equal(f.calls,1);
  }finally{f.close();}
});
test('rerunning the same graph clears an old PASS handoff until the new experiment completes',async()=>{
  let count=0,resolve;const f=await appFixture((url,options)=>++count===1?localApi(url,options):new Promise(r=>resolve=r));try{let navigations=0;f.doc.nav.find(n=>n.dataset.view==='synthesis').addEventListener('click',()=>navigations++);await f.click('validate');await f.settle();const old=f.el('result').children.find(n=>n.tagName==='button');assert.ok(old);await f.click('validate');assert.equal(f.el('result').hidden,true);assert.equal(f.el('result').children.length,0);old.click();assert.equal(navigations,0);f.doc.nav.find(n=>n.dataset.view==='directory').click();resolve(new Response('{"status":"PASS"}',{headers:{'content-type':'application/json'}}));await f.settle();assert.notEqual(f.el('result-status').textContent,'PASS · 73/73');
  }finally{f.close();}
});
