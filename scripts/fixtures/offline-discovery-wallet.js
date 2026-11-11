// Served only by the explicitly enabled offline discovery preview. These are
// the already-public local native signing fixtures, never a real wallet/key.
// Only exact localhost BioLab login text can be signed. No transaction feature.
import {getWallets} from '/vendor/wallets.js';
const config=await (await fetch('/offline-discovery-wallet-config',{redirect:'error',cache:'no-store'})).json();
if(config.fixtureOnly!==true||config.messageOnly!==true||config.origin!==location.origin||!Array.isArray(config.accounts)||config.accounts.length!==2)throw Error('OFFLINE_FIXTURE_ONLY');
const hex=text=>Uint8Array.from(text.match(/../g),p=>parseInt(p,16));
async function make(descriptor,label){
  const recipe=descriptor.index<7?`BIOP0R2 native SIGNING FIXTURE ONLY ${descriptor.index}`:`BIOCLIENT pure unit key ${descriptor.index}`;
  const seed=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(recipe)));
  const privateKey=await crypto.subtle.importKey('pkcs8',new Uint8Array([...hex('302e020100300506032b657004220420'),...seed]),{name:'Ed25519'},false,['sign']);
  const account=Object.freeze({address:descriptor.address,publicKey:hex(descriptor.publicKeyHex),chains:['solana:localnet'],features:['solana:signMessage']});
  const listeners=new Set();let connected=false;
  return {version:'1.0.0',name:`离线账本测试 ${label}`,icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjYmFmNTcwIi8+PC9zdmc+',chains:['solana:localnet'],get accounts(){return connected?[account]:[];},features:{
    'standard:connect':{version:'1.0.0',async connect(){connected=true;for(const handler of listeners)handler({accounts:[account]});return {accounts:[account]};}},
    'standard:events':{version:'1.0.0',on(_event,handler){listeners.add(handler);return()=>listeners.delete(handler);}},
    'solana:signMessage':{version:'1.0.0',async signMessage(...inputs){return Promise.all(inputs.map(async input=>{
      if(!connected||input.account!==account||!(input.message instanceof Uint8Array))throw Error('OFFLINE_FIXTURE_ACCOUNT');
      const bytes=new Uint8Array(input.message),message=new TextDecoder('utf8',{fatal:true}).decode(bytes);
      if(!message.startsWith('BioLab wallet sign-in\n')||!message.includes(`\nOrigin: ${location.origin}\n`)||!message.includes(`\nActor: ${account.address}\n`))throw Error('OFFLINE_LOGIN_MESSAGE_ONLY');
      return {signedMessage:bytes,signature:new Uint8Array(await crypto.subtle.sign('Ed25519',privateKey,bytes))};
    }));}},
  }};
}
getWallets().register(await make(config.accounts[0],'A'),await make(config.accounts[1],'B'));
