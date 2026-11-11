import { createHash } from 'node:crypto';
import {
  requireThat, u64, u128, time, add64, add128, sub64, min, max,
} from './arithmetic.mjs';
import {
  TOTAL_SUPPLY, ALLOCATED_SUPPLY, GENESIS_SEALED, H_END,
  HOUR_SECONDS, emissionPrefix, hourBudget, completedHours, nextStakeHour,
} from './emission.mjs';
import { normalWeight, denominator, rewardAmount, K_WEIGHT } from './weights.mjs';

const clone = (value) => structuredClone(value);
const index = (value) => {
  u64(value);
  requireThat(value <= BigInt(Number.MAX_SAFE_INTEGER), 'HOST_INDEX_LIMIT');
  return Number(value);
};
const count = (value, allowZero = false) => {
  requireThat(Number.isInteger(value) && value >= (allowZero ? 0 : 1) && value <= 8, 'BATCH_COUNT');
  return value;
};
const textId = (value, name = 'identifier') => {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 256, 'INVALID_ID', name);
  return value;
};
const stable = (value) => {
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  if (value === null) return ['null'];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number') {
    requireThat(Number.isSafeInteger(value), 'NONCANONICAL_REQUEST');
    return ['integer', value];
  }
  if (Array.isArray(value)) return ['array', value.map(stable)];
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'NONCANONICAL_REQUEST');
  return ['object', Object.keys(value).sort().map((key) => [key, stable(value[key])])];
};
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const intervalId = (instance, seq) => digest(['SETTLE2/interval', instance, seq]);
const activationId = (instance, seq) => digest(['SETTLE2/activation', instance, seq]);
const active = (interval, h) => interval && interval.start <= h && (interval.end === null || h < interval.end);
const effectiveEnd = (interval) => min(interval.end ?? H_END, H_END);

/**
 * Exact-integer executable reference state machine, NOT an on-chain program.
 * createVerifiedRoot/acceptFrontier/acceptWinner/invalidateCertificate are
 * trusted integration entry points; they do not themselves verify certificates.
 * Native signatures, AccountInfo/PDA/Token validation and persistence are outside
 * this package. User/crank commands require per-actor strict nonce sequencing.
 */
export class SettlementEngine {
  #state;
  #prepared = false;

