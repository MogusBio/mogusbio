import { readFileSync } from 'node:fs';
import { address, getAddressEncoder, getAddressDecoder, getProgramDerivedAddress, isOffCurveAddress, AccountRole } from '@solana/kit';
import { ByteReader, ByteWriter, asBytes, typedHash, sha256, businessKey, instanceId } from '../../protocol-core/src/index.mjs';
import { baseConfigR2Id, PROGRAMS } from './release.mjs';

export const NATIVE_FRAME_HEADER_BYTES = 152;
export const NATIVE_FRAME_MAX_BYTES = 4096;
const MAGIC = Buffer.from('42494f4958000000', 'hex');
const U64_MAX = (1n << 64n) - 1n;
const admittedAbis = new WeakSet();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (value, code) => { if (!value) fail(code); };
const fixed = (value, n) => asBytes(value, n);
export const nativeKeyBytes = value => typeof value === 'string'
  ? Buffer.from(getAddressEncoder().encode(address(value))) : fixed(value, 32);
export const nativeKeyAddress = value => getAddressDecoder().decode(nativeKeyBytes(value));
const freezeDeep = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
};
const hashHex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
  ? value : fail('ABI_HASH_FORMAT');
const uint64 = value => { check(typeof value === 'bigint' && value >= 0n && value <= U64_MAX, 'NATIVE_U64'); return value; };
const validLengthSpec = p => Number.isInteger(p) ? p >= 0 && p <= 3944 : p && !Array.isArray(p)
  && (Object.keys(p).length === 2 && Number.isInteger(p.min) && Number.isInteger(p.max) && p.min >= 0 && p.min <= p.max && p.max <= 3944
    || Object.keys(p).length === 1 && Array.isArray(p.oneOf) && p.oneOf.length > 0 && new Set(p.oneOf).size === p.oneOf.length
      && p.oneOf.every(n => Number.isInteger(n) && n >= 0 && n <= 3944));
const lengthAllowed = (p, n) => Number.isInteger(p) ? p === n : p.oneOf ? p.oneOf.includes(n) : n >= p.min && n <= p.max;

/** Pin exact UTF-8 JSON bytes, not a reserialized approximation. This is local
 * ABI admission, not proof that any deployed program implements that ABI. */
