// Presentation only. Every real destination still clicks its original leaf so
// existing cancellation, permission and plan invalidation handlers run once.
export const PLAYER_ROUTES=Object.freeze({
  economy:'协议数据',directory:'实验室项目 · 浏览与购料',project:'实验室项目 · 创建与发售',
  builder:'生物工坊 · 设计实验',manufacture:'生物工坊 · 制造部件',synthesis:'生物工坊 · 逐层合成',
  mining:'生物能', 'wallet-discovery':'我的资产',
  'market-material':'交易市场 · 原料市场','market-product':'交易市场 · 成品市场','market-bio':'交易市场 · 生物市场',
  research:'首创研究',flow:'玩法流程',guided:'资产操作工具',native:'高级交易与恢复',
});
export function mountPlayerRoutes(document,{window=document.defaultView??globalThis.window}={}){
  const title=document.getElementById('page-title');if(!title)return null;
  const leaves=[...document.querySelectorAll('.nav-item')],views=[...document.querySelectorAll('.view')],groups=[...document.querySelectorAll('[data-nav-group]')],byName=new Map();
  for(const leaf of leaves){const name=leaf.dataset.view;if(Object.hasOwn(PLAYER_ROUTES,name)&&document.getElementById(`${name}-view`)&&!byName.has(name))byName.set(name,leaf);}
  let closed=false,current=null;const listeners=[];
  function sync(leaf,{writeURL=true}={}){if(closed||byName.get(leaf.dataset.view)!==leaf)return;current=leaf.dataset.view;
    for(const n of leaves){n.classList.toggle('active',n===leaf);n.setAttribute('aria-current',n===leaf?'page':'false');}
    for(const view of views)view.hidden=view.id!==`${current}-view`;
    const parent=leaf.closest?.('[data-nav-group]');for(const group of groups)group.classList.toggle('player-nav-current',group===parent);
    const details=leaf.closest?.('details');if(details)details.open=true;
    title.textContent=PLAYER_ROUTES[current];
    if(writeURL&&window?.history?.replaceState&&window.location?.hash!==`#${current}`)window.history.replaceState(null,'',`#${current}`);
  }
  function go(name){if(closed||!byName.has(name))return false;byName.get(name).click();return true;}
  for(const leaf of byName.values()){const fn=()=>sync(leaf);leaf.addEventListener('click',fn);listeners.push([leaf,fn]);}
  const fromHash=()=>{const hash=window?.location?.hash??'',name=hash.startsWith('#')?hash.slice(1):'';if(byName.has(name)&&name!==current)go(name);};
  window?.addEventListener?.('hashchange',fromHash);
  const initial=leaves.find(n=>n.className.split(/\s+/).includes('active')&&byName.get(n.dataset.view)===n)??byName.get('builder');if(initial)sync(initial,{writeURL:false});fromHash();
  return{go,get current(){return current;},close(){closed=true;window?.removeEventListener?.('hashchange',fromHash);for(const [leaf,fn]of listeners)leaf.removeEventListener?.('click',fn);}};
}
if(typeof document!=='undefined')mountPlayerRoutes(document);
