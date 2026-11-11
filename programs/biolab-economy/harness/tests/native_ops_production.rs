//! Formal ExactFrame/Ops5 profile. Bootstrap is deliberately not an Ops member.
//! Funds come only from the actual preceding project launch, never a SOL edit.
#![cfg(feature="production-fixture")]
mod support;
use support::*;
fn actor_nonce(a:&[(Pubkey,Account)],actor:Pubkey)->u64{let d=&account(a,nonce(&actor)).data;if d.is_empty(){0}else{read64(d,120)}}

fn fixture_ops(vm:&Mollusk)->Vec<(Pubkey,Account)>{
 let mut a=ops_fixture(vm);if !a.iter().any(|(k,_)|*k==OTHER){a.push((OTHER,Account{lamports:1_000_000_000,owner:SYSTEM,..Default::default()}));}a
}
fn queue_ix(a:&[(Pubkey,Account)],reference:[u8;32],expected:u64,amount:u64,before:i64,expires:i64,actor:Pubkey)->Instruction{
 let mut p=reference.to_vec();p.extend_from_slice(&expected.to_le_bytes());p.extend_from_slice(OTHER.as_ref());p.extend_from_slice(&amount.to_le_bytes());p.extend_from_slice(&EVIDENCE);p.extend_from_slice(&before.to_le_bytes());p.extend_from_slice(&expires.to_le_bytes());p.extend_from_slice(BOOT.as_ref());p.extend_from_slice(&100_000_000u64.to_le_bytes());
 let mut m=prefix_actor(actor);m.extend([AccountMeta::new(pda(b"ops"),false),AccountMeta::new(expense_address(&reference),false)]);append_wallets(&mut m,&[(OTHER,false,false),(BOOT,true,true)]);Instruction{program_id:PROGRAM,accounts:m,data:wire_actor(6,actor_nonce(a,actor),&p,actor)}
}
fn queue(vm:&Mollusk,mut a:Vec<(Pubkey,Account)>,reference:[u8;32],expected:u64,amount:u64,before:i64,expires:i64)->Vec<(Pubkey,Account)>{add_empty(&mut a,expense_address(&reference));let ix=queue_ix(&a,reference,expected,amount,before,expires,OPS_MEMBERS[0]);let before_balance=account(&a,pda(b"ops")).lamports;let r=vm.process_instruction(&ix,&a);assert_eq!(r.raw_result,Ok(()));assert_eq!(account(&r.resulting_accounts,pda(b"ops")).lamports,before_balance,"queue reserves no vault funds");r.resulting_accounts}
fn pay(a:&[(Pubkey,Account)],reference:[u8;32],expected:u64,amount:u64,before:i64,expires:i64,selected:[u8;3])->Instruction{pay_expense_ix(actor_nonce(a,OPS_MEMBERS[selected[0]as usize]),OPS_MEMBERS[selected[0]as usize],reference,expected,OTHER,amount,before,expires,selected,BOOT)}
fn reject(vm:&Mollusk,a:&[(Pubkey,Account)],ix:&Instruction){let r=vm.process_instruction(ix,a);assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,a);}

