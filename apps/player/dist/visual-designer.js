// Local draft controls. These are editing conveniences, never a PASS oracle.
const clone=v=>structuredClone(v),integer=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const need=(v,m)=>{if(!v)throw Error(m);};
const hard=new Set([3,9,14,15]);
export const ROLE_NAMES=['体表交换','体表交换','密封支撑','代谢处理','代谢处理','营养供给','营养供给','代谢处理','稳态排出','运动执行','运动执行','环境感知','信号整合','结构支撑','稳态维持'];
export const roleName=r=>`C${String(r).padStart(2,'0')} ${ROLE_NAMES[r-1]??''}`;
export function checkDraftForEditor(g){
  need(g&&g.target===22&&Array.isArray(g.nodes)&&g.nodes.length===22&&g.nodes.every(n=>n&&integer(n.scope,1,22)&&integer(n.kind,1,3)&&integer(n.role,0,15)&&integer(n.parent,0,22))&&new Set(g.nodes.map(n=>n.scope)).size===22,'完整构造需要22个有效固定层级。');
  need(Array.isArray(g.tiers)&&g.tiers.length===22&&g.tiers.every(t=>t&&integer(t.scope,1,22)&&[0,1].includes(t.mode))&&new Set(g.tiers.map(t=>t.scope)).size===22,'层级模式表缺失或无效。');
  need(Array.isArray(g.cells)&&g.cells.length===15&&g.cells.every(c=>c&&integer(c.role,1,15)&&integer(c.v,0,1000000)&&c.v%1000===0)&&new Set(g.cells.map(c=>c.role)).size===15,'构造需要15个有效功能角色。');
  need(Array.isArray(g.opens)&&g.opens.length===45&&g.opens.every(o=>o&&integer(o.role,1,15)&&integer(o.species,1,3)&&integer(o.remaining,0,1000000))&&new Set(g.opens.map(o=>`${o.role}:${o.species}`)).size===45,'开放比例表缺失或无效。');
  need(Array.isArray(g.edges)&&g.edges.length<=440&&g.edges.every(e=>e&&e.src&&e.dst&&integer(e.type,1,10)&&integer(e.fraction,0,1000000)),'连接表缺失或无效。');
  need(Array.isArray(g.slots)&&g.slots.length===15&&g.slots.every(s=>s&&integer(s.role,1,15)&&integer(s.x,0,4)&&integer(s.y,0,2))&&new Set(g.slots.map(s=>s.role)).size===15&&new Set(g.slots.map(s=>`${s.x},${s.y}`)).size===15,'布局必须填满15个互不重叠的位置。');return g;
}
const tuple=e=>[e.owner,e.type,e.src.kind,e.src.role,e.src.sub,e.src.port,e.dst.kind,e.dst.role,e.dst.sub,e.dst.port];
const compare=(a,b)=>{const x=tuple(a),y=tuple(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
const endpointKey=e=>[e.kind,e.role,e.sub,e.port].join(':'),key=e=>`${endpointKey(e.src)}>${endpointKey(e.dst)}`;
export function percentToFraction(text){need(typeof text==='string'&&/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/.test(text),'比例请输入0至100，最多4位小数。');const [a,b='']=text.split('.'),v=Number(a)*10000+Number(b.padEnd(4,'0'));need(v<=1000000,'比例不能超过100%。');return v;}
export function fractionToPercent(v){need(integer(v,0,1000000),'比例超出范围。');return `${Math.floor(v/10000)}.${String(v%10000).padStart(4,'0')}`.replace(/\.?0+$/,'');}
function owner(g,a,b){const parent=new Map(g.nodes.map(n=>[n.scope,n.parent])),seen=new Set();for(let s=a;s!==0;s=parent.get(s)){need(integer(s,1,22)&&!seen.has(s),'固定层级无效。');seen.add(s);}const visited=new Set();for(let s=b;s!==0;s=parent.get(s)){need(integer(s,1,22)&&!visited.has(s),'固定层级无效。');if(seen.has(s))return s;visited.add(s);}throw Error('两端没有共同真实容器。');}
function flowEdge(g,{type,role,peer,socket,fraction}){need(integer(type,1,3)&&integer(role,1,15)&&integer(socket,1,2)&&integer(fraction,0,1000000),'连接参数无效。');need(g.cells.some(c=>c.role===role)&&g.cells.some(c=>c.role===peer),'连接两端必须实际存在。');need((type===1?[6,7]:[1,2]).includes(peer),'连接来源不符合固定物种。');const leaf=(r,sub,port)=>({kind:0,role:r,sub,port});const src=type===3?leaf(role,1,4+socket):leaf(peer,4,17),dst=type===3?leaf(peer,4,18):leaf(role,1,(type===1?0:2)+socket);return {owner:owner(g,src.role,dst.role),type,src,dst,fraction};}
export function editDraft(graph,action){
  checkDraftForEditor(graph);need(action&&typeof action==='object','缺少编辑操作。');const g=clone(graph);
  if(action.kind==='flow'){
    const next=flowEdge(g,action),k=key(next),index=g.edges.findIndex(e=>key(e)===k);need(index<0||g.edges[index].type===next.type,'不能修改底层固定连接。');
    if(action.fraction===0){if(index>=0)g.edges.splice(index,1);}else if(index>=0)g.edges[index]=next;else{need(g.edges.length<440,'连接数量已达固定上限。');g.edges.push(next);}
    g.edges.sort(compare);g.opens=g.cells.flatMap(c=>[1,2,3].map(species=>{const sum=g.edges.filter(e=>e.type===species&&(species===3?e.src.role:e.dst.role)===c.role).reduce((n,e)=>n+e.fraction,0);need(sum<=1000000,'同一物种的比例总和不能超过100%；请先减少另一条连接。');return {role:c.role,species,remaining:1000000-sum};}));
  }else if(action.kind==='swap'){
    need(integer(action.role,1,15)&&integer(action.peer,1,15)&&g.slots?.length===15,'布局角色无效。');const a=g.slots.find(s=>s.role===action.role),b=g.slots.find(s=>s.role===action.peer);need(a&&b,'布局角色缺失。');[a.x,b.x]=[b.x,a.x];[a.y,b.y]=[b.y,a.y];
  }else if(action.kind==='tier'){
    need(integer(action.scope,1,22)&&[0,1].includes(action.mode),'层级模式无效。');const t=g.tiers.find(t=>t.scope===action.scope);need(t,'层级不存在。');t.mode=action.mode;
  }else if(action.kind==='capability'){
    need(integer(action.role,1,15)&&!hard.has(action.role)&&integer(action.value,0,1000000)&&action.value%1000===0,'该能力值不符合固定档位。');g.cells.find(c=>c.role===action.role).v=action.value;
  }else throw Error('未知本地编辑。');
  return g;
}
export function mountVisualDesigner(document,{getGraph,onEdit,getSelectedRole,onViewChange=()=>{}}){
  const container=document.getElementById('visual-designer');if(!container)return null;
  let section='flow',type=1,closed=false,tierScope=null,priorRole=null;
  const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  const button=(text,fn,cls='quiet')=>{const b=make('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;};
  function render(){if(closed)return;const g=getGraph();if(!g)return;const role=getSelectedRole();if(priorRole!==role){tierScope=role;priorRole=role;}const wrap=make('div',undefined,'visual-designer-card'),head=make('div',undefined,'result-heading');head.append(make('h2',`${roleName(role)} · 点选构造`),make('span','本地设计 · 尚未制造','native-hint'));wrap.append(head);
    const tabs=make('div',undefined,'designer-tabs');for(const [id,label]of [['flow','连接'],['layout','布局'],['tier','层级模式']]){const b=button(label,()=>{section=id;render();});b.setAttribute('aria-pressed',String(section===id));tabs.append(b);}wrap.append(tabs);
    const message=make('p','改动后需重新实验；不会消耗原料或修改已制造作品。','native-hint');message.setAttribute('role','status');
    const apply=action=>{try{onEdit(editDraft(getGraph(),action));render();}catch(e){message.textContent=e.message;message.className='native-message error';}};
    if(section==='flow'){
      const types=make('div',undefined,'designer-tabs');for(const [n,label]of [[1,'营养 N'],[2,'氧气 O'],[3,'废物 W']]){const b=button(label,()=>{type=n;onViewChange(type);render();});b.setAttribute('aria-pressed',String(type===n));types.append(b);}wrap.append(types);
      const flows=g.edges.filter(e=>e.type===type&&(type===3?e.src.role:e.dst.role)===role),sum=flows.reduce((n,e)=>n+e.fraction,0);wrap.append(make('p',`已连接 ${fractionToPercent(sum)}% · ${sum===1000000?'比例已齐，仍须实验核对流量和功能':`还差 ${fractionToPercent(1000000-sum)}%`}`,'designer-flow-total'));
      const form=make('form',undefined,'designer-flow-form'),peer=make('select'),socket=make('select'),amount=make('input');peer.id='designer-peer';socket.id='designer-socket';amount.id='designer-percent';amount.type='text';amount.inputMode='decimal';amount.value='50';amount.maxLength=9;
      for(const r of type===1?[6,7]:[1,2]){const o=make('option',roleName(r));o.value=String(r);peer.append(o);}for(const [i,label]of [[1,type===3?'出口 A':'入口 A'],[2,type===3?'出口 B':'入口 B']]){const o=make('option',label);o.value=String(i);socket.append(o);}
      const field=(text,el)=>{const l=make('label',text);l.htmlFor=el.id;const div=make('div');div.append(l,el);return div;};
      form.append(field(type===3?'排向哪里':'从哪里接入',peer),field('本模块的连接口',socket),field('分配比例（%）',amount));
      const save=make('button','应用这条连接','primary');save.type='submit';form.append(save);form.addEventListener('submit',event=>{event.preventDefault();let fraction;try{fraction=percentToFraction(amount.value);}catch(e){message.textContent=e.message;return;}apply({kind:'flow',type,role,peer:Number(peer.value),socket:Number(socket.value),fraction});});
      const rows=make('div',undefined,'designer-connections');for(const e of flows){const other=type===3?e.dst.role:e.src.role,port=type===3?e.src.port-4:e.dst.port-(type===1?0:2),row=make('div',undefined,'designer-connection');row.append(make('span',`${type===3?`${roleName(role)} → ${roleName(other)}`:`${roleName(other)} → ${roleName(role)}`} · ${port===1?'A':'B'}口 · ${fractionToPercent(e.fraction)}%`),button('调整',()=>{peer.value=String(other);socket.value=String(port);amount.value=fractionToPercent(e.fraction);amount.focus();}),button('移除',()=>apply({kind:'flow',type,role,peer:other,socket:port,fraction:0})));rows.append(row);}wrap.append(rows,form);
    }else if(section==='layout'){
      wrap.append(make('p','先在画布选中模块，再点击下面的位置，与该位置的模块交换。','native-hint'));const grid=make('div',undefined,'designer-slot-grid');for(const s of [...g.slots].sort((a,b)=>a.y-b.y||a.x-b.x)){const b=button(`${roleName(s.role)}${s.role===role?' · 当前':''}`,()=>apply({kind:'swap',role,peer:s.role}));b.disabled=s.role===role;grid.append(b);}wrap.append(grid);
    }else{
      wrap.append(make('p','每层仅有固定的A/B模式。它会影响容量与任务成本；实际品质由完整实验决定。','native-hint'));const select=make('select');select.id='designer-tier-scope';for(const t of g.tiers){const o=make('option',t.scope<=15?roleName(t.scope):t.scope<=21?`器官 O${String(t.scope-15).padStart(2,'0')}`:'完整生物');o.value=String(t.scope);select.append(o);}select.value=String(tierScope);const options=make('div',undefined,'native-actions');const drawModes=()=>{options.replaceChildren();const scope=Number(select.value);tierScope=scope;for(const mode of [0,1]){const b=button(`模式 ${mode===0?'A':'B'}${g.tiers.find(t=>t.scope===scope).mode===mode?' · 当前':''}`,()=>apply({kind:'tier',scope,mode}));options.append(b);}};select.addEventListener('change',drawModes);const label=make('label','调整哪一层');label.htmlFor=select.id;wrap.append(label,select,options);drawModes();
    }
    wrap.append(message);container.replaceChildren(wrap);
  }
  render();return {render,close(){closed=true;container.replaceChildren();}};
}
