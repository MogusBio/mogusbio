//! Isolated fee-stage acceptance adapter; production manufacture must combine validation and output creation.
use super::*;

pub(crate) fn burn<'a>(accounts: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(
        accounts.len() == 11
            && f.payload.len() == 81
            && key_at(f.payload, 0)? == *accounts[8].key
            && key_at(f.payload, 41)? == f.actor,
        8000,
    )?;
    config(&accounts[2])?;
    let m = &accounts[7];
    let source = &accounts[8];
    let tr = &accounts[9];
    let reserve = &accounts[10];
    for a in [m, source, tr] {
        writable(a)?;
    }
    valid_pda(reserve, &PROGRAM_ID, &[b"bio", b"lab-reserve"])?;
    require(source.key != reserve.key, 8012)?;
    let amount = match f.payload[32] {
        1 => 800_000,
        2 => 4_000_000,
        3 => 12_000_000,
        _ => return Err(err(8000)),
    };
    require(amount <= u64_at(f.payload, 33)?, 8015)?;
    check_budget(accounts, nonce_rent(&accounts[1])?, u64_at(f.payload, 73)?)?;
    let supply = mint(m)?;
    let before = token(source, m.key, Some(accounts[0].key), false)?;
    let rb = token(reserve, m.key, Some(&pda(&PROGRAM_ID, b"lab-auth").0), true)?;
    let mut book = treasury(tr, rb.amount, supply)?;
    require(before.amount >= amount, 8018)?;
    let mut data = vec![15];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(6);
    token_cpi(
        &accounts[5],
        vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new(*m.key, false),
            AccountMeta::new_readonly(*accounts[0].key, true),
        ],
        data,
        &[source.clone(), m.clone(), accounts[0].clone()],
        None,
    )?;
    require(
        mint(m)? == supply - amount
            && token(source, m.key, Some(accounts[0].key), false)?.amount == before.amount - amount
            && token(reserve, m.key, Some(&rb.owner), true)?.amount == rb.amount,
        8017,
    )?;
    book[4] = add(book[4], amount)?;
    write_treasury(tr, book)?;
    treasury(tr, rb.amount, supply - amount)?;
    let mut result = source.key.to_bytes().to_vec();
    result.extend_from_slice(&amount.to_le_bytes());
    result.extend_from_slice(&book[4].to_le_bytes());
    Ok(result)
}
