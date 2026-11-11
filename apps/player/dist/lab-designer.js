import {checkDraftForEditor,editDraft,percentToFraction,fractionToPercent} from './visual-designer.js';

const clone=value=>structuredClone(value),locked=new Set([3,9,14,15]);
const names=['Surface exchange A','Surface exchange B','Sealed support','Metabolic processor A','Metabolic processor B','Nutrient supply A','Nutrient supply B','Metabolic processor C','Waste homeostasis','Motion actuator A','Motion actuator B','Environmental sensor','Signal integrator','Structural support','Homeostasis'];
const streams={1:{name:'Nutrient',symbol:'N',color:'#7a9a36',peers:[6,7]},2:{name:'Oxygen',symbol:'O',color:'#598c75',peers:[1,2]},3:{name:'Waste',symbol:'W',color:'#b37b55',peers:[1,2]}};
const roleName=role=>`C${String(role).padStart(2,'0')} ${names[role-1]??'Unknown role'}`;
const scopeName=scope=>scope<=15?roleName(scope):scope<=21?`Organ O${String(scope-15).padStart(2,'0')}`:'Complete organism';
let nextMount=0;


/** Edits the actual frozen 15-cell / 6-organ / 1-organism graph. Rendering and
 * local guards never claim the result passes the protocol's functional model. */
