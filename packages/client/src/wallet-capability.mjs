/** Read-only Wallet Standard feature gate. It never connects or requests a signature. */
export function walletV1Capability(wallet, chain='solana:mainnet') {
  const feature=wallet?.features?.['solana:signTransaction'];
  const versions=Array.isArray(feature?.supportedTransactionVersions)?feature.supportedTransactionVersions:[];
  const v1=versions.some(v=>v===1);
  const network=Array.isArray(wallet?.chains)&&wallet.chains.includes(chain);
  const canConnect=typeof wallet?.features?.['standard:connect']?.connect==='function';
  const canSign=typeof feature?.signTransaction==='function';
  return Object.freeze({name:typeof wallet?.name==='string'?wallet.name:'未命名钱包',chain,v1,network,canConnect,canSign,
    supported:v1&&network&&canConnect&&canSign,
    reason:!v1?'需要支持 v1 交易的钱包版本':!network?'钱包不支持所选网络':!canSign?'钱包缺少独立交易签名接口':!canConnect?'钱包缺少标准连接接口':null});
}
