//! Actual combined Core SBF: transport, manufacture and function integration.
//! Input roots and LAB for full-chain tests must be earned, never fabricated.
mod support;
use support::*;
#[path="support/mining.rs"]mod mining;
#[path="support/synthesis.rs"]mod synthesis_client;

const RENT:u64=100_000_000;
fn ordinary_sha(bytes:&[u8])->[u8;32]{Sha256::digest(bytes).into()}
fn artifact_id(kind:u16,payload:&[u8])->[u8;32]{hash(19,&[&domain(),&config_id(),BOOT.as_ref(),&kind.to_le_bytes(),&(payload.len()as u32).to_le_bytes(),&ordinary_sha(payload)])}
fn artifact_address(id:&[u8;32])->Pubkey{Pubkey::find_program_address(&[b"bio",b"artifact",id],&PROGRAM).0}
fn put_ix(n:u64,kind:u16,payload:&[u8],seq:u64,offset:usize)->Instruction{
    let id=artifact_id(kind,payload);let chunk=&payload[offset..(offset+1024).min(payload.len())];let mut p=kind.to_le_bytes().to_vec();
    p.extend_from_slice(&(payload.len()as u32).to_le_bytes());p.extend_from_slice(&ordinary_sha(payload));p.extend_from_slice(&seq.to_le_bytes());p.extend_from_slice(&(offset as u32).to_le_bytes());p.extend_from_slice(&(chunk.len()as u16).to_le_bytes());p.extend_from_slice(chunk);p.extend_from_slice(&RENT.to_le_bytes());
    let mut accounts=prefix();accounts.push(AccountMeta::new(artifact_address(&id),false));Instruction{program_id:PROGRAM,accounts,data:wire(9,n,&p)}
}
fn seal_ix(n:u64,kind:u16,payload:&[u8],seq:u64)->Instruction{
    let id=artifact_id(kind,payload);let mut p=kind.to_le_bytes().to_vec();p.extend_from_slice(&id);p.extend_from_slice(&seq.to_le_bytes());p.extend_from_slice(&RENT.to_le_bytes());
    let mut accounts=prefix();accounts.push(AccountMeta::new(artifact_address(&id),false));Instruction{program_id:PROGRAM,accounts,data:wire(10,n,&p)}
}

#[test]
fn native_artifact_chunks_real_rent_seal_replay_and_rollback(){
    let vm=runtime();let initial=initialized(&vm);let payload=(0..2065).map(|i|(i%251)as u8).collect::<Vec<_>>();let id=artifact_id(501,&payload);let key=artifact_address(&id);
    let mut accounts=initial;add_empty(&mut accounts,key);
    let hole=vm.process_instruction(&put_ix(1,501,&payload,0,1024),&accounts);assert!(hole.raw_result.is_err());assert_eq!(account(&hole.resulting_accounts,key),account(&accounts,key));
    let first_ix=put_ix(1,501,&payload,0,0);assert!(legacy_packet_size(&[first_ix.clone()])>1232,"1024 upload explicitly needs v1 transport");
    let first=vm.process_instruction(&first_ix,&accounts);println!("ARTIFACT first_put_cu={} raw={:?}",first.compute_units_consumed,first.raw_result);assert_eq!(first.raw_result,Ok(()));
    assert_eq!(account(&first.resulting_accounts,key).data.len(),251+1024);assert_eq!(account(&first.resulting_accounts,key).owner,PROGRAM);
    assert!(account(&first.resulting_accounts,BOOT).lamports<account(&accounts,BOOT).lamports,"actual Rent was funded");
    let duplicate=vm.process_instruction(&first_ix,&first.resulting_accounts);assert_eq!(duplicate.raw_result,Ok(()));assert_eq!(duplicate.return_data,first.return_data);assert_eq!(duplicate.resulting_accounts,first.resulting_accounts);
    let second=vm.process_instruction(&put_ix(2,501,&payload,1,1024),&first.resulting_accounts);assert_eq!(second.raw_result,Ok(()));
    assert_eq!(account(&second.resulting_accounts,key).data.len(),251+2048);
    let incomplete=vm.process_instruction(&seal_ix(3,501,&payload,2),&second.resulting_accounts);assert!(incomplete.raw_result.is_err());assert_eq!(account(&incomplete.resulting_accounts,key),account(&second.resulting_accounts,key));
    let third=vm.process_instruction(&put_ix(3,501,&payload,2,2048),&second.resulting_accounts);assert_eq!(third.raw_result,Ok(()));
    let sealed=vm.process_instruction(&seal_ix(4,501,&payload,3),&third.resulting_accounts);println!("ARTIFACT seal_cu={} raw={:?}",sealed.compute_units_consumed,sealed.raw_result);assert_eq!(sealed.raw_result,Ok(()));
    let data=&account(&sealed.resulting_accounts,key).data;assert_eq!(data[234],1);assert_eq!(&data[251..],payload);
    let mutate=vm.process_instruction(&put_ix(5,501,&payload,3,0),&sealed.resulting_accounts);assert!(mutate.raw_result.is_err());assert_eq!(account(&mutate.resulting_accounts,key),account(&sealed.resulting_accounts,key));
    let failed_tx=vm.process_transaction_instructions(&[first_ix,seal_ix(2,501,&payload,1)],&accounts,Some(&BOOT));
    assert!(failed_tx.raw_result.is_err());assert_eq!(account(&failed_tx.resulting_accounts,key),account(&accounts,key));assert_eq!(account(&failed_tx.resulting_accounts,BOOT).lamports,account(&accounts,BOOT).lamports);
}

