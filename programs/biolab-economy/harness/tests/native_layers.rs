//! Actual raw-token purchase -> 60 P5 -> earned LAB -> 15 CELL -> 6 ORGAN -> BIO.
//! Only SOL is set at local genesis; all material/LAB balances come from programs.
mod support;
use support::*;
#[path="support/mining.rs"]mod mining;
#[path="support/synthesis.rs"]mod synthesis;
#[path="support/originality.rs"]mod originality;
#[path="support/trace.rs"]mod trace;

fn stocked_with_genesis_rent(vm:&Mollusk)->Vec<(Pubkey,Account)>{
    let mut a=fixture();account_mut(&mut a,BOOT).lamports=50_000_000_000;
    let init=vm.process_instruction(&init_ix(0),&a);assert_eq!(init.raw_result,Ok(()));a=init.resulting_accounts;
    prepare_create(&mut a,1);let launched=vm.process_instruction(&create_project_ix(1,500_000,1_000_000),&a);assert_eq!(launched.raw_result,Ok(()));a=launched.resulting_accounts;
    let id=project_id(1);for(class,q,n)in[(1,30,2),(2,60,3),(3,15,4),(4,15,5)]{prepare_buy(&mut a,id,class,0,BOOT);let result=vm.process_instruction(&buy_material_ix(n,id,class,q,0,BOOT,BOOT,500_000),&a);assert_eq!(result.raw_result,Ok(()));a=result.resulting_accounts;}a
}
fn organ_roles(target:u8)->Vec<u8>{biolab_kernel::graph::members(target).unwrap()}
fn evidence_tag()->String{let b=std::fs::read(std::path::PathBuf::from(std::env::var("SBF_OUT_DIR").unwrap()).join("biolab_economy.so")).unwrap();synthesis::hex(&synthesis::sha(&b))[..8].to_owned()}
fn save_checkpoint(a:&[(Pubkey,Account)],parts:&[Pubkey]){
    let mut b=b"BIOLEDG1".to_vec();b.extend_from_slice(&config_id());b.extend_from_slice(&(parts.len()as u32).to_le_bytes());for p in parts{b.extend_from_slice(p.as_ref());}b.extend_from_slice(&(a.len()as u32).to_le_bytes());
    for(k,v)in a{b.extend_from_slice(k.as_ref());b.extend_from_slice(&v.lamports.to_le_bytes());b.extend_from_slice(v.owner.as_ref());b.push(u8::from(v.executable));b.extend_from_slice(&v.rent_epoch.to_le_bytes());b.extend_from_slice(&(v.data.len()as u32).to_le_bytes());b.extend_from_slice(&v.data);}
    let path=synthesis::evidence_dir().join(format!("actual-funded-{}-{}-checkpoint.bin",evidence_tag(),synthesis::hex(&config_id())));std::fs::write(&path,&b).unwrap();std::fs::write(path.with_extension("sha256"),synthesis::hex(&synthesis::sha(&b))).unwrap();
}
fn load_debug_checkpoint(vm:&mut Mollusk)->(Vec<(Pubkey,Account)>,Vec<Pubkey>){
    let path=synthesis::evidence_dir().join(format!("actual-funded-{}-{}-checkpoint.bin",evidence_tag(),synthesis::hex(&config_id())));let b=std::fs::read(if path.exists(){path}else{synthesis::evidence_dir().join("actual-funded-ledger-checkpoint.bin")}).unwrap();assert_eq!(&b[..8],b"BIOLEDG1");assert_eq!(&b[8..40],config_id());let mut at=40;let n=u32::from_le_bytes(b[at..at+4].try_into().unwrap())as usize;at+=4;let mut parts=Vec::new();for _ in 0..n{parts.push(Pubkey::new_from_array(b[at..at+32].try_into().unwrap()));at+=32;}let n=u32::from_le_bytes(b[at..at+4].try_into().unwrap())as usize;at+=4;let mut a=Vec::new();for _ in 0..n{let k=Pubkey::new_from_array(b[at..at+32].try_into().unwrap());at+=32;let lamports=read64(&b,at);at+=8;let owner=Pubkey::new_from_array(b[at..at+32].try_into().unwrap());at+=32;let executable=b[at]==1;at+=1;let rent_epoch=read64(&b,at);at+=8;let len=u32::from_le_bytes(b[at..at+4].try_into().unwrap())as usize;at+=4;let data=b[at..at+len].to_vec();at+=len;a.push((k,Account{lamports,data,owner,executable,rent_epoch}));}assert_eq!(at,b.len());let now=i64::from_le_bytes(account(&a,CLOCK).data[32..40].try_into().unwrap());clock_at(vm,&mut a,now);(a,parts)
}
fn save_final_checkpoint(a:&[(Pubkey,Account)],bio:Pubkey){
    let elf=std::fs::read(std::path::PathBuf::from(std::env::var("SBF_OUT_DIR").unwrap()).join("biolab_economy.so")).unwrap();let mut b=b"BIOFIN01".to_vec();b.extend_from_slice(&config_id());b.extend_from_slice(&synthesis::sha(&elf));b.extend_from_slice(bio.as_ref());b.extend_from_slice(&(a.len()as u32).to_le_bytes());
    for(k,v)in a{b.extend_from_slice(k.as_ref());b.extend_from_slice(&v.lamports.to_le_bytes());b.extend_from_slice(v.owner.as_ref());b.push(u8::from(v.executable));b.extend_from_slice(&v.rent_epoch.to_le_bytes());b.extend_from_slice(&(v.data.len()as u32).to_le_bytes());b.extend_from_slice(&v.data);}
    let digest=synthesis::hex(&synthesis::sha(&b));let elf_hash=synthesis::hex(&synthesis::sha(&elf));let path=synthesis::evidence_dir().join(format!("actual-final-bio-{}-{}.bin",&elf_hash[..8],&digest[..12]));if path.exists(){assert_eq!(std::fs::read(&path).unwrap(),b);}else{std::fs::write(&path,&b).unwrap();}std::fs::write(path.with_extension("sha256"),&digest).unwrap();std::fs::write(synthesis::evidence_dir().join(format!("actual-final-bio-{}-{}.bin",evidence_tag(),synthesis::hex(&synthesis::sha(&b)))),&b).unwrap();
}

