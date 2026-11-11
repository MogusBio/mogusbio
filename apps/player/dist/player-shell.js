import {nativeRequest} from './native-console.js';
import {browserAuthMatches} from './auth-session.js';
const U64=18446744073709551615n;
const check=(v,message)=>{if(!v)throw Error(message);};
export function decimalToAtoms(value,scale){
  check(Number.isInteger(scale)&&scale>=0&&scale<=9,'单位精度无效。');
  const pattern=scale===0?/^(?:0|[1-9][0-9]*)$/:new RegExp('^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,'+scale+'})?$');
  check(typeof value==='string'&&value.length<=32&&pattern.test(value),'请输入不带符号或指数的金额，精度不能超过单位限制。');
  const [whole,fraction='']=value.split('.'),amount=BigInt(whole)*10n**BigInt(scale)+BigInt((fraction+'0'.repeat(scale)).slice(0,scale)||'0');
  check(amount<=U64,'金额超过协议整数上限。');return amount.toString();
}
export function atomsToDecimal(value,scale){
  check(typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value)&&Number.isInteger(scale)&&scale>=0&&scale<=9,'原始金额无效。');
  const amount=BigInt(value);check(amount<=U64,'原始金额超过协议整数上限。');const unit=10n**BigInt(scale),whole=amount/unit,fraction=(amount%unit).toString().padStart(scale,'0').replace(/0+$/,'');return `${whole}${fraction?'.'+fraction:''}`;
}
const actors=['native-actor','guided-actor','project-actor','manufacture-actor','synthesis-actor','mining-actor','research-executor'];
export function verifiedPlayerIdentity(config){return config?.authenticationRequired===true&&browserAuthMatches(config)?config.sessionActor:null;}
const guides={
  builder:{title:'先选参考，再自由修改',text:'从公开模型开始，点选功能细胞，调整连接与位置，再运行实验。设计和测试不消耗材料。',actions:[['查看我的材料','wallet-discovery','material-atas']]},
  directory:{title:'先选一个原料项目',text:'浏览发售，选择项目，再核对四类原料的价格与数量。购买前会重新检查实际额度。',actions:[['我也要发售原料','project']]},
  manufacture:{title:'把已有原料做成部件',text:'先选择材料来源，再选部件类型。核对库存和费用后保存制造清单；保存不会消耗材料。',actions:[['选择原料余额','wallet-discovery','material-atas'],['选择已有余材','wallet-discovery','sources'],['还没有材料，去项目首发','directory']]},
  synthesis:{title:'选成品，接成下一层',text:'从自己的作品中选择直接输入，再导入工作台设计。核对输入、品质和制造费后，才进入合成交易。',actions:[['选择我的输入作品','wallet-discovery','roots'],['回到设计实验','builder']]},
  'wallet-discovery':{title:'先选择要看的资产类别',text:'当前成品、原料余额、余材和旧收益分开显示。点开始读取，选择卡片后再进入对应操作。',actions:[['购买原料','directory']]},
  mining:{title:'查看作品产出与已赚LAB',text:'先从我的资产选择成品。登记产出、补记历史、领取和退出各有明确步骤，收益随全网情况变化。',actions:[['选择我的资产','wallet-discovery','roots'],['查看我的历史收益','wallet-discovery','positions']]},
  guided:{title:'核对所选项目或作品',text:'项目从实验室项目选择，作品从我的资产选择。标识由上一页带入；技术编号可在手动输入中查看。',actions:[['去项目首发选择','directory'],['去我的资产选择','wallet-discovery','roots']]},
  project:{title:'设置你的四类原料发售',text:'填写实验室名称、每类发售数量和售价。核对收款人及费用，再确认创建。已有项目可从实验室项目查找。',actions:[['查看已有发售','directory']]},
  research:{title:'把自由设计提交为首创研究',text:'先在工作台改进并测试，再准备真实输入与私有承诺。公开参考可以普通产出；首创还要求严格改进。',actions:[['回到设计实验','builder'],['选择研究用的作品','wallet-discovery','roots']]},
  native:{title:'高级交易与恢复',text:'这里保留精确交易检查、签名和恢复工具。普通操作会带入当前一步；无需自行编写JSON。',actions:[]},
};
const text=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value;};
export function mountFeeMirror(document,raw){
  const scale=Number(raw.dataset.playerFee),unit=raw.dataset.feeUnit,id=`${raw.id}-display`,box=document.createElement('div');box.className='player-fee-mirror';
  const label=document.createElement('label');label.htmlFor=id;label.textContent=`${raw.dataset.feeLabel}（${unit}）`;const input=document.createElement('input');input.id=id;input.type='text';input.inputMode='decimal';input.maxLength=32;input.autocomplete='off';input.className='native-input';input.setAttribute('aria-describedby',`${id}-note`);
  const note=document.createElement('p');note.id=`${id}-note`;note.className='player-fee-note';box.append(label,input,note);raw.before(box);raw.classList.add('player-fee-authoritative');document.querySelector(`label[for="${raw.id}"]`)?.classList.add('player-fee-raw-label');
  let last=null,invalid=false;const EventClass=document.defaultView?.Event??globalThis.Event;
  function sync(){if(input.disabled!==raw.disabled)input.disabled=raw.disabled;if(raw.value!==last){last=raw.value;try{input.value=atomsToDecimal(raw.value,scale);invalid=false;}catch{input.value='';invalid=true;}}text(note,invalid?'金额无效，请修改后再继续。':raw.value==='0'?'上限为0：仅允许不需此项支出的步骤。':'这是你允许的上限，实际费用会另行核对。');if(input.getAttribute('aria-invalid')!==String(invalid))input.setAttribute('aria-invalid',String(invalid));}
  input.addEventListener('input',()=>{try{raw.value=decimalToAtoms(input.value,scale);invalid=false;}catch{raw.value='';invalid=true;}last=raw.value;raw.dispatchEvent(new EventClass('input',{bubbles:true}));sync();});
  raw.addEventListener('input',()=>{if(raw.value!==last)sync();});raw.addEventListener('change',sync);sync();return {sync,input,raw};
}

