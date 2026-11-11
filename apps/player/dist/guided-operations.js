import { nativeRequest,parsePublicJson,parseIntent,decimalString,validateResources,trustedConsoleConfig } from './native-console.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const check=(value,message)=>{if(!value)throw new Error(message);};
const json=value=>JSON.stringify(value,null,2);
const copy=value=>JSON.parse(JSON.stringify(value));
const frozen=value=>{if(object(value)||Array.isArray(value)){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
const actorAddress=value=>{const address=typeof value==='string'?value.trim():'';check(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address),'请输入有效的公钥地址；完整地址与权限仍由服务端核对。');return address;};
const id32=value=>{check(typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),'请输入 32 字节小写 hex ID。');return value;};
const budgets=values=>({maxRent:decimalString(values.maxRent),resources:validateResources(parsePublicJson(values.resources,1024))});
const OPERATIONS={purchase:'BUY_MATERIAL',stake:'REGISTER_ORDINARY',exit:'EXIT_ORDINARY',claim:'CLAIM_POSITION',accrue:'MATERIALIZE_HOUR'};

export function purchasePlanRequest(values){
  const materialClass=Number(values.class);check(Number.isInteger(materialClass)&&materialClass>=1&&materialClass<=4,'请选择四种原料之一。');
  const quantity=decimalString(values.quantity);check(BigInt(quantity)>0n,'购买数量必须大于零。');
  return {actor:actorAddress(values.actor),projectIdHex:id32(values.projectIdHex),class:materialClass,quantity,
    maxPayment:decimalString(values.maxPayment),...budgets(values)};
}

export function assetReadRequest(values){
  const positionPageLimit=Number(values.positionPageLimit);check(Number.isInteger(positionPageLimit)&&positionPageLimit>=1&&positionPageLimit<=20,'每页只能读取 1–20 条 Position。');
  return {actor:actorAddress(values.actor),instanceHex:id32(values.instanceHex),positionPageStart:decimalString(values.positionPageStart),positionPageLimit};
}

export function assetPlanRequest(values,kind){
  check(kind==='stake'||kind==='exit','未知作品操作。');
  const actor=actorAddress(values.actor);
  return {actor,instanceHex:id32(values.instanceHex),kind,...(kind==='stake'?{beneficiary:actorAddress(values.beneficiary?.trim()||actor)}:{}),...budgets(values)};
}

export function positionPlanRequest(values,kind,asset){
  check(kind==='claim'||kind==='accrue','未知历史权益操作。');
  const actor=actorAddress(values.actor),instanceHex=id32(values.instanceHex),positionSeq=decimalString(values.positionSeq);
  check(asset?.query.actor===actor&&asset.query.instanceHex===instanceHex&&asset.positions.some(position=>position.positionSeq===positionSeq),'请先读取当前作品，并明确选择本页实际历史 Position。');
  return {actor,instanceHex,positionSeq,kind,...budgets(values)};
}

export function checkedAssetRead(result,query){
  check(object(result)&&Array.isArray(result.positions)&&result.positions.length<=query.positionPageLimit,'服务端未返回有效的实际历史 Position 列表。');
  check(!Object.hasOwn(result,'intent')&&result.transactionExecuted!==true,'作品读取结果不能包含交易 intent 或执行结果。');
  const seen=new Set(),start=BigInt(query.positionPageStart),end=start+BigInt(query.positionPageLimit);
  const positions=result.positions.map(position=>{
    check(object(position),'无效的历史 Position。');const sequence=decimalString(position.positionSeq);
    check(!seen.has(sequence)&&BigInt(sequence)>=start&&BigInt(sequence)<end,'历史 Position 重复或不属于当前请求页。');seen.add(sequence);return copy(position);
  });
  return frozen({query:copy(query),records:copy(result),positions});
}

