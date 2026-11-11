//! MARKET1 fixed-price exchange. Only actual inventory/Roots move; no mint,
//! reward, arbitrary owner setter, CPI entry exception or administrative custody.
use super::*;
const LIST_LEN: usize = 676;
const ATA: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
fn fresh(a: &AccountInfo) -> bool { a.owner == &SYSTEM_ID && a.data_is_empty() && !a.executable }
fn put64(b: &mut [u8], at: usize, value: u64) { b[at..at+8].copy_from_slice(&value.to_le_bytes()); }
fn list_id(f: &Frame) -> [u8;32] { typed_hash(26, &[&domain(), &business_key(f)]) }
fn address(id: &[u8;32]) -> (Pubkey,u8) { Pubkey::find_program_address(&[b"bio",b"market",id],&PROGRAM_ID) }
fn text(bytes: &[u8], title: bool) -> ProgramResult {
    require(((if title {1}else{0})..=(if title {48}else{160})).contains(&bytes.len()),6800)?;
    require(core::str::from_utf8(bytes).is_ok() && !bytes.iter().any(|x| *x<32 || *x==127),6800)
}
fn metadata(p: &[u8], fixed: usize, body: &mut [u8]) -> ProgramResult {
    require(p.len()>=fixed+2,6800)?;let a=p[fixed] as usize;let b=p[fixed+1] as usize;
    require(p.len()==fixed+2+a+b,6800)?;text(&p[fixed+2..fixed+2+a],true)?;text(&p[fixed+2+a..],false)?;
    body[344]=a as u8;body[345]=b as u8;body[348..348+a].copy_from_slice(&p[fixed+2..fixed+2+a]);body[396..396+b].copy_from_slice(&p[fixed+2+a..]);Ok(())
}
fn record(a:&AccountInfo,id:&[u8;32])->Result<Vec<u8>,ProgramError>{
    header(a,&PROGRAM_ID,39,1,LIST_LEN,id,&[b"bio",b"market",id])?;
    require(a.lamports()>=Rent::get()?.minimum_balance(LIST_LEN).max(1),6801)?;
    let b=a.try_borrow_data()?[HEADER..].to_vec();
    require(&b[..8]==b"BIOMKT01"&&b[8..40]==*id&&key_at(&b,40)?.is_on_curve()&&b[104]>=1&&b[104]<=2&&b[105]<=2&&zeros(&b[110..112])&&zeros(&b[346..348]),6801)?;
    require(u64_at(&b,208)?>0&&u64_at(&b,216)?>0&&i64_at(&b,248)?>=0,6801)?;
    let tl=b[344]as usize;let dl=b[345]as usize;require(tl<=48&&dl<=160,6801)?;text(&b[348..348+tl],true)?;text(&b[396..396+dl],false)?;
    require(zeros(&b[348+tl..396])&&zeros(&b[396+dl..556]),6801)?;
    if b[104]==1 {
        require(b[106]==1&&(1..=4).contains(&b[107])&&b[108]==0&&b[109]==0&&zeros(&b[176..208])&&zeros(&b[224..240])&&u64_at(&b,208)?<=1_000_000,6801)?;
    }else{
        require(b[107]==0&&zeros(&b[112..176])&&u64_at(&b,208)?==1&&(1..=4).contains(&b[108])&&b[106]==if b[108]==4{3}else{2}&&match b[108]{1=>b[109]==0,2=>(1..=15).contains(&b[109]),3=>(16..=21).contains(&b[109]),4=>b[109]==22,_=>false},6801)?;
        require(u64_at(&b,232)?==add(u64_at(&b,224)?,if b[105]==0{1}else{2})?,6801)?;
    }
    if b[105]==0 {require(u64_at(&b,240)?==0&&zeros(&b[264..344]),6801)?;}else{
        require(u64_at(&b,240)?==1&&i64_at(&b,264)?>=i64_at(&b,248)?&&u64_at(&b,272)?>=u64_at(&b,256)?&&!zeros(&b[312..344]),6801)?;
        require(if b[105]==1{key_at(&b,280)?.is_on_curve()&&key_at(&b,280)?!=key_at(&b,40)?}else{zeros(&b[280..312])},6801)?;
    }Ok(b)
}
fn write(a:&AccountInfo,b:&[u8])->ProgramResult{writable(a)?;require(b.len()==556,6801)?;a.try_borrow_mut_data()?[HEADER..].copy_from_slice(b);Ok(())}
fn create<'a>(a:&[AccountInfo<'a>],f:&Frame,b:&[u8])->ProgramResult{
    let id=list_id(f);allocate(&a[0],&a[7],&a[4],&PROGRAM_ID,LIST_LEN,&[b"bio",b"market",&id])?;
    let bump=valid_pda(&a[7],&PROGRAM_ID,&[b"bio",b"market",&id])?;write_header(&a[7],39,1,&id,bump)?;write(&a[7],b)
}
fn initial(f:&Frame,kind:u8,price:u64)->Result<Vec<u8>,ProgramError>{
    require(price>0,6800)?;let now=Clock::get()?;let mut b=vec![0;556];b[..8].copy_from_slice(b"BIOMKT01");b[8..40].copy_from_slice(&list_id(f));b[40..72].copy_from_slice(f.actor.as_ref());b[72..104].copy_from_slice(&business_key(f));b[104]=kind;put64(&mut b,216,price);b[248..256].copy_from_slice(&now.unix_timestamp.to_le_bytes());put64(&mut b,256,now.slot);Ok(b)
}
fn result(b:&[u8],recipient:&Pubkey)->Result<Vec<u8>,ProgramError>{let mut out=b"BIOMKR01".to_vec();out.extend_from_slice(&b[8..40]);out.extend_from_slice(&[b[104],b[105],b[106],0]);for at in [240,232,208,216]{out.extend_from_slice(&u64_at(b,at)?.to_le_bytes());}out.extend_from_slice(recipient.as_ref());require(out.len()==108,6801)?;Ok(out)}
fn quote(a:&[AccountInfo],f:&Frame,kind:u8,buy:bool)->Result<Vec<u8>,ProgramError>{
    config(&a[2])?;require(f.payload.len()==56,6800)?;let id:[u8;32]=f.payload[..32].try_into().map_err(|_|err(6800))?;let b=record(&a[7],&id)?;
    require(b[104]==kind&&b[105]==0&&u64_at(&b,240)?==u64_at(f.payload,32)?&&u64_at(&b,216)?==u64_at(f.payload,40)?,6802)?;
    require(if buy{key_at(&b,40)?!=f.actor}else{key_at(&b,40)?==f.actor},6803)?;let now=Clock::get()?;require(now.unix_timestamp>=i64_at(&b,248)?&&now.slot>=u64_at(&b,256)?,6804)?;Ok(b)
}
fn close(a:&AccountInfo,b:&mut[u8],f:&Frame,buy:bool)->ProgramResult{let now=Clock::get()?;b[105]=if buy{1}else{2};put64(b,240,1);b[264..272].copy_from_slice(&now.unix_timestamp.to_le_bytes());put64(b,272,now.slot);if buy{b[280..312].copy_from_slice(f.actor.as_ref());}b[312..344].copy_from_slice(&business_key(f));write(a,b)}
fn gross(a:&[AccountInfo],rent:u64,payment:u64,cap:u64)->ProgramResult{check_budget(a,rent,cap)?;require(a[0].lamports()>=add(add(rent,payment)?,Rent::get()?.minimum_balance(0).max(1))?,6805)}
fn canonical_ata(a:&AccountInfo,mint:&Pubkey,owner:&Pubkey)->ProgramResult{require(*a.key==Pubkey::find_program_address(&[owner.as_ref(),TOKEN_ID.as_ref(),mint.as_ref()],&ATA).0,6806)}
fn material(project:&AccountInfo,mint:&AccountInfo,b:&[u8])->ProgramResult{let id:[u8;32]=b[112..144].try_into().map_err(|_|err(6801))?;let class=b[107];let p=launchpad::project(project,&id)?;launchpad::pack_mint(mint,&id,class)?;let _=p;require(mint.key.as_ref()==&b[144..176],6807)}
fn escrow(a:&AccountInfo,listing:&AccountInfo,mint:&Pubkey,id:&[u8;32],quantity:u64)->ProgramResult{valid_pda(a,&PROGRAM_ID,&[b"bio",b"market-token",id])?;require(a.lamports()>=Rent::get()?.minimum_balance(165).max(1)&&token(a,mint,Some(listing.key),true)?.amount>=quantity,6808)}
fn transfer_tokens<'a>(a:&[AccountInfo<'a>],source:&AccountInfo<'a>,mint:&AccountInfo<'a>,dest:&AccountInfo<'a>,authority:&AccountInfo<'a>,quantity:u64,signed:Option<&[&[u8]]>)->ProgramResult{
    writable(source)?;writable(dest)?;let mut data=vec![12];data.extend_from_slice(&quantity.to_le_bytes());data.push(0);token_cpi(&a[5],vec![AccountMeta::new(*source.key,false),AccountMeta::new_readonly(*mint.key,false),AccountMeta::new(*dest.key,false),AccountMeta::new_readonly(*authority.key,true)],data,&[source.clone(),mint.clone(),dest.clone(),authority.clone()],signed)
}
fn destination_rent(dest:&AccountInfo,mint:&Pubkey,owner:&Pubkey)->Result<u64,ProgramError>{canonical_ata(dest,mint,owner)?;if fresh(dest){need_rent(dest,165)}else{require(dest.lamports()>=Rent::get()?.minimum_balance(165).max(1),6806)?;token(dest,mint,Some(owner),false)?;Ok(0)}}
fn create_destination<'a>(a:&[AccountInfo<'a>],dest:&AccountInfo<'a>,mint:&AccountInfo<'a>,owner:&AccountInfo<'a>,ata:&AccountInfo<'a>)->ProgramResult{
    require(*ata.key==ATA&&ata.executable,8008)?;if fresh(dest){invoke(&Instruction{program_id:ATA,accounts:vec![AccountMeta::new(*a[0].key,true),AccountMeta::new(*dest.key,false),AccountMeta::new_readonly(*owner.key,false),AccountMeta::new_readonly(*mint.key,false),AccountMeta::new_readonly(SYSTEM_ID,false),AccountMeta::new_readonly(TOKEN_ID,false)],data:vec![1]},&[a[0].clone(),dest.clone(),owner.clone(),mint.clone(),a[4].clone(),a[5].clone(),ata.clone()])?;}token(dest,mint.key,Some(owner.key),false)?;Ok(())
}
fn pay<'a>(a:&[AccountInfo<'a>],seller:&AccountInfo<'a>,b:&[u8])->ProgramResult{require(seller.key.as_ref()==&b[40..72],6803)?;launchpad::ordinary_wallet(seller,false)?;writable(seller)?;require(seller.key.is_on_curve(),6803)?;{let mut data=2u32.to_le_bytes().to_vec();data.extend_from_slice(&u64_at(b,216)?.to_le_bytes());invoke(&Instruction{program_id:SYSTEM_ID,accounts:vec![AccountMeta::new(*a[0].key,true),AccountMeta::new(*seller.key,false)],data},&[a[0].clone(),seller.clone(),a[4].clone()])} }

