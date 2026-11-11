//! Canonical account headers, rent authorization, System CPI, config and reserve accounting.
use super::*;

pub(crate) fn valid_pda(
    account: &AccountInfo,
    program: &Pubkey,
    seeds: &[&[u8]],
) -> Result<u8, ProgramError> {
    let (key, bump) = Pubkey::find_program_address(seeds, program);
    require(*account.key == key, 8004)?;
    Ok(bump)
}
pub(crate) fn header(
    account: &AccountInfo,
    program: &Pubkey,
    kind: u16,
    schema: u16,
    length: usize,
    key: &[u8; 32],
    seeds: &[&[u8]],
) -> ProgramResult {
    let bump = valid_pda(account, program, seeds)?;
    require(
        account.owner == program && !account.executable && account.data_len() == length,
        8005,
    )?;
    let d = account.try_borrow_data()?;
    require(
        &d[..8] == b"BIOLAB\0\0"
            && u16_at(&d, 8)? == 1
            && u16_at(&d, 10)? == kind
            && u16_at(&d, 12)? == schema
            && zeros(&d[14..16])
            && d[16..48] == domain()
            && d[48..80] == config_id()
            && u32_at(&d, 80)? as usize == length - HEADER
            && d[84] == bump
            && zeros(&d[85..88])
            && d[88..120] == *key,
        8005,
    )
}
pub(crate) fn write_header(
    account: &AccountInfo,
    kind: u16,
    schema: u16,
    key: &[u8; 32],
    bump: u8,
) -> ProgramResult {
    let length = account.data_len();
    let mut d = account.try_borrow_mut_data()?;
    d.fill(0);
    d[..8].copy_from_slice(b"BIOLAB\0\0");
    d[8..10].copy_from_slice(&1u16.to_le_bytes());
    d[10..12].copy_from_slice(&kind.to_le_bytes());
    d[12..14].copy_from_slice(&schema.to_le_bytes());
    d[16..48].copy_from_slice(&domain());
    d[48..80].copy_from_slice(&config_id());
    d[80..84].copy_from_slice(&((length - HEADER) as u32).to_le_bytes());
    d[84] = bump;
    d[88..120].copy_from_slice(key);
    Ok(())
}
pub(crate) fn writable(account: &AccountInfo) -> ProgramResult {
    require(account.is_writable, 8006)
}
pub(crate) fn wallet(account: &AccountInfo) -> ProgramResult {
    require(
        account.owner == &SYSTEM_ID
            && account.data_is_empty()
            && !account.executable
            && account.is_signer,
        8007,
    )
}
pub(crate) fn token_program(account: &AccountInfo) -> ProgramResult {
    require(*account.key == TOKEN_ID && account.executable, 8008)
}
pub(crate) fn system_program(account: &AccountInfo) -> ProgramResult {
    require(*account.key == SYSTEM_ID && account.executable, 8008)
}
pub(crate) fn need_rent(account: &AccountInfo, length: usize) -> Result<u64, ProgramError> {
    require(
        account.owner == &SYSTEM_ID && account.data_is_empty() && !account.executable,
        8009,
    )?;
    Ok(Rent::get()?
        .minimum_balance(length)
        .max(1)
        .saturating_sub(account.lamports()))
}
pub(crate) fn allocate<'a>(
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    owner: &Pubkey,
    length: usize,
    seeds: &[&[u8]],
) -> ProgramResult {
    writable(target)?;
    let bump = valid_pda(target, &PROGRAM_ID, seeds)?;
    let needed = need_rent(target, length)?;
    if needed > 0 {
        let mut data = 2u32.to_le_bytes().to_vec();
        data.extend_from_slice(&needed.to_le_bytes());
        invoke(
            &Instruction {
                program_id: SYSTEM_ID,
                accounts: vec![
                    AccountMeta::new(*payer.key, true),
                    AccountMeta::new(*target.key, false),
                ],
                data,
            },
            &[payer.clone(), target.clone(), system.clone()],
        )?;
    }
    let bump_bytes = [bump];
    let mut signed = seeds.to_vec();
    signed.push(&bump_bytes);
    let mut data = 8u32.to_le_bytes().to_vec();
    data.extend_from_slice(&(length as u64).to_le_bytes());
    invoke_signed(
        &Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![AccountMeta::new(*target.key, true)],
            data,
        },
        &[target.clone(), system.clone()],
        &[&signed],
    )?;
    let mut data = 1u32.to_le_bytes().to_vec();
    data.extend_from_slice(owner.as_ref());
    invoke_signed(
        &Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![AccountMeta::new(*target.key, true)],
            data,
        },
        &[target.clone(), system.clone()],
        &[&signed],
    )?;
    Ok(())
}

