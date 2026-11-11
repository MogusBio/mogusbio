#![allow(dead_code)]
//! Real SBF program + official Classic Token ELF; no native processor substitute.
pub use mollusk_svm::Mollusk;
pub mod release_constants {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../releases/func2r2/constants.rs"
    ));
}
pub use mollusk_svm_programs_token::{associated_token, token};
pub use sha2::{Digest, Sha256};
pub use solana_account::Account;
pub use solana_instruction::{AccountMeta, Instruction};
pub use solana_pubkey::{pubkey, Pubkey};

#[cfg(not(feature="production-fixture"))]
pub const PROGRAM: Pubkey = Pubkey::new_from_array([0x45; 32]);
#[cfg(not(feature="production-fixture"))]
pub const BOOT: Pubkey = Pubkey::new_from_array([
    0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
    0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a,
]);
#[cfg(feature="production-fixture")]
pub mod production_release{use super::Pubkey;include!("production_release.rs");}
#[cfg(feature="production-fixture")]
pub use production_release::{PROGRAM_ID as PROGRAM,BOOTSTRAP as BOOT,OPS_MEMBERS};
pub const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");
pub const NATIVE: Pubkey = pubkey!("NativeLoader1111111111111111111111111111111");
pub const CLOCK: Pubkey = pubkey!("SysvarC1ock11111111111111111111111111111111");
pub const INSTRUCTIONS: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");
pub const SYSVAR: Pubkey = pubkey!("Sysvar1111111111111111111111111111111111111");
pub const DEST: Pubkey = Pubkey::new_from_array([0x33; 32]);
pub const INSTANCE: Pubkey = Pubkey::new_from_array([0x61; 32]);
pub const N: u64 = 100_000_000_000_000;

pub const OTHER: Pubkey = Pubkey::new_from_array([
    0x3d, 0x40, 0x17, 0xc3, 0xe8, 0x43, 0x89, 0x5a, 0x92, 0xb7, 0x0a, 0xa7, 0x4d, 0x1b, 0x7e, 0xbc,
    0x9c, 0x98, 0x2c, 0xcf, 0x2e, 0xc4, 0x96, 0x8c, 0xc0, 0xcd, 0x55, 0xf1, 0x2a, 0xf4, 0x66, 0x0c,
]);

#[cfg(not(feature="production-fixture"))]
pub const OPS_MEMBERS: [Pubkey; 5] = [
    Pubkey::new_from_array([
        0x27, 0x81, 0x17, 0xfc, 0x14, 0x4c, 0x72, 0x34, 0x0f, 0x67, 0xd0, 0xf2, 0x31, 0x6e, 0x83,
        0x86, 0xce, 0xff, 0xbf, 0x2b, 0x24, 0x28, 0xc9, 0xc5, 0x1f, 0xef, 0x7c, 0x59, 0x7f, 0x1d,
        0x42, 0x6e,
    ]),
    Pubkey::new_from_array([
        0x3d, 0x40, 0x17, 0xc3, 0xe8, 0x43, 0x89, 0x5a, 0x92, 0xb7, 0x0a, 0xa7, 0x4d, 0x1b, 0x7e,
        0xbc, 0x9c, 0x98, 0x2c, 0xcf, 0x2e, 0xc4, 0x96, 0x8c, 0xc0, 0xcd, 0x55, 0xf1, 0x2a, 0xf4,
        0x66, 0x0c,
    ]),
    Pubkey::new_from_array([
        0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07,
        0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07,
        0x51, 0x1a,
    ]),
    Pubkey::new_from_array([
        0xec, 0x17, 0x2b, 0x93, 0xad, 0x5e, 0x56, 0x3b, 0xf4, 0x93, 0x2c, 0x70, 0xe1, 0x24, 0x50,
        0x34, 0xc3, 0x54, 0x67, 0xef, 0x2e, 0xfd, 0x4d, 0x64, 0xeb, 0xf8, 0x19, 0x68, 0x34, 0x67,
        0xe2, 0xbf,
    ]),
    Pubkey::new_from_array([
        0xfc, 0x51, 0xcd, 0x8e, 0x62, 0x18, 0xa1, 0xa3, 0x8d, 0xa4, 0x7e, 0xd0, 0x02, 0x30, 0xf0,
        0x58, 0x08, 0x16, 0xed, 0x13, 0xba, 0x33, 0x03, 0xac, 0x5d, 0xeb, 0x91, 0x15, 0x48, 0x90,
        0x80, 0x25,
    ]),
];
pub const EXPENSE_REF: [u8; 32] = [9; 32];
pub const EVIDENCE: [u8; 32] = [0x82; 32];

pub fn read64(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(d[at..at + 8].try_into().unwrap())
}

pub fn hash(tag: u16, parts: &[&[u8]]) -> [u8; 32] {
    let len: usize = parts.iter().map(|b| b.len()).sum();
    let mut h = Sha256::new();
    h.update(b"BIOHASH\0");
    h.update(1u16.to_le_bytes());
    h.update(tag.to_le_bytes());
    h.update((len as u32).to_le_bytes());
    for part in parts {
        h.update(part);
    }
    h.finalize().into()
}

#[cfg(not(feature="production-fixture"))]
pub fn domain() -> [u8; 32] {
    hash(1, &[&[0x5a; 32], PROGRAM.as_ref(), &[0x73; 32]])
}

pub fn pda(name: &[u8]) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", name], &PROGRAM).0
}

pub fn nonce(actor: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"actor-nonce", actor.as_ref()], &PROGRAM).0
}

