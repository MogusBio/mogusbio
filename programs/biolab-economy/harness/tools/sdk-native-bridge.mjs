// Real SDK -> native SBF conformance bridge. Public local release input only.
import {readFileSync} from 'node:fs';
import {AccountRole} from '@solana/kit';
import {validateProductionRelease,baseConfigR2Id,PROGRAMS} from '../../../../packages/client/src/release.mjs';
import * as n from '../../../../packages/client/src/native.mjs';
const release=await validateProductionRelease(JSON.parse(readFileSync(new URL('../../evidence/production-admission-fixture-result58.json',import.meta.url))),{localPublicFixture:true});
const abi=n.loadNativeAbi(undefined,{expectedHash:release.input.abiHash});
const [mode,nonceArg,projectHex,classArg,quantityArg]=process.argv.slice(2);
if(!['buy','materialize'].includes(mode))throw new Error('BRIDGE_MODE');
if(mode==='materialize'){
 const [,,hArg,cursorArg,seqArg,dirArg,instanceHex]=process.argv.slice(2),u64=x=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(x));return b;},pda=(...seeds)=>n.nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
 const instance=Buffer.from(instanceHex,'hex'),payload=n.encodeMaterializeHourPayload({hour:BigInt(hArg),expectedCursor:BigInt(cursorArg),positionSeq:BigInt(seqArg),maxRent:100000000n});
 const frame=n.encodeNativeFrame(abi,{operation:'MATERIALIZE_HOUR',domain:release.domain,configId:baseConfigR2Id(release),actor:release.input.bootstrap,nonce:BigInt(nonceArg),payload});
 const keys={LABMint:await pda('lab-mint'),LABReserve:await pda('lab-reserve'),LABAuth:await pda('lab-auth'),Treasury:await pda('treasury'),Registry:await pda('mining'),Hour:await pda('hour',u64(hArg))};
 const op=n.nativeOperation(abi,'MATERIALIZE_HOUR');if(!op.dynamicAccounts.includes('Directory[r]/RootReg[w]/Position[w]'))throw new Error('MATERIALIZE_NATIVE_WRITABLE_LAYOUT');
 const suffix=op.publicFixedSuffix.map(r=>({name:r.role,address:keys[r.role]}));
 const dynamicAccounts=[{address:await pda('mining-root',u64(dirArg)),writable:false,signer:false},{address:await pda('root-reg',instance),writable:true,signer:false},{address:await pda('reg',instance,u64(seqArg)),writable:true,signer:false}];
 emit(await n.buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts}));process.exit(0);
}
function emit(ix){console.log(Buffer.from(ix.data).toString('hex'));for(const a of ix.accounts)console.log(`${n.nativeKeyBytes(a.address).toString('hex')},${a.role===AccountRole.WRITABLE||a.role===AccountRole.WRITABLE_SIGNER?1:0},${a.role===AccountRole.READONLY_SIGNER||a.role===AccountRole.WRITABLE_SIGNER?1:0}`);}
const nonce=BigInt(nonceArg),project=Buffer.from(projectHex,'hex'),classId=Number(classArg),quantity=BigInt(quantityArg),actor=release.input.bootstrap;
const pda=(...seeds)=>n.nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
const mint=await pda('pack',project,Buffer.from([classId]));
const destination=(await n.nativePda(PROGRAMS.associatedTokenProgram,n.nativeKeyBytes(actor),n.nativeKeyBytes(PROGRAMS.tokenProgram),n.nativeKeyBytes(mint))).address;
const payload=n.encodeBuyMaterialPayload({projectId:project,class:classId,mint,catalogHash:release.hashes.catalogHash,quantity,payer:actor,recipient:actor,destination,destinationMode:1,seller:actor,unitPrice:500000n,resourceFee:100000n,maxPayment:quantity*600000n,rentPayer:actor,maxRent:100000000n,season:0});
const frame=n.encodeNativeFrame(abi,{operation:'BUY_MATERIAL',domain:release.domain,configId:baseConfigR2Id(release),actor,nonce,payload});
const keys={Project:await pda('project',project),Mint:mint,PackAuthority:await pda('pack-auth',project,Buffer.from([classId])),SeasonQuota:await pda('season',Buffer.from([classId]),Buffer.alloc(2)),LifetimeQuota:await pda('issued',Buffer.from([classId])),OpsVault:await pda('ops'),Destination:destination,AssociatedTokenProgram:PROGRAMS.associatedTokenProgram};
const suffix=n.nativeOperation(abi,'BUY_MATERIAL').publicFixedSuffix.map(r=>({name:r.role,address:keys[r.role]}));
const ix=await n.buildNativeInstruction({release,abi,frame,suffix});
emit(ix);
