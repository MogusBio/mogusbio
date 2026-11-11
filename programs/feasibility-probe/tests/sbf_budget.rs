//! Execute the compiled ELF, never a host/native process_instruction substitute.
use mollusk_svm::Mollusk;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

const LIMIT: u64 = 1_400_000;

fn wire(mode: u8, count: usize, rounds: u16, edges: u16) -> Vec<u8> {
    let mut bytes = b"BIOPRB01".to_vec();
    bytes.extend_from_slice(&[mode, count as u8]);
    bytes.extend_from_slice(&rounds.to_le_bytes());
    bytes.extend_from_slice(&edges.to_le_bytes());
    bytes.extend_from_slice(&[0, 0]);
    bytes
}

fn fixture(program: Pubkey, lengths: &[usize]) -> Vec<(Pubkey, Account)> {
    lengths
        .iter()
        .enumerate()
        .map(|(account_index, length)| {
            let mut key = [0u8; 32];
            key[0] = 10 + account_index as u8;
            let data = (0..*length)
                .map(|index| ((index * 37 + account_index * 19) % 251) as u8)
                .collect();
            (
                Pubkey::new_from_array(key),
                Account {
                    lamports: 2_000_000_000,
                    data,
                    owner: program,
                    executable: false,
                    rent_epoch: 0,
                },
            )
        })
        .collect()
}

fn expected_digest(accounts: &[(Pubkey, Account)]) -> [u8; 32] {
    let mut accumulated = [0u8; 32];
    for (index, (_, account)) in accounts.iter().enumerate() {
        let mut hasher = Sha256::new();
        hasher.update(accumulated);
        hasher.update((index as u32).to_le_bytes());
        hasher.update((account.data.len() as u32).to_le_bytes());
        hasher.update(Sha256::digest(&account.data));
        accumulated = hasher.finalize().into();
    }
    accumulated
}

fn instruction(program: Pubkey, data: Vec<u8>, accounts: &[(Pubkey, Account)]) -> Instruction {
    Instruction {
        program_id: program,
        accounts: accounts
            .iter()
            .map(|(key, _)| AccountMeta::new_readonly(*key, false))
            .collect(),
        data,
    }
}

fn runtime(program: &Pubkey) -> Mollusk {
    let mut vm = Mollusk::new(program, "biolab_feasibility_probe");
    vm.compute_budget.compute_unit_limit = LIMIT;
    vm.compute_budget.heap_size = 32_768;
    vm
}

#[test]
fn actual_sbf_reads_all_bytes_and_changes_no_accounts() {
    let program = Pubkey::new_from_array([71; 32]);
    let vm = runtime(&program);
    let accounts = fixture(program, &[67_092, 67_093]);
    let ix = instruction(program, wire(0, accounts.len(), 0, 0), &accounts);
    let result = vm.process_instruction(&ix, &accounts);
    assert_eq!(result.raw_result, Ok(()));
    assert_eq!(result.return_data.len(), 72);
    assert_eq!(&result.return_data[..8], b"BIOPRR01");
    assert_eq!(&result.return_data[40..], &expected_digest(&accounts));
    assert_eq!(result.resulting_accounts, accounts);
    assert!(result.compute_units_consumed > 0 && result.compute_units_consumed <= LIMIT);

    let mut changed = accounts.clone();
    *changed[1].1.data.last_mut().unwrap() ^= 1;
    let changed_result = vm.process_instruction(&ix, &changed);
    assert_eq!(changed_result.raw_result, Ok(()));
    assert_ne!(&result.return_data[40..], &changed_result.return_data[40..]);
}

#[test]
fn actual_sbf_budget_matrix_reports_success_or_budget_failure() {
    let program = Pubkey::new_from_array([72; 32]);
    let vm = runtime(&program);
    for (name, count, bytes, mode, rounds, edges) in [
        ("sha-standard-one", 1, 67_092, 0, 0, 0),
        ("sha-standard-seven", 7, 67_092, 0, 0, 0),
        ("sha-maximum-seven", 7, 214_100, 0, 0, 0),
        ("walk-standard-one", 1, 67_092, 1, 0, 0),
        ("walk-maximum-seven", 7, 214_100, 1, 0, 0),
        ("ops-standard-one", 1, 67_092, 2, 73, 342),
        ("ops-maximum-seven", 7, 214_100, 2, 73, 440),
        ("software-sha-small", 1, 1_024, 3, 0, 0),
        ("software-sha-standard", 1, 67_092, 3, 0, 0),
    ] {
        let accounts = fixture(program, &vec![bytes; count]);
        let ix = instruction(program, wire(mode, count, rounds, edges), &accounts);
        let result = vm.process_instruction(&ix, &accounts);
        println!(
            "PROBE name={name} input_bytes={} accounts={count} rounds={rounds} edges={edges} cu={} raw={:?}",
            count * bytes,
            result.compute_units_consumed,
            result.raw_result
        );
        assert!(result.compute_units_consumed > 0 && result.compute_units_consumed <= LIMIT);
        if result.raw_result.is_ok() {
            assert_eq!(result.return_data.len(), 72);
            assert_eq!(&result.return_data[40..], &expected_digest(&accounts));
            let total = u64::from_le_bytes(result.return_data[16..24].try_into().unwrap());
            assert_eq!(total as usize, count * bytes);
            assert_eq!(result.resulting_accounts, accounts);
        } else {
            // An over-budget row is a failed resource gate, not a successful model.
            let raw = format!("{:?}", result.raw_result);
            assert!(
                raw.contains("ComputationalBudgetExceeded")
                    || (raw.contains("ProgramFailedToComplete") && result.compute_units_consumed == LIMIT),
                "unexpected runtime failure in {name}: {:?}",
                result.raw_result
            );
        }
    }
}

#[test]
fn actual_sbf_rejects_invalid_shapes() {
    let program = Pubkey::new_from_array([73; 32]);
    let vm = runtime(&program);
    let accounts = fixture(program, &[8]);
    for data in [
        wire(0, 0, 0, 0),
        wire(4, 1, 0, 0),
        wire(0, 1, 1, 0),
        wire(2, 1, 74, 440),
        wire(2, 1, 73, 441),
        wire(2, 1, 0, 342),
        vec![0; 16],
        vec![0; 17],
    ] {
        let ix = instruction(program, data, &accounts);
        let result = vm.process_instruction(&ix, &accounts);
        assert!(result.raw_result.is_err());
        assert_eq!(result.resulting_accounts, accounts);
    }
    let oversized = fixture(program, &[214_101]);
    let ix = instruction(program, wire(0, 1, 0, 0), &oversized);
    assert!(vm.process_instruction(&ix, &oversized).raw_result.is_err());

    let mut writable_ix = instruction(program, wire(0, 1, 0, 0), &accounts);
    writable_ix.accounts[0].is_writable = true;
    let writable_result = vm.process_instruction(&writable_ix, &accounts);
    assert!(writable_result.raw_result.is_err());
    assert_eq!(writable_result.resulting_accounts, accounts);

    let mut wrong_owner = accounts.clone();
    wrong_owner[0].1.owner = Pubkey::new_from_array([99; 32]);
    let ix = instruction(program, wire(0, 1, 0, 0), &wrong_owner);
    assert!(vm.process_instruction(&ix, &wrong_owner).raw_result.is_err());

    let mut duplicate_ix = instruction(program, wire(0, 2, 0, 0), &accounts);
    duplicate_ix.accounts.push(duplicate_ix.accounts[0].clone());
    assert!(vm.process_instruction(&duplicate_ix, &accounts).raw_result.is_err());
}
