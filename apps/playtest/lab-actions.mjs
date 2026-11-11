import {createHash} from 'node:crypto';
import {encodeGraph,decodeGraph,validateGraph,validateDesign,designId,projectGraph} from '../../packages/biology/src/index.mjs';
import {applyLaunchpad,encodeCreatePayload,encodeBuyPayload,CREATE_FEE,RESOURCE_FEE_PER_UNIT,materialSeason,SEASON_CAPS,LIFETIME_CAPS} from '../../packages/launchpad/src/index.mjs';
import {catalogHash,F1_BOM,materialClass,RU_TO_TICK} from '../../packages/protocol-core/src/index.mjs';
import {decodeSynthesisPayload,readSealedArtifact} from '../../packages/composition/src/index.mjs';
import {createLabHostMarket,LAB_MARKET_ACTION_FIELDS} from './lab-market.mjs';
import {createLabAppearanceIndex} from './lab-appearance.mjs';

const hex=x=>Buffer.from(x).toString('hex');
const hash=x=>createHash('sha256').update(x).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const fail=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const exact=(value,keys)=>fail(plain(value)&&Object.keys(value).every(k=>keys.includes(k)),'LAB_FIELDS');
const id=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const uint=(x,max=(1n<<64n)-1n,{zero=false}={})=>{fail(typeof x==='string'&&(zero?/^(?:0|[1-9]\d{0,19})$/:/^[1-9]\d{0,19}$/).test(x),'LAB_INTEGER');const n=BigInt(x);fail(n<=max,'LAB_INTEGER');return n;};
const title=x=>{fail(typeof x==='string'&&x.trim()===x&&Buffer.byteLength(x)>=1&&Buffer.byteLength(x)<=64&&!/[\u0000-\u001f\u007f]/.test(x),'LAB_NAME');return x;};
const launchText=(value,minimum,maximum)=>fail(typeof value==='string'&&value.trim()===value&&Buffer.from(value,'utf8').toString('utf8')===value&&Buffer.byteLength(value,'utf8')>=minimum&&Buffer.byteLength(value,'utf8')<=maximum&&!/[\u0000-\u001f\u007f]/.test(value),'LAB_LAUNCH_TEXT');
const challenge=x=>fail(Number.isSafeInteger(x)&&x>=500000&&x<=2000000&&x%1000===0,'LAB_CHALLENGE');
const publicGraph=g=>({...structuredClone(g),...Object.fromEntries(['domain','config','catalog','rule'].map(k=>[k,hex(g[k])]))});
export const LAB_ACTION_FIELDS=Object.freeze({
  'project-create':['name','classes'],'project-select':['projectId'],'project-buy':['projectId','class','quantity'],'project-buy-kit':['projectId'],'project-buy-first-component':['projectId'],
  'design-save':['name','graph','challenge'],'design-test':['graph','challenge'],'design-select':['designId'],
  'manufacture-part':['primitive','profile'],'manufacture-reference':[],'synthesize':['target','inputIds','designId','challenge'],'work-launch':['workId','title','description','priceLamports'],...LAB_MARKET_ACTION_FIELDS
});
export function validateLabAction(action,params){
  fail(Object.hasOwn(LAB_ACTION_FIELDS,action),'LAB_ACTION');exact(params,LAB_ACTION_FIELDS[action]);
  if(action==='project-create'){title(params.name);fail(Array.isArray(params.classes)&&params.classes.length===4,'LAB_CLASSES');for(const [i,c]of params.classes.entries()){exact(c,['class','lifetimeCap','priceLamports']);fail(c.class===i+1,'LAB_CLASSES');uint(c.lifetimeCap,1000000n);uint(c.priceLamports,(1n<<64n)-1n-RESOURCE_FEE_PER_UNIT,{zero:true});}}
  if(['project-select','project-buy','project-buy-kit','project-buy-first-component'].includes(action))fail(id(params.projectId),'LAB_PROJECT');
  if(action==='project-buy'){fail(Number.isInteger(params.class)&&params.class>=1&&params.class<=4,'LAB_CLASS');uint(params.quantity,1000n);}
  if(['design-save','design-test'].includes(action)){if(action==='design-save')title(params.name);fail(plain(params.graph),'LAB_GRAPH');challenge(params.challenge);}
  if(action==='design-select')fail(id(params.designId),'LAB_DESIGN');
  if(action==='manufacture-part')fail(Number.isInteger(params.primitive)&&params.primitive>=1&&params.primitive<=4&&Number.isInteger(params.profile)&&(params.primitive===4?params.profile>=1&&params.profile<=15:params.profile===0),'LAB_DESCRIPTOR');
  if(action==='synthesize'){fail(Number.isInteger(params.target)&&params.target>=1&&params.target<=22&&Array.isArray(params.inputIds)&&params.inputIds.length>=2&&params.inputIds.length<=6&&params.inputIds.every(id)&&new Set(params.inputIds).size===params.inputIds.length,'LAB_INPUTS');if(params.designId!==undefined)fail(id(params.designId),'LAB_DESIGN');if(params.challenge!==undefined)challenge(params.challenge);}
  if(action==='work-launch'){fail(id(params.workId),'LAB_WORK');launchText(params.title,1,48);launchText(params.description,0,160);uint(params.priceLamports);}
  if(action==='market-list'){fail(['MATERIAL','WORK'].includes(params.assetType),'LAB_ASSET');if(params.assetType==='MATERIAL'){fail(Number.isInteger(params.class)&&params.class>=1&&params.class<=4&&!('workId'in params),'LAB_ASSET');if(params.projectId!==undefined)fail(id(params.projectId),'LAB_PROJECT');if(params.quantity!==undefined)uint(params.quantity,1000n);}else fail(id(params.workId)&&!('class'in params)&&!('quantity'in params)&&!('projectId'in params),'LAB_ASSET');if(params.priceLamports!==undefined)uint(params.priceLamports);}
  else if(action.startsWith('market-'))fail(id(params.listingId),'LAB_LISTING');
}

