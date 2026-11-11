import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { deploymentDomain, catalogHash } from '../../protocol-core/src/index.mjs';
import { validateProductionRelease, productionOpening, encodeBaseConfigR2, decodeBaseConfigR2,
  baseConfigR2Id, productionRustConstants, PROGRAMS, verifyProductionLoader, currentNativeAbiHash } from '../src/release.mjs';
import { currentReleaseBinding } from '../src/binding.mjs';
const hash = label => createHash('sha256').update(label).digest('hex');
// Deterministic local codec fixtures only. These keys are never funded/deployed.
function key(n, local=false) {
  const seed = createHash('sha256').update(local ? `BIOP0R2 native SIGNING FIXTURE ONLY ${n}` : `BIOP0R2 codec fixture ${n}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), type: 'pkcs8', format: 'der' });
  return getAddressDecoder().decode(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32));
}
async function fixture(local=false) {
  const model = JSON.parse(readFileSync(new URL('../../../releases/func2r2/manifest.json', import.meta.url), 'utf8'));
  const m = { profile: 'BIOP0R2', wireVersion: 2, programId: key(0,local), bootstrap: key(1,local),
    opsMembers: [2, 3, 4, 5, 6].map(n=>key(n,local)).sort((a, b) => Buffer.compare(getAddressEncoder().encode(a), getAddressEncoder().encode(b))),
    genesisHash: hash(local?'local native genesis':'fixture genesis'), deploymentNonce: hash(local?'local native nonce':'fixture deploy'), releaseHash: hash('fixture release'), abiHash: currentNativeAbiHash(),
    ruleHash: model.ruleHash, validatorHash: model.validatorHash, catalogHash: catalogHash().toString('hex'),
    taskManifestHash: hash('fixture task'), taskFaultPolicyHash: hash('fixture safety'), admissionPolicyHash: hash('fixture admission'), networkProfileHash: hash('fixture network'),
    initialSeedSetId: '', seedCount: 16, frontier: local?316:310, initNotBefore: '3600', seedOpen: '7200', rewardStart: '93600', prewarmSeconds: 86400,
    maxClockSkewSeconds: 0, loaderProgram: PROGRAMS.loaderProgram, programDataAddress: '', upgradeAuthority: null };
  [m.programDataAddress] = await getProgramDerivedAddress({ programAddress: address(PROGRAMS.loaderProgram), seeds: [getAddressEncoder().encode(m.programId)] });
  const d = deploymentDomain(Buffer.from(m.genesisHash, 'hex'), getAddressEncoder().encode(m.programId), Buffer.from(m.deploymentNonce, 'hex'));
  m.initialSeedSetId = productionOpening(d).id.toString('hex');
  if(!local){const b=await currentReleaseBinding();Object.assign(m,{releaseHash:b.releaseHash,...b.policyHashes});}
  return m;
}
test('formal OPEN310 exact928 body retains required16 commitment and binds frontier310', async () => {
  const m = await fixture(), r = await validateProductionRelease(m), b = encodeBaseConfigR2(r), decoded = decodeBaseConfigR2(b);
  assert.equal(b.length, 928); assert.equal(decoded.programId, m.programId); assert.equal(decoded.initialSeedSetId, m.initialSeedSetId);
  assert.equal(decoded.frontier, 310n); assert.equal(r.openingProfile,'OPEN310');assert.equal(b.readUInt32LE(736), 16); assert.equal(b.readBigUInt64LE(740), 310n);
  assert.equal(b.readBigInt64LE(748), 7200n); assert.equal(b.readBigInt64LE(756), 93600n); assert.equal(b[924], 3); assert.equal(b[925], 1);
  assert.equal(baseConfigR2Id(r).length, 32); assert.equal(r.productionAdmission, false);
  assert.match(productionRustConstants(r), /pub const BASE_CONFIG_BODY: \[u8; 928\]/);
  assert.match(productionRustConstants(r), /REWARD_START: i64 = 93600/);
  assert.match(productionRustConstants(r), /OPENING_FRONTIER: u64 = 310/);
  assert.throws(() => decodeBaseConfigR2(Buffer.concat([b, Buffer.from([0])])), /SIZE/);
  const bad = Buffer.from(b); bad[927] = 1; assert.throws(() => decodeBaseConfigR2(bad), /reserved/);
});
test('release rejects markers, missing/unknown fields, alternate Ops order, model or opening drift and nonexact time', async () => {
  const m = await fixture();
  for (const mutate of [
    v => { delete v.abiHash; }, v => { v.optional = true; }, v => { v.genesisHash = '5a'.repeat(32); },
    v => { v.bootstrap = getAddressDecoder().decode(Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex')); },
    v => { v.opsMembers.reverse(); }, v => { v.opsMembers[1] = v.opsMembers[0]; },
    v => { v.ruleHash = hash('unreviewed'); }, v => { v.abiHash = hash('unreviewed ABI'); }, v => { v.initialSeedSetId = hash('unreviewed'); },
    v => { v.releaseHash = hash('invented release'); }, v => { v.taskFaultPolicyHash = hash('invented policy'); },
    v => { v.seedCount = 14; }, v => { v.frontier = 320; }, v => { v.prewarmSeconds = 604800; },
    v => { v.rewardStart = '93601'; }, v => { v.seedOpen = '7201'; }, v => { v.initNotBefore = 3600; },
    v => { v.initNotBefore = '07200'; }, v => { v.initNotBefore = '9223372036854775808'; },
    v => { v.programDataAddress = key(7); }, v => { v.upgradeAuthority = key(7); },
  ]) { const bad = structuredClone(m); mutate(bad); await assert.rejects(validateProductionRelease(bad)); }
});
test('Loader-v3 metadata requires actual Program association, immutable authority, prior slot and frozen init window', async () => {
  const r = await validateProductionRelease(await fixture()), p = Buffer.alloc(36), d = Buffer.alloc(49);
  p.writeUInt32LE(2); Buffer.from(getAddressEncoder().encode(r.programDataAddress)).copy(p, 4);
  d.writeUInt32LE(3); d.writeBigUInt64LE(9n, 4); d[12] = 0; d[45] = 0x7f;
  const accounts = { programAccount: { address: r.input.programId, owner: PROGRAMS.loaderProgram, executable: true, data: p },
    programDataAccount: { address: r.programDataAddress, owner: PROGRAMS.loaderProgram, executable: false, data: d },
    currentSlot: 10n, unixTimestamp: 3600n };
  assert.equal(verifyProductionLoader(r, accounts).immutable, true);
  for (const mutate of [a => { a.programAccount.owner = PROGRAMS.systemProgram; }, a => { a.programAccount.data[4] ^= 1; },
    a => { a.programDataAccount.data[12] = 1; }, a => { a.currentSlot = 9n; }, a => { a.unixTimestamp = 3599n; },
    a => { a.unixTimestamp = 7201n; }]) {
    const bad = { ...accounts, programAccount: { ...accounts.programAccount, data: Buffer.from(p) },
      programDataAccount: { ...accounts.programDataAccount, data: Buffer.from(d) } }; mutate(bad);
    assert.throws(() => verifyProductionLoader(r, bad));
  }
});

test('public local signing identities require explicit fixture admission and remain mode0', async () => {
  const m=await fixture(true);
  await assert.rejects(validateProductionRelease(m),/OPENING_POLICY|PUBLIC_FIXTURE_IDENTITY/);
  const r=await validateProductionRelease(m,{localPublicFixture:true});
  assert.equal(r.localPublicFixture,true);assert.equal(encodeBaseConfigR2(r)[925],0);
  assert.equal(r.openingProfile,'CURRENT16-316');assert.match(productionRustConstants(r),/OPENING_FRONTIER: u64 = 316/);
  assert.match(productionRustConstants(r),/IS_LOCAL_PUBLIC_FIXTURE: bool = true/);
  assert.throws(()=>decodeBaseConfigR2(encodeBaseConfigR2(r)),/POLICY/);
  assert.equal(decodeBaseConfigR2(encodeBaseConfigR2(r),{localPublicFixture:true}).deploymentMode,0);
  const bad={...m,bootstrap:key(8)};
  await assert.rejects(validateProductionRelease(bad,{localPublicFixture:true}),/FIXTURE_RECIPE/);
  await assert.rejects(validateProductionRelease(await fixture(),{localPublicFixture:true}),/FIXTURE_RECIPE/);
});
