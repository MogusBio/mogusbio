use mollusk_svm::Mollusk;use solana_account::Account;use solana_instruction::{AccountMeta,Instruction};use solana_pubkey::Pubkey;use std::path::PathBuf;
#[test]fn actual_sbf_semantic_all_37_and_maximum_match_independent_node(){
    let root=PathBuf::from(env!("CARGO_MANIFEST_DIR"));let expected=std::fs::read_to_string(root.join("expected-semantic.txt")).unwrap();let program=Pubkey::new_from_array([91;32]);let input=Pubkey::new_from_array([92;32]);let state=Pubkey::new_from_array([93;32]);
    let mut vm=Mollusk::new(&program,"biolab_provenance_probe");vm.compute_budget.compute_unit_limit=1_400_000;vm.compute_budget.heap_size=262144;let mut failures=Vec::new();let mut rows=Vec::new();
    for line in expected.lines(){let(file,digest)=line.split_once(' ').unwrap();let path=if file=="MAX440"{root.join("../../biolab-kernel/harness/stress-maximum440.bin")}else{root.join("../../../fixtures/graphs").join(file)};
        let accounts=vec![(input,Account{lamports:2_000_000_000,data:std::fs::read(path).unwrap(),owner:program,..Account::default()}),(state,Account{lamports:2_000_000_000,data:vec![0;955],owner:program,..Account::default()})];
        let r=vm.process_instruction(&Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(input,false),AccountMeta::new(state,false)],data:vec![3]},&accounts);
        println!("SEMANTIC file={file} heap=262144 cu={} result={:?}",r.compute_units_consumed,r.raw_result);
        if r.raw_result.is_ok(){assert_eq!(r.return_data.iter().map(|b|format!("{b:02x}")).collect::<String>(),digest,"{file} independent Node H7");assert_eq!(r.resulting_accounts,accounts);}else{failures.push(file.to_string());}
        rows.push(format!("{file} cu={} raw={:?}",r.compute_units_consumed,r.raw_result));
    }
    std::fs::write(root.join("../evidence/semantic-result.txt"),format!("heap=262144\nproduction_admission=false\nfailures={failures:?}\n{}\n",rows.join("\n"))).unwrap();assert!(failures.is_empty(),"resource failures: {failures:?}");
}