pub fn position() -> Pubkey {
    Pubkey::find_program_address(
        &[b"bio", b"reg", INSTANCE.as_ref(), &0u64.to_le_bytes()],
        &PROGRAM,
    )
    .0
}

pub fn interval() -> [u8; 32] {
    hash(
        14,
        &[
            &domain(),
            &27u16.to_le_bytes(),
            INSTANCE.as_ref(),
            &0u64.to_le_bytes(),
        ],
    )
}

#[cfg(not(feature="production-fixture"))]
pub fn config_id() -> [u8; 32] {
    hash(
        2,
        &[
            b"ECOCFG03",
            &domain(),
            &[0x71; 32],
            BOOT.as_ref(),
            pda(b"lab-mint").as_ref(),
            pda(b"lab-reserve").as_ref(),
            pda(b"lab-auth").as_ref(),
            &N.to_le_bytes(),
            &[6],
            &release_constants::VALIDATOR_HASH,
            &release_constants::RULE_HASH,
            &86400i64.to_le_bytes(),
            &initial_set_id(),
        ],
    )
}

#[cfg(not(feature="production-fixture"))]
pub fn wire(op: u8, n: u64, payload: &[u8]) -> Vec<u8> {
    let mut d = b"BIOECON2".to_vec();
    d.push(op);
    d.extend_from_slice(&[0; 7]);
    d.extend_from_slice(&domain());
    d.extend_from_slice(&config_id());
    d.extend_from_slice(BOOT.as_ref());
    d.extend_from_slice(&n.to_le_bytes());
    d.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    d.extend_from_slice(&[0; 4]);
    d.extend_from_slice(payload);
    d
}

pub fn prefix() -> Vec<AccountMeta> {
    let mut out=vec![
        AccountMeta::new(BOOT, true),
        AccountMeta::new(nonce(&BOOT), false),
        AccountMeta::new_readonly(pda(b"econ-config"), false),
        AccountMeta::new_readonly(INSTRUCTIONS, false),
        AccountMeta::new_readonly(SYSTEM, false),
        AccountMeta::new_readonly(token::ID, false),
        AccountMeta::new_readonly(CLOCK, false),
    ];
    #[cfg(feature="production-fixture")]
    out.push(AccountMeta::new_readonly(pda(b"config"),false));
    out
}

pub fn init_ix(n: u64) -> Instruction {
    let mut accounts = prefix();
    accounts[2].is_writable = true;
    #[cfg(feature="production-fixture")]
    {accounts[7].is_writable=true;}
    accounts.extend([
        AccountMeta::new(pda(b"lab-mint"), false),
        AccountMeta::new(pda(b"lab-reserve"), false),
        AccountMeta::new_readonly(pda(b"lab-auth"), false),
        AccountMeta::new(pda(b"treasury"), false),
    ]);
    #[cfg(feature="production-fixture")]
    accounts.extend([AccountMeta::new_readonly(PROGRAM,false),AccountMeta::new_readonly(Pubkey::new_from_array(production_release::PROGRAM_DATA_ADDRESS),false)]);
    let mut p = BOOT.to_bytes().to_vec();
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    Instruction {
        program_id: PROGRAM,
        accounts,
        data: wire(1, n, &p),
    }
}

pub fn burn_ix(n: u64, tier: u8) -> Instruction {
    let mut accounts = prefix();
    accounts.extend([
        AccountMeta::new(pda(b"lab-mint"), false),
        AccountMeta::new(DEST, false),
        AccountMeta::new(pda(b"treasury"), false),
        AccountMeta::new_readonly(pda(b"lab-reserve"), false),
    ]);
    let mut p = DEST.to_bytes().to_vec();
    p.push(tier);
    p.extend_from_slice(&12_000_000u64.to_le_bytes());
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    Instruction {
        program_id: PROGRAM,
        accounts,
        data: wire(2, n, &p),
    }
}

pub fn claim_ix(n: u64, expected: u64, upto: u64) -> Instruction {
    let mut accounts = prefix();
    accounts.extend([
        AccountMeta::new_readonly(pda(b"lab-mint"), false),
        AccountMeta::new(pda(b"lab-reserve"), false),
        AccountMeta::new_readonly(pda(b"lab-auth"), false),
        AccountMeta::new(pda(b"treasury"), false),
        AccountMeta::new(position(), false),
        AccountMeta::new(DEST, false),
    ]);
    let mut p = interval().to_vec();
    p.extend_from_slice(&expected.to_le_bytes());
    p.extend_from_slice(&upto.to_le_bytes());
    p.extend_from_slice(DEST.as_ref());
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    Instruction {
        program_id: PROGRAM,
        accounts,
        data: wire(3, n, &p),
    }
}

pub fn account(accounts: &[(Pubkey, Account)], key: Pubkey) -> &Account {
    &accounts.iter().find(|(k, _)| *k == key).unwrap().1
}

pub fn account_mut(accounts: &mut [(Pubkey, Account)], key: Pubkey) -> &mut Account {
    &mut accounts.iter_mut().find(|(k, _)| *k == key).unwrap().1
}

pub fn runtime() -> Mollusk {
    let mut vm = Mollusk::new(&PROGRAM, "biolab_economy");
    vm.compute_budget.compute_unit_limit = 1_400_000;
    vm.compute_budget.heap_size = 32768;
    #[cfg(feature="production-fixture")]
    {vm.sysvars.clock.slot=10;vm.sysvars.clock.unix_timestamp=production_release::SEED_OPEN;}
    token::add_program(&mut vm);
    associated_token::add_program(&mut vm);
    vm
}