export function checkedGuidedPlan(result,source,actor){
  check(object(result)&&typeof result.decision==='string','服务端未返回明确规划决策。');
  if(result.decision!=='ACTION'){check(!Object.hasOwn(result,'intent'),'非 ACTION 结果不能提供可用 intent。');return null;}
  check(result.clientPlanOnly===true&&result.transactionExecuted===false,'规划结果缺少明确的只规划、未执行标记。');
  const intent=parseIntent(json(result.intent));
  check(intent.operation===OPERATIONS[source],'规划操作与本次选择不一致。');
  if(Object.hasOwn(result,'actor'))check(result.actor===actor,'规划 Actor 与当前输入不一致。');
  return frozen({actor,intent:copy(intent),result:copy(result),source});
}

export function guidedDecisionNote(result){
  const decision=result?.decision;
  const notes={ACTION:'当前输入得到一个操作草案（精确 intent）；nonce 尚未预留。还须送入交易检查，明确准备、检查和模拟。',
    NO_ACCRUED_DEBT:'当前没有已计债但未领取的 LAB；这不证明历史小时都已补记。',
    WAIT_PRIOR_POSITION:'同一作品仍有更早的 Position 需要按实际覆盖顺序补记。',
    WAIT_FROZEN_FRONTIER:'目标历史小时尚未进入可补记的冻结前沿。',
    COVERAGE_COMPLETE:'该 Position 的历史覆盖已完成；已计债收益仍按实际 accrued/paid 核对。',
    REPLAN_STALE_STATE:'读取期间实际指针或计数已变化；本次没有可用 intent，请重新规划。',
    K_AWARE_EXIT_REQUIRED:'请到「持续挖矿与权益」使用完整退出，核对 K-aware 分支和两条有序结束事件；本页不会生成普通退出交易。'};
  if(typeof decision==='string'&&/K.*(?:OPEN|AWARE|UNSUPPORTED|REQUIRED)/.test(decision))return notes.K_AWARE_EXIT_REQUIRED;
  return notes[decision]??'请查看服务端的精确等待或阻塞决策；本次没有可送入检查的 intent。';
}

export function createGuidedState(){return {config:null,generation:0,mode:'purchase',plan:null,result:null,asset:null};}
export function invalidateGuidedState(state,{clearAsset=false}={}){state.generation++;state.plan=null;state.result=null;if(clearAsset)state.asset=null;}
export function isCurrentGuidedOperation(state,generation,controller,activeController){return state.generation===generation&&controller===activeController;}

/** Handoff is form input and navigation only. No transaction/wallet API belongs
 * here. Assign both values before either input event invalidates old signatures. */
export function handoffGuidedIntent(document,plan){
  check(plan&&object(plan.intent),'没有当前可用 intent。');
  const actor=document.getElementById('native-actor'),intent=document.getElementById('native-intent');
  const navigation=[...document.querySelectorAll('.nav-item')].find(button=>button.dataset.view==='native');
  check(actor&&intent&&navigation,'交易检查界面不可用。');
  actor.value=plan.actor;intent.value=json(plan.intent);
  const EventClass=document.defaultView?.Event??globalThis.Event;
  actor.dispatchEvent(new EventClass('input',{bubbles:true}));intent.dispatchEvent(new EventClass('input',{bubbles:true}));navigation.click();
}

