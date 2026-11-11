import test from 'node:test';
import assert from 'node:assert/strict';
import {Element,allText} from './discovery-ui-fixture.mjs';
import {labUI} from '../apps/player/dist/lab-ui.js';
import {renderSupply} from '../apps/player/dist/lab-panels-supply.js';
import {renderProduction,requiredSlots,availableWork,manufactureCapacity,componentMaterialDeficits} from '../apps/player/dist/lab-panels-production.js';
import {renderMarket} from '../apps/player/dist/lab-panels-market.js';
import {mountLabOperations,chooseLabJourney} from '../apps/player/dist/lab-ops.js';
import {F1_BOM,materialClass,RU_TO_TICK} from '../packages/protocol-core/src/index.mjs';

const id=n=>Number(n).toString(16).padStart(64,'0'),PROJECT=id(100),DESIGN=id(200);
const part=(primitive,changes={})=>({id:id(primitive),scope:'COMPONENT',primitive,profile:primitive===4?4:0,status:'LIVE',staked:false,exitEndHour:null,canConsume:true,quality:'1.000',weight:'60',B:'120000',...changes});
const cell=(target,changes={})=>({id:id(20+target),scope:'CELL',target,status:'LIVE',staked:false,exitEndHour:null,canConsume:true,quality:'1.000',weight:'240',B:'480000',...changes});
const organ=(target,changes={})=>({id:id(40+target),scope:'ORGAN',target,status:'LIVE',staked:false,exitEndHour:null,canConsume:true,quality:'1.000',weight:'720',B:'1200000',...changes});
function ledger(){return{
  testHour:'10',lab:{balanceAtoms:'1000000000000000',unclaimedAtoms:'1000000'},testSOL:{balanceLamports:'9007199254740993'},
  projects:[{id:PROJECT,name:'Reference laboratory',isOwn:false,classes:[1,2,3,4].map(c=>({class:c,issued:'0',lifetimeCap:'1000',remaining:'1000',ownedAmount:'30',priceLamports:'500000'}))}],
  designs:[{id:DESIGN,name:'C310 public reference',challenge:2000000}],selectedDesignId:DESIGN,works:[1,2,3,4].map(p=>part(p)),kits:[],positions:[],materials:[1,2,3,4].map(c=>({class:c,amount:'30'})),sourceRemainingTicks:'0',ledger:[],
  labSim:{starter:{earnedLABAtoms:'1000000000'},recipe:[1,2,3,4].map(c=>({class:c,tickScale:RU_TO_TICK.toString(),species:materialClass(c).species.map(species=>({species,ticks:F1_BOM[species-1].toString()})),sourceRemaining:materialClass(c).species.map(species=>({species,ticks:'0'}))}))},
  market:{listings:[],sellableMaterials:[{class:1,projectId:PROJECT,amount:'30',unitPriceLamports:'500000'}],sellableWorks:[]},
};}
const flatten=element=>[element,...element.children.flatMap(flatten)];
function fixture(view,{state=ledger(),preferences={},busy=false}={}){
  const document={createElement:tag=>new Element(tag)},host=new Element('section'),actions=[],opened=[],inspected=[],statuses=[];let renders=0;
  const context={state,preferences,busy,act:async(action,params)=>{actions.push({action,params:structuredClone(params)});return{status:'PASS'};},open:name=>opened.push(name),inspect:work=>inspected.push(work),status:(...args)=>statuses.push(args),render:()=>{renders++;draw();}};
  const u=labUI(document,context);
  const draw=()=>{host.replaceChildren();if(view==='projects'||view==='supplies')renderSupply(host,u,view);else if(view==='market')renderMarket(host,u);else renderProduction(host,u,view);};
  const all=()=>flatten(host),text=()=>allText(host),buttons=()=>all().filter(e=>e.tagName==='button');
  const button=label=>{const found=buttons().find(e=>e.textContent===label);assert.ok(found,`button: ${label}`);return found;};
  const field=label=>{const box=all().find(e=>e.tagName==='label'&&e.children[0]?.textContent===label);assert.ok(box,`field: ${label}`);return box.children[1];};
  const change=(label,value)=>{const input=field(label);input.value=value;input.dispatchEvent({type:'change'});return input;};
  draw();return{host,state,preferences,u,actions,opened,inspected,statuses,all,text,button,buttons,field,change,draw,get renders(){return renders;}};
}

