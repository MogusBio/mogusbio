import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SettlementEngine, SettlementError, TOTAL_SUPPLY, ALLOCATED_SUPPLY,
  GENESIS_SEALED, HOURS_PER_EPOCH, NONZERO_EPOCHS, H_END,
  U64_MAX, U128_MAX, u64, u128, mul128,
  epochBudget, hourBudget, emissionPrefix, completedHours, nextStakeHour,
  normalWeight, rewardAmount, denominator, W_FLOOR, K_WEIGHT,
} from '../src/index.mjs';

const T = 3_600n;
const at = (h) => T + BigInt(h) * 3_600n;
const fresh = () => new SettlementEngine({ rewardStart: T });
const component = (instance, owner = 'alice') => ({
  instance, owner, scope: 'COMPONENT', B_int: 120_000n, q_ppm: 1_000_000n, certificate: `cert:${instance}`,
});
const bio = (instance = 'bio', owner = 'alice') => ({
  instance, owner, scope: 'BIO', B_int: 7_200_000n, q_ppm: 2_000_000n, certificate: `cert:${instance}`,
});
const cmd = (engine, method, actor, fields) => engine[method]({ actor, nonce: engine.nextNonce(actor), ...fields });
const expectCode = (fn, code) => assert.throws(fn, (error) => error instanceof SettlementError && error.code === code);

function settle(engine, h, now = at(BigInt(h) + 1n), batch = 8) {
  const hour = BigInt(h);
  cmd(engine, 'openHour', 'crank', { now, hour });
  while (['K_SCAN', 'ROOT_SCAN'].includes(engine.hour(hour).status)) {
    const state = engine.snapshot();
    const record = engine.hour(hour);
    // Work is bounded by actual steps. One step is deliberately valid even at
    // an unknown stage boundary; materialization batches still use up to eight.
    cmd(engine, 'scanHour', 'crank', {
      now, hour, expectedPhase: record.status,
      expectedCursor: record.status === 'K_SCAN' ? state.registry.kScanSeq : record.rootCursor,
      workCount: 1,
    });
  }
  while (engine.hour(hour).status !== 'FINAL') {
    const record = engine.hour(hour);
    const rootCount = Math.min(batch, Number(record.rootCutoff - record.materializeCursor));
    cmd(engine, 'materializeHour', 'crank', { now, hour, expectedCursor: record.materializeCursor, rootCount });
  }
  return engine.hour(hour);
}

test('emission: exactly 46 nonzero epochs and one hundred million LAB including sealed tail', () => {
  let sum = 0n;
  for (let epoch = 0n; epoch < NONZERO_EPOCHS; epoch += 1n) {
    assert.ok(epochBudget(epoch) > 0n);
    sum += epochBudget(epoch);
  }
  assert.equal(epochBudget(45n), 1n);
  assert.equal(epochBudget(46n), 0n);
  assert.equal(epochBudget(U64_MAX), 0n);
  assert.equal(sum, ALLOCATED_SUPPLY);
  assert.equal(sum + GENESIS_SEALED, TOTAL_SUPPLY);
  assert.equal(H_END, 1_611_840n);
});

test('emission: first epoch every hourly difference sums exactly, rather than average rounding', () => {
  let sum = 0n;
  for (let h = 0n; h < HOURS_PER_EPOCH; h += 1n) sum += hourBudget(h);
  assert.equal(sum, 50_000_000_000_000n);
  assert.equal(hourBudget(0n), 1_426_940_639n);
  assert.equal(hourBudget(HOURS_PER_EPOCH - 1n), 1_426_940_640n);
});

test('emission: prefix differences match individual budgets across all epoch boundaries', () => {
  for (let epoch = 0n; epoch < NONZERO_EPOCHS; epoch += 1n) {
    const first = epoch * HOURS_PER_EPOCH;
    const last = first + HOURS_PER_EPOCH - 1n;
    for (const h of [first, first + 1n, last]) {
      assert.equal(emissionPrefix(h + 1n) - emissionPrefix(h), hourBudget(h));
    }
    assert.equal(emissionPrefix(first + HOURS_PER_EPOCH) - emissionPrefix(first), epochBudget(epoch));
  }
  assert.equal(emissionPrefix(H_END), ALLOCATED_SUPPLY);
  assert.equal(emissionPrefix(U64_MAX), ALLOCATED_SUPPLY);
  assert.equal(hourBudget(H_END - 1n), 1n);
  assert.equal(hourBudget(H_END), 0n);
});

