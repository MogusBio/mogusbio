import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildWalletCatalog,walletCapabilities,walletPlayerSummary,walletNetworkConfig,readWalletNetworkConfig,uniqueNativeWalletOption,walletBrand,groupWalletProviders,bindWalletOption,SOLANA_WALLET_CHOICES,WALLET_SELECTION_EVENT,WALLET_SELECTION_RESULT_EVENT} from '../apps/player/dist/wallet-catalog.js';
import {mountWalletPanel} from '../apps/player/dist/wallet-panel.js';
import {walletV1Capability} from '../packages/client/src/wallet-capability.mjs';

const tick=()=>new Promise(r=>setImmediate(r)),response=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
const network=walletNetworkConfig({enabled:true,chain:'solana:devnet'});
function wallet(name='Phantom',versions=[1]){const calls={connect:0,message:0,sign:0,send:0},w={name,chains:['solana:devnet'],accounts:[],features:{'standard:connect':{connect(){calls.connect++;return{accounts:[]};}},'solana:signMessage':{signMessage(){calls.message++;}},'solana:signTransaction':{supportedTransactionVersions:versions,signTransaction(){calls.sign++;}},'solana:signAndSendTransaction':{signAndSendTransaction(){calls.send++;}}}};return{w,calls};}
class Element extends EventTarget{constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.textContent='';this.value='';this.className='';this.disabled=false;this.open=false;this.attributes={};}set innerHTML(_){assert.fail('metadata must never be HTML');}append(...parts){this.children.push(...parts);}replaceChildren(...parts){this.children=[...parts];}setAttribute(k,v){this.attributes[k]=v;}click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}showModal(){this.open=true;}close(){this.open=false;}}
const text=el=>[el.textContent,...el.children.map(text)].join(' '),buttons=el=>el.children.flatMap(c=>[...(c.tagName==='BUTTON'?[c]:[]),...buttons(c)]);
async function fixture(initial=[]){const html=await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8'),document=new EventTarget(),els=new Map();for(const id of ['wallet-dialog','wallet-list','wallet-support','wallet-close','native-wallet']){assert.match(html,new RegExp(`id="${id}"`));els.set(id,new Element(id==='native-wallet'?'select':'div'));}document.getElementById=id=>els.get(id);document.createElement=tag=>new Element(tag);document.defaultView={Event,CustomEvent};let installed=[...initial];const listeners={register:new Set(),unregister:new Set()},registry={get:()=>[...installed],on:(type,fn)=>{listeners[type].add(fn);return()=>listeners[type].delete(fn);}};return{document,els,registry,set(wallets,type='register'){installed=[...wallets];for(const f of [...listeners[type]])f();},listeners};}

test('three fixed official wallet choices are always present without connecting or importing provider URLs',()=>{
  const rows=buildWalletCatalog([]);assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.url),['https://phantom.com/download','https://www.solflare.com/download/','https://backpack.app/']);assert.ok(rows.every(r=>r.installed===false&&r.wallet===null));assert.equal(SOLANA_WALLET_CHOICES[0].name,'Phantom · 幽灵钱包');
});
test('installed aliases produce one brand card backed by one capable live object',()=>{
  const a=wallet('Phantom',[0]),b=wallet(),other=wallet('<img src=x onerror=alert(1)>');const rows=buildWalletCatalog([a.w,b.w,other.w],network),phantoms=rows.filter(r=>r.key.startsWith('phantom'));
  assert.equal(phantoms.length,1);assert.equal(phantoms[0].wallet,b.w);assert.equal(phantoms[0].url,null);assert.doesNotMatch(phantoms[0].name,/1\/2|2\/2/);assert.equal(rows.at(-1).wallet,other.w);for(const w of [a,b,other])assert.deepEqual(w.calls,{connect:0,message:0,sign:0,send:0});
});
test('message login and exact numeric-v1 transaction ability are independent and agree with the unchanged SDK gate',()=>{
  for(const versions of [['legacy',0],['1'],[],[1]]){const {w,calls}=wallet('Phantom',versions),c=walletCapabilities(w,network);assert.equal(c.messageLogin,true);assert.equal(c.transactionSupported,versions.includes(1));assert.equal(c.transactionSupported,walletV1Capability(w,'solana:devnet').supported);assert.deepEqual(calls,{connect:0,message:0,sign:0,send:0});}
  const {w}=wallet('Solflare');delete w.features['solana:signTransaction'];assert.equal(walletCapabilities(w,network).transactionSupported,false);assert.equal(walletCapabilities(w,network).messageLogin,true);
  const {w:b}=wallet('Backpack');delete b.features['solana:signMessage'];assert.equal(walletCapabilities(b,network).transactionSupported,true);assert.equal(walletCapabilities(b,network).messageLogin,false);
});
test('unknown/unconfigured service chain is not mainnet or transaction-ready; wrong chain stays blocked',()=>{
  const {w}=wallet();for(const config of [null,{}, {enabled:false,chain:'solana:mainnet'},{enabled:true,chain:null},{enabled:true,chain:'solana:bad host'}]){const n=walletNetworkConfig(config);assert.equal(n.known,false);assert.equal(walletCapabilities(w,n).transactionSupported,null);assert.match(walletCapabilities(w,n).transactionText,/待确定/);}
  assert.equal(walletCapabilities(w,walletNetworkConfig({enabled:true,chain:'solana:mainnet'})).transactionSupported,false);
});
test('player wallet summaries use plain status while raw chain and numeric-version diagnosis remains in compatibility details',async()=>{
  const {w}=wallet('Phantom',['legacy',0]),f=await fixture([w]),c=await mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:async()=>response({enabled:true,chain:'solana:devnet'})});
  try{const card=f.els.get('wallet-list').children[0],main=card.children.filter(el=>el.tagName!=='DETAILS').map(text).join(' '),detail=card.children.find(el=>el.tagName==='DETAILS');assert.match(main,/可连接并登录/);assert.match(main,/当前钱包版本暂不支持本项目交易，请更新钱包/);assert.doesNotMatch(main,/solana:|数字 v1|Wallet Standard|独立.*接口/);assert.equal(buttons(card)[0].textContent,'连接 Phantom');assert.match(text(detail),/数字 v1/);assert.equal(walletPlayerSummary(walletCapabilities(w)).transaction,'交易兼容性尚未确定');}finally{c.close();}
});
test('native selection requires the exact bound live object rather than labels or registry order',()=>{
  const {w}=wallet(),{w:fake}=wallet('Phantom · fake'),select=new Element('select');for(const [value,label,provider]of [['7','Phantom · v1 可用',w],['8','Phantom · fake · v1 可用',fake]]){const o=new Element('option');o.value=value;o.textContent=label;bindWalletOption(o,provider);select.append(o);}assert.equal(uniqueNativeWalletOption(select,w,[w,fake]),'7');assert.equal(uniqueNativeWalletOption(select,w,[fake,w]),'7');assert.equal(uniqueNativeWalletOption(select,{...w},[w,fake]),null);
  const unbound=new Element('option');unbound.value='7';unbound.textContent='Phantom · v1 可用';select.replaceChildren(unbound);assert.equal(uniqueNativeWalletOption(select,w,[w,fake]),null);
  bindWalletOption(unbound,w);unbound.disabled=true;assert.equal(uniqueNativeWalletOption(select,w,[w,fake]),null);unbound.disabled=false;assert.equal(uniqueNativeWalletOption(select,w,[fake]),null);
});
test('network config reads only the bounded same-origin endpoint and hides malformed/error provider data',async()=>{
  const calls=[];const n=await readWalletNetworkConfig({fetchImpl:async(...args)=>{calls.push(args);return response({enabled:true,chain:'solana:devnet'});}});assert.deepEqual(n,network);assert.equal(calls[0][0],'/api/native/config');assert.equal(calls[0][1].credentials,'same-origin');assert.equal(calls[0][1].redirect,'error');
  for(const fetchImpl of [async()=>new Response('PRIVATE_DIAGNOSTIC'),async()=>response({x:'x'.repeat(17000)}),async()=>{throw Error('PRIVATE_DIAGNOSTIC');}])await assert.rejects(readWalletNetworkConfig({fetchImpl}),e=>e.message==='WALLET_CONFIG_UNAVAILABLE');
  await assert.rejects(readWalletNetworkConfig({timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),/WALLET_CONFIG_UNAVAILABLE/);
});
test('wallet modal renders fixed missing cards and actual registry entries safely without automatic wallet calls',async()=>{
  const {w,calls}=wallet('<img src=x>'),f=await fixture([w]),requests=[];const control=await mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:async(url)=>{requests.push(url);return response({enabled:true,chain:'solana:devnet'});}});
  try{const content=text(f.els.get('wallet-list'));for(const name of ['Phantom','Solflare','Backpack','<img src=x>'])assert.ok(content.includes(name));assert.match(content,/solana:devnet/);assert.doesNotMatch(content,/支持 v1 \/ Solana 主网/);assert.deepEqual(calls,{connect:0,message:0,sign:0,send:0});assert.deepEqual(requests,['/api/native/config']);f.els.get('wallet-support').click();assert.equal(f.els.get('wallet-dialog').open,true);await tick();assert.deepEqual(calls,{connect:0,message:0,sign:0,send:0});}finally{control.close();}
});
test('one card hands off one live representative, rejects stale cards and never signs or falls back',async()=>{
  const a=wallet('Phantom',[0]),b=wallet(),f=await fixture([a.w,b.w]),events=[];f.document.addEventListener(WALLET_SELECTION_EVENT,e=>events.push(e.detail));const c=await mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:async()=>response({enabled:true,chain:'solana:devnet'})});
  try{const all=buttons(f.els.get('wallet-list'));assert.equal(all.length,1);all[0].click();assert.equal(events.length,1);assert.equal(events[0].wallet,b.w);assert.equal(events[0].connect,true);f.document.dispatchEvent(new CustomEvent(WALLET_SELECTION_RESULT_EVENT,{detail:{accepted:false}}));assert.equal(events.length,1);for(const w of [a,b])assert.deepEqual(w.calls,{connect:0,message:0,sign:0,send:0});const old=all[0];f.set([a.w],'unregister');old.click();assert.equal(events.length,1);assert.match(text(f.els.get('wallet-list')),/钱包已离开页面/);}finally{c.close();}
});
test('late registration/unregister redraws live cards while preserving the same configured network and close detaches listeners',async()=>{
  const f=await fixture([]),a=wallet('Backpack');let resolve;const pending=new Promise(r=>resolve=r),mount=mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:()=>pending});await tick();f.set([a.w]);resolve(response({enabled:true,chain:'solana:devnet'}));const c=await mount;
  try{assert.equal(c.network.known,true);assert.match(text(f.els.get('wallet-list')),/solana:devnet/);assert.ok(buttons(f.els.get('wallet-list')).some(b=>b.textContent.includes('Backpack')));f.set([],'unregister');assert.equal(buttons(f.els.get('wallet-list')).length,0);f.document.dispatchEvent(new CustomEvent(WALLET_SELECTION_RESULT_EVENT,{detail:{accepted:false}}));assert.match(text(f.els.get('wallet-list')),/暂未连接/);}finally{c.close();}assert.equal(f.listeners.register.size,0);assert.equal(f.listeners.unregister.size,0);
});
test('late config from a previous session refresh cannot replace the newer service chain',async()=>{
  const {w}=wallet(),f=await fixture([w]),pending=[];const mounting=mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});await tick();f.document.dispatchEvent(new Event('biolab-auth-change'));await tick();assert.equal(pending.length,2);pending[1](response({enabled:true,chain:'solana:devnet'}));await tick();pending[0](response({enabled:true,chain:'solana:mainnet'}));const c=await mounting;try{assert.equal(c.network.chain,'solana:devnet');assert.match(text(f.els.get('wallet-list')),/solana:devnet/);assert.doesNotMatch(text(f.els.get('wallet-list')),/solana:mainnet/);}finally{c.close();}
});
test('accepted wallet selection opens an optional collapsed login shell without fetching a challenge or invoking a wallet',async()=>{
  const {w,calls}=wallet(),f=await fixture([w]),login=new Element('details');f.els.set('player-login',login);const requests=[],c=await mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:async url=>{requests.push(url);return response({enabled:true,chain:'solana:devnet'});}});
  try{f.els.get('wallet-dialog').showModal();f.document.dispatchEvent(new CustomEvent(WALLET_SELECTION_RESULT_EVENT,{detail:{accepted:false}}));assert.equal(login.open,false);assert.equal(f.els.get('wallet-dialog').open,true);f.document.dispatchEvent(new CustomEvent(WALLET_SELECTION_RESULT_EVENT,{detail:{accepted:true}}));assert.equal(login.open,true);assert.equal(f.els.get('wallet-dialog').open,false);assert.deepEqual(requests,['/api/native/config']);assert.deepEqual(calls,{connect:0,message:0,sign:0,send:0});}finally{c.close();}
});