  constructor({ rewardStart, saleStart = 0n }) {
    time(rewardStart); time(saleStart);
    requireThat(saleStart <= rewardStart, 'INVALID_CLOCK_CONFIGURATION');
    this.#state = {
      version: 'ECON-SETTLE4/1', rewardStart, saleStart,
      registry: { roots: [], kHistory: [], kScanSeq: 0n, nextMaterializeHour: 0n, highWater: 0n },
      roots: new Map(), registrations: new Map(), intervals: new Map(),
      activations: new Map(), hours: new Map(), actors: new Map(),
      winners: new Map(), bestCost: null, taskPaused: false, taskPauseReference: null,
      treasury: {
        F: ALLOCATED_SUPPLY, pending: 0n, certified: 0n, sealed: GENESIS_SEALED,
        manufactureBurned: 0n, asOf: 0n, paidTotal: 0n,
      },
      supply: TOTAL_SUPPLY, reserve: TOTAL_SUPPLY, balances: new Map(),
    };
  }

  /** Detached trusted checkpoint. It is not a cryptographic state proof. */
  snapshot() { return clone(this.#state); }

  static fromSnapshot(snapshot) {
    requireThat(['ECON-SETTLE2/1', 'ECON-SETTLE4/1'].includes(snapshot?.version), 'SNAPSHOT_VERSION');
    const engine = new SettlementEngine(snapshot);
    engine.#state = clone(snapshot);
    // Explicit host checkpoint migration, not an on-chain account relabel.
    if (snapshot.version === 'ECON-SETTLE2/1') {
      engine.#state.version = 'ECON-SETTLE4/1';
      for (const record of engine.#state.hours.values()) record.lazy = false;
    }
    engine.assertInvariants();
    return engine;
  }

  nextNonce(actor) { return this.#state.actors.get(textId(actor))?.nextNonce ?? 0n; }

  /**
   * Integration ONLY: call inside the core's authorized executeAtomic transition.
   * The core owns the sole actor nonce state; this path never reads/writes ours.
   * `actor` must be taken from the verified ExactFrame, not arbitrary payload.
   */
  executePrepared(command, request) {
    const commands = new Set(['sync', 'register', 'exit', 'transfer', 'consume',
      'activateK', 'openHour', 'scanHour', 'advanceFrozenHour', 'materializeHour', 'materializePosition', 'claimPosition',
      'burnManufacture', 'donateToReserve']);
    requireThat(commands.has(command) && !this.#prepared, 'INVALID_PREPARED_COMMAND');
    this.#prepared = true;
    try { return this[command](request); } finally { this.#prepared = false; }
  }
  root(instance) { return clone(this.#getRoot(instance)); }
  position(id) {
    const position = this.#state.intervals.get(textId(id));
    requireThat(position, 'UNKNOWN_POSITION');
    return clone(position);
  }
  hour(h) { u64(h); return clone(this.#state.hours.get(h) ?? null); }
  balance(beneficiary) { return this.#state.balances.get(textId(beneficiary)) ?? 0n; }

  #atomic(fn) {
    const before = this.#state;
    this.#state = clone(before);
    try {
      const result = fn();
      this.assertInvariants();
      return clone(result);
    } catch (error) {
      this.#state = before;
      throw error;
    }
  }

  #command(name, request, fn) {
    requireThat(request && Object.getPrototypeOf(request) === Object.prototype, 'NONCANONICAL_REQUEST');
    const { actor, nonce } = request;
    textId(actor, 'actor');
    if (this.#prepared) return this.#atomic(fn);
    u64(nonce, 'nonce');
    const fingerprint = digest([name, request]);
    const actorState = this.#state.actors.get(actor);
    const nextNonce = actorState?.nextNonce ?? 0n;
    if (nonce < nextNonce) {
      requireThat(nonce + 1n === nextNonce, 'ALREADY_PROCESSED');
      requireThat(actorState.lastDigest === fingerprint, 'NONCE_CONFLICT');
      return clone(actorState.lastResult);
    }
    requireThat(nonce === nextNonce, 'NONCE_GAP');
    return this.#atomic(() => {
      const result = fn();
      this.#state.actors.set(actor, {
        nextNonce: add64(nonce, 1n), lastDigest: fingerprint, lastResult: clone(result),
      });
      return result;
    });
  }

  #observe(now) {
    time(now);
    requireThat(now >= this.#state.registry.highWater, 'CLOCK_ROLLBACK');
    this.#state.registry.highWater = now;
  }

  #sync(now) {
    const treasury = this.#state.treasury;
    const boundary = completedHours(now, this.#state.rewardStart);
    requireThat(boundary >= treasury.asOf, 'CLOCK_ROLLBACK');
    const delta = emissionPrefix(boundary) - emissionPrefix(treasury.asOf);
    treasury.F = sub64(treasury.F, delta);
    treasury.pending = add64(treasury.pending, delta);
    treasury.asOf = boundary;
    return delta;
  }

  #getRoot(instance) {
    const root = this.#state.roots.get(textId(instance));
    requireThat(root, 'UNKNOWN_ROOT');
    return root;
  }

  #reg(instance) {
    let reg = this.#state.registrations.get(instance);
    if (!reg) {
      reg = { instance, intervals: [], settlementSeq: 0n, coverageSeq: 0n,
        directorySeq: null, activations: [], revoked: null, certificateFault: false };
      this.#state.registrations.set(instance, reg);
    }
    return reg;
  }

  #lastInterval(reg) {
    return reg.intervals.length ? this.#state.intervals.get(reg.intervals.at(-1)) : null;
  }

  #lastActivation(reg) {
    return reg.activations.length ? this.#state.activations.get(reg.activations.at(-1)) : null;
  }

  #ownLive(instance, actor) {
    const root = this.#getRoot(instance);
    requireThat(root.status === 'LIVE', 'ROOT_CONSUMED');
    requireThat(root.owner === actor, 'OWNER_REQUIRED');
    requireThat(!this.#state.registrations.get(instance)?.certificateFault, 'CERTIFICATE_INVALID');
    return root;
  }

  #emptyPrefix(now) {
    const state = this.#state;
    const registry = state.registry;
    requireThat(registry.roots.length === 0 && registry.kHistory.length === 0
      && registry.kScanSeq === 0n, 'EMPTY_PREFIX_NOT_PROVEN');
    this.#sync(now);
    const b = completedHours(now, state.rewardStart);
    const g = registry.nextMaterializeHour;
    requireThat(g <= b, 'HOUR_ORDER');
    const amount = emissionPrefix(b) - emissionPrefix(g);
    requireThat(state.treasury.certified === 0n && state.treasury.pending >= amount, 'EMPTY_PREFIX_LEDGER');
    const existing = state.hours.get(g);
    if (existing) {
      requireThat(g < b && existing.status === 'READY' && existing.rootCutoff === 0n
        && existing.kCutoff === 0n && existing.rootCursor === 0n
        && existing.materializeCursor === 0n && existing.members === 0n
        && existing.materializedCount === 0n && existing.materializedSum === 0n
        && existing.normalWeight === 0n && existing.k === null
        && existing.budget === hourBudget(g), 'EMPTY_PREFIX_HOUR');
      existing.status = 'FINAL';
      existing.sealedResidual = existing.budget;
    }
    state.treasury.pending = sub64(state.treasury.pending, amount);
    state.treasury.sealed = add64(state.treasury.sealed, amount);
    registry.nextMaterializeHour = b;
  }

  /** Trusted ingress after the upstream verifier and material burn commit. */
  createVerifiedRoot(facts) {
    return this.#atomic(() => this.#createRoot(facts));
  }

  #createRoot(facts) {
    const { instance, owner, scope, B_int, q_ppm, certificate } = facts;
    textId(instance); textId(owner); textId(certificate, 'verified certificate');
    requireThat(!this.#state.roots.has(instance), 'ROOT_ALREADY_EXISTS');
    const weight = normalWeight({ scope, B_int, q_ppm });
    const root = { instance, owner, originalOwner: owner, scope, B_int, q_ppm, certificate,
      weight, revision: 0n, status: 'LIVE', consumedInto: null };
    this.#state.roots.set(instance, root);
    return root;
  }

  sync(request) {
    return this.#command('SYNC', request, () => {
      this.#observe(request.now);
      this.#sync(request.now);
      return this.#state.treasury;
    });
  }

  register(request) {
    return this.#command('REGISTER', request, () => {
      const { actor, instance, now, beneficiary = actor } = request;
      this.#observe(now);
      requireThat(now >= this.#state.saleStart, 'SALE_NOT_OPEN');
      textId(beneficiary);
      const root = this.#ownLive(instance, actor);
      const start = nextStakeHour(now, this.#state.rewardStart);
      const reg = this.#reg(instance);
      const previous = this.#lastInterval(reg);
      requireThat(!previous || (previous.end !== null
        && completedHours(now, this.#state.rewardStart) >= effectiveEnd(previous)), 'ALREADY_STAKED_OR_PENDING');
      requireThat(!this.#lastActivation(reg) || this.#lastActivation(reg).end !== null, 'K_STILL_OPEN');
      if (this.#state.registry.roots.length === 0) this.#emptyPrefix(now);
      if (reg.directorySeq === null) {
        reg.directorySeq = BigInt(this.#state.registry.roots.length);
        this.#state.registry.roots.push(instance);
      }
      const seq = BigInt(reg.intervals.length);
      const id = intervalId(instance, seq);
      const interval = {
        id, instance, seq, directorySeq: reg.directorySeq, beneficiary,
        rootRevision: root.revision, weight: root.weight, start, end: null, endReason: null,
        accrued: 0n, paid: 0n, nextUnsettledHour: start,
      };
      this.#state.intervals.set(id, interval);
      reg.intervals.push(id);
      return { intervalId: id, start, weight: root.weight, seq, directorySeq: reg.directorySeq };
    });
  }

  #stopK(instance, end, reason) {
    const reg = this.#state.registrations.get(instance);
    if (!reg) return;
    const activation = this.#lastActivation(reg);
    if (activation && activation.end === null) {
      activation.end = max(activation.start, end);
      activation.endReason = reason;
    }
  }

  exit(request) {
    return this.#command('EXIT', request, () => {
      const { actor, instance, now, seq } = request;
      this.#observe(now);
      const root = this.#getRoot(instance);
      const reg = this.#state.registrations.get(instance);
      requireThat(reg, 'NOT_STAKED'); u64(seq);
      const interval = this.#state.intervals.get(reg.intervals[index(seq)]);
      requireThat(interval, 'UNKNOWN_POSITION');
      if (interval.end !== null) return { intervalId: interval.id, end: interval.end, reason: interval.endReason };
      requireThat(root.status === 'LIVE' && root.owner === actor, 'OWNER_REQUIRED');
      requireThat(interval === this.#lastInterval(reg), 'NOT_CURRENT_POSITION');
      requireThat(now >= this.#state.rewardStart + interval.start * HOUR_SECONDS, 'CANNOT_CANCEL_PENDING_STAKE');
      const end = u64((now - this.#state.rewardStart) / HOUR_SECONDS + 1n);
      interval.end = end;
      interval.endReason = 'VOLUNTARY';
      this.#stopK(instance, end, 'EXIT');
      return { intervalId: interval.id, end, reason: interval.endReason };
    });
  }

  #assertMovable(instance, now) {
    const root = this.#getRoot(instance);
    requireThat(root.status === 'LIVE', 'ROOT_CONSUMED');
    const reg = this.#state.registrations.get(instance);
    if (!reg) return;
    requireThat(!reg.certificateFault, 'CERTIFICATE_INVALID');
    // Usage locks keep their actual end boundary after the finite emission
    // domain. Only reward coverage is clamped to H_END.
    const b = now < this.#state.rewardStart ? 0n : (now - this.#state.rewardStart) / HOUR_SECONDS;
    for (const latest of [this.#lastInterval(reg), this.#lastActivation(reg)]) {
      requireThat(!latest || (latest.end !== null && b >= latest.end), 'STAKE_LOCKED');
    }
    requireThat(reg.coverageSeq === BigInt(reg.intervals.length), 'UNSETTLED_HISTORY');
  }

  assertCanConsume(instance, now) { time(now); this.#assertMovable(instance, now); return true; }

  transfer(request) {
    return this.#command('TRANSFER', request, () => {
      const { actor, instance, now, newOwner } = request;
      this.#observe(now); textId(newOwner);
      const root = this.#ownLive(instance, actor);
      requireThat(newOwner !== actor, 'SELF_TRANSFER');
      this.#assertMovable(instance, now);
      const reg = this.#reg(instance);
      reg.revoked ??= { reason: 'TRANSFER', time: now };
      root.owner = newOwner;
      root.revision = add64(root.revision, 1n);
      return { instance, owner: newOwner, revision: root.revision };
    });
  }

  /**
   * Trusted synthesis boundary: outputFacts must already be verified upstream.
   * Inputs and output commit together. Upstream material/burn state must share
   * the same enclosing protocol transaction; this is not a public free mint.
   */
  consume(request) {
    return this.#command('CONSUME', request, () => {
      const { actor, instances, outputInstance, outputFacts, now } = request;
      this.#observe(now); textId(outputInstance);
      requireThat(Array.isArray(instances) && instances.length > 0 && instances.length <= 6, 'INPUT_COUNT');
      requireThat(new Set(instances).size === instances.length && !instances.includes(outputInstance), 'DUPLICATE_INPUT');
      const roots = instances.map((instance) => {
        const root = this.#ownLive(instance, actor);
        this.#assertMovable(instance, now);
        return root;
      });
      requireThat(!this.#state.roots.has(outputInstance), 'OUTPUT_ALREADY_EXISTS');
      requireThat(outputFacts && outputFacts.instance === outputInstance && outputFacts.owner === actor,
        'OUTPUT_FACTS_REQUIRED');
      for (const root of roots) {
        const reg = this.#reg(root.instance);
        reg.revoked ??= { reason: 'CONSUMED', time: now };
        root.status = 'CONSUMED';
        root.consumedInto = outputInstance;
        root.revision = add64(root.revision, 1n);
      }
      this.#createRoot(outputFacts);
      return { consumed: instances, outputInstance };
    });
  }

  /** Trusted task verifier calls this for every strictly better admitted PASS. */
  acceptFrontier({ cost, now }) {
    return this.#atomic(() => {
      this.#observe(now); u64(cost);
      requireThat(cost > 0n, 'INVALID_COST');
      requireThat(this.#state.bestCost === null || cost < this.#state.bestCost, 'NOT_STRICTLY_BETTER');
      this.#state.bestCost = cost;
      const last = this.#state.registry.kHistory.at(-1);
      if (last) this.#stopK(this.#state.activations.get(last).instance,
        now < this.#state.rewardStart ? 0n : (now - this.#state.rewardStart) / HOUR_SECONDS + 1n,
        'OUTRANKED');
      return { bestCost: cost };
    });
  }

  /** Trusted round selection boundary, not a user claim that a design won. */
  acceptWinner({ winnerId, instance, author, cost }) {
    return this.#atomic(() => {
      textId(winnerId); textId(author); u64(cost);
      const root = this.#getRoot(instance);
      requireThat(root.scope === 'BIO' && root.q_ppm === 2_000_000n, 'WINNER_ROOT_QUALIFICATION');
      // Selection is historical. A later sale/consumption cannot erase the
      // selected author, while activateK still checks current owner and revoke.
      requireThat(root.originalOwner === author && !this.#state.winners.has(winnerId), 'WINNER_INVALID');
      requireThat(this.#state.bestCost !== null && cost >= this.#state.bestCost, 'FRONTIER_NOT_RECORDED');
      this.#state.winners.set(winnerId, { winnerId, instance, author, cost });
      return { winnerId, instance, author, cost };
    });
  }

  activateK(request) {
    return this.#command('ACTIVATE_K', request, () => {
      const { actor, instance, winnerId, now } = request;
      this.#observe(now);
      this.#ownLive(instance, actor);
      requireThat(!this.#state.taskPaused, 'TASK_PAUSED');
      const winner = this.#state.winners.get(textId(winnerId));
      requireThat(winner && winner.instance === instance && winner.author === actor
        && winner.cost === this.#state.bestCost, 'WINNER_NOT_CURRENT');
      const reg = this.#reg(instance);
      requireThat(!reg.revoked && !reg.certificateFault, 'K_PERMANENTLY_REVOKED');
      const ordinary = this.#lastInterval(reg);
      const start = nextStakeHour(now, this.#state.rewardStart);
      requireThat(ordinary && ordinary.end === null && ordinary.beneficiary === actor
        && ordinary.start <= start, 'ORDINARY_REQUIRED_FOR_K');
      const previousId = this.#state.registry.kHistory.at(-1);
      const previous = previousId ? this.#state.activations.get(previousId) : null;
      requireThat(!previous || (previous.end !== null && previous.end <= start && previous.start <= start), 'K_OVERLAP');
      const seq = BigInt(reg.activations.length);
      const id = activationId(instance, seq);
      const activation = { id, instance, seq, globalSeq: BigInt(this.#state.registry.kHistory.length),
        intervalId: ordinary.id, beneficiary: actor, winnerId, start, end: null, endReason: null };
      this.#state.activations.set(id, activation);
      this.#state.registry.kHistory.push(id);
      reg.activations.push(id);
      return { activationId: id, start, weight: K_WEIGHT };
    });
  }

  /** Trusted finite safety-proof hook, never an arbitrary administrator pause. */
  pauseTask({ now, faultReference }) {
    return this.#atomic(() => {
      this.#observe(now); textId(faultReference);
      const last = this.#state.registry.kHistory.at(-1);
      const end = now < this.#state.rewardStart ? 0n : (now - this.#state.rewardStart) / HOUR_SECONDS + 1n;
      if (last) this.#stopK(this.#state.activations.get(last).instance, end, 'TASK_PAUSE');
      this.#state.taskPaused = true;
      this.#state.taskPauseReference = faultReference;
      return { paused: true, faultReference };
    });
  }

  /**
   * Trusted caller must have replayed the entire accepted knowledge prefix and
   * passed its tail/epoch CAS. This cannot create an activation or change debt.
   */
  recoverTaskFrontier({ now, faultReference, bestCost }) {
    return this.#atomic(() => {
      this.#observe(now); textId(faultReference);
      requireThat(this.#state.taskPaused && this.#state.taskPauseReference === faultReference, 'SAFETY_PROOF_MISMATCH');
      if (bestCost !== null) requireThat(u64(bestCost) > 0n, 'INVALID_COST');
      this.#state.bestCost = bestCost;
      this.#state.taskPaused = false;
      return { paused: false, bestCost };
    });
  }

  /** Trusted deterministic fault result; missing data is not a certificate fault. */
  invalidateCertificate({ instance, now, faultReference }) {
    return this.#atomic(() => {
      this.#observe(now); textId(faultReference);
      this.#getRoot(instance);
      const reg = this.#reg(instance);
      if (reg.certificateFault) return { faultReference: reg.faultReference };
      reg.certificateFault = true;
      reg.faultReference = faultReference;
      reg.revoked ??= { reason: 'CERT_INVALID', time: now };
      const next = now < this.#state.rewardStart ? 0n : (now - this.#state.rewardStart) / HOUR_SECONDS + 1n;
      const ordinary = this.#lastInterval(reg);
      if (ordinary && ordinary.end === null) {
        ordinary.end = max(ordinary.start, next);
        ordinary.endReason = 'CERT_INVALID';
        if (ordinary.end === ordinary.start && reg.coverageSeq === ordinary.seq) reg.coverageSeq += 1n;
      }
      this.#stopK(instance, next, 'CERT_INVALID');
      return { faultReference };
    });
  }

  openHour(request) {
    return this.#command('OPEN_HOUR', request, () => {
      const { now, hour } = request;
      this.#observe(now); u64(hour);
      const registry = this.#state.registry;
      requireThat(hour < H_END && hour < completedHours(now, this.#state.rewardStart), 'HOUR_NOT_DUE_OR_DOMAIN');
      const existing = this.#state.hours.get(hour);
      if (existing) return { hour, status: existing.status, rootCutoff: existing.rootCutoff, budget: existing.budget };
      requireThat(hour === registry.nextMaterializeHour, 'HOUR_ORDER');
      this.#sync(now);
      const record = { hour, budget: hourBudget(hour), rootCutoff: BigInt(registry.roots.length),
        kCutoff: BigInt(registry.kHistory.length), rootCursor: 0n, materializeCursor: 0n,
        status: 'K_SCAN', lazy: false, members: 0n, materializedCount: 0n, normalWeight: 0n,
        k: null, totalWeight: 0n, denominator: 0n, materializedSum: 0n, sealedResidual: 0n };
      this.#state.hours.set(hour, record);
      this.#normalizePhase(record);
      return { hour, status: record.status, rootCutoff: record.rootCutoff, budget: record.budget };
    });
  }

  #normalizePhase(record) {
    if (record.status === 'K_SCAN' && this.#state.registry.kScanSeq === record.kCutoff) record.status = 'ROOT_SCAN';
    if (record.status === 'ROOT_SCAN' && record.rootCursor === record.rootCutoff) {
      record.totalWeight = add128(record.normalWeight, record.k ? K_WEIGHT : 0n);
      record.denominator = denominator(record.totalWeight);
      record.status = 'READY';
    }
  }

  scanHour(request) {
    return this.#command('SCAN_HOUR', request, () => {
      const { hour, now, expectedPhase, expectedCursor, workCount } = request;
      this.#observe(now); u64(hour); u64(expectedCursor); count(workCount);
      const record = this.#state.hours.get(hour);
      requireThat(record && hour === this.#state.registry.nextMaterializeHour, 'HOUR_ORDER');
      requireThat(record.status === expectedPhase && ['K_SCAN', 'ROOT_SCAN'].includes(expectedPhase), 'HOUR_PHASE');
      const cursor = expectedPhase === 'K_SCAN' ? this.#state.registry.kScanSeq : record.rootCursor;
      requireThat(cursor === expectedCursor, 'SCAN_CURSOR');
      for (let step = 0; step < workCount; step += 1) {
        requireThat(['K_SCAN', 'ROOT_SCAN'].includes(record.status), 'EXCESS_WORK_COUNT');
        if (record.status === 'K_SCAN') this.#scanK(record);
        else this.#scanRoot(record);
        this.#normalizePhase(record);
      }
      return { hour, status: record.status, cursor: record.status === 'K_SCAN'
        ? this.#state.registry.kScanSeq : record.rootCursor,
      members: record.members, totalWeight: record.totalWeight };
    });
  }

  #scanK(record) {
    const registry = this.#state.registry;
    requireThat(registry.kScanSeq < record.kCutoff, 'K_CURSOR');
    const activation = this.#state.activations.get(registry.kHistory[index(registry.kScanSeq)]);
    requireThat(activation && activation.globalSeq === registry.kScanSeq, 'DIRECTORY_CORRUPT');
    if (activation.end !== null && activation.end <= record.hour) {
      registry.kScanSeq += 1n;
      return;
    }
    if (active(activation, record.hour)) {
      const ordinary = this.#state.intervals.get(activation.intervalId);
      requireThat(active(ordinary, record.hour) && ordinary.instance === activation.instance
        && ordinary.beneficiary === activation.beneficiary
        && ordinary.directorySeq < record.rootCutoff, 'INVALID_K_ORDINARY');
      record.k = { activationId: activation.id, instance: activation.instance,
        beneficiary: activation.beneficiary, intervalId: activation.intervalId };
    }
    record.status = 'ROOT_SCAN';
  }

  #scanRoot(record) {
    const instance = this.#state.registry.roots[index(record.rootCursor)];
    const reg = this.#state.registrations.get(instance);
    requireThat(reg && reg.directorySeq === record.rootCursor, 'DIRECTORY_CORRUPT');
    const interval = this.#state.intervals.get(reg.intervals[index(reg.settlementSeq)]);
    if (interval && interval.end !== null && interval.end <= record.hour) {
      if (interval.end === interval.start) {
        requireThat(interval.endReason === 'CERT_INVALID', 'INVALID_ZERO_INTERVAL');
        if (reg.coverageSeq === interval.seq) reg.coverageSeq += 1n;
      }
      reg.settlementSeq += 1n;
      return;
    }
    const isActive = active(interval, record.hour);
    if (isActive) {
      record.members = add64(record.members, 1n);
      record.normalWeight = add128(record.normalWeight, interval.weight);
    }
    if (record.k?.instance === instance) {
      requireThat(isActive && record.k.intervalId === interval.id
        && record.k.beneficiary === interval.beneficiary, 'INVALID_K_ORDINARY');
    }
    record.rootCursor += 1n;
  }

  materializeHour(request) {
    return this.#command('MATERIALIZE_HOUR', request, () => {
      const { now, hour, expectedCursor, rootCount } = request;
      this.#observe(now); u64(hour); u64(expectedCursor);
      const record = this.#state.hours.get(hour);
      requireThat(record && !record.lazy && hour === this.#state.registry.nextMaterializeHour, 'HOUR_ORDER');
      requireThat(['READY', 'MATERIALIZING'].includes(record.status), 'HOUR_PHASE');
      requireThat(expectedCursor === record.materializeCursor, 'MATERIALIZE_CURSOR');
      count(rootCount, record.rootCutoff === 0n);
      requireThat(record.materializeCursor + BigInt(rootCount) <= record.rootCutoff
        && (rootCount > 0 || record.rootCutoff === 0n), 'BATCH_COUNT');
      this.#sync(now);
      for (let n = 0; n < rootCount; n += 1) {
        const instance = this.#state.registry.roots[index(record.materializeCursor)];
        const reg = this.#state.registrations.get(instance);
        const interval = this.#state.intervals.get(reg.intervals[index(reg.settlementSeq)]);
        if (active(interval, hour)) {
          requireThat(reg.coverageSeq === interval.seq && interval.nextUnsettledHour === hour, 'COVERAGE_SEQUENCE');
          this.#accrue(record, interval, reg);
        }
        record.materializeCursor += 1n;
      }
      record.status = 'MATERIALIZING';
      if (record.materializeCursor === record.rootCutoff) {
        requireThat(record.materializedCount === record.members
          && record.materializedSum <= record.budget, 'MATERIALIZATION_COUNT');
        record.sealedResidual = record.budget - record.materializedSum;
        this.#state.treasury.pending = sub64(this.#state.treasury.pending, record.sealedResidual);
        this.#state.treasury.sealed = add64(this.#state.treasury.sealed, record.sealedResidual);
        record.status = 'FINAL';
        this.#state.registry.nextMaterializeHour = hour + 1n;
      }
      return { hour, status: record.status, cursor: record.materializeCursor,
        materializedCount: record.materializedCount, materializedSum: record.materializedSum,
        sealedResidual: record.sealedResidual };
    });
  }

  /** Freeze frontier progress without allocating anyone's outstanding budget.
   * This host oracle still scans roots to independently derive the denominator;
   * native ECON4 uses its ordered event/active membership cache instead. */
  advanceFrozenHour(request) {
    return this.#command('ADVANCE_FROZEN_HOUR', request, () => {
      const { now, hour } = request;
      this.#observe(now); u64(hour);
      const record = this.#state.hours.get(hour), registry = this.#state.registry;
      requireThat(record && hour === registry.nextMaterializeHour, 'HOUR_ORDER');
      requireThat(hour < completedHours(now, this.#state.rewardStart), 'HOUR_NOT_DUE_OR_DOMAIN');
      requireThat(!record.lazy && ['READY', 'MATERIALIZING'].includes(record.status), 'HOUR_PHASE');
      record.lazy = true;
      // Legacy traversal counted historical inactive directory entries too.
      // In lazy mode the CAS cursor counts only actually allocated members.
      record.materializeCursor = record.materializedCount;
      registry.nextMaterializeHour = add64(hour, 1n);
      return { hour, nextHour: registry.nextMaterializeHour };
    });
  }

  #accrue(record, interval, reg) {
    const hour = record.hour;
    requireThat(active(interval, hour) && reg.coverageSeq === interval.seq
      && interval.nextUnsettledHour === hour, 'COVERAGE_SEQUENCE');
    const combinedWeight = add128(interval.weight, record.k?.instance === interval.instance ? K_WEIGHT : 0n);
    if (record.k?.instance === interval.instance) requireThat(record.k.intervalId === interval.id
      && record.k.beneficiary === interval.beneficiary, 'INVALID_K_ORDINARY');
    const amount = rewardAmount(record.budget, combinedWeight, record.denominator);
    interval.accrued = add64(interval.accrued, amount);
    interval.nextUnsettledHour = hour + 1n;
    if (interval.nextUnsettledHour === effectiveEnd(interval)) {
      reg.coverageSeq += 1n;
      // Fault-cancelled zero-length intervals earn nothing and cannot block
      // a later real interval after the previous history finally catches up.
      while (reg.coverageSeq < BigInt(reg.intervals.length)) {
        const next = this.#state.intervals.get(reg.intervals[index(reg.coverageSeq)]);
        if (next.end !== next.start || next.endReason !== 'CERT_INVALID') break;
        reg.coverageSeq += 1n;
      }
    }
    this.#state.treasury.pending = sub64(this.#state.treasury.pending, amount);
    this.#state.treasury.certified = add64(this.#state.treasury.certified, amount);
    record.materializedCount = add64(record.materializedCount, 1n);
    record.materializedSum = add64(record.materializedSum, amount);
  }

  /** One actual historical Position; current membership may already be ended.
   * Empty lazy hours use intervalId:null and still need explicit finalization. */
  materializePosition(request) {
    return this.#command('MATERIALIZE_POSITION', request, () => {
      const { now, hour, expectedCursor, intervalId: id } = request;
      this.#observe(now); u64(hour); u64(expectedCursor);
      const record = this.#state.hours.get(hour);
      requireThat(record?.lazy && hour < this.#state.registry.nextMaterializeHour, 'HOUR_ORDER');
      requireThat(['READY', 'MATERIALIZING'].includes(record.status), 'HOUR_PHASE');
      requireThat(expectedCursor === record.materializeCursor, 'MATERIALIZE_CURSOR');
      this.#sync(now);
      if (record.members > 0n) {
        requireThat(record.materializedCount < record.members, 'MATERIALIZATION_COUNT');
        const interval = this.#state.intervals.get(textId(id));
        requireThat(interval && interval.directorySeq < record.rootCutoff, 'UNKNOWN_POSITION');
        const reg = this.#state.registrations.get(interval.instance);
        requireThat(reg && reg.intervals[index(interval.seq)] === id
          && reg.directorySeq === interval.directorySeq, 'DIRECTORY_CORRUPT');
        this.#accrue(record, interval, reg);
        record.materializeCursor += 1n;
      } else requireThat(id === null && expectedCursor === 0n, 'EMPTY_POSITION');
      record.status = 'MATERIALIZING';
      if (record.materializedCount === record.members) {
        record.sealedResidual = sub64(record.budget, record.materializedSum);
        this.#state.treasury.pending = sub64(this.#state.treasury.pending, record.sealedResidual);
        this.#state.treasury.sealed = add64(this.#state.treasury.sealed, record.sealedResidual);
        record.status = 'FINAL';
      }
      return { hour, status: record.status, cursor: record.materializeCursor,
        materializedCount: record.materializedCount, materializedSum: record.materializedSum,
        sealedResidual: record.sealedResidual };
    });
  }

  claimPosition(request) {
    return this.#command('CLAIM_POSITION', request, () => {
      const { now, intervalId: id, expectedPaid, upToAccrued, destinationOwner } = request;
      this.#observe(now); textId(destinationOwner); u64(expectedPaid); u64(upToAccrued);
      const interval = this.#state.intervals.get(textId(id));
      requireThat(interval, 'UNKNOWN_POSITION');
      requireThat(interval.beneficiary === destinationOwner, 'BENEFICIARY_DESTINATION');
      requireThat(interval.paid === expectedPaid, 'PAID_CAS');
      requireThat(upToAccrued >= expectedPaid && upToAccrued <= interval.accrued, 'UNACCRUED_CLAIM');
      this.#sync(now);
      const amount = upToAccrued - expectedPaid;
      this.#state.reserve = sub64(this.#state.reserve, amount);
      this.#state.treasury.certified = sub64(this.#state.treasury.certified, amount);
      this.#state.treasury.paidTotal = add64(this.#state.treasury.paidTotal, amount);
      interval.paid = upToAccrued;
      this.#state.balances.set(destinationOwner, add64(this.balance(destinationOwner), amount));
      return { intervalId: id, beneficiary: destinationOwner, amount, paid: interval.paid, accrued: interval.accrued };
    });
  }

  /** Token-adapter equivalent for actual paid wallet funds, never pending debt. */
  burnManufacture(request) {
    return this.#command('BURN_MANUFACTURE', request, () => {
      const { actor, amount, now } = request;
      this.#observe(now); u64(amount);
      this.#state.balances.set(actor, sub64(this.balance(actor), amount));
      this.#state.supply = sub64(this.#state.supply, amount);
      this.#state.treasury.manufactureBurned = add64(this.#state.treasury.manufactureBurned, amount);
      return { amount, supply: this.#state.supply };
    });
  }

  /** Passive LAB transfer to reserve creates no new entitlement or budget. */
  donateToReserve(request) {
    return this.#command('DONATE_TO_RESERVE', request, () => {
      const { actor, amount, now } = request;
      this.#observe(now); u64(amount);
      this.#state.balances.set(actor, sub64(this.balance(actor), amount));
      this.#state.reserve = add64(this.#state.reserve, amount);
      return { amount, reserve: this.#state.reserve };
    });
  }

  ledger() {
    const { treasury: t, reserve, supply } = this.#state;
    const burned = TOTAL_SUPPLY - supply;
    const circulating = supply - reserve;
    const inbound = reserve - t.F - t.pending - t.certified - t.sealed;
    return { ...clone(t), reserve, supply, burned, circulating, inbound,
      total: t.F + t.pending + t.certified + t.sealed + inbound + circulating + burned };
  }

  /** Expensive host audit, not a Solana execution-cost claim. */
  assertInvariants() {
    const state = this.#state;
    const ledger = this.ledger();
    for (const [key, value] of Object.entries(ledger)) u64(value, key);
    requireThat(ledger.total === TOTAL_SUPPLY && ledger.manufactureBurned <= ledger.burned, 'TREASURY_INVARIANT');
    requireThat(state.treasury.asOf <= H_END && state.registry.nextMaterializeHour <= H_END, 'REWARD_DOMAIN');
    requireThat(state.treasury.F === ALLOCATED_SUPPLY - emissionPrefix(state.treasury.asOf), 'PREFIX_INVARIANT');
    requireThat(new Set(state.registry.roots).size === state.registry.roots.length, 'DUPLICATE_ROOT_DIRECTORY');
    requireThat(state.registry.kScanSeq <= BigInt(state.registry.kHistory.length), 'K_CURSOR');
    let unpaid = 0n;
    for (const [instance, reg] of state.registrations) {
      requireThat(reg.instance === instance && state.roots.has(instance), 'REGISTRATION_INVARIANT');
      requireThat(reg.coverageSeq <= BigInt(reg.intervals.length)
        && reg.settlementSeq <= BigInt(reg.intervals.length), 'COVERAGE_SEQUENCE');
      requireThat((reg.directorySeq === null) === (reg.intervals.length === 0), 'DIRECTORY_CORRUPT');
      if (reg.directorySeq !== null) requireThat(state.registry.roots[index(reg.directorySeq)] === instance, 'DIRECTORY_CORRUPT');
      let previousEnd = null;
      for (let n = 0; n < reg.intervals.length; n += 1) {
        const interval = state.intervals.get(reg.intervals[n]);
        requireThat(interval && interval.id === intervalId(instance, BigInt(n)) && interval.seq === BigInt(n)
          && interval.instance === instance && interval.directorySeq === reg.directorySeq, 'POSITION_INVARIANT');
        requireThat(n === 0 || (previousEnd !== null && previousEnd <= interval.start), 'INTERVAL_OVERLAP');
        requireThat(interval.end === null || interval.end >= interval.start, 'INTERVAL_BOUNDARY');
        requireThat(interval.paid <= interval.accrued && interval.nextUnsettledHour >= interval.start
          && interval.nextUnsettledHour <= effectiveEnd(interval), 'POSITION_INVARIANT');
        unpaid = add64(unpaid, interval.accrued - interval.paid);
        previousEnd = interval.end;
      }
    }
    requireThat(unpaid === state.treasury.certified, 'CERTIFIED_INVARIANT');
    let walletTotal = 0n;
    for (const amount of state.balances.values()) walletTotal = add64(walletTotal, amount);
    requireThat(walletTotal === ledger.circulating, 'TOKEN_BALANCE_INVARIANT');
    let previousActivation = null;
    for (let n = 0; n < state.registry.kHistory.length; n += 1) {
      const activation = state.activations.get(state.registry.kHistory[n]);
      requireThat(activation && activation.globalSeq === BigInt(n), 'K_DIRECTORY_INVARIANT');
      requireThat(!previousActivation || (previousActivation.end !== null
        && previousActivation.end <= activation.start), 'K_OVERLAP');
      requireThat(activation.end === null || activation.end >= activation.start, 'K_BOUNDARY');
      previousActivation = activation;
    }
    for (const [h, record] of state.hours) {
      requireThat(typeof record.lazy === 'boolean' && (!record.lazy || (h < state.registry.nextMaterializeHour
        && record.materializeCursor === record.materializedCount)), 'HOUR_LAZY_INVARIANT');
      requireThat(record.hour === h && h < H_END && record.budget === hourBudget(h), 'HOUR_INVARIANT');
      requireThat(record.rootCursor <= record.rootCutoff && record.materializeCursor <= record.rootCutoff
        && record.rootCutoff <= BigInt(state.registry.roots.length)
        && record.materializedCount <= record.members && record.materializedSum <= record.budget, 'HOUR_INVARIANT');
      if (['READY', 'MATERIALIZING', 'FINAL'].includes(record.status)) {
        requireThat(record.totalWeight === record.normalWeight + (record.k ? K_WEIGHT : 0n)
          && record.denominator === denominator(record.totalWeight), 'DENOMINATOR_INVARIANT');
      }
      if (record.status === 'FINAL') requireThat(record.materializedCount === record.members
        && record.sealedResidual + record.materializedSum === record.budget, 'HOUR_CONSERVATION');
    }
    // Unopened future hours remain pending; advanced unfinished old snapshots
    // retain their complete unallocated balance. No current owner can take it.
    let expectedPending = emissionPrefix(state.treasury.asOf)
      - emissionPrefix(state.registry.nextMaterializeHour);
    for (const [h, record] of state.hours) {
      if (h < state.registry.nextMaterializeHour && record.status !== 'FINAL')
        expectedPending += record.budget - record.materializedSum;
      else if (h >= state.registry.nextMaterializeHour)
        expectedPending -= record.materializedSum;
    }
    requireThat(expectedPending === state.treasury.pending, 'PENDING_HOUR_INVARIANT');
    return true;
  }
}
