import test from 'node:test';
import assert from 'node:assert/strict';
import {Element,allText,flush} from './discovery-ui-fixture.mjs';
import {labUI} from '../apps/player/dist/lab-ui.js';
import {renderMarket,filterSortMarketListings} from '../apps/player/dist/lab-panels-market.js';
import {createSpecimenArt,specimenArtKind} from '../apps/player/dist/lab-specimen-art.js';

const id=n=>n.toString(16).padStart(64,'0'),PROJECT=id(100),flatten=e=>[e,...e.children.flatMap(flatten)];
const material=(n,extra={})=>({id:id(n),category:'MATERIAL',assetType:'MATERIAL',class:1,quantity:'3',projectId:PROJECT,priceLamports:'1000000',status:'OPEN',isOwn:false,canBuy:true,createdAt:String(n),...extra});
const work=(n,extra={})=>({id:id(n),category:'PRODUCT',assetType:'WORK',scope:'CELL',target:4,workId:id(n+100),quality:'1.500',qualityPpm:'1500000',weight:'3024000000000',priceLamports:'1000000',status:'OPEN',isOwn:false,canBuy:true,createdAt:String(n),...extra});
function snapshot(){return{testHour:'10',testSOL:{balanceLamports:'100000000000'},works:[],projects:[{id:PROJECT,name:'Moss research laboratory'}],market:{listings:[material(1),material(2,{class:2}),work(3),work(4,{scope:'ORGAN',target:16}),work(5,{scope:'BIO',category:'BIO',target:22})],sellableMaterials:[{class:1,projectId:PROJECT,amount:'30',unitPriceLamports:'500000'},{class:2,projectId:PROJECT,amount:'60',unitPriceLamports:'600000'}],sellableWorks:[]}};}
function fixture({state=snapshot(),preferences={},busy=false,respond}={}){
  const document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},host=new Element('section');host.ownerDocument=document;
  const actions=[],opened=[],statuses=[];let renders=0;
  const context={state,preferences,busy,status:(...v)=>statuses.push(v),open:view=>opened.push(view),act:async(action,params)=>{actions.push({action,params:structuredClone(params)});return respond?.(action,params,state);},render:()=>{renders++;draw();}};
  const u=labUI(document,context),draw=()=>{host.replaceChildren();renderMarket(host,u);};draw();
  const all=()=>flatten(host),text=()=>allText(host),button=label=>{const b=all().find(e=>e.tagName==='button'&&e.textContent===label);assert.ok(b,`button: ${label}`);return b;};
  const field=label=>{const box=all().find(e=>e.tagName==='label'&&e.children[0]?.textContent===label);assert.ok(box,`field: ${label}`);return box.children[1];};
  const aria=label=>{const e=all().find(e=>e.attributes['aria-label']===label);assert.ok(e,`aria: ${label}`);return e;};
  const change=(e,value,type='change')=>{e.value=value;e.dispatchEvent({type});};
  return{host,state,preferences,actions,opened,statuses,all,text,button,field,aria,change,draw,get renders(){return renders;}};
}

const serial=e=>({tag:e.tagName,attributes:e.attributes,text:e.textContent,children:e.children.map(serial)});
test('catalogue SVG distinguishes four chemicals, four components, fifteen cells, six organs and organism safely',()=>{
  const calls=[],document={createElement:tag=>new Element(tag),createElementNS:(ns,tag)=>{calls.push(ns);return new Element(tag);}};
  const descriptors=[...[1,2,3,4].map(c=>({assetType:'MATERIAL',class:c})),...[1,2,3,4].map(primitive=>({scope:'COMPONENT',primitive,profile:4})),...Array.from({length:15},(_,i)=>({scope:'CELL',target:i+1})),...Array.from({length:6},(_,i)=>({scope:'ORGAN',target:i+16})),{scope:'BIO'}];
  const signatures=[];
  for(const descriptor of descriptors){const svg=createSpecimenArt(document,descriptor,{label:'<img onerror=bad> plain text'});assert.equal(svg.tagName,'svg');assert.equal(svg.attributes.role,'img');assert.match(allText(svg),/not a real anatomical or molecular reconstruction/);assert.equal(svg.attributes['data-art-kind'],specimenArtKind(descriptor));assert.ok(flatten(svg).every(e=>!['script','style','img','image','foreignObject'].includes(e.tagName)));assert.ok(flatten(svg).every(e=>e.attributes.style===undefined&&!Object.keys(e.attributes).some(k=>/^on/i.test(k))));assert.deepEqual(serial(svg),serial(createSpecimenArt(document,descriptor,{label:'<img onerror=bad> plain text'})));signatures.push(JSON.stringify(serial(svg)));}
  assert.equal(new Set(signatures).size,descriptors.length);assert.ok(calls.every(ns=>ns==='http://www.w3.org/2000/svg'));
  const fallback=createSpecimenArt({createElement:tag=>new Element(tag)},{scope:'BIO'});assert.equal(fallback.tagName,'svg');
});

