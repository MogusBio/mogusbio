import { nativeRequest,parsePublicJson,parseIntent,decimalString,validateResources,trustedConsoleConfig } from './native-console.js';
import { handoffGuidedIntent } from './guided-operations.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const json=value=>JSON.stringify(value,null,2);
const copy=value=>JSON.parse(JSON.stringify(value));
const frozen=value=>{if(object(value)||Array.isArray(value)){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
const bytesLength=value=>new TextEncoder().encode(value).length;
const address=value=>{const result=typeof value==='string'?value.trim():'';check(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result),'请输入有效的公钥地址；完整地址与权限仍由服务端核对。');return result;};
const id32=value=>{check(typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),'请输入 32 字节小写 hex ID。');return value;};
const CLASS_NAMES=['AA · 氨基酸类','NUC · 核苷酸类','LIPID · 脂质类','SUGAR · 糖类'];
const CLASS_INPUTS=Array.from({length:4},(_,i)=>[`project-cap-${i+1}`,`project-price-${i+1}`]).flat();
const INPUTS=['project-actor','project-name','project-seller','project-max-creation-fee','project-max-rent','project-resources','project-read-id','project-status-nonce',...CLASS_INPUTS];

export function projectName(value){
  check(typeof value==='string'&&bytesLength(value)>=1&&bytesLength(value)<=64&&!/[\u0000-\u001f\u007f-\u009f]/.test(value)
    &&![...value].some(char=>{const cp=char.codePointAt(0);return cp>=0xd800&&cp<=0xdfff;}),'项目名称须为 1–64 个 UTF-8 字节，且不得含控制字符或无效 Unicode。');
  return value;
}

function classValues(entry){
  const cap=decimalString(entry.cap),unitPrice=decimalString(entry.unitPrice);
  check(BigInt(cap)>=1n&&BigInt(cap)<=1000000n,'每类终身配额必须为 1–1,000,000 标准单位 / 份。');
  check(BigInt(unitPrice)<=18446744073709451615n,'单价加每份原料费不得超过 u64 上限。');
  return {cap,unitPrice};
}

function projectClasses(classes){
  check(Array.isArray(classes)&&classes.length===4,'必须明确提供全部四类原料。');
  return classes.map((entry,index)=>{
    check(object(entry)&&Object.keys(entry).length===3&&entry.class===index+1&&Object.hasOwn(entry,'cap')&&Object.hasOwn(entry,'unitPrice'),'四类原料必须按 1–4 排列，只含 class、cap、unitPrice。');
    return {class:entry.class,...classValues(entry)};
  });
}

export function projectPlanRequest(values){
  return {actor:address(values.actor),name:projectName(values.name),seller:address(values.seller),classes:projectClasses(values.classes),
    maxCreationFee:decimalString(values.maxCreationFee),maxRent:decimalString(values.maxRent),resources:validateResources(parsePublicJson(values.resources,1024))};
}

export function projectReadRequest(values){return {actor:address(values.actor),projectIdHex:id32(values.projectIdHex)};}
export function projectStatusRequest(values){return {actor:address(values.actor),nonce:decimalString(values.nonce)};}

export function checkedProjectPlan(result,request){
  check(object(result)&&typeof result.decision==='string','服务端未返回明确的项目规划决策。');
  if(result.decision!=='ACTION'){check(!Object.hasOwn(result,'intent'),'非 ACTION 结果不能提供可用 intent。');return null;}
  check(result.clientPlanOnly===true&&result.transactionExecuted===false,'创建草案缺少只规划、未执行标记。');
  check(!Object.hasOwn(result,'actor')||result.actor===request.actor,'规划 Actor 与当前请求不一致。');
  const intent=parseIntent(json(result.intent));check(intent.operation==='CREATE_PROJECT','规划操作必须是 CREATE_PROJECT。');
  check(Object.keys(request.resources).every(key=>intent.resources[key]===request.resources[key]),'规划资源预算与当前明确请求不一致。');
  return frozen({actor:request.actor,intent:copy(intent),request:copy(request),result:copy(result)});
}

