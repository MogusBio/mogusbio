//! ECON4 ordered events with immutable hourly snapshots and opt-in lazy accrual.
//! BIOECON2 local adapter uses Config3.rewardStart; production P0 scheduling is a separate gate.
use super::*;

const EPOCH: u64 = 35_040;
const FLOOR: u128 = 288_000_000_000_000_000;
const MAX: u64 = u64::MAX;
const REG_LEN: usize = 380;
const REGISTRY_LEN: usize = 376;
const DIRECTORY_LEN: usize = 258;
const POSITION_LEN: usize = 375;
const HOUR_LEN: usize = 482;
const LEGACY_HOUR_LEN: usize = 481;

macro_rules! put64 {
    ($b:expr, $at:expr, $x:expr) => {{
        let x: u64 = $x;
        let at: usize = $at;
        let b = &mut *($b);
        b[at..at + 8].copy_from_slice(&x.to_le_bytes());
    }};
}
macro_rules! put128 {
    ($b:expr, $at:expr, $x:expr) => {{
        let x: u128 = $x;
        let at: usize = $at;
        let b = &mut *($b);
        b[at..at + 16].copy_from_slice(&x.to_le_bytes());
    }};
}
fn sub(a: u64, b: u64) -> Result<u64, ProgramError> {
    a.checked_sub(b).ok_or(err(8020))
}
fn id(kind: u16, tail: &[&[u8]]) -> [u8; 32] {
    let d = domain();
    let k = kind.to_le_bytes();
    let mut p = vec![d.as_slice(), k.as_slice()];
    p.extend_from_slice(tail);
    typed_hash(14, &p)
}
fn position_id(instance: &Pubkey, seq: u64) -> [u8; 32] {
    id(27, &[instance.as_ref(), &seq.to_le_bytes()])
}
fn hour_id(h: u64) -> [u8; 32] {
    id(18, &[&h.to_le_bytes()])
}
fn directory_id(seq: u64) -> [u8; 32] {
    id(28, &[&[0], &seq.to_le_bytes()])
}
fn start_at(cfg: &AccountInfo) -> Result<i64, ProgramError> {
    config(cfg)?;
    i64_at(&cfg.try_borrow_data()?, HEADER + 264)
}
fn actual_boundary(now: i64, start: i64) -> u64 {
    if now < start {
        0
    } else {
        ((now - start) as u64) / 3600
    }
}
fn completed(now: i64, start: i64) -> u64 {
    actual_boundary(now, start).min(H_END)
}
fn prefix(b: u64) -> Result<u64, ProgramError> {
    require(b <= H_END, 8200)?;
    let mut sum = 0u64;
    for k in 0..46u32 {
        let t = b.saturating_sub((k as u64) * EPOCH).min(EPOCH);
        let e = N >> (k + 1);
        sum = add(sum, (((e as u128) * (t as u128)) / EPOCH as u128) as u64)?;
    }
    Ok(sum)
}
fn budget(h: u64) -> Result<u64, ProgramError> {
    require(h < H_END, 8200)?;
    sub(prefix(h + 1)?, prefix(h)?)
}
fn absent(a: &AccountInfo) -> bool {
    a.owner == &SYSTEM_ID && a.data_is_empty() && !a.executable
}
fn blank_reg(instance: &Pubkey) -> Vec<u8> {
    let mut b = vec![0; 260];
    b[..32].copy_from_slice(instance.as_ref());
    b[80] = 1;
    b[129] = 1;
    put64!(&mut b, 146, MAX);
    put64!(&mut b, 244, MAX);
    b
}
pub(crate) fn registry(a: &AccountInfo) -> Result<[u64; 5], ProgramError> {
    header(
        a,
        &PROGRAM_ID,
        26,
        2,
        REGISTRY_LEN,
        &config_id(),
        &[b"bio", b"mining"],
    )?;
    let d = a.try_borrow_data()?;
    let b = &d[HEADER..];
    let v = [
        u64_at(b, 0)?,
        u64_at(b, 8)?,
        u64_at(b, 16)?,
        u64_at(b, 24)?,
        u64_at(b, 32)?,
    ];
    require(
        v[1] <= H_END && v[2] <= i64::MAX as u64 && v[4] <= v[3],
        8201,
    )?;
    Ok(v)
}
pub(crate) fn write_registry(a: &AccountInfo, v: [u64; 5]) -> ProgramResult {
    let mut d = a.try_borrow_mut_data()?;
    if zeros(&d[HEADER + 40..]) {
        put64!(&mut d[HEADER..], 72, MAX);
        put64!(&mut d[HEADER..], 80, MAX);
        put64!(&mut d[HEADER..], 232, MAX);
    }
    for (i, n) in v.iter().enumerate() {
        put64!(&mut d[HEADER..], i * 8, *n);
    }
    Ok(())
}
pub(crate) fn observe(v: &mut [u64; 5], now: i64) -> ProgramResult {
    require(now >= 0 && now as u64 >= v[2], 8202)?;
    v[2] = now as u64;
    Ok(())
}
pub(crate) fn root_reg(a: &AccountInfo, instance: &Pubkey) -> Result<Vec<u8>, ProgramError> {
    header(
        a,
        &PROGRAM_ID,
        25,
        1,
        REG_LEN,
        &instance.to_bytes(),
        &[b"bio", b"root-reg", instance.as_ref()],
    )?;
    let b = a.try_borrow_data()?[HEADER..].to_vec();
    let count = u64_at(&b, 40)?;
    let cov = u64_at(&b, 138)?;
    require(
        key_at(&b, 0)? == *instance
            && cov <= count
            && u64_at(&b, 252)? == 0
            && b[80] <= 1
            && b[129] <= 1
            && b[203] <= 1
            && b[154] <= 3
            && (cov < count || u64_at(&b, 146)? == MAX)
            && (count > 0
                || (u64_at(&b, 244)? == MAX
                    && zeros(&b[48..80])
                    && b[80] == 1
                    && u64_at(&b, 81)? == 0)),
        8203,
    )?;
    if b[80] == 0 {
        require(u64_at(&b, 81)? == 0, 8203)?;
    }
    if b[129] == 0 {
        require(u64_at(&b, 130)? == 0, 8203)?;
    }
    if u64_at(&b, 89)? == 0 {
        require(
            zeros(&b[97..129]) && b[129] == 1 && u64_at(&b, 130)? == 0,
            8203,
        )?;
    }
    if count > 0 {
        require(
            u64_at(&b, 244)? != MAX && b[48..80] == position_id(instance, count - 1),
            8203,
        )?;
    }
    if b[154] == 0 {
        require(zeros(&b[155..203]), 8203)?;
    } else {
        require(!zeros(&b[155..187]) && i64_at(&b, 187)? >= 0, 8203)?;
    }
    if b[203] == 0 {
        require(zeros(&b[204..244]), 8203)?;
    } else {
        require(!zeros(&b[204..236]), 8203)?;
    }
    Ok(b)
}
fn write_body(a: &AccountInfo, b: &[u8]) -> ProgramResult {
    writable(a)?;
    let mut d = a.try_borrow_mut_data()?;
    require(d.len() == HEADER + b.len(), 8203)?;
    d[HEADER..].copy_from_slice(b);
    Ok(())
}
fn directory(a: &AccountInfo, seq: u64, instance: &Pubkey) -> ProgramResult {
    header(
        a,
        &PROGRAM_ID,
        28,
        2,
        DIRECTORY_LEN,
        &directory_id(seq),
        &[b"bio", b"mining-root", &seq.to_le_bytes()],
    )?;
    let d = a.try_borrow_data()?;
    let b = &d[HEADER..];
    require(
        u64_at(b, 0)? == seq
            && b[8] == 0
            && key_at(b, 9)? == *instance
            && key_at(b, 41)? == *instance
            && u64_at(b, 73)? == 0,
        8204,
    )
}
pub(crate) fn position_body(
    a: &AccountInfo,
    instance: &Pubkey,
    seq: u64,
    dir: u64,
) -> Result<Vec<u8>, ProgramError> {
    position::position(a, &position_id(instance, seq))?;
    let b = a.try_borrow_data()?[HEADER..].to_vec();
    require(
        key_at(&b, 0)? == *instance && u64_at(&b, 32)? == seq && u64_at(&b, 40)? == dir,
        8205,
    )?;
    Ok(b)
}
fn end(b: &[u8]) -> Result<u64, ProgramError> {
    Ok(if b[157] == 0 {
        H_END
    } else {
        u64_at(b, 158)?.min(H_END)
    })
}
fn active(b: &[u8], h: u64) -> Result<bool, ProgramError> {
    Ok(u64_at(b, 149)? <= h && h < end(b)?)
}
fn hour(a: &AccountInfo, h: u64) -> Result<Vec<u8>, ProgramError> {
    let schema = u16_at(&a.try_borrow_data()?, 12)?;
    let len = match schema {
        3 => LEGACY_HOUR_LEN,
        4 => HOUR_LEN,
        _ => return Err(err(8206)),
    };
    header(
        a,
        &PROGRAM_ID,
        18,
        schema,
        len,
        &hour_id(h),
        &[b"bio", b"hour", &h.to_le_bytes()],
    )?;
    let b = a.try_borrow_data()?[HEADER..].to_vec();
    require(
        u64_at(&b, 0)? == h
            && u64_at(&b, 8)? == budget(h)?
            && [2, 3, 4].contains(&b[40])
            && u64_at(&b, 16)? == u64_at(&b, 24)?
            && u64_at(&b, 41)? == u64_at(&b, 16)?
            && u64_at(&b, 32)? <= u64_at(&b, 16)?
            && u64_at(&b, 49)? == u64_at(&b, 32)?
            && u64_at(&b, 249)? <= u64_at(&b, 8)?
            && u64_at(&b, 257)? == 0,
        8206,
    )?;
    require(schema == 3 || b[361] <= 1, 8206)?;
    let lazy = lazy_hour(&b);
    if lazy {
        require(u64_at(&b, 313)? == MAX && u64_at(&b, 321)? == MAX, 8206)?;
    }
    let kw = u128_at(&b, 201)?;
    require(kw == 0 || kw == 77_760_000_000_000, 8206)?;
    require(
        u128_at(&b, 217)? == u128_at(&b, 57)?.checked_add(kw).ok_or(err(8020))?
            && u128_at(&b, 233)? == u128_at(&b, 217)?.max(FLOOR),
        8206,
    )?;
    if kw == 0 {
        require(zeros(&b[73..201]), 8206)?;
    } else {
        require(!zeros(&b[73..105]), 8206)?;
    }
    if b[40] == 4 {
        require(
            u64_at(&b, 32)? == u64_at(&b, 16)?
                && u64_at(&b, 49)? == u64_at(&b, 41)?
                && add(u64_at(&b, 249)?, u64_at(&b, 265)?)? == u64_at(&b, 8)?
                && u64_at(&b, 313)? == MAX,
            8206,
        )?;
    } else {
        require(u64_at(&b, 265)? == 0, 8206)?;
    }
    Ok(b)
}
fn lazy_hour(b: &[u8]) -> bool {
    b.len() == 362 && b[361] == 1
}
fn sync_book(a: &[AccountInfo], book: &mut [u64; 8], now: i64) -> ProgramResult {
    let b = completed(now, start_at(&a[2])?);
    require(b >= book[5], 8202)?;
    let x = sub(prefix(b)?, prefix(book[5])?)?;
    book[0] = sub(book[0], x)?;
    book[1] = add(book[1], x)?;
    book[5] = b;
    Ok(())
}
fn read_book(a: &[AccountInfo]) -> Result<[u64; 8], ProgramError> {
    let supply = mint(&a[7])?;
    valid_pda(&a[8], &PROGRAM_ID, &[b"bio", b"lab-reserve"])?;
    valid_pda(&a[9], &PROGRAM_ID, &[b"bio", b"lab-auth"])?;
    let reserve = token(&a[8], a[7].key, Some(a[9].key), true)?.amount;
    treasury(&a[10], reserve, supply)
}
fn rent_new(a: &AccountInfo, len: usize) -> Result<u64, ProgramError> {
    if absent(a) {
        need_rent(a, len)
    } else {
        Ok(0)
    }
}
fn allocate_record<'a>(
    a: &[AccountInfo<'a>],
    target: &AccountInfo<'a>,
    len: usize,
    kind: u16,
    schema: u16,
    key: &[u8; 32],
    seeds: &[&[u8]],
) -> ProgramResult {
    allocate(&a[0], target, &a[4], &PROGRAM_ID, len, seeds)?;
    write_header(
        target,
        kind,
        schema,
        key,
        valid_pda(target, &PROGRAM_ID, seeds)?,
    )
}

