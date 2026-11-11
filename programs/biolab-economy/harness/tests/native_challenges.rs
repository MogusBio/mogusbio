//! Real manufactured inputs, free legal challenge range, no supplied q.
mod support;use support::*;
#[path="support/mining.rs"]mod mining;
#[path="support/synthesis.rs"]mod synthesis;
#[test]
fn frozen_challenge_range_and_hard_role_gate_are_native(){
    let mut vm=runtime();vm.compute_budget.heap_size=262144;let mut a=stocked(&vm);let mut inputs=Vec::new();for p in 1..=4{let(next,id)=manufacture_next(&vm,a,p,if p==4{1}else{0});a=next;inputs.push(id);}
    let mut rows=Vec::new();for challenge in [500_000,750_000,1_000_000,1_500_000,1_750_000,2_000_000]{let p=synthesis::verify(&vm,a,1,&inputs,challenge);rows.push(format!("challenge={challenge} q={} C={} max_cu={}",p.expected[1],p.expected[2],p.max_cu));a=p.accounts;}
    let bytes=synthesis::payload(&a,1,&inputs);for invalid in [499_000,500_001,2_001_000]{let ix=synthesis::begin_ix(&a,&bytes,invalid);let r=vm.process_instruction(&ix,&a);assert_eq!(format!("{:?}",r.raw_result),"Err(Custom(6600))");assert_eq!(account(&r.resulting_accounts,synthesis::verification()),account(&a,synthesis::verification()));}
    // Legal syntax does not promise a physically valid integer flow. This graph
    // at1.499 has a non-integral branch: BEGIN accepts the challenge domain, and
    // the real transition rejects it without committing a partial STEP.
    let begin=vm.process_instruction(&synthesis::begin_ix(&a,&bytes,1_499_000),&a);assert_eq!(begin.raw_result,Ok(()));a=begin.resulting_accounts;let mut prior=begin.return_data;loop{let r=vm.process_instruction(&synthesis::step_ix(&a,&bytes,&prior),&a);if r.raw_result.is_err(){assert_eq!(format!("{:?}",r.raw_result),"Err(Custom(8001))");assert_eq!(account(&r.resulting_accounts,synthesis::verification()),account(&a,synthesis::verification()));assert_eq!(account(&r.resulting_accounts,nonce(&BOOT)),account(&a,nonce(&BOOT)));break;}a=r.resulting_accounts;prior=r.return_data;assert_ne!(prior[18],6);}rows.push("challenge=1499000 syntax=accepted physics=INTEGER8001 partial_state=rolled_back".into());
    let(next,s3)=manufacture_next(&vm,a,4,3);let mut a=next;inputs[3]=s3;let bytes=synthesis::payload(&a,3,&inputs);let(next,_)=put_artifact(&vm,a,702,&bytes);a=next;let r=vm.process_instruction(&synthesis::begin_ix(&a,&bytes,1_000_000),&a);assert_eq!(format!("{:?}",r.raw_result),"Err(Custom(6600))");let p=synthesis::verify(&vm,a,3,&inputs,2_000_000);assert_eq!(p.expected[1],"1000000");rows.push(format!("hard_target3 challenge=2000000 q={} max_cu={}",p.expected[1],p.max_cu));std::fs::write(synthesis::evidence_dir().join("native-challenge-result.txt"),rows.join("\n")+"\n").unwrap();
}