test('all laboratory panels are English, CSP-safe and inert until an explicit button click',()=>{
  for(const view of ['projects','supplies','workshop','assembly','energy','assets','market']){
    const f=fixture(view);assert.ok(f.host.children.length,view);assert.doesNotMatch(f.text(),/[\u3400-\u9fff]/,view);assert.equal(f.actions.length,0,view);
    for(const element of f.all()){assert.ok(!['style','script','iframe'].includes(element.tagName),view);assert.equal(element.attributes.style,undefined,view);if(element.tagName==='button')assert.equal(element.type,'button',`${view}: ${element.textContent}`);}
  }
});

test('reference purchasing requests materials only and never auto-manufactures 60 components',()=>{
  const f=fixture('supplies');assert.match(f.text(),/120 direct units/);assert.match(f.text(),/not an automatic manufacture/);assert.match(f.text(),/0.06 simulation SOL/);
  f.button('Buy reference materials · 120 units').click();assert.deepEqual(f.actions,[{action:'project-buy-kit',params:{projectId:PROJECT}}]);
  f.button('Design before buying').click();assert.deepEqual(f.opened,['design']);
});

test('individual material purchase controls validate quantity and retain the chosen class and project',()=>{
  const f=fixture('supplies'),cards=f.all().filter(e=>e.tagName==='article'),amino=cards.find(c=>allText(c).includes('Amino acids'));
  const elements=flatten(amino),quantity=elements.find(e=>e.tagName==='input'),buy=elements.find(e=>e.tagName==='button'&&e.textContent==='Buy material');
  for(const bad of ['0','-1','1001','1e3','2.5']){quantity.value=bad;buy.click();}assert.equal(f.actions.length,0);assert.equal(f.statuses.length,5);
  quantity.value='7';buy.click();assert.deepEqual(f.actions,[{action:'project-buy',params:{projectId:PROJECT,class:1,quantity:'7'}}]);
  const sold=ledger();sold.projects[0].classes[0].remaining='0';const closed=fixture('supplies',{state:sold});const card=closed.all().find(e=>e.tagName==='article'&&allText(e).includes('Amino acids'));assert.equal(flatten(card).find(e=>e.tagName==='button').disabled,true);
});

test('supply quote arithmetic does not round prices through Number',()=>{
  const s=ledger();for(const c of s.projects[0].classes)c.priceLamports='9007199254740993';
  const f=fixture('supplies',{state:s});assert.match(f.text(),/1080863910\.56891916 simulation SOL/);
});

test('creating a sale emits exactly four immutable classes and preserves one-lamport prices',()=>{
  const f=fixture('projects');f.change('Project name','  My lab  ');f.change('Supply cap for each class','999');
  for(const symbol of ['AA','NUC','LIPID','SUGAR'])f.change(`${symbol} price / unit (simulation SOL)`,'0.000000001');
  f.button('Create laboratory sale').click();assert.deepEqual(f.actions,[{action:'project-create',params:{name:'My lab',classes:[1,2,3,4].map(c=>({class:c,lifetimeCap:'999',priceLamports:'1'}))}}]);
  f.change('AA price / unit (simulation SOL)','0.0000000001');f.button('Create laboratory sale').click();assert.equal(f.actions.length,1);assert.match(f.statuses.at(-1)[0],/valid amount/);
});

test('single manufacture is explicit, emits one selected component and keeps the full sample optional',()=>{
  const f=fixture('workshop');assert.match(f.text(),/Choose one component/);assert.ok(f.all().some(e=>e.tagName==='details'&&allText(e).includes('Optional:')));
  f.button('Manufacture 1 component').click();assert.deepEqual(f.actions,[{action:'manufacture-part',params:{primitive:1,profile:0}}]);
  f.change('Component function','4');f.change('Functional role','12');f.button('Manufacture 1 component').click();assert.deepEqual(f.actions.at(-1),{action:'manufacture-part',params:{primitive:4,profile:12}});
  f.button('Next: assemble compatible components').click();assert.deepEqual(f.opened,['assembly']);
});

