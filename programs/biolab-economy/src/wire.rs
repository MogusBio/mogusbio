//! BIOECON2 local envelope and typed hashes; distinct from the full ExactFrame admission adapter.
use super::*;

pub fn typed_hash(tag: u16, parts: &[&[u8]]) -> [u8; 32] {
    let length: usize = parts.iter().map(|b| b.len()).sum();
    let mut head = [0u8; 16];
    head[..8].copy_from_slice(b"BIOHASH\0");
    head[8..10].copy_from_slice(&1u16.to_le_bytes());
    head[10..12].copy_from_slice(&tag.to_le_bytes());
    head[12..].copy_from_slice(&(length as u32).to_le_bytes());
    let mut slices = Vec::with_capacity(parts.len() + 1);
    slices.push(head.as_slice());
    slices.extend_from_slice(parts);
    hashv(&slices).to_bytes()
}
pub fn domain() -> [u8; 32] {
    typed_hash(1, &[&GENESIS, PROGRAM_ID.as_ref(), &DEPLOYMENT_NONCE])
}
pub fn pda(program: &Pubkey, name: &[u8]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"bio", name], program)
}
pub fn config_id() -> [u8; 32] {
    #[cfg(feature="production-admission")]
    {return constants::CONFIG_ID;}
    #[cfg(feature="acceptance-test")]
    {
    let mint = pda(&PROGRAM_ID, b"lab-mint").0;
    let reserve = pda(&PROGRAM_ID, b"lab-reserve").0;
    let authority = pda(&PROGRAM_ID, b"lab-auth").0;
    typed_hash(
        2,
        &[
            b"ECOCFG03",
            &domain(),
            &RELEASE_HASH,
            BOOTSTRAP.as_ref(),
            mint.as_ref(),
            reserve.as_ref(),
            authority.as_ref(),
            &N.to_le_bytes(),
            &[6],
            &APPROVED_VALIDATOR_HASH,
            &APPROVED_RULE_HASH,
            &originality::PREWARM_SECONDS.to_le_bytes(),
            &originality::initial_set_id(),
        ],
    )
    }
}
pub(crate) struct Frame<'a> {
    pub(crate) opcode: u8,
    pub(crate) actor: Pubkey,
    pub(crate) nonce: u64,
    pub(crate) payload: &'a [u8],
    pub(crate) digest: [u8; 32],
}
#[cfg(feature="acceptance-test")]
pub(crate) fn frame(data: &[u8]) -> Result<Frame<'_>, ProgramError> {
    require(
        data.len() >= 128
            && data.len() <= 2048
            && &data[..8] == b"BIOECON2"
            && zeros(&data[9..16])
            && zeros(&data[124..128]),
        8000,
    )?;
    require(
        data[16..48] == domain() && data[48..80] == config_id(),
        8001,
    )?;
    require(
        (1..=13).contains(&data[8]) || (20..=46).contains(&data[8]),
        8000,
    )?;
    require(u32_at(data, 120)? as usize == data.len() - 128, 8000)?;
    Ok(Frame {
        opcode: data[8],
        actor: key_at(data, 80)?,
        nonce: u64_at(data, 112)?,
        payload: &data[128..],
        digest: typed_hash(4, &[data]),
    })
}

/// P0R2 exact152-byte public envelope. Its H4 binds the user's original bytes;
/// no BIOECON2 reconstruction, opcode alias or second nonce path is accepted.
#[cfg(feature="production-admission")]
pub(crate) fn frame(data:&[u8])->Result<Frame<'_>,ProgramError>{
    require((152..=4096).contains(&data.len())&&&data[..8]==b"BIOIX\0\0\0"&&u16_at(data,8)?==1&&zeros(&data[120..144])&&zeros(&data[148..152]),8000)?;
    require(data[16..48]==domain()&&data[48..80]==config_id(),8001)?;
    require(u32_at(data,144)?as usize==data.len()-152,8000)?;
    let key=(u16_at(data,10)?,u16_at(data,12)?,u16_at(data,14)?);
    let opcode=match key{
        (1,1,2)=>1,(201,1,2)=>4,(202,1,2)=>5,(301,1,2)=>6,(301,2,2)=>7,
        (401,1,2)=>9,(401,2,2)=>10,(501,1,2)=>8,(602,1,2)=>11,(602,2,2)=>12,(701,1,2)=>13,
        (1001,1,2)=>20,(1001,2,2)=>21,(1001,3,2)=>26,(1101,1,2)=>22,(1102,1,2)=>23,(1102,2,2)=>24,(1102,3,2)=>28,(1102,4,2)=>29,
        (1201,1,2)=>25,(1201,2,2)=>27,(1203,1,1)=>3,
        (901,1,2)=>30,(901,2,2)=>31,(901,3,2)=>32,(901,4,2)=>33,
        (1002,1,2)=>34,(1002,2,2)=>35,(1002,3,2)=>36,
        (1301,1,1)=>41,(1301,2,1)=>42,(1301,3,1)=>43,(1301,4,1)=>44,(1301,5,1)=>45,(1301,6,1)=>46,
        (1003,1,2)=>37,(1003,2,2)=>38,(1003,3,2)=>39,(1003,4,2)=>40,_=>return Err(err(8000)),
    };
    Ok(Frame{opcode,actor:key_at(data,80)?,nonce:u64_at(data,112)?,payload:&data[152..],digest:typed_hash(4,&[data])})
}

/// ECON-SETTLE2 canonical op ID is nonce:u64 LE followed by24 zero bytes.
pub(crate) fn business_key(f: &Frame) -> [u8; 32] {
    let mut op = [0u8; 32];
    op[..8].copy_from_slice(&f.nonce.to_le_bytes());
    typed_hash(3, &[&domain(), f.actor.as_ref(), &op])
}
