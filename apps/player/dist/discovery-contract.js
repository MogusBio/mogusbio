import { decimalString,trustedConsoleConfig } from './native-console.js';
import { browserAuthMatches } from './auth-session.js';

export const DISCOVERY_SECTIONS=Object.freeze(['projects','my-projects','roots','sources','positions','material-atas','token-owner-hints']);
const contextKeys=['releaseHash','abiHash','domainHex','configHex'];
const coverageStates=new Set(['IN_PROGRESS','TRAVERSAL_EXHAUSTED','OVERFLOW','UNAVAILABLE','CHANGED']);
const decisions=new Set(['DISCOVERY_PAGE','DISCOVERY_BLOCKED','DISCOVERY_RESTART_REQUIRED']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export const discoveryCheck=(v,message)=>{if(!v)throw Error(message);};
const exact=(v,keys)=>discoveryCheck(object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(','),'发现响应字段不符合冻结接口。');
export const discoveryAddress=v=>{discoveryCheck(typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v),'发现响应包含无效地址。');return v;};
export const discoveryId=v=>{discoveryCheck(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),'发现响应包含无效 ID。');return v;};
export const discoveryCopy=v=>JSON.parse(JSON.stringify(v));
export const discoveryFreeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(discoveryFreeze);Object.freeze(v);}return v;};
export function discoveryFetch(fetchImpl,onDenied){return async(url,options)=>{const r=await fetchImpl(url,options);if(r?.status===401||r?.status===403)onDenied();return r;};}
const uint=v=>{decimalString(v);return BigInt(v);};
const textBytes=v=>new TextEncoder().encode(v).length;
const validUnicode=v=>![...v].some(c=>{const n=c.codePointAt(0);return n>=0xd800&&n<=0xdfff;});

export function discoveryConfigReady(config){return trustedConsoleConfig(config)&&config.authenticationRequired===true&&config.sessionAuthenticated===true&&browserAuthMatches(config)&&typeof config.sessionActor==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(config.sessionActor)&&contextKeys.every(k=>typeof config[k]==='string'&&/^[0-9a-f]{64}$/.test(config[k]));}
export function discoveryContext(config){discoveryCheck(discoveryConfigReady(config),'请先登录当前发布对应的钱包账户。');return Object.fromEntries(contextKeys.map(k=>[k,config[k]]));}
export function discoveryQuery(value){
  discoveryCheck(typeof value==='string'&&validUnicode(value)&&textBytes(value)<=128&&!/[\u0000-\u001f\u007f]/.test(value),'搜索须为不含控制字符的有效 UTF-8 文本，原始输入最多 128 字节。');
  return value.normalize('NFC').trim();
}
export function discoveryRequest({config,section,cursor=null,query=''}){
  discoveryContext(config);discoveryCheck(DISCOVERY_SECTIONS.includes(section),'未知发现分类。');
  discoveryCheck(cursor===null||typeof cursor==='string'&&/^[0-9a-f]{64}$/.test(cursor),'请重新开始当前发现；继续标识无效。');
  const canonical=discoveryQuery(query);discoveryCheck(['projects','my-projects'].includes(section)||query==='','钱包分类的 query 必须为空。');
  return {actor:config.sessionActor,section,cursor,query:canonical};
}

