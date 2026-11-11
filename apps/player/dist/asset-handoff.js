// Current identifiers and an explicit panel selection only. Receiving readers
// still recheck the actual Root, historical beneficiary, interval and nonce.
export function handoffKnownAsset(document,{actor,instanceHex,positionPageStart='0',positionPageLimit='5'}){
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  check(typeof actor==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(actor),'作品操作人地址无效。');
  check(typeof instanceHex==='string'&&/^[0-9a-f]{64}$/.test(instanceHex),'作品实例ID无效。');
  check(typeof positionPageStart==='string'&&/^(0|[1-9][0-9]*)$/.test(positionPageStart)&&BigInt(positionPageStart)<=18446744073709551615n,'历史起始序号无效。');
  check(['1','5','10','20'].includes(positionPageLimit),'历史页大小没有对应的实际选项。');
  const fields={'guided-actor':actor,'guided-instance':instanceHex,'guided-page-start':positionPageStart,'guided-page-limit':positionPageLimit};
  const controls=Object.entries(fields).map(([id,value])=>({el:document.getElementById(id),value})),tab=document.getElementById('guided-tab-asset'),nav=[...document.querySelectorAll('.nav-item')].find(b=>b.dataset.view==='guided');
  check(tab&&nav&&controls.every(c=>c.el),'已有作品与历史权益页面不可用。');
  const EventClass=document.defaultView?.Event??globalThis.Event;
  for(const {el,value}of controls)el.value=value;
  for(const {el}of controls)el.dispatchEvent(new EventClass('input',{bubbles:true}));
  tab.click();nav.click();
}
