//! Resource probe only. This program does not issue protocol admission or assets.

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    hash::hashv,
    log::sol_log_compute_units,
    program::set_return_data,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use sha2::{Digest, Sha256};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

const MAX_ACCOUNTS: usize = 7;
const MAX_DATA_LEN: usize = 214_100;
const MAX_ROUNDS: u16 = 73;
const MAX_EDGES: u16 = 440;
const NODES: usize = 15;

/// Wire: BIOPRB01 || mode:u8 || count:u8 || rounds:u16 || edges:u16 || zero:u16.
/// Modes: 0=syscall SHA; 1=SHA+read; 2=SHA+read+synthetic checked arithmetic;
/// 3=incremental software SHA, to expose transcript streaming costs.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() != 16
        || &instruction_data[..8] != b"BIOPRB01"
        || instruction_data[14..16] != [0, 0]
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mode = instruction_data[8];
    let count = usize::from(instruction_data[9]);
    let rounds = u16::from_le_bytes([instruction_data[10], instruction_data[11]]);
    let edges = u16::from_le_bytes([instruction_data[12], instruction_data[13]]);
    if mode > 3
        || count == 0
        || count > MAX_ACCOUNTS
        || count != accounts.len()
        || rounds > MAX_ROUNDS
        || edges > MAX_EDGES
        || (mode != 2 && (rounds != 0 || edges != 0))
        || (mode == 2 && (rounds == 0 || edges == 0))
    {
        return Err(ProgramError::InvalidInstructionData);
    }

    sol_log_compute_units();
    let mut digest = [0u8; 32];
    let mut total_bytes = 0u64;
    let mut stream_checksum = 0u64;
    for (index, account) in accounts.iter().enumerate() {
        // Fixture ownership is intentional; these are not genuine sealed Artifacts.
        if account.owner != program_id || account.is_writable || account.is_signer {
            return Err(ProgramError::InvalidAccountData);
        }
        if accounts[..index].iter().any(|other| other.key == account.key) {
            return Err(ProgramError::InvalidAccountData);
        }
        let data = account.try_borrow_data()?;
        if data.is_empty() || data.len() > MAX_DATA_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        let content_digest: [u8; 32] = if mode == 3 {
            // The SHA syscall has no incremental context. This deliberately
            // executes software SHA inside SBF instead of changing the hash.
            let mut hasher = Sha256::new();
            for chunk in data.chunks(1024) {
                hasher.update(chunk);
            }
            hasher.finalize().into()
        } else {
            hashv(&[&data]).to_bytes()
        };
        let index_bytes = (index as u32).to_le_bytes();
        let length_bytes = (data.len() as u32).to_le_bytes();
        digest = hashv(&[&digest, &index_bytes, &length_bytes, &content_digest]).to_bytes();
        total_bytes = total_bytes
            .checked_add(data.len() as u64)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }
    sol_log_compute_units();

    if mode == 1 || mode == 2 {
        for account in accounts {
            let data = account.try_borrow_data()?;
            // Include the last partial word. No heap-sized copies or truncation.
            for chunk in data.chunks(8) {
                let mut word = [0u8; 8];
                word[..chunk.len()].copy_from_slice(chunk);
                // Wrapping is deliberate in this non-economic probe checksum only.
                stream_checksum = stream_checksum
                    .rotate_left(7)
                    .wrapping_add(u64::from_le_bytes(word));
            }
        }
    }
    sol_log_compute_units();

    let arithmetic_checksum = if mode == 2 {
        arithmetic_probe(rounds, edges, &digest)?
    } else {
        0
    };
    sol_log_compute_units();

    let mut result = [0u8; 72];
    result[..8].copy_from_slice(b"BIOPRR01");
    result[8] = mode;
    result[9] = count as u8;
    result[10..12].copy_from_slice(&rounds.to_le_bytes());
    result[12..14].copy_from_slice(&edges.to_le_bytes());
    result[16..24].copy_from_slice(&total_bytes.to_le_bytes());
    result[24..32].copy_from_slice(&stream_checksum.to_le_bytes());
    result[32..40].copy_from_slice(&arithmetic_checksum.to_le_bytes());
    result[40..72].copy_from_slice(&digest);
    set_return_data(&result);
    Ok(())
}

/// Generic integer workload. It is deliberately not F1/FUNC or a quality model.
#[inline(never)]
fn arithmetic_probe(rounds: u16, edges: u16, seed: &[u8; 32]) -> Result<u64, ProgramError> {
    let mut stocks = [1_000_000u64; NODES];
    let mut checksum = 0u64;
    for round in 0..usize::from(rounds) {
        let mut incoming = [0u64; NODES];
        for edge in 0..usize::from(edges) {
            let source = edge % NODES;
            let destination = (edge + round + 1) % NODES;
            let ratio = (u64::from(seed[(edge + round) % 32] & 3) + 1) * 250_000;
            let product = stocks[source]
                .checked_mul(ratio)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            let quantity = product / 1_000_000;
            incoming[destination] = incoming[destination]
                .checked_add(quantity)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }
        for role in 0..NODES {
            let maintenance = (u64::from(seed[(role + round) % 32] & 1) + 1) * 250_000;
            let available = stocks[role]
                .checked_add(incoming[role])
                .ok_or(ProgramError::ArithmeticOverflow)?;
            let after = available
                .checked_sub(maintenance)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            let generated = maintenance
                .checked_mul(4)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            checksum = checksum
                .checked_add(after)
                .and_then(|v| v.checked_add(generated))
                .ok_or(ProgramError::ArithmeticOverflow)?;
            // Bound the next synthetic state. This is not a biological rule.
            stocks[role] = (after % 1_000_000) + 500_000;
        }
    }
    Ok(checksum)
}
