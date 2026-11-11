import {address,getAddressEncoder} from '@solana/kit';

export const DEVNET_GENESIS_BASE58='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_GENESIS_HEX=Buffer.from(getAddressEncoder().encode(address(DEVNET_GENESIS_BASE58))).toString('hex');
const MAINNET_GENESIS_HEX=Buffer.from(getAddressEncoder().encode(address('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'))).toString('hex');
const genesis=release=>{try{const bytes=release?.hashes?.genesisHash;if(!(bytes instanceof Uint8Array)||bytes.length!==32)return null;const hex=Buffer.from(bytes).toString('hex');return release?.input?.genesisHash===hex?hex:null;}catch{return null;}};
/** An admitted public Devnet release is never the deterministic local fixture. */
export const isDevnetRelease=release=>release?.localPublicFixture===false&&genesis(release)===DEVNET_GENESIS_HEX;
/** Network identity derives from the admitted genesis, never from the RPC URL. */
export function walletChainForRelease(release){
  if(release?.localPublicFixture===true)return 'solana:localnet';
  if(release?.localPublicFixture!==false)return null;const value=genesis(release);
  return value===DEVNET_GENESIS_HEX?'solana:devnet':value===MAINNET_GENESIS_HEX?'solana:mainnet':null;
}