test('manufacturing capacity requires every fixed species and preserves exact raw plus credit arithmetic',()=>{
  const reference=ledger();reference.materials.forEach((m,i)=>m.amount=String([30,60,15,15][i]));assert.equal(manufactureCapacity(reference),60n);
  const credits=ledger();credits.materials.forEach(m=>m.amount='0');for(const row of credits.labSim.recipe)for(const credit of row.sourceRemaining)credit.ticks=(F1_BOM[credit.species-1]*2n).toString();assert.equal(manufactureCapacity(credits),2n);
  credits.labSim.recipe[0].sourceRemaining[0].ticks='499';assert.equal(manufactureCapacity(credits),0n,'extra molecules cannot replace a missing amino-acid species');
  const huge=ledger();huge.materials.forEach(m=>m.amount='9007199254740993');assert.equal(manufactureCapacity(huge),9007199254740993n);
  reference.materials[1].amount='0';assert.equal(manufactureCapacity(reference),0n);const panel=fixture('workshop',{state:reference});assert.equal(panel.button('Manufacture 1 component').disabled,true);
});

test('optional complete reference batch explicitly reuses eligible components and makes only missing entries',()=>{
  const s=ledger();s.materials.forEach((m,i)=>m.amount=String([30,60,15,15][i]));s.works.push(part(1,{id:id(777),staked:true}),part(4,{id:id(778),profile:15}));
  const f=fixture('workshop',{state:s});assert.match(f.text(),/5 existing components can be reused; 55 new components are needed/);assert.equal(f.actions.length,0);f.button('Complete reference component set · 55 new').click();assert.deepEqual(f.actions,[{action:'manufacture-reference',params:{}}]);
});

test('required slots encode every fixed hierarchy layer without accepting the wrong functional profile',()=>{
  for(let target=1;target<=15;target++){
    const slots=requiredSlots(target);assert.equal(slots.length,4);const inputs=[1,2,3,4].map(p=>part(p,{profile:p===4?target:0}));
    slots.forEach((slot,i)=>{assert.equal(slot.match(inputs[i]),true);assert.equal(inputs.filter(w=>slot.match(w)).length,1);});
    assert.equal(slots[3].match(part(4,{profile:target===15?1:target+1})),false);
    assert.ok(slots.every(slot=>!slot.match(cell(target))));
  }
  const roles=[[1,2],[3,4,5],[6,7,8,9],[10,11],[12,13],[14,15]],covered=[];
  for(let i=0;i<6;i++){
    const slots=requiredSlots(i+16);assert.equal(slots.length,roles[i].length);
    slots.forEach((slot,n)=>{covered.push(roles[i][n]);assert.equal(slot.match(cell(roles[i][n])),true);assert.equal(slot.match(part(4,{profile:roles[i][n]})),false);assert.equal(slot.match(cell(roles[(i+1)%6][0])),false);});
  }
  assert.deepEqual(covered,Array.from({length:15},(_,i)=>i+1));
  const bio=requiredSlots(22);assert.equal(bio.length,6);bio.forEach((slot,i)=>{assert.equal(slot.match(organ(i+16)),true);assert.equal(slot.match(cell(i+1)),false);assert.equal(slot.match(organ(16+(i+1)%6)),false);});
});

test('escrowed, consumed, staked or exiting specimens cannot be selected for assembly or listing',()=>{
  const s=ledger();assert.equal(availableWork(part(1),s),true);assert.equal(availableWork(part(1,{exitEndHour:'10'}),s),true);
  for(const patch of [{status:'CONSUMED'},{status:'ESCROW'},{staked:true},{canConsume:false},{exitEndHour:'11'}])assert.equal(availableWork(part(1,patch),s),false,JSON.stringify(patch));
  s.works=[part(1,{status:'ESCROW'}),part(2,{staked:true}),part(3,{exitEndHour:'11'}),part(4,{profile:5})];
  const f=fixture('assembly',{state:s});assert.equal(f.button('Validate & assemble 1 cell').disabled,true);assert.match(f.text(),/0 \/ 4 compatible inputs selected/);
  f.button('Validate & assemble 1 cell').click();assert.equal(f.actions.length,0);
});

test('cell assembly uses four distinct live inputs and the exact validated blueprint',()=>{
  const f=fixture('assembly');assert.match(f.text(),/4 \/ 4 compatible inputs selected/);assert.match(f.text(),/0.8 LAB burned on success/);
  f.button('Validate & assemble 1 cell').click();assert.deepEqual(f.actions,[{action:'synthesize',params:{target:4,inputIds:[1,2,3,4].map(id),designId:DESIGN,challenge:2000000}}]);
  f.change('What are you assembling?','16');assert.match(f.text(),/0 \/ 2 compatible inputs selected/);assert.equal(f.button('Validate & assemble 1 organ').disabled,true);
});

