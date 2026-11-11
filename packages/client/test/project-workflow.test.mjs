import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,open } from 'node:fs/promises';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { typedHash,businessKey } from '../../protocol-core/src/index.mjs';
import { planCreateProject,decodeNativeCreateProjectResult } from '../src/project-workflow.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { validateProductionRelease,PROGRAMS } from '../src/release.mjs';
import { loadNativeAbi,nativeKeyAddress,nativeKeyBytes,nativePda,nativeNonceOpId,decodeNativeFrame } from '../src/native.mjs';
import { decodeNativeProject,decodeClassicMint } from '../src/accounts.mjs';
import { nativeActionIntent } from '../src/player-settlement.mjs';
import { decodeCreatePayload,MAX_UNIT_PRICE } from '../../launchpad/src/index.mjs';
import { key } from './native-fixture.mjs';

const release=await validateProductionRelease(JSON.parse(await readFile(new URL('../../../programs/biolab-economy/evidence/production-admission-fixture-result58.json',import.meta.url),'utf8')),{localPublicFixture:true});
const abi=loadNativeAbi(await readFile(new URL('../../../programs/biolab-economy/operations.p0r2.json',import.meta.url)),{expectedHash:release.input.abiHash});
const recorded=parseJsonWithBigInts(await readFile(new URL('../../../programs/transaction-transport/evidence/purchase-result-bank-76b35cfb-class-1.json',import.meta.url),'utf8'));
const createBank=parseJsonWithBigInts(await readFile(new URL('../../../programs/transaction-transport/evidence/create-project-bank-76b35cfb-case-1.json',import.meta.url),'utf8'));
const traceFile=await open(new URL('../../../programs/biolab-economy/evidence/econ4r1-full-chain.jsonl',import.meta.url));
const traceBuffer=Buffer.alloc(65536);const traceRead=await traceFile.read(traceBuffer,0,traceBuffer.length,0);await traceFile.close();
const traceRows=traceBuffer.subarray(0,traceRead.bytesRead).toString('utf8').split('\n').slice(0,3).map(line=>JSON.parse(line));
const createRow=traceRows[2],createFrame=Buffer.from(createRow.dataHex,'hex'),createDecoded=decodeNativeFrame(abi,createFrame),createPayload=decodeCreatePayload(createDecoded.payload);
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const max=(1n<<64n)-1n;
const raw=account=>account===null?null:{owner:account.owner,executable:account.executable,lamports:account.lamports,rentEpoch:account.rentEpoch,data:[account.data.toString('base64'),'base64']};
const accountRows=rows=>new Map(rows.map(row=>[row.address,row.missing===true?null:{...row,data:Buffer.from(row.data[0],'base64')}]));
const ordinary=(address,lamports=0n)=>({address,owner:PROGRAMS.systemProgram,executable:false,lamports,rentEpoch:0n,data:Buffer.alloc(0)});

/** HOST-ONLY before-state reconstruction from recorded post-CREATE Bank rows.
 * Its altered nonce/fresh allocations are never described as recorded Bank
 * evidence. Exact CREATE bytes/metas come independently from the Rust trace;
 * the actual 208-byte CREATE result remains in the recorded Bank nonce cache. */
