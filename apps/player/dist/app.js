import {mountVisualDesigner,checkDraftForEditor} from './visual-designer.js';
import {createExperimentRunner} from './app-state.js';
const $=id=>document.getElementById(id);
const names=['体表交换','体表交换','密封支撑','代谢处理','代谢处理','营养供给','营养供给','代谢处理','稳态排出','运动执行','运动执行','环境感知','信号整合','结构支撑','稳态维持'];
const hard=new Set([3,9,14,15]);
let config,graph,referenceIndex=13,selectedRole=4,visualDesigner=null,designGeneration=0,visibleFlowType=1,graphTextDirty=false;
const experimentRunner=createExperimentRunner();
const toast=text=>{const box=$('toast');box.textContent=text;box.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.hidden=true,3000);};
const readable=n=>(Number(n)/1e6).toLocaleString('en-US',{maximumFractionDigits:6});
const failures={PROCESSOR:'营养处理通路能力不足。提高相关部件能力，或降低请求挑战。',CONTROL:'感知或信号整合能力不足，无法支持请求的第二任务。',
  MECHANICAL:'运动执行器没有足够的本地供能或能力完成负载。',CUT:'某一层的总物流超过容量，需要调整连接、层级模式或请求负载。',
  PORT_CAP:'同一物理端口的总通量超过容量。',MACRO_CAP:'供给或排出部件的总通量超过容量。',INTEGER:'实际物流不能精确分成整数微单位，请调整比例或挑战。',
  QUALITY:'作品最弱服务低于请求品质，无法通过本次挑战。',FIXED_EDGE:'缺失或更改了底层固定的必经连接。',CHALLENGE:'挑战档位不合法；支撑目标必须用2.000验证。',
  IDENTITY:'模型版本或目录与当前工作台不一致。',DUPLICATE_EDGE:'同一组端口被重复连接。',FRACTION:'某一物种的连接比例总和超过100%。',
  SLOTS:'布局必须在5×3网格中各占一个位置。',PORT:'连接使用了不匹配的物种、方向或端口。',DEAD_INTERFACE:'接口没有可接入的合法外部供给。'};