export async function mountGuidedOperations(document,{fetchImpl=globalThis.fetch}={}){
  const $=id=>document.getElementById(id);if(!$('guided-view'))return;
  const state=createGuidedState();let activeController=null,busy=false,configController=null,configBusy=false,lastAsset=null;
  const message=(text,error=false)=>{$('guided-message').textContent=text;$('guided-message').className=`native-message${error?' error':''}`;};
  const values=()=>({actor:$('guided-actor').value,projectIdHex:$('guided-project').value,class:$('guided-material-class').value,
    quantity:$('guided-quantity').value,maxPayment:$('guided-max-payment').value,maxRent:$('guided-max-rent').value,resources:$('guided-resources').value,
    instanceHex:$('guided-instance').value,positionPageStart:$('guided-page-start').value,positionPageLimit:$('guided-page-limit').value,
    beneficiary:$('guided-beneficiary').value,positionSeq:$('guided-position').value});
  const valid=builder=>{try{builder();return true;}catch{return false;}};
  const hasCurrentAsset=()=>{try{const query=assetReadRequest(values());return state.asset?.query.actor===query.actor&&state.asset.query.instanceHex===query.instanceHex
    &&state.asset.query.positionPageStart===query.positionPageStart&&state.asset.query.positionPageLimit===query.positionPageLimit;}catch{return false;}};
  const knownOpenK=()=>{const registration=state.asset?.records.registration;try{return registration&&BigInt(decimalString(registration.activationCount))>0n&&registration.kEnd===null;}catch{return false;}};
  const summary=(target,rows)=>{target.replaceChildren();for(const [label,value]of rows){if(value===undefined||value===null)continue;
    const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=typeof value==='object'?json(value):String(value);target.append(term,detail);}};

  function drawAsset(){
    if(lastAsset===state.asset)return;lastAsset=state.asset;$('guided-position').replaceChildren();
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='明确选择本页实际 Position';$('guided-position').append(placeholder);
    const asset=state.asset;
    $('guided-asset-json').textContent=asset?json(asset.records):'尚未读取';
    const root=asset?.records.root,registration=asset?.records.registration;
    summary($('guided-asset-summary'),asset?[['读取范围','已知实例，不代表全部持仓'],['实例 ID',asset.query.instanceHex],['finalized context',asset.records.contextSlot],
      ['当前所有人',root?.owner],['Root revision',root?.revision],['生命周期',root?.lifecycle],['普通 Position 总数',registration?.ordinaryCount],
      ['本页实际记录数',asset.positions.length],['下一页起始序号',asset.records.nextPageStart]]:[]);
    for(const position of asset?.positions??[]){const option=document.createElement('option');option.value=position.positionSeq;
      option.textContent=`#${position.positionSeq} · 受益人 ${position.beneficiaryAddress??position.beneficiary??'见公开记录'} · accrued ${position.accrued??'—'} / paid ${position.paid??'—'}`;
      $('guided-position').append(option);}
    $('guided-position').value='';
    $('guided-asset-note').textContent=asset?`本页已读取 ${asset.positions.length} 条实际权益。规划时服务端仍会重新读取并核对指针与 CAS。`:'尚未读取当前 Actor 与作品。';
    $('guided-position-note').textContent='仅可选择服务端本次读到的真实记录。领取始终付给其固定受益人。';
  }

  function render(){
    drawAsset();const enabled=trustedConsoleConfig(state.config),ready=enabled&&!busy&&!configBusy;
    for(const id of ['guided-actor','guided-max-rent','guided-resources','guided-project','guided-material-class','guided-quantity','guided-max-payment',
      'guided-instance','guided-page-start','guided-page-limit','guided-beneficiary'])$(id).disabled=!enabled;
    $('guided-purchase-plan').disabled=!ready||!valid(()=>purchasePlanRequest(values()));
    $('guided-asset-read').disabled=!ready||!valid(()=>assetReadRequest(values()));
    $('guided-stake-plan').disabled=!ready||!hasCurrentAsset()||!valid(()=>assetPlanRequest(values(),'stake'));
    $('guided-exit-plan').disabled=!ready||!hasCurrentAsset()||knownOpenK()||!valid(()=>assetPlanRequest(values(),'exit'));
    $('guided-position').disabled=!ready||!hasCurrentAsset()||!state.asset?.positions.length;
    for(const kind of ['claim','accrue'])$('guided-'+kind+'-plan').disabled=!ready||!hasCurrentAsset()||!valid(()=>positionPlanRequest(values(),kind,state.asset));
    $('guided-use-intent').disabled=!ready||!state.plan||state.plan.generation!==state.generation;
    $('guided-reload').disabled=busy||configBusy;
    $('guided-tab-purchase').classList.toggle('active',state.mode==='purchase');$('guided-tab-asset').classList.toggle('active',state.mode==='asset');
    $('guided-tab-purchase').setAttribute('aria-pressed',String(state.mode==='purchase'));$('guided-tab-asset').setAttribute('aria-pressed',String(state.mode==='asset'));
    $('guided-purchase-panel').hidden=state.mode!=='purchase';$('guided-asset-panel').hidden=state.mode!=='asset';$('guided-k-note').hidden=!knownOpenK();
    const result=state.result,plan=state.plan;
    $('guided-result-badge').textContent=busy?'读取 / 规划中':result?.decision??(result?'已读取公开记录':'等待操作');
    $('guided-result-badge').className=`result-status${plan?' pass':''}`;
    $('guided-plan-note').textContent=plan?guidedDecisionNote(result):result?.decision?guidedDecisionNote(result):'只有当前输入下返回 ACTION 的精确 intent，才能送入交易检查。等待、阻塞或过期结果不会生成可用交易。';
    $('guided-result-json').textContent=result?json(result):'尚无当前输入的规划结果';
    summary($('guided-plan-summary'),plan?[['操作',plan.intent.operation],['Actor',plan.actor],['nonce（未预留）',plan.intent.nonce],
      ['固定受益人 / 收款人',result.beneficiary??result.recipient??plan.request.beneficiary],['资源预算',plan.intent.resources],['本次明确请求',plan.request]]:[]);
  }

  function invalidate({clearAsset=false,text='输入已改变；旧规划已清除，需要重新读取或规划。'}={}){
    activeController?.abort();activeController=null;busy=false;invalidateGuidedState(state,{clearAsset});message(text);render();
  }

  async function run(action,body,apply){
    if(busy||configBusy||!trustedConsoleConfig(state.config))return;
    invalidateGuidedState(state,{clearAsset:action==='asset-read'});const generation=state.generation,controller=new AbortController();activeController=controller;busy=true;message('正在执行本次明确的只读请求…');render();
    try{const result=await nativeRequest(action,body,{fetchImpl,signal:controller.signal});
      if(!isCurrentGuidedOperation(state,generation,controller,activeController))return;
      apply(result);render();
    }catch(error){if(isCurrentGuidedOperation(state,generation,controller,activeController)){state.plan=null;state.result=null;message(error.message,true);}}
    finally{if(activeController===controller){activeController=null;busy=false;render();}}
  }

  function plan(action,request,source){
    return run(action,request,result=>{state.plan=null;const accepted=checkedGuidedPlan(result,source,request.actor);state.result=copy(result);
      if(accepted)state.plan={...accepted,request:frozen(copy(request)),generation:state.generation};
      message(`${result.decision} · ${guidedDecisionNote(result)}`);
    });
  }

  async function loadConfig(){
    configController?.abort();const controller=new AbortController();configController=controller;configBusy=true;state.config=null;invalidate({clearAsset:true,text:'正在读取服务端规划配置；不会连接钱包。'});
    $('guided-config-badge').textContent='读取中';$('guided-config-badge').className='result-status';render();
    try{const result=await nativeRequest('config',undefined,{fetchImpl,signal:controller.signal});if(configController!==controller)return;
      state.config=frozen(copy(result));const enabled=trustedConsoleConfig(result);
      $('guided-config-badge').textContent=enabled?'已启用 · 只读规划':'本地模式 · 未启用';$('guided-config-badge').className=`result-status${enabled?' pass':''}`;
      $('guided-config-note').textContent=enabled?'发布、网络和记录来源由受信任服务端固定。读取与规划均不执行交易，也不会请求钱包。':'链上规划未启用。当前可继续使用本地构造工作台；购买与权益操作需受信任服务端配置。';
      message(enabled?'服务端允许只读规划。请输入明确 Actor 与项目或已知实例 ID。':'规划保持关闭；未请求钱包或交易操作。');
    }catch(error){if(configController===controller){$('guided-config-badge').textContent='本地模式 · 配置不可用';$('guided-config-note').textContent='未取得有效服务端配置，规划保持关闭。';message(error.message,true);}}
    finally{if(configController===controller){configController=null;configBusy=false;render();}}
  }

  const identityFields=new Set(['guided-actor','guided-instance','guided-page-start','guided-page-limit']);
  for(const id of ['guided-actor','guided-max-rent','guided-resources','guided-project','guided-material-class','guided-quantity','guided-max-payment',
    'guided-instance','guided-page-start','guided-page-limit','guided-beneficiary','guided-position']){
    for(const event of ['input','change'])$(id).addEventListener(event,()=>{
      invalidate({clearAsset:identityFields.has(id)});
      if(id==='guided-position'&&state.asset){const selected=state.asset.positions.find(position=>position.positionSeq===$('guided-position').value);
        $('guided-position-note').textContent=selected?`所选 #${selected.positionSeq} 的固定受益人：${selected.beneficiaryAddress??selected.beneficiary??'见公开记录'}。当前 Actor 可以只代为触发领取。`:'请明确选择实际历史 Position。';}
    });
  }
  for(const mode of ['purchase','asset'])$('guided-tab-'+mode).addEventListener('click',()=>{invalidate({text:'规划类别已改变；此前 intent 已失效。'});state.mode=mode;render();});
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
    invalidate({text:'视图已切换；旧规划不会继续用于交易检查。'});
    document.querySelectorAll('.view').forEach(view=>{view.hidden=view.id!==`${button.dataset.view}-view`;});
    if(button.dataset.view==='guided')$('page-title').textContent='资产与购买';
  }));
  $('guided-reload').addEventListener('click',loadConfig);
  const requestOrMessage=builder=>{try{return builder();}catch(error){message(error.message,true);return null;}};
  $('guided-purchase-plan').addEventListener('click',()=>{const request=requestOrMessage(()=>purchasePlanRequest(values()));if(request)void plan('purchase-plan',request,'purchase');});
  $('guided-asset-read').addEventListener('click',()=>{const request=requestOrMessage(()=>assetReadRequest(values()));if(!request)return;
    void run('asset-read',request,result=>{state.asset=checkedAssetRead(result,request);state.result=copy(result);message(`已核验本页 ${state.asset.positions.length} 条实际 Position；这不是全部持仓清单。`);});
  });
  for(const kind of ['stake','exit'])$('guided-'+kind+'-plan').addEventListener('click',()=>{if(!hasCurrentAsset()||kind==='exit'&&knownOpenK())return;
    const request=requestOrMessage(()=>assetPlanRequest(values(),kind));if(request)void plan('asset-plan',request,kind);});
  for(const kind of ['claim','accrue'])$('guided-'+kind+'-plan').addEventListener('click',()=>{const request=requestOrMessage(()=>positionPlanRequest(values(),kind,state.asset));if(request)void plan('position-plan',request,kind);});
  $('guided-use-intent').addEventListener('click',()=>{
    if(busy||!trustedConsoleConfig(state.config)||!state.plan||state.plan.generation!==state.generation)return;
    try{handoffGuidedIntent(document,state.plan);}catch(error){message(error.message,true);}
  });
  document.addEventListener?.('biolab-auth-change',()=>{state.config=null;invalidate({clearAsset:true});void loadConfig();});
  await loadConfig();return {state,render};
}

if(typeof document!=='undefined')void mountGuidedOperations(document).catch(error=>{
  const target=document.getElementById('guided-message');if(target){target.textContent=`引导规划保持关闭：${error.message}`;target.className='native-message error';}
});
