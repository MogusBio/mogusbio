//! Ordinary mining end-to-end on the SBF ELF. No Position.accrued fixture is used.
mod support;
use support::*;
#[path = "support/mining.rs"]
mod mining;
#[path = "support/synthesis.rs"]
mod synthesis;

const FLOOR: u128 = 288_000_000_000_000_000;
const WIRE_HEADER: usize = if cfg!(feature="production-fixture") { 152 } else { 128 };
const PUBLIC_PREFIX: usize = if cfg!(feature="production-fixture") { 8 } else { 7 };
fn address(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &PROGRAM).0
}
fn root(instance: Pubkey) -> Pubkey {
    address(&[b"bio", b"root", instance.as_ref()])
}
fn reg(instance: Pubkey) -> Pubkey {
    address(&[b"bio", b"root-reg", instance.as_ref()])
}
fn pos(instance: Pubkey, seq: u64) -> Pubkey {
    address(&[b"bio", b"reg", instance.as_ref(), &seq.to_le_bytes()])
}
fn pos_id(instance: Pubkey, seq: u64) -> [u8; 32] {
    hash(
        14,
        &[
            &domain(),
            &27u16.to_le_bytes(),
            instance.as_ref(),
            &seq.to_le_bytes(),
        ],
    )
}
fn dir(seq: u64) -> Pubkey {
    address(&[b"bio", b"mining-root", &seq.to_le_bytes()])
}
fn hour(h: u64) -> Pubkey {
    address(&[b"bio", b"hour", &h.to_le_bytes()])
}
fn next(a: &[(Pubkey, Account)], actor: Pubkey) -> u64 {
    let x = account(a, nonce(&actor));
    if x.data.is_empty() {
        0
    } else {
        read64(&x.data, 120)
    }
}
fn extra_book(v: &mut Vec<AccountMeta>) {
    v.extend([
        AccountMeta::new_readonly(pda(b"lab-mint"), false),
        AccountMeta::new_readonly(pda(b"lab-reserve"), false),
        AccountMeta::new_readonly(pda(b"lab-auth"), false),
        AccountMeta::new(pda(b"treasury"), false),
    ]);
}
fn ix(op: u8, n: u64, p: Vec<u8>, metas: Vec<AccountMeta>, actor: Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM,
        accounts: metas,
        data: wire_actor(op, n, &p, actor),
    }
}
fn execute(
    vm: &Mollusk,
    a: Vec<(Pubkey, Account)>,
    ix: Instruction,
    label: &str,
) -> Vec<(Pubkey, Account)> {
    assert!(
        legacy_packet_size(&[ix.clone()]) <= 1232,
        "{label} legacy packet too large"
    );
    let r = vm.process_instruction(&ix, &a);
    println!(
        "SETTLE_{label} cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()), "{label}");
    r.resulting_accounts
}
fn prepare_stake(a: &mut Vec<(Pubkey, Account)>, instance: Pubkey, seq: u64) {
    for key in [pda(b"mining"), reg(instance), dir(0), pos(instance, seq)] {
        add_empty(a, key);
    }
    let h = if account(a, pda(b"mining")).data.is_empty() {
        0
    } else {
        read64(&account(a, pda(b"mining")).data, 128)
    };
    add_empty(a, hour(h));
}
fn stake_ix(
    a: &[(Pubkey, Account)],
    instance: Pubkey,
    seq: u64,
    actor: Pubkey,
    beneficiary: Pubkey,
) -> Instruction {
    let r = &account(a, root(instance)).data;
    let mut p = instance.to_bytes().to_vec();
    p.extend_from_slice(&read64(r, 120 + 234).to_le_bytes());
    p.extend_from_slice(&seq.to_le_bytes());
    p.extend_from_slice(&0u64.to_le_bytes());
    p.extend_from_slice(beneficiary.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix_actor(actor);
    extra_book(&mut m);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new_readonly(root(instance), false),
        AccountMeta::new(reg(instance), false),
        AccountMeta::new(dir(0), false),
        AccountMeta::new(pos(instance, seq), false),
    ]);
    let h = if account(a, pda(b"mining")).data.is_empty() {
        0
    } else {
        read64(&account(a, pda(b"mining")).data, 128)
    };
    m.push(AccountMeta::new(hour(h), false));
    if seq > 0 {
        m.push(AccountMeta::new_readonly(pos(instance, seq - 1), false));
    }
    let ev = if account(a, pda(b"mining")).data.is_empty() {
        0
    } else {
        read64(&account(a, pda(b"mining")).data, 160)
    };
    m.push(AccountMeta::new(mining::event_key(ev), false));
    ix(20, next(a, actor), p, m, actor)
}
fn exit_ix(a: &[(Pubkey, Account)], instance: Pubkey, seq: u64, actor: Pubkey) -> Instruction {
    let mut p = instance.to_bytes().to_vec();
    p.extend_from_slice(&seq.to_le_bytes());
    p.extend_from_slice(&read64(&account(a, root(instance)).data, 120 + 234).to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix_actor(actor);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new_readonly(root(instance), false),
        AccountMeta::new(reg(instance), false),
        AccountMeta::new(pos(instance, seq), false),
    ]);
    let ev = read64(&account(a, pda(b"mining")).data, 160);
    m.push(AccountMeta::new(mining::event_key(ev), false));
    ix(21, next(a, actor), p, m, actor)
}
fn open_ix(a: &[(Pubkey, Account)], h: u64) -> Instruction {
    mining::open_ix(a, h)
}
fn sync_ix(a: &[(Pubkey, Account)]) -> Instruction {
    let mut m = prefix();
    extra_book(&mut m);
    m.push(AccountMeta::new(pda(b"mining"), false));
    ix(
        22,
        next(a, BOOT),
        100_000_000u64.to_le_bytes().to_vec(),
        m,
        BOOT,
    )
}
fn mat_ix(a: &[(Pubkey, Account)], _instance: Pubkey, h: u64) -> Instruction {
    mining::materialize_ix(a, h)
}
fn settle(
    vm: &Mollusk,
    a: Vec<(Pubkey, Account)>,
    _instance: Pubkey,
    h: u64,
) -> Vec<(Pubkey, Account)> {
    mining::settle_hour(vm, a, h)
}
fn claim_root_ix(
    a: &[(Pubkey, Account)],
    instance: Pubkey,
    seq: u64,
    actor: Pubkey,
    beneficiary: Pubkey,
    expected: u64,
    upto: u64,
) -> Instruction {
    let destination = ata(&pda(b"lab-mint"), &beneficiary);
    let mut p = pos_id(instance, seq).to_vec();
    p.extend_from_slice(&expected.to_le_bytes());
    p.extend_from_slice(&upto.to_le_bytes());
    p.extend_from_slice(destination.as_ref());
    p.extend_from_slice(actor.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix_actor(actor);
    m.extend([
        AccountMeta::new_readonly(pda(b"lab-mint"), false),
        AccountMeta::new(pda(b"lab-reserve"), false),
        AccountMeta::new_readonly(pda(b"lab-auth"), false),
        AccountMeta::new(pda(b"treasury"), false),
        AccountMeta::new(pos(instance, seq), false),
        AccountMeta::new(destination, false),
    ]);
    ix(3, next(a, actor), p, m, actor)
}
fn transfer_ix(a: &[(Pubkey, Account)], instance: Pubkey, to: Pubkey) -> Instruction {
    let mut p = instance.to_bytes().to_vec();
    p.extend_from_slice(&read64(&account(a, root(instance)).data, 120 + 234).to_le_bytes());
    p.extend_from_slice(&read64(&account(a, reg(instance)).data, 120 + 32).to_le_bytes());
    p.extend_from_slice(to.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix();
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new(root(instance), false),
        AccountMeta::new(reg(instance), false),
    ]);
    ix(26, next(a, BOOT), p, m, BOOT)
}
fn close_ix(a: &[(Pubkey, Account)], h: u64, actor: Pubkey, receiver: Pubkey) -> Instruction {
    let mut p = h.to_le_bytes().to_vec();
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix_actor(actor);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new(hour(h), false),
    ]);
    if receiver != actor {
        m.push(AccountMeta::new(receiver, false));
    }
    ix(27, next(a, actor), p, m, actor)
}
fn create_lab_ata(
    vm: &Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    owner: Pubkey,
) -> Vec<(Pubkey, Account)> {
    let destination = ata(&pda(b"lab-mint"), &owner);
    add_empty(&mut a, destination);
    if !a.iter().any(|(k, _)| *k == owner) {
        a.push((
            owner,
            Account {
                lamports: 1_000_000_000,
                owner: SYSTEM,
                ..Default::default()
            },
        ));
    }
    add_empty(&mut a, nonce(&owner));
    let x = Instruction {
        program_id: associated_token::ID,
        accounts: vec![
            AccountMeta::new(BOOT, true),
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(pda(b"lab-mint"), false),
            AccountMeta::new_readonly(SYSTEM, false),
            AccountMeta::new_readonly(token::ID, false),
        ],
        data: vec![1],
    };
    execute(vm, a, x, "ATA")
}
fn setup() -> (Mollusk, Vec<(Pubkey, Account)>, Pubkey, i64) {
    let vm = runtime();
    let (mut a, instance) = manufactured(&vm);
    let start = i64::from_le_bytes(
        account(&a, pda(b"econ-config")).data[384..392]
            .try_into()
            .unwrap(),
    );
    prepare_stake(&mut a, instance, 0);
    for seq in 0..32 {
        add_empty(&mut a, mining::event_key(seq));
    }
    a = create_lab_ata(&vm, a, BOOT);
    (vm, a, instance, start)
}