test('arithmetic: reject Number, negative, fractional and overflowing inputs', () => {
  for (const invalid of [1, 1.5, -1n, '1', undefined]) expectCode(() => u64(invalid), 'ARITHMETIC');
  expectCode(() => u64(U64_MAX + 1n), 'ARITHMETIC');
  expectCode(() => u128(U128_MAX + 1n), 'ARITHMETIC');
  expectCode(() => mul128(U128_MAX, 2n), 'ARITHMETIC');
  expectCode(() => hourBudget(-1n), 'ARITHMETIC');
  assert.equal(mul128(57_600_000_000_000_000_000n, TOTAL_SUPPLY), 5_760_000_000_000_000_000_000_000_000_000_000n);
});

test('time: complete hours, pre-start registration, and finite end are distinct', () => {
  assert.equal(completedHours(T - 1n, T), 0n);
  assert.equal(completedHours(T, T), 0n);
  assert.equal(nextStakeHour(T - 1n, T), 0n);
  assert.equal(nextStakeHour(T, T), 1n);
  assert.equal(completedHours(at(H_END + 5n), T), H_END);
  expectCode(() => nextStakeHour(at(H_END - 1n), T), 'REWARD_DOMAIN_CLOSED');
});

test('weight and rewards match frozen component/BIO/champion vectors', () => {
  assert.equal(normalWeight(component('p')), 480_000_000_000n);
  assert.equal(normalWeight(bio()), 95_040_000_000_000n);
  assert.equal(rewardAmount(hourBudget(0n), normalWeight(component('p')), W_FLOOR), 2_378n);
  assert.equal(rewardAmount(hourBudget(0n), normalWeight(bio()), W_FLOOR), 470_890n);
  assert.equal(rewardAmount(hourBudget(0n), normalWeight(bio()) + K_WEIGHT, W_FLOOR), 856_164n);
  expectCode(() => normalWeight({ ...component('p'), q_ppm: 2_000_000n }), 'INVALID_COMPONENT_FACTS');
  expectCode(() => normalWeight({ ...bio(), q_ppm: 1_000_001n }), 'QUALITY_NOT_MILLIQUANTIZED');
  expectCode(() => normalWeight({ ...bio(), q_ppm: 499_000n }), 'INVALID_QUALITY_OR_B');
});

test('one BIO: materialization classifies once; cumulative claim pays once', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const registration = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  const record = settle(engine, 0n);
  assert.equal(record.materializedSum, 470_890n);
  assert.equal(record.sealedResidual, 1_426_469_749n);
  assert.equal(engine.position(registration.intervalId).accrued, 470_890n);
  assert.equal(engine.ledger().certified, 470_890n);
  const request = { actor: 'alice', nonce: engine.nextNonce('alice'), now: at(1), intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 470_890n, destinationOwner: 'alice' };
  const paid = engine.claimPosition(request);
  assert.equal(paid.amount, 470_890n);
  assert.deepEqual(engine.claimPosition(request), paid);
  assert.equal(engine.balance('alice'), 470_890n);
  assert.equal(engine.ledger().certified, 0n);
  assert.equal(engine.ledger().total, TOTAL_SUPPLY);
  expectCode(() => cmd(engine, 'claimPosition', 'attacker', {
    now: at(1), intervalId: registration.intervalId, expectedPaid: 0n,
    upToAccrued: 470_890n, destinationOwner: 'alice',
  }), 'PAID_CAS');
});

test('SETTLE2: no permanent per-root/hour receipts and no unbounded Business log', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const registration = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  for (let h = 0n; h < 24n; h += 1n) settle(engine, h);
  const state = engine.snapshot();
  assert.equal(state.intervals.size, 1);
  assert.equal(state.hours.size, 24);
  assert.equal(state.actors.size, 2);
  assert.equal(Object.hasOwn(state, 'receipts'), false);
  assert.equal(Object.hasOwn(state, 'businesses'), false);
  const expected = Array.from({ length: 24 }, (_, h) => rewardAmount(hourBudget(BigInt(h)), normalWeight(bio()), W_FLOOR))
    .reduce((a, b) => a + b, 0n);
  assert.equal(engine.position(registration.intervalId).accrued, expected);
});

test('nonce: latest exact replay, conflicting replay, old nonce and future gaps', () => {
  const engine = fresh();
  const first = { actor: 'crank', nonce: 0n, now: at(1) };
  const original = engine.sync(first);
  assert.deepEqual(engine.sync(first), original);
  expectCode(() => engine.sync({ ...first, now: at(2) }), 'NONCE_CONFLICT');
  cmd(engine, 'sync', 'crank', { now: at(2) });
  expectCode(() => engine.sync(first), 'ALREADY_PROCESSED');
  expectCode(() => engine.sync({ actor: 'crank', nonce: 3n, now: at(3) }), 'NONCE_GAP');
  assert.equal(engine.nextNonce('crank'), 2n);
});

