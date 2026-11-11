import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEASON_CAPS, LIFETIME_CAPS, CREATE_FEE, RESOURCE_FEE_PER_UNIT } from '../packages/launchpad/src/index.mjs';
import { TOTAL_SUPPLY, HOURS_PER_EPOCH, NONZERO_EPOCHS, H_END, GENESIS_SEALED, W_FLOOR, K_WEIGHT, L_QUARTERS } from '../packages/settlement/src/index.mjs';
import { synthesisFee } from '../packages/composition/src/coordinator.mjs';
import { members } from '../packages/biology/src/graph.mjs';
import { productionOpening, publishedOpening } from '../packages/client/src/release.mjs';

test('publishable task policy uses actual frozen quantities and per-target manufacturing fees, not an average organ price',()=>{
  const p=JSON.parse(readFileSync(new URL('../releases/production/policies/task.json',import.meta.url),'utf8'));
  assert.equal(p.profile,'BIO-TASK-FUNC2R2-ECON4-1');assert.equal(p.settlement.profile,'ECON4-R1');
  assert.deepEqual(p.globalSeasonIssueCaps.map(BigInt),SEASON_CAPS);assert.deepEqual(SEASON_CAPS.map(n=>n*BigInt(p.seasonCount)),LIFETIME_CAPS);
  for(const [name,value] of Object.entries({projectCreationLamports:CREATE_FEE,perUnitResourceFeeLamports:RESOURCE_FEE_PER_UNIT,
    labSupplyAtoms:TOTAL_SUPPLY,hoursPerHalvingEpoch:HOURS_PER_EPOCH,nonzeroEpochs:NONZERO_EPOCHS,rewardEndHour:H_END,
    genesisSealedAtoms:GENESIS_SEALED,minimumDenominator:W_FLOOR,uniqueChampionWeight:K_WEIGHT}))assert.equal(BigInt(p[name]),value,name);
  assert.deepEqual(p.scopeLQuarters.map(BigInt),Object.values(L_QUARTERS));
  assert.deepEqual(Object.fromEntries(Object.entries(p.manufacturingFeeAtoms.layerRateAtoms).map(([k,v])=>[k,BigInt(v)])),
    {CELL:synthesisFee(120000n,1),ORGAN:synthesisFee(120000n,16),BIO:synthesisFee(120000n,22)});
  const fee=t=>synthesisFee(BigInt(members(t).length)*480000n,t),organs=Array.from({length:6},(_,i)=>fee(i+16));
  assert.deepEqual(p.manufacturingFeeAtoms.fixedReferenceByTarget16Through21.map(BigInt),organs);
  const cells=Array.from({length:15},(_,i)=>fee(i+1)).reduce((a,b)=>a+b,0n),organTotal=organs.reduce((a,b)=>a+b,0n),final=fee(22);
  assert.equal(BigInt(p.manufacturingFeeAtoms.fixedReferenceAllCells),cells);
  assert.equal(BigInt(p.manufacturingFeeAtoms.fixedReferenceAllOrgans),organTotal);
  assert.equal(BigInt(p.manufacturingFeeAtoms.fixedReferenceBio),final);
  assert.equal(BigInt(p.manufacturingFeeAtoms.fixedReferenceTotal),cells+organTotal+final);
  const opening=productionOpening(Buffer.alloc(32,7));
  assert.equal(p.openingSeedCount,opening.rows.length);
  assert.deepEqual([...p.openingSeedCosts].map(BigInt).sort((a,b)=>a<b?-1:a>b?1:0),opening.rows.map(s=>s.C).sort((a,b)=>a<b?-1:a>b?1:0));
  const published=publishedOpening(Buffer.alloc(32,7));
  assert.equal(p.openingPolicy,'OPEN310');assert.equal(p.openingPublishedKnownCount,published.rows.length);
  assert.equal(BigInt(p.openingFrontier),published.rows.reduce((a,b)=>a<b.C?a:b.C,published.rows[0].C));
  const extra=published.rows.find(row=>row.design.toString('hex')===p.openingAdditionalPublicK0.designIdHex);
  assert.ok(extra);assert.equal(BigInt(p.openingAdditionalPublicK0.cost),extra.C);
});
