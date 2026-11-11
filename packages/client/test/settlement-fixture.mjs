import { ByteWriter,typedHash } from '../../protocol-core/src/index.mjs';
import { encodePositionBody,encodeHourBody,emptyHourWire } from '../../settlement/src/wire.mjs';
import { normalWeight,K_WEIGHT,W_FLOOR } from '../../settlement/src/weights.mjs';
import { nativeKeyBytes } from '../src/native.mjs';
import { baseConfigR2Id,PROGRAMS } from '../src/release.mjs';
import { clientFixture,hash } from './native-fixture.mjs';
import { recordAccount } from './account-fixture.mjs';
const MAX=(1n<<64n)-1n,le=n=>new ByteWriter(8).u64(n).finish();
const id=(c,k,...tail)=>typedHash(14,Buffer.concat([c.release.domain,new ByteWriter(2).u16(k).finish(),...tail]));
// Canonical RPC codec fixtures only; these bytes do not assert chain execution.
export async function settlementFixture({lazy=true,champion=false,empty=false,schema=4}={}){
  const c=await clientFixture(),instance=hash('settlement-root'),pid=id(c,27,instance,le(0n)),beneficiary=nativeKeyBytes(c.actor);
  const weight=normalWeight({scope:champion?'BIO':'COMPONENT',B_int:champion?7200000n:120000n,q_ppm:champion?2000000n:1000000n});
  const r=Buffer.alloc(256);r.writeBigUInt64LE(1n,0);r.writeBigUInt64LE(lazy?3n:0n,8);r.writeBigUInt64LE(BigInt(c.release.input.rewardStart)+3600n,16);
  for(const at of [72,80,232])r.writeBigUInt64LE(MAX,at);
  const registryAccount=await recordAccount(c.release,{kind:26,schema:2,seeds:['bio','mining'],id:baseConfigR2Id(c.release),body:r});
  const h=emptyHourWire(0n);h.openedTime=BigInt(c.release.input.rewardStart)+3600n;h.openedSlot=10n;
  if(!empty){Object.assign(h,{rootCutoff:1n,rootCursor:1n,members:1n,normalWeight:weight,totalWeight:weight,denominator:W_FLOOR});}
  if(champion){Object.assign(h,{kActivationId:hash('activation'),kInstance:instance,kBeneficiary:beneficiary,kIntervalId:pid,kWeight:K_WEIGHT,totalWeight:weight+K_WEIGHT});}
  const extension=Buffer.alloc(schema===4?65:64);extension.writeBigUInt64LE(empty?MAX:0n,0);extension.writeBigUInt64LE(empty?MAX:0n,8);
  extension.writeBigUInt64LE(lazy||empty?MAX:0n,16);extension.writeBigUInt64LE(MAX,24);beneficiary.copy(extension,32);if(schema===4)extension[64]=lazy?1:0;
  const hourAccount=await recordAccount(c.release,{kind:18,schema,seeds:['bio','hour',le(0n)],id:id(c,18,le(0n)),body:Buffer.concat([encodeHourBody(h),extension])});
  const p={instance,rootSeq:0n,rootDirectorySeq:0n,registrationM:hash('registration'),beneficiary,rootRevision:0n,
    B_int:champion?7200000n:120000n,q_ppm:champion?2000000:1000000,L_quarters:champion?12:4,weight,start:0n,end:1n,endReason:1,endBusiness:hash('exit'),
    createdTime:0n,createdSlot:1n,endedTime:1n,endedSlot:2n,accrued:0n,paid:0n,nextUnsettledHour:0n};
  const positionAccount=await recordAccount(c.release,{kind:27,schema:2,seeds:['bio','reg',instance,le(0n)],id:pid,body:encodePositionBody(p)});
  const b=Buffer.alloc(260);instance.copy(b);b.writeBigUInt64LE(1n,40);pid.copy(b,48);b[80]=1;b.writeBigUInt64LE(1n,81);b[129]=1;b.writeBigUInt64LE(MAX,146);
  const rootRegAccount=await recordAccount(c.release,{kind:25,seeds:['bio','root-reg',instance],id:instance,body:b});
  const d=Buffer.alloc(138);instance.copy(d,9);instance.copy(d,41);d.writeBigUInt64LE(MAX,122);d.writeBigUInt64LE(MAX,130);
  const directoryAccount=await recordAccount(c.release,{kind:28,schema:2,seeds:['bio','mining-root',le(0n)],id:id(c,28,Buffer.from([0]),le(0n)),body:d});
  const clock=Buffer.alloc(40);clock.writeBigInt64LE(BigInt(c.release.input.rewardStart)+3600n,32);
  return {...c,instance,pid,p,registryAccount,hourAccount,positionAccount,rootRegAccount,directoryAccount,
    clockAccount:{address:PROGRAMS.clockSysvar,owner:'Sysvar1111111111111111111111111111111111111',executable:false,data:clock}};
}