test('assembly requires both a validated design and enough LAB, even when material inputs exist',()=>{
  const noDesign=ledger();noDesign.selectedDesignId=null;const a=fixture('assembly',{state:noDesign});assert.equal(a.button('Validate & assemble 1 cell').disabled,true);
  const poor=ledger();poor.lab.balanceAtoms='799999';const b=fixture('assembly',{state:poor});assert.equal(b.button('Validate & assemble 1 cell').disabled,true);
  poor.lab.balanceAtoms='800000';b.draw();assert.equal(b.button('Validate & assemble 1 cell').disabled,false);
});

test('organism assembly selects exactly six organ roles; exact fee calculation survives >2^53 inputs',()=>{
  const s=ledger();s.works=Array.from({length:6},(_,i)=>organ(16+i,{B:'9007199254740993'}));s.lab.balanceAtoms='18446744073709551615';
  const f=fixture('assembly',{state:s,preferences:{assemblyTarget:22}});const fee=(9007199254740993n*6n*200000n+119999n)/120000n;
  assert.match(f.text(),new RegExp(f.u.lab(fee).replace('.','\\.')+' LAB burned'));
  f.button('Validate & assemble 1 organism').click();assert.deepEqual(f.actions[0].params.inputIds,s.works.map(w=>w.id));assert.equal(f.actions[0].params.target,22);
});

test('a duplicate instance ID cannot satisfy two assembly slots',()=>{
  const s=ledger();s.works[1].id=s.works[0].id;const f=fixture('assembly',{state:s});assert.equal(f.button('Validate & assemble 1 cell').disabled,true);f.button('Validate & assemble 1 cell').click();assert.equal(f.actions.length,0);
});

test('energy controls separate stake, hour settlement, claim and delayed exit without fixed-return promises',()=>{
  const s=ledger();s.works=[part(1),part(2,{staked:true})];s.positions=[{workId:id(2),startHour:'9',endHour:null}];
  const f=fixture('energy',{state:s});assert.match(f.text(),/not a fixed daily return/);assert.match(f.text(),/next complete hour/);
  f.button('Stake specimen').click();f.button('Settle 2 simulation hours').click();f.button('Claim settled LAB').click();f.button('Exit registration').click();
  assert.deepEqual(f.actions,[{action:'stake',params:{workId:id(1)}},{action:'advance-hour',params:{hours:2}},{action:'claim',params:{}},{action:'exit',params:{workId:id(2)}}]);
  const pending=ledger();pending.works=[part(1,{staked:true})];pending.positions=[{workId:id(1),startHour:'11',endHour:null}];pending.lab.unclaimedAtoms='0';
  const g=fixture('energy',{state:pending});assert.equal(g.button('Exit registration').disabled,true);assert.equal(g.button('Claim settled LAB').disabled,true);
});

test('sold specimen ledger and historical unpaid rewards remain readable independently',()=>{
  const s=ledger();s.works=[];s.positions=[{workId:id(1),startHour:'1',endHour:'7',accruedAtoms:'1000001',paidAtoms:'1000000'}];s.lab.unclaimedAtoms='1';
  const f=fixture('energy',{state:s});assert.match(f.text(),/earned 1\.000001 LAB \/ paid 1 LAB/);assert.equal(f.button('Claim settled LAB').disabled,false);
});

test('market listing cannot stake or consume escrowed assets and local counterparties are explicitly marked',async()=>{
  const s=ledger();s.market.listings=[{id:id(500),category:'MATERIAL',status:'OPEN',assetType:'MATERIAL',class:1,quantity:'7',projectId:PROJECT,priceLamports:'1',isOwn:true,canCancel:true,canTestSell:true},{id:id(501),category:'MATERIAL',status:'OPEN',assetType:'MATERIAL',class:2,quantity:'3',projectId:PROJECT,priceLamports:'2',isOwn:false,canBuy:true}];
  const f=fixture('market',{state:s});assert.match(f.text(),/Listed specimens cannot be staked or consumed/);assert.match(f.text(),/SIMULATED COUNTERPARTY/);assert.match(f.text(),/not a trade with another person/);
  f.button('Cancel listing').click();await new Promise(resolve=>setImmediate(resolve));f.button('Simulate buyer purchase').click();await new Promise(resolve=>setImmediate(resolve));f.button('Buy asset').click();assert.equal(f.actions.length,2,'reviewing an asset does not execute a trade');f.button('Confirm purchase').click();
  assert.deepEqual(f.actions,[{action:'market-cancel',params:{listingId:id(500)}},{action:'market-test-counterparty-buy',params:{listingId:id(500)}},{action:'market-buy',params:{listingId:id(501)}}]);
});