const EVENT_LEN: usize = 297;
fn event_id(seq: u64) -> [u8; 32] {
    id(38, &[&seq.to_le_bytes()])
}
fn index(a: &AccountInfo) -> Result<Vec<u8>, ProgramError> {
    registry(a)?;
    let b = a.try_borrow_data()?[HEADER..].to_vec();
    require(
        u64_at(&b, 48)? <= u64_at(&b, 40)?
            && u64_at(&b, 56)? <= H_END
            && u64_at(&b, 64)? <= u64_at(&b, 0)?,
        8220,
    )?;
    if u64_at(&b, 64)? == 0 {
        require(
            u64_at(&b, 72)? == MAX && u64_at(&b, 80)? == MAX && u128_at(&b, 88)? == 0,
            8220,
        )?;
    } else {
        require(
            u64_at(&b, 72)? < u64_at(&b, 0)? && u64_at(&b, 80)? < u64_at(&b, 0)?,
            8220,
        )?;
    }
    let kw = u128_at(&b, 240)?;
    require(kw == 0 || kw == 77_760_000_000_000, 8220)?;
    if kw == 0 {
        require(zeros(&b[104..232]) && u64_at(&b, 232)? == MAX, 8220)?;
    } else {
        require(
            !zeros(&b[104..136]) && u64_at(&b, 232)? < u64_at(&b, 0)?,
            8220,
        )?;
    }
    Ok(b)
}
pub(crate) fn event_rent(event: &AccountInfo, reg: &AccountInfo) -> Result<u64, ProgramError> {
    let seq = if absent(reg) {
        0
    } else {
        u64_at(&index(reg)?, 40)?
    };
    valid_pda(
        event,
        &PROGRAM_ID,
        &[b"bio", b"mining-event", &seq.to_le_bytes()],
    )?;
    need_rent(event, EVENT_LEN)
}
fn enqueue<'a>(
    a: &[AccountInfo<'a>],
    reg: &AccountInfo<'a>,
    event: &AccountInfo<'a>,
    p: &[u8],
    kind: u8,
    due: u64,
    activation: &[u8; 32],
    f: &Frame,
) -> ProgramResult {
    let mut x = index(reg)?;
    let seq = u64_at(&x, 40)?;
    let now = Clock::get()?;
    require(
        due <= H_END
            && due >= u64_at(&x, 56)?
            && due >= u64_at(&x, 8)?
            && now.unix_timestamp as u64 >= u64_at(&x, 16)?,
        8221,
    )?;
    allocate_record(
        a,
        event,
        EVENT_LEN,
        38,
        1,
        &event_id(seq),
        &[b"bio", b"mining-event", &seq.to_le_bytes()],
    )?;
    let mut b = vec![0; 177];
    put64!(&mut b, 0, seq);
    put64!(&mut b, 8, due);
    b[16] = kind;
    b[17..49].copy_from_slice(&p[..32]);
    b[49..81].copy_from_slice(&position_id(&key_at(p, 0)?, u64_at(p, 32)?));
    put64!(&mut b, 81, u64_at(p, 40)?);
    put64!(&mut b, 89, u64_at(p, 32)?);
    b[97..129].copy_from_slice(activation);
    b[129..161].copy_from_slice(&business_key(f));
    b[161..169].copy_from_slice(&now.unix_timestamp.to_le_bytes());
    put64!(&mut b, 169, now.slot);
    write_body(event, &b)?;
    put64!(&mut x, 40, add(seq, 1)?);
    put64!(&mut x, 56, due);
    write_body(reg, &x)
}
fn read_event(a: &AccountInfo, seq: u64) -> Result<Vec<u8>, ProgramError> {
    header(
        a,
        &PROGRAM_ID,
        38,
        1,
        EVENT_LEN,
        &event_id(seq),
        &[b"bio", b"mining-event", &seq.to_le_bytes()],
    )?;
    let b = a.try_borrow_data()?[HEADER..].to_vec();
    require(
        u64_at(&b, 0)? == seq
            && u64_at(&b, 8)? <= H_END
            && b[16] <= 3
            && (b[16] >= 2 || zeros(&b[97..129])),
        8221,
    )?;
    Ok(b)
}
fn node(a: &AccountInfo, seq: u64) -> Result<Vec<u8>, ProgramError> {
    let d = a.try_borrow_data()?;
    require(d.len() == DIRECTORY_LEN, 8204)?;
    let instance = key_at(&d, HEADER + 9)?;
    drop(d);
    directory(a, seq, &instance)?;
    let b = a.try_borrow_data()?[HEADER..].to_vec();
    require(b[81] <= 1, 8222)?;
    if b[81] == 0 {
        require(
            zeros(&b[82..122]) && u64_at(&b, 122)? == MAX && u64_at(&b, 130)? == MAX,
            8222,
        )?;
    } else {
        require(!zeros(&b[82..114]), 8222)?;
    }
    Ok(b)
}
struct KFacts {
    id: [u8; 32],
    instance: Pubkey,
    author: Pubkey,
    ordinary: [u8; 32],
    start: u64,
    end: Option<u64>,
    global: u64,
}
fn read_k(a: &AccountInfo) -> Result<KFacts, ProgramError> {
    // One authoritative decoder for family/identity/stop evidence, rather than
    // a looser second interpretation of the actual coordinator's Activation.
    let k = originality::read_activation(a)?;
    Ok(KFacts {
        id: k.id,
        instance: k.instance,
        author: k.author,
        ordinary: k.ordinary,
        start: k.start,
        end: k.end,
        global: k.global,
    })
}
/// Called only by the actual native Task/Winner coordinator after it atomically
/// creates/stops the real Activation and K_HISTORY and updates RootReg mirrors.
pub(crate) fn enqueue_k_event<'a>(
    a: &[AccountInfo<'a>],
    reg: &AccountInfo<'a>,
    event: &AccountInfo<'a>,
    activation: &AccountInfo<'a>,
    ordinary: &AccountInfo<'a>,
    f: &Frame,
    stop: bool,
) -> ProgramResult {
    let k = read_k(activation)?;
    let d = ordinary.try_borrow_data()?;
    require(d.len() == POSITION_LEN, 8223)?;
    let seq = u64_at(&d, HEADER + 32)?;
    let dir = u64_at(&d, HEADER + 40)?;
    drop(d);
    let p = position_body(ordinary, &k.instance, seq, dir)?;
    require(
        k.ordinary == position_id(&k.instance, seq)
            && k.author == key_at(&p, 80)?
            && k.start >= u64_at(&p, 149)?
            && k.global < registry(reg)?[3],
        8223,
    )?;
    let mut registry_fields = registry(reg)?;
    if stop {
        require(k.global < registry_fields[4], 8223)?;
    } else {
        require(k.global == registry_fields[4], 8223)?;
    }
    let due = if stop {
        k.end.ok_or(err(8223))?.min(H_END)
    } else {
        require(k.end.is_none(), 8223)?;
        k.start
    };
    enqueue(a, reg, event, &p, if stop { 3 } else { 2 }, due, &k.id, f)?;
    if !stop {
        registry_fields[4] = add(registry_fields[4], 1)?;
        write_registry(reg, registry_fields)?;
    }
    Ok(())
}