test('nonce request fingerprints distinguish typed values from lookalike arrays', () => {
  const engine = fresh();
  const request = { actor: 'crank', nonce: 0n, now: at(1) };
  engine.sync(request);
  expectCode(() => engine.sync({ ...request, now: ['bigint', at(1).toString()] }), 'NONCE_CONFLICT');
});

test('prepared integration uses the core nonce once and creates no second actor checkpoint', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  engine.executePrepared('register', { actor: 'alice', instance: 'p', now: 0n });
  assert.equal(engine.snapshot().actors.size, 0);
  expectCode(() => engine.executePrepared('constructor', {}), 'INVALID_PREPARED_COMMAND');
});

test('failed command rolls back all state, actor nonce and observed time', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  const before = engine.snapshot();
  expectCode(() => cmd(engine, 'register', 'bob', { instance: 'p', now: at(2) }), 'OWNER_REQUIRED');
  assert.deepEqual(engine.snapshot(), before);
  assert.equal(engine.nextNonce('bob'), 0n);
});

test('clock rollback between h0 and pre-start is rejected even though both completed-hour counts are zero', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'sync', 'crank', { now: T });
  expectCode(() => cmd(engine, 'register', 'alice', { instance: 'p', now: T - 1n }), 'CLOCK_ROLLBACK');
});

test('global cold start seals only completed empty prefix and preserves current hour', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const now = at(8_760) + 42n;
  const registration = cmd(engine, 'register', 'alice', { instance: 'bio', now });
  const state = engine.snapshot();
  assert.equal(registration.start, 8_761n);
  assert.equal(state.registry.nextMaterializeHour, 8_760n);
  assert.equal(engine.hour(8_760n), null);
  assert.equal(state.treasury.F, 87_499_999_999_983n);
  assert.equal(state.treasury.sealed, 12_500_000_000_017n);
  assert.equal(state.treasury.pending, 0n);
  expectCode(() => cmd(engine, 'openHour', 'crank', { hour: 8_760n, now }), 'HOUR_NOT_DUE_OR_DOMAIN');
  assert.equal(settle(engine, 8_760n, at(8_761)).members, 0n);
  assert.equal(settle(engine, 8_761n, at(8_762)).members, 1n);
});

test('cold start handles exactly one preexisting empty READY hour without double sealing it', () => {
  const engine = fresh();
  cmd(engine, 'openHour', 'crank', { hour: 0n, now: at(2) });
  assert.equal(engine.hour(0n).status, 'READY');
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'register', 'alice', { instance: 'p', now: at(2) });
  assert.equal(engine.hour(0n).status, 'FINAL');
  assert.equal(engine.snapshot().registry.nextMaterializeHour, 2n);
  assert.equal(engine.ledger().sealed, GENESIS_SEALED + emissionPrefix(2n));
});

test('completed empty hour before first registration is not classified twice', () => {
  const engine = fresh();
  settle(engine, 0n, at(2));
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'register', 'alice', { instance: 'p', now: at(2) });
  assert.equal(engine.ledger().sealed, GENESIS_SEALED + emissionPrefix(2n));
  assert.equal(engine.snapshot().registry.nextMaterializeHour, 2n);
});

test('pending stake cannot be voluntarily cancelled, consumed, transferred or double-staked', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'register', 'alice', { instance: 'p', now: 0n });
  expectCode(() => cmd(engine, 'exit', 'alice', { instance: 'p', seq: 0n, now: 0n }), 'CANNOT_CANCEL_PENDING_STAKE');
  expectCode(() => cmd(engine, 'transfer', 'alice', { instance: 'p', newOwner: 'bob', now: 0n }), 'STAKE_LOCKED');
  expectCode(() => cmd(engine, 'register', 'alice', { instance: 'p', now: 0n }), 'ALREADY_STAKED_OR_PENDING');
  expectCode(() => engine.assertCanConsume('p', 0n), 'STAKE_LOCKED');
});

test('exit takes next full-hour boundary and materialization, rather than payment, unlocks transfer', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const reg = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  const exit = cmd(engine, 'exit', 'alice', { instance: 'bio', seq: 0n, now: T + 50n });
  assert.equal(exit.end, 1n);
  expectCode(() => cmd(engine, 'transfer', 'alice', { instance: 'bio', newOwner: 'bob', now: T + 60n }), 'STAKE_LOCKED');
  expectCode(() => cmd(engine, 'transfer', 'alice', { instance: 'bio', newOwner: 'bob', now: at(1) }), 'UNSETTLED_HISTORY');
  settle(engine, 0n);
  cmd(engine, 'transfer', 'alice', { instance: 'bio', newOwner: 'bob', now: at(1) });
  assert.equal(engine.root('bio').owner, 'bob');
  assert.equal(engine.position(reg.intervalId).paid, 0n);
  cmd(engine, 'claimPosition', 'relayer', { now: at(1), intervalId: reg.intervalId,
    expectedPaid: 0n, upToAccrued: 470_890n, destinationOwner: 'alice' });
  assert.equal(engine.balance('alice'), 470_890n);
  assert.equal(engine.balance('bob'), 0n);
});

