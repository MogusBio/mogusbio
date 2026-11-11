import { nativeRequest,parsePublicJson,parseIntent,decimalString,validateResources,trustedConsoleConfig } from './native-console.js';
import { handoffGuidedIntent } from './guided-operations.js';
import { handoffKnownAsset } from './asset-handoff.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const json=value=>JSON.stringify(value,null,2);
const copy=value=>JSON.parse(JSON.stringify(value));
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const frozen=value=>{if(object(value)||Array.isArray(value)){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
const address=value=>{const result=typeof value==='string'?value.trim():'';check(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result),'请输入有效的公钥地址；完整权限由服务端核对。');return result;};
const id32=value=>{check(typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),'ID 必须为 32 字节小写 hex。');return value;};
const boundedIds=(value,maximum)=>{const list=typeof value==='string'?(value.trim()?value.trim().split(/\s+/):[]):value;
  check(Array.isArray(list)&&list.length<=maximum,`最多提供 ${maximum} 个已知 ID。`);list.forEach(id32);check(new Set(list).size===list.length,'已知 ID 不能重复。');return [...list];};
const u64=value=>decimalString(value);
const ticks=value=>{check(Array.isArray(value)&&value.length===32,'物种预算必须包含固定 32 项 ticks。');return value.map(u64);};
const descriptor=value=>{check(object(value)&&Object.keys(value).length===2&&Number.isInteger(value.primitive)&&value.primitive>=1&&value.primitive<=4&&Number.isInteger(value.profile)
  &&(value.primitive===4?value.profile>=1&&value.profile<=15:value.profile===0),'部件描述必须为类型 1–3 / profile0，或类型4 / profile1–15。');return {...value};};
const descriptorHex=value=>`0100${value.primitive.toString(16).padStart(2,'0')}${value.profile.toString(16).padStart(2,'0')}`;
const INPUTS=['manufacture-actor','manufacture-projects','manufacture-sources','manufacture-primitive','manufacture-profile','manufacture-max-part-rent','manufacture-max-upload-rent','manufacture-resources','manufacture-workflow-id'];
const readonly=result=>{check(object(result)&&result.clientPlanOnly===true&&result.transactionExecuted===false&&result.networkSubmitted===false,'返回结果缺少只规划、未执行及未广播标记。');};

export function inventoryReadRequest(values){return {actor:address(values.actor),projectIdsHex:boundedIds(values.projectIdsHex,8),sourceIdsHex:boundedIds(values.sourceIdsHex,16)};}
export function manufacturePlanRequest(values){check(/^[1-4]$/.test(String(values.primitive))&&/^(0|[1-9]|1[0-5])$/.test(String(values.profile)),'部件类型和 profile 必须为明确的规范整数。');return {...inventoryReadRequest(values),descriptor:descriptor({primitive:Number(values.primitive),profile:Number(values.profile)}),
  maxPartRent:u64(values.maxPartRent),maxUploadRent:u64(values.maxUploadRent),resources:validateResources(parsePublicJson(values.resources,1024))};}
export function manufactureNextRequest(values){return {actor:address(values.actor),workflowId:id32(values.workflowId)};}