// Isolated oracle filename: another independently running historical-profile
// full-chain test must never overwrite the bytes this Node comparison reads.
// All transaction builders and actual FINAL are shared with the real client.
fn verify_cell_isolated(
    vm: &Mollusk,
    a: Vec<(Pubkey, Account)>,
    roots: &[Pubkey],
) -> synthesis::Prepared {
    let bytes = synthesis::payload(&a, 1, roots);
    let mut a = synthesis::ensure_artifact(vm, a, &bytes);
    add_empty(&mut a, synthesis::verification());
    let file = synthesis::evidence_dir().join(format!(
        "native-settlement-cell-{}.bin",
        synthesis::hex(&synthesis::sha(&bytes))
    ));
    std::fs::write(&file, &bytes).unwrap();
    let oracle = std::process::Command::new("node")
        .arg(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools/check-synthesis.mjs"))
        .arg(&file)
        .arg("2000000")
        .output()
        .unwrap();
    assert!(
        oracle.status.success(),
        "{}",
        String::from_utf8_lossy(&oracle.stderr)
    );
    let expected = String::from_utf8(oracle.stdout)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    assert_eq!(expected.len(), 6);
    let begin = vm.process_instruction(&synthesis::begin_ix(&a, &bytes, 2_000_000), &a);
    assert_eq!(begin.raw_result, Ok(()));
    let mut max_cu = begin.compute_units_consumed;
    let mut phase_cu = [0u64; 7];
    let mut prior = begin.return_data;
    let mut steps = 0;
    a = begin.resulting_accounts;
    while prior[18] != 6 {
        assert!(steps < 1024);
        let phase = prior[18] as usize;
        let result = vm.process_instruction(&synthesis::step_ix(&a, &bytes, &prior), &a);
        assert_eq!(result.raw_result, Ok(()));
        max_cu = max_cu.max(result.compute_units_consumed);
        phase_cu[phase] = phase_cu[phase].max(result.compute_units_consumed);
        a = result.resulting_accounts;
        prior = result.return_data;
        steps += 1;
    }
    assert_eq!(u16::from_le_bytes(prior[25..27].try_into().unwrap()), 73);
    assert_eq!(
        u32::from_le_bytes(prior[20..24].try_into().unwrap()).to_string(),
        expected[1]
    );
    assert_eq!(read64(&prior, 32).to_string(), expected[2]);
    assert_eq!(synthesis::hex(&prior[40..72]), expected[3]);
    synthesis::Prepared {
        accounts: a,
        bytes,
        prior,
        expected,
        max_cu,
        steps,
        phase_cu,
    }
}

#[test]
fn real_manufactured_root_earns_closed_hour_then_claims_real_reserve_tokens() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "STAKE");
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 149), 1);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 0);
    clock_at(&mut vm, &mut a, start + 3601);
    a = settle(&vm, a, instance, 0);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 0);
    clock_at(&mut vm, &mut a, start + 7201);
    a = settle(&vm, a, instance, 1);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 2378);
    let hb = &account(&a, hour(1)).data;
    assert_eq!(read64(hb, 128), 1_426_940_639);
    assert_eq!(u128::from_le_bytes(hb[353..369].try_into().unwrap()), FLOOR);
    assert_eq!(read64(hb, 120 + 265), 1_426_938_261);
    let c = claim_root_ix(&a, instance, 0, BOOT, BOOT, 0, 2378);
    a = execute(&vm, a, c.clone(), "CLAIM");
    assert_eq!(
        read64(&account(&a, ata(&pda(b"lab-mint"), &BOOT)).data, 64),
        2378
    );
    assert_eq!(read64(&account(&a, pda(b"lab-reserve")).data, 64), N - 2378);
    let retry = vm.process_instruction(&c, &a);
    assert_eq!(retry.raw_result, Ok(()));
    assert_eq!(retry.resulting_accounts, a);
    let bad = claim_root_ix(&a, instance, 0, BOOT, BOOT, 0, 2378);
    let r = vm.process_instruction(&bad, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    a = create_lab_ata(&vm, a, OTHER);
    let race = claim_root_ix(&a, instance, 0, OTHER, BOOT, 0, 2378);
    let r = vm.process_instruction(&race, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
fn downtime_exit_transfer_restake_preserve_old_beneficiary_and_one_lifetime_directory() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "STAKE");
    clock_at(&mut vm, &mut a, start + 3601);
    a = settle(&vm, a, instance, 0);
    // No crank in hours1..2; exit cannot backdate the missing hours.
    clock_at(&mut vm, &mut a, start + 7201);
    let x = exit_ix(&a, instance, 0, BOOT);
    a = execute(&vm, a, x, "EXIT");
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 158), 3);
    let locked = transfer_ix(&a, instance, OTHER);
    let r = vm.process_instruction(&locked, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    clock_at(&mut vm, &mut a, start + 10801);
    let unpaid = transfer_ix(&a, instance, OTHER);
    let r = vm.process_instruction(&unpaid, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    a = settle(&vm, a, instance, 1);
    a = settle(&vm, a, instance, 2);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 4756);
    let t = transfer_ix(&a, instance, OTHER);
    a = execute(&vm, a, t, "TRANSFER");
    assert_eq!(&account(&a, root(instance)).data[322..354], OTHER.as_ref());
    a = create_lab_ata(&vm, a, OTHER);
    prepare_stake(&mut a, instance, 1);
    let s = stake_ix(&a, instance, 1, OTHER, OTHER);
    a = execute(&vm, a, s, "RESTAKE");
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120), 1);
    assert_eq!(read64(&account(&a, reg(instance)).data, 120 + 40), 2);
    clock_at(&mut vm, &mut a, start + 14401);
    add_empty(&mut a, hour(3));
    a = mining::apply_pending_events(&vm, a, 3);
    let o = open_ix(&a, 3);
    a = execute(&vm, a, o, "OPEN");
    assert_eq!(read64(&account(&a, hour(3)).data, 120 + 16), 0);
    assert_eq!(read64(&account(&a, reg(instance)).data, 120 + 252), 0);
    let m = mat_ix(&a, instance, 3);
    a = execute(&vm, a, m, "MATERIALIZE");
    clock_at(&mut vm, &mut a, start + 18001);
    a = settle(&vm, a, instance, 4);
    assert_eq!(read64(&account(&a, pos(instance, 1)).data, 120 + 231), 2378);
    let c = claim_root_ix(&a, instance, 0, OTHER, BOOT, 0, 4756);
    a = execute(&vm, a, c, "OLD_OWNER_CLAIM");
    assert_eq!(
        read64(&account(&a, ata(&pda(b"lab-mint"), &BOOT)).data, 64),
        4756
    );
    assert_eq!(
        read64(&account(&a, ata(&pda(b"lab-mint"), &OTHER)).data, 64),
        0
    );
}