test('a transferred root may earn future ordinary rewards while old author retains old position', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const old = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  cmd(engine, 'exit', 'alice', { instance: 'bio', seq: 0n, now: T });
  settle(engine, 0n);
  cmd(engine, 'transfer', 'alice', { instance: 'bio', newOwner: 'bob', now: at(1) });
  const next = cmd(engine, 'register', 'bob', { instance: 'bio', now: at(1) });
  assert.equal(next.start, 2n);
  settle(engine, 1n);
  settle(engine, 2n);
  assert.equal(engine.position(old.intervalId).accrued, 470_890n);
  assert.equal(engine.position(next.intervalId).beneficiary, 'bob');
  assert.equal(engine.position(next.intervalId).accrued, rewardAmount(hourBudget(2n), normalWeight(bio()), W_FLOOR));
  assert.equal(engine.snapshot().registry.roots.length, 1);
});

test('repeat staking grows local positions once, never global root directory', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'register', 'alice', { instance: 'p', now: 0n });
  cmd(engine, 'exit', 'alice', { instance: 'p', seq: 0n, now: T });
  settle(engine, 0n);
  const next = cmd(engine, 'register', 'alice', { instance: 'p', now: at(1) });
  settle(engine, 1n);
  cmd(engine, 'exit', 'alice', { instance: 'p', seq: 1n, now: at(2) });
  settle(engine, 2n);
  assert.equal(next.seq, 1n);
  assert.equal(engine.snapshot().registry.roots.length, 1);
  assert.equal(engine.snapshot().intervals.size, 2);
  assert.equal(engine.snapshot().registrations.get('p').settlementSeq, 1n);
  assert.equal(engine.snapshot().registrations.get('p').coverageSeq, 2n);
});

test('old exit request cannot terminate a later stake or change closed boundary', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'register', 'alice', { instance: 'p', now: 0n });
  cmd(engine, 'exit', 'alice', { instance: 'p', seq: 0n, now: T });
  settle(engine, 0n);
  const next = cmd(engine, 'register', 'alice', { instance: 'p', now: at(1) });
  const old = cmd(engine, 'exit', 'someone', { instance: 'p', seq: 0n, now: at(1) });
  assert.equal(old.end, 1n);
  assert.equal(engine.position(next.intervalId).end, null);
});

test('one-way synthesis is atomic; actual consumed instances never earn again', () => {
  const engine = fresh();
  for (const id of ['a', 'b', 'kept']) engine.createVerifiedRoot(component(id));
  const invalid = { actor: 'alice', nonce: 0n, instances: ['a', 'b'], outputInstance: 'cell',
    now: 0n, outputFacts: { instance: 'cell', owner: 'alice', scope: 'CELL', B_int: 1n,
      q_ppm: 0n, certificate: 'bad' } };
  const before = engine.snapshot();
  expectCode(() => engine.consume(invalid), 'INVALID_QUALITY_OR_B');
  assert.deepEqual(engine.snapshot(), before);
  engine.consume({ ...invalid, outputFacts: { ...invalid.outputFacts, B_int: 240_000n, q_ppm: 1_000_000n } });
  assert.equal(engine.root('a').status, 'CONSUMED');
  assert.equal(engine.root('cell').status, 'LIVE');
  assert.equal(engine.root('kept').status, 'LIVE');
  expectCode(() => cmd(engine, 'register', 'alice', { instance: 'a', now: 0n }), 'ROOT_CONSUMED');
  cmd(engine, 'register', 'alice', { instance: 'cell', now: 0n });
  cmd(engine, 'register', 'alice', { instance: 'kept', now: 0n });
  assert.equal(engine.snapshot().registry.roots.length, 2);
});

test('same input supplied twice or reused by a new identity cannot be consumed twice', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  expectCode(() => cmd(engine, 'consume', 'alice', { instances: ['p', 'p'], outputInstance: 'x',
    outputFacts: { ...bio('x') }, now: 0n }), 'DUPLICATE_INPUT');
  expectCode(() => cmd(engine, 'consume', 'bob', { instances: ['p'], outputInstance: 'x',
    outputFacts: bio('x', 'bob'), now: 0n }), 'OWNER_REQUIRED');
});

