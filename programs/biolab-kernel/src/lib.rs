//! Deterministic biological model execution. No protocol admission or asset API.
pub mod graph;
pub mod runtime;
pub mod scratch;

use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, hash::hashv, log::sol_log_compute_units,
    program::set_return_data, program_error::ProgramError, pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

/// Measurement ABI only: BIOKRN02 || challenge:u32LE || reserved-zero:u32LE.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.starts_with(b"BIOVBG02") {
        return begin(program_id, accounts, data);
    }
    if data.starts_with(b"BIOVST02") {
        return advance(program_id, accounts, data);
    }
    if data.starts_with(b"BIOVFN02") {
        return final_report(program_id, accounts, data);
    }
    if data.len() != 16
        || &data[..8] != b"BIOKRN02"
        || data[12..] != [0, 0, 0, 0]
        || accounts.len() != 1
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    let account = &accounts[0];
    if account.owner != program_id || account.is_writable || account.is_signer {
        return Err(ProgramError::InvalidAccountData);
    }
    let challenge = u32::from_le_bytes(
        data[8..12]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    sol_log_compute_units();
    let raw = account.try_borrow_data()?;
    let graph = graph::decode_graph(&raw)?;
    sol_log_compute_units();
    let report = runtime::run_suite(&graph, challenge, hashv(&[&raw]).to_bytes())?;
    sol_log_compute_units();
    return_report(graph.target, &report);
    Ok(())
}

fn return_report(target: u8, report: &runtime::KernelReport) {
    let mut result = [0u8; 724];
    result[..8].copy_from_slice(b"BIOKRS02");
    result[8..12].copy_from_slice(&report.quality.to_le_bytes());
    result[12] = target;
    result[13] = u8::from(report.task_applicable);
    result[14..16].copy_from_slice(&report.rounds.to_le_bytes());
    result[16..24].copy_from_slice(&report.cost.to_le_bytes());
    result[24..88].copy_from_slice(&report.positive);
    result[88..120].copy_from_slice(&report.model_digest);
    let mut offset = 120;
    for case in report.cases {
        for n in case.n {
            result[offset..offset + 8].copy_from_slice(&n.to_le_bytes());
            offset += 8;
        }
        result[offset..offset + 15].copy_from_slice(&case.i);
        offset += 15;
        result[offset..offset + 8].copy_from_slice(&case.x_a.to_le_bytes());
        offset += 8;
        result[offset..offset + 8].copy_from_slice(&case.x_b.to_le_bytes());
        offset += 8;
    }
    set_return_data(&result);
}

fn owned_state(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    count: usize,
    writable: bool,
) -> ProgramResult {
    if accounts.len() != count
        || accounts[0].is_writable
        || accounts[0].is_signer
        || accounts[1].owner != program_id
        || accounts[1].is_writable != writable
        || accounts[1].data_len() != scratch::BYTES
    {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

#[inline(never)]
fn begin(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    use solana_program::{clock::Clock, sysvar::Sysvar};
    owned_state(program_id, accounts, 3, true)?;
    if data.len() != 116 || !accounts[2].is_signer {
        return Err(ProgramError::InvalidInstructionData);
    }
    let challenge = u32::from_le_bytes(data[8..12].try_into().unwrap());
    let expected = u64::from_le_bytes(data[12..20].try_into().unwrap());
    let config: [u8; 32] = data[20..52].try_into().unwrap();
    let validator = data[52..84].try_into().unwrap();
    let direct = data[84..116].try_into().unwrap();
    let actor = accounts[2].key.to_bytes();
    let now = Clock::get()?.unix_timestamp;
    {
        let raw = accounts[1].try_borrow_data()?;
        if raw.iter().all(|b| *b == 0) {
            if expected != 0 {
                return Err(ProgramError::Custom(8_021));
            }
        } else {
            let old = scratch::Scratch::decode(&raw)?;
            if old.actor != actor || old.generation != expected || now < old.clock {
                return Err(ProgramError::Custom(8_021));
            }
        }
    }
    let raw = accounts[0].try_borrow_data()?;
    let graph = graph::decode_graph(&raw)?;
    if graph.config != config {
        return Err(ProgramError::Custom(8_022));
    }
    let session = runtime::begin_session(&graph, challenge, hashv(&[&raw]).to_bytes())?;
    let state = scratch::Scratch {
        generation: expected
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?,
        clock: now,
        actor,
        config,
        validator,
        direct,
        last_from: u16::MAX,
        last_count: 0,
        last_request: [0; 32],
        session,
        quality: 0,
        task: false,
        cost: 0,
    };
    state.encode(&mut accounts[1].try_borrow_mut_data()?)?;
    set_return_data(&state.result());
    Ok(())
}

#[inline(never)]
fn advance(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    use solana_program::{clock::Clock, sysvar::Sysvar};
    owned_state(program_id, accounts, 2, true)?;
    if data.len() != 52 || data[19] != 0 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let generation = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let cursor = u16::from_le_bytes(data[16..18].try_into().unwrap());
    let count = data[18];
    let prior: [u8; 32] = data[20..52].try_into().unwrap();
    if count == 0 || count > 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut state = scratch::Scratch::decode(&accounts[1].try_borrow_data()?)?;
    if state.generation != generation {
        return Err(ProgramError::Custom(8_021));
    }
    let request = hashv(&[data]).to_bytes();
    if state.last_from == cursor && state.last_count == count && state.last_request == request {
        set_return_data(&state.result());
        return Ok(());
    }
    if state.session.cursor != cursor || state.session.digest != prior {
        return Err(ProgramError::Custom(8_023));
    }
    let now = Clock::get()?.unix_timestamp;
    if now < state.clock {
        return Err(ProgramError::Custom(8_024));
    }
    let raw = accounts[0].try_borrow_data()?;
    let graph_sha = hashv(&[&raw]).to_bytes();
    if graph_sha != state.session.graph_sha {
        return Err(ProgramError::Custom(8_022));
    }
    let graph = graph::decode_graph(&raw)?;
    if graph.config != state.config {
        return Err(ProgramError::Custom(8_022));
    }
    runtime::advance(&graph, graph_sha, &mut state.session, count)?;
    if state.session.cursor == 73 {
        let report = runtime::finish_session(&graph, &state.session)?;
        state.quality = report.quality;
        state.task = report.task_applicable;
        state.cost = report.cost;
    }
    state.clock = now;
    state.last_from = cursor;
    state.last_count = count;
    state.last_request = request;
    state.encode(&mut accounts[1].try_borrow_mut_data()?)?;
    set_return_data(&state.result());
    Ok(())
}

#[inline(never)]
fn final_report(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    owned_state(program_id, accounts, 2, false)?;
    if data.len() != 48 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let state = scratch::Scratch::decode(&accounts[1].try_borrow_data()?)?;
    let generation = u64::from_le_bytes(data[8..16].try_into().unwrap());
    if generation != state.generation
        || data[16..48] != state.session.digest
        || state.session.cursor != 73
    {
        return Err(ProgramError::Custom(8_023));
    }
    let raw = accounts[0].try_borrow_data()?;
    if hashv(&[&raw]).to_bytes() != state.session.graph_sha {
        return Err(ProgramError::Custom(8_022));
    }
    let graph = graph::decode_graph(&raw)?;
    let report = runtime::finish_session(&graph, &state.session)?;
    return_report(graph.target, &report);
    Ok(())
}