pub(crate) fn config(account: &AccountInfo) -> ProgramResult {
    header(
        account,
        &PROGRAM_ID,
        36,
        3,
        CONFIG_LEN,
        &config_id(),
        &[b"bio", b"econ-config"],
    )?;
    let d = account.try_borrow_data()?;
    let b = &d[120..];
    #[cfg(feature="acceptance-test")]
    let schedule_ok=i64_at(b,256)?==i64_at(b,184)?;
    #[cfg(feature="production-admission")]
    let schedule_ok=i64_at(b,184)?>=constants::INIT_NOT_BEFORE&&i64_at(b,184)?<=constants::SEED_OPEN&&i64_at(b,256)?==constants::SEED_OPEN&&i64_at(b,264)?==constants::REWARD_START;
    require(
        &b[..8] == b"ECOCFG03"
            && b[8..40] == RELEASE_HASH
            && b[40..72] == BOOTSTRAP.to_bytes()
            && b[72..104] == pda(&PROGRAM_ID, b"lab-mint").0.to_bytes()
            && b[104..136] == pda(&PROGRAM_ID, b"lab-reserve").0.to_bytes()
            && b[136..168] == pda(&PROGRAM_ID, b"lab-auth").0.to_bytes()
            && u64_at(b, 168)? == N
            && b[176] == 6
            && zeros(&b[177..184])
            && i64_at(b, 184)? >= 0
            && b[192..224] == APPROVED_VALIDATOR_HASH
            && b[224..256] == APPROVED_RULE_HASH
            && schedule_ok
            && i64_at(b,264)? == i64_at(b,256)?.checked_add(originality::PREWARM_SECONDS).ok_or(err(8020))?
            && b[272..304] == originality::initial_set_id(),
        8011,
    )
}
pub(crate) fn config_hashes(account: &AccountInfo) -> Result<([u8; 32], [u8; 32]), ProgramError> {
    config(account)?;
    Ok((APPROVED_VALIDATOR_HASH, APPROVED_RULE_HASH))
}
pub(crate) fn treasury(
    account: &AccountInfo,
    reserve: u64,
    supply: u64,
) -> Result<[u64; 8], ProgramError> {
    header(
        account,
        &PROGRAM_ID,
        6,
        1,
        TREASURY_LEN,
        &config_id(),
        &[b"bio", b"treasury"],
    )?;
    let d = account.try_borrow_data()?;
    let mut fields = [0; 8];
    for (i, v) in fields.iter_mut().enumerate() {
        *v = u64_at(&d, 120 + i * 8)?;
    }
    let sum = fields[..4].iter().try_fold(0u64, |sum, v| add(sum, *v))?;
    require(
        // A public SPL Token account can receive unsolicited transfers. Such
        // atoms stay implicitly sealed as Vinbound = reserve - book sum; they
        // must not block settlement or become a new reward budget.
        sum <= reserve
            && fields[4] <= N
            && supply <= N - fields[4]
            && reserve <= supply
            && fields[7] == 0,
        8014,
    )?;
    Ok(fields)
}
pub(crate) fn write_treasury(account: &AccountInfo, fields: [u64; 8]) -> ProgramResult {
    let mut d = account.try_borrow_mut_data()?;
    for (i, v) in fields.iter().enumerate() {
        d[120 + i * 8..128 + i * 8].copy_from_slice(&v.to_le_bytes());
    }
    Ok(())
}
pub(crate) fn check_budget(accounts: &[AccountInfo], rent: u64, cap: u64) -> ProgramResult {
    require(rent <= cap, 8015)?;
    wallet(&accounts[0])?;
    writable(&accounts[0])?;
    require(accounts[0].lamports() >= rent, 8016)
}
