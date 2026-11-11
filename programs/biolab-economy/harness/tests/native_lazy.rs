//! ECON4 actual SBF: every asset/debt is manufactured/earned through handlers.
mod support;
use support::*;
#[path="support/mining.rs"] mod mining;
#[path="support/trace.rs"] mod trace;

fn setup(n: usize)->(Mollusk,Vec<(Pubkey,Account)>,Vec<Pubkey>,i64){
    let mut vm=runtime();
    let (mut a,first)=manufactured(&vm);let mut roots=vec![first];
    for _ in 1..n{let(next,r)=manufacture_next(&vm,a,1,0);a=next;roots.push(r);}
    let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+1);
    for r in &roots{a=mining::stake(&vm,a,*r,BOOT,BOOT);}
    a=mining::create_lab_ata(&vm,a,BOOT);
    // A second permissionless caller is funded only with test-genesis SOL;
    // every material, Root and LAB entitlement still uses the real handlers.
    a.push((OTHER,Account{lamports:1_000_000_000,owner:SYSTEM,..Default::default()}));
    add_empty(&mut a,nonce(&OTHER));
    clock_at(&mut vm,&mut a,start+7201);
    a=mining::settle_hour(&vm,a,0);
    (vm,a,roots,start)
}
fn execute(vm:&Mollusk,a:Vec<(Pubkey,Account)>,ix:Instruction)->Vec<(Pubkey,Account)>{
    assert!(legacy_packet_size(&[ix.clone()])<=1232);
    let r=vm.process_instruction(&ix,&a);
    println!("ECON4_EXEC cu={} raw={:?}",r.compute_units_consumed,r.raw_result);
    assert_eq!(r.raw_result,Ok(()));r.resulting_accounts
}
fn ix(a:&[(Pubkey,Account)],op:u8,p:Vec<u8>,suffix:Vec<AccountMeta>,actor:Pubkey)->Instruction{
    let mut m=prefix_actor(actor);m.extend(suffix);
    let n=&account(a,nonce(&actor)).data;let next=if n.is_empty(){0}else{read64(n,120)};
    Instruction{program_id:PROGRAM,accounts:m,data:wire_actor(op,next,&p,actor)}
}
fn book()->Vec<AccountMeta>{vec![AccountMeta::new_readonly(pda(b"lab-mint"),false),AccountMeta::new_readonly(pda(b"lab-reserve"),false),AccountMeta::new_readonly(pda(b"lab-auth"),false),AccountMeta::new(pda(b"treasury"),false)]}
fn advance_ix(a:&[(Pubkey,Account)],h:u64,actor:Pubkey)->Instruction{
    let mut p=h.to_le_bytes().to_vec();p.extend_from_slice(&100_000_000u64.to_le_bytes());
    ix(a,29,p,vec![AccountMeta::new(pda(b"mining"),false),AccountMeta::new(mining::hour(h),false)],actor)
}
fn open(vm:&Mollusk,mut a:Vec<(Pubkey,Account)>,h:u64)->Vec<(Pubkey,Account)>{
    a=mining::apply_pending_events(vm,a,h);add_empty(&mut a,mining::hour(h));
    let ev=read64(&account(&a,pda(b"mining")).data,168);add_empty(&mut a,mining::event_key(ev));
    let x=mining::open_ix(&a,h);execute(vm,a,x)
}
fn freeze(vm:&Mollusk,a:Vec<(Pubkey,Account)>,h:u64)->Vec<(Pubkey,Account)>{
    let a=open(vm,a,h);let x=advance_ix(&a,h,BOOT);execute(vm,a,x)
}
fn mat_ix(a:&[(Pubkey,Account)],h:u64,root:Pubkey,seq:u64,actor:Pubkey)->Instruction{
    let rr=&account(a,mining::root_reg(root)).data;let dir=read64(rr,364);
    let mut p=h.to_le_bytes().to_vec();p.extend_from_slice(&read64(&account(a,mining::hour(h)).data,152).to_le_bytes());p.extend_from_slice(&seq.to_le_bytes());p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m=book();m.extend([AccountMeta::new(pda(b"mining"),false),AccountMeta::new(mining::hour(h),false),AccountMeta::new_readonly(mining::directory(dir),false),AccountMeta::new(mining::root_reg(root),false),AccountMeta::new(mining::position(root,seq),false)]);
    ix(a,25,p,m,actor)
}
fn mat(vm:&Mollusk,a:Vec<(Pubkey,Account)>,h:u64,root:Pubkey,seq:u64)->Vec<(Pubkey,Account)>{let x=mat_ix(&a,h,root,seq,BOOT);execute(vm,a,x)}
fn fail(vm:&Mollusk,a:&[(Pubkey,Account)],x:Instruction){let r=vm.process_instruction(&x,a);assert!(r.raw_result.is_err(),"unexpected pass");assert_eq!(r.resulting_accounts,a);}
fn transfer_ix(a:&[(Pubkey,Account)],root:Pubkey,to:Pubkey)->Instruction{
    let mut p=root.to_bytes().to_vec();p.extend_from_slice(&read64(&account(a,mining::root(root)).data,354).to_le_bytes());p.extend_from_slice(&read64(&account(a,mining::root_reg(root)).data,152).to_le_bytes());p.extend_from_slice(to.as_ref());p.extend_from_slice(&100_000_000u64.to_le_bytes());
    ix(a,26,p,vec![AccountMeta::new(pda(b"mining"),false),AccountMeta::new(mining::root(root),false),AccountMeta::new(mining::root_reg(root),false)],BOOT)
}
fn skip_ix(a:&[(Pubkey,Account)],from:u64,to:u64)->Instruction{
    let ec=read64(&account(a,pda(b"mining")).data,168);let mut p=from.to_le_bytes().to_vec();p.extend_from_slice(&to.to_le_bytes());p.extend_from_slice(&100_000_000u64.to_le_bytes());let mut m=book();m.extend([AccountMeta::new(pda(b"mining"),false),AccountMeta::new_readonly(mining::hour(from),false),AccountMeta::new_readonly(mining::event_key(ec),false)]);ix(a,28,p,m,BOOT)
}
fn close_ix(a:&[(Pubkey,Account)],h:u64,actor:Pubkey,payer:Pubkey)->Instruction{
    let mut p=h.to_le_bytes().to_vec();p.extend_from_slice(&100_000_000u64.to_le_bytes());let mut m=vec![AccountMeta::new(pda(b"mining"),false),AccountMeta::new(mining::hour(h),false)];if actor!=payer{m.push(AccountMeta::new(payer,false));}ix(a,27,p,m,actor)
}
fn state(a:&[(Pubkey,Account)],r:Pubkey,seq:u64)->(u64,u64,u64){let b=&account(a,mining::position(r,seq)).data;(read64(b,351),read64(b,359),read64(b,367))}

