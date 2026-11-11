import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ByteWriter,sha256,typedHash } from '../../protocol-core/src/index.mjs';
import { TOTAL_SUPPLY } from '../../settlement/src/emission.mjs';
import { PROGRAMS,baseConfigR2Id,validateProductionRelease } from '../src/release.mjs';
import { nativeKeyAddress,nativeKeyBytes } from '../src/native.mjs';
import { decodeClassicMint,decodeClassicTokenAccount } from '../src/accounts.mjs';
import { decodeNativeRootRegistration,decodeNativeEconomyConfig,decodeNativeTreasury,validateNativeTreasuryBalances,decodeNativeClock } from '../src/economy-accounts.mjs';
import { clientFixture,key,hash } from './native-fixture.mjs';
import { recordAccount } from './account-fixture.mjs';

const MAX=(1n<<64n)-1n,le64=value=>new ByteWriter(8).u64(value).finish();
const clone=account=>({...account,data:Buffer.from(account.data)});
const changed=(account,mutate)=>{const copy=clone(account);mutate(copy.data.subarray(120));return copy;};
const positionId=(release,instance,sequence)=>typedHash(14,Buffer.concat([release.domain,new ByteWriter(2).u16(27).finish(),instance,le64(sequence)]));

// Unchanged records from a genuine accepted local SBF ledger. No lifecycle,
// owner, counter, identity, or account byte is restored or rewritten here.
async function savedLedger(){
  const input=JSON.parse(readFileSync(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url),'utf8'));
  const release=await validateProductionRelease(input,{localPublicFixture:true});
  const bytes=readFileSync(new URL('../../../programs/biolab-economy/evidence/actual-final-bio-7fa418ac-a247b6eef233.bin',import.meta.url));
  assert.equal(sha256(bytes).toString('hex'),'a247b6eef23398840a0ed15b81738aa8cdf9e38efc425ce047d889cfe3210279');
  assert.equal(bytes.subarray(0,8).toString(),'BIOFIN01');assert.deepEqual(bytes.subarray(8,40),baseConfigR2Id(release));
  const accounts=new Map();let offset=104;const count=bytes.readUInt32LE(offset);offset+=4;
  for(let i=0;i<count;i++){
    const address=nativeKeyAddress(bytes.subarray(offset,offset+32));offset+=32;
    const lamports=bytes.readBigUInt64LE(offset);offset+=8;
    const owner=nativeKeyAddress(bytes.subarray(offset,offset+32));offset+=32;
    assert.ok(bytes[offset]===0||bytes[offset]===1);const executable=bytes[offset++]===1;
    const rentEpoch=bytes.readBigUInt64LE(offset);offset+=8;const length=bytes.readUInt32LE(offset);offset+=4;
    assert.ok(offset+length<=bytes.length);const data=Buffer.from(bytes.subarray(offset,offset+length));offset+=length;
    accounts.set(address,{address,lamports,owner,executable,rentEpoch,data});
  }
  assert.equal(offset,bytes.length);assert.equal(accounts.size,1081);
  const kind=number=>[...accounts.values()].filter(account=>account.owner===input.programId&&account.data.length>=120&&account.data.readUInt16LE(10)===number);
  return {release,accounts,config:kind(36)[0],treasury:kind(6)[0],registrations:kind(25),clock:accounts.get(PROGRAMS.clockSysvar)};
}
const ledgerPromise=savedLedger();

async function synthetic(){
  const {release}=await clientFixture(),instance=hash('P10.2a synthetic instance');
  const blank=Buffer.alloc(260);instance.copy(blank);blank[80]=1;blank[129]=1;blank.writeBigUInt64LE(MAX,146);blank.writeBigUInt64LE(MAX,244);
  const rootReg=body=>recordAccount(release,{kind:25,seeds:['bio','root-reg',instance],id:instance,body});
  const registered=Buffer.from(blank);registered.writeBigUInt64LE(9n,32);registered.writeBigUInt64LE(2n,40);positionId(release,instance,1n).copy(registered,48);
  registered[80]=0;registered.writeBigUInt64LE(5n,244);
  const configBody=Buffer.alloc(304);configBody.write('ECOCFG03');release.hashes.releaseHash.copy(configBody,8);nativeKeyBytes(release.input.bootstrap).copy(configBody,40);
  nativeKeyBytes(release.pdas.labMint.address).copy(configBody,72);nativeKeyBytes(release.pdas.labReserve.address).copy(configBody,104);nativeKeyBytes(release.pdas.labAuthority.address).copy(configBody,136);
  configBody.writeBigUInt64LE(TOTAL_SUPPLY,168);configBody[176]=6;configBody.writeBigInt64LE(release.initNotBefore,184);
  release.hashes.validatorHash.copy(configBody,192);release.hashes.ruleHash.copy(configBody,224);configBody.writeBigInt64LE(release.seedOpen,256);configBody.writeBigInt64LE(release.rewardStart,264);release.hashes.initialSeedSetId.copy(configBody,272);
  const config=await recordAccount(release,{kind:36,schema:3,seeds:['bio','econ-config'],id:baseConfigR2Id(release),body:configBody});
  const treasury=values=>{const body=new ByteWriter(64);for(const value of values)body.u64(value);return recordAccount(release,{kind:6,seeds:['bio','treasury'],id:baseConfigR2Id(release),body:body.finish()});};
  return {release,instance,blank,registered,rootReg,config,treasury};
}