#[test]
fn cold_start_seals_completed_prefix_without_sealing_current_hour_or_backdating_stake() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 3 * 3600 + 17);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "COLD_STAKE");
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 128), 3);
    assert_eq!(
        read64(&account(&a, pda(b"treasury")).data, 120 + 24),
        4_280_821_934
    );
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 149), 4);
    add_empty(&mut a, hour(3));
    let future = open_ix(&a, 3);
    let r = vm.process_instruction(&future, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    clock_at(&mut vm, &mut a, start + 4 * 3600 + 1);
    a = settle(&vm, a, instance, 3);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 0);
    clock_at(&mut vm, &mut a, start + 5 * 3600 + 1);
    a = settle(&vm, a, instance, 4);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 2378);
}

#[test]
fn empty_ready_hour_before_first_stake_is_finalized_once_inside_cold_prefix() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 2 * 3600 + 17);
    let s = sync_ix(&a);
    a = execute(&vm, a, s, "EMPTY_SYNC");
    let o = open_ix(&a, 0);
    a = execute(&vm, a, o, "EMPTY_OPEN");
    assert_eq!(account(&a, hour(0)).data[160], 2);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "EMPTY_READY_COLD_STAKE");
    assert_eq!(account(&a, hour(0)).data[160], 4);
    assert_eq!(read64(&account(&a, hour(0)).data, 120 + 265), 1_426_940_639);
    assert_eq!(
        read64(&account(&a, pda(b"treasury")).data, 120 + 24),
        2_853_881_295
    );
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 128), 2);
}

