import { AccountRole } from '@solana/kit';
import { PROGRAMS } from './release.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda,decodeNativeFrame } from './native.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};

/** Exact official Associated Token CreateIdempotent, not arbitrary setup.
 * This pure constructor does not prove the Position beneficiary on-chain;
 * NativePlayerSession separately reads/validates that actual account. */
export async function buildClaimLabDestinationSetup({release,abi,frame,labDestinationSetup}){
  check(labDestinationSetup&&typeof labDestinationSetup==='object'&&!Array.isArray(labDestinationSetup)
    &&Object.keys(labDestinationSetup).join(',')==='beneficiary'&&typeof labDestinationSetup.beneficiary==='string','LAB_SETUP_FIELDS');
  const f=decodeNativeFrame(abi,frame);check(f.operation==='CLAIM_POSITION','LAB_SETUP_ONLY_CLAIM');
  const beneficiary=nativeKeyAddress(labDestinationSetup.beneficiary),payer=nativeKeyAddress(f.actor),mint=release.pdas.labMint.address;
  check(nativeKeyAddress(f.payload.subarray(80,112))===payer,'LAB_SETUP_PAYER');
  const destination=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(beneficiary),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address;
  check(nativeKeyAddress(f.payload.subarray(48,80))===destination,'LAB_SETUP_DESTINATION');
  const accounts=[{address:payer,role:AccountRole.WRITABLE_SIGNER},{address:destination,role:AccountRole.WRITABLE},
    {address:beneficiary,role:AccountRole.READONLY},{address:mint,role:AccountRole.READONLY},
    {address:PROGRAMS.systemProgram,role:AccountRole.READONLY},{address:PROGRAMS.tokenProgram,role:AccountRole.READONLY}];
  return {metadata:{beneficiary},beneficiary,payer,destination,instruction:{programAddress:PROGRAMS.associatedTokenProgram,accounts,data:Buffer.from([1])}};
}
