import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { planSelfPurchase } from '../src/purchase-workflow.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { validateProductionRelease,PROGRAMS } from '../src/release.mjs';
import { loadNativeAbi,nativeKeyAddress,decodeNativeFrame,nativeKeyBytes } from '../src/native.mjs';
import { nativeActionIntent } from '../src/player-settlement.mjs';
import { decodeBuyPayload } from '../../launchpad/src/codec.mjs';
import { key } from './native-fixture.mjs';

const release=await validateProductionRelease(JSON.parse(await readFile(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url),'utf8')),{localPublicFixture:true});
const abi=loadNativeAbi(await readFile(new URL('../../../programs/biolab-economy/operations.p0r2.json',import.meta.url)),{expectedHash:release.input.abiHash});
const cases=await Promise.all([1,2,3,4].map(async c=>parseJsonWithBigInts(await readFile(new URL(`../../../programs/transaction-transport/evidence/purchase-result-bank-76b35cfb-class-${c}.json`,import.meta.url),'utf8'))));
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const raw=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};
function mapRows(rows){return new Map(rows.map(row=>[row.address,row.missing===true?null:{...row,data:Buffer.from(row.data[0],'base64')}]));}
function fixture(classId=1,{phase='beforeAccounts',onRead}={}){
  const c=cases[classId-1],map=mapRows(c[phase]),after=mapRows(c.afterAccounts),frame=decodeNativeFrame(abi,Buffer.from(c.frameHex,'hex')),payload=decodeBuyPayload(frame.payload),calls=[];
  let slot=10n,reads=0;
  const rpc=new ReadOnlyRpc({release,endpoint:'https://recorded-bank.invalid',fetchImpl:async(url,options)=>{
    assert.equal(url,'https://recorded-bank.invalid/');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts'){
      assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[1].minContextSlot<=slot);
      onRead?.({map,after,reads:++reads,addresses:req.params[0]});
      result={context:{slot:++slot},value:req.params[0].map(address=>{assert.ok(map.has(address),`unrecorded account ${address}`);return raw(map.get(address));})};
    }else throw new Error(`unexpected non-read method ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  }});
  const args={release,abi,rpc,actor:c.actor,projectId:payload.projectId,class:classId,quantity:payload.quantity,maxPayment:payload.maxProtocolLamports,maxRent:payload.maxRentLamports};
  const projectAddress=c.instruction.accounts[8].pubkey,mintAddress=c.instruction.accounts[9].pubkey,seasonAddress=c.instruction.accounts[11].pubkey,
    lifetimeAddress=c.instruction.accounts[12].pubkey,opsAddress=c.instruction.accounts[13].pubkey,destination=c.instruction.accounts[14].pubkey;
  const classOffset=()=>120+148+map.get(projectAddress).data.readUInt32LE(120+144)+65*(classId-1);
  const projectValue=(field,value)=>map.get(projectAddress).data.writeBigUInt64LE(value,classOffset()+{cap:33,price:41,issued:49,burned:57}[field]);
  const setQuota=(lifetime,value)=>{const address=lifetime?lifetimeAddress:seasonAddress;map.set(address,structuredClone(after.get(address)));map.get(address).data=Buffer.from(map.get(address).data);map.get(address).data.writeBigUInt64LE(value,lifetime?121:123);};
  return {args,c,map,after,calls,projectAddress,mintAddress,seasonAddress,lifetimeAddress,opsAddress,destination,projectValue,setQuota};
}

test('all four recorded real Bank purchase before-states yield the exact native frame/metas and observed nonce without signing or sending',async()=>{
  for(const classId of [1,2,3,4]){
    const f=fixture(classId),out=await planSelfPurchase(f.args);assert.equal(out.decision,'ACTION');assert.equal(out.requiresSimulation,true);
    assert.equal(out.rentSufficiencyVerified,false);assert.equal(out.networkFeeQuote,null);assert.equal(out.networkSubmitted,false);
    assert.equal(out.action.frame.toString('hex'),f.c.frameHex);assert.equal(out.action.nonce,f.c.purchaseResult.nativeNonceBefore);
    assert.equal(out.preview.project.unitPrice,500000n);assert.equal(out.preview.principal.totalLamports,f.args.quantity*600000n);
    assert.equal(out.preview.destination.address,f.destination);assert.equal(out.preview.destination.creationRequired,true);
    assert.equal(out.preview.quotas.seasonal.issued,0n);assert.equal(out.preview.quotas.lifetime.issued,0n);
    assert.deepEqual(out.action.dynamicAccounts,[]);assert.deepEqual(out.action.instruction.accounts.map(a=>({pubkey:a.address,isSigner:Boolean(a.role&2),isWritable:Boolean(a.role&1)})),f.c.instruction.accounts);
    const intent=nativeActionIntent(out.action,resources);assert.equal(intent.nonce,f.c.purchaseResult.nativeNonceBefore.toString());assert.equal(intent.payloadHex,f.c.frameHex.slice(304));
    assert.equal(f.calls.filter(c=>c.method==='getMultipleAccounts').length,5);assert.deepEqual([...new Set(f.calls.map(c=>c.method))].sort(),['getGenesisHash','getMultipleAccounts']);
  }
});

test('a real existing canonical ATA and a proven system-owned prefunded canonical ATA are handled without arbitrary setup',async()=>{
  const live=fixture(1,{phase:'afterAccounts'}),out=await planSelfPurchase(live.args);assert.equal(out.decision,'ACTION');
  assert.equal(out.preview.destination.creationRequired,false);assert.equal(out.preview.destination.amount,30n);assert.equal(out.action.nonce,3n);
  const prefunded=fixture();prefunded.map.set(prefunded.destination,{address:prefunded.destination,owner:PROGRAMS.systemProgram,executable:false,lamports:12345n,rentEpoch:0n,data:Buffer.alloc(0)});
  const planned=await planSelfPurchase(prefunded.args);assert.equal(planned.decision,'ACTION');assert.equal(planned.preview.destination.creationRequired,true);
  assert.equal(planned.preview.destination.prefundedLamports,12345n);assert.equal(decodeBuyPayload(planned.action.payload).destinationMode,1);
  assert.equal(Object.hasOwn(planned.action,'labDestinationSetup'),false);
  const quotaPrefunded=fixture();for(const [address,lamports]of [[quotaPrefunded.seasonAddress,123n],[quotaPrefunded.lifetimeAddress,456n]])
    quotaPrefunded.map.set(address,{address,owner:PROGRAMS.systemProgram,executable:false,lamports,rentEpoch:0n,data:Buffer.alloc(0)});
  const quotas=await planSelfPurchase(quotaPrefunded.args);assert.equal(quotas.decision,'ACTION');
  assert.equal(quotas.preview.quotas.seasonal.fresh,true);assert.equal(quotas.preview.quotas.lifetime.fresh,true);
});

test('native total payment cap and gross principal balance are checked even for a self-sale; rent and fees remain unquoted',async()=>{
  const capped=fixture();capped.args.maxPayment=capped.args.quantity*600000n-1n;
  assert.equal((await planSelfPurchase(capped.args)).reason,'PAYMENT_CAP_TOO_LOW');
  const poor=fixture();poor.map.get(poor.args.actor).lamports=poor.args.quantity*600000n-1n;
  const out=await planSelfPurchase(poor.args);assert.equal(out.reason,'PRINCIPAL_BALANCE_TOO_LOW');assert.equal(out.preview.principal.selfSaleStillRequiresGrossPrincipal,true);
  const exact=fixture();exact.map.get(exact.args.actor).lamports=exact.args.quantity*600000n;exact.args.maxRent=0n;
  const proposed=await planSelfPurchase(exact.args);assert.equal(proposed.decision,'ACTION');assert.equal(proposed.rentSufficiencyVerified,false);
  assert.equal(proposed.preview.maxRent,0n);assert.equal(proposed.preview.principal.includesUnknownRent,false);assert.equal(proposed.preview.principal.includesNetworkFees,false);
});

test('actual price/counters and all project, season and lifetime caps constrain the unsigned proposal',async()=>{
  const price=fixture();price.args.maxPayment=price.args.quantity*600000n;price.projectValue('price',600000n);assert.equal((await planSelfPurchase(price.args)).reason,'PAYMENT_CAP_TOO_LOW');
  const project=fixture();project.projectValue('cap',1n);assert.equal((await planSelfPurchase(project.args)).reason,'PROJECT_CAP_EXCEEDED');
  const season=fixture();season.setQuota(false,50000n);season.setQuota(true,50000n);assert.equal((await planSelfPurchase(season.args)).reason,'SEASON_CAP_EXCEEDED');
  const life=fixture();life.setQuota(true,5000000n);assert.equal((await planSelfPurchase(life.args)).reason,'LIFETIME_CAP_EXCEEDED');
  const unhealthy=fixture();unhealthy.setQuota(false,1n);await assert.rejects(planSelfPurchase(unhealthy.args),/PURCHASE_QUOTA_HEALTH/);
});

test('the maximum native quantity is supported and u64 price/balance arithmetic cannot overflow',async()=>{
  const max=fixture();max.args.quantity=1000n;max.args.maxPayment=600000000n;assert.equal((await planSelfPurchase(max.args)).decision,'ACTION');
  const price=fixture();price.projectValue('price',((1n<<64n)-1n)-100000n);price.args.quantity=2n;price.args.maxPayment=(1n<<64n)-1n;
  await assert.rejects(planSelfPurchase(price.args),/PURCHASE_OVERFLOW/);
  const dest=fixture(1,{phase:'afterAccounts'});dest.map.get(dest.destination).data.writeBigUInt64LE((1n<<64n)-1n,64);
  await assert.rejects(planSelfPurchase(dest.args),/PURCHASE_OVERFLOW/);
});

test('wrong mint authority, decimals, freeze authority, supply and ATA authority/mint/state are rejected',async()=>{
  for(const change of [f=>f.map.get(f.mintAddress).data[44]=1,f=>nativeKeyBytes(key(20)).copy(f.map.get(f.mintAddress).data,4),
    f=>f.map.get(f.mintAddress).data.writeUInt32LE(1,46),f=>f.map.get(f.mintAddress).data.writeBigUInt64LE(1n,36)]){
    const f=fixture();change(f);await assert.rejects(planSelfPurchase(f.args));
  }
  for(const change of [f=>f.map.get(f.destination).owner=PROGRAMS.systemProgram,f=>f.map.get(f.destination).data[108]=2,
    f=>nativeKeyBytes(key(20)).copy(f.map.get(f.destination).data),f=>nativeKeyBytes(key(20)).copy(f.map.get(f.destination).data,32)]){
    const f=fixture(1,{phase:'afterAccounts'});change(f);await assert.rejects(planSelfPurchase(f.args));
  }
});

test('malformed quota, Clock, BaseConfig, EconConfig and nonordinary payer records fail closed',async()=>{
  for(const change of [f=>{f.setQuota(false,1n);f.map.get(f.seasonAddress).owner=PROGRAMS.tokenProgram;},
    f=>f.map.get(PROGRAMS.clockSysvar).owner=PROGRAMS.systemProgram,
    f=>f.map.get(f.c.baseConfigAddress).data[120]^=1,f=>f.map.get(f.c.econConfigAddress).data[128]^=1,
    f=>f.map.get(f.args.actor).owner=PROGRAMS.tokenProgram]){
    const f=fixture();change(f);await assert.rejects(planSelfPurchase(f.args));
  }
  const ops=fixture();ops.map.set(ops.opsAddress,null);assert.equal((await planSelfPurchase(ops.args)).reason,'OPS_NOT_INITIALIZED');
  const missing=fixture();missing.map.set(missing.projectAddress,null);assert.equal((await planSelfPurchase(missing.args)).reason,'PROJECT_NOT_FOUND');
});

test('only the actual chain Clock derives season; pre-opening and issuance-end reads block',async()=>{
  for(const now of [release.seedOpen-1n,release.seedOpen+788400000n]){
    const f=fixture();f.map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(now,32);const out=await planSelfPurchase(f.args);
    assert.equal(out.decision,'BLOCKED');assert.equal(out.reason,'OUTSIDE_ISSUANCE_WINDOW');
  }
});

test('finalized input changes require replanning and Clock movement within a season remains valid',async()=>{
  for(const mutate of [({map},f)=>map.get(f.c.actorNonceAddress).data.writeBigUInt64LE(f.c.purchaseResult.nativeNonceBefore+1n,120),
    ({map},f)=>map.get(f.projectAddress).data[120+148+5+41]^=1,
    ({map},f)=>map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(release.seedOpen+7862400n,32),
    ({map},f)=>map.get(f.args.actor).lamports--]){
    let f;f=fixture(1,{onRead:ctx=>{if(ctx.reads===5)mutate(ctx,f);}});const out=await planSelfPurchase(f.args);assert.equal(out.decision,'REPLAN_STALE_STATE');assert.equal(Object.hasOwn(out,'action'),false);
  }
  const moving=fixture(1,{onRead:({map,reads})=>{if(reads===5){const d=map.get(PROGRAMS.clockSysvar).data;d.writeBigUInt64LE(d.readBigUInt64LE(0)+1n,0);d.writeBigInt64LE(d.readBigInt64LE(32)+1n,32);}}});
  assert.equal((await planSelfPurchase(moving.args)).decision,'ACTION');
  let discovery;discovery=fixture(1,{onRead:({reads})=>{if(reads===4)discovery.projectValue('price',500001n);}});
  const stale=await planSelfPurchase(discovery.args);assert.equal(stale.decision,'REPLAN_STALE_STATE');assert.equal(stale.reason,'DISCOVERY_CHANGED');
});

test('an actual Project external seller is passive, writable and included once while all paying and receiving roles remain actor',async()=>{
  const f=fixture(),seller=key(20);nativeKeyBytes(seller).copy(f.map.get(f.projectAddress).data,120+96);
  f.map.set(seller,{address:seller,owner:PROGRAMS.systemProgram,executable:false,data:Buffer.alloc(0),lamports:1000000n,rentEpoch:0n});
  const out=await planSelfPurchase(f.args);assert.equal(out.decision,'ACTION');assert.equal(out.preview.project.seller,seller);
  assert.deepEqual(out.action.dynamicAccounts,[{address:seller,writable:true,signer:false}]);
  const payload=decodeBuyPayload(out.action.payload);assert.equal(nativeKeyAddress(payload.saleRecipient),seller);
  for(const role of ['principalPayer','materialRecipient','rentPayer'])assert.equal(nativeKeyAddress(payload[role]),f.args.actor);
  assert.deepEqual(out.action.instruction.accounts.filter(a=>a.role&2).map(a=>a.address),[f.args.actor]);
});

test('strict typed API rejects browser counters, role overrides, unsupported classes/quantities/u64 and non-read-only transports',async()=>{
  for(const extra of ['nonce','season','seller','mint','recipient','payer','destination','destinationMode','unitPrice','resources','endpoint']){
    const f=fixture();await assert.rejects(planSelfPurchase({...f.args,[extra]:'forbidden'}),/PURCHASE_FIELDS/);assert.equal(f.calls.length,0);
  }
  for(const patch of [{class:0},{class:5},{class:'1'},{quantity:0n},{quantity:1001n},{quantity:1},{maxPayment:-1n},{maxRent:1n<<64n},{rpc:{}},{projectId:Buffer.alloc(31)}]){
    const f=fixture();await assert.rejects(planSelfPurchase({...f.args,...patch}));assert.equal(f.calls.length,0);
  }
});
