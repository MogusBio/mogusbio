import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sha256, speciesCreditInt } from '../packages/protocol-core/src/index.mjs';
import { validateProductionRelease, baseConfigR2Id } from '../packages/client/src/release.mjs';
import { nativeKeyAddress } from '../packages/client/src/native.mjs';
import { decodeNativeSource, decodeNativeRoot } from '../packages/client/src/accounts.mjs';

const check=(v,c)=>{if(!v)throw new Error(c);};
const sum=a=>a.reduce((n,x)=>n+x,0n);
/** Offline evidence inspection only. A file and its digest do not prove that a
 * network executed it; the separately bound cold-run report supplies that scope. */
export async function auditNativeCheckpoint({checkpointFile,releaseFile,expectedElfSHA256,expectedCheckpointSHA256,reportFile}){
  const [raw,input]=await Promise.all([readFile(checkpointFile),readFile(releaseFile,'utf8')]);
  check(raw.length>=108&&raw.length<=40*1024*1024&&raw.subarray(0,8).equals(Buffer.from('BIOFIN01')),'CHECKPOINT_FORMAT');
  const digest=sha256(raw).toString('hex');check(digest===expectedCheckpointSHA256,'CHECKPOINT_SHA256');
  check(raw.subarray(40,72).toString('hex')===expectedElfSHA256,'CHECKPOINT_ELF');
  const release=await validateProductionRelease(JSON.parse(input),{localPublicFixture:true});
  check(raw.subarray(8,40).equals(baseConfigR2Id(release)),'CHECKPOINT_CONFIG');
  const bio=nativeKeyAddress(raw.subarray(72,104)),count=raw.readUInt32LE(104),accounts=new Map();
  check(count<=100000,'CHECKPOINT_COUNT');let at=108;
  for(let n=0;n<count;n++){
    check(at+85<=raw.length,'CHECKPOINT_TRUNCATED');
    const address=nativeKeyAddress(raw.subarray(at,at+32)),lamports=raw.readBigUInt64LE(at+32),owner=nativeKeyAddress(raw.subarray(at+40,at+72));
    check(raw[at+72]<=1,'CHECKPOINT_EXECUTABLE');
    const executable=raw[at+72]===1,rentEpoch=raw.readBigUInt64LE(at+73),len=raw.readUInt32LE(at+81);at+=85;
    check(len<=2*1024*1024&&at+len<=raw.length&&!accounts.has(address),'CHECKPOINT_ACCOUNT');
    accounts.set(address,{address,lamports,owner,executable,rentEpoch,data:Buffer.from(raw.subarray(at,at+len))});at+=len;
  }
  check(at===raw.length,'CHECKPOINT_TRAILING');
  const sources=[],roots=[],units=[0n,0n,0n,0n],initial=Array(32).fill(0n),spent=Array(32).fill(0n);
  for(const a of accounts.values()){
    if(a.owner!==release.input.programId||a.data.length<120||!a.data.subarray(0,8).equals(Buffer.from('BIOLAB\0\0')))continue;
    const kind=a.data.readUInt16LE(10),id=a.data.subarray(88,120);
    if(kind===11){const s=await decodeNativeSource(release,a,id);sources.push(s);units[s.class-1]+=s.unitCount;
      for(let i=0;i<32;i++){initial[i]+=s.initialTick[i];spent[i]+=s.spentPrefix[i];}}
    if(kind===12)roots.push({...await decodeNativeRoot(release,a,id),address:a.address});
  }
  const credits=a=>a.reduce((n,t,i)=>n+speciesCreditInt(i+1,t),0n),initialCredit=credits(initial),spentCredit=credits(spent),remainingCredit=initialCredit-spentCredit;
  const final=roots.find(r=>nativeKeyAddress(r.instance)===bio);check(final&&final.target===22&&final.lifecycle===0,'CHECKPOINT_FINAL_BIO');
  const layers={component:roots.filter(r=>r.schema===1).length,cell:roots.filter(r=>r.schema===2).length,organ:roots.filter(r=>r.schema===3).length,bio:roots.filter(r=>r.schema===4).length};
  check(units.every((n,i)=>n===[30n,60n,15n,15n][i]),'CHECKPOINT_STANDARD_UNITS');
  check(layers.component===60&&layers.cell===15&&layers.organ===6&&layers.bio===1,'CHECKPOINT_LAYERS');
  check(roots.length===82&&roots.filter(r=>r.lifecycle===1).length===81,'CHECKPOINT_CONSUMED');
  check(sum(initial)===1140000n&&sum(spent)===840000n&&sum(initial)-sum(spent)===300000n,'CHECKPOINT_SPECIES_TICKS');
  check(initialCredit===14400000n&&spentCredit===9900000n&&remainingCredit===4500000n,'CHECKPOINT_CREDIT_UNITS');
  check(final.B===7200000n&&final.retired===2700000n&&final.B+final.retired===spentCredit,'CHECKPOINT_PROVENANCE_CONSERVATION');
  const report={schema:'BIO-NATIVE-CHECKPOINT-AUDIT-1',fixtureOnly:true,productionAdmission:false,
    scope:'independent JS strict PDA/source/root decoding of the separately executed local cold-chain checkpoint',
    checkpointSHA256:digest,elfSHA256:expectedElfSHA256,accountCount:count,sourceCount:sources.length,
    standardUnitsByClass:units.map(String),totalStandardUnits:String(sum(units)),speciesTicks:{initial:String(sum(initial)),spent:String(sum(spent)),unspent:String(sum(initial)-sum(spent))},
    milliRU:{initial:String(initialCredit),spent:String(spentCredit),unspent:String(remainingCredit),effective:String(final.B),retired:String(final.retired)},
    layers,consumedRoots:81,finalBio:{instance:bio,address:final.address,qualityPpm:String(final.qualityPpm),cost:String(final.cost)},success:true};
  if(reportFile)await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [checkpointFile,releaseFile,expectedElfSHA256,expectedCheckpointSHA256,reportFile]=process.argv.slice(2);
  check(checkpointFile&&releaseFile&&expectedElfSHA256&&expectedCheckpointSHA256&&reportFile,'usage: checkpoint release exactELFSHA256 exactCheckpointSHA256 newReport');
  console.log(JSON.stringify(await auditNativeCheckpoint({checkpointFile,releaseFile,expectedElfSHA256,expectedCheckpointSHA256,reportFile}),null,2));
}
