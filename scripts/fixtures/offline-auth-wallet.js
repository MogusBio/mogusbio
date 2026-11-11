// Served only by preview-auth-local --local-public-fixture --demo-wallet.
// Ephemeral browser keys can sign login text only; there is no transaction,
// token, wallet-file import, broadcast feature or exported private key.
import {getWallets} from '/vendor/wallets.js';
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function address(bytes){let n=0n;for(const byte of bytes)n=(n<<8n)+BigInt(byte);let text='';while(n){text=B58[Number(n%58n)]+text;n/=58n;}for(const byte of bytes){if(byte!==0)break;text='1'+text;}return text;}
async function make(label){
  const pair=await crypto.subtle.generateKey({name:'Ed25519'},false,['sign','verify']),publicKey=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),account=Object.freeze({address:address(publicKey),publicKey,chains:['solana:localnet'],features:['solana:signMessage']}),listeners=new Set();let connected=false;
  return {version:'1.0.0',name:`离线消息签名测试 ${label}`,icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjYmFmNTcwIi8+PC9zdmc+',chains:['solana:localnet'],get accounts(){return connected?[account]:[];},features:{
    'standard:connect':{version:'1.0.0',async connect(){connected=true;for(const f of listeners)f({accounts:[account]});return {accounts:[account]};}},
    'standard:events':{version:'1.0.0',on(_event,handler){listeners.add(handler);return()=>listeners.delete(handler);}},
    'solana:signMessage':{version:'1.0.0',async signMessage(...inputs){return Promise.all(inputs.map(async input=>{if(!connected||input.account!==account||!(input.message instanceof Uint8Array))throw Error('OFFLINE_TEST_ACCOUNT');const bytes=new Uint8Array(input.message);return {signedMessage:bytes,signature:new Uint8Array(await crypto.subtle.sign('Ed25519',pair.privateKey,bytes))};}));}},
  }};
}
getWallets().register(await make('A'),await make('B'));