test('price, quality and weight sorting remains exact above Number limits and does not mutate source rows',()=>{
  const rows=[work(1,{priceLamports:'9007199254740993',weight:'9007199254740993',qualityPpm:'1500001'}),work(2,{priceLamports:'9007199254740992',weight:'9007199254740992',qualityPpm:'1500000'}),work(3,{priceLamports:'1',weight:'9007199254740994',qualityPpm:'2000000'})],before=structuredClone(rows);
  const options={category:'PRODUCT'};assert.deepEqual(filterSortMarketListings(rows,{...options,sort:'price-low'}).map(l=>l.id),[id(3),id(2),id(1)]);assert.deepEqual(filterSortMarketListings(rows,{...options,sort:'quality',minimumQuality:'1500001'}).map(l=>l.id),[id(3),id(1)]);assert.deepEqual(filterSortMarketListings(rows,{...options,sort:'weight'}).map(l=>l.id),[id(3),id(1),id(2)]);assert.deepEqual(rows,before);
});

test('search finds published names and descriptions while category, type, ownership and status filters remain independent',()=>{
  const rows=[work(1,{launch:{title:'Citrus courier',description:'Nutrient exchange without shortcuts',author:id(91)}}),work(2,{scope:'ORGAN',target:17,isOwn:true}),work(3,{status:'SOLD'}),material(4)];
  assert.deepEqual(filterSortMarketListings(rows,{category:'PRODUCT',search:'nutrient exchange'}).map(l=>l.id),[id(1)]);assert.deepEqual(filterSortMarketListings(rows,{category:'PRODUCT',kind:'ORGAN',view:'listings'}).map(l=>l.id),[id(2)]);assert.deepEqual(filterSortMarketListings(rows,{category:'PRODUCT',view:'activity'}).map(l=>l.id),[id(3)]);assert.deepEqual(filterSortMarketListings(rows,{category:'MATERIAL'}).map(l=>l.id),[id(4)]);
});

test('market cards show SVG art and real properties, not fictitious minted traits',()=>{
  const f=fixture({preferences:{marketCategory:'PRODUCT'}});assert.ok(f.all().some(e=>e.tagName==='svg'&&e.attributes['data-art-kind']==='cell'));assert.match(f.text(),/Quality\s+1\.500×\s+Weight\s+756/);assert.match(f.text(),/0\.001\s+test SOL/);assert.match(f.text(),/Artwork is illustrative/);assert.equal(f.actions.length,0);assert.doesNotMatch(f.text(),/mainnet|floor price|volume traded|guaranteed/i);
});

test('buy opens a transaction review and confirms the exact listing once',async()=>{
  let resolve;const f=fixture({respond:()=>new Promise(r=>{resolve=r;})});f.button('Buy asset').click();assert.equal(f.actions.length,0);assert.match(f.text(),/receiving token account may require rent/);assert.match(f.text(),/Pay 0\.001 test SOL/);const confirm=f.button('Confirm purchase');confirm.click();confirm.click();assert.equal(f.actions.length,1);assert.deepEqual(f.actions[0],{action:'market-buy',params:{listingId:id(2)}});resolve();await flush();
});

test('own listing never exposes self-buy and cancellation preserves the original listing ID',async()=>{
  const s=snapshot();s.market.listings=[material(8,{isOwn:true,canBuy:false,canCancel:true,canTestSell:true})];const f=fixture({state:s});assert.ok(!f.all().some(e=>e.tagName==='button'&&e.textContent==='Buy asset'));f.button('Cancel listing').click();await flush();assert.deepEqual(f.actions[0],{action:'market-cancel',params:{listingId:id(8)}});f.button('Simulate buyer purchase').click();assert.deepEqual(f.actions[1],{action:'market-test-counterparty-buy',params:{listingId:id(8)}});assert.match(f.text(),/not a real-person trade/);
});