#[test]
fn genuine_sequential_and_partial_prefix_then_arbitrary_lazy_order_are_identical(){
    let(vm,a,roots,_)=setup(3);let base=open(&vm,a,1);
    assert_eq!(account(&base,mining::hour(1)).data.len(),482);assert_eq!(&account(&base,mining::hour(1)).data[12..14],&4u16.to_le_bytes());
    let mut sequential=base.clone();for _ in &roots{let x=mining::materialize_ix(&sequential,1);sequential=execute(&vm,sequential,x);}
    let x=mining::materialize_ix(&base,1);let mut lazy=execute(&vm,base,x);
    let treasury=account(&lazy,pda(b"treasury")).clone();let mint=account(&lazy,pda(b"lab-mint")).clone();let reserve=account(&lazy,pda(b"lab-reserve")).clone();
    let x=advance_ix(&lazy,1,BOOT);lazy=execute(&vm,lazy,x);
    assert_eq!(account(&lazy,pda(b"treasury")),&treasury);assert_eq!(account(&lazy,pda(b"lab-mint")),&mint);assert_eq!(account(&lazy,pda(b"lab-reserve")),&reserve);
    for r in [roots[2],roots[1]]{lazy=mat(&vm,lazy,1,r,0);}
    for r in roots{assert_eq!(account(&lazy,mining::position(r,0)),account(&sequential,mining::position(r,0)));assert_eq!(account(&lazy,mining::root_reg(r)),account(&sequential,mining::root_reg(r)));}
    assert_eq!(account(&lazy,pda(b"treasury")),account(&sequential,pda(b"treasury")));
    let l=&account(&lazy,mining::hour(1)).data;let s=&account(&sequential,mining::hour(1)).data;
    assert_eq!(l[160],4);assert_eq!(l[481],1);assert_eq!(read64(l,369),read64(s,369));assert_eq!(read64(l,385),read64(s,385));assert_eq!(read64(&account(&lazy,pda(b"mining")).data,128),2);
}

