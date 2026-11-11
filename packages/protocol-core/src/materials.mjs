import { ByteReader, ByteWriter, asBytes, compareBytes, equalBytes, integer, I64_MAX, U64_MAX } from './codec.mjs';
import { ERRORS as E, ProtocolError, invariant } from './errors.mjs';
import { typedHash, sourceId } from './p0.mjs';

export const RU_TO_TICK = 1000n;
export const MATERIAL_CLASSES = Object.freeze([
  Object.freeze({ id: 1, symbol: 'AA', creditPerRU: 6, species: Object.freeze(Array.from({ length: 20 }, (_, i) => i + 1)) }),
  Object.freeze({ id: 2, symbol: 'NUC', creditPerRU: 15, species: Object.freeze(Array.from({ length: 8 }, (_, i) => i + 21)) }),
  Object.freeze({ id: 3, symbol: 'LIPID', creditPerRU: 40, species: Object.freeze([29, 30, 31]) }),
  Object.freeze({ id: 4, symbol: 'SUGAR', creditPerRU: 120, species: Object.freeze([32]) }),
]);
export const SPECIES = Object.freeze([
  'Ala', 'Arg', 'Asn', 'Asp', 'Cys', 'Gln', 'Glu', 'Gly', 'His', 'Ile',
  'Leu', 'Lys', 'Met', 'Phe', 'Pro', 'Ser', 'Thr', 'Trp', 'Tyr', 'Val',
  'dATP', 'dCTP', 'dGTP', 'dTTP', 'ATP', 'CTP', 'GTP', 'UTP', 'DOPE', 'DOPG', 'DOPC', 'D-glucose',
]);
export function materialClass(id) {
  invariant(Number.isInteger(id) && id >= 1 && id <= 4, E.BAD_MATERIAL_CLASS, 'unknown material class');
  return MATERIAL_CLASSES[id - 1];
}
export function speciesClass(id) {
  integer(id, 1n, 32n, 'species');
  return id <= 20 ? 1 : id <= 28 ? 2 : id <= 31 ? 3 : 4;
}
export function encodeCatalog() {
  const w = new ByteWriter(95).raw(Buffer.from('42494f4341540000', 'hex')).u16(1).u32(RU_TO_TICK).u8(4);
  MATERIAL_CLASSES.forEach((c) => { w.u8(c.id).u16(c.creditPerRU).u8(c.species.length); c.species.forEach((s) => w.u16(s)); });
  return w.finish();
}
export function catalogHash() { return typedHash(19, encodeCatalog()); }
export const F1_BOM = Object.freeze(Array.from({ length: 32 }, (_, i) => {
  const s = i + 1;
  return s <= 24 ? 500n : s === 25 ? 1000n : s <= 28 ? 0n : 250n;
}));
export const F1_EFFECTIVE_SPECIES = Object.freeze([...Array.from({ length: 24 }, (_, i) => i + 1), 29, 30, 31]);
export function speciesCreditInt(species, ticks) {
  return integer(ticks, 0n, U64_MAX) * BigInt(materialClass(speciesClass(species)).creditPerRU);
}

