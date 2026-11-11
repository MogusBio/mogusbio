import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePositionBody } from '../../settlement/src/wire.mjs';
import { decodeNativeFrame,nativePda,nativeKeyBytes } from '../src/native.mjs';
import { PROGRAMS } from '../src/release.mjs';
import { planFrozenHourAdvance,planLazyPositionAccrual,planAccruedPositionClaim,planFinalHourClosure } from '../src/settlement-workflow.mjs';
import { key } from './native-fixture.mjs';
import { settlementFixture as fixture } from './settlement-fixture.mjs';

test('ADVANCE planner uses mature exact Hour4 and has no token/treasury suffix',async()=>{
  const f=await fixture({lazy:false}),args={...f,hour:0n,nonce:9n,maxRent:1000000n};
  const plan=await planFrozenHourAdvance(args),frame=decodeNativeFrame(f.abi,plan.frame);
  assert.equal(frame.operation,'ADVANCE_FROZEN_HOUR');assert.equal(plan.instruction.accounts.length,10);
  assert.deepEqual(plan.suffix.map(r=>r.name),['Registry','Hour']);assert.equal(plan.transactionExecuted,false);
  for(const invalid of [await fixture({schema:3,lazy:false}),await fixture({lazy:true})])await assert.rejects(()=>planFrozenHourAdvance({...invalid,hour:0n,nonce:1n,maxRent:1000000n}));
  const earlier={...f.clockAccount,data:Buffer.from(f.clockAccount.data)};earlier.data.writeBigInt64LE(BigInt(f.release.input.rewardStart)+3599n,32);
  await assert.rejects(()=>planFrozenHourAdvance({...args,clockAccount:earlier}),{code:'SETTLEMENT_HOUR_NOT_MATURE'});
});

test('lazy planner uses ended historical identity, exact own coverage and single combined H+K floor',async()=>{
  for(const champion of [false,true]){
    const f=await fixture({champion}),args={...f,hour:0n,positionSeq:0n,nonce:3n,maxRent:1000000n};
    const plan=await planLazyPositionAccrual(args);assert.equal(plan.previewAtoms,champion?856164n:2378n);
    assert.deepEqual(plan.dynamicAccounts.map(x=>x.writable),[false,true,true]);assert.equal(plan.instruction.accounts.length,17);
    const badReg={...f.rootRegAccount,data:Buffer.from(f.rootRegAccount.data)};badReg.data.writeBigUInt64LE(1n,120+138);
    await assert.rejects(()=>planLazyPositionAccrual({...args,rootRegAccount:badReg}),{code:'SETTLEMENT_OWN_COVERAGE'});
    const badPosition={...f.positionAccount,data:Buffer.from(f.positionAccount.data)};badPosition.data.writeBigUInt64LE(1n,120+247);
    await assert.rejects(()=>planLazyPositionAccrual({...args,positionAccount:badPosition}),{code:'SETTLEMENT_POSITION_HOUR'});
  }
  const empty=await fixture({empty:true});const plan=await planLazyPositionAccrual({release:empty.release,abi:empty.abi,actor:empty.actor,nonce:5n,hour:0n,registryAccount:empty.registryAccount,hourAccount:empty.hourAccount,maxRent:1000000n});
  assert.equal(plan.dynamicAccounts.length,0);assert.equal(plan.previewAtoms,0n);
});

test('claim planner previews only actual accrued debt and cannot redirect an old beneficiary to the cranker',async()=>{
  const f=await fixture();f.p.accrued=7134n;f.p.paid=2378n;f.p.nextUnsettledHour=1n;
  f.positionAccount.data=Buffer.concat([f.positionAccount.data.subarray(0,120),encodePositionBody(f.p)]);
  const mint=await nativePda(f.release.input.programId,'bio','lab-mint'),d=Buffer.alloc(165);nativeKeyBytes(mint.address).copy(d);nativeKeyBytes(f.actor).copy(d,32);d[108]=1;
  const destinationAccount={address:key(16),owner:PROGRAMS.tokenProgram,executable:false,data:d};
  const plan=await planAccruedPositionClaim({...f,actor:key(17),nonce:1n,positionSeq:0n,destinationAccount,maxRent:1000000n});
  assert.equal(plan.previewAtoms,4756n);assert.equal(plan.beneficiary,f.actor);
  assert.equal(decodeNativeFrame(f.abi,plan.frame).payload.readBigUInt64LE(32),2378n);
  const bad={...destinationAccount,data:Buffer.from(d)};nativeKeyBytes(key(17)).copy(bad.data,32);
  await assert.rejects(()=>planAccruedPositionClaim({...f,nonce:1n,positionSeq:0n,destinationAccount:bad,maxRent:1000000n}),{code:'TOKEN_AUTHORITY'});
  await assert.rejects(()=>planAccruedPositionClaim({...f,nonce:1n,positionSeq:0n,destinationAccount,upToAccrued:7135n,maxRent:1000000n}),{code:'SETTLEMENT_UNACCRUED_CLAIM'});
  const firstClaim=await planAccruedPositionClaim({...f,nonce:1n,positionSeq:0n,destinationAccount:null,maxRent:1000000n});
  const ata=await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(f.actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint.address));
  assert.equal(firstClaim.suffix.at(-1).address,ata.address);assert.deepEqual(firstClaim.labDestinationSetup,{beneficiary:f.actor});
});

test('completed-hour closure returns SOL only to the saved opener, and incomplete hours remain locked',async()=>{
  const f=await fixture(),args={...f,hour:0n,nonce:1n,maxRent:1000000n};
  await assert.rejects(()=>planFinalHourClosure(args),{code:'SETTLEMENT_HOUR_NOT_CLOSABLE'});
  const b=f.hourAccount.data.subarray(120);b[40]=4;b.writeBigUInt64LE(1n,32);b.writeBigUInt64LE(1n,49);b.writeBigUInt64LE(2378n,249);b.writeBigUInt64LE(b.readBigUInt64LE(8)-2378n,265);
  const own=await planFinalHourClosure(args);assert.equal(own.dynamicAccounts.length,0);assert.equal(own.refundRecipient,f.actor);
  assert.equal(own.previewRefundLamports,10000000n);
  const cranked=await planFinalHourClosure({...args,actor:key(17)});assert.deepEqual(cranked.dynamicAccounts,[{address:f.actor,writable:true,signer:false}]);
  assert.equal(cranked.instruction.accounts.length,11);assert.equal(cranked.refundRecipient,f.actor);
});