export function createLabActions({BASE,BUYER,COUNTERPARTY,MARKET_ESCROW,context,frame,manufactureOne,makeParent,engineFor,novelty}){
  const actor=hex(BUYER),other=hex(COUNTERPARTY),kitUnits=[30n,60n,15n,15n];
  const name=(r,f)=>r.scope==='COMPONENT'?`Functional component ${f.primitive}${f.primitive===4?` / C${String(f.profile).padStart(2,'0')}`:''}`:r.scope==='CELL'?`Functional cell C${String(f.target).padStart(2,'0')}`:r.scope==='ORGAN'?`Functional organ O${String(f.target-15).padStart(2,'0')}`:'Digital organism';
  const market=createLabHostMarket({domain:BASE.domain,player:BUYER,counterparty:COUNTERPARTY,escrow:MARKET_ESCROW,deriveAtaAddress:(mint,owner)=>context().deriveAtaAddress(mint,owner),minimumBalance:length=>context().minimumBalance(length),workName:name});
  function parseGraph(value){
    exact(value,['domain','config','catalog','rule','target','nodes','cells','tiers','edges','opens','slots']);
    fail(Object.keys(value).length===11&&value.target===22,'LAB_GRAPH');
    for(const [field,keys]of [['nodes',['scope','kind','role','parent']],['cells',['role','v']],['tiers',['scope','mode']],['edges',['owner','type','src','dst','fraction']],['opens',['role','species','remaining']],['slots',['role','x','y']]]){
      fail(Array.isArray(value[field])&&value[field].length<=440,'LAB_GRAPH');for(const row of value[field]){exact(row,keys);fail(Object.keys(row).length===keys.length,'LAB_GRAPH');if(field==='edges')for(const endpoint of [row.src,row.dst]){exact(endpoint,['kind','role','sub','port']);fail(Object.keys(endpoint).length===4,'LAB_GRAPH');}}
    }
    for(const k of ['domain','config','catalog','rule'])fail(id(value[k]),'LAB_GRAPH_IDENTITY');
    for(const k of ['domain','config'])fail([hex(BASE[k]),'0'.repeat(64)].includes(value[k]),'LAB_GRAPH_IDENTITY');
    for(const k of ['catalog','rule'])fail(value[k]===hex(BASE[k]),'LAB_GRAPH_IDENTITY');
    const graph={...structuredClone(value),...Object.fromEntries(['domain','config','catalog','rule'].map(k=>[k,Buffer.from(BASE[k])]))};
    validateGraph(graph,BASE);return decodeGraph(encodeGraph(graph));
  }
  function initialize(s){
    if(s.labSim){fail(s.labSim.profile==='BIO-LAB-SIM1'&&s.labSim.designs instanceof Map&&s.protocol.projects.has(s.labSim.selectedProjectId),'LAB_STATE');s.labSim.workLaunches??=new Map();fail(s.labSim.workLaunches instanceof Map,'LAB_STATE');market.assertInvariants(s);return;}
    // Move actual legacy reference assets out of the fresh account. Historic
    // beneficiaries and their earned LAB remain unchanged; nothing is minted.
    const e=engineFor(s),moved=[];
    for(const r of e.snapshot().roots.values())if(r.owner===actor&&r.status==='LIVE'){
      e.executePrepared('transfer',{actor,instance:r.instance,newOwner:other,now:s.now});const updated=e.root(r.instance),facts=s.protocol.compositionRoots.get(r.instance);Buffer.from(other,'hex').copy(facts.wireBytes,322);facts.wireBytes.writeBigUInt64LE(updated.revision,354);moved.push(r.instance);
    }
    s.protocol.settlement=e.snapshot();
    for(const l of s.market.listings.values())l.name=l.assetType==='MATERIAL'?`${['AA','NUC','LIPID','SUGAR'][l.class-1]} material`:name(e.root(l.workId),s.protocol.compositionRoots.get(l.workId));
    const transferred=[];for(const [projectId,p]of s.protocol.projects)for(const c of p.classes){const token=[...s.protocol.tokens.values()].find(t=>hex(t.owner)===actor&&hex(t.mint)===hex(c.mint));if(token?.amount>0n){const quantity=token.amount;market.transferStarterMaterial(s,c.mint,BUYER,COUNTERPARTY,quantity);transferred.push({projectId,class:c.class,quantity:quantity.toString()});}}
    const residual=[...s.protocol.sources.values()].filter(source=>hex(source.inventoryOwner)===actor).reduce((n,source)=>n+source.initialTick.reduce((a,t,i)=>a+t-source.spentPrefix[i],0n),0n);
    const designs=new Map();for(const [i,graph]of novelty.publishedGraphs().entries()){const report=validateDesign(graph,{challenge:2000000}),id=hex(designId(graph));designs.set(id,{id,name:`C${report.C}${i===9?' A':i===10?' B':''}`,graph,challenge:2000000,qualityPpm:report.q_ppm.toString(),cost:report.C.toString(),isReference:true});}
    const selected=[...designs.values()].find(d=>d.cost==='310').id;
    s.kits=[];s.selectedKitId=null;s.nextKit=1;
    s.labSim={profile:'BIO-LAB-SIM1',selectedProjectId:s.projectId,selectedDesignId:selected,designs,workLaunches:new Map(),starter:{mode:'MODEL_EARNED_CREDIT',historyHours:'338',earnedLABAtoms:e.balance(actor).toString(),transferredLegacyWorkIds:moved,transferredLegacyMaterials:transferred,residualMaterialTicks:residual.toString(),message:'Starting test LAB was earned by the reference model over 338 simulated hours. Legacy works and raw units were transferred to the simulated counterparty; Remaining unused species credits from that history are retained and disclosed below; no new LAB was granted.'}};
    s.ledger=[];s.sequence=0;s.lastResult={status:'READY',message:'Your isolated laboratory is ready. Buy materials and manufacture your first individual component.'};market.assertInvariants(s);
  }
  function buy(s,projectId,classId,quantity){const p=s.protocol.projects.get(projectId);fail(p,'LAB_PROJECT');const c=p.classes[classId-1],ctx=context(s.now,++s.slot),payload=encodeBuyPayload({projectId:Buffer.from(projectId,'hex'),class:classId,mint:c.mint,catalogHash:catalogHash(),quantity,principalPayer:BUYER,materialRecipient:BUYER,destinationToken:ctx.deriveAtaAddress(c.mint,BUYER),destinationMode:1,saleRecipient:p.saleRecipient,unitPriceLamports:c.priceLamports,resourcePerUnitLamports:RESOURCE_FEE_PER_UNIT,maxProtocolLamports:(1n<<64n)-1n,rentPayer:BUYER,maxRentLamports:100000000n,expectedSeason:materialSeason(s.now,0n)});s.protocol=applyLaunchpad(s.protocol,frame(s.protocol,202,payload,BUYER),ctx).state;}
  function componentRequirements(s){
    return[1,2,3,4].map(classId=>{
      const species=materialClass(classId).species.filter(i=>F1_BOM[i-1]>0n),maximum=species.reduce((n,i)=>F1_BOM[i-1]>n?F1_BOM[i-1]:n,0n),intakeUnits=(maximum+RU_TO_TICK-1n)/RU_TO_TICK;
      // Mirror P5's actual planner: one source must cover all required species
      // of its class. Unused species credits are inventory, never recycled work.
      const sourceCovered=[...s.protocol.sources.values()].some(source=>source.class===classId&&hex(source.inventoryOwner)===actor&&species.every(i=>source.initialTick[i-1]-source.spentPrefix[i-1]>=F1_BOM[i-1]));
      const mints=new Set([...s.protocol.projects.values()].filter(p=>hex(p.catalogHash)===hex(BASE.catalog)).map(p=>hex(p.classes[classId-1].mint)));
      const rawUnits=[...s.protocol.tokens.values()].filter(t=>hex(t.owner)===actor&&mints.has(hex(t.mint))&&t.initialized===true&&t.native===false&&t.frozen!==true).reduce((n,t)=>n+t.amount,0n);
      const quantity=sourceCovered||rawUnits>=intakeUnits?0n:intakeUnits-rawUnits;
      return{class:classId,quantity:quantity.toString(),sourceCovered,rawUnitsAvailable:rawUnits.toString()};
    });
  }
  function execute(s,action,p){
    validateLabAction(action,p);
    if(action.startsWith('market-'))return market.execute(s,action,p);
    // A local publication record for one already manufactured Root. The
    // existing market owns escrow/payment/transfer; this registry grants no
    // edition, token, blueprint license, originality award or global exposure.
    if(action==='work-launch'){
      const e=engineFor(s),root=e.root(p.workId);fail(root.owner===actor&&root.status==='LIVE','LAB_LAUNCH_OWNER');e.assertCanConsume(p.workId,s.now);
      const listed=market.execute(s,'market-list',{assetType:'WORK',workId:p.workId,priceLamports:p.priceLamports}),launchId=hash(`BIO-LAB-WORK-LAUNCH1\0${hex(BASE.domain)}\0${listed.listingId}`);
      s.labSim.workLaunches??=new Map();fail(!s.labSim.workLaunches.has(launchId),'LAB_LAUNCH_EXISTS');
      s.labSim.workLaunches.set(launchId,{profile:'BIO-WORK-LAUNCH1',id:launchId,title:p.title,description:p.description,publishedHour:((s.now-s.protocol.settlement.rewardStart)/3600n).toString(),assetType:'WORK',workId:p.workId,listingId:listed.listingId,author:actor,oneOnly:true,supply:'1',priceLamports:listed.priceLamports,scope:'LOCAL_ACCOUNT_LEDGER'});
      return{message:'Your existing specimen was published as a single-work sale and moved into listing escrow. No additional specimen, token or reward was created.',launchId,listingId:listed.listingId,workId:p.workId,oneOnly:true,supply:'1',priceLamports:listed.priceLamports};
    }
    if(action==='project-select'){fail(s.protocol.projects.has(p.projectId),'LAB_PROJECT');s.labSim.selectedProjectId=p.projectId;return{message:'Material project selected.',projectId:p.projectId};}
    if(action==='project-create'){fail(s.protocol.projects.size<16,'LAB_PROJECT_LIMIT');const payload=encodeCreatePayload({catalogHash:catalogHash(),saleRecipient:BUYER,principalPayer:BUYER,rentPayer:BUYER,maxProtocolLamports:CREATE_FEE,maxRentLamports:100000000n,name:p.name,classes:p.classes.map(c=>({class:c.class,lifetimeCap:BigInt(c.lifetimeCap),priceLamports:BigInt(c.priceLamports)}))}),before=new Set(s.protocol.projects.keys());s.protocol=applyLaunchpad(s.protocol,frame(s.protocol,201,payload,BUYER),context(s.now,++s.slot)).state;const projectId=[...s.protocol.projects.keys()].find(id=>!before.has(id));s.labSim.selectedProjectId=projectId;return{message:'A laboratory project with four fixed material classes was created.',projectId};}
    if(action==='project-buy'||action==='project-buy-kit'){if(action==='project-buy')buy(s,p.projectId,p.class,BigInt(p.quantity));else for(let c=1;c<=4;c++)buy(s,p.projectId,c,kitUnits[c-1]);s.labSim.selectedProjectId=p.projectId;return{message:action==='project-buy'?'Purchased material units were delivered.':'Purchased 120 individual material units: 30 AA, 60 NUC, 15 LIPID and 15 SUGAR.',projectId:p.projectId};}
    if(action==='project-buy-first-component'){
      fail(s.protocol.projects.has(p.projectId),'LAB_PROJECT');const requirements=componentRequirements(s),boughtUnits=requirements.map(({class:classId,quantity})=>({class:classId,quantity})),reusedClasses=requirements.filter(r=>r.quantity==='0').map(r=>r.class);
      for(const row of requirements)if(BigInt(row.quantity)>0n)buy(s,p.projectId,row.class,BigInt(row.quantity));
      s.labSim.selectedProjectId=p.projectId;const boughtUnitCount=requirements.reduce((n,r)=>n+BigInt(r.quantity),0n).toString();
      return{message:boughtUnitCount==='0'?'Existing material units and species inventory already cover one component. Nothing was purchased.':`Purchased only the ${boughtUnitCount} missing direct material unit(s) for one component. No component was manufactured.`,projectId:p.projectId,boughtUnits,boughtUnitCount,reusedClasses,requirements};
    }
    if(action==='manufacture-part'){const made=manufactureOne(s,p.primitive,p.profile);return{message:'One functional component was manufactured from actual available material inventory.',produced:[made],workId:made};}
    if(action==='manufacture-reference'){
      const e=engineFor(s),available=[];
      for(const r of e.snapshot().roots.values())if(r.owner===actor&&r.status==='LIVE'&&r.scope==='COMPONENT'){try{e.assertCanConsume(r.instance,s.now);available.push(s.protocol.compositionRoots.get(r.instance));}catch{}}
      const availableIds=new Set(available.map(r=>hex(r.instance))),complete=s.kits.find(k=>k.stage==='PARTS'&&k.components.flat().length===60&&k.components.flat().every(id=>availableIds.has(id)));
      if(complete){s.selectedKitId=complete.id;return{message:'The reference component set is already complete. No materials were consumed.',kitId:complete.id,produced:[],reusedComponentCount:60,totalComponentCount:60};}
      const partial=s.kits.find(k=>k.stage==='PARTS');fail(partial||s.kits.length<6,'PLAYTEST_KIT_LIMIT');
      const components=[],produced=[];let reused=0;
      for(let role=1;role<=15;role++){const row=[];for(let primitive=1;primitive<=4;primitive++){const i=available.findIndex(r=>r.primitive===primitive&&(primitive!==4||r.profile===role));if(i>=0){row.push(hex(available.splice(i,1)[0].instance));reused++;}else{const made=manufactureOne(s,primitive,role);row.push(made);produced.push(made);}}components.push(row);}
      const kit={id:partial?.id??`kit-${s.nextKit++}`,name:'Reference component set',stage:'PARTS',components,cells:[],organs:[],bio:null};if(partial)Object.assign(partial,kit);else s.kits.push(kit);s.selectedKitId=kit.id;return{message:`Reference set prepared: ${reused} existing components reused and ${produced.length} missing components manufactured.`,kitId:kit.id,produced,reusedComponentCount:reused,totalComponentCount:60};
    }
    if(action==='design-select'){fail(s.labSim.designs.has(p.designId),'LAB_DESIGN');s.labSim.selectedDesignId=p.designId;return{message:'Design selected.',designId:p.designId};}
    if(action==='design-save'||action==='design-test'){const graph=parseGraph(p.graph),report=validateDesign(graph,{challenge:p.challenge}),id=hex(designId(graph));if(action==='design-save'){fail(s.labSim.designs.size<49||s.labSim.designs.has(id),'LAB_DESIGN_LIMIT');const existing=s.labSim.designs.get(id);s.labSim.designs.set(id,{id,name:existing?.isReference?existing.name:p.name,graph,challenge:p.challenge,qualityPpm:report.q_ppm.toString(),cost:report.C.toString(),isReference:existing?.isReference??false});s.labSim.selectedDesignId=id;}return{message:action==='design-test'?'The submitted design passed all 73 actual model rounds.':'The validated design was saved.',designId:id,qualityPpm:report.q_ppm.toString(),cost:report.C.toString(),rounds:report.report.rounds,graph:publicGraph(graph)};}
    if(action==='synthesize'){const d=s.labSim.designs.get(p.designId??s.labSim.selectedDesignId);fail(d,'LAB_DESIGN');const requested=p.challenge??([3,9,14,15,21].includes(p.target)?2000000:d.challenge);challenge(requested);const graph=projectGraph(d.graph,p.target),report=validateDesign(graph,{challenge:requested}),made=makeParent(s,p.target,p.inputIds,d.graph,requested);return{message:'Selected inputs were consumed once and replaced with the validated parent work.',produced:[made],workId:made,target:p.target,qualityPpm:report.q_ppm.toString()};}
    fail(false,'LAB_ACTION');
  }
  function snapshot(s,dto){
    const appearances=createLabAppearanceIndex({protocol:s.protocol,base:BASE});
    const e=engineFor(s),season=materialSeason(s.now,0n),projects=[...s.protocol.projects].map(([id,p])=>({id,name:id===s.projectId?'Genesis laboratory':p.name,isOwn:hex(p.creator)===actor,creatorId:hex(p.creator),saleRecipient:hex(p.saleRecipient),selected:id===s.labSim.selectedProjectId,classes:p.classes.map(c=>({class:c.class,mint:hex(c.mint),lifetimeCap:c.lifetimeCap.toString(),issued:c.issued.toString(),remaining:(c.lifetimeCap-c.issued).toString(),intakeBurned:c.intakeBurned.toString(),priceLamports:c.priceLamports.toString(),resourceFeePerUnitLamports:RESOURCE_FEE_PER_UNIT.toString(),ownedAmount:[...s.protocol.tokens.values()].filter(t=>hex(t.owner)===actor&&hex(t.mint)===hex(c.mint)).reduce((n,t)=>n+t.amount,0n).toString(),globalSeasonRemaining:(SEASON_CAPS[c.class-1]-(s.protocol.seasonIssued.get(`${c.class}:${season}`)??0n)).toString(),globalLifetimeRemaining:(LIFETIME_CAPS[c.class-1]-(s.protocol.lifetimeIssued.get(`${c.class}`)??0n)).toString()}))}));
    // Global quota keys are context-independent and are checked again by P2.
    const materials=[1,2,3,4].map(c=>({class:c,symbol:['AA','NUC','LIPID','SUGAR'][c-1],amount:projects.reduce((n,p)=>n+BigInt(p.classes[c-1].ownedAmount),0n).toString()}));
    const works=dto.works.map(w=>{const f=s.protocol.compositionRoots.get(w.id),inputIds=f.artifactId?decodeSynthesisPayload(readSealedArtifact(s.protocol,f.artifactId,BASE).written).direct.map(d=>hex(d.instance)):[];return{...w,name:name(e.root(w.id),f),primitive:f.primitive??null,profile:f.profile??null,B:f.B_int.toString(),descriptor:f.descriptor?hex(f.descriptor):f.scope==='COMPONENT'?`0100${f.primitive.toString(16).padStart(2,'0')}${f.profile.toString(16).padStart(2,'0')}`:null,inputIds,appearanceRef:appearances.reference(w.id)};});
    const recipe=[1,2,3,4].map(c=>{const species=materialClass(c).species;return{class:c,tickScale:RU_TO_TICK.toString(),species:species.map(species=>({species,ticks:F1_BOM[species-1].toString()})),maxSpeciesTicks:species.reduce((n,i)=>F1_BOM[i-1]>n?F1_BOM[i-1]:n,0n).toString(),sourceRemaining:species.map(i=>({species:i,ticks:[...s.protocol.sources.values()].filter(source=>source.class===c&&hex(source.inventoryOwner)===actor).reduce((n,source)=>n+source.initialTick[i-1]-source.spentPrefix[i-1],0n).toString()}))};});
    const labMarket=market.snapshot(s),available=new Set(labMarket.sellableWorks.map(w=>w.workId)),parts=works.filter(w=>w.scope==='COMPONENT'&&available.has(w.id));
    for(const listing of labMarket.listings)if(listing.assetType==='WORK')listing.appearanceRef=appearances.reference(listing.workId);
    for(const work of labMarket.sellableWorks)work.appearanceRef=appearances.reference(work.workId);
    const workLaunches=[...(s.labSim.workLaunches??new Map()).values()].reverse().map(record=>{const listing=labMarket.listings.find(l=>l.id===record.listingId);fail(listing&&listing.assetType==='WORK'&&listing.workId===record.workId&&listing.sellerId===record.author&&listing.priceLamports===record.priceLamports,'LAB_LAUNCH_BINDING');return{...record,status:listing.status,remainingSupply:listing.status==='OPEN'?'1':'0',...(listing.designId?{designId:listing.designId}:{}),scopeOfWork:listing.scope,qualityPpm:listing.qualityPpm,weight:listing.weight,appearanceRef:listing.appearanceRef};});
    const launchesByListing=new Map(workLaunches.map(record=>[record.listingId,record]));for(const collection of [labMarket.listings,labMarket.products,labMarket.bios])for(const listing of collection){const launch=launchesByListing.get(listing.id);if(launch)listing.launchRef=launch.id;}
    const marketWire={...Object.fromEntries(Object.entries(labMarket).filter(([key])=>!['materials','products','bios'].includes(key))),listingCollections:'DERIVED_FROM_CATEGORY'};
    const slots=[];for(let primitive=1;primitive<=4;primitive++){if(primitive<4){const count=parts.filter(w=>w.primitive===primitive).length;slots.push({primitive,profile:0,required:15,available:count,missing:Math.max(0,15-count)});}else for(let role=1;role<=15;role++){const count=parts.filter(w=>w.primitive===4&&w.profile===role).length;slots.push({primitive,profile:role,required:1,available:count,missing:Math.max(0,1-count)});}}
    const ready=s.kits.find(k=>k.stage==='PARTS'&&k.components.flat().length===60&&k.components.flat().every(id=>available.has(id)));
    const referenceAssembly={requiredComponentCount:60,availableComponentCount:slots.reduce((n,s)=>n+Math.min(s.available,s.required),0),missingComponentCount:slots.reduce((n,s)=>n+s.missing,0),readyKitId:ready?.id??null,slots};
    const labels={'buy-kit':'Buy reference materials','manufacture-kit':'Manufacture reference components','synthesize-cells':'Synthesize functional cells','synthesize-organs':'Synthesize functional organs','synthesize-bio':'Synthesize organism',stake:'Stake a work','advance-hour':'Advance simulated time',claim:'Claim accrued LAB',exit:'Exit staking'};
    return{...dto,workLaunches,appearances:appearances.appearances,appearanceGraphs:appearances.graphs,kits:dto.kits.map(k=>({...k,name:'Reference component set',availabilityReason:k.availabilityReason?'Some inputs are consumed, listed, transferred or still locked by staking.':''})),nextActions:dto.nextActions.map(row=>({...row,label:labels[row.action]??row.action,reason:row.enabled?'':'Complete the required preceding action or provide compatible available assets.'})),account:{...dto.account,name:'Test researcher'},materials,works:works.map(w=>({...w,canCompose:available.has(w.id),canList:available.has(w.id),canStake:available.has(w.id)})),projects,designs:[...s.labSim.designs.values()].map(({graph,...d})=>d),selectedGraph:publicGraph(s.labSim.designs.get(s.labSim.selectedDesignId).graph),selectedProjectId:s.labSim.selectedProjectId,selectedDesignId:s.labSim.selectedDesignId,sourceRemainingTicks:recipe.reduce((n,c)=>n+c.sourceRemaining.reduce((a,species)=>a+BigInt(species.ticks),0n),0n).toString(),market:marketWire,labSim:{profile:'BIO-LAB-SIM1',isolated:true,graphsIncluded:'SELECTED_ONLY',supportOnlyTargets:[3,9,14,15,21],supportOnlyChallenge:2000000,starter:s.labSim.starter,recipe,referenceAssembly,manufacturing:{profile:'F1',materialUsePerComponent:F1_BOM.map(String),materialUseIsFixed:true,outputCount:1},createProjectFeeLamports:CREATE_FEE.toString(),globalLifetimeCaps:LIFETIME_CAPS.map(String),season,oneWayComposition:true,unpacking:false,recycling:false}};
  }
  return{initialize,execute,snapshot,market};
}
