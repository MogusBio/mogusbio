//! Finite sealed PASS/link and approved pure-function FAIL replay proofs.
//! UNKNOWN, missing evidence and VM budget/allocator traps cannot pause a task.
use super::*;

fn safety_address(epoch:u64)->Pubkey{Pubkey::find_program_address(&[b"bio",b"task-safety",&FAMILY,&epoch.to_le_bytes()],&PROGRAM_ID).0}
fn safety_read(a:&AccountInfo)->Result<[u8;321],ProgramError>{
    require(a.owner==&PROGRAM_ID&&a.data_len()==441,6732)?;let d=a.try_borrow_data()?;let epoch=u64_at(&d,152)?;let key:[u8;32]=d[88..120].try_into().unwrap();drop(d);
    record(a,20,441,&key,&[b"bio",b"task-safety",&FAMILY,&epoch.to_le_bytes()])?;let mut b=[0;321];b.copy_from_slice(&a.try_borrow_data()?[120..]);
    require(b[..32]==FAMILY&&epoch>0&&b[80]<=2&&b[81]<=1&&b[114]<=1&&b[205]<=3&&b[230]<=1&&u64_at(&b,206)?<=u64_at(&b,214)?&&u64_at(&b,214)?<=u64_at(&b,222)?&&u64_at(&b,148)?>0&&i64_at(&b,164)?>=0,6732)?;
    let admission=ref33(&b,115)?;require((b[114]==1)==admission.is_some(),6732)?;ref33(&b,172)?;
    for at in [279,288]{require(b[at]<=1&&(b[at]!=0||u64_at(&b,at+1)?==0),6732)?;}
    if b[230]==0{require(zeros(&b[231..279]),6732)?;}if b[205]!=3{require(zeros(&b[288..313]),6732)?;}let origin=u64_at(&b,313)?;require(origin<=u64_at(&b,40)?||(b[279]==1&&origin==u64_at(&b,280)?),6732)?;Ok(b)
}
struct Replay{base_kind:u8,base_ref:[u8;32],artifact:[u8;32],sha:[u8;32],graph:[u8;32],semantic:[u8;32],admission:[u8;32],cost:u64,qualified:bool,base_bad:bool,link_bad:bool,failed:bool}
#[inline(never)]
fn analyze(a:&[AccountInfo],f:&Frame,k:&[u8;279],session_at:usize,artifact_at:usize,base_at:usize,correction:Option<&[u8;321]>)->Result<Box<Replay>,ProgramError>{
    let session=BlueprintSession::read_boxed(&a[session_at])?;require(session.historical&&session.kernel.actor==f.actor.to_bytes()&&(session.kernel.session.cursor==73||session.failure!=0)&&Clock::get()?.unix_timestamp>=session.kernel.clock&&Clock::get()?.slot>=u64_at(k,124)?,6735)?;session.bound(&a[artifact_at])?;
    let kind=session.base_kind;let base=session.base_ref;
    if let Some(proof)=correction{require(k[148]==2&&proof[279]==1&&u64_at(proof,280)?==u64_at(k,36)?&&proof[81]==kind&&proof[82..114]==base,6743)?;}
    else{require(k[148]==kind&&k[149..181]==base,6737)?;}
    let correct=if session.failure!=0{[0;32]}else{admission_id(&session.artifact,&if kind==0{session.artifact}else{base},kind,&session.kernel.session.graph_sha,&session.map_sha,session.kernel.session.target,session.kernel.session.challenge,session.kernel.quality,session.kernel.task,session.kernel.cost,&session.kernel.session.digest,&session.kernel.session.positive)};
    let claimed_bad=if kind==0{
        require(a[base_at].data_len()==321,6737)?;let design:[u8;32]=a[base_at].try_borrow_data()?[152..184].try_into().unwrap();let seed=seed_read(&a[base_at],&design)?;let(_,reward)=schedule(&a[2])?;
        require(base==seed_key(&design)&&seed[64..96]==session.artifact&&i64_at(&seed,193)?<reward&&(correction.is_some()||u64_at(&seed,136)?==u64_at(k,36)?),6737)?;
        seed[96..128]!=correct||u64_at(&seed,128)?!=session.kernel.cost||design!=session.semantic
    }else{
        let root=crate::root::read_root(&a[base_at])?;require(root.schema==4&&root.instance.to_bytes()==base,6737)?;let d=a[base_at].try_borrow_data()?;
        require(d[443..475]==session.artifact&&d[475..507]==session.sha&&u32_at(&d,507)?as usize==session.len&&u32_at(&d,607)?==session.kernel.session.challenge,6737)?;
        root.q!=session.kernel.quality||d[305]!=u8::from(session.kernel.task)||u64_at(&d,719)?!=session.kernel.cost||d[511..543]!=session.kernel.session.graph_sha||d[543..575]!=session.map_sha||d[623..655]!=session.kernel.session.digest||d[655..719]!=session.kernel.session.positive||d[727..759]!=session.semantic
    };
    let base_bad=if session.failure!=0{true}else if let Some(proof)=correction{require(proof[114]==1,6743)?;ref33(proof,115)?!=Some(correct)}else{claimed_bad};
    let qualified=session.failure==0&&session.kernel.session.target==22&&session.kernel.quality==2_000_000&&session.kernel.task&&session.kernel.cost>0;
    let link_bad=k[44..76]!=session.semantic||u64_at(k,140)?!=session.kernel.cost||k[181..213]!=session.artifact||k[213..245]!=correct;
    Ok(Box::new(Replay{base_kind:kind,base_ref:base,artifact:session.artifact,sha:session.sha,graph:session.kernel.session.graph_sha,semantic:session.semantic,admission:correct,cost:session.kernel.cost,qualified,base_bad,link_bad,failed:session.failure!=0}))
}
fn expected_account(a:&[AccountInfo],cursor:&mut usize,key:&Pubkey)->Result<usize,ProgramError>{if let Some(index)=a[..*cursor].iter().position(|x|x.key==key){return Ok(index);}require(*cursor<a.len()&&a[*cursor].key==key,6732)?;let index=*cursor;*cursor+=1;Ok(index)}
fn expected_record(a:&[AccountInfo],cursor:&mut usize,id:&[u8;32])->Result<usize,ProgramError>{
    for(i,x)in a[..*cursor].iter().enumerate(){if x.owner==&PROGRAM_ID&&x.data_len()>=120&&x.try_borrow_data()?[88..120]==*id{return Ok(i);}}
    require(*cursor<a.len()&&a[*cursor].data_len()>=120&&a[*cursor].try_borrow_data()?[88..120]==*id,6732)?;let index=*cursor;*cursor+=1;Ok(index)
}

