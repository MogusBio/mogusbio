import test from 'node:test';import assert from 'node:assert/strict';
import { planPrivateDesignCommit,localCompetitionWindow } from '../src/competition.mjs';
import { clientFixture,hash,key } from './native-fixture.mjs';
import { baseConfigR2Id } from '../src/release.mjs';
import { createFurtherImprovement } from '../../biology/src/seeds.mjs';
import { commitmentHash } from '../../originality/src/wire.mjs';
import { nativeKeyBytes,nativeNonceOpId,decodeNativeFrame } from '../src/native.mjs';
test('private-first commit exact116 payload hides design/salt/future nonce and binds actual author manufacturing nonce',async()=>{
  const {release,abi,actor}=await clientFixture(),graph=createFurtherImprovement({domain:release.domain,config:baseConfigR2Id(release),catalog:release.hashes.catalogHash,rule:release.hashes.ruleHash,stage:2});
  const args={release,abi,author:actor,commitNonce:20n,futureManufactureNonce:160n,round:7n,graph,salt:hash('local secret salt'),maxRent:100000000n};
  const a=await planPrivateDesignCommit(args);assert.equal(a.payload.length,116);assert.equal(decodeNativeFrame(abi,a.frame).operation,'COMMIT');
  assert.equal(a.payload.readBigUInt64LE(36),7n);assert.deepEqual(a.payload.subarray(76,108),nativeKeyBytes(actor));assert.equal(a.payload.readBigUInt64LE(108),100000000n);
  assert.deepEqual(a.commitment,commitmentHash({domain:release.domain,round:7n,author:nativeKeyBytes(actor),design:a.design,manufactureOpId:nativeNonceOpId(160n),salt:args.salt}));
  assert.equal(a.payload.includes(args.salt),false);assert.equal(a.payload.includes(a.design),false);assert.equal('salt'in a,false);
  assert.equal(a.knownOpeningDesign,true);assert.equal(a.eligibilityVerified,false);assert.equal(a.nonceReserved,false);
  for(const change of [{futureManufactureNonce:161n},{author:key(20)},{salt:hash('another salt')}])assert.notDeepEqual((await planPrivateDesignCommit({...args,...change})).commitment,a.commitment);
  await assert.rejects(planPrivateDesignCommit({...args,futureManufactureNonce:20n}),/FUTURE_NONCE/);
  const ordinaryGraph={...graph,target:1};await assert.rejects(planPrivateDesignCommit({...args,graph:ordinaryGraph}));
});
test('local competition schedule exposes exact three windows without pretending to read chain clock',async()=>{
  const {release}=await clientFixture(),t=release.rewardStart;
  assert.equal(localCompetitionWindow(release,t-1n).phase,'PREWARM');
  for(const [dt,phase,round]of [[0n,'COMMIT',0n],[86399n,'COMMIT',0n],[86400n,'MANUFACTURE',0n],[172800n,'FINALIZE',0n],[259200n,'COMMIT',1n]]){
    const w=localCompetitionWindow(release,t+dt);assert.equal(w.phase,phase);assert.equal(w.round,round);assert.equal(w.chainClockVerified,false);
  }
});