function projectRow(row,request){
  exact(row,['type','recordVerified','observedSlot','projectIdHex','address','name','creator','seller','createdAt','createdSlot','classes']);
  discoveryCheck(row.type==='PROJECT','目录只能包含实际项目记录。');discoveryId(row.projectIdHex);discoveryAddress(row.address);discoveryAddress(row.creator);discoveryAddress(row.seller);
  discoveryCheck(typeof row.name==='string'&&validUnicode(row.name)&&textBytes(row.name)>=1&&textBytes(row.name)<=64&&!/[\u0000-\u001f\u007f]/.test(row.name),'项目名称字段无效。');
  uint(row.createdAt);uint(row.createdSlot);discoveryCheck(uint(row.createdSlot)<=uint(row.observedSlot),'项目创建时间超出观察区间。');
  if(request.section==='my-projects')discoveryCheck(row.creator===request.actor,'我的项目结果包含其他创建者。');
  const q=request.query;if(q)discoveryCheck(row.name.normalize('NFC').toLowerCase().includes(q.toLowerCase())||row.projectIdHex===q.toLowerCase()||row.creator===q,'项目记录不匹配当前搜索。');
  discoveryCheck(Array.isArray(row.classes)&&row.classes.length===4,'项目缺少四类原料条款。');const mints=new Set();
  row.classes.forEach((c,i)=>{
    exact(c,['class','mint','cap','unitPriceLamports','issued','intakeBurned','supply']);discoveryCheck(c.class===i+1,'项目四类原料顺序无效。');discoveryAddress(c.mint);discoveryCheck(!mints.has(c.mint),'项目 mint 重复。');mints.add(c.mint);
    const cap=uint(c.cap),issued=uint(c.issued),burned=uint(c.intakeBurned),supply=uint(c.supply);uint(c.unitPriceLamports);
    discoveryCheck(cap>=1n&&cap<=1000000n&&burned<=issued&&issued<=cap&&supply<=issued-burned,'项目发行、摄入与供应量不一致。');
  });
  return row.projectIdHex;
}
function walletRow(row,request){
  const base=['type','recordVerified','observedSlot'];
  if(request.section==='roots'){
    exact(row,[...base,'instanceHex','address','owner','descriptorHex','target','qualityPpm','B','retired','revision','lifecycle','parentInstanceHex','registration']);
    discoveryCheck(row.type==='ROOT'&&row.lifecycle==='LIVE'&&row.owner===request.actor,'当前作品必须是此账户的 LIVE 成品。');discoveryId(row.instanceHex);discoveryAddress(row.address);discoveryAddress(row.owner);
    discoveryCheck(typeof row.descriptorHex==='string'&&/^[0-9a-f]{8}$/.test(row.descriptorHex),'作品目录描述必须是四字节。');discoveryCheck(row.target===null||Number.isInteger(row.target)&&row.target>=1&&row.target<=22,'作品目标无效。');
    const q=uint(row.qualityPpm),b=uint(row.B),retired=uint(row.retired);uint(row.revision);discoveryCheck(q>=500000n&&q<=2000000n&&q%1000n===0n&&b>0n&&retired<=b,'作品品质或材料基数无效。');if(row.parentInstanceHex!==null)discoveryId(row.parentInstanceHex);
    const reg=row.registration;exact(reg,['exists','ordinaryCount','directorySequence','certificateFault']);discoveryCheck(typeof reg.exists==='boolean'&&typeof reg.certificateFault==='boolean','作品登记标记无效。');const count=uint(reg.ordinaryCount);if(reg.directorySequence!==null)uint(reg.directorySequence);if(count>0n)discoveryCheck(reg.exists&&reg.directorySequence!==null,'作品登记缺少目录。');if(!reg.exists)discoveryCheck(count===0n&&reg.directorySequence===null&&!reg.certificateFault,'未登记作品不能提供登记权益。');
    return row.instanceHex;
  }
  if(request.section==='sources'){
    exact(row,[...base,'sourceIdHex','address','owner','projectIdHex','class','mint','unitCount','initialTick','spentPrefix','remainingTick','createdAt','createdSlot']);discoveryCheck(row.type==='SOURCE'&&row.owner===request.actor,'Source 不属于当前账户。');discoveryId(row.sourceIdHex);discoveryId(row.projectIdHex);discoveryAddress(row.address);discoveryAddress(row.owner);discoveryAddress(row.mint);discoveryCheck(Number.isInteger(row.class)&&row.class>=1&&row.class<=4&&uint(row.unitCount)>0n,'Source 原始摄入字段无效。');uint(row.createdAt);discoveryCheck(uint(row.createdSlot)<=uint(row.observedSlot),'Source 创建时间超出观察区间。');
    for(const n of ['initialTick','spentPrefix','remainingTick'])discoveryCheck(Array.isArray(row[n])&&row[n].length===32,'Source 必须包含32种物种预算。');
    for(let i=0;i<32;i++){const initial=uint(row.initialTick[i]),spent=uint(row.spentPrefix[i]),remaining=uint(row.remainingTick[i]);discoveryCheck(spent<=initial&&remaining===initial-spent,'Source 剩余预算与已消费前缀不一致。');}return row.sourceIdHex;
  }
  if(request.section==='positions'){
    exact(row,[...base,'positionIdHex','address','instanceHex','positionSeq','beneficiary','start','end','accrued','paid','nextUnsettledHour','rootOwner','rootLifecycle']);discoveryCheck(row.type==='POSITION'&&row.beneficiary===request.actor,'历史权益必须属于当前固定受益人。');discoveryId(row.positionIdHex);discoveryId(row.instanceHex);discoveryAddress(row.address);discoveryAddress(row.beneficiary);discoveryAddress(row.rootOwner);uint(row.positionSeq);const start=uint(row.start);if(row.end!==null)discoveryCheck(uint(row.end)>=start,'历史区间结束早于开始。');discoveryCheck(uint(row.paid)<=uint(row.accrued)&&uint(row.nextUnsettledHour)>=start,'历史已领/计债字段无效。');discoveryCheck(['LIVE','CONSUMED'].includes(row.rootLifecycle),'历史作品生命周期无效。');return row.positionIdHex;
  }
  if(request.section==='material-atas'){
    exact(row,[...base,'projectIdHex','class','mint','address','owner','amount','manufactureIncluded']);discoveryCheck(row.type==='MATERIAL_ATA'&&row.owner===request.actor&&row.manufactureIncluded===false,'原料 ATA 不能直接成为制造授权。');discoveryId(row.projectIdHex);for(const n of ['mint','address','owner'])discoveryAddress(row[n]);discoveryCheck(Number.isInteger(row.class)&&row.class>=1&&row.class<=4&&uint(row.amount)>0n,'原料 ATA 只返回实际正余额。');return row.address;
  }
  exact(row,[...base,'address','mint','owner','amount','isStandardAta','protocolMatch','manufactureIncluded']);discoveryCheck(request.section==='token-owner-hints'&&row.type==='CLASSIC_TOKEN_HINT'&&row.owner===request.actor&&row.manufactureIncluded===false&&typeof row.isStandardAta==='boolean'&&['LAB','UNRESOLVED'].includes(row.protocolMatch),'代币提示分类或权限无效。');for(const n of ['address','mint','owner'])discoveryAddress(row[n]);uint(row.amount);return row.address;
}

