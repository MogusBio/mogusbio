import test from 'node:test';
import assert from 'node:assert/strict';
import { planComponentMaterials } from '../src/index.mjs';
import { createReferenceGraph, validateDesign } from '../../biology/src/index.mjs';
import { encodeBlueprint, decodeBlueprint, encodeAdmission321 } from '../../originality/src/index.mjs';
import { catalogHash, encodeMaterialPlan, decodeMaterialPlan, sourceId, F1_BOM, materialClass } from '../../protocol-core/src/index.mjs';

test('client refuses material snapshots lacking the actual player balance', () => {
  const state = { sources: new Map(), tokens: new Map(), projects: new Map() };
  assert.throws(() => planComponentMaterials(state, { domain: Buffer.alloc(32), business: Buffer.alloc(32),
    owner: Buffer.alloc(32) }), { code: 'MATERIAL_PLAN_BALANCE' });
});

test('materials from different laboratories sort intakes before deriving source ordinals',()=>{
  const b=n=>Buffer.alloc(32,n),owner=b(0x90),domain=b(0x91),business=b(0x92);
  const state={sources:new Map(),projects:new Map(),tokens:new Map()};
  // Class order deliberately opposes project order, which previously made
  // a mixed-project plan fail the native canonical intake table.
  for(let c=1;c<=4;c++){
    const projectId=b(8-c),mint=b(20+c),tokenId=b(30+c);
    state.projects.set(projectId.toString('hex'),{catalogHash:catalogHash(),classes:Array.from({length:4},(_,i)=>({mint:i+1===c?mint:b(60+c*4+i)}))});
    state.tokens.set(tokenId.toString('hex'),{owner,mint,amount:10n,initialized:true,native:false,frozen:false});
  }
  const plan=planComponentMaterials(state,{domain,business,owner});assert.equal(plan.intakes.length,4);
  assert.deepEqual(plan.intakes.map(i=>i.class),[4,3,2,1]);
  for(const [ordinal,intake]of plan.intakes.entries()){
    const id=sourceId(domain,business,ordinal),group=plan.debits.find(d=>d.sourceId.equals(id));assert.ok(group);
    assert.ok(group.entries.every(e=>materialClass(intake.class).species.includes(e.species)&&e.takeTick===F1_BOM[e.species-1]));
  }
  const decoded=decodeMaterialPlan(encodeMaterialPlan(plan));assert.deepEqual(decoded,plan);
});

test('blueprint and H16 codecs retain the complete frozen challenge lattice', () => {
  const graph = createReferenceGraph({ target: 4 });
  for (const challenge of [500_000, 1_002_000, 2_000_000]) {
    const decoded = decodeBlueprint(encodeBlueprint({ graph, challenge }));
    assert.equal(decoded.challenge, challenge);
    const actual = validateDesign(decoded.graph, { challenge });
    const encoded = encodeAdmission321({ domain: graph.domain, config: graph.config, rule: graph.rule,
      graphSHA: actual.graphSHA, leafMapSHA: decoded.descriptorMapSHA, evidenceRef: Buffer.alloc(32),
      evidenceKind: 0, target: 4, c_ppm: challenge, q_ppm: actual.q_ppm, taskApplicable: false,
      C: 0n, suite: 2, fixture: 1, load: 1, dutMask: 8,
      transcriptSHA: actual.transcriptSHA, positiveBitmap: actual.positiveBitmap });
    assert.equal(encoded.length, 321);
  }
  for (const challenge of [499_000, 2_001_000, 1_000_001, 1.5, NaN])
    assert.throws(() => encodeBlueprint({ graph, challenge }));
  const integerHole = decodeBlueprint(encodeBlueprint({ graph, challenge: 1_001_000 }));
  assert.throws(() => validateDesign(integerHole.graph, { challenge: integerHole.challenge }), /non-integral/);
});