export function loadNativeAbi(bytes, { expectedHash } = {}) {
  const raw = bytes === undefined ? readFileSync(new URL('../../../programs/biolab-economy/operations.p0r2.json', import.meta.url)) : asBytes(bytes);
  check(sha256(raw).toString('hex') === hashHex(expectedHash), 'ABI_HASH_MISMATCH');
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  check(parsed.profile === 'BIOP0R2' && parsed.wireVersion === 2 && parsed.frameHeaderBytes === 152
    && parsed.frameMaxBytes === 4096 && parsed.unknownSchema === 'reject', 'ABI_PROFILE');
  const roles = ['actor', 'ActorNonce', 'RuntimeEconConfig', 'Instructions', 'SystemProgram', 'ClassicToken', 'Clock', 'BaseConfig'];
  check(Array.isArray(parsed.prefix) && parsed.prefix.length === 8 && parsed.prefix.every((p, i) => p.role === roles[i]
    && p.writable === (i < 2) && p.signer === (i === 0)), 'ABI_PREFIX');
  check(parsed.retryPrefixCount===4&&parsed.initPrefixOverrides?.RuntimeEconConfig==='writable'
    &&parsed.initPrefixOverrides?.BaseConfig==='writable'&&Object.keys(parsed.initPrefixOverrides).length===2,'ABI_PREFIX_POLICY');
  check(Array.isArray(parsed.operations) && parsed.operations.length > 0, 'ABI_OPERATIONS');
  const ids = new Set(), names = new Set();
  for (const op of parsed.operations) {
    for (const k of ['module', 'opcode', 'schema']) check(Number.isInteger(op[k]) && op[k] > 0 && op[k] <= 65535, 'ABI_OPERATION_ID');
    const id = `${op.module}/${op.opcode}/${op.schema}`;
    check(!ids.has(id) && typeof op.name === 'string' && !names.has(op.name), 'ABI_DUPLICATE_OPERATION'); ids.add(id); names.add(op.name);
    check(Number.isInteger(op.nativeOpcode) && op.nativeOpcode > 0 && op.nativeOpcode <= 255, 'ABI_NATIVE_OPCODE');
    check(Number.isInteger(op.resultBytes) && op.resultBytes >= 0 && op.resultBytes <= 256, 'ABI_RESULT_LENGTH');
    check(validLengthSpec(op.payloadBytes), 'ABI_PAYLOAD_LENGTH');
    check(Array.isArray(op.normalizedSuffix) && op.normalizedSuffix.every(a => typeof a.role === 'string'
      && typeof a.writable === 'boolean' && typeof a.signer === 'boolean') && typeof op.dynamicAccounts === 'string', 'ABI_SUFFIX');
    check(Array.isArray(op.publicFixedSuffix)&&JSON.stringify(op.publicFixedSuffix)===JSON.stringify(op.normalizedSuffix.filter(r=>!(op.nativeOpcode===1&&r.role==='BaseConfig'))),'ABI_PUBLIC_SUFFIX');
  }
  const result = freezeDeep({ ...parsed, hash: expectedHash }); admittedAbis.add(result); return result;
}
export function nativeOperation(abi, selector) {
  check(admittedAbis.has(abi), 'ABI_NOT_ADMITTED');
  const op = abi.operations.find(o => typeof selector === 'string' ? o.name === selector
    : o.module === selector?.module && o.opcode === selector?.opcode && o.schema === (selector?.payloadSchema ?? selector?.schema));
  check(op, 'NATIVE_OPERATION_OR_SCHEMA'); return op;
}
export function nativeNonceOpId(nonce) { return new ByteWriter(32).u64(uint64(nonce)).raw(Buffer.alloc(24)).finish(); }
export function nativeOpIdNonce(bytes) {
  const r = new ByteReader(fixed(bytes, 32), 32), nonce = r.u64(); r.zero(24); r.finish(); return nonce;
}
function validatePayload(op, payload) {
  const range = op.payloadBytes;
  check(lengthAllowed(range,payload.length), 'NATIVE_PAYLOAD_LENGTH');
  if (op.name === 'SYNTH_FINALIZE') check(payload.length === 124 || (payload.length === 189 && payload[124] === 1), 'NATIVE_SYNTH_MODE');
  if (op.name === 'CREATE_PROJECT') {
    const n = payload.readUInt32LE(144); check(n >= 1 && n <= 64 && payload.length === 216 + n, 'NATIVE_PROJECT_NAME_LENGTH');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(148, 148 + n));
    check(!/[\u0000-\u001f\u007f]/.test(name), 'NATIVE_PROJECT_NAME');
  }
  if (op.name === 'ARTIFACT_PUT') {
    const kind = payload.readUInt16LE(0), total = payload.readUInt32LE(2), offset = payload.readUInt32LE(46), count = payload.readUInt16LE(50);
    check([501, 702, 1002].includes(kind) && total > 0 && total <= 262144 && offset < total && offset % 1024 === 0
      && count === Math.min(total - offset, 1024) && payload.length === 60 + count, 'NATIVE_ARTIFACT_CHUNK');
  }
  return payload;
}
export function encodeNativeFrame(abi, fields) {
  check(fields && Object.keys(fields).every(k => ['operation', 'module', 'opcode', 'payloadSchema', 'domain', 'configId', 'actor', 'nonce', 'opId', 'payload'].includes(k)), 'NATIVE_FRAME_FIELDS');
  const op = nativeOperation(abi, fields.operation ?? fields), payload = validatePayload(op, asBytes(fields.payload));
  check((fields.module===undefined||fields.module===op.module)&&(fields.opcode===undefined||fields.opcode===op.opcode)
    &&(fields.payloadSchema===undefined||fields.payloadSchema===op.schema),'NATIVE_OPERATION_CONFLICT');
  const opId = fields.opId === undefined ? nativeNonceOpId(fields.nonce) : fixed(fields.opId, 32);
  const nonce = nativeOpIdNonce(opId);
  check(fields.nonce === undefined || uint64(fields.nonce) === nonce, 'NATIVE_NONCE_OPID_CONFLICT');
  return new ByteWriter(4096).raw(MAGIC).u16(1).u16(op.module).u16(op.opcode).u16(op.schema)
    .raw(fields.domain, 32).raw(fields.configId, 32).raw(nativeKeyBytes(fields.actor)).raw(opId)
    .u32(payload.length).u32(0).raw(payload).finish();
}
export function decodeNativeFrame(abi, bytes) {
  const r = new ByteReader(bytes, 4096); check(r.raw(8).equals(MAGIC), 'NATIVE_FRAME_MAGIC');
  check(r.u16() === 1, 'NATIVE_FRAME_CODEC');
  const out = { module: r.u16(), opcode: r.u16(), payloadSchema: r.u16(), domain: r.raw(32), configId: r.raw(32), actor: r.raw(32), opId: r.raw(32) };
  out.nonce = nativeOpIdNonce(out.opId); const size = r.u32(); r.zero(4); check(size === r.remaining, 'NATIVE_FRAME_LENGTH');
  const op = nativeOperation(abi, out); out.operation = op.name; out.payload = validatePayload(op, r.raw(size)); r.finish(); return out;
}
export const nativeRequestHash = (abi, frame) => { decodeNativeFrame(abi, frame); return typedHash(4, asBytes(frame)); };
export const nativeBusinessKey = (abi, bytes) => { const f = decodeNativeFrame(abi, bytes); return businessKey(f.domain, f.actor, f.opId); };
export function validateNativeResult(abi, frame, bytes) {
  const f = decodeNativeFrame(abi, frame), op = nativeOperation(abi, f), result = asBytes(bytes);
  check(result.length === op.resultBytes, 'NATIVE_RESULT_LENGTH'); return result;
}

