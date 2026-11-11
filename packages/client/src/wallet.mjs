import { createPublicKey, verify } from 'node:crypto';
import { getAddressEncoder } from '@solana/kit';
import { decodeV1Transaction } from './transaction.mjs';
import { walletV1Capability } from './wallet-capability.mjs';
export { walletV1Capability } from './wallet-capability.mjs';

/** Verify every required signature and ensure the wallet changed no message byte. */
export function verifyWalletSignedV1(unsignedBytes,signedBytes,{allowPartial=false,requiredSigners=[]}={}) {
  if(typeof allowPartial!=='boolean'||!Array.isArray(requiredSigners))throw new Error('WALLET_SIGNATURE_POLICY');
  const before=decodeV1Transaction(unsignedBytes).transaction,after=decodeV1Transaction(signedBytes).transaction;
  if(!Buffer.from(before.messageBytes).equals(Buffer.from(after.messageBytes)))throw new Error('WALLET_CHANGED_TRANSACTION_MESSAGE');
  const required=Object.keys(before.signatures),actual=Object.keys(after.signatures);
  if(!required.length||required.length!==actual.length||required.some((key,i)=>key!==actual[i]))throw new Error('WALLET_CHANGED_REQUIRED_SIGNERS');
  if(requiredSigners.some(s=>!required.includes(s)))throw new Error('WALLET_UNEXPECTED_REQUIRED_SIGNER');
  let signedCount=0;
  for(const signer of required){
    const signature=after.signatures[signer];
    const prior=before.signatures[signer],hasPrior=prior instanceof Uint8Array&&prior.some(b=>b!==0);
    if(hasPrior&&!(signature instanceof Uint8Array&&Buffer.from(prior).equals(Buffer.from(signature))))throw new Error('WALLET_REMOVED_OR_CHANGED_COSIGNATURE');
    if(!(signature instanceof Uint8Array)||signature.length!==64||signature.every(b=>b===0)){
      if(allowPartial&&!requiredSigners.includes(signer)&&!hasPrior)continue;
      throw new Error('WALLET_MISSING_SIGNATURE');
    }
    const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(getAddressEncoder().encode(signer))]),format:'der',type:'spki'});
    if(!verify(null,after.messageBytes,publicKey,signature))throw new Error('WALLET_INVALID_SIGNATURE');
    signedCount++;
  }
  return {transaction:after,signers:required,signedCount,fullySigned:signedCount===required.length,verified:true};
}

/** Called only from the user's explicit signing action; never sends to an RPC. */
export async function requestWalletV1Signature({wallet,account,chain='solana:mainnet',unsignedBytes,allowPartial=false}) {
  const capability=walletV1Capability(wallet,chain);
  if(!capability.supported)throw new Error('WALLET_V1_OR_NETWORK_UNSUPPORTED');
  if(!wallet.accounts?.includes(account)||!account.chains?.includes(chain)||!account.features?.includes('solana:signTransaction'))
    throw new Error('WALLET_ACCOUNT_NOT_AUTHORIZED');
  const decoded=decodeV1Transaction(unsignedBytes).transaction;
  if(!Object.keys(decoded.signatures).includes(account.address))throw new Error('WALLET_ACCOUNT_NOT_REQUIRED_SIGNER');
  const outputs=await wallet.features['solana:signTransaction'].signTransaction({account,chain,transaction:new Uint8Array(unsignedBytes)});
  if(!Array.isArray(outputs)||outputs.length!==1||!(outputs[0]?.signedTransaction instanceof Uint8Array))throw new Error('WALLET_SIGN_OUTPUT');
  // Explicit partial collection supports multi-owner manufacture and 3/5 Ops.
  // The final broadcast gate always calls verifyWalletSignedV1 without partial.
  verifyWalletSignedV1(unsignedBytes,outputs[0].signedTransaction,{allowPartial,requiredSigners:[account.address]});
  return Buffer.from(outputs[0].signedTransaction);
}