export function mountProfileSelector(document){
  const primitive=document.getElementById('manufacture-primitive'),raw=document.getElementById('manufacture-profile');if(!primitive||!raw)return null;
  const box=document.createElement('div'),label=document.createElement('label'),select=document.createElement('select');box.className='player-profile-picker';label.htmlFor='player-part-purpose';label.textContent='这个部件用于哪个功能细胞？';select.id='player-part-purpose';
  const names=['体表交换','体表交换','密封支撑','代谢处理','代谢处理','营养供给','营养供给','代谢处理','稳态排出','运动执行','运动执行','环境感知','信号整合','结构支撑','稳态维持'];
  for(let i=0;i<=15;i++){const option=document.createElement('option');option.value=i===0?'':String(i);option.textContent=i===0?'请选择功能用途':String(i).padStart(2,'0')+' · '+names[i-1];select.append(option);}box.append(label,select);primitive.after(box);
  const EventClass=document.defaultView?.Event??globalThis.Event;function sync(){const hidden=primitive.value!=='4';if(box.hidden!==hidden)box.hidden=hidden;if(select.disabled!==raw.disabled)select.disabled=raw.disabled;const wanted=/^(?:[1-9]|1[0-5])$/.test(raw.value)?raw.value:'';if(select.value!==wanted)select.value=wanted;}
  select.addEventListener('change',()=>{raw.value=select.value;raw.dispatchEvent(new EventClass('input',{bubbles:true}));sync();});primitive.addEventListener('change',()=>{if(primitive.value!=='4'&&raw.value!=='0'){raw.value='0';raw.dispatchEvent(new EventClass('input',{bubbles:true}));}sync();});raw.addEventListener('input',sync);sync();return {sync,select,raw,box};
}