test('unchanged genuine checkpoint config, all 82 RootRegs, Treasury balances and Clock decode against the exact saved release',async()=>{
  const f=await ledgerPromise,config=await decodeNativeEconomyConfig(f.release,f.config);
  assert.equal(config.initializedAt,7200n);assert.equal(config.seedOpen,7200n);assert.equal(config.rewardStart,93600n);
  assert.equal(config.totalSupply,TOTAL_SUPPLY);assert.equal(config.bootstrap,f.release.input.bootstrap);
  assert.equal(config.labMint,f.release.pdas.labMint.address);assert.deepEqual(config.initialSeedSetId,f.release.hashes.initialSeedSetId);
  assert.equal(f.registrations.length,82);let empty=0,registered=0,revoked=0;
  for(const account of f.registrations){const registration=await decodeNativeRootRegistration(f.release,account,account.data.subarray(120,152));
    if(registration.ordinaryCount===0n)empty++;else registered++;
    if(registration.revocationCause===2)revoked++;
    assert.equal(registration.coverageSequence,registration.ordinaryCount);assert.equal(registration.nextCoverageHour,MAX);
    assert.equal(registration.activationCount,0n);assert.equal(registration.kEnd,0n);assert.equal(registration.certificateFault,false);
  }
  assert.equal(empty,21);assert.equal(registered,61);assert.equal(revoked,81);
  const treasury=await decodeNativeTreasury(f.release,f.treasury);
  assert.deepEqual(treasury.values,[99513413241993n,0n,0n,486537733067n,48000000n,341n,49024940n,0n]);
  const mint=decodeClassicMint(f.accounts.get(f.release.pdas.labMint.address),{expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null});
  const reserve=decodeClassicTokenAccount(f.accounts.get(f.release.pdas.labReserve.address),{expectedMint:mint.address,expectedOwner:f.release.pdas.labAuthority.address,reserve:true});
  const checked=validateNativeTreasuryBalances(f.release,treasury,{mint,reserve});assert.equal(checked.inboundSealed,0n);assert.equal(checked.reserveAmount,99999950975060n);
  const clock=decodeNativeClock(f.clock);assert.equal(clock.slot,10n);assert.equal(clock.unixTimestamp,1321201n);
});

test('each native reader rejects hostile owner, executable, PDA, schema, domain/config/key, reserved header and exact-length mutations',async()=>{
  const f=await ledgerPromise,registration=f.registrations[0],instance=registration.data.subarray(120,152);
  const cases=[[f.config,account=>decodeNativeEconomyConfig(f.release,account)],[f.treasury,account=>decodeNativeTreasury(f.release,account)],
    [registration,account=>decodeNativeRootRegistration(f.release,account,instance)]];
  // These are host-only corruptions of saved records, not newly executed state.
  for(const [account,decode] of cases){
    for(const update of [value=>value.owner=PROGRAMS.systemProgram,value=>value.executable=true,value=>value.address=key(20),
      value=>value.data[0]^=1,value=>value.data.writeUInt16LE(9,12),value=>value.data[14]=1,value=>value.data[16]^=1,
      value=>value.data[48]^=1,value=>value.data[84]^=1,value=>value.data[85]=1,value=>value.data[88]^=1,
      value=>value.data=Buffer.concat([value.data,Buffer.from([0])]),value=>value.data=value.data.subarray(0,value.data.length-1)]){
      const invalid=clone(account);update(invalid);await assert.rejects(decode(invalid));
    }
    await assert.rejects(decode(null));
  }
});

