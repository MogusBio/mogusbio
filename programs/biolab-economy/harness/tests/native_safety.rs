//! Deliberate program-owned storage corruption here is an adversarial fixture.
//! No production instruction can perform those writes or inject a PASS/fault.
mod support;
use support::*;
#[path="support/originality.rs"]mod originality;
use originality as ori;

fn one_seed(vm:&Mollusk)->(Vec<(Pubkey,Account)>,Vec<u8>,[u8;32]){let a=initialized(vm);let b=ori::bytes("candidate-c320.bin");let(a,prior,_)=ori::verify(vm,a,&b);let design=prior[62..94].try_into().unwrap();let(a,_,_)=ori::register(vm,a,&b,&prior);(a,b,design)}
#[test]
fn known_pass_matches_cannot_pause_link_fault_seals_once_and_full_audit_recovers(){
 let mut vm=runtime();vm.compute_budget.heap_size=262144;let(mut a,b,design)=one_seed(&vm);let reward=ori::reward_start(&a);clock_at(&mut vm,&mut a,reward+1);let(mut a,prior,_)=ori::history(&vm,a,&b,&design);ori::prepare_proof(&mut a,&prior);
 let matching=vm.process_instruction(&ori::prove_ix(&a,&b,&prior,&design,0),&a);assert_eq!(format!("{:?}",matching.raw_result),"Err(Custom(6734))");assert_eq!(matching.resulting_accounts,a);assert_eq!(account(&a,ori::named(b"task")).data[238],0);
 let mut wrong=ori::prove_ix(&a,&b,&prior,&design,0);let header=wrong.data.len()-160;wrong.data[header+84]^=1;let unknown=vm.process_instruction(&wrong,&a);assert!(unknown.raw_result.is_err());assert_eq!(unknown.resulting_accounts,a);
 // First-publication metadata also affects novelty. H7/H16 equality alone
 // must not hide a corrupted first event or a swapped Disclosure identity.
 for field in [196usize,228]{let mut corrupt=a.clone();if field==228{let first=read64(&account(&corrupt,ori::knowledge(0)).data,228);account_mut(&mut corrupt,ori::knowledge(0)).data[228..236].copy_from_slice(&(first+1).to_le_bytes());account_mut(&mut corrupt,ori::knowledge(0)).data[236..244].copy_from_slice(&(first+2).to_le_bytes());}else{account_mut(&mut corrupt,ori::knowledge(0)).data[field]^=1;}let r=vm.process_instruction(&ori::prove_ix(&corrupt,&b,&prior,&design,0),&corrupt);assert_eq!(r.raw_result,Ok(()),"Disclosure link offset {field}");let correct=&account(&r.resulting_accounts,ori::knowledge(1)).data;assert_eq!(&correct[196..236],&account(&a,ori::knowledge(0)).data[196..236]);}
 // This is the exact corruption under test, not an exposed setter.
 account_mut(&mut a,ori::knowledge(0)).data[260..268].copy_from_slice(&321u64.to_le_bytes());
 let result=vm.process_instruction(&ori::prove_ix(&a,&b,&prior,&design,0),&a);println!("SAFETY_LINK_PROOF cu={} raw={:?}",result.compute_units_consumed,result.raw_result);assert_eq!(result.raw_result,Ok(()));a=result.resulting_accounts;
 assert_eq!(account(&a,ori::named(b"task")).data[238],1);assert_eq!(read64(&account(&a,ori::named(b"task")).data,239),1);assert_eq!(account(&a,ori::knowledge(0)).data[365],1);assert_eq!(account(&a,ori::knowledge(1)).data[268],2);assert_eq!(account(&a,ori::safety(1)).data[200],1);
 ori::prepare_proof(&mut a,&prior);let repeat=vm.process_instruction(&ori::prove_ix(&a,&b,&prior,&design,0),&a);assert_eq!(format!("{:?}",repeat.raw_result),"Err(Custom(6736))");assert_eq!(repeat.resulting_accounts,a);
 for _ in 0..2{let audit=vm.process_instruction(&ori::audit_ix(&a,&b,&design),&a);assert_eq!(audit.raw_result,Ok(()));a=audit.resulting_accounts;}
 assert_eq!(account(&a,ori::safety(1)).data[325],2);let stale=vm.process_instruction(&ori::recover_ix(&a,1),&a);assert_eq!(format!("{:?}",stale.raw_result),"Err(Custom(6742))");assert_eq!(stale.resulting_accounts,a);let r=vm.process_instruction(&ori::recover_ix(&a,2),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;assert_eq!(account(&a,ori::named(b"task")).data[238],0);assert_eq!(read64(&account(&a,ori::named(b"task")).data,181),320);assert_eq!(account(&a,ori::safety(1)).data[325],3);assert_eq!(read64(&account(&a,pda(b"lab-mint")).data,36),N);
}

#[test]
fn exact_bound_structure_and_function_failures_are_captured_but_budget_traps_are_unknown(){
 for functional in [false,true]{let mut vm=runtime();vm.compute_budget.heap_size=262144;let(mut a,good,design)=one_seed(&vm);let mut bad=good.clone();let glen=u32::from_le_bytes(bad[20..24].try_into().unwrap())as usize;
  if functional{let mut g=biolab_kernel::graph::decode_graph(&bad[24..24+glen]).unwrap();g.cells.iter_mut().find(|c|c.role==1).unwrap().v=500_000;let wire=biolab_kernel::graph::encode_graph(&g).unwrap();assert_eq!(wire.len(),glen);bad[24..24+glen].copy_from_slice(&wire);}else{bad[24+10]=21;}
  let(next,_)=put_artifact(&vm,a,1002,&bad);a=next;let forged=vm.process_instruction(&ori::history_begin_ix(&a,&bad,&design),&a);assert_eq!(format!("{:?}",forged.raw_result),"Err(Custom(6737))");assert_eq!(forged.resulting_accounts,a);
  // Simulated already-admitted source storage corruption, still bound to a
  // genuinely sealed complete Artifact. Remote users cannot edit this record.
  let id=artifact_id(1002,BOOT,&bad);account_mut(&mut a,ori::seed(&design)).data[184..216].copy_from_slice(&id);let reward=ori::reward_start(&a);clock_at(&mut vm,&mut a,reward+1);
  vm.compute_budget.compute_unit_limit=1000;let trapped=vm.process_instruction(&ori::history_begin_ix(&a,&bad,&design),&a);assert!(trapped.raw_result.is_err());assert_eq!(trapped.resulting_accounts,a);assert_eq!(account(&a,ori::named(b"task")).data[238],0);vm.compute_budget.compute_unit_limit=1_400_000;
  let(mut a,prior,_)=ori::history(&vm,a,&bad,&design);assert_ne!(ori::read_failure(&prior),0);ori::prepare_proof(&mut a,&prior);let proof=vm.process_instruction(&ori::prove_ix(&a,&bad,&prior,&design,0),&a);println!("SAFETY_FAIL functional={functional} code={} stage={} cu={} raw={:?}",ori::read_failure(&prior),prior[130],proof.compute_units_consumed,proof.raw_result);assert_eq!(proof.raw_result,Ok(()));a=proof.resulting_accounts;let p=&account(&a,ori::safety(1)).data;assert_eq!(p[200],2);assert_eq!(p[234],0);assert_eq!(read64(&account(&a,ori::named(b"task")).data,164),1);assert_eq!(account(&a,ori::knowledge(0)).data[365],1);
 }
}

#[test]
fn correction_origin_requires_same_identity_and_a_real_prior_disclosure(){
 let mut vm=runtime();vm.compute_budget.heap_size=262144;let(mut a,b,design)=one_seed(&vm);let start=ori::reward_start(&a);clock_at(&mut vm,&mut a,start+1);let(mut a,prior,_)=ori::history(&vm,a,&b,&design);ori::prepare_proof(&mut a,&prior);
 // All branches start from one genuinely executed and sealed accepted seed.
 // Only the explicitly selected stored field is corrupted, never a public setter.
 for case in 0..4 {
  let mut damaged=a.clone();
  match case {
   0=>account_mut(&mut damaged,ori::knowledge(0)).data[260..268].copy_from_slice(&321u64.to_le_bytes()),
   1=>account_mut(&mut damaged,ori::knowledge(0)).data[164]^=1,
   2=>{account_mut(&mut damaged,ori::knowledge(0)).data[196]^=1;let d=account_mut(&mut damaged,ori::disclosure(&design));d.data.clear();d.lamports=0;d.owner=SYSTEM;},
   _=>{let q=read64(&account(&damaged,ori::knowledge(0)).data,236);account_mut(&mut damaged,ori::disclosure(&design)).data[248..256].copy_from_slice(&q.to_le_bytes());}
  }
  let r=vm.process_instruction(&ori::prove_ix(&damaged,&b,&prior,&design,0),&damaged);println!("SAFETY_ORIGIN case={case} cu={} raw={:?}",r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));let proof=&account(&r.resulting_accounts,ori::safety(1)).data;let corrected=&account(&r.resulting_accounts,ori::knowledge(1)).data;
  assert_eq!(read64(proof,400),1);assert_eq!(read64(proof,433),if case==0{0}else{1});assert_eq!(&corrected[164..196],&design);
  if case==2 {assert!(read64(corrected,228)>read64(&account(&a,ori::knowledge(0)).data,236));}
  if case==0 {
   // A second repair of the same identity keeps the verified original anchor.
   let mut next=r.resulting_accounts;account_mut(&mut next,ori::knowledge(1)).data[260..268].copy_from_slice(&322u64.to_le_bytes());ori::prepare_proof(&mut next,&prior);let mut ix=ori::prove_ix(&next,&b,&prior,&design,1);ix.accounts.push(AccountMeta::new_readonly(ori::safety(1),false));let repeated=vm.process_instruction(&ix,&next);assert_eq!(repeated.raw_result,Ok(()));assert_eq!(read64(&account(&repeated.resulting_accounts,ori::safety(2)).data,433),0);assert_eq!(read64(&account(&repeated.resulting_accounts,ori::safety(2)).data,400),2);
  }
 }
 // Correct H8 ID with absent evidence is UNKNOWN: no fabricated historical H8.
 let mut missing=a;let d=account_mut(&mut missing,ori::disclosure(&design));d.data.clear();d.lamports=0;d.owner=SYSTEM;let r=vm.process_instruction(&ori::prove_ix(&missing,&b,&prior,&design,0),&missing);assert_eq!(format!("{:?}",r.raw_result),"Err(Custom(6737))");assert_eq!(r.resulting_accounts,missing);
}
