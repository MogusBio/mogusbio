//! Explicit historical14 profile only. C318 was genuinely novel relative to
//! that historical opening; the default16 production profile includes it K0.
//! Every blueprint, material, Root, fee, candidate and reward executes real SBF.
mod support;
use support::*;
#[path="support/mining.rs"]mod mining;
#[path="support/synthesis.rs"]mod synthesis;
#[path="support/originality.rs"]mod ori;
#[path="support/competition_safety.rs"]mod competition_safety;

fn pda_more(seeds:&[&[u8]])->Pubkey{Pubkey::find_program_address(seeds,&PROGRAM).0}
fn candidate(n:u64,i:u64)->Pubkey{pda_more(&[b"bio",b"candidate",&ori::round_id(n),&i.to_le_bytes()])}
fn winner(n:u64)->([u8;32],Pubkey){let id=hash(10,&[&domain(),&ori::round_id(n)]);(id,pda_more(&[b"bio",b"winner",&id]))}
fn activation(w:&[u8;32],seq:u64)->([u8;32],Pubkey){let id=hash(11,&[&domain(),&ori::FAMILY,w,&seq.to_le_bytes()]);(id,pda_more(&[b"bio",b"activation",&id]))}
fn kdir(seq:u64)->Pubkey{pda_more(&[b"bio",b"mining-k",&seq.to_le_bytes()])}
fn stocked(vm:&Mollusk)->Vec<(Pubkey,Account)>{
 let mut a=fixture();account_mut(&mut a,BOOT).lamports=50_000_000_000;let r=vm.process_instruction(&init_ix(0),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;prepare_create(&mut a,1);let r=vm.process_instruction(&create_project_ix(1,500_000,1_000_000),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;
 for(class,q,n)in[(1,30,2),(2,60,3),(3,15,4),(4,15,5)]{let id=project_id(1);prepare_buy(&mut a,id,class,0,BOOT);let r=vm.process_instruction(&buy_material_ix(n,id,class,q,0,BOOT,BOOT,500_000),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;}a
}
fn finalize_round_ix(a:&[(Pubkey,Account)],n:u64,bio:Pubkey,cid:&[u8;32],design:&[u8;32])->Instruction{
 let mut ix=ori::final_step_ix(a,n,8);let d=&account(a,ori::round(n)).data;if d.is_empty(){return ix;}let b=&d[120..];
 if b[117]==2&&read64(b,175)<read64(b,109){let ci=read64(b,175);let c=&account(a,candidate(n,ci)).data;let own=read64(c,460);ix.accounts.extend([AccountMeta::new_readonly(candidate(n,ci),false),AccountMeta::new_readonly(ori::commit_address(cid),false),AccountMeta::new_readonly(ori::disclosure(design),false),AccountMeta::new_readonly(ori::knowledge(own),false)]);let cur=read64(b,183);for k in cur..(cur+8).min(read64(b,93)){if k!=own{ix.accounts.push(AccountMeta::new_readonly(ori::knowledge(k),false));}}}
 if b[117]==3&&b[200]==1{let(wid,w)=winner(n);let(_,act)=activation(&wid,0);let c=&account(a,candidate(n,0)).data;ix.accounts.extend([AccountMeta::new_readonly(candidate(n,0),false),AccountMeta::new_readonly(ori::commit_address(cid),false),AccountMeta::new_readonly(ori::knowledge(read64(c,460)),false),AccountMeta::new(w,false),AccountMeta::new_readonly(root_address(&bio),false),AccountMeta::new(mining::root_reg(bio),false),AccountMeta::new_readonly(mining::position(bio,0),false),AccountMeta::new(act,false),AccountMeta::new(kdir(0),false),AccountMeta::new(pda(b"mining"),false),AccountMeta::new(mining::event_key(read64(&account(a,pda(b"mining")).data,160)),false)]);}
 ix
}
fn add_actual_comparison_component(vm:&Mollusk,mut a:Vec<(Pubkey,Account)>)->(Vec<(Pubkey,Account)>,Pubkey){
 for class in 1..=4{let project=project_id(1);prepare_buy(&mut a,project,class,0,BOOT);let x=buy_material_ix(next_nonce(&a,BOOT),project,class,1,0,BOOT,BOOT,500_000);let r=vm.process_instruction(&x,&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;}
 let(a,component)=manufacture_next(vm,a,1,0);(mining::stake(vm,a,component,BOOT,BOOT),component)
}
fn compare_actual_k_sequential_and_lazy(vm:&Mollusk,a:Vec<(Pubkey,Account)>,bio:Pubkey,component:Pubkey)->Vec<(Pubkey,Account)>{
 assert_ne!(std::env::var("BIOLAB_LAZY_SETTLEMENT").as_deref(),Ok("1"),"reference path must remain sequential");
 let base=mining::settle_through(vm,a,433);let mut reference=base.clone();for h in 433..436{reference=mining::settle_hour(vm,reference,h);}
 let mut lazy=base;for h in 433..436{lazy=mining::freeze_hour(vm,lazy,h);}
 assert_eq!(read64(&account(&lazy,pda(b"mining")).data,128),436);assert_eq!(read64(&account(&lazy,pda(b"mining")).data,184),0);
 // A later empty Hour can finalize while earlier real K debt remains pending.
 let x=mining::materialize_ix(&lazy,435);lazy=mining::execute(vm,lazy,x);assert_eq!(account(&lazy,mining::hour(435)).data[160],4);assert_ne!(account(&lazy,mining::hour(433)).data[160],4);
 // Interleave different Positions/hours. A single Position still cannot skip
 // its own hour433: reverse processing is a real rejected native instruction.
 for h in[433,434]{let x=mining::materialize_member_ix(&lazy,h,component,0);lazy=mining::execute(vm,lazy,x);}
 let bad=mining::materialize_member_ix(&lazy,434,bio,0);let r=vm.process_instruction(&bad,&lazy);assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,lazy);
 let before=read64(&account(&lazy,mining::position(bio,0)).data,351);
 for h in[433,434]{let old=read64(&account(&lazy,mining::position(bio,0)).data,351);let x=mining::materialize_member_ix(&lazy,h,bio,0);lazy=mining::execute(vm,lazy,x);assert_eq!(read64(&account(&lazy,mining::position(bio,0)).data,351)-old,856_164);}
 assert_eq!(read64(&account(&lazy,mining::position(bio,0)).data,351)-before,1_712_328);
 for instance in[bio,component]{assert_eq!(account(&lazy,mining::position(instance,0)),account(&reference,mining::position(instance,0)));assert_eq!(account(&lazy,mining::root_reg(instance)),account(&reference,mining::root_reg(instance)));}
 for key in[pda(b"treasury"),pda(b"lab-mint"),pda(b"lab-reserve")]{assert_eq!(account(&lazy,key),account(&reference,key));}
 for h in[433,434,435]{let x=&account(&lazy,mining::hour(h)).data;let y=&account(&reference,mining::hour(h)).data;assert_eq!(x[160],4);assert_eq!(x[481],1);for offset in[128,136,152,169,369,385]{assert_eq!(read64(x,offset),read64(y,offset));}}
 // Frozen denominator remains the same and the additional ordinary member
 // has no K. Splitting BIO ordinary/K floors would be exactly one atom short.
 let h=&account(&lazy,mining::hour(433)).data;let budget=read64(h,128)as u128;let den=u128::from_le_bytes(h[353..369].try_into().unwrap());let ordinary=95_040_000_000_000u128;let k=77_760_000_000_000u128;
 assert_eq!(budget*(ordinary+k)/den,856_164);assert_eq!(budget*ordinary/den+budget*k/den,856_163);assert_eq!(read64(h,369),858_542);
 println!("ECON4_TRUE_K_LAZY historical14=true candidateC318 winnerGenuine=true combinedPerHour856164 separateWrong856163 extraF1PerHour2378 globalFreeze436 laterHour435FinalBefore433=true ownReverseHourRejected=true exactSequentialLedgerMatch=true");lazy
}

#[test]
#[ignore="requires the separately compiled historical14 ELF and BIO_OPENING_PROFILE=historical14"]
fn historical14_actual_c318_candidate_winner_k_exit_and_true_claim(){
 assert_eq!(std::env::var("BIO_OPENING_PROFILE").as_deref(),Ok("historical14"),"never run historical award fixture against default16");
 let mut vm=runtime();vm.compute_budget.heap_size=262144;let a=stocked(&vm);let(mut a,_)=ori::prewarm(&vm,a);assert_eq!(initial_count(),14);let start=ori::reward_start(&a);clock_at(&mut vm,&mut a,start);add_empty(&mut a,ori::named(b"seed-final"));for _ in 0..2{let r=vm.process_instruction(&ori::seal_ix(&a,8),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;}assert_eq!(read64(&account(&a,ori::named(b"task")).data,181),320);
 let mut parts=Vec::new();for role in 1..=15{for primitive in 1..=4{let(next,id)=manufacture_next(&vm,a,primitive,if primitive==4{role}else{0});a=next;parts.push(id);}}
 a=mining::earn_then_exit(&mut vm,a,&parts,337);let lab=ata(&pda(b"lab-mint"),&BOOT);assert_eq!(read64(&account(&a,lab).data,64),48_083_160);
 let mut cells=Vec::new();for target in 1..=15{let p=synthesis::verify(&vm,a,target,&parts[(target as usize-1)*4..target as usize*4],2_000_000);let(next,id,_)=synthesis::finalize(&vm,p,800_000);a=next;cells.push(id);}
 let mut organs=Vec::new();for target in 16..=21{let roles=biolab_kernel::graph::members(target).unwrap();let inputs=roles.iter().map(|r|cells[*r as usize-1]).collect::<Vec<_>>();let p=synthesis::verify(&vm,a,target,&inputs,2_000_000);let(next,id,_)=synthesis::finalize(&vm,p,roles.len()as u64*1_600_000);a=next;organs.push(id);}
 let blueprint=ori::bytes("candidate-c318.bin");let glen=u32::from_le_bytes(blueprint[20..24].try_into().unwrap())as usize;let mut prepared=synthesis::verify_with_graph(&vm,a,22,&organs,2_000_000,&blueprint[24..24+glen]);assert_eq!(prepared.expected[2],"318");let design:[u8;32]=prepared.accounts.iter().find(|(k,_)|*k==synthesis::verification()).unwrap().1.data[332..364].try_into().unwrap();
 let n=5;clock_at(&mut vm,&mut prepared.accounts,start+360*3600);let commit_nonce=next_nonce(&prepared.accounts,BOOT);let cid=business_for(BOOT,commit_nonce);let salt=[79;32];let hidden=ori::commit_hash(n,BOOT,&design,commit_nonce+1,&salt);add_empty(&mut prepared.accounts,ori::round(n));add_empty(&mut prepared.accounts,ori::commit_address(&cid));let r=vm.process_instruction(&ori::commit_ix(&prepared.accounts,n,&hidden),&prepared.accounts);assert_eq!(r.raw_result,Ok(()));prepared.accounts=r.resulting_accounts;
 clock_at(&mut vm,&mut prepared.accounts,start+384*3600);let bio=instance_for(BOOT,commit_nonce+1);for k in[root_address(&bio),candidate(n,0)]{add_empty(&mut prepared.accounts,k);}for id in &organs{add_empty(&mut prepared.accounts,mining::root_reg(*id));}synthesis::prepare_registration(&mut prepared.accounts,true);let mut ix=synthesis::final_ix(&prepared.accounts,&prepared.bytes,&prepared.prior,12_000_000);ix.data.push(1);ix.data.extend_from_slice(&cid);ix.data.extend_from_slice(&salt);ix.data[120..124].copy_from_slice(&189u32.to_le_bytes());ix.accounts.extend([AccountMeta::new_readonly(ori::named(b"seed-final"),false),AccountMeta::new(ori::commit_address(&cid),false),AccountMeta::new(candidate(n,0),false)]);let r=vm.process_instruction(&ix,&prepared.accounts);println!("COMPETITION_REAL_BIO C318 cu={} raw={:?}",r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;assert_eq!(read64(&account(&a,lab).data,64),83_160);assert_eq!(read64(&account(&a,ori::named(b"task")).data,181),318);assert_eq!(read64(&account(&a,ori::named(b"task")).data,164),15);
 a=mining::stake(&vm,a,bio,BOOT,BOOT);clock_at(&mut vm,&mut a,start+432*3600+1);
 for round in 0..=n{add_empty(&mut a,ori::round(round));for _ in 0..32{let(wid,w)=winner(round);let(_,act)=activation(&wid,0);for k in[w,act,kdir(0),mining::event_key(read64(&account(&a,pda(b"mining")).data,160))]{add_empty(&mut a,k);}let ix=finalize_round_ix(&a,round,bio,&cid,&design);let r=vm.process_instruction(&ix,&a);println!("COMPETITION_FINAL round={round} cu={} raw={:?}",r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;if account(&a,ori::round(round)).data[237]==4{break;}}assert_eq!(account(&a,ori::round(round)).data[237],4);}
 let(wid,w)=winner(n);let(_,act)=activation(&wid,0);assert_eq!(account(&a,w).data.len(),372);assert_eq!(account(&a,ori::named(b"k-slot")).data[193],1);assert_eq!(read64(&account(&a,act).data,304),433);assert_eq!(account(&a,act).data[312],0);
 let repeat=vm.process_instruction(&ori::final_step_ix(&a,n,8),&a);assert!(repeat.raw_result.is_err());assert_eq!(repeat.resulting_accounts,a);
 let(next,comparison_component)=add_actual_comparison_component(&vm,a);a=next;
 // K and ordinary stop together at the next boundary; neither historic debt
 // nor the selected immutable Winner is erased, and no second mint occurs.
 clock_at(&mut vm,&mut a,start+434*3600+1);let e=read64(&account(&a,pda(b"mining")).data,160);for s in[e,e+1]{add_empty(&mut a,mining::event_key(s));}let mut p=bio.to_bytes().to_vec();p.extend_from_slice(&0u64.to_le_bytes());p.extend_from_slice(&read64(&account(&a,root_address(&bio)).data,354).to_le_bytes());p.extend_from_slice(&100_000_000u64.to_le_bytes());let mut m=prefix();m.extend([AccountMeta::new(pda(b"mining"),false),AccountMeta::new_readonly(root_address(&bio),false),AccountMeta::new(mining::root_reg(bio),false),AccountMeta::new(mining::position(bio,0),false),AccountMeta::new(mining::event_key(e+1),false),AccountMeta::new(ori::named(b"task"),false),AccountMeta::new(ori::named(b"k-slot"),false),AccountMeta::new(act,false),AccountMeta::new(mining::event_key(e),false)]);let exit=Instruction{program_id:PROGRAM,accounts:m,data:wire(21,next_nonce(&a,BOOT),&p)};let r=vm.process_instruction(&exit,&a);println!("COMPETITION_EXIT_K cu={} raw={:?}",r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;assert_eq!(read64(&account(&a,act).data,313),435);assert_eq!(account(&a,ori::named(b"k-slot")).data[193],2);
 a=mining::exit(&vm,a,comparison_component,BOOT);
 clock_at(&mut vm,&mut a,start+436*3600+1);a=compare_actual_k_sequential_and_lazy(&vm,a,bio,comparison_component);let debt=read64(&account(&a,mining::position(bio,0)).data,351);let h=&account(&a,mining::hour(433)).data;let kw=u128::from_le_bytes(h[321..337].try_into().unwrap());assert_eq!(kw,77_760_000_000_000);assert_eq!(read64(h,369),858_542);assert_eq!(read64(&account(&a,mining::hour(434)).data,369),858_542);assert_eq!(debt,24_315_048);assert_eq!(read64(&account(&a,pda(b"mining")).data,120),62);assert_eq!(read64(&account(&a,pda(b"mining")).data,184),0);a=mining::claim(&vm,a,bio,0,BOOT);assert_eq!(read64(&account(&a,lab).data,64),83_160+debt);assert_eq!(read64(&account(&a,mining::position(bio,0)).data,359),debt);assert_eq!(read64(&account(&a,pda(b"lab-mint")).data,36),N-48_000_000);println!("COMPETITION_DONE actualCost318 ordinary_plus_K_atoms={debt} historicWinner={} Kstart433 Kend435",w);let _=competition_safety::verify_fault_with_open_k(&mut vm,a,bio,wid,w,&prepared.bytes,design);
}
