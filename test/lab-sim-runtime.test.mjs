import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createPlaytestRuntime,createLabSimulationRuntime,preparePlaytestCheckpoint,restoreLabSimulationRuntime} from '../apps/playtest/runtime.mjs';
import {createPlaytestHTTP} from '../apps/playtest/http.mjs';
import {ORGAN_CELLS} from '../packages/biology/src/index.mjs';

const legacyCheckpoint=await preparePlaytestCheckpoint();
const pristine=JSON.stringify(legacyCheckpoint);
const initial=await createLabSimulationRuntime({checkpoint:legacyCheckpoint}),checkpoint=initial.exportState();
const fresh=()=>createLabSimulationRuntime({checkpoint});
const act=(r,action,params={})=>r.execute({action,params});
const unchanged=(r,action,params,code)=>{const before=JSON.stringify(r.exportState());assert.throws(()=>act(r,action,params),e=>!code||e.code===code);assert.equal(JSON.stringify(r.exportState()),before);};
const classes=()=>[1,2,3,4].map(c=>({class:c,lifetimeCap:'1000',priceLamports:'750000'}));
const targetRef=s=>s.designs.find(d=>d.id===s.selectedDesignId);
const marketRows=(s,category)=>{assert.equal(s.market.listingCollections,'DERIVED_FROM_CATEGORY');for(const field of ['materials','products','bios'])assert.equal(Object.hasOwn(s.market,field),false);return s.market.listings.filter(row=>row.category===category);};
function checkpointValue(v){if(Array.isArray(v))return v.map(checkpointValue);if(v&&typeof v==='object'){if(v.$bio==='bigint')return BigInt(v.value);if(v.$bio==='bytes')return Buffer.from(v.value,'base64');if(v.$bio==='map')return new Map(v.value.map(([k,value])=>[checkpointValue(k),checkpointValue(value)]));if(v.$bio==='set')return new Set(v.value.map(checkpointValue));return Object.fromEntries(Object.entries(v).map(([k,value])=>[k,checkpointValue(value)]));}return v;}
function checkMarketWork(r,row){const p=checkpointValue(r.exportState().data).protocol,root=p.settlement.roots.get(row.workId),facts=p.compositionRoots.get(row.workId);assert.equal(row.primitive,facts.primitive??null);assert.equal(row.profile,facts.profile??null);assert.equal(row.target,facts.target??null);assert.equal(row.qualityPpm,root.q_ppm.toString());assert.equal(row.quality,(Number(root.q_ppm)/1e6).toFixed(3));assert.equal(row.weight,root.weight.toString());assert.equal(row.B,root.B_int.toString());assert.ok(BigInt(row.qualityPpm)>0n&&BigInt(row.weight)>0n&&BigInt(row.B)>0n);assert.equal(Object.hasOwn(row,'graph'),false);if(facts.semantic)assert.equal(row.designId,Buffer.from(facts.semantic).toString('hex'));}

test('fresh simulation transfers legacy assets, retains model-earned credit and cannot change the old account',async()=>{
  const r=await fresh(),s=r.snapshot(),old=await createPlaytestRuntime({checkpoint:legacyCheckpoint});
  assert.equal(s.works.length,0);assert.deepEqual(s.materials.map(m=>m.amount),['0','0','0','0']);assert.equal(s.kits.length,0);
  assert.equal(s.lab.balanceAtoms,'48225840');assert.equal(s.labSim.starter.mode,'MODEL_EARNED_CREDIT');assert.equal(s.labSim.starter.transferredLegacyWorkIds.length,60);
  assert.equal(s.designs.length,17);assert.equal(targetRef(s).cost,'310');assert.equal(s.projects.length,1);
  assert.equal(old.snapshot().works.length,60);assert.deepEqual(old.snapshot().materials.map(m=>m.amount),['30','60','15','15']);
  assert.equal(JSON.stringify(legacyCheckpoint),pristine);assert.equal(s.labSim.unpacking,false);assert.equal(s.labSim.recycling,false);
  assert.equal(s.labSim.recipe[0].maxSpeciesTicks,'500');assert.equal(s.labSim.recipe[1].maxSpeciesTicks,'1000');assert.equal(s.labSim.recipe[2].maxSpeciesTicks,'250');
  assert.doesNotMatch(JSON.stringify(s),/[\u3400-\u9fff]/);
  const before=JSON.stringify(r.exportState());s.selectedGraph.cells[0].v=0;s.labSim.starter.earnedLABAtoms='999999999';s.designs[0].name='changed';assert.equal(JSON.stringify(r.exportState()),before);
});

