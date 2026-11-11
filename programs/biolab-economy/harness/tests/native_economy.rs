//! Real SBF acceptance cases; reusable native fixtures live in support.
mod support;
use support::*;

// Account-body offsets remain fixed; only the public frame/suffix change.
fn payload_at() -> usize { if cfg!(feature="production-fixture") {152} else {128} }
fn legacy_suffix_at(n: usize) -> usize { n + usize::from(cfg!(feature="production-fixture")) }

#[test]
fn actual_classic_genesis_has_fixed_supply_revoked_authorities_and_canonical_reserve() {
    let vm = runtime();
    let a = initialized(&vm);
    let mint = account(&a, pda(b"lab-mint"));
    assert_eq!(mint.owner, token::ID);
    assert_eq!(mint.data.len(), 82);
    assert_eq!(read64(&mint.data, 36), N);
    assert_eq!(&mint.data[..4], &[0; 4]);
    assert_eq!(mint.data[44], 6);
    assert_eq!(&mint.data[46..50], &[0; 4]);
    let reserve = account(&a, pda(b"lab-reserve"));
    assert_eq!(read64(&reserve.data, 64), N);
    assert_eq!(&reserve.data[32..64], pda(b"lab-auth").as_ref());
    assert_eq!(read64(&account(&a, nonce(&BOOT)).data, 120), 1);
    println!("CLASSIC_TOKEN_ELF sha256={:x}", Sha256::digest(token::ELF));
}

#[test]
fn latest_nonce_replay_only_needs_actor_nonce_config_key_and_instructions_sysvar() {
    let vm = runtime();
    let a = initialized(&vm);
    let mut ix = init_ix(0);
    ix.accounts.truncate(4);
    ix.accounts[1].is_writable = false;
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    assert_eq!(r.resulting_accounts, a);
    assert_eq!(r.return_data.len(), 72);
    let mut conflict = ix;
    conflict.data[160] ^= 1;
    let r = vm.process_instruction(&conflict, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy BIOECON2 bare-BURN test adapter is deliberately absent from the production ABI; real FINAL burn is covered by native_synthesis and complete cold lifecycle")]
fn actual_claim_and_fee_burn_transfer_and_destroy_real_classic_tokens() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    let claim = vm.process_instruction(&claim_ix(1, 0, 4_000_000), &a);
    println!(
        "ECON_CLAIM cu={} raw={:?}",
        claim.compute_units_consumed, claim.raw_result
    );
    assert_eq!(claim.raw_result, Ok(()));
    let a = claim.resulting_accounts;
    assert_eq!(read64(&account(&a, DEST).data, 64), 4_000_000);
    assert_eq!(
        read64(&account(&a, pda(b"lab-reserve")).data, 64),
        N - 4_000_000
    );
    assert_eq!(read64(&account(&a, position()).data, 120 + 239), 4_000_000);
    let burn = vm.process_instruction(&burn_ix(2, 1), &a);
    println!(
        "ECON_BURN cu={} raw={:?}",
        burn.compute_units_consumed, burn.raw_result
    );
    assert_eq!(burn.raw_result, Ok(()));
    let a = burn.resulting_accounts;
    assert_eq!(read64(&account(&a, DEST).data, 64), 3_200_000);
    assert_eq!(read64(&account(&a, pda(b"lab-mint")).data, 36), N - 800_000);
    assert_eq!(
        read64(&account(&a, pda(b"treasury")).data, 120 + 32),
        800_000
    );
}

#[test]
fn position_paid_cas_and_latest_nonce_prevent_double_payment() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    let ix = claim_ix(1, 0, 3_000_000);
    let first = vm.process_instruction(&ix, &a);
    assert_eq!(first.raw_result, Ok(()));
    let a = first.resulting_accounts;
    let retry = vm.process_instruction(&ix, &a);
    assert_eq!(retry.raw_result, Ok(()));
    assert_eq!(retry.resulting_accounts, a);
    let race = vm.process_instruction(&claim_ix(2, 0, 4_000_000), &a);
    assert!(race.raw_result.is_err());
    assert_eq!(race.resulting_accounts, a);
    let partial = vm.process_instruction(&claim_ix(2, 3_000_000, 4_000_000), &a);
    assert_eq!(partial.raw_result, Ok(()));
    assert_eq!(
        read64(&account(&partial.resulting_accounts, DEST).data, 64),
        4_000_000
    );
    let old = vm.process_instruction(&ix, &partial.resulting_accounts);
    assert!(old.raw_result.is_err());
    assert_eq!(old.resulting_accounts, partial.resulting_accounts);
}

#[test]
fn wrong_signer_config_domain_token_owner_and_destination_all_roll_back() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    for case in 0..7 {
        let mut ix = claim_ix(1, 0, 4_000_000);
        let mut bad = a.clone();
        match case {
            0 => ix.accounts[0].is_signer = false,
            1 => ix.data[16] ^= 1,
            2 => ix.data[48] ^= 1,
            3 => account_mut(&mut bad, DEST).owner = SYSTEM,
            4 => account_mut(&mut bad, DEST).data[32] ^= 1,
            5 => account_mut(&mut bad, pda(b"lab-reserve")).data[72] = 1,
            6 => account_mut(&mut bad, pda(b"econ-config")).owner = SYSTEM,
            _ => unreachable!(),
        };
        let r = vm.process_instruction(&ix, &bad);
        assert!(r.raw_result.is_err(), "case{case} unexpectedly accepted");
        assert_eq!(r.resulting_accounts, bad);
    }
}

