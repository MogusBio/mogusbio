import {MATERIAL_LABELS,MATERIAL_SYMBOLS,shortId,workTitle,formatProductionWeight} from './lab-ui.js';
import {createSpecimenArt} from './lab-specimen-art.js';

const CATEGORIES=[['MATERIAL','Materials'],['PRODUCT','Components & organs'],['BIO','Organisms']];
const VIEWS=[['browse','Browse'],['sell','Sell'],['listings','My listings'],['activity','Activity']];
const uint=value=>typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value)?BigInt(value):0n;
const isMaterial=item=>item.assetType==='MATERIAL'||item.category==='MATERIAL';
const itemName=item=>typeof item.launch?.title==='string'&&item.launch.title.trim()?item.launch.title:isMaterial(item)?`${MATERIAL_LABELS[item.class]??'Raw material'}${item.quantity?` · ${item.quantity} units`:''}`:workTitle(item);
const qualityValue=item=>{
  if(typeof item.qualityPpm==='string'&&/^\d+$/.test(item.qualityPpm))return BigInt(item.qualityPpm);
  if(typeof item.quality==='string'&&/^\d+(?:\.\d{1,6})?$/.test(item.quality)){const [a,b='']=item.quality.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));}
  return -1n;
};
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function filterSortMarketListings(listings,{category='MATERIAL',view='browse',search='',kind='ALL',sort='newest',minimumQuality='0'}={}){
  const query=String(search).trim().toLowerCase(),minimum=uint(minimumQuality);
  return listings.map((listing,index)=>({listing,index})).filter(({listing:l})=>{
    if(l.category!==category)return false;
    if(view==='activity'?l.status==='OPEN':l.status!=='OPEN')return false;
    if(view==='listings'&&!l.isOwn)return false;
    if(kind!=='ALL'&&(category==='MATERIAL'?String(l.class)!==kind:l.scope!==kind))return false;
    if(minimum&&qualityValue(l)<minimum)return false;
    const haystack=[itemName(l),l.launch?.title,l.launch?.description,l.launch?.author,l.name,l.projectName,l.scope,MATERIAL_SYMBOLS[l.class],l.workId,l.id,l.designId,l.sellerName,l.status].filter(Boolean).join(' ').toLowerCase();
    return !query||haystack.includes(query);
  }).sort((a,b)=>{
    let order=0;
    if(sort==='price-low')order=compare(uint(a.listing.priceLamports),uint(b.listing.priceLamports));
    else if(sort==='price-high')order=compare(uint(b.listing.priceLamports),uint(a.listing.priceLamports));
    else if(sort==='quality')order=compare(qualityValue(b.listing),qualityValue(a.listing));
    else if(sort==='weight')order=compare(uint(b.listing.weight),uint(a.listing.weight));
    else order=compare(uint(b.listing.closedAt??b.listing.createdAt),uint(a.listing.closedAt??a.listing.createdAt));
    return order||a.index-b.index;
  }).map(row=>row.listing);
}

