//! Validated existing Position claim and real reserve transfer; no reward accrual creation instruction.
use super::*;

pub(crate) fn position(
    account: &AccountInfo,
    id: &[u8; 32],
) -> Result<(Pubkey, u64, u64), ProgramError> {
    require(account.data_len() == 375, 8019)?;
    let d = account.try_borrow_data()?;
    let b = &d[120..];
    let instance = key_at(b, 0)?;
    let seq = u64_at(b, 32)?;
    let derived = typed_hash(
        14,
        &[
            &domain(),
            &27u16.to_le_bytes(),
            instance.as_ref(),
            &seq.to_le_bytes(),
        ],
    );
    require(*id == derived, 8019)?;
    drop(d);
    header(
        account,
        &PROGRAM_ID,
        27,
        2,
        375,
        id,
        &[b"bio", b"reg", instance.as_ref(), &seq.to_le_bytes()],
    )?;
    let d = account.try_borrow_data()?;
    let b = &d[120..];
    let q = u32_at(b, 128)?;
    let l = b[132];
    let weight = u128_at(b, 133)?;
    require(
        (500000..=2000000).contains(&q)
            && q % 1000 == 0
            && [4, 6, 10, 12].contains(&l)
            && (1..=2_400_000_000_000).contains(&u64_at(b, 120)?),
        8019,
    )?;
    let expected = (u64_at(b, 120)? as u128)
        .checked_mul((900000 + q / 10) as u128)
        .and_then(|v| v.checked_mul(l as u128))
        .ok_or(err(8020))?;
    require(expected == weight, 8019)?;
    let start = u64_at(b, 149)?;
    let end_tag = b[157];
    let end = u64_at(b, 158)?;
    let reason = b[166];
    let created = i64_at(b, 199)?;
    let ended = i64_at(b, 215)?;
    let next = u64_at(b, 247)?;
    require(
        start < H_END
            && created >= 0
            && end_tag <= 1
            && next >= start
            && next <= if end_tag == 0 { H_END } else { end.min(H_END) },
        8019,
    )?;
    if end_tag == 0 {
        require(
            end == 0 && reason == 0 && zeros(&b[167..199]) && ended == 0 && u64_at(b, 223)? == 0,
            8019,
        )?;
    } else {
        require(
            end >= start
                && [1, 2].contains(&reason)
                && (end > start || reason == 2)
                && ended >= created,
            8019,
        )?;
    }
    let accrued = u64_at(b, 231)?;
    let paid = u64_at(b, 239)?;
    require(paid <= accrued && accrued <= N, 8019)?;
    Ok((key_at(b, 80)?, accrued, paid))
}
pub(crate) fn claim<'a>(accounts: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(
        accounts.len() == 13 && f.payload.len() == 120 && key_at(f.payload, 80)? == f.actor,
        8000,
    )?;
    config(&accounts[2])?;
    let m = &accounts[7];
    let reserve = &accounts[8];
    let auth = &accounts[9];
    let tr = &accounts[10];
    let pos = &accounts[11];
    let dest = &accounts[12];
    for a in [reserve, tr, pos, dest] {
        writable(a)?;
    }
    valid_pda(reserve, &PROGRAM_ID, &[b"bio", b"lab-reserve"])?;
    let bump = valid_pda(auth, &PROGRAM_ID, &[b"bio", b"lab-auth"])?;
    require(
        dest.key != reserve.key && key_at(f.payload, 48)? == *dest.key,
        8012,
    )?;
    let id: [u8; 32] = f.payload[..32].try_into().map_err(|_| err(8000))?;
    let (beneficiary, accrued, paid) = position(pos, &id)?;
    let expected = u64_at(f.payload, 32)?;
    let upto = u64_at(f.payload, 40)?;
    require(expected == paid && upto >= paid && upto <= accrued, 8021)?;
    let amount = upto - paid;
    check_budget(accounts, nonce_rent(&accounts[1])?, u64_at(f.payload, 112)?)?;
    let supply = mint(m)?;
    let rb = token(reserve, m.key, Some(auth.key), true)?;
    let db = token(dest, m.key, Some(&beneficiary), false)?;
    let mut book = treasury(tr, rb.amount, supply)?;
    require(book[2] >= amount && rb.amount >= amount, 8014)?;
    add(db.amount, amount)?;
    if amount > 0 {
        let bump_b = [bump];
        let seeds = [b"bio".as_slice(), b"lab-auth", &bump_b];
        let mut data = vec![12];
        data.extend_from_slice(&amount.to_le_bytes());
        data.push(6);
        token_cpi(
            &accounts[5],
            vec![
                AccountMeta::new(*reserve.key, false),
                AccountMeta::new_readonly(*m.key, false),
                AccountMeta::new(*dest.key, false),
                AccountMeta::new_readonly(*auth.key, true),
            ],
            data,
            &[reserve.clone(), m.clone(), dest.clone(), auth.clone()],
            Some(&seeds),
        )?;
    }
    require(
        mint(m)? == supply
            && token(reserve, m.key, Some(auth.key), true)?.amount == rb.amount - amount
            && token(dest, m.key, Some(&beneficiary), false)?.amount == db.amount + amount,
        8017,
    )?;
    book[2] -= amount;
    book[6] = add(book[6], amount)?;
    write_treasury(tr, book)?;
    {
        let mut d = pos.try_borrow_mut_data()?;
        d[HEADER + 239..HEADER + 247].copy_from_slice(&upto.to_le_bytes());
    }
    treasury(tr, rb.amount - amount, supply)?;
    let mut result = id.to_vec();
    result.extend_from_slice(beneficiary.as_ref());
    result.extend_from_slice(&amount.to_le_bytes());
    result.extend_from_slice(&upto.to_le_bytes());
    result.extend_from_slice(&accrued.to_le_bytes());
    Ok(result)
}
