import { readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { address, getAddressEncoder, getAddressDecoder, getProgramDerivedAddress, isOffCurveAddress } from '@solana/kit';
import { ByteReader, ByteWriter, deploymentDomain, typedHash, catalogHash, sha256 } from '../../protocol-core/src/index.mjs';
import { createSeed, createImprovement, createFurtherImprovement, FROZEN_SEED_COSTS } from '../../biology/src/seeds.mjs';
import { designId } from '../../biology/src/canonical.mjs';
import { createPublishedC310Graph } from '../../biology/src/published-c310.mjs';
import { initialSeedSetId } from '../../originality/src/wire.mjs';
import { assertCurrentReleaseBinding } from './binding.mjs';
import {DEVNET_GENESIS_HEX} from './cluster.mjs';

export const RELEASE_PROFILE = 'BIOP0R2';
export const BASE_CONFIG_BODY_BYTES = 928;
export const OPENING_PROFILES=Object.freeze({LEGACY:'CURRENT16-316',FORMAL:'OPEN310'});
export function openingPolicy(input,{localPublicFixture=false}={}){
  if(input?.seedCount!==16||input.frontier!==310&&!(localPublicFixture&&input.frontier===316))throw new Error('RELEASE_OPENING_POLICY');
  return Object.freeze({profile:input.frontier===310?OPENING_PROFILES.FORMAL:OPENING_PROFILES.LEGACY,requiredSeedCount:16,publishedKnownCount:input.frontier===310?17:16,frontier:input.frontier});
}
export const PROGRAMS = Object.freeze({
  systemProgram: '11111111111111111111111111111111',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  loaderProgram: 'BPFLoaderUpgradeab1e11111111111111111111111',
  clockSysvar: 'SysvarC1ock11111111111111111111111111111111',
  instructionsSysvar: 'Sysvar1nstructions1111111111111111111111111',
});
const hex32 = (v, label) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new Error(`RELEASE_HEX32:${label}`);
  return Buffer.from(v, 'hex');
};
const keyBytes = v => Buffer.from(getAddressEncoder().encode(address(v)));
const keyString = v => getAddressDecoder().decode(v);
const time = (v, label) => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) throw new Error(`RELEASE_I64:${label}`);
  const n = BigInt(v); if (n > 9223372036854775807n) throw new Error(`RELEASE_I64:${label}`); return n;
};
const testKeys = new Set([
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
  'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
  '278117fc144c72340f67d0f2316e8386ceffbf2b2428c9c51fef7c597f1d426e',
  'ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf',
]);
// These deterministic public signing fixtures can only enter an explicitly
// labelled local build. Nothing here reads or creates a user's wallet key.
const localFixtureKeys = Array.from({ length: 7 }, (_, n) => {
  const seed = sha256(Buffer.from(`BIOP0R2 native SIGNING FIXTURE ONLY ${n}`));
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), type: 'pkcs8', format: 'der' });
  return Buffer.from(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32));
});
const localFixtureSet = new Set(localFixtureKeys.map(b => b.toString('hex')));
const rejectTestIdentity = (bytes, label, localPublicFixture = false) => {
  if (bytes.every(v => v === bytes[0]) || testKeys.has(bytes.toString('hex')))
    throw new Error(`RELEASE_TEST_IDENTITY:${label}`);
  if (!localPublicFixture && localFixtureSet.has(bytes.toString('hex'))) throw new Error(`RELEASE_PUBLIC_FIXTURE_IDENTITY:${label}`);
};
const hashFields = ['genesisHash', 'deploymentNonce', 'releaseHash', 'abiHash', 'ruleHash', 'validatorHash',
  'catalogHash', 'initialSeedSetId', 'taskManifestHash', 'taskFaultPolicyHash', 'admissionPolicyHash', 'networkProfileHash'];
const requiredFields = ['profile', 'wireVersion', 'programId', 'bootstrap', 'opsMembers', ...hashFields,
  'seedCount', 'frontier', 'initNotBefore', 'seedOpen', 'rewardStart', 'prewarmSeconds',
  'maxClockSkewSeconds', 'loaderProgram', 'programDataAddress', 'upgradeAuthority'];