#[test]
fn actual_sixty_parts_earned_fees_all_layers_and_bio_ordinary_mining(){
    let mut vm=runtime();vm.compute_budget.heap_size=262144;
    let debug_resume=std::env::var("BIOLAB_DEBUG_RESUME_ACTUAL_LEDGER").is_ok();let trace=trace::Trace::install(&mut vm,!debug_resume);let(mut a,parts)=if debug_resume{println!("DEBUG_RESUME_ONLY: loading a checkpoint written after actual programs earned all funding; this is not a cold full-chain acceptance run");load_debug_checkpoint(&mut vm)}else{
        let a=stocked_with_genesis_rent(&vm);let(mut a,_)=originality::prewarm(&vm,a);let start=originality::reward_start(&a);clock_at(&mut vm,&mut a,start);add_empty(&mut a,originality::named(b"seed-final"));for _ in 0..2{let r=vm.process_instruction(&originality::seal_ix(&a,8),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;}
        let mut parts=Vec::new();for role in 1..=15{for primitive in 1..=4{let(next,id)=manufacture_next(&vm,a,primitive,if primitive==4{role}else{0});a=next;parts.push(id);}}assert_eq!(parts.len(),60);println!("LAYER_MINING_FUNDING_START parts=60 active_hours=337");let a=mining::earn_then_exit(&mut vm,a,&parts,337);save_checkpoint(&a,&parts);(a,parts)};
    let lab=ata(&pda(b"lab-mint"),&BOOT);let earned=read64(&account(&a,lab).data,64);assert_eq!(earned,48_083_160);println!("LAYER_MINING_FUNDING_DONE earned_atoms={earned}");
    let mut all_inputs=parts.clone();let mut cells=Vec::new();let mut organs=Vec::new();let mut max_cu=0;let mut total_steps=0;
    for target in 1..=15u8{let p=synthesis::verify(&vm,a,target,&parts[(target as usize-1)*4..target as usize*4],2_000_000);total_steps+=p.steps;let(next,id,cu)=synthesis::finalize(&vm,p,800_000);a=next;cells.push(id);max_cu=max_cu.max(cu);}
    assert_eq!(read64(&account(&a,lab).data,64),earned-12_000_000);all_inputs.extend(&cells);
    for target in 16..=21{let roles=organ_roles(target);let directs=roles.iter().map(|r|cells[*r as usize-1]).collect::<Vec<_>>();let p=synthesis::verify(&vm,a,target,&directs,2_000_000);total_steps+=p.steps;let(next,id,cu)=synthesis::finalize(&vm,p,roles.len()as u64*1_600_000);a=next;organs.push(id);max_cu=max_cu.max(cu);}
    all_inputs.extend(&organs);assert_eq!(read64(&account(&a,lab).data,64),earned-36_000_000);
    // q2 BIO atomically discloses and registers verified Knowledge. C320 was
    // public before Opening: copying it earns ordinary mining, never new K.
    let p=synthesis::verify(&vm,a,22,&organs,2_000_000);total_steps+=p.steps;assert_eq!(p.expected[1],"2000000");assert_eq!(p.expected[2],"320");let(next,bio,cu)=synthesis::finalize(&vm,p,12_000_000);a=next;max_cu=max_cu.max(cu);assert_eq!(read64(&account(&a,originality::named(b"task")).data,181),if initial_count()==16{316}else{320});assert_eq!(account(&a,originality::named(b"k-slot")).data[193],0);
    assert_eq!(read64(&account(&a,lab).data,64),83_160);assert_eq!(read64(&account(&a,pda(b"lab-mint")).data,36),N-48_000_000);
    for id in &all_inputs{assert_eq!(account(&a,root_address(id)).data[362],1);}assert_eq!(account(&a,root_address(&bio)).data[362],0);
    a=mining::stake(&vm,a,bio,BOOT,BOOT);let start=mining::local_start(&a);let h=((vm.sysvars.clock.unix_timestamp-start)/3600)as u64;
    clock_at(&mut vm,&mut a,start+(h as i64+2)*3600+1);a=mining::exit(&vm,a,bio,BOOT);clock_at(&mut vm,&mut a,start+(h as i64+3)*3600+1);a=mining::settle_through(&vm,a,h+3);a=mining::claim(&vm,a,bio,0,BOOT);
    let final_atoms=read64(&account(&a,lab).data,64);assert_eq!(final_atoms,1_024_940);assert!(max_cu<=1_400_000);save_final_checkpoint(&a,bio);
    let report=format!("cold_full_chain={}\nlazy_settlement={}\nactual_p5=60\nactual_cells=15\nactual_organs=6\nactual_bio=1\nbio_instance={bio}\nconsumed_roots={}\nfunding_atoms={earned}\nfees_burned_atoms=48000000\nremaining_before_bio_mining_atoms=83160\nbio_two_hour_reward_atoms={}\nfinal_lab_atoms={final_atoms}\nmax_cu={max_cu}\nverification_steps={total_steps}\nheap_request=262144\nseed_copy_K_reward_atoms=0\n",!debug_resume,std::env::var("BIOLAB_LAZY_SETTLEMENT").as_deref()==Ok("1"),all_inputs.len(),final_atoms-83_160);println!("{report}");std::fs::write(synthesis::evidence_dir().join(format!("native-all-layers-{}-result.txt",evidence_tag())),&report).unwrap();if let Some(trace)=trace{trace.finish(&report);}
}
