//! Small real-instruction smoke trace; not a full-chain completion claim.
mod support;use support::*;
#[path="support/trace.rs"]mod trace;
#[test]
fn actual_callback_records_only_top_level_instructions(){
    let mut vm=runtime();let mut a=fixture();account_mut(&mut a,BOOT).lamports=50_000_000_000;let trace=trace::Trace::install(&mut vm,true).expect("set BIOLAB_TRACE_FILE for this dedicated trace test");let r=vm.process_instruction(&init_ix(0),&a);assert_eq!(r.raw_result,Ok(()));a=r.resulting_accounts;let bytes=(0..2065).map(|i|(i%251)as u8).collect::<Vec<_>>();let(a,_)=put_artifact(&vm,a,501,&bytes);assert_eq!(read64(&account(&a,pda(b"lab-mint")).data,36),N);trace.finish("smoke-only: INIT + 3 PUT + SEAL; no material/LAB injection");
}