test('creating four-class projects and buying material uses actual issuance, fixed fees, caps and per-project balances',async()=>{
  const r=await fresh(),before=r.snapshot();let s=act(r,'project-create',{name:'Helix laboratory',classes:classes()}),projectId=s.lastResult.projectId;
  assert.equal(s.projects.length,2);assert.equal(s.projects.find(p=>p.id===projectId).isOwn,true);
  assert.ok(BigInt(before.testSOL.balanceLamports)-BigInt(s.testSOL.balanceLamports)>=10000000n);
  const wallet=BigInt(s.testSOL.balanceLamports);s=act(r,'project-buy',{projectId,class:1,quantity:'3'});
  const p=s.projects.find(p=>p.id===projectId);assert.equal(p.classes[0].issued,'3');assert.equal(p.classes[0].ownedAmount,'3');assert.equal(p.classes[0].remaining,'997');
  // Own sale revenue returns to the owner, but the immutable resource charge
  // and actual host token-account rent are still paid.
  assert.equal(wallet-BigInt(s.testSOL.balanceLamports),301651n);
  assert.deepEqual(s.ledger.at(-1).materialAfter,['3','0','0','0']);assert.equal(s.market.invariants.testSOLConserved,true);
  unchanged(r,'project-buy',{projectId,class:1,quantity:'998'});
  for(const params of [{name:'Bad',classes:classes().slice(1)},{name:'Bad',classes:classes().map(c=>({...c,class:1}))},{name:'Bad',classes:classes().map(c=>({...c,lifetimeCap:'1000001'}))},{name:'Bad',classes:classes().map(c=>({...c,priceLamports:'-1'}))}])unchanged(r,'project-create',params);
});

test('one component is manufactured once; fractional species credits remain inventory rather than returning raw units',async()=>{
  const r=await fresh(),projectId=r.snapshot().selectedProjectId;let s=act(r,'project-buy-kit',{projectId});
  assert.equal(s.works.length,0);assert.deepEqual(s.materials.map(m=>m.amount),['30','60','15','15']);
  s=act(r,'manufacture-part',{primitive:4,profile:4});
  assert.equal(s.works.length,1);assert.equal(s.works[0].primitive,4);assert.equal(s.works[0].profile,4);assert.equal(s.works[0].B,'120000');
  assert.equal(s.works[0].descriptor,'01000404');assert.equal(s.lastResult.produced.length,1);
  assert.deepEqual(s.materials.map(m=>m.amount),['29','59','14','14']);
  assert.equal(s.labSim.recipe[0].sourceRemaining[0].ticks,'500');assert.equal(s.labSim.recipe[2].sourceRemaining[0].ticks,'750');
  assert.equal(BigInt(s.ledger.at(-1).sourceTicksAfter[0])-BigInt(s.ledger.at(-1).sourceTicksBefore[0]),10000n);
  for(const params of [{primitive:1,profile:4},{primitive:4,profile:0},{primitive:5,profile:1},{primitive:4,profile:16}])unchanged(r,'manufacture-part',params,'LAB_DESCRIPTOR');
});

test('first-component purchase buys four minimal units, repeats without cost, then reuses exact species credits',async()=>{
  const r=await fresh(),projectId=r.snapshot().selectedProjectId;let s=act(r,'project-buy-first-component',{projectId});
  assert.deepEqual(s.materials.map(m=>m.amount),['1','1','1','1']);assert.equal(s.works.length,0);assert.equal(s.kits.length,0);
  assert.deepEqual(s.lastResult.boughtUnits,[1,2,3,4].map(classId=>({class:classId,quantity:'1'})));assert.equal(s.lastResult.boughtUnitCount,'4');assert.deepEqual(s.lastResult.reusedClasses,[]);
  const before=s.testSOL.balanceLamports,materials=s.materials,lab=s.lab;s=act(r,'project-buy-first-component',{projectId});
  assert.equal(s.testSOL.balanceLamports,before);assert.deepEqual(s.materials,materials);assert.deepEqual(s.lab,lab);assert.equal(s.lastResult.boughtUnitCount,'0');assert.deepEqual(s.lastResult.reusedClasses,[1,2,3,4]);
  s=act(r,'manufacture-part',{primitive:1,profile:0});assert.equal(s.works.length,1);assert.deepEqual(s.materials.map(m=>m.amount),['0','0','0','0']);
  s=act(r,'project-buy-first-component',{projectId});assert.equal(s.lastResult.boughtUnitCount,'1');assert.deepEqual(s.lastResult.boughtUnits.map(row=>row.quantity),['0','1','0','0']);assert.deepEqual(s.lastResult.reusedClasses,[1,3,4]);
  assert.deepEqual(s.lastResult.requirements.map(row=>row.sourceCovered),[true,false,true,true]);assert.equal(s.works.length,1);
  s=act(r,'manufacture-part',{primitive:2,profile:0});assert.equal(s.works.length,2);
  unchanged(r,'project-buy-first-component',{projectId,quantity:'999'},'PLAYTEST_FIELDS');
});

