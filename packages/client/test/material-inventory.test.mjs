import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseJsonWithBigInts,stringifyJsonWithBigInts } from '@solana/rpc-spec-types';
import { sha256,typedHash,encodeProjectBody,prepareMaterialConsumption } from '../../protocol-core/src/index.mjs';
import { validateProductionRelease,baseConfigR2Id,PROGRAMS } from '../src/release.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda,loadNativeAbi } from '../src/native.mjs';
import { ReadOnlyRpc } from '../src/rpc.mjs';
import { decodeNativeSource,decodeNativeProject } from '../src/accounts.mjs';
import { readMaterialInventory,MATERIAL_INVENTORY_LIMITS } from '../src/material-inventory.mjs';
import { planManufacturePartWorkflow } from '../src/workflow.mjs';
import { recordAccount } from './account-fixture.mjs';
import { key } from './native-fixture.mjs';

// Saved, immutable local SBF/Bank evidence. It is never described as a live
// network response. All altered and synthetic cases below are HOST-ONLY.
const saved=async name=>readFile(new URL(`../../../${name}`,import.meta.url));
const release=await validateProductionRelease(JSON.parse(await saved('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
const abi=loadNativeAbi(await saved('programs/biolab-economy/operations.p0r2.json'),{expectedHash:release.input.abiHash});
const purchases=await Promise.all([1,2,3,4].map(async c=>parseJsonWithBigInts((await saved(`programs/transaction-transport/evidence/purchase-result-bank-76b35cfb-class-${c}.json`)).toString())));
const created=parseJsonWithBigInts((await saved('programs/transaction-transport/evidence/create-project-bank-76b35cfb-case-1.json')).toString());
const actor=purchases[0].actor;
const toMap=rows=>new Map(rows.map(a=>[a.address,a.missing?null:{...a,data:Buffer.from(a.data[0],'base64')}]));
const copy=map=>new Map([...map].map(([a,v])=>[a,v===null?null:{...v,data:Buffer.from(v.data)}]));
const raw=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:a.lamports,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};
const ordinary=(address,lamports=0n)=>({address,owner:PROGRAMS.systemProgram,executable:false,lamports,rentEpoch:0n,data:Buffer.alloc(0)});
const checkpoint=await (async()=>{
  const b=await saved('programs/biolab-economy/evidence/actual-final-bio-76b35cfb-6dc5c36b1687.bin');
  assert.equal(sha256(b).toString('hex'),'6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe');
  assert.equal(b.subarray(40,72).toString('hex'),'76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e');
  assert.deepEqual(b.subarray(8,40),baseConfigR2Id(release));let at=108;const map=new Map();
  for(let i=0;i<b.readUInt32LE(104);i++){
    const address=nativeKeyAddress(b.subarray(at,at+32)),lamports=b.readBigUInt64LE(at+32),owner=nativeKeyAddress(b.subarray(at+40,at+72));
    const executable=b[at+72]===1,rentEpoch=b.readBigUInt64LE(at+73),length=b.readUInt32LE(at+81);at+=85;
    map.set(address,{address,owner,lamports,executable,rentEpoch,data:Buffer.from(b.subarray(at,at+length))});at+=length;
  }
  assert.equal(at,b.length);assert.equal(map.size,1081);return map;
})();
const nativeKind=kind=>[...checkpoint.values()].filter(a=>a.owner===release.input.programId&&a.data.length>=120&&a.data.readUInt16LE(10)===kind);
const projectAccount=nativeKind(9)[0],projectId=Buffer.from(projectAccount.data.subarray(88,120));
const sourceAccounts=nativeKind(11),sourceIds=sourceAccounts.slice(0,16).map(a=>Buffer.from(a.data.subarray(88,120)));
const pda=(...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
const mints=await Promise.all([1,2,3,4].map(c=>pda('pack',projectId,Buffer.from([c]))));
const atas=await Promise.all(mints.map(mint=>nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint)).then(p=>p.address)));
const nonceAddress=await pda('actor-nonce',nativeKeyBytes(actor));
// Cumulative prefix after the four sequential purchases: keep each saved row
// unchanged, with later rows replacing earlier common/project records.
const purchased=new Map();for(const purchase of purchases)for(const [a,v]of toMap(purchase.afterAccounts))purchased.set(a,v);

function fixture(initial=checkpoint,{onRead}={}){
  const map=copy(initial),calls=[];let slot=100n,reads=0;
  const rpc=new ReadOnlyRpc({release,endpoint:'https://material-recorded.invalid',fetchImpl:async(url,options)=>{
    assert.equal(url,'https://material-recorded.invalid/');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts'){
      assert.equal(req.params[1].commitment,'finalized');assert.ok(req.params[1].minContextSlot<=slot);assert.ok(req.params[0].length<=100);
      onRead?.({map,reads:++reads,addresses:req.params[0]});result={context:{slot:++slot},value:req.params[0].map(address=>{
        assert.ok(map.has(address),`fixture has no recorded or explicitly absent account ${address}`);return raw(map.get(address));
      })};
    }else assert.fail(`unexpected non-read method ${req.method}`);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));
  }});
  return {map,calls,args:{release,rpc,actor,projectIds:[Buffer.from(projectId)],sourceIds:[]}};
}
const read=f=>readMaterialInventory(f.args);
const projectClassOffset=(map,c)=>120+148+map.get(projectAccount.address).data.readUInt32LE(264)+65*(c-1);