pub fn fixture() -> Vec<(Pubkey, Account)> {
    let mut a = vec![
        (
            BOOT,
            Account {
                lamports: 2_000_000_000,
                owner: SYSTEM,
                ..Default::default()
            },
        ),
        (
            SYSTEM,
            Account {
                lamports: 1,
                owner: NATIVE,
                executable: true,
                ..Default::default()
            },
        ),
        token::keyed_account(),
        associated_token::keyed_account(),
        (
            CLOCK,
            Account {
                lamports: 1_000_000,
                data: vec![0; 40],
                owner: SYSVAR,
                ..Default::default()
            },
        ),
    ];
    for key in [
        nonce(&BOOT),
        pda(b"econ-config"),
        pda(b"lab-mint"),
        pda(b"lab-reserve"),
        pda(b"lab-auth"),
        pda(b"treasury"),
    ] {
        a.push((key, Account::default()));
    }
    #[cfg(feature="production-fixture")]
    {add_empty(&mut a,pda(b"config"));let loader=pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");let mut p=2u32.to_le_bytes().to_vec();p.extend_from_slice(&production_release::PROGRAM_DATA_ADDRESS);a.push((PROGRAM,Account{lamports:1000000,owner:loader,executable:true,data:p,..Default::default()}));let mut d=vec![0;49];d[..4].copy_from_slice(&3u32.to_le_bytes());d[4..12].copy_from_slice(&9u64.to_le_bytes());d[45]=0x7f;a.push((Pubkey::new_from_array(production_release::PROGRAM_DATA_ADDRESS),Account{lamports:1000000,owner:loader,data:d,..Default::default()}));let c=account_mut(&mut a,CLOCK);c.data[..8].copy_from_slice(&10u64.to_le_bytes());c.data[32..40].copy_from_slice(&production_release::SEED_OPEN.to_le_bytes());}
    a
}

pub fn initialized(vm: &Mollusk) -> Vec<(Pubkey, Account)> {
    let a = fixture();
    let r = vm.process_instruction(&init_ix(0), &a);
    println!(
        "ECON_INIT cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()));
    r.resulting_accounts
}

pub fn header(kind: u16, schema: u16, body_len: usize, key: [u8; 32], bump: u8) -> Vec<u8> {
    let mut d = vec![0; 120 + body_len];
    d[..8].copy_from_slice(b"BIOLAB\0\0");
    d[8..10].copy_from_slice(&1u16.to_le_bytes());
    d[10..12].copy_from_slice(&kind.to_le_bytes());
    d[12..14].copy_from_slice(&schema.to_le_bytes());
    d[16..48].copy_from_slice(&domain());
    d[48..80].copy_from_slice(&config_id());
    d[80..84].copy_from_slice(&(body_len as u32).to_le_bytes());
    d[84] = bump;
    d[88..120].copy_from_slice(&key);
    d
}

pub fn accrued_fixture(vm: &Mollusk, amount: u64) -> Vec<(Pubkey, Account)> {
    let mut accounts = initialized(vm);
    let tr = account_mut(&mut accounts, pda(b"treasury"));
    tr.data[120..128].copy_from_slice(&(N - 17 - amount).to_le_bytes());
    tr.data[136..144].copy_from_slice(&amount.to_le_bytes());
    let bump = Pubkey::find_program_address(
        &[b"bio", b"reg", INSTANCE.as_ref(), &0u64.to_le_bytes()],
        &PROGRAM,
    )
    .1;
    let mut d = header(27, 2, 255, interval(), bump);
    let b = &mut d[120..];
    b[..32].copy_from_slice(INSTANCE.as_ref());
    b[48..80].copy_from_slice(&[0x62; 32]);
    b[80..112].copy_from_slice(BOOT.as_ref());
    b[120..128].copy_from_slice(&120_000u64.to_le_bytes());
    b[128..132].copy_from_slice(&1_000_000u32.to_le_bytes());
    b[132] = 4;
    b[133..149].copy_from_slice(&480_000_000_000u128.to_le_bytes());
    b[231..239].copy_from_slice(&amount.to_le_bytes());
    accounts.push((
        position(),
        Account {
            lamports: vm.sysvars.rent.minimum_balance(375),
            data: d,
            owner: PROGRAM,
            ..Default::default()
        },
    ));
    let mut d = vec![0u8; 165];
    d[..32].copy_from_slice(pda(b"lab-mint").as_ref());
    d[32..64].copy_from_slice(BOOT.as_ref());
    d[108] = 1;
    accounts.push((
        DEST,
        Account {
            lamports: vm.sysvars.rent.minimum_balance(165),
            data: d,
            owner: token::ID,
            ..Default::default()
        },
    ));
    accounts
}

pub fn catalog() -> [u8; 32] {
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
    assert_eq!(b.len(), 95);
    hash(19, &[&b])
}

pub fn project_id(n: u64) -> [u8; 32] {
    let mut op = [0u8; 32];
    op[..8].copy_from_slice(&n.to_le_bytes());
    let m = hash(3, &[&domain(), BOOT.as_ref(), &op]);
    hash(17, &[&domain(), &m])
}

pub fn project_address(id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"project", id], &PROGRAM).0
}

pub fn material_address(id: &[u8; 32], class: u8, authority: bool) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"bio",
            if authority { b"pack-auth" } else { b"pack" },
            id,
            &[class],
        ],
        &PROGRAM,
    )
    .0
}