test('first-component purchase fills only classes missing from partial compatible raw inventory',async()=>{
  const r=await fresh(),projectId=r.snapshot().selectedProjectId;act(r,'project-buy',{projectId,class:1,quantity:'1'});act(r,'project-buy',{projectId,class:4,quantity:'1'});
  const s=act(r,'project-buy-first-component',{projectId});assert.deepEqual(s.materials.map(m=>m.amount),['1','1','1','1']);assert.equal(s.lastResult.boughtUnitCount,'2');assert.deepEqual(s.lastResult.reusedClasses,[1,4]);
  assert.deepEqual(s.lastResult.requirements.map(row=>row.rawUnitsAvailable),['1','0','0','1']);assert.equal(s.works.length,0);
});

test('first-component purchase rolls back every earlier class, payment and nonce when a later issuance fails',async()=>{
  const r=await fresh();let s=act(r,'project-create',{name:'Limited first-component supply',classes:classes().map(c=>({...c,lifetimeCap:'1'}))}),projectId=s.lastResult.projectId;
  act(r,'project-buy',{projectId,class:4,quantity:'1'});act(r,'market-list',{assetType:'MATERIAL',projectId,class:4,quantity:'1'});
  unchanged(r,'project-buy-first-component',{projectId});s=r.snapshot();const p=s.projects.find(p=>p.id===projectId);
  assert.deepEqual(p.classes.map(c=>c.issued),['0','0','0','1']);assert.deepEqual(s.materials.map(m=>m.amount),['0','0','0','0']);assert.equal(s.works.length,0);
});

test('design editing rebases only the known identities and actual model validation guards persisted designs',async()=>{
  const r=await fresh(),base=targetRef(r.snapshot()),graph=structuredClone(base.graph??r.snapshot().selectedGraph);
  graph.domain='0'.repeat(64);graph.config='0'.repeat(64);graph.cells.find(c=>c.role===4).v=900000;
  let s=act(r,'design-save',{name:'Adaptive metabolic draft',graph,challenge:1500000}),saved=s.designs.find(d=>d.id===s.selectedDesignId);
  assert.equal(saved.isReference,false);assert.equal(s.selectedGraph.cells.find(c=>c.role===4).v,900000);assert.notEqual(s.selectedGraph.domain,'0'.repeat(64));assert.equal(s.lastResult.rounds,73);
  assert.equal(s.designs.length,18);assert.equal(s.works.length,0);
  const broken=structuredClone(graph);broken.cells.find(c=>c.role===4).v=0;unchanged(r,'design-save',{name:'Broken',graph:broken,challenge:2000000},'PROCESSOR');
  const foreign=structuredClone(graph);foreign.rule='1'.repeat(64);unchanged(r,'design-save',{name:'Foreign',graph:foreign,challenge:1500000},'LAB_GRAPH_IDENTITY');
  const injected=structuredClone(graph);injected.mintMore=true;unchanged(r,'design-test',{graph:injected,challenge:1500000},'LAB_FIELDS');
  const restored=await restoreLabSimulationRuntime(JSON.parse(JSON.stringify(r.exportState())));assert.deepEqual(restored.snapshot(),r.snapshot());
});