test('RootReg preserves native open/end, physical post-emission boundaries and backlog semantics without inventing extra restrictions',async()=>{
  const f=await synthetic(),blank=await decodeNativeRootRegistration(f.release,await f.rootReg(f.blank),f.instance);
  assert.equal(blank.ordinaryCount,0n);assert.equal(blank.directorySequence,MAX);assert.equal(blank.ordinaryEnd,0n);
  const open=await decodeNativeRootRegistration(f.release,await f.rootReg(f.registered),f.instance);
  assert.equal(open.ordinaryEnd,null);assert.equal(open.coverageSequence,0n);assert.equal(open.nextCoverageHour,MAX);assert.equal(open.directorySequence,5n);
  const body=Buffer.from(f.registered);body[80]=1;body.writeBigUInt64LE(MAX,81);body.writeBigUInt64LE(1n,89);body[129]=1;body.writeBigUInt64LE(MAX,130);
  // Native root_reg deliberately does not require a nonzero activation ID only
  // because activationCount>0. Linked Activation validation belongs to planners.
  body[154]=1;hash('host-only revocation').copy(body,155);body[203]=1;hash('host-only certificate fault').copy(body,204);
  const result=await decodeNativeRootRegistration(f.release,await f.rootReg(body),f.instance);
  assert.equal(result.ordinaryEnd,MAX);assert.equal(result.kEnd,MAX);assert.equal(result.activationCount,1n);assert.equal(result.certificateFault,true);
  const kOpen=Buffer.from(body);kOpen[129]=0;kOpen.writeBigUInt64LE(0n,130);
  assert.equal((await decodeNativeRootRegistration(f.release,await f.rootReg(kOpen),f.instance)).kEnd,null);
});

test('RootReg rejects every native body invariant using explicitly synthetic hostile records',async()=>{
  const f=await synthetic(),account=await f.rootReg(f.registered);
  const invalid=[b=>b[0]^=1,b=>b.writeBigUInt64LE(3n,138),b=>b.writeBigUInt64LE(1n,252),b=>b[80]=2,b=>b[129]=2,b=>b[203]=2,b=>b[154]=4,
    b=>{b.writeBigUInt64LE(2n,138);b.writeBigUInt64LE(0n,146);},b=>b.writeBigUInt64LE(1n,81),
    b=>{b.writeBigUInt64LE(1n,89);b[129]=0;b.writeBigUInt64LE(1n,130);},b=>b[97]=1,b=>b[129]=0,b=>b.writeBigUInt64LE(1n,130),
    b=>b.writeBigUInt64LE(MAX,244),b=>b[48]^=1,b=>b[155]=1,b=>b.writeBigInt64LE(1n,187),b=>b.writeBigUInt64LE(1n,195),
    b=>b[154]=1,b=>{b[154]=1;b[155]=1;b.writeBigInt64LE(-1n,187);},b=>b[204]=1,b=>b.writeBigUInt64LE(1n,236),b=>b[203]=1];
  for(const mutate of invalid)await assert.rejects(decodeNativeRootRegistration(f.release,changed(account,mutate),f.instance));
  const empty=await f.rootReg(f.blank);
  for(const mutate of [b=>b.writeBigUInt64LE(1n,244),b=>b[48]=1,b=>b[80]=0,b=>b.writeBigUInt64LE(1n,81)])
    await assert.rejects(decodeNativeRootRegistration(f.release,changed(empty,mutate),f.instance));
});

test('EconConfig rejects every fixed identity/hash and schedule corruption, while accepting both admitted initialization endpoints',async()=>{
  const f=await synthetic();assert.equal((await decodeNativeEconomyConfig(f.release,f.config)).initializedAt,f.release.initNotBefore);
  assert.equal((await decodeNativeEconomyConfig(f.release,changed(f.config,b=>b.writeBigInt64LE(f.release.seedOpen,184)))).initializedAt,f.release.seedOpen);
  for(const offset of [0,8,40,72,104,136,168,176,177,192,224,272])await assert.rejects(decodeNativeEconomyConfig(f.release,changed(f.config,b=>b[offset]^=1)));
  for(const mutate of [b=>b.writeBigInt64LE(-1n,184),b=>b.writeBigInt64LE(f.release.initNotBefore-1n,184),b=>b.writeBigInt64LE(f.release.seedOpen+1n,184),
    b=>b.writeBigInt64LE(f.release.seedOpen+1n,256),b=>b.writeBigInt64LE(f.release.rewardStart-1n,264),
    b=>{b.writeBigInt64LE(f.release.initNotBefore,256);b.writeBigInt64LE(f.release.initNotBefore+86400n,264);}])
    await assert.rejects(decodeNativeEconomyConfig(f.release,changed(f.config,mutate)),/SCHEDULE/);
});