/** Strict JSON display contract; existence never becomes action authority. */
export function checkedDiscoveryPage(result,request,config){
  discoveryContext(config);discoveryCheck(request.actor===config.sessionActor,'发现请求与当前登录账户不一致。');
  exact(result,['profile','decision','actor','section','context','rows','nextCursor','coverage','issues','readFlags']);
  discoveryCheck(result.profile==='BIO-DISCOVERY1'&&decisions.has(result.decision)&&result.actor===request.actor&&result.section===request.section,'发现响应不属于当前查询。');
  exact(result.context,contextKeys);discoveryCheck(contextKeys.every(k=>result.context[k]===config[k]),'发现响应属于其他发布。');
  exact(result.readFlags,['transactionExecuted','networkSubmitted','reservesOnChainNonce','discoveryOnly','actionEligibilityVerified']);
  discoveryCheck(result.readFlags.transactionExecuted===false&&result.readFlags.networkSubmitted===false&&result.readFlags.reservesOnChainNonce===false&&result.readFlags.discoveryOnly===true&&result.readFlags.actionEligibilityVerified===false,'发现响应不能提供执行或行动资格。');
  discoveryCheck(result.nextCursor===null||typeof result.nextCursor==='string'&&/^[0-9a-f]{64}$/.test(result.nextCursor),'发现继续标识无效。');
  exact(result.coverage,['state','commitment','consistency','minObservedSlot','maxObservedSlot','prefixesVisited','pending','cryptographicComplete','fullWallet']);
  const c=result.coverage;discoveryCheck(coverageStates.has(c.state)&&c.commitment==='finalized'&&c.consistency==='MULTI_SLOT_BEST_EFFORT'&&typeof c.pending==='boolean'&&c.cryptographicComplete===false&&c.fullWallet===false,'发现覆盖说明不能宣称全钱包或单时点完整性。');uint(c.prefixesVisited);
  discoveryCheck((c.minObservedSlot===null)===(c.maxObservedSlot===null),'观察区间缺失。');if(c.minObservedSlot!==null)discoveryCheck(uint(c.minObservedSlot)<=uint(c.maxObservedSlot),'观察区间倒退。');
  if(c.state==='TRAVERSAL_EXHAUSTED')discoveryCheck(!c.pending&&result.nextCursor===null,'遍历结束仍含待处理标识。');
  if(!c.pending)discoveryCheck(result.nextCursor===null,'无待处理工作时不能返回继续标识。');
  if(result.decision==='DISCOVERY_PAGE'&&c.pending)discoveryCheck(result.nextCursor!==null,'待处理页缺少继续标识。');
  discoveryCheck(Array.isArray(result.issues)&&result.issues.length<=32,'发现问题列表超过边界。');for(const issue of result.issues){exact(issue,['code']);discoveryCheck(typeof issue.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(issue.code),'发现问题代码无效。');}
  discoveryCheck(Array.isArray(result.rows)&&result.rows.length<=8,'发现页最多包含八个已验证记录。');const seen=new Set();
  for(const row of result.rows){discoveryCheck(object(row)&&row.recordVerified===true&&c.minObservedSlot!==null,'发现记录没有实际核验。');discoveryCheck(uint(row.observedSlot)>=uint(c.minObservedSlot)&&uint(row.observedSlot)<=uint(c.maxObservedSlot),'记录不在当前观察区间。');
    const id=['projects','my-projects'].includes(request.section)?projectRow(row,request):walletRow(row,request);discoveryCheck(!seen.has(id),'发现页包含重复记录。');seen.add(id);
  }
  return discoveryFreeze({query:discoveryCopy(request),result:discoveryCopy(result)});
}

export function discoveryCoverageText(c){
  const states={IN_PROGRESS:'仍有分区或候选待核验',TRAVERSAL_EXHAUSTED:'本次遍历已结束',OVERFLOW:'响应超出范围，覆盖不足',UNAVAILABLE:'当前无法取得覆盖',CHANGED:'记录变化，需要重扫'};
  return `${states[c.state]} · finalized ${c.minObservedSlot??'未知'}–${c.maxObservedSlot??'未知'} · 多时点观察，不能证明全钱包完整；转移或新记录可能需重新扫描。`;
}