#[test]
fn ignored_member_cannot_block_future_end_transfer_empty_skip_or_its_later_old_claim(){
    let(mut vm,mut a,roots,start)=setup(2);let ra=roots[0];let rb=roots[1];
    a=freeze(&vm,a,1);a=mat(&vm,a,1,rb,0);assert_eq!(state(&a,ra,0),(0,0,1));
    let early_close=close_ix(&a,1,OTHER,BOOT);fail(&vm,&a,early_close);
    clock_at(&mut vm,&mut a,start+10801);
    a=mining::exit(&vm,a,ra,BOOT);a=mining::exit(&vm,a,rb,BOOT);
    a=freeze(&vm,a,2);a=mat(&vm,a,2,rb,0);
    clock_at(&mut vm,&mut a,start+14401);a=freeze(&vm,a,3);a=mat(&vm,a,3,rb,0);
    let locked=transfer_ix(&a,ra,OTHER);fail(&vm,&a,locked);
    // Real END removes A despite its wholly unmaterialized [1,4) interval.
    a=mining::apply_pending_events(&vm,a,4);assert_eq!(read64(&account(&a,pda(b"mining")).data,184),0);
    let old_b=account(&a,mining::position(rb,0)).clone();let x=transfer_ix(&a,rb,OTHER);a=execute(&vm,a,x);assert_eq!(account(&a,mining::position(rb,0)),&old_b);
    clock_at(&mut vm,&mut a,start+36001);add_empty(&mut a,mining::hour(4));let ec=read64(&account(&a,pda(b"mining")).data,168);add_empty(&mut a,mining::event_key(ec));
    let before=account(&a,pda(b"treasury")).data.clone();let x=skip_ix(&a,4,10);a=execute(&vm,a,x);
    let after=&account(&a,pda(b"treasury")).data;
    // SYNC adds exactly [4,10), then EMPTY_SKIP seals exactly that new prefix.
    // Pending from the older lazy Hours must remain byte-for-byte intact.
    assert_eq!(read64(after,128),read64(&before,128));assert_eq!(read64(after,136),read64(&before,136));assert_eq!(read64(&before,120)-read64(after,120),read64(after,144)-read64(&before,144));assert_eq!(state(&a,ra,0),(0,0,1));
    for h in 1..4{let x=mat_ix(&a,h,ra,0,OTHER);a=execute(&vm,a,x);assert_eq!(read64(&account(&a,pda(b"mining")).data,128),10);}
    assert_eq!(state(&a,ra,0),(7134,0,4));assert_eq!(state(&a,rb,0),(7134,0,4));
    a=mining::claim(&vm,a,ra,0,OTHER);a=mining::claim(&vm,a,rb,0,OTHER);
    assert_eq!(read64(&account(&a,ata(&pda(b"lab-mint"),&BOOT)).data,64),14268);
    assert_eq!(read64(&account(&a,pda(b"treasury")).data,128),0);
    assert_eq!(read64(&account(&a,pda(b"mining")).data,128),10);
    let old_position=account(&a,mining::position(ra,0)).clone();let x=close_ix(&a,1,OTHER,BOOT);a=execute(&vm,a,x);assert!(account(&a,mining::hour(1)).data.is_empty());assert_eq!(account(&a,mining::position(ra,0)),&old_position);assert_eq!(read64(&account(&a,pda(b"mining")).data,128),10);
}

#[test]
fn advance_and_lazy_member_cas_exact_retry_permissions_and_transaction_rollback(){
    let(vm,a,roots,_)=setup(2);let a=open(&vm,a,1);let advance=advance_ix(&a,1,BOOT);
    let mut bad=advance.clone();bad.accounts.last_mut().unwrap().is_writable=false;fail(&vm,&a,bad);
    let mut later=advance.clone();later.data[0]=0;let r=vm.process_transaction_instructions(&[advance.clone(),later],&a,Some(&BOOT));assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,a);
    let a=execute(&vm,a,advance.clone());let r=vm.process_instruction(&advance,&a);assert_eq!(r.raw_result,Ok(()));assert_eq!(r.resulting_accounts,a);
    let fresh=advance_ix(&a,1,OTHER);fail(&vm,&a,fresh);
    let valid=mat_ix(&a,1,roots[1],0,BOOT);let stale=mat_ix(&a,1,roots[0],0,OTHER);let a=execute(&vm,a,valid.clone());
    let retry=vm.process_instruction(&valid,&a);assert_eq!(retry.raw_result,Ok(()));assert_eq!(retry.resulting_accounts,a);fail(&vm,&a,stale);
    let duplicate=mat_ix(&a,1,roots[1],0,OTHER);fail(&vm,&a,duplicate);
    let mut unknown=a.clone();add_empty(&mut unknown,mining::position(roots[0],1));let wrong_seq=mat_ix(&unknown,1,roots[0],1,OTHER);fail(&vm,&unknown,wrong_seq);
    let mut bad_dir=mat_ix(&a,1,roots[0],0,OTHER);let n=bad_dir.accounts.len();bad_dir.accounts[n-3]=AccountMeta::new_readonly(mining::directory(1),false);fail(&vm,&a,bad_dir);
    let mut forged=a.clone();account_mut(&mut forged,mining::position(roots[0],0)).data[253]^=1;let x=mat_ix(&forged,1,roots[0],0,OTHER);fail(&vm,&forged,x);
    let good=mat_ix(&a,1,roots[0],0,OTHER);let mut later=good.clone();later.data[0]=0;let r=vm.process_transaction_instructions(&[good.clone(),later],&a,Some(&OTHER));assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,a);
    let a=execute(&vm,a,good);assert_eq!(account(&a,mining::hour(1)).data[160],4);
}

