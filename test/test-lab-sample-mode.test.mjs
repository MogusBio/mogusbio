import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Element,allText,flush} from './discovery-ui-fixture.mjs';
import {mountTestLab} from '../apps/player/dist/test-lab.js';

const id=n=>n.toString(16).padStart(64,'0');
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const actions=['buy-kit','manufacture-kit','synthesize-cells','synthesize-organs','synthesize-bio','stake','advance-hour','claim','exit'];
const constructionActions=actions.slice(0,5);
function reply(selectedKitId='kit-3',revision='0'){
  return{profile:'BIO-LOCAL-PLAYTEST1',mode:'LOCAL_PROTOCOL_MODEL',referenceModel:true,networkSubmitted:false,accountName:'体验账号 001',runId:id(1),revision,state:{profile:'BIO-PLAYTEST-SNAPSHOT1',mode:'LOCAL_PROTOCOL_MODEL',scope:{hostReferenceOnly:true,networkSubmitted:false},testHour:'340',materials:['30','60','15','15'].map((amount,i)=>({class:i+1,amount})),lab:{balanceAtoms:'48225840',unclaimedAtoms:'0',manufactureBurnedAtoms:'48000000'},testSOL:{balanceLamports:'9000000000'},counts:{live:2,consumed:81},selectedKitId,kits:[{id:'kit-1',name:'构造套装 1',stage:'PARTS',canConsume:true,upgradeCostAtoms:'12000000',availableInputCount:60,requiredInputCount:60,bioId:null},{id:'kit-2',name:'构造套装 2',stage:'RAW',canConsume:false,canManufacture:true,upgradeCostAtoms:'0',bioId:null},{id:'kit-3',name:'构造套装 3',stage:'BIO',canConsume:true,upgradeCostAtoms:'0',bioId:id(103)}],works:[{id:id(101),scope:'COMPONENT',name:'参考部件',quality:'1.000',staked:false,pending:false,exitEndHour:null},{id:id(103),scope:'BIO',name:'完整生物 C310',quality:'2.000',staked:false,pending:false,exitEndHour:null}],ledger:constructionActions.map((action,i)=>({action,message:'另一套样本的历史步骤',testHour:String(338+i),labAfterAtoms:'48225840',materialAfter:['30','60','15','15']})),nextActions:actions.map(action=>({action,label:action,enabled:true,reason:'',...(action.startsWith('synthesize-')?{costAtoms:'99000000'}:{})})),lastResult:{action:'synthesize-bio',kitId:selectedKitId,message:'另一套样本已完成'}}};
}
async function fixture(){
  const html=await readFile(new URL('../apps/player/dist/test-lab.html',import.meta.url),'utf8'),els=new Map(),hours=[];
  for(const [,tag,attrs]of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)){const e=new Element(tag),key=attrs.match(/\bid="([^"]+)"/)?.[1];if(key){e.id=key;els.set(key,e);}e.className=attrs.match(/\bclass="([^"]+)"/)?.[1]??'';e.hidden=/\bhidden\b/.test(attrs);for(const [,name,value]of attrs.matchAll(/([a-z-]+)="([^"]*)"/g))e.setAttribute(name,value);if(attrs.includes('data-hours=')){e.dataset.hours=attrs.match(/data-hours="(\d+)"/)[1];hours.push(e);}}
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};let n=500;
  const document={getElementById:key=>els.get(key),createElement:tag=>new Element(tag),querySelectorAll:query=>query==='[data-hours]'?hours:[],defaultView:{}};
  return{html,els,storage,document,random:()=>id(n++)};
}
const flatten=e=>[e,...e.children.flatMap(flatten)];
function selectKit(f,name){const button=f.els.get('tl-kits').children.find(e=>e.textContent===name);assert.ok(button);button.click();}
function stepStatuses(f){const steps=f.els.get('tl-steps').children;assert.deepEqual(steps.map(e=>e.dataset.action??e.attributes['data-action']),constructionActions);return steps.map(e=>e.dataset.status??e.attributes['data-status']);}

