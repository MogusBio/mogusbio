import { readdir,readFile,lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';import { fileURLToPath } from 'node:url';
const projectRoot=fileURLToPath(new URL('../../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(v,c)=>{if(!v)throw new Error(c);};
const policyFiles={taskManifestHash:'task.json',taskFaultPolicyHash:'fault.json',admissionPolicyHash:'admission.json',networkProfileHash:'network.json'};
/** Deterministic byte inventory, independent of deployment keys, times and ELF.
 * Generated target/evidence, private state and dependency/tool trees are absent.
 * Production builds must separately pin deployment-specific public inputs. */
export async function currentReleaseBinding(){
  const paths=[];
  async function walk(relative){
    const absolute=path.join(projectRoot,relative),s=await lstat(absolute);check(!s.isSymbolicLink(),'RELEASE_SOURCE_SYMLINK');
    if(s.isDirectory())for(const name of (await readdir(absolute)).sort()){if(name.startsWith('.')||['target','node_modules','evidence','coverage'].includes(name)||name.endsWith('.log'))continue;await walk(`${relative}/${name}`);}
    else{check(s.isFile()&&s.size<=4*1024*1024,'RELEASE_SOURCE_FILE');paths.push(relative);}
  }
  for(const name of ['packages','apps','scripts','test'])await walk(name);
  for(const name of (await readdir(path.join(projectRoot,'programs'))).sort()){
    const dir=`programs/${name}`,stat=await lstat(path.join(projectRoot,dir));check(!stat.isSymbolicLink(),'RELEASE_SOURCE_SYMLINK');if(!stat.isDirectory())continue;
    for(const file of ['Cargo.toml','Cargo.lock','build.rs','operations.p0r2.json','operations.market1.json']){
      try{await lstat(path.join(projectRoot,dir,file));}catch(e){if(e.code==='ENOENT')continue;throw e;}await walk(`${dir}/${file}`);
    }
    for(const folder of ['src','tests','harness']){try{await lstat(path.join(projectRoot,dir,folder));}catch(e){if(e.code==='ENOENT')continue;throw e;}await walk(`${dir}/${folder}`);}
  }
  for(const file of ['package.json','package-lock.json','releases/func2r2/manifest.json'])await walk(file);
  const policyHashes={};for(const [key,file]of Object.entries(policyFiles)){const relative=`releases/production/policies/${file}`;await walk(relative);policyHashes[key]=sha(await readFile(path.join(projectRoot,relative)));}
  const sources=[];for(const relative of paths.sort()){const b=await readFile(path.join(projectRoot,relative));sources.push({path:relative,bytes:b.length,sha256:sha(b)});}
  const manifest={profile:'BIO-SOURCE-RELEASE1',scope:'first release protocol/client/operator/workbench plus acceptance source and exact dependency locks',
    generatedDeploymentInputsExcluded:true,standaloneElfExcluded:true,policyHashes,sources};
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n');return {releaseHash:sha(bytes),policyHashes,manifest,bytes};
}
export async function assertCurrentReleaseBinding(input){
  const binding=await currentReleaseBinding();check(input.releaseHash===binding.releaseHash,'RELEASE_SOURCE_BINDING');
  for(const [key,value]of Object.entries(binding.policyHashes))check(input[key]===value,`RELEASE_POLICY_BINDING:${key}`);
  return binding;
}