test('actual four sequential Bank purchases normalize inventory directly into exact fixed workflow and pure material preflight',async()=>{
  const f=fixture(purchased),out=await read(f);assert.equal(out.decision,'INVENTORY_READ');assert.equal(out.actualInventoryVerified,true);
  assert.equal(out.nextNonce,6n);assert.equal(out.inventory.projects.size,1);assert.equal(out.inventory.mints.size,4);assert.equal(out.inventory.tokens.size,4);assert.equal(out.inventory.sources.size,0);
  assert.deepEqual(out.summary.standardUnitsByClass.map(c=>c.amount),['30','60','15','15']);assert.equal(out.summary.totals.totalTick,'1140000');assert.equal(out.summary.totals.creditInt,'14400000');
  assert.equal(out.summary.noLABBalanceIncluded,true);assert.doesNotThrow(()=>JSON.stringify(out.summary));assert.equal(out.businessExecutionVerified,false);assert.equal(out.reservesOnChainNonce,false);
  for(const [id,t]of out.inventory.tokens){assert.equal(id.length,64);assert.ok(Buffer.isBuffer(t.owner)&&Buffer.isBuffer(t.mint));assert.ok(t.owner.equals(nativeKeyBytes(actor)));assert.equal(t.initialized,true);assert.equal(t.native,false);assert.equal(t.frozen,false);}
  for(const [id,m]of out.inventory.mints){assert.equal(id.length,64);assert.ok(Buffer.isBuffer(m.mintAuthority));assert.equal(m.decimals,0);assert.equal(m.freezeAuthority,null);}
  const before=structuredClone(out.inventory),workflow=await planManufacturePartWorkflow({release,abi,actor,inventory:out.inventory,initialNonce:out.nextNonce,descriptor:{primitive:1,profile:0},maxPartRent:100000000n,maxUploadRent:100000000n});
  const prepared=prepareMaterialConsumption(out.inventory,{domain:release.domain,manufactureBusiness:workflow.business,authorizedOwners:new Set([nativeKeyBytes(actor).toString('hex')]),
    createdAt:out.clock.unixTimestamp,createdSlot:out.clock.slot,plan:workflow.materialPlan});
  assert.deepEqual(prepared.burnedStandardUnits,[1n,1n,1n,1n]);assert.equal(prepared.consumedTick,14000n);assert.deepEqual(structuredClone(out.inventory),before);
  assert.equal(f.calls.filter(c=>c.method==='getMultipleAccounts').length,3);assert.deepEqual([...new Set(f.calls.map(c=>c.method))].sort(),['getGenesisHash','getMultipleAccounts']);
});

