import { asBytes, equalBytes, integer, I64_MAX, U64_MAX } from './codec.mjs';
import { ERRORS as E, invariant } from './errors.mjs';
import { sourceId, projectId } from './p0.mjs';
import { cloneProtocolState } from './atomic.mjs';
import { catalogHash, decodeMaterialPlan, encodeMaterialPlan, encodeProjectBody, decodeProjectBody, initialTicks, validateSource,
  F1_BOM, F1_EFFECTIVE_SPECIES, materialClass, speciesClass, speciesCreditInt, RU_TO_TICK } from './materials.mjs';

const hex = (value) => asBytes(value, 32).toString('hex');
function requireMap(state, key) { invariant(state[key] instanceof Map, E.BAD_MATERIAL_PLAN, `${key} table missing`); return state[key]; }
function ownerAuthorized(owners, owner, code) {
  invariant(owners instanceof Set && owners.has(hex(owner)), code, 'trusted ingress did not authorize material owner');
}
function checkSupply(c, mint) {
  invariant(mint && typeof mint === 'object', E.UNREGISTERED_PACK_MINT, 'registered Mint not found');
  const issued = integer(c.issued, 0n, BigInt(c.lifetimeCap)), burned = integer(c.intakeBurned, 0n, issued);
  const supply = integer(mint.supply, 0n, U64_MAX);
  invariant(supply <= issued - burned, E.MATERIAL_SUPPLY_LEDGER, 'Mint supply exceeds permanent issuance less manufacturing burn');
}

/**
 * Prepare a pure material-ledger transition. No public P1 opcode exists.
 * The trusted P5/P7 coordinator must atomically validate the real output,
 * create that output, charge costs, and commit its actor nonce with this state.
 * Authorization sets and project/mint/token tables are trusted runtime-model
 * inputs; they are not native signature or Classic Token CPI verification.
 */
