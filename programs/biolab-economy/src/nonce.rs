//! Fixed actor nonce and latest-result retry; committed in the same native transaction as effects.
use super::*;

pub(crate) fn inspect_nonce(
    nonce: &AccountInfo,
    actor: &Pubkey,
    frame: &Frame,
) -> Result<bool, ProgramError> {
    valid_pda(
        nonce,
        &PROGRAM_ID,
        &[b"bio", b"actor-nonce", actor.as_ref()],
    )?;
    if nonce.owner == &SYSTEM_ID && nonce.data_is_empty() {
        require(frame.nonce == 0, 7001)?;
        return Ok(false);
    }
    header(
        nonce,
        &PROGRAM_ID,
        35,
        1,
        NONCE_LEN,
        actor.as_array(),
        &[b"bio", b"actor-nonce", actor.as_ref()],
    )?;
    let d = nonce.try_borrow_data()?;
    let next = u64_at(&d, 120)?;
    let size = u16_at(&d, 160)? as usize;
    require(size <= 256 && zeros(&d[162 + size..418]), 8005)?;
    if next == 0 {
        require(zeros(&d[128..160]) && size == 0, 8005)?;
    }
    if frame.nonce < next {
        require(frame.nonce.checked_add(1) == Some(next), 7000)?;
        require(d[128..160] == frame.digest, 6010)?;
        set_return_data(&d[162..162 + size]);
        return Ok(true);
    }
    require(frame.nonce == next, 7001)?;
    require(next < u64::MAX, 8020)?;
    Ok(false)
}
pub(crate) fn nonce_rent(nonce: &AccountInfo) -> Result<u64, ProgramError> {
    if nonce.owner == &SYSTEM_ID && nonce.data_is_empty() {
        need_rent(nonce, NONCE_LEN)
    } else {
        Ok(0)
    }
}
pub(crate) fn finish_nonce<'a>(
    accounts: &[AccountInfo<'a>],
    frame: &Frame,
    result: &[u8],
    payer: &AccountInfo<'a>,
) -> ProgramResult {
    require(result.len() <= 256, 8000)?;
    ensure_nonce_account(accounts, payer)?;
    let nonce = &accounts[1];
    let mut d = nonce.try_borrow_mut_data()?;
    d[120..128].copy_from_slice(&frame.nonce.checked_add(1).ok_or(err(8020))?.to_le_bytes());
    d[128..160].copy_from_slice(&frame.digest);
    d[160..162].copy_from_slice(&(result.len() as u16).to_le_bytes());
    d[162..418].fill(0);
    d[162..162 + result.len()].copy_from_slice(result);
    drop(d);
    set_return_data(result);
    Ok(())
}
pub(crate) fn ensure_nonce_account<'a>(
    accounts: &[AccountInfo<'a>],
    payer: &AccountInfo<'a>,
) -> ProgramResult {
    let actor = &accounts[0];
    let nonce = &accounts[1];
    writable(nonce)?;
    if nonce.owner == &SYSTEM_ID {
        allocate(
            payer,
            nonce,
            &accounts[4],
            &PROGRAM_ID,
            NONCE_LEN,
            &[b"bio", b"actor-nonce", actor.key.as_ref()],
        )?;
        let bump = valid_pda(
            nonce,
            &PROGRAM_ID,
            &[b"bio", b"actor-nonce", actor.key.as_ref()],
        )?;
        write_header(nonce, 35, 1, actor.key.as_array(), bump)?;
    }
    Ok(())
}