#[test]
fn explicit_legacy_hour3_can_finish_sequentially_but_cannot_be_relabelled_lazy(){
    let(vm,a,roots,_)=setup(1);let mut a=open(&vm,a,1);
    // Decoder compatibility fixture only: no asset/debt/certificate is injected.
    let h=account_mut(&mut a,mining::hour(1));h.data.truncate(481);h.data[12..14].copy_from_slice(&3u16.to_le_bytes());h.data[80..84].copy_from_slice(&361u32.to_le_bytes());
    let x=advance_ix(&a,1,BOOT);fail(&vm,&a,x);
    let x=mining::materialize_ix(&a,1);let a=execute(&vm,a,x);assert_eq!(state(&a,roots[0],0),(2378,0,2));assert_eq!(account(&a,mining::hour(1)).data.len(),481);
}

#[test]
fn restake_keeps_earliest_own_coverage_and_old_lazy_eligibility_ignores_new_directory_links(){
    let(mut vm,mut a,roots,start)=setup(1);let root=roots[0];a=freeze(&vm,a,1);
    clock_at(&mut vm,&mut a,start+7202);a=mining::exit(&vm,a,root,BOOT); // end3
    clock_at(&mut vm,&mut a,start+10801);a=freeze(&vm,a,2);a=mining::apply_pending_events(&vm,a,3);
    a=mining::stake(&vm,a,root,BOOT,BOOT); // seq1 begins4; seq0 remains unsettled
    assert_eq!(read64(&account(&a,mining::root_reg(root)).data,258),0);
    clock_at(&mut vm,&mut a,start+18001);add_empty(&mut a,mining::hour(3));let ec=read64(&account(&a,pda(b"mining")).data,168);add_empty(&mut a,mining::event_key(ec));let x=skip_ix(&a,3,4);a=execute(&vm,a,x);
    a=freeze(&vm,a,4);let premature=mat_ix(&a,4,root,1,OTHER);fail(&vm,&a,premature);
    a=mat(&vm,a,1,root,0);a=mat(&vm,a,2,root,0);assert_eq!(read64(&account(&a,mining::root_reg(root)).data,258),1);
    a=mat(&vm,a,4,root,1);assert_eq!(state(&a,root,0),(4756,0,3));assert_eq!(state(&a,root,1),(2378,0,5));assert_eq!(read64(&account(&a,pda(b"mining")).data,128),5);
}

#[test]
fn empty_lazy_hour_defers_its_whole_residue_and_can_finish_without_rewinding(){
    let mut vm=runtime();let mut a=initialized(&vm);let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+3601);add_empty(&mut a,pda(b"mining"));
    let mut m=book();m.push(AccountMeta::new(pda(b"mining"),false));let x=ix(&a,22,100_000_000u64.to_le_bytes().to_vec(),m,BOOT);a=execute(&vm,a,x);
    a=freeze(&vm,a,0);let tr=account(&a,pda(b"treasury")).data.clone();assert!(read64(&tr,128)>0);assert_eq!(account(&a,mining::hour(0)).data[160],2);
    let early=close_ix(&a,0,BOOT,BOOT);fail(&vm,&a,early);let x=mining::materialize_ix(&a,0);a=execute(&vm,a,x);
    assert_eq!(read64(&account(&a,pda(b"mining")).data,128),1);assert_eq!(read64(&account(&a,pda(b"treasury")).data,128),0);assert_eq!(read64(&account(&a,pda(b"treasury")).data,136),0);assert_eq!(account(&a,mining::hour(0)).data[160],4);
    let x=close_ix(&a,0,BOOT,BOOT);a=execute(&vm,a,x);assert!(account(&a,mining::hour(0)).data.is_empty());
}

