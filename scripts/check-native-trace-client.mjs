import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateProductionRelease,baseConfigR2Id,PROGRAMS } from '../packages/client/src/release.mjs';
import { loadNativeAbi,decodeNativeFrame,encodeNativeFrame,nativeOperation,buildNativeInstruction } from '../packages/client/src/native.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const check=(v,c)=>{if(!v)throw new Error(c);};
export async function checkNativeTraceClient({traceFile,releaseFile,abiFile,reportFile}){
  const [raw,releaseRaw,abiRaw]=await Promise.all([readFile(traceFile),readFile(releaseFile),readFile(abiFile)]);
  const release=await validateProductionRelease(JSON.parse(releaseRaw),{localPublicFixture:true});
  const abi=loadNativeAbi(abiRaw,{expectedHash:release.hashes.abiHash.toString('hex')});
  const lines=raw.toString('utf8').trimEnd().split('\n').map(l=>JSON.parse(l)),begin=lines[0],end=lines.at(-1);
  check(begin.kind==='begin'&&begin.fixtureOnly===true&&begin.cold===true&&begin.program===release.input.programId,'TRACE_BEGIN');
  check(end.kind==='complete'&&end.success===true&&end.instructions===lines.length-2,'TRACE_FOOTER');
  const counts={};let core=0,external=0,maxAccounts=0;
  for(let index=1;index<lines.length-1;index++){
    const row=lines[index];check(row.kind==='instruction'&&row.seq===index-1&&row.expectedResult==='Ok','TRACE_SEQUENCE');
    if(row.programId!==release.input.programId){check([PROGRAMS.systemProgram,PROGRAMS.tokenProgram,PROGRAMS.associatedTokenProgram].includes(row.programId),'TRACE_FOREIGN_PROGRAM');external++;continue;}
    const frame=Buffer.from(row.dataHex,'hex'),f=decodeNativeFrame(abi,frame),op=nativeOperation(abi,f);
    check(f.domain.equals(release.domain)&&f.configId.equals(baseConfigR2Id(release)),'TRACE_RELEASE_CONTEXT');
    const encoded=encodeNativeFrame(abi,{operation:f.operation,domain:f.domain,configId:f.configId,actor:f.actor,opId:f.opId,payload:f.payload});
    check(encoded.equals(frame),'TRACE_FRAME_CODEC');
    const fixed=op.publicFixedSuffix;
    check(row.accounts.length>=8+fixed.length,'TRACE_ACCOUNT_COUNT');
    const suffix=fixed.map((r,i)=>({name:r.role,address:row.accounts[8+i].pubkey}));
    const dynamicAccounts=row.accounts.slice(8+fixed.length).map(a=>({address:a.pubkey,writable:a.isWritable,signer:a.isSigner}));
    const instruction=await buildNativeInstruction({release,abi,frame,suffix,dynamicAccounts});
    check(instruction.accounts.length===row.accounts.length,'TRACE_SDK_ACCOUNT_COUNT');
    for(let i=0;i<row.accounts.length;i++){
      const expected=row.accounts[i],actual=instruction.accounts[i];
      check(actual.address===expected.pubkey&&((actual.role&1)!==0)===expected.isWritable&&((actual.role&2)!==0)===expected.isSigner,
        `TRACE_ACCOUNT_FLAGS_${row.seq}_${op.name}_${i}`);
    }
    core++;counts[op.name]=(counts[op.name]??0)+1;maxAccounts=Math.max(maxAccounts,row.accounts.length);
  }
  const report={scope:'independent Rust actual-success trace against exact JS client frame/account builder',fixtureOnly:true,productionAdmission:false,
    traceSHA256:hash(raw),abiSHA256:abi.hash,elfSHA256:begin.elfSHA256,transactions:end.instructions,coreInstructions:core,
    externalInstructions:external,maxAccounts,operations:counts,success:true};
  if(reportFile)await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [traceFile,releaseFile,abiFile,reportFile]=process.argv.slice(2);check(traceFile&&releaseFile&&abiFile&&reportFile,'usage: trace release ABI report (all paths)');
  console.log(JSON.stringify(await checkNativeTraceClient({traceFile,releaseFile,abiFile,reportFile}),null,2));
}