pub(crate) fn stake(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() >= 18 && f.payload.len() == 96, 8000)?;
    config(&a[2])?;
    let instance = key_at(f.payload, 0)?;
    let revision = u64_at(f.payload, 32)?;
    let seq = u64_at(f.payload, 40)?;
    let expected_dir = u64_at(f.payload, 48)?;
    let beneficiary = key_at(f.payload, 56)?;
    require(beneficiary != Pubkey::default(), 8207)?;
    let root = root::read_root(&a[12])?;
    require(
        root.instance == instance
            && root.owner == f.actor
            && root.revision == revision
            && root.lifecycle == 0,
        8207,
    )?;
    let l = match root.schema {
        1 => 4u8,
        2 => 6,
        3 => 10,
        4 => 12,
        _ => return Err(err(8207)),
    };
    let q = root.q;
    let base = root.b;
    require(
        (500_000..=2_000_000).contains(&q)
            && q % 1000 == 0
            && base > 0
            && base <= 2_400_000_000_000,
        8207,
    )?;
    let w = (base as u128)
        .checked_mul((900_000 + q / 10) as u128)
        .and_then(|x| x.checked_mul(l as u128))
        .ok_or(err(8020))?;
    let now = Clock::get()?;
    require(
        now.unix_timestamp >= root.created_at && now.slot >= root.created_slot,
        8202,
    )?;
    let reward = start_at(&a[2])?;
    let start = if now.unix_timestamp < reward {
        0
    } else {
        add(actual_boundary(now.unix_timestamp, reward), 1)?
    };
    require(start < H_END, 8200)?;
    valid_pda(&a[11], &PROGRAM_ID, &[b"bio", b"mining"])?;
    valid_pda(
        &a[13],
        &PROGRAM_ID,
        &[b"bio", b"root-reg", instance.as_ref()],
    )?;
    let mut rg = if absent(&a[11]) {
        [0; 5]
    } else {
        registry(&a[11])?
    };
    observe(&mut rg, now.unix_timestamp)?;
    let mut rr = if absent(&a[13]) {
        blank_reg(&instance)
    } else {
        root_reg(&a[13], &instance)?
    };
    let count = u64_at(&rr, 40)?;
    require(
        seq == count
            && rr[203] == 0
            && rr[129] == 1
            && actual_boundary(now.unix_timestamp, reward) >= u64_at(&rr, 130)?,
        8208,
    )?;
    if count > 0 {
        require(
            a.len() == 19
                && rr[80] == 1
                && actual_boundary(now.unix_timestamp, reward) >= u64_at(&rr, 81)?,
            8208,
        )?;
        let p = position_body(&a[17], &instance, count - 1, u64_at(&rr, 244)?)?;
        require(
            position_id(&instance, count - 1) == rr[48..80]
                && p[157] == 1
                && u64_at(&p, 158)? == u64_at(&rr, 81)?,
            8208,
        )?;
    } else {
        require(a.len() == 18, 8000)?;
    }
    let dir = if count == 0 { rg[0] } else { u64_at(&rr, 244)? };
    require(expected_dir == dir, 8208)?;
    valid_pda(
        &a[14],
        &PROGRAM_ID,
        &[b"bio", b"mining-root", &dir.to_le_bytes()],
    )?;
    valid_pda(
        &a[15],
        &PROGRAM_ID,
        &[b"bio", b"reg", instance.as_ref(), &seq.to_le_bytes()],
    )?;
    let cold_h = rg[1];
    valid_pda(
        &a[16],
        &PROGRAM_ID,
        &[b"bio", b"hour", &cold_h.to_le_bytes()],
    )?;
    let mut rent = nonce_rent(&a[1])?;
    let event_at = if count == 0 { 17 } else { 18 };
    rent = add(rent, event_rent(&a[event_at], &a[11])?)?;
    for (x, len) in [
        (&a[11], REGISTRY_LEN),
        (&a[13], REG_LEN),
        (&a[15], POSITION_LEN),
    ] {
        rent = add(rent, rent_new(x, len)?)?;
    }
    if count == 0 {
        rent = add(rent, need_rent(&a[14], DIRECTORY_LEN)?)?;
    } else {
        directory(&a[14], dir, &instance)?;
    }
    require(absent(&a[15]), 8208)?;
    check_budget(a, rent, u64_at(f.payload, 88)?)?;
    for x in [&a[10], &a[11], &a[13], &a[15]] {
        writable(x)?;
    }
    let mut book = read_book(a)?;
    if rg[0] == 0 {
        sync_book(a, &mut book, now.unix_timestamp)?;
        let b = completed(now.unix_timestamp, reward);
        require(rg[1] <= b, 8209)?;
        let amount = sub(prefix(b)?, prefix(rg[1])?)?;
        // Earlier empty lazy snapshots may still reserve their whole budgets.
        // Seal only this never-registered frontier suffix, leaving those old
        // budgets available to their separate exact finalization calls.
        require(book[2] == 0 && book[1] >= amount, 8209)?;
        if !absent(&a[16]) {
            let mut h = hour(&a[16], rg[1])?;
            require(
                rg[1] < b
                    && h[40] == 2
                    && zeros(&h[16..40])
                    && zeros(&h[41..233])
                    && zeros(&h[249..273])
                    && u128_at(&h, 233)? == FLOOR,
                8209,
            )?;
            h[40] = 4;
            put64!(&mut h, 265, budget(rg[1])?);
            write_body(&a[16], &h)?;
        }
        book[1] = sub(book[1], amount)?;
        book[3] = add(book[3], amount)?;
        rg[1] = b;
    }
    if absent(&a[11]) {
        allocate_record(
            a,
            &a[11],
            REGISTRY_LEN,
            26,
            2,
            &config_id(),
            &[b"bio", b"mining"],
        )?;
    }
    if absent(&a[13]) {
        allocate_record(
            a,
            &a[13],
            REG_LEN,
            25,
            1,
            &instance.to_bytes(),
            &[b"bio", b"root-reg", instance.as_ref()],
        )?;
    }
    if count == 0 {
        allocate_record(
            a,
            &a[14],
            DIRECTORY_LEN,
            28,
            2,
            &directory_id(dir),
            &[b"bio", b"mining-root", &dir.to_le_bytes()],
        )?;
        let mut db = vec![0; 138];
        put64!(&mut db, 122, MAX);
        put64!(&mut db, 130, MAX);
        put64!(&mut db, 0, dir);
        db[9..41].copy_from_slice(instance.as_ref());
        db[41..73].copy_from_slice(instance.as_ref());
        write_body(&a[14], &db)?;
        rg[0] = add(rg[0], 1)?;
        put64!(&mut rr, 244, dir);
    }
    let pid = position_id(&instance, seq);
    allocate_record(
        a,
        &a[15],
        POSITION_LEN,
        27,
        2,
        &pid,
        &[b"bio", b"reg", instance.as_ref(), &seq.to_le_bytes()],
    )?;
    let mut p = vec![0; 255];
    p[..32].copy_from_slice(instance.as_ref());
    put64!(&mut p, 32, seq);
    put64!(&mut p, 40, dir);
    p[48..80].copy_from_slice(&business_key(f));
    p[80..112].copy_from_slice(beneficiary.as_ref());
    put64!(&mut p, 112, revision);
    put64!(&mut p, 120, base);
    p[128..132].copy_from_slice(&q.to_le_bytes());
    p[132] = l;
    put128!(&mut p, 133, w);
    put64!(&mut p, 149, start);
    p[199..207].copy_from_slice(&now.unix_timestamp.to_le_bytes());
    put64!(&mut p, 207, now.slot);
    put64!(&mut p, 247, start);
    write_body(&a[15], &p)?;
    put64!(&mut rr, 32, add(u64_at(&rr, 32)?, 1)?);
    put64!(&mut rr, 40, add(count, 1)?);
    rr[48..80].copy_from_slice(&pid);
    rr[80..89].fill(0);
    if u64_at(&rr, 138)? == count {
        put64!(&mut rr, 146, start);
    }
    write_body(&a[13], &rr)?;
    write_registry(&a[11], rg)?;
    write_treasury(&a[10], book)?;
    enqueue(a, &a[11], &a[event_at], &p, 0, start, &[0; 32], f)?;
    let mut out = pid.to_vec();
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&dir.to_le_bytes());
    Ok(out)
}

