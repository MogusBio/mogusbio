import test from 'node:test';import assert from 'node:assert/strict';
import {createKeyPairFromPrivateKeyBytes,signTransaction,partiallySignTransaction,getBase58Decoder} from '@solana/kit';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {ByteWriter,typedHash,encodeRecord,encodeActorNonceBody} from '../../protocol-core/src/index.mjs';
import {encodePositionBody} from '../../settlement/src/wire.mjs';
import {NativePlayerSession,createPreparedNativeEnvelope,inspectPreparedNativeEnvelope} from '../src/session.mjs';
import {buildClaimLabDestinationSetup} from '../src/lab-destination.mjs';import {buildNativeInstruction,nativePda,nativeKeyAddress,nativeKeyBytes,nativeRequestHash,encodeClaimPositionPayload} from '../src/native.mjs';
import {baseConfigR2Id,PROGRAMS} from '../src/release.mjs';import {buildV1Transaction,decodeV1Transaction,transactionBytes} from '../src/transaction.mjs';import {verifyWalletSignedV1} from '../src/wallet.mjs';
import {clientFixture,key,hash} from './native-fixture.mjs';import {baseAccount,recordAccount} from './account-fixture.mjs';
import {promises as fs} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {runOperator} from '../../../apps/operator/main.mjs';
const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:0n};
const pair=await createKeyPairFromPrivateKeyBytes(hash('BIOP0R2 native SIGNING FIXTURE ONLY 1'));
class MemoryStore{revision=0n;payload=null;async load(){return {revision:this.revision,payload:this.payload};}async compareAndSwap(n,s){if(n!==this.revision)return false;this.payload=s;return ++this.revision;}}
async function fixture(){
  const c=await clientFixture(),beneficiary=key(20),instance=hash('actual claim instance'),positionId=typedHash(14,new ByteWriter(74).raw(c.release.domain).u16(27).raw(instance).u64(0n).finish()),base=await baseAccount(c.release),store=new MemoryStore();
  const position=await recordAccount(c.release,{kind:27,schema:2,seeds:['bio','reg',instance,Buffer.alloc(8)],id:positionId,body:encodePositionBody({instance,rootSeq:0n,rootDirectorySeq:0n,registrationM:hash('registered'),beneficiary:nativeKeyBytes(beneficiary),rootRevision:0n,B_int:120000n,q_ppm:1000000,L_quarters:4,weight:480000000000n,start:0n,end:null,endReason:0,endBusiness:Buffer.alloc(32),createdTime:93600n,createdSlot:10n,endedTime:0n,endedSlot:0n,accrued:100n,paid:0n,nextUnsettledHour:1n})});
  const destination=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(beneficiary),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(c.release.pdas.labMint.address))).address;
  const payload=encodeClaimPositionPayload({positionId,expectedPaid:0n,upToAccrued:100n,destination,rentPayer:c.actor,maxRent:1000000n}),frame=c.frame('CLAIM_POSITION',payload),seeds={LABMint:'lab-mint',LABReserve:'lab-reserve',LABAuth:'lab-auth',Treasury:'treasury'};
  const suffix=await Promise.all(c.abi.operations.find(o=>o.name==='CLAIM_POSITION').publicFixedSuffix.map(async r=>({name:r.role,address:r.role==='Position'?position.address:r.role==='Destination'?destination:(await nativePda(c.release.input.programId,'bio',seeds[r.role])).address})));
  const noncePda=await nativePda(c.release.input.programId,'bio','actor-nonce',nativeKeyBytes(c.actor)),state={slot:20n,nextNonce:0n,digest:null,result:null,hash:key(21),lastValid:100n,sendTimeout:false,simulationFails:false},calls=[];
  const raw=a=>a===null?null:{owner:a.owner,executable:a.executable,lamports:10000000n,rentEpoch:0n,data:[a.data.toString('base64'),'base64']};
  const fetchImpl=async(_,o)=>{const req=parseJsonWithBigInts(o.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(c.release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts'){assert.ok(req.params[1].minContextSlot<=state.slot);const nonce=state.nextNonce===0n?null:{owner:c.release.input.programId,executable:false,data:encodeRecord({kind:35,schema:1,domain:c.release.domain,configId:baseConfigR2Id(c.release),recordKey:nativeKeyBytes(c.actor),bump:noncePda.bump,body:encodeActorNonceBody({nextNonce:state.nextNonce,lastDigest:state.digest,lastResult:state.result})})};result={context:{slot:state.slot},value:req.params[0].map(k=>raw(k===base.address?base:k===position.address?position:k===noncePda.address?nonce:null))};}
    else if(req.method==='getLatestBlockhash')result={context:{slot:state.slot},value:{blockhash:state.hash,lastValidBlockHeight:state.lastValid}};
    else if(req.method==='getBlockHeight')result=10n;
    else if(req.method==='isBlockhashValid')result={context:{slot:state.slot},value:true};
    else if(req.method==='simulateTransaction')result={context:{slot:state.slot},value:{err:state.simulationFails?{InstructionError:[1n,'Custom']}:null,unitsConsumed:150000n,logs:[],replacementBlockhash:null}};
    else if(req.method==='sendTransaction'){assert.equal(JSON.parse(store.payload).entries[0].state,'PENDING');const wire=Buffer.from(req.params[0],'base64'),decoded=decodeV1Transaction(wire);assert.equal(decoded.message.numInstructions,2);if(state.sendTimeout)throw new Error('socket timeout');result=getBase58Decoder().decode(Object.values(decoded.transaction.signatures)[0]);}
    else throw new Error(req.method);return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}));};
  const session=()=>new NativePlayerSession({...c,store,endpoint:'http://127.0.0.1:8899',allowLocalhost:true,fetchImpl});
  const intent={operation:'CLAIM_POSITION',nonce:0n,payload,suffix,resources,labDestinationSetup:{beneficiary}},lifetime={blockhash:state.hash,lastValidBlockHeight:state.lastValid};
  const sign=async e=>transactionBytes(await signTransaction([pair],decodeV1Transaction(Buffer.from(e.unsignedHex,'hex')).transaction));
  return {...c,makeFrame:c.frame,position,positionId,beneficiary,destination,payload,frame,suffix,state,store,calls,fetchImpl,session,intent,lifetime,sign};
}
test('optional setup is exactly official idempotent Classic LAB ATA plus one unchanged BIO CLAIM, while no-setup bytes remain unchanged',async()=>{
  const f=await fixture(),setup=await buildClaimLabDestinationSetup({...f,labDestinationSetup:{beneficiary:f.beneficiary}});
  assert.equal(setup.instruction.programAddress,PROGRAMS.associatedTokenProgram);assert.deepEqual(setup.instruction.data,Buffer.from([1]));assert.deepEqual(setup.instruction.accounts.map(a=>a.address),[f.actor,f.destination,f.beneficiary,f.release.pdas.labMint.address,PROGRAMS.systemProgram,PROGRAMS.tokenProgram]);assert.deepEqual(setup.instruction.accounts.map(a=>a.role),[3,1,0,0,0,0]);
  const plain=await createPreparedNativeEnvelope({...f,feePayer:f.actor,resources}),actual=await buildNativeInstruction({...f});const old=buildV1Transaction({feePayer:f.actor,lifetime:f.lifetime,resources,instructions:[actual],supportedTransactionVersions:[1]});assert.equal(plain.unsignedHex,transactionBytes(old.transaction).toString('hex'));assert.equal(Object.hasOwn(plain,'labDestinationSetup'),false);
  const e=await createPreparedNativeEnvelope({...f,feePayer:f.actor,resources,labDestinationSetup:{beneficiary:f.beneficiary}}),decoded=await inspectPreparedNativeEnvelope({...f,envelope:e}),message=decodeV1Transaction(decoded.unsignedBytes).message;
  assert.equal(message.numInstructions,2);assert.equal(message.staticAccounts[message.instructionHeaders[0].programAccountIndex],PROGRAMS.associatedTokenProgram);assert.equal(message.staticAccounts[message.instructionHeaders[1].programAccountIndex],f.release.input.programId);assert.deepEqual(Buffer.from(message.instructionPayloads[1].instructionData),f.frame);assert.deepEqual(nativeRequestHash(f.abi,Buffer.from(message.instructionPayloads[1].instructionData)),nativeRequestHash(f.abi,f.frame));assert.equal(decoded.nonce,0n);assert.ok(verifyWalletSignedV1(decoded.unsignedBytes,await f.sign(e)));
  const two=await createPreparedNativeEnvelope({...f,feePayer:key(21),resources,labDestinationSetup:{beneficiary:f.beneficiary}}),tx=decodeV1Transaction(Buffer.from(two.unsignedHex,'hex')).transaction,feePair=await createKeyPairFromPrivateKeyBytes(hash('BIOCLIENT pure unit key 21'));
  const partial=transactionBytes(await partiallySignTransaction([pair],tx));assert.throws(()=>verifyWalletSignedV1(Buffer.from(two.unsignedHex,'hex'),partial),/SIGNATURE/);assert.ok(verifyWalletSignedV1(Buffer.from(two.unsignedHex,'hex'),transactionBytes(await signTransaction([pair,feePair],tx))));
});
test('setup rejects arbitrary payer/mint/program/ATA/instructions, wrong destination and wrong actual Position beneficiary before any send',async()=>{
  const f=await fixture();for(const metadata of [{beneficiary:f.beneficiary,payer:key(21)},{beneficiary:f.beneficiary,mint:key(21)},{beneficiary:f.beneficiary,program:PROGRAMS.systemProgram},{beneficiary:f.beneficiary,destination:key(21)},{beneficiary:f.beneficiary,instructions:[]},null])await assert.rejects(buildClaimLabDestinationSetup({...f,labDestinationSetup:metadata}),/FIELDS/);
  await assert.rejects(buildClaimLabDestinationSetup({...f,labDestinationSetup:{beneficiary:key(21)}}),/DESTINATION/);
  const badDestination=encodeClaimPositionPayload({positionId:f.positionId,expectedPaid:0n,upToAccrued:100n,destination:key(21),rentPayer:f.actor,maxRent:0n});await assert.rejects(f.session().prepare({...f.intent,payload:badDestination}),/DESTINATION/);
  await assert.rejects(f.session().prepare({...f.intent,suffix:f.suffix.map(r=>r.name==='Destination'?{...r,address:key(21)}:r)}),/SUFFIX_PDA/);
  const other=key(21),otherATA=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(other),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(f.release.pdas.labMint.address))).address,p=encodeClaimPositionPayload({positionId:f.positionId,expectedPaid:0n,upToAccrued:100n,destination:otherATA,rentPayer:f.actor,maxRent:0n}),suffix=f.suffix.map(r=>r.name==='Destination'?{...r,address:otherATA}:r);
  await assert.rejects(f.session().prepare({...f.intent,payload:p,suffix,labDestinationSetup:{beneficiary:other}}),/BENEFICIARY/);assert.equal(f.store.payload,null);assert.equal(f.calls.some(x=>x.method==='sendTransaction'),false);
  await assert.rejects(buildClaimLabDestinationSetup({...f,frame:f.makeFrame('SYNC_EMISSION',Buffer.alloc(8)),labDestinationSetup:{beneficiary:f.beneficiary}}),/ONLY_CLAIM/);
});
test('the entire setup message is signed; wallet changes and failed simulation cannot become a business execution',async()=>{
  const f=await fixture(),e=await f.session().prepare(f.intent),signed=await f.sign(e);assert.equal(f.calls.some(x=>x.method==='sendTransaction'),false);
  const mutated=Buffer.from(signed);mutated[mutated.length-80]^=1;await assert.rejects(f.session().broadcastSigned(e,mutated));
  for(const change of [x=>delete x.labDestinationSetup,x=>x.labDestinationSetup.beneficiary=key(21),x=>x.labDestinationSetup.extra=true]){const bad=structuredClone(e);change(bad);await assert.rejects(f.session().broadcastSigned(bad,signed));}
  f.state.simulationFails=true;await assert.rejects(f.session().rpc.simulatePreparedV1(Buffer.from(e.unsignedHex,'hex'),{supportedTransactionVersions:[1]}),/SIMULATION_FAILED/);assert.equal(f.calls.some(x=>x.method==='sendTransaction'),false);assert.equal(JSON.parse(f.store.payload).entries[0].state,'PREPARED');
});
test('timeout and fresh blockhash retain both fixed instructions and one BIO nonce; finalized replay pays no second time',async()=>{
  const f=await fixture(),e=await f.session().prepare(f.intent);f.state.sendTimeout=true;const unknown=await f.session().broadcastSigned(e,await f.sign(e));assert.equal(unknown.decision,'UNKNOWN');assert.equal(JSON.parse(f.store.payload).entries.length,1);
  f.state.hash=key(22);f.state.lastValid=200n;f.state.slot++;const retry=await f.session().refresh(e);assert.equal(retry.frameHex,e.frameHex);assert.deepEqual(retry.labDestinationSetup,e.labDestinationSetup);assert.equal(decodeV1Transaction(Buffer.from(retry.unsignedHex,'hex')).message.numInstructions,2);assert.notEqual(retry.unsignedHex,e.unsignedHex);
  f.state.sendTimeout=false;assert.equal((await f.session().broadcastSigned(retry,await f.sign(retry))).decision,'PENDING');const sends=f.calls.filter(x=>x.method==='sendTransaction').length;
  f.state.nextNonce=1n;f.state.digest=nativeRequestHash(f.abi,Buffer.from(retry.frameHex,'hex'));f.state.result=Buffer.alloc(88);f.state.slot++;const done=await f.session().reconcile(0n);assert.equal(done.decision,'CONFIRMED');assert.equal(done.businessExecutionVerified,true);
  const duplicate=await f.session().broadcastSigned(retry,await f.sign(retry));assert.equal(duplicate.decision,'CONFIRMED');assert.equal(duplicate.networkSubmitted,false);assert.equal(f.calls.filter(x=>x.method==='sendTransaction').length,sends);
});
test('operator typed optional setup exports the same atomic unsigned message through actual file CAS, without a network write',async()=>{
  const f=await fixture(),directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-cli-lab-'));
  try{const releasePath=path.join(directory,'release.json'),intentPath=path.join(directory,'intent.json'),outputPath=path.join(directory,'prepared.json');await fs.writeFile(releasePath,JSON.stringify(f.release.input),{mode:0o600});
    await fs.writeFile(intentPath,JSON.stringify({operation:'CLAIM_POSITION',nonce:'0',payloadHex:f.payload.toString('hex'),suffix:f.suffix,dynamicAccounts:[],feePayer:f.actor,resources:{...resources,priorityFeeLamports:'0'},labDestinationSetup:{beneficiary:f.beneficiary}}),{mode:0o600});
    await runOperator(['prepare','--release',releasePath,'--intent',intentPath,'--actor',f.actor,'--state',path.join(directory,'state'),'--endpoint','http://127.0.0.1:8899','--out',outputPath,'--local-public-fixture'],{fetchImpl:f.fetchImpl});
    const e=JSON.parse(await fs.readFile(outputPath,'utf8'));assert.deepEqual(e.labDestinationSetup,{beneficiary:f.beneficiary});assert.equal(decodeV1Transaction(Buffer.from(e.unsignedHex,'hex')).message.numInstructions,2);assert.equal(f.calls.some(x=>x.method==='sendTransaction'),false);
    const inspected=await runOperator(['inspect','--release',releasePath,'--envelope',outputPath,'--local-public-fixture']);assert.deepEqual(inspected.labDestinationSetup,e.labDestinationSetup);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
