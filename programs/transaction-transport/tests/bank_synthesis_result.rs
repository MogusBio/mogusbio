//! Replay actual cold Mollusk top-level calls as Kit8-signed v1 Bank transactions.
//! No material, accrued LAB, roots or certificate accounts are injected.
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_message::VersionedMessage;
use solana_transaction::versioned::VersionedTransaction;
use sha2::{Digest, Sha256};
use std::{fs, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Command, Stdio}, str::FromStr};
use serde_json::{json, Value};

fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap() }
fn decode_hex(s:&str)->Vec<u8>{assert!(s.len()%2==0);(0..s.len()).step_by(2).map(|i|u8::from_str_radix(&s[i..i+2],16).unwrap()).collect()}
fn at_pda(program:&Address,seed:&[u8])->Address{Address::find_program_address(&[b"bio",seed],program).0}
#[derive(Clone,Copy,PartialEq,Eq)]
enum TraceScope{FullLifecycle,Artifact,EmptySkip,LazySettlement}

// Evidence files are immutable. An explicit path can distinguish repeat runs;
// the default also separates ELF releases instead of replacing the7fa report.
fn write_report(dir:&std::path::Path,default_name:String,report:&Value){
    let path=std::env::var_os("BIOLAB_BANK_REPORT_FILE").map(PathBuf::from).unwrap_or_else(||dir.join(default_name));
    if let Some(parent)=path.parent(){fs::create_dir_all(parent).unwrap();}
    let bytes=serde_json::to_vec_pretty(report).unwrap();
    if path.exists(){assert_eq!(fs::read(&path).unwrap(),bytes,"refuse to overwrite distinct Bank evidence: {}",path.display());}
    else{let mut out=fs::OpenOptions::new().write(true).create_new(true).open(&path).unwrap();out.write_all(&bytes).unwrap();out.sync_all().unwrap();}
    println!("BANK_REPORT_FILE {}",path.display());
}
fn add_cost_fields(report:&mut Value,cost:&Value){report.as_object_mut().unwrap().extend(cost.as_object().unwrap().clone());}

