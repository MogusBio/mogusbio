import { ByteWriter } from '../../protocol-core/src/index.mjs';
import { nativePda } from '../src/native.mjs';
import { baseConfigR2Id,encodeBaseConfigR2 } from '../src/release.mjs';
export async function recordAccount(release,{kind,schema=1,seeds,id,body}){
  const p=await nativePda(release.input.programId,...seeds),header=new ByteWriter(120).raw(Buffer.from('BIOLAB\0\0')).u16(1).u16(kind).u16(schema).u16(0).raw(release.domain).raw(baseConfigR2Id(release)).u32(body.length).u8(p.bump).raw(Buffer.alloc(3)).raw(id,32).finish();
  return {address:p.address,owner:release.input.programId,executable:false,lamports:10000000n,rentEpoch:0n,data:Buffer.concat([header,body])};
}
export const baseAccount=release=>recordAccount(release,{kind:1,schema:2,seeds:['bio','config'],id:baseConfigR2Id(release),body:encodeBaseConfigR2(release)});
