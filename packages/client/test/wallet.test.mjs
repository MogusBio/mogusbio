import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyPairFromPrivateKeyBytes,getAddressFromPublicKey,signTransaction,partiallySignTransaction } from '@solana/kit';
import { buildV1Transaction,transactionBytes } from '../src/transaction.mjs';
import { walletV1Capability,verifyWalletSignedV1,requestWalletV1Signature } from '../src/wallet.mjs';
const pair=await createKeyPairFromPrivateKeyBytes(Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex'));
const address=await getAddressFromPublicKey(pair.publicKey);
const build=fee=>buildV1Transaction({feePayer:address,supportedTransactionVersions:[1],lifetime:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:10n},
  instructions:[{programAddress:'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',data:Buffer.from('local signing integrity fixture')}],
  resources:{computeUnitLimit:500000,loadedAccountsDataSizeLimit:100000,heapSize:32768,priorityFeeLamports:fee}}).transaction;
test('wallet capability checks the actual signing feature, installed version and network without prompting',()=>{
  let calls=0;const wallet={name:'fixture',chains:['solana:mainnet'],features:{'standard:connect':{connect:()=>{calls++;}},
    'solana:signTransaction':{supportedTransactionVersions:['legacy',0],signTransaction:()=>{calls++;}},
    'solana:signAndSendTransaction':{supportedTransactionVersions:[1]}}};
  assert.equal(walletV1Capability(wallet).supported,false);assert.equal(calls,0);
  wallet.features['solana:signTransaction'].supportedTransactionVersions=['1'];assert.equal(walletV1Capability(wallet).supported,false);
  wallet.features['solana:signTransaction'].supportedTransactionVersions=[1];assert.equal(walletV1Capability(wallet).supported,true);
  assert.equal(walletV1Capability(wallet,'solana:devnet').supported,false);assert.equal(calls,0);
});
test('real v1 signatures pass; unsigned, tampered signatures and wallet-mutated fees/messages fail',async()=>{
  const original=build(0n),unsigned=transactionBytes(original),signed=transactionBytes(await signTransaction([pair],original));
  assert.equal(verifyWalletSignedV1(unsigned,signed).verified,true);
  assert.throws(()=>verifyWalletSignedV1(unsigned,unsigned),/INVALID_SIGNATURE|MISSING_SIGNATURE/);
  const corrupt=Buffer.from(signed);corrupt[corrupt.length-1]^=1;assert.throws(()=>verifyWalletSignedV1(unsigned,corrupt),/INVALID_SIGNATURE/);
  const changed=transactionBytes(await signTransaction([pair],build(1n)));
  assert.throws(()=>verifyWalletSignedV1(unsigned,changed),/CHANGED_TRANSACTION_MESSAGE/);
});
test('user-invoked wallet signature helper enforces account reference, feature support and exact signed bytes; never broadcasts',async()=>{
  const original=build(0n),unsigned=transactionBytes(original),signed=transactionBytes(await signTransaction([pair],original));
  let signatures=0;const account={address,chains:['solana:mainnet'],features:['solana:signTransaction']};
  const wallet={name:'local public fixture',chains:['solana:mainnet'],accounts:[account],features:{'standard:connect':{connect:async()=>({accounts:[account]})},
    'solana:signTransaction':{supportedTransactionVersions:[1],signTransaction:async()=>{signatures++;return[{signedTransaction:signed}];}}}};
  await assert.rejects(requestWalletV1Signature({wallet,account:{...account},unsignedBytes:unsigned}),/ACCOUNT_NOT_AUTHORIZED/);
  assert.equal(signatures,0);assert.deepEqual(await requestWalletV1Signature({wallet,account,unsignedBytes:unsigned}),signed);assert.equal(signatures,1);
  wallet.features['solana:signTransaction'].supportedTransactionVersions=[0];
  await assert.rejects(requestWalletV1Signature({wallet,account,unsignedBytes:unsigned}),/UNSUPPORTED/);assert.equal(signatures,1);
});

test('explicit multi-signer collection preserves prior signatures and final acceptance requires every signer',async()=>{
  const other=await createKeyPairFromPrivateKeyBytes(Buffer.from('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb','hex'));
  const otherAddress=await getAddressFromPublicKey(other.publicKey);
  const transaction=buildV1Transaction({feePayer:address,supportedTransactionVersions:[1],lifetime:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:10n},
    instructions:[{programAddress:'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',accounts:[{address:otherAddress,role:2}],data:Buffer.from('local multisigner fixture')}],
    resources:{computeUnitLimit:500000,loadedAccountsDataSizeLimit:100000}}).transaction;
  const first=await partiallySignTransaction([pair],transaction),firstBytes=transactionBytes(first),unsigned=transactionBytes(transaction);
  const partial=verifyWalletSignedV1(unsigned,firstBytes,{allowPartial:true,requiredSigners:[address]});assert.equal(partial.fullySigned,false);
  assert.throws(()=>verifyWalletSignedV1(unsigned,firstBytes),/MISSING_SIGNATURE/);
  const complete=transactionBytes(await signTransaction([other],first));assert.equal(verifyWalletSignedV1(firstBytes,complete).fullySigned,true);
  const stripped=transactionBytes(await partiallySignTransaction([other],transaction));
  assert.throws(()=>verifyWalletSignedV1(firstBytes,stripped,{allowPartial:true,requiredSigners:[otherAddress]}),/COSIGNATURE/);
});
