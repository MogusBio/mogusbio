import { nativeRequest } from './native-console.js';
import { discoveryCheck,discoveryConfigReady,discoveryContext,discoveryRequest,checkedDiscoveryPage,discoveryCoverageText,discoveryCopy,discoveryFreeze,discoveryFetch } from './discovery-contract.js';

const json=v=>JSON.stringify(v,null,2);
const classNames=['AA','NUC','LIPID','SUGAR'];

/** Only current identifiers move; receiving project-read remains mandatory. */
export function handoffDirectoryProject(document,page,projectIdHex,config){
  const context=discoveryContext(config);discoveryCheck(page?.query.actor===config.sessionActor&&page.result.decision==='DISCOVERY_PAGE'&&Object.entries(context).every(([k,v])=>page.result.context[k]===v),'请先读取当前账户的实际目录。');
  discoveryCheck(page.result.rows.some(row=>row.type==='PROJECT'&&row.projectIdHex===projectIdHex),'请选择本页实际核验的项目。');
  const fields={'project-actor':config.sessionActor,'project-read-id':projectIdHex},tab=document.getElementById('project-tab-read'),nav=[...document.querySelectorAll('.nav-item')].find(b=>b.dataset.view==='project');discoveryCheck(tab&&nav,'现有项目读取页不可用。');
  const EventClass=document.defaultView?.Event??globalThis.Event;for(const [name,value]of Object.entries(fields)){const el=document.getElementById(name);discoveryCheck(el,'现有项目表单不可用。');el.value=value;el.dispatchEvent(new EventClass('input',{bubbles:true}));}tab.click();nav.click();
}

