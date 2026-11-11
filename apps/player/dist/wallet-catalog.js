// Display helpers only. Names do not authenticate a provider or grant signing
// authority; transaction/account checks remain in the existing SDK and console.
export const SOLANA_WALLET_CHOICES=Object.freeze([
  Object.freeze({key:'phantom',name:'Phantom · 幽灵钱包',registeredName:'Phantom',url:'https://phantom.com/download'}),
  Object.freeze({key:'solflare',name:'Solflare',registeredName:'Solflare',url:'https://www.solflare.com/download/'}),
  Object.freeze({key:'backpack',name:'Backpack',registeredName:'Backpack',url:'https://backpack.app/'}),
]);
export const WALLET_SELECTION_EVENT='biolab-wallet-select';
export const WALLET_SELECTION_RESULT_EVENT='biolab-wallet-selection-result';
export const walletDisplayName=wallet=>typeof wallet?.name==='string'&&wallet.name.trim()?wallet.name.normalize('NFC').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,100):'未命名 Wallet Standard 钱包';
const chainValid=chain=>typeof chain==='string'&&/^solana:[A-Za-z0-9]+$/.test(chain);
const aliases=new Map([
  ['phantom',['phantom']],['solflare',['solflare']],['backpack',['backpack']],
  ['okx',['okx','okex','okx wallet','okex wallet','okxwallet','okexwallet','欧易','欧易钱包']],
  ['metamask',['metamask','metamask wallet']],
]);
const brandNames={phantom:'Phantom',solflare:'Solflare',backpack:'Backpack',okx:'OKX',metamask:'MetaMask'};
export function walletBrand(wallet){const name=walletDisplayName(wallet).trim().replace(/\s+/g,' '),normalized=name.toLowerCase();for(const [key,names]of aliases)if(names.includes(normalized))return{key,name:brandNames[key]};return{key:`other:${normalized}`,name};}
export function groupWalletProviders(wallets,{network={known:false,chain:null},purpose='login',preferredWallet=null}={}){
  const groups=new Map();for(const w of new Set((Array.isArray(wallets)?wallets:[]).filter(w=>w&&typeof w==='object'))){const brand=walletBrand(w);if(!groups.has(brand.key))groups.set(brand.key,{...brand,candidates:[]});groups.get(brand.key).candidates.push(w);}
  const score=w=>{const c=walletCapabilities(w,network);return purpose==='transaction'?(c.transactionSupported===true?10000:0)+(c.connect&&c.independentSign&&c.numericV1?1000:0)+(c.correctNetwork?100:0)+(c.messageLogin?10:0):(c.messageLogin?10000:0)+(c.transactionSupported===true?500:0)+(c.correctNetwork?200:0)+(c.independentSign&&c.numericV1?100:0);};
  return [...groups.values()].map(g=>({key:g.key,name:g.name,candidateCount:g.candidates.length,wallet:g.candidates.includes(preferredWallet)?preferredWallet:g.candidates.reduce((best,w)=>score(w)>score(best)?w:best)}));
}
// An option represents one concrete live object. Names and provider ordering
// cannot substitute for that binding when another selector synchronizes it.
const optionWallets=new WeakMap();
export function bindWalletOption(option,wallet){optionWallets.set(option,wallet);return option;}

export function walletNetworkConfig(value){
  return Object.freeze(value?.enabled===true&&chainValid(value.chain)
    ?{known:true,chain:value.chain}:{known:false,chain:null});
}

export function walletCapabilities(wallet,network={known:false,chain:null}){
  const features=wallet?.features,sign=features?.['solana:signTransaction'];
  const connect=typeof features?.['standard:connect']?.connect==='function';
  const message=typeof features?.['solana:signMessage']?.signMessage==='function';
  const independentSign=typeof sign?.signTransaction==='function';
  const numericV1=Array.isArray(sign?.supportedTransactionVersions)&&sign.supportedTransactionVersions.some(v=>v===1);
  const known=network?.known===true&&chainValid(network.chain);
  const correctNetwork=known&&Array.isArray(wallet?.chains)&&wallet.chains.includes(network.chain);
  return Object.freeze({connect,messageLogin:connect&&message,independentSign,numericV1,
    networkKnown:known,correctNetwork,transactionSupported:known?connect&&independentSign&&numericV1&&correctNetwork:null,
    connectionText:connect?'可连接':'缺少标准连接接口',
    messageText:connect&&message?'可签署登录消息':'未提供消息登录接口',
    transactionText:!known?'交易能力待确定 · 服务网络未配置':!correctNetwork?'未声明支持当前网络':!numericV1?'当前版本未声明数字 v1 交易':!independentSign?'缺少独立交易签名接口':!connect?'缺少标准连接接口':`当前 ${network.chain} 接口支持 v1 · 仍须逐笔核验`});
}