export function prepareMaterialConsumption(state, context, trustedBOM = F1_BOM) {
  const { domain, manufactureBusiness, authorizedOwners, createdAt, createdSlot } = context;
  asBytes(domain, 32); asBytes(manufactureBusiness, 32); integer(createdAt, 0n, I64_MAX); integer(createdSlot, 0n, U64_MAX);
  invariant(Array.isArray(trustedBOM) && trustedBOM.length === 32, E.BAD_MATERIAL_PLAN, 'trusted BOM requires 32 species');
  trustedBOM.forEach((n) => integer(n, 0n, U64_MAX));
  // Canonicalize through the strict codec; never silently sort, merge, or select inputs.
  const plan = decodeMaterialPlan(encodeMaterialPlan(context.plan));
  const draft = cloneProtocolState(state);
  const projects = requireMap(draft, 'projects'), mints = requireMap(draft, 'mints'), tokens = requireMap(draft, 'tokens'), sources = requireMap(draft, 'sources');
  const debitMap = new Map(plan.debits.map((group) => [hex(group.sourceId), group]));
  const newIds = plan.intakes.map((_, i) => sourceId(domain, manufactureBusiness, i));
  invariant(new Set([...debitMap.keys(), ...newIds.map(hex)]).size <= 32, E.BAD_MATERIAL_PLAN, 'new and old Source union exceeds 32');
  const burnedStandardUnits = [0n, 0n, 0n, 0n];
  const normalizedProjects = new Set();

  // First validate every mint/project supply at the same pre-transition state.
  const burnTotals = new Map();
  plan.intakes.forEach((item, ordinal) => {
    const id = hex(newIds[ordinal]);
    invariant(!sources.has(id), E.SOURCE_ALREADY_EXISTS, 'new Source already initialized');
    const group = debitMap.get(id);
    invariant(group && group.entries.length > 0, E.NON_MINIMAL_INTAKE, 'intake must have a positive debit');
    const classInfo = materialClass(item.class);
    let maximum = 0n;
    group.entries.forEach((entry) => {
      invariant(classInfo.species.includes(entry.species), E.BAD_MATERIAL_PLAN, 'new Source contains another class');
      invariant(entry.expectedPrefix === 0n, E.STALE_INVENTORY_PREFIX, 'new Source prefix must be zero');
      maximum = entry.takeTick > maximum ? entry.takeTick : maximum;
    });
    const minimumUnits = (maximum + RU_TO_TICK - 1n) / RU_TO_TICK;
    invariant(item.unitCount === minimumUnits && minimumUnits > 0n, E.NON_MINIMAL_INTAKE, 'intake exceeds locally minimal standard units');
    ownerAuthorized(authorizedOwners, item.materialOwner, E.MATERIAL_OWNER_REQUIRED);
    let project = projects.get(hex(item.projectId));
    invariant(project, E.BAD_PROJECT_STATE, 'unknown Project');
    if (!normalizedProjects.has(hex(item.projectId))) {
      project = decodeProjectBody(encodeProjectBody(project));
      projects.set(hex(item.projectId), project); normalizedProjects.add(hex(item.projectId));
    }
    invariant(equalBytes(projectId(domain, project.creationBusiness), item.projectId), E.BAD_PROJECT_STATE, 'Project ID mismatch');
    invariant(equalBytes(project.catalogHash, plan.catalogHash), E.CATALOG_MISMATCH, 'Project catalog mismatch');
    const c = project.classes[item.class - 1], mintId = hex(c.mint), mint = mints.get(mintId), token = tokens.get(hex(item.sourceTokenAccount));
    checkSupply(c, mint);
    mint.supply = integer(mint.supply, 0n, U64_MAX);
    invariant(token && token.initialized === true && token.native === false && token.frozen !== true,
      E.MATERIAL_ACCOUNT_STATE, 'Token account is not usable');
    invariant(equalBytes(token.mint, c.mint), E.UNREGISTERED_PACK_MINT, 'Token Mint differs from registered class');
    invariant(equalBytes(token.owner, item.materialOwner), E.MATERIAL_OWNER_REQUIRED, 'Token owner differs from intake authority');
    token.amount = integer(token.amount, 0n, U64_MAX);
    invariant(token.amount >= item.unitCount, E.MATERIAL_BALANCE_LOW, 'insufficient material Token balance');
    const key = `${hex(item.projectId)}:${item.class}`;
    const groupTotal = burnTotals.get(key) ?? { classState: c, mint, total: 0n };
    groupTotal.total += item.unitCount; burnTotals.set(key, groupTotal);
  });
  burnTotals.forEach(({ classState: c, mint, total }) => {
    invariant(total <= mint.supply && c.intakeBurned + total <= c.issued, E.MATERIAL_SUPPLY_LEDGER, 'aggregate manufacturing intake exceeds supply');
  });

  // The in-memory arithmetic models exact BurnChecked postconditions; the SBF adapter must do real CPI.
  plan.intakes.forEach((item, ordinal) => {
    const project = projects.get(hex(item.projectId)), c = project.classes[item.class - 1], mint = mints.get(hex(c.mint));
    const token = tokens.get(hex(item.sourceTokenAccount)), n = item.unitCount;
    token.amount -= n; mint.supply -= n; c.intakeBurned += n; burnedStandardUnits[item.class - 1] += n;
    checkSupply(c, mint);
    const source = { inventoryOwner: item.materialOwner, projectId: item.projectId, mint: c.mint, catalogHash: catalogHash(),
      manufactureBusiness: asBytes(manufactureBusiness, 32), sourceTokenAccount: item.sourceTokenAccount, unitCount: n,
      class: item.class, intakeOrdinal: ordinal, createdAt: BigInt(createdAt), createdSlot: BigInt(createdSlot),
      initialTick: initialTicks(item.class, n), spentPrefix: Array(32).fill(0n) };
    sources.set(hex(newIds[ordinal]), source);
  });
  const totals = Array(32).fill(0n), effective = [], retired = [];
  let effectiveCreditInt = 0n, retiredCreditInt = 0n;
  plan.debits.forEach((group) => {
    const source = sources.get(hex(group.sourceId));
    invariant(source, E.BAD_SOURCE_STATE, 'unknown Source');
    validateSource(source, { domain, expectedId: group.sourceId, requireSpent: !newIds.some((id) => equalBytes(id, group.sourceId)) });
    source.initialTick = source.initialTick.map(BigInt); source.spentPrefix = source.spentPrefix.map(BigInt);
    ownerAuthorized(authorizedOwners, source.inventoryOwner, E.INVENTORY_OWNER_REQUIRED);
    group.entries.forEach((entry) => {
      invariant(speciesClass(entry.species) === source.class, E.BAD_MATERIAL_PLAN, 'Source does not contain selected species');
      const i = entry.species - 1, lo = integer(entry.expectedPrefix, 0n, U64_MAX), hi = integer(lo + entry.takeTick, 0n, U64_MAX);
      invariant(source.spentPrefix[i] === lo, E.STALE_INVENTORY_PREFIX, 'Source prefix changed');
      invariant(hi <= source.initialTick[i], E.INVENTORY_BALANCE_LOW, 'Source remaining material insufficient');
      source.spentPrefix[i] = hi; totals[i] += entry.takeTick;
      const slice = { sourceId: Buffer.from(group.sourceId), species: entry.species, lo, hi };
      const credit = speciesCreditInt(entry.species, entry.takeTick);
      if (F1_EFFECTIVE_SPECIES.includes(entry.species)) { effective.push(slice); effectiveCreditInt += credit; }
      else { retired.push(slice); retiredCreditInt += credit; }
    });
    validateSource(source, { domain, expectedId: group.sourceId });
  });
  invariant(totals.every((n, i) => n === BigInt(trustedBOM[i])), E.MATERIAL_DESTINATION_MISMATCH, 'material debits do not exactly equal trusted BOM');
  return { state: draft, plan, newSourceIds: newIds.map((id) => Buffer.from(id)), burnedStandardUnits,
    consumedTick: totals.reduce((a, b) => a + b, 0n), effectiveCreditInt, retiredCreditInt, effective, retired };
}

/** Current unused material credit only; it never becomes a mining weight. */
export function inventoryTotals(sources) {
  invariant(sources instanceof Map, E.BAD_SOURCE_STATE, 'Source table required');
  const ticks = Array(32).fill(0n); let creditInt = 0n;
  sources.forEach((source) => {
    validateSource(source);
    source.initialTick.forEach((initial, i) => {
      const remaining = initial - source.spentPrefix[i]; ticks[i] += remaining; creditInt += speciesCreditInt(i + 1, remaining);
    });
  });
  return { ticks, totalTick: ticks.reduce((a, b) => a + b, 0n), creditInt };
}
