// Loader-v3 wire mirrors solana-loader-v3-interface 7.0.0 instruction.rs.
// This module only constructs instructions. Signing and network gates live elsewhere.
import {AccountRole,address} from '@solana/kit';
import {ByteWriter} from '../../packages/protocol-core/src/index.mjs';
import {nativeKeyBytes,nativePda} from '../../packages/client/src/native.mjs';
import {PROGRAMS} from '../../packages/client/src/release.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const meta=(key,role)=>({address:address(key),role});
const R=AccountRole.READONLY,W=AccountRole.WRITABLE,S=AccountRole.READONLY_SIGNER,WS=AccountRole.WRITABLE_SIGNER;
const ix=(data,accounts,programAddress=PROGRAMS.loaderProgram)=>({programAddress:address(programAddress),accounts,data:Uint8Array.from(data)});
export const LOADER_BUFFER_METADATA_BYTES=37,LOADER_PROGRAM_METADATA_BYTES=36,LOADER_DATA_METADATA_BYTES=45;
export function createAccountInstruction({payer,newAccount,lamports,space,owner=PROGRAMS.loaderProgram}){check(typeof lamports==='bigint'&&lamports>=0n&&typeof space==='bigint'&&space>=0n&&space<=10485760n,'DEVNET_CREATE_ACCOUNT');return ix(new ByteWriter(52).u32(0).u64(lamports).u64(space).raw(nativeKeyBytes(owner)).finish(),[meta(payer,WS),meta(newAccount,WS)],PROGRAMS.systemProgram);}
export function initializeBufferInstruction({buffer,authority}){return ix(new ByteWriter(4).u32(0).finish(),[meta(buffer,W),meta(authority,R)]);}
export function writeBufferInstruction({buffer,authority,offset,bytes}){check(Number.isInteger(offset)&&offset>=0&&offset<=10485760&&bytes instanceof Uint8Array&&bytes.length>=1&&bytes.length<=3072,'DEVNET_LOADER_WRITE');return ix(new ByteWriter(3088).u32(1).u32(offset).u64(BigInt(bytes.length)).raw(bytes).finish(),[meta(buffer,W),meta(authority,S)]);}
export async function deployLoaderInstruction({payer,program,buffer,authority,maxDataLength}){check(Number.isInteger(maxDataLength)&&maxDataLength>=1&&maxDataLength<=10485760-45,'DEVNET_LOADER_LENGTH');const data=await nativePda(PROGRAMS.loaderProgram,nativeKeyBytes(program));return ix(new ByteWriter(12).u32(2).u64(BigInt(maxDataLength)).finish(),[meta(payer,WS),meta(data.address,W),meta(program,W),meta(buffer,W),meta('SysvarRent111111111111111111111111111111111',R),meta(PROGRAMS.clockSysvar,R),meta(PROGRAMS.systemProgram,R),meta(authority,S)]);}
export async function makeProgramImmutableInstruction({program,authority}){const data=await nativePda(PROGRAMS.loaderProgram,nativeKeyBytes(program));return ix(new ByteWriter(4).u32(4).finish(),[meta(data.address,W),meta(authority,S)]);}