export async function nativePda(programId, ...seeds) {
  const [pda, bump] = await getProgramDerivedAddress({ programAddress: address(programId), seeds: seeds.map(s => typeof s === 'string' ? Buffer.from(s) : asBytes(s)) });
  return { address: pda, bump };
}
const kitRole = (writable, signer) => signer ? (writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
  : (writable ? AccountRole.WRITABLE : AccountRole.READONLY);
const meta = (key, writable, signer) => Object.freeze({ address: address(key), role: kitRole(writable, signer) });
export async function nativePrefix(release, actor, { init = false } = {}) {
  const actorAddress = nativeKeyAddress(actor); check(!isOffCurveAddress(address(actorAddress)), 'NATIVE_ACTOR_SIGNER');
  const program = release.input.programId;
  const actorNonce = await nativePda(program, 'bio', 'actor-nonce', nativeKeyBytes(actorAddress));
  const config = await nativePda(program, 'bio', 'econ-config');
  const base = await nativePda(program, 'bio', 'config');
  return [meta(actorAddress, true, true), meta(actorNonce.address, true, false), meta(config.address, init, false),
    meta(PROGRAMS.instructionsSysvar, false, false), meta(PROGRAMS.systemProgram, false, false), meta(PROGRAMS.tokenProgram, false, false),
    meta(PROGRAMS.clockSysvar, false, false), meta(base.address, init, false)];
}
async function knownSuffixAddress(release, op, row, frame, frameBytes) {
  const n = row.role.toLowerCase(), program = release.input.programId;
  const seeds = { labmint: 'lab-mint', labreserve: 'lab-reserve', labauth: 'lab-auth', labauthority: 'lab-auth',
    treasury: 'treasury', registry: 'mining', opsvault: 'ops' };
  if (seeds[n]) return (await nativePda(program, 'bio', seeds[n])).address;
  if (n === 'program') return program;
  if (n === 'programdata') return release.programDataAddress;
  if (n === 'associatedtokenprogram') return PROGRAMS.associatedTokenProgram;
  if (['hour','currenthour'].includes(n)&&[23,25,27,28,29].includes(op.nativeOpcode)) return (await nativePda(program,'bio','hour',frame.payload.subarray(0,8))).address;
  if (n==='expense'&&[6,7].includes(op.nativeOpcode)) return (await nativePda(program,'bio','expense',frame.payload.subarray(0,32))).address;
  if (n==='destination'&&op.nativeOpcode===3) return nativeKeyAddress(frame.payload.subarray(48,80));
  if (n === 'newroot') return (await nativePda(program, 'bio', 'root', instanceId(frame.domain, nativeBusinessKeyForDecoded(frame)))).address;
  if (n === 'root' && [20, 21, 26].includes(op.nativeOpcode)) return (await nativePda(program, 'bio', 'root', frame.payload.subarray(0, 32))).address;
  if (n === 'rootreg' && [20,21,26].includes(op.nativeOpcode)) return (await nativePda(program,'bio','root-reg',frame.payload.subarray(0,32))).address;
  if (op.nativeOpcode===20&&n==='directory') return (await nativePda(program,'bio','mining-root',frame.payload.subarray(48,56))).address;
  if ([20,21].includes(op.nativeOpcode)&&['newposition','position'].includes(n)) return (await nativePda(program,'bio','reg',frame.payload.subarray(0,32),frame.payload.subarray(op.nativeOpcode===20?40:32,op.nativeOpcode===20?48:40))).address;
  // Native STEP12 is permissionless. Its original actor/PDA is read from the
  // actual program-owned V4 account, not the cranking actor's signed frame.
  if (n==='verification') return op.nativeOpcode===12?null:(await nativePda(program,'bio','verify',frame.actor)).address;
  if (n==='artifact') {
    const p=frame.payload;
    const aid=op.nativeOpcode===9?typedHash(19,Buffer.concat([frame.domain,frame.configId,frame.actor,p.subarray(0,2),p.subarray(2,6),p.subarray(6,38)]))
      :op.nativeOpcode===10?p.subarray(2,34):op.nativeOpcode===37?p.subarray(33,65):op.nativeOpcode===38?p.subarray(52,84):p.subarray(0,32);
    return (await nativePda(program,'bio','artifact',aid)).address;
  }
  if (op.nativeOpcode===5) {
    const p=frame.payload, project=p.subarray(0,32), c=p.subarray(32,33);
    if(n==='project')return(await nativePda(program,'bio','project',project)).address;
    if(n==='mint')return(await nativePda(program,'bio','pack',project,c)).address;
    if(n==='packauthority')return(await nativePda(program,'bio','pack-auth',project,c)).address;
    if(n==='destination')return nativeKeyAddress(p.subarray(169,201));
    if(n==='seasonquota')return(await nativePda(program,'bio','season',c,p.subarray(298,300))).address;
    if(n==='lifetimequota')return(await nativePda(program,'bio','issued',c)).address;
  }
  if(op.nativeOpcode===4){
    const project=typedHash(17,Buffer.concat([frame.domain,nativeBusinessKeyForDecoded(frame)]));
    if(n==='project')return(await nativePda(program,'bio','project',project)).address;
    const m=/^(aa|nuc|lipid|sugar)_(mint|auth)$/.exec(n);
    if(m){const c=Buffer.from([['aa','nuc','lipid','sugar'].indexOf(m[1])+1]);return(await nativePda(program,'bio',m[2]==='mint'?'pack':'pack-auth',project,c)).address;}
  }
  return null;
}
const nativeBusinessKeyForDecoded = f => businessKey(f.domain, f.actor, f.opId);

/** Emits an official Kit instruction only. Dynamic accounts require actual
 * state/Artifact planning and final native validation; this builder does not
 * invent that state or certify ownership/quality merely from client booleans. */
export async function buildNativeInstruction({ release, abi, frame: input, suffix = [], dynamicAccounts = [] }) {
  check(abi.hash === release.hashes.abiHash.toString('hex'), 'NATIVE_RELEASE_ABI');
  const frameBytes = asBytes(input), f = decodeNativeFrame(abi, frameBytes), op = nativeOperation(abi, f);
  check(f.domain.equals(release.domain) && f.configId.equals(baseConfigR2Id(release)), 'NATIVE_RELEASE_DOMAIN_CONFIG');
  const fixedRows = op.publicFixedSuffix ?? op.normalizedSuffix.filter(row => !(op.nativeOpcode === 1 && row.role === 'BaseConfig'));
  check(Array.isArray(suffix) && suffix.length === fixedRows.length && Array.isArray(dynamicAccounts), 'NATIVE_SUFFIX_COUNT');
  if (op.dynamicAccounts === 'none') check(dynamicAccounts.length === 0, 'NATIVE_NO_DYNAMIC_ACCOUNTS');
  const accounts = await nativePrefix(release, f.actor, { init: op.nativeOpcode === 1 });
  for (let i = 0; i < fixedRows.length; i++) {
    const row = fixedRows[i], supplied = suffix[i];
    check(supplied?.name === row.role, 'NATIVE_SUFFIX_ORDER');
    check((supplied.writable === undefined || supplied.writable === row.writable)
      && (supplied.signer === undefined || supplied.signer === row.signer), 'NATIVE_SUFFIX_FLAGS');
    const key = nativeKeyAddress(supplied.address), expected = await knownSuffixAddress(release, op, row, f, frameBytes);
    check(expected === null || key === expected, 'NATIVE_SUFFIX_PDA'); accounts.push(meta(key, row.writable, row.signer));
  }
  for (const row of dynamicAccounts) {
    check(typeof row?.writable === 'boolean' && typeof row?.signer === 'boolean', 'NATIVE_DYNAMIC_FLAGS');
    const key = nativeKeyAddress(row.address); check(!row.signer || !isOffCurveAddress(address(key)), 'NATIVE_DYNAMIC_SIGNER');
    accounts.push(meta(key, row.writable, row.signer));
  }
  check(new Set(accounts.map(a => a.address)).size === accounts.length, 'NATIVE_DUPLICATE_ACCOUNT');
  check(new Set([release.input.programId,...accounts.map(a=>a.address)]).size <= 64, 'NATIVE_ACCOUNT_LIMIT');
  return Object.freeze({ programAddress: address(release.input.programId), accounts: Object.freeze(accounts), data: Buffer.from(frameBytes),
    localPublicFixture: release.localPublicFixture === true, productionAdmission: false });
}

// Typed payloads use the actual native offsets, with u64 quantities kept BigInt.
const onlyFields=(p,names)=>check(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>names.includes(k)),'NATIVE_PAYLOAD_FIELDS');
/** Merges legitimate aliases once and sorts by raw32-byte key, never base58
 * string order. Fixed/prefix alias and actual wallet ownership remain checked
 * by buildNativeInstruction and by the native coordinator. */