function planGuard(action) {
  try { return action(); }
  catch (error) {
    if (error instanceof ProtocolError && error.code === E.BAD_FRAME) {
      throw new ProtocolError(E.BAD_MATERIAL_PLAN, error.message);
    }
    throw error;
  }
}
function validateDebits(groups) {
  invariant(Array.isArray(groups) && groups.length <= 32, E.BAD_MATERIAL_PLAN, 'too many debit groups');
  let previous = null, count = 0;
  groups.forEach((group) => {
    const id = asBytes(group.sourceId, 32);
    invariant(previous === null || compareBytes(previous, id) < 0, E.BAD_MATERIAL_PLAN, 'debit Sources not strictly ordered');
    previous = id;
    invariant(Array.isArray(group.entries) && group.entries.length >= 1 && group.entries.length <= 32,
      E.BAD_MATERIAL_PLAN, 'empty or oversized species mask');
    let previousSpecies = 0;
    group.entries.forEach((entry) => {
      const s = Number(integer(entry.species, 1n, 32n));
      invariant(s > previousSpecies, E.BAD_MATERIAL_PLAN, 'species not strictly ordered'); previousSpecies = s;
      integer(entry.expectedPrefix, 0n, U64_MAX); integer(entry.takeTick, 1n, U64_MAX);
      integer(BigInt(entry.expectedPrefix) + BigInt(entry.takeTick), 0n, U64_MAX);
    });
    count += group.entries.length;
  });
  invariant(count <= 128, E.BAD_MATERIAL_PLAN, 'too many debit entries');
}
export function encodeDebitPlan(groups) {
  return planGuard(() => {
    validateDebits(groups);
    const w = new ByteWriter(3204).u32(groups.length);
    groups.forEach((group) => {
      let mask = 0n;
      group.entries.forEach((entry) => { mask |= 1n << (BigInt(entry.species) - 1n); });
      w.raw(group.sourceId, 32).u32(mask);
      group.entries.forEach((entry) => w.u64(entry.expectedPrefix).u64(entry.takeTick));
    });
    return w.finish();
  });
}
function readDebitPlan(r) {
  let totalEntries = 0;
  const groups = r.vector(32, 52, (reader) => {
    const id = reader.raw(32), mask = reader.u32();
    invariant(mask !== 0, E.BAD_MATERIAL_PLAN, 'empty species mask');
    const entries = [];
    for (let bit = 0; bit < 32; bit += 1) {
      if (((mask >>> bit) & 1) !== 0) {
        totalEntries += 1;
        invariant(totalEntries <= 128, E.BAD_MATERIAL_PLAN, 'too many debit entries');
        entries.push({ species: bit + 1, expectedPrefix: reader.u64(), takeTick: reader.u64() });
      }
    }
    return { sourceId: id, entries };
  });
  validateDebits(groups); return groups;
}
export function decodeDebitPlan(bytes) {
  return planGuard(() => { const r = new ByteReader(bytes, 3204), groups = readDebitPlan(r); r.finish(); return groups; });
}
function intakeCompare(a, b) {
  return compareBytes(a.projectId, b.projectId) || a.class - b.class || compareBytes(a.sourceTokenAccount, b.sourceTokenAccount);
}
function validateIntakes(intakes) {
  invariant(Array.isArray(intakes) && intakes.length <= 32, E.BAD_MATERIAL_PLAN, 'too many intake entries');
  const tokens = new Set();
  intakes.forEach((item, i) => {
    asBytes(item.projectId, 32); asBytes(item.sourceTokenAccount, 32); asBytes(item.materialOwner, 32);
    materialClass(item.class); integer(item.unitCount, 1n, 1000000n);
    invariant(i === 0 || intakeCompare(intakes[i - 1], item) < 0, E.BAD_MATERIAL_PLAN, 'intakes not strictly ordered');
    const token = Buffer.from(item.sourceTokenAccount).toString('hex');
    invariant(!tokens.has(token), E.BAD_MATERIAL_PLAN, 'same source Token appears twice'); tokens.add(token);
  });
}
export function encodeMaterialPlan(plan) {
  return planGuard(() => {
    invariant(equalBytes(plan.catalogHash, catalogHash()), E.CATALOG_MISMATCH, 'catalog does not match fixed directory');
    validateIntakes(plan.intakes);
    const w = new ByteWriter(3072).raw(plan.catalogHash, 32).u32(plan.intakes.length);
    plan.intakes.forEach((item) => w.raw(item.projectId, 32).u8(item.class).raw(item.sourceTokenAccount, 32)
      .raw(item.materialOwner, 32).u64(item.unitCount));
    return w.raw(encodeDebitPlan(plan.debits)).finish();
  });
}
export function decodeMaterialPlan(bytes) {
  return planGuard(() => {
    const r = new ByteReader(bytes, 3072), catalog = r.raw(32);
    invariant(equalBytes(catalog, catalogHash()), E.CATALOG_MISMATCH, 'catalog does not match fixed directory');
    const intakes = r.vector(32, 105, (reader) => ({ projectId: reader.raw(32), class: reader.u8(),
      sourceTokenAccount: reader.raw(32), materialOwner: reader.raw(32), unitCount: reader.u64() }));
    validateIntakes(intakes);
    const debits = readDebitPlan(r); r.finish(); return { catalogHash: catalog, intakes, debits };
  });
}

