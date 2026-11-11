//! P0R2 production gate. Public manifest constants and actual immutable loader
//! accounts are independent: valid JSON never substitutes for chain ownership.
use super::*;
const LOADER:Pubkey=pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
pub(crate) fn base(account:&AccountInfo)->ProgramResult{
    require(constants::IS_LOCAL_PUBLIC_FIXTURE==cfg!(feature="local-public-fixture")&&constants::BASE_CONFIG_BODY[925]==if cfg!(feature="local-public-fixture"){0}else{1},8050)?;
    header(account,&PROGRAM_ID,1,2,1048,&config_id(),&[b"bio",b"config"])?;
    require(account.try_borrow_data()?[120..]==constants::BASE_CONFIG_BODY,8050)?;
    require(account.lamports()>=Rent::get()?.minimum_balance(1048).max(1),8050)
}
pub(crate) fn prepare_init(a:&[AccountInfo])->ProgramResult{
    require(a.len()==14,8050)?;let program=&a[12];let pd=&a[13];
    require(program.key==&PROGRAM_ID&&program.owner==&LOADER&&program.executable&&program.data_len()==36&&!program.is_writable,8051)?;
    let p=program.try_borrow_data()?;require(u32_at(&p,0)?==2&&p[4..36]==constants::PROGRAM_DATA_ADDRESS,8051)?;drop(p);
    require(pd.key.to_bytes()==constants::PROGRAM_DATA_ADDRESS&&pd.owner==&LOADER&&!pd.executable&&!pd.is_writable&&pd.data_len()>45,8051)?;
    valid_pda(pd,&LOADER,&[PROGRAM_ID.as_ref()])?;let d=pd.try_borrow_data()?;
    // ProgramData serializes Option::None to a single byte. The former
    // authority's bytes13..45 may remain allocated and are not an authority.
    require(u32_at(&d,0)?==3&&d[12]==0&&u64_at(&d,4)?<Clock::get()?.slot,8051)?;
    let now=Clock::get()?.unix_timestamp;require(now>=constants::INIT_NOT_BEFORE&&now<=constants::SEED_OPEN,8052)?;
    valid_pda(&a[11],&PROGRAM_ID,&[b"bio",b"config"])?;writable(&a[11])?;Ok(())
}
pub(crate) fn initialize_base<'a>(a:&[AccountInfo<'a>])->ProgramResult{
    allocate(&a[0],&a[11],&a[4],&PROGRAM_ID,1048,&[b"bio",b"config"])?;
    let bump=valid_pda(&a[11],&PROGRAM_ID,&[b"bio",b"config"])?;write_header(&a[11],1,2,&config_id(),bump)?;
    a[11].try_borrow_mut_data()?[120..].copy_from_slice(&constants::BASE_CONFIG_BODY);base(&a[11])
}
