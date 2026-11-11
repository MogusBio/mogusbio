//! Real P1/P5 complete manufacture and independent Node codec comparison.
mod support;
use support::*;

fn staged(
    vm: &Mollusk,
    a: Vec<(Pubkey, Account)>,
    plan: &ComponentPlan,
) -> (Vec<(Pubkey, Account)>, Instruction) {
    let (mut a, artifact) = put_artifact(vm, a, 501, &plan.payload);
    add_empty(&mut a, root_address(&instance_for(BOOT, plan.n)));
    for id in &plan.source_ids {
        add_empty(&mut a, source_address(id));
    }
    let ix = component_ix(&a, plan, artifact);
    (a, ix)
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
#[test]
fn real_first_component_reconciles_four_burns_sources_root_and_node934_capsule() {
    let vm = runtime();
    let a = stocked(&vm);
    let plan = component_plan(&a, 1, 0);
    assert_eq!(plan.intakes.len(), 4);
    let (a, ix) = staged(&vm, a, &plan);
    let original_ops = account(&a, pda(b"ops")).lamports;
    let entry_payer=account(&a,BOOT).lamports;
    assert!(legacy_packet_size(&[ix.clone()]) <= 1232);
    let result = vm.process_instruction(&ix, &a);
    println!(
        "P5_FIRST cu={} raw={:?}",
        result.compute_units_consumed, result.raw_result
    );
    assert_eq!(result.raw_result, Ok(()));
    assert_eq!(result.return_data.len(), 108);
    let actual_rent=read64(&result.return_data,100);
    let expected_rent=4*vm.sysvars.rent.minimum_balance(856)+vm.sysvars.rent.minimum_balance(1055);
    assert_eq!(actual_rent,expected_rent);
    assert_eq!(
        &result.return_data[64..96],
        &[1u64.to_le_bytes(); 4].concat()
    );
    let a = result.resulting_accounts;
    assert_eq!(account(&a,BOOT).lamports,entry_payer-actual_rent);
    let root = account(&a, root_address(&instance_for(BOOT, plan.n)));
    assert_eq!(root.data.len(), 1055);
    assert_eq!(&root.data[120 + 202..120 + 234], BOOT.as_ref());
    assert_eq!(read64(&root.data, 120 + 168), 120_000);
    assert_eq!(read64(&root.data, 120 + 176), 45_000);
    assert_eq!(account(&a, pda(b"ops")).lamports, original_ops);
    assert_eq!(read64(&account(&a, pda(b"lab-mint")).data, 36), N);
    let project = project_id(1);
    let sources = plan
        .source_ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            format!(
                "{{\"id\":\"{}\",\"mint\":\"{}\",\"bytes\":\"{}\"}}",
                hex(id),
                hex(material_address(&project, (i + 1) as u8, false).as_ref()),
                hex(&account(&a, source_address(id)).data)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        "{{\"frame\":\"{}\",\"payload\":\"{}\",\"root\":\"{}\",\"createdAt\":\"{}\",\"createdSlot\":\"{}\",\"sources\":[{}]}}",
        hex(&ix.data),
        hex(&plan.payload),
        hex(&root.data),
        vm.sysvars.clock.unix_timestamp,
        vm.sysvars.clock.slot,
        sources
    );
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../evidence");
    std::fs::create_dir_all(&dir).unwrap();
    let evidence_tag = hex(&Sha256::digest(&root.data));
    let file = dir.join(format!("p5-node-input-{evidence_tag}.json"));
    std::fs::write(&file, json).unwrap();
    let output = std::process::Command::new("node")
        .arg(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tools/p5-golden.mjs"))
        .arg(&file)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    std::fs::write(dir.join(format!("p5-node-golden-{evidence_tag}.json")), &output.stdout).unwrap();
    println!("NODE_P5 {}", String::from_utf8_lossy(&output.stdout));
    let mut retry = ix;
    retry.accounts.truncate(4);
    let repeated = vm.process_instruction(&retry, &a);
    assert_eq!(repeated.raw_result, Ok(()));
    assert_eq!(repeated.resulting_accounts, a);
}
#[test]
fn second_component_reuses_aa_lipid_sugar_prefixes_and_burns_only_new_nuc() {
    let vm = runtime();
    let (a, first) = manufactured(&vm);
    let before = account(&a, root_address(&first)).clone();
    let plan = component_plan(&a, 2, 0);
    assert_eq!(plan.intakes, vec![(2, 0)]);
    let (a, ix) = staged(&vm, a, &plan);
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    assert_eq!(
        &r.return_data[64..96],
        &[
            0u64.to_le_bytes(),
            1u64.to_le_bytes(),
            0u64.to_le_bytes(),
            0u64.to_le_bytes()
        ]
        .concat()
    );
    let a = r.resulting_accounts;
    assert_eq!(account(&a, root_address(&first)), &before);
    for (class, expected) in [(1, 1), (2, 2), (3, 1), (4, 1)] {
        let p = account(&a, project_address(&project_id(1)));
        assert_eq!(
            read64(&p.data, 120 + 148 + 5 + 65 * (class - 1) + 57),
            expected
        );
    }
}
#[test]
fn invalid_descriptor_bom_and_nonminimal_intake_commit_no_material_effects() {
    let vm = runtime();
    let original = stocked(&vm);
    for case in 0..8 {
        let mut plan = component_plan(&original, 1, 0);
        match case {
            0 => plan.payload[0] = 2,
            1 => plan.payload[2] = 5,
            2 => plan.payload[3] = 1,
            3 => plan.payload[2..4].copy_from_slice(&[4, 0]),
            4 => plan.payload[2..4].copy_from_slice(&[4, 16]),
            5 => plan.payload[177..185].copy_from_slice(&2u64.to_le_bytes()),
            6 => {
                let at = plan.payload.len() - 8;
                let n = read64(&plan.payload, at);
                plan.payload[at..].copy_from_slice(&(n - 1).to_le_bytes());
            }
            7 => {
                let old = plan.payload[44 + 32 + 4 + 33..44 + 32 + 4 + 65].to_vec();
                let second = 44 + 32 + 4 + 105 + 33;
                plan.payload[second..second + 32].copy_from_slice(&old);
            }
            _ => unreachable!(),
        }
        let (a, ix) = staged(&vm, original.clone(), &plan);
        let r = vm.process_instruction(&ix, &a);
        assert!(r.raw_result.is_err(), "case{case} accepted");
        assert_eq!(r.resulting_accounts, a);
    }
}
#[test]
fn stale_existing_prefix_and_actual_later_token_cpi_failure_roll_back_all_burns() {
    let vm = runtime();
    let (a, _) = manufactured(&vm);
    let mut plan = component_plan(&a, 2, 0);
    let mut at = 44 + 32 + 4 + 105;
    let count = u32::from_le_bytes(plan.payload[at..at + 4].try_into().unwrap());
    at += 4;
    for _ in 0..count {
        let source: [u8; 32] = plan.payload[at..at + 32].try_into().unwrap();
        let mask = u32::from_le_bytes(plan.payload[at + 32..at + 36].try_into().unwrap());
        at += 36;
        if source == plan.source_ids[0] {
            plan.payload[at..at + 8].fill(0);
        }
        at += mask.count_ones() as usize * 16;
    }
    let (a, ix) = staged(&vm, a, &plan);
    let r = vm.process_instruction(&ix, &a);
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
    let original = stocked(&vm);
    let plan = component_plan(&original, 1, 0);
    let (mut a, ix) = staged(&vm, original, &plan);
    let nuc = ata(&material_address(&project_id(1), 2, false), &BOOT);
    let d = &mut account_mut(&mut a, nuc).data;
    d[72..76].copy_from_slice(&1u32.to_le_bytes());
    d[76..108].copy_from_slice(BOOT.as_ref());
    d[121..129].fill(0);
    let r = vm.process_instruction(&ix, &a);
    println!(
        "P5_TOKEN_REJECT cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}
#[test]
fn native_post_manufacture_system_failure_rolls_back_material_sources_root_and_nonce() {
    let vm = runtime();
    let original = stocked(&vm);
    let plan = component_plan(&original, 1, 0);
    let (a, ix) = staged(&vm, original, &plan);
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&u64::MAX.to_le_bytes());
    let fail = Instruction {
        program_id: SYSTEM,
        accounts: vec![
            AccountMeta::new(BOOT, true),
            AccountMeta::new(pda(b"ops"), false),
        ],
        data,
    };
    assert!(legacy_packet_size(&[ix.clone(), fail.clone()]) <= 1232);
    let r = vm.process_transaction_instructions(&[ix, fail], &a, Some(&BOOT));
    println!(
        "P5_ATOMIC cu={} raw={:?}",
        r.compute_units_consumed, r.raw_result
    );
    assert!(r.raw_result.is_err());
    assert_eq!(r.resulting_accounts, a);
}
#[test]
fn sixty_real_components_use_exact30_60_15_15_and_keep_all_permanent_source_intervals() {
    let vm = runtime();
    let mut a = stocked(&vm);
    let mut roots = Vec::new();
    for role in 1..=15 {
        for primitive in 1..=4 {
            let (next, id) =
                manufacture_next(&vm, a, primitive, if primitive == 4 { role } else { 0 });
            a = next;
            roots.push(id);
        }
    }
    assert_eq!(roots.len(), 60);
    let p = account(&a, project_address(&project_id(1)));
    for (class, expected) in [(1, 30), (2, 60), (3, 15), (4, 15)] {
        let at = 120 + 148 + 5 + 65 * (class - 1);
        assert_eq!(read64(&p.data, at + 49), expected);
        assert_eq!(read64(&p.data, at + 57), expected);
        assert_eq!(
            read64(
                &account(&a, material_address(&project_id(1), class as u8, false)).data,
                36
            ),
            0
        );
    }
    assert_eq!(
        roots
            .iter()
            .map(|id| read64(&account(&a, root_address(id)).data, 120 + 168))
            .sum::<u64>(),
        7_200_000
    );
    assert_eq!(
        roots
            .iter()
            .map(|id| read64(&account(&a, root_address(id)).data, 120 + 176))
            .sum::<u64>(),
        2_700_000
    );
    let mut remaining = 0u64;
    let mut count = 0;
    for (_, source) in &a {
        if source.owner == PROGRAM
            && source.data.len() == 856
            && source.data[10..12] == 11u16.to_le_bytes()
        {
            count += 1;
            let b = &source.data[120..];
            let credit = match b[200] {
                1 => 6,
                2 => 15,
                3 => 40,
                4 => 120,
                _ => unreachable!(),
            };
            for i in 0..32 {
                remaining += (read64(b, 224 + i * 8) - read64(b, 480 + i * 8)) * credit;
            }
        }
    }
    assert_eq!(count, 120);
    assert_eq!(remaining, 4_500_000);
    assert_eq!(read64(&account(&a, pda(b"lab-mint")).data, 36), N);
}

#[test]
fn distinct_material_owner_must_sign_and_keeps_unused_inventory_while_actor_owns_output() {
    let vm = runtime();
    let mut a = launched(&vm);
    a.push((
        OTHER,
        Account {
            lamports: 1_000_000_000,
            owner: SYSTEM,
            ..Default::default()
        },
    ));
    let project = project_id(1);
    for (class, q, n) in [(1, 30, 2), (2, 60, 3), (3, 15, 4), (4, 15, 5)] {
        prepare_buy(&mut a, project, class, 0, OTHER);
        let r = vm.process_instruction(
            &buy_material_ix(n, project, class, q, 0, BOOT, OTHER, 500_000),
            &a,
        );
        assert_eq!(r.raw_result, Ok(()));
        a = r.resulting_accounts;
    }
    let mut plan = component_plan(&a, 1, 0);
    for i in 0..4 {
        let at = 80 + 105 * i;
        plan.payload[at + 33..at + 65].copy_from_slice(
            ata(&material_address(&project, (i + 1) as u8, false), &OTHER).as_ref(),
        );
        plan.payload[at + 65..at + 97].copy_from_slice(OTHER.as_ref());
    }
    let (mut a, artifact) = put_artifact(&vm, a, 501, &plan.payload);
    let instance = instance_for(BOOT, plan.n);
    add_empty(&mut a, root_address(&instance));
    for id in &plan.source_ids {
        add_empty(&mut a, source_address(id));
    }
    let mut ix = component_ix(&a, &plan, artifact);
    for i in 0..4 {
        ix.accounts[14 + i + usize::from(cfg!(feature="production-fixture"))].pubkey = ata(&material_address(&project, (i + 1) as u8, false), &OTHER);
    }
    ix.accounts.push(AccountMeta::new_readonly(OTHER, false));
    let rejected = vm.process_instruction(&ix, &a);
    assert!(rejected.raw_result.is_err());
    assert_eq!(rejected.resulting_accounts, a);
    ix.accounts.last_mut().unwrap().is_signer = true;
    assert!(legacy_packet_size(&[ix.clone()]) <= 1232);
    let made = vm.process_instruction(&ix, &a);
    assert_eq!(made.raw_result, Ok(()));
    let a = made.resulting_accounts;
    assert_eq!(
        &account(&a, root_address(&instance)).data[120 + 202..120 + 234],
        BOOT.as_ref()
    );
    for id in &plan.source_ids {
        assert_eq!(
            &account(&a, source_address(id)).data[120..152],
            OTHER.as_ref()
        );
    }
    let source = account(&a, source_address(&plan.source_ids[0]));
    assert_eq!(read64(&source.data, 120 + 224), 1000);
    assert_eq!(read64(&source.data, 120 + 480), 500);
}