export function initialTicks(classId, unitCount) {
  const c = materialClass(classId), n = integer(unitCount, 1n, 1000000n);
  return Array.from({ length: 32 }, (_, i) => c.species.includes(i + 1) ? n * RU_TO_TICK : 0n);
}
export function validateSource(source, { domain, expectedId, requireSpent = true } = {}) {
  ['inventoryOwner', 'projectId', 'mint', 'catalogHash', 'manufactureBusiness', 'sourceTokenAccount'].forEach((key) => asBytes(source[key], 32));
  invariant(equalBytes(source.catalogHash, catalogHash()), E.CATALOG_MISMATCH, 'Source catalog mismatch');
  materialClass(source.class); integer(source.unitCount, 1n, 1000000n); integer(source.intakeOrdinal, 0n, 31n);
  integer(source.createdAt, 0n, I64_MAX); integer(source.createdSlot, 0n, U64_MAX);
  invariant(Array.isArray(source.initialTick) && source.initialTick.length === 32 &&
    Array.isArray(source.spentPrefix) && source.spentPrefix.length === 32, E.BAD_SOURCE_STATE, 'Source requires two 32-element arrays');
  const initial = initialTicks(source.class, source.unitCount);
  source.initialTick.forEach((n, i) => {
    invariant(integer(n, 0n, U64_MAX) === initial[i], E.BAD_SOURCE_STATE, 'Source initial material mismatch');
    integer(source.spentPrefix[i], 0n, initial[i]);
  });
  invariant(!requireSpent || source.spentPrefix.some((n) => BigInt(n) > 0n), E.BAD_SOURCE_STATE, 'persisted Source has no consumption');
  if (domain !== undefined) {
    const derived = sourceId(domain, source.manufactureBusiness, source.intakeOrdinal);
    invariant(expectedId === undefined || equalBytes(derived, expectedId), E.BAD_SOURCE_STATE, 'Source identity mismatch');
  }
  return source;
}
export function encodeSourceBody(source) {
  validateSource(source);
  const w = new ByteWriter(736).raw(source.inventoryOwner, 32).raw(source.projectId, 32).raw(source.mint, 32)
    .raw(source.catalogHash, 32).raw(source.manufactureBusiness, 32).raw(source.sourceTokenAccount, 32)
    .u64(source.unitCount).u8(source.class).u16(source.intakeOrdinal).raw(Buffer.alloc(5))
    .i64(source.createdAt).u64(source.createdSlot);
  source.initialTick.forEach((n) => w.u64(n)); source.spentPrefix.forEach((n) => w.u64(n)); return w.finish();
}
export function decodeSourceBody(bytes, context) {
  const r = new ByteReader(bytes, 736);
  const source = { inventoryOwner: r.raw(32), projectId: r.raw(32), mint: r.raw(32), catalogHash: r.raw(32),
    manufactureBusiness: r.raw(32), sourceTokenAccount: r.raw(32), unitCount: r.u64(), class: r.u8(), intakeOrdinal: r.u16() };
  r.zero(5); source.createdAt = r.i64(); source.createdSlot = r.u64();
  source.initialTick = Array.from({ length: 32 }, () => r.u64()); source.spentPrefix = Array.from({ length: 32 }, () => r.u64());
  r.finish(); return validateSource(source, context);
}

function validateProject(project) {
  ['creator', 'creationBusiness', 'catalogHash', 'saleRecipient'].forEach((key) => asBytes(project[key], 32));
  invariant(equalBytes(project.catalogHash, catalogHash()), E.CATALOG_MISMATCH, 'Project catalog mismatch');
  integer(project.createdAt, 0n, I64_MAX); integer(project.createdSlot, 0n, U64_MAX);
  invariant(typeof project.name === 'string' && !/[\u0000-\u001f\u007f]/u.test(project.name), E.BAD_PROJECT_STATE, 'invalid Project name');
  const name = Buffer.from(project.name, 'utf8');
  invariant(name.length >= 1 && name.length <= 64 && name.toString('utf8') === project.name, E.BAD_PROJECT_STATE, 'invalid Project UTF-8 name');
  invariant(Array.isArray(project.classes) && project.classes.length === 4, E.BAD_PROJECT_STATE, 'Project requires four classes');
  const mints = new Set();
  project.classes.forEach((c, i) => {
    invariant(c.class === i + 1, E.BAD_PROJECT_STATE, 'Project class order mismatch');
    asBytes(c.mint, 32); const mint = Buffer.from(c.mint).toString('hex');
    invariant(!mints.has(mint), E.BAD_PROJECT_STATE, 'Project mints must differ'); mints.add(mint);
    const cap = integer(c.lifetimeCap, 1n, 1000000n), issued = integer(c.issued, 0n, cap);
    integer(c.intakeBurned, 0n, issued); integer(c.priceLamports, 0n, U64_MAX);
  });
  return project;
}
export function encodeProjectBody(project) {
  validateProject(project);
  const w = new ByteWriter(472).raw(project.creator, 32).raw(project.creationBusiness, 32).raw(project.catalogHash, 32)
    .raw(project.saleRecipient, 32).i64(project.createdAt).u64(project.createdSlot).text(project.name, 64);
  project.classes.forEach((c) => w.u8(c.class).raw(c.mint, 32).u64(c.lifetimeCap).u64(c.priceLamports).u64(c.issued).u64(c.intakeBurned));
  return w.finish();
}
export function decodeProjectBody(bytes) {
  const r = new ByteReader(bytes, 472);
  const p = { creator: r.raw(32), creationBusiness: r.raw(32), catalogHash: r.raw(32), saleRecipient: r.raw(32),
    createdAt: r.i64(), createdSlot: r.u64(), name: r.text(64) };
  p.classes = Array.from({ length: 4 }, () => ({ class: r.u8(), mint: r.raw(32), lifetimeCap: r.u64(), priceLamports: r.u64(), issued: r.u64(), intakeBurned: r.u64() }));
  r.finish(); return validateProject(p);
}