export function buildWalletCatalog(wallets,network={known:false,chain:null},preferredWallet=null){
  const groups=groupWalletProviders(wallets,{network,preferredWallet});
  const used=new Set(),entries=[];
  for(const choice of SOLANA_WALLET_CHOICES){
    const group=groups.find(g=>g.key===choice.key);
    if(!group){entries.push(Object.freeze({key:choice.key,name:choice.name,installed:false,url:choice.url,wallet:null,duplicateName:false}));continue;}
    used.add(group.key);entries.push(Object.freeze({key:choice.key,name:choice.name,buttonLabel:`连接 ${choice.registeredName}`,installed:true,url:null,wallet:group.wallet,duplicateName:false,providerCount:group.candidateCount,capabilities:walletCapabilities(group.wallet,network)}));
  }
  for(const group of groups.filter(g=>!used.has(g.key)))entries.push(Object.freeze({key:group.key,name:group.name,buttonLabel:`连接 ${group.name}`,installed:true,url:null,wallet:group.wallet,duplicateName:false,providerCount:group.candidateCount,capabilities:walletCapabilities(group.wallet,network)}));
  return entries;
}

export function walletPlayerSummary(capabilities){
  const connection=capabilities?.messageLogin?'可连接并登录':capabilities?.connect?'可连接，暂不支持站点登录':'暂无法连接';
  const transaction=!capabilities?.networkKnown?'交易兼容性尚未确定':!capabilities.correctNetwork?'当前网络不匹配':!capabilities.transactionSupported?'当前钱包版本暂不支持本项目交易，请更新钱包':'已声明交易支持，签名前会再次核对';
  return Object.freeze({connection,transaction});
}

// Synchronize only a uniquely identified existing select option. This is a UI
// selection, not an authorization proof or permission to sign/connect.
export function uniqueNativeWalletOption(select,wallet,wallets){
  if(!(Array.isArray(wallets)?wallets:[]).includes(wallet))return null;
  const options=Array.from(select?.options??select?.children??[]).filter(o=>o.tagName?.toLowerCase()==='option'&&!o.disabled&&optionWallets.get(o)===wallet);
  return options.length===1?String(options[0].value):null;
}

export async function readWalletNetworkConfig({fetchImpl=globalThis.fetch,signal,timeoutMs=5000}={}){
  const controller=new AbortController(),abort=()=>controller.abort();let reader;
  if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeoutMs);
  const bounded=p=>new Promise((resolve,reject)=>{const stop=()=>{cleanup();reject(new Error('WALLET_CONFIG_UNAVAILABLE'));},cleanup=()=>controller.signal.removeEventListener('abort',stop);if(controller.signal.aborted){stop();return;}controller.signal.addEventListener('abort',stop,{once:true});Promise.resolve(p).then(v=>{cleanup();resolve(v);},()=>{cleanup();reject(new Error('WALLET_CONFIG_UNAVAILABLE'));});});
  try{
    const response=await bounded(fetchImpl('/api/native/config',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json'},signal:controller.signal}));
    if(!response.ok||!/\bapplication\/json\b/i.test(response.headers?.get('content-type')??''))throw Error('WALLET_CONFIG_UNAVAILABLE');
    const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16384))throw Error('WALLET_CONFIG_UNAVAILABLE');
    if(!response.body?.getReader)throw Error('WALLET_CONFIG_UNAVAILABLE');reader=response.body.getReader();let size=0;const chunks=[];
    for(;;){const {done,value}=await bounded(reader.read());if(done)break;size+=value.byteLength;if(size>16384)throw Error('WALLET_CONFIG_UNAVAILABLE');chunks.push(value);}
    const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}
    return walletNetworkConfig(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  }catch{throw Error('WALLET_CONFIG_UNAVAILABLE');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
}