async function hostFixture({nonce=1n,onRead}={}){
  const map=accountRows(recorded.beforeAccounts),calls=[];
  const n=map.get(recorded.actorNonceAddress);n.data.writeBigUInt64LE(nonce,120);
  if(nonce===0n)map.set(recorded.actorNonceAddress,null);
  const id=typedHash(17,Buffer.concat([release.domain,businessKey(release.domain,nativeKeyBytes(recorded.actor),nativeNonceOpId(nonce))]));
  const projectAddress=(await nativePda(release.input.programId,'bio','project',id)).address;
  const mints=await Promise.all([1,2,3,4].map(async classId=>({class:classId,
    address:(await nativePda(release.input.programId,'bio','pack',id,Buffer.from([classId]))).address,
    authority:(await nativePda(release.input.programId,'bio','pack-auth',id,Buffer.from([classId]))).address})));
  for(const address of [projectAddress,...mints.flatMap(m=>[m.address,m.authority])])map.set(address,null);
  const opsAddress=createRow.accounts[17].pubkey;
  // Native CREATE lazily initializes Ops. All other unchanged records retain
  // their actual recorded bytes, including native Base/Econ/Clock.
  map.set(opsAddress,null);
  let slot=10n,reads=0;
  const rpc=new ReadOnlyRpc({release,endpoint:'https://host-fixture.invalid',fetchImpl:async(url,options)=>{
    assert.equal(url,'https://host-fixture.invalid/');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const request=parseJsonWithBigInts(options.body);calls.push(request);let result;
    if(request.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(request.method==='getMultipleAccounts'){
      assert.equal(request.params[1].commitment,'finalized');assert.ok(request.params[1].minContextSlot<=slot);
      onRead?.({map,reads:++reads,addresses:request.params[0]});
      result={context:{slot:++slot},value:request.params[0].map(address=>{assert.ok(map.has(address),`unrecorded host fixture address ${address}`);return raw(map.get(address));})};
    }else throw new Error(`unexpected non-read method ${request.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:request.id,result}));
  }});
  const args={release,abi,rpc,actor:recorded.actor,name:createPayload.name,
    classes:createPayload.classes.map(c=>({class:c.class,cap:c.lifetimeCap,unitPrice:c.priceLamports})),
    maxCreationFee:createPayload.maxProtocolLamports,maxRent:createPayload.maxRentLamports};
  return {args,map,calls,id,projectAddress,mints,opsAddress};
}

async function bankFixture(){
  const f=await hostFixture();f.map.clear();for(const [address,account]of accountRows(createBank.beforeAccounts))f.map.set(address,account);
  return f;
}

test('actual recorded Bank CREATE before-state yields exact independent native trace frame/metas and one unsigned intent',async()=>{
  assert.equal(createRow.seq,1);assert.equal(createRow.expectedResult,'Ok');assert.equal(createDecoded.operation,'CREATE_PROJECT');
  assert.equal(createBank.fixtureOnly,true);assert.equal(createBank.networkBroadcast,false);assert.equal(createBank.abiSHA256,abi.hash);
  assert.equal(createBank.frameHex,createFrame.toString('hex'));assert.deepEqual(createBank.instruction.accounts,createRow.accounts);
  const f=await bankFixture(),out=await planCreateProject(f.args);assert.equal(out.decision,'ACTION');
  assert.equal(out.action.frame.toString('hex'),createBank.frameHex);assert.equal(out.action.nonce,createBank.createResult.nativeNonceBefore);
  assert.deepEqual(out.action.instruction.accounts.map(a=>({pubkey:a.address,isSigner:Boolean(a.role&2),isWritable:Boolean(a.role&1)})),createRow.accounts);
  assert.deepEqual(out.action.dynamicAccounts,[]);assert.equal(out.preview.projectId,f.id.toString('hex'));
  assert.equal(out.preview.project.address,f.projectAddress);assert.deepEqual(out.preview.mints,f.mints);
  assert.equal(out.preview.ops.creationRequired,true);assert.equal(out.preview.allocations.length,6);
  for(const role of ['actor','creator','principalPayer','rentPayer','feePayer','seller'])assert.equal(out.preview[role],recorded.actor);
  assert.equal(out.preview.predictionOnly,true);assert.equal(out.requiresSimulation,true);assert.equal(out.rentSufficiencyVerified,false);
  assert.equal(out.aggregateFundingVerified,false);assert.equal(out.networkFeeQuote,null);assert.equal(out.businessExecutionVerified,false);
  assert.equal(out.transactionExecuted,false);assert.equal(out.networkSubmitted,false);
  const intent=nativeActionIntent(out.action,resources);assert.equal(intent.operation,'CREATE_PROJECT');assert.equal(intent.nonce,'1');
  assert.equal(intent.payloadHex,createFrame.subarray(152).toString('hex'));
  assert.equal(f.calls.filter(c=>c.method==='getMultipleAccounts').length,4);
  assert.deepEqual([...new Set(f.calls.map(c=>c.method))].sort(),['getGenesisHash','getMultipleAccounts']);
});

test('actual recorded Bank post-CREATE cache yields a bound 208-byte result and actual Project/mints decode',async()=>{
  const map=accountRows(createBank.afterAccounts),nonce=map.get(createBank.actorNonceAddress).data;
  assert.equal(nonce.readUInt16LE(160),208);const bytes=nonce.subarray(162,370);
  assert.equal(bytes.toString('hex'),createBank.createResult.resultHex);
  const result=await decodeNativeCreateProjectResult({release,abi,frame:createFrame,result:bytes});
  assert.equal(result.projectAddress,createRow.accounts[8].pubkey);assert.equal(result.creationFeeLamports,10000000n);
  assert.equal(result.rentLamports,12284400n);assert.equal(result.businessExecutionVerified,false);
  const project=await decodeNativeProject(release,map.get(result.projectAddress),result.projectId);
  assert.equal(project.name,'Alpha');assert.equal(nativeKeyAddress(project.creator),recorded.actor);
  assert.equal(project.creationBusiness.toString('hex'),businessKey(release.domain,nativeKeyBytes(recorded.actor),nativeNonceOpId(1n)).toString('hex'));
  assert.deepEqual(project.classes.map(c=>nativeKeyAddress(c.mint)),result.mints);
  for(const [i,address]of result.mints.entries()){
    const mint=decodeClassicMint(map.get(address),{expectedAddress:address,expectedDecimals:0,
      expectedMintAuthority:createRow.accounts[13+i].pubkey,expectedFreezeAuthority:null});assert.equal(mint.supply,0n);
  }
  for(const patch of [Buffer.alloc(207),Buffer.concat([bytes,Buffer.alloc(1)])])await assert.rejects(decodeNativeCreateProjectResult({release,abi,frame:createFrame,result:patch}));
  for(const offset of [0,32,64,96,128,160,192]){
    const bad=Buffer.from(bytes);bad[offset]^=128;
    await assert.rejects(decodeNativeCreateProjectResult({release,abi,frame:createFrame,result:bad}));
  }
  const excessiveRent=Buffer.from(bytes);excessiveRent.writeBigUInt64LE(createPayload.maxRentLamports+1n,200);
  await assert.rejects(decodeNativeCreateProjectResult({release,abi,frame:createFrame,result:excessiveRent}),/PROJECT_RESULT_COST/);
});

test('host-only fresh nonce, prefunded allocation targets and existing strict native Ops are supported',async()=>{
  const fresh=await hostFixture({nonce:0n});const out=await planCreateProject(fresh.args);
  assert.equal(out.decision,'ACTION');assert.equal(out.action.nonce,0n);assert.equal(out.preview.allocations.length,7);
  const f=await hostFixture();for(const address of [f.projectAddress,...f.mints.map(m=>m.address)])f.map.set(address,ordinary(address,12345n));
  const recordedMap=accountRows(recorded.beforeAccounts);f.map.set(f.opsAddress,recordedMap.get(f.opsAddress));
  // Native authorities are read-only PDA placeholders, not allocated records.
  const authority=f.mints[0].authority;f.map.set(authority,ordinary(authority,99n));
  const prefunded=await planCreateProject(f.args);assert.equal(prefunded.decision,'ACTION');assert.equal(prefunded.preview.ops.creationRequired,false);
  assert.equal(prefunded.preview.allocations.length,5);assert.ok(prefunded.preview.allocations.every(a=>a.prefundedLamports===12345n));
  assert.equal(prefunded.preview.authorities[0].exists,true);assert.ok(prefunded.preview.authorities.every(a=>a.allocationRequired===false));
});

test('host-only existing project/mints and malformed fresh-looking state are rejected instead of treated as absent',async()=>{
  for(const change of [f=>f.map.set(f.projectAddress,{...ordinary(f.projectAddress),owner:release.input.programId,data:Buffer.alloc(529)}),
    f=>f.map.set(f.mints[1].address,{...ordinary(f.mints[1].address),owner:PROGRAMS.tokenProgram,data:Buffer.alloc(82)}),
    f=>f.map.set(f.mints[2].address,{...ordinary(f.mints[2].address),executable:true}),
    f=>f.map.set(f.projectAddress,{...ordinary(f.projectAddress),data:Buffer.alloc(1)}),
    f=>f.map.set(f.opsAddress,{...ordinary(f.opsAddress),executable:true}),
    f=>f.map.set(f.opsAddress,{...ordinary(f.opsAddress),owner:release.input.programId,data:Buffer.alloc(136)})]){
    const f=await hostFixture();change(f);await assert.rejects(planCreateProject(f.args));
  }
});

test('host-only known fee shortfalls block while rent, aggregate funding and network fees remain unverified',async()=>{
  const cap=await hostFixture();cap.args.maxCreationFee=9999999n;const capped=await planCreateProject(cap.args);
  assert.equal(capped.reason,'CREATION_FEE_CAP_TOO_LOW');assert.equal(Object.hasOwn(capped,'action'),false);
  const poor=await hostFixture();poor.map.get(poor.args.actor).lamports=9999999n;
  assert.equal((await planCreateProject(poor.args)).reason,'CREATION_FEE_BALANCE_TOO_LOW');
  const exact=await hostFixture();exact.map.get(exact.args.actor).lamports=10000000n;exact.args.maxRent=0n;
  const out=await planCreateProject(exact.args);assert.equal(out.decision,'ACTION');assert.equal(out.rentSufficiencyVerified,false);
  assert.equal(out.aggregateFundingVerified,false);assert.equal(out.preview.maxRent,0n);assert.equal(out.networkFeeQuote,null);
});

test('host-only explicit external seller is passive, present once, and all paying roles stay actor',async()=>{
  const f=await hostFixture(),seller=key(20);f.args.seller=seller;f.map.set(seller,ordinary(seller,1000000n));
  const out=await planCreateProject(f.args);assert.equal(out.decision,'ACTION');assert.equal(out.preview.project.seller,seller);
  assert.deepEqual(out.action.dynamicAccounts,[{address:seller,writable:false,signer:false}]);
  assert.deepEqual(out.action.instruction.accounts.filter(a=>a.role&2).map(a=>a.address),[f.args.actor]);
  const payload=decodeCreatePayload(out.action.payload);assert.equal(nativeKeyAddress(payload.saleRecipient),seller);
  assert.equal(nativeKeyAddress(payload.principalPayer),f.args.actor);assert.equal(nativeKeyAddress(payload.rentPayer),f.args.actor);
  const explicit=await hostFixture();explicit.args.seller=explicit.args.actor;
  assert.deepEqual((await planCreateProject(explicit.args)).action.dynamicAccounts,[]);
  for(const bad of [null,{...ordinary(seller),owner:PROGRAMS.tokenProgram},{...ordinary(seller),executable:true},{...ordinary(seller),data:Buffer.alloc(1)}]){
    const f=await hostFixture();f.args.seller=seller;f.map.set(seller,bad);await assert.rejects(planCreateProject(f.args),/PROJECT_ORDINARY_WALLET/);
  }
  for(const seller of [PROGRAMS.systemProgram,release.pdas.baseConfig.address,f.projectAddress,f.mints[3].authority,f.opsAddress]){
    const f=await hostFixture();f.args.seller=seller;await assert.rejects(planCreateProject(f.args),/PROJECT_WALLET_ALIAS/);
  }
});

test('host-only actual Clock gates issuance; malformed config/clock/actor/nonce fail closed',async()=>{
  for(const timestamp of [release.seedOpen-1n,release.seedOpen+788400000n]){
    const f=await hostFixture();f.map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(timestamp,32);
    assert.equal((await planCreateProject(f.args)).reason,'OUTSIDE_ISSUANCE_WINDOW');
  }
  for(const change of [f=>f.map.get(recorded.baseConfigAddress).data[120]^=1,
    f=>f.map.get(recorded.econConfigAddress).data[128]^=1,
    f=>f.map.get(PROGRAMS.clockSysvar).owner=PROGRAMS.systemProgram,
    f=>f.map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(-1n,32),
    f=>f.map.get(f.args.actor).owner=PROGRAMS.tokenProgram,
    f=>f.map.get(recorded.actorNonceAddress).data[8]^=1]){
    const f=await hostFixture();change(f);await assert.rejects(planCreateProject(f.args));
  }
  const exhausted=await hostFixture({nonce:max});assert.equal((await planCreateProject(exhausted.args)).reason,'ACTOR_NONCE_EXHAUSTED');
});

test('host-only finalized concurrent nonce/account/clock changes require replanning without reserving a nonce',async()=>{
  for(const change of [(map,f)=>map.get(recorded.actorNonceAddress).data.writeBigUInt64LE(2n,120),
    (map,f)=>map.get(f.args.actor).lamports--,
    (map,f)=>map.set(f.projectAddress,ordinary(f.projectAddress,1n)),
    (map,f)=>map.set(f.mints[0].address,ordinary(f.mints[0].address,1n)),
    (map,f)=>map.set(f.mints[1].authority,ordinary(f.mints[1].authority,1n)),
    map=>map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(release.seedOpen+7862400n,32)]){
    let f;f=await hostFixture({onRead:({map,reads})=>{if(reads===4)change(map,f);}});
    const out=await planCreateProject(f.args);assert.equal(out.decision,'REPLAN_STALE_STATE');assert.equal(Object.hasOwn(out,'action'),false);
  }
  const early=await hostFixture({onRead:({map,reads})=>{if(reads===3)map.get(recorded.actorNonceAddress).data.writeBigUInt64LE(2n,120);}});
  assert.equal((await planCreateProject(early.args)).reason,'ACTOR_NONCE_CHANGED');
  const moving=await hostFixture({onRead:({map,reads})=>{if(reads===4){const clock=map.get(PROGRAMS.clockSysvar).data;
    clock.writeBigUInt64LE(clock.readBigUInt64LE(0)+1n,0);clock.writeBigInt64LE(clock.readBigInt64LE(32)+1n,32);}}});
  assert.equal((await planCreateProject(moving.args)).decision,'ACTION');
  const backwards=await hostFixture({onRead:({map,reads})=>{if(reads===4)map.get(PROGRAMS.clockSysvar).data.writeBigUInt64LE(0n,0);}});
  await assert.rejects(planCreateProject(backwards.args),/PROJECT_CLOCK_REGRESSION/);
  const f=await hostFixture();const [a,b]=await Promise.all([planCreateProject(f.args),planCreateProject(f.args)]);
  assert.equal(a.decision,'ACTION');assert.equal(b.decision,'ACTION');assert.equal(a.action.nonce,b.action.nonce);assert.ok(a.action.frame.equals(b.action.frame));
});

test('host-only strict fields, exact four classes, UTF-8 bytes and u64 boundaries reject before transport',async()=>{
  for(const extra of ['nonce','projectId','clock','season','sellerAccount','feePayer','rentPayer','catalogHash','endpoint','resources','suffix']){
    const f=await hostFixture();await assert.rejects(planCreateProject({...f.args,[extra]:'forbidden'}),/PROJECT_FIELDS/);assert.equal(f.calls.length,0);
  }
  for(const name of ['', 'a'.repeat(65),'é'.repeat(33),'bad\nname','bad\x7fname','\ud800']){
    const f=await hostFixture();f.args.name=name;await assert.rejects(planCreateProject(f.args),/PROJECT_NAME/);assert.equal(f.calls.length,0);
  }
  for(const patch of [{classes:[]},{classes:new Array(4)},{maxCreationFee:1},{maxCreationFee:-1n},{maxRent:max+1n},{rpc:{}},{actor:Buffer.alloc(31)}]){
    const f=await hostFixture();await assert.rejects(planCreateProject({...f.args,...patch}));assert.equal(f.calls.length,0);
  }
  for(const patch of [{class:2},{class:'1'},{cap:0n},{cap:1000001n},{cap:1},{unitPrice:MAX_UNIT_PRICE+1n},{unitPrice:-1n},{browserQuote:0}]){
    const f=await hostFixture();Object.assign(f.args.classes[0],patch);await assert.rejects(planCreateProject(f.args));assert.equal(f.calls.length,0);
  }
  const unicode=await hostFixture();unicode.args.name='é'.repeat(32);unicode.args.classes[0].cap=1n;unicode.args.classes[0].unitPrice=0n;
  unicode.args.classes[3].cap=1000000n;unicode.args.classes[3].unitPrice=MAX_UNIT_PRICE;
  const out=await planCreateProject(unicode.args);assert.equal(out.decision,'ACTION');assert.equal(out.action.payload.length,280);
  assert.equal(out.preview.allocations[0].bytes,592);assert.equal(decodeCreatePayload(out.action.payload).name,unicode.args.name);
});

test('host-only caller mutation during RPC cannot change the already validated name/classes/seller snapshot',async()=>{
  let f;f=await hostFixture({onRead:({reads})=>{if(reads===1){f.args.classes[0].cap=0n;f.args.name='changed';f.args.seller=key(21);}}});
  const out=await planCreateProject(f.args);assert.equal(out.decision,'ACTION');const payload=decodeCreatePayload(out.action.payload);
  assert.equal(payload.name,'Alpha');assert.equal(payload.classes[0].lifetimeCap,1000000n);assert.equal(nativeKeyAddress(payload.saleRecipient),recorded.actor);
});
