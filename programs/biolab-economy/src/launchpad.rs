//! Native P2 acceptance layer. No public Source/intake/unpack operation exists.
use super::*;

const ATA_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
#[cfg(feature="acceptance-test")]
const T_OPEN: i64 = 0;
#[cfg(feature="production-admission")]
const T_OPEN: i64 = constants::SEED_OPEN;
const CREATE_FEE: u64 = 10_000_000;
const RESOURCE_FEE: u64 = 100_000;
const CAPS: [u64; 4] = [50_000, 100_000, 25_000, 25_000];

fn mul(a: u64, b: u64) -> Result<u64, ProgramError> {
    a.checked_mul(b).ok_or(err(8020))
}
fn catalog() -> [u8; 32] {
    let mut b = b"BIOCAT\0\0".to_vec();
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&1000u32.to_le_bytes());
    b.push(4);
    for (class, credit, first, last) in [
        (1u8, 6u16, 1u16, 20u16),
        (2, 15, 21, 28),
        (3, 40, 29, 31),
        (4, 120, 32, 32),
    ] {
        b.push(class);
        b.extend_from_slice(&credit.to_le_bytes());
        b.push((last - first + 1) as u8);
        for species in first..=last {
            b.extend_from_slice(&species.to_le_bytes());
        }
    }
    typed_hash(19, &[&b])
}
fn project_id(f: &Frame) -> [u8; 32] {
    typed_hash(17, &[&domain(), &business_key(f)])
}
fn season(now: i64) -> Result<u16, ProgramError> {
    let end = T_OPEN.checked_add(788_400_000).ok_or(err(8020))?;
    require(now >= T_OPEN && now < end, 6311)?;
    let delta = now - T_OPEN;
    let r = delta % 31_536_000;
    let quarter = if r < 7_862_400 {
        0
    } else if r < 15_724_800 {
        1
    } else if r < 23_587_200 {
        2
    } else {
        3
    };
    Ok((delta / 31_536_000 * 4 + quarter) as u16)
}
pub(crate) fn ordinary_wallet(a: &AccountInfo, signer: bool) -> ProgramResult {
    require(
        a.owner == &SYSTEM_ID && a.data_is_empty() && !a.executable,
        6306,
    )?;
    if signer {
        require(a.is_signer && a.key.is_on_curve(), 8002)?;
        writable(a)?;
    }
    Ok(())
}
pub(crate) fn role<'a, 'b>(
    accounts: &'a [AccountInfo<'b>],
    key: &Pubkey,
) -> Result<&'a AccountInfo<'b>, ProgramError> {
    accounts.iter().find(|a| a.key == key).ok_or(err(8004))
}
pub(crate) fn wallet_table(
    accounts: &[AccountInfo],
    base: usize,
    roles: &[Pubkey],
) -> ProgramResult {
    let mut keys = roles.to_vec();
    keys.sort_unstable();
    keys.dedup();
    keys.retain(|k| k != accounts[0].key);
    require(accounts.len() == base + keys.len(), 8004)?;
    for (a, k) in accounts[base..].iter().zip(&keys) {
        require(a.key == k, 8004)?;
    }
    Ok(())
}
fn protected_roles(accounts: &[AccountInfo], base: usize, roles: &[Pubkey]) -> ProgramResult {
    // The fixed table contains all operation-local state, authorities, programs
    // and sysvars, including initially empty canonical authority addresses.
    for key in roles {
        require(!accounts[1..base].iter().any(|a| a.key == key), 8004)?;
    }
    Ok(())
}
fn gross(
    payer: &AccountInfo,
    rent_payer: &AccountInfo,
    principal: u64,
    rent: u64,
) -> ProgramResult {
    ordinary_wallet(payer, true)?;
    ordinary_wallet(rent_payer, true)?;
    let total = if payer.key == rent_payer.key {
        add(principal, rent)?
    } else {
        principal
    };
    require(
        payer.lamports() >= total && rent_payer.lamports() >= rent,
        6310,
    )
}
fn transfer<'a>(
    payer: &AccountInfo<'a>,
    dest: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    amount: u64,
) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    writable(dest)?;
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    invoke(
        &Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![
                AccountMeta::new(*payer.key, true),
                AccountMeta::new(*dest.key, false),
            ],
            data,
        },
        &[payer.clone(), dest.clone(), system.clone()],
    )
}
pub(crate) fn ops(account: &AccountInfo) -> ProgramResult {
    header(
        account,
        &PROGRAM_ID,
        7,
        1,
        136,
        &config_id(),
        &[b"bio", b"ops"],
    )?;
    require(
        account.lamports() >= Rent::get()?.minimum_balance(136).max(1),
        6400,
    )
}
pub(crate) fn pack_address(id: &[u8; 32], class: u8, name: &[u8]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"bio", name, id, &[class]], &PROGRAM_ID)
}
pub(crate) fn pack_mint(a: &AccountInfo, id: &[u8; 32], class: u8) -> Result<u64, ProgramError> {
    require(
        *a.key == pack_address(id, class, b"pack").0
            && a.owner == &TOKEN_ID
            && !a.executable
            && a.data_len() == 82,
        6302,
    )?;
    let d = a.try_borrow_data()?;
    require(
        u32_at(&d, 0)? == 1
            && key_at(&d, 4)? == pack_address(id, class, b"pack-auth").0
            && d[44] == 0
            && d[45] == 1
            && u32_at(&d, 46)? == 0,
        6302,
    )?;
    require(
        a.lamports() >= Rent::get()?.minimum_balance(82).max(1),
        6320,
    )?;
    u64_at(&d, 36)
}
#[derive(Clone, Copy)]
pub(crate) struct Class {
    pub(crate) cap: u64,
    pub(crate) price: u64,
    pub(crate) issued: u64,
    pub(crate) burned: u64,
}
pub(crate) struct Project {
    pub(crate) seller: Pubkey,
    pub(crate) classes: [Class; 4],
    pub(crate) classes_offset: usize,
}
pub(crate) fn project(a: &AccountInfo, id: &[u8; 32]) -> Result<Project, ProgramError> {
    require((529..=592).contains(&a.data_len()), 6302)?;
    header(
        a,
        &PROGRAM_ID,
        9,
        1,
        a.data_len(),
        id,
        &[b"bio", b"project", id],
    )?;
    let d = a.try_borrow_data()?;
    let b = &d[120..];
    let name_len = u32_at(b, 144)? as usize;
    require(
        (1..=64).contains(&name_len)
            && b.len() == 408 + name_len
            && b[64..96] == catalog()
            && i64_at(b, 128)? >= 0,
        6302,
    )?;
    let name = std::str::from_utf8(&b[148..148 + name_len]).map_err(|_| err(6302))?;
    require(!name.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}'), 6302)?;
    let created: [u8; 32] = b[32..64].try_into().map_err(|_| err(6302))?;
    require(typed_hash(17, &[&domain(), &created]) == *id, 6302)?;
    let empty = Class {
        cap: 0,
        price: 0,
        issued: 0,
        burned: 0,
    };
    let mut classes = [empty; 4];
    let offset = 148 + name_len;
    for (i, c) in classes.iter_mut().enumerate() {
        let at = offset + 65 * i;
        let class = (i + 1) as u8;
        require(
            b[at] == class && key_at(b, at + 1)? == pack_address(id, class, b"pack").0,
            6302,
        )?;
        *c = Class {
            cap: u64_at(b, at + 33)?,
            price: u64_at(b, at + 41)?,
            issued: u64_at(b, at + 49)?,
            burned: u64_at(b, at + 57)?,
        };
        require(
            (1..=1_000_000).contains(&c.cap)
                && c.price <= u64::MAX - RESOURCE_FEE
                && c.burned <= c.issued
                && c.issued <= c.cap,
            6302,
        )?;
    }
    require(
        a.lamports() >= Rent::get()?.minimum_balance(a.data_len()).max(1),
        6320,
    )?;
    Ok(Project {
        seller: key_at(b, 96)?,
        classes,
        classes_offset: offset,
    })
}

