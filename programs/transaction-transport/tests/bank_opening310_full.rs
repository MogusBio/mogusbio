#![recursion_limit = "256"]
//! OPEN310 cold replay. Only SOL and immutable Loader metadata at genesis.
//! Native INIT, four sales, manufacture and real ordinary mining create assets.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_message::VersionedMessage;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_transaction::versioned::VersionedTransaction;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Command, Stdio},
};
const ELF: &str = "67c79ff71e977ade39d0823b561c7d8d13c0669060d0ed83dff4a2031afad100";
const INPUT: &str = "88de3e368ddbb23dff9960eac935b3d2b0c2c2da4fc77c717806fa36b1c780db";
const ABI: &str = "089d63ad876fe0701ab783b25ad9de3b6ea7cb0f2a48e085e451fe51a6d9024f";
const PREFIX: &str = "opening310-full-lifecycle-bank-67c79ff7";
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
    d.iter().map(|v| format!("{v:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}
fn u64at(d: &[u8], p: usize) -> u64 {
    u64::from_le_bytes(d[p..p + 8].try_into().unwrap())
}
fn u16at(d: &[u8], p: usize) -> u16 {
    u16::from_le_bytes(d[p..p + 2].try_into().unwrap())
}
fn b64(d: &[u8]) -> String {
    let t = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for c in d.chunks(3) {
        let n = (c[0] as u32) << 16
            | (c.get(1).copied().unwrap_or(0) as u32) << 8
            | c.get(2).copied().unwrap_or(0) as u32;
        s.push(t[(n >> 18) as usize] as char);
        s.push(t[((n >> 12) & 63) as usize] as char);
        s.push(if c.len() > 1 {
            t[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        s.push(if c.len() > 2 {
            t[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    s
}
fn row(k: Address, a: Option<Account>) -> Value {
    match a {
        None => json!({"address":k.to_string(),"missing":true}),
        Some(a) => {
            json!({"address":k.to_string(),"owner":a.owner.to_string(),"lamports":a.lamports.to_string(),"executable":a.executable,"rentEpoch":a.rent_epoch.to_string(),"data":[b64(&a.data),"base64"]})
        }
    }
}
fn same(a: &Option<Account>, b: &Option<Account>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            a.owner == b.owner
                && a.executable == b.executable
                && a.data == b.data
                && a.lamports == b.lamports
        }
        _ => false,
    }
}
fn write_new(path: PathBuf, v: &Value) {
    let mut f = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .unwrap();
    f.write_all(&serde_json::to_vec_pretty(v).unwrap()).unwrap();
    f.sync_all().unwrap();
}
async fn get(c: &ProgramTestContext, k: Address) -> Option<Account> {
    c.banks_client.get_account(k).await.unwrap()
}
fn pda(p: Address, s: &[&[u8]]) -> Address {
    Address::find_program_address(s, &p).0
}
async fn bank(
    program: Address,
    elf: &[u8],
    state: &BTreeMap<Address, Account>,
    clock: &Clock,
) -> ProgramTestContext {
    let loader = key("BPFLoaderUpgradeab1e11111111111111111111111");
    let pd = pda(loader, &[program.as_ref()]);
    let mut p = 2u32.to_le_bytes().to_vec();
    p.extend_from_slice(pd.as_ref());
    let mut d = vec![0; 45];
    d[..4].copy_from_slice(&3u32.to_le_bytes());
    d.extend_from_slice(elf);
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
        pd,
        Account {
            lamports: 10_000_000_000,
            data: d,
            owner: loader,
            executable: false,
            rent_epoch: u64::MAX,
        },
    );
    for (k, a) in state {
        test.add_genesis_account(*k, a.clone());
    }
    let c = test.start_with_context().await;
    c.set_sysvar(clock);
    c
}
async fn read_set(
    c: &ProgramTestContext,
    keys: &BTreeSet<Address>,
) -> BTreeMap<Address, Option<Account>> {
    let mut a = BTreeMap::new();
    for k in keys {
        a.insert(*k, get(c, *k).await);
    }
    a
}
fn public_rows(a: &BTreeMap<Address, Option<Account>>) -> Vec<Value> {
    a.iter()
        .filter(|(_, a)| a.as_ref().map_or(true, |a| !a.executable))
        .map(|(k, a)| row(*k, a.clone()))
        .collect()
}
async fn restart(
    c: ProgramTestContext,
    program: Address,
    elf: &[u8],
    tracked: &BTreeSet<Address>,
    clock: &Clock,
    label: &str,
) -> (ProgramTestContext, Value) {
    let loader = key("BPFLoaderUpgradeab1e11111111111111111111111");
    let sysvar = key("Sysvar1111111111111111111111111111111111111");
    let pd = pda(loader, &[program.as_ref()]);
    let mut state = BTreeMap::new();
    for k in tracked {
        if *k == pd {
            continue;
        }
        if let Some(a) = get(&c, *k).await {
            if !a.executable && a.owner != sysvar {
                state.insert(*k, a);
            }
        }
    }
    let digest = hex(&Sha256::digest(
        serde_json::to_vec(
            &state
                .iter()
                .map(|(k, a)| row(*k, Some(a.clone())))
                .collect::<Vec<_>>(),
        )
        .unwrap(),
    ));
    drop(c);
    let new = bank(program, elf, &state, clock).await;
    for (k, a) in &state {
        assert!(
            same(&Some(a.clone()), &get(&new, *k).await),
            "restart changed {k}"
        );
    }
    (
        new,
        json!({"label":label,"actualAccountsRestored":state.len(),"accountContentSHA256":digest,"noBusinessFieldModified":true}),
    )
}
fn op(frame: &[u8]) -> (u16, u16) {
    (u16at(frame, 10), u16at(frame, 12))
}

#[tokio::test]
#[ignore = "explicit full new OPEN310 cold signed Bank lifecycle; immutable evidence"]
async fn actual_opening310_cold_materials_layers_mining_restart_and_retry() {
    let project = root();
    let input_bytes = fs::read(
        project
            .join("programs/biolab-economy/evidence/production-admission-fixture.opening310.json"),
    )
    .unwrap();
    assert_eq!(hex(&Sha256::digest(&input_bytes)), INPUT);
    let input: Value = serde_json::from_slice(&input_bytes).unwrap();
    let elf = fs::read(
        project
            .join("programs/biolab-economy/target/opening310-production-deploy/biolab_economy.so"),
    )
    .unwrap();
    assert_eq!(hex(&Sha256::digest(&elf)), ELF);
    assert_eq!(
        hex(&Sha256::digest(
            fs::read(project.join("programs/biolab-economy/operations.p0r2.json")).unwrap()
        )),
        ABI
    );
    let trace_bytes = fs::read(
        project.join("programs/biolab-economy/evidence/opening310-full-chain-67c79ff7.jsonl"),
    )
    .unwrap();
    let trace_sha = hex(&Sha256::digest(&trace_bytes));
    let lines = String::from_utf8(trace_bytes)
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str::<Value>(s).unwrap())
        .collect::<Vec<_>>();
    let begin = &lines[0];
    let end = lines.last().unwrap();
    assert_eq!(begin["cold"], true);
    assert_eq!(begin["elfSHA256"], ELF);
    assert_eq!(end["kind"], "complete");
    assert_eq!(end["success"], true);
    let rows = &lines[1..lines.len() - 1];
    assert_eq!(rows.len() as u64, end["instructions"].as_u64().unwrap());
    let program = key(input["programId"].as_str().unwrap());
    let author = key(input["bootstrap"].as_str().unwrap());
    assert_eq!(begin["program"], program.to_string());
    assert_eq!(begin["boot"], author.to_string());
    assert_eq!(
        begin["configId"],
        "86e2d98dae0c2f93d737019a52790a9e691d24e3c9cb1f0da5e2b0dc94f93d20"
    );
    // Preflight every meta index used by captures before the long replay.
    for (i, r) in rows.iter().enumerate() {
        assert_eq!(r["seq"], i);
        let f = unhex(r["dataHex"].as_str().unwrap());
        if r["programId"] == program.to_string() {
            assert_eq!(&f[..8], b"BIOIX\0\0\0");
            assert_eq!(&f[48..80], unhex(begin["configId"].as_str().unwrap()));
            assert_eq!(r["accounts"][0]["pubkey"], author.to_string());
            assert_eq!(
                r["accounts"][7]["pubkey"],
                pda(program, &[b"bio", b"config"]).to_string()
            );
            if [(602, 1), (602, 2), (701, 1)].contains(&op(&f)) {
                let artifact = pda(program, &[b"bio", b"artifact", &f[152..184]]);
                assert_eq!(r["accounts"][8]["pubkey"], artifact.to_string());
            }
        }
    }
    let mut state = BTreeMap::new();
    state.insert(
        author,
        Account {
            lamports: 50_000_000_000,
            data: vec![],
            owner: Address::default(),
            executable: false,
            rent_epoch: 0,
        },
    );
    let mut clock = Clock {
        slot: 0,
        unix_timestamp: 0,
        ..Clock::default()
    };
    let mut c = bank(program, &elf, &state, &clock).await;
    let mut tracked = BTreeSet::new();
    tracked.insert(author);
    let initial_boot = 50_000_000_000u64;
    let mut signer = Command::new("node")
        .current_dir(&project)
        .arg(project.join("scripts/sign-trace-fixture.mjs"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut sin = signer.stdin.take().unwrap();
    let mut sout = BufReader::new(signer.stdout.take().unwrap());
    let mut txs = Vec::new();
    let mut captures = Vec::new();
    let mut restarts = Vec::new();
    let mut produced = BTreeSet::new();
    let mut parts = 0;
    let mut finals = 0;
    let mut seeds = 0;
    let mut buys = 0;
    let mut bio = None;
    let mut max_cu = 0u64;
    let mut total_cu = 0u64;
    let mut max_bytes = 0usize;
    let mut restarted_physics = false;
    let mut actual_funding_claims = 0u64;
    let mut actual_bio_claims = 0u64;
    let mut actual_fee_burns = 0u64;
    for (i, r) in rows.iter().enumerate() {
        let f = unhex(r["dataHex"].as_str().unwrap());
        let native = r["programId"] == program.to_string();
        let operation = if native { op(&f) } else { (0, 0) };
        let next = Clock {
            slot: r["clock"]["slot"].as_u64().unwrap(),
            unix_timestamp: r["clock"]["unixTimestamp"].as_i64().unwrap(),
            ..Clock::default()
        };
        assert!(next.slot >= clock.slot && next.unix_timestamp >= clock.unix_timestamp);
        clock = next;
        c.set_sysvar(&clock);
        let keys = r["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| key(m["pubkey"].as_str().unwrap()))
            .collect::<BTreeSet<_>>();
        tracked.extend(keys.iter().copied());
        let artifact = if native && operation == (701, 1) {
            Some(
                get(&c, key(r["accounts"][8]["pubkey"].as_str().unwrap()))
                    .await
                    .unwrap(),
            )
        } else {
            None
        };
        let target = artifact.as_ref().map(|a| a.data[261]);
        let label = if operation == (1, 1) {
            Some("init")
        } else if operation == (201, 1) {
            Some("create_project")
        } else if operation == (202, 1) {
            Some("purchase_material")
        } else if operation == (501, 1) && parts == 0 {
            Some("first_component")
        } else if operation == (501, 1) && parts == 59 {
            Some("sixtieth_component")
        } else if operation == (901, 4) && seeds == 17 {
            Some("seal17")
        } else if target == Some(1) {
            Some("first_cell")
        } else if target == Some(16) {
            Some("first_organ")
        } else if target == Some(22) {
            Some("final_bio")
        } else if native && operation == (1001, 2) && bio.is_some() {
            Some("bio_exit")
        } else if native && operation == (1203, 1) && bio.is_some() {
            Some("bio_claim")
        } else {
            None
        };
        let ledger_before = if label.is_some() {
            Some(public_rows(&read_set(&c, &tracked).await))
        } else {
            None
        };
        let should_fail = target == Some(22);
        let cache = operation == (202, 1) && buys == 0
            || operation == (501, 1) && parts == 0
            || target == Some(22)
            || native && operation == (1203, 1) && bio.is_some()
            || native && operation == (1001, 2) && bio.is_some();
        let original_before = if label.is_some() || should_fail || cache {
            Some(read_set(&c, &keys).await)
        } else {
            None
        };
        let attempts = if should_fail {
            vec!["fee_cap_failure", "actual", "cached_retry"]
        } else if cache && operation == (1203, 1) && bio.is_some() {
            vec!["actual", "cached_retry", "stale_claim_new_nonce"]
        } else if cache {
            vec!["actual", "cached_retry"]
        } else {
            vec!["actual"]
        };
        let mut actual_return = Vec::new();
        for attempt in attempts {
            let mut request_row = r.clone();
            if attempt == "fee_cap_failure" {
                let mut invalid = f.clone();
                let fee = u64at(&invalid, 260);
                assert!(fee > 0);
                invalid[260..268].copy_from_slice(&(fee - 1).to_le_bytes());
                request_row["dataHex"] = json!(hex(&invalid));
            }
            if attempt == "stale_claim_new_nonce" {
                let mut invalid = f.clone();
                let n = get(&c, key(r["accounts"][1]["pubkey"].as_str().unwrap()))
                    .await
                    .unwrap();
                invalid[112..120].copy_from_slice(&u64at(&n.data, 120).to_le_bytes());
                request_row["dataHex"] = json!(hex(&invalid));
            }
            let frame = unhex(request_row["dataHex"].as_str().unwrap());
            let before = if attempt != "actual" {
                Some(read_set(&c, &keys).await)
            } else {
                None
            };
            let recent = c.banks_client.get_latest_blockhash().await.unwrap();
            let req = json!({"fixtureOnly":true,"seq":txs.len(),"feePayer":author.to_string(),"blockhash":recent.to_string(),"lastValidBlockHeight":(c.banks_client.get_root_block_height().await.unwrap()+150).to_string(),"maxCU":if attempt=="cached_retry"{1399999}else{1400000},"heap":262144,"productionWire":true,"instructions":[request_row]});
            writeln!(sin, "{req}").unwrap();
            sin.flush().unwrap();
            let mut response = String::new();
            assert!(sout.read_line(&mut response).unwrap() > 0);
            let signed: Value = serde_json::from_str(&response).unwrap();
            let bytes = unhex(signed["bytesHex"].as_str().unwrap());
            let tx: VersionedTransaction = wincode::deserialize(&bytes).unwrap();
            tx.verify_and_hash_message().unwrap();
            assert_eq!(tx.message.static_account_keys()[0], author);
            let VersionedMessage::V1(ref msg) = tx.message else {
                panic!("requiresv1")
            };
            assert_eq!(msg.instructions.len(), 1);
            assert_eq!(msg.instructions[0].data, frame);
            assert_eq!(msg.config.priority_fee, Some(0));
            let signature = tx.signatures[0].to_string();
            let result = c
                .banks_client
                .process_transaction_with_metadata(tx)
                .await
                .unwrap();
            let meta = result.metadata.as_ref().unwrap();
            let cu = meta.compute_units_consumed;
            max_cu = max_cu.max(cu);
            max_bytes = max_bytes.max(bytes.len());
            total_cu += cu;
            let success = !["fee_cap_failure", "stale_claim_new_nonce"].contains(&attempt);
            assert_eq!(
                result.result.is_ok(),
                success,
                "trace{i}/{attempt} {operation:?}: {:?}",
                result.result
            );
            if attempt == "stale_claim_new_nonce" {
                assert!(format!("{:?}", result.result).contains("Custom(8021)"));
            }
            let returned = meta
                .return_data
                .as_ref()
                .filter(|d| d.program_id == program)
                .map_or(vec![], |d| d.data.clone());
            if attempt == "actual" {
                actual_return = returned.clone();
                if native && operation == (1203, 1) {
                    assert_eq!(returned.len(), 88);
                    let amount = u64at(&returned, 64);
                    if bio.is_some() {
                        actual_bio_claims += amount;
                    } else {
                        actual_funding_claims += amount;
                    }
                }
                if native && operation == (701, 1) {
                    assert_eq!(returned.len(), 156);
                    actual_fee_burns += u64at(&returned, 52);
                }
            } else {
                let after = read_set(&c, &keys).await;
                for (k, a) in before.as_ref().unwrap() {
                    if *k != author {
                        assert!(
                            same(a, after.get(k).unwrap()),
                            "{attempt} changed {k} at{i}"
                        );
                    }
                }
                if attempt == "cached_retry" {
                    assert_eq!(returned, actual_return);
                }
            }
            if native && success {
                let nonce = get(&c, key(r["accounts"][1]["pubkey"].as_str().unwrap()))
                    .await
                    .unwrap();
                assert_eq!(u64at(&nonce.data, 120), u64at(&frame, 112) + 1);
                assert_eq!(
                    &nonce.data[128..160],
                    &biolab_economy::typed_hash(4, &[&frame])
                );
                assert_eq!(u16at(&nonce.data, 160) as usize, returned.len());
                assert_eq!(&nonce.data[162..162 + returned.len()], &returned);
            }
            txs.push(json!({"sequence":txs.len(),"traceSequence":i,"attempt":attempt,"nativeModule":operation.0,"nativeOperation":operation.1,"actualSignature":signature,"signedTransactionHex":hex(&bytes),"signedTransactionSHA256":hex(&Sha256::digest(&bytes)),"blockhash":recent.to_string(),"verifiedEd25519":true,"signatureCount":1,"version":1,"packetBytes":bytes.len(),"computeUnits":cu,"result":format!("{:?}",result.result),"returnDataHex":hex(&returned),"frameHex":hex(&frame)}));
        }
        if let Some(label) = label {
            let before = public_rows(original_before.as_ref().unwrap());
            let after = public_rows(&read_set(&c, &keys).await);
            let all = public_rows(&read_set(&c, &tracked).await);
            captures.push(json!({"schema":"BIO-BANK-OPEN310-FULL-STAGE-1","label":label,"traceSequence":i,"elfSHA256":ELF,"inputSHA256":INPUT,"abiSHA256":ABI,"traceSHA256":trace_sha,"instruction":r,"beforeAccounts":before,"afterAccounts":after,"actualLedgerBefore":ledger_before,"actualLedgerAfter":all,"artifactBodyHex":artifact.as_ref().map(|a|hex(&a.data[251..])),"returnDataHex":hex(&actual_return)}));
            println!("OPEN310_FULL_STAGE {label} trace{i}");
        }
        if operation == (901, 3) {
            seeds += 1;
        }
        if operation == (202, 1) {
            buys += 1;
        }
        if [(501, 1), (701, 1)].contains(&operation) {
            let mut id = [0u8; 32];
            id[..8].copy_from_slice(&f[112..120]);
            let business = biolab_economy::typed_hash(3, &[&f[16..48], &f[80..112], &id]);
            let instance =
                biolab_economy::typed_hash(6, &[&f[16..48], &business, &0u16.to_le_bytes()]);
            let addr = pda(program, &[b"bio", b"root", &instance]);
            let a = get(&c, addr).await.unwrap();
            assert_eq!(a.data[362], 0);
            assert!(produced.insert(addr));
            if operation == (501, 1) {
                parts += 1;
            } else {
                finals += 1;
                if target == Some(22) {
                    assert_eq!(u64at(&a.data, 719), 310);
                    bio = Some(addr);
                }
            }
        }
        let restart_label = if operation == (501, 1) && parts == 60 {
            Some("after_sixty_components")
        } else if native && operation == (602, 2) && finals == 21 && !restarted_physics {
            if actual_return[18] == 5 && u16at(&actual_return, 25) >= 35 {
                restarted_physics = true;
                Some("mid_bio_physics")
            } else {
                None
            }
        } else if native && operation == (1001, 2) && bio.is_some() {
            Some("after_bio_exit_before_settlement")
        } else {
            None
        };
        if let Some(label) = restart_label {
            let (next, proof) = restart(c, program, &elf, &tracked, &clock, label).await;
            c = next;
            restarts.push(proof);
            println!("OPEN310_FULL_RESTART {label} trace{i}");
        }
        if (i + 1) % 1000 == 0 {
            println!(
                "OPEN310_FULL_PROGRESS {}/{} tx{} maxCU{max_cu}",
                i + 1,
                rows.len(),
                txs.len()
            );
        }
    }
    // Preserve the completed genuine signed cold run before any acceptance-only
    // expectation, so a helper mistake cannot destroy its inspectable lineage.
    let evidence_dir = project.join("programs/transaction-transport/evidence");
    write_new(
        evidence_dir.join(format!("{PREFIX}-pre-cleanup-checkpoint.json")),
        &json!({"schema":"BIO-BANK-OPEN310-GENUINE-CHECKPOINT-1","acceptancePassed":false,"label":"actual cold trace plus retries completed; pending frontier END is processed next","elfSHA256":ELF,"inputSHA256":INPUT,"abiSHA256":ABI,"traceSHA256":trace_sha,"configId":begin["configId"],"clock":{"slot":clock.slot,"unixTimestamp":clock.unix_timestamp},"actualSignedTransactions":txs.len(),"accounts":public_rows(&read_set(&c,&tracked).await),"transactions":txs}),
    );
    // The completed historical positions do not themselves mutate the lazy
    // Registry. Read and apply its real boundary END in this same Bank.
    let registry_key = pda(program, &[b"bio", b"mining"]);
    let registry = get(&c, registry_key).await.unwrap();
    let cursor = u64at(&registry.data, 168);
    let count = u64at(&registry.data, 160);
    let boundary = u64at(&registry.data, 128);
    assert_eq!(cursor + 1, count);
    let event_key = pda(program, &[b"bio", b"mining-event", &cursor.to_le_bytes()]);
    let event = get(&c, event_key).await.unwrap();
    assert_eq!(event.data[136], 1);
    assert!(u64at(&event.data, 128) <= boundary);
    let directory_seq = u64at(&event.data, 201);
    let directory_key = pda(
        program,
        &[b"bio", b"mining-root", &directory_seq.to_le_bytes()],
    );
    let directory = get(&c, directory_key).await.unwrap();
    let instance = &event.data[137..169];
    let seq = u64at(&event.data, 209);
    let position_key = pda(program, &[b"bio", b"reg", instance, &seq.to_le_bytes()]);
    let mut end_row = rows
        .iter()
        .rev()
        .find(|r| {
            r["programId"] == program.to_string()
                && op(&unhex(r["dataHex"].as_str().unwrap())) == (1102, 2)
        })
        .unwrap()
        .clone();
    let mut frame = unhex(end_row["dataHex"].as_str().unwrap());
    assert_eq!(frame.len(), 176);
    let nkey = key(end_row["accounts"][1]["pubkey"].as_str().unwrap());
    let nonce = get(&c, nkey).await.unwrap();
    frame[112..120].copy_from_slice(&u64at(&nonce.data, 120).to_le_bytes());
    frame[152..160].copy_from_slice(&cursor.to_le_bytes());
    frame[160..168].copy_from_slice(&boundary.to_le_bytes());
    end_row["dataHex"] = json!(hex(&frame));
    end_row["seq"] = json!(rows.len());
    end_row["clock"] = json!({"slot":clock.slot,"unixTimestamp":clock.unix_timestamp});
    let mut metas = end_row["accounts"].as_array().unwrap()[..8].to_vec();
    for (address, writable) in [
        (registry_key, true),
        (event_key, false),
        (directory_key, true),
        (position_key, false),
    ] {
        metas.push(json!({"pubkey":address.to_string(),"isSigner":false,"isWritable":writable}));
    }
    for link in [u64at(&directory.data, 242), u64at(&directory.data, 250)] {
        if link != u64::MAX {
            metas.push(json!({"pubkey":pda(program,&[b"bio",b"mining-root",&link.to_le_bytes()]).to_string(),"isSigner":false,"isWritable":true}));
        }
    }
    end_row["accounts"] = json!(metas);
    let keys = metas
        .iter()
        .map(|m| key(m["pubkey"].as_str().unwrap()))
        .collect::<BTreeSet<_>>();
    tracked.extend(keys.iter().copied());
    let before = read_set(&c, &keys).await;
    let ledger_before = public_rows(&read_set(&c, &tracked).await);
    let recent = c.banks_client.get_latest_blockhash().await.unwrap();
    let req = json!({"fixtureOnly":true,"seq":txs.len(),"feePayer":author.to_string(),"blockhash":recent.to_string(),"lastValidBlockHeight":(c.banks_client.get_root_block_height().await.unwrap()+150).to_string(),"maxCU":1400000,"heap":262144,"productionWire":true,"instructions":[end_row]});
    writeln!(sin, "{req}").unwrap();
    sin.flush().unwrap();
    let mut text = String::new();
    assert!(sout.read_line(&mut text).unwrap() > 0);
    let signed: Value = serde_json::from_str(&text).unwrap();
    let bytes = unhex(signed["bytesHex"].as_str().unwrap());
    let tx: VersionedTransaction = wincode::deserialize(&bytes).unwrap();
    tx.verify_and_hash_message().unwrap();
    let VersionedMessage::V1(ref msg) = tx.message else {
        panic!("requiresv1")
    };
    assert_eq!(msg.instructions[0].data, frame);
    let signature = tx.signatures[0].to_string();
    let result = c
        .banks_client
        .process_transaction_with_metadata(tx)
        .await
        .unwrap();
    assert!(
        result.result.is_ok(),
        "actual post-trace END failed {:?}",
        result.result
    );
    let meta = result.metadata.as_ref().unwrap();
    let cu = meta.compute_units_consumed;
    max_cu = max_cu.max(cu);
    max_bytes = max_bytes.max(bytes.len());
    total_cu += cu;
    let returned = meta
        .return_data
        .as_ref()
        .filter(|r| r.program_id == program)
        .map_or(vec![], |r| r.data.clone());
    let after = read_set(&c, &keys).await;
    let nonce = get(&c, nkey).await.unwrap();
    assert_eq!(u64at(&nonce.data, 120), u64at(&frame, 112) + 1);
    assert_eq!(
        &nonce.data[128..160],
        &biolab_economy::typed_hash(4, &[&frame])
    );
    assert_eq!(u16at(&nonce.data, 160) as usize, returned.len());
    assert_eq!(&nonce.data[162..162 + returned.len()], &returned);
    txs.push(json!({"sequence":txs.len(),"traceSequence":Value::Null,"attempt":"posttrace_end","nativeModule":1102,"nativeOperation":2,"actualSignature":signature,"signedTransactionHex":hex(&bytes),"signedTransactionSHA256":hex(&Sha256::digest(&bytes)),"blockhash":recent.to_string(),"verifiedEd25519":true,"signatureCount":1,"version":1,"packetBytes":bytes.len(),"computeUnits":cu,"result":format!("{:?}",result.result),"returnDataHex":hex(&returned),"frameHex":hex(&frame)}));
    captures.push(json!({"schema":"BIO-BANK-OPEN310-FULL-STAGE-1","label":"posttrace_end","traceSequence":Value::Null,"elfSHA256":ELF,"inputSHA256":INPUT,"abiSHA256":ABI,"traceSHA256":trace_sha,"instruction":end_row,"beforeAccounts":public_rows(&before),"afterAccounts":public_rows(&after),"actualLedgerBefore":ledger_before,"actualLedgerAfter":public_rows(&read_set(&c,&tracked).await),"artifactBodyHex":Value::Null,"returnDataHex":hex(&returned)}));
    write_new(
        evidence_dir.join(format!("{PREFIX}-checkpoint.json")),
        &json!({"schema":"BIO-BANK-OPEN310-GENUINE-CHECKPOINT-1","acceptancePassed":false,"label":"actual post-trace END executed; remaining acceptance assertions follow","elfSHA256":ELF,"inputSHA256":INPUT,"abiSHA256":ABI,"traceSHA256":trace_sha,"configId":begin["configId"],"clock":{"slot":clock.slot,"unixTimestamp":clock.unix_timestamp},"actualSignedTransactions":txs.len(),"parentCheckpointFile":format!("{PREFIX}-pre-cleanup-checkpoint.json"),"parentCheckpointSHA256":hex(&Sha256::digest(fs::read(evidence_dir.join(format!("{PREFIX}-pre-cleanup-checkpoint.json"))).unwrap())),"accounts":public_rows(&read_set(&c,&tracked).await),"additionalTransactions":[txs.last().unwrap()]}),
    );
    println!(
        "OPEN310_FULL_POSTTRACE_END event{cursor} boundary{boundary} tx{}",
        txs.len()
    );
    drop(sin);
    assert!(signer.wait().unwrap().success());
    assert_eq!(seeds, 17);
    assert!(restarted_physics);
    assert_eq!(restarts.len(), 3);
    assert_eq!(actual_funding_claims, 48083160);
    assert_eq!(actual_bio_claims, 941780);
    assert_eq!(actual_fee_burns, 48000000);
    assert_eq!(buys, 4);
    assert_eq!(parts, 60);
    assert_eq!(finals, 22);
    assert_eq!(produced.len(), 82);
    let bio = bio.unwrap();
    for k in &produced {
        assert_eq!(get(&c, *k).await.unwrap().data[362], u8::from(*k != bio));
    }
    let mint = pda(program, &[b"bio", b"lab-mint"]);
    let reserve = pda(program, &[b"bio", b"lab-reserve"]);
    let treasury = pda(program, &[b"bio", b"treasury"]);
    let token = key("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    let source = pda(
        key("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        &[author.as_ref(), token.as_ref(), mint.as_ref()],
    );
    let mint_supply = u64at(&get(&c, mint).await.unwrap().data, 36);
    let wallet = u64at(&get(&c, source).await.unwrap().data, 64);
    let reserve_amount = u64at(&get(&c, reserve).await.unwrap().data, 64);
    let treasury_a = get(&c, treasury).await.unwrap();
    assert_eq!(mint_supply, 100_000_000_000_000 - 48_000_000);
    assert_eq!(wallet, 1_024_940);
    assert_eq!(reserve_amount + wallet, mint_supply);
    assert_eq!(u64at(&treasury_a.data, 152), 48_000_000);
    let family = unhex("a02bcc4826e7d0fdf38d0ca20c26898147e71ab029eef69736790010f793f5fe");
    let snapshot = pda(program, &[b"bio", b"seed-final", &family]);
    let task = pda(program, &[b"bio", b"task", &family]);
    let slot = pda(program, &[b"bio", b"k-slot", &family]);
    let snap = get(&c, snapshot).await.unwrap();
    assert_eq!(u64at(&snap.data, 192), 17);
    assert_eq!(u64at(&get(&c, task).await.unwrap().data, 181), 310);
    let k = get(&c, slot).await.unwrap();
    assert_eq!(k.data[160], 0);
    assert_eq!(k.data[193], 0);
    tracked.extend([mint, reserve, treasury, source, snapshot, task, slot]);
    let bio_data = get(&c, bio).await.unwrap();
    let bio_position = pda(
        program,
        &[
            b"bio",
            b"reg",
            &bio_data.data[120..152],
            &0u64.to_le_bytes(),
        ],
    );
    tracked.insert(bio_position);
    let bio_pos = get(&c, bio_position).await.unwrap();
    assert_eq!(bio_pos.data[277], 1);
    let bio_start = u64at(&bio_pos.data, 269);
    let bio_end = u64at(&bio_pos.data, 278);
    assert_eq!(bio_end - bio_start, 2);
    assert_eq!(u64at(&bio_pos.data, 367), bio_end);
    assert_eq!(u64at(&bio_pos.data, 351), actual_bio_claims);
    assert_eq!(u64at(&bio_pos.data, 359), actual_bio_claims);
    assert_eq!(
        u64at(&treasury_a.data, 168),
        actual_funding_claims + actual_bio_claims
    );
    let terminal_map = read_set(&c, &tracked).await;
    let ended_positions = terminal_map
        .values()
        .filter_map(|a| a.as_ref())
        .filter(|a| a.owner == program && a.data.len() == 375 && u16at(&a.data, 10) == 27)
        .collect::<Vec<_>>();
    assert_eq!(ended_positions.len(), 61);
    for a in &ended_positions {
        assert_eq!(a.data[277], 1);
        assert_eq!(u64at(&a.data, 367), u64at(&a.data, 278));
        assert_eq!(u64at(&a.data, 351), u64at(&a.data, 359));
    }
    let registry = get(&c, pda(program, &[b"bio", b"mining"])).await.unwrap();
    assert_eq!(u64at(&registry.data, 184), 0);
    assert_eq!(u64at(&registry.data, 160), u64at(&registry.data, 168));
    let project_row = terminal_map
        .iter()
        .filter_map(|(k, a)| a.as_ref().map(|a| (k, a)))
        .find(|(_, a)| a.owner == program && a.data.len() >= 120 && u16at(&a.data, 10) == 9)
        .unwrap();
    let project_data = &project_row.1.data;
    let name_len = u32::from_le_bytes(project_data[264..268].try_into().unwrap()) as usize;
    let classes_at = 268 + name_len;
    let mut material_classes = Vec::new();
    for (class, expected) in [(1u8, 30u64), (2, 60), (3, 15), (4, 15)] {
        let at = classes_at + 65 * (class as usize - 1);
        assert_eq!(project_data[at], class);
        let mint_addr = Address::new_from_array(project_data[at + 1..at + 33].try_into().unwrap());
        let mat_mint = get(&c, mint_addr).await.unwrap();
        let issued = u64at(project_data, at + 49);
        let burned = u64at(project_data, at + 57);
        assert_eq!(issued, expected);
        assert_eq!(burned, expected);
        assert_eq!(u64at(&mat_mint.data, 36), 0);
        let ata = pda(
            key("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
            &[author.as_ref(), token.as_ref(), mint_addr.as_ref()],
        );
        assert_eq!(u64at(&get(&c, ata).await.unwrap().data, 64), 0);
        material_classes.push(json!({"class":class,"issuedUnits":issued,"burnedUnits":burned,"remainingTokenSupply":0,"playerATABalance":0,"mint":mint_addr.to_string(),"ata":ata.to_string()}));
    }
    let sources = terminal_map
        .values()
        .filter_map(|a| a.as_ref())
        .filter(|a| a.owner == program && a.data.len() == 856 && u16at(&a.data, 10) == 11)
        .collect::<Vec<_>>();
    let mut source_units = [0u64; 4];
    let mut source_spent = [0u64; 32];
    for a in &sources {
        let class = a.data[320];
        source_units[class as usize - 1] += u64at(&a.data, 312);
        for species in 1..=32 {
            source_spent[species - 1] += u64at(&a.data, 600 + 8 * (species - 1));
        }
    }
    assert_eq!(source_units, [30, 60, 15, 15]);
    for species in 1..=32 {
        let bom = match species {
            1..=24 => 500,
            25 => 1000,
            29..=32 => 250,
            _ => 0,
        };
        assert_eq!(source_spent[species - 1], 60 * bom);
    }
    let terminal = public_rows(&terminal_map);
    let terminal_sha = hex(&Sha256::digest(serde_json::to_vec(&terminal).unwrap()));
    let final_boot = c.banks_client.get_balance(author).await.unwrap();
    let ops = get(&c, pda(program, &[b"bio", b"ops"]))
        .await
        .unwrap()
        .lamports;
    let report = json!({"schema":"BIO-BANK-OPEN310-COLD-FULL-LIFECYCLE-1","fixtureOnly":true,"productionAdmission":false,"networkBroadcast":false,"cold":true,"scope":"new OPEN310 same input and frozen67c ELF: INIT17 prewarm, four material purchases,60parts,15CELL,6ORGAN,known C310 BIO,ordinary staking/continuous settlement/claims/exit,failed retry/cache and genuine Bank restart","elfSHA256":ELF,"inputSHA256":INPUT,"abiSHA256":ABI,"traceSHA256":trace_sha,"configId":begin["configId"],"noOldConfigurationBusinessAccountsLoaded":true,"genesisOnlySOLAndImmutableLoader":true,"nativeINITOnlyLABMint":true,"realV1Signatures":true,"actualSignedV1BankTransactions":txs.len(),"positiveTraceTransactions":rows.len(),"cachedRetryTransactions":5,"rejectedTransactions":2,"postTraceEndTransactions":1,"maxCU":max_cu,"maxPacketBytes":max_bytes,"totalComputeUnits":total_cu,"actualSeedCount":seeds,"actualPurchases":buys,"actualParts":parts,"actualCells":15,"actualOrgans":6,"actualBIO":bio.to_string(),"actualBIOCost":310,"consumedRoots":81,"materialLedger":material_classes,"actualSourceRecords":sources.len(),"sourceClassUnits":source_units,"sourceSpentTicksBySpecies":source_spent.to_vec(),"actualManufacturingBurnAtoms":actual_fee_burns,"actualFundingClaimAtoms":actual_funding_claims,"actualBIOOrdinaryRewardAtoms":actual_bio_claims,"actualTotalClaimAtoms":actual_funding_claims+actual_bio_claims,"actualBIOPosition":{"address":bio_position.to_string(),"start":bio_start,"end":bio_end,"coveredThrough":bio_end,"accrued":actual_bio_claims,"paid":actual_bio_claims},"actualFinalWalletAtoms":wallet,"actualFinalMintAtoms":mint_supply,"actualFinalReserveAtoms":reserve_amount,"knownPublicC310NoWinnerOrK":true,"actualHistoricalPositions":ended_positions.len(),"allPositionsEndedFullyCoveredAndPaid":true,"terminalRegistryActiveCount":0,"terminalEventCursorEqualsEventCount":true,"failedFinalAllNonFeePayerAccountsUnchanged":true,"exactCachedRetriesNoBusinessMutation":true,"duplicateClaimWithNewNonceRejected8021WithoutBusinessMutation":true,"allActualNonceCachesMatchReturnData":true,"actualRestarts":restarts,"terminalAccountsContentSHA256":terminal_sha,"initialBootLamports":initial_boot,"finalBootLamports":final_boot,"actualBootNetSpentLamports":initial_boot-final_boot,"actualOpsVaultLamports":ops,"localBankSignatureFeeLamports":txs.len()as u64*5000,"signatureFeeQuoteScope":"ProgramTest 5000 per signature; zero priority, not network quote","transactions":txs});
    let dir = project.join("programs/transaction-transport/evidence");
    write_new(dir.join(format!("{PREFIX}.json")), &report);
    write_new(
        dir.join(format!("{PREFIX}-terminal.json")),
        &json!({"schema":"BIO-BANK-OPEN310-ACTUAL-TERMINAL-1","elfSHA256":ELF,"inputSHA256":INPUT,"abiSHA256":ABI,"traceSHA256":trace_sha,"configId":begin["configId"],"actualSignedV1BankTransactions":report["actualSignedV1BankTransactions"],"accountsContentSHA256":terminal_sha,"clock":{"slot":clock.slot,"unixTimestamp":clock.unix_timestamp},"accounts":terminal}),
    );
    for (idx, v) in captures.iter().enumerate() {
        write_new(
            dir.join(format!(
                "{PREFIX}-stage-{idx:02}-{}.json",
                v["label"].as_str().unwrap()
            )),
            v,
        );
    }
    println!(
        "OPEN310_FULL_BANK_PASS tx{} maxCU{max_cu} bytes{max_bytes}",
        report["actualSignedV1BankTransactions"]
    );
}