export function canonicalNativeWalletTable(actor,roles){
  check(Array.isArray(roles),'NATIVE_WALLET_TABLE');const owner=nativeKeyAddress(actor),map=new Map();
  for(const r of roles){check(typeof r?.writable==='boolean'&&typeof r?.signer==='boolean','NATIVE_DYNAMIC_FLAGS');const a=nativeKeyAddress(r.address);
    check(!r.signer||!isOffCurveAddress(address(a)),'NATIVE_DYNAMIC_SIGNER');if(a===owner)continue;
    const old=map.get(a)??{address:a,writable:false,signer:false};old.writable||=r.writable;old.signer||=r.signer;map.set(a,old);}
  return [...map.values()].sort((a,b)=>Buffer.compare(nativeKeyBytes(a.address),nativeKeyBytes(b.address)));
}
export function encodeCreateProjectPayload(p){
  onlyFields(p,['catalogHash','seller','feePayer','rentPayer','maxCreationFee','maxRent','name','classes']);
  check(typeof p.name==='string','CREATE_NAME');const name=Buffer.from(p.name,'utf8');
  check(name.length>=1&&name.length<=64&&name.toString('utf8')===p.name&&!/[\u0000-\u001f\u007f]/.test(p.name),'CREATE_NAME');
  check(Array.isArray(p.classes)&&p.classes.length===4&&uint64(p.maxCreationFee)>=10000000n,'CREATE_PROJECT_CLASSES');
  const w=new ByteWriter(280).raw(p.catalogHash,32).raw(nativeKeyBytes(p.seller)).raw(nativeKeyBytes(p.feePayer)).raw(nativeKeyBytes(p.rentPayer))
    .u64(p.maxCreationFee).u64(uint64(p.maxRent)).u32(name.length).raw(name);
  p.classes.forEach((c,i)=>{onlyFields(c,['class','cap','unitPrice']);check(c.class===i+1&&uint64(c.cap)>=1n&&c.cap<=1000000n&&uint64(c.unitPrice)<=U64_MAX-100000n,'CREATE_PROJECT_CLASSES');w.u8(c.class).u64(c.cap).u64(c.unitPrice);});
  return w.finish();
}
export function encodeBuyMaterialPayload(p) {
  onlyFields(p,['projectId','class','mint','catalogHash','quantity','payer','recipient','destination','destinationMode','seller','unitPrice','resourceFee','maxPayment','rentPayer','maxRent','season']);
  check(Number.isInteger(p.class) && p.class >= 1 && p.class <= 4 && uint64(p.quantity) >= 1n && p.quantity <= 1000n, 'BUY_MATERIAL_RANGE');
  check(p.destinationMode === 0 || p.destinationMode === 1, 'BUY_DESTINATION_MODE');
  check(Number.isInteger(p.season)&&p.season>=0&&p.season<100,'BUY_SEASON');
  check(uint64(p.resourceFee)===100000n&&uint64(p.unitPrice)<=U64_MAX-100000n,'BUY_QUOTED_FEES');
  const total=p.quantity*(p.unitPrice+p.resourceFee);check(total<=U64_MAX&&uint64(p.maxPayment)>=total,'BUY_MAX_PAYMENT');
  return new ByteWriter(300).raw(p.projectId,32).u8(p.class).raw(nativeKeyBytes(p.mint)).raw(p.catalogHash,32).u64(p.quantity)
    .raw(nativeKeyBytes(p.payer)).raw(nativeKeyBytes(p.recipient)).raw(nativeKeyBytes(p.destination)).u8(p.destinationMode)
    .raw(nativeKeyBytes(p.seller)).u64(uint64(p.unitPrice)).u64(uint64(p.resourceFee)).u64(uint64(p.maxPayment))
    .raw(nativeKeyBytes(p.rentPayer)).u64(uint64(p.maxRent)).u16(p.season).finish();
}
export function encodeManufacturePartPayload(p) { onlyFields(p,['artifactId','artifactSHA','artifactLength','maxRent']);return new ByteWriter(76).raw(p.artifactId,32).raw(p.artifactSHA,32).u32(p.artifactLength).u64(uint64(p.maxRent)).finish(); }
export function encodeRegisterOrdinaryPayload(p) { onlyFields(p,['instance','rootRevision','positionSeq','directorySeq','beneficiary','maxRent']);return new ByteWriter(96).raw(p.instance,32).u64(uint64(p.rootRevision)).u64(uint64(p.positionSeq))
  .u64(uint64(p.directorySeq)).raw(nativeKeyBytes(p.beneficiary)).u64(uint64(p.maxRent)).finish(); }