test('K is only accepted from a trusted selected winner and merged before a single floor', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const reg = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  engine.acceptFrontier({ cost: 328n, now: 0n });
  engine.acceptWinner({ winnerId: 'winner', instance: 'bio', author: 'alice', cost: 328n });
  cmd(engine, 'activateK', 'alice', { instance: 'bio', winnerId: 'winner', now: 0n });
  const record = settle(engine, 0n);
  assert.equal(record.members, 1n);
  assert.equal(record.totalWeight, 172_800_000_000_000n);
  assert.equal(engine.position(reg.intervalId).accrued, 856_164n);
  assert.equal(engine.snapshot().intervals.size, 1);
  expectCode(() => cmd(engine, 'activateK', 'alice', { instance: 'bio', winnerId: 'winner', now: at(1) }), 'K_OVERLAP');
});

test('strictly better frontier stops K prospectively without changing existing ordinary or historical accrual', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const reg = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  engine.acceptFrontier({ cost: 328n, now: 0n });
  engine.acceptWinner({ winnerId: 'winner', instance: 'bio', author: 'alice', cost: 328n });
  cmd(engine, 'activateK', 'alice', { instance: 'bio', winnerId: 'winner', now: 0n });
  engine.acceptFrontier({ cost: 327n, now: T + 1n });
  settle(engine, 0n);
  settle(engine, 1n);
  assert.equal(engine.position(reg.intervalId).accrued,
    856_164n + rewardAmount(hourBudget(1n), normalWeight(bio()), W_FLOOR));
  expectCode(() => cmd(engine, 'activateK', 'alice', { instance: 'bio', winnerId: 'winner', now: at(2) }), 'WINNER_NOT_CURRENT');
});

test('same-boundary better frontiers cancel pending K without creating a second reward', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const reg = cmd(engine, 'register', 'alice', { instance: 'bio', now: T });
  engine.acceptFrontier({ cost: 328n, now: T });
  engine.acceptWinner({ winnerId: 'winner', instance: 'bio', author: 'alice', cost: 328n });
  cmd(engine, 'activateK', 'alice', { instance: 'bio', winnerId: 'winner', now: T });
  engine.acceptFrontier({ cost: 327n, now: T + 1n });
  settle(engine, 0n);
  settle(engine, 1n);
  assert.equal(engine.snapshot().activations.values().next().value.end, 1n);
  assert.equal(engine.position(reg.intervalId).accrued,
    rewardAmount(hourBudget(1n), normalWeight(bio()), W_FLOOR));
});

test('transfer and buy-back never restores original first-discovery eligibility', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  engine.acceptFrontier({ cost: 328n, now: 0n });
  engine.acceptWinner({ winnerId: 'winner', instance: 'bio', author: 'alice', cost: 328n });
  cmd(engine, 'transfer', 'alice', { instance: 'bio', newOwner: 'bob', now: 0n });
  cmd(engine, 'transfer', 'bob', { instance: 'bio', newOwner: 'alice', now: 0n });
  cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  expectCode(() => cmd(engine, 'activateK', 'alice', { instance: 'bio', winnerId: 'winner', now: 0n }), 'K_PERMANENTLY_REVOKED');
});

test('certificate fault may zero pending stake but never erase old earned debt', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const reg = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  settle(engine, 0n);
  engine.invalidateCertificate({ instance: 'bio', now: at(1), faultReference: 'deterministic-fault' });
  settle(engine, 1n);
  assert.equal(engine.position(reg.intervalId).accrued, 470_890n
    + rewardAmount(hourBudget(1n), normalWeight(bio()), W_FLOOR));
  cmd(engine, 'claimPosition', 'alice', { now: at(2), intervalId: reg.intervalId, expectedPaid: 0n,
    upToAccrued: engine.position(reg.intervalId).accrued, destinationOwner: 'alice' });
  expectCode(() => cmd(engine, 'register', 'alice', { instance: 'bio', now: at(2) }), 'CERTIFICATE_INVALID');
});

test('deterministically invalid pending certificate produces no zero-length reward position', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  const reg = cmd(engine, 'register', 'alice', { instance: 'p', now: T });
  engine.invalidateCertificate({ instance: 'p', now: T + 1n, faultReference: 'fault' });
  settle(engine, 0n);
  settle(engine, 1n);
  assert.equal(engine.position(reg.intervalId).start, 1n);
  assert.equal(engine.position(reg.intervalId).end, 1n);
  assert.equal(engine.position(reg.intervalId).accrued, 0n);
  assert.equal(engine.snapshot().registrations.get('p').coverageSeq, 1n);
});

test('60 independent component roots floor individually; different wallets do not change denominator', () => {
  const engine = fresh();
  const positions = [];
  for (let n = 0; n < 60; n += 1) {
    engine.createVerifiedRoot(component(`p${n}`, `owner${n}`));
    positions.push(cmd(engine, 'register', `owner${n}`, { instance: `p${n}`, now: 0n }).intervalId);
  }
  const record = settle(engine, 0n);
  assert.equal(record.members, 60n);
  assert.equal(record.denominator, W_FLOOR);
  assert.equal(record.materializedSum, 142_680n);
  for (const id of positions) assert.equal(engine.position(id).accrued, 2_378n);
  assert.equal(engine.snapshot().intervals.size, 60);
});