#[test]
fn actual_distinct_ops_three_of_five_pays_once_and_keeps_permanent_expense_and_nonce(){
 let vm=runtime();let now=vm.sysvars.clock.unix_timestamp;let a=fixture_ops(&vm);assert!(!OPS_MEMBERS.contains(&BOOT));let a=queue(&vm,a,EXPENSE_REF,0,3_000_000,now,now+1000);let ix=pay(&a,EXPENSE_REF,0,3_000_000,now,now+1000,[0,1,2]);let old_vault=account(&a,pda(b"ops")).lamports;let old_wallet=account(&a,OTHER).lamports;let r=vm.process_instruction(&ix,&a);println!("FORMAL_OPS_PAY cu={} result={:?} signatures={}",r.compute_units_consumed,r.raw_result,ix.accounts.iter().filter(|x|x.is_signer).count());assert_eq!(r.raw_result,Ok(()));let a=r.resulting_accounts;assert_eq!(account(&a,pda(b"ops")).lamports,old_vault-3_000_000);assert_eq!(account(&a,OTHER).lamports,old_wallet+3_000_000);assert_eq!(account(&a,expense_address(&EXPENSE_REF)).data[328],1);assert_eq!(read64(&account(&a,pda(b"ops")).data,128),3_000_000);let again=vm.process_instruction(&ix,&a);assert_eq!(again.raw_result,Ok(()));assert_eq!(again.resulting_accounts,a);reject(&vm,&a,&pay(&a,EXPENSE_REF,0,3_000_000,now,now+1000,[0,1,2]));
}
#[test]
fn formal_ops_requires_real_selected_signers_exact_quote_and_atomic_post_failure(){
 let vm=runtime();let now=vm.sysvars.clock.unix_timestamp;let a=fixture_ops(&vm);let outside=queue_ix(&a,EXPENSE_REF,0,3_000_000,now,now+1000,BOOT);reject(&vm,&a,&outside);let a=queue(&vm,a,EXPENSE_REF,0,3_000_000,now,now+1000);let valid=pay(&a,EXPENSE_REF,0,3_000_000,now,now+1000,[0,1,2]);for selected in[0,1,2]{let mut bad=valid.clone();bad.accounts.iter_mut().find(|x|x.pubkey==OPS_MEMBERS[selected]).unwrap().is_signer=false;reject(&vm,&a,&bad);}for at in[64usize,104,112]{let mut bad=valid.clone();bad.data[152+at]^=1;reject(&vm,&a,&bad);}let mut malformed=valid.clone();malformed.data[152+160..152+163].copy_from_slice(&[0,0,2]);reject(&vm,&a,&malformed);
 let mut fail=valid.clone();fail.data[0]=0;let r=vm.process_transaction_instructions(&[valid.clone(),fail],&a,Some(&BOOT));assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,a);let r=vm.process_instruction(&valid,&a);assert_eq!(r.raw_result,Ok(()));
}
#[test]
fn formal_ops_other_valid_three_and_competing_queued_expenses_use_actual_available_vault(){
 let vm=runtime();let now=vm.sysvars.clock.unix_timestamp;let a=fixture_ops(&vm);let a=queue(&vm,a,EXPENSE_REF,0,7_000_000,now,now+1000);let other=[10;32];let a=queue(&vm,a,other,1,7_000_000,now,now+1000);let r=vm.process_instruction(&pay(&a,EXPENSE_REF,0,7_000_000,now,now+1000,[1,3,4]),&a);assert_eq!(r.raw_result,Ok(()));let a=r.resulting_accounts;reject(&vm,&a,&pay(&a,other,1,7_000_000,now,now+1000,[0,2,4]));assert_eq!(account(&a,expense_address(&other)).data[328],0);assert_eq!(read64(&account(&a,pda(b"ops")).data,120),2);
}
#[test]
fn formal_ops_clock_window_and_queue_rent_cap_are_exact_without_clock_rollback(){
 let mut vm=runtime();let now=vm.sysvars.clock.unix_timestamp;let a=fixture_ops(&vm);let mut cap=queue_ix(&a,EXPENSE_REF,0,3_000_000,now+10,now+20,OPS_MEMBERS[0]);cap.data[152+160..152+168].copy_from_slice(&0u64.to_le_bytes());reject(&vm,&a,&cap);let a=queue(&vm,a,EXPENSE_REF,0,3_000_000,now+10,now+20);let ix=pay(&a,EXPENSE_REF,0,3_000_000,now+10,now+20,[0,1,2]);reject(&vm,&a,&ix);let mut exact=a.clone();clock_at(&mut vm,&mut exact,now+10);let paid=vm.process_instruction(&ix,&exact);assert_eq!(paid.raw_result,Ok(()));let mut expired=a;clock_at(&mut vm,&mut expired,now+20);reject(&vm,&expired,&ix);let mut replay=paid.resulting_accounts;clock_at(&mut vm,&mut replay,now+20);let r=vm.process_instruction(&ix,&replay);assert_eq!(r.raw_result,Ok(()));assert_eq!(r.resulting_accounts,replay);
}
