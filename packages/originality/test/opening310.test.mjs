import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalityCoordinator,encodeBlueprint} from '../src/index.mjs';
import {SettlementEngine} from '../../settlement/src/index.mjs';
import {cloneProtocolState} from '../../protocol-core/src/atomic.mjs';
import {BASE,B0,CRANK,context,upload} from './fixtures.mjs';

// Pure JS reference protocol. These are no signed native account/ELF proofs.
test('explicit OPEN310 old16-only seal rejects atomically; an independent prewarm17 fork seals public310 without any K reward',()=>{
  const coordinator=createOriginalityCoordinator({...BASE,openingProfile:'OPEN310',frontier:310}),legacy=createOriginalityCoordinator(BASE);assert.equal(coordinator.initialGraphs().length,16);assert.equal(coordinator.publishedGraphs().length,17);assert.deepEqual(coordinator.initialSetId(),legacy.initialSetId());
  let state=coordinator.initialize({compositionArtifacts:new Map(),compositionRoots:new Map(),settlement:new SettlementEngine({rewardStart:B0}).snapshot()});
  for(const [n,graph]of coordinator.initialGraphs().entries()){const made=upload(state,encodeBlueprint({graph}));state=coordinator.registerSeed(made.state,context(20n+BigInt(n),CRANK,{artifactId:made.id})).state;}
  const only16=coordinator.sealOpeningStep(state,context(B0,CRANK,{expectedCursor:0n,maxScan:8})).state,before=cloneProtocolState(only16);assert.throws(()=>coordinator.sealOpeningStep(only16,context(B0,CRANK,{expectedCursor:8n,maxScan:8})),e=>e.code==='OPENING_FRONTIER');assert.deepEqual(only16,before);
  // Fork from the original pre-cutoff state: never rewind a single chain after
  // failing seal at the deadline to add an already-too-late public seed.
  const extra=upload(state,encodeBlueprint({graph:coordinator.publishedGraphs()[16]}));let full=coordinator.registerSeed(extra.state,context(100n,CRANK,{artifactId:extra.id})).state;
  for(const cursor of [0n,8n,16n])full=coordinator.sealOpeningStep(full,context(B0,CRANK,{expectedCursor:cursor,maxScan:8})).state;
  assert.equal(full.originality.opening.initialBitmap,0xffff);assert.equal(full.originality.opening.snapshot.seedCount,17n);assert.equal(full.originality.opening.snapshot.best.C,310n);assert.equal(full.originality.knowledge[16].C,310n);assert.equal(full.originality.knowledge[16].evidenceKind,0);assert.equal(full.originality.opening.sealed,true);assert.equal(SettlementEngine.fromSnapshot(full.settlement).snapshot().registry.roots.length,0);
  assert.throws(()=>createOriginalityCoordinator({...BASE,openingProfile:'OPEN310',frontier:316}),e=>e.code==='OPENING_POLICY');assert.throws(()=>createOriginalityCoordinator({...BASE,openingProfile:'arbitrary'}),e=>e.code==='OPENING_POLICY');assert.equal(legacy.openingPolicy().frontier,316n);
});
