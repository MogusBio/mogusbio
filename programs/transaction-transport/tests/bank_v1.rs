use solana_account::Account;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_message::{v1, VersionedMessage};
use solana_program_test::ProgramTest;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use std::{fs, path::PathBuf, process::Command, str::FromStr};
use sha2::{Digest, Sha256};

#[tokio::test]
async fn official_kit_signed_large_v1_executes_in_actual_bank_and_charges_absolute_fee() {
    let payer = Address::from_str("FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z").unwrap();
    // RFC8032 public test signer, funded only in this in-memory local genesis.
    let mut test = ProgramTest::default();
    test.add_account(payer, Account { lamports: 1_000_000_000, data: vec![], owner: Address::default(), executable: false, rent_epoch: 0 });
    let context = test.start_with_context().await;
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = std::env::temp_dir().join(format!("biolab-v1-{}.bin", std::process::id()));
    let process = Command::new("node").arg(project.join("scripts/sign-transport-fixture.mjs"))
        .arg(context.last_blockhash.to_string()).arg(&output).output().unwrap();
    assert!(process.status.success(), "{}", String::from_utf8_lossy(&process.stderr));
    let bytes = fs::read(&output).unwrap(); fs::remove_file(output).unwrap();
    assert_eq!(bytes[0], 0x81); assert!(bytes.len() > 1232 && bytes.len() <= 4096);
    let transaction: VersionedTransaction = wincode::deserialize(&bytes).unwrap();
    transaction.verify_and_hash_message().unwrap();
    assert_eq!(wincode::serialize(&transaction).unwrap(), bytes);
    assert_eq!(transaction.message.static_account_keys()[0], payer);
    let VersionedMessage::V1(message) = &transaction.message else { panic!("not v1") };
    assert_eq!(message.config.compute_unit_limit, Some(1_400_000));
    assert_eq!(message.config.loaded_accounts_data_size_limit, Some(67_108_864));
    assert_eq!(message.config.heap_size, Some(262_144));
    assert_eq!(message.config.priority_fee, Some(17));
    let balance = context.banks_client.get_balance(payer).await.unwrap();
    let processed = context.banks_client.process_transaction_with_metadata(transaction).await.unwrap();
    processed.result.unwrap();
    let metadata = processed.metadata.unwrap();
    assert_eq!(balance - context.banks_client.get_balance(payer).await.unwrap(), 5_017);

    // Missing fields are not legacy defaults. Runtime must reject zero budget.
    let memo = Instruction { program_id: Address::from_str("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr").unwrap(), accounts: vec![], data: b"negative-defaults".to_vec() };
    let message = v1::Message::try_compile_with_config(&context.payer.pubkey(), &[memo], context.last_blockhash, v1::TransactionConfig::empty()).unwrap();
    let negative = VersionedTransaction::try_new(VersionedMessage::V1(message), &[&context.payer]).unwrap();
    assert!(context.banks_client.process_transaction(negative).await.is_err());
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("evidence"); fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("bank-v1.json"), serde_json::to_vec_pretty(&serde_json::json!({
      "fixtureOnly": true, "networkBroadcast": false, "runtime": "Agave4.3.2 ProgramTest Bank",
      "officialSdk": "@solana/kit8.0.0", "packetBytes": bytes.len(), "packetSHA256": format!("{:x}",Sha256::digest(&bytes)),
      "signatureVerified": true, "wireRoundTripEqual": true, "chargedLamports": 5017,
      "priorityFeeAbsoluteLamports": 17, "computeUnitsConsumed": metadata.compute_units_consumed,
      "requestedHeapBytes": 262144, "missingBudgetsRejected": true,
      "assetProtocolAcceptance": false
    })).unwrap()).unwrap();
}
