import { createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getAddressDecoder, getAddressEncoder, address, getProgramDerivedAddress } from '@solana/kit';
import { catalogHash, deploymentDomain } from '../../protocol-core/src/index.mjs';
import { PROGRAMS, productionOpening, validateProductionRelease, baseConfigR2Id } from '../src/release.mjs';
import { loadNativeAbi, encodeNativeFrame } from '../src/native.mjs';
export const hash = label => createHash('sha256').update(label).digest();
// Explicit known public local recipe only. Never funded, broadcast or used as
// production authority. The release validator binds it to deploymentMode0.
export function key(n){const seed=hash(n<7?`BIOP0R2 native SIGNING FIXTURE ONLY ${n}`:`BIOCLIENT pure unit key ${n}`);
  const sk=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),type:'pkcs8',format:'der'});
  return getAddressDecoder().decode(createPublicKey(sk).export({type:'spki',format:'der'}).subarray(-32));}
export const abiBytes=()=>readFileSync(new URL('../../../programs/biolab-economy/operations.p0r2.json',import.meta.url));
export async function clientFixture(){
  const raw=abiBytes(),abi=loadNativeAbi(raw,{expectedHash:createHash('sha256').update(raw).digest('hex')});
  const model=JSON.parse(readFileSync(new URL('../../../releases/func2r2/manifest.json',import.meta.url),'utf8'));
  const m={profile:'BIOP0R2',wireVersion:2,programId:key(0),bootstrap:key(1),opsMembers:[2,3,4,5,6].map(key).sort((a,b)=>Buffer.compare(getAddressEncoder().encode(a),getAddressEncoder().encode(b))),
    genesisHash:hash('local native genesis').toString('hex'),deploymentNonce:hash('local native nonce').toString('hex'),releaseHash:hash('native wire unit fixture').toString('hex'),abiHash:abi.hash,
    ruleHash:model.ruleHash,validatorHash:model.validatorHash,catalogHash:catalogHash().toString('hex'),taskManifestHash:hash('task').toString('hex'),
    taskFaultPolicyHash:hash('fault').toString('hex'),admissionPolicyHash:hash('admission').toString('hex'),networkProfileHash:hash('network').toString('hex'),
    initialSeedSetId:'',seedCount:16,frontier:316,initNotBefore:'3600',seedOpen:'7200',rewardStart:'93600',prewarmSeconds:86400,maxClockSkewSeconds:0,
    loaderProgram:PROGRAMS.loaderProgram,programDataAddress:'',upgradeAuthority:null};
  [m.programDataAddress]=await getProgramDerivedAddress({programAddress:address(PROGRAMS.loaderProgram),seeds:[getAddressEncoder().encode(m.programId)]});
  const domain=deploymentDomain(Buffer.from(m.genesisHash,'hex'),getAddressEncoder().encode(m.programId),Buffer.from(m.deploymentNonce,'hex'));
  m.initialSeedSetId=productionOpening(domain).id.toString('hex');const release=await validateProductionRelease(m,{localPublicFixture:true});
  return {abi,release,actor:key(1),frame:(operation,payload,nonce=0n)=>encodeNativeFrame(abi,{operation,domain:release.domain,configId:baseConfigR2Id(release),actor:key(1),nonce,payload})};
}
