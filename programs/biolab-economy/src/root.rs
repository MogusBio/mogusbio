//! Shared native Root records. Only complete manufacture/synthesis calls writers.
use super::*;

#[derive(Clone, Copy, Debug)]
pub(crate) struct RootFacts {
    pub schema: u16,
    pub instance: Pubkey,
    pub m: [u8; 32],
    pub catalog: [u8; 32],
    pub validator: [u8; 32],
    pub descriptor: [u8; 4],
    pub q: u32,
    pub b: u64,
    pub retired: u64,
    pub scope: u8,
    pub admission: u8,
    pub owner: Pubkey,
    pub revision: u64,
    pub lifecycle: u8,
    pub parent: [u8; 32],
    pub consumed_m: [u8; 32],
    pub created_at: i64,
    pub created_slot: u64,
    pub fingerprint: [u8; 32],
}
pub fn descriptor(bytes: &[u8]) -> Result<[u8; 4], ProgramError> {
    require(bytes.len() == 4 && u16_at(bytes, 0)? == 1, 6500)?;
    require(
        match bytes[2] {
            1..=3 => bytes[3] == 0,
            4 => (1..=15).contains(&bytes[3]),
            _ => false,
        },
        6500,
    )?;
    bytes.try_into().map_err(|_| err(6500))
}
pub fn instance_id(m: &[u8; 32]) -> [u8; 32] {
    typed_hash(6, &[&domain(), m, &0u16.to_le_bytes()])
}
pub(crate) fn read_root(a: &AccountInfo) -> Result<RootFacts, ProgramError> {
    require((447..=3479).contains(&a.data_len()), 6506)?;
    let d = a.try_borrow_data()?;
    let schema = u16_at(&d, 12)?;
    require((1..=4).contains(&schema), 6506)?;
    let b = &d[120..];
    let instance = key_at(b, 0)?;
    let m: [u8; 32] = b[32..64].try_into().map_err(|_| err(6506))?;
    require(instance.to_bytes() == instance_id(&m), 6506)?;
    let q = u32_at(b, 164)?;
    let base = u64_at(b, 168)?;
    let retired = u64_at(b, 176)?;
    require(
        b[96..128] == materials::catalog_hash()
            && b[128..160] == APPROVED_VALIDATOR_HASH
            && i64_at(b, 186)? >= 0,
        6506,
    )?;
    let desc: [u8; 4] = b[160..164].try_into().map_err(|_| err(6506))?;
    if schema == 1 {
        descriptor(&desc)?;
        require(
            q == 1_000_000
                && base == 120_000
                && retired == 45_000
                && b[184] == 1
                && b[185] == 0
                && b.len() <= 3359,
            6506,
        )?;
        let groups = materials::decode_debits(&b[323..])?;
        materials::assert_bom(&groups)?;
    } else {
        require(b.len() == 641, 6506)?;
        let target = desc[0];
        require(
            match schema {
                2 => (1..=15).contains(&target) && desc == [target, 1, target, 0],
                3 => (16..=21).contains(&target) && desc == [target, 2, target - 15, 0],
                4 => desc == [22, 3, 0, 0],
                _ => false,
            },
            6506,
        )?;
        let leaves = biolab_kernel::graph::members(target)?
            .len()
            .checked_mul(4)
            .ok_or(err(8020))?;
        require(
            base == (leaves as u64) * 120_000
                && retired == (leaves as u64) * 45_000
                && (500_000..=2_000_000).contains(&q)
                && q % 1000 == 0
                && b[184] == 2
                && b[185] <= 1
                && b[640] as usize == leaves,
            6506,
        )?;
        let direct = if target <= 15 {
            4
        } else if target <= 21 {
            biolab_kernel::graph::members(target)?.len()
        } else {
            6
        };
        let challenge = u32_at(b, 487)?;
        require(
            b[639] as usize == direct
                && (500_000..=2_000_000).contains(&challenge)
                && challenge % 1000 == 0
                && (![3, 9, 14, 15, 21].contains(&target) || challenge == 2_000_000)
                && u32_at(b, 491)? == 2
                && u32_at(b, 495)? == 1
                && u32_at(b, 499)? == 1,
            6506,
        )?;
        let cost = u64_at(b, 599)?;
        require(
            if b[185] == 1 {
                schema == 4 && q == 2_000_000 && cost > 0
            } else {
                cost == 0
            },
            6506,
        )?;
    }
    let lifecycle = b[242];
    require(lifecycle <= 1, 6506)?;
    let parent = b[243..275].try_into().map_err(|_| err(6506))?;
    let consumed_m = b[275..307].try_into().map_err(|_| err(6506))?;
    if lifecycle == 0 {
        require(zeros(&b[243..323]), 6506)?;
    } else {
        require(
            !zeros(&b[243..275])
                && !zeros(&b[275..307])
                && i64_at(b, 307)? >= i64_at(b, 186)?
                && u64_at(b, 315)? >= u64_at(b, 194)?,
            6506,
        )?;
    }
    let facts = RootFacts {
        schema,
        instance,
        m,
        catalog: b[96..128].try_into().map_err(|_| err(6506))?,
        validator: b[128..160].try_into().map_err(|_| err(6506))?,
        descriptor: desc,
        q,
        b: base,
        retired,
        scope: b[184],
        admission: b[185],
        owner: key_at(b, 202)?,
        revision: u64_at(b, 234)?,
        lifecycle,
        parent,
        consumed_m,
        created_at: i64_at(b, 186)?,
        created_slot: u64_at(b, 194)?,
        fingerprint: hashv(&[&d[..322], &d[443..]]).to_bytes(),
    };
    drop(d);
    header(
        a,
        &PROGRAM_ID,
        12,
        schema,
        a.data_len(),
        instance.as_array(),
        &[b"bio", b"root", instance.as_ref()],
    )?;
    require(
        a.lamports() >= Rent::get()?.minimum_balance(a.data_len()).max(1),
        6510,
    )?;
    Ok(facts)
}
pub(crate) fn leaf_capsule(a: &AccountInfo) -> Result<Vec<u8>, ProgramError> {
    let facts = read_root(a)?;
    require(facts.schema == 1, 6506)?;
    let d = a.try_borrow_data()?;
    let mut out = Vec::with_capacity(d.len() - 121);
    out.extend_from_slice(&d[..322]);
    out.extend_from_slice(&d[443..]);
    Ok(out)
}
pub(crate) fn write_leaf<'a>(
    a: &AccountInfo<'a>,
    payer: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    m: &[u8; 32],
    request: &[u8; 32],
    desc: &[u8; 4],
    dp: &[u8],
    actor: &Pubkey,
    clock: &Clock,
) -> ProgramResult {
    descriptor(desc)?;
    materials::assert_bom(&materials::decode_debits(dp)?)?;
    let id = instance_id(m);
    let len = 443usize.checked_add(dp.len()).ok_or(err(8020))?;
    allocate(payer, a, system, &PROGRAM_ID, len, &[b"bio", b"root", &id])?;
    let bump = valid_pda(a, &PROGRAM_ID, &[b"bio", b"root", &id])?;
    write_header(a, 12, 1, &id, bump)?;
    {
        let mut d = a.try_borrow_mut_data()?;
        let b = &mut d[120..];
        b[..32].copy_from_slice(&id);
        b[32..64].copy_from_slice(m);
        b[64..96].copy_from_slice(request);
        b[96..128].copy_from_slice(&materials::catalog_hash());
        b[128..160].copy_from_slice(&APPROVED_VALIDATOR_HASH);
        b[160..164].copy_from_slice(desc);
        b[164..168].copy_from_slice(&1_000_000u32.to_le_bytes());
        b[168..176].copy_from_slice(&120_000u64.to_le_bytes());
        b[176..184].copy_from_slice(&45_000u64.to_le_bytes());
        b[184] = 1;
        b[186..194].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        b[194..202].copy_from_slice(&clock.slot.to_le_bytes());
        b[202..234].copy_from_slice(actor.as_ref());
        b[323..].copy_from_slice(dp);
    }
    let facts = read_root(a)?;
    require(
        facts.owner == *actor && facts.revision == 0 && facts.lifecycle == 0,
        6512,
    )
}
pub(crate) fn consume(
    a: &AccountInfo,
    owner: &Pubkey,
    expected_revision: u64,
    parent: &[u8; 32],
    m: &[u8; 32],
    clock: &Clock,
) -> ProgramResult {
    writable(a)?;
    let before = read_root(a)?;
    require(
        before.owner == *owner
            && before.revision == expected_revision
            && before.lifecycle == 0
            && !zeros(parent)
            && !zeros(m)
            && clock.unix_timestamp >= before.created_at
            && clock.slot >= before.created_slot,
        6506,
    )?;
    let revision = expected_revision.checked_add(1).ok_or(err(8020))?;
    {
        let mut d = a.try_borrow_mut_data()?;
        let b = &mut d[120..];
        b[234..242].copy_from_slice(&revision.to_le_bytes());
        b[242] = 1;
        b[243..275].copy_from_slice(parent);
        b[275..307].copy_from_slice(m);
        b[307..315].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        b[315..323].copy_from_slice(&clock.slot.to_le_bytes());
    }
    require(read_root(a)?.fingerprint == before.fingerprint, 6512)
}