pub(crate) fn create<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    config(&a[2])?;
    season(Clock::get()?.unix_timestamp)?;
    require((217..=280).contains(&f.payload.len()), 8000)?;
    let p = f.payload;
    require(p[..32] == catalog(), 6201)?;
    let seller_key = key_at(p, 32)?;
    let payer_key = key_at(p, 64)?;
    let rent_key = key_at(p, 96)?;
    let name_len = u32_at(p, 144)? as usize;
    require(
        (1..=64).contains(&name_len) && p.len() == 216 + name_len,
        6201,
    )?;
    let name = std::str::from_utf8(&p[148..148 + name_len]).map_err(|_| err(6202))?;
    require(!name.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}'), 6202)?;
    require(a.len() >= 17, 8000)?;
    wallet_table(a, 17, &[seller_key, payer_key, rent_key])?;
    protected_roles(a, 17, &[f.actor, seller_key, payer_key, rent_key])?;
    let seller = role(a, &seller_key)?;
    let payer = role(a, &payer_key)?;
    let rent_payer = role(a, &rent_key)?;
    ordinary_wallet(seller, false)?;
    let id = project_id(f);
    let target = &a[7];
    let vault = &a[16];
    writable(vault)?;
    valid_pda(target, &PROGRAM_ID, &[b"bio", b"project", &id])?;
    valid_pda(vault, &PROGRAM_ID, &[b"bio", b"ops"])?;
    require(CREATE_FEE <= u64_at(p, 128)?, 6207)?;
    let mut rent = add(need_rent(target, 528 + name_len)?, nonce_rent(&a[1])?)?;
    let new_ops = vault.owner == &SYSTEM_ID && vault.data_is_empty();
    if new_ops {
        rent = add(rent, need_rent(vault, 136)?)?;
    } else {
        ops(vault)?;
    }
    for i in 0..4 {
        let at = 148 + name_len + 17 * i;
        let class = (i + 1) as u8;
        require(
            p[at] == class
                && (1..=1_000_000).contains(&u64_at(p, at + 1)?)
                && u64_at(p, at + 9)? <= u64::MAX - RESOURCE_FEE,
            6201,
        )?;
        valid_pda(&a[8 + i], &PROGRAM_ID, &[b"bio", b"pack", &id, &[class]])?;
        valid_pda(
            &a[12 + i],
            &PROGRAM_ID,
            &[b"bio", b"pack-auth", &id, &[class]],
        )?;
        rent = add(rent, need_rent(&a[8 + i], 82)?)?;
    }
    require(rent <= u64_at(p, 136)?, 6208)?;
    gross(payer, rent_payer, CREATE_FEE, rent)?;
    allocate(
        rent_payer,
        target,
        &a[4],
        &PROGRAM_ID,
        528 + name_len,
        &[b"bio", b"project", &id],
    )?;
    if new_ops {
        allocate(
            rent_payer,
            vault,
            &a[4],
            &PROGRAM_ID,
            136,
            &[b"bio", b"ops"],
        )?;
        let bump = valid_pda(vault, &PROGRAM_ID, &[b"bio", b"ops"])?;
        write_header(vault, 7, 1, &config_id(), bump)?;
    }
    for i in 0..4 {
        let class = (i + 1) as u8;
        let m = &a[8 + i];
        let auth = &a[12 + i];
        allocate(
            rent_payer,
            m,
            &a[4],
            &TOKEN_ID,
            82,
            &[b"bio", b"pack", &id, &[class]],
        )?;
        let mut data = vec![20, 0];
        data.extend_from_slice(auth.key.as_ref());
        data.push(0);
        token_cpi(
            &a[5],
            vec![AccountMeta::new(*m.key, false)],
            data,
            &[m.clone()],
            None,
        )?;
        require(pack_mint(m, &id, class)? == 0, 8017)?;
    }
    transfer(payer, vault, &a[4], CREATE_FEE)?;
    let bump = valid_pda(target, &PROGRAM_ID, &[b"bio", b"project", &id])?;
    write_header(target, 9, 1, &id, bump)?;
    {
        let mut d = target.try_borrow_mut_data()?;
        let b = &mut d[120..];
        b[..32].copy_from_slice(f.actor.as_ref());
        b[32..64].copy_from_slice(&business_key(f));
        b[64..96].copy_from_slice(&catalog());
        b[96..128].copy_from_slice(seller_key.as_ref());
        let clock = Clock::get()?;
        b[128..136].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        b[136..144].copy_from_slice(&clock.slot.to_le_bytes());
        b[144..148].copy_from_slice(&(name_len as u32).to_le_bytes());
        b[148..148 + name_len].copy_from_slice(name.as_bytes());
        for i in 0..4 {
            let from = 148 + name_len + 17 * i;
            let at = 148 + name_len + 65 * i;
            b[at] = p[from];
            b[at + 1..at + 33].copy_from_slice(a[8 + i].key.as_ref());
            b[at + 33..at + 41].copy_from_slice(&p[from + 1..from + 9]);
            b[at + 41..at + 49].copy_from_slice(&p[from + 9..from + 17]);
        }
    }
    project(target, &id)?;
    ops(vault)?;
    let mut result = id.to_vec();
    result.extend_from_slice(target.key.as_ref());
    for m in &a[8..12] {
        result.extend_from_slice(m.key.as_ref());
    }
    result.extend_from_slice(&CREATE_FEE.to_le_bytes());
    result.extend_from_slice(&rent.to_le_bytes());
    Ok(result)
}

