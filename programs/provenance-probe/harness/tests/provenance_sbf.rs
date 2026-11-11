use mollusk_svm::Mollusk;use solana_account::Account;use solana_instruction::{AccountMeta,Instruction};use solana_pubkey::Pubkey;use std::path::PathBuf;
#[test]fn real_sbf_maximum_shared_provenance_ordinary_sha(){
    let program=Pubkey::new_from_array([91;32]);let input=Pubkey::new_from_array([92;32]);let state=Pubkey::new_from_array([93;32]);let root=PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for variant in ["rows","blob"]{
    let bytes=std::fs::read(root.join(format!("maximum-{variant}.bin"))).unwrap();let expected=std::fs::read_to_string(root.join(format!("expected-{variant}.txt"))).unwrap();let values=expected.lines().collect::<Vec<_>>();let digest=values[0];let segments=values[1];let hash_bytes=values[2];let rows=values[3];let steps=(rows.parse::<usize>().unwrap()+63)/64;
    let mut vm=Mollusk::new(&program,"biolab_provenance_probe");vm.compute_budget.compute_unit_limit=1_400_000;vm.compute_budget.heap_size=32768;
    let mut accounts=vec![(input,Account{lamports:2_000_000_000,data:bytes,owner:program,..Account::default()}),(state,Account{lamports:2_000_000_000,data:vec![0;955],owner:program,..Account::default()})];
    let mut counts=[0usize;3];let mut high=0;
    for mode in 0..3u8{loop{let ix=Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(input,false),AccountMeta::new(state,false)],data:vec![mode]};let r=vm.process_instruction(&ix,&accounts);
        println!("PROVENANCE mode={mode} call={} cu={} result={:?}",counts[usize::from(mode)],r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));counts[usize::from(mode)]+=1;high=high.max(r.compute_units_consumed);accounts=r.resulting_accounts;
        if mode==0||r.return_data[0]==1{if mode==2{let actual=r.return_data[1..].iter().map(|b|format!("{b:02x}")).collect::<String>();assert_eq!(actual,digest);}break;}assert!(counts[usize::from(mode)]<=steps);
    }}
    assert_eq!(counts,[1,steps,steps]);assert!(high<=1_260_000);std::fs::write(root.join(format!("../evidence/maximum-{variant}-result.txt")),format!("leaves=60\nrows={rows}\nsegments={segments}\nordinary_sha_bytes={hash_bytes}\ncount_steps={steps}\nhash_steps={steps}\nheap=32768\nmax_cu={high}\ndigest={digest}\nproduction_admission=false\n")).unwrap();
    }
}
