// Presentation for the existing fixed-C310 HOST batch adapter. These labels
// cannot authorize materials, fees, design validity or manufacture operations.
export const SAMPLE_ACTION_LABELS=Object.freeze({
  'buy-kit':'按C310样本用量购买原料',
  'manufacture-kit':'按样本批量制造60个部件',
  'synthesize-cells':'按样本批量合成15个细胞',
  'synthesize-organs':'按样本批量合成6个器官',
  'synthesize-bio':'按样本合成1个生物',
});
const stages=['RAW','PARTS','CELLS','ORGANS','BIO'];
const rows=[
  ['buy-kit','样本备料','C310参考用量：120份'],
  ['manufacture-kit','批量制造样本部件','固定类型与用途 → 60个部件'],
  ['synthesize-cells','批量合成样本细胞','60个部件 → 15个细胞'],
  ['synthesize-organs','批量合成样本器官','15个细胞 → 6个器官'],
  ['synthesize-bio','合成样本生物','6个器官 → 1个C310生物'],
];
export function sampleConstructionSteps(kit){
  const reached=stages.indexOf(kit?.stage);
  return rows.map(([action,label,note],index)=>{const status=index<reached?'past':index===reached?'current':'future';return{action,label,note,status,statusLabel:status==='past'?'前序阶段':status==='current'?'当前阶段':'尚未到达'};});
}