/// A repaired row has a new immutable event, but restores an older knowledge
/// position only when its H7 identity and previously disclosed H8 are unchanged.
/// Otherwise its proof anchors the repair to the new knowledge index.
pub(super) fn effective_index(a:&[AccountInfo],cursor:&mut usize,k:&[u8;279],index:u64)->Result<u64,ProgramError>{
    if k[245]!=0||k[148]!=2{return Ok(index);}
    let key=key_at(k,149)?;let at=expected_account(a,cursor,&key)?;let proof=safety_read(&a[at])?;
    require(proof[114]==1&&proof[279]==1&&u64_at(&proof,280)?==index&&ref33(&proof,115)?==Some(k[213..245].try_into().unwrap()),6743)?;
    let origin=u64_at(&proof,313)?;require(origin<=index,6743)?;Ok(origin)
}

#[inline(never)]
pub(crate) fn prove_fault<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()>=16&&f.payload.len()==160,6730)?;let p=f.payload;require(p[..32]==FAMILY&&u32_at(p,32)?==1&&key_at(p,120)?==f.actor,6731)?;
    let now=Clock::get()?;let(_,reward)=schedule(&a[2])?;require(now.unix_timestamp>=reward,6704)?;let mut task=Task::read(&a[7])?;task.observe(now.unix_timestamp)?;require(task.epoch==u64_at(p,44)?,6733)?;
    let mut slot=slot_body(&a[8],task.generation)?;let index=u64_at(p,36)?;require(index<task.count,6714)?;let mut k=knowledge_read(&a[10],index)?;require(k[245]==0,6736)?;
    let session=BlueprintSession::read_boxed(&a[12])?;require(p[52..84]==session.artifact&&p[84..116]==session.sha&&u32_at(p,116)?as usize==session.len,6737)?;let qualified=session.failure==0&&session.kernel.session.target==22&&session.kernel.quality==2_000_000&&session.kernel.task&&session.kernel.cost>0;drop(session);
    let mut cursor=16+if qualified{2}else{0};require(a.len()>=cursor,6732)?;
    let previous_proof=if k[148]==2{let key=key_at(&k,149)?;let i=expected_account(a,&mut cursor,&key)?;Some(safety_read(&a[i])?)}else{None};
    let mut replay=analyze(a,f,&k,12,11,13,previous_proof.as_ref())?;
    let prior_origin=if let Some(proof)=&previous_proof{u64_at(proof,313)?}else{index};require(prior_origin<=index,6743)?;
    let mut origin=prior_origin;
    if replay.qualified{
        let did=disclosure_id(&replay.semantic);
        if fresh(&a[17]){require(replay.base_bad||k[44..76]!=replay.semantic||k[76..108]!=did,6737)?;replay.link_bad|=k[76..108]!=did;origin=task.count;}
        else{let d=disclosure_read(&a[17],&replay.semantic)?;require(u64_at(&d,128)?<=task.event&&u64_at(&d,136)?<=now.slot&&i64_at(&d,144)?<=now.unix_timestamp,6737)?;
            // Repairs never borrow an old index for a different identity or a
            // first disclosure that was not public before the old acceptance.
            if k[44..76]!=replay.semantic||u64_at(&d,128)?>=u64_at(&k,116)?{origin=task.count;}
            replay.link_bad|=k[76..108]!=did||u64_at(&k,108)?!=u64_at(&d,128)?;}
    }
    require(replay.base_bad||replay.link_bad||!replay.qualified,6734)?;
    let epoch=add(task.epoch,1)?;let address=safety_address(epoch);require(*a[14].key==address&&fresh(&a[14]),6733)?;
    let n=((now.unix_timestamp-reward)/ROUND_SECONDS)as u64;let mut round=round_load(&a[15],&task,n)?;let original_slot_ref=ref33(&slot,40)?;
    let mut rg=if fresh(&a[9]){[0;5]}else{crate::settlement::registry(&a[9])?};crate::settlement::observe(&mut rg,now.unix_timestamp)?;
    let event_count=if fresh(&a[9]){0}else{u64_at(&a[9].try_borrow_data()?,160)?};
    let stop_open=if let Some(id)=original_slot_ref{let key=Pubkey::find_program_address(&[b"bio",b"activation",&id],&PROGRAM_ID).0;let account=a.iter().find(|x|x.key==&key).ok_or(err(6732))?;read_activation(account)?.end.is_none()}else{false};
    let fault_root=replay.base_bad&&replay.base_kind==1&&k[148]!=2;let fault_map=if fault_root{
        let instance=Pubkey::new_from_array(replay.base_ref);let rkey=Pubkey::find_program_address(&[b"bio",b"root-reg",instance.as_ref()],&PROGRAM_ID).0;let registration=expected_account(a,&mut cursor,&rkey)?;
        let open=if fresh(&a[registration]){false}else{let rr=crate::settlement::root_reg(&a[registration],&instance)?;rr[80]==0};
        let(ordinary,end_event)=if open{let rr=crate::settlement::root_reg(&a[registration],&instance)?;let id:[u8;32]=rr[48..80].try_into().unwrap();let pi=expected_record(a,&mut cursor,&id)?;let seq=add(event_count,u64::from(stop_open))?;let ek=Pubkey::find_program_address(&[b"bio",b"mining-event",&seq.to_le_bytes()],&PROGRAM_ID).0;(Some(pi),Some(expected_account(a,&mut cursor,&ek)?))}else{(None,None)};
        Some(crate::settlement::FaultAccounts{registry:9,root:13,registration,ordinary,end_event})
    }else{None};
    let fault_event=task.touch()?;task.epoch=epoch;task.paused=true;task.generation=add(task.generation,1)?;
    let mut view=a.to_vec();let stop=if let Some(id)=original_slot_ref{
        let key=Pubkey::find_program_address(&[b"bio",b"activation",&id],&PROGRAM_ID).0;let act_i=expected_account(a,&mut cursor,&key)?;let old=read_activation(&a[act_i])?;let rkey=Pubkey::find_program_address(&[b"bio",b"root-reg",old.instance.as_ref()],&PROGRAM_ID).0;let rr_i=expected_account(a,&mut cursor,&rkey)?;let pos_i=expected_record(a,&mut cursor,&old.ordinary)?;let root_key=Pubkey::find_program_address(&[b"bio",b"root",old.instance.as_ref()],&PROGRAM_ID).0;let root_i=expected_account(a,&mut cursor,&root_key)?;
        let ei=if stop_open{let ek=Pubkey::find_program_address(&[b"bio",b"mining-event",&event_count.to_le_bytes()],&PROGRAM_ID).0;Some(expected_account(a,&mut cursor,&ek)?)}else{None};
        let tail=view.len();view.extend([a[act_i].clone(),a[rr_i].clone(),a[pos_i].clone(),a[root_i].clone()]);if let Some(i)=ei{view.push(a[i].clone());}
        let(mut value,rent)=prepare_stop(&view,tail,&a[9],&slot,&task,&now,true,6)?;
        if let Some(ref map)=fault_map{if map.registration==rr_i{let rev=u64_at(&value.registration,32)?.checked_sub(u64::from(value.event_at.is_some())).ok_or(err(6746))?;put64(&mut value.registration,32,rev);}}
        slot[73]=if fault_root&&old.instance.to_bytes()==replay.base_ref{4}else{2};Some((value,rent))
    }else{None};
    require(cursor==a.len(),6732)?;
    let fault=if let Some(map)=fault_map{Some(crate::settlement::prepare_fault(a,map,&address,fault_event,u64::from(stop_open))?)}else{None};
    // prepare_fault already owns the shared Registry creation in its rent plan.
    let mut rent=nonce_rent(&a[1])?;rent=add(rent,if let Some(fault)=&fault{fault.rent}else{crate::settlement::registry_rent(&a[9])?})?;if let Some((_,extra))=&stop{rent=add(rent,*extra)?;}
    rent=add(rent,record_rent(&a[14],&business_key(f),&[b"bio",b"task-safety",&FAMILY,&epoch.to_le_bytes()],441)?)?;rent=add(rent,record_rent(&a[15],&round_id(n),&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()],509)?)?;
    let mut corrected=None;let mut disclosure=None;
    if replay.qualified{
        let correct_index=task.count;let key=knowledge_key(correct_index);require(fresh(&a[16]),6743)?;rent=add(rent,record_rent(&a[16],&key,&[b"bio",b"knowledge",&FAMILY,&correct_index.to_le_bytes()],399)?)?;
        let id=disclosure_id(&replay.semantic);rent=add(rent,record_rent(&a[17],&id,&[b"bio",b"disclosure",&id],337)?)?;
        let d=if fresh(&a[17]){let event=task.touch()?;let b=disclosure_body(&replay.semantic,&replay.artifact,&replay.graph,&replay.sha,&f.actor,22,event,&now);disclosure=Some((id,b));b}else{disclosure_read(&a[17],&replay.semantic)?};
        let event=task.touch()?;let row=knowledge_body(correct_index,&replay.semantic,&id,u64_at(&d,128)?,event,&now,replay.cost,2,address.as_array(),&replay.artifact,&replay.admission);corrected=Some((correct_index,row));task.count=add(task.count,1)?;task.improve(replay.cost,replay.semantic,correct_index)?;put64(&mut round,93,task.count);
    }
    let mut proof=[0;321];put32(&mut proof,0,&FAMILY);put64(&mut proof,32,epoch);put64(&mut proof,40,index);proof[48..80].copy_from_slice(&k[213..245]);proof[80]=if replay.failed{2}else{u8::from(!replay.base_bad)};proof[81]=replay.base_kind;put32(&mut proof,82,&replay.base_ref);proof[114]=u8::from(!replay.failed);put_ref(&mut proof,115,if replay.failed{None}else{Some(replay.admission)});put64(&mut proof,148,fault_event);put64(&mut proof,156,now.slot);puti64(&mut proof,164,now.unix_timestamp);put_ref(&mut proof,172,original_slot_ref);put64(&mut proof,214,task.count);put64(&mut proof,222,task.count);if let Some((i,_))=&corrected{proof[279]=1;put64(&mut proof,280,*i);}
    put64(&mut proof,313,origin);
    check_budget(a,rent,u64_at(p,152)?)?;crate::settlement::ensure_registry(a,&a[9],now.unix_timestamp)?;
    if let Some((stop,_))=&stop{commit_stop(&view,&a[9],stop,f)?;}if let Some(fault)=&fault{crate::settlement::commit_fault(a,fault,f)?;}
    k[245]=1;put_ref(&mut k,246,Some(address.to_bytes()));store_body(&a[10],&k)?;if let Some((id,d))=&disclosure{create_record(&a[17],&a[0],&a[4],14,id,&[b"bio",b"disclosure",id],d)?;}
    if let Some((i,row))=&corrected{create_record(&a[16],&a[0],&a[4],33,&knowledge_key(*i),&[b"bio",b"knowledge",&FAMILY,&i.to_le_bytes()],row)?;}
    create_record(&a[14],&a[0],&a[4],20,&business_key(f),&[b"bio",b"task-safety",&FAMILY,&epoch.to_le_bytes()],&proof)?;put64(&mut slot,32,task.generation);slot_store(&a[8],a,&slot)?;round_store(&a[15],a,n,&round)?;task_store(&a[7],a,&task)?;
    let mut registry=crate::settlement::registry(&a[9])?;crate::settlement::observe(&mut registry,now.unix_timestamp)?;crate::settlement::write_registry(&a[9],registry)?;
    let mut result=address.to_bytes().to_vec();result.extend_from_slice(&epoch.to_le_bytes());result.extend_from_slice(&proof[279..288]);result.extend_from_slice(&fault_event.to_le_bytes());result.push(u8::from(!replay.failed));Ok(result)
}

