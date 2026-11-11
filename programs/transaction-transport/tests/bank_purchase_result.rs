//! Exact signed Bank evidence for the cold INIT/CREATE/four-BUY prefix.
//! Every account/result below is read from the Bank, never constructed as a
//! fabricated entitlement. This test does not replay the rest of the BIO chain.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_message::VersionedMessage;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_transaction::versioned::VersionedTransaction;
use std::{fs, io::{BufRead, BufReader, Write}, path::{Path, PathBuf}, process::{Child, ChildStdin, ChildStdout, Command, Stdio}};

const ELF_SHA: &str = "76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e";
const TRACE_SHA: &str = "0e095ba68569187525b39f2c65c95836878fb763532acf5f2aa2cbece2ebc1f0";
const ABI_SHA: &str = "089d63ad876fe0701ab783b25ad9de3b6ea7cb0f2a48e085e451fe51a6d9024f";
fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap() }
fn key(s: &str) -> Address { s.parse().unwrap() }
fn hex(d: &[u8]) -> String { d.iter().map(|b| format!("{b:02x}")).collect() }
fn unhex(s: &str) -> Vec<u8> { assert_eq!(s.len() % 2, 0); (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i+2],16).unwrap()).collect() }
fn sha(d: &[u8]) -> String { hex(&Sha256::digest(d)) }
fn u64at(d: &[u8], at: usize) -> u64 { u64::from_le_bytes(d[at..at+8].try_into().unwrap()) }
fn u16at(d: &[u8], at: usize) -> u16 { u16::from_le_bytes(d[at..at+2].try_into().unwrap()) }
fn base64(d: &[u8]) -> String {
    const CHARS: &[u8;64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in d.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (chunk.get(1).copied().unwrap_or(0) as u32) << 8 | chunk.get(2).copied().unwrap_or(0) as u32;
        out.push(CHARS[(n >> 18) as usize] as char); out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { CHARS[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[(n & 63) as usize] as char } else { '=' });
    }
    out
}
async fn account(c: &ProgramTestContext, k: Address) -> Account { c.banks_client.get_account(k).await.unwrap().unwrap() }
fn row_key(row: &Value, index: usize) -> Address { key(row["accounts"][index]["pubkey"].as_str().unwrap()) }
fn same_value(a: &Account, b: &Account) { assert_eq!(a.lamports,b.lamports); assert_eq!(a.data,b.data); assert_eq!(a.owner,b.owner); assert_eq!(a.executable,b.executable); }
async fn snapshot(c: &ProgramTestContext, row: &Value) -> Vec<Value> {
    let mut seen = std::collections::BTreeSet::new(); let mut out = Vec::new();
    for meta in row["accounts"].as_array().unwrap() {
        let address = meta["pubkey"].as_str().unwrap(); if !seen.insert(address) { continue; }
        match c.banks_client.get_account(key(address)).await.unwrap() {
            None => out.push(json!({"address":address,"missing":true})),
            // Executable binaries are separately bound by ELF/runtime identity;
            // the recorded-read client needs account state, not Token ELF copies.
            Some(a) if a.executable => {},
            Some(a) => out.push(json!({"address":address,"lamports":a.lamports,"owner":a.owner.to_string(),"executable":a.executable,"rentEpoch":a.rent_epoch,"data":[base64(&a.data),"base64"]})),
        }
    }
    out
}
fn immutable_json(path: &Path, value: &Value) -> String {
    let bytes = serde_json::to_vec_pretty(value).unwrap();
    if path.exists() { assert_eq!(fs::read(path).unwrap(),bytes,"refuse to replace distinct evidence: {}",path.display()); }
    else { let mut f = fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap(); f.write_all(&bytes).unwrap(); f.sync_all().unwrap(); }
    sha(&bytes)
}
struct Signer { child: Child, input: ChildStdin, output: BufReader<ChildStdout>, seq: u64 }
impl Signer {
    fn new() -> Self {
        let mut child = Command::new("node").arg(root().join("scripts/sign-trace-fixture.mjs")).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let input = child.stdin.take().unwrap(); let output = BufReader::new(child.stdout.take().unwrap()); Self{child,input,output,seq:0}
    }
    async fn send(&mut self, c: &mut ProgramTestContext, begin: &Value, row: &Value, new_lifetime: bool) -> (Value, Vec<u8>) {
        // A new recent blockhash proves retry reaches Core rather than Bank's
        // already-processed-signature cache. Exact instruction bytes stay fixed.
        let recent = if new_lifetime { c.get_new_latest_blockhash().await.unwrap() } else { c.banks_client.get_latest_blockhash().await.unwrap() };
        // Keep ProgramTest's comparison point equal to the hash actually signed,
        // including ordinary sends that may observe its background tick thread.
        c.last_blockhash = recent;
        let request = json!({"fixtureOnly":true,"productionWire":true,"seq":self.seq,"feePayer":begin["boot"],"blockhash":recent.to_string(),"lastValidBlockHeight":(c.banks_client.get_root_block_height().await.unwrap()+150).to_string(),"maxCU":begin["maxCU"],"heap":begin["heap"],"instructions":[row]});
        writeln!(self.input,"{request}").unwrap(); self.input.flush().unwrap(); let mut line = String::new(); assert!(self.output.read_line(&mut line).unwrap() > 0);
        let signed: Value = serde_json::from_str(&line).unwrap(); assert_eq!(signed["seq"],self.seq); self.seq += 1;
        let bytes = unhex(signed["bytesHex"].as_str().unwrap()); assert!(bytes.len() <= 4096);
        let tx: VersionedTransaction = wincode::deserialize(&bytes).unwrap(); tx.verify_and_hash_message().unwrap();
        assert_eq!(tx.message.static_account_keys()[0].to_string(),begin["boot"].as_str().unwrap());
        let VersionedMessage::V1(message) = &tx.message else { panic!("official Kit signer must emit v1") };
        assert_eq!(message.config.priority_fee,Some(0)); let signature = tx.signatures[0].to_string(); let signatures = tx.signatures.len();
        let result = c.banks_client.process_transaction_with_metadata(tx).await.unwrap(); assert_eq!(result.result,Ok(()),"actual signed Bank prefix transaction seq{}",self.seq-1);
        let metadata = result.metadata.unwrap(); let returned = metadata.return_data.expect("native success returns actual cached result");
        assert_eq!(returned.program_id.to_string(),begin["program"].as_str().unwrap());
        let evidence = json!({"bankTransactionSequence":self.seq-1,"actualSignature":signature,"signatureCount":signatures,"verifiedEd25519":true,"version":1,"blockhash":recent.to_string(),"signedTransactionHex":hex(&bytes),"signedTransactionSHA256":sha(&bytes),"packetBytes":bytes.len(),"computeUnits":metadata.compute_units_consumed,"returnDataHex":hex(&returned.data),"returnDataBytes":returned.data.len(),"result":"Ok"});
        println!("BANK_PURCHASE_TX seq={} bytes={} cu={}",self.seq-1,bytes.len(),metadata.compute_units_consumed);
        (evidence,returned.data)
    }
}

