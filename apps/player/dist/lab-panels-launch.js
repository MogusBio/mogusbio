import {renderSupply} from './lab-panels-supply.js';
import {availableWork} from './lab-panels-production.js';
import {createSpecimenArt} from './lab-specimen-art.js';
import {workTitle,shortId,formatProductionWeight} from './lab-ui.js';

export function renderLaunchpad(host,u){
  const {state:s,preferences:p,el,button,input,field,card,row,grid,note,section,sol,act,render}=u;
  const tab=['materials','works'].includes(p.launchTab)?p.launchTab:'overview';
  host.append(row(...[['overview','Launchpad'],['materials','Material projects'],['works','Launch a specimen']].map(([id,label])=>button(label,()=>{p.launchTab=id;render();},{active:tab===id}))));
  if(tab==='materials'){host.append(note('Publish a four-material project. Set its supply caps and unit prices; purchasers receive real material units from the fixed catalogue.'));renderSupply(host,u,'projects');return;}
  const eligible=s.works.filter(w=>availableWork(w,s)&&w.canList!==false),launches=s.workLaunches??[];
  if(tab==='overview'){
    host.append(section('Bring your work to the laboratory',note('Launch a material project, or offer one of the specimens you have actually made. These are two different kinds of sale.')));
    const materials=card('01 / Material projects',createSpecimenArt(u.document,{assetType:'MATERIAL',class:1}),note('Create a project for AA, NUC, LIPID and SUGAR. Choose supply caps and prices; buyers use the materials for their experiments.'),button('Create a material project',()=>{p.launchTab='materials';render();},{primary:true}));
    const works=card('02 / Your specimens',createSpecimenArt(u.document,{scope:'BIO'}),note('Publish one owned component, cell, organ or organism. It goes on the specimen market at your asking price.'),button(eligible.length?'Launch my specimen':launches.length?'Manage my launches':'Make a specimen first',()=>{if(eligible.length||launches.length){p.launchTab='works';render();}else u.open('workshop');},{primary:true}));
    host.append(grid(materials,works),note(`${s.projects.filter(x=>x.isOwn).length} material project(s) created · ${eligible.length} available specimen(s) · ${launches.length} specimen launch(es). Each specimen sale transfers one existing object.`));return;
  }
  host.append(section('Launch a single specimen',note('Select an owned specimen, give the listing a name and set its price. One specimen is held for the buyer. You can cancel an open listing to take it back.')));
  const published=launches.find(l=>l.id===p.launchPublished);if(published)host.append(card(published.status==='OPEN'?'Your specimen is on the market':published.status==='SOLD'?'Your launch is complete':'Your specimen was returned',note(`${published.title} · ${published.status} · supply 1 · ${sol(published.priceLamports)} simulation SOL`),button('Manage this launch',()=>{p.marketCategory=published.scopeOfWork==='BIO'?'BIO':'PRODUCT';p.marketView=published.status==='OPEN'?'listings':'activity';u.open('market');},{primary:true})));
  if(!eligible.some(w=>w.id===p.launchWorkId))p.launchWorkId=eligible[0]?.id;
  const chosen=eligible.find(w=>w.id===p.launchWorkId);
  if(!chosen&&!launches.some(l=>l.status==='OPEN'))host.append(card('Your next launch starts at the bench',note('Make a component or assemble a larger specimen first. Staked, listed, consumed or exit-pending specimens cannot be launched.'),button('Open manufacturing bench',()=>u.open('workshop'),{primary:true}),button('Manage staking & exits',()=>u.open('energy'))));
  else if(chosen){
    host.append(grid(...eligible.slice(0,p.launchLimit??12).map(w=>card(workTitle(w),createSpecimenArt(u.document,w),note(`Q ${w.quality} · weight ${formatProductionWeight(w.weight)} · #${shortId(w.id)}`),button(w.id===chosen.id?'Selected specimen':'Choose this specimen',()=>{p.launchWorkId=w.id;render();},{active:w.id===chosen.id})))));
    if(eligible.length>(p.launchLimit??12))host.append(button('Show more specimens',()=>{p.launchLimit=(p.launchLimit??12)+12;render();}));
    p.launchDrafts??={};const draft=p.launchDrafts[chosen.id]??={title:`My ${workTitle(chosen).toLowerCase()}`.slice(0,48),description:'A functional specimen from my collection.',price:'0.0012'};
    const title=input(draft.title,{onChange:v=>draft.title=v});title.maxLength=48;
    const description=el('textarea');description.value=draft.description;description.maxLength=160;description.disabled=u.busy;description.addEventListener('change',()=>draft.description=description.value);
    const price=input(draft.price,{onChange:v=>draft.price=v});
    host.append(card('Your launch details',field('Listing name',title),field('Description',description),field('Asking price (simulation SOL)',price),note('Supply: 1 existing specimen. A successful launch holds that specimen in escrow. It cannot be staked or used in synthesis while listed.'),button('Publish specimen for sale',async()=>{
      const name=title.value.trim(),text=description.value.trim();if(!name||new TextEncoder().encode(name).length>48||new TextEncoder().encode(text).length>160){u.status('Use a listing name of 1–48 UTF-8 bytes and a description up to 160 bytes.',true);return;}
      let amount;try{amount=u.toLamports(price.value);if(BigInt(amount)===0n)throw Error('PRICE');}catch{u.status('Enter a positive price with up to 9 decimal places.',true);return;}
      const response=await act('work-launch',{workId:chosen.id,title:name,description:text,priceLamports:amount});if(response){p.launchTab='works';p.launchPublished=response.state.lastResult.launchId;render();}
    },{primary:true})));
  }
  if(launches.length)host.append(section('Your specimen launches',grid(...launches.map(launch=>{
    const preview=s.market?.listings?.find(l=>l.id===launch.listingId)??{};const descriptor={id:launch.workId,workId:launch.workId,scope:launch.scopeOfWork,primitive:preview.primitive,profile:preview.profile,target:preview.target,appearance:launch.appearance??preview.appearance};const box=card(launch.title,createSpecimenArt(u.document,descriptor),el('span',launch.status==='OPEN'?'FOR SALE':launch.status,'lab-op-badge'),note(launch.description),note(`1 specimen · ${sol(launch.priceLamports)} SOL · ${workTitle(descriptor)}`),note(`Listing #${shortId(launch.listingId)} · published hour ${launch.publishedHour}`));
    if(launch.status==='OPEN')box.append(button('Open specimen market',()=>{p.marketCategory=launch.scopeOfWork==='BIO'?'BIO':'PRODUCT';p.marketView='listings';u.open('market');}),button('Cancel this listing',()=>act('market-cancel',{listingId:launch.listingId})));
    if(launch.status==='SOLD')box.append(note('Sold. The original specimen was transferred and the sale proceeds were credited.'));
    if(launch.status==='CANCELLED')box.append(note('Cancelled. The same specimen was returned; no extra copy was created.'));
    return box;
  }))));
}
