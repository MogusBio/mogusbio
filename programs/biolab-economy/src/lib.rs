//! BIOECON2 native acceptance adapter. This is not complete P0 production admission.
//! Reward accrual is limited to verified-root settlement; no arbitrary credit opcode exists.
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    hash::hashv,
    instruction::{get_stack_height, AccountMeta, Instruction, TRANSACTION_LEVEL_STACK_HEIGHT},
    program::{invoke, invoke_signed, set_return_data},
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::{
        instructions::{load_current_index_checked, load_instruction_at_checked},
        Sysvar,
    },
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

mod accounts;
#[cfg(feature="production-admission")]
mod admission;
mod codec;
mod component;
mod constants;
mod initialize;
mod launchpad;
mod manufacture_fee;
pub mod materials;
mod market;
mod nonce;
mod ops;
mod originality;
mod position;
#[path = "../../../releases/func2r2/constants.rs"]
mod release_constants;
mod root;
mod settlement;
mod synthesis;
mod token;
mod verification;
mod wire;
pub use release_constants::{
    RULE_HASH as APPROVED_RULE_HASH, VALIDATOR_HASH as APPROVED_VALIDATOR_HASH,
};

use accounts::*;
use codec::*;
pub use constants::{
    BOOTSTRAP, DEPLOYMENT_NONCE, GENESIS, N, OPS_MEMBERS, PROGRAM_ID, RELEASE_HASH, TOKEN_ID,
};
use constants::{
    CONFIG_LEN, HEADER, H_END, INSTRUCTIONS_ID, NONCE_LEN, SYSTEM_ID, SYSVAR_OWNER, TREASURY_LEN,
};
use initialize::initialize;
use manufacture_fee::burn;
use nonce::*;
use position::claim;
use token::*;
use wire::{business_key, frame, Frame};
pub use wire::{config_id, domain, pda, typed_hash};

pub fn process_instruction(
    program: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    require(*program == PROGRAM_ID, 8001)?;
    let f = frame(data)?;
    require(
        accounts.len() >= 4
            && f.actor == *accounts[0].key
            && accounts[0].is_signer
            && accounts[0].key.is_on_curve(),
        8002,
    )?;
    require(get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT, 8003)?;
    require(
        *accounts[3].key == INSTRUCTIONS_ID && *accounts[3].owner == SYSVAR_OWNER,
        8003,
    )?;
    let idx = load_current_index_checked(&accounts[3])?;
    let current = load_instruction_at_checked(idx as usize, &accounts[3])?;
    require(current.program_id == *program && current.data == data, 8003)?;
    valid_pda(&accounts[2], program, &[b"bio", b"econ-config"])?;
    if inspect_nonce(&accounts[1], &f.actor, &f)? {
        return Ok(());
    }
    require(accounts.len() >= 7, 8000)?;
    writable(&accounts[1])?;
    system_program(&accounts[4])?;
    token_program(&accounts[5])?;
    require(
        *accounts[6].key == solana_program::sysvar::clock::id(),
        8008,
    )?;
    require(Clock::get()?.unix_timestamp >= 0, 8000)?;
    for (i, a) in accounts.iter().enumerate() {
        require(!accounts[..i].iter().any(|b| b.key == a.key), 8004)?;
    }
    #[cfg(feature="production-admission")]
    let normalized={
        require(accounts.len()>=8,8050)?;
        let mut v=Vec::with_capacity(accounts.len());v.extend_from_slice(&accounts[..7]);
        if f.opcode==1{
            require(accounts.len()==14,8050)?;
            v.extend_from_slice(&accounts[8..12]);v.push(accounts[7].clone());v.extend_from_slice(&accounts[12..14]);
        }else{admission::base(&accounts[7])?;v.extend_from_slice(&accounts[8..]);}
        v
    };
    #[cfg(feature="production-admission")]
    let accounts=normalized.as_slice();
    let result = match f.opcode {
        1 => initialize(accounts, &f)?,
        2 => burn(accounts, &f)?,
        3 => claim(accounts, &f)?,
        4 => launchpad::create(accounts, &f)?,
        5 => launchpad::buy(accounts, &f)?,
        6 => ops::queue(accounts, &f)?,
        7 => ops::pay(accounts, &f)?,
        8 => component::make(accounts, &f)?,
        9 => verification::put(accounts, &f)?,
        10 => verification::seal(accounts, &f)?,
        11 => verification::begin(accounts, &f)?,
        12 => verification::step(accounts, &f)?,
        13 => synthesis::finalize(accounts, &f)?,
        20 => settlement::stake(accounts, &f)?,
        21 => originality::exit_with_k(accounts, &f)?,
        22 => settlement::sync(accounts, &f)?,
        23 => settlement::open_hour(accounts, &f)?,
        24 => settlement::scan_hour(accounts, &f)?,
        25 => settlement::materialize(accounts, &f)?,
        26 => settlement::transfer(accounts, &f)?,
        27 => settlement::close_final_hour(accounts, &f)?,
        28 => settlement::empty_skip(accounts, &f)?,
        29 => settlement::advance_frozen_hour(accounts, &f)?,
        30 => originality::blueprint_begin(accounts, &f)?,
        31 => originality::blueprint_step(accounts, &f)?,
        32 => originality::register_seed(accounts, &f)?,
        33 => originality::seal_opening(accounts, &f)?,
        34 => originality::commit(accounts, &f)?,
        35 => originality::finalize_round(accounts, &f)?,
        36 => originality::activate_winner(accounts, &f)?,
        37 => originality::history_begin(accounts, &f)?,
        38 => originality::prove_fault(accounts, &f)?,
        39 => originality::audit_next(accounts, &f)?,
        40 => originality::recover_task(accounts, &f)?,
        41 => market::list_material(accounts, &f)?,
        42 => market::fill_material(accounts, &f)?,
        43 => market::cancel_material(accounts, &f)?,
        44 => market::list_root(accounts, &f)?,
        45 => market::fill_root(accounts, &f)?,
        46 => market::cancel_root(accounts, &f)?,
        _ => return Err(err(8000)),
    };
    let rent_payer = if f.opcode == 8 {
        component::rent_payer(accounts, &f)?
    } else if f.opcode == 4 || f.opcode == 5 {
        launchpad::rent_payer(accounts, &f)?
    } else if f.opcode == 6 || f.opcode == 7 {
        ops::rent_payer(accounts, &f)?
    } else {
        &accounts[0]
    };
    finish_nonce(accounts, &f, &result, rent_payer)
}
