//! Resource/byte oracle only. No Root, material, token, certificate or LAB API.
//! Uses the exact shared production provenance implementation under a separate
//! executable, with deliberately unauthenticated synthetic historical capsules.
use solana_program::{account_info::AccountInfo,entrypoint::ProgramResult,program::set_return_data,program_error::ProgramError,pubkey::Pubkey};
solana_program::entrypoint!(process_instruction);
fn err(n:u32)->ProgramError{ProgramError::Custom(n)}
fn require(c:bool,n:u32)->ProgramResult{if c{Ok(())}else{Err(err(n))}}
fn u16_at(b:&[u8],n:usize)->Result<u16,ProgramError>{Ok(u16::from_le_bytes(b.get(n..n+2).ok_or(err(1))?.try_into().unwrap()))}
fn u32_at(b:&[u8],n:usize)->Result<u32,ProgramError>{Ok(u32::from_le_bytes(b.get(n..n+4).ok_or(err(1))?.try_into().unwrap()))}
fn u64_at(b:&[u8],n:usize)->Result<u64,ProgramError>{Ok(u64::from_le_bytes(b.get(n..n+8).ok_or(err(1))?.try_into().unwrap()))}
fn add(a:u64,b:u64)->Result<u64,ProgramError>{a.checked_add(b).ok_or(err(2))}
fn zeros(b:&[u8])->bool{b.iter().all(|x|*x==0)}
mod synthesis{pub struct Payload{pub leaf_count:usize,pub capsules:[(usize,usize);60]}}
#[path="../../biolab-economy/src/provenance.rs"]mod provenance;
#[path="../../biolab-economy/src/heap.rs"]mod heap;
#[path="../../biolab-economy/src/semantic.rs"]mod semantic;
fn typed_hash(tag:u16,parts:&[&[u8]])->[u8;32]{let mut h=[0;16];h[..8].copy_from_slice(b"BIOHASH\0");h[8..10].copy_from_slice(&1u16.to_le_bytes());h[10..12].copy_from_slice(&tag.to_le_bytes());h[12..16].copy_from_slice(&(parts.iter().map(|p|p.len()).sum::<usize>()as u32).to_le_bytes());let mut slices=vec![h.as_slice()];slices.extend_from_slice(parts);solana_program::hash::hashv(&slices).to_bytes()}
#[inline(never)]
fn payload(b:&[u8])->Result<Box<synthesis::Payload>,ProgramError>{
    require(!b.is_empty()&&b[0]==60,1)?;let mut p=Box::new(synthesis::Payload{leaf_count:60,capsules:[(0,0);60]});let mut at=1;
    for capsule in &mut p.capsules{let len=u16_at(b,at)?as usize;at+=2;require((326..=3358).contains(&len)&&at+len<=b.len(),1)?;*capsule=(at,len);at+=len;}require(at==b.len(),1)?;Ok(p)
}
pub fn process_instruction(program:&Pubkey,a:&[AccountInfo],d:&[u8])->ProgramResult{
    require(d.len()==1&&d[0]<=3&&a.len()==2&&a[0].owner==program&&!a[0].is_writable&&!a[0].is_signer&&a[1].owner==program&&a[1].is_writable&&a[1].data_len()==provenance::BYTES,1)?;
    let raw=a[0].try_borrow_data()?;
    if d[0]==3{let g=biolab_kernel::graph::decode_graph(&raw)?;let digest=semantic::semantic_id(&g)?;set_return_data(&digest);return Ok(());}
    let p=payload(&raw)?;
    let mut state=if d[0]==0{let mut s=provenance::Provenance::new_boxed();s.reset_iterators(&raw,&p)?;s}else{provenance::Provenance::decode_boxed(&a[1].try_borrow_data()?)?};
    let mut out=[0u8;33];match d[0]{0=>{},1=>{out[0]=u8::from(state.count_step(&raw,&p,7_200_000,2_700_000)?);},_=>{if let Some(hash)=state.hash_step(&raw,&p)?{out[0]=1;out[1..].copy_from_slice(&hash);}}}
    state.encode(&mut a[1].try_borrow_mut_data()?)?;set_return_data(&out);Ok(())
}
