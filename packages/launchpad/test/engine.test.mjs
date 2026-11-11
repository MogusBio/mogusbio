import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLaunchpad, executeLaunchpadPrepared, decodeBuyResult, encodeExpenseBody, decodeExpenseBody, SEASON_CAPS } from '../src/index.mjs';
import { cloneProtocolState, ProtocolError, executeAtomic } from '../../protocol-core/src/index.mjs';
import { DOMAIN, OWNER, BUYER, SELLER, OPS, MEMBERS, bytes, key, fixture, createFrame, buyFields, buyFrame,
  queueFields, queueFrame, payFields, payFrame } from './fixtures.mjs';
const fail = (fn, code) => assert.throws(fn, (e) => e instanceof ProtocolError && (code === undefined || e.code === code));
const sumSOL = (state) => [...state.lamports.values()].reduce((a, b) => a + b, 0n);
function created(overrides = {}) {
  const f = fixture(), result = applyLaunchpad(f.state, createFrame(0n, overrides), f.context);
  return { ...f, state: result.state, id: result.resultBytes.subarray(0, 32), result };
}
test('CREATE initializes exactly four zero-supply Mints and immutable Project, charges only fee and real rent shortfalls', () => {
  const f = fixture(), before = cloneProtocolState(f.state), originalSOL = sumSOL(f.state), r = applyLaunchpad(f.state, createFrame(), f.context);
  assert.deepEqual(f.state, before); assert.equal(r.resultBytes.length, 208); assert.equal(r.state.projects.size, 1); assert.equal(r.state.mints.size, 4);
  assert.equal(r.state.sources.size, 0); assert.equal(r.state.roots.size, 0); assert.equal(r.state.seasonIssued.size, 0); assert.equal(r.state.lifetimeIssued.size, 0);
  const p = r.state.projects.values().next().value;
  assert.deepEqual(p.classes.map((c) => [c.issued, c.intakeBurned]), [[0n, 0n], [0n, 0n], [0n, 0n], [0n, 0n]]);
  assert.equal(r.state.lamports.get(key(OPS)) - f.state.lamports.get(key(OPS)), 10000000n);
  assert.equal(sumSOL(r.state), originalSOL); assert.equal(r.state.actorNonces.size, 1);
  const nonceAddr = f.context.deriveActorNonceAddress(OWNER); assert.equal(r.state.nativeAccounts.get(key(nonceAddr)).dataLength, 418);
});
test('ordinary purchase delivers exactlyn and increments one project/class, global season and lifetime once', () => {
  const f = created(), project = f.state.projects.get(key(f.id)), p = buyFields(f.id, project, f.context), startSOL = sumSOL(f.state);
  const r = applyLaunchpad(f.state, buyFrame(p), f.context), result = decodeBuyResult(r.resultBytes);
  assert.equal(result.quantity, 2n); assert.equal(result.saleLamports, 1000000n); assert.equal(result.resourceLamports, 200000n);
  assert.equal(r.state.tokens.get(key(p.destinationToken)).amount, 2n); assert.equal(r.state.mints.get(key(p.mint)).supply, 2n);
  assert.equal(r.state.projects.get(key(f.id)).classes[0].issued, 2n);
  assert.equal(r.state.seasonIssued.get('1:0'), 2n); assert.equal(r.state.lifetimeIssued.get('1'), 2n);
  assert.equal(r.state.lamports.get(key(SELLER)) - f.state.lamports.get(key(SELLER)), 1000000n);
  assert.equal(r.state.lamports.get(key(OPS)) - f.state.lamports.get(key(OPS)), 200000n); assert.equal(sumSOL(r.state), startSOL);
  assert.equal(r.state.sources.size, 0); assert.equal(r.state.roots.size, 0);
  const retry = applyLaunchpad(r.state, buyFrame(p), { ...f.context, now: 788400000n, authorizedActors: new Set([key(BUYER)]) });
  assert.equal(retry.replayed, true); assert.deepEqual(retry.resultBytes, r.resultBytes); assert.deepEqual(retry.state.tokens, r.state.tokens);
});
test('self-sale is gross-budget checked and pays real resource fees without any mining reward', () => {
  const f = created({ saleRecipient: BUYER }), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context);
  const r = applyLaunchpad(f.state, buyFrame(p), f.context), result = decodeBuyResult(r.resultBytes);
  const delta = f.state.lamports.get(key(BUYER)) - r.state.lamports.get(key(BUYER));
  assert.equal(delta, result.resourceLamports + result.rentLamports); assert.equal(result.saleLamports, 1000000n);
  const poor = cloneProtocolState(f.state); poor.lamports.set(key(BUYER), result.resourceLamports + result.rentLamports);
  fail(() => applyLaunchpad(poor, buyFrame(p), f.context), 6310);
});
test('zero-price materials still consume quota and pay100000 lamports per unit', () => {
  const f = created({ classes: [1, 2, 3, 4].map((c) => ({ class: c, lifetimeCap: 1000n, priceLamports: 0n })) });
  const p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context), r = applyLaunchpad(f.state, buyFrame(p), f.context), result = decodeBuyResult(r.resultBytes);
  assert.equal(result.saleLamports, 0n); assert.equal(result.resourceLamports, 200000n); assert.equal(r.state.lifetimeIssued.get('1'), 2n);
});
test('all roles must be authorized independently; recipient does not grant payer authority', () => {
  const f = fixture(), request = createFrame(0n, { principalPayer: BUYER, rentPayer: SELLER });
  fail(() => applyLaunchpad(f.state, request, { ...f.context, authorizedActors: new Set([key(OWNER), key(BUYER)]) }), 6006);
  assert.equal(f.state.projects.size, 0); assert.equal(f.state.actorNonces.size, 0);
});
test('failed quote, stale season, wrong ATA, destination state or low cap rolls back everything', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context);
  for (const [change, code] of [[{ unitPriceLamports: 1n }, 6303], [{ resourcePerUnitLamports: 0n }, 6303], [{ expectedSeason: 1 }, 6312],
    [{ destinationToken: bytes(0xfa) }, 6305], [{ destinationMode: 2 }, 6304], [{ maxProtocolLamports: 1n }, 6308], [{ maxRentLamports: 0n }, 6309]]) {
    const before = cloneProtocolState(f.state); fail(() => applyLaunchpad(f.state, buyFrame({ ...p, ...change }), f.context), code); assert.deepEqual(f.state, before);
  }
});
test('material global season caps are shared across projects and buyers, final-unit race admits exactly one', () => {
  const f = created(), create2 = applyLaunchpad(f.state, createFrame(0n, { principalPayer: SELLER, rentPayer: SELLER, saleRecipient: SELLER }, SELLER), f.context);
  const secondId = create2.resultBytes.subarray(0, 32), state = create2.state;
  // This valid fixture represents prior purchases from other projects, not a counter reset operation.
  state.seasonIssued.set('1:0', SEASON_CAPS[0] - 1n); state.lifetimeIssued.set('1', SEASON_CAPS[0] - 1n);
  const qa = f.context.deriveQuotaAddresses(1, 0);
  for (const [address, length] of [[qa.seasonAddress, 131], [qa.lifetimeAddress, 129]]) {
    state.nativeAccounts.set(key(address), { programOwner: 'biolab', dataLength: length, executable: false }); state.lamports.set(key(address), f.context.minimumBalance(length));
  }
  const p1 = buyFields(f.id, state.projects.get(key(f.id)), f.context, { quantity: 1n });
  const p2 = buyFields(secondId, state.projects.get(key(secondId)), f.context, { quantity: 1n, principalPayer: SELLER, rentPayer: SELLER, materialRecipient: SELLER,
    destinationToken: f.context.deriveAtaAddress(state.projects.get(key(secondId)).classes[0].mint, SELLER) });
  const winner = applyLaunchpad(state, buyFrame(p1), f.context); assert.equal(winner.state.seasonIssued.get('1:0'), 50000n);
  const before = cloneProtocolState(winner.state); fail(() => applyLaunchpad(winner.state, buyFrame(p2, 1n, SELLER), f.context), 6314);
  assert.deepEqual(winner.state, before);
});
test('new seasons have fresh fixed caps; old tokens remain and cumulative/project caps never reset', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context), first = applyLaunchpad(f.state, buyFrame(p), f.context);
  const second = applyLaunchpad(first.state, buyFrame({ ...p, expectedSeason: 1 }, 1n), { ...f.context, now: 7862400n, slot: 2n });
  assert.equal(second.state.seasonIssued.get('1:0'), 2n); assert.equal(second.state.seasonIssued.get('1:1'), 2n);
  assert.equal(second.state.lifetimeIssued.get('1'), 4n); assert.equal(second.state.tokens.get(key(p.destinationToken)).amount, 4n);
  const missingLifetime = cloneProtocolState(first.state); missingLifetime.lifetimeIssued.delete('1');
  fail(() => applyLaunchpad(missingLifetime, buyFrame({ ...p, expectedSeason: 1 }, 1n), { ...f.context, now: 7862400n }), 6313);
});
test('external burn does not return sales allowance or create Source; supply guard remains exact', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context), first = applyLaunchpad(f.state, buyFrame(p), f.context);
  first.state.mints.get(key(p.mint)).supply = 0n; first.state.tokens.get(key(p.destinationToken)).amount = 0n;
  const second = applyLaunchpad(first.state, buyFrame(p, 1n), f.context);
  assert.equal(second.state.projects.get(key(f.id)).classes[0].issued, 4n); assert.equal(second.state.mints.get(key(p.mint)).supply, 2n);
  assert.equal(second.state.lifetimeIssued.get('1'), 4n); assert.equal(second.state.sources.size, 0);
});
test('QUEUE uses one member, no funds reserve, unique ref, and bounded permanent Expense', () => {
  const f = fixture(), q = queueFields(), r = applyLaunchpad(f.state, queueFrame(q), f.context);
  assert.equal(r.resultBytes.length, 56); assert.equal(r.state.ops.nextExpenseNonce, 1n); assert.equal(r.state.ops.paidLamports, 0n);
  assert.equal(r.state.lamports.get(key(OPS)), f.state.lamports.get(key(OPS)));
  const expense = r.state.expenses.get(key(q.expenseRef)); assert.equal(expense.status, 0); assert.equal(encodeExpenseBody(expense).length, 289);
  assert.deepEqual(decodeExpenseBody(encodeExpenseBody(expense)), expense);
  fail(() => applyLaunchpad(r.state, queueFrame({ ...q, expectedNonce: 1n }, 1n), f.context), 6404);
  const bad = fixture(); fail(() => applyLaunchpad(bad.state, queueFrame(q, 0n, OWNER), bad.context), 6401);
});
test('Ops payment requires the selected distinct three and pays exactly once', () => {
  const f = fixture(), q = queueFields(), queued = applyLaunchpad(f.state, queueFrame(q), f.context), p = payFields(q);
  const beforeSOL = sumSOL(queued.state), r = applyLaunchpad(queued.state, payFrame(p), { ...f.context, now: 3600n, slot: 2n });
  assert.equal(r.resultBytes.length, 64); assert.equal(r.state.expenses.get(key(q.expenseRef)).status, 1); assert.equal(r.state.ops.paidLamports, q.amount);
  assert.equal(queued.state.lamports.get(key(OPS)) - r.state.lamports.get(key(OPS)), q.amount);
  assert.equal(r.state.lamports.get(key(SELLER)) - queued.state.lamports.get(key(SELLER)), q.amount); assert.equal(sumSOL(r.state), beforeSOL);
  const repeat = applyLaunchpad(r.state, payFrame(p), { ...f.context, now: 1000000n, authorizedActors: new Set([key(MEMBERS[0])]) }); assert.equal(repeat.replayed, true);
  fail(() => applyLaunchpad(r.state, payFrame(p, 2n), { ...f.context, now: 3601n, slot: 3n }), 6414);
});
test('repeated indices, missing selected signer, changed fields and unselected actor cannot authorize Ops', () => {
  const f = fixture(), q = queueFields(), queued = applyLaunchpad(f.state, queueFrame(q), f.context), p = payFields(q);
  fail(() => applyLaunchpad(queued.state, payFrame({ ...p, memberIndices: [0, 0, 4] }), f.context), 6412);
  fail(() => applyLaunchpad(queued.state, payFrame(p), { ...f.context, authorizedActors: new Set([key(MEMBERS[0]), key(MEMBERS[1]), key(MEMBERS[2]), key(MEMBERS[3])]) }), 6006);
  fail(() => applyLaunchpad(queued.state, payFrame({ ...p, amount: p.amount + 1n }), f.context), 6413);
  fail(() => applyLaunchpad(queued.state, payFrame(p, 0n, MEMBERS[1]), f.context), 6412);
});
test('Expense not-before/expiry and spendable Ops floor are enforced without expiry refund or paid mutation', () => {
  const f = fixture(), q = queueFields({ notBefore: 100n, expiresAt: 200n }), queued = applyLaunchpad(f.state, queueFrame(q), f.context), p = payFields(q);
  fail(() => applyLaunchpad(queued.state, payFrame(p), { ...f.context, now: 99n }), 6415);
  fail(() => applyLaunchpad(queued.state, payFrame(p), { ...f.context, now: 200n }), 6416);
  const poor = cloneProtocolState(queued.state); poor.lamports.set(key(OPS), f.context.minimumBalance(136) + q.amount - 1n);
  fail(() => applyLaunchpad(poor, payFrame(p), { ...f.context, now: 100n }), 6417);
  assert.equal(queued.state.expenses.get(key(q.expenseRef)).status, 0); assert.equal(queued.state.ops.paidLamports, 0n);
});
test('new queue global nonce race accepts one proposal and never locks other spending', () => {
  const f = fixture(), q = queueFields(), first = applyLaunchpad(f.state, queueFrame(q), f.context);
  const competing = queueFields({ expenseRef: bytes(0xac), rentPayer: MEMBERS[1] });
  fail(() => applyLaunchpad(first.state, queueFrame(competing, 0n, MEMBERS[1]), f.context), 6405);
  const second = applyLaunchpad(first.state, queueFrame({ ...competing, expectedNonce: 1n }, 0n, MEMBERS[1]), f.context);
  assert.equal(second.state.ops.nextExpenseNonce, 2n); assert.equal(second.state.expenses.size, 2);
  const paid = applyLaunchpad(second.state, payFrame(payFields(q)), { ...f.context, now: 1n }); assert.equal(paid.state.ops.paidLamports, q.amount);
});
test('project cap remains independent of available global season allowance', () => {
  const f = created({ classes: [1, 2, 3, 4].map((c) => ({ class: c, lifetimeCap: 1n, priceLamports: 0n })) });
  const p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context, { quantity: 1n });
  const first = applyLaunchpad(f.state, buyFrame(p), f.context);
  fail(() => applyLaunchpad(first.state, buyFrame(p, 1n), f.context), 6316);
  assert.equal(first.state.seasonIssued.get('1:0'), 1n);
});
test('new BUY/CREATE stop after100 seasons while the latest historical result still returns', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context);
  fail(() => applyLaunchpad(f.state, buyFrame(p), { ...f.context, now: 788400000n }), 6311);
  fail(() => applyLaunchpad(f.state, createFrame(1n), { ...f.context, now: 788400000n }), 6210);
  const retry = applyLaunchpad(f.state, createFrame(), { ...f.context, now: 788400000n }); assert.equal(retry.replayed, true);
});
test('seller future proceeds cannot finance the signed rent payer entry requirement', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context, { rentPayer: SELLER });
  const poor = cloneProtocolState(f.state); poor.lamports.set(key(SELLER), 1n);
  fail(() => applyLaunchpad(poor, buyFrame(p), f.context), 6310);
  assert.equal(poor.tokens.size, 0);
});
test('prepaid excess remains at its own new target and cannot fund another target', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context), qa = f.context.deriveQuotaAddresses(1, 0);
  const prepaid = cloneProtocolState(f.state); prepaid.lamports.set(key(qa.seasonAddress), 1000000n);
  prepaid.nativeAccounts.set(key(qa.seasonAddress), { programOwner: 'system', dataLength: 0, executable: false });
  const r = applyLaunchpad(prepaid, buyFrame(p), f.context), result = decodeBuyResult(r.resultBytes);
  assert.equal(r.state.lamports.get(key(qa.seasonAddress)), 1000000n); assert.ok(result.rentLamports > 0n);
  const exactExpected = f.context.minimumBalance(418) + f.context.minimumBalance(165) + f.context.minimumBalance(129);
  assert.equal(result.rentLamports, exactExpected);
});
test('missing/mistyped existing global counter evidence is blocked rather than silently repaired', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context), first = applyLaunchpad(f.state, buyFrame(p), f.context);
  const broken = cloneProtocolState(first.state), qa = f.context.deriveQuotaAddresses(1, 0); broken.nativeAccounts.delete(key(qa.seasonAddress));
  fail(() => applyLaunchpad(broken, buyFrame(p, 1n), f.context), 6313);
  assert.equal(broken.seasonIssued.get('1:0'), 2n);
});
test('failure after full prepared BUY discards payment, token delivery, quotas and nonce together', () => {
  const f = created(), p = buyFields(f.id, f.state.projects.get(key(f.id)), f.context), before = cloneProtocolState(f.state);
  assert.throws(() => executeAtomic(f.state, buyFrame(p), f.context, (draft, info) => {
    executeLaunchpadPrepared(draft, info, f.context); throw new Error('later same transaction failure');
  }), /later same transaction failure/);
  assert.deepEqual(f.state, before);
});
test('queue refs/evidence cannot be zero and a seven-day window cannot be silently extended', () => {
  const f = fixture();
  for (const [change, code] of [[{ expenseRef: bytes(0) }, 6402], [{ evidenceHash: bytes(0) }, 6403],
    [{ expiresAt: 604801n }, 6407], [{ notBefore: 86400n }, 6407], [{ amount: 0n }, 6406]]) {
    fail(() => applyLaunchpad(f.state, queueFrame(queueFields(change)), f.context), code);
    assert.equal(f.state.expenses.size, 0); assert.equal(f.state.ops.nextExpenseNonce, 0n);
  }
});
test('Ops itself cannot be recipient and payment cannot pretend a zero-net self-transfer is an outflow', () => {
  const f = fixture(); fail(() => applyLaunchpad(f.state, queueFrame(queueFields({ recipient: OPS })), f.context), 6410);
  assert.equal(f.state.ops.paidLamports, 0n); assert.equal(f.state.expenses.size, 0);
});
