//! Cold INIT/CREATE/four-BUY and SDK part-window evidence from the frozen ELF
//! with real Kit V1 signatures. No material, nonce or debt state is injected.
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
            "BANK_PART_TX seq={} success={} bytes={} cu={}",
            self.seq - 1,
            success,
            bytes.len(),
            metadata.compute_units_consumed
        );
        (execution, returned)
    }
}

fn sdk_window(max_rent: u64) -> Value {
    // Read-only planning from previously captured actual cold purchase balances.
    // The fresh Bank below independently executes that same cold prefix; these
    // records never enter Bank genesis or replace any protocol account.
    let script = r#"
import {readFileSync} from 'node:fs';
import {parseJsonWithBigInts} from '@solana/rpc-spec-types';
import {validateProductionRelease,PROGRAMS} from './packages/client/src/release.mjs';
import {loadNativeAbi,nativeKeyBytes} from './packages/client/src/native.mjs';
import {decodeNativeProject,decodeClassicTokenAccount} from './packages/client/src/accounts.mjs';
import {planManufacturePartWorkflow} from './packages/client/src/workflow.mjs';
const release=await validateProductionRelease(JSON.parse(readFileSync('programs/biolab-economy/evidence/production-admission-fixture-result58.json')),{localPublicFixture:true});
const abi=loadNativeAbi(undefined,{expectedHash:release.input.abiHash}),rows=new Map(),files=[];
for(let c=1;c<=4;c++){const path=`programs/transaction-transport/evidence/purchase-result-bank-76b35cfb-class-${c}.json`,value=parseJsonWithBigInts(readFileSync(path,'utf8'));files.push(path);for(const a of value.afterAccounts)if(!a.missing)rows.set(a.address,{...a,data:Buffer.from(a.data[0],'base64')});}
const projects=new Map(),tokens=new Map(),sources=new Map(),actor=release.input.bootstrap;
for(const a of rows.values())if(a.owner===release.input.programId&&a.data.length>=120&&a.data.readUInt16LE(10)===9){const id=a.data.subarray(88,120),p=await decodeNativeProject(release,a,id);projects.set(id.toString('hex'),p);}
for(const a of rows.values())if(a.owner===PROGRAMS.tokenProgram&&a.data.length===165){const t=decodeClassicTokenAccount(a,{expectedOwner:actor});tokens.set(nativeKeyBytes(a.address).toString('hex'),{...t,owner:nativeKeyBytes(t.owner),mint:nativeKeyBytes(t.mint),initialized:true,native:false,frozen:false});}
const w=await planManufacturePartWorkflow({release,abi,actor,initialNonce:6n,inventory:{projects,tokens,sources},descriptor:{primitive:1,profile:0},maxPartRent:BigInt(process.argv[1]),maxUploadRent:100000000n});
const stages=w.stages.map(s=>({kind:'instruction',stage:s.kind,programId:s.instruction.programAddress,dataHex:Buffer.from(s.frame).toString('hex'),expectedResult:'Ok',accounts:s.instruction.accounts.map(a=>({pubkey:a.address,isWritable:Boolean(a.role&1),isSigner:Boolean(a.role&2)}))}));
console.log(JSON.stringify({fixtureOnly:true,networkBroadcast:false,scope:'SDK plan from actual recorded purchased balances; execution Bank independently recreates these from cold genesis',basis:files,actor,initialNonce:w.initialNonce.toString(),manufactureNonce:w.manufactureNonce.toString(),nextNonce:w.nextNonce.toString(),artifactIdHex:w.artifactId.toString('hex'),artifactSHAHex:w.artifactSHA.toString('hex'),artifactBodyHex:w.artifactBody.toString('hex'),outputIdHex:w.outputId.toString('hex'),outputAddress:w.outputAddress,stages}));
"#;
    let output = Command::new("node")
        .args(["--input-type=module", "-e", script, &max_rent.to_string()])
        .current_dir(root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "SDK part plan: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
async fn cold_context(begin: &Value, elf: &[u8]) -> ProgramTestContext {
    let program = key(begin["program"].as_str().unwrap());
    let boot = key(begin["boot"].as_str().unwrap());
    let loader = key("BPFLoaderUpgradeab1e11111111111111111111111");
    let program_data = Address::find_program_address(&[program.as_ref()], &loader).0;
    let mut p = 2u32.to_le_bytes().to_vec();
    p.extend_from_slice(program_data.as_ref());
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
    test.start_with_context().await
}
fn set_clock(context: &mut ProgramTestContext, row: &Value) {
    context.set_sysvar(&Clock {
        slot: row["clock"]["slot"].as_u64().unwrap(),
        unix_timestamp: row["clock"]["unixTimestamp"].as_i64().unwrap(),
        ..Clock::default()
    });
}
async fn execute_prefix(
    context: &mut ProgramTestContext,
    signer: &mut Signer,
    begin: &Value,
    rows: &[Value],
    window: &Value,
) -> Vec<Value> {
    let mut out = Vec::new();
    for row in rows {
        set_clock(context, row);
        let (tx, _) = signer
            .send(context, begin, &[row.clone()], false, true)
            .await;
        out.push(tx);
    }
    for row in window["stages"]
        .as_array()
        .unwrap()
        .iter()
        .take(window["stages"].as_array().unwrap().len() - 1)
    {
        let (tx, _) = signer
            .send(context, begin, &[row.clone()], false, true)
            .await;
        out.push(tx);
    }
    out
}
#[tokio::test]
#[ignore = "explicit frozen76b cold signed Bank part manufacture,108 result, rollback and exact retry; immutable evidence"]
async fn actual_cold_part_caches_108_bytes_retries_and_rolls_back() {
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
    let prefix = &lines[1..7];
    assert_eq!(begin["cold"], true);
    assert_eq!(lines.last().unwrap()["success"], true);
    let abi_bytes = fs::read(project.join("programs/biolab-economy/operations.p0r2.json")).unwrap();
    assert_eq!(sha(&abi_bytes), ABI_SHA);
    let abi: Value = serde_json::from_slice(&abi_bytes).unwrap();
    let op = abi["operations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|op| op["name"] == "MANUFACTURE_PART")
        .unwrap();
    assert_eq!(op["resultBytes"], 108);
    assert_eq!(op["module"], 501);
    let elf = fs::read(
        project.join("programs/biolab-economy/target/econ4r1-production-deploy/biolab_economy.so"),
    )
    .unwrap();
    assert_eq!(sha(&elf), ELF_SHA);
    let program = key(begin["program"].as_str().unwrap());
    let boot = key(begin["boot"].as_str().unwrap());
    let normal = sdk_window(100_000_000);
    let capped = sdk_window(0);
    assert_eq!(normal["manufactureNonce"], capped["manufactureNonce"]);
    assert_eq!(normal["outputIdHex"], capped["outputIdHex"]);
    let mut signer = Signer::new();
    let mut all_txs = Vec::new();
    // Separate cold Bank authenticates cap0 in its uploaded and sealed full
    // payload; this reaches the actual rent requirement, not cap disagreement.
    let mut cap_context = cold_context(begin, &elf).await;
    let cap_prefix = execute_prefix(&mut cap_context, &mut signer, begin, prefix, &capped).await;
    all_txs.extend(cap_prefix.clone());
    let cap_row = capped["stages"].as_array().unwrap().last().unwrap();
    let cap_before = snapshot(&cap_context, cap_row).await;
    let cap_boot = cap_context.banks_client.get_balance(boot).await.unwrap();
    let (cap_execution, _) = signer
        .send(&mut cap_context, begin, &[cap_row.clone()], false, false)
        .await;
    assert!(cap_execution["bankResult"]
        .as_str()
        .unwrap()
        .contains("6109"));
    assert_state_equal(&cap_context, cap_row, &cap_before).await;
    assert_eq!(
        cap_boot - cap_context.banks_client.get_balance(boot).await.unwrap(),
        5000
    );
    all_txs.push(cap_execution.clone());
    let cap_case = json!({"name":"AUTHENTICATED_MANUFACTURE_RENT_CAP_ZERO","scope":"independent cold Bank; cap0 body uploaded and sealed by actual signed transactions","window":capped,"beforeAccounts":cap_before,"afterAccounts":snapshot(&cap_context,cap_row).await,"prefixExecutions":cap_prefix,"execution":cap_execution,"businessStateRolledBack":true,"onlyLocalSignatureFeeLamports":5000});
    drop(cap_context);
    let mut context = cold_context(begin, &elf).await;
    let prefix_executions = execute_prefix(&mut context, &mut signer, begin, prefix, &normal).await;
    all_txs.extend(prefix_executions.clone());
    let row = normal["stages"].as_array().unwrap().last().unwrap();
    let frame = unhex(row["dataHex"].as_str().unwrap());
    let body = unhex(normal["artifactBodyHex"].as_str().unwrap());
    assert_eq!(u16at(&frame, 10), 501);
    assert_eq!(
        u64at(&frame, 112),
        normal["manufactureNonce"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
    );
    let before_abort = snapshot(&context, row).await;
    let before_abort_boot = context.banks_client.get_balance(boot).await.unwrap();
    let mut fail_transfer = 2u32.to_le_bytes().to_vec();
    fail_transfer.extend_from_slice(&u64::MAX.to_le_bytes());
    let fail_ix = json!({"programId":"11111111111111111111111111111111","accounts":[{"pubkey":boot.to_string(),"isWritable":true,"isSigner":true},{"pubkey":row_key(row,10).to_string(),"isWritable":true,"isSigner":false}],"dataHex":hex(&fail_transfer)});
    let (abort_execution, _) = signer
        .send(
            &mut context,
            begin,
            &[row.clone(), fail_ix.clone()],
            false,
            false,
        )
        .await;
    assert!(abort_execution["bankResult"]
        .as_str()
        .unwrap()
        .contains("InstructionError(1"));
    assert_state_equal(&context, row, &before_abort).await;
    assert_eq!(
        before_abort_boot - context.banks_client.get_balance(boot).await.unwrap(),
        5000
    );
    all_txs.push(abort_execution.clone());
    let abort_case = json!({"name":"LATER_INSTRUCTION_FAILURE_ROLLS_BACK_MANUFACTURE","instructions":[row,fail_ix],"beforeAccounts":before_abort,"afterAccounts":snapshot(&context,row).await,"execution":abort_execution,"businessStateRolledBack":true,"onlyLocalSignatureFeeLamports":5000});
    let before_accounts = snapshot(&context, row).await;
    let before_boot = context.banks_client.get_balance(boot).await.unwrap();
    let before_nonce = account(&context, row_key(row, 1)).await;
    assert!(context
        .banks_client
        .get_account(row_key(row, 9))
        .await
        .unwrap()
        .is_none());
    let (execution, result) = signer
        .send(&mut context, begin, &[row.clone()], false, true)
        .await;
    all_txs.push(execution.clone());
    assert_eq!(result.len(), 108);
    let after_accounts = snapshot(&context, row).await;
    let after_boot = context.banks_client.get_balance(boot).await.unwrap();
    let nonce = account(&context, row_key(row, 1)).await;
    let output = account(&context, row_key(row, 9)).await;
    let artifact = account(&context, row_key(row, 8)).await;
    assert_eq!(output.owner, program);
    assert_eq!(u16at(&output.data, 10), 12);
    assert_eq!(u16at(&output.data, 12), 1);
    assert_eq!(
        &result[..32],
        &unhex(normal["outputIdHex"].as_str().unwrap())
    );
    assert_eq!(&output.data[120..152], &result[..32]);
    assert_eq!(&result[32..36], &body[..4]);
    assert_eq!(u32at(&result, 36), 1_000_000);
    assert_eq!(u64at(&result, 40), 120_000);
    assert_eq!(u64at(&result, 48), 45_000);
    assert_eq!(u64at(&result, 56), 14_000);
    assert_eq!(&artifact.data[251..], &body);
    assert_eq!(artifact.data[234], 1);
    assert_eq!(
        &output.data[184..216],
        &biolab_economy::typed_hash(4, &[&frame])
    );
    let mut mints = Vec::new();
    let mut sources = Vec::new();
    let mut actual_rent = output.lamports;
    for (i, class) in (1u8..=4).enumerate() {
        let before_mint = before_accounts
            .iter()
            .find(|a| a["address"] == row["accounts"][11 + i]["pubkey"])
            .unwrap();
        let mint = account(&context, row_key(row, 11 + i)).await;
        let token = account(&context, row_key(row, 15 + i)).await;
        let burned = u64at(&result, 64 + i * 8);
        // Four first intakes are each the minimal1 standard unit. Supply and ATA
        // deltas are checked from actual Bank before snapshots below as well.
        assert_eq!(burned, 1);
        assert_eq!(
            u64at(&token.data, 64),
            if class == 1 {
                29
            } else if class == 2 {
                59
            } else {
                14
            }
        );
        mints.push(json!({"class":class,"mint":row_key(row,11+i).to_string(),"token":row_key(row,15+i).to_string(),"burnedUnits":burned,"mintSupplyAfter":u64at(&mint.data,36),"tokenAmountAfter":u64at(&token.data,64),"beforeRecordCaptured":before_mint["missing"].is_null()}));
    }
    // Canonical dynamic list: project,4mints,4ATAs,4Sources after Root.
    for i in 19..23 {
        let address = row_key(row, i);
        let source = account(&context, address).await;
        assert_eq!(source.owner, program);
        assert_eq!(source.data.len(), 856);
        assert_eq!(u16at(&source.data, 10), 11);
        assert_eq!(u64at(&source.data, 312), 1);
        assert_eq!(&source.data[120..152], boot.as_ref());
        actual_rent += source.lamports;
        sources.push(json!({"address":address.to_string(),"sourceIdHex":hex(&source.data[88..120]),"class":source.data[320],"unitCount":u64at(&source.data,312),"createdSlot":u64at(&source.data,336),"spentPrefix":(0..32).map(|j|u64at(&source.data,600+j*8)).collect::<Vec<_>>()}));
    }
    assert_eq!(u16at(&result, 96), 4);
    assert_eq!(u16at(&result, 98), 4);
    assert_eq!(u64at(&result, 100), actual_rent);
    assert_eq!(before_boot - after_boot, actual_rent + 5000);
    assert_eq!(u64at(&nonce.data, 120), u64at(&before_nonce.data, 120) + 1);
    assert_eq!(u16at(&nonce.data, 160), 108);
    assert_eq!(&nonce.data[162..270], &result);
    assert!(nonce.data[270..].iter().all(|x| *x == 0));
    let project_record = account(&context, row_key(row, 10)).await;
    let name_len = u32at(&project_record.data, 264) as usize;
    for i in 0..4 {
        let at = 120 + 148 + name_len + i * 65;
        assert_eq!(u64at(&project_record.data, at + 57), 1);
    }
    let (retry, retry_result) = signer
        .send(&mut context, begin, &[row.clone()], true, true)
        .await;
    all_txs.push(retry.clone());
    assert_ne!(execution["actualSignature"], retry["actualSignature"]);
    assert_ne!(execution["blockhash"], retry["blockhash"]);
    assert_eq!(result, retry_result);
    assert_state_equal(&context, row, &after_accounts).await;
    assert_eq!(
        after_boot - context.banks_client.get_balance(boot).await.unwrap(),
        5000
    );
    let after_retry = snapshot(&context, row).await;
    let h4 = biolab_economy::typed_hash(4, &[&frame]);
    let manufacture_result = json!({"outputIdHex":normal["outputIdHex"],"outputAddress":normal["outputAddress"],"descriptorHex":hex(&body[..4]),"qualityPpm":1_000_000,"B":120_000,"retired":45_000,"totalTicks":14_000,"burnedUnits":[1,1,1,1],"intakeCount":4,"debitCount":4,"actualRentLamports":actual_rent,"cacheBytes":108,"resultHex":hex(&result),"nativeNonceBefore":u64at(&before_nonce.data,120),"nativeNonceAfter":u64at(&nonce.data,120),"bootLamportsBefore":before_boot,"bootLamportsAfter":after_boot,"bootNetDebitLamports":before_boot-after_boot,"localTransactionSignatureFeeLamports":5000,"mints":mints,"sources":sources});
    let case = json!({"schema":"BIO-BANK-PART-RESULT-CASE-1","fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"scope":"actual cold6 prefix and SDK part window; firstpart manufacture and distinct-lifetime exact retry; no 16-seed/full-chain replay","programId":program.to_string(),"actor":boot.to_string(),"elfSHA256":ELF_SHA,"traceSHA256":TRACE_SHA,"abiSHA256":ABI_SHA,"frameHex":hex(&frame),"frameSHA256":sha(&frame),"requestH4":hex(&h4),"instruction":row,"artifactBodyHex":normal["artifactBodyHex"],"window":normal,"actorNonceAddress":row_key(row,1).to_string(),"econConfigAddress":row_key(row,2).to_string(),"baseConfigAddress":row_key(row,7).to_string(),"beforeAccounts":before_accounts,"afterAccounts":after_accounts,"afterRetryAccounts":after_retry,"manufactureResult":manufacture_result,"prefixExecutions":prefix_executions,"execution":execution,"retry":retry,"negativeCases":[cap_case,abort_case],"retryNativeNonceUnchanged":true,"retryCachedResultUnchanged":true,"retryRootSourcesMintATAsProjectUnchanged":true,"retryOnlyLocalSignatureFeeLamports":5000});
    let dir = std::env::var_os("BIOLAB_PART_EVIDENCE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| project.join("programs/transaction-transport/evidence"));
    fs::create_dir_all(&dir).unwrap();
    let filename = "part-result-bank-76b35cfb-case-1.json";
    let case_sha = immutable_json(&dir.join(filename), &case);
    let report = json!({"schema":"BIO-BANK-PART-RESULT-1","fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"scope":"two independent empty cold Banks: exact6 purchase prefix and signed SDK part windows, true authenticatedcap0 rollback, later failure rollback,108 cached success and exactFrame retry","runtime":"Agave4.3.2 ProgramTest Bank","officialSdk":"@solana/kit8.0.0","wireProfile":"BIOP0R2 ExactFrame152","elfSHA256":ELF_SHA,"sourceTraceSHA256":TRACE_SHA,"abiSHA256":ABI_SHA,"replayedTraceSequencesPerBank":[0,1,2,3,4,5],"actualSignedV1BankTransactions":signer.seq,"actualSignatureVerification":true,"immutableLoaderV3Genesis":true,"upgradeAuthority":null,"onlyBOOTFundedWithSOL":true,"bootGenesisLamportsPerBank":50_000_000_000u64,"protocolOrMaterialOrDebtAccountsInjected":0,"actualManufactures":1,"failedTransactions":2,"actualDistinctLifetimeExactFrameRetries":1,"allManufactureResultCacheLengths":108,"allRetryResultsEqual":true,"noRetryBurnOrRootCreationOrProtocolDebit":true,"failedTransactionsRolledBackAllManufactureState":true,"maxComputeUnits":all_txs.iter().map(|v|v["computeUnits"].as_u64().unwrap()).max().unwrap(),"totalComputeUnits":all_txs.iter().map(|v|v["computeUnits"].as_u64().unwrap()).sum::<u64>(),"maxPacketBytes":all_txs.iter().map(|v|v["packetBytes"].as_u64().unwrap()).max().unwrap(),"cases":[{"file":filename,"sha256":case_sha,"manufactureResult":manufacture_result}],"recordedReadsScope":"actual local Bank snapshots; offline fixture adapters are not live RPC finality","costScope":"local ProgramTest Bank only; actual rent distinct from5000-lamport included signature fee, zero priorityfee; no public-network quote"});
    let report_file = dir.join("part-result-bank-76b35cfb.json");
    immutable_json(&report_file, &report);
    println!("BANK_PART_RESULT_PASS {}", report_file.display());
    drop(signer.input);
    assert!(signer.child.wait().unwrap().success());
}