pub(crate) fn audit_next<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()>=11&&f.payload.len()==92,6730)?;let p=f.payload;require(p[..32]==FAMILY&&u32_at(p,32)?==1&&key_at(p,52)?==f.actor,6731)?;
    let now=Clock::get()?;let mut task=Task::read(&a[7])?;task.observe(now.unix_timestamp)?;require(task.paused&&task.epoch==u64_at(p,36)?,6740)?;let slot=slot_body(&a[8],task.generation)?;let _=slot;
    let mut registry=crate::settlement::registry(&a[9])?;crate::settlement::observe(&mut registry,now.unix_timestamp)?;let mut proof=safety_read(&a[10])?;require(*a[10].key==safety_address(task.epoch)&&u64_at(&proof,32)?==task.epoch&&proof[205]!=3,6733)?;
    let mut cursor=u64_at(&proof,206)?;require(u64_at(p,44)?==cursor,6739)?;let target=u64_at(&proof,214)?;
    if cursor<target{
        require(a.len()>=12,6732)?;let k=knowledge_read(&a[11],cursor)?;
        if k[245]==1{let same=ref33(&k,246)?==Some(a[10].key.to_bytes());let at=if same{10}else{12};require(a.len()==if same{12}else{13},6732)?;let old=safety_read(&a[at])?;require(ref33(&k,246)?==Some(a[at].key.to_bytes())&&u64_at(&old,40)?==cursor,6732)?;}
        else{
            let same=k[148]==2&&k[149..181]==a[10].key.to_bytes();require(a.len()==if k[148]==2&&!same{17}else{16},6732)?;let correction=if k[148]==2{let at=if same{10}else{16};let old=safety_read(&a[at])?;require(k[149..181]==a[at].key.to_bytes(),6743)?;Some(old)}else{None};
            let replay=analyze(a,f,&k,12,13,14,correction.as_ref())?;require(!replay.base_bad&&!replay.link_bad&&replay.qualified,6738)?;
            let did=disclosure_id(&replay.semantic);let d=disclosure_read(&a[15],&replay.semantic)?;require(u64_at(&d,128)?<=task.event&&u64_at(&d,136)?<=now.slot&&i64_at(&d,144)?<=now.unix_timestamp,6737)?;require(k[76..108]==did&&u64_at(&k,108)?==u64_at(&d,128)?,6738)?;
            if proof[230]==0||replay.cost<u64_at(&proof,231)?{proof[230]=1;put64(&mut proof,231,replay.cost);put32(&mut proof,239,&replay.semantic);put64(&mut proof,271,cursor);}
        }
        cursor=add(cursor,1)?;put64(&mut proof,206,cursor);
    }else{require(a.len()==11,6732)?;}
    let mut target=target;if cursor==target&&task.count>target{target=task.count;put64(&mut proof,214,target);put64(&mut proof,222,target);}
    proof[205]=if cursor==target&&u64_at(&proof,222)?==task.count{2}else{1};check_budget(a,nonce_rent(&a[1])?,u64_at(p,84)?)?;
    store_body(&a[10],&proof)?;task_store(&a[7],a,&task)?;crate::settlement::write_registry(&a[9],registry)?;
    let mut result=task.epoch.to_le_bytes().to_vec();result.extend_from_slice(&cursor.to_le_bytes());result.extend_from_slice(&target.to_le_bytes());result.extend_from_slice(&proof[205..206]);result.extend_from_slice(&proof[230..271]);Ok(result)
}
pub(crate) fn recover_task<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==11&&f.payload.len()==92,6730)?;let p=f.payload;require(p[..32]==FAMILY&&u32_at(p,32)?==1&&key_at(p,52)?==f.actor,6731)?;
    let now=Clock::get()?;let mut task=Task::read(&a[7])?;task.observe(now.unix_timestamp)?;require(task.paused&&task.epoch==u64_at(p,36)?,6740)?;let mut slot=slot_body(&a[8],task.generation)?;let mut registry=crate::settlement::registry(&a[9])?;crate::settlement::observe(&mut registry,now.unix_timestamp)?;
    let mut proof=safety_read(&a[10])?;require(*a[10].key==safety_address(task.epoch)&&u64_at(&proof,32)?==task.epoch,6733)?;
    require(proof[205]==2&&u64_at(&proof,206)?==task.count&&u64_at(&proof,214)?==task.count&&u64_at(&proof,222)?==task.count&&u64_at(p,44)?==task.count,6742)?;
    task.best=if proof[230]==0{None}else{Some((u64_at(&proof,231)?,proof[239..271].try_into().unwrap(),u64_at(&proof,271)?))};task.paused=false;task.generation=add(task.generation,1)?;let event=task.touch()?;proof[205]=3;proof[288]=1;put64(&mut proof,289,event);put64(&mut proof,297,now.slot);puti64(&mut proof,305,now.unix_timestamp);put64(&mut slot,32,task.generation);
    check_budget(a,nonce_rent(&a[1])?,u64_at(p,84)?)?;store_body(&a[10],&proof)?;slot_store(&a[8],a,&slot)?;task_store(&a[7],a,&task)?;crate::settlement::write_registry(&a[9],registry)?;
    let(_,reward)=schedule(&a[2])?;let hour=if now.unix_timestamp<reward{0}else{((now.unix_timestamp-reward)/3600)as u64};let mut result=task.epoch.to_le_bytes().to_vec();result.extend_from_slice(&event.to_le_bytes());result.extend_from_slice(&hour.to_le_bytes());result.extend_from_slice(&task.best.map_or(0,|b|b.0).to_le_bytes());result.extend_from_slice(&task.best.map_or([0;32],|b|b.1));Ok(result)
}