export function mountPlayerShell(document,{fetchImpl=globalThis.fetch}={}){
  if(!document.getElementById('player-mode-toggle'))return null;const $=id=>document.getElementById(id),nav=[...document.querySelectorAll('.nav-item')],mirrors=[];let advanced=false,config=null,generation=0,closed=false,controller=null,observer=null;
  function go(view,section){const target=nav.find(n=>n.dataset.view===view);if(!target)return;target.click();if(section){const select=$('wallet-discovery-section');if(select){select.value=section;select.dispatchEvent(new (document.defaultView?.Event??Event)('change',{bubbles:true}));}}}
  function syncIdentity(){const actor=verifiedPlayerIdentity(config);text($('player-wallet-display'),actor?`${actor.slice(0,6)}…${actor.slice(-4)}`:'未验证登录身份');if($('player-wallet-display'))$('player-wallet-display').title=actor??'';text($('player-wallet-note'),actor?'地址已由登录带入，操作前仍核对权限。':'设计实验可直接使用；读取资产需先登录。');text($('player-login-summary'),actor?'已登录，可展开切换或注销':'连接后可读取自己的原料与作品');for(const id of actors){const el=$(id);if(el)el.readOnly=!!actor&&!advanced;}}
  function mode(value){advanced=value;document.body.dataset.playerMode=advanced?'advanced':'simple';$('player-mode-toggle').setAttribute('aria-pressed',String(advanced));text($('player-mode-toggle'),advanced?'返回玩家模式':'高级模式');for(const d of document.querySelectorAll('.player-technical-drawer,.player-raw-response'))d.open=advanced;syncIdentity();mirrors.forEach(m=>m.sync());}
  for(const view of document.querySelectorAll('.view')){
    const name=view.id.replace(/-view$/,''),g=guides[name];if(g){const card=document.createElement('section');card.className='player-step-guide';const heading=document.createElement('h2'),description=document.createElement('p'),actions=document.createElement('div');heading.textContent=g.title;description.textContent=g.text;actions.className='player-guide-actions';for(const[label,target,section]of g.actions){const b=document.createElement('button');b.className='quiet';b.textContent=label;b.addEventListener('click',()=>go(target,section));actions.append(b);}card.append(heading,description,actions);const before=view.querySelector('.page-heading');if(before)before.after(card);else view.prepend(card);}
    const fields=[...view.querySelectorAll('.player-technical-field')];if(fields.length){const drawer=document.createElement('details');drawer.className='player-technical-drawer';const summary=document.createElement('summary');summary.textContent='技术标识与手动输入';drawer.append(summary);for(const field of fields){const parent=field.parentElement,next=field.nextElementSibling;if(next?.matches('p.native-hint')&&/Actor|公钥|nonce/.test(next.textContent))field.append(next);drawer.append(field);if(parent?.matches('.native-card')&&!parent.children.length)parent.classList.add('player-empty-card');}view.append(drawer);}
  }
  for(const raw of document.querySelectorAll('[data-player-fee]'))mirrors.push(mountFeeMirror(document,raw));const profile=mountProfileSelector(document);if(profile)mirrors.push(profile);
  for(const el of document.querySelectorAll('pre.native-json,dl.native-summary')){if(el.closest('details'))continue;const wrapper=document.createElement('details'),summary=document.createElement('summary');wrapper.className='player-raw-response';summary.textContent=el.tagName.toLowerCase()==='pre'?'查看原始记录':'查看核验细节';el.before(wrapper);wrapper.append(summary,el);}
  for(const button of nav)button.addEventListener('click',()=>{const parent=button.closest('details');if(parent)parent.open=true;const view=document.getElementById(`${button.dataset.view}-view`);if(view){for(const d of view.querySelectorAll('.player-technical-drawer'))d.open=advanced;}});
  $('player-mode-toggle').addEventListener('click',()=>mode(!advanced));
  async function loadConfig(){const own=++generation;controller?.abort();controller=new AbortController();config=null;syncIdentity();try{const value=await nativeRequest('config',undefined,{fetchImpl,signal:controller.signal});if(!closed&&own===generation){config=value;syncIdentity();if(verifiedPlayerIdentity(config)&&$('player-login'))$('player-login').open=false;}}catch{if(!closed&&own===generation){config=null;syncIdentity();}}}
  document.addEventListener('biolab-auth-change',()=>{config=null;syncIdentity();void loadConfig();});
  let queued=false;const Observer=document.defaultView?.MutationObserver;if(Observer){observer=new Observer(()=>{if(queued||closed)return;queued=true;queueMicrotask(()=>{queued=false;if(!closed)mirrors.forEach(m=>m.sync());});});observer.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});}
  mode(false);void loadConfig();return {mode,go,mirrors,refreshIdentity:loadConfig,close(){closed=true;generation++;controller?.abort();observer?.disconnect();}};
}
if(typeof document!=='undefined')mountPlayerShell(document);