test('one component through an explicit reference fill, cells, organs and organism mines and exits with conserved accounting',async()=>{
  const r=await fresh(),projectId=r.snapshot().selectedProjectId;act(r,'project-buy-kit',{projectId});
  let s=act(r,'manufacture-part',{primitive:4,profile:4}),first=s.works[0].id;
  s=act(r,'manufacture-reference');assert.equal(s.lastResult.reusedComponentCount,1);assert.equal(s.lastResult.produced.length,59);assert.equal(s.works.length,60);
  assert.equal(s.labSim.referenceAssembly.missingComponentCount,0);assert.equal(s.labSim.referenceAssembly.readyKitId,s.lastResult.kitId);
  const materialBeforeRepeat=s.materials;s=act(r,'manufacture-reference');assert.equal(s.lastResult.produced.length,0);assert.equal(s.lastResult.reusedComponentCount,60);assert.deepEqual(s.materials,materialBeforeRepeat);
  const designId=s.selectedDesignId,used=new Set(),cells=[];
  for(let target=1;target<=15;target++){
    const inputs=[1,2,3,4].map(primitive=>{const part=s.works.find(w=>w.scope==='COMPONENT'&&w.primitive===primitive&&!used.has(w.id)&&(primitive!==4||w.profile===target));assert.ok(part);used.add(part.id);return part.id;});
    if(target===4)assert.ok(inputs.includes(first));
    s=act(r,'synthesize',{target,inputIds:inputs,designId,challenge:2000000});cells.push(s.lastResult.workId);
    if(target===1)unchanged(r,'synthesize',{target,inputIds:inputs,designId,challenge:2000000});
  }
  assert.equal(s.works.length,15);assert.equal(s.lab.manufactureBurnedAtoms,'12000000');
  const organs=[];for(const [i,roles]of ORGAN_CELLS.entries()){s=act(r,'synthesize',{target:16+i,inputIds:roles.map(role=>cells[role-1]),designId,challenge:2000000});organs.push(s.lastResult.workId);}
  assert.equal(s.works.length,6);assert.equal(s.lab.manufactureBurnedAtoms,'36000000');
  s=act(r,'synthesize',{target:22,inputIds:organs,designId,challenge:2000000});const bio=s.lastResult.workId;
  assert.equal(s.works.length,1);assert.equal(s.works[0].scope,'BIO');assert.equal(s.works[0].qualityPpm,'2000000');assert.equal(s.lab.manufactureBurnedAtoms,'48000000');assert.equal(s.lab.balanceAtoms,'225840');
  s=act(r,'stake',{workId:bio});assert.equal(s.lastResult.startHour,'339');
  unchanged(r,'market-list',{assetType:'WORK',workId:bio},'STAKE_LOCKED');
  s=act(r,'advance-hour',{hours:2});assert.ok(BigInt(s.lab.unclaimedAtoms)>0n);const unpaid=BigInt(s.lab.unclaimedAtoms),balance=BigInt(s.lab.balanceAtoms);
  s=act(r,'claim');assert.equal(BigInt(s.lab.balanceAtoms),balance+unpaid);assert.equal(s.lab.unclaimedAtoms,'0');unchanged(r,'claim',{},'PLAYTEST_NOTHING_TO_CLAIM');
  s=act(r,'exit',{workId:bio});unchanged(r,'market-list',{assetType:'WORK',workId:bio},'STAKE_LOCKED');s=act(r,'advance-hour',{hours:1});
  s=act(r,'market-list',{assetType:'WORK',workId:bio,priceLamports:'88000000'});assert.equal(marketRows(s,'BIO').find(l=>l.id===s.lastResult.listingId).priceLamports,'88000000');
  checkMarketWork(r,marketRows(s,'BIO').find(l=>l.id===s.lastResult.listingId));assert.equal(marketRows(s,'BIO').find(l=>l.id===s.lastResult.listingId).target,22);
  const id=s.lastResult.listingId;s=act(r,'market-cancel',{listingId:id});assert.ok(s.works.some(w=>w.id===bio));assert.equal(s.ledgerInvariant.valid,true);
  assert.doesNotMatch(JSON.stringify(s),/[\u3400-\u9fff]/);
});