test('material listing is priced as a total and retains exact one-lamport asks',async()=>{
  const f=fixture('market',{preferences:{marketView:'sell'}});f.change('Units to list','7');f.change('Total asking price (simulation SOL)','0.000000001');f.button('List materials').click();
  assert.deepEqual(f.actions,[{action:'market-list',params:{assetType:'MATERIAL',class:1,quantity:'7',projectId:PROJECT,priceLamports:'1'}}]);
  await new Promise(resolve=>setImmediate(resolve));
  f.change('Total asking price (simulation SOL)','18446744073.709551616');f.button('List materials').click();assert.equal(f.actions.length,1);assert.match(f.statuses.at(-1)[0],/valid amount/);
});

test('specimen market switches category explicitly and lists exactly the selected owned specimen',()=>{
  const s=ledger();s.market.sellableWorks=[{workId:id(600),category:'PRODUCT',scope:'CELL',target:4,priceLamports:'9007199254740993'},{workId:id(601),category:'PRODUCT',scope:'ORGAN',target:16,priceLamports:'1'}];
  const f=fixture('market',{state:s,preferences:{marketView:'sell'}});f.button('Components & organs').click();assert.equal(f.preferences.marketCategory,'PRODUCT');assert.equal(f.field('Asking price (simulation SOL)').value,'9007199.254740993');
  const chosen=f.all().find(e=>e.attributes['data-owned-work']===id(601));flatten(chosen).find(e=>e.tagName==='button'&&e.textContent==='Select asset').click();assert.equal(f.field('Asking price (simulation SOL)').value,'0.000000001');f.button('List selected specimen').click();
  assert.deepEqual(f.actions,[{action:'market-list',params:{assetType:'WORK',workId:id(601),priceLamports:'1'}}]);
  f.button('Organisms').click();assert.match(f.text(),/Only your unstaked, unconsumed specimens/);f.button('Manage staking and exits').click();assert.deepEqual(f.opened,['energy']);
});

test('busy UI disables every mutating form control and prevents accidental duplicate actions',()=>{
  for(const view of ['projects','supplies','workshop','assembly','energy','assets','market']){
    const f=fixture(view,{busy:true});for(const b of f.buttons()){assert.equal(b.disabled,true,`${view}: ${b.textContent}`);b.click();}
    for(const field of f.all().filter(e=>['input','select'].includes(e.tagName)))assert.equal(field.disabled,true,view);
    assert.equal(f.actions.length,0,view);
  }
});

test('untrusted project names and specimen IDs remain text, never executable markup',()=>{
  const s=ledger();s.projects[0].name='<img src=x onerror=alert(1)>';s.works[0].id='<script>alert(1)</script>';
  for(const view of ['projects','supplies','assets']){const f=fixture(view,{state:s});assert.ok(f.all().every(e=>!['script','img'].includes(e.tagName)));assert.equal(f.actions.length,0);}
});