const current = JSON.parse(readFileSync(new URL('../../../releases/func2r2/manifest.json', import.meta.url), 'utf8'));
export const currentNativeAbiHash = () => sha256(readFileSync(new URL('../../../programs/biolab-economy/operations.p0r2.json', import.meta.url))).toString('hex');
/** Historical core ABI remains immutable. The additive market ABI is admitted
 * only in a separately bound real Devnet deployment, never by an arbitrary file
 * path or a browser-supplied ABI. */
export function nativeAbiBytesForRelease(releaseOrInput){
  const input=releaseOrInput?.input??releaseOrInput;
  const core=readFileSync(new URL('../../../programs/biolab-economy/operations.p0r2.json',import.meta.url));
  if(input?.abiHash===sha256(core).toString('hex'))return core;
  if(input?.genesisHash===DEVNET_GENESIS_HEX){
    let market;try{market=readFileSync(new URL('../../../programs/biolab-economy/operations.market1.json',import.meta.url));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(market&&input.abiHash===sha256(market).toString('hex'))return market;
  }
  throw new Error('RELEASE_ABI_BINDING');
}

/** Computes the public opening commitment without a manufactured asset or reward. */
export function productionOpening(domain) {
  const base = { domain, config: Buffer.alloc(32), catalog: catalogHash(), rule: Buffer.from(current.ruleHash, 'hex') };
  const graphs = Array.from({ length: 12 }, (_, n) => createSeed(n, base)).concat([
    createImprovement({ ...base, surfaces: false }), createImprovement(base),
    createFurtherImprovement({ ...base, stage: 1 }), createFurtherImprovement({ ...base, stage: 2 }),
  ]);
  const costs = [...FROZEN_SEED_COSTS, 324, 320, 318, 316];
  const rows = graphs.map((g, i) => ({ design: designId(g), C: BigInt(costs[i]) }))
    .sort((a, b) => Buffer.compare(a.design, b.design));
  return { rows, id: initialSeedSetId(domain, rows) };
}
/** The required16 commitment stays unchanged. OPEN310 additionally publishes
 * C310, which is registered as ordinary warm K0 before the opening is sealed. */
export function publishedOpening(domain,{frontier=310}={}){
  if(frontier!==310&&frontier!==316)throw new Error('RELEASE_OPENING_POLICY');const required=productionOpening(domain);
  const extra=frontier===310?[{design:designId(createPublishedC310Graph({domain,config:Buffer.alloc(32),catalog:catalogHash(),rule:Buffer.from(current.ruleHash,'hex')})),C:310n}]:[];
  return {requiredRows:required.rows,requiredSetId:required.id,rows:[...required.rows,...extra].sort((a,b)=>Buffer.compare(a.design,b.design)),requiredSeedCount:16,publishedKnownCount:16+extra.length,frontier};
}

/** Pure input admission. It neither deploys nor proves an immutable on-chain loader. */
export async function validateProductionRelease(input, { localPublicFixture = false } = {}) {
  if (typeof localPublicFixture !== 'boolean') throw new Error('RELEASE_FIXTURE_OPTION');
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== requiredFields.length || requiredFields.some(k => !(k in input))
    || Object.keys(input).some(k => !requiredFields.includes(k))) throw new Error('RELEASE_FIELDS');
  const opening=openingPolicy(input,{localPublicFixture});
  if (input.profile !== RELEASE_PROFILE || input.wireVersion !== 2
    || input.prewarmSeconds !== 86400 || input.maxClockSkewSeconds !== 0 || input.loaderProgram !== PROGRAMS.loaderProgram
    || input.upgradeAuthority !== null) throw new Error('RELEASE_FIXED_POLICY');
  const hashes = Object.fromEntries(hashFields.map(k => [k, hex32(input[k], k)]));
  for (const k of hashFields) if (!['ruleHash', 'validatorHash', 'catalogHash', 'initialSeedSetId'].includes(k)) rejectTestIdentity(hashes[k], k);
  if (input.ruleHash !== current.ruleHash || input.validatorHash !== current.validatorHash
    || input.catalogHash !== catalogHash().toString('hex')) throw new Error('RELEASE_MODEL_BINDING');
  nativeAbiBytesForRelease(input);
  const program = keyBytes(input.programId), bootstrap = keyBytes(input.bootstrap);
  rejectTestIdentity(program, 'programId', localPublicFixture); rejectTestIdentity(bootstrap, 'bootstrap', localPublicFixture);
  if (Object.values(PROGRAMS).includes(input.programId) || isOffCurveAddress(address(input.bootstrap))) throw new Error('RELEASE_SIGNER_OR_PROGRAM');
  if (!Array.isArray(input.opsMembers) || input.opsMembers.length !== 5) throw new Error('RELEASE_OPS_COUNT');
  const ops = input.opsMembers.map(v => {
    const bytes = keyBytes(v); rejectTestIdentity(bytes, 'opsMember', localPublicFixture);
    if (isOffCurveAddress(address(v))) throw new Error('RELEASE_OPS_SIGNER'); return bytes;
  });
  if (ops.some((v, i) => i > 0 && Buffer.compare(ops[i - 1], v) >= 0)) throw new Error('RELEASE_OPS_ORDER');
  if (localPublicFixture) {
    const expectedOps = localFixtureKeys.slice(2).sort(Buffer.compare);
    if (!program.equals(localFixtureKeys[0]) || !bootstrap.equals(localFixtureKeys[1])
      || ops.some((b, i) => !b.equals(expectedOps[i]))
      || input.genesisHash !== sha256(Buffer.from('local native genesis')).toString('hex')
      || input.deploymentNonce !== sha256(Buffer.from('local native nonce')).toString('hex')) throw new Error('RELEASE_FIXTURE_RECIPE');
  }
  const initNotBefore = time(input.initNotBefore, 'initNotBefore'), seedOpen = time(input.seedOpen, 'seedOpen');
  const rewardStart = time(input.rewardStart, 'rewardStart');
  if (initNotBefore > seedOpen || seedOpen % 3600n !== 0n || rewardStart !== seedOpen + 86400n)
    throw new Error('RELEASE_SCHEDULE');
  const [programDataAddress] = await getProgramDerivedAddress({ programAddress: address(PROGRAMS.loaderProgram), seeds: [program] });
  if (input.programDataAddress !== programDataAddress) throw new Error('RELEASE_PROGRAM_DATA_PDA');
  const domain = deploymentDomain(hashes.genesisHash, program, hashes.deploymentNonce);
  if (!productionOpening(domain).id.equals(hashes.initialSeedSetId)) throw new Error('RELEASE_SEED_BINDING');
  const pdas = {};
  for (const [name, seed] of Object.entries({ baseConfig: 'config', manifest: 'deploy', labMint: 'lab-mint',
    labAuthority: 'lab-auth', labReserve: 'lab-reserve', treasury: 'treasury', opsVault: 'ops' })) {
    const [pda, bump] = await getProgramDerivedAddress({ programAddress: address(input.programId), seeds: [Buffer.from('bio'), Buffer.from(seed)] });
    pdas[name] = { address: pda, bump };
  }
  const identities = [input.programId, input.programDataAddress, ...Object.values(PROGRAMS), ...Object.values(pdas).map(v => v.address)];
  if (new Set(identities).size !== identities.length || identities.includes(input.bootstrap)
    || input.opsMembers.some(v => identities.includes(v))) throw new Error('RELEASE_ROLE_ALIAS');
  if (!localPublicFixture) await assertCurrentReleaseBinding(input);
  return { input: structuredClone(input), hashes, program, bootstrap, ops, initNotBefore, seedOpen, rewardStart,
    domain, pdas, programDataAddress, localPublicFixture, openingProfile:opening.profile, productionAdmission: false };
}