test('strict OKX and OKEX aliases produce one Solana brand entry without numbered variants',()=>{
  const names=['OKX','OKEX','OKX Wallet','OKEX Wallet','okx',' okex wallet '],all=names.map(name=>wallet(name));
  for(const item of all)assert.deepEqual(walletBrand(item.w),{key:'okx',name:'OKX'});
  const groups=groupWalletProviders(all.map(x=>x.w),{network,purpose:'login'});assert.equal(groups.length,1);assert.equal(groups[0].key,'okx');assert.equal(groups[0].candidateCount,6);assert.ok(all.some(x=>x.w===groups[0].wallet));
  const rows=buildWalletCatalog(all.map(x=>x.w),network),okx=rows.filter(r=>r.name==='OKX');assert.equal(okx.length,1);assert.doesNotMatch(okx[0].buttonLabel,/\(\d|（\d|1\/6/);
  for(const item of all)assert.deepEqual(item.calls,{connect:0,message:0,sign:0,send:0});
});
test('display aliases do not merge distinct brands, prefix lookalikes or unrelated names',()=>{
  const all=['OKX','OKX fake','OKEX Wallet Plus','Phantom','Phantom fake','MetaMask','METAMASK','Backpack'].map(name=>wallet(name));
  assert.notEqual(walletBrand(all[1].w).key,'okx');assert.notEqual(walletBrand(all[2].w).key,'okx');assert.notEqual(walletBrand(all[4].w).key,walletBrand(all[3].w).key);
  const groups=groupWalletProviders(all.map(x=>x.w),{network,purpose:'login'});assert.equal(groups.length,7);assert.equal(groups.filter(g=>g.key===walletBrand(all[5].w).key).length,1);
});
test('same object registered repeatedly is counted once while distinct wrappers remain actual candidates',()=>{
  const a=wallet('OKX'),b=wallet('OKEX');const groups=groupWalletProviders([a.w,a.w,b.w,b.w],{network,purpose:'login'});assert.equal(groups.length,1);assert.equal(groups[0].candidateCount,2);assert.ok(groups[0].wallet===a.w||groups[0].wallet===b.w);
});
test('one brand cannot obtain a combined login and transaction capability from separate providers',()=>{
  const a=wallet('OKX'),b=wallet('OKEX Wallet');delete a.w.features['solana:signTransaction'];delete b.w.features['solana:signMessage'];
  const login=groupWalletProviders([a.w,b.w],{network,purpose:'login'})[0],transaction=groupWalletProviders([a.w,b.w],{network,purpose:'transaction'})[0];assert.equal(login.wallet,a.w);assert.equal(transaction.wallet,b.w);
  assert.equal(walletCapabilities(login.wallet,network).messageLogin,true);assert.equal(walletCapabilities(login.wallet,network).transactionSupported,false);assert.equal(walletCapabilities(transaction.wallet,network).messageLogin,false);assert.equal(walletCapabilities(transaction.wallet,network).transactionSupported,true);
  for(const item of [a,b])assert.deepEqual(item.calls,{connect:0,message:0,sign:0,send:0});
});
test('transaction representative uses actual current-chain numeric-v1 ability rather than brand name',()=>{
  const wrongChain=wallet('OKX'),stringVersion=wallet('OKEX',['1']),right=wallet('OKX Wallet');wrongChain.w.chains=['solana:mainnet'];
  const groups=groupWalletProviders([wrongChain.w,stringVersion.w,right.w],{network,purpose:'transaction'});assert.equal(groups.length,1);assert.equal(groups[0].wallet,right.w);assert.equal(walletCapabilities(groups[0].wallet,network).transactionSupported,true);
});
test('preferred live provider remains exact through reorder, new registration and weaker capability',()=>{
  const preferred=wallet('OKEX',[0]),other=wallet('OKX'),late=wallet('OKX Wallet');for(const entries of [[preferred.w,other.w],[other.w,preferred.w],[late.w,other.w,preferred.w]]){const rows=groupWalletProviders(entries,{network,purpose:'login',preferredWallet:preferred.w});assert.equal(rows.length,1);assert.equal(rows[0].wallet,preferred.w);}
  const rows=groupWalletProviders([other.w,preferred.w],{network,purpose:'transaction',preferredWallet:preferred.w});assert.equal(rows[0].wallet,preferred.w);assert.equal(walletCapabilities(rows[0].wallet,network).transactionSupported,false);
  const removed=groupWalletProviders([other.w,late.w],{network,purpose:'login',preferredWallet:preferred.w});assert.notEqual(removed[0].wallet,preferred.w);for(const item of [preferred,other,late])assert.deepEqual(item.calls,{connect:0,message:0,sign:0,send:0});
});
test('six OKX registrations render one connect action and rejection does not emit a fallback request',async()=>{
  const all=['OKX','OKEX','OKX Wallet','OKEX Wallet','okx','okex'].map(name=>wallet(name)),f=await fixture(all.map(x=>x.w)),events=[];f.document.addEventListener(WALLET_SELECTION_EVENT,e=>events.push(e.detail));const c=await mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:async()=>response({enabled:true,chain:'solana:devnet'})});
  try{const cards=f.els.get('wallet-list').children.filter(e=>e.className.includes('wallet-card')),okx=cards.filter(card=>card.children.find(el=>el.tagName==='H3')?.textContent==='OKX');assert.equal(okx.length,1);const visible=buttons(f.els.get('wallet-list'));assert.equal(visible.length,1);assert.equal(visible[0].textContent,'连接 OKX');visible[0].click();assert.equal(events.length,1);assert.ok(all.some(x=>x.w===events[0].wallet));f.document.dispatchEvent(new CustomEvent(WALLET_SELECTION_RESULT_EVENT,{detail:{accepted:false}}));await tick();assert.equal(events.length,1);for(const item of all)assert.deepEqual(item.calls,{connect:0,message:0,sign:0,send:0});}finally{c.close();}
});
test('visible brand choice keeps its explicitly selected provider through later stronger registration',async()=>{
  const a=wallet('OKEX',[0]),b=wallet('OKX'),f=await fixture([a.w]),events=[];f.document.addEventListener(WALLET_SELECTION_EVENT,e=>events.push(e.detail));const c=await mountWalletPanel(f.document,{getWallets:()=>f.registry,fetchImpl:async()=>response({enabled:true,chain:'solana:devnet'})});
  try{buttons(f.els.get('wallet-list'))[0].click();assert.equal(events.at(-1).wallet,a.w);f.set([b.w,a.w]);assert.equal(buttons(f.els.get('wallet-list')).length,1);buttons(f.els.get('wallet-list'))[0].click();assert.equal(events.at(-1).wallet,a.w);const old=buttons(f.els.get('wallet-list'))[0],count=events.length;f.set([b.w],'unregister');assert.equal(events.length,count);old.click();assert.equal(events.length,count);buttons(f.els.get('wallet-list'))[0].click();assert.equal(events.at(-1).wallet,b.w);for(const item of [a,b])assert.deepEqual(item.calls,{connect:0,message:0,sign:0,send:0});}finally{c.close();}
});