export function encodeExitOrdinaryPayload(p) { onlyFields(p,['instance','positionSeq','rootRevision','maxRent']);return new ByteWriter(56).raw(p.instance,32).u64(uint64(p.positionSeq)).u64(uint64(p.rootRevision)).u64(uint64(p.maxRent)).finish(); }
export function encodeClaimPositionPayload(p) { onlyFields(p,['positionId','expectedPaid','upToAccrued','destination','rentPayer','maxRent']);check(uint64(p.expectedPaid) <= uint64(p.upToAccrued), 'CLAIM_PAID_CAS'); return new ByteWriter(120).raw(p.positionId,32)
  .u64(p.expectedPaid).u64(p.upToAccrued).raw(nativeKeyBytes(p.destination)).raw(nativeKeyBytes(p.rentPayer)).u64(uint64(p.maxRent)).finish(); }
export function encodeArtifactPutPayload(p) {
  onlyFields(p,['kind','totalLength','artifactSHA','expectedSequence','offset','chunk','maxRent']);
  const chunk=asBytes(p.chunk), out=new ByteWriter(1084).u16(p.kind).u32(p.totalLength).raw(p.artifactSHA,32).u64(uint64(p.expectedSequence))
    .u32(p.offset).u16(chunk.length).raw(chunk).u64(uint64(p.maxRent)).finish();
  validatePayload({name:'ARTIFACT_PUT',payloadBytes:{min:61,max:1084}},out);return out;
}
export function encodeArtifactSealPayload(p) { onlyFields(p,['kind','artifactId','expectedSequence','maxRent']);check([501,702,1002].includes(p.kind),'ARTIFACT_KIND'); return new ByteWriter(50).u16(p.kind).raw(p.artifactId,32).u64(uint64(p.expectedSequence)).u64(uint64(p.maxRent)).finish(); }
export function encodeVerifyBeginPayload(p) { onlyFields(p,['artifactId','artifactSHA','artifactLength','challengePpm','expectedGeneration','maxRent']);check(Number.isInteger(p.challengePpm)&&p.challengePpm>=500000&&p.challengePpm<=2000000&&p.challengePpm%1000===0,'VERIFY_CHALLENGE');
  return new ByteWriter(88).raw(p.artifactId,32).raw(p.artifactSHA,32).u32(p.artifactLength).u32(p.challengePpm).u64(uint64(p.expectedGeneration)).u64(uint64(p.maxRent)).finish(); }
