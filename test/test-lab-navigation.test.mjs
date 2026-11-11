import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Element,allText,flush} from './discovery-ui-fixture.mjs';
import {mountTestLab} from '../apps/player/dist/test-lab.js';

const id=n=>n.toString(16).padStart(64,'0');
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const panels=['overview','projects','build','production','assets','market','research'];
const routes={overview:'tl-nav-overview',projects:'tl-nav-projects',build:'tl-nav-build',production:'tl-nav-production',assets:'tl-nav-assets','market-material':'tl-market-material','market-product':'tl-market-product','market-bio':'tl-market-bio',research:'tl-nav-research'};
function reply(revision='0'){
  const listing=(category,n)=>({id:id(n),category,assetType:category==='MATERIAL'?'MATERIAL':'WORK',class:category==='MATERIAL'?1:null,quantity:category==='MATERIAL'?'1':null,workId:category==='MATERIAL'?null:id(20+n),scope:category==='MATERIAL'?null:category==='BIO'?'BIO':'CELL',name:`offer-${category}`,sellerName:'测试交易对手',priceLamports:'500000',status:'OPEN',isOwn:false,canBuy:true,canCancel:false,canTestSell:false});
  return{profile:'BIO-LOCAL-PLAYTEST1',mode:'LOCAL_PROTOCOL_MODEL',referenceModel:true,networkSubmitted:false,accountName:'体验账号 001',runId:id(1),revision,state:{profile:'BIO-PLAYTEST-SNAPSHOT1',mode:'LOCAL_PROTOCOL_MODEL',scope:{hostReferenceOnly:true,networkSubmitted:false},testHour:'338',materials:['30','60','15','15'].map((amount,i)=>({class:i+1,amount})),lab:{balanceAtoms:'48225840',unclaimedAtoms:'0',manufactureBurnedAtoms:'0'},testSOL:{balanceLamports:'9000000000'},counts:{live:1,consumed:0},selectedKitId:'kit-1',kits:[{id:'kit-1',name:'构造套装 1',stage:'PARTS',canConsume:true,bioId:null}],works:[{id:id(2),scope:'COMPONENT',name:'我的参考部件',quality:'1.000',staked:false,pending:false,exitEndHour:null}],ledger:[],nextActions:['buy-kit','manufacture-kit','synthesize-cells','synthesize-organs','synthesize-bio','stake','advance-hour','claim','exit'].map(action=>({action,label:action,enabled:true,reason:''})),lastResult:{action:'prepared-start',message:'就绪'},market:{profile:'BIO-HOST-MARKET1',testOnly:true,nativeExecutionVerified:false,counterparty:{simulated:true},listings:[listing('MATERIAL',11),listing('PRODUCT',12),listing('BIO',13)],sellableMaterials:[1,2,3,4].map(c=>({class:c,symbol:['AA','NUC','LIPID','SUGAR'][c-1],amount:'15',unitPriceLamports:'500000'})),sellableWorks:[]}}};
}
async function fixture(hash=''){
  const html=await readFile(new URL('../apps/player/dist/test-lab.html',import.meta.url),'utf8'),els=new Map(),hours=[],events=new Map();
  for(const [,tag,attrs]of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)){const e=new Element(tag),name=attrs.match(/\bid="([^"]+)"/)?.[1];if(name){e.id=name;els.set(name,e);}e.hidden=/\bhidden\b/.test(attrs);e.className=attrs.match(/\bclass="([^"]+)"/)?.[1]??'';if(attrs.includes('data-hours=')){e.dataset.hours=attrs.match(/data-hours="(\d+)"/)[1];hours.push(e);}}
  const win={location:{hash},history:{replaceState(_state,_unused,value){win.location.hash=value;}},addEventListener(key,fn){if(!events.has(key))events.set(key,new Set());events.get(key).add(fn);},removeEventListener(key,fn){events.get(key)?.delete(fn);}},document={getElementById:key=>els.get(key),createElement:tag=>new Element(tag),querySelectorAll:query=>query==='[data-hours]'?hours:[],defaultView:win};
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};let n=100;
  return{document,els,html,win,storage,random:()=>id(n++),hash(value){win.location.hash=value;for(const fn of events.get('hashchange')??[])fn();}};
}
const visible=f=>panels.filter(key=>!f.els.get('tl-view-'+key).hidden);
const flatten=e=>[e,...e.children.flatMap(flatten)];

test('deep links wait for account preparation, then show exactly their page without an automatic action',async()=>{
  const f=await fixture('#market-bio'),calls=[];let authenticated=false;
  const c=mountTestLab(f.document,{...f,fetchImpl:async(url,options)=>{calls.push({url,body:options.body});if(url.endsWith('/start'))authenticated=true;return response(authenticated?reply():{profile:'BIO-LOCAL-PLAYTEST1',authenticated:false});}});
  try{await flush();await flush();assert.equal(f.els.get('tl-welcome').hidden,false);assert.equal(f.els.get('tl-account').hidden,true);assert.deepEqual(visible(f),[]);assert.equal(c.route,'market-bio');assert.equal(calls.length,1);f.els.get('tl-start').click();await flush();await flush();assert.equal(f.els.get('tl-welcome').hidden,true);assert.deepEqual(visible(f),['market']);assert.match(allText(f.els.get('tl-market')),/offer-BIO/);assert.doesNotMatch(allText(f.els.get('tl-market')),/offer-PRODUCT/);assert.ok(!calls.some(x=>x.url.endsWith('/action')));
  }finally{c.close();}
});

