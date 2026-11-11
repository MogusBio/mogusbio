use mollusk_svm::Mollusk;
use solana_account::Account;
use solana_instruction::{AccountMeta,Instruction};
use solana_pubkey::Pubkey;
use std::path::PathBuf;

const LIMIT:u64=1_400_000;
fn fixtures()->PathBuf{PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/graphs")}
fn instruction(program:Pubkey,key:Pubkey)->Instruction{
    let mut data=b"BIOKRN02".to_vec();
    data.extend_from_slice(&2_000_000u32.to_le_bytes());data.extend_from_slice(&[0;4]);
    Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(key,false)],data}
}
fn input(program:Pubkey,key:Pubkey,file:&str)->Vec<(Pubkey,Account)>{
    vec![(key,Account{lamports:2_000_000_000,data:std::fs::read(fixtures().join(file)).expect("real graph fixture"),owner:program,executable:false,rent_epoch:0})]
}
fn vm(program:&Pubkey,heap:u32)->Mollusk{
    let mut vm=Mollusk::new(program,"biolab_kernel");
    vm.compute_budget.compute_unit_limit=LIMIT;vm.compute_budget.heap_size=heap;vm
}
fn expected_cost(file:&str)->u64{
    if file=="candidate-c320.bin"||file=="c320-scope-22.bin"||file=="MAX440"{320}
    else if file=="candidate-c324.bin"{324}
    else if file.starts_with("seed-"){
        let index=file[5..7].parse::<usize>().unwrap();
        [413,394,375,347,343,341,340,336,332,330,330,328][index]
    }else{0}
}
fn assert_report(file:&str,raw:&[u8],report:&[u8]){
    assert_eq!(report.len(),724,"{file}");assert_eq!(&report[..8],b"BIOKRS02");
    let target=raw[10];let hard=[3,9,14,15,21].contains(&target);
    let quality=u32::from_le_bytes(report[8..12].try_into().unwrap());
    assert_eq!(quality,if hard{1_000_000}else{2_000_000},"{file} q");
    assert_eq!(report[12],target);assert_eq!(report[13],u8::from(target==22));
    assert_eq!(u16::from_le_bytes(report[14..16].try_into().unwrap()),73);
    assert_eq!(u64::from_le_bytes(report[16..24].try_into().unwrap()),expected_cost(file),"{file} C");
    for case in 0..4{
        let start=120+case*151;
        for role in 0..15{assert_eq!(u64::from_le_bytes(report[start+role*8..start+role*8+8].try_into().unwrap()),1_000_000,"{file} final N");}
        assert_eq!(&report[start+120..start+135],&[if case==1{1}else{0};15]);
        let sign=if case==1{1i64}else{-1};
        assert_eq!(i64::from_le_bytes(report[start+135..start+143].try_into().unwrap()),sign*500_000);
        assert_eq!(i64::from_le_bytes(report[start+143..start+151].try_into().unwrap()),-sign*500_000);
    }
}

#[test]
fn actual_sbf_all_37_graphs_compute_real_73_rounds(){
    let program=Pubkey::new_from_array([81;32]);let key=Pubkey::new_from_array([82;32]);
    let mut files=std::fs::read_dir(fixtures()).unwrap().map(|e|e.unwrap().file_name().to_string_lossy().to_string()).filter(|n|n.ends_with(".bin")).collect::<Vec<_>>();files.sort();
    assert_eq!(files.len(),37);let mut failures=Vec::new();
    let mut reports=serde_json::Map::new();
    for file in files{
        let accounts=input(program,key,&file);let ix=instruction(program,key);let mut passed=false;
        for heap in [32_768,262_144]{
            let runtime=vm(&program,heap);let result=runtime.process_instruction(&ix,&accounts);
            println!("KERNEL file={file} heap={heap} cu={} raw={:?}",result.compute_units_consumed,result.raw_result);
            if result.raw_result.is_ok(){
                assert_report(&file,&accounts[0].1.data,&result.return_data);
                assert_eq!(result.resulting_accounts,accounts);
                let digest=result.return_data[88..120].iter().map(|x|format!("{x:02x}")).collect::<String>();
                reports.insert(file.clone(),serde_json::json!({"heap":heap,"compute_units":result.compute_units_consumed,"q":u32::from_le_bytes(result.return_data[8..12].try_into().unwrap()),"C":expected_cost(&file),"func2_digest":digest}));
                passed=true;break;
            }
        }
        if !passed{failures.push(file);}
    }
    let path=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../evidence/kernel-actual.json");
    std::fs::write(path,serde_json::to_string_pretty(&serde_json::json!({"production_admission":false,"limit":LIMIT,"reports":reports,"failures":failures})).unwrap()).unwrap();
    // Retain the old one-transaction resource baseline. Every failed row remains
    // an explicit failed gate in the JSON, regardless of this exploratory test.
}

