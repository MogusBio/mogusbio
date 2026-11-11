#![allow(dead_code)]
//! Host client for the actual program-owned staged verifier. No supplied q/PASS.
use crate::{mining,support::*};
pub const RENT:u64=100_000_000;
pub const FAMILY:[u8;32]=[160,43,204,72,38,231,208,253,243,141,12,162,12,38,137,129,71,231,26,176,41,238,246,151,54,121,0,16,247,147,245,254];
pub fn sha(bytes:&[u8])->[u8;32]{Sha256::digest(bytes).into()}
pub fn hex(bytes:&[u8])->String{bytes.iter().map(|b|format!("{b:02x}")).collect()}
pub fn verification()->Pubkey{Pubkey::find_program_address(&[b"bio",b"verify",BOOT.as_ref()],&PROGRAM).0}
pub fn evidence_dir()->std::path::PathBuf{std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../evidence")}
pub fn graph(target:u8)->Vec<u8>{
    let mut g=std::fs::read(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../../fixtures/graphs/c320-scope-{target:02}.bin"))).unwrap();
    g[16..48].copy_from_slice(&domain());g[48..80].copy_from_slice(&config_id());g[80..112].copy_from_slice(&catalog());g[112..144].copy_from_slice(&release_constants::RULE_HASH);g
}
fn capsule(data:&[u8])->Vec<u8>{let mut result=data[..322].to_vec();result.extend_from_slice(&data[443..]);result}
#[derive(Clone)]
struct Leaf{row:[u8;70],capsule:Vec<u8>}
fn inherited(bytes:&[u8])->Vec<Leaf>{
    assert_eq!(&bytes[..8],b"BIOP7D01");let graph_len=u32::from_le_bytes(bytes[16..20].try_into().unwrap())as usize;
    let mut at=20+graph_len;let n=bytes[at]as usize;at+=1+74*n;let count=bytes[at]as usize;at+=1;
    let rows=(0..count).map(|i|<[u8;70]>::try_from(&bytes[at+i*70..at+(i+1)*70]).unwrap()).collect::<Vec<_>>();at+=70*count;assert_eq!(bytes[at]as usize,count);at+=1;
    let mut out=Vec::new();for row in rows{let len=u32::from_le_bytes(bytes[at..at+4].try_into().unwrap())as usize;at+=4;out.push(Leaf{row,capsule:bytes[at..at+len].to_vec()});at+=len;}assert_eq!(at,bytes.len());out
}
pub fn payload(accounts:&[(Pubkey,Account)],target:u8,instances:&[Pubkey])->Vec<u8>{
    payload_with_graph(accounts,target,instances,&graph(target))
}
pub fn payload_with_graph(accounts:&[(Pubkey,Account)],target:u8,instances:&[Pubkey],graph_bytes:&[u8])->Vec<u8>{
    let mut g=graph_bytes.to_vec();assert_eq!(g[10],target);g[16..48].copy_from_slice(&domain());g[48..80].copy_from_slice(&config_id());g[80..112].copy_from_slice(&catalog());g[112..144].copy_from_slice(&release_constants::RULE_HASH);let mut direct=Vec::new();let mut leaves=Vec::new();
    for (i,id)in instances.iter().enumerate(){let d=&account(accounts,root_address(id)).data;let fingerprint=sha(&capsule(d));let mut row=Vec::new();
        let label=if target<=15{[target,(i+1)as u8]}else{[d[280],0]};row.extend_from_slice(&label);row.extend_from_slice(id.as_ref());row.extend_from_slice(&read64(d,354).to_le_bytes());row.extend_from_slice(&fingerprint);direct.push(row);
        if target<=15{let mut leaf=[0;70];leaf[..2].copy_from_slice(&[target,(i+1)as u8]);leaf[2..6].copy_from_slice(&[1,0,(i+1)as u8,if i==3{target}else{0}]);leaf[6..38].copy_from_slice(id.as_ref());leaf[38..].copy_from_slice(&fingerprint);leaves.push(Leaf{row:leaf,capsule:capsule(d)});}
    }
    if target>15{for id in instances{let d=&account(accounts,root_address(id)).data;let aid:[u8;32]=d[443..475].try_into().unwrap();let raw=&account(accounts,artifact_address(&aid)).data;leaves.extend(inherited(&raw[251..]));}}
    direct.sort();leaves.sort_by_key(|l|(l.row[0],l.row[1]));let mut body=(g.len()as u32).to_le_bytes().to_vec();body.extend_from_slice(&g);body.push(direct.len()as u8);for row in direct{body.extend_from_slice(&row);}body.push(leaves.len()as u8);for l in &leaves{body.extend_from_slice(&l.row);}body.push(leaves.len()as u8);for l in leaves{body.extend_from_slice(&(l.capsule.len()as u32).to_le_bytes());body.extend_from_slice(&l.capsule);}
    let mut out=b"BIOP7D01".to_vec();out.extend_from_slice(&1u16.to_le_bytes());out.extend_from_slice(&[target,0]);out.extend_from_slice(&(body.len()as u32).to_le_bytes());out.extend_from_slice(&body);out
}
fn direct_instances(payload:&[u8])->Vec<Pubkey>{let len=u32::from_le_bytes(payload[16..20].try_into().unwrap())as usize;let at=20+len;let n=payload[at]as usize;(0..n).map(|i|Pubkey::new_from_array(payload[at+1+i*74+2..at+1+i*74+34].try_into().unwrap())).collect()}
pub fn begin_ix(a:&[(Pubkey,Account)],bytes:&[u8],challenge:u32)->Instruction{
    let id=artifact_id(702,BOOT,bytes);let generation=a.iter().find(|(k,_)|*k==verification()).filter(|(_,v)|!v.data.is_empty()).map_or(0,|(_,v)|read64(&v.data,380));
    let mut p=id.to_vec();p.extend_from_slice(&sha(bytes));p.extend_from_slice(&(bytes.len()as u32).to_le_bytes());p.extend_from_slice(&challenge.to_le_bytes());p.extend_from_slice(&generation.to_le_bytes());p.extend_from_slice(&RENT.to_le_bytes());let mut m=prefix();m.extend([AccountMeta::new_readonly(artifact_address(&id),false),AccountMeta::new(verification(),false)]);m.extend(direct_instances(bytes).iter().map(|id|AccountMeta::new_readonly(root_address(id),false)));Instruction{program_id:PROGRAM,accounts:m,data:wire(11,next_nonce(a,BOOT),&p)}
}
pub fn step_ix(a:&[(Pubkey,Account)],bytes:&[u8],prior:&[u8])->Instruction{
    let id=artifact_id(702,BOOT,bytes);let mut p=id.to_vec();p.extend_from_slice(&prior[8..16]);p.extend_from_slice(&prior[16..18]);let round=u16::from_le_bytes(prior[25..27].try_into().unwrap());let count=if prior[18]==5{(73-round).min(2)as u8}else{1};p.extend_from_slice(&[count,0]);p.extend_from_slice(&prior[40..72]);p.extend_from_slice(&RENT.to_le_bytes());let mut m=prefix();m.extend([AccountMeta::new_readonly(artifact_address(&id),false),AccountMeta::new(verification(),false)]);
    if prior[18]==0{let progress=u16::from_le_bytes(account(a,verification()).data[326..328].try_into().unwrap())as usize;let instance=direct_instances(bytes)[progress];let rd=&account(a,root_address(&instance)).data;let aid:[u8;32]=rd[443..475].try_into().unwrap();m.extend([AccountMeta::new_readonly(root_address(&instance),false),AccountMeta::new_readonly(artifact_address(&aid),false)]);}
    Instruction{program_id:PROGRAM,accounts:m,data:wire(12,next_nonce(a,BOOT),&p)}
}
pub fn final_ix(a:&[(Pubkey,Account)],bytes:&[u8],prior:&[u8],fee:u64)->Instruction{
    let n=next_nonce(a,BOOT);let id=artifact_id(702,BOOT,bytes);let output=instance_for(BOOT,n);let mut p=id.to_vec();p.extend_from_slice(&sha(bytes));p.extend_from_slice(&(bytes.len()as u32).to_le_bytes());p.extend_from_slice(&prior[8..16]);p.extend_from_slice(&prior[40..72]);p.extend_from_slice(&fee.to_le_bytes());p.extend_from_slice(&RENT.to_le_bytes());let mut m=prefix();m.extend([AccountMeta::new_readonly(artifact_address(&id),false),AccountMeta::new(verification(),false),AccountMeta::new(root_address(&output),false),AccountMeta::new(pda(b"lab-mint"),false),AccountMeta::new(ata(&pda(b"lab-mint"),&BOOT),false),AccountMeta::new(pda(b"treasury"),false),AccountMeta::new_readonly(pda(b"lab-reserve"),false),AccountMeta::new(pda(b"mining"),false)]);let directs=direct_instances(bytes);m.extend(directs.iter().map(|id|AccountMeta::new(root_address(id),false)));m.extend(directs.iter().map(|id|AccountMeta::new(mining::root_reg(*id),false)));let semantic:[u8;32]=account(a,verification()).data[332..364].try_into().unwrap();m.extend(registration_metas(a,&semantic,prior[24]==1));Instruction{program_id:PROGRAM,accounts:m,data:wire(13,n,&p)}
}
pub fn registration_metas(a:&[(Pubkey,Account)],semantic:&[u8;32],qualified:bool)->Vec<AccountMeta>{
    let task=Pubkey::find_program_address(&[b"bio",b"task",&FAMILY],&PROGRAM).0;let now=i64::from_le_bytes(account(a,CLOCK).data[32..40].try_into().unwrap());let reward=mining::local_start(a);let n=u64::try_from((now-reward)/259200).unwrap();let round=Pubkey::find_program_address(&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()],&PROGRAM).0;let did=hash(8,&[&domain(),semantic]);let disclosure=Pubkey::find_program_address(&[b"bio",b"disclosure",&did],&PROGRAM).0;
    let mut m=vec![AccountMeta::new(task,false),AccountMeta::new(round,false),AccountMeta::new(disclosure,false)];if qualified{let index=a.iter().find(|(k,_)|*k==task).filter(|(_,v)|!v.data.is_empty()).map_or(0,|(_,v)|read64(&v.data,164));m.push(AccountMeta::new(Pubkey::find_program_address(&[b"bio",b"knowledge",&FAMILY,&index.to_le_bytes()],&PROGRAM).0,false));m.push(AccountMeta::new(Pubkey::find_program_address(&[b"bio",b"k-slot",&FAMILY],&PROGRAM).0,false));}m
}
pub fn prepare_registration(a:&mut Vec<(Pubkey,Account)>,qualified:bool){let semantic:[u8;32]=account(a,verification()).data[332..364].try_into().unwrap();for m in registration_metas(a,&semantic,qualified){add_empty(a,m.pubkey);}}
pub struct Prepared{pub accounts:Vec<(Pubkey,Account)>,pub bytes:Vec<u8>,pub prior:Vec<u8>,pub expected:Vec<String>,pub max_cu:u64,pub steps:u64,pub phase_cu:[u64;7]}
pub fn ensure_artifact(vm:&Mollusk,a:Vec<(Pubkey,Account)>,bytes:&[u8])->Vec<(Pubkey,Account)>{let id=artifact_id(702,BOOT,bytes);if let Some((_,v))=a.iter().find(|(k,v)|*k==artifact_address(&id)&&v.data.len()>=251&&v.data[234]==1){assert_eq!(v.owner,PROGRAM);assert_eq!(&v.data[251..],bytes);a}else{put_artifact(vm,a,702,bytes).0}}
pub fn verify(vm:&Mollusk,a:Vec<(Pubkey,Account)>,target:u8,instances:&[Pubkey],challenge:u32)->Prepared{
    verify_with_graph(vm,a,target,instances,challenge,&graph(target))
}
pub fn verify_with_graph(vm:&Mollusk,a:Vec<(Pubkey,Account)>,target:u8,instances:&[Pubkey],challenge:u32,graph_bytes:&[u8])->Prepared{
    let bytes=payload_with_graph(&a,target,instances,graph_bytes);let mut a=ensure_artifact(vm,a,&bytes);add_empty(&mut a,verification());let file=evidence_dir().join(format!("native-target-{target:02}-{}.bin",hex(&sha(&bytes))));std::fs::write(&file,&bytes).unwrap();let oracle=std::process::Command::new("node").arg(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools/check-synthesis.mjs")).arg(&file).arg(challenge.to_string()).output().unwrap();assert!(oracle.status.success(),"{}",String::from_utf8_lossy(&oracle.stderr));let expected=String::from_utf8(oracle.stdout).unwrap().lines().map(str::to_string).collect::<Vec<_>>();assert_eq!(expected.len(),6);
    let begin=vm.process_instruction(&begin_ix(&a,&bytes,challenge),&a);println!("LAYER_BEGIN target={target} cu={} raw={:?}",begin.compute_units_consumed,begin.raw_result);assert_eq!(begin.raw_result,Ok(()));let mut max_cu=begin.compute_units_consumed;let mut phase_cu=[0u64;7];a=begin.resulting_accounts;let mut prior=begin.return_data;let mut steps=0;
    while prior[18]!=6{assert!(steps<1024);let phase=prior[18]as usize;let ix=step_ix(&a,&bytes,&prior);let result=vm.process_instruction(&ix,&a);if result.raw_result.is_err(){println!("LAYER_STEP_FAIL target={target} phase={phase} workseq={} round={} cu={} raw={:?}",u16::from_le_bytes(prior[16..18].try_into().unwrap()),u16::from_le_bytes(prior[25..27].try_into().unwrap()),result.compute_units_consumed,result.raw_result);}assert_eq!(result.raw_result,Ok(()));max_cu=max_cu.max(result.compute_units_consumed);phase_cu[phase]=phase_cu[phase].max(result.compute_units_consumed);a=result.resulting_accounts;prior=result.return_data;steps+=1;}
    assert_eq!(u16::from_le_bytes(prior[25..27].try_into().unwrap()),73);assert_eq!(u32::from_le_bytes(prior[20..24].try_into().unwrap()).to_string(),expected[1]);assert_eq!(read64(&prior,32).to_string(),expected[2]);assert_eq!(hex(&prior[40..72]),expected[3]);println!("LAYER_VERIFIED target={target} steps={steps} max_cu={max_cu} phase_cu={phase_cu:?}");Prepared{accounts:a,bytes,prior,expected,max_cu,steps,phase_cu}
}
pub fn finalize(vm:&Mollusk,mut p:Prepared,fee:u64)->(Vec<(Pubkey,Account)>,Pubkey,u64){
    let target=p.bytes[10];let n=next_nonce(&p.accounts,BOOT);let output=instance_for(BOOT,n);add_empty(&mut p.accounts,root_address(&output));add_empty(&mut p.accounts,pda(b"mining"));for id in direct_instances(&p.bytes){add_empty(&mut p.accounts,mining::root_reg(id));}prepare_registration(&mut p.accounts,p.prior[24]==1);
    let ix=final_ix(&p.accounts,&p.bytes,&p.prior,fee);let packet=legacy_packet_size(&[ix.clone()]);let result=vm.process_instruction(&ix,&p.accounts);println!("LAYER_FINAL target={target} cu={} packet={packet} raw={:?}",result.compute_units_consumed,result.raw_result);assert_eq!(result.raw_result,Ok(()));let d=&account(&result.resulting_accounts,root_address(&output)).data;assert_eq!(hex(&d[727..759]),p.expected[0]);assert_eq!(hex(&d[623..655]),p.expected[3]);assert_eq!(hex(&d[655..719]),p.expected[4]);assert_eq!(hex(&d[575..607]),p.expected[5]);assert_eq!(read64(d,719).to_string(),p.expected[2]);for id in direct_instances(&p.bytes){assert_eq!(account(&result.resulting_accounts,root_address(&id)).data[362],1);}
    (result.resulting_accounts,output,p.max_cu.max(result.compute_units_consumed))
}