test('live search updates just the result cards and keeps separate search states for each market',()=>{
  const f=fixture();const search=f.aria('Search this market'),renderCount=f.renders;f.change(search,'Nucleotides','input');assert.equal(f.renders,renderCount);assert.equal(f.aria('Search this market'),search,'typing does not remount the input');assert.equal(f.all().filter(e=>e.attributes['data-listing-id']).length,1);f.button('Components & organs').click();assert.equal(f.aria('Search this market').value,'');f.change(f.aria('Search this market'),'ORGAN','input');f.button('Materials').click();assert.equal(f.aria('Search this market').value,'Nucleotides');
});

test('compact filters default to Search, Sort and a closed native Filters disclosure with per-view memory',()=>{
  const f=fixture({preferences:{marketCategory:'PRODUCT'}}),bar=f.all().find(e=>e.className==='lab-market-filters'),details=f.aria('Additional market filters');
  assert.deepEqual(bar.children.map(e=>e.tagName),['input','select','details']);assert.equal(bar.children[0],f.aria('Search this market'));assert.equal(bar.children[1],f.aria('Sort market'));assert.equal(details.open,false);assert.equal(details.children[0].tagName,'summary');assert.equal(details.children[0].textContent,'Filters');
  details.open=true;details.dispatchEvent({type:'toggle'});f.change(f.aria('Asset type filter'),'CELL');f.change(f.aria('Minimum quality'),'1500000');assert.equal(details.children[0].textContent,'Filters (2)');assert.equal(f.all().filter(e=>e.attributes['data-listing-id']).length,1);
  f.button('My listings').click();assert.equal(f.aria('Additional market filters').open,false);assert.equal(f.aria('Asset type filter').value,'ALL');f.button('Browse').click();assert.equal(f.aria('Additional market filters').open,true);assert.equal(f.aria('Asset type filter').value,'CELL');assert.equal(f.aria('Minimum quality').value,'1500000');
  f.button('Materials').click();assert.equal(f.aria('Additional market filters').open,false);assert.ok(!f.all().some(e=>e.attributes['aria-label']==='Minimum quality'));f.button('Components & organs').click();assert.equal(f.aria('Additional market filters').open,true);
});

test('Sell, My listings and Activity do not overwrite drafts or filters belonging to another view',()=>{
  const f=fixture();f.button('Sell').click();f.change(f.field('Total asking price (simulation SOL)'),'0.1234','input');f.change(f.field('Units to list'),'7','input');f.button('My listings').click();assert.equal(f.all().filter(e=>e.attributes['data-listing-id']).length,0);f.button('Activity').click();assert.match(f.text(),/Your next trade starts a story/);f.button('Sell').click();assert.equal(f.field('Total asking price (simulation SOL)').value,'0.1234');assert.equal(f.field('Units to list').value,'7');f.button('Browse').click();assert.equal(f.aria('Search this market').value,'');
});

test('selling uses owned image cards, keeps per-asset drafts and prevents staked work from being listed',()=>{
  const s=snapshot();s.works=[{id:id(51),scope:'CELL',target:4,status:'LIVE',staked:false},{id:id(52),scope:'ORGAN',target:16,status:'LIVE',staked:true}];s.market.sellableWorks=[{workId:id(51),category:'PRODUCT',scope:'CELL',target:4,priceLamports:'1000000',quality:'1.500',weight:'3024000000000'}];
  const f=fixture({state:s,preferences:{marketCategory:'PRODUCT',marketView:'sell'}});assert.ok(f.all().some(e=>e.attributes['data-owned-work']===id(52)));assert.match(f.text(),/STAKED · EXIT BEFORE SELLING/);assert.ok(!f.all().some(e=>e.tagName==='select'),'owned objects are chosen by cards');f.change(f.field('Asking price (simulation SOL)'),'0.000000001','input');f.button('List selected specimen').click();assert.deepEqual(f.actions,[{action:'market-list',params:{assetType:'WORK',workId:id(51),priceLamports:'1'}}]);
});