#[tokio::test]
#[ignore = "explicit exact76b cold signed Bank purchase-result prefix; writes immutable recorded account snapshots"]
async fn actual_cold_purchases_cache_58_bytes_and_retry_without_reissuance() {
    let project = root(); let trace_path = project.join("programs/biolab-economy/evidence/econ4r1-full-chain.jsonl");
    let trace = fs::read(&trace_path).unwrap(); assert_eq!(sha(&trace),TRACE_SHA);
    let lines = String::from_utf8(trace).unwrap().lines().map(|line|serde_json::from_str::<Value>(line).unwrap()).collect::<Vec<_>>();
    let begin = &lines[0]; assert_eq!(begin["kind"],"begin"); assert_eq!(begin["cold"],true); assert_eq!(begin["fixtureOnly"],true); assert_eq!(lines.last().unwrap()["success"],true);
    let rows = &lines[1..7]; assert_eq!(rows.len(),6); assert_eq!(begin["bootGenesisLamports"],50_000_000_000u64);
    let abi_path = project.join("programs/biolab-economy/operations.p0r2.json"); let abi_bytes = fs::read(&abi_path).unwrap(); assert_eq!(sha(&abi_bytes),ABI_SHA);
    let abi: Value = serde_json::from_slice(&abi_bytes).unwrap(); let buy_abi = abi["operations"].as_array().unwrap().iter().find(|op|op["name"] == "BUY_MATERIAL").unwrap(); let abi_result_len = buy_abi["resultBytes"].as_u64().unwrap() as usize; assert_eq!(abi_result_len,58);
    let program = key(begin["program"].as_str().unwrap()); let boot = key(begin["boot"].as_str().unwrap());
    let elf = fs::read(project.join("programs/biolab-economy/target/econ4r1-production-deploy/biolab_economy.so")).unwrap(); assert_eq!(sha(&elf),ELF_SHA); assert_eq!(begin["elfSHA256"],ELF_SHA);
    // Only immutable Loader-v3 deployment metadata + exact ELF and BOOT's
    // 50SOL enter genesis. No protocol/material/nonce/quota/debt state is added.
    let loader = key("BPFLoaderUpgradeab1e11111111111111111111111"); let program_data = Address::find_program_address(&[program.as_ref()],&loader).0;
    let mut p = 2u32.to_le_bytes().to_vec(); p.extend_from_slice(program_data.as_ref()); let mut d = vec![0;45]; d[..4].copy_from_slice(&3u32.to_le_bytes()); d.extend_from_slice(&elf);
    let mut test = ProgramTest::default(); test.prefer_bpf(true);
    test.add_genesis_account(program,Account{lamports:10_000_000,data:p,owner:loader,executable:true,rent_epoch:u64::MAX});
    test.add_genesis_account(program_data,Account{lamports:10_000_000_000,data:d,owner:loader,executable:false,rent_epoch:u64::MAX});
    test.add_account(boot,Account{lamports:50_000_000_000,data:vec![],owner:Address::default(),executable:false,rent_epoch:0});
    let mut context = test.start_with_context().await; assert_eq!(context.banks_client.get_balance(boot).await.unwrap(),50_000_000_000);
    let dir = std::env::var_os("BIOLAB_PURCHASE_EVIDENCE_DIR").map(PathBuf::from).unwrap_or_else(||project.join("programs/transaction-transport/evidence")); fs::create_dir_all(&dir).unwrap();
    let mut signer = Signer::new(); let mut purchases = Vec::new(); let mut prefix = Vec::new(); let mut max_cu = 0; let mut max_bytes = 0; let mut total_cu = 0;
    for (i,row) in rows.iter().enumerate() {
        assert_eq!(row["kind"],"instruction"); assert_eq!(row["seq"],i); assert_eq!(row["expectedResult"],"Ok");
        let frame = unhex(row["dataHex"].as_str().unwrap()); assert!(frame.starts_with(b"BIOIX\0\0\0")); assert_eq!(u16at(&frame,10),if i==0{1}else if i==1{201}else{202}); assert_eq!(u16at(&frame,12),1); assert_eq!(u16at(&frame,14),2); assert_eq!(u64at(&frame,112),i as u64);
        context.set_sysvar(&Clock{slot:row["clock"]["slot"].as_u64().unwrap(),unix_timestamp:row["clock"]["unixTimestamp"].as_i64().unwrap(),..Clock::default()});
        if i < 2 {
            let (execution,_) = signer.send(&mut context,begin,row,false).await; prefix.push(execution); continue;
        }
        let before_accounts = snapshot(&context,row).await; let before_nonce = account(&context,row_key(row,1)).await; let before_boot = context.banks_client.get_balance(boot).await.unwrap();
        let before_ops = account(&context,row_key(row,13)).await; let before_mint = account(&context,row_key(row,9)).await; let before_project = account(&context,row_key(row,8)).await;
        let (execution,result) = signer.send(&mut context,begin,row,false).await; assert_eq!(result.len(),abi_result_len);
        let after_accounts = snapshot(&context,row).await; let after_nonce = account(&context,row_key(row,1)).await; let after_boot = context.banks_client.get_balance(boot).await.unwrap();
        let mint = account(&context,row_key(row,9)).await; let destination = account(&context,row_key(row,14)).await; let seasonal = account(&context,row_key(row,11)).await; let lifetime = account(&context,row_key(row,12)).await; let after_ops = account(&context,row_key(row,13)).await; let after_project = account(&context,row_key(row,8)).await;
        let payload = &frame[152..]; let class = payload[32]; let quantity = u64at(payload,97); let price = u64at(payload,234); let resource_per = u64at(payload,242); let season = u16at(payload,298);
        assert_eq!(&mint.data[..4],&[1,0,0,0]); assert_eq!(u64at(&mint.data,36),u64at(&before_mint.data,36)+quantity); assert_eq!(u64at(&destination.data,64),quantity);
        assert_eq!(&destination.data[..32],row_key(row,9).as_ref()); assert_eq!(&destination.data[32..64],boot.as_ref());
        assert_eq!(seasonal.data.len(),131); assert_eq!(lifetime.data.len(),129); assert_eq!(seasonal.data[120],class); assert_eq!(lifetime.data[120],class); assert_eq!(u16at(&seasonal.data,121),season); assert_eq!(u64at(&seasonal.data,123),quantity); assert_eq!(u64at(&lifetime.data,121),quantity);
        let name_len = u32::from_le_bytes(after_project.data[264..268].try_into().unwrap()) as usize; let issued_at = 120+148+name_len+65*(class as usize-1)+49; assert_eq!(u64at(&after_project.data,issued_at),u64at(&before_project.data,issued_at)+quantity);
        let rent = seasonal.lamports+lifetime.lamports+destination.lamports; assert_eq!(u64at(&result,0),quantity); assert_eq!(u64at(&result,8),quantity*price); assert_eq!(u64at(&result,16),quantity*resource_per); assert_eq!(u64at(&result,24),rent); assert_eq!(u16at(&result,32),season); for at in [34,42,50] { assert_eq!(u64at(&result,at),quantity); }
        assert_eq!(after_ops.lamports-before_ops.lamports,quantity*resource_per); assert_eq!(before_boot-after_boot,quantity*resource_per+rent+5000);
        assert_eq!(u64at(&after_nonce.data,120),u64at(&before_nonce.data,120)+1); assert_eq!(u16at(&after_nonce.data,160) as usize,abi_result_len); assert_eq!(&after_nonce.data[162..162+abi_result_len],&result); assert!(after_nonce.data[162+abi_result_len..418].iter().all(|x|*x==0));
        let h4 = biolab_economy::typed_hash(4,&[&frame]); assert_eq!(&after_nonce.data[128..160],&h4);
        let (retry,retry_result) = signer.send(&mut context,begin,row,true).await; assert_ne!(execution["actualSignature"],retry["actualSignature"]); assert_ne!(execution["blockhash"],retry["blockhash"]); assert_eq!(retry_result,result);
        same_value(&account(&context,row_key(row,1)).await,&after_nonce); same_value(&account(&context,row_key(row,9)).await,&mint); same_value(&account(&context,row_key(row,14)).await,&destination); same_value(&account(&context,row_key(row,11)).await,&seasonal); same_value(&account(&context,row_key(row,12)).await,&lifetime); same_value(&account(&context,row_key(row,8)).await,&after_project); same_value(&account(&context,row_key(row,13)).await,&after_ops); assert_eq!(after_boot-context.banks_client.get_balance(boot).await.unwrap(),5000);
        let after_retry_accounts = snapshot(&context,row).await;
        let purchase_result = json!({"class":class,"quantity":quantity,"saleLamports":quantity*price,"resourceLamports":quantity*resource_per,"rentLamports":rent,"season":season,"projectIssued":quantity,"seasonalIssued":quantity,"lifetimeIssued":quantity,"cacheBytes":abi_result_len,"resultHex":hex(&result),"nativeNonceBefore":u64at(&before_nonce.data,120),"nativeNonceAfter":u64at(&after_nonce.data,120),"mintSupplyBefore":u64at(&before_mint.data,36),"mintSupplyAfter":u64at(&mint.data,36),"destinationAmount":u64at(&destination.data,64),"bootLamportsBefore":before_boot,"bootLamportsAfter":after_boot,"bootNetDebitLamports":before_boot-after_boot,"opsVaultDeltaLamports":after_ops.lamports-before_ops.lamports,"localTransactionSignatureFeeLamports":5000,"sellerSameAsBuyer":true,"sellerSaleLegReturnsToBOOT":true});
        let case = json!({"schema":"BIO-BANK-PURCHASE-RESULT-CASE-1","fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"scope":"one actual purchase in exact six-instruction cold prefix, with actual before/after and distinct-lifetime exact-frame retry","programId":program.to_string(),"actor":boot.to_string(),"traceSequence":i,"elfSHA256":ELF_SHA,"traceSHA256":TRACE_SHA,"abiSHA256":ABI_SHA,"frameHex":hex(&frame),"frameSHA256":sha(&frame),"requestH4":hex(&h4),"instruction":row,"actorNonceAddress":row_key(row,1).to_string(),"econConfigAddress":row_key(row,2).to_string(),"baseConfigAddress":row_key(row,7).to_string(),"beforeAccounts":before_accounts,"afterAccounts":after_accounts,"afterRetryAccounts":after_retry_accounts,"purchaseResult":purchase_result,"execution":execution,"retry":retry,"retryNativeNonceUnchanged":true,"retryCachedResultUnchanged":true,"retryMintDestinationQuotaProjectOpsUnchanged":true,"retryOnlyLocalSignatureFeeLamports":5000});
        let filename = format!("purchase-result-bank-76b35cfb-class-{class}.json"); let case_sha = immutable_json(&dir.join(&filename),&case); purchases.push(json!({"class":class,"traceSequence":i,"file":filename,"sha256":case_sha,"purchaseResult":purchase_result,"executionCU":execution["computeUnits"],"retryCU":retry["computeUnits"]}));
        for tx in [&execution,&retry] { let cu=tx["computeUnits"].as_u64().unwrap(); max_cu=max_cu.max(cu);total_cu+=cu;max_bytes=max_bytes.max(tx["packetBytes"].as_u64().unwrap()); }
    }
    for tx in &prefix {let cu=tx["computeUnits"].as_u64().unwrap();max_cu=max_cu.max(cu);total_cu+=cu;max_bytes=max_bytes.max(tx["packetBytes"].as_u64().unwrap());}
    assert_eq!(purchases.len(),4); assert_eq!(signer.seq,10); let final_boot=context.banks_client.get_balance(boot).await.unwrap();
    let report = json!({"schema":"BIO-BANK-PURCHASE-RESULT-1","fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"scope":"exact cold INIT/CREATE/four-BUY prefix only, plus four exact-frame retries; no claim of replaying the remaining full chain","runtime":"Agave4.3.2 ProgramTest Bank","officialSdk":"@solana/kit8.0.0","wireProfile":"BIOP0R2 ExactFrame152","elfSHA256":ELF_SHA,"sourceTraceSHA256":TRACE_SHA,"abiSHA256":ABI_SHA,"abiBindingScope":"corrected BUY_MATERIAL resultBytes58 declaration matches unchanged exact76b native behavior; this ELF predates the ABI correction","sourceTraceInstructionCount":lines.last().unwrap()["instructions"],"replayedTraceSequences":[0,1,2,3,4,5],"actualSignedV1BankTransactions":10,"actualSignatureVerification":true,"immutableLoaderV3Genesis":true,"upgradeAuthority":null,"onlyBOOTFundedWithSOL":true,"bootGenesisLamports":50_000_000_000u64,"finalBootLamports":final_boot,"actualBootNetSpentLamports":50_000_000_000u64-final_boot,"deploymentProgramAndProgramDataGenesisRentIncludedInBootSpend":false,"protocolOrMaterialOrDebtAccountsInjected":0,"actualPurchases":4,"actualDistinctLifetimeExactFrameRetries":4,"allNativeResultCacheLengths":58,"allRetryResultsEqual":true,"noRetryReissuanceOrQuotaOrOpsDebit":true,"maxComputeUnits":max_cu,"totalComputeUnits":total_cu,"maxPacketBytes":max_bytes,"prefixExecutions":prefix,"cases":purchases,"recordedReadsScope":"actual local Bank snapshots for separate offline SDK finalized-read reconciliation; these are not live RPC responses","costScope":"local ProgramTest Bank only; native sale/resource/rent obligations are reported separately; seller and buyer are the same BOOT so sale transfers net to BOOT; signature fees are5000 per included transaction, zero priority fee; no public-network cost quote"});
    let report_file=dir.join("purchase-result-bank-76b35cfb.json");immutable_json(&report_file,&report);println!("BANK_PURCHASE_RESULT_PASS {}",report_file.display());
    drop(signer.input);assert!(signer.child.wait().unwrap().success());
}