test('unchanged genuine checkpoint Sources pull in their actual Project closure and retain exact remaining prefixes without double counting',async()=>{
  const f=fixture();f.args.projectIds=[];f.args.sourceIds=sourceIds.map(id=>Buffer.from(id));const out=await read(f);
  assert.equal(out.decision,'INVENTORY_READ');assert.equal(out.inventory.projects.size,1);assert.equal(out.inventory.sources.size,16);assert.equal(out.inventory.mints.size,4);
  const totals=Array(32).fill(0n);for(const id of sourceIds){const expected=await decodeNativeSource(release,sourceAccounts.find(a=>a.data.subarray(88,120).equals(id)),id),actual=out.inventory.sources.get(id.toString('hex'));
    assert.deepEqual(actual,expected);for(let i=0;i<32;i++)totals[i]+=expected.remainingTick[i];}
  assert.deepEqual(out.summary.speciesTicks.sourceRemaining,totals.map(String));assert.deepEqual(out.summary.standardUnitsByClass.map(c=>c.amount),['0','0','0','0']);
  assert.equal(out.summary.totals.totalTick,String(totals.reduce((n,t)=>n+t,0n)));assert.equal(out.summary.sourceBudgets.length,16);
  assert.equal(out.summary.walletWideDiscovery,false);assert.ok(f.calls.every(c=>!['getProgramAccounts','simulateTransaction','sendTransaction'].includes(c.method)));
});

test('actual post-CREATE missing canonical ATAs are zero without decoded flags; HOST-only prefunded empty System ATA remains zero',async()=>{
  const map=toMap(created.afterAccounts);for(const ata of atas)map.set(ata,null);const f=fixture(map),out=await read(f);
  assert.equal(out.inventory.tokens.size,0);assert.ok(out.summary.standardUnits.every(t=>t.amount==='0'&&t.missing));
  const prefunded=fixture(map);prefunded.map.set(atas[0],ordinary(atas[0],12345n));const second=await read(prefunded);
  assert.equal(second.inventory.tokens.size,0);assert.equal(second.summary.tokenAccounts.find(t=>t.address===atas[0]).prefundedLamports,'12345');
});

test('strict known IDs, limits, unknown fields and caller state are rejected before transport',async()=>{
  const variants=[args=>args.nonce=0n,args=>args.inventory={},args=>args.projectIds=[projectId,projectId],args=>args.sourceIds=[sourceIds[0],sourceIds[0]],
    args=>args.projectIds=[projectId.toString('hex')],args=>args.sourceIds=[Buffer.alloc(31)],args=>args.projectIds=Array.from({length:9},(_,i)=>Buffer.alloc(32,i)),
    args=>args.sourceIds=Array.from({length:17},(_,i)=>Buffer.alloc(32,i)),args=>args.rpc={getMultipleAccounts(){assert.fail('fake RPC called');}}];
  for(const mutate of variants){const f=fixture();mutate(f.args);await assert.rejects(read(f));assert.equal(f.calls.length,0);}
  const closure=fixture();closure.args.sourceIds=[sourceIds[0]];closure.args.projectIds=Array.from({length:8},(_,i)=>Buffer.alloc(32,i));
  await assert.rejects(read(closure),/INVENTORY_PROJECT_CLOSURE_LIMIT/);assert.equal(closure.calls.filter(c=>c.method==='getMultipleAccounts').length,1);
});

