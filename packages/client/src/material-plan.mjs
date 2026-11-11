import { asBytes, equalBytes } from '../../protocol-core/src/codec.mjs';
import { sourceId } from '../../protocol-core/src/p0.mjs';
import { catalogHash, F1_BOM, materialClass, RU_TO_TICK, validateSource } from '../../protocol-core/src/materials.mjs';

const hex = value => asBytes(value, 32).toString('hex');
const ordered = table => [...table.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'));

/**
 * Client convenience only. This selects a deterministic F1 material plan from a
 * read snapshot. It cannot authorize consumption: P5 rechecks every identity,
 * balance and prefix in the transaction that creates the output.
 * A standard unit is consumed directly; no unpacking operation is introduced.
 */
export function planComponentMaterials(state, { domain, business, owner }) {
  asBytes(domain, 32); asBytes(business, 32); asBytes(owner, 32);
  for (const name of ['sources', 'tokens', 'projects']) if (!(state[name] instanceof Map))
    throw new TypeError(`missing ${name} snapshot`);
  const intakes = [], debits = [], newDebits = [];
  for (let classId = 1; classId <= 4; classId++) {
    const species = materialClass(classId).species.filter(s => F1_BOM[s - 1] > 0n);
    let selected = null;
    for (const [id, source] of ordered(state.sources)) {
      if (source.class !== classId || !equalBytes(source.inventoryOwner, owner)) continue;
      validateSource(source, { domain, expectedId: Buffer.from(id, 'hex') });
      if (species.every(s => source.initialTick[s - 1] - source.spentPrefix[s - 1] >= F1_BOM[s - 1])) {
        selected = { sourceId: Buffer.from(id, 'hex'), entries: species.map(s => ({ species: s,
          expectedPrefix: source.spentPrefix[s - 1], takeTick: F1_BOM[s - 1] })) };
        break;
      }
    }
    if (!selected) {
      const maximum = species.reduce((m, s) => F1_BOM[s - 1] > m ? F1_BOM[s - 1] : m, 0n);
      const unitCount = (maximum + RU_TO_TICK - 1n) / RU_TO_TICK;
      let intake = null;
      for (const [id, project] of ordered(state.projects)) {
        if (!equalBytes(project.catalogHash, catalogHash())) continue;
        const c = project.classes[classId - 1];
        for (const [tokenId, token] of ordered(state.tokens)) {
          if (token.initialized === true && token.native === false && token.frozen !== true
            && equalBytes(token.owner, owner) && equalBytes(token.mint, c.mint) && token.amount >= unitCount) {
            intake = { projectId: Buffer.from(id, 'hex'), class: classId,
              sourceTokenAccount: Buffer.from(tokenId, 'hex'), materialOwner: asBytes(owner, 32), unitCount };
            break;
          }
        }
        if (intake) break;
      }
      if (!intake) throw Object.assign(new Error(`insufficient class ${classId} material`), { code: 'MATERIAL_PLAN_BALANCE' });
      intakes.push(intake);
      selected = { sourceId: null, entries: species.map(s => ({
        species: s, expectedPrefix: 0n, takeTick: F1_BOM[s - 1] })) };
      newDebits.push({intake,debit:selected});
    }
    debits.push(selected);
  }
  // New source ordinals belong to the canonical intake table, not the order
  // in which the UI happened to choose the four material classes.
  intakes.sort((a,b)=>Buffer.compare(a.projectId,b.projectId)||a.class-b.class||Buffer.compare(a.sourceTokenAccount,b.sourceTokenAccount));
  for(const {intake,debit} of newDebits)debit.sourceId=sourceId(domain,business,intakes.indexOf(intake));
  debits.sort((a, b) => Buffer.compare(a.sourceId, b.sourceId));
  return { catalogHash: catalogHash(), intakes, debits };
}
