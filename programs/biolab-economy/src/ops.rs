//! P3 native authorization and direct BIO-owned Ops SOL debit.
use super::*;
use launchpad::{ordinary_wallet, role, wallet_table};

fn expense_id(reference: &[u8; 32]) -> [u8; 32] {
    typed_hash(21, &[&domain(), reference])
}
fn member(key: &Pubkey) -> bool {
    OPS_MEMBERS.contains(key)
}
fn protected(accounts: &[AccountInfo], roles: &[Pubkey]) -> ProgramResult {
    let loader = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
    let data = Pubkey::find_program_address(&[PROGRAM_ID.as_ref()], &loader).0;
    let known = [
        PROGRAM_ID,
        loader,
        data,
        pda(&PROGRAM_ID, b"config").0,
        pda(&PROGRAM_ID, b"deploy").0,
        pda(&PROGRAM_ID, b"lab-mint").0,
        pda(&PROGRAM_ID, b"lab-reserve").0,
        pda(&PROGRAM_ID, b"lab-auth").0,
        pda(&PROGRAM_ID, b"treasury").0,
        pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    ];
    for key in roles {
        require(
            !known.contains(key) && !accounts[1..9].iter().any(|a| a.key == key),
            6411,
        )?;
    }
    Ok(())
}
fn rent_budget(a: &[AccountInfo], payer: &AccountInfo, rent: u64, cap: u64) -> ProgramResult {
    ordinary_wallet(payer, true)?;
    require(rent <= cap, 6408)?;
    require(payer.lamports() >= rent, 6409)?;
    require(a[1].is_writable, 8006)
}
pub(crate) fn rent_payer<'a, 'b>(
    a: &'a [AccountInfo<'b>],
    f: &Frame,
) -> Result<&'a AccountInfo<'b>, ProgramError> {
    let at = match f.opcode {
        6 => 128,
        7 => 163,
        _ => return Err(err(8000)),
    };
    role(a, &key_at(f.payload, at)?)
}
pub(crate) fn queue<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() >= 9 && f.payload.len() == 168, 8000)?;
    config(&a[2])?;
    let p = f.payload;
    require(member(&f.actor), 6401)?;
    let reference: [u8; 32] = p[..32].try_into().map_err(|_| err(8000))?;
    require(!zeros(&reference), 6402)?;
    let recipient_key = key_at(p, 40)?;
    let rent_key = key_at(p, 128)?;
    wallet_table(a, 9, &[recipient_key, rent_key])?;
    protected(a, &[f.actor, recipient_key, rent_key])?;
    let recipient = role(a, &recipient_key)?;
    ordinary_wallet(recipient, false)?;
    let payer = role(a, &rent_key)?;
    let vault = &a[7];
    let target = &a[8];
    writable(vault)?;
    writable(target)?;
    launchpad::ops(vault)?;
    valid_pda(target, &PROGRAM_ID, &[b"bio", b"expense", &reference])?;
    let amount = u64_at(p, 72)?;
    require(amount > 0, 6406)?;
    require(!zeros(&p[80..112]), 6403)?;
    let clock = Clock::get()?;
    let before = i64_at(p, 112)?;
    let expires = i64_at(p, 120)?;
    let last = clock.unix_timestamp.checked_add(604800).ok_or(err(8020))?;
    require(
        before >= 0 && expires > before && expires > clock.unix_timestamp && expires <= last,
        6407,
    )?;
    let expected = u64_at(p, 32)?;
    let next = {
        let d = vault.try_borrow_data()?;
        u64_at(&d, 120)?
    };
    require(expected == next, 6405)?;
    let successor = add(next, 1)?;
    let rent = add(need_rent(target, 409)?, nonce_rent(&a[1])?)?;
    rent_budget(a, payer, rent, u64_at(p, 160)?)?;
    let vault_balance = vault.lamports();
    allocate(
        payer,
        target,
        &a[4],
        &PROGRAM_ID,
        409,
        &[b"bio", b"expense", &reference],
    )?;
    let bump = valid_pda(target, &PROGRAM_ID, &[b"bio", b"expense", &reference])?;
    let id = expense_id(&reference);
    write_header(target, 23, 1, &id, bump)?;
    {
        let mut d = target.try_borrow_mut_data()?;
        let b = &mut d[120..];
        b[..32].copy_from_slice(&reference);
        b[32..40].copy_from_slice(&next.to_le_bytes());
        b[40..72].copy_from_slice(f.actor.as_ref());
        b[72..104].copy_from_slice(&business_key(f));
        b[104..136].copy_from_slice(recipient_key.as_ref());
        b[136..144].copy_from_slice(&amount.to_le_bytes());
        b[144..176].copy_from_slice(&p[80..112]);
        b[176..184].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        b[184..192].copy_from_slice(&clock.slot.to_le_bytes());
        b[192..200].copy_from_slice(&before.to_le_bytes());
        b[200..208].copy_from_slice(&expires.to_le_bytes());
    }
    {
        let mut d = vault.try_borrow_mut_data()?;
        d[120..128].copy_from_slice(&successor.to_le_bytes());
    }
    require(vault.lamports() == vault_balance, 8017)?;
    expense(target, &reference)?;
    let mut result = id.to_vec();
    result.extend_from_slice(&next.to_le_bytes());
    result.extend_from_slice(&rent.to_le_bytes());
    result.extend_from_slice(&successor.to_le_bytes());
    Ok(result)
}
struct Expense {
    nonce: u64,
    recipient: Pubkey,
    amount: u64,
    evidence: [u8; 32],
    queued_at: i64,
    queued_slot: u64,
    not_before: i64,
    expires: i64,
    status: u8,
}
fn expense(a: &AccountInfo, reference: &[u8; 32]) -> Result<Expense, ProgramError> {
    header(
        a,
        &PROGRAM_ID,
        23,
        1,
        409,
        &expense_id(reference),
        &[b"bio", b"expense", reference],
    )?;
    require(
        a.lamports() >= Rent::get()?.minimum_balance(409).max(1),
        6419,
    )?;
    let d = a.try_borrow_data()?;
    let b = &d[120..];
    let queued = i64_at(b, 176)?;
    let before = i64_at(b, 192)?;
    let expires = i64_at(b, 200)?;
    require(
        b[..32] == *reference
            && !zeros(reference)
            && member(&key_at(b, 40)?)
            && !zeros(&b[72..104])
            && !zeros(&b[144..176])
            && u64_at(b, 136)? > 0
            && queued >= 0
            && before >= 0
            && expires > queued
            && expires > before
            && expires <= queued.checked_add(604800).ok_or(err(8020))?,
        6419,
    )?;
    let status = b[208];
    require(status <= 1, 6419)?;
    if status == 0 {
        require(zeros(&b[209..289]), 6419)?;
    } else {
        let paid = i64_at(b, 273)?;
        require(
            !zeros(&b[209..241])
                && member(&key_at(b, 241)?)
                && paid >= queued
                && paid >= before
                && paid < expires
                && u64_at(b, 281)? >= u64_at(b, 184)?,
            6419,
        )?;
    }
    Ok(Expense {
        nonce: u64_at(b, 32)?,
        recipient: key_at(b, 104)?,
        amount: u64_at(b, 136)?,
        evidence: b[144..176].try_into().map_err(|_| err(6419))?,
        queued_at: queued,
        queued_slot: u64_at(b, 184)?,
        not_before: before,
        expires,
        status,
    })
}
pub(crate) fn pay<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() >= 9 && f.payload.len() == 203, 8000)?;
    config(&a[2])?;
    let p = f.payload;
    let reference: [u8; 32] = p[..32].try_into().map_err(|_| err(8000))?;
    require(!zeros(&reference), 6402)?;
    let recipient_key = key_at(p, 72)?;
    let rent_key = key_at(p, 163)?;
    let indices = &p[160..163];
    require(
        indices[0] < indices[1] && indices[1] < indices[2] && indices[2] < 5,
        6412,
    )?;
    let members = [
        OPS_MEMBERS[indices[0] as usize],
        OPS_MEMBERS[indices[1] as usize],
        OPS_MEMBERS[indices[2] as usize],
    ];
    require(members.contains(&f.actor), 6412)?;
    wallet_table(
        a,
        9,
        &[recipient_key, rent_key, members[0], members[1], members[2]],
    )?;
    protected(
        a,
        &[
            f.actor,
            recipient_key,
            rent_key,
            members[0],
            members[1],
            members[2],
        ],
    )?;
    for key in members {
        let actor = role(a, &key)?;
        require(actor.is_signer && actor.key.is_on_curve(), 8002)?;
    }
    let recipient = role(a, &recipient_key)?;
    ordinary_wallet(recipient, false)?;
    writable(recipient)?;
    let payer = role(a, &rent_key)?;
    let vault = &a[7];
    let target = &a[8];
    writable(vault)?;
    writable(target)?;
    launchpad::ops(vault)?;
    let expense = expense(target, &reference)?;
    require(
        p[32..64] == expense_id(&reference)
            && u64_at(p, 64)? == expense.nonce
            && recipient_key == expense.recipient
            && u64_at(p, 104)? == expense.amount
            && p[112..144] == expense.evidence
            && i64_at(p, 144)? == expense.not_before
            && i64_at(p, 152)? == expense.expires,
        6413,
    )?;
    let (next, paid_total) = {
        let d = vault.try_borrow_data()?;
        (u64_at(&d, 120)?, u64_at(&d, 128)?)
    };
    require(expense.nonce < next, 6405)?;
    require(expense.status == 0, 6414)?;
    let clock = Clock::get()?;
    require(
        clock.unix_timestamp >= expense.queued_at && clock.slot >= expense.queued_slot,
        6419,
    )?;
    require(clock.unix_timestamp >= expense.not_before, 6415)?;
    require(clock.unix_timestamp < expense.expires, 6416)?;
    let floor = Rent::get()?.minimum_balance(136).max(1);
    let vault_before = vault.lamports();
    require(expense.amount <= vault_before - floor, 6417)?;
    let next_paid = add(paid_total, expense.amount)?;
    let rent = nonce_rent(&a[1])?;
    rent_budget(a, payer, rent, u64_at(p, 195)?)?;
    let old_recipient = recipient.lamports();
    let after_rent = if payer.key == recipient.key {
        old_recipient.checked_sub(rent).ok_or(err(6409))?
    } else {
        old_recipient
    };
    let recipient_final = add(after_rent, expense.amount)?;
    require(
        recipient_final >= Rent::get()?.minimum_balance(0).max(1),
        6418,
    )?;
    // A recipient which also pays rent must spend its own entry funds before
    // receiving this expense. No transient overflow or future-credit funding.
    ensure_nonce_account(a, payer)?;
    let actual_before = recipient.lamports();
    require(actual_before == after_rent, 8017)?;
    **vault.try_borrow_mut_lamports()? = vault_before - expense.amount;
    **recipient.try_borrow_mut_lamports()? = recipient_final;
    {
        let mut d = vault.try_borrow_mut_data()?;
        d[128..136].copy_from_slice(&next_paid.to_le_bytes());
    }
    {
        let mut d = target.try_borrow_mut_data()?;
        let b = &mut d[120..];
        b[208] = 1;
        b[209..241].copy_from_slice(&business_key(f));
        b[241..273].copy_from_slice(f.actor.as_ref());
        b[273..281].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        b[281..289].copy_from_slice(&clock.slot.to_le_bytes());
    }
    require(
        vault.lamports() == vault_before - expense.amount
            && recipient.lamports() == recipient_final,
        8017,
    )?;
    expense_state_paid(target, &reference)?;
    let mut result = expense_id(&reference).to_vec();
    result.extend_from_slice(&expense.nonce.to_le_bytes());
    result.extend_from_slice(&expense.amount.to_le_bytes());
    result.extend_from_slice(&next_paid.to_le_bytes());
    result.extend_from_slice(&rent.to_le_bytes());
    Ok(result)
}
fn expense_state_paid(account: &AccountInfo, reference: &[u8; 32]) -> ProgramResult {
    require(expense(account, reference)?.status == 1, 8017)
}
