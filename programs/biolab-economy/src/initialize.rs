//! Unique fixed-supply mint initialization, reserve creation and mint-authority revocation.
use super::*;

pub(crate) fn initialize<'a>(
    accounts: &[AccountInfo<'a>],
    f: &Frame,
) -> Result<Vec<u8>, ProgramError> {
    require(
        accounts.len() == if cfg!(feature="production-admission"){14}else{11}
            && f.payload.len() == 40
            && f.actor == BOOTSTRAP
            && key_at(f.payload, 0)? == f.actor,
        8010,
    )?;
    #[cfg(feature="production-admission")]
    admission::prepare_init(accounts)?;
    let actor = &accounts[0];
    let cfg = &accounts[2];
    let m = &accounts[7];
    let reserve = &accounts[8];
    let authority = &accounts[9];
    let tr = &accounts[10];
    for (a, name) in [
        (cfg, b"econ-config".as_slice()),
        (m, b"lab-mint"),
        (reserve, b"lab-reserve"),
        (authority, b"lab-auth"),
        (tr, b"treasury"),
    ] {
        valid_pda(a, &PROGRAM_ID, &[b"bio", name])?;
    }
    for a in [cfg, m, reserve, tr] {
        writable(a)?;
    }
    let mut rent = nonce_rent(&accounts[1])?;
    for (a, len) in [
        (cfg, CONFIG_LEN),
        (m, 82),
        (reserve, 165),
        (tr, TREASURY_LEN),
    ] {
        rent = add(rent, need_rent(a, len)?)?;
    }
    #[cfg(feature="production-admission")]
    {rent=add(rent,need_rent(&accounts[11],1048)?)?;}
    check_budget(accounts, rent, u64_at(f.payload, 32)?)?;
    for (a, name, len, owner) in [
        (cfg, b"econ-config".as_slice(), CONFIG_LEN, PROGRAM_ID),
        (m, b"lab-mint", 82, TOKEN_ID),
        (reserve, b"lab-reserve", 165, TOKEN_ID),
        (tr, b"treasury", TREASURY_LEN, PROGRAM_ID),
    ] {
        allocate(actor, a, &accounts[4], &owner, len, &[b"bio", name])?;
    }
    let mut data = vec![20, 6];
    data.extend_from_slice(authority.key.as_ref());
    data.push(0);
    token_cpi(
        &accounts[5],
        vec![AccountMeta::new(*m.key, false)],
        data,
        &[m.clone()],
        None,
    )?;
    let mut data = vec![18];
    data.extend_from_slice(authority.key.as_ref());
    token_cpi(
        &accounts[5],
        vec![
            AccountMeta::new(*reserve.key, false),
            AccountMeta::new_readonly(*m.key, false),
        ],
        data,
        &[reserve.clone(), m.clone()],
        None,
    )?;
    let bump = valid_pda(authority, &PROGRAM_ID, &[b"bio", b"lab-auth"])?;
    let bump_b = [bump];
    let auth_seeds = [b"bio".as_slice(), b"lab-auth", &bump_b];
    let mut data = vec![14];
    data.extend_from_slice(&N.to_le_bytes());
    data.push(6);
    token_cpi(
        &accounts[5],
        vec![
            AccountMeta::new(*m.key, false),
            AccountMeta::new(*reserve.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
        &[m.clone(), reserve.clone(), authority.clone()],
        Some(&auth_seeds),
    )?;
    token_cpi(
        &accounts[5],
        vec![
            AccountMeta::new(*m.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        vec![6, 0, 0],
        &[m.clone(), authority.clone()],
        Some(&auth_seeds),
    )?;
    let bump = valid_pda(cfg, &PROGRAM_ID, &[b"bio", b"econ-config"])?;
    write_header(cfg, 36, 3, &config_id(), bump)?;
    {
        let mut d = cfg.try_borrow_mut_data()?;
        let b = &mut d[120..];
        b[..8].copy_from_slice(b"ECOCFG03");
        b[8..40].copy_from_slice(&RELEASE_HASH);
        b[40..72].copy_from_slice(BOOTSTRAP.as_ref());
        b[72..104].copy_from_slice(m.key.as_ref());
        b[104..136].copy_from_slice(reserve.key.as_ref());
        b[136..168].copy_from_slice(authority.key.as_ref());
        b[168..176].copy_from_slice(&N.to_le_bytes());
        b[176] = 6;
        b[184..192].copy_from_slice(&Clock::get()?.unix_timestamp.to_le_bytes());
        b[192..224].copy_from_slice(&APPROVED_VALIDATOR_HASH);
        b[224..256].copy_from_slice(&APPROVED_RULE_HASH);
        #[cfg(feature="acceptance-test")]
        let seed_open=Clock::get()?.unix_timestamp;
        #[cfg(feature="production-admission")]
        let seed_open=constants::SEED_OPEN;
        let reward=seed_open.checked_add(originality::PREWARM_SECONDS).ok_or(err(8020))?;
        b[256..264].copy_from_slice(&seed_open.to_le_bytes());
        b[264..272].copy_from_slice(&reward.to_le_bytes());
        b[272..304].copy_from_slice(&originality::initial_set_id());
    }
    let bump = valid_pda(tr, &PROGRAM_ID, &[b"bio", b"treasury"])?;
    write_header(tr, 6, 1, &config_id(), bump)?;
    write_treasury(tr, [N - 17, 0, 0, 17, 0, 0, 0, 0])?;
    require(
        mint(m)? == N && token(reserve, m.key, Some(authority.key), true)?.amount == N,
        8017,
    )?;
    treasury(tr, N, N)?;
    #[cfg(feature="production-admission")]
    admission::initialize_base(accounts)?;
    config(cfg)?;
    let mut result = m.key.to_bytes().to_vec();
    result.extend_from_slice(reserve.key.as_ref());
    result.extend_from_slice(&N.to_le_bytes());
    Ok(result)
}
