//! Classic SPL Token state validation and real CPI dispatch.
use super::*;

#[derive(Clone, Copy)]
pub(crate) struct Token {
    pub(crate) owner: Pubkey,
    pub(crate) amount: u64,
}
pub(crate) fn token(
    account: &AccountInfo,
    mint: &Pubkey,
    owner: Option<&Pubkey>,
    reserve: bool,
) -> Result<Token, ProgramError> {
    require(
        account.owner == &TOKEN_ID && !account.executable && account.data_len() == 165,
        8012,
    )?;
    let d = account.try_borrow_data()?;
    require(
        key_at(&d, 0)? == *mint && d[108] == 1 && u32_at(&d, 109)? == 0,
        8012,
    )?;
    let authority = key_at(&d, 32)?;
    if let Some(expected) = owner {
        require(authority == *expected, 8013)?;
    }
    require(u32_at(&d, 72)? <= 1 && u32_at(&d, 129)? <= 1, 8012)?;
    if reserve {
        require(
            u32_at(&d, 72)? == 0 && u64_at(&d, 121)? == 0 && u32_at(&d, 129)? == 0,
            8012,
        )?;
    }
    Ok(Token {
        owner: authority,
        amount: u64_at(&d, 64)?,
    })
}
pub(crate) fn mint(account: &AccountInfo) -> Result<u64, ProgramError> {
    valid_pda(account, &PROGRAM_ID, &[b"bio", b"lab-mint"])?;
    require(
        account.owner == &TOKEN_ID && account.data_len() == 82 && !account.executable,
        8012,
    )?;
    let d = account.try_borrow_data()?;
    require(
        u32_at(&d, 0)? == 0 && d[44] == 6 && d[45] == 1 && u32_at(&d, 46)? == 0,
        8012,
    )?;
    Ok(u64_at(&d, 36)?)
}
pub(crate) fn token_cpi<'a>(
    program: &AccountInfo<'a>,
    metas: Vec<AccountMeta>,
    data: Vec<u8>,
    infos: &[AccountInfo<'a>],
    seeds: Option<&[&[u8]]>,
) -> ProgramResult {
    let ix = Instruction {
        program_id: TOKEN_ID,
        accounts: metas,
        data,
    };
    let mut accounts = infos.to_vec();
    accounts.push(program.clone());
    if let Some(seeds) = seeds {
        invoke_signed(&ix, &accounts, &[seeds])
    } else {
        invoke(&ix, &accounts)
    }
}