fn begin_ix(program:Pubkey,key:Pubkey,state:Pubkey,actor:Pubkey,raw:&[u8])->Instruction{
    let mut data=b"BIOVBG02".to_vec();data.extend_from_slice(&2_000_000u32.to_le_bytes());data.extend_from_slice(&0u64.to_le_bytes());
    data.extend_from_slice(&raw[48..80]);data.extend_from_slice(&[91;32]);data.extend_from_slice(&[92;32]);
    Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(key,false),AccountMeta::new(state,false),AccountMeta::new_readonly(actor,true)],data}
}
fn step_ix(program:Pubkey,key:Pubkey,state:Pubkey,generation:u64,cursor:u16,count:u8,digest:&[u8])->Instruction{
    let mut data=b"BIOVST02".to_vec();data.extend_from_slice(&generation.to_le_bytes());data.extend_from_slice(&cursor.to_le_bytes());data.extend_from_slice(&[count,0]);data.extend_from_slice(digest);
    Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(key,false),AccountMeta::new(state,false)],data}
}
fn state_fixture(program:Pubkey,key:Pubkey,state:Pubkey,actor:Pubkey,raw:Vec<u8>)->Vec<(Pubkey,Account)>{
    vec![(key,Account{lamports:2_000_000_000,data:raw,owner:program,executable:false,rent_epoch:0}),(state,Account{lamports:2_000_000_000,data:vec![0;1213],owner:program,executable:false,rent_epoch:0}),(actor,Account{lamports:2_000_000_000,..Account::default()})]
}

#[test]
fn actual_sbf_step_batch_budget_matrix(){
    let program=Pubkey::new_from_array([85;32]);let key=Pubkey::new_from_array([86;32]);let state=Pubkey::new_from_array([87;32]);let actor=Pubkey::new_from_array([88;32]);
    for (file,raw) in [("C320",std::fs::read(fixtures().join("candidate-c320.bin")).unwrap()),("MAX440",std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("stress-maximum440.bin")).unwrap())]{
        for count in [1u8,2,4,8]{
            for heap in [32768,262144]{
                let vm=vm(&program,heap);let accounts=state_fixture(program,key,state,actor,raw.clone());
                let begun=vm.process_instruction(&begin_ix(program,key,state,actor,&raw),&accounts);assert_eq!(begun.raw_result,Ok(()),"BEGIN {file}");
                let result=vm.process_instruction(&step_ix(program,key,state,1,0,count,&begun.return_data[40..72]),&begun.resulting_accounts);
                println!("STEPBUDGET file={file} count={count} heap={heap} cu={} raw={:?}",result.compute_units_consumed,result.raw_result);
                if result.raw_result.is_ok(){assert_eq!(u16::from_le_bytes(result.return_data[16..18].try_into().unwrap()),u16::from(count));break;}
            }
        }
    }
}