class OperationsElement extends Element{
  constructor(tag,document){super(tag);this.ownerDocument=document;}
  append(...children){super.append(...children);for(const child of children)child.parentElement=this;}
  querySelectorAll(selector){return flatten(this).slice(1).filter(e=>selector==='button'?e.tagName==='button':selector==='span'?e.tagName==='span':false);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]??[]).filter(listener=>listener!==fn);}
  focus(){this.ownerDocument.activeElement=this;}
}
function operationsFixture({pending=null,state=ledger()}={}){
  const elements=new Map(),listeners={},calls=[],map=new Map(pending?[['mogusbio:lab-sim:pending:v1',JSON.stringify(pending)]]:[]);
  const document={activeElement:null,createElement:tag=>new OperationsElement(tag,document),getElementById:id=>elements.get(id),querySelectorAll:selector=>selector==='[data-operation]'?[...elements.values()].filter(e=>e.dataset.operation):selector==='[data-journey-step]'?[...elements.values()].filter(e=>e.dataset.journeyStep):[],addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);},removeEventListener:(type,fn)=>{listeners[type]=(listeners[type]??[]).filter(listener=>listener!==fn);}};
  for(const name of 'lab-ops lab-ops-content lab-ops-title lab-ops-subtitle lab-ops-status lab-ops-tabs lab-ops-close lab-notebook lab-status lab-account-button lab-account-balance lab-account-sol lab-task-title lab-task-body lab-primary lab-journey-next'.split(' ')){const element=document.createElement(name.includes('button')||['lab-primary','lab-journey-next','lab-ops-close'].includes(name)?'button':'div');element.id=name;elements.set(name,element);}
  elements.get('lab-account-button').append(document.createElement('span'));
  for(const operation of ['projects','supplies','design','workshop','assembly','energy','market','assets']){const b=document.createElement('button');b.dataset.operation=operation;elements.set(`operation-${operation}`,b);}
  for(const stage of ['account','supplies','design','workshop','assembly','energy','claim']){const li=document.createElement('li');li.dataset.journeyStep=stage;elements.set(`stage-${stage}`,li);}
  const dto=()=>({profile:'BIO-LOCAL-PLAYTEST1',networkSubmitted:false,authenticated:true,runId:'ab'.repeat(32),revision:'1',state:{...structuredClone(state),profile:'BIO-PLAYTEST-SNAPSHOT1',scope:{networkSubmitted:false}}});
  const fetchImpl=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.endsWith('/config')?{enabled:true,referenceModel:true,networkSubmitted:false}:dto()),{headers:{'content-type':'application/json'}});};
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
  const mounted=mountLabOperations(document,{fetchImpl,storage,window:{}});
  return{mounted,elements,document,calls,map,all:()=>flatten(elements.get('lab-ops-content'))};
}

test('journey prioritizes accrued LAB and never promises a constant or guaranteed reward',()=>{
  const empty=ledger();empty.works=[];empty.lab.unclaimedAtoms='0';empty.materials=[];empty.sources=[];empty.sourceRemainingTicks='0';
  assert.equal(chooseLabJourney(null).operation,'account');assert.equal(chooseLabJourney(empty).operation,'supplies');
  const earned=ledger();earned.works=[part(1,{staked:true})];assert.equal(chooseLabJourney(earned).operation,'claim');earned.lab.unclaimedAtoms='0';assert.equal(chooseLabJourney(earned).operation,'energy');
  const ready=ledger();ready.lab.unclaimedAtoms='0';assert.equal(chooseLabJourney(ready,{designConfirmed:true}).operation,'assembly');assert.equal(chooseLabJourney(ready,{designConfirmed:false}).operation,'design');
});

test('pending operation has one usable exact-request retry control while ordinary actions remain locked',async()=>{
  const pending={kind:'action',body:{requestId:'01'.repeat(32),runId:'ab'.repeat(32),revision:'1',action:'claim',params:{}}},f=operationsFixture({pending});
  try{
    await f.mounted.ready;f.mounted.open('supplies');const retry=f.all().find(e=>e.tagName==='button'&&e.textContent==='Retry pending operation');assert.ok(retry);assert.equal(retry.disabled,false);
    const buy=f.all().find(e=>e.tagName==='button'&&e.textContent==='Buy reference materials · 120 units');assert.equal(buy.disabled,true);
    retry.click();await new Promise(resolve=>setImmediate(resolve));const post=f.calls.find(call=>call.init.method==='POST');assert.ok(post);assert.equal(post.url,'/api/lab-sim/action');assert.deepEqual(JSON.parse(post.init.body),pending.body);assert.equal(f.mounted.snapshot.pending,null);
  }finally{f.mounted.dispose();}
});

test('the journey explains a pending exit before offering to restake the same locked specimen',()=>{
  const s=ledger();s.lab.unclaimedAtoms='0';s.works=[{id:id(999),scope:'BIO',status:'LIVE',staked:false,exitEndHour:'11'}];s.testHour='10';const pending=chooseLabJourney(s,{designConfirmed:true});assert.equal(pending.operation,'energy');assert.match(pending.title,/exit is pending/);assert.doesNotMatch(pending.label,/Stake/);s.testHour='11';assert.equal(chooseLabJourney(s).label,'Stake your organism');
});