/// Trusted in-instruction optimization: the caller has just authenticated this
/// exact direct Root with read_root and retained its immutable fingerprint.
/// External callers cannot supply these facts. System/Token CPI cannot modify
/// program-owned Root bytes; mutable owner/revision/live are still actual CAS.
#[inline(never)]
pub(crate) fn consume_prechecked(
    a:&AccountInfo,before:&RootFacts,owner:&Pubkey,expected_revision:u64,
    parent:&[u8;32],m:&[u8;32],clock:&Clock,
)->ProgramResult{
    writable(a)?;
    require(a.owner==&PROGRAM_ID&&!a.executable&&a.data_len()>=447
        &&before.owner==*owner&&before.revision==expected_revision&&before.lifecycle==0
        &&!zeros(parent)&&!zeros(m)&&clock.unix_timestamp>=before.created_at&&clock.slot>=before.created_slot,6506)?;
    valid_pda(a,&PROGRAM_ID,&[b"bio",b"root",before.instance.as_ref()])?;
    let revision=expected_revision.checked_add(1).ok_or(err(8020))?;
    let mut d=a.try_borrow_mut_data()?;
    require(d[120..152]==before.instance.to_bytes()&&d[322..354]==owner.to_bytes()
        &&u64_at(&d,354)?==expected_revision&&d[362]==0&&zeros(&d[363..443]),6506)?;
    d[354..362].copy_from_slice(&revision.to_le_bytes());d[362]=1;
    d[363..395].copy_from_slice(parent);d[395..427].copy_from_slice(m);
    d[427..435].copy_from_slice(&clock.unix_timestamp.to_le_bytes());d[435..443].copy_from_slice(&clock.slot.to_le_bytes());
    require(hashv(&[&d[..322],&d[443..]]).to_bytes()==before.fingerprint,6512)
}
