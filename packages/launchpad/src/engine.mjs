import { ByteWriter, asBytes, equalBytes, integer, I64_MAX, U64_MAX, ERRORS as E, invariant,
  executeAtomic, projectId, typedHash, catalogHash, encodeProjectBody, decodeProjectBody } from '../../protocol-core/src/index.mjs';
import { CREATE_FEE, RESOURCE_FEE_PER_UNIT, MAX_UNIT_PRICE, SEASON_CAPS, LIFETIME_CAPS,
  decodeCreatePayload, decodeBuyPayload, decodeQueuePayload, decodePayPayload } from './codec.mjs';

const hex = (v) => asBytes(v, 32).toString('hex');
const zero = () => Buffer.alloc(32);
const nonzero = (v) => asBytes(v, 32).some((b) => b !== 0);
export const MATERIAL_WINDOW_SECONDS = 788400000n;
export function materialSeason(now, openAt) {
  const t = integer(now, 0n, I64_MAX), open = integer(openAt, 0n, I64_MAX);
  integer(open + MATERIAL_WINDOW_SECONDS, 0n, I64_MAX, 'material window end');
  invariant(t >= open && t < open + MATERIAL_WINDOW_SECONDS, 6311, 'outside material issuance window');
  const delta = t - open, year = delta / 31536000n, r = delta % 31536000n;
  return Number(year * 4n + (r < 7862400n ? 0n : r < 15724800n ? 1n : r < 23587200n ? 2n : 3n));
}
export function quotaKey(domain, scope, classId, season) {
  invariant([1, 2].includes(scope) && [1, 2, 3, 4].includes(classId), 6313, 'invalid quota scope or class');
  invariant(scope === 1 ? Number.isInteger(season) && season >= 0 && season <= 99 : season === 65535, 6313, 'invalid quota season');
  return typedHash(20, new ByteWriter(36).raw(domain, 32).u8(scope).u8(classId).u16(season).finish());
}
export function expenseId(domain, ref) {
  invariant(nonzero(ref), 6402, 'expense ref must be nonzero');
  return typedHash(21, Buffer.concat([asBytes(domain, 32), asBytes(ref, 32)]));
}
function map(state, name) {
  invariant(state[name] instanceof Map, E.BAD_FRAME, `missing ${name} Map`); return state[name];
}
function balance(state, address) { return integer(map(state, 'lamports').get(hex(address)) ?? 0n, 0n, U64_MAX); }
function floor(context, length) {
  invariant(typeof context.minimumBalance === 'function', E.BAD_FRAME, 'trusted minimumBalance adapter required');
  const n = integer(context.minimumBalance(length), 0n, U64_MAX); return n > 0n ? n : 1n;
}
function wallet(state, address, code) {
  const a = map(state, 'nativeAccounts').get(hex(address));
  invariant(a && a.programOwner === 'system' && a.dataLength === 0 && a.executable === false,
    code, 'role requires a trusted System-owned empty nonexecutable account');
}
function signer(context, address) {
  invariant(context.authorizedActors instanceof Set && context.authorizedActors.has(hex(address)), E.REQUIRED_SIGNER, 'required authority absent from trusted ingress');
}
function protectedRoles(context, roles, extra = []) {
  const protectedSet = new Set([hex(context.opsAddress), ...extra.map(hex), ...(context.protectedKeys ?? [])]);
  roles.forEach((r) => invariant(!protectedSet.has(hex(r)), 6411, 'protected address used as ordinary role'));
}
function checkOps(state, context) {
  const ops = state.ops, a = map(state, 'nativeAccounts').get(hex(context.opsAddress));
  invariant(ops && equalBytes(ops.address, context.opsAddress) && a && a.programOwner === 'biolab' && a.dataLength === 136 && !a.executable,
    6400, 'Ops state invalid');
  integer(ops.nextExpenseNonce, 0n, U64_MAX); integer(ops.paidLamports, 0n, U64_MAX);
  invariant(balance(state, context.opsAddress) >= floor(context, 136), 6400, 'Ops below permanent balance');
}
function checkContext(state, info, context) {
  invariant(equalBytes(info.frame.configId, context.configId), E.CONFIG_MISMATCH, 'config mismatch');
  invariant(equalBytes(info.frame.domain, context.expectedDomain), E.BAD_DEPLOYMENT_DOMAIN, 'domain mismatch');
  integer(context.now, 0n, I64_MAX); integer(context.slot, 0n, U64_MAX);
  invariant(Array.isArray(context.opsMembers) && context.opsMembers.length === 5 &&
    context.opsMembers.every((m, i) => asBytes(m, 32).length === 32 && (i === 0 || Buffer.compare(asBytes(context.opsMembers[i - 1], 32), asBytes(m, 32)) < 0)),
    6400, 'five distinct byte-sorted Ops members required');
  checkOps(state, context);
}
function actorNonceTarget(state, actor, context) {
  invariant(typeof context.deriveActorNonceAddress === 'function', E.BAD_FRAME, 'trusted ActorNonce address adapter required');
  const address = asBytes(context.deriveActorNonceAddress(actor), 32);
  const k = `${hex(context.expectedDomain)}:${hex(actor)}`;
  if (state.actorNonces?.has(k)) {
    const a = map(state, 'nativeAccounts').get(hex(address));
    invariant(a && a.programOwner === 'biolab' && a.dataLength === 418 && balance(state, address) >= floor(context, 418),
      E.BAD_BUSINESS_RECORD, 'existing ActorNonce account evidence missing');
    return [];
  }
  return [{ address, length: 418, programOwner: 'biolab' }];
}
function rentPlan(state, targets, payer, cap, context, limitCode) {
  const seen = new Set(), transfers = []; let total = 0n;
  targets.forEach((target) => {
    const address = hex(target.address);
    invariant(!seen.has(address), E.ACCOUNT_SET_MISMATCH, 'new targets alias'); seen.add(address);
    invariant(address !== hex(payer), E.ACCOUNT_SET_MISMATCH, 'rent payer aliases new target');
    const existing = map(state, 'nativeAccounts').get(address);
    invariant(existing === undefined || existing.programOwner === 'system' && existing.dataLength === 0 && !existing.executable,
      6319, 'new target not a canonical uninitialized System account in model');
    const required = floor(context, target.length), current = balance(state, target.address), missing = required > current ? required - current : 0n;
    total = integer(total + missing, 0n, U64_MAX); transfers.push({ from: payer, to: target.address, amount: missing });
  });
  invariant(total <= cap, limitCode, 'actual rent exceeds signed cap');
  return { transfers, targets, total };
}
function funds(state, transfers, budgetCode, context, minimumRecipients = []) {
  const gross = new Map(), deltas = new Map();
  transfers.forEach(({ from, to, amount }) => {
    const n = integer(amount, 0n, U64_MAX), f = hex(from), t = hex(to);
    gross.set(f, integer((gross.get(f) ?? 0n) + n, 0n, U64_MAX));
    deltas.set(f, (deltas.get(f) ?? 0n) - n); deltas.set(t, (deltas.get(t) ?? 0n) + n);
  });
  gross.forEach((n, key) => invariant(balance(state, Buffer.from(key, 'hex')) >= n, budgetCode, 'entry gross SOL budget insufficient'));
  const final = new Map();
  deltas.forEach((delta, key) => final.set(key, integer(balance(state, Buffer.from(key, 'hex')) + delta, 0n, U64_MAX)));
  minimumRecipients.forEach((address) => invariant((final.get(hex(address)) ?? balance(state, address)) >= floor(context, 0),
    6418, 'recipient final balance below required floor'));
  final.forEach((value, address) => state.lamports.set(address, value));
}
function allocate(state, targets) {
  targets.forEach((target) => state.nativeAccounts.set(hex(target.address), { programOwner: target.programOwner, dataLength: target.length, executable: false }));
}
function projectAddresses(context, id) {
  invariant(typeof context.deriveProjectAddresses === 'function', E.BAD_FRAME, 'trusted PDA adapter required');
  const a = context.deriveProjectAddresses(id);
  invariant(a && Array.isArray(a.mints) && a.mints.length === 4, E.BAD_PDA_OR_HEADER, 'four Mint addresses required');
  const all = [asBytes(a.projectAddress, 32), ...a.mints.map((m) => asBytes(m, 32))];
  invariant(new Set(all.map(hex)).size === 5, E.BAD_PDA_OR_HEADER, 'Project and Mint addresses alias'); return { projectAddress: all[0], mints: all.slice(1) };
}
function create(state, info, context) {
  const p = decodeCreatePayload(info.frame.payload);
  invariant(equalBytes(p.catalogHash, catalogHash()), E.CONFIG_MISMATCH, 'wrong material catalog');
  try { materialSeason(context.now, context.tOpen); } catch (e) { if (e.code === 6311) e.code = 6210; throw e; }
  signer(context, p.principalPayer); signer(context, p.rentPayer);
  wallet(state, p.saleRecipient, 6204); wallet(state, p.principalPayer, 6209); wallet(state, p.rentPayer, 6209);
  invariant(p.maxProtocolLamports >= CREATE_FEE, 6207, 'creation fee cap too low');
  const id = projectId(context.expectedDomain, info.businessKey), a = projectAddresses(context, id);
  invariant(!map(state, 'projects').has(hex(id)), 6205, 'Project exists');
  a.mints.forEach((m) => invariant(!map(state, 'mints').has(hex(m)), 6206, 'Mint exists'));
  protectedRoles(context, [info.frame.actor, p.saleRecipient, p.principalPayer, p.rentPayer], [a.projectAddress, ...a.mints]);
  const project = { creator: info.frame.actor, creationBusiness: info.businessKey, catalogHash: p.catalogHash, saleRecipient: p.saleRecipient,
    createdAt: BigInt(context.now), createdSlot: BigInt(context.slot), name: p.name, classes: p.classes.map((c, i) => ({ ...c, mint: a.mints[i], issued: 0n, intakeBurned: 0n })) };
  const body = encodeProjectBody(project);
  const targets = [{ address: a.projectAddress, length: body.length + 120, programOwner: 'biolab' },
    ...a.mints.map((address) => ({ address, length: 82, programOwner: 'token' })), ...actorNonceTarget(state, info.frame.actor, context)];
  const rent = rentPlan(state, targets, p.rentPayer, p.maxRentLamports, context, 6208);
  funds(state, [...rent.transfers, { from: p.principalPayer, to: context.opsAddress, amount: CREATE_FEE }], 6209, context);
  allocate(state, targets); state.projects.set(hex(id), project); a.mints.forEach((m) => state.mints.set(hex(m), { supply: 0n }));
  return new ByteWriter(208).raw(id).raw(a.projectAddress).raw(Buffer.concat(a.mints)).u64(CREATE_FEE).u64(rent.total).finish();
}
function buy(state, info, context) {
  const p = decodeBuyPayload(info.frame.payload);
  invariant([1, 2, 3, 4].includes(p.class), 6300, 'unknown material class'); integer(p.quantity, 1n, 1000n);
  const season = materialSeason(context.now, context.tOpen); invariant(p.expectedSeason === season, 6312, 'signed season is stale');
  const oldProject = map(state, 'projects').get(hex(p.projectId)); invariant(oldProject, 6302, 'unknown Project');
  const project = decodeProjectBody(encodeProjectBody(oldProject)), c = project.classes[p.class - 1]; state.projects.set(hex(p.projectId), project);
  const addresses = projectAddresses(context, p.projectId);
  const projectAccount = map(state, 'nativeAccounts').get(hex(addresses.projectAddress));
  invariant(projectAccount && projectAccount.programOwner === 'biolab' && projectAccount.dataLength === 120 + encodeProjectBody(project).length && !projectAccount.executable,
    6302, 'Project account evidence inconsistent');
  invariant(balance(state, addresses.projectAddress) >= floor(context, projectAccount.dataLength), 6320, 'Project below permanent balance');
  invariant(equalBytes(projectId(context.expectedDomain, project.creationBusiness), p.projectId) && equalBytes(c.mint, addresses.mints[p.class - 1]) &&
    equalBytes(p.mint, c.mint) && equalBytes(p.catalogHash, catalogHash()) && equalBytes(project.catalogHash, p.catalogHash), 6302, 'registered material identity mismatch');
  invariant(equalBytes(p.saleRecipient, project.saleRecipient), 6307, 'seller changed');
  invariant(p.unitPriceLamports === c.priceLamports && p.resourcePerUnitLamports === RESOURCE_FEE_PER_UNIT, 6303, 'quote mismatch');
  integer(p.unitPriceLamports, 0n, MAX_UNIT_PRICE);
  const sale = integer(p.quantity * p.unitPriceLamports, 0n, U64_MAX), resource = integer(p.quantity * RESOURCE_FEE_PER_UNIT, 0n, U64_MAX);
  const total = integer(sale + resource, 0n, U64_MAX); invariant(total <= p.maxProtocolLamports, 6308, 'protocol spend cap too low');
  signer(context, p.principalPayer); signer(context, p.rentPayer);
  wallet(state, p.principalPayer, 6306); wallet(state, p.rentPayer, 6306); wallet(state, p.saleRecipient, 6307);
  invariant([0, 1].includes(p.destinationMode), 6304, 'unknown destination mode');
  const quotaAddresses = context.deriveQuotaAddresses(p.class, season), seasonKey = `${p.class}:${season}`, lifetimeKey = `${p.class}`;
  const seasons = map(state, 'seasonIssued'), lifetime = map(state, 'lifetimeIssued'), hasSeason = seasons.has(seasonKey), hasLifetime = lifetime.has(lifetimeKey);
  const gs = integer(seasons.get(seasonKey) ?? 0n, 0n, SEASON_CAPS[p.class - 1]), gl = integer(lifetime.get(lifetimeKey) ?? 0n, 0n, LIFETIME_CAPS[p.class - 1]);
  [[hasSeason, quotaAddresses.seasonAddress, 131], [hasLifetime, quotaAddresses.lifetimeAddress, 129]].forEach(([exists, address, length]) => {
    if (!exists) return;
    const account = map(state, 'nativeAccounts').get(hex(address));
    invariant(account && account.programOwner === 'biolab' && account.dataLength === length && !account.executable &&
      balance(state, address) >= floor(context, length), 6313, 'existing quota account evidence inconsistent');
  });
  invariant(gl >= gs && gl >= c.issued && (hasLifetime || gs === 0n && c.issued === 0n), 6313, 'global counters missing or rolled back');
  invariant(gs + p.quantity <= SEASON_CAPS[p.class - 1], 6314, 'global season cap exceeded');
  invariant(gl + p.quantity <= LIFETIME_CAPS[p.class - 1], 6315, 'global lifetime cap exceeded');
  invariant(c.issued + p.quantity <= c.lifetimeCap, 6316, 'project cap exceeded');
  const mint = map(state, 'mints').get(hex(c.mint));
  const mintAccount = map(state, 'nativeAccounts').get(hex(c.mint));
  invariant(mintAccount && mintAccount.programOwner === 'token' && mintAccount.dataLength === 82 && !mintAccount.executable,
    6302, 'Mint account evidence inconsistent');
  invariant(balance(state, c.mint) >= floor(context, 82), 6320, 'Mint below permanent balance');
  invariant(mint && integer(mint.supply, 0n, U64_MAX) <= c.issued - c.intakeBurned, 6317, 'Mint supply inconsistent with issuance/intake');
  let destination = map(state, 'tokens').get(hex(p.destinationToken)); const targets = [...actorNonceTarget(state, info.frame.actor, context)];
  if (p.destinationMode === 1) invariant(equalBytes(context.deriveAtaAddress(p.mint, p.materialRecipient), p.destinationToken), 6305, 'destination is not verified ATA');
  if (!destination) {
    invariant(p.destinationMode === 1, 6305, 'EXISTING destination missing');
    destination = { mint: p.mint, owner: p.materialRecipient, amount: 0n, initialized: true, native: false, frozen: false };
    targets.push({ address: p.destinationToken, length: 165, programOwner: 'token' });
  } else {
    const destinationAccount = map(state, 'nativeAccounts').get(hex(p.destinationToken));
    invariant(destinationAccount && destinationAccount.programOwner === 'token' && destinationAccount.dataLength === 165 && !destinationAccount.executable,
      6305, 'destination Token runtime metadata inconsistent');
    invariant(balance(state, p.destinationToken) >= floor(context, 165), 6320, 'existing Token account below permanent balance');
  }
  invariant(destination.initialized === true && destination.native === false && destination.frozen !== true &&
    equalBytes(destination.mint, p.mint) && equalBytes(destination.owner, p.materialRecipient), 6305, 'destination Token state invalid');
  integer(destination.amount + p.quantity, 0n, U64_MAX); integer(mint.supply + p.quantity, 0n, U64_MAX);
  if (!hasSeason) targets.push({ address: asBytes(quotaAddresses.seasonAddress, 32), length: 131, programOwner: 'biolab' });
  if (!hasLifetime) targets.push({ address: asBytes(quotaAddresses.lifetimeAddress, 32), length: 129, programOwner: 'biolab' });
  protectedRoles(context, [info.frame.actor, p.principalPayer, p.rentPayer, p.saleRecipient, p.materialRecipient],
    [addresses.projectAddress, ...addresses.mints, p.destinationToken, quotaAddresses.seasonAddress, quotaAddresses.lifetimeAddress]);
  const rent = rentPlan(state, targets, p.rentPayer, p.maxRentLamports, context, 6309);
  funds(state, [...rent.transfers, { from: p.principalPayer, to: p.saleRecipient, amount: sale },
    { from: p.principalPayer, to: context.opsAddress, amount: resource }], 6310, context, [p.saleRecipient]);
  allocate(state, targets); destination.amount += p.quantity; mint.supply += p.quantity;
  state.tokens.set(hex(p.destinationToken), destination); c.issued += p.quantity; seasons.set(seasonKey, gs + p.quantity); lifetime.set(lifetimeKey, gl + p.quantity);
  return new ByteWriter(58).u64(p.quantity).u64(sale).u64(resource).u64(rent.total).u16(season).u64(c.issued).u64(gs + p.quantity).u64(gl + p.quantity).finish();
}
function queue(state, info, context) {
  const p = decodeQueuePayload(info.frame.payload);
  invariant(context.opsMembers.some((m) => equalBytes(m, info.frame.actor)), 6401, 'queue actor is not an Ops member');
  const id = expenseId(context.expectedDomain, p.expenseRef); invariant(nonzero(p.evidenceHash), 6403, 'evidence hash must be nonzero');
  invariant(!map(state, 'expenses').has(hex(p.expenseRef)), 6404, 'expense reference already used');
  invariant(p.expectedNonce === state.ops.nextExpenseNonce, 6405, 'stale expense nonce'); integer(p.expectedNonce + 1n, 0n, U64_MAX);
  invariant(p.amount >= 1n, 6406, 'expense amount must be positive');
  const now = BigInt(context.now); integer(now + 604800n, 0n, I64_MAX);
  invariant(p.notBefore >= 0n && p.expiresAt > p.notBefore && p.expiresAt > now && p.expiresAt <= now + 604800n,
    6407, 'expense window invalid');
  signer(context, p.rentPayer); wallet(state, p.rentPayer, 6409); wallet(state, p.recipient, 6410);
  const address = asBytes(context.deriveExpenseAddress(p.expenseRef), 32);
  protectedRoles(context, [info.frame.actor, p.rentPayer, p.recipient], [address]);
  const targets = [{ address, length: 409, programOwner: 'biolab' }, ...actorNonceTarget(state, info.frame.actor, context)];
  const rent = rentPlan(state, targets, p.rentPayer, p.maxRentLamports, context, 6408);
  funds(state, rent.transfers, 6409, context); allocate(state, targets);
  state.expenses.set(hex(p.expenseRef), { expenseRef: p.expenseRef, nonce: p.expectedNonce, queueActor: info.frame.actor, queueBusiness: info.businessKey,
    recipient: p.recipient, amount: p.amount, evidenceHash: p.evidenceHash, queuedAt: now, queuedSlot: BigInt(context.slot),
    notBefore: p.notBefore, expiresAt: p.expiresAt, status: 0, paidBusiness: zero(), paidActor: zero(), paidAt: 0n, paidSlot: 0n });
  state.ops.nextExpenseNonce += 1n;
  return new ByteWriter(56).raw(id).u64(p.expectedNonce).u64(rent.total).u64(state.ops.nextExpenseNonce).finish();
}
function pay(state, info, context) {
  const p = decodePayPayload(info.frame.payload), id = expenseId(context.expectedDomain, p.expenseRef);
  invariant(equalBytes(id, p.expenseId), 6413, 'expense identity mismatch');
  const expense = map(state, 'expenses').get(hex(p.expenseRef)); invariant(expense, 6419, 'expense missing');
  const expenseAccount = map(state, 'nativeAccounts').get(hex(context.deriveExpenseAddress(p.expenseRef)));
  invariant(expenseAccount && expenseAccount.programOwner === 'biolab' && expenseAccount.dataLength === 409 && !expenseAccount.executable &&
    balance(state, context.deriveExpenseAddress(p.expenseRef)) >= floor(context, 409), 6419, 'Expense account evidence inconsistent');
  const expected = [[p.recipient, expense.recipient], [p.evidenceHash, expense.evidenceHash], [p.expenseRef, expense.expenseRef]];
  invariant(expected.every(([a, b]) => equalBytes(a, b)) && p.allocatedNonce === expense.nonce && p.amount === expense.amount &&
    p.notBefore === expense.notBefore && p.expiresAt === expense.expiresAt, 6413, 'immutable Expense fields changed');
  invariant(expense.nonce < state.ops.nextExpenseNonce, 6405, 'Expense nonce not allocated');
  invariant(expense.status === 0 || expense.status === 1, 6419, 'invalid Expense status');
  invariant(expense.status === 0, 6414, 'Expense already paid');
  invariant(!nonzero(expense.paidBusiness) && !nonzero(expense.paidActor) && expense.paidAt === 0n && expense.paidSlot === 0n &&
    context.opsMembers.some((m) => equalBytes(m, expense.queueActor)) && expense.queuedAt >= 0n &&
    expense.notBefore >= 0n && expense.expiresAt > expense.notBefore && nonzero(expense.evidenceHash) && expense.amount > 0n &&
    expense.expiresAt > expense.queuedAt && expense.expiresAt <= expense.queuedAt + 604800n && expense.queuedAt + 604800n <= I64_MAX,
    6419, 'Expense pending history corrupt');
  const indices = p.memberIndices;
  invariant(indices.every((i, n) => i >= 0 && i <= 4 && (n === 0 || indices[n - 1] < i)), 6412, 'three distinct sorted member indices required');
  const members = indices.map((i) => context.opsMembers[i]);
  invariant(members.some((m) => equalBytes(m, info.frame.actor)), 6412, 'actor must be one of the selected three');
  members.forEach((m) => signer(context, m)); signer(context, p.rentPayer);
  const now = BigInt(context.now);
  invariant(now >= expense.queuedAt && BigInt(context.slot) >= expense.queuedSlot, 6419, 'Clock predates queue history');
  invariant(now >= p.notBefore, 6415, 'Expense not due'); invariant(now < p.expiresAt, 6416, 'Expense expired');
  invariant(p.amount > 0n, 6406, 'Expense amount invalid');
  wallet(state, p.rentPayer, 6409); wallet(state, p.recipient, 6410);
  protectedRoles(context, [info.frame.actor, ...members, p.rentPayer, p.recipient], [context.deriveExpenseAddress(p.expenseRef)]);
  invariant(p.amount <= balance(state, context.opsAddress) - floor(context, 136), 6417, 'Ops spendable balance insufficient');
  integer(state.ops.paidLamports + p.amount, 0n, U64_MAX);
  const targets = actorNonceTarget(state, info.frame.actor, context), rent = rentPlan(state, targets, p.rentPayer, p.maxRentLamports, context, 6408);
  funds(state, [...rent.transfers, { from: context.opsAddress, to: p.recipient, amount: p.amount }], 6409, context, [p.recipient]); allocate(state, targets);
  state.ops.paidLamports += p.amount; expense.status = 1; expense.paidBusiness = info.businessKey; expense.paidActor = info.frame.actor;
  expense.paidAt = now; expense.paidSlot = BigInt(context.slot);
  return new ByteWriter(64).raw(id).u64(expense.nonce).u64(p.amount).u64(state.ops.paidLamports).u64(rent.total).finish();
}

/** Trusted outer core transaction may invoke this mutating prepared stage. */
export function executeLaunchpadPrepared(state, info, context) {
  checkContext(state, info, context);
  if (info.frame.module === 201 && info.frame.opcode === 1) return create(state, info, context);
  if (info.frame.module === 202 && info.frame.opcode === 1) return buy(state, info, context);
  if (info.frame.module === 301 && info.frame.opcode === 1) return queue(state, info, context);
  if (info.frame.module === 301 && info.frame.opcode === 2) return pay(state, info, context);
  invariant(false, E.OPCODE_NOT_OPEN, 'not a launchpad operation');
}
export function applyLaunchpad(state, frameBytes, context) {
  return executeAtomic(state, frameBytes, context, (draft, info) => executeLaunchpadPrepared(draft, info, context));
}