function actualProjectRecords(result,query){
  check(result.projectRecordVerified===true&&object(result.project),'服务端未核验实际项目记录。');
  const project=result.project;check(project.projectIdHex===query.projectIdHex&&result.projectIdHex===query.projectIdHex&&result.actor===query.actor,'实际项目 ID 或 Actor 与本次查询不一致。');
  address(project.address);projectName(project.name);address(project.creator);address(project.seller);id32(project.creationBusinessHex);decimalString(result.contextSlot);
  check(Array.isArray(project.classes)&&project.classes.length===4&&Array.isArray(result.mints)&&result.mints.length===4,'实际记录必须包含四类配额与四个 mint。');
  const seen=new Set();
  for(let index=0;index<4;index++){
    const entry=project.classes[index],mint=result.mints[index];
    check(object(entry)&&object(mint)&&entry.class===index+1&&mint.class===index+1,'实际项目与 mint 必须按四类顺序返回。');
    classValues(entry);
    decimalString(entry.issued);decimalString(entry.intakeBurned);decimalString(mint.supply);
    const mintAddress=address(mint.address);address(mint.authority);
    check(address(entry.mint)===mintAddress&&!seen.has(mintAddress),'实际四类 mint 缺失、重复或与项目不一致。');seen.add(mintAddress);
    check(mint.decimals===0,'原料 mint 必须使用标准单位 / 份的整数精度。');
  }
  return frozen({query:copy(query),project:copy(project),mints:copy(result.mints),records:copy(result)});
}

function readOnlyResult(result){check(object(result)&&!Object.hasOwn(result,'intent')&&result.clientPlanOnly===true&&result.transactionExecuted===false,'项目查询必须是明确的只读、未执行公开结果。');}
export function checkedProjectRead(result,query){
  readOnlyResult(result);check(result.actor===query.actor&&result.projectIdHex===query.projectIdHex,'实际读取与本次查询不一致。');
  if(result.decision==='PROJECT_NOT_FOUND'){check(result.projectRecordVerified!==true&&(result.project===undefined||result.project===null),'未找到项目的结果不得包含已核验项目。');return null;}
  check(result.decision==='PROJECT_READ'&&result.businessExecutionVerified===false,'项目读取不能证明某个旧请求执行。');
  return actualProjectRecords(result,query);
}

export function checkedProjectStatus(result,query){
  readOnlyResult(result);check(result.lookupOnly===true&&result.actor===query.actor&&result.nonce===query.nonce&&typeof result.decision==='string','创建请求查询必须匹配明确 Actor 与原 nonce。');
  check(typeof result.exactRequestExecutionVerified==='boolean'&&typeof result.businessExecutionVerified==='boolean'&&typeof result.projectRecordVerified==='boolean'&&typeof result.recordMatchesRequest==='boolean','创建请求查询缺少明确核验标记。');
  if(result.exactRequestExecutionVerified){
    check(result.decision==='CONFIRMED'&&result.businessExecutionVerified===true&&result.projectRecordVerified===true&&result.recordMatchesRequest===true&&object(result.receipt),'原请求确认缺少精确执行证明。');
    const receipt=result.receipt;check(receipt.projectIdHex===result.projectIdHex&&receipt.projectAddress===result.project?.address
      &&Array.isArray(receipt.mints)&&receipt.mints.length===4&&receipt.mints.every((mint,index)=>mint===result.mints?.[index]?.address),'精确创建公开结果与实际项目或四个 mint 不一致。');
    decimalString(receipt.creationFeeLamports);decimalString(receipt.rentLamports);
  }
  else check(result.businessExecutionVerified===false,'没有精确执行证明时不得称原请求已执行。');
  if(!result.projectRecordVerified||!result.recordMatchesRequest)return null;
  const projectQuery={actor:query.actor,projectIdHex:id32(result.projectIdHex)};
  return actualProjectRecords(result,projectQuery);
}

export function createProjectState(){return {config:null,generation:0,mode:'create',plan:null,result:null,resultKind:null,verified:null};}
export function invalidateProjectState(state){state.generation++;state.plan=null;state.result=null;state.resultKind=null;state.verified=null;}
export function isCurrentProjectOperation(state,generation,controller,activeController){return state.generation===generation&&controller===activeController;}