test('multi-project raw and product markets conserve inventory and money across escrow, cancel and trade',async()=>{
  const r=await fresh();let s=act(r,'project-create',{name:'Market laboratory',classes:classes()}),projectId=s.lastResult.projectId;
  s=act(r,'project-buy-kit',{projectId});const initialSOL=BigInt(s.testSOL.balanceLamports);
  s=act(r,'market-list',{assetType:'MATERIAL',projectId,class:1,quantity:'2',priceLamports:'1234567'});let listingId=s.lastResult.listingId;
  assert.equal(s.projects.find(p=>p.id===projectId).classes[0].ownedAmount,'28');assert.equal(marketRows(s,'MATERIAL').find(l=>l.id===listingId).projectId,projectId);
  unchanged(r,'market-buy',{listingId},'MARKET_SELF_TRADE');
  s=act(r,'market-cancel',{listingId});assert.equal(s.projects.find(p=>p.id===projectId).classes[0].ownedAmount,'30');
  s=act(r,'market-list',{assetType:'MATERIAL',projectId,class:1,quantity:'1',priceLamports:'1234567'});listingId=s.lastResult.listingId;
  const before=BigInt(s.testSOL.balanceLamports);s=act(r,'market-test-counterparty-buy',{listingId});assert.equal(BigInt(s.testSOL.balanceLamports)-before,1234567n); // buyer pays its newly created ATA rent; seller receives the full price
  assert.ok(BigInt(s.testSOL.balanceLamports)>initialSOL);assert.equal(s.market.invariants.materialSupplyValid,true);
  const offer=marketRows(s,'PRODUCT').find(l=>l.canBuy);s=act(r,'market-buy',{listingId:offer.id});const work=s.works.find(w=>w.id===offer.workId);assert.ok(work);
  s=act(r,'market-list',{assetType:'WORK',workId:work.id,priceLamports:'7654321'});listingId=s.lastResult.listingId;assert.equal(s.works.some(w=>w.id===work.id),false);unchanged(r,'stake',{workId:work.id},'PLAYTEST_WORK_UNAVAILABLE');
  s=act(r,'market-cancel',{listingId});assert.equal(s.works.some(w=>w.id===work.id),true);
});

test('market work previews expose actual descriptors, quality and weight without mutable references or material-field changes',async()=>{
  const r=await fresh();let s=r.snapshot(),offer=marketRows(s,'PRODUCT').find(l=>l.canBuy);checkMarketWork(r,offer);assert.equal(offer.primitive,1);assert.equal(offer.profile,0);
  for(const raw of marketRows(s,'MATERIAL'))for(const field of ['primitive','profile','target','qualityPpm','quality','weight','B','designId'])assert.equal(Object.hasOwn(raw,field),false);
  s=act(r,'market-buy',{listingId:offer.id});const sellable=s.market.sellableWorks.find(w=>w.workId===offer.workId);checkMarketWork(r,sellable);
  act(r,'project-buy-kit',{projectId:s.selectedProjectId});s=act(r,'manufacture-part',{primitive:4,profile:4});const made=s.lastResult.workId;
  s=act(r,'market-list',{assetType:'WORK',workId:made,priceLamports:'3000000'});const listed=marketRows(s,'PRODUCT').find(l=>l.id===s.lastResult.listingId);checkMarketWork(r,listed);assert.equal(listed.primitive,4);assert.equal(listed.profile,4);
  const before=JSON.stringify(r.exportState());listed.qualityPpm='9999999';listed.weight='0';s.market.sellableWorks[0].profile=15;assert.equal(JSON.stringify(r.exportState()),before);
});