test('sample progress belongs to the selected kit rather than a different completed kit or global ledger',async()=>{
  const f=await fixture(),calls=[];const c=mountTestLab(f.document,{...f,fetchImpl:async(url,options)=>{calls.push({url,body:options.body});return response(reply());}});
  try{await flush();await flush();assert.deepEqual(stepStatuses(f),['past','past','past','past','current']);selectKit(f,'构造套装 1');assert.deepEqual(stepStatuses(f),['past','current','future','future','future']);assert.doesNotMatch(allText(f.els.get('tl-steps')),/已体验/);assert.match(allText(f.els.get('tl-next')),/按样本批量合成15个细胞/);selectKit(f,'构造套装 2');assert.deepEqual(stepStatuses(f),['current','future','future','future','future']);assert.match(allText(f.els.get('tl-next')),/按样本批量制造60个部件/);assert.equal(calls.length,1,'selecting a kit only renders existing state');assert.equal(f.storage.getItem('biolab-local-test-pending-v1'),null);assert.ok(f.els.has('tl-sample-mode'));assert.match(f.html,/C310/);assert.match(f.html,/公开(?:参考)?样本/);assert.match(f.html,/批量(?:体验|执行)/);
  }finally{c.close();}
});

test('the displayed batch quote uses selected actual kit cost, distinguishes RAW and BIO, and never substitutes a global quote',async()=>{
  const f=await fixture();let value=reply('kit-1');const c=mountTestLab(f.document,{...f,fetchImpl:async()=>response(value)});
  try{await flush();await flush();const cost=()=>allText(f.els.get('tl-sample-cost'));assert.match(cost(),/60个样本部件/);assert.match(cost(),/15个功能细胞/);assert.match(cost(),/12\s*测试\s*LAB/);assert.doesNotMatch(cost(),/99\s*测试\s*LAB/);selectKit(f,'构造套装 2');assert.match(cost(),/60个样本部件/);assert.match(cost(),/不收\s*LAB\s*制造费/);selectKit(f,'构造套装 3');assert.match(cost(),/生物阶段/);assert.doesNotMatch(cost(),/(?:12|24|99)\s*测试\s*LAB/);selectKit(f,'构造套装 1');delete value.state.kits[0].upgradeCostAtoms;value.state.lastResult={action:'read',message:'缺少本套装报价'};await c.refresh();assert.match(cost(),/待核对/);assert.doesNotMatch(cost(),/99\s*测试\s*LAB/);
  }finally{c.close();}
});

test('sample links and selection are read-only; one batch click keeps the exact action and kit through UNKNOWN retry',async()=>{
  const f=await fixture(),calls=[],sent=[];let fail=true;const c=mountTestLab(f.document,{...f,fetchImpl:async(url,options)=>{calls.push(url);if(url.endsWith('/action')){const body=JSON.parse(options.body);sent.push(body);if(fail){fail=false;throw Error('lost acknowledgement');}const next=reply('kit-1','1');next.state.kits[0].stage='CELLS';next.state.kits[0].upgradeCostAtoms='24000000';next.state.lastResult={action:'synthesize-cells',kitId:'kit-1',message:'按样本完成细胞批次'};return response(next);}return response(reply());}});
  try{await flush();await flush();const links={'tl-design-experiment-link':'/#builder','tl-single-manufacture-link':'/#manufacture','tl-single-synthesis-link':'/#synthesis'};for(const [key,href]of Object.entries(links)){const link=f.els.get(key);assert.ok(link);assert.equal(link.attributes.href,href);assert.equal(link.attributes.target,'_blank');assert.equal(link.attributes.rel,'noopener');link.click();}selectKit(f,'构造套装 2');selectKit(f,'构造套装 1');assert.equal(calls.length,1);assert.match(f.html,/独立|不会自动/);const batch=flatten(f.els.get('tl-next')).find(e=>e.tagName==='button'&&e.textContent==='按样本批量合成15个细胞');assert.ok(batch);batch.click();batch.click();await flush();await flush();assert.equal(sent.length,1);assert.equal(sent[0].action,'synthesize-cells');assert.deepEqual(sent[0].params,{kitId:'kit-1'});const pending=f.storage.getItem('biolab-local-test-pending-v1');assert.ok(pending);f.els.get('tl-nav-assets').click();assert.equal(f.storage.getItem('biolab-local-test-pending-v1'),pending);f.els.get('tl-retry').click();await flush();await flush();assert.equal(sent.length,2);assert.deepEqual(sent[1],sent[0]);assert.equal(c.state.revision,'1');assert.equal(c.route,'assets');assert.equal(f.storage.getItem('biolab-local-test-pending-v1'),null);assert.equal(calls.filter(url=>url.endsWith('/state')).length,1);assert.ok(!calls.some(url=>url.endsWith('/reset')));
  }finally{c.close();}
});