test('HOST-only Project, Mint, ATA, common config, clock and Actor corruption never becomes spendable inventory',async()=>{
  const cases=[
    f=>f.map.get(release.pdas.baseConfig.address).owner=PROGRAMS.systemProgram,
    async f=>f.map.get(await pda('econ-config')).data[128]^=1,
    f=>f.map.get(PROGRAMS.clockSysvar).owner=PROGRAMS.systemProgram,
    f=>f.map.get(actor).owner=PROGRAMS.tokenProgram,
    f=>f.map.get(actor).executable=true,
    f=>f.map.get(actor).data=Buffer.from([0]),
    f=>f.map.set(projectAccount.address,null),
    f=>f.map.get(projectAccount.address).data[184]^=1,
    f=>f.map.get(projectAccount.address).data.writeBigInt64LE(0n,248),
    f=>f.map.get(projectAccount.address).data.writeBigInt64LE(999999999n,248),
    ...mints.flatMap(mint=>[
      f=>f.map.set(mint,null),f=>f.map.get(mint).data[44]=1,
      f=>nativeKeyBytes(key(20)).copy(f.map.get(mint).data,4),
      f=>f.map.get(mint).data.writeBigUInt64LE(1000001n,36),
      f=>f.map.get(mint).data.writeUInt32LE(1,46),
    ]),
    f=>f.map.get(atas[0]).owner=PROGRAMS.systemProgram,
    f=>nativeKeyBytes(key(20)).copy(f.map.get(atas[0]).data,32),
    f=>nativeKeyBytes(key(20)).copy(f.map.get(atas[0]).data,0),
    f=>f.map.get(atas[0]).data[108]=2,
    f=>f.map.get(atas[0]).data[108]=0,
    f=>f.map.get(atas[0]).data.writeUInt32LE(1,109),
    f=>f.map.get(atas[0]).data.writeBigUInt64LE(31n,64),
  ];
  for(const mutate of cases){const f=fixture(purchased);await mutate(f);await assert.rejects(read(f));}
});

test('HOST-only Source owner, canonical identity, mint, prefix, timestamps and project burn mismatches are rejected',async()=>{
  const first=sourceAccounts[0],cases=[
    f=>f.map.set(first.address,null),f=>f.map.get(first.address).owner=PROGRAMS.systemProgram,
    f=>nativeKeyBytes(key(20)).copy(f.map.get(first.address).data,120),
    f=>f.map.get(first.address).data[88]^=1,
    f=>nativeKeyBytes(key(20)).copy(f.map.get(first.address).data,184),
    f=>f.map.get(first.address).data.writeBigUInt64LE(1001n,600),
    f=>f.map.get(first.address).data.writeBigInt64LE(999999999n,328),
    f=>f.map.get(first.address).data.writeBigInt64LE(0n,328),
    f=>f.map.get(projectAccount.address).data.writeBigUInt64LE(0n,projectClassOffset(f.map,1)+57),
  ];
  for(const mutate of cases){const f=fixture();f.args.sourceIds=[Buffer.from(first.data.subarray(88,120))];await mutate(f);await assert.rejects(read(f));}
  const other=fixture();other.args.actor=key(20);other.args.sourceIds=[sourceIds[0]];other.map.set(other.args.actor,ordinary(other.args.actor,1000000n));
  other.map.set(await pda('actor-nonce',nativeKeyBytes(other.args.actor)),null);await assert.rejects(read(other),/INVENTORY_SOURCE_OWNER/);
});

