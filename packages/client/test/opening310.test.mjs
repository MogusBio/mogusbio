import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ByteWriter,typedHash} from '../../protocol-core/src/index.mjs';
import {createPublishedC310Graph,PUBLISHED_C310} from '../../biology/src/published-c310.mjs';
import {encodeGraph,designId,runSuite,projectGraph,createFurtherImprovement} from '../../biology/src/index.mjs';
import {validateProductionRelease,productionOpening,publishedOpening,openingPolicy,baseConfigR2Id,encodeBaseConfigR2,decodeBaseConfigR2,productionRustConstants} from '../src/release.mjs';
import {decodeNativeOpeningSnapshot} from '../src/originality-accounts.mjs';
import {planPrivateDesignCommit} from '../src/competition.mjs';
import {currentReleaseBinding} from '../src/binding.mjs';
import {recordAccount} from './account-fixture.mjs';
import {clientFixture} from './native-fixture.mjs';
import {release as legacyRelease,FAMILY} from './synthesis-fixture.mjs';

const graphFor=r=>createPublishedC310Graph({domain:r.domain,config:baseConfigR2Id(r),catalog:r.hashes.catalogHash,rule:r.hashes.ruleHash});
async function local310(){const {release,abi,actor}=await clientFixture(),input={...release.input,frontier:310};return {abi,actor,release:await validateProductionRelease(input,{localPublicFixture:true})};}
test('source-bound public C310 exactly reproduces published SHA/H7 and all22 unchanged-model scopes',async()=>{
  const graph=graphFor(legacyRelease);assert.equal(createHash('sha256').update(encodeGraph(graph)).digest('hex'),PUBLISHED_C310.discoveredGraphSHA256);assert.equal(designId(graph).toString('hex'),PUBLISHED_C310.designIdHex);
  for(let target=1;target<=22;target++){const result=runSuite(projectGraph(graph,target));assert.equal(result.quality,[3,9,14,15,21].includes(target)?1000000:2000000);assert.equal(result.rounds,73);if(target===22)assert.equal(result.cost,310);}
  const before=createFurtherImprovement({domain:graph.domain,config:graph.config,catalog:graph.catalog,rule:graph.rule,stage:2});for(let target=16;target<=21;target++)assert.deepEqual(encodeGraph(projectGraph(graph,target)),encodeGraph(projectGraph(before,target)));
  assert.equal(PUBLISHED_C310.unpublishedOriginalityRewardPromised,false);assert.equal(PUBLISHED_C310.globalOptimalityProved,false);assert.throws(()=>createPublishedC310Graph({target:1}),/IDENTITIES/);
  const binding=await currentReleaseBinding();assert.ok(binding.manifest.sources.some(r=>r.path==='packages/biology/src/published-c310.mjs'));
});
test('OPEN310 retains required16 H15/bitmap identity while exposing17 public known designs and preserving old local316 body',async()=>{
  const {release,abi,actor}=await local310(),required=productionOpening(release.domain),known=publishedOpening(release.domain),oldBody=encodeBaseConfigR2(legacyRelease);assert.equal(known.rows.length,17);assert.equal(known.requiredRows.length,16);assert.deepEqual(known.requiredSetId,required.id);assert.equal(known.rows.filter(r=>r.C===310n).length,1);assert.equal(release.openingProfile,'OPEN310');assert.equal(designId(graphFor(release)).toString('hex'),PUBLISHED_C310.designIdHex);assert.notEqual(createHash('sha256').update(encodeGraph(graphFor(release))).digest('hex'),PUBLISHED_C310.discoveredGraphSHA256);
  assert.equal(decodeBaseConfigR2(encodeBaseConfigR2(release),{localPublicFixture:true}).frontier,310n);assert.equal(decodeBaseConfigR2(oldBody,{localPublicFixture:true}).frontier,316n);assert.equal(oldBody.readBigUInt64LE(740),316n);assert.match(productionRustConstants(release),/OPENING_FRONTIER: u64 = 310/);assert.match(productionRustConstants(legacyRelease),/OPENING_FRONTIER: u64 = 316/);
  assert.throws(()=>openingPolicy({seedCount:16,frontier:316}),/POLICY/);assert.throws(()=>openingPolicy({seedCount:17,frontier:310},{localPublicFixture:true}),/POLICY/);assert.equal(publishedOpening(release.domain,{frontier:316}).rows.length,16);
  const plan=await planPrivateDesignCommit({release,abi,author:actor,commitNonce:0n,futureManufactureNonce:100n,round:0n,graph:graphFor(release),salt:Buffer.alloc(32,1),maxRent:1000000000n});assert.equal(plan.knownOpeningDesign,true);assert.equal(plan.eligibilityVerified,false);
});
test('HOST OPEN310 snapshot requires17 K0 and frontier310; old genuine316 snapshot stays explicitly legacy-readable',async()=>{
  const {release}=await local310(),body=Buffer.alloc(176);FAMILY.copy(body);release.hashes.initialSeedSetId.copy(body,32);body.writeBigInt64LE(release.rewardStart,64);body.writeBigUInt64LE(17n,72);Buffer.alloc(32,3).copy(body,80);body.writeBigUInt64LE(310n,112);Buffer.from(PUBLISHED_C310.designIdHex,'hex').copy(body,120);body.writeBigUInt64LE(35n,152);body.writeBigUInt64LE(1n,160);body.writeBigInt64LE(release.rewardStart,168);
  const record=async b=>recordAccount(release,{kind:5,seeds:['bio','seed-final',FAMILY],id:typedHash(15,Buffer.concat([Buffer.from([3]),release.domain,b])),body:b});assert.equal((await decodeNativeOpeningSnapshot(release,await record(body))).best.cost,310n);
  for(const [count,cost]of [[16n,310n],[17n,316n],[16n,316n]]){const changed=Buffer.from(body);changed.writeBigUInt64LE(count,72);changed.writeBigUInt64LE(cost,112);await assert.rejects(decodeNativeOpeningSnapshot(release,await record(changed)),/SNAPSHOT_FACTS/);}
  const schema=JSON.parse(await readFile(new URL('../../../releases/production/production-input.schema.json',import.meta.url),'utf8'));assert.equal(schema.properties.seedCount.const,16);assert.equal(schema.properties.frontier.const,310);const task=JSON.parse(await readFile(new URL('../../../releases/production/policies/task.json',import.meta.url),'utf8'));assert.equal(task.openingPublishedKnownCount,17);assert.equal(task.openingAdditionalPublicK0.designIdHex,PUBLISHED_C310.designIdHex);
});