pub(crate) fn exit(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 12 && f.payload.len() == 56, 8000)?;
    config(&a[2])?;
    let instance = key_at(f.payload, 0)?;
    let seq = u64_at(f.payload, 32)?;
    let revision = u64_at(f.payload, 40)?;
    let r = root::read_root(&a[8])?;
    require(
        r.instance == instance && r.owner == f.actor && r.revision == revision && r.lifecycle == 0,
        8207,
    )?;
    let mut rg = registry(&a[7])?;
    let now = Clock::get()?;
    require(
        now.unix_timestamp >= r.created_at && now.slot >= r.created_slot,
        8202,
    )?;
    observe(&mut rg, now.unix_timestamp)?;
    let mut rr = root_reg(&a[9], &instance)?;
    require(rr[129] == 1, 8223)?; // actual open K must be stopped through the Task hook first
    require(
        rr[203] == 0
            && add(seq, 1)? == u64_at(&rr, 40)?
            && rr[80] == 0
            && position_id(&instance, seq) == rr[48..80],
        8208,
    )?;
    let mut p = position_body(&a[10], &instance, seq, u64_at(&rr, 244)?)?;
    let reward = start_at(&a[2])?;
    let current = actual_boundary(now.unix_timestamp, reward);
    require(
        now.unix_timestamp >= reward && current >= u64_at(&p, 149)? && p[157] == 0,
        8210,
    )?;
    check_budget(
        a,
        add(nonce_rent(&a[1])?, event_rent(&a[11], &a[7])?)?,
        u64_at(f.payload, 48)?,
    )?;
    let e = add(current, 1)?;
    p[157] = 1;
    put64!(&mut p, 158, e);
    p[166] = 1;
    p[167..199].copy_from_slice(&business_key(f));
    p[215..223].copy_from_slice(&now.unix_timestamp.to_le_bytes());
    put64!(&mut p, 223, now.slot);
    rr[80] = 1;
    put64!(&mut rr, 81, e);
    put64!(&mut rr, 32, add(u64_at(&rr, 32)?, 1)?);
    write_body(&a[10], &p)?;
    write_body(&a[9], &rr)?;
    write_registry(&a[7], rg)?;
    enqueue(a, &a[7], &a[11], &p, 1, e.min(H_END), &[0; 32], f)?;
    let mut out = position_id(&instance, seq).to_vec();
    out.extend_from_slice(&e.to_le_bytes());
    Ok(out)
}
pub(crate) fn sync(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 12 && f.payload.len() == 8, 8000)?;
    config(&a[2])?;
    let now = Clock::get()?;
    valid_pda(&a[11], &PROGRAM_ID, &[b"bio", b"mining"])?;
    let mut rg = if absent(&a[11]) {
        [0; 5]
    } else {
        registry(&a[11])?
    };
    observe(&mut rg, now.unix_timestamp)?;
    check_budget(
        a,
        add(nonce_rent(&a[1])?, rent_new(&a[11], REGISTRY_LEN)?)?,
        u64_at(f.payload, 0)?,
    )?;
    let mut b = read_book(a)?;
    sync_book(a, &mut b, now.unix_timestamp)?;
    if absent(&a[11]) {
        allocate_record(
            a,
            &a[11],
            REGISTRY_LEN,
            26,
            2,
            &config_id(),
            &[b"bio", b"mining"],
        )?;
    }
    write_registry(&a[11], rg)?;
    writable(&a[10])?;
    write_treasury(&a[10], b)?;
    Ok(b[5].to_le_bytes().to_vec())
}

/// Seal an actually empty half-open range without allocating historical Hours.
/// The immutable event frontier, never a client-supplied root list, proves that
/// no ordinary/K activation can occur before the exclusive target boundary.
pub(crate) fn empty_skip(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 14 && f.payload.len() == 24, 8000)?;
    config(&a[2])?;
    let from = u64_at(f.payload, 0)?;
    let to = u64_at(f.payload, 8)?;
    let now = Clock::get()?;
    let mut rg = registry(&a[11])?;
    observe(&mut rg, now.unix_timestamp)?;
    require(
        from == rg[1]
            && from < to
            && to <= completed(now.unix_timestamp, start_at(&a[2])?),
        8227,
    )?;
    let x = index(&a[11])?;
    require(u64_at(&x, 64)? == 0 && u128_at(&x, 240)? == 0, 8227)?;
    valid_pda(&a[12], &PROGRAM_ID, &[b"bio", b"hour", &from.to_le_bytes()])?;
    require(absent(&a[12]), 8227)?;
    let cursor = u64_at(&x, 48)?;
    valid_pda(
        &a[13],
        &PROGRAM_ID,
        &[b"bio", b"mining-event", &cursor.to_le_bytes()],
    )?;
    if cursor < u64_at(&x, 40)? {
        require(u64_at(&read_event(&a[13], cursor)?, 8)? >= to, 8227)?;
    } else {
        require(absent(&a[13]), 8227)?;
    }
    check_budget(a, nonce_rent(&a[1])?, u64_at(f.payload, 16)?)?;
    writable(&a[10])?;
    writable(&a[11])?;
    let mut book = read_book(a)?;
    sync_book(a, &mut book, now.unix_timestamp)?;
    let sealed = sub(prefix(to)?, prefix(from)?)?;
    book[1] = sub(book[1], sealed)?;
    book[3] = add(book[3], sealed)?;
    rg[1] = to;
    write_treasury(&a[10], book)?;
    write_registry(&a[11], rg)?;
    let mut result = from.to_le_bytes().to_vec();
    result.extend_from_slice(&to.to_le_bytes());
    result.extend_from_slice(&sealed.to_le_bytes());
    Ok(result)
}