test('material listing follows quantity until the player enters a custom total and applies no floating point shortcuts',()=>{
  const f=fixture({preferences:{marketView:'sell'}}),quantity=f.field('Units to list'),price=f.field('Total asking price (simulation SOL)');f.change(quantity,'3','input');assert.equal(price.value,'0.0015');f.button('+10%').click();assert.equal(price.value,'0.00165');f.change(price,'0.123456789','input');f.change(quantity,'4','input');assert.equal(price.value,'0.123456789');f.button('List materials').click();assert.deepEqual(f.actions,[{action:'market-list',params:{assetType:'MATERIAL',class:1,quantity:'4',projectId:PROJECT,priceLamports:'123456789'}}]);
});

test('zero/overflow prices and unavailable material amounts are rejected before a trade request',()=>{
  const f=fixture({preferences:{marketView:'sell'}});const quantity=f.field('Units to list'),price=f.field('Total asking price (simulation SOL)');for(const value of ['0','31','1001','-1','1e2']){f.change(quantity,value,'input');f.button('List materials').click();}assert.equal(f.actions.length,0);f.change(quantity,'1','input');for(const value of ['0','18446744073.709551616','0.0000000001']){f.change(price,value,'input');f.button('List materials').click();}assert.equal(f.actions.length,0);assert.ok(f.statuses.length>=8);
});

test('successful listing switches to My listings with a real result, and a rejected request makes no success claim',async()=>{
  const f=fixture({preferences:{marketView:'sell'},respond:(action,params,state)=>({state:{...state,lastResult:{status:'SUCCESS',action,listingId:id(99),priceLamports:params.priceLamports}}})});f.button('List materials').click();await flush();assert.equal(f.preferences.marketView,'listings');assert.match(f.text(),/Listed successfully/);assert.match(f.text(),/held in escrow/);
  const rejected=fixture({preferences:{marketView:'sell'},respond:()=>undefined});rejected.button('List materials').click();await flush();assert.doesNotMatch(rejected.text(),/Listed successfully/);assert.equal(rejected.preferences.marketView,'sell');
});

test('published titles, descriptions and publisher provenance are rendered as text and searchable',()=>{
  const s=snapshot();s.market.listings=[work(3,{launch:{title:'<img src=x onerror=alert(1)> Mint ferry',description:'A careful transport model',author:id(88)}})];const f=fixture({state:s,preferences:{marketCategory:'PRODUCT'}});assert.match(f.text(),/Mint ferry/);assert.match(f.text(),/Publisher #/);assert.doesNotMatch(f.text(),/Author/);assert.ok(!f.all().some(e=>['img','script','style','iframe'].includes(e.tagName)));f.change(f.aria('Search this market'),'careful transport','input');assert.equal(f.all().filter(e=>e.attributes['data-listing-id']).length,1);
});

test('completed and removed listings are separated from live cards and cannot buy twice',()=>{
  const s=snapshot();s.market.listings=[material(1,{status:'SOLD'}),material(2,{status:'CANCELLED'}),material(3,{isOwn:true,canCancel:true})];const f=fixture({state:s});assert.equal(f.all().filter(e=>e.attributes['data-listing-id']).length,1);f.button('Activity').click();assert.equal(f.all().filter(e=>e.attributes['data-listing-id']).length,2);assert.ok(!f.all().some(e=>e.tagName==='button'&&['Buy asset','Cancel listing','Simulate buyer purchase'].includes(e.textContent)));assert.match(f.text(),/SOLD/);assert.match(f.text(),/REMOVED/);
});

test('busy state disables browse, review, sell and category controls without issuing an action',()=>{
  for(const view of ['browse','sell','listings','activity']){const f=fixture({busy:true,preferences:{marketView:view}});for(const e of f.all().filter(e=>['button','input','select'].includes(e.tagName))){assert.equal(e.disabled,true,`${view}: ${e.textContent}`);if(e.tagName==='button')e.click();}assert.equal(f.actions.length,0);}
});

test('organism artwork uses its own organism silhouette and does not enter the organ-prefix branch',()=>{const document={createElement:tag=>new Element(tag)};const bio=createSpecimenArt(document,{scope:'BIO'}),organ=createSpecimenArt(document,{scope:'ORGAN',target:16});assert.match(allText(bio),/DIGITAL ORGANISM/);assert.doesNotMatch(allText(bio),/FUNCTIONAL ORGAN/);assert.match(allText(organ),/FUNCTIONAL ORGAN/);assert.doesNotMatch(allText(organ),/DIGITAL ORGANISM/);});