/// Explicit opt-in: recaptures actual receipts missing from the first report.
#[tokio::test]
#[ignore = "requires unchanged genuine23653 cold trace and frozen76b ELF"]
async fn actual_cold_synthesis_results_execute_and_capture(){
    replay_trace(TraceScope::FullLifecycle).await;
}
async fn replay_trace(scope:TraceScope){
    let path=PathBuf::from(std::env::var_os("BIOLAB_TRACE_FILE").expect("actual cold trace"));
    let trace_bytes=fs::read(&path).unwrap();assert_eq!(format!("{:x}",Sha256::digest(&trace_bytes)),"0e095ba68569187525b39f2c65c95836878fb763532acf5f2aa2cbece2ebc1f0");
    let lines=String::from_utf8(trace_bytes.clone()).unwrap().lines().map(|s|serde_json::from_str::<Value>(s).unwrap()).collect::<Vec<_>>();
    let begin=&lines[0]; let complete=lines.last().unwrap();
    assert_eq!(begin["kind"],"begin"); assert_eq!(begin["schema"],1);assert_eq!(begin["cold"],true);assert_eq!(begin["fixtureOnly"],true);
    assert_eq!(complete["kind"],"complete");assert_eq!(complete["success"],true);
    let rows=&lines[1..lines.len()-1];assert_eq!(rows.len()as u64,complete["instructions"].as_u64().unwrap());
    assert!(!rows.is_empty());
    let actual_lazy_advances=rows.iter().filter(|row|{let d=decode_hex(row["dataHex"].as_str().unwrap());
        if d.starts_with(b"BIOECON2"){return d[8]==29;}
        d.starts_with(b"BIOIX\0\0\0")&&u16::from_le_bytes(d[10..12].try_into().unwrap())==1102
            &&u16::from_le_bytes(d[12..14].try_into().unwrap())==4
            &&u16::from_le_bytes(d[14..16].try_into().unwrap())==2}).count();
    if std::env::var("BIOLAB_REQUIRE_LAZY").as_deref()==Ok("1"){assert!(actual_lazy_advances>0,"requested ECON4 replay must actually execute ADVANCE_FROZEN_HOUR");}
    let program=Address::from_str(begin["program"].as_str().unwrap()).unwrap();
    let boot=Address::from_str(begin["boot"].as_str().unwrap()).unwrap();
    let production_wire=decode_hex(rows[0]["dataHex"].as_str().unwrap()).starts_with(b"BIOIX\0\0\0");
    if !production_wire{
        assert_eq!(program.to_bytes(),biolab_economy::PROGRAM_ID.to_bytes());
        assert_eq!(boot.to_bytes(),biolab_economy::BOOTSTRAP.to_bytes());
    }
    let elf=PathBuf::from(std::env::var_os("BIOLAB_CORE_ELF").expect("exact traced Core ELF"));
    let elf_bytes=fs::read(&elf).unwrap();let elf_sha=format!("{:x}",Sha256::digest(&elf_bytes));
    assert_eq!(begin["elfSHA256"],elf_sha,"trace and execution must use the same frozen ELF");assert_eq!(elf_sha,"76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e");
    let actual_abi=fs::read(root().join("programs/biolab-economy/operations.p0r2.json")).unwrap();assert_eq!(format!("{:x}",Sha256::digest(&actual_abi)),ABI_SHA);
    let snapshot=root().join(format!(".data/bank-lifecycle-{}",std::process::id()));fs::create_dir_all(&snapshot).unwrap();
    fs::write(snapshot.join("biolab_economy.so"),&elf_bytes).unwrap();std::env::set_var("SBF_OUT_DIR",&snapshot);
    let mut test=if production_wire{
        // Real Loader-v3 accounts from this exact ELF in local genesis. No
        // asset, material or reward state is inserted. The None authority is
        // required by actual Core INIT; ProgramTest's upgradeable helper uses
        // Some(default), so construct its canonical immutable metadata here.
        let mut test=ProgramTest::default();let loader=Address::from_str("BPFLoaderUpgradeab1e11111111111111111111111").unwrap();
        let program_data=Address::find_program_address(&[program.as_ref()],&loader).0;
        let mut p=2u32.to_le_bytes().to_vec();p.extend_from_slice(program_data.as_ref());
        let mut d=vec![0u8;45];d[..4].copy_from_slice(&3u32.to_le_bytes());d.extend_from_slice(&elf_bytes);
        test.add_genesis_account(program,Account{lamports:10_000_000,data:p,owner:loader,executable:true,rent_epoch:u64::MAX});
        test.add_genesis_account(program_data,Account{lamports:10_000_000_000,data:d,owner:loader,executable:false,rent_epoch:u64::MAX});
        test
    }else{ProgramTest::new("biolab_economy",program,None)};test.prefer_bpf(true);
    test.add_account(boot,Account{lamports:begin["bootGenesisLamports"].as_u64().unwrap(),data:vec![],owner:Address::default(),executable:false,rent_epoch:0});
    let context=test.start_with_context().await;
    let initial_boot_lamports=context.banks_client.get_balance(boot).await.unwrap();
    assert_eq!(initial_boot_lamports,begin["bootGenesisLamports"].as_u64().unwrap());
    let mut signer=Command::new("node").arg(root().join("scripts/sign-trace-fixture.mjs"))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
    let mut input=signer.stdin.take().unwrap();let mut output=BufReader::new(signer.stdout.take().unwrap());
    let mut max_bytes=0usize;let mut max_cu=0u64;let mut total_cu=0u64;let mut unix=0i64;let mut slot=0u64;let mut large=0u64;let mut total_signatures=0u64;
    let mut final_bio=None;let mut final_body=None;let mut finals=0u64;let mut parts=0u64;let mut produced=std::collections::BTreeSet::new();let mut initial_empty_token_data=None;
    let mut captures=Vec::<Value>::new();let mut selected=std::collections::BTreeSet::<String>::new();
    for (i,row) in rows.iter().enumerate(){
        assert_eq!(row["kind"],"instruction");assert_eq!(row["seq"].as_u64().unwrap(),i as u64);
        assert_eq!(row["expectedResult"],"Ok");
        let next_unix=row["clock"]["unixTimestamp"].as_i64().unwrap();let next_slot=row["clock"]["slot"].as_u64().unwrap();
        assert!(next_unix>=unix&&next_slot>=slot,"trace cannot roll back the canonical test clock");
        unix=next_unix;slot=next_slot;context.set_sysvar(&Clock{slot,epoch_start_timestamp:0,epoch:0,leader_schedule_epoch:0,unix_timestamp:unix});
        // ProgramTest's background tick thread advances the blockhash queue.
        // A long replay must refresh lifetime instead of reusing genesis hash.
        let recent=context.banks_client.get_latest_blockhash().await.unwrap();
        let valid_height=context.banks_client.get_root_block_height().await.unwrap()+150;
        let request=json!({"fixtureOnly":true,"seq":i,"feePayer":boot.to_string(),"blockhash":recent.to_string(),
            "lastValidBlockHeight":valid_height.to_string(),"maxCU":begin["maxCU"],"heap":begin["heap"],"productionWire":production_wire,"instructions":[row]});
        writeln!(input,"{}",request).unwrap();input.flush().unwrap();let mut response=String::new();assert!(output.read_line(&mut response).unwrap()>0,"local fixture signer exited");
        let signed:Value=serde_json::from_str(&response).unwrap();assert_eq!(signed["seq"].as_u64().unwrap(),i as u64);
        let bytes=decode_hex(signed["bytesHex"].as_str().unwrap());assert!(bytes.len()<=4096);if bytes.len()>1232{large+=1;}max_bytes=max_bytes.max(bytes.len());
        let tx:VersionedTransaction=wincode::deserialize(&bytes).unwrap();tx.verify_and_hash_message().unwrap();
        assert_eq!(tx.message.static_account_keys()[0],boot,"the measured BOOT pays every replay transaction");
        let VersionedMessage::V1(message)=&tx.message else{panic!("trace signer must emit real v1 transactions")};
        assert_eq!(message.config.priority_fee,Some(0),"local signature-fee comparison requires explicit zero priority fee");
        total_signatures=total_signatures.checked_add(tx.signatures.len()as u64).unwrap();
        let capture=select_capture(&context,&program,row,&selected).await;
        let before=if let Some(ref info)=capture{snapshot_keys(&context,&info.keys).await}else{Vec::new()};
        let before_stats=if let Some(ref info)=capture{if info.operation=="SYNTH_FINALIZE"{Some(final_before(&context,row,&info.body).await)}else{None}}else{None};
        let actual_signature=tx.signatures[0].to_string();let signature_count=tx.signatures.len();
        let processed=context.banks_client.process_transaction_with_metadata(tx).await.unwrap();
        let cu=processed.metadata.as_ref().map_or(0,|m|m.compute_units_consumed);max_cu=max_cu.max(cu);total_cu=total_cu.checked_add(cu).unwrap();
        assert_eq!(processed.result,Ok(()),"actual Bank failed trace instruction {i} program={} opcode={} CU{cu}",row["programId"],row["dataHex"].as_str().unwrap().get(16..18).unwrap_or("?"));
        if let Some(info)=capture{
            let returned=processed.metadata.as_ref().unwrap().return_data.as_ref().unwrap();assert_eq!(returned.program_id,program);
            assert_eq!(returned.data.len(),if info.operation=="SYNTH_FINALIZE"{156}else{80});
            let after=snapshot_keys(&context,&info.keys).await;
            let nonce=context.banks_client.get_account(Address::from_str(row["accounts"][1]["pubkey"].as_str().unwrap()).unwrap()).await.unwrap().unwrap();
            let frame=decode_hex(row["dataHex"].as_str().unwrap());let h4=biolab_economy::typed_hash(4,&[&frame]);
            assert_eq!(&nonce.data[128..160],&h4);assert_eq!(u16_at(&nonce.data,160)as usize,returned.data.len());assert_eq!(&nonce.data[162..162+returned.data.len()],&returned.data);
            assert_eq!(u64_at(&nonce.data,120),u64_at(&frame,112)+1);
            let actual_checks=if let Some(before_stats)=before_stats{final_after(&context,row,&returned.data,before_stats).await}else{json!({"exact80CacheMatchesReturn":true})};
            let value=json!({"schema":"BIO-BANK-SYNTHESIS-RESULT-CASE-1","fixtureOnly":true,"productionAdmission":false,"networkBroadcast":false,"cold":true,
                "scope":"actual signed Bank cold full lifecycle capture, no material, LAB, Root or verification state injection","operation":info.operation,"target":info.target,"stage":info.stage,"traceSequence":i,
                "programId":program.to_string(),"actor":row["accounts"][0]["pubkey"],"actorNonceAddress":row["accounts"][1]["pubkey"],"baseConfigAddress":row["accounts"][7]["pubkey"],"econConfigAddress":row["accounts"][2]["pubkey"],
                "elfSHA256":elf_sha,"abiSHA256":ABI_SHA,"traceSHA256":format!("{:x}",Sha256::digest(&trace_bytes)),"frameHex":row["dataHex"],"requestH4":to_hex(&h4),"artifactBodyHex":to_hex(&info.body),
                "instruction":row,"beforeAccounts":before,"afterAccounts":after,"actualChecks":actual_checks,
                "execution":{"bankTransactionSequence":i,"actualSignature":actual_signature,"signatureCount":signature_count,"verifiedEd25519":true,"version":1,"blockhash":recent.to_string(),"signedTransactionHex":to_hex(&bytes),"signedTransactionSHA256":format!("{:x}",Sha256::digest(&bytes)),"packetBytes":bytes.len(),"computeUnits":cu,"result":"Ok","bankResult":"Ok(())","returnDataBytes":returned.data.len(),"returnDataHex":to_hex(&returned.data),"successfulBusinessResult":true}});
            println!("BANK_SYNTH_CAPTURE {} target={} seq={} bytes={} cu={}",info.operation,info.target,i,returned.data.len(),cu);selected.insert(info.label);captures.push(value);
        }
        if scope==TraceScope::EmptySkip&&i==0{
            let mint=context.banks_client.get_account(at_pda(&program,b"lab-mint")).await.unwrap().unwrap();
            let reserve=context.banks_client.get_account(at_pda(&program,b"lab-reserve")).await.unwrap().unwrap();
            initial_empty_token_data=Some((mint.data,reserve.data));
        }
        let data=decode_hex(row["dataHex"].as_str().unwrap());
        let op=if data.starts_with(b"BIOECON2"){data[8]}else if data.starts_with(b"BIOIX\0\0\0"){
            match(u16::from_le_bytes(data[10..12].try_into().unwrap()),u16::from_le_bytes(data[12..14].try_into().unwrap())){(501,1)=>8,(701,1)=>13,_=>0}
        }else{0};
        if [8,13].contains(&op){
            let mut op_id=[0u8;32];op_id[..8].copy_from_slice(&data[112..120]);
            let business=biolab_economy::typed_hash(3,&[&data[16..48],&data[80..112],&op_id]);
            let instance=biolab_economy::typed_hash(6,&[&data[16..48],&business,&0u16.to_le_bytes()]);
            let key=Address::find_program_address(&[b"bio",b"root",&instance],&program).0;
            let account=context.banks_client.get_account(key).await.unwrap().expect("actual manufactured output");
            assert_eq!(account.owner,program);assert!(account.data.starts_with(b"BIOLAB\0\0"));assert_eq!(account.data[362],0);
            assert!(produced.insert(key),"a trace cannot count the same manufactured root twice");
            if op==8{parts+=1;}else{
                if account.data[280]==22{final_bio=Some(key);final_body=Some(account.data);}finals+=1;
            }
        }
        if (i+1)%1000==0{println!("BANK_TRACE_PROGRESS {}/{} max_bytes={} max_cu={}",i+1,rows.len(),max_bytes,max_cu);}
    }
    drop(input);assert!(signer.wait().unwrap().success());
    let final_boot_lamports=context.banks_client.get_balance(boot).await.unwrap();
    let actual_boot_net_spent=initial_boot_lamports.checked_sub(final_boot_lamports).expect("this fixture receives no external SOL funding");
    let actual_ops_vault_lamports=context.banks_client.get_account(at_pda(&program,b"ops")).await.unwrap().map_or(0,|account|account.lamports);
    // Agave4.3.2 ProgramTest initializes 5000lamports/native signature. The
    // separate bank_v1 test directly proves 5017=5000+17 absolute priority fee.
    // This expectation is not a public-network getFeeForMessage quotation.
    let expected_local_signature_fees=total_signatures.checked_mul(5000).unwrap();
    assert!(actual_boot_net_spent>=expected_local_signature_fees);
    let cost=json!({"initialBootLamports":initial_boot_lamports,"finalBootLamports":final_boot_lamports,
        "actualBootNetSpentLamports":actual_boot_net_spent,"actualOpsVaultLamports":actual_ops_vault_lamports,
        "actualTransactionSignatureCount":total_signatures,"localExpectedLamportsPerSignature":5000,
        "localExpectedSignatureFeeLamports":expected_local_signature_fees,"absolutePriorityFeeLamportsPerTransaction":0,
        "actualBootNetSpentExcludingExpectedSignatureFeesLamports":actual_boot_net_spent-expected_local_signature_fees,
        "solCostScope":"local ProgramTest Bank fixture only; BOOT net outflow includes account rent and Ops vault funding; material buyer and seller may be the same BOOT, so seller-price legs return/net to BOOT; this is not all transaction fees or a public-network cost quote",
        "deploymentProgramAndProgramDataGenesisRentIncludedInBootSpend":false});
    let dir=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("evidence");fs::create_dir_all(&dir).unwrap();
    if scope==TraceScope::LazySettlement{
        assert!(production_wire);assert_eq!(parts,2);assert_eq!(finals,0);assert_eq!(produced.len(),2);
        let operations=rows.iter().filter_map(|row|{let d=decode_hex(row["dataHex"].as_str().unwrap());if !d.starts_with(b"BIOIX\0\0\0"){return None;}Some((u16::from_le_bytes(d[10..12].try_into().unwrap()),u16::from_le_bytes(d[12..14].try_into().unwrap()),u16::from_le_bytes(d[14..16].try_into().unwrap())))}).collect::<Vec<_>>();
        assert_eq!(operations.iter().filter(|x|**x==(1102,4,2)).count(),3,"three actual ADVANCE operations must execute");
        let read=|d:&[u8],at:usize|u64::from_le_bytes(d[at..at+8].try_into().unwrap());
        let registry=context.banks_client.get_account(at_pda(&program,b"mining")).await.unwrap().unwrap();assert_eq!(read(&registry.data,128),10);assert_eq!(read(&registry.data,184),0);
        let treasury=context.banks_client.get_account(at_pda(&program,b"treasury")).await.unwrap().unwrap();assert_eq!(read(&treasury.data,128),0);assert_eq!(read(&treasury.data,136),0);assert_eq!(read(&treasury.data,168),14268);
        assert_eq!([120,128,136,144,168].iter().map(|i|read(&treasury.data,*i)).sum::<u64>(),100_000_000_000_000);
        let mint_key=at_pda(&program,b"lab-mint");let mint=context.banks_client.get_account(mint_key).await.unwrap().unwrap();assert_eq!(read(&mint.data,36),100_000_000_000_000);
        let token=Address::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap();let ata=Address::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap();let wallet=Address::find_program_address(&[boot.as_ref(),token.as_ref(),mint_key.as_ref()],&ata).0;let destination=context.banks_client.get_account(wallet).await.unwrap().unwrap();assert_eq!(read(&destination.data,64),14268);
        for key in &produced{let root=context.banks_client.get_account(*key).await.unwrap().unwrap();assert_eq!(root.data[362],0);let instance=&root.data[120..152];let position_key=Address::find_program_address(&[b"bio",b"reg",instance,&0u64.to_le_bytes()],&program).0;let p=context.banks_client.get_account(position_key).await.unwrap().unwrap();assert_eq!(read(&p.data,351),7134);assert_eq!(read(&p.data,359),7134);assert_eq!(read(&p.data,367),4);}
        let hour1=Address::find_program_address(&[b"bio",b"hour",&1u64.to_le_bytes()],&program).0;assert!(context.banks_client.get_account(hour1).await.unwrap().is_none());
        for h in[2u64,3]{let key=Address::find_program_address(&[b"bio",b"hour",&h.to_le_bytes()],&program).0;let hour=context.banks_client.get_account(key).await.unwrap().unwrap();assert_eq!(hour.data.len(),482);assert_eq!(u16::from_le_bytes(hour.data[12..14].try_into().unwrap()),4);assert_eq!(hour.data[481],1);assert_eq!(hour.data[160],4);}
        let mut report=json!({"fixtureOnly":true,"productionAdmission":false,"networkBroadcast":false,"cold":true,"scope":"ECON4 lazy-settlement module:2 real F1; does not claim complete BIO lifecycle","runtime":"Agave4.3.2 ProgramTest Bank","officialSdk":"@solana/kit8.0.0","wireProfile":"BIOP0R2 ExactFrame152","elfSHA256":elf_sha,"traceSHA256":format!("{:x}",Sha256::digest(&trace_bytes)),"transactions":rows.len(),"realV1Signatures":true,"messagesOver1232Bytes":large,"maxPacketBytes":max_bytes,"maxComputeUnits":max_cu,"totalComputeUnits":total_cu,"actualParts":2,"actualLazyAdvances":3,"hourSchema":4,"registryFreezeFrontier":10,"pendingAtoms":0,"certifiedUnpaidAtoms":0,"finalLABAtoms":14268,"manufacturingBurnAtoms":0,"oneMemberDelayedUntilAfterEndAndEmptySkip":true,"savedHourRentRefundedOnlyAfterComplete":true,"genesisOnlySOL":true});
        add_cost_fields(&mut report,&cost);write_report(&dir,format!("econ4-lazy-bank-{}.json",&elf_sha[..8]),&report);fs::remove_dir_all(snapshot).unwrap();println!("BANK_ECON4_LAZY_PASS {report}");return;
    }
    if scope!=TraceScope::FullLifecycle{
        assert!(production_wire);assert_eq!(finals,0);assert_eq!(parts,0);assert!(rows.len()>=3);
        let mint=context.banks_client.get_account(at_pda(&program,b"lab-mint")).await.unwrap().unwrap();
        assert_eq!(u64::from_le_bytes(mint.data[36..44].try_into().unwrap()),100_000_000_000_000);
        assert_eq!(&mint.data[..4],&[0;4]);assert_eq!(&mint.data[46..50],&[0;4]);
        let config=context.banks_client.get_account(at_pda(&program,b"config")).await.unwrap().unwrap();
        assert_eq!(config.data.len(),1048);assert_eq!(config.data[120+925],0,"test identity cannot be labelled production mode1");
        let operations=rows.iter().map(|row|{let d=decode_hex(row["dataHex"].as_str().unwrap());assert!(d.starts_with(b"BIOIX\0\0\0"));(u16::from_le_bytes(d[10..12].try_into().unwrap()),u16::from_le_bytes(d[12..14].try_into().unwrap()),u16::from_le_bytes(d[14..16].try_into().unwrap()))}).collect::<Vec<_>>();
        if scope==TraceScope::EmptySkip{
            const N:u64=100_000_000_000_000;const END:u64=46*35_040;
            assert_eq!(operations,[(1,1,2),(1101,1,2),(1102,3,2)],"EMPTY_SKIP scope must never be labelled Artifact smoke");
            let registry=context.banks_client.get_account(at_pda(&program,b"mining")).await.unwrap().unwrap();
            assert_eq!(registry.owner,program);assert_eq!(registry.data.len(),376);
            let read=|d:&[u8],at:usize|u64::from_le_bytes(d[at..at+8].try_into().unwrap());
            assert_eq!(read(&registry.data,128),END);assert_eq!(read(&registry.data,184),0);assert_eq!(read(&registry.data,160),0);assert_eq!(read(&registry.data,168),0);assert_eq!(&registry.data[360..376],&[0;16]);
            let treasury=context.banks_client.get_account(at_pda(&program,b"treasury")).await.unwrap().unwrap();
            let fields:Vec<_>=(0..8).map(|n|read(&treasury.data,120+n*8)).collect();assert_eq!(fields,[0,0,0,N,0,END,0,0]);
            let reserve=context.banks_client.get_account(at_pda(&program,b"lab-reserve")).await.unwrap().unwrap();let(initial_mint,initial_reserve)=initial_empty_token_data.unwrap();
            assert_eq!(mint.data,initial_mint,"empty recovery cannot mutate mint supply or authority");assert_eq!(reserve.data,initial_reserve,"empty recovery cannot transfer or mint reserve tokens");assert_eq!(read(&reserve.data,64),N);
            let mut report=json!({"fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"scope":"INIT plus SYNC plus EMPTY_SKIP terminal prefix only",
                "runtime":"Agave4.3.2 ProgramTest Bank","officialSdk":"@solana/kit8.0.0","wireProfile":"BIOP0R2 ExactFrame152",
                "elfSHA256":elf_sha,"traceSHA256":format!("{:x}",Sha256::digest(&trace_bytes)),"transactions":rows.len(),"realV1Signatures":true,
                "messagesOver1232Bytes":large,"maxPacketBytes":max_bytes,"maxComputeUnits":max_cu,"totalComputeUnits":total_cu,"heapBytes":begin["heap"],
                "registryNextHour":END,"genesisSealedAtoms":17,"newlySealedAtoms":N-17,"treasuryU":0,"treasuryPending":0,"treasuryV":N,
                "actualMintSupply":N,"actualReserveBalance":N,"mintDataUnchangedAfterInit":true,"reserveDataUnchangedAfterInit":true,"newAssetsOrRewards":0,"genesisOnlySOL":true});
            add_cost_fields(&mut report,&cost);write_report(&dir,format!("empty-skip-bank-{}.json",&elf_sha[..8]),&report);fs::remove_dir_all(snapshot).unwrap();println!("BANK_EMPTY_SKIP_PASS {report}");return;
        }
        assert_eq!(operations[0],(1,1,2));assert_eq!(operations.last(),Some(&(401,2,2)));assert!(operations[1..operations.len()-1].iter().all(|op|*op==(401,1,2)),"Artifact smoke cannot accept an unrelated operation sequence");
        let mut report=json!({"fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"scope":"INIT plus Artifact transport only",
            "runtime":"Agave4.3.2 ProgramTest Bank","officialSdk":"@solana/kit8.0.0","wireProfile":"BIOP0R2 ExactFrame152",
            "elfSHA256":elf_sha,"traceSHA256":format!("{:x}",Sha256::digest(&trace_bytes)),"transactions":rows.len(),"realV1Signatures":true,
            "messagesOver1232Bytes":large,"maxPacketBytes":max_bytes,"maxComputeUnits":max_cu,"totalComputeUnits":total_cu,
            "actualFixedSupply":100_000_000_000_000u64,"immutableLoaderMetadata":true,"baseConfigBytes":1048,"mode":0});
        add_cost_fields(&mut report,&cost);write_report(&dir,format!("production-admission-trace-bank-{}.json",&elf_sha[..8]),&report);fs::remove_dir_all(snapshot).unwrap();println!("BANK_PRODUCTION_SMOKE_PASS {report}");return;
    }
    let bio=final_bio.expect("actual final BIO output");let bio_data=final_body.unwrap();
    assert_eq!(parts,60);assert_eq!(finals,22);assert_eq!(produced.len(),82);
    assert_eq!(u64::from_le_bytes(bio_data[719..727].try_into().unwrap()),320);
    for key in &produced{let root=context.banks_client.get_account(*key).await.unwrap().unwrap();assert_eq!(root.data[362],u8::from(*key!=bio));}
    let mint=context.banks_client.get_account(at_pda(&program,b"lab-mint")).await.unwrap().unwrap();
    assert_eq!(u64::from_le_bytes(mint.data[36..44].try_into().unwrap()),100_000_000_000_000-48_000_000);
    assert_eq!(&mint.data[..4],&[0;4]);assert_eq!(&mint.data[46..50],&[0;4]);
    let token=Address::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap();
    let ata_program=Address::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap();
    let lab=at_pda(&program,b"lab-mint");let wallet=Address::find_program_address(&[boot.as_ref(),token.as_ref(),lab.as_ref()],&ata_program).0;
    let balance=context.banks_client.get_account(wallet).await.unwrap().unwrap();
    assert_eq!(u64::from_le_bytes(balance.data[64..72].try_into().unwrap()),1_024_940);
    let mut report=json!({"fixtureOnly":true,"networkBroadcast":false,"productionAdmission":false,"cold":true,"runtime":"Agave4.3.2 ProgramTest Bank",
        "officialSdk":"@solana/kit8.0.0","elfSHA256":elf_sha,"traceSHA256":format!("{:x}",Sha256::digest(&trace_bytes)),
        "wireProfile":if production_wire{"BIOP0R2 ExactFrame152"}else{"BIOECON2 acceptance-only"},"transactions":rows.len(),"realV1Signatures":true,"messagesOver1232Bytes":large,"maxPacketBytes":max_bytes,"maxComputeUnits":max_cu,
        "totalComputeUnits":total_cu,"actualFrozenHourAdvances":actual_lazy_advances,"genesisOnlySOL":true,"actualParts":60,"actualCells":15,"actualOrgans":6,"actualBIO":bio.to_string(),
        "consumedRoots":81,"actualManufacturingBurnAtoms":48_000_000,"finalLABAtoms":1_024_940,"clockSource":"positive-only actual trace test Clock"});
    assert_eq!(rows.len(),23653);let mut case_index=Vec::new();
    for target in [1u64,16,22]{assert!(captures.iter().any(|c|c["operation"]=="SYNTH_FINALIZE"&&c["target"]==target));}
    for case in captures{
        let operation=case["operation"].as_str().unwrap();let target=case["target"].as_u64().unwrap();
        let filename=if operation=="SYNTH_FINALIZE"{format!("synthesis-result-bank-{}-target-{target}.json",&elf_sha[..8])}else{format!("synthesis-{}-bank-{}-target-{target}-{}.json",if operation=="VERIFY_BEGIN"{"begin"}else{"step"},&elf_sha[..8],case["stage"].as_str().unwrap())};
        let path=dir.join(&filename);let bytes=serde_json::to_vec_pretty(&case).unwrap();if path.exists(){assert_eq!(fs::read(&path).unwrap(),bytes,"immutable synthesis case");}else{let mut f=fs::OpenOptions::new().write(true).create_new(true).open(&path).unwrap();f.write_all(&bytes).unwrap();f.sync_all().unwrap();}
        case_index.push(json!({"path":filename,"operation":operation,"target":target,"stage":case["stage"],"traceSequence":case["traceSequence"],"returnDataBytes":case["execution"]["returnDataBytes"],"sha256":format!("{:x}",Sha256::digest(&bytes))}));
    }
    report["schema"]=json!("BIO-BANK-SYNTHESIS-RESULTS-1");report["abiSHA256"]=json!(ABI_SHA);report["captureScope"]=json!("same original full23653 signed lifecycle plus exact80 BEGIN/STEP and156 FINAL cache/results and actual pre/post dependency closures");report["cases"]=json!(case_index);
    add_cost_fields(&mut report,&cost);write_report(&dir,format!("synthesis-results-bank-{}.json",&elf_sha[..8]),&report);
    fs::remove_dir_all(snapshot).unwrap();println!("BANK_FULL_LIFECYCLE_PASS {report}");
}