pub fn season_address(class: u8, s: u16) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"season", &[class], &s.to_le_bytes()], &PROGRAM).0
}

pub fn lifetime_address(class: u8) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"issued", &[class]], &PROGRAM).0
}

pub fn ata(mint: &Pubkey, owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token::ID.as_ref(), mint.as_ref()],
        &associated_token::ID,
    )
    .0
}

pub fn append_wallets(metas: &mut Vec<AccountMeta>, roles: &[(Pubkey, bool, bool)]) {
    let actor = metas[0].pubkey;
    let mut keys = roles
        .iter()
        .map(|r| r.0)
        .filter(|k| *k != actor)
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    for key in keys {
        let signer = roles.iter().any(|r| r.0 == key && r.1);
        let writable = roles.iter().any(|r| r.0 == key && r.2);
        metas.push(if writable {
            AccountMeta::new(key, signer)
        } else {
            AccountMeta::new_readonly(key, signer)
        });
    }
}

pub fn create_project_ix(n: u64, price: u64, cap: u64) -> Instruction {
    let id = project_id(n);
    let mut accounts = prefix();
    accounts.push(AccountMeta::new(project_address(&id), false));
    for class in 1..=4 {
        accounts.push(AccountMeta::new(material_address(&id, class, false), false));
    }
    for class in 1..=4 {
        accounts.push(AccountMeta::new_readonly(
            material_address(&id, class, true),
            false,
        ));
    }
    accounts.push(AccountMeta::new(pda(b"ops"), false));
    let mut p = catalog().to_vec();
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(&10_000_000u64.to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    p.extend_from_slice(&5u32.to_le_bytes());
    p.extend_from_slice(b"Alpha");
    for class in 1..=4 {
        p.push(class);
        p.extend_from_slice(&cap.to_le_bytes());
        p.extend_from_slice(&price.to_le_bytes());
    }
    Instruction {
        program_id: PROGRAM,
        accounts,
        data: wire(4, n, &p),
    }
}

pub fn add_empty(accounts: &mut Vec<(Pubkey, Account)>, key: Pubkey) {
    if !accounts.iter().any(|(k, _)| *k == key) {
        accounts.push((key, Account::default()));
    }
}

pub fn prepare_create(accounts: &mut Vec<(Pubkey, Account)>, n: u64) {
    let id = project_id(n);
    add_empty(accounts, project_address(&id));
    add_empty(accounts, pda(b"ops"));
    for class in 1..=4 {
        add_empty(accounts, material_address(&id, class, false));
        add_empty(accounts, material_address(&id, class, true));
    }
}

pub fn launched(vm: &Mollusk) -> Vec<(Pubkey, Account)> {
    let mut a = initialized(vm);
    prepare_create(&mut a, 1);
    let r = vm.process_instruction(&create_project_ix(1, 500_000, 1_000_000), &a);
    println!(
        "ECON_CREATE cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()));
    r.resulting_accounts
}

pub fn buy_material_ix(
    n: u64,
    id: [u8; 32],
    class: u8,
    q: u64,
    s: u16,
    payer: Pubkey,
    recipient: Pubkey,
    price: u64,
) -> Instruction {
    let mint = material_address(&id, class, false);
    let dest = ata(&mint, &recipient);
    let mut accounts = prefix();
    accounts.extend([
        AccountMeta::new(project_address(&id), false),
        AccountMeta::new(mint, false),
        AccountMeta::new_readonly(material_address(&id, class, true), false),
        AccountMeta::new(season_address(class, s), false),
        AccountMeta::new(lifetime_address(class), false),
        AccountMeta::new(pda(b"ops"), false),
        AccountMeta::new(dest, false),
        AccountMeta::new_readonly(associated_token::ID, false),
    ]);
    append_wallets(
        &mut accounts,
        &[
            (payer, true, true),
            (recipient, false, false),
            (BOOT, false, true),
        ],
    );
    let mut p = id.to_vec();
    p.push(class);
    p.extend_from_slice(mint.as_ref());
    p.extend_from_slice(&catalog());
    p.extend_from_slice(&q.to_le_bytes());
    p.extend_from_slice(payer.as_ref());
    p.extend_from_slice(recipient.as_ref());
    p.extend_from_slice(dest.as_ref());
    p.push(1);
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(&price.to_le_bytes());
    p.extend_from_slice(&100_000u64.to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    p.extend_from_slice(&s.to_le_bytes());
    assert_eq!(p.len(), 300);
    Instruction {
        program_id: PROGRAM,
        accounts,
        data: wire(5, n, &p),
    }
}

pub fn prepare_buy(
    accounts: &mut Vec<(Pubkey, Account)>,
    id: [u8; 32],
    class: u8,
    s: u16,
    recipient: Pubkey,
) {
    add_empty(accounts, season_address(class, s));
    add_empty(accounts, lifetime_address(class));
    add_empty(
        accounts,
        ata(&material_address(&id, class, false), &recipient),
    );
}

pub fn seed_final_aa_unit(a: &mut [(Pubkey, Account)], id: &[u8; 32]) {
    let at = 120 + 148 + 5 + 49;
    account_mut(a, project_address(id)).data[at..at + 8].copy_from_slice(&49_999u64.to_le_bytes());
    account_mut(a, material_address(id, 1, false)).data[36..44]
        .copy_from_slice(&49_999u64.to_le_bytes());
    account_mut(a, ata(&material_address(id, 1, false), &BOOT)).data[64..72]
        .copy_from_slice(&49_999u64.to_le_bytes());
    account_mut(a, season_address(1, 0)).data[123..131].copy_from_slice(&49_999u64.to_le_bytes());
    account_mut(a, lifetime_address(1)).data[121..129].copy_from_slice(&49_999u64.to_le_bytes());
}

pub fn compact_length(mut n: usize) -> usize {
    let mut size = 1;
    while n >= 128 {
        size += 1;
        n >>= 7;
    }
    size
}

pub fn legacy_packet_size(instructions: &[Instruction]) -> usize {
    let mut keys = Vec::new();
    let mut signers = Vec::new();
    for ix in instructions {
        if !keys.contains(&ix.program_id) {
            keys.push(ix.program_id);
        }
        for m in &ix.accounts {
            if !keys.contains(&m.pubkey) {
                keys.push(m.pubkey);
            }
            if m.is_signer && !signers.contains(&m.pubkey) {
                signers.push(m.pubkey);
            }
        }
    }
    compact_length(signers.len())
        + signers.len() * 64
        + 3
        + compact_length(keys.len())
        + keys.len() * 32
        + 32
        + compact_length(instructions.len())
        + instructions
            .iter()
            .map(|ix| {
                1 + compact_length(ix.accounts.len())
                    + ix.accounts.len()
                    + compact_length(ix.data.len())
                    + ix.data.len()
            })
            .sum::<usize>()
}

pub fn expense_address(reference: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"expense", reference], &PROGRAM).0
}

pub fn expense_id(reference: &[u8; 32]) -> [u8; 32] {
    hash(21, &[&domain(), reference])
}

pub fn wire_actor(op: u8, n: u64, p: &[u8], actor: Pubkey) -> Vec<u8> {
    let mut d = wire(op, n, p);
    d[80..112].copy_from_slice(actor.as_ref());
    d
}

pub fn prefix_actor(actor: Pubkey) -> Vec<AccountMeta> {
    let mut a = prefix();
    a[0].pubkey = actor;
    a[1].pubkey = nonce(&actor);
    a
}

pub fn ops_fixture(vm: &Mollusk) -> Vec<(Pubkey, Account)> {
    let mut a = launched(vm);
    for m in OPS_MEMBERS {
        if !a.iter().any(|(k, _)| *k == m) {
            a.push((
                m,
                Account {
                    lamports: 1_000_000_000,
                    owner: SYSTEM,
                    ..Default::default()
                },
            ));
        }
        add_empty(&mut a, nonce(&m));
    }
    add_empty(&mut a, expense_address(&EXPENSE_REF));
    a
}

pub fn queue_expense_ix(
    n: u64,
    reference: [u8; 32],
    expected: u64,
    recipient: Pubkey,
    amount: u64,
    not_before: i64,
    expires: i64,
) -> Instruction {
    let mut a = prefix();
    a.extend([
        AccountMeta::new(pda(b"ops"), false),
        AccountMeta::new(expense_address(&reference), false),
    ]);
    append_wallets(&mut a, &[(recipient, false, false), (BOOT, true, true)]);
    let mut p = reference.to_vec();
    p.extend_from_slice(&expected.to_le_bytes());
    p.extend_from_slice(recipient.as_ref());
    p.extend_from_slice(&amount.to_le_bytes());
    p.extend_from_slice(&EVIDENCE);
    p.extend_from_slice(&not_before.to_le_bytes());
    p.extend_from_slice(&expires.to_le_bytes());
    p.extend_from_slice(BOOT.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    assert_eq!(p.len(), 168);
    Instruction {
        program_id: PROGRAM,
        accounts: a,
        data: wire(6, n, &p),
    }
}

pub fn pay_expense_ix(
    n: u64,
    actor: Pubkey,
    reference: [u8; 32],
    allocated: u64,
    recipient: Pubkey,
    amount: u64,
    not_before: i64,
    expires: i64,
    indices: [u8; 3],
    rent_payer: Pubkey,
) -> Instruction {
    let mut a = prefix_actor(actor);
    a.extend([
        AccountMeta::new(pda(b"ops"), false),
        AccountMeta::new(expense_address(&reference), false),
    ]);
    let mut roles = vec![(recipient, false, true), (rent_payer, true, true)];
    for i in indices {
        roles.push((OPS_MEMBERS[i as usize], true, false));
    }
    append_wallets(&mut a, &roles);
    let mut p = reference.to_vec();
    p.extend_from_slice(&expense_id(&reference));
    p.extend_from_slice(&allocated.to_le_bytes());
    p.extend_from_slice(recipient.as_ref());
    p.extend_from_slice(&amount.to_le_bytes());
    p.extend_from_slice(&EVIDENCE);
    p.extend_from_slice(&not_before.to_le_bytes());
    p.extend_from_slice(&expires.to_le_bytes());
    p.extend_from_slice(&indices);
    p.extend_from_slice(rent_payer.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    assert_eq!(p.len(), 203);
    Instruction {
        program_id: PROGRAM,
        accounts: a,
        data: wire_actor(7, n, &p, actor),
    }
}

pub fn queued(vm: &Mollusk, amount: u64, not_before: i64, expires: i64) -> Vec<(Pubkey, Account)> {
    let a = ops_fixture(vm);
    let ix = queue_expense_ix(2, EXPENSE_REF, 0, OTHER, amount, not_before, expires);
    assert!(legacy_packet_size(&[ix.clone()]) <= 1232);
    let r = vm.process_instruction(&ix, &a);
    println!(
        "ECON_OPS_QUEUE cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()));
    r.resulting_accounts
}

pub fn clock_at(vm: &mut Mollusk, a: &mut [(Pubkey, Account)], now: i64) {
    vm.sysvars.clock.unix_timestamp = now;
    *account_mut(a, CLOCK) = vm.sysvars.keyed_account_for_clock_sysvar().1;
}

pub fn business_for(actor: Pubkey, n: u64) -> [u8; 32] {
    let mut op = [0u8; 32];
    op[..8].copy_from_slice(&n.to_le_bytes());
    hash(3, &[&domain(), actor.as_ref(), &op])
}
pub fn instance_for(actor: Pubkey, n: u64) -> Pubkey {
    Pubkey::new_from_array(hash(
        6,
        &[&domain(), &business_for(actor, n), &0u16.to_le_bytes()],
    ))
}
pub fn source_for(actor: Pubkey, n: u64, ordinal: u16) -> [u8; 32] {
    hash(
        5,
        &[&domain(), &business_for(actor, n), &ordinal.to_le_bytes()],
    )
}
pub fn root_address(instance: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"root", instance.as_ref()], &PROGRAM).0
}
pub fn source_address(id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"source", id], &PROGRAM).0
}
pub fn artifact_id(kind: u16, actor: Pubkey, bytes: &[u8]) -> [u8; 32] {
    hash(
        19,
        &[
            &domain(),
            &config_id(),
            actor.as_ref(),
            &kind.to_le_bytes(),
            &(bytes.len() as u32).to_le_bytes(),
            &Sha256::digest(bytes),
        ],
    )
}
pub fn artifact_address(id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"bio", b"artifact", id], &PROGRAM).0
}
pub fn next_nonce(a: &[(Pubkey, Account)], actor: Pubkey) -> u64 {
    read64(&account(a, nonce(&actor)).data, 120)
}
pub fn material_bom(species: u8) -> u64 {
    match species {
        1..=24 => 500,
        25 => 1000,
        29..=32 => 250,
        _ => 0,
    }
}
pub fn material_class(species: u8) -> u8 {
    if species <= 20 {
        1
    } else if species <= 28 {
        2
    } else if species <= 31 {
        3
    } else {
        4
    }
}
pub fn stocked(vm: &Mollusk) -> Vec<(Pubkey, Account)> {
    let mut a = launched(vm);
    let id = project_id(1);
    for (class, q, n) in [(1, 30, 2), (2, 60, 3), (3, 15, 4), (4, 15, 5)] {
        prepare_buy(&mut a, id, class, 0, BOOT);
        let r = vm.process_instruction(
            &buy_material_ix(n, id, class, q, 0, BOOT, BOOT, 500_000),
            &a,
        );
        assert_eq!(r.raw_result, Ok(()));
        a = r.resulting_accounts;
    }
    a
}
pub fn put_artifact(
    vm: &Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    kind: u16,
    bytes: &[u8],
) -> (Vec<(Pubkey, Account)>, [u8; 32]) {
    let id = artifact_id(kind, BOOT, bytes);
    let key = artifact_address(&id);
    add_empty(&mut a, key);
    let digest = Sha256::digest(bytes);
    let mut seq = 0u64;
    for (offset, chunk) in bytes.chunks(1024).enumerate() {
        let mut p = kind.to_le_bytes().to_vec();
        p.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        p.extend_from_slice(&digest);
        p.extend_from_slice(&seq.to_le_bytes());
        p.extend_from_slice(&((offset * 1024) as u32).to_le_bytes());
        p.extend_from_slice(&(chunk.len() as u16).to_le_bytes());
        p.extend_from_slice(chunk);
        p.extend_from_slice(&100_000_000u64.to_le_bytes());
        let mut accounts = prefix();
        accounts.push(AccountMeta::new(key, false));
        let ix = Instruction {
            program_id: PROGRAM,
            accounts,
            data: wire(9, next_nonce(&a, BOOT), &p),
        };
        let r = vm.process_instruction(&ix, &a);
        assert_eq!(r.raw_result, Ok(()));
        a = r.resulting_accounts;
        seq += 1;
    }
    let mut p = kind.to_le_bytes().to_vec();
    p.extend_from_slice(&id);
    p.extend_from_slice(&seq.to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut accounts = prefix();
    accounts.push(AccountMeta::new(key, false));
    let ix = Instruction {
        program_id: PROGRAM,
        accounts,
        data: wire(10, next_nonce(&a, BOOT), &p),
    };
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    (r.resulting_accounts, id)
}
#[derive(Clone)]
pub struct ComponentPlan {
    pub payload: Vec<u8>,
    pub n: u64,
    pub source_ids: Vec<[u8; 32]>,
    pub intakes: Vec<(u8, u16)>,
    pub prefixes: Vec<[u64; 32]>,
}
pub fn component_plan(a: &[(Pubkey, Account)], primitive: u8, profile: u8) -> ComponentPlan {
    let mut chosen: [Option<([u8; 32], [u64; 32])>; 4] = [None; 4];
    for (_, acc) in a {
        if acc.owner != PROGRAM || acc.data.len() != 856 || acc.data[10..12] != 11u16.to_le_bytes()
        {
            continue;
        }
        let b = &acc.data[120..];
        if b[..32] != BOOT.to_bytes() {
            continue;
        }
        let class = b[200];
        if !(1..=4).contains(&class) {
            continue;
        }
        let p = std::array::from_fn(|i| read64(b, 480 + i * 8));
        let initial = std::array::from_fn::<_, 32, _>(|i| read64(b, 224 + i * 8));
        if (1..=32)
            .filter(|s| material_class(*s) == class)
            .all(|s| initial[usize::from(s - 1)] - p[usize::from(s - 1)] >= material_bom(s))
        {
            let id: [u8; 32] = acc.data[88..120].try_into().unwrap();
            if chosen[usize::from(class - 1)].is_none_or(|(old, _)| id < old) {
                chosen[usize::from(class - 1)] = Some((id, p));
            }
        }
    }
    let count = chosen.iter().filter(|s| s.is_none()).count();
    let length = 692 + 105 * count;
    let n = next_nonce(a, BOOT) + length.div_ceil(1024) as u64 + 1;
    let mut intakes = Vec::new();
    let mut ids = Vec::new();
    let mut prefixes = Vec::new();
    let mut intake_bytes = Vec::new();
    let project = project_id(1);
    for class in 1..=4 {
        if let Some((id, p)) = chosen[usize::from(class - 1)] {
            ids.push(id);
            prefixes.push(p);
        } else {
            let ordinal = intakes.len() as u16;
            let id = source_for(BOOT, n, ordinal);
            intakes.push((class, ordinal));
            ids.push(id);
            prefixes.push([0; 32]);
            intake_bytes.extend_from_slice(&project);
            intake_bytes.push(class);
            intake_bytes
                .extend_from_slice(ata(&material_address(&project, class, false), &BOOT).as_ref());
            intake_bytes.extend_from_slice(BOOT.as_ref());
            intake_bytes.extend_from_slice(&1u64.to_le_bytes());
        }
    }
    let mut order = (0..4).collect::<Vec<_>>();
    order.sort_by_key(|i| ids[*i]);
    let mut dp = 4u32.to_le_bytes().to_vec();
    for i in order {
        let class = (i + 1) as u8;
        let species = (1..=32)
            .filter(|s| material_class(*s) == class && material_bom(*s) > 0)
            .collect::<Vec<_>>();
        let mask = species.iter().fold(0u32, |m, s| m | (1u32 << (*s - 1)));
        dp.extend_from_slice(&ids[i]);
        dp.extend_from_slice(&mask.to_le_bytes());
        for s in species {
            dp.extend_from_slice(&prefixes[i][usize::from(s - 1)].to_le_bytes());
            dp.extend_from_slice(&material_bom(s).to_le_bytes());
        }
    }
    assert_eq!(dp.len(), 612);
    let mut payload = 1u16.to_le_bytes().to_vec();
    payload.extend_from_slice(&[primitive, profile]);
    payload.extend_from_slice(BOOT.as_ref());
    payload.extend_from_slice(&100_000_000u64.to_le_bytes());
    payload.extend_from_slice(&catalog());
    payload.extend_from_slice(&(count as u32).to_le_bytes());
    payload.extend_from_slice(&intake_bytes);
    payload.extend_from_slice(&dp);
    assert_eq!(payload.len(), length);
    ComponentPlan {
        payload,
        n,
        source_ids: ids,
        intakes,
        prefixes,
    }
}
pub fn component_ix(
    a: &[(Pubkey, Account)],
    plan: &ComponentPlan,
    artifact: [u8; 32],
) -> Instruction {
    let mut accounts = prefix();
    accounts.extend([
        AccountMeta::new_readonly(artifact_address(&artifact), false),
        AccountMeta::new(root_address(&instance_for(BOOT, plan.n)), false),
    ]);
    let project = project_id(1);
    if !plan.intakes.is_empty() {
        accounts.push(AccountMeta::new(project_address(&project), false));
    }
    for (class, _) in &plan.intakes {
        accounts.push(AccountMeta::new(
            material_address(&project, *class, false),
            false,
        ));
    }
    for (class, _) in &plan.intakes {
        accounts.push(AccountMeta::new(
            ata(&material_address(&project, *class, false), &BOOT),
            false,
        ));
    }
    let mut ids = plan.source_ids.clone();
    ids.sort();
    for id in ids {
        accounts.push(AccountMeta::new(source_address(&id), false));
    }
    let mut p = artifact.to_vec();
    p.extend_from_slice(&Sha256::digest(&plan.payload));
    p.extend_from_slice(&(plan.payload.len() as u32).to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    assert_eq!(next_nonce(a, BOOT), plan.n);
    Instruction {
        program_id: PROGRAM,
        accounts,
        data: wire(8, plan.n, &p),
    }
}
pub fn manufacture_next(
    vm: &Mollusk,
    a: Vec<(Pubkey, Account)>,
    primitive: u8,
    profile: u8,
) -> (Vec<(Pubkey, Account)>, Pubkey) {
    let plan = component_plan(&a, primitive, profile);
    let (mut a, artifact) = put_artifact(vm, a, 501, &plan.payload);
    let instance = instance_for(BOOT, plan.n);
    add_empty(&mut a, root_address(&instance));
    for id in &plan.source_ids {
        add_empty(&mut a, source_address(id));
    }
    let ix = component_ix(&a, &plan, artifact);
    let r = vm.process_instruction(&ix, &a);
    println!(
        "ECON_P5 cu={} packet={} raw={:?}",
        r.compute_units_consumed,
        legacy_packet_size(&[ix]),
        r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()));
    (r.resulting_accounts, instance)
}
pub fn manufactured(vm: &Mollusk) -> (Vec<(Pubkey, Account)>, Pubkey) {
    manufacture_next(vm, stocked(vm), 1, 0)
}

pub fn initial_count()->usize{if std::env::var("BIO_OPENING_PROFILE").as_deref()==Ok("historical14"){14}else{16}}
pub fn initial_set_id()->[u8;32]{
 let rows:[([u8;32],u64);16]=[
([16,171,66,38,130,124,236,99,125,187,104,208,70,86,134,239,6,37,6,40,3,196,88,186,82,206,12,171,186,114,22,51],341),
([26,39,115,52,238,191,87,190,144,226,185,12,17,113,245,11,112,126,190,247,150,124,16,168,207,199,158,233,212,227,140,97],340),
([53,213,210,244,114,231,106,78,97,121,221,194,29,113,38,214,73,160,217,176,115,159,236,81,49,228,170,57,244,204,164,33],343),
([55,231,187,252,243,61,120,244,122,49,187,231,161,25,64,255,53,215,145,146,119,254,14,176,78,24,64,64,123,106,83,205],394),
([64,253,12,78,208,67,20,131,67,17,11,37,185,50,215,132,109,229,183,190,136,64,97,35,148,54,251,153,251,26,21,239],330),
([81,229,116,119,183,166,162,230,233,121,24,87,101,154,166,236,231,164,99,191,105,226,172,51,31,96,248,205,88,58,191,46],336),
([97,96,170,234,127,74,241,208,238,246,120,52,202,170,140,58,137,46,59,166,100,169,3,75,226,45,82,202,21,9,205,106],332),
([120,148,56,149,226,90,52,254,14,194,25,35,158,119,253,95,172,183,89,237,152,85,55,252,35,229,42,190,231,46,158,203],413),
([142,124,137,27,62,130,173,72,241,158,66,185,228,229,61,193,164,137,106,42,125,191,73,244,195,30,171,63,149,121,210,239],347),
([143,233,100,37,59,198,111,74,143,42,117,1,38,239,49,198,100,246,244,138,246,248,25,247,104,87,164,226,130,246,195,154],324),
([169,55,139,71,28,249,207,240,203,37,238,8,122,155,156,235,146,187,144,112,254,83,151,243,141,99,250,37,213,192,152,15],330),
([180,98,156,227,209,176,165,242,173,6,45,52,17,18,161,154,37,148,52,184,243,43,148,208,35,100,177,221,50,216,213,95],320),
([183,134,94,237,5,2,87,171,65,202,242,193,205,239,89,48,45,48,68,245,106,103,75,114,114,167,38,122,36,98,38,235],318),
([194,173,150,108,177,25,240,4,44,21,237,66,159,254,99,57,228,213,1,218,28,157,178,132,16,61,243,115,71,33,44,212],375),
([233,2,125,51,197,185,155,5,166,19,223,249,32,106,114,123,139,2,21,210,255,2,234,221,100,60,35,24,250,218,156,42],316),
([237,248,148,118,227,1,36,23,166,196,225,160,218,212,61,109,220,136,161,192,91,86,239,212,193,6,182,80,180,233,23,44],328),
 ];
 let mut b=vec![if initial_count()==16{3}else{2}];b.extend_from_slice(&domain());b.extend_from_slice(&[160,43,204,72,38,231,208,253,243,141,12,162,12,38,137,129,71,231,26,176,41,238,246,151,54,121,0,16,247,147,245,254]);b.extend_from_slice(&(initial_count()as u32).to_le_bytes());for(d,c)in rows{if initial_count()==16||c>=320{b.extend_from_slice(&d);b.extend_from_slice(&c.to_le_bytes());}}hash(15,&[&b])
}

#[cfg(feature="production-fixture")]
pub fn domain()->[u8;32]{production_release::DEPLOYMENT_DOMAIN}
#[cfg(feature="production-fixture")]
pub fn config_id()->[u8;32]{production_release::CONFIG_ID}
#[cfg(feature="production-fixture")]
pub fn wire(op:u8,n:u64,payload:&[u8])->Vec<u8>{
 let(module,code,schema)=match op{1=>(1,1,2),3=>(1203,1,1),4=>(201,1,2),5=>(202,1,2),6=>(301,1,2),7=>(301,2,2),8=>(501,1,2),9=>(401,1,2),10=>(401,2,2),11=>(602,1,2),12=>(602,2,2),13=>(701,1,2),20=>(1001,1,2),21=>(1001,2,2),22=>(1101,1,2),23=>(1102,1,2),24=>(1102,2,2),25=>(1201,1,2),26=>(1001,3,2),27=>(1201,2,2),28=>(1102,3,2),29=>(1102,4,2),30=>(901,1,2),31=>(901,2,2),32=>(901,3,2),33=>(901,4,2),34=>(1002,1,2),35=>(1002,2,2),36=>(1002,3,2),37=>(1003,1,2),38=>(1003,2,2),39=>(1003,3,2),40=>(1003,4,2),_=>(u16::MAX,u16::MAX,2)};
 let mut d=b"BIOIX\0\0\0".to_vec();for x in[1u16,module,code,schema]{d.extend_from_slice(&x.to_le_bytes());}d.extend_from_slice(&domain());d.extend_from_slice(&config_id());d.extend_from_slice(BOOT.as_ref());d.extend_from_slice(&n.to_le_bytes());d.extend_from_slice(&[0;24]);d.extend_from_slice(&(payload.len()as u32).to_le_bytes());d.extend_from_slice(&[0;4]);d.extend_from_slice(payload);d
}