test('single-work launch persists a real sale registry and derives cancel, relaunch and sold history from actual listings',async()=>{
  const r=await fresh();act(r,'project-buy-first-component',{projectId:r.snapshot().selectedProjectId});let s=act(r,'manufacture-part',{primitive:1,profile:0}),workId=s.lastResult.workId;
  const before=s,request={workId,title:'First exchange specimen',description:'One existing manufactured specimen.',priceLamports:'3000000'};
  s=act(r,'work-launch',request);assert.equal(s.workLaunches.length,1);const first=s.workLaunches[0];assert.equal(first.oneOnly,true);assert.equal(first.supply,'1');assert.equal(first.remainingSupply,'1');assert.equal(first.status,'OPEN');assert.equal(first.author,s.account.id);assert.equal(first.scope,'LOCAL_ACCOUNT_LEDGER');
  assert.equal(first.workId,workId);assert.equal(first.publishedHour,s.testHour);assert.equal(s.works.length,0);assert.equal(s.counts.roots,before.counts.roots);assert.deepEqual(s.materials,before.materials);assert.deepEqual(s.lab,before.lab);assert.equal(s.testSOL.balanceLamports,before.testSOL.balanceLamports);
  const listing=marketRows(s,'PRODUCT').find(l=>l.id===first.listingId);assert.equal(listing.workId,workId);assert.equal(listing.launchRef,first.id);assert.equal(Object.hasOwn(listing,'launch'),false);assert.equal(s.workLaunches.find(record=>record.id===listing.launchRef).title,request.title);assert.equal(s.workLaunches.find(record=>record.id===listing.launchRef).description,request.description);
  unchanged(r,'work-launch',request,'LAB_LAUNCH_OWNER');const checkpoint=JSON.parse(JSON.stringify(r.exportState())),restored=await restoreLabSimulationRuntime(checkpoint);assert.deepEqual(restored.snapshot(),s);
  const readonlyBefore=JSON.stringify(r.exportState());s.workLaunches[0].title='changed';listing.launchRef='changed';assert.equal(JSON.stringify(r.exportState()),readonlyBefore);
  s=act(r,'market-cancel',{listingId:first.listingId});assert.equal(s.workLaunches[0].status,'CANCELLED');assert.equal(s.workLaunches[0].remainingSupply,'0');assert.ok(s.works.some(w=>w.id===workId));
  s=act(r,'work-launch',{...request,title:'Same specimen, new sale'});const second=s.workLaunches[0];assert.notEqual(second.id,first.id);assert.equal(second.workId,first.workId);assert.equal(s.workLaunches.length,2);assert.equal(s.workLaunches.filter(l=>l.status==='OPEN').length,1);
  const funds=BigInt(s.testSOL.balanceLamports);s=act(r,'market-test-counterparty-buy',{listingId:second.listingId});assert.equal(s.workLaunches[0].status,'SOLD');assert.equal(s.workLaunches[0].remainingSupply,'0');assert.equal(BigInt(s.testSOL.balanceLamports)-funds,3000000n);assert.equal(s.counts.roots,before.counts.roots);assert.deepEqual(s.lab,before.lab);
});

test('single-work launch enforces exact UTF-8 metadata, positive price, strict fields and manufactured ownership',async()=>{
  const r=await fresh();act(r,'project-buy-first-component',{projectId:r.snapshot().selectedProjectId});const made=act(r,'manufacture-part',{primitive:1,profile:0}),workId=made.lastResult.workId,valid={workId,title:'🧬'.repeat(12),description:'🧪'.repeat(40),priceLamports:'1'};
  for(const update of [{title:'🧬'.repeat(13)},{title:'x'.repeat(49)},{description:'x'.repeat(161)},{title:'\ud800'},{description:'\udc00'},{title:'\u0000bad'},{title:''},{title:' leading'},{priceLamports:'0'},{priceLamports:'01'},{priceLamports:1},{description:undefined},{author:'1'.repeat(64)},{supply:'2'}])unchanged(r,'work-launch',{...valid,...update});
  unchanged(r,'work-launch',{...valid,workId:r.snapshot().selectedDesignId});assert.equal(r.snapshot().workLaunches.length,0);
  const s=act(r,'work-launch',valid);assert.equal(Buffer.byteLength(s.workLaunches[0].title,'utf8'),48);assert.equal(Buffer.byteLength(s.workLaunches[0].description,'utf8'),160);assert.equal(s.workLaunches[0].assetType,'WORK');
});

test('single-work launch refuses a staked or exiting specimen until its actual unlock boundary',async()=>{
  const r=await fresh();act(r,'project-buy-first-component',{projectId:r.snapshot().selectedProjectId});const made=act(r,'manufacture-part',{primitive:1,profile:0}),workId=made.lastResult.workId,request={workId,title:'Unlocked sale only',description:'',priceLamports:'1000000'};
  act(r,'stake',{workId});unchanged(r,'work-launch',request,'STAKE_LOCKED');act(r,'advance-hour',{hours:2});act(r,'exit',{workId});unchanged(r,'work-launch',request,'STAKE_LOCKED');
  act(r,'advance-hour',{hours:1});const s=act(r,'work-launch',request);assert.equal(s.workLaunches[0].status,'OPEN');assert.equal(s.workLaunches[0].workId,workId);
});

