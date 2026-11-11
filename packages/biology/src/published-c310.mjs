import {createFurtherImprovement} from './seeds.mjs';
import {validateGraph} from './graph.mjs';

/** A public layout discovery under unchanged FUNC2R2 rules. H7 excludes
 * deployment domain/config; raw graph SHA below identifies the original
 * published current76b-context bytes, not every rebound deployment encoding. */
export const PUBLISHED_C310=Object.freeze({
  cost:310,qualityPpm:2000000,rounds:73,
  discoveredGraphSHA256:'ec4d6372bcc33d431c3fc5efeee6b43a7592f2e78a5b3b4a1023f7357f86d365',
  designIdHex:'ecc3333da75e14f985eada298ed4b8489c2d4a93bd5f9bfb3d63d62ce3fa75c2',
  positions:Object.freeze([6,8,4,11,3,12,2,5,10,9,7,1,13,0,14]),
  published:true,unpublishedOriginalityRewardPromised:false,globalOptimalityProved:false,
});
export function createPublishedC310Graph(identities={}){
  if(!identities||Object.getPrototypeOf(identities)!==Object.prototype||Object.keys(identities).some(k=>!['domain','config','catalog','rule'].includes(k)))throw new Error('PUBLISHED_C310_IDENTITIES');
  const graph=createFurtherImprovement({...identities,stage:2});graph.slots=PUBLISHED_C310.positions.map((value,i)=>({role:i+1,x:value%5,y:Math.floor(value/5)}));return validateGraph(graph);
}