pub(crate) fn open_hour(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 14 && f.payload.len() == 16, 8000)?;
    config(&a[2])?;
    let h = u64_at(f.payload, 0)?;
    let now = Clock::get()?;
    let mut rg = registry(&a[11])?;
    observe(&mut rg, now.unix_timestamp)?;
    require(
        h == rg[1] && h < H_END && h < completed(now.unix_timestamp, start_at(&a[2])?),
        8211,
    )?;
    let x = index(&a[11])?;
    let ec = u64_at(&x, 48)?;
    valid_pda(
        &a[13],
        &PROGRAM_ID,
        &[b"bio", b"mining-event", &ec.to_le_bytes()],
    )?;
    if ec < u64_at(&x, 40)? {
        require(u64_at(&read_event(&a[13], ec)?, 8)? > h, 8224)?;
    } else {
        require(absent(&a[13]), 8224)?;
    }
    valid_pda(&a[12], &PROGRAM_ID, &[b"bio", b"hour", &h.to_le_bytes()])?;
    require(absent(&a[12]), 8211)?;
    check_budget(
        a,
        add(nonce_rent(&a[1])?, need_rent(&a[12], HOUR_LEN)?)?,
        u64_at(f.payload, 8)?,
    )?;
    let mut book = read_book(a)?;
    sync_book(a, &mut book, now.unix_timestamp)?;
    allocate_record(
        a,
        &a[12],
        HOUR_LEN,
        18,
        4,
        &hour_id(h),
        &[b"bio", b"hour", &h.to_le_bytes()],
    )?;
    let count = u64_at(&x, 64)?;
    let nw = u128_at(&x, 88)?;
    let kw = u128_at(&x, 240)?;
    let total = nw.checked_add(kw).ok_or(err(8020))?;
    let mut b = vec![0; 362];
    put64!(&mut b, 0, h);
    put64!(&mut b, 8, budget(h)?);
    put64!(&mut b, 16, count);
    put64!(&mut b, 24, count);
    b[40] = 2;
    put64!(&mut b, 41, count);
    put128!(&mut b, 57, nw);
    b[73..105].copy_from_slice(&x[104..136]);
    b[105..137].copy_from_slice(&x[136..168]);
    b[137..169].copy_from_slice(&x[168..200]);
    b[169..201].copy_from_slice(&x[200..232]);
    put128!(&mut b, 201, kw);
    put128!(&mut b, 217, total);
    put128!(&mut b, 233, total.max(FLOOR));
    b[273..281].copy_from_slice(&now.unix_timestamp.to_le_bytes());
    put64!(&mut b, 281, now.slot);
    put64!(&mut b, 289, rg[3]);
    put64!(&mut b, 297, u64_at(&x, 72)?);
    put64!(&mut b, 305, u64_at(&x, 80)?);
    put64!(&mut b, 313, u64_at(&x, 72)?);
    put64!(&mut b, 321, MAX);
    b[329..361].copy_from_slice(f.actor.as_ref());
    write_body(&a[12], &b)?;
    write_registry(&a[11], rg)?;
    writable(&a[10])?;
    write_treasury(&a[10], book)?;
    let mut out = h.to_le_bytes().to_vec();
    out.extend_from_slice(&budget(h)?.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    Ok(out)
}

/// Freeze-frontier advancement never certifies debt or seals another member's
/// unmaterialized share. Old schema3 accounts remain sequential-only records.
pub(crate) fn advance_frozen_hour(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 9 && f.payload.len() == 16, 8000)?;
    config(&a[2])?;
    let h = u64_at(f.payload, 0)?;
    let now = Clock::get()?;
    let mut rg = registry(&a[7])?;
    observe(&mut rg, now.unix_timestamp)?;
    require(h == rg[1] && h < completed(now.unix_timestamp, start_at(&a[2])?), 8228)?;
    let mut hb = hour(&a[8], h)?;
    require(hb.len() == 362 && hb[361] == 0 && [2, 3].contains(&hb[40]), 8228)?;
    check_budget(a, nonce_rent(&a[1])?, u64_at(f.payload, 8)?)?;
    writable(&a[7])?;
    hb[361] = 1;
    put64!(&mut hb, 313, MAX);
    put64!(&mut hb, 321, MAX);
    rg[1] = add(h, 1)?;
    write_body(&a[8], &hb)?;
    write_registry(&a[7], rg)?;
    let mut out = h.to_le_bytes().to_vec();
    out.extend_from_slice(&rg[1].to_le_bytes());
    Ok(out)
}

/// One queue transition, never a historical Root scan. Extra neighbors are exact,
/// ordered prev then next for removal, or the old tail for insertion.
pub(crate) fn scan_hour(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() >= 11 && f.payload.len() == 24, 8000)?;
    config(&a[2])?;
    let seq = u64_at(f.payload, 0)?;
    let boundary = u64_at(f.payload, 8)?;
    let mut rg = registry(&a[7])?;
    let now = Clock::get()?;
    observe(&mut rg, now.unix_timestamp)?;
    let mut x = index(&a[7])?;
    require(
        boundary == rg[1] && seq == u64_at(&x, 48)? && seq < u64_at(&x, 40)?,
        8224,
    )?;
    let e = read_event(&a[8], seq)?;
    let due = u64_at(&e, 8)?;
    require(due <= boundary, 8224)?;
    let dir = u64_at(&e, 81)?;
    let instance = key_at(&e, 17)?;
    let rseq = u64_at(&e, 89)?;
    let mut n = node(&a[9], dir)?;
    require(key_at(&n, 9)? == instance, 8222)?;
    let p = position_body(&a[10], &instance, rseq, dir)?;
    require(e[49..81] == position_id(&instance, rseq), 8221)?;
    check_budget(a, nonce_rent(&a[1])?, u64_at(f.payload, 16)?)?;
    match e[16] {
        0 => {
            require(u64_at(&p, 149)? == due && n[81] == 0, 8222)?;
            let tail = u64_at(&x, 80)?;
            require(a.len() == if tail == MAX { 11 } else { 12 }, 8000)?;
            if tail != MAX {
                let mut t = node(&a[11], tail)?;
                require(t[81] == 1 && u64_at(&t, 130)? == MAX, 8222)?;
                put64!(&mut t, 130, dir);
                write_body(&a[11], &t)?;
            } else {
                require(u64_at(&x, 64)? == 0, 8222)?;
                put64!(&mut x, 72, dir);
            }
            n[81] = 1;
            n[82..114].copy_from_slice(&e[49..81]);
            put64!(&mut n, 114, rseq);
            put64!(&mut n, 122, tail);
            put64!(&mut n, 130, MAX);
            put64!(&mut x, 80, dir);
            put64!(&mut x, 64, add(u64_at(&x, 64)?, 1)?);
            put128!(
                &mut x,
                88,
                u128_at(&x, 88)?
                    .checked_add(u128_at(&p, 133)?)
                    .ok_or(err(8020))?
            );
            write_body(&a[9], &n)?;
        }
        1 => {
            require(
                p[157] == 1
                    && end(&p)? == due
                    && n[81] == 1
                    && n[82..114] == e[49..81],
                8222,
            )?;
            require(u128_at(&x, 240)? == 0 || x[200..232] != e[49..81], 8223)?;
            let prev = u64_at(&n, 122)?;
            let next = u64_at(&n, 130)?;
            let mut at = 11;
            if prev == MAX {
                require(u64_at(&x, 72)? == dir, 8222)?;
                put64!(&mut x, 72, next);
            } else {
                require(a.len() > at, 8000)?;
                let mut v = node(&a[at], prev)?;
                require(v[81] == 1 && u64_at(&v, 130)? == dir, 8222)?;
                put64!(&mut v, 130, next);
                write_body(&a[at], &v)?;
                at += 1;
            }
            if next == MAX {
                require(u64_at(&x, 80)? == dir, 8222)?;
                put64!(&mut x, 80, prev);
            } else {
                require(a.len() > at, 8000)?;
                let mut v = node(&a[at], next)?;
                require(v[81] == 1 && u64_at(&v, 122)? == dir, 8222)?;
                put64!(&mut v, 122, prev);
                write_body(&a[at], &v)?;
                at += 1;
            }
            require(a.len() == at, 8000)?;
            n[81..122].fill(0);
            put64!(&mut n, 122, MAX);
            put64!(&mut n, 130, MAX);
            put64!(&mut x, 64, sub(u64_at(&x, 64)?, 1)?);
            put128!(
                &mut x,
                88,
                u128_at(&x, 88)?
                    .checked_sub(u128_at(&p, 133)?)
                    .ok_or(err(8020))?
            );
            write_body(&a[9], &n)?;
        }
        2 | 3 => {
            require(a.len() == 12, 8000)?;
            let k = read_k(&a[11])?;
            require(
                k.id == e[97..129]
                    && k.instance == instance
                    && k.ordinary == e[49..81]
                    && k.author == key_at(&p, 80)?,
                8223,
            )?;
            if e[16] == 2 {
                require(
                    k.start == due
                        && u128_at(&x, 240)? == 0
                        && n[81] == 1
                        && n[82..114] == e[49..81],
                    8223,
                )?;
                x[104..136].copy_from_slice(&k.id);
                x[136..168].copy_from_slice(instance.as_ref());
                x[168..200].copy_from_slice(k.author.as_ref());
                x[200..232].copy_from_slice(&k.ordinary);
                put64!(&mut x, 232, dir);
                put128!(&mut x, 240, 77_760_000_000_000);
            } else {
                require(
                    k.end.map(|v| v.min(H_END)) == Some(due) && x[104..136] == k.id,
                    8223,
                )?;
                x[104..232].fill(0);
                put64!(&mut x, 232, MAX);
                put128!(&mut x, 240, 0);
            }
        }
        _ => return Err(err(8221)),
    }
    put64!(&mut x, 48, add(seq, 1)?);
    put64!(&mut x, 16, rg[2]);
    write_body(&a[7], &x)?;
    Ok(add(seq, 1)?.to_le_bytes().to_vec())
}