const ABI_SHA:&str="089d63ad876fe0701ab783b25ad9de3b6ea7cb0f2a48e085e451fe51a6d9024f";
const FAMILY:[u8;32]=[160,43,204,72,38,231,208,253,243,141,12,162,12,38,137,129,71,231,26,176,41,238,246,151,54,121,0,16,247,147,245,254];
fn to_hex(d:&[u8])->String{d.iter().map(|v|format!("{v:02x}")).collect()}
fn u16_at(d:&[u8],at:usize)->u16{u16::from_le_bytes(d[at..at+2].try_into().unwrap())}
fn u64_at(d:&[u8],at:usize)->u64{u64::from_le_bytes(d[at..at+8].try_into().unwrap())}
fn u32_at(d:&[u8],at:usize)->u32{u32::from_le_bytes(d[at..at+4].try_into().unwrap())}
fn base64(d:&[u8])->String{const CHARS:&[u8;64]=b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let mut out=String::new();for c in d.chunks(3){let n=(c[0]as u32)<<16|(c.get(1).copied().unwrap_or(0)as u32)<<8|c.get(2).copied().unwrap_or(0)as u32;out.push(CHARS[(n>>18)as usize]as char);out.push(CHARS[((n>>12)&63)as usize]as char);out.push(if c.len()>1{CHARS[((n>>6)&63)as usize]as char}else{'='});out.push(if c.len()>2{CHARS[(n&63)as usize]as char}else{'='});}out}
fn row_key(row:&Value,i:usize)->Address{Address::from_str(row["accounts"][i]["pubkey"].as_str().unwrap()).unwrap()}
// Native handlers receive the prefix with raw BaseConfig[7] removed.
fn normalized_key(row:&Value,i:usize)->Address{row_key(row,if i>=7{i+1}else{i})}
async fn get(c:&ProgramTestContext,key:Address)->Account{c.banks_client.get_account(key).await.unwrap().unwrap()}
struct Capture{operation:String,target:u8,stage:String,label:String,keys:Vec<Address>,body:Vec<u8>}
async fn select_capture(c:&ProgramTestContext,program:&Address,row:&Value,selected:&std::collections::BTreeSet<String>)->Option<Capture>{
    let data=decode_hex(row["dataHex"].as_str().unwrap());if !data.starts_with(b"BIOIX\0\0\0"){return None;}
    let module=u16_at(&data,10);let opcode=u16_at(&data,12);let operation=match(module,opcode){(701,1)=>"SYNTH_FINALIZE",(602,1)=>"VERIFY_BEGIN",(602,2)=>"VERIFY_STEP",_=>return None};
    let artifact=get(c,normalized_key(row,7)).await;assert!(artifact.data.len()>251);let body=artifact.data[251..].to_vec();assert_eq!(&body[..8],b"BIOP7D01");let target=body[10];
    if !(operation=="SYNTH_FINALIZE"&&[1,16,22].contains(&target)||operation!="SYNTH_FINALIZE"&&[1,22].contains(&target)){return None;}
    let stage=if operation=="SYNTH_FINALIZE"{"final"}else if operation=="VERIFY_BEGIN"{"begin"}else{let v=get(c,normalized_key(row,8)).await;if v.data[211]==5&&u16_at(&v.data,388)>=72{"physics-last"}else if v.data[211]==if target==1{1}else{0}{"first"}else{return None;}};
    let label=format!("{operation}-{target}-{stage}");if selected.contains(&label){return None;}
    let mut keys=row["accounts"].as_array().unwrap().iter().map(|v|Address::from_str(v["pubkey"].as_str().unwrap()).unwrap()).collect::<Vec<_>>();
    for seed in[b"config".as_slice(),b"econ-config",b"lab-mint",b"lab-reserve",b"treasury",b"mining"]{keys.push(at_pda(program,seed));}
    for seed in[b"task".as_slice(),b"k-slot"]{keys.push(Address::find_program_address(&[b"bio",seed,&FAMILY],program).0);}
    let token=Address::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap();let associated=Address::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap();let lab=at_pda(program,b"lab-mint");let actor=normalized_key(row,0);keys.push(Address::find_program_address(&[actor.as_ref(),token.as_ref(),lab.as_ref()],&associated).0);
    let graph_len=u32_at(&body,16)as usize;let direct_at=21+graph_len;let count=body[20+graph_len]as usize;assert!((2..=6).contains(&count));
    for i in 0..count{let id=&body[direct_at+i*74+2..direct_at+i*74+34];let key=Address::find_program_address(&[b"bio",b"root",id],program).0;keys.push(key);keys.push(Address::find_program_address(&[b"bio",b"root-reg",id],program).0);let root=get(c,key).await;if u16_at(&root.data,12)>1{keys.push(Address::find_program_address(&[b"bio",b"artifact",&root.data[443..475]],program).0);}}
    let task_key=Address::find_program_address(&[b"bio",b"task",&FAMILY],program).0;let task=get(c,task_key).await;keys.push(Address::find_program_address(&[b"bio",b"knowledge",&FAMILY,&u64_at(&task.data,164).to_le_bytes()],program).0);
    let econ=get(c,at_pda(program,b"econ-config")).await;let reward=i64::from_le_bytes(econ.data[384..392].try_into().unwrap());let now=row["clock"]["unixTimestamp"].as_i64().unwrap();if now>=reward{let n=((now-reward)/259200)as u64;keys.push(Address::find_program_address(&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()],program).0);}
    if operation=="SYNTH_FINALIZE"{let verify=get(c,normalized_key(row,8)).await;let id=biolab_economy::typed_hash(8,&[&data[16..48],&verify.data[332..364]]);keys.push(Address::find_program_address(&[b"bio",b"disclosure",&id],program).0);}
    keys.sort();keys.dedup();assert!(keys.len()<=64);Some(Capture{operation:operation.to_string(),target,stage:stage.to_string(),label,keys,body})
}
async fn snapshot_keys(c:&ProgramTestContext,keys:&[Address])->Vec<Value>{let mut out=Vec::new();for key in keys{match c.banks_client.get_account(*key).await.unwrap(){None=>out.push(json!({"address":key.to_string(),"missing":true})),Some(a)if a.executable=>{},Some(a)=>out.push(json!({"address":key.to_string(),"owner":a.owner.to_string(),"executable":a.executable,"lamports":a.lamports,"rentEpoch":a.rent_epoch,"data":[base64(&a.data),"base64"]}))}}out}
struct FinalBefore{mint:u64,wallet:u64,reserve:u64,burned:u64,children:Vec<Address>}
async fn final_before(c:&ProgramTestContext,row:&Value,body:&[u8])->FinalBefore{let count=body[20+u32_at(body,16)as usize]as usize;let mut children=Vec::new();for i in 0..count{let key=normalized_key(row,15+i);let r=get(c,key).await;assert_eq!(r.data[362],0);children.push(key);}FinalBefore{mint:u64_at(&get(c,normalized_key(row,10)).await.data,36),wallet:u64_at(&get(c,normalized_key(row,11)).await.data,64),reserve:u64_at(&get(c,normalized_key(row,13)).await.data,64),burned:u64_at(&get(c,normalized_key(row,12)).await.data,152),children}}
async fn final_after(c:&ProgramTestContext,row:&Value,result:&[u8],before:FinalBefore)->Value{let output=get(c,normalized_key(row,9)).await;assert_eq!(&output.data[120..152],&result[..32]);assert_eq!(output.data[362],0);assert_eq!(u32_at(&output.data,284),u32_at(result,32));assert_eq!(u64_at(&output.data,288),u64_at(result,36));assert_eq!(u64_at(&output.data,296),u64_at(result,44));let fee=u64_at(result,52);assert_eq!(u64_at(&get(c,normalized_key(row,10)).await.data,36),before.mint-fee);assert_eq!(u64_at(&get(c,normalized_key(row,11)).await.data,64),before.wallet-fee);assert_eq!(u64_at(&get(c,normalized_key(row,13)).await.data,64),before.reserve);assert_eq!(u64_at(&get(c,normalized_key(row,12)).await.data,152),before.burned+fee);let v=get(c,normalized_key(row,8)).await;assert_eq!(v.data[210],1);for key in &before.children{let r=get(c,*key).await;assert_eq!(r.data[362],1);assert_eq!(&r.data[363..395],&result[..32]);}json!({"exact156CacheMatchesReturn":true,"actualCreatedRoot":row["accounts"][10]["pubkey"],"actualFeeAtoms":fee,"actualMintAndWalletBurnMatch":true,"reserveUnchanged":true,"actualTreasuryBurnIncrementMatches":true,"actualChildrenConsumed":before.children.len(),"actualV4Used":true,"actualOutputQualityPpm":u32_at(result,32),"actualOutputB":u64_at(result,36),"actualOutputRetired":u64_at(result,44)})}
