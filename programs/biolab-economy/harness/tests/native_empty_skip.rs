//! EMPTY_SKIP exercises actual SBF authority, budget, nonce and rollback paths.
mod support;
use support::*;
#[path="support/mining.rs"]mod mining;
#[path="support/trace.rs"]mod trace;

const EPOCH:u64=35_040;
const END:u64=46*EPOCH;
fn prefix_budget(b:u64)->u64{(0..46u32).map(|k|((N as u128>>(k+1))*b.saturating_sub(k as u64*EPOCH).min(EPOCH)as u128/EPOCH as u128)as u64).sum()}
fn book(m:&mut Vec<AccountMeta>){m.extend([AccountMeta::new_readonly(pda(b"lab-mint"),false),AccountMeta::new_readonly(pda(b"lab-reserve"),false),AccountMeta::new_readonly(pda(b"lab-auth"),false),AccountMeta::new(pda(b"treasury"),false)]);}
fn instruction(a:&[(Pubkey,Account)],op:u8,p:Vec<u8>,m:Vec<AccountMeta>,actor:Pubkey)->Instruction{Instruction{program_id:PROGRAM,accounts:m,data:wire_actor(op,if account(a,nonce(&actor)).data.is_empty(){0}else{next_nonce(a,actor)},&p,actor)}}
fn prepare(a:&mut Vec<(Pubkey,Account)>,from:u64){add_empty(a,mining::hour(from));let ec=read64(&account(a,pda(b"mining")).data,168);add_empty(a,mining::event_key(ec));}
fn skip_ix(a:&[(Pubkey,Account)],from:u64,to:u64,actor:Pubkey)->Instruction{let mut m=prefix_actor(actor);book(&mut m);let ec=read64(&account(a,pda(b"mining")).data,168);m.extend([AccountMeta::new(pda(b"mining"),false),AccountMeta::new_readonly(mining::hour(from),false),AccountMeta::new_readonly(mining::event_key(ec),false)]);let mut p=from.to_le_bytes().to_vec();p.extend_from_slice(&to.to_le_bytes());p.extend_from_slice(&100_000_000u64.to_le_bytes());instruction(a,28,p,m,actor)}
fn synced(vm:&Mollusk)->Vec<(Pubkey,Account)>{let mut a=initialized(vm);add_empty(&mut a,pda(b"mining"));let mut m=prefix();book(&mut m);m.push(AccountMeta::new(pda(b"mining"),false));let ix=instruction(&a,22,100_000_000u64.to_le_bytes().to_vec(),m,BOOT);let r=vm.process_instruction(&ix,&a);assert_eq!(r.raw_result,Ok(()));r.resulting_accounts}
fn okay(vm:&Mollusk,a:&[(Pubkey,Account)],ix:&Instruction)->(Vec<(Pubkey,Account)>,Vec<u8>,u64){assert!(legacy_packet_size(&[ix.clone()])<=1232);let r=vm.process_instruction(ix,a);let op=if &ix.data[..8]==b"BIOECON2"{format!("native{}",ix.data[8])}else{format!("formal{}/{}",u16::from_le_bytes(ix.data[10..12].try_into().unwrap()),u16::from_le_bytes(ix.data[12..14].try_into().unwrap()))};println!("EMPTY_SKIP_TEST op={op} cu={} raw={:?}",r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));(r.resulting_accounts,r.return_data,r.compute_units_consumed)}
fn fail(vm:&Mollusk,a:&[(Pubkey,Account)],ix:&Instruction){let r=vm.process_instruction(ix,a);assert!(r.raw_result.is_err(),"unexpected EMPTY_SKIP success");assert_eq!(r.resulting_accounts,a);}
fn fields(a:&[(Pubkey,Account)])->[u64;8]{core::array::from_fn(|n|read64(&account(a,pda(b"treasury")).data,120+n*8))}

