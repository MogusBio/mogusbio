// UI-only draft configuration. Actual validity is decided by /api/validate.
export const LAB_TARGETS=Object.freeze({4:{name:'Metabolic cell',scope:'CELL',specimen:'cell',inputs:'4 matching functional components'},17:{name:'Metabolic organ',scope:'ORGAN',specimen:'cell',inputs:'3 matching functional cells'},22:{name:'Digital organism',scope:'BIO',specimen:'organism',inputs:'6 matching functional organs'}});
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function checkLabConfig(c){
  if(c?.productionAdmission!==false||!hex(c.ruleHash)||!hex(c.validatorHash)||!Array.isArray(c.references)||c.references.length<1||c.references.length>64)throw Error('MODEL_CONFIG');
  for(const r of c.references)if(!Number.isInteger(r.index)||!Number.isInteger(r.cost)||typeof r.name!=='string'||!r.graph||r.graph.rule!==c.ruleHash||r.graph.target!==22||!Array.isArray(r.graph.cells)||r.graph.cells.length!==15||!['domain','config','catalog','rule'].every(k=>hex(r.graph[k])))throw Error('MODEL_REFERENCE');
  return c;
}
export function createLabDraft(config,index){checkLabConfig(config);const r=config.references.find(x=>x.index===index)??config.references.find(x=>x.cost===310)??config.references.at(-1);return{referenceIndex:r.index,referenceName:r.name,target:4,challenge:2000000,graph:structuredClone(r.graph)};}
export function changeLabDraft(draft,{target=draft.target,challenge=draft.challenge,capacity}={}){
  if(!Object.hasOwn(LAB_TARGETS,target)||!Number.isInteger(challenge)||challenge<500000||challenge>2000000||challenge%1000||capacity!==undefined&&(!Number.isInteger(capacity)||capacity<0||capacity>1000000||capacity%1000))throw Error('DRAFT_FIELDS');
  const next=structuredClone(draft);next.target=target;next.challenge=challenge;if(capacity!==undefined){const cell=next.graph.cells.find(c=>c.role===4);if(!cell)throw Error('MODEL_CELL');cell.v=capacity;}return next;
}
export function checkLabResult(data,draft,{requestSHA}={}){
  if(data?.status!=='PASS'||data.productionAdmission!==false||data.target!==draft.target||data.scope!==LAB_TARGETS[draft.target].scope||data.steps!==73||!hex(data.requestSHA)||requestSHA!==undefined&&data.requestSHA!==requestSHA||!hex(data.designId)||!hex(data.graphSHA)||typeof data.q!=='string'||!/^[1-9]\d*$/.test(data.q)||BigInt(data.q)>2000000n)throw Error('MODEL_RESULT');
  return data;
}
export function isLabRecord(r){
  return r?.profile==='BIO-LAB-VISUAL-RECORD1'&&typeof r.date==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.date)&&Number.isFinite(Date.parse(r.date))&&new Date(r.date).toISOString()===r.date&&typeof r.reference==='string'&&/^C\d{1,6}(?: [AB])?$/.test(r.reference)&&Object.hasOwn(LAB_TARGETS,r.target)&&r.scope===LAB_TARGETS[r.target].scope&&typeof r.quality==='string'&&/^[1-9]\d{0,6}$/.test(r.quality)&&BigInt(r.quality)<=2000000n&&hex(r.designId)&&hex(r.graphSHA)&&hex(r.rule)&&r.rounds===73&&r.previewOnly===true&&r.networkSubmitted===false;
}
export const labInput=draft=>({graph:structuredClone(draft.graph),challenge:draft.challenge,target:draft.target});
export function labRecord(draft,result,date=new Date().toISOString()){
  checkLabResult(result,draft);return{profile:'BIO-LAB-VISUAL-RECORD1',date,reference:draft.referenceName,target:draft.target,scope:result.scope,quality:result.q,designId:result.designId,graphSHA:result.graphSHA,rounds:result.steps,rule:draft.graph.rule,previewOnly:true,networkSubmitted:false};
}
