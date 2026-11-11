// These main-workbench pages describe production capability and link to the
// explicitly enabled local test account. They never buy, sign or start it.
export function localMarketPreview(config,origin){
  try{const u=new URL(origin);return u.origin===origin&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&config?.profile==='BIO-LOCAL-PLAYTEST1'&&config.enabled===true&&config.referenceModel===true&&config.networkSubmitted===false&&config.origin===origin;}catch{return false;}
}
export function mountMarketPanels(document,{fetchImpl=globalThis.fetch,origin=document.defaultView?.location?.origin??'',timeoutMs=5000}={}){
  const kinds=['material','product','bio'],links=kinds.map(k=>document.getElementById(`market-${k}-test-link`)),asset=document.getElementById('player-test-assets-link');if(!links.some(Boolean))return null;
  let closed=false;const controller=new AbortController();
  const set=value=>{for(const link of [...links,asset])if(link)link.hidden=!value;for(const kind of kinds){const p=document.getElementById(`market-${kind}-mode`);if(p)p.textContent=value?'正式市场尚未开放。本机测试账号可体验买卖、上架和下架。':'正式市场尚未开放，当前没有可用的正式挂牌或成交入口。';}};
  set(false);
  const ready=(async()=>{const timer=setTimeout(()=>controller.abort(),timeoutMs);try{
    const r=await fetchImpl('/api/playtest/config',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:{accept:'application/json'},signal:controller.signal});
    if(!r.ok||!/\bapplication\/json\b/i.test(r.headers?.get('content-type')??''))return false;
    const bytes=await r.text();if(bytes.length>8192)return false;const enabled=localMarketPreview(JSON.parse(bytes),origin);if(!closed)set(enabled);return enabled;
  }catch{return false;}finally{clearTimeout(timer);}})();
  return{ready,close(){closed=true;controller.abort();set(false);}};
}
if(typeof document!=='undefined')mountMarketPanels(document);