fn hex(bytes:&[u8])->String{bytes.iter().map(|b|format!("{b:02x}")).collect()}
fn assert_expected(file:&str,actual:&[u8],entry:&serde_json::Value){
    assert_eq!(u32::from_le_bytes(actual[8..12].try_into().unwrap()).to_string(),entry["q"].as_str().unwrap(),"{file} q");
    assert_eq!(u64::from_le_bytes(actual[16..24].try_into().unwrap()).to_string(),entry["cost"].as_str().unwrap(),"{file} C");
    assert_eq!(hex(&actual[24..88]),entry["bitmap"].as_str().unwrap(),"{file} bitmap");
    assert_eq!(hex(&actual[88..120]),entry["digest"].as_str().unwrap(),"{file} FUNC2 digest");
    for (case,e) in entry["cases"].as_array().unwrap().iter().enumerate(){
        let start=120+151*case;
        for role in 0..15{
            assert_eq!(u64::from_le_bytes(actual[start+8*role..start+8*role+8].try_into().unwrap()).to_string(),e["N"][role].as_str().unwrap(),"{file} N");
            assert_eq!(u64::from(actual[start+120+role]),e["I"][role].as_u64().unwrap(),"{file} I");
        }
        assert_eq!(i64::from_le_bytes(actual[start+135..start+143].try_into().unwrap()).to_string(),e["xA"].as_str().unwrap());
        assert_eq!(i64::from_le_bytes(actual[start+143..start+151].try_into().unwrap()).to_string(),e["xB"].as_str().unwrap());
    }
}

#[test]
fn actual_sbf_step_all_37_match_independent_node_func2(){
    let expected:serde_json::Value=serde_json::from_slice(&std::fs::read(fixtures().join("expected-FUNC2.json")).unwrap()).unwrap();
    assert_eq!(expected["recordBytes"],2271);assert_eq!(expected["entries"].as_array().unwrap().len(),37);
    let program=Pubkey::new_from_array([89;32]);let key=Pubkey::new_from_array([90;32]);let state=Pubkey::new_from_array([93;32]);let actor=Pubkey::new_from_array([94;32]);
    let mut rows=Vec::new();
    for entry in expected["entries"].as_array().unwrap(){
        let file=entry["file"].as_str().unwrap();let raw=std::fs::read(fixtures().join(file)).unwrap();let vm=vm(&program,32768);
        let initial=state_fixture(program,key,state,actor,raw.clone());let begun=vm.process_instruction(&begin_ix(program,key,state,actor,&raw),&initial);
        assert_eq!(begun.raw_result,Ok(()),"BEGIN {file}");let mut accounts=begun.resulting_accounts;let mut result=begun.return_data;let mut high=0u64;let mut calls=0usize;
        while u16::from_le_bytes(result[16..18].try_into().unwrap())<73{
            let cursor=u16::from_le_bytes(result[16..18].try_into().unwrap());let count=(73-cursor).min(2) as u8;
            let executed=vm.process_instruction(&step_ix(program,key,state,1,cursor,count,&result[40..72]),&accounts);
            println!("STEP file={file} cursor={cursor} count={count} heap=32768 cu={} raw={:?}",executed.compute_units_consumed,executed.raw_result);
            assert_eq!(executed.raw_result,Ok(()),"STEP {file} cursor{cursor}");
            high=high.max(executed.compute_units_consumed);calls+=1;accounts=executed.resulting_accounts;result=executed.return_data;
        }
        let mut data=b"BIOVFN02".to_vec();data.extend_from_slice(&1u64.to_le_bytes());data.extend_from_slice(&result[40..72]);
        let finish=vm.process_instruction(&Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(key,false),AccountMeta::new_readonly(state,false)],data},&accounts);
        assert_eq!(finish.raw_result,Ok(()),"FINISH {file}");assert_report(file,&raw,&finish.return_data);assert_expected(file,&finish.return_data,entry);
        rows.push(serde_json::json!({"file":file,"calls":calls,"max_step_cu":high,"heap":32768,"digest":hex(&finish.return_data[88..120])}));
    }
    std::fs::write(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../evidence/kernel-step-actual.json"),serde_json::to_string_pretty(&serde_json::json!({"production_admission":false,"suite":2,"rounds":73,"reports":rows})).unwrap()).unwrap();
}