/** Only current actual records can reach the buying form. No request is made. */
export function handoffProjectPurchase(document,verified){
  check(verified?.records?.projectRecordVerified===true&&verified.records.clientPlanOnly===true&&verified.records.transactionExecuted===false
    &&(verified.records.decision==='PROJECT_READ'||verified.records.lookupOnly===true&&verified.records.recordMatchesRequest===true)
    &&verified.project?.projectIdHex===verified.query?.projectIdHex,'请先读取并核验当前实际项目。');
  const actor=document.getElementById('guided-actor'),project=document.getElementById('guided-project'),tab=document.getElementById('guided-tab-purchase');
  const navigation=[...document.querySelectorAll('.nav-item')].find(button=>button.dataset.view==='guided');
  check(actor&&project&&tab&&navigation,'购买页不可用。');
  actor.value=verified.query.actor;project.value=verified.project.projectIdHex;
  const EventClass=document.defaultView?.Event??globalThis.Event;
  actor.dispatchEvent(new EventClass('input',{bubbles:true}));project.dispatchEvent(new EventClass('input',{bubbles:true}));tab.click();navigation.click();
}

export async function mountProjectOperations(document,{fetchImpl=globalThis.fetch}={}){
  const $=id=>document.getElementById(id);if(!$('project-view'))return;
  const state=createProjectState();let activeController=null,busy=false,configController=null,configBusy=false;
  const message=(text,error=false)=>{$('project-message').textContent=text;$('project-message').className=`native-message${error?' error':''}`;};
  const values=()=>({actor:$('project-actor').value,name:$('project-name').value,seller:$('project-seller').value,
    classes:Array.from({length:4},(_,i)=>({class:i+1,cap:$(`project-cap-${i+1}`).value,unitPrice:$(`project-price-${i+1}`).value})),
    maxCreationFee:$('project-max-creation-fee').value,maxRent:$('project-max-rent').value,resources:$('project-resources').value,projectIdHex:$('project-read-id').value,nonce:$('project-status-nonce').value});
  const valid=builder=>{try{builder();return true;}catch{return false;}};
  const summary=(target,rows)=>{target.replaceChildren();for(const[label,value]of rows){if(value===undefined||value===null)continue;
    const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=typeof value==='object'?json(value):String(value);target.append(term,detail);}};

  function render(){
    const enabled=trustedConsoleConfig(state.config),ready=enabled&&!busy&&!configBusy;
    for(const id of INPUTS)$(id).disabled=!enabled;
    $('project-use-actor').disabled=!ready||!valid(()=>address($('project-actor').value));
    $('project-plan').disabled=!ready||state.mode!=='create'||!valid(()=>projectPlanRequest(values()));
    $('project-read').disabled=!ready||state.mode!=='read'||!valid(()=>projectReadRequest(values()));
    $('project-status').disabled=!ready||state.mode!=='read'||!valid(()=>projectStatusRequest(values()));
    $('project-use-intent').disabled=!ready||!state.plan||state.plan.generation!==state.generation;
    $('project-use-purchase').disabled=!ready||!state.verified||state.verified.generation!==state.generation;
    $('project-reload').disabled=busy||configBusy;
    for(const mode of ['create','read']){$('project-tab-'+mode).classList.toggle('active',state.mode===mode);$('project-tab-'+mode).setAttribute('aria-pressed',String(state.mode===mode));$('project-'+mode+'-panel').hidden=state.mode!==mode;}
    const plan=state.plan,verified=state.verified;
    $('project-plan-badge').textContent=busy&&state.mode==='create'?'规划中':plan?'ACTION · 草案':state.result?.decision??'等待规划';
    $('project-plan-badge').className=`result-status${plan?' pass':''}`;
    $('project-plan-note').textContent=plan?'当前仅生成精确创建 intent；nonce 尚未预留。预览 ID 与 mint 地址未证明创建，须先独立完成交易并核查公开结果。':'预览中的项目 ID 与 mint 地址仅为草案派生值，不表示项目已创建。';
    $('project-plan-json').textContent=state.mode==='create'&&state.result?json(state.result):'尚无当前输入的创建草案';
    summary($('project-plan-summary'),plan?[['操作',plan.intent.operation],['Actor',plan.actor],['nonce（未预留）',plan.intent.nonce],['项目名称',plan.request.name],['固定收款人 Seller',plan.request.seller],['四类发售条款',plan.request.classes],['创建费上限（lamports）',plan.request.maxCreationFee],['协议账户租存上限 maxRent（lamports）',plan.request.maxRent],['资源预算',plan.intent.resources],['草案派生项目 ID（尚未创建）',plan.result.projectIdHex??plan.result.preview?.projectIdHex??plan.result.preview?.projectId]]:[]);
    const statusResult=state.resultKind==='status';
    $('project-read-badge').textContent=busy&&state.mode==='read'?'读取中':statusResult?state.result.decision:verified?'实际记录已核验':state.mode==='read'&&state.result?.decision==='PROJECT_NOT_FOUND'?'PROJECT_NOT_FOUND':'尚未核验';
    $('project-read-badge').className=`result-status${verified?' pass':''}`;
    $('project-read-note').textContent=statusResult?(state.result.exactRequestExecutionVerified?'服务端已核验原 CREATE 请求的精确执行证明与实际项目记录。下列项目可明确填入购买页。':verified?'实际项目记录与原请求字段匹配；尚未证明该原 nonce 的请求执行成功。可填入购买页，购买规划仍会重新核对。':'未取得可用的实际项目匹配记录；原请求状态按精确决策处理，不推断创建成功。'):verified?'下列项目与四个 mint 来自本次实际公开记录读取。购买规划仍会重新核对价格、配额与账户。':state.mode==='read'&&state.result?.decision==='PROJECT_NOT_FOUND'?'本次没有读取到实际项目；草案预览不能替代创建证明。':'尚无实际读取结果。创建草案不能作为发售成功证明。';
    $('project-read-json').textContent=state.mode==='read'&&state.result?json(state.result):'尚未读取';
    summary($('project-read-summary'),verified?[['来源','本次实际项目与 mint 读取'],['项目 ID',verified.project.projectIdHex],['项目账户',verified.project.address],['项目名称',verified.project.name],['创建人',verified.project.creator],['固定收款人 Seller',verified.project.seller],['创建业务 ID',verified.project.creationBusinessHex],['finalized context',verified.records.contextSlot],
      ...verified.project.classes.map((entry,i)=>[CLASS_NAMES[i],`mint ${entry.mint} · 配额 ${entry.cap} / 已发行 ${entry.issued} / intakeBurned ${entry.intakeBurned} 份 · 单价 ${entry.unitPrice} lamports`]),['四个实际 mint',verified.mints]]:[]);
  }

  function invalidate(text='输入已改变；旧草案与读取结果已清除。'){
    activeController?.abort();activeController=null;busy=false;invalidateProjectState(state);message(text);render();
  }

  async function run(action,body,apply){
    if(busy||configBusy||!trustedConsoleConfig(state.config))return;
    invalidateProjectState(state);const generation=state.generation,controller=new AbortController();activeController=controller;busy=true;message('正在执行本次明确的只读请求…');render();
    try{const result=await nativeRequest(action,body,{fetchImpl,signal:controller.signal,maxRequestBytes:8192,maxResponseBytes:65536});
      if(!isCurrentProjectOperation(state,generation,controller,activeController))return;
      apply(result);render();
    }catch(error){if(isCurrentProjectOperation(state,generation,controller,activeController)){state.plan=null;state.result=null;state.resultKind=null;state.verified=null;message(error.message,true);}}
    finally{if(activeController===controller){activeController=null;busy=false;render();}}
  }

  async function loadConfig(){
    configController?.abort();const controller=new AbortController();configController=controller;configBusy=true;state.config=null;invalidate('正在读取服务端项目配置；不会连接钱包。');
    $('project-config-badge').textContent='读取中';$('project-config-badge').className='result-status';render();
    try{const result=await nativeRequest('config',undefined,{fetchImpl,signal:controller.signal});if(configController!==controller)return;
      state.config=frozen(copy(result));const enabled=trustedConsoleConfig(result);$('project-config-badge').textContent=enabled?'已启用 · 只读规划':'本地模式 · 未启用';$('project-config-badge').className=`result-status${enabled?' pass':''}`;
      $('project-config-note').textContent=enabled?'发布、网络与公开记录来源由受信任服务端固定。创建草案与项目读取均不执行交易。':'链上项目规划未启用。当前保留本地工作台；项目表单与交易交接保持关闭。';
      message(enabled?'请输入明确 Actor，再选择创建草案或读取已知项目。':'项目操作保持关闭；未请求钱包或交易。');
    }catch(error){if(configController===controller){$('project-config-badge').textContent='本地模式 · 配置不可用';$('project-config-note').textContent='未取得有效服务端配置，项目操作保持关闭。';message(error.message,true);}}
    finally{if(configController===controller){configController=null;configBusy=false;render();}}
  }

  for(const id of INPUTS)for(const event of ['input','change'])$(id).addEventListener(event,()=>invalidate());
  for(const mode of ['create','read'])$('project-tab-'+mode).addEventListener('click',()=>{invalidate('项目操作类别已改变；此前草案与读取结果已失效。');state.mode=mode;render();});
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
    invalidate('视图已切换；旧草案与读取结果不能继续交接。');
    document.querySelectorAll('.view').forEach(view=>{view.hidden=view.id!==`${button.dataset.view}-view`;});
    if(button.dataset.view==='project')$('page-title').textContent='创建与发售';
  }));
  $('project-use-actor').addEventListener('click',()=>{if(busy||!trustedConsoleConfig(state.config))return;
    try{$('project-seller').value=address($('project-actor').value);const EventClass=document.defaultView?.Event??globalThis.Event;$('project-seller').dispatchEvent(new EventClass('input',{bubbles:true}));}catch(error){message(error.message,true);}});
  $('project-reload').addEventListener('click',loadConfig);
  const requestOrMessage=builder=>{try{return builder();}catch(error){message(error.message,true);return null;}};
  $('project-plan').addEventListener('click',()=>{if(state.mode!=='create')return;const request=requestOrMessage(()=>projectPlanRequest(values()));if(!request)return;
    void run('project-plan',request,result=>{const accepted=checkedProjectPlan(result,request);state.result=copy(result);state.resultKind='plan';if(accepted)state.plan={...accepted,generation:state.generation};message(accepted?'ACTION · 仅创建草案，尚未创建项目。':'本次没有可送入交易检查的创建 intent；请查看精确决策。');});});
  $('project-read').addEventListener('click',()=>{if(state.mode!=='read')return;const query=requestOrMessage(()=>projectReadRequest(values()));if(!query)return;
    void run('project-read',query,result=>{const verified=checkedProjectRead(result,query);state.result=copy(result);state.resultKind='read';if(verified)state.verified={...verified,generation:state.generation};message(verified?'已读取实际项目与四类 mint；尚未规划或执行购买。':'PROJECT_NOT_FOUND · 本次未读取到实际项目。');});});
  $('project-status').addEventListener('click',()=>{if(state.mode!=='read')return;const query=requestOrMessage(()=>projectStatusRequest(values()));if(!query)return;
    void run('project-status',query,result=>{const verified=checkedProjectStatus(result,query);state.result=copy(result);state.resultKind='status';if(verified)state.verified={...verified,generation:state.generation};message(result.exactRequestExecutionVerified?'CONFIRMED · 原 CREATE 请求精确执行与实际项目均已核验。':`${result.decision} · ${verified?'实际项目字段匹配；原请求执行仍未验证。':'未取得可交接的实际项目记录。'}`);});});
  $('project-use-intent').addEventListener('click',()=>{if(busy||configBusy||!trustedConsoleConfig(state.config)||!state.plan||state.plan.generation!==state.generation)return;
    try{handoffGuidedIntent(document,state.plan);}catch(error){message(error.message,true);}});
  $('project-use-purchase').addEventListener('click',()=>{if(busy||configBusy||!trustedConsoleConfig(state.config)||!state.verified||state.verified.generation!==state.generation)return;
    try{handoffProjectPurchase(document,state.verified);}catch(error){message(error.message,true);}});
  document.addEventListener?.('biolab-auth-change',()=>{state.config=null;invalidate();void loadConfig();});
  await loadConfig();return {state,render};
}

if(typeof document!=='undefined')void mountProjectOperations(document).catch(error=>{
  const target=document.getElementById('project-message');if(target){target.textContent=`项目操作保持关闭：${error.message}`;target.className='native-message error';}
});
