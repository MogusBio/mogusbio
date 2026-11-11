//! Production-path local acceptance, using explicitly public-only codec fixture
//! identities and Loader metadata fixtures. It does not deploy a program or
//! prove a live genesis/Loader state. The program executes the actual SBF ELF.
mod support;
use support::*;
#[allow(dead_code)]mod release{use super::Pubkey;include!("support/production_release.rs");}
const LOADER:Pubkey=pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
fn at(name:&[u8])->Pubkey{Pubkey::find_program_address(&[b"bio",name],&release::PROGRAM_ID).0}
fn nkey()->Pubkey{Pubkey::find_program_address(&[b"bio",b"actor-nonce",release::BOOTSTRAP.as_ref()],&release::PROGRAM_ID).0}
fn vm()->Mollusk{let mut v=Mollusk::new(&release::PROGRAM_ID,"biolab_economy");v.compute_budget.compute_unit_limit=1_400_000;v.compute_budget.heap_size=32768;v.sysvars.clock.slot=10;v.sysvars.clock.unix_timestamp=3600;token::add_program(&mut v);v}
fn fixture(v:&Mollusk)->Vec<(Pubkey,Account)>{
 let mut a=support::fixture();a.push((release::BOOTSTRAP,Account{lamports:2_000_000_000,owner:SYSTEM,..Default::default()}));for k in[nkey(),at(b"config"),at(b"econ-config"),at(b"lab-mint"),at(b"lab-reserve"),at(b"lab-auth"),at(b"treasury")]{add_empty(&mut a,k);}
 let mut p=2u32.to_le_bytes().to_vec();p.extend_from_slice(&release::PROGRAM_DATA_ADDRESS);a.push((release::PROGRAM_ID,Account{lamports:1_000_000,owner:LOADER,executable:true,data:p,..Default::default()}));let mut d=vec![0;49];d[..4].copy_from_slice(&3u32.to_le_bytes());d[4..12].copy_from_slice(&9u64.to_le_bytes());d[13..45].fill(0xa5);d[45]=0x7f;a.push((Pubkey::new_from_array(release::PROGRAM_DATA_ADDRESS),Account{lamports:1_000_000,owner:LOADER,data:d,..Default::default()}));*account_mut(&mut a,CLOCK)=v.sysvars.keyed_account_for_clock_sysvar().1;a
}
fn exact(module:u16,op:u16,schema:u16,nonce:u64,p:&[u8])->Vec<u8>{let mut b=b"BIOIX\0\0\0".to_vec();b.extend_from_slice(&1u16.to_le_bytes());for n in[module,op,schema]{b.extend_from_slice(&n.to_le_bytes());}b.extend_from_slice(&release::DEPLOYMENT_DOMAIN);b.extend_from_slice(&release::CONFIG_ID);b.extend_from_slice(release::BOOTSTRAP.as_ref());b.extend_from_slice(&nonce.to_le_bytes());b.extend_from_slice(&[0;24]);b.extend_from_slice(&(p.len()as u32).to_le_bytes());b.extend_from_slice(&[0;4]);b.extend_from_slice(p);b}
fn prefix()->Vec<AccountMeta>{vec![AccountMeta::new(release::BOOTSTRAP,true),AccountMeta::new(nkey(),false),AccountMeta::new(at(b"econ-config"),false),AccountMeta::new_readonly(INSTRUCTIONS,false),AccountMeta::new_readonly(SYSTEM,false),AccountMeta::new_readonly(token::ID,false),AccountMeta::new_readonly(CLOCK,false),AccountMeta::new(at(b"config"),false)]}
fn init()->Instruction{let mut p=release::BOOTSTRAP.to_bytes().to_vec();p.extend_from_slice(&100_000_000u64.to_le_bytes());let mut m=prefix();m.extend([AccountMeta::new(at(b"lab-mint"),false),AccountMeta::new(at(b"lab-reserve"),false),AccountMeta::new_readonly(at(b"lab-auth"),false),AccountMeta::new(at(b"treasury"),false),AccountMeta::new_readonly(release::PROGRAM_ID,false),AccountMeta::new_readonly(Pubkey::new_from_array(release::PROGRAM_DATA_ADDRESS),false)]);Instruction{program_id:release::PROGRAM_ID,accounts:m,data:exact(1,1,2,0,&p)}}

