import {formatLabUnits,decimalLabUnits} from './lab-sim-client.js';
export const MATERIAL_LABELS={1:'Amino acids',2:'Nucleotides',3:'Lipids',4:'Sugars'};
export const MATERIAL_SYMBOLS={1:'AA',2:'NUC',3:'LIPID',4:'SUGAR'};
export const FUNCTION_NAMES=['Surface exchange','Surface exchange','Sealed support','Metabolic processing','Metabolic processing','Nutrient supply','Nutrient supply','Metabolic processing','Waste removal','Movement','Movement','Environmental sensing','Signal integration','Structural support','Homeostasis'];
export const ORGAN_ROLES=[[1,2],[3,4,5],[6,7,8,9],[10,11],[12,13],[14,15]];
export const shortId=id=>typeof id==='string'?id.slice(0,8):'—';
// Protocol weight = milli-RU × ppm-performance × quarter-level multiplier.
// Displayed weight removes those 1,000 × 1,000,000 × 4 fixed-point factors.
export function formatProductionWeight(value){if(typeof value!=='string'||!/^(?:0|[1-9]\d*)$/.test(value))return '—';const n=BigInt(value),scale=4000000000n;let r=n%scale,digits='';while(r){r*=10n;digits+=(r/scale).toString();r%=scale;}return `${n/scale}${digits?'.'+digits:''}`;}
export function formatSolMovement(value){if(typeof value!=='string'||!/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value))return 'SOL movement not recorded';return value.startsWith('-')?`SOL credit ${formatLabUnits(value.slice(1),9)}`:`SOL debit ${formatLabUnits(value,9)}`;}
export const workTitle=w=>w.scope==='COMPONENT'?`${['','Exchange component','Processing component','Transport component','Functional component'][w.primitive]??'Component'}${w.profile?` / C${String(w.profile).padStart(2,'0')}`:''}`:w.scope==='CELL'?`C${String(w.target).padStart(2,'0')} · ${FUNCTION_NAMES[w.target-1]??'Functional cell'}`:w.scope==='ORGAN'?`O${String(w.target-15).padStart(2,'0')} · Functional organ`:'Digital organism';
export function labUI(document,context){
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
  const button=(text,fn,{disabled=false,primary=false,active}={})=>{const b=el('button',text,primary?'lab-op-action primary':'lab-op-action');b.type='button';b.disabled=context.busy||disabled;if(typeof active==='boolean')b.setAttribute('aria-pressed',String(active));b.addEventListener('click',()=>{if(!b.disabled)void fn();});return b;};
  const field=(label,input,{note}={})=>{const box=el('label',undefined,'lab-op-field');box.append(el('span',label),input);if(note)box.append(el('small',note));return box;};
  const input=(value,{type='text',min,max,step,placeholder,onChange}={})=>{const i=el('input');i.type=type;i.value=String(value??'');i.disabled=context.busy;for(const [k,v]of Object.entries({min,max,step,placeholder}))if(v!==undefined)i[k]=String(v);if(onChange)i.addEventListener('change',()=>onChange(i.value));return i;};
  const select=(options,value,onChange)=>{const s=el('select');for(const [v,label]of options){const o=el('option',label);o.value=String(v);s.append(o);}s.value=String(value??options[0]?.[0]??'');s.disabled=context.busy;if(onChange)s.addEventListener('change',()=>onChange(s.value));return s;};
  const row=(...children)=>{const r=el('div',undefined,'lab-op-toolbar');r.append(...children);return r;};
  const card=(title,...children)=>{const c=el('article',undefined,'lab-op-card');c.append(el('h3',title),...children);return c;};
  const note=text=>el('p',text,'lab-op-note');
  const grid=(...children)=>{const g=el('div',undefined,'lab-op-grid');g.append(...children);return g;};
  const section=(title,...children)=>{const s=el('section',undefined,'lab-op-section');s.append(el('h3',title),...children);return s;};
  const metric=(name,value)=>{const m=el('div',undefined,'lab-op-metric');m.append(el('span',name),el('strong',value));return m;};
  const lab=n=>formatLabUnits(String(n??'0'),6),sol=n=>formatLabUnits(String(n??'0'),9);
  const safe=fn=>{try{return fn();}catch(error){context.status('Enter a valid amount with up to 9 decimal places.',true);return null;}};
  return{...context,document,el,button,field,input,select,row,card,note,grid,section,metric,lab,sol,safe,toLamports:v=>decimalLabUnits(v,9)};
}