test('all seven pages and three market hashes navigate read-only, preserve the selected kit and support history',async()=>{
  const f=await fixture(),calls=[];const c=mountTestLab(f.document,{...f,fetchImpl:async(url,options)=>{calls.push({url,body:options.body});return response(reply());}});
  try{await flush();await flush();assert.equal(c.route,'build');assert.equal(f.win.location.hash,'#build');assert.deepEqual(visible(f),['build']);for(const [route,element]of Object.entries(routes)){f.els.get(element).click();assert.equal(c.route,route);assert.equal(f.win.location.hash,'#'+route);assert.deepEqual(visible(f),[route.startsWith('market-')?'market':route]);assert.equal(f.els.get(element).attributes['aria-current'],'page');if(route.startsWith('market-')){const category=route.slice(7).toUpperCase();assert.match(allText(f.els.get('tl-market')),new RegExp(`offer-${category}`));}assert.equal(c.state.state.selectedKitId,'kit-1');}assert.equal(calls.length,1,'navigation must not fetch or mutate');f.hash('#assets');assert.deepEqual(visible(f),['assets']);f.hash('#build');assert.deepEqual(visible(f),['build']);assert.equal(flatten(f.els.get('tl-assets-works')).some(e=>e.tagName==='button'),false);assert.match(allText(f.els.get('tl-assets-works')),/我的参考部件/);assert.doesNotMatch(f.html,/<(?:input|textarea)\b/);assert.match(f.html,/href="\/#project"/);assert.match(f.html,/href="\/#research"/);for(const [,attrs]of f.html.matchAll(/<a\b([^>]*\bhref="\/(?:#[^"]*)?"[^>]*)>/g)){assert.match(attrs,/target="_blank"/);assert.match(attrs,/rel="noopener"/);}
  }finally{c.close();}const before=f.els.get('tl-page-title').textContent;f.hash('#overview');assert.equal(f.els.get('tl-page-title').textContent,before,'closed mounts remove their history listener');
});

test('navigation while a mutation is pending never cancels it, changes its request, or reopens the build page',async()=>{
  const f=await fixture('#build'),calls=[];let resolveAction;const c=mountTestLab(f.document,{...f,fetchImpl:async(url,options)=>{calls.push({url,body:options.body});if(url.endsWith('/action'))return new Promise(resolve=>resolveAction=resolve);return response(reply());}});
  try{await flush();await flush();const mutation=c.act('synthesize-cells',{kitId:'kit-1'}),saved=f.storage.getItem('biolab-local-test-pending-v1');assert.ok(saved);for(const element of ['tl-nav-projects','tl-nav-production','tl-nav-assets','tl-market-bio']){assert.equal(f.els.get(element).disabled,false);f.els.get(element).click();assert.equal(f.storage.getItem('biolab-local-test-pending-v1'),saved);assert.equal(c.state.state.selectedKitId,'kit-1');}assert.equal(calls.length,2);assert.equal(c.route,'market-bio');const after=reply('1');after.state.kits[0].stage='CELLS';after.state.lastResult={action:'synthesize-cells',kitId:'kit-1',message:'完成细胞'};resolveAction(response(after));await mutation;assert.equal(c.route,'market-bio');assert.deepEqual(visible(f),['market']);assert.equal(c.state.revision,'1');assert.equal(f.storage.getItem('biolab-local-test-pending-v1'),null);assert.equal(calls.length,2);
  }finally{c.close();}
});

test('unknown actions survive page switches and exact retry; project purchase binds the real buy-kit action',async()=>{
  const f=await fixture('#projects'),actions=[];let fail=true;const c=mountTestLab(f.document,{...f,fetchImpl:async(url,options)=>{if(url.endsWith('/action')){actions.push(JSON.parse(options.body));if(fail){fail=false;throw Error('lost acknowledgement');}return response(reply('1'));}return response(reply());}});
  try{await flush();await flush();f.els.get('tl-project-buy').click();await flush();await flush();assert.equal(actions.length,1);assert.equal(actions[0].action,'buy-kit');assert.deepEqual(actions[0].params,{});const saved=f.storage.getItem('biolab-local-test-pending-v1');assert.ok(saved);f.els.get('tl-nav-research').click();f.els.get('tl-market-product').click();f.els.get('tl-nav-assets').click();assert.equal(f.storage.getItem('biolab-local-test-pending-v1'),saved);assert.equal(f.els.get('tl-project-buy').disabled,true);assert.equal(f.els.get('tl-retry').hidden,false);f.els.get('tl-retry').click();await flush();await flush();assert.deepEqual(actions[1],actions[0]);assert.equal(c.route,'assets');assert.deepEqual(visible(f),['assets']);assert.equal(f.storage.getItem('biolab-local-test-pending-v1'),null);
  }finally{c.close();}
});