#[test]
#[ignore="requires the exact local-public-fixture ELF and BIO_NATIVE_PRODUCTION_FIXTURE=1"]
fn exact_production_init_checks_real_loader_writes_base_and_fixed_schedule_and_retries_original_hash(){
 assert_eq!(std::env::var("BIO_NATIVE_PRODUCTION_FIXTURE").as_deref(),Ok("1"));
 let vm=vm();let a=fixture(&vm);let ix=init();let r=vm.process_instruction(&ix,&a);println!("P0R2_REAL_INIT CU={} raw={:?}",r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));let a=r.resulting_accounts;assert_eq!(read64(&account(&a,at(b"lab-mint")).data,36),N);assert_eq!(read64(&account(&a,at(b"lab-reserve")).data,64),N);assert_eq!(&account(&a,at(b"lab-mint")).data[..4],&[0;4]);assert_eq!(&account(&a,at(b"config")).data[120..],&release::BASE_CONFIG_BODY);let c=&account(&a,at(b"econ-config")).data;assert_eq!(read64(c,304),3600);assert_eq!(read64(c,376),7200);assert_eq!(read64(c,384),93600);assert_eq!(&account(&a,nkey()).data[128..160],&hash(4,&[&ix.data]));
 let mut retry=ix.clone();retry.accounts.truncate(4);let repeated=vm.process_instruction(&retry,&a);assert_eq!(repeated.raw_result,Ok(()));assert_eq!(repeated.resulting_accounts,a);assert_eq!(repeated.return_data,r.return_data);
 let mut changed=retry.clone();changed.data[152+32]^=1;let bad=vm.process_instruction(&changed,&a);assert_eq!(format!("{:?}",bad.raw_result),"Err(Custom(6010))");assert_eq!(bad.resulting_accounts,a);
 let mut malformed=ix.clone();malformed.data[120]=1;let bad=vm.process_instruction(&malformed,&a);assert!(bad.raw_result.is_err());assert_eq!(bad.resulting_accounts,a);
}

#[test]
#[ignore="requires the exact local-public-fixture ELF and BIO_NATIVE_PRODUCTION_FIXTURE=1"]
fn production_refuses_mutable_loader_wrong_owners_old_wire_test_domain_and_later_failure_rolls_everything_back(){
 assert_eq!(std::env::var("BIO_NATIVE_PRODUCTION_FIXTURE").as_deref(),Ok("1"));
 let vm=vm();let a=fixture(&vm);let ix=init();let pd=Pubkey::new_from_array(release::PROGRAM_DATA_ADDRESS);
 for kind in 0..6{let mut bad=a.clone();match kind{0=>account_mut(&mut bad,pd).data[12]=1,1=>account_mut(&mut bad,pd).owner=SYSTEM,2=>account_mut(&mut bad,release::PROGRAM_ID).owner=SYSTEM,3=>account_mut(&mut bad,release::PROGRAM_ID).data[4]^=1,4=>account_mut(&mut bad,pd).data[4..12].copy_from_slice(&10u64.to_le_bytes()),_=>account_mut(&mut bad,pd).executable=true};let r=vm.process_instruction(&ix,&bad);if kind==2{assert!(r.raw_result.is_err());}else{assert_eq!(format!("{:?}",r.raw_result),"Err(Custom(8051))");}assert_eq!(r.resulting_accounts,bad);}
 for offset in[0usize,10,12,14,16,48,148]{let mut bad=ix.clone();bad.data[offset]^=1;let r=vm.process_instruction(&bad,&a);assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,a);}
 let mut legacy=ix.clone();legacy.data=support::wire(1,0,&[0;40]);let r=vm.process_instruction(&legacy,&a);assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,a);
 let mut later=ix.clone();later.data[14..16].copy_from_slice(&1u16.to_le_bytes());let r=vm.process_transaction_instructions(&[ix,later],&a,Some(&release::BOOTSTRAP));assert!(r.raw_result.is_err());assert_eq!(r.resulting_accounts,a);
}
