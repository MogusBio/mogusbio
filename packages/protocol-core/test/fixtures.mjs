import { catalogHash, materialClass, F1_BOM, businessKey, sourceId, projectId } from '../src/index.mjs';
export const bytes = (value) => Buffer.alloc(32, value);
export const DOMAIN = bytes(0), CONFIG = bytes(0x11);
export const OWNER = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
export const OTHER_OWNER = bytes(0xa1);
export const PROJECT = projectId(DOMAIN, bytes(0x44));
export const key = (value) => Buffer.from(value).toString('hex');

export function fixture({ opId = bytes(0x22), owners = [OWNER, OWNER, OWNER, OWNER], project = PROJECT } = {}) {
  const manufactureBusiness = businessKey(DOMAIN, OWNER, opId);
  const classes = [1, 2, 3, 4].map((c) => ({ class: c, mint: bytes(0x54 + c), lifetimeCap: 1000n,
    priceLamports: 1n, issued: 10n, intakeBurned: 0n }));
  const state = {
    projects: new Map([[key(project), { creator: OWNER, creationBusiness: bytes(0x44), catalogHash: catalogHash(),
      saleRecipient: OWNER, createdAt: 0n, createdSlot: 1n, name: 'Lab', classes }]]),
    mints: new Map(classes.map((c) => [key(c.mint), { supply: 10n }])),
    tokens: new Map(classes.map((c, i) => [key(bytes([0x66, 0x77, 0x88, 0x99][i])), {
      mint: c.mint, owner: owners[i], amount: 10n, initialized: true, native: false, frozen: false }])),
    sources: new Map(), roots: new Map(), actorNonces: new Map(),
  };
  const intakes = classes.map((c, i) => ({ projectId: project, class: c.class,
    sourceTokenAccount: bytes([0x66, 0x77, 0x88, 0x99][i]), materialOwner: owners[i], unitCount: 1n }));
  const debits = intakes.map((item, i) => ({ sourceId: sourceId(DOMAIN, manufactureBusiness, i),
    entries: materialClass(item.class).species.filter((s) => F1_BOM[s - 1] > 0n)
      .map((species) => ({ species, expectedPrefix: 0n, takeTick: F1_BOM[species - 1] })) }))
    .sort((a, b) => Buffer.compare(a.sourceId, b.sourceId));
  const context = { domain: DOMAIN, manufactureBusiness, plan: { catalogHash: catalogHash(), intakes, debits },
    authorizedOwners: new Set(owners.map(key)), createdAt: 0n, createdSlot: 1n };
  return { state, context, opId, classes };
}
