import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentReleaseBinding} from '../../packages/client/src/binding.mjs';
import {validateProductionRelease} from '../../packages/client/src/release.mjs';
import {isDevnetRelease} from '../../packages/client/src/cluster.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
/** cargo-build-sbf may exit zero after LLVM reports an unusable frame. The
 * saved compiler diagnostics are an independent admission gate for its ELF. */
export function assertSbfBuildDiagnostics(log){
  check(typeof log==='string','DEVNET_BUILD_DIAGNOSTICS');
  const text=log.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
  check(!/\bStack offset of\b|\bstack frame[^\r\n]*(?:exceed|too large)|\boverflows the maximum allowed frame space\b/i.test(text),'DEVNET_BUILD_STACK_OVERFLOW');
  check(!/^\s*(?:error(?:\[[^\]\r\n]+\])?|LLVM ERROR)\s*:/im.test(text),'DEVNET_BUILD_DIAGNOSTIC_ERROR');
}
export async function buildDevnetProgram({releaseFile,directory,onOutput=()=>{}}={}){
  check(path.isAbsolute(releaseFile??'')&&path.isAbsolute(directory??''),'DEVNET_BUILD_PATH');const input=JSON.parse(await readFile(releaseFile,'utf8')),release=await validateProductionRelease(input);check(isDevnetRelease(release),'DEVNET_BUILD_NETWORK');await mkdir(directory,{recursive:true,mode:0o700});const args=['--manifest-path',path.join(ROOT,'programs/biolab-economy/Cargo.toml'),'--arch','v3','--sbf-out-dir',directory,'--no-default-features','--features','production-admission,custom-heap','--','--offline'];
  const logfile=path.join(directory,'build.log'),log=await open(logfile,'w',0o600);let code,writes=Promise.resolve(),writeError=null;
  try{code=await new Promise((resolve,reject)=>{const child=spawn(path.join(ROOT,'.local-tools/cargo/bin/cargo-build-sbf'),args,{cwd:ROOT,env:{...process.env,CARGO_HOME:path.join(ROOT,'.local-tools/cargo'),RUSTUP_HOME:path.join(ROOT,'.local-tools/rustup'),PATH:`${path.join(ROOT,'.local-tools/cargo/bin')}${path.delimiter}${process.env.PATH??''}`,CARGO_TARGET_DIR:path.join(directory,'cargo-target'),BIO_RELEASE_MANIFEST:releaseFile},stdio:['ignore','pipe','pipe']});child.on('error',reject);for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{writes=writes.then(()=>log.write(data)).catch(error=>{writeError=error;});onOutput(data.toString());});child.on('close',resolve);});await writes;if(writeError)throw writeError;await log.sync();}finally{await writes;await log.close();}check(code===0,'DEVNET_BUILD_FAILED');assertSbfBuildDiagnostics(await readFile(logfile,'utf8'));check((await currentReleaseBinding()).releaseHash===input.releaseHash,'DEVNET_SOURCE_CHANGED_DURING_BUILD');const elfPath=path.join(directory,'biolab_economy.so'),elf=await readFile(elfPath);check(elf.readUInt32LE(48)===3,'DEVNET_BUILD_ARCH');const record={profile:'BIO-DEVNET-BUILD1',programId:input.programId,releaseHash:input.releaseHash,abiHash:input.abiHash,elfSHA256:createHash('sha256').update(elf).digest('hex'),elfBytes:elf.length,architecture:'sbf-v3',buildFlags:args,networkSubmitted:false},recordFile=path.join(directory,'build-public.json');await writeFile(recordFile,JSON.stringify(record,null,2)+'\n',{mode:0o600});return{...record,elfPath,buildRecordPath:recordFile,buildLog:logfile};
}