pub(crate) fn materialize(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() >= 13 && f.payload.len() == 32, 8000)?;
    config(&a[2])?;
    let h = u64_at(f.payload, 0)?;
    let cursor = u64_at(f.payload, 8)?;
    let seq = u64_at(f.payload, 16)?;
    let mut rg = registry(&a[11])?;
    let now = Clock::get()?;
    observe(&mut rg, now.unix_timestamp)?;
    let mut hb = hour(&a[12], h)?;
    let lazy = lazy_hour(&hb);
    require(if lazy { h < rg[1] } else { h == rg[1] }, 8211)?;
    require([2, 3].contains(&hb[40]) && u64_at(&hb, 32)? == cursor, 8212)?;
    check_budget(a, nonce_rent(&a[1])?, u64_at(f.payload, 24)?)?;
    let mut book = read_book(a)?;
    sync_book(a, &mut book, now.unix_timestamp)?;
    let cutoff = u64_at(&hb, 16)?;
    if cutoff > 0 {
        require(a.len() == 16 && cursor < cutoff, 8000)?;
        // Only the immutable Directory identity proves a lazy historical
        // member. Its present Position/prev/next may already have changed.
        let dir = if lazy {
            u64_at(&a[13].try_borrow_data()?, HEADER)?
        } else {
            u64_at(&hb, 313)?
        };
        let n = node(&a[13], dir)?;
        let instance = key_at(&n, 9)?;
        let mut rr = root_reg(&a[14], &instance)?;
        let mut p = position_body(&a[15], &instance, seq, dir)?;
        require(
            (lazy || (n[81] == 1
                && u64_at(&n, 114)? == seq
                && n[82..114] == position_id(&instance, seq)
                && u64_at(&n, 122)? == u64_at(&hb, 321)?))
                && active(&p, h)?
                && u64_at(&rr, 244)? == dir
                && u64_at(&rr, 138)? == seq
                && u64_at(&p, 247)? == h
                && (u64_at(&rr, 146)? == h || (u64_at(&rr, 146)? == MAX && h == u64_at(&p, 149)?)),
            8213,
        )?;
        let kw = if u128_at(&hb, 201)? > 0 && hb[105..137] == instance.to_bytes() {
            require(
                hb[169..201] == position_id(&instance, seq) && key_at(&hb, 137)? == key_at(&p, 80)?,
                8223,
            )?;
            u128_at(&hb, 201)?
        } else {
            0
        };
        let w = u128_at(&p, 133)?.checked_add(kw).ok_or(err(8020))?;
        let amount =
            ((budget(h)? as u128).checked_mul(w).ok_or(err(8020))? / u128_at(&hb, 233)?) as u64;
        put64!(&mut p, 231, add(u64_at(&p, 231)?, amount)?);
        put64!(&mut p, 247, h + 1);
        if h + 1 == end(&p)? {
            put64!(&mut rr, 138, add(seq, 1)?);
            put64!(&mut rr, 146, MAX);
        } else {
            put64!(&mut rr, 146, h + 1);
        }
        book[1] = sub(book[1], amount)?;
        book[2] = add(book[2], amount)?;
        put64!(&mut hb, 49, add(u64_at(&hb, 49)?, 1)?);
        put64!(&mut hb, 249, add(u64_at(&hb, 249)?, amount)?);
        put64!(&mut hb, 32, add(cursor, 1)?);
        if !lazy {
            put64!(&mut hb, 321, dir);
            put64!(&mut hb, 313, u64_at(&n, 130)?);
        }
        put64!(&mut rr, 32, add(u64_at(&rr, 32)?, 1)?);
        write_body(&a[15], &p)?;
        write_body(&a[14], &rr)?;
    } else {
        require(
            a.len() == 13 && cursor == 0 && u64_at(&hb, 313)? == MAX,
            8000,
        )?;
    }
    hb[40] = 3;
    if u64_at(&hb, 32)? == cutoff {
        require(
            u64_at(&hb, 49)? == cutoff
                && u64_at(&hb, 313)? == MAX
                && (lazy || u64_at(&hb, 321)? == u64_at(&hb, 305)?),
            8214,
        )?;
        let residue = sub(budget(h)?, u64_at(&hb, 249)?)?;
        book[1] = sub(book[1], residue)?;
        book[3] = add(book[3], residue)?;
        put64!(&mut hb, 265, residue);
        hb[40] = 4;
        if !lazy {
            rg[1] = h + 1;
        }
    }
    write_body(&a[12], &hb)?;
    write_registry(&a[11], rg)?;
    writable(&a[10])?;
    write_treasury(&a[10], book)?;
    let mut out = h.to_le_bytes().to_vec();
    out.push(hb[40]);
    out.extend_from_slice(&u64_at(&hb, 32)?.to_le_bytes());
    out.extend_from_slice(&u64_at(&hb, 249)?.to_le_bytes());
    out.extend_from_slice(&u64_at(&hb, 265)?.to_le_bytes());
    Ok(out)
}

/// Release only the completed global Hour's SOL rent, never token rewards or
/// material provenance. Its original opener is immutable, while Registry's
/// monotone hour cursor permanently prevents reopening the closed PDA.
pub(crate) fn close_final_hour(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(
        (a.len() == 9 || a.len() == 10) && f.payload.len() == 16,
        8000,
    )?;
    config(&a[2])?;
    let h = u64_at(f.payload, 0)?;
    let mut rg = registry(&a[7])?;
    let now = Clock::get()?;
    observe(&mut rg, now.unix_timestamp)?;
    let b = hour(&a[8], h)?;
    require(
        b[40] == 4 && h < rg[1] && (lazy_hour(&b) || u64_at(&b, 321)? == u64_at(&b, 305)?),
        8226,
    )?;
    if u64_at(&b, 16)? == 0 {
        require(u64_at(&b, 297)? == MAX && u64_at(&b, 305)? == MAX, 8226)?;
    }
    let payer = key_at(&b, 329)?;
    let recipient = if payer == f.actor {
        require(a.len() == 9, 8000)?;
        &a[0]
    } else {
        require(a.len() == 10 && *a[9].key == payer, 8226)?;
        &a[9]
    };
    require(payer.is_on_curve() && payer != Pubkey::default(), 8226)?;
    writable(&a[7])?;
    writable(&a[8])?;
    writable(recipient)?;
    check_budget(a, nonce_rent(&a[1])?, u64_at(f.payload, 8)?)?;
    let refund = a[8].lamports();
    let final_balance = add(recipient.lamports(), refund)?;
    write_registry(&a[7], rg)?;
    **recipient.try_borrow_mut_lamports()? = final_balance;
    **a[8].try_borrow_mut_lamports()? = 0;
    a[8].resize(0)?;
    a[8].assign(&SYSTEM_ID);
    let mut result = h.to_le_bytes().to_vec();
    result.extend_from_slice(&hour_id(h));
    result.extend_from_slice(payer.as_ref());
    result.extend_from_slice(&refund.to_le_bytes());
    Ok(result)
}