/** BIOP0R2/schema2 body; original P0/schema1 is deliberately not relabelled. */
export function encodeBaseConfigR2(release) {
  const { input: m, hashes: h, pdas } = release;
  const w = new ByteWriter(BASE_CONFIG_BODY_BYTES).raw(h.genesisHash).raw(release.program).raw(h.deploymentNonce).raw(release.bootstrap)
    .raw(keyBytes(release.programDataAddress));
  for (const field of ['systemProgram', 'tokenProgram', 'associatedTokenProgram', 'loaderProgram', 'clockSysvar', 'instructionsSysvar']) w.raw(keyBytes(PROGRAMS[field]));
  for (const field of ['labMint', 'labAuthority', 'labReserve', 'opsVault']) w.raw(keyBytes(pdas[field].address));
  for (const field of ['releaseHash', 'catalogHash', 'validatorHash', 'taskManifestHash', 'taskFaultPolicyHash',
    'initialSeedSetId', 'admissionPolicyHash', 'networkProfileHash']) w.raw(h[field]);
  w.u32(m.seedCount).u64(m.frontier).i64(release.seedOpen).i64(release.rewardStart);
  for (const member of release.ops) w.raw(member);
  return w.u8(3).u8(release.localPublicFixture ? 0 : 1).u16(0).finish();
}
export const baseConfigR2Id = release => typedHash(2, encodeBaseConfigR2(release));

