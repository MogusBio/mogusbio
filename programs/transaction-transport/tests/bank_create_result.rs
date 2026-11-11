//! Cold INIT/CREATE evidence from the exact frozen native ELF and real Kit V1
//! signatures. No protocol, material, nonce or entitlement state is injected.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_message::VersionedMessage;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_transaction::versioned::VersionedTransaction;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

const ELF_SHA: &str = "76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e";
const TRACE_SHA: &str = "0e095ba68569187525b39f2c65c95836878fb763532acf5f2aa2cbece2ebc1f0";
const ABI_SHA: &str = "089d63ad876fe0701ab783b25ad9de3b6ea7cb0f2a48e085e451fe51a6d9024f";
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}
fn key(s: &str) -> Address {
    s.parse().unwrap()
}
fn hex(d: &[u8]) -> String {
    d.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    assert_eq!(s.len() % 2, 0);
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}
fn sha(d: &[u8]) -> String {
    hex(&Sha256::digest(d))
}
fn u64at(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(d[at..at + 8].try_into().unwrap())
}
fn u32at(d: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(d[at..at + 4].try_into().unwrap())
}
fn u16at(d: &[u8], at: usize) -> u16 {
    u16::from_le_bytes(d[at..at + 2].try_into().unwrap())
}
fn row_key(row: &Value, index: usize) -> Address {
    key(row["accounts"][index]["pubkey"].as_str().unwrap())
}
async fn account(c: &ProgramTestContext, k: Address) -> Account {
    c.banks_client.get_account(k).await.unwrap().unwrap()
}
fn base64(d: &[u8]) -> String {
    const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in d.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (chunk.get(1).copied().unwrap_or(0) as u32) << 8
            | chunk.get(2).copied().unwrap_or(0) as u32;
        out.push(CHARS[(n >> 18) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            CHARS[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
async fn snapshot(c: &ProgramTestContext, row: &Value) -> Vec<Value> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for meta in row["accounts"].as_array().unwrap() {
        let address = meta["pubkey"].as_str().unwrap();
        if !seen.insert(address) {
            continue;
        }
        match c.banks_client.get_account(key(address)).await.unwrap() {
            None=>out.push(json!({"address":address,"missing":true})),
            Some(a) if a.executable=>{},
            Some(a)=>out.push(json!({"address":address,"lamports":a.lamports,"owner":a.owner.to_string(),"executable":a.executable,"rentEpoch":a.rent_epoch,"data":[base64(&a.data),"base64"]})),
        }
    }
    out
}
async fn assert_state_equal(c: &ProgramTestContext, row: &Value, before: &[Value]) {
    let after = snapshot(c, row).await;
    // Clock/Instructions are runtime observations; BOOT pays the actual fee.
    let omitted = [
        row_key(row, 0).to_string(),
        row_key(row, 3).to_string(),
        row_key(row, 6).to_string(),
    ];
    for a in before {
        if !omitted.contains(&a["address"].as_str().unwrap().to_string()) {
            assert_eq!(after.iter().find(|x| x["address"] == a["address"]), Some(a));
        }
    }
}
fn immutable_json(path: &Path, value: &Value) -> String {
    let bytes = serde_json::to_vec_pretty(value).unwrap();
    if path.exists() {
        assert_eq!(
            fs::read(path).unwrap(),
            bytes,
            "refuse to replace distinct evidence: {}",
            path.display()
        );
    } else {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        f.write_all(&bytes).unwrap();
        f.sync_all().unwrap();
    }
    sha(&bytes)
}
struct Signer {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    seq: u64,
}
impl Signer {
    fn new() -> Self {
        let mut child = Command::new("node")
            .arg(root().join("scripts/sign-trace-fixture.mjs"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            input,
            output,
            seq: 0,
        }
    }
    async fn send(
        &mut self,
        c: &mut ProgramTestContext,
        begin: &Value,
        instructions: &[Value],
        new_lifetime: bool,
        success: bool,
    ) -> (Value, Vec<u8>) {
        let recent = if new_lifetime {
            c.get_new_latest_blockhash().await.unwrap()
        } else {
            c.banks_client.get_latest_blockhash().await.unwrap()
        };
        c.last_blockhash = recent;
        let request = json!({"fixtureOnly":true,"productionWire":true,"seq":self.seq,"feePayer":begin["boot"],"blockhash":recent.to_string(),"lastValidBlockHeight":(c.banks_client.get_root_block_height().await.unwrap()+150).to_string(),"maxCU":begin["maxCU"],"heap":begin["heap"],"instructions":instructions});
        writeln!(self.input, "{request}").unwrap();
        self.input.flush().unwrap();
        let mut line = String::new();
        assert!(self.output.read_line(&mut line).unwrap() > 0);
        let signed: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(signed["seq"], self.seq);
        self.seq += 1;
        let bytes = unhex(signed["bytesHex"].as_str().unwrap());
        assert!(bytes.len() <= 4096);
        let tx: VersionedTransaction = wincode::deserialize(&bytes).unwrap();
        tx.verify_and_hash_message().unwrap();
        assert_eq!(
            tx.message.static_account_keys()[0].to_string(),
            begin["boot"].as_str().unwrap()
        );
        let VersionedMessage::V1(message) = &tx.message else {
            panic!("real V1 required")
        };
        assert_eq!(message.config.priority_fee, Some(0));
        let signature = tx.signatures[0].to_string();
        let signatures = tx.signatures.len();
        let result = c
            .banks_client
            .process_transaction_with_metadata(tx)
            .await
            .unwrap();
        assert_eq!(
            result.result.is_ok(),
            success,
            "Bank transaction {}: {:?}",
            self.seq - 1,
            result.result
        );
        let outcome = format!("{:?}", result.result);
        let metadata = result.metadata.unwrap();
        let returned = if success {
            let r = metadata.return_data.expect("native successful result");
            assert_eq!(r.program_id.to_string(), begin["program"].as_str().unwrap());
            r.data
        } else {
            Vec::new()
        };
        let execution = json!({"bankTransactionSequence":self.seq-1,"actualSignature":signature,"signatureCount":signatures,"verifiedEd25519":true,"version":1,"blockhash":recent.to_string(),"signedTransactionHex":hex(&bytes),"signedTransactionSHA256":sha(&bytes),"packetBytes":bytes.len(),"computeUnits":metadata.compute_units_consumed,"returnDataHex":hex(&returned),"returnDataBytes":returned.len(),"result":if success {"Ok"} else {"Err"},"bankResult":outcome,"successfulBusinessResult":success});
        println!(
            "BANK_CREATE_TX seq={} success={} bytes={} cu={}",
            self.seq - 1,
            success,
            bytes.len(),
            metadata.compute_units_consumed
        );
        (execution, returned)
    }
}

#[tokio::test]
#[ignore = "explicit frozen76b cold signed INIT/CREATE and exact retry; writes immutable local Bank evidence"]
async fn actual_cold_create_caches_208_bytes_retries_and_rolls_back() {
    let project = root();
    let trace = fs::read(project.join("programs/biolab-economy/evidence/econ4r1-full-chain.jsonl"))
        .unwrap();
    assert_eq!(sha(&trace), TRACE_SHA);
    let lines = String::from_utf8(trace)
        .unwrap()
        .lines()
        .map(|x| serde_json::from_str::<Value>(x).unwrap())
        .collect::<Vec<_>>();
    let begin = &lines[0];
    let init = &lines[1];
    let create = &lines[2];
    assert_eq!(begin["cold"], true);
    assert_eq!(begin["fixtureOnly"], true);
    assert_eq!(lines.last().unwrap()["success"], true);
    assert_eq!(create["seq"], 1);
    assert_eq!(create["expectedResult"], "Ok");
    let abi_bytes = fs::read(project.join("programs/biolab-economy/operations.p0r2.json")).unwrap();
    assert_eq!(sha(&abi_bytes), ABI_SHA);
    let abi: Value = serde_json::from_slice(&abi_bytes).unwrap();
    let operation = abi["operations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == "CREATE_PROJECT")
        .unwrap();
    assert_eq!(operation["resultBytes"], 208);
    assert_eq!(operation["module"], 201);
    assert_eq!(operation["schema"], 2);
    let frame = unhex(create["dataHex"].as_str().unwrap());
    assert!(frame.starts_with(b"BIOIX\0\0\0"));
    assert_eq!(u16at(&frame, 10), 201);
    assert_eq!(u16at(&frame, 12), 1);
    assert_eq!(u16at(&frame, 14), 2);
    assert_eq!(u64at(&frame, 112), 1);
    let program = key(begin["program"].as_str().unwrap());
    let boot = key(begin["boot"].as_str().unwrap());
    let elf = fs::read(
        project.join("programs/biolab-economy/target/econ4r1-production-deploy/biolab_economy.so"),
    )
    .unwrap();
    assert_eq!(sha(&elf), ELF_SHA);
    assert_eq!(begin["elfSHA256"], ELF_SHA);
    let loader = key("BPFLoaderUpgradeab1e11111111111111111111111");
    let program_data = Address::find_program_address(&[program.as_ref()], &loader).0;
    let mut p = 2u32.to_le_bytes().to_vec();
    p.extend_from_slice(program_data.as_ref());
    let mut d = vec![0; 45];
    d[..4].copy_from_slice(&3u32.to_le_bytes());
    d.extend_from_slice(&elf);
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    test.add_genesis_account(
        program,
        Account {
            lamports: 10_000_000,
            data: p,
            owner: loader,
            executable: true,
            rent_epoch: u64::MAX,
        },
    );
    test.add_genesis_account(
        program_data,
        Account {
            lamports: 10_000_000_000,
            data: d,
            owner: loader,
            executable: false,
            rent_epoch: u64::MAX,
        },
    );
    test.add_account(
        boot,
        Account {
            lamports: 50_000_000_000,
            data: vec![],
            owner: Address::default(),
            executable: false,
            rent_epoch: 0,
        },
    );
    let mut context = test.start_with_context().await;
    let mut signer = Signer::new();
    context.set_sysvar(&Clock {
        slot: init["clock"]["slot"].as_u64().unwrap(),
        unix_timestamp: init["clock"]["unixTimestamp"].as_i64().unwrap(),
        ..Clock::default()
    });
    let (init_execution, _) = signer
        .send(&mut context, begin, &[init.clone()], false, true)
        .await;
    context.set_sysvar(&Clock {
        slot: create["clock"]["slot"].as_u64().unwrap(),
        unix_timestamp: create["clock"]["unixTimestamp"].as_i64().unwrap(),
        ..Clock::default()
    });
    let initial_accounts = snapshot(&context, create).await;
    let mut negatives = Vec::new();
    // The signed creation cap is a native obligation, independent of funding.
    let mut capped = create.clone();
    let mut capped_frame = frame.clone();
    capped_frame[280..288].copy_from_slice(&9_999_999u64.to_le_bytes());
    capped["dataHex"] = json!(hex(&capped_frame));
    capped["expectedResult"] = json!("Err");
    let before_cap_balance = context.banks_client.get_balance(boot).await.unwrap();
    let (cap_execution, _) = signer
        .send(&mut context, begin, &[capped.clone()], false, false)
        .await;
    assert!(cap_execution["bankResult"]
        .as_str()
        .unwrap()
        .contains("6207"));
    assert_state_equal(&context, create, &initial_accounts).await;
    assert_eq!(
        before_cap_balance - context.banks_client.get_balance(boot).await.unwrap(),
        5000
    );
    negatives.push(json!({"name":"SIGNED_CREATION_FEE_CAP_TOO_LOW","instructions":[capped],"execution":cap_execution,"stateRolledBack":true,"onlyLocalSignatureFeeLamports":5000,"afterAccounts":snapshot(&context,create).await}));
    // A later failing System instruction must roll back successful CREATE's
    // accounts, fee transfer, mint initialization and nonce in the transaction.
    let mut fail_transfer = 2u32.to_le_bytes().to_vec();
    fail_transfer.extend_from_slice(&u64::MAX.to_le_bytes());
    let fail_ix = json!({"programId":"11111111111111111111111111111111","accounts":[{"pubkey":boot.to_string(),"isWritable":true,"isSigner":true},{"pubkey":row_key(create,17).to_string(),"isWritable":true,"isSigner":false}],"dataHex":hex(&fail_transfer)});
    let before_abort_accounts = snapshot(&context, create).await;
    let before_abort_balance = context.banks_client.get_balance(boot).await.unwrap();
    let (abort_execution, _) = signer
        .send(
            &mut context,
            begin,
            &[create.clone(), fail_ix.clone()],
            false,
            false,
        )
        .await;
    assert!(abort_execution["bankResult"]
        .as_str()
        .unwrap()
        .contains("InstructionError(1"));
    assert_state_equal(&context, create, &before_abort_accounts).await;
    assert_eq!(
        before_abort_balance - context.banks_client.get_balance(boot).await.unwrap(),
        5000
    );
    negatives.push(json!({"name":"LATER_INSTRUCTION_FAILURE_ROLLS_BACK_CREATE","instructions":[create,fail_ix],"execution":abort_execution,"stateRolledBack":true,"onlyLocalSignatureFeeLamports":5000,"beforeAccounts":before_abort_accounts,"afterAccounts":snapshot(&context,create).await}));
    let before_accounts = snapshot(&context, create).await;
    let before_boot = context.banks_client.get_balance(boot).await.unwrap();
    let before_nonce = account(&context, row_key(create, 1)).await;
    assert_eq!(u64at(&before_nonce.data, 120), 1);
    for index in 8..17 {
        let a = context
            .banks_client
            .get_account(row_key(create, index))
            .await
            .unwrap();
        assert!(a
            .as_ref()
            .is_none_or(|x| x.owner == Address::default() && x.data.is_empty() && !x.executable));
    }
    let (execution, result) = signer
        .send(&mut context, begin, &[create.clone()], false, true)
        .await;
    assert_eq!(result.len(), 208);
    let after_accounts = snapshot(&context, create).await;
    let after_boot = context.banks_client.get_balance(boot).await.unwrap();
    let nonce = account(&context, row_key(create, 1)).await;
    let target = account(&context, row_key(create, 8)).await;
    let ops = account(&context, row_key(create, 17)).await;
    let payload = &frame[152..];
    let name_len = u32at(payload, 144) as usize;
    let business =
        biolab_economy::typed_hash(3, &[&frame[16..48], &frame[80..112], &frame[112..144]]);
    let id = biolab_economy::typed_hash(17, &[&frame[16..48], &business]);
    let h4 = biolab_economy::typed_hash(4, &[&frame]);
    assert_eq!(&result[..32], &id);
    assert_eq!(&result[32..64], row_key(create, 8).as_ref());
    assert_eq!(target.owner, program);
    assert_eq!(target.data.len(), 528 + name_len);
    assert_eq!(u16at(&target.data, 10), 9);
    assert_eq!(u16at(&target.data, 12), 1);
    assert_eq!(&target.data[120..152], boot.as_ref());
    assert_eq!(&target.data[152..184], &business);
    assert_eq!(&target.data[184..216], &payload[..32]);
    assert_eq!(&target.data[216..248], &payload[32..64]);
    assert_eq!(
        &target.data[268..268 + name_len],
        &payload[148..148 + name_len]
    );
    let mut classes = Vec::new();
    let mut rent = target.lamports + ops.lamports - 10_000_000;
    for i in 0..4 {
        let class = (i + 1) as u8;
        let mint_address = row_key(create, 8 + i + 1);
        let authority = row_key(create, 13 + i);
        let mint = account(&context, mint_address).await;
        let at = 120 + 148 + name_len + 65 * i;
        let p_at = 148 + name_len + 17 * i;
        assert_eq!(&result[64 + 32 * i..96 + 32 * i], mint_address.as_ref());
        assert_eq!(
            mint.owner,
            key("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
        );
        assert_eq!(mint.data.len(), 82);
        assert_eq!(u32at(&mint.data, 0), 1);
        assert_eq!(&mint.data[4..36], authority.as_ref());
        assert_eq!(u64at(&mint.data, 36), 0);
        assert_eq!(mint.data[44], 0);
        assert_eq!(mint.data[45], 1);
        assert_eq!(u32at(&mint.data, 46), 0);
        assert!(context
            .banks_client
            .get_account(authority)
            .await
            .unwrap()
            .is_none_or(|x| x.owner == Address::default() && x.data.is_empty() && !x.executable));
        assert_eq!(target.data[at], class);
        assert_eq!(&target.data[at + 1..at + 33], mint_address.as_ref());
        assert_eq!(u64at(&target.data, at + 33), u64at(payload, p_at + 1));
        assert_eq!(u64at(&target.data, at + 41), u64at(payload, p_at + 9));
        assert_eq!(u64at(&target.data, at + 49), 0);
        assert_eq!(u64at(&target.data, at + 57), 0);
        rent += mint.lamports;
        classes.push(json!({"class":class,"mint":mint_address.to_string(),"authority":authority.to_string(),"cap":u64at(payload,p_at+1),"unitPriceLamports":u64at(payload,p_at+9),"issued":0,"intakeBurned":0,"supply":0}));
    }
    assert_eq!(u64at(&result, 192), 10_000_000);
    assert_eq!(u64at(&result, 200), rent);
    assert_eq!(before_boot - after_boot, 10_000_000 + rent + 5000);
    assert_eq!(u64at(&nonce.data, 120), 2);
    assert_eq!(&nonce.data[128..160], &h4);
    assert_eq!(u16at(&nonce.data, 160), 208);
    assert_eq!(&nonce.data[162..370], &result);
    assert!(nonce.data[370..].iter().all(|x| *x == 0));
    let (retry, retry_result) = signer
        .send(&mut context, begin, &[create.clone()], true, true)
        .await;
    assert_ne!(execution["actualSignature"], retry["actualSignature"]);
    assert_ne!(execution["blockhash"], retry["blockhash"]);
    assert_eq!(result, retry_result);
    assert_state_equal(&context, create, &after_accounts).await;
    assert_eq!(
        after_boot - context.banks_client.get_balance(boot).await.unwrap(),
        5000
    );
    let after_retry_accounts = snapshot(&context, create).await;
    let create_result = json!({"projectIdHex":hex(&id),"projectAddress":row_key(create,8).to_string(),"classes":classes,"creationFeeLamports":10_000_000,"actualRentLamports":rent,"cacheBytes":208,"resultHex":hex(&result),"nativeNonceBefore":1,"nativeNonceAfter":2,"creationBusinessHex":hex(&business),"bootLamportsBefore":before_boot,"bootLamportsAfter":after_boot,"bootNetDebitLamports":before_boot-after_boot,"localTransactionSignatureFeeLamports":5000});
    let case = json!({"schema":"BIO-BANK-CREATE-PROJECT-RESULT-CASE-1","fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"scope":"exact cold INIT/CREATE prefix, two failed native transactions and one distinct-blockhash exact CREATE retry; not full-chain execution or live RPC finality","programId":program.to_string(),"actor":boot.to_string(),"traceSequence":1,"elfSHA256":ELF_SHA,"traceSHA256":TRACE_SHA,"abiSHA256":ABI_SHA,"frameHex":hex(&frame),"frameSHA256":sha(&frame),"requestH4":hex(&h4),"instruction":create,"actorNonceAddress":row_key(create,1).to_string(),"econConfigAddress":row_key(create,2).to_string(),"baseConfigAddress":row_key(create,7).to_string(),"initialAccountsAfterINIT":initial_accounts,"beforeAccounts":before_accounts,"afterAccounts":after_accounts,"afterRetryAccounts":after_retry_accounts,"createResult":create_result,"initExecution":init_execution,"execution":execution,"retry":retry,"negativeCases":negatives,"retryNativeNonceUnchanged":true,"retryCachedResultUnchanged":true,"retryProjectMintsAuthoritiesOpsUnchanged":true,"retryOnlyLocalSignatureFeeLamports":5000});
    let dir = std::env::var_os("BIOLAB_CREATE_EVIDENCE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| project.join("programs/transaction-transport/evidence"));
    fs::create_dir_all(&dir).unwrap();
    let filename = "create-project-bank-76b35cfb-case-1.json";
    let case_sha = immutable_json(&dir.join(filename), &case);
    let report = json!({"schema":"BIO-BANK-CREATE-PROJECT-RESULT-1","fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"scope":"cold INIT/CREATE prefix only, two failed transactions, one distinct-blockhash exact-frame retry","runtime":"Agave4.3.2 ProgramTest Bank","officialSdk":"@solana/kit8.0.0","wireProfile":"BIOP0R2 ExactFrame152","elfSHA256":ELF_SHA,"sourceTraceSHA256":TRACE_SHA,"abiSHA256":ABI_SHA,"abiBindingScope":"current registry CREATE resultBytes208 matches exact frozen native ELF; ELF predates corrected BUY result metadata","replayedTraceSequences":[0,1],"actualSignedV1BankTransactions":signer.seq,"actualSignatureVerification":true,"immutableLoaderV3Genesis":true,"upgradeAuthority":null,"onlyBOOTFundedWithSOL":true,"bootGenesisLamports":50_000_000_000u64,"protocolOrMaterialOrDebtAccountsInjected":0,"actualCreates":1,"failedTransactions":2,"actualDistinctLifetimeExactFrameRetries":1,"allNativeResultCacheLengths":208,"allRetryResultsEqual":true,"noRetryCreationOrProtocolDebit":true,"failedTransactionsRolledBackAllCreateState":true,"cases":[{"file":filename,"sha256":case_sha,"createResult":create_result}],"recordedReadsScope":"actual local Bank account snapshots; offline fixture adapters may replay them, but they do not establish live RPC finality","costScope":"local ProgramTest Bank only; protocol fee and actual rent are distinct from 5000-lamport signature fees, zero priority fee; no public-network cost quote"});
    let report_file = dir.join("create-project-bank-76b35cfb.json");
    immutable_json(&report_file, &report);
    println!("BANK_CREATE_RESULT_PASS {}", report_file.display());
    drop(signer.input);
    assert!(signer.child.wait().unwrap().success());
}