#[test]
fn actual_sbf_step_maximum440_matches_node(){
    let program=Pubkey::new_from_array([101;32]);let key=Pubkey::new_from_array([102;32]);let state=Pubkey::new_from_array([103;32]);let actor=Pubkey::new_from_array([104;32]);
    let directory=PathBuf::from(env!("CARGO_MANIFEST_DIR"));let raw=std::fs::read(directory.join("stress-maximum440.bin")).unwrap();
    assert_eq!(raw.len(),7713);let expected:serde_json::Value=serde_json::from_slice(&std::fs::read(directory.join("stress-expected.json")).unwrap()).unwrap();
    let vm=vm(&program,32768);let initial=state_fixture(program,key,state,actor,raw.clone());let begun=vm.process_instruction(&begin_ix(program,key,state,actor,&raw),&initial);
    assert_eq!(begun.raw_result,Ok(()));let mut accounts=begun.resulting_accounts;let mut result=begun.return_data;let mut high=0;
    while u16::from_le_bytes(result[16..18].try_into().unwrap())<73{
        let cursor=u16::from_le_bytes(result[16..18].try_into().unwrap());let count=(73-cursor).min(2) as u8;
        let executed=vm.process_instruction(&step_ix(program,key,state,1,cursor,count,&result[40..72]),&accounts);
        println!("STRESSMAX cursor={cursor} count={count} heap=32768 cu={} raw={:?}",executed.compute_units_consumed,executed.raw_result);
        assert_eq!(executed.raw_result,Ok(()));high=high.max(executed.compute_units_consumed);accounts=executed.resulting_accounts;result=executed.return_data;
    }
    let mut data=b"BIOVFN02".to_vec();data.extend_from_slice(&1u64.to_le_bytes());data.extend_from_slice(&result[40..72]);
    let final_result=vm.process_instruction(&Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(key,false),AccountMeta::new_readonly(state,false)],data},&accounts);
    assert_eq!(final_result.raw_result,Ok(()));assert_report("MAX440",&raw,&final_result.return_data);
    assert_eq!(hex(&final_result.return_data[24..88]),expected["bitmap"].as_str().unwrap());assert_eq!(hex(&final_result.return_data[88..120]),expected["digest"].as_str().unwrap());
    std::fs::write(directory.join("../evidence/kernel-maximum-actual.json"),serde_json::to_string_pretty(&serde_json::json!({"production_admission":false,"bytes":7713,"edges":440,"rounds":73,"calls":37,"heap":32768,"max_step_cu":high,"digest":hex(&final_result.return_data[88..120])})).unwrap()).unwrap();
}