/// Shared SYNTH/TRANSFER guard. It never erases the beneficiary's old Position debt.
/// Callers must separately authenticate the live Root and atomically mark consumption/revoke.
pub(crate) fn assert_movable(
    reg: &AccountInfo,
    instance: &Pubkey,
    cfg: &AccountInfo,
    now: i64,
) -> ProgramResult {
    let start = start_at(cfg)?;
    require(now >= 0, 8202)?;
    valid_pda(reg, &PROGRAM_ID, &[b"bio", b"root-reg", instance.as_ref()])?;
    if absent(reg) {
        return Ok(());
    }
    let r = root_reg(reg, instance)?;
    require(
        r[203] == 0
            && r[80] == 1
            && r[129] == 1
            && actual_boundary(now, start) >= u64_at(&r, 81)?
            && actual_boundary(now, start) >= u64_at(&r, 130)?
            && u64_at(&r, 138)? == u64_at(&r, 40)?
            && u64_at(&r, 146)? == MAX,
        8215,
    )
}

/// Native SYNTH includes each direct input's canonical RootReg even when never staked.
pub(crate) fn movement_rent(reg: &AccountInfo, instance: &Pubkey) -> Result<u64, ProgramError> {
    valid_pda(reg, &PROGRAM_ID, &[b"bio", b"root-reg", instance.as_ref()])?;
    if absent(reg) {
        need_rent(reg, REG_LEN)
    } else {
        root_reg(reg, instance)?;
        Ok(0)
    }
}
pub(crate) fn registry_rent(reg: &AccountInfo) -> Result<u64, ProgramError> {
    valid_pda(reg, &PROGRAM_ID, &[b"bio", b"mining"])?;
    if absent(reg) {
        need_rent(reg, REGISTRY_LEN)
    } else {
        registry(reg)?;
        Ok(0)
    }
}
/// Canonical lazy initialization for trusted callers, including Safety before
/// the first miner. The caller must include registry_rent in its total cap.
pub(crate) fn ensure_registry<'a>(
    a: &[AccountInfo<'a>],
    target: &AccountInfo<'a>,
    now: i64,
) -> ProgramResult {
    config(&a[2])?;
    require(Clock::get()?.unix_timestamp == now, 8202)?;
    registry_rent(target)?;
    let mut rg = if absent(target) {
        [0; 5]
    } else {
        registry(target)?
    };
    observe(&mut rg, now)?;
    if absent(target) {
        allocate_record(
            a,
            target,
            REGISTRY_LEN,
            26,
            2,
            &config_id(),
            &[b"bio", b"mining"],
        )?;
    }
    write_registry(target, rg)
}

/// These indices are supplied only by the in-program finite Safety replay
/// coordinator. No external instruction dispatches an arbitrary fault setter.
pub(crate) struct FaultAccounts {
    pub registry: usize,
    pub root: usize,
    pub registration: usize,
    pub ordinary: Option<usize>,
    pub end_event: Option<usize>,
}
pub(crate) struct PreparedFault {
    pub rent: u64,
    map: FaultAccounts,
    instance: Pubkey,
    evidence: Pubkey,
    evidence_event: u64,
    now: Clock,
    old_count: u64,
    old_ordinary: [u8; 32],
    position: Option<Vec<u8>>,
    due: Option<u64>,
}
/// Preflight only. `preceding_events` is the trusted coordinator's K_END count
/// (zero or one), allowing both rents and the *later* ordinary Event PDA to be
/// checked before either write. Missing evidence is never treated as a fault.
pub(crate) fn prepare_fault(
    a: &[AccountInfo],
    map: FaultAccounts,
    evidence: &Pubkey,
    evidence_event: u64,
    preceding_events: u64,
) -> Result<PreparedFault, ProgramError> {
    require(
        preceding_events <= 1 && *evidence != Pubkey::default() && evidence_event > 0,
        8225,
    )?;
    config(&a[2])?;
    let now = Clock::get()?;
    let r = root::read_root(&a[map.root])?;
    require(
        now.unix_timestamp >= r.created_at && now.slot >= r.created_slot,
        8202,
    )?;
    let mut rg = if absent(&a[map.registry]) {
        [0; 5]
    } else {
        registry(&a[map.registry])?
    };
    observe(&mut rg, now.unix_timestamp)?;
    let mut rent = add(
        registry_rent(&a[map.registry])?,
        movement_rent(&a[map.registration], &r.instance)?,
    )?;
    let rr = if absent(&a[map.registration]) {
        blank_reg(&r.instance)
    } else {
        root_reg(&a[map.registration], &r.instance)?
    };
    let count = u64_at(&rr, 40)?;
    let old_ordinary = rr[48..80].try_into().map_err(|_| err(8225))?;
    let mut position = None;
    let mut due = None;
    if rr[203] == 0 && count > 0 && rr[80] == 0 {
        let at = map.ordinary.ok_or(err(8225))?;
        let mut p = position_body(&a[at], &r.instance, count - 1, u64_at(&rr, 244)?)?;
        require(
            p[157] == 0 && old_ordinary == position_id(&r.instance, count - 1),
            8225,
        )?;
        let start = u64_at(&p, 149)?;
        let reward = start_at(&a[2])?;
        let next = if now.unix_timestamp < reward {
            0
        } else {
            add(actual_boundary(now.unix_timestamp, reward), 1)?.min(H_END)
        };
        let e = next.max(start);
        require(u64_at(&p, 247)? <= e && rg[1] <= e, 8225)?;
        p[157] = 1;
        put64!(&mut p, 158, e);
        p[166] = 2; // Frozen Position enum: 1=EXIT, 2=CERT_INVALID (may be empty).
        p[215..223].copy_from_slice(&now.unix_timestamp.to_le_bytes());
        put64!(&mut p, 223, now.slot);
        let event_at = map.end_event.ok_or(err(8225))?;
        let event_seq = if absent(&a[map.registry]) {
            0
        } else {
            u64_at(&index(&a[map.registry])?, 40)?
        };
        let seq = add(event_seq, preceding_events)?;
        valid_pda(
            &a[event_at],
            &PROGRAM_ID,
            &[b"bio", b"mining-event", &seq.to_le_bytes()],
        )?;
        rent = add(rent, need_rent(&a[event_at], EVENT_LEN)?)?;
        position = Some(p);
        due = Some(e);
    } else {
        require(map.ordinary.is_none() && map.end_event.is_none(), 8225)?;
    }
    Ok(PreparedFault {
        rent,
        map,
        instance: r.instance,
        evidence: *evidence,
        evidence_event,
        now,
        old_count: count,
        old_ordinary,
        position,
        due,
    })
}

