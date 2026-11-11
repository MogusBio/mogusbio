import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import path from 'node:path';
import {createKeyPairFromPrivateKeyBytes,signTransaction,getBase58Decoder} from '@solana/kit';
import {parseJsonWithBigInts,stringifyJsonWithBigInts} from '@solana/rpc-spec-types';
import {checkpoint,cloneAccounts,release,abi,actor,pda} from '../packages/client/test/synthesis-fixture.mjs';
import {hash,key} from '../packages/client/test/native-fixture.mjs';
import {encodeActorNonceBody} from '../packages/protocol-core/src/index.mjs';
import {nativeKeyAddress,nativeKeyBytes,nativeRequestHash} from '../packages/client/src/native.mjs';
import {transactionBytes,decodeV1Transaction} from '../packages/client/src/transaction.mjs';
import {FileJournalStore} from '../packages/client/src/file-journal.mjs';
import {baseConfigR2Id} from '../packages/client/src/release.mjs';
import {openServiceSupervisor,readServiceHealth} from '../apps/service/supervisor.mjs';
import {acquireServiceLease,recoverServiceLease} from '../apps/service/lease.mjs';
import {runServiceCLI} from '../apps/service/main.mjs';
import {NativePlayerSession} from '../packages/client/src/session.mjs';
import {prepareNativeCancellation} from '../packages/client/src/recovery.mjs';
import {ResearchWorkflowStore} from '../packages/client/src/research-manifest.mjs';
import {saveGuidedResearchWorkflow} from '../packages/client/src/research-progress.mjs';
import {recordAccount} from '../packages/client/test/account-fixture.mjs';
import {hostArtifact,hostVerification} from '../packages/client/test/synthesis-fixture.mjs';
import {hostResearchFixture,researchCranker,enterHostResearchManufacture,setHostResearchAuthorNonce} from '../packages/client/test/research-fixture.mjs';

// All sending/signature/fee/confirmation behavior in this file is HOST-only.
// Account contents default to the genuine current76b checkpoint. The signer
// uses only its documented public local-fixture seed, never a funded secret.
const fixturePair=await createKeyPairFromPrivateKeyBytes(hash('BIOP0R2 native SIGNING FIXTURE ONLY 1'));
export const resources={computeUnitLimit:1400000,loadedAccountsDataSizeLimit:67108864,heapSize:262144,priorityFeeLamports:'0'};
export async function serviceFixture(changes={}){
  const directory=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'biolab-service-')),map=cloneAccounts(checkpoint),calls=[],state={slot:1000000n,height:100n,lastValid:200n,blockhash:key(20),valid:true,fee:5000n,balanceLow:false,failSend:false},signed=[];
  const config={version:'BIOLAB-SERVICE1',releaseHash:release.input.releaseHash,abiHash:abi.hash,domainHex:release.domain.toString('hex'),configHex:baseConfigR2Id(release).toString('hex'),stateDirectory:path.join(directory,'state'),endpoint:'http://127.0.0.1:1',sendEnabled:true,globalActor:actor,researchJobs:[],maxRent:'10000000',resources:{...resources},limits:{stepFee:'10000',stepRent:'10000000',stepTotal:'10010000',dayFee:'100000',dayRent:'100000000',dayTotal:'100100000',lifetimeFee:'1000000',lifetimeRent:'1000000000',lifetimeTotal:'1001000000',minimumBalance:'10000000',maxRefreshes:2,maxQuoteAgeSlots:8},poll:{minMs:10,maxMs:20,maxTicks:10,maxDurationMs:1000},...changes};
  const fetchImpl=async(url,options)=>{assert.equal(url,'http://127.0.0.1:1/');assert.equal(options.redirect,'error');const req=parseJsonWithBigInts(options.body);calls.push(req);let result;
    if(req.method==='getGenesisHash')result=nativeKeyAddress(release.hashes.genesisHash);
    else if(req.method==='getMultipleAccounts')result={context:{slot:++state.slot},value:req.params[0].map(address=>{const a=map.get(address);return !a?null:{owner:a.owner,executable:a.executable,lamports:state.balanceLow&&address===actor?1n:a.lamports,rentEpoch:a.rentEpoch,data:[a.data.toString('base64'),'base64']};})};
    else if(req.method==='getLatestBlockhash')result={context:{slot:state.slot},value:{blockhash:state.blockhash,lastValidBlockHeight:state.lastValid}};
    else if(req.method==='simulateTransaction')result={context:{slot:state.slot},value:{err:null,unitsConsumed:100000n,logs:[],replacementBlockhash:null}};
    else if(req.method==='getFeeForMessage')result={context:{slot:state.slot},value:state.fee};
    else if(req.method==='getMinimumBalanceForRentExemption')result=BigInt(req.params[0])*10n;
    else if(req.method==='isBlockhashValid')result={context:{slot:state.slot},value:req.params[0]===state.blockhash?state.valid:false};
    else if(req.method==='getBlockHeight')result=state.height;
    else if(req.method==='sendTransaction'){if(state.failSend)throw Error('HOST secret endpoint credential must not print');const tx=decodeV1Transaction(Buffer.from(req.params[0],'base64')).transaction;result=getBase58Decoder().decode(Object.values(tx.signatures)[0]);}
    else throw Error('unexpected method '+req.method);
    return new Response(stringifyJsonWithBigInts({jsonrpc:'2.0',id:req.id,result}),{headers:{'content-type':'application/json'}});
  };
  const signer={actors:[actor],signOnly:true,async signEnvelope(envelope,context){assert.equal(context.actor,actor);assert.equal(context.role,'global');assert.equal(context.requestId,envelope.messageSHA256);signed.push(envelope);return transactionBytes(await signTransaction([fixturePair],decodeV1Transaction(Buffer.from(envelope.unsignedHex,'hex')).transaction));}};
  const args={release,abi,config,fetchImpl,signer},open=extra=>openServiceSupervisor({...args,...extra}),cleanup=()=>fs.rm(directory,{recursive:true,force:true});
  const confirm=async()=>{const envelope=signed.at(-1),address=await pda('actor-nonce',nativeKeyBytes(actor)),old=map.get(address),body=encodeActorNonceBody({nextNonce:BigInt(envelope.nonce)+1n,lastDigest:nativeRequestHash(abi,Buffer.from(envelope.frameHex,'hex')),lastResult:Buffer.alloc(8)});map.set(address,{...old,data:Buffer.concat([old.data.subarray(0,120),body])});};
  return {directory,map,calls,state,signed,config,signer,args,open,cleanup,confirm};
}

