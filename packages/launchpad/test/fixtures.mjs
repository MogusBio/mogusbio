import { encodeExactFrame, nonceOpId, catalogHash } from '../../protocol-core/src/index.mjs';
import { encodeCreatePayload, encodeBuyPayload, encodeQueuePayload, encodePayPayload, expenseId } from '../src/index.mjs';
export const bytes = (n) => Buffer.alloc(32, n);
export const DOMAIN = bytes(0), CONFIG = bytes(0x11), OWNER = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
export const BUYER = bytes(0x10), SELLER = bytes(0x12), OPS = bytes(0xfe), MEMBERS = [1, 2, 3, 4, 5].map(bytes);
export const key = (v) => Buffer.from(v).toString('hex');
export function fixture() {
  // Opaque deterministic fixture allocation, deliberately not a fake PDA algorithm.
  const addresses = new Map(); let sequence = 10000n;
  const fixtureAddress = (label) => {
    if (!addresses.has(label)) { const b = Buffer.alloc(32, 0xab); b.writeBigUInt64LE(sequence++, 0); addresses.set(label, b); }
    return Buffer.from(addresses.get(label));
  };
  const state = { projects: new Map(), mints: new Map(), tokens: new Map(), sources: new Map(), roots: new Map(), actorNonces: new Map(),
    lamports: new Map(), nativeAccounts: new Map(), seasonIssued: new Map(), lifetimeIssued: new Map(), expenses: new Map(),
    ops: { address: OPS, nextExpenseNonce: 0n, paidLamports: 0n } };
  [OWNER, BUYER, SELLER, ...MEMBERS].forEach((a) => {
    state.lamports.set(key(a), 1000000000n); state.nativeAccounts.set(key(a), { programOwner: 'system', dataLength: 0, executable: false });
  });
  state.nativeAccounts.set(key(OPS), { programOwner: 'biolab', dataLength: 136, executable: false }); state.lamports.set(key(OPS), 1000000000n);
  const context = { expectedDomain: DOMAIN, configId: CONFIG, tOpen: 0n, now: 0n, slot: 1n, opsAddress: OPS, opsMembers: MEMBERS,
    authorizedActors: new Set([OWNER, BUYER, SELLER, ...MEMBERS].map(key)), protectedKeys: [],
    minimumBalance: (length) => 10n * BigInt(length) + 1n,
    deriveActorNonceAddress: (actor) => fixtureAddress(`nonce:${key(actor)}`),
    deriveProjectAddresses: (id) => ({ projectAddress: fixtureAddress(`project:${key(id)}`), mints: [1, 2, 3, 4].map((c) => fixtureAddress(`mint:${key(id)}:${c}`)) }),
    deriveQuotaAddresses: (c, season) => ({ seasonAddress: fixtureAddress(`season:${c}:${season}`), lifetimeAddress: fixtureAddress(`lifetime:${c}`) }),
    deriveAtaAddress: (mint, recipient) => fixtureAddress(`ata:${key(mint)}:${key(recipient)}`),
    deriveExpenseAddress: (ref) => fixtureAddress(`expense:${key(ref)}`),
  };
  return { state, context, fixtureAddress };
}
export function frame(module, opcode, actor, nonce, payload) {
  return encodeExactFrame({ module, opcode, domain: DOMAIN, configId: CONFIG, actor, opId: nonceOpId(nonce), payload });
}
export function createFields(overrides = {}) {
  return { catalogHash: catalogHash(), saleRecipient: SELLER, principalPayer: OWNER, rentPayer: OWNER,
    maxProtocolLamports: 10000000n, maxRentLamports: 100000000n, name: 'Lab',
    classes: [1, 2, 3, 4].map((c) => ({ class: c, lifetimeCap: 1000000n, priceLamports: 500000n })), ...overrides };
}
export function createFrame(nonce = 0n, overrides = {}, actor = OWNER) { return frame(201, 1, actor, nonce, encodeCreatePayload(createFields(overrides))); }
export function buyFields(projectId, project, context, overrides = {}) {
  const c = project.classes[0], recipient = BUYER;
  return { projectId, class: 1, mint: c.mint, catalogHash: catalogHash(), quantity: 2n,
    principalPayer: BUYER, materialRecipient: recipient, destinationToken: context.deriveAtaAddress(c.mint, recipient), destinationMode: 1,
    saleRecipient: project.saleRecipient, unitPriceLamports: c.priceLamports, resourcePerUnitLamports: 100000n,
    maxProtocolLamports: 100000000n, rentPayer: BUYER, maxRentLamports: 100000000n, expectedSeason: 0, ...overrides };
}
export const buyFrame = (p, nonce = 0n, actor = BUYER) => frame(202, 1, actor, nonce, encodeBuyPayload(p));
export function queueFields(overrides = {}) { return { expenseRef: bytes(0xaa), expectedNonce: 0n, recipient: SELLER, amount: 2000000n,
  evidenceHash: bytes(0xbb), notBefore: 0n, expiresAt: 86400n, rentPayer: MEMBERS[0], maxRentLamports: 100000000n, ...overrides }; }
export const queueFrame = (p = queueFields(), nonce = 0n, actor = MEMBERS[0]) => frame(301, 1, actor, nonce, encodeQueuePayload(p));
export function payFields(queue, overrides = {}) { return { expenseRef: queue.expenseRef, expenseId: expenseId(DOMAIN, queue.expenseRef), allocatedNonce: queue.expectedNonce,
  recipient: queue.recipient, amount: queue.amount, evidenceHash: queue.evidenceHash, notBefore: queue.notBefore, expiresAt: queue.expiresAt,
  memberIndices: [0, 2, 4], rentPayer: MEMBERS[0], maxRentLamports: 100000000n, ...overrides }; }
export const payFrame = (p, nonce = 1n, actor = MEMBERS[0]) => frame(301, 2, actor, nonce, encodePayPayload(p));