#[test]
fn native_empty_skip_matches_real_hour_engine_and_handles_opened_hour(){
    let mut vm=runtime();let mut a=synced(&vm);let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+12*3600+1);prepare(&mut a,0);let mut slow=a.clone();
    let(ix,out,cu)={let ix=skip_ix(&a,0,12,BOOT);let(next,out,cu)=okay(&vm,&a,&ix);(next,out,cu)};a=ix;assert_eq!(read64(&out,16),prefix_budget(12));assert!(cu<500_000);
    slow=mining::settle_through(&vm,slow,12);assert_eq!(fields(&a),fields(&slow));assert_eq!(read64(&account(&a,pda(b"mining")).data,128),12);assert!(account(&a,mining::hour(0)).data.is_empty());
    let mut vm2=runtime();let mut b=synced(&vm2);let start2=mining::local_start(&b);clock_at(&mut vm2,&mut b,start2+4*3600+1);prepare(&mut b,0);let open=mining::open_ix(&b,0);b=okay(&vm2,&b,&open).0;let reject=skip_ix(&b,0,4,BOOT);fail(&vm2,&b,&reject);let finish=mining::materialize_ix(&b,0);b=okay(&vm2,&b,&finish).0;prepare(&mut b,1);let ix=skip_ix(&b,1,4,BOOT);b=okay(&vm2,&b,&ix).0;assert_eq!(read64(&account(&b,pda(b"mining")).data,128),4);
}

#[test]
fn native_empty_skip_long_idle_crosses46epochs_and_preserves_terminal_supply(){
    let mut vm=runtime();let mut a=synced(&vm);let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+END as i64*3600+7200);let mut from=0;let mut total=0;let mut peak=0;
    let mint_before=account(&a,pda(b"lab-mint")).clone();let reserve_before=account(&a,pda(b"lab-reserve")).clone();
    for to in [EPOCH-1,EPOCH+1,EPOCH*20+3,END]{prepare(&mut a,from);let ix=skip_ix(&a,from,to,BOOT);let(next,out,cu)=okay(&vm,&a,&ix);assert_eq!(&out[..8],&from.to_le_bytes());assert_eq!(&out[8..16],&to.to_le_bytes());let amount=read64(&out,16);assert_eq!(amount,prefix_budget(to)-prefix_budget(from));total+=amount;peak=peak.max(cu);a=next;from=to;}
    assert_eq!(total,N-17);assert_eq!(fields(&a),[0,0,0,N,0,END,0,0]);assert_eq!(account(&a,pda(b"lab-mint")),&mint_before);assert_eq!(account(&a,pda(b"lab-reserve")),&reserve_before);prepare(&mut a,END);for to in [END,END+1]{let ix=skip_ix(&a,END,to,BOOT);fail(&vm,&a,&ix);}println!("EMPTY_SKIP_TERMINAL total={total} peak_cu={peak} heap=32768");
}

#[test]
fn native_empty_skip_canonical_frontier_donation_nonce_cas_and_transaction_rollback(){
    let mut vm=runtime();let mut a=synced(&vm);let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+8*3600+1);prepare(&mut a,0);account_mut(&mut a,mining::event_key(0)).lamports=1;
    let ix=skip_ix(&a,0,4,BOOT);let first=vm.process_instruction(&ix,&a);assert_eq!(first.raw_result,Ok(()));let replay=vm.process_instruction(&ix,&first.resulting_accounts);assert_eq!(replay.raw_result,Ok(()));assert_eq!(replay.resulting_accounts,first.resulting_accounts);assert_eq!(replay.return_data,first.return_data);
    let mut accepted=first.resulting_accounts;prepare(&mut accepted,0);let stale=skip_ix(&accepted,0,8,BOOT);fail(&vm,&accepted,&stale);
    let other=OPS_MEMBERS[0];add_empty(&mut accepted,other);account_mut(&mut accepted,other).lamports=1_000_000_000;add_empty(&mut accepted,nonce(&other));let race=skip_ix(&accepted,0,8,other);fail(&vm,&accepted,&race);
    let mut missing=skip_ix(&a,0,4,BOOT);missing.accounts.pop();fail(&vm,&a,&missing);let mut wrong=skip_ix(&a,0,4,BOOT);let end=wrong.accounts.len()-1;wrong.accounts[end].pubkey=mining::hour(0);fail(&vm,&a,&wrong);
    let mut occupied=a.clone();account_mut(&mut occupied,mining::event_key(0)).data=vec![1];let malformed=skip_ix(&occupied,0,4,BOOT);fail(&vm,&occupied,&malformed);
    let mut bad=ix.clone();let payload=vec![0u8;24];bad.data=wire_actor(28,next_nonce(&a,BOOT)+1,&payload,BOOT);assert!(legacy_packet_size(&[ix.clone(),bad.clone()])<=1232);let rolled=vm.process_transaction_instructions(&[ix,bad],&a,Some(&BOOT));assert!(rolled.raw_result.is_err());assert_eq!(rolled.resulting_accounts,a);
    let mut backwards=accepted.clone();clock_at(&mut vm,&mut backwards,start+3600);prepare(&mut backwards,4);let ix=skip_ix(&backwards,4,5,BOOT);fail(&vm,&backwards,&ix);
}

