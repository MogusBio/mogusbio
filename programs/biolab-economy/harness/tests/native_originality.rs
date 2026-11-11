mod support;
use support::*;
#[path="support/originality.rs"]mod originality;
use originality as ori;

#[test]
fn public_seed_runs_seal_opening_and_late_repair_restores_old_unfinalized_baseline(){
 let mut vm=runtime();vm.compute_budget.heap_size=262144;let mut a=fixture();account_mut(&mut a,BOOT).lamports=50_000_000_000;let r=vm.process_instruction(&init_ix(0),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;
 let start=ori::reward_start(&a);assert_eq!(start,if cfg!(feature="production-fixture"){93600}else{86400});let(mut a,peak)=ori::prewarm(&vm,a);let count=initial_count()as u64;let frontier=if count==16{316}else{320};let td=&account(&a,ori::named(b"task")).data;assert_eq!(read64(td,164),count);assert_eq!(read64(td,181),frontier);assert_eq!(account(&a,ori::named(b"k-slot")).data[193],0);let od=&account(&a,ori::named(b"opening")).data;assert_eq!(u16::from_le_bytes(od[192..194].try_into().unwrap()),if count==16{0xffff}else{0x3fff});
 assert_eq!(read64(&account(&a,pda(b"lab-mint")).data,36),N);assert_eq!(read64(&account(&a,pda(b"lab-reserve")).data,64),N);assert!(!a.iter().any(|(_,v)|v.owner==PROGRAM&&v.data.len()>=14&&u16::from_le_bytes(v.data[10..12].try_into().unwrap())==12));
 clock_at(&mut vm,&mut a,start);add_empty(&mut a,ori::named(b"seed-final"));let first=vm.process_instruction(&ori::seal_ix(&a,8),&a);assert_eq!(first.raw_result,Ok(()));a=first.resulting_accounts;assert_eq!(read64(&account(&a,ori::named(b"opening")).data,194),8);let second=vm.process_instruction(&ori::seal_ix(&a,8),&a);assert_eq!(second.raw_result,Ok(()));a=second.resulting_accounts;assert_eq!(account(&a,ori::named(b"task")).data[237],1);assert_eq!(read64(&account(&a,ori::named(b"seed-final")).data,232),frontier);assert_eq!(read64(&account(&a,ori::named(b"seed-final")).data,192),count);
 // A public seed may be committed, but no manufacture means no Candidate
 // and no award. COMMIT itself creates only a bounded immutable record.
 let design:[u8;32]=account(&a,ori::knowledge(0)).data[164..196].try_into().unwrap();let n=next_nonce(&a,BOOT);let hidden=ori::commit_hash(0,BOOT,&design,n+1,&[7;32]);add_empty(&mut a,ori::round(0));add_empty(&mut a,ori::commit_address(&business_for(BOOT,n)));let committed=vm.process_instruction(&ori::commit_ix(&a,0,&hidden),&a);assert_eq!(committed.raw_result,Ok(()));a=committed.resulting_accounts;
 assert_eq!(read64(&account(&a,ori::round(0)).data,205),count);assert_eq!(read64(&account(&a,ori::round(0)).data,221),1);assert_eq!(read64(&account(&a,ori::round(0)).data,229),0);
 clock_at(&mut vm,&mut a,start+86400);let late_nonce=next_nonce(&a,BOOT);add_empty(&mut a,ori::commit_address(&business_for(BOOT,late_nonce)));let late=vm.process_instruction(&ori::commit_ix(&a,0,&hidden),&a);assert_eq!(format!("{:?}",late.raw_result),"Err(Custom(6707))");assert_eq!(late.resulting_accounts,a);
 clock_at(&mut vm,&mut a,start+259200);
 // A genuine round0 existed before its deadline. The explicit local storage
 // corruption fixture and its genuine replay repair happen in round1. The
 // correction's new index must restore origin=count-1 in round0's baseline.
 let old=count-1;let d=account(&a,ori::knowledge(old)).data.clone();let design:[u8;32]=d[164..196].try_into().unwrap();let aid:[u8;32]=d[301..333].try_into().unwrap();let bytes=account(&a,artifact_address(&aid)).data[251..].to_vec();account_mut(&mut a,ori::knowledge(old)).data[260..268].copy_from_slice(&(frontier+1).to_le_bytes());let(next,prior,_)=ori::history(&vm,a,&bytes,&design);a=next;ori::prepare_proof(&mut a,&prior);let proof=vm.process_instruction(&ori::prove_ix(&a,&bytes,&prior,&design,old),&a);assert_eq!(proof.raw_result,Ok(()));a=proof.resulting_accounts;assert_eq!(read64(&account(&a,ori::safety(1)).data,433),old);assert_eq!(read64(&account(&a,ori::round(0)).data,213),count);
 for index in 0..=count{let k=account(&a,ori::knowledge(index)).data.clone();let design:[u8;32]=k[164..196].try_into().unwrap();let aid:[u8;32]=k[301..333].try_into().unwrap();let bytes=account(&a,artifact_address(&aid)).data[251..].to_vec();if k[365]==0{let(next,_,_)=ori::history(&vm,a,&bytes,&design);a=next;}let audited=vm.process_instruction(&ori::audit_ix(&a,&bytes,&design),&a);assert_eq!(audited.raw_result,Ok(()));a=audited.resulting_accounts;}
 let recovered=vm.process_instruction(&ori::recover_ix(&a,count+1),&a);assert_eq!(recovered.raw_result,Ok(()));a=recovered.resulting_accounts;
 let mut steps=0;while read64(&account(&a,ori::named(b"task")).data,172)==0{let ix=ori::final_step_ix(&a,0,8);let result=vm.process_instruction(&ix,&a);assert_eq!(result.raw_result,Ok(()));a=result.resulting_accounts;steps+=1;assert!(steps<20);}assert_eq!(account(&a,ori::round(0)).data[426],0);assert_eq!(account(&a,ori::named(b"k-slot")).data[193],0);assert_eq!(read64(&account(&a,ori::round(0)).data,255),frontier);assert_eq!(read64(&account(&a,ori::round(0)).data,501),count+1);
 println!("ORI_REAL_OPENING seeds={count} rounds={} frontier={frontier} k=0 material=0 lab_minted=0 max_cu={peak}",count*73);
}

#[test]
fn incomplete_seed_prefix_cannot_seal_and_late_registration_cannot_backdate(){
 let mut vm=runtime();vm.compute_budget.heap_size=262144;let a=initialized(&vm);let b=ori::bytes("candidate-c320.bin");let(a,prior,_)=ori::verify(&vm,a,&b);let(mut a,_,_)=ori::register(&vm,a,&b,&prior);let count=read64(&account(&a,ori::named(b"task")).data,164);assert_eq!(count,1);
 // Another signed nonce may refer to the already registered design but cannot
 // create another seed or knowledge entry.
 let retry=vm.process_instruction(&ori::register_ix(&a,&b,&prior),&a);assert_eq!(retry.raw_result,Ok(()));a=retry.resulting_accounts;assert_eq!(read64(&account(&a,ori::named(b"task")).data,164),1);
 let start=ori::reward_start(&a);clock_at(&mut vm,&mut a,start);add_empty(&mut a,ori::named(b"seed-final"));let incomplete=vm.process_instruction(&ori::seal_ix(&a,1),&a);assert_eq!(format!("{:?}",incomplete.raw_result),"Err(Custom(6719))");let late=vm.process_instruction(&ori::register_ix(&a,&b,&prior),&a);assert_eq!(format!("{:?}",late.raw_result),"Err(Custom(6717))");assert_eq!(late.resulting_accounts,a);
}