pub(crate) fn list_material(a:&[AccountInfo],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==12&&f.payload.len()>=60,6800)?;config(&a[2])?;let p=f.payload;let class=p[32];let quantity=u64_at(p,33)?;require((1..=4).contains(&class)&&(1..=1_000_000).contains(&quantity),6800)?;
    let mut b=initial(f,1,u64_at(p,41)?)?;b[106]=1;b[107]=class;b[112..144].copy_from_slice(&p[..32]);b[144..176].copy_from_slice(a[9].key.as_ref());put64(&mut b,208,quantity);metadata(p,57,&mut b)?;material(&a[8],&a[9],&b)?;canonical_ata(&a[10],a[9].key,&f.actor)?;require(token(&a[10],a[9].key,Some(&f.actor),false)?.amount>=quantity,6808)?;
    let id=list_id(f);valid_pda(&a[7],&PROGRAM_ID,&[b"bio",b"market",&id])?;valid_pda(&a[11],&PROGRAM_ID,&[b"bio",b"market-token",&id])?;let rent=add(add(nonce_rent(&a[1])?,need_rent(&a[7],LIST_LEN)?)?,need_rent(&a[11],165)?)?;gross(a,rent,0,u64_at(p,49)?)?;
    create(a,f,&b)?;allocate(&a[0],&a[11],&a[4],&TOKEN_ID,165,&[b"bio",b"market-token",&id])?;let mut data=vec![18];data.extend_from_slice(a[7].key.as_ref());token_cpi(&a[5],vec![AccountMeta::new(*a[11].key,false),AccountMeta::new_readonly(*a[9].key,false)],data,&[a[11].clone(),a[9].clone()],None)?;
    transfer_tokens(a,&a[10],&a[9],&a[11],&a[0],quantity,None)?;escrow(&a[11],&a[7],a[9].key,&id,quantity)?;result(&b,a[7].key)
}
pub(crate) fn fill_material(a:&[AccountInfo],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==14,6800)?;let mut b=quote(a,f,1,true)?;material(&a[8],&a[9],&b)?;let id:[u8;32]=b[8..40].try_into().map_err(|_|err(6801))?;let qty=u64_at(&b,208)?;escrow(&a[10],&a[7],a[9].key,&id,qty)?;let rent=add(nonce_rent(&a[1])?,destination_rent(&a[11],a[9].key,&f.actor)?)?;gross(a,rent,u64_at(&b,216)?,u64_at(f.payload,48)?)?;
    pay(a,&a[12],&b)?;create_destination(a,&a[11],&a[9],&a[0],&a[13])?;let bump=[address(&id).1];transfer_tokens(a,&a[10],&a[9],&a[11],&a[7],qty,Some(&[b"bio",b"market",&id,&bump]))?;close(&a[7],&mut b,f,true)?;result(&b,&f.actor)
}
pub(crate) fn cancel_material(a:&[AccountInfo],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==13,6800)?;let mut b=quote(a,f,1,false)?;material(&a[8],&a[9],&b)?;let id:[u8;32]=b[8..40].try_into().map_err(|_|err(6801))?;let qty=u64_at(&b,208)?;escrow(&a[10],&a[7],a[9].key,&id,qty)?;let rent=add(nonce_rent(&a[1])?,destination_rent(&a[11],a[9].key,&f.actor)?)?;gross(a,rent,0,u64_at(f.payload,48)?)?;
    create_destination(a,&a[11],&a[9],&a[0],&a[12])?;let bump=[address(&id).1];transfer_tokens(a,&a[10],&a[9],&a[11],&a[7],qty,Some(&[b"bio",b"market",&id,&bump]))?;close(&a[7],&mut b,f,false)?;result(&b,&f.actor)
}
fn root_owner(a:&AccountInfo,root:&root::RootFacts,owner:&Pubkey)->Result<u64,ProgramError>{writable(a)?;let next=add(root.revision,1)?;{let mut d=a.try_borrow_mut_data()?;d[HEADER+202..HEADER+234].copy_from_slice(owner.as_ref());put64(&mut d[HEADER..],234,next);}let actual=root::read_root(a)?;require(actual.owner==*owner&&actual.revision==next&&actual.fingerprint==root.fingerprint,6810)?;Ok(next)}
fn held_root(a:&AccountInfo,listing:&AccountInfo,b:&[u8])->Result<root::RootFacts,ProgramError>{let r=root::read_root(a)?;require(r.instance.as_ref()==&b[176..208]&&r.owner==*listing.key&&r.revision==u64_at(b,232)?&&r.lifecycle==0&&r.schema==b[108]as u16&&(if r.schema==1{0}else{r.descriptor[0]})==b[109],6810)?;Ok(r)}
pub(crate) fn list_root(a:&[AccountInfo],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==11&&f.payload.len()>=67,6800)?;config(&a[2])?;let p=f.payload;let r=root::read_root(&a[9])?;require(r.instance.as_ref()==&p[..32]&&r.owner==f.actor&&r.revision==u64_at(p,32)?&&r.lifecycle==0,6809)?;let now=Clock::get()?;require(now.unix_timestamp>=r.created_at&&now.slot>=r.created_slot,6804)?;
    let mut b=initial(f,2,u64_at(p,48)?)?;b[106]=if r.schema==4{3}else{2};b[108]=r.schema as u8;b[109]=if r.schema==1{0}else{r.descriptor[0]};b[176..208].copy_from_slice(r.instance.as_ref());put64(&mut b,208,1);put64(&mut b,224,r.revision);put64(&mut b,232,add(r.revision,1)?);metadata(p,64,&mut b)?;
    let id=list_id(f);valid_pda(&a[7],&PROGRAM_ID,&[b"bio",b"market",&id])?;let rent=add(add(add(nonce_rent(&a[1])?,need_rent(&a[7],LIST_LEN)?)?,settlement::registry_rent(&a[8])?)?,settlement::movement_rent(&a[10],&r.instance)?)?;gross(a,rent,0,u64_at(p,56)?)?;
    settlement::market_revoke(a,&a[8],&a[10],&r.instance,u64_at(p,40)?,f)?;create(a,f,&b)?;root_owner(&a[9],&r,a[7].key)?;result(&b,a[7].key)
}
pub(crate) fn fill_root(a:&[AccountInfo],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==11,6800)?;let mut b=quote(a,f,2,true)?;let r=held_root(&a[8],&a[7],&b)?;settlement::assert_movable(&a[9],&r.instance,&a[2],Clock::get()?.unix_timestamp)?;gross(a,nonce_rent(&a[1])?,u64_at(&b,216)?,u64_at(f.payload,48)?)?;pay(a,&a[10],&b)?;let revision=root_owner(&a[8],&r,&f.actor)?;put64(&mut b,232,revision);close(&a[7],&mut b,f,true)?;result(&b,&f.actor)
}
pub(crate) fn cancel_root(a:&[AccountInfo],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==9,6800)?;let mut b=quote(a,f,2,false)?;let r=held_root(&a[8],&a[7],&b)?;gross(a,nonce_rent(&a[1])?,0,u64_at(f.payload,48)?)?;let revision=root_owner(&a[8],&r,&f.actor)?;put64(&mut b,232,revision);close(&a[7],&mut b,f,false)?;result(&b,&f.actor)
}