fn upload(vm:&Mollusk,accounts:&mut Vec<(Pubkey,Account)>,kind:u16,payload:&[u8],nonce:&mut u64)->Pubkey{
    let address=artifact_address(&artifact_id(kind,payload));add_empty(accounts,address);let mut seq=0;
    for offset in (0..payload.len()).step_by(1024){let result=vm.process_instruction(&put_ix(*nonce,kind,payload,seq,offset),accounts);assert_eq!(result.raw_result,Ok(()),"upload offset{offset}");*accounts=result.resulting_accounts;*nonce+=1;seq+=1;}
    let result=vm.process_instruction(&seal_ix(*nonce,kind,payload,seq),accounts);assert_eq!(result.raw_result,Ok(()));*accounts=result.resulting_accounts;*nonce+=1;address
}

fn hex(bytes:&[u8])->String{bytes.iter().map(|b|format!("{b:02x}")).collect()}
fn verification_address()->Pubkey{Pubkey::find_program_address(&[b"bio",b"verify",BOOT.as_ref()],&PROGRAM).0}
fn cell_payload(accounts:&[(Pubkey,Account)],instances:&[Pubkey])->Vec<u8>{
    let mut graph=std::fs::read(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/graphs/golden-c03-zero.bin")).unwrap();
    graph[16..48].copy_from_slice(&domain());graph[48..80].copy_from_slice(&config_id());graph[80..112].copy_from_slice(&catalog());graph[112..144].copy_from_slice(&release_constants::RULE_HASH);
    let mut body=(graph.len()as u32).to_le_bytes().to_vec();body.extend_from_slice(&graph);body.push(4);
    let capsules=instances.iter().map(|instance|{let data=&account(accounts,root_address(instance)).data;let mut cap=data[..322].to_vec();cap.extend_from_slice(&data[443..]);cap}).collect::<Vec<_>>();
    for (i,instance)in instances.iter().enumerate(){body.extend_from_slice(&[3,(i+1)as u8]);body.extend_from_slice(instance.as_ref());body.extend_from_slice(&read64(&account(accounts,root_address(instance)).data,354).to_le_bytes());body.extend_from_slice(&ordinary_sha(&capsules[i]));}
    body.push(4);
    for (i,instance)in instances.iter().enumerate(){body.extend_from_slice(&[3,(i+1)as u8]);body.extend_from_slice(&[1,0,(i+1)as u8,if i==3{3}else{0}]);body.extend_from_slice(instance.as_ref());body.extend_from_slice(&ordinary_sha(&capsules[i]));}
    body.push(4);for cap in capsules{body.extend_from_slice(&(cap.len()as u32).to_le_bytes());body.extend_from_slice(&cap);}
    let mut result=b"BIOP7D01".to_vec();result.extend_from_slice(&1u16.to_le_bytes());result.extend_from_slice(&[3,0]);result.extend_from_slice(&(body.len()as u32).to_le_bytes());result.extend_from_slice(&body);result
}
fn begin_ix(n:u64,payload:&[u8],instances:&[Pubkey])->Instruction{
    let id=artifact_id(702,payload);let mut p=id.to_vec();p.extend_from_slice(&ordinary_sha(payload));p.extend_from_slice(&(payload.len()as u32).to_le_bytes());p.extend_from_slice(&2_000_000u32.to_le_bytes());p.extend_from_slice(&0u64.to_le_bytes());p.extend_from_slice(&RENT.to_le_bytes());
    let mut a=prefix();a.extend([AccountMeta::new_readonly(artifact_address(&id),false),AccountMeta::new(verification_address(),false)]);a.extend(instances.iter().map(|id|AccountMeta::new_readonly(root_address(id),false)));Instruction{program_id:PROGRAM,accounts:a,data:wire(11,n,&p)}
}
fn step_ix(n:u64,payload:&[u8],prior:&[u8])->Instruction{
    let id=artifact_id(702,payload);let cursor=u16::from_le_bytes(prior[16..18].try_into().unwrap());let mut p=id.to_vec();p.extend_from_slice(&1u64.to_le_bytes());p.extend_from_slice(&cursor.to_le_bytes());let count=if prior[18]==5{let round=u16::from_le_bytes(prior[25..27].try_into().unwrap());(73-round).min(2)as u8}else{1};p.extend_from_slice(&[count,0]);p.extend_from_slice(&prior[40..72]);p.extend_from_slice(&RENT.to_le_bytes());
    let mut a=prefix();a.extend([AccountMeta::new_readonly(artifact_address(&id),false),AccountMeta::new(verification_address(),false)]);Instruction{program_id:PROGRAM,accounts:a,data:wire(12,n,&p)}
}
fn final_ix(accounts:&[(Pubkey,Account)],n:u64,payload:&[u8],digest:&[u8],instances:&[Pubkey])->Instruction{
    let id=artifact_id(702,payload);let output=instance_for(BOOT,n);let mut p=id.to_vec();p.extend_from_slice(&ordinary_sha(payload));p.extend_from_slice(&(payload.len()as u32).to_le_bytes());p.extend_from_slice(&1u64.to_le_bytes());p.extend_from_slice(digest);p.extend_from_slice(&800_000u64.to_le_bytes());p.extend_from_slice(&RENT.to_le_bytes());
    let mut a=prefix();a.extend([AccountMeta::new_readonly(artifact_address(&id),false),AccountMeta::new(verification_address(),false),AccountMeta::new(root_address(&output),false),AccountMeta::new(pda(b"lab-mint"),false),AccountMeta::new(ata(&pda(b"lab-mint"),&BOOT),false),AccountMeta::new(pda(b"treasury"),false),AccountMeta::new_readonly(pda(b"lab-reserve"),false),AccountMeta::new(pda(b"mining"),false)]);
    a.extend(instances.iter().map(|id|AccountMeta::new(root_address(id),false)));a.extend(instances.iter().map(|id|AccountMeta::new(mining::root_reg(*id),false)));let semantic:[u8;32]=account(accounts,verification_address()).data[332..364].try_into().unwrap();a.extend(synthesis_client::registration_metas(accounts,&semantic,false));Instruction{program_id:PROGRAM,accounts:a,data:wire(13,n,&p)}
}

#[test]
fn native_actual_stock_parts_mining_fee_cell_and_atomic_finalization(){
    let mut vm=runtime();vm.compute_budget.heap_size=262144;
    vm.logger=Some(std::rc::Rc::new(std::cell::RefCell::new(Default::default())));
    let mut accounts=stocked(&vm);let mut instances=Vec::new();
    for primitive in 1..=4{let result=manufacture_next(&vm,accounts,primitive,if primitive==4{3}else{0});accounts=result.0;instances.push(result.1);}
    let component_burn_before=instances.iter().map(|id|read64(&account(&accounts,root_address(id)).data,288)).sum::<u64>();assert_eq!(component_burn_before,480_000);
    accounts=mining::earn_then_exit(&mut vm,accounts,&instances,85);
    let lab_source=ata(&pda(b"lab-mint"),&BOOT);let earned=read64(&account(&accounts,lab_source).data,64);assert_eq!(earned,808_520,"actual hourly floor and TransferChecked supplied the fee");
    let payload=cell_payload(&accounts,&instances);let mut n=next_nonce(&accounts,BOOT);upload(&vm,&mut accounts,702,&payload,&mut n);add_empty(&mut accounts,verification_address());
    let directory=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));let input_path=directory.join("../evidence/native-cell-payload.bin");std::fs::write(&input_path,&payload).unwrap();
    let oracle=std::process::Command::new("node").arg(directory.join("tools/check-synthesis.mjs")).arg(&input_path).output().unwrap();assert!(oracle.status.success(),"{}",String::from_utf8_lossy(&oracle.stderr));
    let text=String::from_utf8(oracle.stdout).unwrap();let expected=text.lines().collect::<Vec<_>>();assert_eq!(expected.len(),6);
    vm.logger=Some(std::rc::Rc::new(std::cell::RefCell::new(Default::default())));
    let begin=vm.process_instruction(&begin_ix(n,&payload,&instances),&accounts);println!("NATIVE_CELL_BEGIN cu={} raw={:?}",begin.compute_units_consumed,begin.raw_result);if begin.raw_result.is_err(){println!("BEGIN logs={:?}",vm.logger.as_ref().unwrap().borrow().get_recorded_content());}assert_eq!(begin.raw_result,Ok(()));
    accounts=begin.resulting_accounts;n+=1;let mut prior=begin.return_data;let mut high=begin.compute_units_consumed;
    let mut calls=0usize;while prior[18]!=6{assert!(calls<1024);calls+=1;let ix=step_ix(n,&payload,&prior);let r=vm.process_instruction(&ix,&accounts);println!("NATIVE_CELL_STEP cursor={} cu={} raw={:?}",u16::from_le_bytes(prior[16..18].try_into().unwrap()),r.compute_units_consumed,r.raw_result);assert_eq!(r.raw_result,Ok(()));high=high.max(r.compute_units_consumed);accounts=r.resulting_accounts;prior=r.return_data;n+=1;}
    assert_eq!(u16::from_le_bytes(prior[25..27].try_into().unwrap()),73);assert_eq!(u32::from_le_bytes(prior[20..24].try_into().unwrap()),1_000_000);assert_eq!(hex(&prior[40..72]),expected[3]);
    let output=instance_for(BOOT,n);add_empty(&mut accounts,root_address(&output));add_empty(&mut accounts,root_address(&instance_for(BOOT,n+1)));synthesis_client::prepare_registration(&mut accounts,false);let final_instruction=final_ix(&accounts,n,&payload,&prior[40..72],&instances);
    assert!(legacy_packet_size(&[final_instruction.clone()])<=4096,"P9 Disclosure adds accounts; v1 outer serialization is checked separately");
    // A later native instruction failing must undo real SPL burn, four consumed
    // roots, new Root allocation, registry updates, nonce and verification.used.
    let mut fail_after=final_ix(&accounts,n+1,&payload,&prior[40..72],&instances);fail_after.data[128+68]^=1;
    let rolled=vm.process_transaction_instructions(&[final_instruction.clone(),fail_after],&accounts,Some(&BOOT));assert_eq!(format!("{:?}",rolled.raw_result),"Err(InstructionError(1, Custom(6615)))");
    for key in [lab_source,pda(b"lab-mint"),pda(b"treasury"),pda(b"mining"),verification_address(),root_address(&output),nonce(&BOOT)]{assert_eq!(account(&rolled.resulting_accounts,key),account(&accounts,key),"native final rollback {key}");}
    for id in &instances{assert_eq!(account(&rolled.resulting_accounts,root_address(id)),account(&accounts,root_address(id)));}
    // A separate legitimate branch transfers one input after verification. The
    // subsequent new-nonce FINAL reaches the actual owner/revision recheck.
    let mut transfer_payload=instances[0].to_bytes().to_vec();transfer_payload.extend_from_slice(&0u64.to_le_bytes());transfer_payload.extend_from_slice(&read64(&account(&accounts,mining::root_reg(instances[0])).data,152).to_le_bytes());transfer_payload.extend_from_slice(OTHER.as_ref());transfer_payload.extend_from_slice(&RENT.to_le_bytes());
    let mut transfer_accounts=prefix();transfer_accounts.extend([AccountMeta::new(pda(b"mining"),false),AccountMeta::new(root_address(&instances[0]),false),AccountMeta::new(mining::root_reg(instances[0]),false)]);
    let transfer=vm.process_instruction(&Instruction{program_id:PROGRAM,accounts:transfer_accounts,data:wire(26,n,&transfer_payload)},&accounts);assert_eq!(transfer.raw_result,Ok(()));
    let toctou=vm.process_instruction(&final_ix(&transfer.resulting_accounts,n+1,&payload,&prior[40..72],&instances),&transfer.resulting_accounts);assert_eq!(format!("{:?}",toctou.raw_result),"Err(Custom(6608))");assert_eq!(account(&toctou.resulting_accounts,lab_source),account(&transfer.resulting_accounts,lab_source));
    let done=vm.process_instruction(&final_instruction,&accounts);println!("NATIVE_CELL_FINAL cu={} raw={:?}",done.compute_units_consumed,done.raw_result);assert_eq!(done.raw_result,Ok(()));high=high.max(done.compute_units_consumed);
    let d=&account(&done.resulting_accounts,root_address(&output)).data;assert_eq!(d.len(),761);assert_eq!(d[12..14],2u16.to_le_bytes());assert_eq!(read64(d,288),480_000);assert_eq!(read64(d,296),180_000);assert_eq!(d[362],0);assert_eq!(&d[322..354],BOOT.as_ref());
    assert_eq!(hex(&d[120+607..120+639]),expected[0]);assert_eq!(hex(&d[120+503..120+535]),expected[3]);assert_eq!(hex(&d[120+535..120+599]),expected[4]);assert_eq!(hex(&d[120+455..120+487]),expected[5]);
    assert_eq!(read64(&account(&done.resulting_accounts,lab_source).data,64),earned-800_000);
    for id in &instances{let data=&account(&done.resulting_accounts,root_address(id)).data;assert_eq!(data[362],1);assert_eq!(read64(data,354),1);assert_eq!(&data[363..395],output.as_ref());}
    let duplicate=vm.process_instruction(&final_instruction,&done.resulting_accounts);assert_eq!(duplicate.raw_result,Ok(()));assert_eq!(duplicate.return_data,done.return_data);assert_eq!(duplicate.resulting_accounts,done.resulting_accounts);
    let conflict=vm.process_instruction(&final_ix(&done.resulting_accounts,n+1,&payload,&prior[40..72],&instances),&done.resulting_accounts);assert!(conflict.raw_result.is_err());assert_eq!(account(&conflict.resulting_accounts,lab_source),account(&done.resulting_accounts,lab_source));
    let mut after_mining=mining::stake(&vm,done.resulting_accounts,output,BOOT,BOOT);let reward_start=mining::local_start(&after_mining);let current_h=((vm.sysvars.clock.unix_timestamp-reward_start)/3600)as u64;
    clock_at(&mut vm,&mut after_mining,reward_start+(current_h as i64+2)*3600+1);after_mining=mining::exit(&vm,after_mining,output,BOOT);
    clock_at(&mut vm,&mut after_mining,reward_start+(current_h as i64+3)*3600+1);after_mining=mining::settle_through(&vm,after_mining,current_h+3);after_mining=mining::claim(&vm,after_mining,output,0,BOOT);
    let after_balance=read64(&account(&after_mining,lab_source).data,64);assert_eq!(after_balance,37_058,"new CELL earns two real hours; consumed components do not mine again");
    assert!(high<=1_260_000);std::fs::write(directory.join("../evidence/native-cell-result.txt"),format!("actual manufactured inputs={}\nearned_atoms={earned}\nfee_atoms=800000\nremaining_atoms={}\ncell_two_hour_mining_atoms={}\nfinal_lab_atoms={after_balance}\nq=1000000\nB=480000\nretired=180000\nmax_cu={high}\nheap_request=262144\nsemantic={}\nfunc2={}\nunion={}\n",instances.len(),earned-800_000,after_balance-(earned-800_000),expected[0],expected[3],expected[5])).unwrap();
}