export function renderMarket(host,u){
  const {state:s,preferences:p,el,button,input,field,select,sol,act,render,status}=u,market=s.market;
  const root=el('section',undefined,'lab-market');host.append(root);
  if(!market){root.append(el('h3','The exchange is preparing.'),el('p','Refresh your local ledger to load its marketplace.','lab-market-note'));return;}
  const document=host.ownerDocument??{createElement:tag=>el(tag)};
  const art=(descriptor,compact=false)=>createSpecimenArt(document,descriptor,{compact,label:`${itemName(descriptor)} — illustrative model art`});
  const projectName=id=>s.projects?.find(project=>project.id===id)?.name??`Project ${shortId(id)}`;
  const category=CATEGORIES.some(([id])=>id===p.marketCategory)?p.marketCategory:'MATERIAL';p.marketCategory=category;
  const view=VIEWS.some(([id])=>id===p.marketView)?p.marketView:p.sellWorkId?'sell':'browse';
  let inFlight=false;
  const navigate=(nextCategory,nextView)=>{p.marketCategory=nextCategory;p.marketView=nextView;render();};
  const actionButton=(label,fn,options={},className='')=>{const b=button(label,fn,options);b.className=`lab-market-button${options.primary?' is-primary':''}${className?' '+className:''}`;return b;};
  const note=text=>el('p',text,'lab-market-note');
  const badge=(text,modifier='')=>el('span',text,`lab-market-badge${modifier?' '+modifier:''}`);
  const stats=(label,value)=>{const box=el('div',undefined,'lab-market-stat');box.append(el('span',label),el('strong',value));return box;};
  const traits=item=>{
    const list=el('dl',undefined,'lab-market-traits');
    for(const [name,value]of isMaterial(item)?[['Material',MATERIAL_SYMBOLS[item.class]??'—'],['Quantity',`${item.quantity??item.amount??'0'} units`]]:[['Quality',item.quality===undefined?'Not recorded':`${item.quality}×`],['Weight',formatProductionWeight(item.weight)],['Level',({COMPONENT:'Component',CELL:'Cell',ORGAN:'Organ',BIO:'Organism'})[item.scope]??'Specimen']]){
      const row=el('div');row.append(el('dt',name),el('dd',value));list.append(row);
    }return list;
  };
  async function invoke(action,params,pressed){
    if(inFlight||u.busy)return;inFlight=true;if(pressed)pressed.disabled=true;
    try{const response=await act(action,params),result=response?.state?.lastResult;
      if(result?.action===action&&result.status==='SUCCESS'){
        p.marketOutcome={action,listingId:result.listingId??params.listingId??null,workId:result.workId??params.workId??null,priceLamports:result.priceLamports??params.priceLamports??null};
        if(action==='market-list')p.marketView='listings';render();
      }
    }catch{status('The trade could not be confirmed. Check the ledger or resolve the pending operation before trying again.',true);}
    finally{inFlight=false;if(pressed)pressed.disabled=!!u.busy;}
  }

  const heading=el('header',undefined,'lab-market-heading'),title=el('div');title.append(el('span','THE LIVING EXCHANGE','lab-market-eyebrow'),el('h3','A little chemistry. A new possibility.'),el('p','Collect the building blocks. Trade what you create.','lab-market-intro'));heading.append(title,badge('LOCAL TEST MARKET','is-local'));root.append(heading);
  const categories=el('div',undefined,'lab-market-categories');categories.setAttribute('role','group');categories.setAttribute('aria-label','Three marketplaces');
  for(const [id,label]of CATEGORIES){const b=actionButton(label,()=>navigate(id,view),{active:category===id});b.setAttribute('data-market-category',id);categories.append(b);}root.append(categories);
  const navigation=el('nav',undefined,'lab-market-views');navigation.setAttribute('aria-label','Market activities');
  for(const [id,label]of VIEWS){const b=actionButton(label,()=>navigate(category,id),{active:view===id});b.setAttribute('data-market-view',id);navigation.append(b);}root.append(navigation);
  const inventory=market.listings??[],active=inventory.filter(l=>l.category===category&&l.status==='OPEN'),own=active.filter(l=>l.isOwn);
  const summary=el('div',undefined,'lab-market-summary');summary.append(stats('Open listings',String(active.length)),stats('Your active listings',String(own.length)),stats('Your balance',`${sol(s.testSOL?.balanceLamports??market.balances?.playerLamports??'0')} test SOL`));root.append(summary);
  if(p.marketOutcome){
    const labels={'market-list':['Listed successfully','Your original asset is now held in escrow. It cannot be staked or consumed until the listing is cancelled.'],'market-buy':['Purchase complete','The original asset and test SOL were transferred atomically. Find your purchase in My assets.'],'market-cancel':['Listing removed','The original asset has returned to your available inventory.'],'market-test-counterparty-buy':['Test sale complete','The simulated counterparty received your asset and paid the asking price.']},outcome=p.marketOutcome,[label,body]=labels[outcome.action]??['Ledger updated','Check your recorded trade.'];
    const box=el('div',undefined,'lab-market-result');box.setAttribute('role','status');box.append(el('strong',label),el('p',body));if(outcome.priceLamports)box.append(el('span',`${sol(outcome.priceLamports)} test SOL${outcome.listingId?' · listing #'+shortId(outcome.listingId):''}`));box.append(actionButton('Dismiss',()=>{delete p.marketOutcome;render();},{},'is-quiet'));root.append(box);
  }
  const safety=el('details',undefined,'lab-market-rules');safety.append(el('summary','How trading and staking work'),note('Listing moves an asset into escrow. Listed specimens cannot be staked or consumed. Exit staking and wait for its hour boundary before listing. A purchase transfers the same asset without issuing extra material or LAB.'),note('SIMULATED COUNTERPARTY means a test participant inside your isolated account ledger. A test purchase is not a trade with another person. Artwork is illustrative; quality, weight, quantity and ownership come from the actual model ledger.'));root.append(safety);

  if(view==='sell'){renderSell();return;}
  const filterKey=`${category}:${view}`;p.marketFilters??={};p.marketFilters[filterKey]??={search:'',kind:'ALL',sort:'newest',minimumQuality:'0',expanded:false};const filters=p.marketFilters[filterKey];
  const filterBar=el('div',undefined,'lab-market-filters'),search=input(filters.search,{type:'search',placeholder:'Search by name, role or specimen…'});search.setAttribute('aria-label','Search this market');
  const extra=el('details',undefined,'lab-market-extra-filters'),filterSummary=el('summary','Filters'),extraFields=el('div',undefined,'lab-market-extra-filter-fields');extra.open=filters.expanded===true;extra.setAttribute('aria-label','Additional market filters');extra.addEventListener('toggle',()=>{filters.expanded=extra.open===true;});extra.append(filterSummary,extraFields);
  const kinds=category==='MATERIAL'?[['ALL','All four materials'],...[1,2,3,4].map(c=>[String(c),MATERIAL_LABELS[c]])]:category==='PRODUCT'?[['ALL','All components, cells & organs'],['COMPONENT','Components'],['CELL','Cells'],['ORGAN','Organs']]:[['ALL','All organisms']];
  const kind=select(kinds,filters.kind,value=>{filters.kind=value;updateFilterSummary();drawListings();});kind.setAttribute('aria-label','Asset type filter');extraFields.append(field('Asset type',kind));
  const sort=select([['newest','Newest first'],['price-low','Price: low to high'],['price-high','Price: high to low'],...(category!=='MATERIAL'?[['quality','Highest quality'],['weight','Highest production weight']]:[])],filters.sort,value=>{filters.sort=value;drawListings();});sort.setAttribute('aria-label','Sort market');
  search.addEventListener('input',()=>{filters.search=search.value;drawListings();});filterBar.append(search,sort,extra);
  if(category!=='MATERIAL'){const quality=select([['0','Any verified quality'],['1000000','Quality ≥ 1.0×'],['1500000','Quality ≥ 1.5×'],['2000000','Quality ≥ 2.0×']],filters.minimumQuality,value=>{filters.minimumQuality=value;updateFilterSummary();drawListings();});quality.setAttribute('aria-label','Minimum quality');extraFields.append(field('Minimum quality',quality));}updateFilterSummary();root.append(filterBar);
  function updateFilterSummary(){const count=Number(filters.kind!=='ALL')+Number(category!=='MATERIAL'&&uint(filters.minimumQuality)>0n);filterSummary.textContent=count?`Filters (${count})`:'Filters';}
  const resultHeading=el('div',undefined,'lab-market-results-heading'),count=el('span');resultHeading.append(el('h4',view==='activity'?'Recorded trades':view==='listings'?'Your active listings':'Discover the collection'),count);root.append(resultHeading);
  const results=el('div',undefined,'lab-market-grid');results.setAttribute('aria-label','Market result cards');root.append(results);drawListings();

  function drawListings(){
    const rows=filterSortMarketListings(inventory.map(l=>({...l,projectName:projectName(l.projectId)})),{...filters,category,view});count.textContent=`${rows.length} ${rows.length===1?'result':'results'}`;results.replaceChildren();
    if(!rows.length){const empty=el('div',undefined,'lab-market-empty');empty.append(el('span','NOTHING HERE YET','lab-market-eyebrow'),el('h4',filters.search||filters.kind!=='ALL'?'No matching specimens.':view==='activity'?'Your next trade starts a story.':view==='listings'?'Your shelf is ready to share.':'This collection is waiting to grow.'),note(filters.search||filters.kind!=='ALL'?'Try a different search or asset type.':view==='listings'?'Choose an available asset and set its asking price.':'There are no recorded assets in this selection. Nothing is generated automatically.'),actionButton(view==='activity'?'Browse the market':'List an asset',()=>navigate(category,view==='activity'?'browse':'sell'),{primary:true}));results.append(empty);return;}
    for(const listing of rows)results.append(listingCard(listing));
  }
  function listingCard(listing){
    const card=el('article',undefined,'lab-market-card');card.setAttribute('data-listing-id',listing.id);card.setAttribute('data-listing-status',listing.status);
    const picture=el('div',undefined,`lab-market-picture is-${category.toLowerCase()}`);picture.append(art(listing));const ribbon=el('div',undefined,'lab-market-card-ribbon');ribbon.append(badge(listing.status==='OPEN'?(listing.isOwn?'YOUR LISTING':'TEST COUNTERPARTY'):listing.status==='SOLD'?'SOLD':'REMOVED',listing.isOwn?'is-owned':''),el('span',`#${shortId(listing.id)}`));picture.append(ribbon);card.append(picture);
    const body=el('div',undefined,'lab-market-card-body');body.append(el('span',isMaterial(listing)?projectName(listing.projectId):`${listing.scope} · #${shortId(listing.workId)}`,'lab-market-card-origin'),el('h4',itemName(listing)));
    if(listing.launch){body.append(el('p',`Publisher #${shortId(listing.launch.author)}`,'lab-market-publisher'));if(!isMaterial(listing))body.append(el('p',workTitle(listing),'lab-market-model-role'));if(listing.launch.description)body.append(el('p',listing.launch.description,'lab-market-description'));}
    body.append(traits(listing));
    const price=el('div',undefined,'lab-market-price');price.append(el('span',listing.status==='OPEN'?'TOTAL ASKING PRICE':'RECORDED PRICE'),el('strong',sol(listing.priceLamports)),el('small','test SOL'));body.append(price);
    const actions=el('div',undefined,'lab-market-card-actions');
    if(listing.status==='OPEN'&&listing.isOwn){
      let cancel;cancel=actionButton('Cancel listing',()=>invoke('market-cancel',{listingId:listing.id},cancel),{disabled:!listing.canCancel});actions.append(cancel);
      const tools=el('details',undefined,'lab-market-test-tools');tools.append(el('summary','Simulation tools'),note('A simulated buyer pays this exact asking price. This creates a real local-ledger sale, not a real-person trade.'));let simulate;simulate=actionButton('Simulate buyer purchase',()=>invoke('market-test-counterparty-buy',{listingId:listing.id},simulate),{disabled:!listing.canTestSell});tools.append(simulate);actions.append(tools);
    }else if(listing.status==='OPEN'){
      actions.append(actionButton('Buy asset',()=>reviewPurchase(listing,actions),{primary:true,disabled:!listing.canBuy}));
      if(!listing.canBuy)actions.append(note('This asset is not available to purchase.'));
    }else actions.append(el('span',listing.status==='SOLD'?'The original asset changed owner.':'The original asset returned to its seller.','lab-market-trade-state'));
    body.append(actions);card.append(body);return card;
  }
  function reviewPurchase(listing,container){
    container.replaceChildren();const review=el('section',undefined,'lab-market-review');review.setAttribute('aria-label','Review purchase');
    review.append(el('strong','Review your purchase'),note(itemName(listing)));
    if(listing.launch){review.append(note(`Publisher #${shortId(listing.launch.author)} · ${workTitle(listing)}`));if(listing.launch.description)review.append(note(listing.launch.description));}
    review.append(traits(listing),el('p',`Pay ${sol(listing.priceLamports)} test SOL to the test counterparty. You receive the original ${isMaterial(listing)?listing.quantity+' material units':'unstaked specimen'}.`),note(isMaterial(listing)?'A receiving token account may require rent if it does not exist. Any required rent is included in your recorded SOL movement.':'The asset keeps its existing quality and production weight. Buying does not increase the global LAB emission rate.'));
    let confirm;confirm=actionButton('Confirm purchase',()=>invoke('market-buy',{listingId:listing.id},confirm),{primary:true,disabled:!listing.canBuy});review.append(confirm,actionButton('Keep browsing',()=>{container.replaceChildren(actionButton('Buy asset',()=>reviewPurchase(listing,container),{primary:true,disabled:!listing.canBuy}));}));container.append(review);confirm.focus?.({preventScroll:true});
  }

  function renderSell(){
    const intro=el('div',undefined,'lab-market-sell-intro');intro.append(el('h4','Choose what leaves your shelf.'),note('Pick one owned asset. Set its total price. Listing locks that original asset in escrow until it is sold or removed.'));root.append(intro);
    const authoritative=new Map((market.sellableWorks??[]).filter(w=>w.category===category).map(w=>[w.workId,w]));
    const candidates=category==='MATERIAL'?(market.sellableMaterials??[]).filter(m=>uint(m.amount)>0n).map(m=>({...m,assetType:'MATERIAL',category:'MATERIAL',available:true})):[...(s.works??[]).filter(w=>w.status==='LIVE'&&(category==='BIO'?w.scope==='BIO':w.scope!=='BIO')).map(w=>({...w,...(authoritative.get(w.id)??{}),workId:w.id,assetType:'WORK',available:authoritative.has(w.id)})),...(market.sellableWorks??[]).filter(w=>w.category===category&&!(s.works??[]).some(owned=>owned.id===w.workId)).map(w=>({...w,assetType:'WORK',available:true}))];
    const key=item=>isMaterial(item)?`${item.projectId??''}:${item.class}`:item.workId;
    p.marketSellSelection??={};let selectedKey=category!=='MATERIAL'&&p.sellWorkId&&candidates.some(c=>c.workId===p.sellWorkId)?p.sellWorkId:p.marketSellSelection[category];
    if(!candidates.some(c=>key(c)===selectedKey))selectedKey=key(candidates.find(c=>c.available)??candidates[0]??{});p.marketSellSelection[category]=selectedKey;
    const chooser=el('div',undefined,'lab-market-owned-grid');chooser.setAttribute('aria-label','Choose an owned asset to list');
    for(const asset of candidates){const selected=key(asset)===selectedKey,card=el('article',undefined,`lab-market-owned-card${selected?' is-selected':''}${!asset.available?' is-locked':''}`);card.setAttribute('data-owned-work',asset.workId??key(asset));card.append(art(asset,true),el('h4',isMaterial(asset)?`${MATERIAL_SYMBOLS[asset.class]} · ${asset.amount} available`:itemName(asset)),el('p',isMaterial(asset)?projectName(asset.projectId):`#${shortId(asset.workId)}`),traits(asset));
      if(asset.available)card.append(actionButton(selected?'Selected':'Select asset',()=>{p.marketSellSelection[category]=key(asset);if(!isMaterial(asset))p.sellWorkId=asset.workId;render();},{active:selected}));else card.append(badge(asset.staked?'STAKED · EXIT BEFORE SELLING':'LOCKED · WAIT FOR EXIT','is-locked'),actionButton('Manage staking and exits',()=>u.open('energy')));chooser.append(card);
    }root.append(chooser);
    const selected=candidates.find(c=>key(c)===selectedKey&&c.available);
    if(!selected){const empty=el('div',undefined,'lab-market-empty');empty.append(el('h4',candidates.length?'These specimens are still registered.':'No available assets in this collection.'),note(category==='MATERIAL'?'Buy some direct material units to start a listing.':'Only your unstaked, unconsumed specimens can be listed. Exit registration and wait for the hour boundary first.'),actionButton(category==='MATERIAL'?'Open reagent supplies':'Manage staking and exits',()=>u.open(category==='MATERIAL'?'supplies':'energy'),{primary:true}));root.append(empty);return;}
    const draftKey=`${category}:${key(selected)}`;p.marketSaleDrafts??={};const draft=p.marketSaleDrafts[draftKey]??={quantity:'1',price:sol(isMaterial(selected)?selected.unitPriceLamports??'500000':selected.priceLamports??'0'),manual:false};
    const form=el('section',undefined,'lab-market-sale-form');form.setAttribute('aria-label','Create a listing');form.append(el('span','YOUR LISTING','lab-market-eyebrow'),el('h4',itemName(selected)),traits(selected));
    const material=isMaterial(selected),quantity=input(draft.quantity,{type:'number',min:1,max:String(uint(selected.amount)>1000n?1000n:uint(selected.amount)),step:1}),price=input(draft.price,{type:'text'});price.setAttribute('inputmode','decimal');
    const quote=el('div',undefined,'lab-market-sale-quote');
    function updateQuote(){quote.replaceChildren(el('span','Buyer pays / total asking price'),el('strong',`${price.value||'—'} test SOL`));}
    if(material){quantity.addEventListener('input',()=>{draft.quantity=quantity.value;if(!draft.manual&&/^[1-9]\d{0,3}$/.test(quantity.value)&&uint(quantity.value)<=1000n){price.value=sol(uint(selected.unitPriceLamports??'500000')*uint(quantity.value));draft.price=price.value;}updateQuote();});form.append(field('Units to list',quantity,{note:`${selected.amount} available. A listing contains 1–1,000 whole units.`}));}
    price.addEventListener('input',()=>{draft.price=price.value;draft.manual=true;updateQuote();});price.addEventListener('change',()=>{draft.price=price.value;draft.manual=true;updateQuote();});
    form.append(field(material?'Total asking price (simulation SOL)':'Asking price (simulation SOL)',price,{note:'You choose the total price. The reference quote is a suggestion, not a guaranteed market value.'}));
    const shortcuts=el('div',undefined,'lab-market-price-shortcuts'),reference=uint(material?selected.unitPriceLamports??'500000':selected.priceLamports??'0');
    for(const [label,numerator,denominator]of [['Reference',1n,1n],['−10%',9n,10n],['+10%',11n,10n]])shortcuts.append(actionButton(label,()=>{const amount=reference*(material?uint(quantity.value):1n)*numerator/denominator;price.value=sol(amount>0n?amount:1n);draft.price=price.value;draft.manual=true;updateQuote();}));form.append(shortcuts);updateQuote();form.append(quote,note('The seller receives the asking price on sale. A first material escrow account can also require rent, which is included in the recorded SOL movement. Listed specimens cannot produce LAB while held in escrow.'));
    let submit;submit=actionButton(material?'List materials':'List selected specimen',()=>{
      if(material&&(!/^[1-9]\d{0,3}$/.test(quantity.value)||uint(quantity.value)>1000n||uint(quantity.value)>uint(selected.amount))){status('Choose 1 to 1,000 available material units.',true);return;}
      return u.safe(()=>{const asking=u.toLamports(price.value);if(uint(asking)===0n){status('Enter a positive asking price.',true);return;}draft.quantity=quantity.value;draft.price=price.value;draft.manual=true;return invoke('market-list',material?{assetType:'MATERIAL',class:selected.class,quantity:quantity.value,...(selected.projectId?{projectId:selected.projectId}:{}),priceLamports:asking}:{assetType:'WORK',workId:selected.workId,priceLamports:asking},submit);});
    },{primary:true});form.append(submit);root.append(form);
  }
}