#[test]
fn first_real_registration_keeps_earlier_empty_lazy_pending_without_a_global_cleanup(){
    let mut vm=runtime();let(mut a,root)=manufactured(&vm);let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+3601);add_empty(&mut a,pda(b"mining"));
    let mut m=book();m.push(AccountMeta::new(pda(b"mining"),false));let x=ix(&a,22,100_000_000u64.to_le_bytes().to_vec(),m,BOOT);a=execute(&vm,a,x);a=freeze(&vm,a,0);
    let old_pending=read64(&account(&a,pda(b"treasury")).data,128);assert_eq!(read64(&account(&a,pda(b"mining")).data,120),0);
    clock_at(&mut vm,&mut a,start+7201);a=mining::stake(&vm,a,root,BOOT,BOOT);
    assert_eq!(read64(&account(&a,pda(b"mining")).data,128),2);assert_eq!(read64(&account(&a,pda(b"treasury")).data,128),old_pending);assert_eq!(state(&a,root,0),(0,0,3));
    let x=mining::materialize_ix(&a,0);a=execute(&vm,a,x);assert_eq!(read64(&account(&a,pda(b"treasury")).data,128),0);assert_eq!(read64(&account(&a,pda(b"mining")).data,128),2);
}

#[test]
#[ignore="requires an explicit BIOLAB_TRACE_FILE and the exact production fixture ELF"]
fn actual_lazy_cold_trace_fixture(){
    let mut vm=runtime();let trace=trace::Trace::install(&mut vm,true).expect("explicit trace file");
    let mut a=fixture();account_mut(&mut a,BOOT).lamports=50_000_000_000;
    a=execute(&vm,a,init_ix(0));prepare_create(&mut a,1);a=execute(&vm,a,create_project_ix(1,500_000,1_000_000));
    let project=project_id(1);for(class,q,n)in[(1,30,2),(2,60,3),(3,15,4),(4,15,5)]{prepare_buy(&mut a,project,class,0,BOOT);let x=buy_material_ix(n,project,class,q,0,BOOT,BOOT,500_000);a=execute(&vm,a,x);}
    let(next,ra)=manufacture_next(&vm,a,1,0);let(mut a,rb)=manufacture_next(&vm,next,1,0);let start=mining::local_start(&a);
    clock_at(&mut vm,&mut a,start+1);a=mining::stake(&vm,a,ra,BOOT,BOOT);a=mining::stake(&vm,a,rb,BOOT,BOOT);a=mining::create_lab_ata(&vm,a,BOOT);
    clock_at(&mut vm,&mut a,start+7201);a=mining::settle_hour(&vm,a,0);a=freeze(&vm,a,1);a=mat(&vm,a,1,rb,0);
    clock_at(&mut vm,&mut a,start+10801);a=mining::exit(&vm,a,ra,BOOT);a=mining::exit(&vm,a,rb,BOOT);a=freeze(&vm,a,2);a=mat(&vm,a,2,rb,0);
    clock_at(&mut vm,&mut a,start+14401);a=freeze(&vm,a,3);a=mat(&vm,a,3,rb,0);a=mining::apply_pending_events(&vm,a,4);
    clock_at(&mut vm,&mut a,start+36001);add_empty(&mut a,mining::hour(4));let ec=read64(&account(&a,pda(b"mining")).data,168);add_empty(&mut a,mining::event_key(ec));let x=skip_ix(&a,4,10);a=execute(&vm,a,x);
    for h in 1..4{a=mat(&vm,a,h,ra,0);}a=mining::claim(&vm,a,ra,0,BOOT);a=mining::claim(&vm,a,rb,0,BOOT);let x=close_ix(&a,1,BOOT,BOOT);a=execute(&vm,a,x);
    assert_eq!(read64(&account(&a,ata(&pda(b"lab-mint"),&BOOT)).data,64),14268);assert_eq!(read64(&account(&a,pda(b"mining")).data,128),10);assert_eq!(read64(&account(&a,pda(b"treasury")).data,128),0);
    trace.finish("ECON4 module-only cold:2 actual F1,3 lazy hours,A unprocessed while B earned,END applies,empty skip then old A claim,14268atoms,Hour1 rent closed; no full BIO lifecycle claimed");
}