/// Commit after the replay evidence and any K_END are written in the same
/// transaction. Re-read RootReg so the coordinator's K stop is never overwritten.
/// Existing TRANSFER/CONSUMED first cause, all debt and paid totals are retained.
pub(crate) fn commit_fault<'a>(
    a: &[AccountInfo<'a>],
    p: &PreparedFault,
    f: &Frame,
) -> ProgramResult {
    ensure_registry(a, &a[p.map.registry], p.now.unix_timestamp)?;
    let target = &a[p.map.registration];
    let mut rr = if absent(target) {
        blank_reg(&p.instance)
    } else {
        root_reg(target, &p.instance)?
    };
    require(
        u64_at(&rr, 40)? == p.old_count && rr[48..80] == p.old_ordinary,
        8225,
    )?;
    if rr[203] == 1 {
        return Ok(());
    }
    require(rr[129] == 1, 8223)?;
    if absent(target) {
        allocate_record(
            a,
            target,
            REG_LEN,
            25,
            1,
            &p.instance.to_bytes(),
            &[b"bio", b"root-reg", p.instance.as_ref()],
        )?;
    }
    if let Some(mut ordinary) = p.position.clone() {
        require(rr[80] == 0, 8225)?;
        let e = p.due.ok_or(err(8225))?;
        require(u64_at(&rr, 130)?.min(H_END) <= e, 8225)?;
        ordinary[167..199].copy_from_slice(&business_key(f));
        rr[80] = 1;
        put64!(&mut rr, 81, e);
        // A pending interval cancelled before its first reward hour has no
        // materialization call which could advance coverage. Seal that empty
        // coverage now; its START+END queue entries still replay in append order.
        if e == u64_at(&ordinary, 149)? && u64_at(&rr, 138)? == p.old_count - 1 {
            require(u64_at(&ordinary, 247)? == e, 8225)?;
            put64!(&mut rr, 138, p.old_count);
            put64!(&mut rr, 146, MAX);
        }
        write_body(&a[p.map.ordinary.ok_or(err(8225))?], &ordinary)?;
        enqueue(
            a,
            &a[p.map.registry],
            &a[p.map.end_event.ok_or(err(8225))?],
            &ordinary,
            1,
            e,
            &[0; 32],
            f,
        )?;
    }
    if rr[154] == 0 {
        rr[154] = 3;
        rr[155..187].copy_from_slice(&business_key(f));
        rr[187..195].copy_from_slice(&p.now.unix_timestamp.to_le_bytes());
        put64!(&mut rr, 195, p.now.slot);
    }
    rr[203] = 1;
    rr[204..236].copy_from_slice(p.evidence.as_ref());
    put64!(&mut rr, 236, p.evidence_event);
    put64!(&mut rr, 32, add(u64_at(&rr, 32)?, 1)?);
    write_body(target, &rr)
}
/// Trusted in-program SYNTH hook, after all real Root/owner/certificate checks.
/// Caller counts registry_rent once + movement_rent per distinct input in its rent cap.
/// All these writes share the caller's atomic fee burn / consumed inputs / new Root.
pub(crate) fn mark_consumed<'a>(
    a: &[AccountInfo<'a>],
    registry_account: &AccountInfo<'a>,
    reg: &AccountInfo<'a>,
    instance: &Pubkey,
    f: &Frame,
) -> ProgramResult {
    mark_revoke(a, registry_account, reg, instance, f, 2)
}
/// Trusted market list uses the same physical-end/coverage revocation as transfer.
/// It cannot alter the immutable beneficiary or the debt of any old Position.
pub(crate) fn market_revoke<'a>(a:&[AccountInfo<'a>],registry:&AccountInfo<'a>,reg:&AccountInfo<'a>,instance:&Pubkey,expected_revision:u64,f:&Frame)->ProgramResult{
    let actual=if absent(reg){0}else{u64_at(&root_reg(reg,instance)?,32)?};
    require(actual==expected_revision,6809)?;mark_revoke(a,registry,reg,instance,f,1)
}
fn mark_revoke<'a>(
    a: &[AccountInfo<'a>],
    registry_account: &AccountInfo<'a>,
    reg: &AccountInfo<'a>,
    instance: &Pubkey,
    f: &Frame,
    reason: u8,
) -> ProgramResult {
    let now = Clock::get()?;
    assert_movable(reg, instance, &a[2], now.unix_timestamp)?;
    let mut rg = if absent(registry_account) {
        [0; 5]
    } else {
        registry(registry_account)?
    };
    observe(&mut rg, now.unix_timestamp)?;
    let mut rr = if absent(reg) {
        blank_reg(instance)
    } else {
        root_reg(reg, instance)?
    };
    if absent(registry_account) {
        allocate_record(
            a,
            registry_account,
            REGISTRY_LEN,
            26,
            2,
            &config_id(),
            &[b"bio", b"mining"],
        )?;
    }
    if absent(reg) {
        allocate_record(
            a,
            reg,
            REG_LEN,
            25,
            1,
            &instance.to_bytes(),
            &[b"bio", b"root-reg", instance.as_ref()],
        )?;
    }
    if rr[154] == 0 {
        rr[154] = reason;
        rr[155..187].copy_from_slice(&business_key(f));
        rr[187..195].copy_from_slice(&now.unix_timestamp.to_le_bytes());
        put64!(&mut rr, 195, now.slot);
        put64!(&mut rr, 32, add(u64_at(&rr, 32)?, 1)?);
    }
    write_body(reg, &rr)?;
    write_registry(registry_account, rg)
}

/// Local native transfer, after end+coverage; previously accrued rewards remain
/// attached to each immutable beneficiary Position, not the mutable Root owner.
pub(crate) fn transfer(a: &[AccountInfo], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 10 && f.payload.len() == 88, 8000)?;
    config(&a[2])?;
    let instance = key_at(f.payload, 0)?;
    let revision = u64_at(f.payload, 32)?;
    let reg_revision = u64_at(f.payload, 40)?;
    let new_owner = key_at(f.payload, 48)?;
    require(
        new_owner.is_on_curve()
            && new_owner != f.actor
            && new_owner != Pubkey::default()
            && new_owner != PROGRAM_ID
            && new_owner != TOKEN_ID
            && new_owner != SYSTEM_ID,
        8207,
    )?;
    let r = root::read_root(&a[8])?;
    require(
        r.instance == instance && r.owner == f.actor && r.revision == revision && r.lifecycle == 0,
        8207,
    )?;
    let clock = Clock::get()?;
    require(
        clock.unix_timestamp >= r.created_at && clock.slot >= r.created_slot,
        8202,
    )?;
    let old_reg_revision = if absent(&a[9]) {
        0
    } else {
        u64_at(&root_reg(&a[9], &instance)?, 32)?
    };
    require(old_reg_revision == reg_revision, 8208)?;
    check_budget(
        a,
        add(
            add(nonce_rent(&a[1])?, registry_rent(&a[7])?)?,
            movement_rent(&a[9], &instance)?,
        )?,
        u64_at(f.payload, 80)?,
    )?;
    mark_revoke(a, &a[7], &a[9], &instance, f, 1)?;
    writable(&a[8])?;
    {
        let mut d = a[8].try_borrow_mut_data()?;
        d[HEADER + 202..HEADER + 234].copy_from_slice(new_owner.as_ref());
        put64!(&mut d[HEADER..], 234, add(revision, 1)?);
    }
    let mut out = instance.to_bytes().to_vec();
    out.extend_from_slice(new_owner.as_ref());
    out.extend_from_slice(&add(revision, 1)?.to_le_bytes());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn emission_exact() {
        assert_eq!(prefix(H_END).unwrap(), N - 17);
        assert_eq!(budget(0).unwrap(), 1_426_940_639);
        assert_eq!(budget(EPOCH).unwrap(), 713_470_319);
        assert_eq!(prefix(EPOCH).unwrap(), N / 2);
    }
    #[test]
    fn ordinary_floor() {
        let w = 480_000_000_000u128;
        assert_eq!(budget(0).unwrap() as u128 * w / FLOOR, 2378);
        assert_eq!(budget(0).unwrap() as u128 * (w * 60) / FLOOR, 142694);
        assert_eq!(2378 * 60, 142680);
        assert_eq!(
            budget(0).unwrap() as u128 * 95_040_000_000_000 / FLOOR,
            470890
        );
    }
    #[test]
    fn lock_uses_actual_not_emission_boundary() {
        assert_eq!(actual_boundary((H_END as i64 + 2) * 3600, 0), H_END + 2);
        assert_eq!(completed((H_END as i64 + 2) * 3600, 0), H_END);
    }
    #[test]
    fn all_lifetime_issuance_weight_and_largest_hour_fit_exact_u128() {
        // Independent cross-module upper bound: the four global lifetime unit
        // caps, species counts, ticks/unit and catalog credits. Count retired
        // species too for a conservative bound; no extra issuance is assumed.
        let material_credit: u128 = [
            (5_000_000u128, 20u128, 6u128),
            (10_000_000, 8, 15),
            (2_500_000, 3, 40),
            (2_500_000, 1, 120),
        ]
        .iter()
        .map(|(units, species, credit)| units * species * 1000 * credit)
        .sum();
        assert_eq!(material_credit, 2_400_000_000_000);
        // Even placing every non-reusable material at the maximum BIO tier
        // and q2, plus the unique K, is far below a checked u128 product limit.
        let total = material_credit
            .checked_mul(1_100_000)
            .unwrap()
            .checked_mul(12)
            .unwrap()
            .checked_add(77_760_000_000_000)
            .unwrap();
        assert_eq!(total, 31_680_077_760_000_000_000);
        assert_eq!(
            total.checked_mul(1_426_940_640).unwrap(),
            45_205_590_434_104_166_400_000_000_000
        );
    }
}