test('above-floor large integer denominator conserves budget and leaves only per-root floor dust', () => {
  const engine = fresh();
  for (let n = 0; n < 5; n += 1) {
    const facts = { ...bio(`large${n}`, `owner${n}`), B_int: 10_000_000_000n };
    engine.createVerifiedRoot(facts);
    cmd(engine, 'register', `owner${n}`, { instance: facts.instance, now: 0n });
  }
  const record = settle(engine, 0n);
  assert.ok(record.totalWeight > W_FLOOR);
  assert.equal(record.denominator, record.totalWeight);
  assert.ok(record.sealedResidual < 5n);
  assert.equal(record.materializedSum + record.sealedResidual, record.budget);
});

test('scan cannot skip roots, pay from partial denominator or absorb excess work', () => {
  const engine = fresh();
  for (const id of ['a', 'b']) {
    engine.createVerifiedRoot(component(id));
    cmd(engine, 'register', 'alice', { instance: id, now: 0n });
  }
  cmd(engine, 'openHour', 'crank', { now: at(1), hour: 0n });
  expectCode(() => cmd(engine, 'scanHour', 'crank', { now: at(1), hour: 0n,
    expectedPhase: 'ROOT_SCAN', expectedCursor: 1n, workCount: 1 }), 'SCAN_CURSOR');
  expectCode(() => cmd(engine, 'materializeHour', 'crank', { now: at(1), hour: 0n,
    expectedCursor: 0n, rootCount: 2 }), 'HOUR_PHASE');
  const before = engine.snapshot();
  expectCode(() => cmd(engine, 'scanHour', 'crank', { now: at(1), hour: 0n,
    expectedPhase: 'ROOT_SCAN', expectedCursor: 0n, workCount: 3 }), 'EXCESS_WORK_COUNT');
  assert.deepEqual(engine.snapshot(), before);
});

test('hour order and materialization cursor enforce exactly-once position accrual', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  cmd(engine, 'openHour', 'crank', { now: at(2), hour: 0n });
  expectCode(() => cmd(engine, 'openHour', 'crank', { now: at(2), hour: 1n }), 'HOUR_ORDER');
  cmd(engine, 'scanHour', 'crank', { now: at(2), hour: 0n, expectedPhase: 'ROOT_SCAN', expectedCursor: 0n, workCount: 1 });
  cmd(engine, 'materializeHour', 'crank', { now: at(2), hour: 0n, expectedCursor: 0n, rootCount: 1 });
  expectCode(() => cmd(engine, 'materializeHour', 'another', { now: at(2), hour: 0n, expectedCursor: 0n, rootCount: 1 }), 'HOUR_ORDER');
});

test('interrupted multi-batch settlement resumes from durable cursor without loss or duplicate floor', () => {
  let engine = fresh();
  const positions = [];
  for (let n = 0; n < 11; n += 1) {
    engine.createVerifiedRoot(component(`p${n}`));
    positions.push(cmd(engine, 'register', 'alice', { instance: `p${n}`, now: 0n }).intervalId);
  }
  cmd(engine, 'openHour', 'crank', { now: at(3), hour: 0n });
  cmd(engine, 'scanHour', 'crank', { now: at(3), hour: 0n, expectedPhase: 'ROOT_SCAN', expectedCursor: 0n, workCount: 8 });
  engine = SettlementEngine.fromSnapshot(engine.snapshot());
  cmd(engine, 'scanHour', 'crank', { now: at(3), hour: 0n, expectedPhase: 'ROOT_SCAN', expectedCursor: 8n, workCount: 3 });
  cmd(engine, 'materializeHour', 'crank', { now: at(3), hour: 0n, expectedCursor: 0n, rootCount: 8 });
  engine = SettlementEngine.fromSnapshot(engine.snapshot());
  cmd(engine, 'materializeHour', 'crank', { now: at(3), hour: 0n, expectedCursor: 8n, rootCount: 3 });
  for (const id of positions) assert.equal(engine.position(id).accrued, 2_378n);
  assert.equal(engine.hour(0n).materializedSum, 26_158n);
  assert.equal(engine.ledger().pending, emissionPrefix(3n) - hourBudget(0n));
  settle(engine, 1n, at(3));
  settle(engine, 2n, at(3));
  assert.equal(engine.ledger().pending, 0n);
});