fn quota_key(scope: u8, class: u8, s: u16) -> [u8; 32] {
    typed_hash(20, &[&domain(), &[scope, class], &s.to_le_bytes()])
}
fn quota(a: &AccountInfo, class: u8, s: u16, lifetime: bool) -> Result<(u64, bool), ProgramError> {
    let cb = [class];
    let sb = s.to_le_bytes();
    let seeds: Vec<&[u8]> = if lifetime {
        vec![b"bio", b"issued", &cb]
    } else {
        vec![b"bio", b"season", &cb, &sb]
    };
    valid_pda(a, &PROGRAM_ID, &seeds)?;
    writable(a)?;
    if a.owner == &SYSTEM_ID && a.data_is_empty() {
        need_rent(a, if lifetime { 129 } else { 131 })?;
        return Ok((0, true));
    }
    header(
        a,
        &PROGRAM_ID,
        if lifetime { 22 } else { 21 },
        1,
        if lifetime { 129 } else { 131 },
        &quota_key(
            if lifetime { 2 } else { 1 },
            class,
            if lifetime { 65535 } else { s },
        ),
        &seeds,
    )?;
    let d = a.try_borrow_data()?;
    require(d[120] == class, 6313)?;
    if !lifetime {
        require(u16_at(&d, 121)? == s, 6313)?;
    }
    let n = u64_at(&d, if lifetime { 121 } else { 123 })?;
    require(
        n <= CAPS[class as usize - 1] * if lifetime { 100 } else { 1 },
        6313,
    )?;
    require(
        a.lamports() >= Rent::get()?.minimum_balance(a.data_len()).max(1),
        6320,
    )?;
    Ok((n, false))
}
fn write_quota<'a>(
    a: &AccountInfo<'a>,
    payer: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    class: u8,
    s: u16,
    lifetime: bool,
    new: bool,
    n: u64,
) -> ProgramResult {
    let cb = [class];
    let sb = s.to_le_bytes();
    let seeds: Vec<&[u8]> = if lifetime {
        vec![b"bio", b"issued", &cb]
    } else {
        vec![b"bio", b"season", &cb, &sb]
    };
    if new {
        allocate(
            payer,
            a,
            system,
            &PROGRAM_ID,
            if lifetime { 129 } else { 131 },
            &seeds,
        )?;
        let bump = valid_pda(a, &PROGRAM_ID, &seeds)?;
        write_header(
            a,
            if lifetime { 22 } else { 21 },
            1,
            &quota_key(
                if lifetime { 2 } else { 1 },
                class,
                if lifetime { 65535 } else { s },
            ),
            bump,
        )?;
    }
    let mut d = a.try_borrow_mut_data()?;
    d[120] = class;
    if !lifetime {
        d[121..123].copy_from_slice(&s.to_le_bytes());
    }
    let at = if lifetime { 121 } else { 123 };
    d[at..at + 8].copy_from_slice(&n.to_le_bytes());
    Ok(())
}
pub(crate) fn buy<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() >= 15 && f.payload.len() == 300, 8000)?;
    config(&a[2])?;
    let p = f.payload;
    let id: [u8; 32] = p[..32].try_into().map_err(|_| err(8000))?;
    let class = p[32];
    require((1..=4).contains(&class), 6300)?;
    let quantity = u64_at(p, 97)?;
    require((1..=1000).contains(&quantity), 6301)?;
    let payer_key = key_at(p, 105)?;
    let recipient_key = key_at(p, 137)?;
    let dest_key = key_at(p, 169)?;
    let mode = p[201];
    let seller_key = key_at(p, 202)?;
    let rent_key = key_at(p, 258)?;
    wallet_table(a, 15, &[payer_key, recipient_key, seller_key, rent_key])?;
    protected_roles(
        a,
        15,
        &[f.actor, payer_key, recipient_key, seller_key, rent_key],
    )?;
    let payer = role(a, &payer_key)?;
    let rent_payer = role(a, &rent_key)?;
    let seller = role(a, &seller_key)?;
    let recipient = role(a, &recipient_key)?;
    ordinary_wallet(seller, false)?;
    let target = &a[7];
    writable(target)?;
    let project = project(target, &id)?;
    let c = project.classes[class as usize - 1];
    require(
        project.seller == seller_key && key_at(p, 33)? == *a[8].key && p[65..97] == catalog(),
        6302,
    )?;
    let price = u64_at(p, 234)?;
    require(price == c.price && u64_at(p, 242)? == RESOURCE_FEE, 6303)?;
    let sale = mul(quantity, price)?;
    let resource = mul(quantity, RESOURCE_FEE)?;
    let total = add(sale, resource)?;
    require(total <= u64_at(p, 250)?, 6308)?;
    let current = season(Clock::get()?.unix_timestamp)?;
    require(current == u16_at(p, 298)?, 6312)?;
    let mint = &a[8];
    writable(mint)?;
    let supply = pack_mint(mint, &id, class)?;
    require(supply <= c.issued - c.burned, 6317)?;
    let auth = &a[9];
    let bump = valid_pda(auth, &PROGRAM_ID, &[b"bio", b"pack-auth", &id, &[class]])?;
    let (gs, new_s) = quota(&a[10], class, current, false)?;
    let (gl, new_l) = quota(&a[11], class, current, true)?;
    require(
        gl >= gs && gl >= c.issued && (!new_l || gs == 0 && c.issued == 0),
        6313,
    )?;
    let next_s = add(gs, quantity)?;
    let next_l = add(gl, quantity)?;
    let next_i = add(c.issued, quantity)?;
    require(next_s <= CAPS[class as usize - 1], 6314)?;
    require(next_l <= CAPS[class as usize - 1] * 100, 6315)?;
    require(next_i <= c.cap, 6316)?;
    let vault = &a[12];
    writable(vault)?;
    ops(vault)?;
    let dest = &a[13];
    writable(dest)?;
    require(*dest.key == dest_key && mode <= 1, 6305)?;
    require(*a[14].key == ATA_ID && a[14].executable, 8008)?;
    if mode == 1 {
        require(
            Pubkey::find_program_address(
                &[recipient_key.as_ref(), TOKEN_ID.as_ref(), mint.key.as_ref()],
                &ATA_ID,
            )
            .0 == dest_key,
            6305,
        )?;
    }
    let new_dest = dest.owner == &SYSTEM_ID && dest.data_is_empty();
    require(!new_dest || mode == 1, 6305)?;
    let before = if new_dest {
        need_rent(dest, 165)?;
        0
    } else {
        require(
            dest.lamports() >= Rent::get()?.minimum_balance(165).max(1),
            6320,
        )?;
        token(dest, mint.key, Some(&recipient_key), false)?.amount
    };
    let next_balance = add(before, quantity)?;
    let next_supply = add(supply, quantity)?;
    let mut rent = nonce_rent(&a[1])?;
    for (account, len, new) in [
        (&a[10], 131, new_s),
        (&a[11], 129, new_l),
        (dest, 165, new_dest),
    ] {
        if new {
            rent = add(rent, need_rent(account, len)?)?;
        }
    }
    require(rent <= u64_at(p, 290)?, 6309)?;
    gross(payer, rent_payer, total, rent)?;
    let seller_post = if payer.key == seller.key {
        seller.lamports().checked_sub(resource).ok_or(err(6310))?
    } else {
        add(seller.lamports(), sale)?
    };
    let seller_post = if rent_payer.key == seller.key {
        seller_post.checked_sub(rent).ok_or(err(6310))?
    } else {
        seller_post
    };
    require(seller_post >= Rent::get()?.minimum_balance(0).max(1), 6418)?;
    // All obligations were checked at entry; incoming sale proceeds never finance rent or principal.
    transfer(payer, seller, &a[4], sale)?;
    transfer(payer, vault, &a[4], resource)?;
    if new_dest {
        invoke(
            &Instruction {
                program_id: ATA_ID,
                accounts: vec![
                    AccountMeta::new(*rent_payer.key, true),
                    AccountMeta::new(*dest.key, false),
                    AccountMeta::new_readonly(recipient_key, false),
                    AccountMeta::new_readonly(*mint.key, false),
                    AccountMeta::new_readonly(SYSTEM_ID, false),
                    AccountMeta::new_readonly(TOKEN_ID, false),
                ],
                data: vec![1],
            },
            &[
                rent_payer.clone(),
                dest.clone(),
                recipient.clone(),
                mint.clone(),
                a[4].clone(),
                a[5].clone(),
                a[14].clone(),
            ],
        )?;
        require(
            token(dest, mint.key, Some(&recipient_key), false)?.amount == 0,
            8017,
        )?;
    }
    let cb = [class];
    let bb = [bump];
    let seeds = [b"bio".as_slice(), b"pack-auth", &id, &cb, &bb];
    let mut data = vec![14];
    data.extend_from_slice(&quantity.to_le_bytes());
    data.push(0);
    token_cpi(
        &a[5],
        vec![
            AccountMeta::new(*mint.key, false),
            AccountMeta::new(*dest.key, false),
            AccountMeta::new_readonly(*auth.key, true),
        ],
        data,
        &[mint.clone(), dest.clone(), auth.clone()],
        Some(&seeds),
    )?;
    require(
        pack_mint(mint, &id, class)? == next_supply
            && token(dest, mint.key, Some(&recipient_key), false)?.amount == next_balance,
        8017,
    )?;
    write_quota(
        &a[10], rent_payer, &a[4], class, current, false, new_s, next_s,
    )?;
    write_quota(
        &a[11], rent_payer, &a[4], class, current, true, new_l, next_l,
    )?;
    {
        let mut d = target.try_borrow_mut_data()?;
        let at = 120 + project.classes_offset + 65 * (class as usize - 1) + 49;
        d[at..at + 8].copy_from_slice(&next_i.to_le_bytes());
    }
    let mut result = quantity.to_le_bytes().to_vec();
    result.extend_from_slice(&sale.to_le_bytes());
    result.extend_from_slice(&resource.to_le_bytes());
    result.extend_from_slice(&rent.to_le_bytes());
    result.extend_from_slice(&current.to_le_bytes());
    result.extend_from_slice(&next_i.to_le_bytes());
    result.extend_from_slice(&next_s.to_le_bytes());
    result.extend_from_slice(&next_l.to_le_bytes());
    Ok(result)
}

/// The completed P2 operation already validated this payload-bound signer and
/// included the nonce shortfall in its aggregate rent/gross funding plan.
pub(crate) fn rent_payer<'a, 'b>(
    accounts: &'a [AccountInfo<'b>],
    f: &Frame,
) -> Result<&'a AccountInfo<'b>, ProgramError> {
    let at = match f.opcode {
        4 => 96,
        5 => 258,
        _ => return Err(err(8000)),
    };
    let key = key_at(f.payload, at)?;
    role(accounts, &key)
}