test('market previews disclose exact cell quality and weight before purchase, and material defaults follow quantity',()=>{
  const s=ledger();s.market.listings=[{id:id(911),category:'PRODUCT',assetType:'WORK',workId:id(912),scope:'CELL',target:4,quality:'1.500',qualityPpm:'1500000',weight:'3024000000000',B:'480000',priceLamports:'1000000',status:'OPEN',isOwn:false,canBuy:true}];
  const preview=fixture('market',{state:s,preferences:{marketCategory:'PRODUCT'}});assert.match(preview.text(),/C04 · Metabolic processing/);assert.match(preview.text(),/Quality\s+1\.500×\s+Weight\s+756/);assert.equal(preview.actions.length,0);preview.button('Buy asset').click();assert.equal(preview.actions.length,0);preview.button('Confirm purchase').click();assert.deepEqual(preview.actions,[{action:'market-buy',params:{listingId:id(911)}}]);
  const material=fixture('market',{preferences:{marketView:'sell'}}),quantity=material.field('Units to list'),price=material.field('Total asking price (simulation SOL)');quantity.value='3';quantity.dispatchEvent({type:'input'});assert.equal(price.value,'0.0015');price.value='0.02';price.dispatchEvent({type:'input'});quantity.value='4';quantity.dispatchEvent({type:'input'});assert.equal(price.value,'0.02','manual total asking price is preserved');quantity.value='1001';material.button('List materials').click();assert.equal(material.actions.length,0);quantity.value='4';material.button('List materials').click();assert.equal(material.actions[0].params.priceLamports,'20000000');assert.equal(material.actions[0].params.quantity,'4');
});

test('the account ledger shows the full sale credit after simulated counterparty purchase',()=>{
  const s=ledger();s.ledger=[{sequence:1,action:'market-test-counterparty-buy',testHour:'10',labBeforeAtoms:'1000000',labAfterAtoms:'1000000',manufactureBurnAtoms:'0',solDebitLamports:'-10000000',materialBefore:['0','0','0','0'],materialAfter:['0','0','0','0']}];const account=fixture('assets',{state:s});assert.match(account.text(),/SOL credit 0\.01/);assert.doesNotMatch(account.text(),/SOL debit —/);
});


test('first-component guidance quotes only missing units and optional reference remains explicit',()=>{
 const s=ledger();s.works=[];s.lab.unclaimedAtoms='0';s.materials.forEach(m=>m.amount='0');
 const f=fixture('supplies',{state:s});assert.equal(f.all().find(e=>e.tagName==='article').children[0].textContent,'Your first component · start here');
 assert.deepEqual(componentMaterialDeficits(s).map(x=>x.quantity),[1n,1n,1n,1n]);
 f.button('Buy missing materials · 4 units').click();assert.deepEqual(f.actions,[{action:'project-buy-first-component',params:{projectId:PROJECT}}]);
 const reference=f.all().find(e=>e.tagName==='details');assert.ok(allText(reference).includes('120 direct units'));assert.notEqual(reference.open,true);
 s.materials.forEach(m=>m.amount='1');const ready=fixture('supplies',{state:s});ready.button('Next: manufacture 1 component').click();assert.deepEqual(ready.opened,['workshop']);assert.equal(ready.actions.length,0);
 assert.equal(chooseLabJourney(s).operation,'workshop','first component needs materials, not prior blueprint selection');
 s.works=[part(1)];assert.equal(chooseLabJourney(s).operation,'design','a cell still requires a blueprint decision');
});

test('first-component quote counts individual species and mixed raw inventory exactly',()=>{
 const s=ledger();s.materials.forEach(m=>m.amount='0');
 for(const row of s.labSim.recipe)for(const item of row.sourceRemaining)item.ticks=F1_BOM[item.species-1].toString();
 assert.deepEqual(componentMaterialDeficits(s).map(x=>x.quantity),[0n,0n,0n,0n]);
 s.labSim.recipe[1].sourceRemaining[0].ticks='499';assert.deepEqual(componentMaterialDeficits(s).map(x=>x.quantity),[0n,1n,0n,0n]);
 s.materials[1].amount='1';assert.equal(componentMaterialDeficits(s)[1].quantity,0n);
});