#[test]
fn cursor_race_fake_k_clock_rollback_and_later_transaction_failure_roll_back() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "STAKE");
    clock_at(&mut vm, &mut a, start + 7201);
    a = settle(&vm, a, instance, 0);
    add_empty(&mut a, hour(1));
    a = mining::apply_pending_events(&vm, a, 1);
    let o = open_ix(&a, 1);
    a = execute(&vm, a, o, "OPEN");
    let m = mat_ix(&a, instance, 1);
    let mut stale = m.clone();
    stale.data[WIRE_HEADER + 8..WIRE_HEADER + 16].copy_from_slice(&1u64.to_le_bytes());
    let r = vm.process_instruction(&stale, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let mut fake = a.clone();
    account_mut(&mut fake, hour(1)).data[120 + 201] = 1;
    let r = vm.process_instruction(&m, &fake);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, fake);
    clock_at(&mut vm, &mut a, start + 7199);
    let r = vm.process_instruction(&m, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    clock_at(&mut vm, &mut a, start + 7201);
    a = execute(&vm, a, m, "MATERIALIZE");
    let c = claim_root_ix(&a, instance, 0, BOOT, BOOT, 0, 2378);
    let mut bad = c.clone();
    bad.data[0] = 0;
    let r = vm.process_transaction_instructions(&[c, bad], &a, Some(&BOOT));
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
fn true_closed_hours_across_epoch_boundary_match_node_golden_without_backfilling_stake() {
    let (mut vm, mut a, instance, start) = setup();
    const E: u64 = 35040;
    clock_at(&mut vm, &mut a, start + (E as i64 - 2) * 3600 + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "EPOCH_STAKE");
    clock_at(&mut vm, &mut a, start + (E as i64 + 1) * 3600 + 1);
    for h in [E - 2, E - 1, E] {
        a = settle(&vm, a, instance, h);
    }
    assert_eq!(read64(&account(&a, hour(E - 1)).data, 128), 1_426_940_640);
    assert_eq!(read64(&account(&a, hour(E)).data, 128), 713_470_319);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 3567);
    let tr = &account(&a, pda(b"treasury")).data;
    assert_eq!(read64(tr, 120 + 40), E + 1);
    assert_eq!(read64(tr, 120), N - 17 - 50_000_713_470_319);
    assert_eq!(read64(tr, 120 + 8), 0);
    assert_eq!(read64(tr, 120 + 16), 3567);
}

#[test]
fn zero_atom_final_hour_still_advances_coverage_and_usage_lock_outlives_emission_domain() {
    let (mut vm, mut a, instance, start) = setup();
    const END: u64 = 1_611_840;
    clock_at(&mut vm, &mut a, start + (END as i64 - 2) * 3600 + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "FINAL_STAKE");
    clock_at(&mut vm, &mut a, start + (END as i64 + 1) * 3600 + 1);
    a = settle(&vm, a, instance, END - 2);
    a = settle(&vm, a, instance, END - 1);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 0);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 247), END);
    assert_eq!(read64(&account(&a, reg(instance)).data, 120 + 138), 1);
    let x = exit_ix(&a, instance, 0, BOOT);
    a = execute(&vm, a, x, "POST_EMISSION_EXIT");
    assert_eq!(
        read64(&account(&a, pos(instance, 0)).data, 120 + 158),
        END + 2
    );
    let t = transfer_ix(&a, instance, OTHER);
    let r = vm.process_instruction(&t, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    clock_at(&mut vm, &mut a, start + (END as i64 + 2) * 3600);
    let t = transfer_ix(&a, instance, OTHER);
    a = execute(&vm, a, t, "POST_EMISSION_TRANSFER");
    assert_eq!(read64(&account(&a, pda(b"treasury")).data, 120 + 24), N);
    assert_eq!(read64(&account(&a, pda(b"treasury")).data, 120 + 16), 0);
}

