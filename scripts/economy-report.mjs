import { hourBudget, HOURS_PER_EPOCH, TOTAL_SUPPLY, ALLOCATED_SUPPLY, H_END, GENESIS_SEALED,
  epochBudget, normalWeight, K_WEIGHT, W_FLOOR, denominator, rewardAmount } from '../packages/settlement/src/index.mjs';
import { SEASON_CAPS, LIFETIME_CAPS, RESOURCE_FEE_PER_UNIT, CREATE_FEE } from '../packages/launchpad/src/index.mjs';
import { synthesisFee } from '../packages/composition/src/index.mjs';
import { MATERIAL_CLASSES,F1_BOM,F1_EFFECTIVE_SPECIES,speciesCreditInt } from '../packages/protocol-core/src/materials.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const rawPerBio = [30n, 60n, 15n, 15n];
const minimum = values => values.reduce((a,b)=>a<b?a:b);
const atoms = n => `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6,'0')}`;
const ordinary = normalWeight({scope:'BIO',B_int:7_200_000n,q_ppm:2_000_000n});
const component = normalWeight({scope:'COMPONENT',B_int:120_000n,q_ppm:1_000_000n});
const cell = normalWeight({scope:'CELL',B_int:480_000n,q_ppm:2_000_000n});
const oneDay = (firstHour, weights) => {
  const total = weights.reduce((s,w)=>s+w,0n), D = denominator(total);
  const earned = weights.map(()=>0n); let budget=0n;
  for(let h=firstHour;h<firstHour+24n;h++){
    const B=hourBudget(h);budget+=B;
    weights.forEach((w,i)=>earned[i]+=rewardAmount(B,w,D));
  }
  const paid=earned.reduce((s,n)=>s+n,0n);
  return {budgetAtoms:budget.toString(),budgetLAB:atoms(budget),distributedAtoms:paid.toString(),
    distributedLAB:atoms(paid),sealedResidualAtoms:(budget-paid).toString(),
    denominator:D.toString(),firstRootLAB:atoms(earned[0]??0n)};
};
const seasonal=minimum(SEASON_CAPS.map((n,i)=>n/rawPerBio[i]));
const initialTick=MATERIAL_CLASSES.flatMap((c,i)=>c.species.map(s=>({species:s,ticks:rawPerBio[i]*1000n}))),
  initialCredits=initialTick.reduce((n,x)=>n+speciesCreditInt(x.species,x.ticks),0n),
  spentCredits=F1_BOM.reduce((n,t,i)=>n+speciesCreditInt(i+1,t*60n),0n),
  effectiveCredits=F1_BOM.reduce((n,t,i)=>n+(F1_EFFECTIVE_SPECIES.includes(i+1)?speciesCreditInt(i+1,t*60n):0n),0n),
  initialSpeciesTicks=initialTick.reduce((n,x)=>n+x.ticks,0n),spentSpeciesTicks=F1_BOM.reduce((n,t)=>n+t*60n,0n);
const report={schema:2,monetaryPromise:false,totalAtoms:TOTAL_SUPPLY.toString(),totalLAB:atoms(TOTAL_SUPPLY),
  decimals:6,allocatedAtoms:ALLOCATED_SUPPLY.toString(),genesisSealedAtoms:GENESIS_SEALED.toString(),
  halvingHours:HOURS_PER_EPOCH.toString(),rewardEndHour:H_END.toString(),
  firstEpochBudgetLAB:atoms(epochBudget(0n)),rawStandardUnitsPerBio:rawPerBio.map(String),
  materialLedger:{standardUnits:rawPerBio.reduce((a,b)=>a+b).toString(),
    initialSpeciesTicks:initialSpeciesTicks.toString(),spentSpeciesTicks:spentSpeciesTicks.toString(),remainingSpeciesTicks:(initialSpeciesTicks-spentSpeciesTicks).toString(),
    initialCreditInt:initialCredits.toString(),spentCreditInt:spentCredits.toString(),remainingCreditInt:(initialCredits-spentCredits).toString(),
    effectiveCreditInt:effectiveCredits.toString(),retiredCreditInt:(spentCredits-effectiveCredits).toString(),
    tickScale:'1000 ticks per species unit',creditScale:'1000 creditInt per RU',
    warning:'1140 species units are not1140 RU. Standard material tokens, species ticks, weighted RU and LAB are distinct units.'},
  seasonCaps:SEASON_CAPS.map(String),lifetimeCaps:LIFETIME_CAPS.map(String),
  maximumBioPerSeason:seasonal.toString(),
  maximumBioFromLifetimeIssue:minimum(LIFETIME_CAPS.map((n,i)=>n/rawPerBio[i])).toString(),
  resourceFeePerBioLamports:(rawPerBio.reduce((s,n)=>s+n)*RESOURCE_FEE_PER_UNIT).toString(),
  labCreationFeeLamports:CREATE_FEE.toString(),
  manufacturingBurnLAB:atoms(15n*synthesisFee(480_000n,1)+[2n,3n,4n,2n,2n,2n].reduce((s,n,i)=>s+synthesisFee(n*480_000n,16+i),0n)+synthesisFee(7_200_000n,22)),
  floorWeight:W_FLOOR.toString(),ordinaryBioWeight:ordinary.toString(),uniqueKWeight:K_WEIGHT.toString(),
  ordinaryBiosToReachFloor:((W_FLOOR+ordinary-1n)/ordinary).toString(),
  dailyScenarios:{
    noParticipants:oneDay(0n,[]),oneComponent:oneDay(0n,[component]),oneQ2Cell:oneDay(0n,[cell]),
    sixtySeparateComponents:oneDay(0n,Array(60).fill(component)),oneQ2Bio:oneDay(0n,[ordinary]),
    oneValidChampionBio:oneDay(0n,[ordinary+K_WEIGHT]),
    firstSeasonAllRawMadeIntoBio:oneDay(0n,Array(Number(seasonal)).fill(ordinary)),
    secondSeasonSameCapacity:oneDay(0n,Array(Number(seasonal*2n)).fill(ordinary)),
    tenThousandBios:oneDay(0n,Array(10_000).fill(ordinary)),
    afterFirstHalvingOneBio:oneDay(HOURS_PER_EPOCH,[ordinary]),
  },notes:[
    'Individual asset rewards floor once per hour; same-root ordinary and unique K combine before that floor.',
    'A score improvement alone never creates material, extra ordinary assets or a second K.',
    'These are fixed-roster accounting scenarios, not guaranteed income, price assumptions or participation forecasts.',
    'After complete hourly allocation, unassigned residual and floor dust stay sealed; unfinished lazy snapshots retain their unallocated Pending budget. Neither creates a new wallet or later-hour entitlement.',
    'Issued material consumed into Source inventory cannot be reminted, unpacked or recovered from a finished asset.',
    'This arithmetic report does not price transaction fees, rent, SOL, LAB or third-party sale revenue.'
  ]};
if(process.argv.includes('--write')){mkdirSync(new URL('../evidence/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../evidence/economy-model.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
