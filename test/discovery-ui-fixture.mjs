import { readFile } from 'node:fs/promises';
import { setBrowserAuthSession } from '../apps/player/dist/auth-session.js';

export const actor='3kF2TqjkRAzKLyabi6ugsmKS6PTnkhh5KWhmMoqQcVDm',other='22222222222222222222222222222222';
export const context={releaseHash:'a'.repeat(64),abiHash:'b'.repeat(64),domainHex:'c'.repeat(64),configHex:'d'.repeat(64)};
export const config=()=>({enabled:true,chain:'solana:localnet',authenticationRequired:true,sessionAuthenticated:true,sessionActor:actor,...context});
export const cursor='f'.repeat(64),projectId='ab'.repeat(32);
export const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
export const flush=()=>new Promise(r=>setImmediate(r));
export const clone=v=>JSON.parse(JSON.stringify(v));
export function login(who=actor,bindings=context){setBrowserAuthSession({actor:who},bindings);}
export function projectRow(changes={}){return {type:'PROJECT',recordVerified:true,observedSlot:'101',projectIdHex:projectId,address:'7'.repeat(32),name:'Target laboratory',creator:actor,seller:other,createdAt:'1760000000',createdSlot:'40',classes:Array.from({length:4},(_,i)=>({class:i+1,mint:String(i+3).repeat(32),cap:'100',unitPriceLamports:String(i),issued:'3',intakeBurned:'1',supply:'2'})),...changes};}
export function discoveryPage(changes={}){return {profile:'BIO-DISCOVERY1',decision:'DISCOVERY_PAGE',actor,section:'projects',context:{...context},rows:[projectRow()],nextCursor:null,coverage:{state:'TRAVERSAL_EXHAUSTED',commitment:'finalized',consistency:'MULTI_SLOT_BEST_EFFORT',minObservedSlot:'100',maxObservedSlot:'110',prefixesVisited:'1',pending:false,cryptographicComplete:false,fullWallet:false},issues:[],readFlags:{transactionExecuted:false,networkSubmitted:false,reservesOnChainNonce:false,discoveryOnly:true,actionEligibilityVerified:false},...changes};}
const common={recordVerified:true,observedSlot:'101',address:'7'.repeat(32)};
export const instanceId='12'.repeat(32),sourceId='34'.repeat(32),positionId='56'.repeat(32);
export function rootRow(changes={}){return {...common,type:'ROOT',instanceHex:instanceId,owner:actor,descriptorHex:'46412201',target:22,qualityPpm:'2000000',B:'7200000',retired:'2700000',revision:'1',lifecycle:'LIVE',parentInstanceHex:null,registration:{exists:true,ordinaryCount:'1',directorySequence:'60',certificateFault:false},...changes};}
export function positionRow(changes={}){return {...common,type:'POSITION',positionIdHex:positionId,instanceHex:instanceId,positionSeq:'60',beneficiary:actor,start:'20',end:'80',accrued:'3000',paid:'1000',nextUnsettledHour:'80',rootOwner:other,rootLifecycle:'CONSUMED',...changes};}
export function sourceRow(changes={}){return {...common,type:'SOURCE',sourceIdHex:sourceId,owner:actor,projectIdHex:projectId,class:1,mint:'3'.repeat(32),unitCount:'1',initialTick:Array.from({length:32},(_,i)=>i===0?'10000':'0'),spentPrefix:Array.from({length:32},(_,i)=>i===0?'7500':'0'),remainingTick:Array.from({length:32},(_,i)=>i===0?'2500':'0'),createdAt:'1760000000',createdSlot:'40',...changes};}
export function materialRow(changes={}){return {...common,type:'MATERIAL_ATA',projectIdHex:projectId,class:1,mint:'3'.repeat(32),owner:actor,amount:'5',manufactureIncluded:false,...changes};}
export function tokenRow(changes={}){return {...common,type:'CLASSIC_TOKEN_HINT',mint:'3'.repeat(32),owner:actor,amount:'1024940',isStandardAta:false,protocolMatch:'LAB',manufactureIncluded:false,...changes};}
export class Element{
  constructor(tagName='div'){this.tagName=tagName;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.disabled=false;this.hidden=false;this.textContent='';this._value='';this.className='';this.classList={toggle:(name,on)=>{const s=new Set(this.className.split(' ').filter(Boolean));if(on)s.add(name);else s.delete(name);this.className=[...s].join(' ');}};}
  get value(){return this._value;}set value(v){const text=String(v);this._value=this.tagName==='select'&&!this.children.some(o=>o.tagName==='option'&&o.value===text)?'':text;}
  set innerHTML(_){throw Error('unsafe innerHTML is forbidden');}
  append(...children){this.children.push(...children);if(this.tagName==='select'&&this.children.length===children.length)this.value=this.children[0]?.value??'';}
  replaceChildren(...children){this.children=[];if(this.tagName==='select')this.value='';this.append(...children);}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  dispatchEvent(event){for(const fn of this.listeners[event.type]??[])fn({type:event.type,target:this,detail:event.detail});return true;}
  click(){if(!this.disabled)this.dispatchEvent({type:'click'});}
  async trigger(name){if(name==='click')this.click();else this.dispatchEvent({type:name});await flush();}
}
export async function discoveryDocument(){
  const html=await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8'),els=new Map(),nav=[],views=[],listeners={};
  for(const [,tag,a]of html.matchAll(/<([a-z-]+)\b([^>]*)>/g)){
    const el=new Element(tag),id=a.match(/\bid="([^"]+)"/)?.[1];if(id){el.id=id;els.set(id,el);}el.className=a.match(/\bclass="([^"]+)"/)?.[1]??'';el.value=a.match(/\bvalue="([^"]*)"/)?.[1]??'';el.disabled=/\bdisabled\b/.test(a);el.hidden=/\bhidden\b/.test(a);const view=a.match(/\bdata-view="([^"]+)"/)?.[1];if(view){el.dataset.view=view;nav.push(el);}if(el.className.split(' ').includes('view'))views.push(el);
  }
  for(const [,a,content]of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)){const id=a.match(/\bid="([^"]+)"/)?.[1];if(id)els.get(id).value=content;}
  for(const [,a,content]of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){const id=a.match(/\bid="([^"]+)"/)?.[1];if(!id)continue;for(const [,oa,label]of content.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)){const opt=new Element('option');opt.value=oa.match(/\bvalue="([^"]*)"/)?.[1]??label;opt.textContent=label;els.get(id).append(opt);if(/\bselected\b/.test(oa))els.get(id).value=opt.value;}}
  for(const button of nav)button.addEventListener('click',()=>{for(const b of nav)b.classList.toggle('active',b===button);for(const n of ['builder','flow','economy'])els.get(n+'-view').hidden=n!==button.dataset.view;els.get('page-title').textContent=({builder:'构造工作台',flow:'玩家路径',economy:'产出与原料'})[button.dataset.view];});
  return {els,nav,views,html,defaultView:{Event:class{constructor(type){this.type=type;}}},getElementById:id=>els.get(id),createElement:tag=>new Element(tag),querySelectorAll:s=>s==='.nav-item'?nav:s==='.view'?views:[],addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){for(const fn of listeners[event.type]??[])fn(event);}};
}
export const allText=el=>[el.textContent,...el.children.map(allText)].join(' ');