export function checkedInventoryRead(result,query){
  readonly(result);check(!Object.hasOwn(result,'intent')&&result.actor===query.actor,'库存读取不得提供交易 intent，且必须对应当前 Actor。');
  if(result.decision==='REPLAN_STALE_STATE'){check(result.actualInventoryVerified!==true,'已变化的库存不得标为已核验。');return null;}
  check(result.decision==='INVENTORY_READ'&&result.actualInventoryVerified===true&&object(result.summary),'尚未取得实际库存。');u64(result.contextSlot);u64(result.nextNonce);
  const {standardUnits,sourceBudgets,totals}=result.summary;
  check(Array.isArray(standardUnits)&&standardUnits.length<=32&&Array.isArray(sourceBudgets)&&sourceBudgets.length<=16&&object(totals),'实际库存结果超过有界读取范围。');
  const seen=new Set();for(const row of standardUnits){check(object(row)&&Number.isInteger(row.class)&&row.class>=1&&row.class<=4,'实际标准单位类别无效。');
    const key=`${id32(row.projectIdHex)}:${row.class}`;check(!seen.has(key),'实际项目原料类别重复。');seen.add(key);address(row.mint);address(row.tokenAccount);u64(row.amount);}
  const sources=new Set();for(const row of sourceBudgets){check(object(row)&&Number.isInteger(row.class)&&row.class>=1&&row.class<=4,'实际 Source 类别无效。');
    const id=id32(row.sourceIdHex);check(!sources.has(id)&&query.sourceIdsHex.includes(id),'Source 缺失查询归属或重复。');sources.add(id);ticks(row.remainingTick);}
  ticks(totals.ticks);u64(totals.totalTick);u64(totals.creditInt);check(totals.ticks.reduce((sum,value)=>sum+BigInt(value),0n)===BigInt(totals.totalTick),'库存总 ticks 与逐物种合计不一致。');
  return frozen({query:copy(query),records:copy(result)});
}

export function checkedManufactureWorkflow(value,actor){
  check(object(value)&&value.actor===actor,'制造清单 Actor 与当前请求不一致。');
  for(const name of ['workflowId','artifactIdHex','artifactSHAHex','outputIdHex'])id32(value[name]);address(value.outputAddress);
  const initial=BigInt(u64(value.initialNonce)),last=BigInt(u64(value.manufactureNonce)),next=BigInt(u64(value.nextNonce));
  check(Number.isInteger(value.stageCount)&&value.stageCount>=3&&value.stageCount<=6&&last===initial+BigInt(value.stageCount-1)&&next===last+1n,'制造清单的固定 nonce 窗口无效。');
  descriptor(value.descriptor);u64(value.maxPartRent);u64(value.maxUploadRent);validateResources(value.resources);
  const newSources=boundedIds(value.newSourceIdsHex,4),oldSources=boundedIds(value.existingSourceIdsHex,4),projects=boundedIds(value.projectIdsHex,8);
  check(!newSources.some(id=>oldSources.includes(id)),'新旧 Source 不能重复计入。');
  const plan=value.materialPlan;check(object(plan)&&Array.isArray(plan.intakes)&&plan.intakes.length<=4&&Array.isArray(plan.debits)&&plan.debits.length>=1&&plan.debits.length<=4&&newSources.length===plan.intakes.length,'制造材料清单无效。');
  const intakeKeys=new Set();for(const row of plan.intakes){check(object(row)&&Number.isInteger(row.class)&&row.class>=1&&row.class<=4,'制造 intake 类别无效。');
    const project=id32(row.projectId);check(projects.includes(project),'intake 项目不属于固定清单。');id32(row.sourceTokenAccount);id32(row.materialOwner);check(BigInt(u64(row.unitCount))>0n,'intake 数量必须大于零。');
    const key=`${project}:${row.class}:${row.sourceTokenAccount}`;check(!intakeKeys.has(key),'制造 intake 重复。');intakeKeys.add(key);}
  const debits=new Set();for(const row of plan.debits){const source=id32(row.sourceId);check(!debits.has(source)&&(newSources.includes(source)||oldSources.includes(source)),'制造 debit Source 重复或不在固定清单。');debits.add(source);
    check(Array.isArray(row.entries)&&row.entries.length>=1&&row.entries.length<=32,'制造 debit 物种清单无效。');const species=new Set();
    for(const entry of row.entries){check(Number.isInteger(entry.species)&&entry.species>=1&&entry.species<=32&&!species.has(entry.species),'物种编号无效或重复。');species.add(entry.species);u64(entry.expectedPrefix);check(BigInt(u64(entry.takeTick))>0n,'消耗 ticks 必须大于零。');}}
  check(debits.size===newSources.length+oldSources.length,'固定 Source 清单与 debit 集合不一致。');
  return frozen(copy(value));
}