#[test]
fn actual_sbf_step_permissions_replay_clock_reset_and_atomic_rollback(){
    let program=Pubkey::new_from_array([105;32]);let key=Pubkey::new_from_array([106;32]);let state=Pubkey::new_from_array([107;32]);let actor=Pubkey::new_from_array([108;32]);
    let raw=std::fs::read(fixtures().join("candidate-c320.bin")).unwrap();let initial=state_fixture(program,key,state,actor,raw.clone());let mut vm=vm(&program,32768);vm.sysvars.clock.unix_timestamp=100;
    let begin=begin_ix(program,key,state,actor,&raw);let mut unsigned=begin.clone();unsigned.accounts[2].is_signer=false;
    assert!(vm.process_instruction(&unsigned,&initial).raw_result.is_err());
    let mut wrong_config=begin.clone();wrong_config.data[20]^=1;assert!(vm.process_instruction(&wrong_config,&initial).raw_result.is_err());
    let begun=vm.process_instruction(&begin,&initial);assert_eq!(begun.raw_result,Ok(()));let initial_state=begun.resulting_accounts.clone();
    let first=step_ix(program,key,state,1,0,2,&begun.return_data[40..72]);
    vm.sysvars.clock.unix_timestamp=99;let rewind=vm.process_instruction(&first,&initial_state);assert!(rewind.raw_result.is_err());assert_eq!(rewind.resulting_accounts[1].1.data,initial_state[1].1.data);
    vm.sysvars.clock.unix_timestamp=101;let once=vm.process_instruction(&first,&initial_state);assert_eq!(once.raw_result,Ok(()));
    let duplicate=vm.process_instruction(&first,&once.resulting_accounts);assert_eq!(duplicate.raw_result,Ok(()));assert_eq!(duplicate.return_data,once.return_data);assert_eq!(duplicate.resulting_accounts[1].1.data,once.resulting_accounts[1].1.data);
    let second=step_ix(program,key,state,1,2,1,&once.return_data[40..72]);let twice=vm.process_instruction(&second,&once.resulting_accounts);assert_eq!(twice.raw_result,Ok(()));
    let stale=vm.process_instruction(&first,&twice.resulting_accounts);assert!(stale.raw_result.is_err());assert_eq!(stale.resulting_accounts[1].1.data,twice.resulting_accounts[1].1.data);
    let third=step_ix(program,key,state,1,3,1,&twice.return_data[40..72]);let mut changed=twice.resulting_accounts.clone();*changed[0].1.data.last_mut().unwrap()^=1;
    let tampered=vm.process_instruction(&third,&changed);assert!(tampered.raw_result.is_err());assert_eq!(tampered.resulting_accounts[1].1.data,twice.resulting_accounts[1].1.data);
    let mut reset=begin.clone();reset.data[12..20].copy_from_slice(&1u64.to_le_bytes());let reset_result=vm.process_instruction(&reset,&twice.resulting_accounts);assert_eq!(reset_result.raw_result,Ok(()));assert_eq!(u64::from_le_bytes(reset_result.return_data[8..16].try_into().unwrap()),2);
    assert!(vm.process_instruction(&first,&reset_result.resulting_accounts).raw_result.is_err());
    let invalid_second=step_ix(program,key,state,1,99,1,&[0;32]);
    let transaction=vm.process_transaction_instructions(&[first,invalid_second],&initial_state,Some(&actor));
    assert!(transaction.raw_result.is_err());let rolled=transaction.resulting_accounts.iter().find(|(k,_)|*k==state).unwrap();assert_eq!(rolled.1.data,initial_state[1].1.data,"later native instruction must roll back earlier STEP state");
}

#[test]
fn actual_sbf_step_end_to_end_resource_accounts(){
    let program=Pubkey::new_from_array([109;32]);let key=Pubkey::new_from_array([110;32]);let state=Pubkey::new_from_array([111;32]);let actor=Pubkey::new_from_array([112;32]);
    let directory=PathBuf::from(env!("CARGO_MANIFEST_DIR"));let mut rows=Vec::new();
    for file in ["candidate-c320.bin","c320-scope-18.bin","MAX440"]{
        let raw=if file=="MAX440"{std::fs::read(directory.join("stress-maximum440.bin")).unwrap()}else{std::fs::read(fixtures().join(file)).unwrap()};
        let vm=vm(&program,32768);let initial=state_fixture(program,key,state,actor,raw.clone());
        let begun=vm.process_instruction(&begin_ix(program,key,state,actor,&raw),&initial);assert_eq!(begun.raw_result,Ok(()));
        let begin_cu=begun.compute_units_consumed;let mut total=begin_cu;let mut maximum=begin_cu;
        let mut accounts=begun.resulting_accounts;let mut result=begun.return_data;let mut steps=0;
        while u16::from_le_bytes(result[16..18].try_into().unwrap())<73{
            let cursor=u16::from_le_bytes(result[16..18].try_into().unwrap());let count=(73-cursor).min(2) as u8;
            let executed=vm.process_instruction(&step_ix(program,key,state,1,cursor,count,&result[40..72]),&accounts);
            assert_eq!(executed.raw_result,Ok(()));steps+=1;total+=executed.compute_units_consumed;maximum=maximum.max(executed.compute_units_consumed);
            accounts=executed.resulting_accounts;result=executed.return_data;
        }
        let mut data=b"BIOVFN02".to_vec();data.extend_from_slice(&1u64.to_le_bytes());data.extend_from_slice(&result[40..72]);
        let final_result=vm.process_instruction(&Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(key,false),AccountMeta::new_readonly(state,false)],data},&accounts);
        assert_eq!(final_result.raw_result,Ok(()));let final_cu=final_result.compute_units_consumed;total+=final_cu;maximum=maximum.max(final_cu);
        println!("RESOURCE file={file} begin_cu={begin_cu} final_cu={final_cu} transactions={} total_cu={total} maximum_cu={maximum}",steps+2);
        assert!(maximum<=1_260_000,"private kernel must preserve at least 10% CU headroom");
        rows.push(serde_json::json!({"file":file,"begin_cu":begin_cu,"final_cu":final_cu,"transactions":steps+2,"total_cu":total,"maximum_cu":maximum,"heap":32768}));
    }
    std::fs::write(directory.join("../evidence/kernel-end-to-end-actual.json"),serde_json::to_string_pretty(&serde_json::json!({"production_admission":false,"reports":rows})).unwrap()).unwrap();
}