const clone=value=>structuredClone(value);
const idLabel=role=>`C${String(role).padStart(2,'0')}`;
const updateJson=()=>{$('graph-json').value=JSON.stringify(graph,null,2);graphTextDirty=false;$('json-error').textContent='';if($('discard-json-draft'))$('discard-json-draft').disabled=true;};
function invalidateExperiment(){designGeneration++;experimentRunner.cancel();$('validate').disabled=false;$('validate').innerHTML='运行完整实验 <span>↗</span>';$('result').hidden=true;$('result').replaceChildren();$('result-empty').hidden=false;$('result-empty').textContent='构造已更新，运行实验查看是否可行。';$('result-status').textContent='等待重新实验';$('result-status').className='result-status';}
function requireAppliedDraft(){if(graphTextDirty)throw Error('高级JSON草稿尚未应用；先应用编辑或放弃草稿，再点选修改。');}
function selectRole(role){
  selectedRole=role;const cell=graph.cells.find(c=>c.role===role);if(!cell)return;
  $('selected-role').textContent=`${idLabel(role)} · ${names[role-1]}`;
  $('capability').value=cell.v;$('capability').disabled=hard.has(role);
  $('capability-value').textContent=(cell.v/1e6).toFixed(3);
  $('module-editor').querySelector('.module-name span').textContent=hard.has(role)?'固定支撑':'可自由设置';
  draw();visualDesigner?.render();
}
function draw(){
  const positions=new Map(graph.slots.map(s=>[s.role,{x:42+s.x*155,y:30+s.y*105}]));
  const paths=graph.edges.filter(e=>e.type===visibleFlowType&&e.fraction>0&&e.src.role!==e.dst.role).map(e=>{
    const a=positions.get(e.src.role),b=positions.get(e.dst.role);if(!a||!b)return'';
    const x1=a.x+59,y1=a.y+32,x2=b.x+59,y2=b.y+32;
    return `<path class="connection" d="M${x1} ${y1} Q${(x1+x2)/2} ${(y1+y2)/2-23} ${x2} ${y2}" marker-end="url(#arrow)"/>`;
  }).join('');
  const nodes=graph.cells.map(c=>{
    const p=positions.get(c.role);if(!p)return'';
    return `<g class="module ${c.role===selectedRole?'selected':''} ${hard.has(c.role)?'hard':''}" data-role="${c.role}" tabindex="0" role="button" aria-label="选择${idLabel(c.role)} ${names[c.role-1]}" transform="translate(${p.x},${p.y})"><rect width="118" height="66" rx="5"/><circle class="pin" cx="0" cy="33" r="2.4"/><circle class="pin" cx="118" cy="33" r="2.4"/><text class="id" x="11" y="18">${idLabel(c.role)}</text><text class="name" x="11" y="39">${names[c.role-1]}</text><text class="number" x="11" y="55">${hard.has(c.role)?'SUPPORT':'V '+(c.v/1e6).toFixed(3)}</text></g>`;
  }).join('');
  $('graph').innerHTML=`<svg viewBox="0 0 825 330" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#66896c"/></marker></defs>${paths}${nodes}</svg>`;
  document.querySelectorAll('.module').forEach(node=>{
    const pick=()=>selectRole(Number(node.dataset.role));node.addEventListener('click',pick);
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();pick();}});
  });
}
function loadReference(){
  graph=clone(config.references[referenceIndex].graph);$('reference').value=referenceIndex;
  invalidateExperiment();selectRole(selectedRole);updateJson();$('result').hidden=true;$('result-empty').hidden=false;
  $('result-status').textContent='等待实验';$('result-status').className='result-status';
}
async function run(){
  if(graphTextDirty){toast('高级JSON草稿尚未应用；先应用编辑，或重置为参考构造。');return;}
  if(experimentRunner.busy)return;
  invalidateExperiment();
  const generation=designGeneration,selectedTarget=Number($('target').value);
  const button=$('validate');button.disabled=true;button.textContent='执行全部 73 轮…';
  $('result-status').textContent='验证中';$('result-status').className='result-status';
  try{
    const result=await experimentRunner.run({graph,challenge:Number($('challenge').value),target:Number($('target').value)});if(generation!==designGeneration||result.decision==='STALE'||result.decision==='BUSY')return;
    if(result.decision!=='RESULT'){toast(result.message);$('result-status').textContent=result.decision==='TIMEOUT'?'实验超时 · 可重试':'连接异常 · 可重试';return;}
    const data=result.data;$('result-empty').hidden=true;$('result').hidden=false;
    if(!result.ok||data.status!=='PASS'){
      $('result-status').textContent='FAIL · 未通过';$('result-status').className='result-status fail';
      const failure=document.createElement('div');failure.className='result-error';failure.textContent=failures[data.code]??data.error??'验证失败';
      const note=document.createElement('div');note.className='result-foot';note.textContent='失败方案保留在工作台中，可继续修改。没有材料消耗、成品发行或奖励。';
      $('result').replaceChildren(failure,note);return;
    }
    $('result-status').textContent='PASS · 73/73';$('result-status').className='result-status pass';
    const stats=[['实际品质',readable(data.q),'Q'],['任务成本',data.taskApplicable?data.cost:'—',data.taskApplicable?'越低越优':'不适用首创任务'],
      ['已完成验证',data.steps,'ROUNDS'],['开场首24小时算例',readable(data.isolatedDailyAtoms),'LAB']];
    const wrapper=document.createElement('div');wrapper.className='result-stats';
    for(const[label,value,unit]of stats){const box=document.createElement('div');const l=document.createElement('div');l.className='stat-label';l.textContent=label;
      const v=document.createElement('div');v.className='stat-value';v.append(document.createTextNode(value+' '));const u=document.createElement('small');u.textContent=unit;v.append(u);box.append(l,v);wrapper.append(box);}
    const cases=document.createElement('div');cases.className='case-row';for(const c of data.referenceCases){const tag=document.createElement('span');tag.textContent=`${c.name} · ${c.rounds} ROUNDS`;cases.append(tag);}
    const foot=document.createElement('div');foot.className='result-foot';foot.textContent='本地功能验证通过。算例使用开场首24小时预算并假设全网分母处于下限，不代表当前或未来日产量；同层、同材料基数、同品质的普通权重相同，任务成本用于首创比较。链上合成仍须真实材料、费用和原生验证。公开参考不领取首创额外奖励。';
    const hash=document.createElement('div');hash.className='result-hash';hash.textContent=`GRAPH ${data.graphSHA} · ${data.graphBytes} bytes`;
    const next=document.createElement('button');next.type='button';next.className='primary';next.textContent='用此构造进入合成 →';next.addEventListener('click',()=>{if(generation!==designGeneration||graphTextDirty)return;const target=$('synthesis-target'),panel=$('synthesis-tab-plan'),encoded=$('synthesis-graph-hex');if(!target||!panel||!encoded||![...target.options].some(o=>o.value===String(selectedTarget)))return;updateJson();panel.click();target.value=String(selectedTarget);target.dispatchEvent(new Event('change',{bubbles:true}));encoded.value='';encoded.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.nav-item[data-view="synthesis"]')?.click();toast('已带入目标；旧设计编码已清除，请导入当前构造并选择真实输入。');});
    $('result').replaceChildren(wrapper,cases,next,foot,hash);
  }catch(error){if(generation===designGeneration){toast(`实验未完成：${error.message}`);$('result-status').textContent='连接异常 · 可重试';}}
  finally{button.disabled=experimentRunner.busy;if(!experimentRunner.busy)button.innerHTML='运行完整实验 <span>↗</span>';}
}
const journeys=[
  ['创建实验室','选择四类原料各自的发售数量和价格。项目额度仍受全网同类发行额度约束。','得到：独立实验室与四类原料发售'],
  ['购买并备料','购买AA、NUC、LIPID、SUGAR标准单位。购买本身不会生成成品或挖矿权重。','得到：四类真实材料余额'],
  ['制造功能部件','按固定目录与BOM直接消费原料；系统核库存、权限和用量。制造不支持拆解或回收。','得到：独立功能部件'],
  ['自由连接与实验','设计端口连接、物流比例、动态能力和布局，执行供能、控制、障碍与恢复测试。','得到：可验证的结果与实际品质'],
  ['逐层合成','通过完整验证并支付制造费，永久消费真实输入实例，依次形成细胞、器官和生物。','得到：新成品，旧实例停止使用'],
  ['质押与持续产出','合格成品质押后参与完整小时分配。实际份额随全网权重变化；首创奖励还须严格的新颖性条件。','得到：可累计领取的LAB，历史权益保留'],
];
for(const [i,row]of journeys.entries()){const box=document.createElement('article');box.className='journey-card';
  const num=document.createElement('div');num.className='journey-number';num.textContent=`0${i+1} /`;
  const h=document.createElement('h2');h.textContent=row[0];const p=document.createElement('p');p.textContent=row[1];const gain=document.createElement('div');gain.className='gain';gain.textContent=row[2];box.append(num,h,p,gain);$('journey').append(box);}
async function economy(){
  const data=await(await fetch('/api/economy')).json();
  const cards=[['LAB固定总量','100,000,000','初始化一次发行并撤销铸币权'],['四类每季额度','50k / 100k / 25k / 25k','AA / NUC / LIPID / SUGAR'],['完整生物制造费','48 LAB','15细胞 + 6器官 + 1生物'],['标准构造链原料','120 份','30 AA · 60 NUC · 15脂质 · 15糖']];
  for(const[label,value,note]of cards){const card=document.createElement('div');card.className='economy-card';const l=document.createElement('div');l.className='stat-label';l.textContent=label;const v=document.createElement('div');v.className='stat-value';v.textContent=value;const n=document.createElement('small');n.textContent=note;card.append(l,v,n);$('economy-cards').append(card);}
  for(const[key,label]of [['noParticipants','无人质押'],['oneComponent','一件独立部件'],['oneQ2Cell','一个Q2细胞'],['oneQ2Bio','一个Q2生物'],['firstSeasonAllRawMadeIntoBio','首季原料全制成生物'],['secondSeasonSameCapacity','两季同量成果累计'],['tenThousandBios','一万个Q2生物'],['afterFirstHalvingOneBio','首次减半后一件Q2生物']]){
    const row=document.createElement('tr');for(const value of[label,data.dailyScenarios[key].firstRootLAB,data.dailyScenarios[key].distributedLAB]){const td=document.createElement('td');td.textContent=value;row.append(td);}$('economy-rows').append(row);
  }
}
document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
  if(button.dataset.view!=='builder'&&experimentRunner.busy){invalidateExperiment();$('result-empty').textContent='已离开实验页；构造已保留，可返回重试。';}
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b===button));
  for(const view of ['builder','flow','economy'])$(`${view}-view`).hidden=view!==button.dataset.view;
  const title=({builder:'生物工坊 · 设计实验',flow:'玩法流程',economy:'协议数据'})[button.dataset.view];if(title)$('page-title').textContent=title;
}));
$('reference').addEventListener('change',event=>{referenceIndex=Number(event.target.value);loadReference();});
$('reset-design').addEventListener('click',()=>{loadReference();toast('已恢复当前公开参考');});
$('capability').addEventListener('input',event=>{const cell=graph.cells.find(c=>c.role===selectedRole);try{requireAppliedDraft();}catch(error){event.target.value=String(cell.v);toast(error.message);return;}cell.v=Number(event.target.value);$('capability-value').textContent=(cell.v/1e6).toFixed(3);invalidateExperiment();draw();updateJson();visualDesigner?.render();});
$('challenge').addEventListener('input',event=>{$('challenge-value').textContent=(Number(event.target.value)/1e6).toFixed(3);invalidateExperiment();});
$('target').addEventListener('change',()=>{if([3,21].includes(Number($('target').value))){$('challenge').value=2000000;$('challenge-value').textContent='2.000';}invalidateExperiment();});
$('validate').addEventListener('click',run);
$('advanced-toggle').addEventListener('click',()=>{$('advanced').hidden=!$('advanced').hidden;if(!$('advanced').hidden){if(!graphTextDirty)updateJson();$('advanced').scrollIntoView({behavior:'smooth',block:'start'});}});
$('graph-json').addEventListener('input',()=>{graphTextDirty=true;invalidateExperiment();$('discard-json-draft').disabled=false;$('json-error').textContent='高级草稿尚未应用，之前的实验结果已失效。';});
const discardDraft=document.createElement('button');discardDraft.type='button';discardDraft.id='discard-json-draft';discardDraft.className='quiet';discardDraft.textContent='放弃未应用草稿';discardDraft.disabled=true;$('apply-json').after(discardDraft);discardDraft.addEventListener('click',()=>{updateJson();invalidateExperiment();toast('已放弃未应用草稿，当前构造保留。');});
$('apply-json').addEventListener('click',()=>{
  const previous=graph;
  try{const candidate=JSON.parse($('graph-json').value);
    if(!Array.isArray(candidate.cells)||candidate.cells.length!==15||candidate.cells.some(c=>!Number.isInteger(c.role)||c.role<1||c.role>15||!Number.isInteger(c.v)||c.v<0||c.v>1000000)
      ||new Set(candidate.cells.map(c=>c.role)).size!==15||!Array.isArray(candidate.slots)||candidate.slots.length!==15
      ||candidate.slots.some(s=>!Number.isInteger(s.role)||s.role<1||s.role>15||!Number.isInteger(s.x)||s.x<0||s.x>4||!Number.isInteger(s.y)||s.y<0||s.y>2)
      ||new Set(candidate.slots.map(s=>s.role)).size!==15||!Array.isArray(candidate.edges)||candidate.edges.length>440
      ||candidate.edges.some(e=>!e||!e.src||!e.dst||!Number.isInteger(e.type)||!Number.isInteger(e.fraction)))throw new Error('工作台需要15个有效角色、5×3布局和完整连接字段，完整合法性请运行验证');
    checkDraftForEditor(candidate);graph=candidate;invalidateExperiment();selectRole(selectedRole);updateJson();visualDesigner?.render();$('json-error').textContent='';toast('编辑已应用，运行完整实验核对合法性');
  }catch(error){graph=previous;selectRole(selectedRole);$('json-error').textContent=error.message;}
});
$('export-design').addEventListener('click',()=>{if(graphTextDirty){toast('先应用高级JSON草稿，再导出构造。');return;}const blob=new Blob([JSON.stringify(graph,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='biolab-design.json';a.click();URL.revokeObjectURL(url);});
try{config=await(await fetch('/api/config')).json();for(const ref of config.references){const option=document.createElement('option');option.value=ref.index;option.textContent=`${ref.name} · ${ref.openingRole==='PUBLISHED_EXTRA'?'公开新增参考':'公开 K0'}`;$('reference').append(option);}
  $('version').textContent=`${config.release} / ${config.references.length} PUBLIC DESIGNS`;loadReference();visualDesigner=mountVisualDesigner(document,{getGraph:()=>graph,getSelectedRole:()=>selectedRole,onViewChange:type=>{visibleFlowType=type;draw();const label=document.querySelector('.graph-legend span:nth-child(2)');if(label)label.textContent=({1:'营养连接',2:'氧气连接',3:'废物排出连接'})[type];},onEdit:next=>{requireAppliedDraft();graph=next;invalidateExperiment();draw();updateJson();}});await economy();
}catch(error){toast(`模型加载失败：${error.message}`);$('validate').disabled=true;}
