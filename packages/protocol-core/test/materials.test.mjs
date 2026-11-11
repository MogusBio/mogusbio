import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCatalog, catalogHash, encodeMaterialPlan, decodeMaterialPlan, encodeDebitPlan, decodeDebitPlan,
  encodeSourceBody, decodeSourceBody, encodeProjectBody, decodeProjectBody, sha256, prepareMaterialConsumption,
  inventoryTotals, cloneProtocolState, F1_BOM, sourceId, projectId, businessKey, materialClass, ProtocolError, ERRORS as E } from '../src/index.mjs';
import { fixture, bytes, DOMAIN, OWNER, OTHER_OWNER, PROJECT, key } from './fixtures.mjs';
const fail = (fn, code) => assert.throws(fn, (e) => e instanceof ProtocolError && e.code === code);

test('fixed catalog and complete F1 MaterialPlan match frozen independent goldens', () => {
  assert.equal(encodeCatalog().length, 95);
  assert.equal(key(catalogHash()), '2a26772c8e8b61831fa7431e1600f419bcf088843474edb0a153f83ca82453b5');
  const { context } = fixture(), encoded = encodeMaterialPlan(context.plan);
  assert.equal(encoded.length, 1068); assert.equal(encodeDebitPlan(context.plan.debits).length, 612);
  assert.equal(key(sha256(encoded)), '7a4592e394dbbf6a398b8ad58daa8d1693f696ba4b2a3c9e7abffe27064e4124');
  assert.deepEqual(encodeMaterialPlan(decodeMaterialPlan(encoded)), encoded);
  assert.deepEqual(encodeDebitPlan(decodeDebitPlan(encodeDebitPlan(context.plan.debits))), encodeDebitPlan(context.plan.debits));
});
test('AA Source body matches the 736-byte frozen golden including all unused species', () => {
  const { state, context } = fixture(), result = prepareMaterialConsumption(state, context);
  const id = sourceId(DOMAIN, context.manufactureBusiness, 0), source = result.state.sources.get(key(id));
  const encoded = encodeSourceBody(source);
  assert.equal(encoded.length, 736);
  assert.equal(key(sha256(encoded)), '1312363347a78ea08d812d6f283c8f4ceb688ff6c8ea5c3173408267fcaaa987');
  assert.deepEqual(encodeSourceBody(decodeSourceBody(encoded, { domain: DOMAIN, expectedId: id })), encoded);
  const bad = Buffer.from(encoded); bad.writeBigUInt64LE(1n, 224 + 31 * 8);
  fail(() => decodeSourceBody(bad), E.BAD_SOURCE_STATE);
  const zeroPrefix = Buffer.from(encoded); zeroPrefix.fill(0, 480);
  fail(() => decodeSourceBody(zeroPrefix), E.BAD_SOURCE_STATE);
});
test('Project exact lengths, immutable catalog, class order and UTF-8 name bounds', () => {
  const f = fixture(), p = f.state.projects.get(key(PROJECT));
  assert.equal(encodeProjectBody(p).length, 411);
  assert.deepEqual(encodeProjectBody(decodeProjectBody(encodeProjectBody(p))), encodeProjectBody(p));
  p.name = 'a'.repeat(64); assert.equal(encodeProjectBody(p).length, 472);
  p.name += 'a'; fail(() => encodeProjectBody(p), E.BAD_PROJECT_STATE);
  p.name = 'a\u0000b'; fail(() => encodeProjectBody(p), E.BAD_PROJECT_STATE);
  p.name = 'Lab'; p.classes[0].intakeBurned = 11n; fail(() => encodeProjectBody(p), E.INTEGER_RANGE);
});
test('material plans reject noncanonical order, duplicate tokens and duplicate Source/debit entries', () => {
  const { context } = fixture();
  const swapped = cloneProtocolState(context.plan); swapped.intakes.reverse(); fail(() => encodeMaterialPlan(swapped), E.BAD_MATERIAL_PLAN);
  const dupToken = cloneProtocolState(context.plan); dupToken.intakes[1].sourceTokenAccount = dupToken.intakes[0].sourceTokenAccount;
  fail(() => encodeMaterialPlan(dupToken), E.BAD_MATERIAL_PLAN);
  const dupGroup = cloneProtocolState(context.plan); dupGroup.debits.push(dupGroup.debits[0]); fail(() => encodeMaterialPlan(dupGroup), E.BAD_MATERIAL_PLAN);
  const dupEntry = cloneProtocolState(context.plan); dupEntry.debits[0].entries.push(dupEntry.debits[0].entries[0]);
  fail(() => encodeMaterialPlan(dupEntry), E.BAD_MATERIAL_PLAN);
  fail(() => decodeMaterialPlan(Buffer.concat([encodeMaterialPlan(context.plan), Buffer.alloc(1)])), E.BAD_MATERIAL_PLAN);
});
test('highest mask bit species32 is unsigned and malformed length cannot allocate huge plans', () => {
  const s = [{ sourceId: bytes(1), entries: [{ species: 32, expectedPrefix: 0n, takeTick: 250n }] }];
  const encoded = encodeDebitPlan(s); assert.equal(encoded.subarray(36, 40).toString('hex'), '00000080');
  assert.deepEqual(decodeDebitPlan(encoded), s);
  const noMask = Buffer.from(encoded); noMask.fill(0, 36, 40); fail(() => decodeDebitPlan(noMask), E.BAD_MATERIAL_PLAN);
  fail(() => decodeDebitPlan(Buffer.from('ffffffff', 'hex')), E.BAD_MATERIAL_PLAN);
  fail(() => encodeDebitPlan([{ sourceId: bytes(1), entries: [{ species: 32, expectedPrefix: 0n, takeTick: 0n }] }]), E.INTEGER_RANGE);
});
test('one F1 manufacture consumes real material and exactly conserves source credit', () => {
  const { state, context } = fixture(), before = cloneProtocolState(state), r = prepareMaterialConsumption(state, context);
  assert.deepEqual(state, before, 'preparation may not mutate original state');
  assert.equal(r.state.sources.size, 4); assert.equal(r.consumedTick, 14000n);
  assert.equal(r.effective.length, 27); assert.equal(r.retired.length, 2);
  assert.equal(r.effectiveCreditInt, 120000n); assert.equal(r.retiredCreditInt, 45000n);
  assert.deepEqual(r.burnedStandardUnits, [1n, 1n, 1n, 1n]);
  const unused = inventoryTotals(r.state.sources);
  assert.equal(unused.totalTick, 18000n); assert.equal(unused.creditInt, 315000n);
  assert.equal(unused.creditInt + r.effectiveCreditInt + r.retiredCreditInt, 480000n);
  context.plan.intakes.forEach((item) => assert.equal(r.state.tokens.get(key(item.sourceTokenAccount)).amount, 9n));
  assert.deepEqual(r.state.projects.get(key(PROJECT)).classes.map((c) => c.intakeBurned), [1n, 1n, 1n, 1n]);
});
test('second component uses remaining AA/lipid/sugar and only one new NUC unit', () => {
  const f = fixture(), first = prepareMaterialConsumption(f.state, f.context);
  const secondM = businessKey(DOMAIN, OWNER, bytes(0x23)), newNucId = sourceId(DOMAIN, secondM, 0);
  const intakes = [cloneProtocolState(f.context.plan.intakes[1])];
  const debits = [1, 3, 4].map((c) => {
    const id = sourceId(DOMAIN, f.context.manufactureBusiness, c - 1), s = first.state.sources.get(key(id));
    return { sourceId: id, entries: materialClass(c).species.filter((n) => F1_BOM[n - 1] > 0n)
      .map((species) => ({ species, expectedPrefix: s.spentPrefix[species - 1], takeTick: F1_BOM[species - 1] })) };
  });
  debits.push({ sourceId: newNucId, entries: [21, 22, 23, 24, 25].map((species) => ({ species, expectedPrefix: 0n, takeTick: F1_BOM[species - 1] })) });
  debits.sort((a, b) => Buffer.compare(a.sourceId, b.sourceId));
  const r = prepareMaterialConsumption(first.state, { ...f.context, manufactureBusiness: secondM,
    plan: { catalogHash: catalogHash(), intakes, debits }, createdAt: 1n });
  assert.equal(r.state.sources.size, 5); assert.deepEqual(r.burnedStandardUnits, [0n, 1n, 0n, 0n]);
  const totals = inventoryTotals(r.state.sources); assert.equal(totals.totalTick, 12000n); assert.equal(totals.creditInt, 270000n);
  assert.equal(totals.creditInt + 2n * (120000n + 45000n), 600000n);
});
test('material owner authority is distinct from actor and requires every contributing owner', () => {
  const f = fixture({ owners: [OWNER, OTHER_OWNER, OWNER, OTHER_OWNER] });
  const withoutOther = { ...f.context, authorizedOwners: new Set([key(OWNER)]) };
  fail(() => prepareMaterialConsumption(f.state, withoutOther), E.MATERIAL_OWNER_REQUIRED);
  const r = prepareMaterialConsumption(f.state, f.context);
  const nuc = r.state.sources.get(key(sourceId(DOMAIN, f.context.manufactureBusiness, 1)));
  assert.deepEqual(nuc.inventoryOwner, OTHER_OWNER);
  assert.equal(r.state.sources.size, 4);
});
test('extra or insufficient BOM, nonminimal intake, missing debit and frozen Token all fail atomically', () => {
  const modifications = [
    [E.NON_MINIMAL_INTAKE, (f) => { f.context.plan.intakes[0].unitCount = 2n; }],
    [E.NON_MINIMAL_INTAKE, (f) => { const id = sourceId(DOMAIN, f.context.manufactureBusiness, 0); f.context.plan.debits = f.context.plan.debits.filter((d) => !d.sourceId.equals(id)); }],
    [E.MATERIAL_DESTINATION_MISMATCH, (f) => { f.context.plan.debits[0].entries[0].takeTick -= 1n; }],
    [E.MATERIAL_ACCOUNT_STATE, (f) => { f.state.tokens.get(key(f.context.plan.intakes[0].sourceTokenAccount)).frozen = true; }],
    [E.MATERIAL_SUPPLY_LEDGER, (f) => { f.state.mints.values().next().value.supply = 11n; }],
  ];
  modifications.forEach(([code, modify]) => {
    const f = fixture(); modify(f); const before = cloneProtocolState(f.state);
    fail(() => prepareMaterialConsumption(f.state, f.context), code); assert.deepEqual(f.state, before);
  });
});
test('same manufacturing Source identity cannot be initialized twice or under another owner', () => {
  const f = fixture(), first = prepareMaterialConsumption(f.state, f.context), before = cloneProtocolState(first.state);
  fail(() => prepareMaterialConsumption(first.state, f.context), E.SOURCE_ALREADY_EXISTS);
  assert.deepEqual(first.state, before);
  const changed = cloneProtocolState(f.context); changed.plan.intakes[0].materialOwner = OTHER_OWNER;
  changed.authorizedOwners.add(key(OTHER_OWNER)); fail(() => prepareMaterialConsumption(f.state, changed), E.MATERIAL_OWNER_REQUIRED);
});
test('old stale prefixes cannot be replayed with a fresh manufacture business', () => {
  const f = fixture(), first = prepareMaterialConsumption(f.state, f.context);
  const context = { ...f.context, manufactureBusiness: businessKey(DOMAIN, OWNER, bytes(0x33)),
    plan: { ...f.context.plan, intakes: [] } };
  const before = cloneProtocolState(first.state);
  fail(() => prepareMaterialConsumption(first.state, context), E.STALE_INVENTORY_PREFIX);
  assert.deepEqual(first.state, before);
});
test('Source schemas reject cross-species initial stock, tail data and forged identity', () => {
  const f = fixture(), result = prepareMaterialConsumption(f.state, f.context), source = result.state.sources.values().next().value;
  fail(() => decodeSourceBody(Buffer.concat([encodeSourceBody(source), Buffer.alloc(1)])), E.BAD_FRAME);
  fail(() => decodeSourceBody(encodeSourceBody(source), { domain: DOMAIN, expectedId: bytes(7) }), E.BAD_SOURCE_STATE);
  const wrongClass = cloneProtocolState(source); wrongClass.class = 2; fail(() => encodeSourceBody(wrongClass), E.BAD_SOURCE_STATE);
});
test('same-directory material from two independent projects retains separate Source lineage and no extra effective credit', () => {
  const f = fixture(), secondProjectId = projectId(DOMAIN, bytes(0x45));
  const p2 = cloneProtocolState(f.state.projects.get(key(PROJECT))); p2.creationBusiness = bytes(0x45);
  p2.classes.forEach((c, i) => { c.mint = bytes(0xb1 + i); f.state.mints.set(key(c.mint), { supply: 10n }); });
  f.state.projects.set(key(secondProjectId), p2);
  f.state.tokens.set(key(bytes(0xaa)), { mint: p2.classes[0].mint, owner: OTHER_OWNER, amount: 10n, initialized: true, native: false });
  const intakes = [...f.context.plan.intakes, { projectId: secondProjectId, class: 1, sourceTokenAccount: bytes(0xaa), materialOwner: OTHER_OWNER, unitCount: 1n }]
    .sort((a, b) => Buffer.compare(a.projectId, b.projectId) || a.class - b.class || Buffer.compare(a.sourceTokenAccount, b.sourceTokenAccount));
  const debits = intakes.map((item, i) => ({ sourceId: sourceId(DOMAIN, f.context.manufactureBusiness, i),
    entries: materialClass(item.class).species.filter((s) => F1_BOM[s - 1] > 0n)
      .map((species) => ({ species, expectedPrefix: 0n, takeTick: item.class === 1 ? 250n : F1_BOM[species - 1] })) }))
    .sort((a, b) => Buffer.compare(a.sourceId, b.sourceId));
  const r = prepareMaterialConsumption(f.state, { ...f.context, plan: { catalogHash: catalogHash(), intakes, debits },
    authorizedOwners: new Set([key(OWNER), key(OTHER_OWNER)]) });
  assert.equal(r.state.sources.size, 5); assert.equal(r.effectiveCreditInt, 120000n); assert.equal(r.retiredCreditInt, 45000n);
  assert.equal(inventoryTotals(r.state.sources).creditInt, 435000n);
  assert.equal(new Set([...r.state.sources.values()].map((s) => key(s.projectId))).size, 2);
});
test('old-stock consumption checks its distinct owner, catalog and overdraw before committing anything', () => {
  const f = fixture(), first = prepareMaterialConsumption(f.state, f.context);
  const source = [...first.state.sources.entries()].find(([, s]) => s.class === 1);
  const [id, original] = source;
  const makeContext = () => ({ ...f.context, manufactureBusiness: businessKey(DOMAIN, OWNER, bytes(0xee)),
    plan: { catalogHash: catalogHash(), intakes: [], debits: [{ sourceId: Buffer.from(id, 'hex'),
      entries: [{ species: 1, expectedPrefix: 500n, takeTick: 501n }] }] } });
  fail(() => prepareMaterialConsumption(first.state, makeContext()), E.INVENTORY_BALANCE_LOW);
  const otherOwnerState = cloneProtocolState(first.state); otherOwnerState.sources.get(id).inventoryOwner = OTHER_OWNER;
  fail(() => prepareMaterialConsumption(otherOwnerState, makeContext()), E.INVENTORY_OWNER_REQUIRED);
  const badCatalogState = cloneProtocolState(first.state); badCatalogState.sources.get(id).catalogHash = bytes(1);
  fail(() => prepareMaterialConsumption(badCatalogState, makeContext()), E.CATALOG_MISMATCH);
  assert.deepEqual(first.state.sources.get(id), original);
});