#[test]
fn stake_derives_weight_from_actual_root_and_rejects_owner_revision_and_duplicate_entitlement() {
    let (mut vm, mut a, instance, start) = setup();
    a = create_lab_ata(&vm, a, OTHER);
    clock_at(&mut vm, &mut a, start + 1);
    for case in 0..9 {
        let mut bad = a.clone();
        let mut s = stake_ix(&bad, instance, 0, BOOT, BOOT);
        match case {
            0 => account_mut(&mut bad, root(instance)).owner = SYSTEM,
            1 => account_mut(&mut bad, root(instance)).data[120 + 164..120 + 168]
                .copy_from_slice(&500_000u32.to_le_bytes()),
            2 => account_mut(&mut bad, root(instance)).data[120 + 168..120 + 176]
                .copy_from_slice(&240_000u64.to_le_bytes()),
            3 => s = stake_ix(&bad, instance, 0, OTHER, OTHER),
            4 => s.data[WIRE_HEADER + 32..WIRE_HEADER + 40].copy_from_slice(&1u64.to_le_bytes()),
            5 => s.data[WIRE_HEADER + 56..WIRE_HEADER + 88].fill(0),
            6 => s.accounts[PUBLIC_PREFIX + 8].is_writable = false,
            7 => account_mut(&mut bad, root(instance)).data[120 + 186..120 + 194]
                .copy_from_slice(&(start + 3600).to_le_bytes()),
            8 => account_mut(&mut bad, root(instance)).data[120 + 194..120 + 202]
                .copy_from_slice(&u64::MAX.to_le_bytes()),
            _ => unreachable!(),
        }
        let r = vm.process_instruction(&s, &bad);
        assert!(r.raw_result.is_err(), "case{case}");
        assert_eq!(r.resulting_accounts, bad);
    }
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s.clone(), "STAKE");
    let replay = vm.process_instruction(&s, &a);
    assert_eq!(replay.raw_result, Ok(()));
    assert_eq!(replay.resulting_accounts, a);
    let duplicate = stake_ix(&a, instance, 0, BOOT, BOOT);
    let r = vm.process_instruction(&duplicate, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120), 1);
}

#[test]
fn four_actual_material_roots_earn_the_cell_fee_without_preloading_any_lab() {
    let mut vm = runtime();
    let mut a = stocked(&vm);
    let mut instances = Vec::new();
    for (primitive, profile) in [(1, 0), (2, 0), (3, 0), (4, 1)] {
        let (next, instance) = manufacture_next(&vm, a, primitive, profile);
        a = next;
        instances.push(instance);
    }
    a = mining::earn_then_exit(&mut vm, a, &instances, 85);
    assert_eq!(
        read64(&account(&a, ata(&pda(b"lab-mint"), &BOOT)).data, 64),
        808_520
    );
    assert_eq!(
        read64(&account(&a, pda(b"lab-reserve")).data, 64),
        N - 808_520
    );
    assert_eq!(read64(&account(&a, pda(b"lab-mint")).data, 36), N);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120), 4);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 128), 86);
    for instance in instances {
        let p = &account(&a, pos(instance, 0)).data;
        assert_eq!(read64(p, 120 + 231), 202_130);
        assert_eq!(read64(p, 120 + 239), 202_130);
        assert_eq!(read64(p, 120 + 158), 86);
        assert_eq!(read64(&account(&a, reg(instance)).data, 120 + 138), 1);
    }
    let b = &account(&a, pda(b"treasury")).data;
    assert_eq!(read64(b, 128), 0);
    assert_eq!(read64(b, 136), 0);
    assert_eq!(read64(b, 168), 808_520);
}

#[test]
fn one_transaction_can_materialize_and_transfer_and_a_later_failure_reverts_both() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "STAKE");
    clock_at(&mut vm, &mut a, start + 7201);
    a = settle(&vm, a, instance, 0);
    add_empty(&mut a, hour(1));
    a = mining::apply_pending_events(&vm, a, 1);
    let o = open_ix(&a, 1);
    a = execute(&vm, a, o, "OPEN");
    let m = mat_ix(&a, instance, 1);
    let mut c = claim_root_ix(&a, instance, 0, BOOT, BOOT, 0, 2378);
    c.data[112..120].copy_from_slice(&(next(&a, BOOT) + 1).to_le_bytes());
    let bad = Instruction {
        program_id: PROGRAM,
        accounts: vec![],
        data: vec![0],
    };
    assert!(legacy_packet_size(&[m.clone(), c.clone(), bad.clone()]) <= 1232);
    let r = vm.process_transaction_instructions(&[m.clone(), c.clone(), bad], &a, Some(&BOOT));
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 0);
    let r = vm.process_transaction_instructions(&[m, c.clone()], &a, Some(&BOOT));
    println!(
        "SETTLE_MATERIALIZE_CLAIM_TX cu={}",
        r.compute_units_consumed
    );
    assert_eq!(r.raw_result, Ok(()));
    a = r.resulting_accounts;
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 2378);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 239), 2378);
    assert_eq!(
        read64(&account(&a, ata(&pda(b"lab-mint"), &BOOT)).data, 64),
        2378
    );
    let replay = vm.process_instruction(&c, &a);
    assert_eq!(replay.raw_result, Ok(()));
    assert_eq!(replay.resulting_accounts, a);
}