export function encodeVerifyStepPayload(p) { onlyFields(p,['artifactId','expectedGeneration','expectedWorkSequence','count','previousDigest','maxRent']);check(Number.isInteger(p.expectedWorkSequence)&&p.expectedWorkSequence>=0&&p.expectedWorkSequence<=65535
  && Number.isInteger(p.count)&&p.count>=1&&p.count<=2,'VERIFY_STEP_COUNT'); return new ByteWriter(84).raw(p.artifactId,32).u64(uint64(p.expectedGeneration)).u16(p.expectedWorkSequence)
  .u8(p.count).u8(0).raw(p.previousDigest,32).u64(uint64(p.maxRent)).finish(); }
export function encodeSynthFinalizePayload(p) { onlyFields(p,['artifactId','artifactSHA','artifactLength','expectedGeneration','transcriptSHA','maxFee','maxRent','competition']);const mode=p.competition??null;if(mode)onlyFields(mode,['commitId','salt']);return new ByteWriter(mode?189:124).raw(p.artifactId,32).raw(p.artifactSHA,32).u32(p.artifactLength)
  .u64(uint64(p.expectedGeneration)).raw(p.transcriptSHA,32).u64(uint64(p.maxFee)).u64(uint64(p.maxRent))
  .raw(mode?new ByteWriter(65).u8(1).raw(mode.commitId,32).raw(mode.salt,32).finish():Buffer.alloc(0)).finish(); }