export async function mountProjectDirectory(document,{fetchImpl=globalThis.fetch}={}){
  const $=id=>document.getElementById(id);if(!$('directory-view'))return;
  const state={config:null,generation:0,page:null,selection:'',resume:null};let active=null,configController=null,busy=false,configBusy=false;
  const fetchRead=discoveryFetch(fetchImpl,()=>{state.config=null;configController?.abort();configController=null;configBusy=false;invalidate('登录或访问权限已失效；请刷新会话并重读配置。');$('directory-config-badge').textContent='权限失效 · 发现关闭';});
  const message=(s,error=false)=>{$('directory-message').textContent=s;$('directory-message').className=`native-message${error?' error':''}`;};
  function invalidate(text='查询已变化；旧页、选择和继续标识已失效。'){active?.abort();active=null;busy=false;state.generation++;state.page=null;state.selection='';state.resume=null;message(text);render();}
  function render(){
    const ready=discoveryConfigReady(state.config),page=state.page?.result;
    $('directory-actor').textContent=ready?state.config.sessionActor:'未登录当前发布';
    for(const name of ['section','query'])$('directory-'+name).disabled=!ready||busy||configBusy;
    let valid=false;try{discoveryRequest({config:state.config,section:$('directory-section').value,query:$('directory-query').value});valid=true;}catch{}
    $('directory-start').disabled=!ready||busy||configBusy||!valid;
    $('directory-next').disabled=!ready||busy||configBusy||!(page?.nextCursor??state.resume?.cursor)||page?.decision==='DISCOVERY_RESTART_REQUIRED';$('directory-next').textContent=state.resume?'重试本次继续请求':'继续有界扫描';
    $('directory-reset').disabled=busy||configBusy||!state.page&&!state.resume;
    $('directory-selection').disabled=!ready||busy||configBusy||page?.decision!=='DISCOVERY_PAGE'||!page.rows.length;
    $('directory-use').disabled=!ready||busy||configBusy||!state.selection||page?.decision!=='DISCOVERY_PAGE'||!page.rows.some(r=>r.projectIdHex===state.selection);
    $('directory-coverage').textContent=page?discoveryCoverageText(page.coverage):'尚未读取；按分区发现项目，可购数量须另行核对。';
    $('directory-json').textContent=page?json(page):'尚未读取';
    $('directory-rows').replaceChildren();$('directory-selection').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='明确选择本页项目';$('directory-selection').append(placeholder);
    if(page){
      $('directory-count').textContent=`本页 ${page.rows.length} 个已核验项目 · ${page.coverage.pending?'仍有待处理工作':'以覆盖说明为准'}`;
      for(const row of page.rows){
        const option=document.createElement('option');option.value=row.projectIdHex;option.textContent=`${row.name} · ${row.projectIdHex}`;$('directory-selection').append(option);
        const card=document.createElement('article');card.className='discovery-row';const heading=document.createElement('h3');heading.textContent=row.name;const meta=document.createElement('p');meta.className='discovery-meta';meta.textContent=`ID ${row.projectIdHex}\n创建人 ${row.creator}\n固定收款人 ${row.seller}\n创建 slot ${row.createdSlot} · 本次观察 ${row.observedSlot}`;
        const table=document.createElement('table'),head=document.createElement('thead'),headRow=document.createElement('tr');for(const label of ['原料','项目已发行 / 项目上限','单价（lamports / 份）']){const th=document.createElement('th');th.textContent=label;headRow.append(th);}head.append(headRow);const body=document.createElement('tbody');for(const c of row.classes){const tr=document.createElement('tr');for(const value of [classNames[c.class-1],`${c.issued} / ${c.cap}`,c.unitPriceLamports]){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}table.append(head,body);card.append(heading,meta,table);$('directory-rows').append(card);
      }
      if(!page.rows.length){const note=document.createElement('p');note.className='native-hint';note.textContent=page.coverage.pending?'本页没有匹配项，但还有分区或候选待处理；可继续扫描。':'本次观察没有返回匹配项；不代表全网或整个钱包不存在相关记录。';$('directory-rows').append(note);}
    }else $('directory-count').textContent='每页最多 8 条实际记录';
    $('directory-selection').value=state.selection;
  }
  async function loadConfig(){configController?.abort();const controller=new AbortController();configController=controller;configBusy=true;state.config=null;invalidate('正在读取登录与固定发布配置；不会连接钱包。');$('directory-config-badge').textContent='读取中';render();try{const r=await nativeRequest('config',undefined,{fetchImpl:fetchRead,signal:controller.signal});if(configController!==controller)return;state.config=discoveryFreeze(discoveryCopy(r));$('directory-config-badge').textContent=discoveryConfigReady(r)?'已登录 · 只读发现':'需要登录 · 发现关闭';message(discoveryConfigReady(r)?'可开始有界目录扫描；不会生成交易或固定可购数量。':'先登录当前发布的钱包账户。目录与所有交接保持关闭。');}catch(e){if(configController===controller){$('directory-config-badge').textContent='配置不可用 · 已关闭';message(e.message,true);}}finally{if(configController===controller){configController=null;configBusy=false;render();}}}
  async function readPage(continuation){
    if(busy||configBusy||!discoveryConfigReady(state.config))return;let query;try{query=discoveryRequest({config:state.config,section:$('directory-section').value,cursor:continuation?(state.page?.result.nextCursor??state.resume?.cursor):null,query:$('directory-query').value});if(continuation)discoveryCheck(query.cursor!==null,'没有可继续的当前扫描。');}catch(e){message(e.message,true);return;}
    active?.abort();const controller=new AbortController(),generation=++state.generation,config=state.config;active=controller;busy=true;state.selection='';state.page=null;state.resume=null;message('正在读取实际项目分区和记录；不会预留 nonce 或调用钱包。');render();
    try{const result=await nativeRequest('discovery-read',query,{fetchImpl:fetchRead,signal:controller.signal});if(active!==controller||state.generation!==generation||state.config!==config)return;const page=checkedDiscoveryPage(result,query,config);state.page=page;message(result.decision==='DISCOVERY_RESTART_REQUIRED'?'扫描标识已失效，请从头重扫。':result.decision==='DISCOVERY_BLOCKED'?'当前发现受阻；查看覆盖与问题代码，不推断为空。':'本页实际记录已读取；选择项目后只填入现有读取页。');}
    catch(e){if(active===controller&&state.generation===generation){if(query.cursor!==null)state.resume=discoveryFreeze(discoveryCopy(query));message(e.message,true);}}finally{if(active===controller&&state.generation===generation){active=null;busy=false;render();}}
  }
  for(const id of ['directory-section','directory-query'])for(const event of ['input','change'])$(id).addEventListener(event,()=>invalidate());
  $('directory-selection').addEventListener('change',()=>{state.selection=$('directory-selection').value;render();});
  $('directory-start').addEventListener('click',()=>void readPage(false));$('directory-next').addEventListener('click',()=>void readPage(true));$('directory-reset').addEventListener('click',()=>invalidate('扫描与选择已清除；请明确开始新扫描。'));$('directory-reload').addEventListener('click',()=>void loadConfig());
  $('directory-use').addEventListener('click',()=>{if(!busy&&discoveryConfigReady(state.config))try{handoffDirectoryProject(document,state.page,state.selection,state.config);}catch(e){message(e.message,true);}});
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{invalidate('视图已切换；旧目录选择与交接已失效。');document.querySelectorAll('.view').forEach(view=>{view.hidden=view.id!==`${button.dataset.view}-view`;});if(button.dataset.view==='directory')$('page-title').textContent='实验室发售目录';if(button.dataset.view==='wallet-discovery')$('page-title').textContent='我的 BioLab 资产';}));
  document.addEventListener?.('biolab-auth-change',()=>{state.config=null;invalidate('登录身份变化；目录与继续标识已清除。');void loadConfig();});
  await loadConfig();return {state,render};
}
if(typeof document!=='undefined')void mountProjectDirectory(document).catch(()=>{const el=document.getElementById('directory-message');if(el)el.textContent='目录不可用；发现与交接保持关闭。';});