export function decodeBaseConfigR2(bytes, { localPublicFixture = false } = {}) {
  if (bytes.length !== BASE_CONFIG_BODY_BYTES) throw new Error('BASE_CONFIG_R2_SIZE');
  const r = new ByteReader(bytes, BASE_CONFIG_BODY_BYTES), out = {};
  const first = ['genesisHash', 'programId', 'deploymentNonce', 'bootstrap', 'programDataAddress',
    'systemProgram', 'tokenProgram', 'associatedTokenProgram', 'loaderProgram', 'clockSysvar', 'instructionsSysvar',
    'labMint', 'labAuthority', 'labReserve', 'opsVault', 'releaseHash', 'catalogHash', 'validatorHash',
    'taskManifestHash', 'taskFaultPolicyHash', 'initialSeedSetId', 'admissionPolicyHash', 'networkProfileHash'];
  for (const key of first) { const b = r.raw(32); out[key] = /Hash$|Nonce$|Id$/.test(key) && key !== 'programId' ? b.toString('hex') : keyString(b); }
  out.seedCount = r.u32(); out.frontier = r.u64(); out.seedOpen = r.i64(); out.rewardStart = r.i64();
  out.opsMembers = Array.from({ length: 5 }, () => keyString(r.raw(32)));
  out.opsThreshold = r.u8(); out.deploymentMode = r.u8(); r.zero(2); r.finish();
  openingPolicy({seedCount:out.seedCount,frontier:Number(out.frontier)},{localPublicFixture});
  if (out.opsThreshold !== 3 || out.deploymentMode !== (localPublicFixture ? 0 : 1)
    || out.seedOpen < 0n || out.seedOpen % 3600n || out.rewardStart !== out.seedOpen + 86400n
    || Object.entries(PROGRAMS).some(([k, v]) => out[k] !== v)) throw new Error('BASE_CONFIG_R2_POLICY');
  return out;
}

/** Immutable Loader-v3 metadata admission, after RPC genesis and account owner checks. */
export function verifyProductionLoader(release, { programAccount, programDataAccount, currentSlot, unixTimestamp }) {
  const { input: m } = release;
  if (programAccount.address !== m.programId || programAccount.owner !== PROGRAMS.loaderProgram || programAccount.executable !== true
    || programDataAccount.address !== m.programDataAddress || programDataAccount.owner !== PROGRAMS.loaderProgram
    || programDataAccount.executable !== false) throw new Error('RELEASE_LOADER_ACCOUNT');
  const p = Buffer.from(programAccount.data), d = Buffer.from(programDataAccount.data);
  if (p.length !== 36 || p.readUInt32LE(0) !== 2 || !p.subarray(4).equals(keyBytes(m.programDataAddress))
    || d.length <= 45 || d.readUInt32LE(0) !== 3 || d[12] !== 0) throw new Error('RELEASE_LOADER_METADATA');
  if (typeof currentSlot !== 'bigint' || currentSlot < 0n || d.readBigUInt64LE(4) >= currentSlot
    || typeof unixTimestamp !== 'bigint' || unixTimestamp < release.initNotBefore || unixTimestamp > release.seedOpen)
    throw new Error('RELEASE_LOADER_TIME');
  // ProgramData may reserve trailing capacity. This hashes those bytes too and
  // must never be represented as the standalone ELF build hash.
  return { immutable: true, deployedSlot: d.readBigUInt64LE(4), programDataPayloadSha256: sha256(d.subarray(45)).toString('hex') };
}