test('explicit bulk assembly follows a selected free design through all layers and fixed support fixtures',async()=>{
  const r=await fresh();let s=r.snapshot(),graph=structuredClone(s.selectedGraph);graph.cells.find(c=>c.role===4).v=900000;
  s=act(r,'design-save',{name:'Adaptive bulk organism',graph,challenge:1500000});const design=targetRef(s);
  act(r,'project-buy-kit',{projectId:s.selectedProjectId});s=act(r,'manufacture-reference');const kitId=s.lastResult.kitId;
  s=act(r,'synthesize-cells',{kitId});assert.equal(s.works.length,15);
  assert.equal(s.works.find(w=>w.target===3).qualityPpm,'1000000');
  s=act(r,'synthesize-organs',{kitId});assert.equal(s.works.length,6);
  s=act(r,'synthesize-bio',{kitId});assert.equal(s.works.length,1);assert.equal(s.works[0].qualityPpm,design.qualityPpm);
  assert.ok(BigInt(s.works[0].qualityPpm)<2000000n);assert.equal(s.selectedGraph.cells.find(c=>c.role===4).v,900000);assert.equal(s.lab.manufactureBurnedAtoms,'48000000');
});

const origin='http://localhost:4318',id=n=>n.toString(16).padStart(64,'0');
async function request(api,{method='GET',url='/api/lab-sim/state',cookie,body,source=origin}={}){const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url,headers:{host:'localhost:4318',...(cookie?{cookie}:{}),...(method==='POST'?{'content-type':'application/json',origin:source,'sec-fetch-site':'same-origin'}:{})}});const out={};out.handled=await api.handler(req,{writeHead(status,headers){out.status=status;out.headers=headers;},end(bytes){out.body=JSON.parse(bytes);}});return out;}
async function setup(t){const directory=await mkdtemp(path.join(await realpath(tmpdir()),'mogusbio-lab-sim-'));t.after(()=>rm(directory,{recursive:true,force:true}));const api=await createPlaytestHTTP({origin,directory,checkpoint:legacyCheckpoint,basePath:'/api/lab-sim'}),start=await request(api,{method:'POST',url:'/api/lab-sim/start',body:{requestId:id(1)}});assert.equal(start.status,200);return{api,directory,start:start.body,cookie:start.headers['set-cookie'].split(';')[0],cookieHeader:start.headers['set-cookie']};}
const envelope=(state,n,action,params={})=>({runId:state.runId,revision:state.revision,requestId:id(n),action,params});

test('lab HTTP is namespaced, cookie isolated and idempotent across concurrent delivery and restart',async t=>{
  const f=await setup(t);assert.match(f.cookieHeader,/Path=\/api\/lab-sim; HttpOnly; SameSite=Strict/);assert.equal((await request(f.api,{url:'/api/playtest/state',cookie:f.cookie})).handled,false);
  const unauthenticated=await request(f.api);assert.equal(unauthenticated.body.authenticated,false);assert.equal(unauthenticated.body.networkSubmitted,false);
  const body=envelope(f.start,2,'project-buy-kit',{projectId:f.start.state.selectedProjectId}),rows=await Promise.all([request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body}),request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body})]);
  assert.equal(rows[0].status,200);assert.deepEqual(rows[0].body,rows[1].body);assert.equal(rows[0].body.revision,'1');assert.deepEqual(rows[0].body.state.materials.map(m=>m.amount),['30','60','15','15']);
  const restarted=await createPlaytestHTTP({origin,directory:f.directory,checkpoint:legacyCheckpoint,basePath:'/api/lab-sim'});assert.deepEqual((await request(restarted,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body})).body,rows[0].body);
  const foreign=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body:envelope(rows[0].body,3,'manufacture-part',{primitive:1,profile:0}),source:'https://evil.invalid'});assert.equal(foreign.status,400);assert.equal((await request(f.api,{cookie:f.cookie})).body.revision,'1');
});