#[test]
fn a_later_native_instruction_failure_rolls_back_earlier_real_token_transfer() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    let good = claim_ix(1, 0, 4_000_000);
    let mut bad = burn_ix(2, 1);
    bad.data[0] = 0;
    let r = vm.process_transaction_instructions(&[good, bad], &a, Some(&BOOT));
    println!(
        "ECON_ATOMIC cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
fn substituted_token_program_fake_pda_readonly_or_missing_authority_are_rejected() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    for case in 0..5 {
        let mut ix = claim_ix(1, 0, 4_000_000);
        let mut bad = a.clone();
        match case {
            0 => {
                let fake = Pubkey::new_from_array([0xa1; 32]);
                ix.accounts[5].pubkey = fake;
                bad.push((
                    fake,
                    Account {
                        lamports: 1,
                        owner: NATIVE,
                        executable: true,
                        ..Default::default()
                    },
                ));
            }
            1 => {
                let fake = Pubkey::new_from_array([0xa2; 32]);
                ix.accounts[legacy_suffix_at(9)].pubkey = fake;
                bad.push((fake, Account::default()));
            }
            2 => ix.accounts[1].is_writable = false,
            3 => account_mut(&mut bad, pda(b"lab-mint")).data[46] = 1,
            4 => account_mut(&mut bad, DEST).data[108] = 2,
            _ => unreachable!(),
        }
        let result = vm.process_instruction(&ix, &bad);
        assert!(result.raw_result.is_err(), "case{case} accepted");
        assert_eq!(result.resulting_accounts, bad);
    }
}

#[test]
fn nonce_gap_and_separate_actor_paid_cas_cannot_create_second_claim() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    let gap = vm.process_instruction(&claim_ix(3, 0, 4_000_000), &a);
    assert!(gap.raw_result.is_err());
    assert_eq!(gap.resulting_accounts, a);
    let first = vm.process_instruction(&claim_ix(1, 0, 3_000_000), &a);
    assert_eq!(first.raw_result, Ok(()));
    let mut a = first.resulting_accounts;
    let other = Pubkey::new_from_array([
        0x3d, 0x40, 0x17, 0xc3, 0xe8, 0x43, 0x89, 0x5a, 0x92, 0xb7, 0x0a, 0xa7, 0x4d, 0x1b, 0x7e,
        0xbc, 0x9c, 0x98, 0x2c, 0xcf, 0x2e, 0xc4, 0x96, 0x8c, 0xc0, 0xcd, 0x55, 0xf1, 0x2a, 0xf4,
        0x66, 0x0c,
    ]);
    a.push((
        other,
        Account {
            lamports: 1_000_000_000,
            owner: SYSTEM,
            ..Default::default()
        },
    ));
    a.push((nonce(&other), Account::default()));
    let mut ix = claim_ix(0, 0, 4_000_000);
    ix.accounts[0].pubkey = other;
    ix.accounts[1].pubkey = nonce(&other);
    ix.data[80..112].copy_from_slice(other.as_ref());
    ix.data[payload_at() + 80..payload_at() + 112].copy_from_slice(other.as_ref());
    let race = vm.process_instruction(&ix, &a);
    assert!(race.raw_result.is_err());
    assert_eq!(race.resulting_accounts, a);
    ix.data[payload_at() + 32..payload_at() + 40].copy_from_slice(&3_000_000u64.to_le_bytes());
    let valid = vm.process_instruction(&ix, &a);
    assert_eq!(valid.raw_result, Ok(()));
    assert_eq!(
        read64(&account(&valid.resulting_accounts, DEST).data, 64),
        4_000_000
    );
    assert_eq!(
        read64(&account(&valid.resulting_accounts, nonce(&other)).data, 120),
        1
    );
}

#[test]
fn malformed_position_weight_bounds_and_wrong_account_owner_never_authorize_payment() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    for case in 0..4 {
        let mut bad = a.clone();
        let p = account_mut(&mut bad, position());
        match case {
            0 => p.owner = SYSTEM,
            1 => p.data[120 + 133] ^= 1,
            2 => p.data[120 + 128..120 + 132].copy_from_slice(&1_000_001u32.to_le_bytes()),
            3 => p.data[120 + 157] = 2,
            _ => unreachable!(),
        };
        let r = vm.process_instruction(&claim_ix(1, 0, 4_000_000), &bad);
        assert!(r.raw_result.is_err());
        assert_eq!(r.resulting_accounts, bad);
    }
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy BIOECON2 bare-BURN test adapter is deliberately absent from the production ABI; real FINAL burn is covered by native_synthesis and complete cold lifecycle")]
fn actual_token_cpi_failure_and_insufficient_fee_balance_leave_nonce_and_supply_unchanged() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    let claimed = vm.process_instruction(&claim_ix(1, 0, 4_000_000), &a);
    assert_eq!(claimed.raw_result, Ok(()));
    let a = claimed.resulting_accounts;
    let low = vm.process_instruction(&burn_ix(2, 3), &a);
    assert!(low.raw_result.is_err());
    assert_eq!(low.resulting_accounts, a);
    // Classic Token prioritizes a matching delegate, whose allowance is0 here.
    // The BIO owner guard passes, then the genuine Token CPI rejects the burn.
    let mut delegated = a.clone();
    let d = &mut account_mut(&mut delegated, DEST).data;
    d[72..76].copy_from_slice(&1u32.to_le_bytes());
    d[76..108].copy_from_slice(BOOT.as_ref());
    d[121..129].copy_from_slice(&0u64.to_le_bytes());
    let r = vm.process_instruction(&burn_ix(2, 1), &delegated);
    println!(
        "ECON_TOKEN_REJECT cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, delegated);
}

#[test]
fn second_genesis_and_external_classic_mint_or_reserve_withdrawal_cannot_succeed() {
    let vm = runtime();
    let a = initialized(&vm);
    let repeat = vm.process_instruction(&init_ix(1), &a);
    assert!(repeat.raw_result.is_err());
    assert_eq!(repeat.resulting_accounts, a);
    let mut mint_data = vec![14];
    mint_data.extend_from_slice(&1u64.to_le_bytes());
    mint_data.push(6);
    let mint_ix = Instruction {
        program_id: token::ID,
        accounts: vec![
            AccountMeta::new(pda(b"lab-mint"), false),
            AccountMeta::new(pda(b"lab-reserve"), false),
            AccountMeta::new_readonly(BOOT, true),
        ],
        data: mint_data,
    };
    let external = vm.process_instruction(&mint_ix, &a);
    assert!(external.raw_result.is_err());
    assert_eq!(external.resulting_accounts, a);
    let mut claim_accounts = accrued_fixture(&vm, 1_000_000);
    let mut transfer_data = vec![12];
    transfer_data.extend_from_slice(&1u64.to_le_bytes());
    transfer_data.push(6);
    let unauthorized = Instruction {
        program_id: token::ID,
        accounts: vec![
            AccountMeta::new(pda(b"lab-reserve"), false),
            AccountMeta::new_readonly(pda(b"lab-mint"), false),
            AccountMeta::new(DEST, false),
            AccountMeta::new_readonly(BOOT, true),
        ],
        data: transfer_data,
    };
    let rejected = vm.process_instruction(&unauthorized, &claim_accounts);
    assert!(rejected.raw_result.is_err());
    assert_eq!(rejected.resulting_accounts, claim_accounts);
    claim_accounts.clear();
}