#[test]
fn unsolicited_real_token_donation_stays_sealed_and_cannot_halt_or_increase_later_rewards() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "STAKE");
    clock_at(&mut vm, &mut a, start + 7201);
    a = settle(&vm, a, instance, 0);
    a = settle(&vm, a, instance, 1);
    let c = claim_root_ix(&a, instance, 0, BOOT, BOOT, 0, 2378);
    a = execute(&vm, a, c, "CLAIM");
    let destination = ata(&pda(b"lab-mint"), &BOOT);
    let mut data = vec![12];
    data.extend_from_slice(&1u64.to_le_bytes());
    data.push(6);
    let donation = Instruction {
        program_id: token::ID,
        accounts: vec![
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(pda(b"lab-mint"), false),
            AccountMeta::new(pda(b"lab-reserve"), false),
            AccountMeta::new_readonly(BOOT, true),
        ],
        data,
    };
    a = execute(&vm, a, donation, "UNSOLICITED_DONATION");
    let b = &account(&a, pda(b"treasury")).data;
    let booked: u64 = (0..4).map(|i| read64(b, 120 + i * 8)).sum();
    assert_eq!(
        read64(&account(&a, pda(b"lab-reserve")).data, 64) - booked,
        1
    );
    clock_at(&mut vm, &mut a, start + 10801);
    a = settle(&vm, a, instance, 2);
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 4756);
    let c = claim_root_ix(&a, instance, 0, BOOT, BOOT, 2378, 4756);
    a = execute(&vm, a, c, "CLAIM_AFTER_DONATION");
    assert_eq!(read64(&account(&a, destination).data, 64), 4755);
    assert_eq!(read64(&account(&a, pda(b"lab-reserve")).data, 64), N - 4755);
    let b = &account(&a, pda(b"treasury")).data;
    assert_eq!(read64(b, 120 + 48), 4756);
    let booked: u64 = (0..4).map(|i| read64(b, 120 + i * 8)).sum();
    assert_eq!(
        read64(&account(&a, pda(b"lab-reserve")).data, 64) - booked,
        1
    );
}

#[test]
fn econ3_ended_historical_roots_are_not_accounts_in_any_later_hour() {
    let mut vm = runtime();
    let mut a = stocked(&vm);
    let mut roots = Vec::new();
    for (primitive, profile) in [(1, 0), (2, 0), (3, 0), (4, 1)] {
        let (next, instance) = manufacture_next(&vm, a, primitive, profile);
        a = next;
        roots.push(instance);
    }
    a = mining::earn_then_exit(&mut vm, a, &roots, 1);
    let start = mining::local_start(&a);
    clock_at(&mut vm, &mut a, start + 3 * 3600 + 1);
    a = mining::settle_hour(&vm, a, 2); // apply the four END events exactly once
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120), 4);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120 + 64), 0);
    clock_at(&mut vm, &mut a, start + 4 * 3600 + 1);
    add_empty(&mut a, hour(3));
    let q = read64(&account(&a, pda(b"mining")).data, 120 + 48);
    add_empty(&mut a, mining::event_key(q));
    let o = mining::open_ix(&a, 3);
    let old = roots
        .iter()
        .flat_map(|r| [reg(*r), pos(*r, 0), root(*r)])
        .collect::<Vec<_>>();
    assert!(o.accounts.iter().all(|m| !old.contains(&m.pubkey)));
    a = execute(&vm, a, o, "ACTIVE_EMPTY_OPEN");
    let m = mining::materialize_ix(&a, 3);
    assert_eq!(m.accounts.len(), PUBLIC_PREFIX + 6);
    assert!(m.accounts.iter().all(|m| !old.contains(&m.pubkey)));
    a = execute(&vm, a, m, "ACTIVE_EMPTY_MATERIALIZE");
    assert_eq!(read64(&account(&a, hour(3)).data, 120 + 16), 0);
    assert_eq!(read64(&account(&a, hour(3)).data, 120 + 49), 0);
    assert_eq!(read64(&account(&a, hour(3)).data, 120 + 265), 1_426_940_640);
}

#[test]
fn econ3_cannot_open_before_the_complete_event_prefix_or_skip_a_linked_member() {
    let (mut vm, mut a, instance, start) = setup();
    clock_at(&mut vm, &mut a, start + 1);
    let s = stake_ix(&a, instance, 0, BOOT, BOOT);
    a = execute(&vm, a, s, "STAKE");
    clock_at(&mut vm, &mut a, start + 7201);
    a = mining::settle_hour(&vm, a, 0);
    add_empty(&mut a, hour(1));
    let omitted = mining::open_ix(&a, 1);
    let r = vm.process_instruction(&omitted, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let mut p = 1u64.to_le_bytes().to_vec();
    p.extend_from_slice(&1u64.to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix();
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new_readonly(mining::event_key(1), false),
        AccountMeta::new(dir(0), false),
        AccountMeta::new_readonly(pos(instance, 0), false),
    ]);
    let wrong = ix(24, next(&a, BOOT), p, m, BOOT);
    let r = vm.process_instruction(&wrong, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    a = mining::apply_pending_events(&vm, a, 1);
    let o = mining::open_ix(&a, 1);
    a = execute(&vm, a, o, "OPEN");
    let mut corrupt = a.clone();
    account_mut(&mut corrupt, dir(0)).data[120 + 130..120 + 138]
        .copy_from_slice(&0u64.to_le_bytes());
    let bad = mining::materialize_ix(&corrupt, 1);
    let r = vm.process_instruction(&bad, &corrupt);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, corrupt);
    let good = mining::materialize_ix(&a, 1);
    a = execute(&vm, a, good, "MATERIALIZE");
    assert_eq!(read64(&account(&a, pos(instance, 0)).data, 120 + 231), 2378);
}