test('partial materialization may be claimed while fixed remaining liabilities stay pending', () => {
  const engine = fresh();
  const positions = [];
  for (const id of ['a', 'b']) {
    engine.createVerifiedRoot(component(id));
    positions.push(cmd(engine, 'register', 'alice', { instance: id, now: 0n }).intervalId);
  }
  cmd(engine, 'openHour', 'crank', { now: at(1), hour: 0n });
  cmd(engine, 'scanHour', 'crank', { now: at(1), hour: 0n, expectedPhase: 'ROOT_SCAN', expectedCursor: 0n, workCount: 2 });
  cmd(engine, 'materializeHour', 'crank', { now: at(1), hour: 0n, expectedCursor: 0n, rootCount: 1 });
  cmd(engine, 'claimPosition', 'relayer', { now: at(1), intervalId: positions[0], expectedPaid: 0n,
    upToAccrued: 2_378n, destinationOwner: 'alice' });
  assert.equal(engine.ledger().pending, hourBudget(0n) - 2_378n);
  cmd(engine, 'materializeHour', 'crank', { now: at(1), hour: 0n, expectedCursor: 1n, rootCount: 1 });
  assert.equal(engine.ledger().certified, 2_378n);
  assert.equal(engine.ledger().pending, 0n);
});

test('claim cannot redirect to payer, exceed accrued, or silently include new hourly accrual', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const registration = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  settle(engine, 0n);
  expectCode(() => cmd(engine, 'claimPosition', 'bob', { now: at(1), intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 470_890n, destinationOwner: 'bob' }), 'BENEFICIARY_DESTINATION');
  expectCode(() => cmd(engine, 'claimPosition', 'alice', { now: at(1), intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 470_891n, destinationOwner: 'alice' }), 'UNACCRUED_CLAIM');
  settle(engine, 1n);
  cmd(engine, 'claimPosition', 'alice', { now: at(2), intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 470_890n, destinationOwner: 'alice' });
  assert.equal(engine.balance('alice'), 470_890n);
  assert.ok(engine.ledger().certified > 0n);
});

test('wallet switch cannot change a position beneficiary or replay a stale paid checkpoint', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  const registration = cmd(engine, 'register', 'alice', { instance: 'p', now: 0n, beneficiary: 'charlie' });
  settle(engine, 0n);
  cmd(engine, 'claimPosition', 'relayer1', { now: at(1), intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 2_378n, destinationOwner: 'charlie' });
  expectCode(() => cmd(engine, 'claimPosition', 'relayer2', { now: at(1), intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 2_378n, destinationOwner: 'charlie' }), 'PAID_CAS');
  assert.equal(engine.balance('charlie'), 2_378n);
});

test('paid balance is required for manufacturing burn; donations never recreate mining budget', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const registration = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  settle(engine, 0n);
  expectCode(() => cmd(engine, 'burnManufacture', 'alice', { amount: 1n, now: at(1) }), 'ARITHMETIC');
  cmd(engine, 'claimPosition', 'alice', { now: at(1), intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 470_890n, destinationOwner: 'alice' });
  cmd(engine, 'burnManufacture', 'alice', { amount: 100n, now: at(1) });
  const before = engine.ledger();
  cmd(engine, 'donateToReserve', 'alice', { amount: 50n, now: at(1) });
  const after = engine.ledger();
  assert.equal(after.burned, 100n);
  assert.equal(after.manufactureBurned, 100n);
  assert.equal(after.inbound, 50n);
  assert.equal(after.pending, before.pending);
  assert.equal(after.certified, before.certified);
  assert.equal(after.F, before.F);
  assert.equal(after.total, TOTAL_SUPPLY);
});

test('snapshot is detached; malformed stored balances fail audit instead of minting debt', () => {
  const engine = fresh();
  const snapshot = engine.snapshot();
  snapshot.treasury.certified = 1n;
  assert.equal(engine.ledger().certified, 0n);
  expectCode(() => SettlementEngine.fromSnapshot(snapshot), 'ARITHMETIC');
  assert.equal(engine.assertInvariants(), true);
});

test('closed reward domain has finite tail, rejects new stake and avoids infinite accounting', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'sync', 'crank', { now: at(H_END + 100n) });
  assert.equal(engine.ledger().F, 0n);
  assert.equal(engine.ledger().pending, ALLOCATED_SUPPLY);
  expectCode(() => cmd(engine, 'register', 'alice', { instance: 'p', now: at(H_END + 100n) }), 'REWARD_DOMAIN_CLOSED');
  expectCode(() => cmd(engine, 'openHour', 'crank', { hour: H_END, now: at(H_END + 100n) }), 'HOUR_NOT_DUE_OR_DOMAIN');
});

test('sum floor is not floor sum; aggregation does not silently increase component rewards', () => {
  const budget = hourBudget(0n);
  const w = normalWeight(component('p'));
  assert.equal(rewardAmount(budget, w, W_FLOOR) * 60n, 142_680n);
  assert.equal(rewardAmount(budget, w * 60n, W_FLOOR), 142_694n);
  assert.equal(denominator(0n), W_FLOOR);
});

