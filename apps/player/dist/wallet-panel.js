import {buildWalletCatalog,walletCapabilities,walletPlayerSummary,readWalletNetworkConfig,uniqueNativeWalletOption,WALLET_SELECTION_EVENT,WALLET_SELECTION_RESULT_EVENT} from './wallet-catalog.js';

export async function mountWalletPanel(document,{getWallets,fetchImpl=globalThis.fetch}={}){
  const $=id=>document.getElementById(id),dialog=$('wallet-dialog'),list=$('wallet-list');if(!dialog||!list||!$('wallet-support')||!$('wallet-close'))return;
  let registry=null,network={known:false,chain:null},generation=0,active=null,closed=false,preferredWallet=null;const cleanups=[];
  const EventClass=document.defaultView?.CustomEvent??globalThis.CustomEvent,EventCtor=document.defaultView?.Event??globalThis.Event;
  const listen=(target,type,fn)=>{target?.addEventListener?.(type,fn);cleanups.push(()=>target?.removeEventListener?.(type,fn));};
  const message=document.createElement('p');message.className='wallet-catalog-message';message.setAttribute('role','status');
  const actual=()=>registry?.get?.()??[];
  const announce=text=>{message.textContent=text;};
  function select(entry){
    if(closed||!entry.wallet||!actual().includes(entry.wallet)){announce('钱包已离开页面，请重新选择。');draw();return;}
    if(!walletCapabilities(entry.wallet,network).messageLogin){announce('此钱包未提供消息登录接口；不能用于当前站点登录。');return;}
    preferredWallet=entry.wallet;
    const native=$('native-wallet'),nativeValue=uniqueNativeWalletOption(native,entry.wallet,actual());
    if(nativeValue!==null){native.value=nativeValue;native.dispatchEvent(new EventCtor('change',{bubbles:true}));}
    announce('正在选择此钱包并请求连接；登录消息仍须你明确签署。');
    document.dispatchEvent(new EventClass(WALLET_SELECTION_EVENT,{detail:{wallet:entry.wallet,connect:true}}));
  }
  function draw(){
    if(closed)return;list.replaceChildren();
    let entries;try{entries=buildWalletCatalog(actual(),network,preferredWallet);}catch{entries=buildWalletCatalog([],network);announce('钱包信息暂不可读，请稍后重新打开。');}
    for(const entry of entries){
      const card=document.createElement('section');card.className=`wallet-card${entry.installed?' wallet-installed':''}`;
      const title=document.createElement('h3');title.className='wallet-card-heading';title.textContent=entry.name;card.append(title);
      const status=document.createElement('p');status.textContent=entry.installed?'已检测到钱包':'当前浏览器未检测到';card.append(status);
      if(entry.installed){
        const human=walletPlayerSummary(entry.capabilities),capabilities=document.createElement('p');capabilities.className='wallet-capabilities';capabilities.textContent=`${human.connection} · ${human.transaction}`;card.append(capabilities);
        if(entry.duplicateName){const note=document.createElement('p');note.textContent='检测到多个同名钱包条目，请按编号明确选择。';card.append(note);}
        const button=document.createElement('button');button.type='button';button.className='quiet wallet-card-actions';button.textContent=entry.buttonLabel;button.disabled=!entry.capabilities.messageLogin;button.addEventListener('click',()=>select(entry));card.append(button);
        const details=document.createElement('details'),summary=document.createElement('summary'),technical=document.createElement('p');summary.textContent='兼容详情';technical.textContent=[entry.capabilities.connectionText,entry.capabilities.messageText,entry.capabilities.transactionText].join(' · ');details.append(summary,technical);card.append(details);
      }else{
        const link=document.createElement('a');link.className='quiet wallet-card-actions';link.textContent='前往官方网站';link.href=entry.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);
      }
      list.append(card);
    }
    list.append(message);
  }
  async function reload(){
    active?.abort();const controller=new AbortController(),g=++generation;active=controller;network={known:false,chain:null};draw();
    try{const next=await readWalletNetworkConfig({fetchImpl,signal:controller.signal});if(!closed&&g===generation){network=next;draw();}}catch{if(!closed&&g===generation){network={known:false,chain:null};draw();}}finally{if(active===controller)active=null;}
  }
  listen($('wallet-support'),'click',()=>{draw();dialog.showModal();void reload();});listen($('wallet-close'),'click',()=>dialog.close());
  listen(document,'biolab-auth-change',()=>void reload());
  listen(document,WALLET_SELECTION_RESULT_EVENT,event=>{if(closed)return;const value=event.detail;if(value?.accepted===true){announce('钱包已选中。连接成功后，请核对完整登录消息并明确签署。');const login=$('player-login');if(login)login.open=true;dialog.close();}else announce('暂未连接；请在登录区重新选择或稍后重试。');});
  try{registry=(getWallets??(await import('/vendor/wallets.js')).getWallets)();for(const name of ['register','unregister']){const remove=registry.on(name,draw);if(typeof remove==='function')cleanups.push(remove);}}catch{announce('标准钱包发现暂不可用；可以使用固定官方入口。');}
  draw();await reload();return{reload,draw,get network(){return network;},close(){if(closed)return;closed=true;generation++;active?.abort();for(const cleanup of cleanups)cleanup();}};
}
if(typeof document!=='undefined')void mountWalletPanel(document).catch(()=>{const el=document.getElementById('wallet-list');if(el)el.textContent='钱包入口暂不可用，请稍后重试。';});