#[test]
fn native_empty_skip_after_actual_history_preserves_claim_and_stops_before_pending_start(){
    let mut vm=runtime();let a=stocked(&vm);let(mut a,instance)=manufacture_next(&vm,a,1,0);let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+1);a=mining::stake(&vm,a,instance,BOOT,BOOT);clock_at(&mut vm,&mut a,start+2*3600+1);a=mining::exit(&vm,a,instance,BOOT);clock_at(&mut vm,&mut a,start+4*3600+1);a=mining::settle_through(&vm,a,4);
    let position=mining::position(instance,0);let debt=read64(&account(&a,position).data,351);assert!(debt>0);assert_eq!(read64(&account(&a,position).data,359),0);let old_position=account(&a,position).clone();let old_certified=fields(&a)[2];
    clock_at(&mut vm,&mut a,start+100*3600+1);prepare(&mut a,4);
    // Negative program-state fault assay only: even a structurally nonzero K
    // registry cannot be treated as empty. This is not a fabricated K award.
    let mut k_fault=a.clone();let r=&mut account_mut(&mut k_fault,pda(b"mining")).data;r[224]=1;r[352..360].copy_from_slice(&0u64.to_le_bytes());r[360..376].copy_from_slice(&77_760_000_000_000u128.to_le_bytes());let reject=skip_ix(&k_fault,4,100,BOOT);fail(&vm,&k_fault,&reject);
    let ix=skip_ix(&a,4,100,BOOT);a=okay(&vm,&a,&ix).0;assert_eq!(account(&a,position),&old_position);assert_eq!(fields(&a)[2],old_certified);a=mining::create_lab_ata(&vm,a,BOOT);a=mining::claim(&vm,a,instance,0,BOOT);assert_eq!(read64(&account(&a,position).data,359),debt);assert_eq!(read64(&account(&a,ata(&pda(b"lab-mint"),&BOOT)).data,64),debt);
    a=mining::stake(&vm,a,instance,BOOT,BOOT);let from=read64(&account(&a,pda(b"mining")).data,128);let frontier=mining::event_key(read64(&account(&a,pda(b"mining")).data,168));let due=read64(&account(&a,frontier).data,128);assert_eq!(due,101);clock_at(&mut vm,&mut a,start+103*3600+1);prepare(&mut a,from);let crossing=skip_ix(&a,from,due+1,BOOT);fail(&vm,&a,&crossing);
    // Negative authority assay: a client/RPC pretending that a known queued
    // canonical event is empty must not become an absence proof.
    let mut omitted=a.clone();let e=account_mut(&mut omitted,frontier);e.owner=SYSTEM;e.data.clear();let reject=skip_ix(&omitted,from,due,BOOT);fail(&vm,&omitted,&reject);
    let ix=skip_ix(&a,from,due,BOOT);a=okay(&vm,&a,&ix).0;prepare(&mut a,due);let blocked=skip_ix(&a,due,due+1,BOOT);fail(&vm,&a,&blocked);a=mining::apply_pending_events(&vm,a,due);prepare(&mut a,due);let active=skip_ix(&a,due,due+1,BOOT);fail(&vm,&a,&active);
}

#[test]
#[ignore="positive-only actual invocation trace for independent Bank v1 replay"]
fn native_empty_skip_bank_smoke_trace(){
    let mut vm=runtime();let recorder=trace::Trace::install(&mut vm,true).expect("BIOLAB_TRACE_FILE required");let mut a=synced(&vm);let start=mining::local_start(&a);clock_at(&mut vm,&mut a,start+END as i64*3600+1);prepare(&mut a,0);let ix=skip_ix(&a,0,END,BOOT);let(next,out,cu)=okay(&vm,&a,&ix);a=next;assert_eq!(read64(&out,16),N-17);assert_eq!(fields(&a),[0,0,0,N,0,END,0,0]);let report=format!("cold=true\ntransactions=3\nempty_from=0\nempty_to={END}\nsealed_atoms={}\nV={N}\nempty_skip_cu={cu}\nheap=32768\n",N-17);println!("{report}");recorder.finish(&report);
}