#[test]
fn econ3_open_hour_membership_cannot_be_changed_by_new_stake_or_exit() {
    let mut vm = runtime();
    let mut a = stocked(&vm);
    let (next_accounts, first) = manufacture_next(&vm, a, 1, 0);
    let (next_accounts, second) = manufacture_next(&vm, next_accounts, 2, 0);
    a = next_accounts;
    let start = mining::local_start(&a);
    clock_at(&mut vm, &mut a, start + 1);
    a = mining::stake(&vm, a, first, BOOT, BOOT);
    clock_at(&mut vm, &mut a, start + 7201);
    a = mining::settle_hour(&vm, a, 0);
    a = mining::apply_pending_events(&vm, a, 1);
    add_empty(&mut a, hour(1));
    let q = read64(&account(&a, pda(b"mining")).data, 120 + 48);
    add_empty(&mut a, mining::event_key(q));
    let o = mining::open_ix(&a, 1);
    a = execute(&vm, a, o, "FROZEN_OPEN");
    let frozen_hour = account(&a, hour(1)).data.clone();
    let frozen_directory = account(&a, dir(0)).data.clone();
    // Both operations run after OPEN, at actual hour2. They may only append
    // events for boundary3; neither can mutate the saved hour1 membership.
    a = mining::stake(&vm, a, second, BOOT, BOOT);
    a = mining::exit(&vm, a, first, BOOT);
    assert_eq!(account(&a, hour(1)).data, frozen_hour);
    assert_eq!(account(&a, dir(0)).data, frozen_directory);
    assert_eq!(account(&a, dir(1)).data[120 + 81], 0);
    for seq in [1, 2] {
        assert_eq!(
            read64(&account(&a, mining::event_key(seq)).data, 120 + 8),
            3
        );
    }
    // The real next Event cannot be applied early by naming the open hour.
    let mut p = 1u64.to_le_bytes().to_vec();
    p.extend_from_slice(&1u64.to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut metas = prefix();
    metas.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new_readonly(mining::event_key(1), false),
        AccountMeta::new(dir(1), false),
        AccountMeta::new_readonly(pos(second, 0), false),
        AccountMeta::new(dir(0), false),
    ]);
    let early = ix(24, next(&a, BOOT), p, metas, BOOT);
    let r = vm.process_instruction(&early, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let m = mining::materialize_ix(&a, 1);
    a = execute(&vm, a, m, "FROZEN_MATERIALIZE");
    assert_eq!(read64(&account(&a, pos(first, 0)).data, 120 + 231), 2378);
    assert_eq!(read64(&account(&a, pos(second, 0)).data, 120 + 231), 0);
    assert_eq!(
        &account(&a, hour(1)).data[120 + 217..120 + 249],
        &frozen_hour[120 + 217..120 + 249]
    );
    clock_at(&mut vm, &mut a, start + 10801);
    a = mining::settle_hour(&vm, a, 2);
    clock_at(&mut vm, &mut a, start + 14401);
    a = mining::settle_hour(&vm, a, 3);
    assert_eq!(read64(&account(&a, pos(first, 0)).data, 120 + 231), 4756);
    assert_eq!(read64(&account(&a, pos(second, 0)).data, 120 + 231), 2378);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120 + 72), 1);
}

