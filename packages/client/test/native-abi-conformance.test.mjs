import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountRole} from '@solana/kit';
import {clientFixture,key,hash} from './native-fixture.mjs';
import * as n from '../src/native.mjs';
import {decodeBuyResult} from '../../launchpad/src/codec.mjs';

// This is the actual launchpad.rs fixed-account contract, independently tested
// by native_sdk_conformance against the real SBF implementation as well.
test('BUY fixed account table matches native quota/ops/delivery order',async()=>{
 const {abi}=await clientFixture(),rows=n.nativeOperation(abi,'BUY_MATERIAL').publicFixedSuffix;
 assert.deepEqual(rows.map(r=>r.role),['Project','Mint','PackAuthority','SeasonQuota','LifetimeQuota','OpsVault','Destination','AssociatedTokenProgram']);
 assert.deepEqual(rows.map(r=>r.writable),[true,true,false,true,true,true,true,false]);
 assert.ok(rows.every(r=>r.signer===false));
 const dynamic=n.nativeOperation(abi,'MATERIALIZE_HOUR').dynamicAccounts;
 assert.ok(dynamic.includes('Directory[r]/RootReg[w]/Position[w]'));
});

test('BUY finalized result is exactly the native 58-byte result, with no six-byte padding',async()=>{
 const {abi,release,actor,frame}=await clientFixture();
 const payload=n.encodeBuyMaterialPayload({projectId:hash('BUY result contract'),class:1,mint:key(20),catalogHash:release.hashes.catalogHash,
   quantity:2n,payer:actor,recipient:actor,destination:key(21),destinationMode:1,seller:actor,unitPrice:500000n,
   resourceFee:100000n,maxPayment:1200000n,rentPayer:actor,maxRent:9000000n,season:7});
 const request=frame('BUY_MATERIAL',payload),result=Buffer.alloc(58);
 for(const [offset,value]of [[0,2n],[8,1000000n],[16,200000n],[24,1234n],[34,9n],[42,11n],[50,99n]])result.writeBigUInt64LE(value,offset);
 result.writeUInt16LE(7,32);
 assert.equal(n.nativeOperation(abi,'BUY_MATERIAL').resultBytes,58);
 assert.deepEqual(n.validateNativeResult(abi,request,result),result);
 assert.deepEqual(decodeBuyResult(result),{quantity:2n,saleLamports:1000000n,resourceLamports:200000n,rentLamports:1234n,
   season:7,projectIssued:9n,seasonIssued:11n,lifetimeIssued:99n});
 for(const wrong of [result.subarray(0,57),Buffer.concat([result,Buffer.alloc(6)])]){
   assert.throws(()=>n.validateNativeResult(abi,request,wrong),/NATIVE_RESULT_LENGTH/);
   assert.throws(()=>decodeBuyResult(wrong));
 }
});

test('fixed-account-only PUT and EMPTY_SKIP refuse extra dynamic metas before wallet signing',async()=>{
 const {abi,release,frame}=await clientFixture();
 const put=n.encodeArtifactPutPayload({kind:501,totalLength:1,artifactSHA:hash('payload'),expectedSequence:0n,offset:0,chunk:Buffer.from([1]),maxRent:0n});
 const aid=(await n.nativePda(release.input.programId,'bio','artifact',Buffer.alloc(32,7))).address;
 await assert.rejects(n.buildNativeInstruction({release,abi,frame:frame('ARTIFACT_PUT',put),suffix:[{name:'Artifact',address:aid}],dynamicAccounts:[{address:key(20),writable:false,signer:false}]}),/NATIVE_NO_DYNAMIC_ACCOUNTS/);
 const roles=n.nativeOperation(abi,'EMPTY_SKIP').publicFixedSuffix;
 assert.deepEqual(roles.map(r=>r.role),['LABMint','LABReserve','LABAuth','Treasury','Registry','CurrentHour','NextEvent']);
 assert.deepEqual(roles.map(r=>r.writable),[false,false,false,true,true,false,false]);
 const map={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury',Registry:'mining'};
 const hour=Buffer.alloc(8);hour.writeBigUInt64LE(5n);const suffix=await Promise.all(roles.map(async r=>({name:r.role,address:map[r.role]?(await n.nativePda(release.input.programId,'bio',map[r.role])).address:r.role==='CurrentHour'?(await n.nativePda(release.input.programId,'bio','hour',hour)).address:key(22)})));
 const raw=frame('EMPTY_SKIP',n.encodeEmptySkipPayload({expectedNextHour:5n,targetExclusive:10n,maxRent:0n}));
 await assert.rejects(n.buildNativeInstruction({release,abi,frame:raw,suffix,dynamicAccounts:[{address:key(23),writable:false,signer:false}]}),/NATIVE_NO_DYNAMIC_ACCOUNTS/);
 const ix=await n.buildNativeInstruction({release,abi,frame:raw,suffix});assert.equal(ix.accounts.length,15);assert.equal(ix.accounts[13].role,AccountRole.READONLY);
});