export function checkedManufactureSaved(result,request){
  readonly(result);check(!Object.hasOwn(result,'intent')&&result.actor===request.actor,'保存清单不得执行或提供交易 intent。');
  if(result.decision!=='WORKFLOW_SAVED')return null;
  check(result.requiresExplicitNextRead===true,'保存清单后必须明确读取实际下一步。');const workflow=checkedManufactureWorkflow(result.workflow,request.actor);
  check(workflow.descriptor.primitive===request.descriptor.primitive&&workflow.descriptor.profile===request.descriptor.profile&&workflow.maxPartRent===request.maxPartRent&&workflow.maxUploadRent===request.maxUploadRent&&Object.keys(request.resources).every(key=>workflow.resources[key]===request.resources[key]),'已保存清单改变了本次制造条款。');
  return workflow;
}

export function checkedManufactureNext(result,query,previous=null){
  readonly(result);check(result.actor===query.actor&&typeof result.decision==='string','制造进度不属于当前 Actor。');
  const workflow=checkedManufactureWorkflow(result.workflow,query.actor);check(workflow.workflowId===query.workflowId,'制造进度不属于当前工作流。');
  if(previous)check(json(stable(previous))===json(stable(workflow)),'服务端返回的固定制造清单已改变；拒绝继续。');
  check(typeof result.outputVerified==='boolean'&&typeof result.exactRequestExecutionVerified==='boolean','制造进度缺少明确核验标记。');
  let plan=null,verified=null;
  if(result.decision==='ACTION'){
    check(result.outputVerified===false&&object(result.stage),'下一步 ACTION 缺少未执行阶段信息。');const stage=result.stage;
    check(Number.isInteger(stage.index)&&stage.index>=0&&stage.index<workflow.stageCount&&stage.count===workflow.stageCount,'制造阶段索引无效。');
    const expected=stage.index<workflow.stageCount-2?'UPLOAD':stage.index===workflow.stageCount-2?'SEAL':'MANUFACTURE';
    check(stage.kind===expected&&u64(stage.nonce)===(BigInt(workflow.initialNonce)+BigInt(stage.index)).toString(),'制造阶段与固定 nonce 窗口不一致。');
    const intent=parseIntent(json(result.intent)),operation={UPLOAD:'ARTIFACT_PUT',SEAL:'ARTIFACT_SEAL',MANUFACTURE:'MANUFACTURE_PART'}[expected];
    check(intent.operation===operation&&intent.nonce===stage.nonce,'交易 intent 与当前制造阶段不一致。');
    check(Object.keys(workflow.resources).every(key=>workflow.resources[key]===intent.resources[key]),'阶段 intent 资源预算与固定清单不一致。');
    plan=frozen({actor:query.actor,intent:copy(intent),workflow,stage:copy(stage),result:copy(result)});
  }else check(!Object.hasOwn(result,'intent'),'非 ACTION 状态不得保留可执行 intent。');
  if(result.outputVerified){
    check(result.decision==='OUTPUT_READ'&&object(result.root),'实际成品核验缺少 Root。');const root=result.root;
    check(root.instanceHex===workflow.outputIdHex&&root.owner===query.actor&&root.schema===1&&root.descriptorHex===descriptorHex(workflow.descriptor)
      &&(root.lifecycle===0||root.lifecycle===1),'实际 Root 与固定制造输出不一致。');
    u64(root.qualityPpm);u64(root.B);u64(root.retired);check(root.qualityPpm==='1000000'&&root.B==='120000'&&root.retired==='45000','实际部件品质或有效/退役材料与固定模型不一致。');
    if(root.lifecycle===0)verified=frozen({actor:query.actor,workflow,root:copy(root),records:copy(result)});
  }else check(result.root===null||result.root===undefined,'未核验输出时不得提供可交接 Root。');
  return {workflow,plan,verified};
}

