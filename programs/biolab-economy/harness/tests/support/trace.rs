#![allow(dead_code)]
//! Actual Mollusk top-level invocation trace for independently signed Bank replay.
//! No account snapshots or synthetic outputs are replayed as transactions.
use crate::support::*;
use mollusk_svm::InvocationInspectCallback;
use solana_program_runtime::invoke_context::InvokeContext;
use solana_transaction_context::instruction_accounts::InstructionAccount;
use std::{cell::{Cell,RefCell},fs::File,io::{BufWriter,Write},rc::Rc};
fn hex(b:&[u8])->String{b.iter().map(|v|format!("{v:02x}")).collect()}
struct Shared{writer:RefCell<BufWriter<File>>,count:Cell<u64>}
struct Recorder(Rc<Shared>);
impl InvocationInspectCallback for Recorder{
    fn before_invocation(&self,mollusk:&Mollusk,program:&Pubkey,data:&[u8],accounts:&[InstructionAccount],context:&mut InvokeContext,_:bool){
        let sequence=self.0.count.get();self.0.count.set(sequence+1);let mut out=format!("{{\"kind\":\"instruction\",\"seq\":{sequence},\"clock\":{{\"unixTimestamp\":{},\"slot\":{}}},\"programId\":\"{program}\",\"dataHex\":\"{}\",\"expectedResult\":\"Ok\",\"accounts\":[",mollusk.sysvars.clock.unix_timestamp,mollusk.sysvars.clock.slot,hex(data));
        for(i,a)in accounts.iter().enumerate(){if i>0{out.push(',');}let key=context.transaction_context.get_key_of_account_at_index(a.index_in_transaction).unwrap();out.push_str(&format!("{{\"pubkey\":\"{key}\",\"isSigner\":{},\"isWritable\":{}}}",a.is_signer(),a.is_writable()));}out.push_str("]}\n");self.0.writer.borrow_mut().write_all(out.as_bytes()).unwrap();
    }
    fn after_invocation(&self,_:&Mollusk,_:&InvokeContext,_:bool){}
}
pub struct Trace(Rc<Shared>);
impl Trace{
    pub fn install(vm:&mut Mollusk,cold:bool)->Option<Self>{
        let path=std::env::var("BIOLAB_TRACE_FILE").ok()?;assert!(cold,"Bank replay trace must start at genesis, not a debug checkpoint");let mut writer=BufWriter::new(File::create(path).unwrap());let elf=std::fs::read(std::path::PathBuf::from(std::env::var("SBF_OUT_DIR").unwrap()).join("biolab_economy.so")).unwrap();let profile=if cfg!(feature="production-fixture"){"BIOP0R2-local-signing-fixture"}else{"BIOECON2-local-acceptance"};writeln!(writer,"{{\"kind\":\"begin\",\"schema\":1,\"source\":\"MolluskActualTopLevel\",\"fixtureOnly\":true,\"profile\":\"{profile}\",\"cold\":true,\"program\":\"{PROGRAM}\",\"boot\":\"{BOOT}\",\"bootGenesisLamports\":50000000000,\"elfSHA256\":\"{}\",\"validatorHash\":\"{}\",\"configId\":\"{}\",\"heap\":{},\"maxCU\":{}}}",hex(&Sha256::digest(&elf)),hex(&release_constants::VALIDATOR_HASH),hex(&config_id()),vm.compute_budget.heap_size,vm.compute_budget.compute_unit_limit).unwrap();let state=Rc::new(Shared{writer:RefCell::new(writer),count:Cell::new(0)});vm.invocation_inspect_callback=Box::new(Recorder(state.clone()));Some(Self(state))
    }
    pub fn finish(&self,summary:&str){let h=hex(&Sha256::digest(summary.as_bytes()));let mut w=self.0.writer.borrow_mut();writeln!(w,"{{\"kind\":\"complete\",\"success\":true,\"instructions\":{},\"summarySHA256\":\"{h}\"}}",self.0.count.get()).unwrap();w.flush().unwrap();}
}
