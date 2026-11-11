//! Real Core SBF invoked by full Kit-signed v1 Bank messages. No native substitute.
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_transaction::versioned::VersionedTransaction;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, process::Command, str::FromStr};

fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap() }
fn program() -> Address { Address::new_from_array(biolab_economy::PROGRAM_ID.to_bytes()) }
fn boot() -> Address { Address::new_from_array(biolab_economy::BOOTSTRAP.to_bytes()) }
fn pda(name: &[u8]) -> Address { Address::new_from_array(biolab_economy::pda(&biolab_economy::PROGRAM_ID,name).0.to_bytes()) }
fn nonce() -> Address { Address::find_program_address(&[b"bio",b"actor-nonce",boot().as_ref()],&program()).0 }
fn prefix() -> Vec<AccountMeta> { vec![
  AccountMeta::new(boot(),true), AccountMeta::new(nonce(),false), AccountMeta::new_readonly(pda(b"econ-config"),false),
  AccountMeta::new_readonly(Address::from_str("Sysvar1nstructions1111111111111111111111111").unwrap(),false),
  AccountMeta::new_readonly(Address::default(),false),
  AccountMeta::new_readonly(Address::new_from_array(biolab_economy::TOKEN_ID.to_bytes()),false),
  AccountMeta::new_readonly(Address::from_str("SysvarC1ock11111111111111111111111111111111").unwrap(),false),
] }
fn frame(opcode:u8,n:u64,payload:&[u8])->Vec<u8>{
  let mut out=b"BIOECON2".to_vec();out.push(opcode);out.extend_from_slice(&[0;7]);
  out.extend_from_slice(&biolab_economy::domain());out.extend_from_slice(&biolab_economy::config_id());
  out.extend_from_slice(boot().as_ref());out.extend_from_slice(&n.to_le_bytes());out.extend_from_slice(&(payload.len()as u32).to_le_bytes());
  out.extend_from_slice(&[0;4]);out.extend_from_slice(payload);out
}
async fn run(context:&ProgramTestContext,ixs:&[Instruction],label:&str)->(Vec<u8>,Result<(),String>,u64){
  let base=std::env::temp_dir().join(format!("biolab-native-bank-{}-{label}",std::process::id()));
  let input=base.with_extension("json");let output=base.with_extension("bin");
  let request=serde_json::json!({"fixtureOnly":true,"blockhash":context.last_blockhash.to_string(),
    "lastValidBlockHeight":"1000","priorityFeeLamports":"17","instructions":ixs.iter().map(|ix|serde_json::json!({
      "programAddress":ix.program_id.to_string(),"dataHex":ix.data.iter().map(|b|format!("{b:02x}")).collect::<String>(),
      "accounts":ix.accounts.iter().map(|a|serde_json::json!({"address":a.pubkey.to_string(),
        "role":(if a.is_signer{2}else{0})+(if a.is_writable{1}else{0})})).collect::<Vec<_>>()
    })).collect::<Vec<_>>()});
  fs::write(&input,serde_json::to_vec(&request).unwrap()).unwrap();
  let child=Command::new("node").arg(root().join("scripts/sign-native-transport-fixture.mjs")).arg(&input).arg(&output).output().unwrap();
  fs::remove_file(input).unwrap();assert!(child.status.success(),"{}",String::from_utf8_lossy(&child.stderr));
  let bytes=fs::read(&output).unwrap();fs::remove_file(output).unwrap();assert!(bytes.len()<=4096);
  let tx:VersionedTransaction=wincode::deserialize(&bytes).unwrap();tx.verify_and_hash_message().unwrap();
  let processed=context.banks_client.process_transaction_with_metadata(tx).await.unwrap();
  let units=processed.metadata.map_or(0,|m|m.compute_units_consumed);
  (bytes,processed.result.map_err(|e|format!("{e:?}")),units)
}