#[test]
fn malformed_adapters_never_expose_an_admin_entitlement_or_cancel_path() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 4_000_000);
    for case in 0..5 {
        let mut ix = claim_ix(1, 0, 4_000_000);
        match case {
            0 => ix.data[8] = 255,
            1 => ix.data[9] = 1,
            2 => ix.data[payload_at() - 4] = 1,
            3 => ix.data.push(0),
            4 => ix.data[payload_at() - 8] = 0,
            _ => unreachable!(),
        };
        let result = vm.process_instruction(&ix, &a);
        assert!(result.raw_result.is_err());
        assert_eq!(result.resulting_accounts, a);
    }
}

#[test]
fn init_rent_cap_and_prefunded_canonical_accounts_use_only_entry_balance() {
    let vm = runtime();
    let a = fixture();
    let mut cap = init_ix(0);
    cap.data[payload_at() + 32..payload_at() + 40].copy_from_slice(&0u64.to_le_bytes());
    let rejected = vm.process_instruction(&cap, &a);
    assert!(rejected.raw_result.is_err());
    assert_eq!(rejected.resulting_accounts, a);
    let mut poor = a.clone();
    account_mut(&mut poor, BOOT).lamports = 1;
    let rejected = vm.process_instruction(&init_ix(0), &poor);
    assert!(rejected.raw_result.is_err());
    assert_eq!(rejected.resulting_accounts, poor);
    let mut prefunded = a;
    for (key, len) in [
        (pda(b"econ-config"), 424),
        (pda(b"lab-mint"), 82),
        (pda(b"lab-reserve"), 165),
        (pda(b"treasury"), 184),
        (nonce(&BOOT), 418),
    ] {
        account_mut(&mut prefunded, key).lamports = vm.sysvars.rent.minimum_balance(len);
    }
    #[cfg(feature="production-fixture")]
    { account_mut(&mut prefunded, pda(b"config")).lamports = vm.sysvars.rent.minimum_balance(1048); }
    let before = account(&prefunded, BOOT).lamports;
    let accepted = vm.process_instruction(&cap, &prefunded);
    assert_eq!(accepted.raw_result, Ok(()));
    assert_eq!(account(&accepted.resulting_accounts, BOOT).lamports, before);
    assert_eq!(
        read64(
            &account(&accepted.resulting_accounts, pda(b"lab-mint")).data,
            36
        ),
        N
    );
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy BIOECON2 bare-BURN test adapter is deliberately absent from the production ABI; real FINAL burn is covered by native_synthesis and complete cold lifecycle")]
fn all_hierarchy_fee_tiers_destroy_exactly_48_lab_without_minting_or_recycling() {
    let vm = runtime();
    let a = accrued_fixture(&vm, 48_000_000);
    let claimed = vm.process_instruction(&claim_ix(1, 0, 48_000_000), &a);
    assert_eq!(claimed.raw_result, Ok(()));
    let mut state = claimed.resulting_accounts;
    let mut n = 2;
    for tier in std::iter::repeat_n(1, 15)
        .chain(std::iter::repeat_n(2, 6))
        .chain([3])
    {
        let paid = vm.process_instruction(&burn_ix(n, tier), &state);
        assert_eq!(paid.raw_result, Ok(()));
        state = paid.resulting_accounts;
        n += 1;
    }
    assert_eq!(n, 24);
    assert_eq!(read64(&account(&state, DEST).data, 64), 0);
    assert_eq!(
        read64(&account(&state, pda(b"lab-mint")).data, 36),
        N - 48_000_000
    );
    assert_eq!(
        read64(&account(&state, pda(b"treasury")).data, 120 + 32),
        48_000_000
    );
    assert_eq!(read64(&account(&state, nonce(&BOOT)).data, 120), 24);
    let reserve = read64(&account(&state, pda(b"lab-reserve")).data, 64);
    assert_eq!(reserve, N - 48_000_000);
}

#[test]
fn native_launch_creates_four_zero_supply_classic_mints_and_only_creation_income() {
    let vm = runtime();
    let a = launched(&vm);
    let id = project_id(1);
    for class in 1..=4 {
        let m = account(&a, material_address(&id, class, false));
        assert_eq!(m.owner, token::ID);
        assert_eq!(read64(&m.data, 36), 0);
        assert_eq!(m.data[44], 0);
        assert_eq!(&m.data[4..36], material_address(&id, class, true).as_ref());
        assert_eq!(&m.data[46..50], &[0; 4]);
    }
    let vault = account(&a, pda(b"ops"));
    assert_eq!(vault.owner, PROGRAM);
    assert_eq!(vault.data.len(), 136);
    assert_eq!(
        vault.lamports,
        vm.sysvars.rent.minimum_balance(136) + 10_000_000
    );
    assert!(!a.iter().any(|(k, _)| *k == season_address(1, 0)));
    assert_eq!(read64(&account(&a, pda(b"lab-mint")).data, 36), N);
}

#[test]
fn native_purchase_pays_frozen_seller_resource_fee_and_real_ata_delivery() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    a.push((
        OTHER,
        Account {
            lamports: 1_000_000_000,
            owner: SYSTEM,
            ..Default::default()
        },
    ));
    prepare_buy(&mut a, id, 1, 0, OTHER);
    let seller_before = account(&a, BOOT).lamports;
    let ops_before = account(&a, pda(b"ops")).lamports;
    let buyer_before = account(&a, OTHER).lamports;
    let ix = buy_material_ix(2, id, 1, 30, 0, OTHER, OTHER, 500_000);
    let r = vm.process_instruction(&ix, &a);
    println!(
        "ECON_BUY_ATA cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()));
    let rent = read64(&r.return_data, 24);
    let a = r.resulting_accounts;
    assert_eq!(account(&a, OTHER).lamports, buyer_before - 18_000_000);
    assert_eq!(
        account(&a, BOOT).lamports,
        seller_before + 15_000_000 - rent
    );
    assert_eq!(account(&a, pda(b"ops")).lamports, ops_before + 3_000_000);
    assert_eq!(
        read64(
            &account(&a, ata(&material_address(&id, 1, false), &OTHER)).data,
            64
        ),
        30
    );
    assert_eq!(
        read64(&account(&a, material_address(&id, 1, false)).data, 36),
        30
    );
    assert_eq!(read64(&account(&a, season_address(1, 0)).data, 123), 30);
    assert_eq!(read64(&account(&a, lifetime_address(1)).data, 121), 30);
    let retry = vm.process_instruction(&ix, &a);
    assert_eq!(retry.raw_result, Ok(()));
    assert_eq!(retry.resulting_accounts, a);
}

#[test]
fn native_self_sale_charges_resource_fee_and_requires_gross_entry_funding() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    prepare_buy(&mut a, id, 1, 0, BOOT);
    let before = account(&a, BOOT).lamports;
    let ops_before = account(&a, pda(b"ops")).lamports;
    let r = vm.process_instruction(&buy_material_ix(2, id, 1, 2, 0, BOOT, BOOT, 500_000), &a);
    assert_eq!(r.raw_result, Ok(()));
    let rent = read64(&r.return_data, 24);
    let mut a = r.resulting_accounts;
    assert_eq!(account(&a, BOOT).lamports, before - 200_000 - rent);
    assert_eq!(account(&a, pda(b"ops")).lamports, ops_before + 200_000);
    // Net self-sale cost would fit, but gross signed principal does not.
    account_mut(&mut a, BOOT).lamports = 200_000;
    let r = vm.process_instruction(&buy_material_ix(3, id, 1, 1, 0, BOOT, BOOT, 500_000), &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
fn native_purchase_rejects_wrong_signer_quote_program_mint_authority_destination_and_quota() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    a.push((
        OTHER,
        Account {
            lamports: 1_000_000_000,
            owner: SYSTEM,
            ..Default::default()
        },
    ));
    prepare_buy(&mut a, id, 1, 0, OTHER);
    for case in 0..12 {
        let mut state = a.clone();
        let mut ix = buy_material_ix(2, id, 1, 30, 0, OTHER, OTHER, 500_000);
        match case {
            0 => ix.accounts.last_mut().unwrap().is_signer = false,
            1 => ix.data[payload_at() + 234] ^= 1,
            2 => ix.data[payload_at() + 97..payload_at() + 105].copy_from_slice(&0u64.to_le_bytes()),
            3 => ix.data[payload_at() + 65] ^= 1,
            4 => {
                let fake = Pubkey::new_from_array([0xa7; 32]);
                ix.accounts[legacy_suffix_at(14)].pubkey = fake;
                state.push((
                    fake,
                    Account {
                        lamports: 1,
                        owner: NATIVE,
                        executable: true,
                        ..Default::default()
                    },
                ));
            }
            5 => {
                let fake = Pubkey::new_from_array([0xa8; 32]);
                ix.accounts[legacy_suffix_at(9)].pubkey = fake;
                state.push((fake, Account::default()));
            }
            6 => account_mut(&mut state, material_address(&id, 1, false)).data[4] ^= 1,
            7 => account_mut(&mut state, material_address(&id, 1, false)).data[46] = 1,
            8 => {
                let dest = ata(&material_address(&id, 1, false), &OTHER);
                account_mut(&mut state, dest).owner = PROGRAM;
            }
            9 => {
                let q = account_mut(&mut state, season_address(1, 0));
                q.data = vec![0];
            }
            10 => ix.data[payload_at() + 298..payload_at() + 300].copy_from_slice(&1u16.to_le_bytes()),
            11 => ix.data[payload_at() + 250..payload_at() + 258].copy_from_slice(&0u64.to_le_bytes()),
            _ => unreachable!(),
        }
        let r = vm.process_instruction(&ix, &state);
        assert!(r.raw_result.is_err(), "case{case} accepted");
        assert_eq!(r.resulting_accounts, state);
    }
}

#[test]
fn native_buy_later_instruction_failure_and_wrong_existing_ata_roll_back_all_state() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    prepare_buy(&mut a, id, 1, 0, BOOT);
    let first = buy_material_ix(2, id, 1, 1, 0, BOOT, BOOT, 500_000);
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&u64::MAX.to_le_bytes());
    let bad = Instruction {
        program_id: SYSTEM,
        accounts: vec![
            AccountMeta::new(BOOT, true),
            AccountMeta::new(pda(b"ops"), false),
        ],
        data,
    };
    assert!(legacy_packet_size(&[first.clone(), bad.clone()]) <= 1232);
    let r = vm.process_transaction_instructions(&[first, bad], &a, Some(&BOOT));
    println!(
        "ECON_BUY_ATOMIC cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    // An existing ATA-address Token account with the wrong mint is rejected before payments.
    let dest = ata(&material_address(&id, 1, false), &BOOT);
    let d = account_mut(&mut a, dest);
    d.owner = token::ID;
    d.data = vec![0; 165];
    d.data[..32].copy_from_slice(material_address(&id, 2, false).as_ref());
    d.data[32..64].copy_from_slice(BOOT.as_ref());
    d.data[108] = 1;
    d.lamports = vm.sysvars.rent.minimum_balance(165);
    let r = vm.process_instruction(&buy_material_ix(2, id, 1, 1, 0, BOOT, BOOT, 500_000), &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
fn native_two_projects_compete_for_one_global_unit_and_only_new_season_reopens_its_own_allowance() {
    let mut vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    prepare_buy(&mut a, id, 1, 0, BOOT);
    let r = vm.process_instruction(&buy_material_ix(2, id, 1, 1, 0, BOOT, BOOT, 500_000), &a);
    assert_eq!(r.raw_result, Ok(()));
    let mut a = r.resulting_accounts;
    prepare_create(&mut a, 3);
    let r = vm.process_instruction(&create_project_ix(3, 500_000, 1_000_000), &a);
    assert_eq!(r.raw_result, Ok(()));
    let mut a = r.resulting_accounts;
    let second = project_id(3);
    prepare_buy(&mut a, second, 1, 0, BOOT);
    seed_final_aa_unit(&mut a, &id);
    let r = vm.process_instruction(&buy_material_ix(4, id, 1, 1, 0, BOOT, BOOT, 500_000), &a);
    assert_eq!(r.raw_result, Ok(()));
    let a = r.resulting_accounts;
    assert_eq!(read64(&account(&a, season_address(1, 0)).data, 123), 50_000);
    let reject = vm.process_instruction(
        &buy_material_ix(5, second, 1, 1, 0, BOOT, BOOT, 500_000),
        &a,
    );
    assert!(reject.raw_result.is_err());
    assert_eq!(reject.resulting_accounts, a);
    vm.sysvars.clock.unix_timestamp = 7_862_400 + if cfg!(feature="production-fixture"){production_release::SEED_OPEN}else{0};
    let mut a = a;
    *account_mut(&mut a, CLOCK) = vm.sysvars.keyed_account_for_clock_sysvar().1;
    prepare_buy(&mut a, second, 1, 1, BOOT);
    let stale = vm.process_instruction(
        &buy_material_ix(5, second, 1, 1, 0, BOOT, BOOT, 500_000),
        &a,
    );
    assert!(stale.raw_result.is_err());
    assert_eq!(stale.resulting_accounts, a);
    let r = vm.process_instruction(
        &buy_material_ix(5, second, 1, 1, 1, BOOT, BOOT, 500_000),
        &a,
    );
    assert_eq!(r.raw_result, Ok(()));
    let a = r.resulting_accounts;
    assert_eq!(read64(&account(&a, season_address(1, 0)).data, 123), 50_000);
    assert_eq!(read64(&account(&a, season_address(1, 1)).data, 123), 1);
    assert_eq!(read64(&account(&a, lifetime_address(1)).data, 121), 50_001);
}

#[test]
fn native_external_material_burn_does_not_restore_quota_and_cannot_use_pack_authority() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    prepare_buy(&mut a, id, 1, 0, BOOT);
    let r = vm.process_instruction(&buy_material_ix(2, id, 1, 2, 0, BOOT, BOOT, 500_000), &a);
    assert_eq!(r.raw_result, Ok(()));
    let a = r.resulting_accounts;
    let mint = material_address(&id, 1, false);
    let dest = ata(&mint, &BOOT);
    let mut data = vec![15];
    data.extend_from_slice(&1u64.to_le_bytes());
    data.push(0);
    let ix = Instruction {
        program_id: token::ID,
        accounts: vec![
            AccountMeta::new(dest, false),
            AccountMeta::new(mint, false),
            AccountMeta::new_readonly(BOOT, true),
        ],
        data,
    };
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    let a = r.resulting_accounts;
    assert_eq!(read64(&account(&a, mint).data, 36), 1);
    assert_eq!(read64(&account(&a, season_address(1, 0)).data, 123), 2);
    let mut data = vec![14];
    data.extend_from_slice(&1u64.to_le_bytes());
    data.push(0);
    let ix = Instruction {
        program_id: token::ID,
        accounts: vec![
            AccountMeta::new(mint, false),
            AccountMeta::new(dest, false),
            AccountMeta::new_readonly(BOOT, true),
        ],
        data,
    };
    let r = vm.process_instruction(&ix, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let r = vm.process_instruction(&buy_material_ix(3, id, 1, 1, 0, BOOT, BOOT, 500_000), &a);
    assert_eq!(r.raw_result, Ok(()));
    let a = r.resulting_accounts;
    assert_eq!(read64(&account(&a, mint).data, 36), 2);
    assert_eq!(read64(&account(&a, season_address(1, 0)).data, 123), 3);
}

#[test]
fn native_old_successful_buy_replay_survives_issuance_end_but_new_purchase_cannot() {
    let mut vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    prepare_buy(&mut a, id, 1, 0, BOOT);
    let ix = buy_material_ix(2, id, 1, 1, 0, BOOT, BOOT, 500_000);
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    let a = r.resulting_accounts;
    vm.sysvars.clock.unix_timestamp = 788_400_000;
    let mut a = a;
    *account_mut(&mut a, CLOCK) = vm.sysvars.keyed_account_for_clock_sysvar().1;
    let retry = vm.process_instruction(&ix, &a);
    assert_eq!(retry.raw_result, Ok(()));
    assert_eq!(retry.resulting_accounts, a);
    let r = vm.process_instruction(&buy_material_ix(3, id, 1, 1, 0, BOOT, BOOT, 500_000), &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
fn native_reference_messages_fit_real_legacy_packet_size_before_signing() {
    let create = create_project_ix(1, 500_000, 1_000_000);
    let buy = buy_material_ix(2, project_id(1), 1, 30, 0, OTHER, OTHER, 500_000);
    let c = legacy_packet_size(&[create]);
    let b = legacy_packet_size(&[buy]);
    println!("ECON_PACKET create={} buy={}", c, b);
    assert!(c <= 1232 && b <= 1232);
}

#[test]
fn native_full_four_class_stock_uses_exact_30_60_15_15_without_source_or_lab_creation() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    a.push((
        OTHER,
        Account {
            lamports: 1_000_000_000,
            owner: SYSTEM,
            ..Default::default()
        },
    ));
    let before = account(&a, OTHER).lamports;
    let ops = account(&a, pda(b"ops")).lamports;
    let seller = account(&a, BOOT).lamports;
    let mut total_rent = 0;
    for (class, q, n) in [(1, 30, 2), (2, 60, 3), (3, 15, 4), (4, 15, 5)] {
        prepare_buy(&mut a, id, class, 0, OTHER);
        let ix = buy_material_ix(n, id, class, q, 0, OTHER, OTHER, 500_000);
        assert!(legacy_packet_size(&[ix.clone()]) <= 1232);
        let r = vm.process_instruction(&ix, &a);
        assert_eq!(r.raw_result, Ok(()));
        total_rent += read64(&r.return_data, 24);
        a = r.resulting_accounts;
        assert_eq!(
            read64(&account(&a, material_address(&id, class, false)).data, 36),
            q
        );
        assert_eq!(
            read64(
                &account(&a, ata(&material_address(&id, class, false), &OTHER)).data,
                64
            ),
            q
        );
    }
    assert_eq!(account(&a, OTHER).lamports, before - 72_000_000);
    assert_eq!(account(&a, pda(b"ops")).lamports, ops + 12_000_000);
    assert_eq!(account(&a, BOOT).lamports, seller + 60_000_000 - total_rent);
    assert_eq!(read64(&account(&a, pda(b"lab-mint")).data, 36), N);
    assert!(!a.iter().any(|(_, acc)| acc.owner == PROGRAM
        && acc.data.len() >= 14
        && u16::from_le_bytes(acc.data[10..12].try_into().unwrap()) == 11));
}

#[test]
fn native_buy_compute_exhaustion_rolls_back_payment_delivery_and_allocations() {
    let mut vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    prepare_buy(&mut a, id, 1, 0, BOOT);
    vm.compute_budget.compute_unit_limit = 180_000;
    let r = vm.process_instruction(&buy_material_ix(2, id, 1, 1, 0, BOOT, BOOT, 500_000), &a);
    println!(
        "ECON_BUY_BUDGET cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
fn native_new_actor_can_use_an_independently_signed_rent_payer_without_spending_actor_lamports() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    prepare_buy(&mut a, id, 1, 0, BOOT);
    a.push((
        OTHER,
        Account {
            lamports: 1_000_000_000,
            owner: SYSTEM,
            ..Default::default()
        },
    ));
    add_empty(&mut a, nonce(&OTHER));
    let mut ix = buy_material_ix(0, id, 1, 1, 0, BOOT, BOOT, 500_000);
    ix.accounts[0].pubkey = OTHER;
    ix.accounts[1].pubkey = nonce(&OTHER);
    ix.data[80..112].copy_from_slice(OTHER.as_ref());
    ix.accounts.push(AccountMeta::new(BOOT, true));
    assert!(legacy_packet_size(&[ix.clone()]) <= 1232);
    let before = account(&a, OTHER).lamports;
    let result = vm.process_instruction(&ix, &a);
    assert_eq!(result.raw_result, Ok(()));
    let a = result.resulting_accounts;
    assert_eq!(account(&a, OTHER).lamports, before);
    assert_eq!(account(&a, nonce(&OTHER)).owner, PROGRAM);
    assert_eq!(read64(&account(&a, nonce(&OTHER)).data, 120), 1);
}

#[test]
fn native_passive_material_recipient_may_be_off_curve_but_not_a_protected_authority() {
    let vm = runtime();
    let mut a = launched(&vm);
    let id = project_id(1);
    let passive =
        Pubkey::find_program_address(&[b"passive-gift"], &Pubkey::new_from_array([0x92; 32])).0;
    a.push((passive, Account::default()));
    prepare_buy(&mut a, id, 1, 0, passive);
    let ix = buy_material_ix(2, id, 1, 1, 0, BOOT, passive, 500_000);
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    let mut a = r.resulting_accounts;
    assert_eq!(
        &account(&a, ata(&material_address(&id, 1, false), &passive)).data[32..64],
        passive.as_ref()
    );
    let protected = material_address(&id, 1, true);
    prepare_buy(&mut a, id, 1, 0, protected);
    let mut ix = buy_material_ix(3, id, 1, 1, 0, BOOT, protected, 500_000);
    // Protected authority is already in the fixed table, not a second wallet.
    ix.accounts.pop();
    let rejected = vm.process_instruction(&ix, &a);
    assert!(rejected.raw_result.is_err());
    assert_eq!(rejected.resulting_accounts, a);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_three_of_five_expense_pays_exact_ops_sol_once_and_latest_retry_returns_original() {
    let vm = runtime();
    let a = queued(&vm, 3_000_000, 0, 1000);
    let old_ops = account(&a, pda(b"ops")).lamports;
    let old_recipient = account(&a, OTHER).lamports;
    let ix = pay_expense_ix(
        3,
        BOOT,
        EXPENSE_REF,
        0,
        OTHER,
        3_000_000,
        0,
        1000,
        [0, 1, 2],
        BOOT,
    );
    let bytes = legacy_packet_size(&[ix.clone()]);
    assert!(bytes <= 1232);
    let r = vm.process_instruction(&ix, &a);
    println!(
        "ECON_OPS_PAY cu={} packet={} raw={:?}",
        r.compute_units_consumed, bytes, r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()));
    assert_eq!(r.return_data.len(), 64);
    let a = r.resulting_accounts;
    assert_eq!(account(&a, pda(b"ops")).lamports, old_ops - 3_000_000);
    assert_eq!(account(&a, OTHER).lamports, old_recipient + 3_000_000);
    assert_eq!(read64(&account(&a, pda(b"ops")).data, 128), 3_000_000);
    assert_eq!(
        account(&a, expense_address(&EXPENSE_REF)).data[120 + 208],
        1
    );
    let mut retry = ix;
    retry.accounts.truncate(4);
    let r = vm.process_instruction(&retry, &a);
    assert_eq!(r.raw_result, Ok(()));
    assert_eq!(r.resulting_accounts, a);
    let r = vm.process_instruction(
        &pay_expense_ix(
            0,
            OTHER,
            EXPENSE_REF,
            0,
            OTHER,
            3_000_000,
            0,
            1000,
            [0, 1, 2],
            OTHER,
        ),
        &a,
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_queue_reserves_no_money_and_shared_nonce_and_ref_never_reset() {
    let vm = runtime();
    let a = ops_fixture(&vm);
    let balance = account(&a, pda(b"ops")).lamports;
    let ix = queue_expense_ix(2, EXPENSE_REF, 0, OTHER, u64::MAX, 0, 1000);
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    let mut a = r.resulting_accounts;
    assert_eq!(account(&a, pda(b"ops")).lamports, balance);
    assert_eq!(read64(&account(&a, pda(b"ops")).data, 120), 1);
    let retry = vm.process_instruction(&ix, &a);
    assert_eq!(retry.raw_result, Ok(()));
    assert_eq!(retry.resulting_accounts, a);
    let r = vm.process_instruction(&queue_expense_ix(3, EXPENSE_REF, 1, OTHER, 1, 0, 1000), &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let other = [10; 32];
    add_empty(&mut a, expense_address(&other));
    let r = vm.process_instruction(&queue_expense_ix(3, other, 0, OTHER, 1, 0, 1000), &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let r = vm.process_instruction(
        &pay_expense_ix(
            3,
            BOOT,
            EXPENSE_REF,
            0,
            OTHER,
            u64::MAX,
            0,
            1000,
            [0, 1, 2],
            BOOT,
        ),
        &a,
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_expense_rejects_missing_selected_signer_immutable_mutation_or_wrong_records() {
    let vm = runtime();
    let a = queued(&vm, 3_000_000, 0, 1000);
    for case in 0..10 {
        let mut state = a.clone();
        let mut ix = pay_expense_ix(
            3,
            BOOT,
            EXPENSE_REF,
            0,
            OTHER,
            3_000_000,
            0,
            1000,
            [0, 1, 2],
            BOOT,
        );
        match case {
            0 => {
                ix.accounts
                    .iter_mut()
                    .find(|m| m.pubkey == OPS_MEMBERS[0])
                    .unwrap()
                    .is_signer = false
            }
            1 => ix.data[payload_at() + 160..payload_at() + 163].copy_from_slice(&[1, 1, 2]),
            2 => ix.data[payload_at() + 104] ^= 1,
            3 => ix.data[payload_at() + 112] ^= 1,
            4 => account_mut(&mut state, pda(b"ops")).owner = SYSTEM,
            5 => account_mut(&mut state, expense_address(&EXPENSE_REF)).data[120 + 209] = 1,
            6 => account_mut(&mut state, expense_address(&EXPENSE_REF)).owner = SYSTEM,
            7 => account_mut(&mut state, OTHER).owner = token::ID,
            8 => account_mut(&mut state, pda(b"ops")).data[88] ^= 1,
            9 => ix.data[payload_at() + 64] ^= 1,
            _ => unreachable!(),
        }
        let r = vm.process_instruction(&ix, &state);
        assert!(r.raw_result.is_err(), "case{case} accepted");
        assert_eq!(r.resulting_accounts, state);
    }
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_ops_window_boundaries_and_expired_latest_success_are_exact() {
    let mut vm = runtime();
    let mut a = queued(&vm, 3_000_000, 10, 20);
    let ix = pay_expense_ix(
        3,
        BOOT,
        EXPENSE_REF,
        0,
        OTHER,
        3_000_000,
        10,
        20,
        [0, 1, 2],
        BOOT,
    );
    let early = vm.process_instruction(&ix, &a);
    assert!(early.raw_result.is_err());
    assert_eq!(early.resulting_accounts, a);
    clock_at(&mut vm, &mut a, 20);
    let expired = vm.process_instruction(&ix, &a);
    assert!(expired.raw_result.is_err());
    assert_eq!(expired.resulting_accounts, a);
    clock_at(&mut vm, &mut a, 10);
    let paid = vm.process_instruction(&ix, &a);
    assert_eq!(paid.raw_result, Ok(()));
    let mut a = paid.resulting_accounts;
    clock_at(&mut vm, &mut a, 20);
    let mut retry = ix;
    retry.accounts.truncate(4);
    let r = vm.process_instruction(&retry, &a);
    assert_eq!(r.raw_result, Ok(()));
    assert_eq!(r.resulting_accounts, a);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_ops_recipient_rent_payer_spends_entry_rent_before_receiving_payment() {
    let vm = runtime();
    let mut a = queued(&vm, 5_000_000, 0, 1000);
    let ix = pay_expense_ix(
        0,
        OTHER,
        EXPENSE_REF,
        0,
        OTHER,
        5_000_000,
        0,
        1000,
        [0, 1, 2],
        OTHER,
    );
    account_mut(&mut a, OTHER).lamports = 1_000_000;
    let r = vm.process_instruction(&ix, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let required = vm.sysvars.rent.minimum_balance(418);
    account_mut(&mut a, OTHER).lamports = required;
    let r = vm.process_instruction(&ix, &a);
    println!(
        "ECON_OPS_NEW_ACTOR cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert_eq!(r.raw_result, Ok(()));
    let a = r.resulting_accounts;
    assert_eq!(account(&a, OTHER).lamports, 5_000_000);
    assert_eq!(account(&a, nonce(&OTHER)).lamports, required);
    assert_eq!(read64(&account(&a, nonce(&OTHER)).data, 120), 1);
    assert_eq!(read64(&account(&a, nonce(&BOOT)).data, 120), 3);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_queue_rejects_nonmember_invalid_window_zero_evidence_and_rent_cap() {
    let vm = runtime();
    let a = ops_fixture(&vm);
    for case in 0..7 {
        let mut ix = queue_expense_ix(2, EXPENSE_REF, 0, OTHER, 3_000_000, 0, 1000);
        let mut state = a.clone();
        match case {
            0 => ix.data[payload_at() + 80..payload_at() + 112].fill(0),
            1 => ix.data[payload_at() + 72..payload_at() + 80].fill(0),
            2 => ix.data[payload_at() + 160..payload_at() + 168].fill(0),
            3 => ix.data[payload_at() + 120..payload_at() + 128].copy_from_slice(&604_801i64.to_le_bytes()),
            4 => ix.data[payload_at() + 112..payload_at() + 120].copy_from_slice(&(-1i64).to_le_bytes()),
            5 => {
                let n = u64::MAX;
                account_mut(&mut state, pda(b"ops")).data[120..128]
                    .copy_from_slice(&n.to_le_bytes());
                ix.data[payload_at() + 32..payload_at() + 40].copy_from_slice(&n.to_le_bytes());
            }
            6 => {
                let outsider = (1u8..=200)
                    .map(|n| Pubkey::new_from_array([n; 32]))
                    .find(|k| k.is_on_curve() && !OPS_MEMBERS.contains(k))
                    .unwrap();
                state.push((
                    outsider,
                    Account {
                        lamports: 1_000_000_000,
                        owner: SYSTEM,
                        ..Default::default()
                    },
                ));
                add_empty(&mut state, nonce(&outsider));
                ix.accounts[0].pubkey = outsider;
                ix.accounts[1].pubkey = nonce(&outsider);
                ix.data[80..112].copy_from_slice(outsider.as_ref());
                ix.data[112..120].fill(0);
                ix.accounts.push(AccountMeta::new(BOOT, true));
                ix.accounts[9..].sort_by_key(|m| m.pubkey);
            }
            _ => unreachable!(),
        }
        let r = vm.process_instruction(&ix, &state);
        assert!(r.raw_result.is_err(), "case{case} accepted");
        assert_eq!(r.resulting_accounts, state);
    }
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_ops_pay_failure_after_success_rolls_back_direct_lamports_and_paid_record() {
    let vm = runtime();
    let a = queued(&vm, 3_000_000, 0, 1000);
    let pay = pay_expense_ix(
        3,
        BOOT,
        EXPENSE_REF,
        0,
        OTHER,
        3_000_000,
        0,
        1000,
        [0, 1, 2],
        BOOT,
    );
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&u64::MAX.to_le_bytes());
    let fail = Instruction {
        program_id: SYSTEM,
        accounts: vec![AccountMeta::new(BOOT, true), AccountMeta::new(OTHER, false)],
        data,
    };
    assert!(legacy_packet_size(&[pay.clone(), fail.clone()]) <= 1232);
    let r = vm.process_transaction_instructions(&[pay, fail], &a, Some(&BOOT));
    println!(
        "ECON_OPS_ATOMIC cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_ops_two_expenses_compete_for_actual_balance_and_keep_unpaid_history() {
    let vm = runtime();
    let mut a = queued(&vm, 7_000_000, 0, 1000);
    let second = [11; 32];
    add_empty(&mut a, expense_address(&second));
    let queued = vm.process_instruction(
        &queue_expense_ix(3, second, 1, OTHER, 7_000_000, 0, 1000),
        &a,
    );
    assert_eq!(queued.raw_result, Ok(()));
    let a = queued.resulting_accounts;
    let first = vm.process_instruction(
        &pay_expense_ix(
            4,
            BOOT,
            EXPENSE_REF,
            0,
            OTHER,
            7_000_000,
            0,
            1000,
            [0, 1, 2],
            BOOT,
        ),
        &a,
    );
    assert_eq!(first.raw_result, Ok(()));
    let a = first.resulting_accounts;
    let race = vm.process_instruction(
        &pay_expense_ix(
            5,
            BOOT,
            second,
            1,
            OTHER,
            7_000_000,
            0,
            1000,
            [0, 1, 2],
            BOOT,
        ),
        &a,
    );
    assert!(race.raw_result.is_err());
    assert_eq!(race.resulting_accounts, a);
    assert_eq!(account(&a, expense_address(&second)).data[120 + 208], 0);
    assert_eq!(read64(&account(&a, pda(b"ops")).data, 120), 2);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_ops_accepts_another_valid_selected_three_but_extra_fourth_signature_is_no_substitute() {
    let vm = runtime();
    let a = queued(&vm, 3_000_000, 0, 1000);
    let alternative = pay_expense_ix(
        3,
        BOOT,
        EXPENSE_REF,
        0,
        OTHER,
        3_000_000,
        0,
        1000,
        [2, 3, 4],
        BOOT,
    );
    let r = vm.process_instruction(&alternative, &a);
    assert_eq!(r.raw_result, Ok(()));
    let mut missing = pay_expense_ix(
        3,
        BOOT,
        EXPENSE_REF,
        0,
        OTHER,
        3_000_000,
        0,
        1000,
        [0, 1, 2],
        BOOT,
    );
    missing
        .accounts
        .iter_mut()
        .find(|m| m.pubkey == OPS_MEMBERS[0])
        .unwrap()
        .is_signer = false;
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&0u64.to_le_bytes());
    let extra = Instruction {
        program_id: SYSTEM,
        accounts: vec![
            AccountMeta::new(OPS_MEMBERS[3], true),
            AccountMeta::new(OPS_MEMBERS[3], false),
        ],
        data,
    };
    assert!(legacy_packet_size(&[missing.clone(), extra.clone()]) <= 1232);
    let r = vm.process_transaction_instructions(&[missing, extra], &a, Some(&BOOT));
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}

#[test]
#[cfg_attr(feature="production-fixture",ignore="legacy fixture assumes BOOT is Ops member and Clock0; formal distinct Ops5/ExactFrame tests are native_ops_production")]
fn native_ops_passive_pda_can_receive_but_reserved_lab_authority_cannot_be_targeted() {
    let vm = runtime();
    let mut a = ops_fixture(&vm);
    let passive = Pubkey::find_program_address(
        &[b"passive-ops-recipient"],
        &Pubkey::new_from_array([0x92; 32]),
    )
    .0;
    a.push((passive, Account::default()));
    let protected = queue_expense_ix(2, EXPENSE_REF, 0, pda(b"lab-auth"), 1_000_000, 0, 1000);
    let r = vm.process_instruction(&protected, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let q = vm.process_instruction(
        &queue_expense_ix(2, EXPENSE_REF, 0, passive, 1_000_000, 0, 1000),
        &a,
    );
    assert_eq!(q.raw_result, Ok(()));
    let a = q.resulting_accounts;
    let p = vm.process_instruction(
        &pay_expense_ix(
            3,
            BOOT,
            EXPENSE_REF,
            0,
            passive,
            1_000_000,
            0,
            1000,
            [0, 1, 2],
            BOOT,
        ),
        &a,
    );
    assert_eq!(p.raw_result, Ok(()));
    assert_eq!(account(&p.resulting_accounts, passive).lamports, 1_000_000);
}