export function createManufactureState(){return {config:null,generation:0,mode:'plan',inventory:null,workflow:null,result:null,plan:null,verified:null};}
export function invalidateManufactureState(state){state.generation++;state.inventory=null;state.workflow=null;state.result=null;state.plan=null;state.verified=null;}
export function isCurrentManufactureOperation(state,generation,controller,active){return state.generation===generation&&controller===active;}

export function handoffManufacturedRoot(document,verified){
  check(verified?.records?.outputVerified===true&&verified.records.clientPlanOnly===true&&verified.records.transactionExecuted===false&&verified.records.networkSubmitted===false
    &&verified.root?.instanceHex===verified.workflow?.outputIdHex&&verified.root.owner===verified.actor&&verified.root.schema===1&&verified.root.lifecycle===0,'请先核验实际、可用的制造成品。');
  handoffKnownAsset(document,{actor:verified.actor,instanceHex:verified.root.instanceHex});
}

export async function mountManufactureOperations(document,{fetchImpl=globalThis.fetch}={}){
  const $=id=>document.getElementById(id);if(!$('manufacture-view'))return;
  const state=createManufactureState();let activeController=null,busy=false,configController=null,configBusy=false;
  const message=(text,error=false)=>{$('manufacture-message').textContent=text;$('manufacture-message').className=`native-message${error?' error':''}`;};
  const values=()=>({actor:$('manufacture-actor').value,projectIdsHex:$('manufacture-projects').value,sourceIdsHex:$('manufacture-sources').value,
    primitive:$('manufacture-primitive').value,profile:$('manufacture-profile').value,maxPartRent:$('manufacture-max-part-rent').value,maxUploadRent:$('manufacture-max-upload-rent').value,
    resources:$('manufacture-resources').value,workflowId:$('manufacture-workflow-id').value});
  const valid=builder=>{try{builder();return true;}catch{return false;}};
  const summary=(target,rows)=>{target.replaceChildren();for(const[label,value]of rows){if(value===null||value===undefined)continue;const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=typeof value==='object'?json(value):String(value);target.append(term,detail);}};
  function render(){
    const enabled=trustedConsoleConfig(state.config),ready=enabled&&!busy&&!configBusy;for(const id of INPUTS)$(id).disabled=!enabled;
    $('manufacture-read').disabled=!ready||state.mode!=='plan'||!valid(()=>inventoryReadRequest(values()));
    $('manufacture-save').disabled=!ready||state.mode!=='plan'||!valid(()=>manufacturePlanRequest(values()));
    $('manufacture-next').disabled=!ready||state.mode!=='resume'||!valid(()=>manufactureNextRequest(values()));
    $('manufacture-use-intent').disabled=!ready||!state.plan||state.plan.generation!==state.generation;
    $('manufacture-use-root').disabled=!ready||!state.verified||state.verified.generation!==state.generation;
    $('manufacture-open-saved').disabled=!ready||!state.workflow; $('manufacture-reload').disabled=busy||configBusy;
    for(const mode of ['plan','resume']){$('manufacture-tab-'+mode).classList.toggle('active',state.mode===mode);$('manufacture-tab-'+mode).setAttribute('aria-pressed',String(state.mode===mode));$('manufacture-'+mode+'-panel').hidden=state.mode!==mode;}
    $('manufacture-inventory-json').textContent=state.inventory?json(state.inventory.records):'尚未读取当前实际库存';
    summary($('manufacture-inventory-summary'),state.inventory?[['范围','仅列出的已知项目和 Source，非全部钱包持仓'],['finalized context',state.inventory.records.contextSlot],['下一 nonce（未预留）',state.inventory.records.nextNonce],['原料标准单位 / 份',state.inventory.records.summary.standardUnits],['已有 Source 剩余物种预算',state.inventory.records.summary.sourceBudgets],['物种 ticks / creditInt（RU×1000）',state.inventory.records.summary.totals]]:[]);
    $('manufacture-result-badge').textContent=busy?'读取 / 保存中':state.result?.decision??'等待操作';$('manufacture-result-badge').className=`result-status${state.plan||state.verified?' pass':''}`;
    $('manufacture-result-json').textContent=state.result?json(state.result):'尚无当前输入的制造进度';
    const flow=state.workflow;summary($('manufacture-workflow-summary'),flow?[['工作流 ID',flow.workflowId],['保存性质','服务端本地公开清单；未预留材料、nonce，未制造'],['初始 / 制造 / 下一个 nonce',`${flow.initialNonce} / ${flow.manufactureNonce} / ${flow.nextNonce}`],['Artifact ID / SHA',`${flow.artifactIdHex} / ${flow.artifactSHAHex}`],['预期成品 ID（仅实际核验后可交接）',flow.outputIdHex],['部件描述',flow.descriptor],['新 Source / 已有 Source', [...flow.newSourceIdsHex,...flow.existingSourceIdsHex]],['固定材料消耗清单',flow.materialPlan]]:[]);
    const notes={WORKFLOW_SAVED:'固定清单已保存在服务端本地。请明确切换到恢复进度并读取当前一步；这不是链上制造成功。',ACTION:'仅当前一步精确 intent；仍须送入交易检查，分别准备、检查、模拟、签名和发送。',RECOVER_CURRENT_REQUEST:'当前精确 Frame 已在原请求会话中。请用链上操作的原 nonce 恢复；不会重新准备或静默跳步。',WAIT_UNVERIFIED_PREFIX:'此前步骤尚缺原请求确认或实际 Artifact 前缀证明；保留清单，先恢复原请求。',NONCE_WINDOW_CHANGED_REPLAN:'Actor nonce 已离开固定窗口；不改 Source 编号，也不重用旧 intent。请核对原请求后明确重规划。',OUTPUT_READ:state.verified?'实际 Root 已核验且当前可用。可以填入已有作品页，再明确读取和规划质押。':'实际成品已有记录，但当前不可交接质押。',REPLAN_STALE_STATE:'读取期间库存变化，请重新读取或规划。'};
    $('manufacture-result-note').textContent=notes[state.result?.decision]??'上传、封存或本地实验通过均不证明制造成功；仅实际 Root 可作为成品。';
  }
  function invalidate(text='输入已改变；旧库存、清单核验和交接已失效。'){activeController?.abort();activeController=null;busy=false;invalidateManufactureState(state);message(text);render();}
  async function run(action,body,apply){
    if(busy||configBusy||!trustedConsoleConfig(state.config))return;const previous=state.workflow;invalidateManufactureState(state);const generation=state.generation,controller=new AbortController();activeController=controller;busy=true;message('正在执行本次明确请求；不会连接钱包或执行交易。');render();
    try{const result=await nativeRequest(action,body,{fetchImpl,signal:controller.signal,maxRequestBytes:8192,maxResponseBytes:65536});if(!isCurrentManufactureOperation(state,generation,controller,activeController))return;apply(result,previous);render();}
    catch(error){if(isCurrentManufactureOperation(state,generation,controller,activeController)){state.inventory=null;state.workflow=null;state.plan=null;state.verified=null;state.result=null;message(error.message,true);}}
    finally{if(activeController===controller){activeController=null;busy=false;render();}}
  }
  async function loadConfig(){
    configController?.abort();const controller=new AbortController();configController=controller;configBusy=true;state.config=null;invalidate('正在读取固定服务端配置。');$('manufacture-config-badge').textContent='读取中';render();
    try{const result=await nativeRequest('config',undefined,{fetchImpl,signal:controller.signal});if(configController!==controller)return;state.config=frozen(copy(result));const enabled=trustedConsoleConfig(result);$('manufacture-config-badge').textContent=enabled?'已启用 · 本地清单与只读规划':'本地模式 · 未启用';$('manufacture-config-badge').className=`result-status${enabled?' pass':''}`;$('manufacture-config-note').textContent=enabled?'链上读取、发布和清单存储由受信任服务端固定。保存清单不会执行制造。':'库存和制造操作尚未启用；本地设计工作台仍可使用。';message(enabled?'输入明确 Actor，再读取已知库存或恢复清单。':'库存、制造和交易交接保持关闭。');}
    catch(error){if(configController===controller){$('manufacture-config-badge').textContent='本地模式 · 配置不可用';$('manufacture-config-note').textContent='没有有效配置，所有制造入口保持关闭。';message(error.message,true);}}
    finally{if(configController===controller){configController=null;configBusy=false;render();}}
  }
  for(const id of INPUTS)for(const event of ['input','change'])$(id).addEventListener(event,()=>invalidate());
  for(const mode of ['plan','resume'])$('manufacture-tab-'+mode).addEventListener('click',()=>{invalidate('操作类别已改变；请重新核查本次输入。');state.mode=mode;render();});
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{invalidate('视图已切换；旧交接数据已失效。');document.querySelectorAll('.view').forEach(view=>{view.hidden=view.id!==`${button.dataset.view}-view`;});if(button.dataset.view==='manufacture')$('page-title').textContent='库存与制造';}));
  const requestOrMessage=builder=>{try{return builder();}catch(error){message(error.message,true);return null;}};
  $('manufacture-reload').addEventListener('click',loadConfig);
  $('manufacture-read').addEventListener('click',()=>{if(state.mode!=='plan')return;const query=requestOrMessage(()=>inventoryReadRequest(values()));if(query)void run('inventory-read',query,result=>{state.inventory=checkedInventoryRead(result,query);state.result=copy(result);message(state.inventory?'已读取本次实际库存；未预留或消耗任何原料。':'库存已变化，未取得可用核验结果。');});});
  $('manufacture-save').addEventListener('click',()=>{if(state.mode!=='plan')return;const request=requestOrMessage(()=>manufacturePlanRequest(values()));if(request)void run('manufacture-plan',request,result=>{const flow=checkedManufactureSaved(result,request);state.result=copy(result);if(flow){state.workflow=flow;$('manufacture-workflow-id').value=flow.workflowId;}message(flow?'固定公开清单已保存。请明确读取下一步；尚未执行交易。':`${result.decision} · 未保存可用清单。`);});});
  $('manufacture-open-saved').addEventListener('click',()=>{if(busy||configBusy||!trustedConsoleConfig(state.config)||!state.workflow)return;const id=state.workflow.workflowId;invalidate('已填入保存的工作流 ID；须明确读取真实进度。');$('manufacture-workflow-id').value=id;state.mode='resume';render();});
  $('manufacture-next').addEventListener('click',()=>{if(state.mode!=='resume')return;const query=requestOrMessage(()=>manufactureNextRequest(values()));if(query)void run('manufacture-next',query,(result,previous)=>{const accepted=checkedManufactureNext(result,query,previous);state.workflow=accepted.workflow;state.result=copy(result);if(accepted.plan)state.plan={...accepted.plan,generation:state.generation};if(accepted.verified)state.verified={...accepted.verified,generation:state.generation};message(`${result.decision} · 已核对本次工作流身份；未执行交易。`);});});
  $('manufacture-use-intent').addEventListener('click',()=>{if(busy||configBusy||!trustedConsoleConfig(state.config)||!state.plan||state.plan.generation!==state.generation)return;try{handoffGuidedIntent(document,state.plan);}catch(error){message(error.message,true);}});
  $('manufacture-use-root').addEventListener('click',()=>{if(busy||configBusy||!trustedConsoleConfig(state.config)||!state.verified||state.verified.generation!==state.generation)return;try{handoffManufacturedRoot(document,state.verified);}catch(error){message(error.message,true);}});
  document.addEventListener?.('biolab-auth-change',()=>{state.config=null;invalidate();void loadConfig();});
  await loadConfig();return {state,render};
}

if(typeof document!=='undefined')void mountManufactureOperations(document).catch(error=>{const target=document.getElementById('manufacture-message');if(target){target.textContent=`制造操作保持关闭：${error.message}`;target.className='native-message error';}});