#[tokio::test]
async fn real_core_initialize_and1024_artifact_transport_execute_as_kit_signed_bank_transactions(){
  let elf=std::env::var_os("BIOLAB_CORE_ELF").map(PathBuf::from)
    .unwrap_or_else(||root().join("programs/biolab-economy/target/deploy/biolab_economy.so"));
  let elf_bytes=fs::read(&elf).expect("build the Core SBF ELF first");
  let snapshot=root().join(format!(".data/bank-core-{}",std::process::id()));fs::create_dir_all(&snapshot).unwrap();
  fs::write(snapshot.join("biolab_economy.so"),&elf_bytes).unwrap();
  std::env::set_var("SBF_OUT_DIR",&snapshot);
  let mut test=ProgramTest::new("biolab_economy",program(),None);test.prefer_bpf(true);
  test.add_account(boot(),Account{lamports:10_000_000_000,data:vec![],owner:Address::default(),executable:false,rent_epoch:0});
  let context=test.start_with_context().await;
  let mut accounts=prefix();accounts[2].is_writable=true;
  for (name,writable) in [(b"lab-mint".as_slice(),true),(b"lab-reserve",true),(b"lab-auth",false),(b"treasury",true)]{
    accounts.push(if writable{AccountMeta::new(pda(name),false)}else{AccountMeta::new_readonly(pda(name),false)});
  }
  let mut payload=boot().to_bytes().to_vec();payload.extend_from_slice(&1_000_000_000u64.to_le_bytes());
  let init=Instruction{program_id:program(),accounts,data:frame(1,0,&payload)};
  let(init_wire,result,init_cu)=run(&context,&[init],"init").await;assert_eq!(result,Ok(()));
  let mint=context.banks_client.get_account(pda(b"lab-mint")).await.unwrap().unwrap();
  assert_eq!(u64::from_le_bytes(mint.data[36..44].try_into().unwrap()),100_000_000_000_000);
  assert_eq!(&mint.data[..4],&[0,0,0,0]);
  assert_eq!(&mint.data[46..50],&[0,0,0,0]);

  let data=vec![0x61;1024];let hash:[u8;32]=Sha256::digest(&data).into();
  let id=biolab_economy::typed_hash(19,&[&biolab_economy::domain(),&biolab_economy::config_id(),boot().as_ref(),
    &501u16.to_le_bytes(),&1024u32.to_le_bytes(),&hash]);
  let artifact=Address::find_program_address(&[b"bio",b"artifact",&id],&program()).0;
  let mut p=501u16.to_le_bytes().to_vec();p.extend_from_slice(&1024u32.to_le_bytes());p.extend_from_slice(&hash);
  p.extend_from_slice(&0u64.to_le_bytes());p.extend_from_slice(&0u32.to_le_bytes());p.extend_from_slice(&1024u16.to_le_bytes());
  p.extend_from_slice(&data);p.extend_from_slice(&1_000_000_000u64.to_le_bytes());
  let mut a=prefix();a.push(AccountMeta::new(artifact,false));
  let put=Instruction{program_id:program(),accounts:a.clone(),data:frame(9,1,&p)};
  let (put_wire,result,put_cu)=run(&context,&[put],"put").await;assert_eq!(result,Ok(()));assert!(put_wire.len()>1232);
  let before=context.banks_client.get_account(artifact).await.unwrap().unwrap();
  assert_eq!(&before.data[251..],&data);assert_eq!(before.data[234],0);
  let mut p=501u16.to_le_bytes().to_vec();p.extend_from_slice(&id);p.extend_from_slice(&1u64.to_le_bytes());p.extend_from_slice(&1_000_000_000u64.to_le_bytes());
  let seal=Instruction{program_id:program(),accounts:a,data:frame(10,2,&p)};
  let(_,result,seal_cu)=run(&context,&[seal.clone()],"seal").await;assert_eq!(result,Ok(()));
  let sealed=context.banks_client.get_account(artifact).await.unwrap().unwrap();assert_eq!(sealed.data[234],1);
  assert_eq!(&sealed.data[251..],&data);
  let dir=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("evidence");fs::create_dir_all(&dir).unwrap();
  fs::write(dir.join("native-artifact-bank.json"),serde_json::to_vec_pretty(&serde_json::json!({
    "fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"runtime":"Agave4.3.2 ProgramTest Bank",
    "officialSdk":"@solana/kit8.0.0","elfSHA256":format!("{:x}",Sha256::digest(&elf_bytes)),
    "initPacketBytes":init_wire.len(),"putPacketBytes":put_wire.len(),"putChunkBytes":1024,
    "realSignature":true,"realSystemAndClassicTokenCpi":true,"realFixedSupply":100_000_000_000_000u64,
    "initComputeUnits":init_cu,"putComputeUnits":put_cu,"sealComputeUnits":seal_cu,"heapBytes":262144
  })).unwrap()).unwrap();
  fs::remove_dir_all(snapshot).unwrap();
}