test('Treasury keeps donation/external-burn inequalities and does not invent standalone asOf or cumulative-paid bounds',async()=>{
  const f=await ledgerPromise,treasury=await decodeNativeTreasury(f.release,f.treasury);
  const mint=decodeClassicMint(f.accounts.get(f.release.pdas.labMint.address),{expectedDecimals:6,expectedMintAuthority:null,expectedFreezeAuthority:null});
  const reserve=decodeClassicTokenAccount(f.accounts.get(f.release.pdas.labReserve.address),{expectedMint:mint.address,expectedOwner:f.release.pdas.labAuthority.address,reserve:true});
  // Host-only numeric variants exercise native inequalities; no SPL transfer or
  // external burn is claimed to have occurred in the saved ledger.
  const donated=validateNativeTreasuryBalances(f.release,treasury,{mint,reserve:{...reserve,amount:reserve.amount+10n}});assert.equal(donated.inboundSealed,10n);
  const externallyBurned=validateNativeTreasuryBalances(f.release,treasury,{mint:{...mint,supply:mint.supply-100n},reserve});assert.equal(externallyBurned.mintSupply,mint.supply-100n);
  const hostBook=changed(f.treasury,b=>{b.writeBigUInt64LE(MAX,40);b.writeBigUInt64LE(MAX,48);});
  const parsed=await decodeNativeTreasury(f.release,hostBook);assert.equal(parsed.asOf,MAX);assert.equal(parsed.paid,MAX);
  assert.equal(validateNativeTreasuryBalances(f.release,parsed,{mint,reserve}).paid,MAX);
});

test('Treasury rejects checked-book overflow, reserved/burn bounds, invalid financial balances and noncanonical decoded token identities',async()=>{
  const f=await synthetic();
  await assert.rejects(decodeNativeTreasury(f.release,await f.treasury([MAX,1n,0n,0n,0n,0n,0n,0n])),/OVERFLOW/);
  for(const values of [[0n,0n,0n,0n,TOTAL_SUPPLY+1n,0n,0n,0n],[0n,0n,0n,0n,0n,0n,0n,1n]])await assert.rejects(decodeNativeTreasury(f.release,await f.treasury(values)),/FACTS/);
  const treasury=await decodeNativeTreasury(f.release,await f.treasury([10n,20n,30n,40n,5n,0n,0n,0n]));
  const mint={address:f.release.pdas.labMint.address,mintAuthority:null,freezeAuthority:null,decimals:6,supply:1000n};
  const reserve={address:f.release.pdas.labReserve.address,mint:mint.address,owner:f.release.pdas.labAuthority.address,amount:100n,delegate:null,delegatedAmount:0n,closeAuthority:null};
  assert.equal(validateNativeTreasuryBalances(f.release,treasury,{mint,reserve}).bookSum,100n);
  for(const badMint of [{...mint,address:key(20)},{...mint,mintAuthority:key(20)},{...mint,freezeAuthority:key(20)},{...mint,decimals:9},{...mint,supply:TOTAL_SUPPLY},{...mint,supply:99n},{...mint,supply:1000}])
    assert.throws(()=>validateNativeTreasuryBalances(f.release,treasury,{mint:badMint,reserve}));
  for(const badReserve of [{...reserve,address:key(20)},{...reserve,mint:key(20)},{...reserve,owner:key(20)},{...reserve,delegate:key(20)},{...reserve,delegatedAmount:1n},{...reserve,closeAuthority:key(20)},{...reserve,amount:99n},{...reserve,amount:1001n},{...reserve,amount:100}])
    assert.throws(()=>validateNativeTreasuryBalances(f.release,treasury,{mint,reserve:badReserve}));
  assert.throws(()=>validateNativeTreasuryBalances(f.release,{...treasury,values:[MAX,1n,0n,0n,0n,0n,0n,0n]},{mint,reserve}),/OVERFLOW/);
});

test('Clock validates the exact canonical raw sysvar and preserves signed epoch timestamps and BigInt fields',async()=>{
  const f=await ledgerPromise,clock=clone(f.clock);clock.data.writeBigUInt64LE(MAX,0);clock.data.writeBigInt64LE(-7n,8);clock.data.writeBigUInt64LE(MAX,16);clock.data.writeBigUInt64LE(MAX,24);
  const decoded=decodeNativeClock(clock);assert.equal(decoded.slot,MAX);assert.equal(decoded.epochStartTimestamp,-7n);assert.equal(decoded.epoch,MAX);assert.equal(decoded.leaderScheduleEpoch,MAX);
  decoded.bytes[0]^=1;assert.notDeepEqual(decoded.bytes,clock.data);
  for(const bad of [{...clock,address:key(20)},{...clock,owner:PROGRAMS.systemProgram},{...clock,executable:true},{...clock,data:clock.data.subarray(0,39)},{...clock,data:Buffer.concat([clock.data,Buffer.from([0])])},null])assert.throws(()=>decodeNativeClock(bad));
  const negative=clone(clock);negative.data.writeBigInt64LE(-1n,32);assert.throws(()=>decodeNativeClock(negative),/TIME/);
});