export function encodeSyncEmissionPayload(p){onlyFields(p,['maxRent']);return new ByteWriter(8).u64(uint64(p.maxRent)).finish();}
export function encodeOpenHourPayload(p){onlyFields(p,['hour','maxRent']);return new ByteWriter(16).u64(uint64(p.hour)).u64(uint64(p.maxRent)).finish();}
export function encodeAdvanceFrozenHourPayload(p){onlyFields(p,['hour','maxRent']);return new ByteWriter(16).u64(uint64(p.hour)).u64(uint64(p.maxRent)).finish();}
export function encodeApplyEventPayload(p){onlyFields(p,['eventSequence','boundary','maxRent']);return new ByteWriter(24).u64(uint64(p.eventSequence)).u64(uint64(p.boundary)).u64(uint64(p.maxRent)).finish();}
export function encodeMaterializeHourPayload(p){onlyFields(p,['hour','expectedCursor','positionSeq','maxRent']);return new ByteWriter(32).u64(uint64(p.hour)).u64(uint64(p.expectedCursor)).u64(uint64(p.positionSeq)).u64(uint64(p.maxRent)).finish();}
export function encodeCloseFinalHourPayload(p){onlyFields(p,['hour','maxRent']);return new ByteWriter(16).u64(uint64(p.hour)).u64(uint64(p.maxRent)).finish();}
export function encodeEmptySkipPayload(p){onlyFields(p,['expectedNextHour','targetExclusive','maxRent']);check(uint64(p.expectedNextHour)<uint64(p.targetExclusive),'EMPTY_SKIP_RANGE');return new ByteWriter(24).u64(p.expectedNextHour).u64(p.targetExclusive).u64(uint64(p.maxRent)).finish();}
export function encodeTransferRootPayload(p){onlyFields(p,['instance','rootRevision','registrationRevision','newOwner','maxRent']);return new ByteWriter(88).raw(p.instance,32).u64(uint64(p.rootRevision)).u64(uint64(p.registrationRevision)).raw(nativeKeyBytes(p.newOwner)).u64(uint64(p.maxRent)).finish();}