test('HOST-only changed nonce, material balances, Source prefixes or Actor funding returns REPLAN with no usable Maps',async()=>{
  for(const phase of [2,3])for(const kind of ['nonce','token','funding']){
    const f=fixture(purchased,{onRead:({map,reads})=>{if(reads!==phase)return;
      if(kind==='nonce')map.get(nonceAddress).data.writeBigUInt64LE(7n,120);
      if(kind==='token')map.get(atas[0]).data.writeBigUInt64LE(29n,64);
      if(kind==='funding')map.get(actor).lamports-=1n;
    }});const out=await read(f);
    // An ATA is first discovered in the complete batch; a change before its
    // first observation is safely included, whereas its later change replans.
    if(kind==='token'&&phase===2){assert.equal(out.decision,'INVENTORY_READ');assert.equal(out.summary.standardUnitsByClass[0].amount,'29');continue;}
    assert.equal(out.decision,'REPLAN_STALE_STATE');assert.equal(out.inventory,undefined);assert.equal(out.summary,undefined);assert.notEqual(out.actualInventoryVerified,true);
  }
  const nuc=sourceAccounts.find(a=>a.data[320]===2),f=fixture(checkpoint,{onRead:({map,reads})=>{if(reads===3){const d=map.get(nuc.address).data,offset=600+20*8;d.writeBigUInt64LE(d.readBigUInt64LE(offset)+1n,offset);}}});
  f.args.sourceIds=[Buffer.from(nuc.data.subarray(88,120))];assert.equal((await read(f)).decision,'REPLAN_STALE_STATE');
});

test('HOST-only clock advancement is allowed; clock and nonce regression fail closed; decimal summary preserves u64 funding exactly',async()=>{
  const advance=fixture(purchased,{onRead:({map,reads})=>{if(reads===3){map.get(PROGRAMS.clockSysvar).data.writeBigUInt64LE(11n,0);map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(7201n,32);}}});
  assert.equal((await read(advance)).decision,'INVENTORY_READ');
  const time=fixture(checkpoint,{onRead:({map,reads})=>{if(reads===3)map.get(PROGRAMS.clockSysvar).data.writeBigInt64LE(1321200n,32);}});await assert.rejects(read(time),/INVENTORY_CLOCK_REGRESSION/);
  const nonce=fixture(purchased,{onRead:({map,reads})=>{if(reads===3)map.get(nonceAddress).data.writeBigUInt64LE(5n,120);}});await assert.rejects(read(nonce),/INVENTORY_NONCE_REGRESSION/);
  const precise=fixture(purchased);precise.map.get(actor).lamports=(1n<<64n)-1n;assert.equal((await read(precise)).summary.actorLamports,'18446744073709551615');
});

test('HOST-only extra canonical projects plus sixteen genuine Sources reach exactly 93 accounts without truncation or wallet enumeration',async()=>{
  const f=fixture(),project=await decodeNativeProject(release,projectAccount,projectId);f.args.sourceIds=sourceIds.map(id=>Buffer.from(id));
  for(let n=1;n<=7;n++){
    const business=sha256(Buffer.from(`A2.1 HOST-ONLY synthetic project ${n}`)),id=typedHash(17,Buffer.concat([release.domain,business]));
    const value={...project,creationBusiness:business,classes:[]};
    for(let c=1;c<=4;c++){
      const mint=await pda('pack',id,Buffer.from([c])),authority=await pda('pack-auth',id,Buffer.from([c]));
      value.classes.push({...project.classes[c-1],mint:nativeKeyBytes(mint),issued:0n,intakeBurned:0n});
      const account={...f.map.get(mints[c-1]),address:mint,data:Buffer.from(f.map.get(mints[c-1]).data)};nativeKeyBytes(authority).copy(account.data,4);account.data.writeBigUInt64LE(0n,36);f.map.set(mint,account);
      const ata=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address;f.map.set(ata,null);
    }
    const record=await recordAccount(release,{kind:9,schema:1,seeds:['bio','project',id],id,body:encodeProjectBody(value)});f.map.set(record.address,record);f.args.projectIds.push(id);
  }
  const out=await read(f);assert.equal(out.decision,'INVENTORY_READ');assert.equal(out.inventory.projects.size,8);assert.equal(out.inventory.sources.size,16);assert.equal(out.inventory.mints.size,32);
  assert.deepEqual(MATERIAL_INVENTORY_LIMITS,{projects:8,sources:16,accounts:93});
  assert.deepEqual(f.calls.filter(c=>c.method==='getMultipleAccounts').map(c=>c.params[0].length),[21,93,93]);
});
