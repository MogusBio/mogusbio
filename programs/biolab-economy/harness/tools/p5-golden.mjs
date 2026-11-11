import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ByteWriter, businessKey, instanceId, sourceId, typedHash, encodeRecord, decodeMaterialPlan,
  encodeDebitPlan, encodeSourceBody, initialTicks, catalogHash, sha256 } from '../../../../packages/protocol-core/src/index.mjs';
import { loadNativeAbi,decodeNativeFrame } from '../../../../packages/client/src/native.mjs';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const frame = Buffer.from(input.frame, 'hex'), payload = Buffer.from(input.payload, 'hex');
const actualRoot = Buffer.from(input.root, 'hex');
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../releases/func2r2/manifest.json', import.meta.url)), 'utf8'));
if(frame.subarray(0,8).toString()==='BIOECON2'){
  assert.equal(frame[8], 8); assert.equal(frame.length, 204); assert.equal(frame.readUInt32LE(120), 76);
}else{
  const abiBytes=readFileSync(new URL('../../operations.p0r2.json',import.meta.url));
  const exact=decodeNativeFrame(loadNativeAbi(abiBytes,{expectedHash:sha256(abiBytes).toString('hex')}),frame);assert.equal(exact.module,501);assert.equal(exact.opcode,1);assert.equal(exact.payloadSchema,2);assert.equal(exact.payload.length,76);
  assert.equal(frame.length,228);assert.deepEqual(frame.subarray(120,144),Buffer.alloc(24));
}
const createdAt=BigInt(input.createdAt??'0'),createdSlot=BigInt(input.createdSlot??'0');
const domain = frame.subarray(16, 48), configId = frame.subarray(48, 80), actor = frame.subarray(80, 112);
const opId = Buffer.alloc(32); opId.writeBigUInt64LE(frame.readBigUInt64LE(112));
const M = businessKey(domain, actor, opId), id = instanceId(domain, M);
const descriptor = payload.subarray(0, 4), plan = decodeMaterialPlan(payload.subarray(44));
assert.equal(descriptor.readUInt16LE(0), 1);
assert.ok(descriptor[2] >= 1 && descriptor[2] <= 4);
assert.ok(descriptor[2] === 4 ? descriptor[3] >= 1 && descriptor[3] <= 15 : descriptor[3] === 0);
const dp = encodeDebitPlan(plan.debits), zero = Buffer.alloc(32);
const body = new ByteWriter(323 + dp.length).raw(id).raw(M).raw(typedHash(4, frame)).raw(catalogHash())
  .raw(Buffer.from(manifest.validatorHash, 'hex')).raw(descriptor).u32(1_000_000).u64(120_000n).u64(45_000n)
  .u8(1).u8(0).i64(createdAt).u64(createdSlot).raw(actor).u64(0n).u8(0).raw(zero).raw(zero).i64(0n).u64(0n).raw(dp).finish();
const expectedRoot = encodeRecord({ kind: 12, schema: 1, domain, configId, recordKey: id, bump: actualRoot[84], body });
assert.deepEqual(actualRoot, expectedRoot, 'native Root must equal existing Node binary codec byte-for-byte');
assert.equal(actualRoot.length, 1055);
const capsule = Buffer.concat([actualRoot.subarray(0, 322), actualRoot.subarray(443)]);
assert.equal(capsule.length, 934);
for (let ordinal = 0; ordinal < plan.intakes.length; ordinal += 1) {
  const item = plan.intakes[ordinal], source = sourceId(domain, M, ordinal);
  const actual = input.sources.find(s => s.id === source.toString('hex')); assert.ok(actual);
  const bytes = Buffer.from(actual.bytes, 'hex'), group = plan.debits.find(g => g.sourceId.equals(source)); assert.ok(group);
  const prefix = Array(32).fill(0n); group.entries.forEach(e => { assert.equal(e.expectedPrefix, 0n); prefix[e.species - 1] = e.takeTick; });
  const sourceBody = encodeSourceBody({ inventoryOwner: item.materialOwner, projectId: item.projectId,
    mint: Buffer.from(actual.mint, 'hex'), catalogHash: catalogHash(), manufactureBusiness: M,
    sourceTokenAccount: item.sourceTokenAccount, unitCount: item.unitCount, class: item.class,
    intakeOrdinal: ordinal, createdAt, createdSlot, initialTick: initialTicks(item.class, item.unitCount), spentPrefix: prefix });
  const expected = encodeRecord({ kind: 11, schema: 1, domain, configId, recordKey: source, bump: bytes[84], body: sourceBody });
  assert.deepEqual(bytes, expected, 'native Source must equal existing Node736-byte body codec');
}
process.stdout.write(JSON.stringify({ rootBytes: actualRoot.length, capsuleBytes: capsule.length,
  rootSHA: sha256(actualRoot).toString('hex'), capsuleSHA: sha256(capsule).toString('hex'), sources: plan.intakes.length }) + '\n');
