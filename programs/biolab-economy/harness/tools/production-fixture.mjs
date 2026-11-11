// LOCAL SIGNING FIXTURE ONLY: all seeds below are intentionally public. Never
// fund/deploy these identities. No secret file, wallet or real chain is read.
import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,address,isOffCurveAddress} from '@solana/kit';
import {catalogHash,deploymentDomain} from '../../../../packages/protocol-core/src/index.mjs';
import {productionOpening,validateProductionRelease,productionRustConstants,PROGRAMS} from '../../../../packages/client/src/release.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function key(n){const seed=Buffer.from(hash(`BIOP0R2 native SIGNING FIXTURE ONLY ${n}`),'hex');const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),type:'pkcs8',format:'der'});return getAddressDecoder().decode(createPublicKey(privateKey).export({type:'spki',format:'der'}).subarray(-32));}
const model=JSON.parse(readFileSync(new URL('../../../../releases/func2r2/manifest.json',import.meta.url)));
const m={profile:'BIOP0R2',wireVersion:2,programId:key(0),bootstrap:key(1),opsMembers:[2,3,4,5,6].map(key).sort((a,b)=>Buffer.compare(getAddressEncoder().encode(a),getAddressEncoder().encode(b))),genesisHash:hash('local native genesis'),deploymentNonce:hash('local native nonce'),releaseHash:hash('local native public manifest'),abiHash:hash('local native ABI'),ruleHash:model.ruleHash,validatorHash:model.validatorHash,catalogHash:catalogHash().toString('hex'),taskManifestHash:hash('local task'),taskFaultPolicyHash:hash('local fault'),admissionPolicyHash:hash('local admission'),networkProfileHash:hash('local network'),initialSeedSetId:'',seedCount:16,frontier:316,initNotBefore:'3600',seedOpen:'7200',rewardStart:'93600',prewarmSeconds:86400,maxClockSkewSeconds:0,loaderProgram:PROGRAMS.loaderProgram,programDataAddress:'',upgradeAuthority:null};
[m.programDataAddress]=await getProgramDerivedAddress({programAddress:address(PROGRAMS.loaderProgram),seeds:[getAddressEncoder().encode(m.programId)]});const d=deploymentDomain(Buffer.from(m.genesisHash,'hex'),getAddressEncoder().encode(m.programId),Buffer.from(m.deploymentNonce,'hex'));m.initialSeedSetId=productionOpening(d).id.toString('hex');
m.abiHash=createHash('sha256').update(readFileSync(new URL('../../operations.p0r2.json',import.meta.url))).digest('hex');
const args=process.argv.slice(2);if(args.length!==0&&args.length!==2)throw new Error('Usage: production-fixture.mjs [absolute-new-json absolute-generated-rust]');
const jsonFile=args[0]??fileURLToPath(new URL('../../evidence/production-admission-fixture-result58.json',import.meta.url));
const rustFile=args[1]??fileURLToPath(new URL('../tests/support/production_release.rs',import.meta.url));
if(!path.isAbsolute(jsonFile)||!path.isAbsolute(rustFile))throw new Error('FIXTURE_ABSOLUTE_PATHS');
const r=await validateProductionRelease(m,{localPublicFixture:true});writeFileSync(jsonFile,JSON.stringify(m,null,2)+'\n',{flag:'wx'});writeFileSync(rustFile,productionRustConstants(r));