test('halt recovery across an epoch boundary keeps each original hourly floor', () => {
  let engine = fresh();
  engine.createVerifiedRoot(bio());
  const startHour = HOURS_PER_EPOCH - 2n;
  const registration = cmd(engine, 'register', 'alice', { instance: 'bio', now: at(startHour) });
  assert.equal(registration.start, HOURS_PER_EPOCH - 1n);
  // The one-time initial empty prefix proves all earlier hours had no roots.
  const resumeNow = at(HOURS_PER_EPOCH + 2n);
  settle(engine, startHour, resumeNow);
  engine = SettlementEngine.fromSnapshot(engine.snapshot());
  for (let h = startHour + 1n; h <= HOURS_PER_EPOCH + 1n; h += 1n) settle(engine, h, resumeNow);
  const expected = [HOURS_PER_EPOCH - 1n, HOURS_PER_EPOCH, HOURS_PER_EPOCH + 1n]
    .reduce((sum, h) => sum + rewardAmount(hourBudget(h), normalWeight(bio()), W_FLOOR), 0n);
  assert.equal(engine.position(registration.intervalId).accrued, expected);
  assert.equal(engine.ledger().pending, 0n);
  assert.equal(engine.ledger().total, TOTAL_SUPPLY);
});

test('a fault flag remains independent of earlier transfer revocation', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  cmd(engine, 'transfer', 'alice', { instance: 'p', newOwner: 'bob', now: 0n });
  engine.invalidateCertificate({ instance: 'p', now: 0n, faultReference: 'real-fault' });
  const state = engine.snapshot().registrations.get('p');
  assert.equal(state.revoked.reason, 'TRANSFER');
  assert.equal(state.certificateFault, true);
  expectCode(() => cmd(engine, 'register', 'bob', { instance: 'p', now: 0n }), 'CERTIFICATE_INVALID');
});

test('input synthesis preserves historical beneficiary debt after the source disappears', () => {
  const engine = fresh();
  engine.createVerifiedRoot(component('p'));
  const registration = cmd(engine, 'register', 'alice', { instance: 'p', now: 0n });
  cmd(engine, 'exit', 'alice', { instance: 'p', seq: 0n, now: T });
  settle(engine, 0n);
  cmd(engine, 'consume', 'alice', { instances: ['p'], outputInstance: 'cell',
    outputFacts: { instance: 'cell', owner: 'alice', scope: 'CELL', B_int: 120_000n,
      q_ppm: 1_000_000n, certificate: 'trusted-upstream-cell' }, now: at(1) });
  assert.equal(engine.root('p').status, 'CONSUMED');
  cmd(engine, 'claimPosition', 'relayer', { intervalId: registration.intervalId,
    expectedPaid: 0n, upToAccrued: 2_378n, destinationOwner: 'alice', now: at(1) });
  assert.equal(engine.balance('alice'), 2_378n);
});

test('historical winner survives author sale; current K eligibility remains revoked', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  engine.acceptFrontier({ cost: 320n, now: 0n });
  cmd(engine, 'transfer', 'alice', { instance: 'bio', newOwner: 'bob', now: 0n });
  engine.acceptWinner({ winnerId: 'historical-winner', instance: 'bio', author: 'alice', cost: 320n });
  assert.equal(engine.snapshot().winners.get('historical-winner').author, 'alice');
  expectCode(() => cmd(engine, 'activateK', 'alice', {
    instance: 'bio', winnerId: 'historical-winner', now: 0n }), 'OWNER_REQUIRED');
});

test('finite task pause and audited frontier recovery stop K, preserve ordinary debt, and never auto-reactivate', () => {
  const engine = fresh();
  engine.createVerifiedRoot(bio());
  const position = cmd(engine, 'register', 'alice', { instance: 'bio', now: 0n });
  engine.acceptFrontier({ cost: 320n, now: 0n });
  engine.acceptWinner({ winnerId: 'w', instance: 'bio', author: 'alice', cost: 320n });
  cmd(engine, 'activateK', 'alice', { instance: 'bio', winnerId: 'w', now: 0n });
  engine.pauseTask({ now: T, faultReference: 'proof1' });
  settle(engine, 0n);
  expectCode(() => engine.recoverTaskFrontier({ now: at(1), faultReference: 'different', bestCost: 321n }), 'SAFETY_PROOF_MISMATCH');
  engine.recoverTaskFrontier({ now: at(1), faultReference: 'proof1', bestCost: 321n });
  assert.equal(engine.snapshot().activations.size, 1);
  assert.equal(engine.snapshot().taskPaused, false);
  assert.equal(engine.position(position.intervalId).accrued, 856_164n);
});