#[test]
fn econ3_final_hour_rent_returns_only_to_original_payer_and_old_debt_survives_close() {
    let (mut vm, mut a, instance, start) = setup();
    a = create_lab_ata(&vm, a, OTHER);
    clock_at(&mut vm, &mut a, start + 1);
    a = mining::stake(&vm, a, instance, BOOT, BOOT);
    clock_at(&mut vm, &mut a, start + 7201);
    a = mining::settle_hour(&vm, a, 0);
    a = mining::apply_pending_events(&vm, a, 1);
    add_empty(&mut a, hour(1));
    let open = mining::open_ix(&a, 1);
    a = execute(&vm, a, open, "RENT_OPEN");
    let early = close_ix(&a, 1, OTHER, BOOT);
    let r = vm.process_instruction(&early, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let mat = mining::materialize_ix(&a, 1);
    a = execute(&vm, a, mat, "RENT_MATERIALIZE");
    // A closer cannot redirect the original opener's rent to itself.
    let wrong = close_ix(&a, 1, OTHER, OTHER);
    let r = vm.process_instruction(&wrong, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let close = close_ix(&a, 1, OTHER, BOOT);
    assert!(legacy_packet_size(&[close.clone()]) <= 1232);
    let mut corrupted = a.clone();
    account_mut(&mut corrupted, hour(1)).data[120 + 265] ^= 1;
    let r = vm.process_instruction(&close, &corrupted);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, corrupted);
    // A later instruction failure reverts the refund, data deletion, Registry
    // highwater and ActorNonce together in a real transaction.
    let bad = Instruction {
        program_id: PROGRAM,
        accounts: vec![],
        data: vec![0],
    };
    let r = vm.process_transaction_instructions(&[close.clone(), bad], &a, Some(&OTHER));
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let refund = account(&a, hour(1)).lamports;
    assert_eq!(refund, 4_245_600); // Hour18/schema4 adds one authenticated lazy byte.
    let original_before = account(&a, BOOT).lamports;
    let closer_before = account(&a, OTHER).lamports;
    let debt_before = account(&a, pos(instance, 0)).data.clone();
    a = execute(&vm, a, close.clone(), "RENT_CLOSE_OTHER");
    assert_eq!(account(&a, BOOT).lamports, original_before + refund);
    assert!(account(&a, OTHER).lamports < closer_before); // pays only its own first nonce rent
    assert_eq!(account(&a, hour(1)).lamports, 0);
    assert_eq!(account(&a, hour(1)).owner, SYSTEM);
    assert!(account(&a, hour(1)).data.is_empty());
    assert_eq!(account(&a, pos(instance, 0)).data, debt_before);
    // Exact retry does not return rent twice; another nonce cannot close again.
    let r = vm.process_instruction(&close, &a);
    assert_eq!(r.raw_result, Ok(()));
    assert_eq!(r.resulting_accounts, a);
    let double = close_ix(&a, 1, OTHER, BOOT);
    let r = vm.process_instruction(&double, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let reopen = mining::open_ix(&a, 1);
    let r = vm.process_instruction(&reopen, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let claim = claim_root_ix(&a, instance, 0, BOOT, BOOT, 0, 2378);
    a = execute(&vm, a, claim, "CLAIM_AFTER_HOUR_CLOSE");
    assert_eq!(
        read64(&account(&a, ata(&pda(b"lab-mint"), &BOOT)).data, 64),
        2378
    );
    // Self-close uses prefix actor directly, with no forbidden duplicate meta.
    let close_zero = close_ix(&a, 0, BOOT, BOOT);
    assert_eq!(close_zero.accounts.len(), PUBLIC_PREFIX + 2);
    let balance = account(&a, BOOT).lamports;
    let zero_rent = account(&a, hour(0)).lamports;
    a = execute(&vm, a, close_zero, "RENT_CLOSE_SELF");
    assert_eq!(account(&a, BOOT).lamports, balance + zero_rent);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 128), 2);
}

#[test]
fn real_cell_consumption_preserves_unpaid_component_beneficiary_debt() {
    let mut vm = runtime();
    vm.compute_budget.heap_size = 262144; // actual staged synthesis, unlike ordinary-only tests
    let mut a = stocked(&vm);
    let mut roots = Vec::new();
    for (primitive, profile) in [(1, 0), (2, 0), (3, 0), (4, 1)] {
        let (next_accounts, instance) = manufacture_next(&vm, a, primitive, profile);
        a = next_accounts;
        roots.push(instance);
    }
    let start = mining::local_start(&a);
    clock_at(&mut vm, &mut a, start + 1);
    a = create_lab_ata(&vm, a, BOOT);
    for id in &roots {
        a = mining::stake(&vm, a, *id, BOOT, BOOT);
    }
    clock_at(&mut vm, &mut a, start + 85 * 3600 + 1);
    for id in &roots {
        a = mining::exit(&vm, a, *id, BOOT);
    }
    clock_at(&mut vm, &mut a, start + 86 * 3600 + 1);
    a = mining::settle_through(&vm, a, 86);
    // All 808520 atoms are earned by actual material Roots. Draw exactly the
    // 800000 manufacturing fee, leaving a real 8520 liability in old Position0.
    for (n, id) in roots.iter().enumerate() {
        assert_eq!(read64(&account(&a, pos(*id, 0)).data, 351), 202130);
        let upto = if n == 0 { 193610 } else { 202130 };
        let claim = claim_root_ix(&a, *id, 0, BOOT, BOOT, 0, upto);
        a = execute(&vm, a, claim, "PRE_UPGRADE_CLAIM");
    }
    let wallet = ata(&pda(b"lab-mint"), &BOOT);
    assert_eq!(read64(&account(&a, wallet).data, 64), 800000);
    let old_position = account(&a, pos(roots[0], 0)).data.clone();
    let prepared = verify_cell_isolated(&vm, a, &roots);
    let (next_accounts, cell, _) = synthesis::finalize(&vm, prepared, 800000);
    a = next_accounts;
    assert_eq!(read64(&account(&a, wallet).data, 64), 0);
    assert_eq!(account(&a, pos(roots[0], 0)).data, old_position);
    assert_eq!(account(&a, root(cell)).data[362], 0);
    for id in &roots {
        assert_eq!(account(&a, root(*id)).data[362], 1);
        assert_eq!(account(&a, reg(*id)).data[120 + 154], 2);
    }
    let claim = claim_root_ix(&a, roots[0], 0, BOOT, BOOT, 193610, 202130);
    a = execute(&vm, a, claim.clone(), "OLD_DEBT_AFTER_CONSUMPTION");
    assert_eq!(read64(&account(&a, wallet).data, 64), 8520);
    assert_eq!(read64(&account(&a, pda(b"lab-mint")).data, 36), N - 800000);
    assert_eq!(
        read64(&account(&a, pda(b"lab-reserve")).data, 64),
        N - 808520
    );
    let replay = vm.process_instruction(&claim, &a);
    assert_eq!(replay.raw_result, Ok(()));
    assert_eq!(replay.resulting_accounts, a);
    // Replay queued ENDs once and begin the new CELL interval. Its active list
    // replaces the four consumed components; old unpaid/paid history is intact.
    a = mining::stake(&vm, a, cell, BOOT, BOOT);
    clock_at(&mut vm, &mut a, start + 88 * 3600 + 1);
    a = mining::settle_through(&vm, a, 88);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120), 5);
    assert_eq!(read64(&account(&a, pda(b"mining")).data, 120 + 64), 1);
    assert_eq!(read64(&account(&a, pos(cell, 0)).data, 351), 15696);
    assert_eq!(read64(&account(&a, pos(roots[0], 0)).data, 359), 202130);
    println!("SETTLE_TRUE_UPGRADE earned808520 burned800000 oldDebtClaimed8520 newCellHour15696");
}
