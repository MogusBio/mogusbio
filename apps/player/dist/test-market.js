const names={MATERIAL:'原料市场',PRODUCT:'成品市场',BIO:'生物市场'};
const units=atoms=>{const n=BigInt(atoms),tail=(n%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');return`${n/1000000000n}${tail?'.'+tail:''}`;};
export function renderTestMarket(host,market,{document,category='MATERIAL',limit=8,busy=false,onCategory,onMore,act}={}){
  if(!host)return;
  const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(label,fn,disabled=false)=>{const b=make('button',label,'tl-button');b.type='button';b.disabled=busy||disabled;b.addEventListener('click',fn);return b;};
  host.replaceChildren();
  if(!market){host.append(make('p','市场正在准备，请刷新本地体验服务。','tl-note'));return;}
  const tabs=make('div',undefined,'tl-market-tabs');tabs.setAttribute('aria-label','三个交易市场');
  for(const [key,label]of Object.entries(names)){const b=button(label,()=>onCategory(key));b.setAttribute('aria-pressed',String(key===category));tabs.append(b);}host.append(tabs);
  const note=category==='MATERIAL'?'四类原料按份交易，买入直接进入库存。转卖不增发原料。':category==='PRODUCT'?'部件、细胞、器官都可以交易，买入后可登记产出。':'这里只交易完整生物，生态世界将在后期开放。';
  host.append(make('p',note,'tl-note'),make('p','本轮测试商品只覆盖普通产出资产，首创权益交易尚未开放。','tl-note'),make('p','本地体验按固定测试价格成交，0测试手续费。所有对手商品和模拟成交均来自明确标注的测试交易对手。','tl-note'));
  const listings=market.listings.filter(l=>l.category===category&&l.status==='OPEN'),shop=make('div',undefined,'tl-market-grid');
  for(const l of listings){const card=make('article',undefined,'tl-work');card.append(make('h3',l.name),make('p',`${l.sellerName} · ${l.assetType==='MATERIAL'?`${l.quantity}份`:`1件成品 · #${l.workId.slice(-8)}`}`),make('strong',`${units(l.priceLamports)} 测试 SOL`));const controls=make('div',undefined,'tl-market-controls');
    if(l.isOwn){controls.append(button('取消挂牌',()=>void act('market-cancel',{listingId:l.id}),!l.canCancel),button('模拟测试对手购买',()=>void act('market-test-counterparty-buy',{listingId:l.id}),!l.canTestSell));}
    else controls.append(button('购买这件商品',()=>void act('market-buy',{listingId:l.id}),!l.canBuy));card.append(controls);shop.append(card);}
  if(!listings.length)shop.append(make('p',`暂时没有${category==='BIO'?'生物':category==='PRODUCT'?'成品':'原料'}挂牌。可以在下方选择自己的资产出售。`,'tl-note'));host.append(make('h3','在售商品'),shop,make('h3','出售我的资产'));
  const sell=make('div',undefined,'tl-market-grid');
  if(category==='MATERIAL')for(const m of market.sellableMaterials){const e=make('article',undefined,'tl-work');e.append(make('h3',m.symbol),make('p',`可用 ${m.amount} 份 · 每份 ${units(m.unitPriceLamports)} 测试 SOL`));const controls=make('div',undefined,'tl-market-controls');for(const q of [1,5,10])controls.append(button(`挂牌 ${q} 份`,()=>void act('market-list',{assetType:'MATERIAL',class:m.class,quantity:String(q)}),BigInt(m.amount)<BigInt(q)));e.append(controls);sell.append(e);}
  else {const works=market.sellableWorks.filter(w=>w.category===category);for(const w of works.slice(0,limit)){const e=make('article',undefined,'tl-work');e.append(make('h3',w.name),make('p',`#${w.workId.slice(-8)} · ${units(w.priceLamports)} 测试 SOL · 挂牌后锁定，成交即转移所有权`),button('挂牌这件成品',()=>void act('market-list',{assetType:'WORK',workId:w.workId})));sell.append(e);}if(!works.length)sell.append(make('p','当前没有可挂牌的自有成品。已登记或尚未完成退出的作品，先完成退出再出售。','tl-note'));if(works.length>limit)sell.append(button(`查看更多可售成品（共${works.length}件）`,onMore));}
  host.append(sell);
  const records=make('details',undefined,'tl-market-records');records.append(make('summary','市场成交与取消记录'));for(const row of [...market.listings].reverse().filter(l=>l.status!=='OPEN').slice(0,10))records.append(make('p',`${row.name} · ${row.status==='SOLD'?'已成交':'已取消'} · ${units(row.priceLamports)} 测试 SOL`,'tl-note'));host.append(records);
}