test('lab HTTP accepts bounded real graph bodies, rejects forged quantities and resets only the isolated run',async t=>{
  const f=await setup(t),graph=f.start.state.selectedGraph,save=envelope(f.start,2,'design-save',{name:'Public reference',graph,challenge:2000000});assert.ok(Buffer.byteLength(JSON.stringify(save))>4096);
  const stored=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body:save});assert.equal(stored.status,200);
  const failed=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body:envelope(stored.body,3,'project-buy',{projectId:f.start.state.selectedProjectId,class:1,quantity:'999999999999999999999999'})});assert.equal(failed.status,400);assert.equal((await request(f.api,{cookie:f.cookie})).body.revision,'1');
  const resetBody={runId:stored.body.runId,revision:stored.body.revision,requestId:id(4)},reset=await request(f.api,{method:'POST',url:'/api/lab-sim/reset',cookie:f.cookie,body:resetBody});assert.equal(reset.status,200);assert.notEqual(reset.body.runId,f.start.runId);assert.equal(reset.body.state.works.length,0);assert.equal(reset.body.state.lab.balanceAtoms,'48225840');
  assert.deepEqual((await request(f.api,{method:'POST',url:'/api/lab-sim/reset',cookie:f.cookie,body:resetBody})).body,reset.body);
  assert.equal(JSON.stringify(legacyCheckpoint),pristine);
});

test('lab HTTP routes one minimal purchase atomically, replays its receipt and does not manufacture',async t=>{
  const f=await setup(t),body=envelope(f.start,2,'project-buy-first-component',{projectId:f.start.state.selectedProjectId});
  const rows=await Promise.all([request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body}),request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body})]);
  assert.equal(rows[0].status,200);assert.deepEqual(rows[0].body,rows[1].body);assert.equal(rows[0].body.state.lastResult.boughtUnitCount,'4');assert.equal(rows[0].body.state.works.length,0);
  const repeated=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body:envelope(rows[0].body,3,'project-buy-first-component',{projectId:f.start.state.selectedProjectId})});
  assert.equal(repeated.status,200);assert.equal(repeated.body.state.lastResult.boughtUnitCount,'0');assert.equal(repeated.body.state.testSOL.balanceLamports,rows[0].body.state.testSOL.balanceLamports);
  assert.deepEqual(repeated.body.state.materials.map(m=>m.amount),['1','1','1','1']);
});

test('lab HTTP preserves its saved revision and full ledger when the last minimal-purchase class is sold out',async t=>{
  const f=await setup(t);let current=f.start,sequence=2;
  const execute=async(action,params)=>{const reply=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body:envelope(current,sequence++,action,params)});assert.equal(reply.status,200);current=reply.body;return current;};
  const created=await execute('project-create',{name:'Atomic starter materials',classes:classes().map(c=>({...c,lifetimeCap:'1'}))}),projectId=created.state.lastResult.projectId;
  await execute('project-buy',{projectId,class:4,quantity:'1'});await execute('market-list',{assetType:'MATERIAL',projectId,class:4,quantity:'1'});
  const before=await request(f.api,{cookie:f.cookie}),failed=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body:envelope(current,sequence,'project-buy-first-component',{projectId})});
  assert.equal(failed.status,400);assert.deepEqual((await request(f.api,{cookie:f.cookie})).body,before.body);
});

test('lab HTTP creates one single-work launch for concurrent retries and keeps its registry inside the account ledger',async t=>{
  const f=await setup(t);let current=f.start;
  for(const [n,action,params]of [[2,'project-buy-first-component',{projectId:current.state.selectedProjectId}],[3,'manufacture-part',{primitive:1,profile:0}]]){const reply=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body:envelope(current,n,action,params)});assert.equal(reply.status,200);current=reply.body;}
  const workId=current.state.lastResult.workId,body=envelope(current,4,'work-launch',{workId,title:'Published single specimen',description:'Existing asset, supply one.',priceLamports:'2500000'}),rows=await Promise.all([request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body}),request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:f.cookie,body})]);
  assert.equal(rows[0].status,200);assert.deepEqual(rows[0].body,rows[1].body);assert.equal(rows[0].body.state.workLaunches.length,1);assert.equal(rows[0].body.state.workLaunches[0].supply,'1');assert.equal(rows[0].body.state.works.length,0);
  const other=await request(f.api,{method:'POST',url:'/api/lab-sim/start',body:{requestId:id(90)}}),otherCookie=other.headers['set-cookie'].split(';')[0];assert.equal(other.status,200);assert.deepEqual(other.body.state.workLaunches,[]);
  const foreign=await request(f.api,{method:'POST',url:'/api/lab-sim/action',cookie:otherCookie,body});assert.equal(foreign.status,409);assert.equal((await request(f.api,{cookie:otherCookie})).body.state.workLaunches.length,0);
});