export function mountLabDesigner(host,{graph,onChange=()=>{},onValidate,document=host?.ownerDocument}={}){
  if(!host?.replaceChildren||!document?.createElement)throw Error('LAB_DESIGNER_HOST');
  const checked=value=>{try{return clone(checkDraftForEditor(value));}catch{throw Error('LAB_DESIGNER_GRAPH: A complete frozen 22-scope graph is required.');}};
  let current=checked(graph),selected=4,type=1,peer=6,socket=1,fractionText='50',pending=null,revision=0,closed=false,validating=false;
  let status='Select a cell, then connect its real ports. Changes remain a local draft until the full experiment passes.',statusState='draft';
  const prefix=`lab-blueprint-${++nextMount}`,namespace='http://www.w3.org/2000/svg';
  const make=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  const svg=(tag,attributes={},text)=>{const element=document.createElementNS?document.createElementNS(namespace,tag):document.createElement(tag);for(const [key,value]of Object.entries(attributes))element.setAttribute(key,String(value));if(text!==undefined)element.textContent=text;return element;};
  const button=(text,action,className)=>{const element=make('button',text,className);element.type='button';element.addEventListener('click',action);return element;};
  const accessible=(element,label,action)=>{element.setAttribute('role','button');element.setAttribute('tabindex','0');element.setAttribute('aria-label',label);element.addEventListener('click',event=>{event.stopPropagation?.();action();});element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault?.();action();}});};
  const field=(label,input,id)=>{const wrap=make('div'),caption=make('label',label);input.id=`${prefix}-${id}`;caption.htmlFor=input.id;wrap.append(caption,input);return wrap;};
  const select=(options,value,change)=>{const input=make('select');for(const [id,label]of options){const option=make('option',label);option.value=String(id);input.append(option);}input.value=String(value);input.addEventListener('change',()=>change(input.value));return input;};
  function announce(text,state='draft'){status=text;statusState=state;}
  function apply(action){
    if(closed)return;
    let next;try{next=editDraft(current,action);}catch{announce(action.kind==='flow'?'Connection refused. Use a legal source and socket, and keep the total allocation of this stream at or below 100%.':'Edit refused. Capabilities use 0.1% steps; fixed roles and hierarchy cannot be replaced.','error');render();return false;}
    current=next;revision++;validating=false;pending=null;announce('Blueprint changed. Run the complete functional experiment before manufacturing this design.');
    try{onChange(clone(current),{action:clone(action),revision});}catch{announce('The draft changed locally, but the workspace could not accept the update. Reopen the designer before manufacturing.','error');}
    render();return true;
  }
  function applyFlow(){let fraction;try{fraction=percentToFraction(fractionText);}catch{announce('Enter an allocation from 0 to 100 with at most four decimal places.','error');render();return;}apply({kind:'flow',type,role:selected,peer,socket,fraction});}
  function setType(next){type=next;peer=streams[type].peers[0];pending=null;announce(`Editing ${streams[type].name.toLowerCase()} connections. Click a source port, then a destination port, or use the endpoint controls.`);render();}
  function choosePort(role,kind,index=1){
    if(kind==='source'){
      if(type===3){selected=role;socket=index;pending={role,socket:index};}
      else{peer=role;pending={peer:role};}
      announce(`Source selected. Choose a ${type===3?'surface sink':'cell inlet'} to connect at ${fractionText}%.`);render();return;
    }
    if(type===3)peer=role;else{selected=role;socket=index;}
    if(pending)applyFlow();else{announce('Destination selected. Choose a source port or use Connect ports.');render();}
  }
  function point(role,kind,index=1){const slot=current.slots.find(item=>item.role===role),x=28+slot.x*174,y=28+slot.y*146;return{x:x+(kind==='source'?146:0),y:y+(index===0?39:index===1?24:56)};}
  function graphView(){
    const wrap=make('div',undefined,'ld-map'),canvas=svg('svg',{viewBox:'0 0 900 480','aria-label':`${streams[type].name} network, 15 fixed functional cells`,role:'group'}),stream=streams[type];
    canvas.append(svg('title',{},'Functional cell blueprint: select cells and connect the permitted ports.'));
    for(const edge of current.edges.filter(edge=>edge.type===type)){
      const role=type===3?edge.src.role:edge.dst.role,source=type===3?point(role,'source',edge.src.port-4):point(edge.src.role,'source',0),destination=type===3?point(edge.dst.role,'destination',0):point(role,'destination',edge.dst.port-(type===1?0:2));
      const bend=Math.max(40,Math.abs(destination.x-source.x)*.4),path=svg('path',{d:`M${source.x} ${source.y} C${source.x+bend} ${source.y},${destination.x-bend} ${destination.y},${destination.x} ${destination.y}`,fill:'none',stroke:stream.color,'stroke-width':role===selected?2.6:1.2,opacity:role===selected?.95:.26,'pointer-events':'none'});
      path.append(svg('title',{},`${roleName(edge.src.role)} to ${roleName(edge.dst.role)}: ${fractionToPercent(edge.fraction)}%`));canvas.append(path);
    }
    for(const slot of current.slots){
      const role=slot.role,x=28+slot.x*174,y=28+slot.y*146,isSelected=role===selected,node=svg('g',{'data-role':role});
      node.append(svg('rect',{x,y,width:146,height:80,rx:9,fill:isSelected?'#deedbd':'#fffdf0',stroke:isSelected?'#6f9444':'#b6c697','stroke-width':isSelected?2:1}));
      node.append(svg('text',{x:x+14,y:y+23,fill:isSelected?'#3f682b':'#7b8f61','font-family':'monospace','font-size':13},`C${String(role).padStart(2,'0')}`));
      node.append(svg('text',{x:x+14,y:y+44,fill:'#4e6e36','font-family':'sans-serif','font-size':10.5},names[role-1]));
      node.append(svg('text',{x:x+14,y:y+63,fill:'#82966d','font-family':'monospace','font-size':9.5},`CAP ${fractionToPercent(current.cells.find(cell=>cell.role===role).v)}%  /  ${current.tiers.find(tier=>tier.scope===role).mode?'B':'A'}`));
      accessible(node,`Select ${roleName(role)}`,()=>{selected=role;pending=null;render();});canvas.append(node);
      const port=(kind,index,label)=>{const p=point(role,kind,index),circle=svg('circle',{cx:p.x,cy:p.y,r:5.5,fill:stream.color,stroke:'#f8faef','stroke-width':2,'data-port':`${role}:${kind}:${index}`});accessible(circle,`${roleName(role)} ${label}`,()=>choosePort(role,kind,index));circle.append(svg('title',{},`${label}: ${roleName(role)}`));canvas.append(circle);};
      if(type===3){port('source',1,'waste outlet A');port('source',2,'waste outlet B');if(stream.peers.includes(role))port('destination',0,'surface waste sink');}
      else{port('destination',1,`${stream.name} inlet A`);port('destination',2,`${stream.name} inlet B`);if(stream.peers.includes(role))port('source',0,`${stream.name} source`);}
    }
    wrap.append(canvas);return wrap;
  }
  function connectionCard(){
    const card=make('section',undefined,'ld-card'),stream=streams[type],flows=current.edges.filter(edge=>edge.type===type&&(type===3?edge.src.role:edge.dst.role)===selected),sum=flows.reduce((total,edge)=>total+edge.fraction,0);
    card.append(make('h4',`${stream.name} connections`),make('p',`${fractionToPercent(sum)}% connected · ${fractionToPercent(1000000-sum)}% open`,'ld-muted'));
    const form=make('form'),source=select(stream.peers.map(role=>[role,roleName(role)]),peer,value=>{peer=Number(value);}),port=select([[1,type===3?'Outlet A':'Inlet A'],[2,type===3?'Outlet B':'Inlet B']],socket,value=>{socket=Number(value);}),amount=make('input');amount.type='text';amount.inputMode='decimal';amount.maxLength=9;amount.value=fractionText;amount.addEventListener('input',()=>{fractionText=amount.value;});
    form.append(field(type===3?'Destination surface':'Source cell',source,'peer'),field('Selected cell port',port,'socket'),field('Allocation (%)',amount,'fraction'));
    const connect=make('button','Connect ports','ld-primary');connect.type='submit';form.append(connect);form.addEventListener('submit',event=>{event.preventDefault();fractionText=amount.value;peer=Number(source.value);socket=Number(port.value);applyFlow();});card.append(form);
    for(const edge of flows){const other=type===3?edge.dst.role:edge.src.role,index=type===3?edge.src.port-4:edge.dst.port-(type===1?0:2),row=make('div',undefined,'ld-flow-row');row.append(make('span',`C${String(other).padStart(2,'0')} · ${index===1?'A':'B'} · ${fractionToPercent(edge.fraction)}%`),button('Edit',()=>{peer=other;socket=index;fractionText=fractionToPercent(edge.fraction);render();}),button('Remove',()=>apply({kind:'flow',type,role:selected,peer:other,socket:index,fraction:0})));card.append(row);}
    card.append(make('p','Fixed support, control and mechanical links remain part of the submitted graph. This view edits the selected material stream.','ld-note'));return card;
  }
  function capabilityCard(){
    const card=make('section',undefined,'ld-card'),cell=current.cells.find(cell=>cell.role===selected),amount=make('input');amount.type='number';amount.min='0';amount.max='100';amount.step='0.1';amount.value=fractionToPercent(cell.v);amount.disabled=locked.has(selected);
    const form=make('form');form.append(field('Capability (%; 0.1% steps)',amount,'capacity'));const save=make('button',locked.has(selected)?'Fixed by protocol':'Apply capability');save.type='submit';save.disabled=locked.has(selected);form.append(save);form.addEventListener('submit',event=>{event.preventDefault();let value;try{value=percentToFraction(amount.value);}catch{announce('Capability must be between 0 and 100%, in 0.1% steps.','error');render();return;}apply({kind:'capability',role:selected,value});});
    card.append(make('h4','Cell capability'),form,make('p','Capability influences model demand and cost. More capacity alone does not guarantee higher quality.','ld-note'));return card;
  }
  function structureCard(){
    const card=make('section',undefined,'ld-card');card.append(make('h4','Hierarchy and layout'));
    const scope=select(current.tiers.map(tier=>[tier.scope,scopeName(tier.scope)]),selected,()=>drawModes()),modes=make('div',undefined,'ld-actions');
    const drawModes=()=>{const selectedScope=Number(scope.value),tier=current.tiers.find(tier=>tier.scope===selectedScope);modes.replaceChildren();for(const mode of [0,1]){const control=button(`Mode ${mode?'B':'A'}`,()=>apply({kind:'tier',scope:selectedScope,mode}));control.setAttribute('aria-pressed',String(tier.mode===mode));modes.append(control);}};
    card.append(field('Fixed hierarchy scope',scope,'scope'),modes);drawModes();
    const destination=select([...current.slots].sort((a,b)=>a.y-b.y||a.x-b.x).map(slot=>[slot.role,`${slot.x+1},${slot.y+1} · C${String(slot.role).padStart(2,'0')}`]),selected,()=>{});
    card.append(field('Swap occupied position with',destination,'position'),button('Swap cell positions',()=>apply({kind:'swap',role:selected,peer:Number(destination.value)})),make('p','15 real cells → 6 fixed organ containers → 1 organism. Nodes cannot be invented or duplicated.','ld-note'));return card;
  }
  async function validate(){
    if(closed||validating||typeof onValidate!=='function')return;const version=revision;validating=true;announce('Running the complete server-side functional experiment…');render();
    try{const result=await onValidate(clone(current));if(closed||revision!==version)return;validating=false;if(result?.status==='PASS')announce('Functional experiment passed for this exact draft. Check the experiment report before manufacturing.','pass');else if(result?.status==='FAIL'||result?.status==='ERROR')announce('The experiment did not pass. Review the functional result and adjust the draft.','error');else announce('Validation requested. The experiment panel contains the authoritative result.');}
    catch{if(closed||revision!==version)return;validating=false;announce('Validation could not complete. No local edit is treated as a passing experiment.','error');}render();
  }
  function render(){
    if(closed)return;const root=make('div',undefined,'lab-designer'),head=make('header',undefined,'ld-head'),title=make('div');title.append(make('h3','Blueprint editor'),make('p','Real cells. Real ports. Your allocation.','ld-muted'));head.append(title,make('span',statusState==='pass'?'EXPERIMENT PASSED':'LOCAL DRAFT','ld-badge'));root.append(head);
    const tools=make('div',undefined,'ld-tools');for(const [key,stream]of Object.entries(streams)){const tab=button(`${stream.symbol} · ${stream.name}`,()=>setType(Number(key)));tab.setAttribute('aria-pressed',String(type===Number(key)));tools.append(tab);}root.append(tools);
    const layout=make('div',undefined,'ld-layout'),map=make('section');map.append(graphView(),make('p','Click a bright source dot, then an inlet or sink dot to connect. Select a cell to inspect its exact allocation.','ld-note'));const inspector=make('aside',undefined,'ld-inspector'),role=select(names.map((name,index)=>[index+1,`C${String(index+1).padStart(2,'0')} ${name}`]),selected,value=>{selected=Number(value);pending=null;render();});inspector.append(field('Selected functional cell',role,'role'),connectionCard(),capabilityCard(),structureCard());layout.append(map,inspector);root.append(layout);
    const message=make('p',status,'ld-status');message.setAttribute('role','status');message.dataset.state=statusState;root.append(message);const footer=make('footer',undefined,'ld-footer'),run=button(validating?'Testing draft…':'Run functional experiment',validate,'ld-primary');run.disabled=validating||typeof onValidate!=='function';footer.append(make('p','This editor changes the actual submitted blueprint. No materials are consumed here.'),run);root.append(footer);host.replaceChildren(root);
  }
  render();
  return Object.freeze({getGraph(){return clone(current);},setGraph(value){if(closed)return false;current=checked(value);revision++;pending=null;validating=false;announce('Blueprint loaded. Run a new functional experiment after editing.');render();return true;},dispose(){if(closed)return;closed=true;revision++;host.replaceChildren();}});
}