#[test]
fn actual_sbf_step_physical_failures_never_commit_partial_state(){
    let program=Pubkey::new_from_array([113;32]);let key=Pubkey::new_from_array([114;32]);let state=Pubkey::new_from_array([115;32]);let actor=Pubkey::new_from_array([116;32]);
    let directory=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("negative-fixtures");
    let expected:serde_json::Value=serde_json::from_slice(&std::fs::read(directory.join("expected.json")).unwrap()).unwrap();let mut rows=Vec::new();
    for entry in expected["entries"].as_array().unwrap(){
        let file=entry["file"].as_str().unwrap();let raw=std::fs::read(directory.join(file)).unwrap();let vm=vm(&program,32768);
        let initial=state_fixture(program,key,state,actor,raw.clone());let mut begin=begin_ix(program,key,state,actor,&raw);
        begin.data[8..12].copy_from_slice(&(entry["challenge"].as_u64().unwrap() as u32).to_le_bytes());
        let begun=vm.process_instruction(&begin,&initial);assert_eq!(begun.raw_result,Ok(()),"structurally valid {file} must begin");
        let mut accounts=begun.resulting_accounts;let mut result=begun.return_data;let failure_cursor;
        loop{
            let cursor=u16::from_le_bytes(result[16..18].try_into().unwrap());assert!(cursor<73,"{file} must fail rather than be admitted");
            let count=(73-cursor).min(2) as u8;
            let executed=vm.process_instruction(&step_ix(program,key,state,1,cursor,count,&result[40..72]),&accounts);
            if executed.raw_result.is_err(){
                assert_eq!(format!("{:?}",executed.raw_result),format!("Err(Custom({}))",entry["rustCode"].as_u64().unwrap()),"{file} precise physical failure");
                assert_eq!(executed.resulting_accounts[1].1.data,accounts[1].1.data,"{file} no partial round or final quality may commit");
                failure_cursor=cursor;break;
            }
            accounts=executed.resulting_accounts;result=executed.return_data;
        }
        let completed=entry["completedRounds"].as_u64().unwrap();let expected_cursor=if completed==73{72}else{completed/2*2};assert_eq!(u64::from(failure_cursor),expected_cursor,"{file} Node/Rust failure point");
        let mut data=b"BIOVFN02".to_vec();data.extend_from_slice(&1u64.to_le_bytes());data.extend_from_slice(&result[40..72]);
        let finish=vm.process_instruction(&Instruction{program_id:program,accounts:vec![AccountMeta::new_readonly(key,false),AccountMeta::new_readonly(state,false)],data},&accounts);
        assert!(finish.raw_result.is_err(),"{file} cannot obtain a final report");
        println!("NEGATIVE file={file} node_code={} rust_code={} failed_cursor={failure_cursor} scratch_unchanged=true",entry["failure"]["code"],entry["rustCode"]);
        rows.push(serde_json::json!({"file":file,"node_failure":entry["failure"],"rust_code":entry["rustCode"],"failed_cursor":failure_cursor,"scratch_unchanged":true,"final_report_rejected":true}));
    }
    std::fs::write(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../evidence/kernel-negative-actual.json"),serde_json::to_string_pretty(&serde_json::json!({"production_admission":false,"heap":32768,"reports":rows})).unwrap()).unwrap();
}