const rustArray = b => `[${[...b].map(v => `0x${v.toString(16).padStart(2, '0')}`).join(',')}]`;
export function productionRustConstants(r) {
  const body = encodeBaseConfigR2(r), id = baseConfigR2Id(r);
  const rows = ['// Generated from validated public BIOP0R2 input. No ELF self-hash.'];
  rows.push(`pub const IS_LOCAL_PUBLIC_FIXTURE: bool = ${r.localPublicFixture};`);
  rows.push(`pub const OPENING_FRONTIER: u64 = ${r.input.frontier};`);
  for (const [name, bytes] of Object.entries({ PROGRAM_ID: r.program, BOOTSTRAP: r.bootstrap }))
    rows.push(`pub const ${name}: Pubkey = Pubkey::new_from_array(${rustArray(bytes)});`);
  for (const [name, bytes] of Object.entries({ GENESIS: r.hashes.genesisHash, DEPLOYMENT_NONCE: r.hashes.deploymentNonce,
    RELEASE_HASH: r.hashes.releaseHash, ABI_HASH: r.hashes.abiHash, CONFIG_ID: id, DEPLOYMENT_DOMAIN: r.domain,
    PROGRAM_DATA_ADDRESS: keyBytes(r.programDataAddress), INITIAL_SEED_SET_ID: r.hashes.initialSeedSetId }))
    rows.push(`pub const ${name}: [u8; 32] = ${rustArray(bytes)};`);
  rows.push(`pub const OPS_MEMBERS: [Pubkey; 5] = [${r.ops.map(b => `Pubkey::new_from_array(${rustArray(b)})`).join(',')}];`);
  rows.push(`pub const INITIAL_DESIGNS: [([u8; 32], u64); 16] = [${productionOpening(r.domain).rows.map(row =>
    `(${rustArray(row.design)},${row.C})`).join(',')}];`);
  for (const [name, value] of Object.entries({ INIT_NOT_BEFORE: r.initNotBefore, SEED_OPEN: r.seedOpen, REWARD_START: r.rewardStart }))
    rows.push(`pub const ${name}: i64 = ${value};`);
  rows.push(`pub const BASE_CONFIG_BODY: [u8; 928] = ${rustArray(body)};`);
  return `${rows.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, path, flag, ...extra] = process.argv.slice(2);
  if (!['validate', 'emit-rust'].includes(command) || !path || extra.length || (flag !== undefined && !['--local-public-fixture','--local-public-fixture310'].includes(flag)))
    throw new Error('Usage: release.mjs validate|emit-rust approved-release.json [--local-public-fixture|--local-public-fixture310]');
  const r = await validateProductionRelease(JSON.parse(readFileSync(path, 'utf8')), { localPublicFixture: flag !== undefined });
  if(flag==='--local-public-fixture310'&&r.openingProfile!==OPENING_PROFILES.FORMAL)throw new Error('RELEASE_OPEN310_REQUIRED');
  process.stdout.write(command === 'emit-rust' ? productionRustConstants(r) : `${JSON.stringify({ profile: RELEASE_PROFILE,
    openingPolicy:openingPolicy(r.input,{localPublicFixture:r.localPublicFixture}),
    configId: baseConfigR2Id(r).toString('hex'), deploymentDomain: r.domain.toString('hex'), bodyBytes: 928,
    productionAdmission: false, reason: 'Requires actual immutable loader, build and complete release acceptance' }, null, 2)}\n`);
}
