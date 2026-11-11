//! Bounded integer readers and checked arithmetic.
use super::*;

pub(crate) fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
pub(crate) fn require(c: bool, code: u32) -> ProgramResult {
    if c {
        Ok(())
    } else {
        Err(err(code))
    }
}
pub(crate) fn u16_at(bytes: &[u8], at: usize) -> Result<u16, ProgramError> {
    Ok(u16::from_le_bytes(
        bytes
            .get(at..at + 2)
            .ok_or(err(8000))?
            .try_into()
            .map_err(|_| err(8000))?,
    ))
}
pub(crate) fn u32_at(bytes: &[u8], at: usize) -> Result<u32, ProgramError> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at + 4)
            .ok_or(err(8000))?
            .try_into()
            .map_err(|_| err(8000))?,
    ))
}
pub(crate) fn u64_at(bytes: &[u8], at: usize) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(
        bytes
            .get(at..at + 8)
            .ok_or(err(8000))?
            .try_into()
            .map_err(|_| err(8000))?,
    ))
}
pub(crate) fn u128_at(bytes: &[u8], at: usize) -> Result<u128, ProgramError> {
    Ok(u128::from_le_bytes(
        bytes
            .get(at..at + 16)
            .ok_or(err(8000))?
            .try_into()
            .map_err(|_| err(8000))?,
    ))
}
pub(crate) fn i64_at(bytes: &[u8], at: usize) -> Result<i64, ProgramError> {
    Ok(i64::from_le_bytes(
        bytes
            .get(at..at + 8)
            .ok_or(err(8000))?
            .try_into()
            .map_err(|_| err(8000))?,
    ))
}
pub(crate) fn key_at(bytes: &[u8], at: usize) -> Result<Pubkey, ProgramError> {
    Ok(Pubkey::new_from_array(
        bytes
            .get(at..at + 32)
            .ok_or(err(8000))?
            .try_into()
            .map_err(|_| err(8000))?,
    ))
}
pub(crate) fn zeros(bytes: &[u8]) -> bool {
    bytes.iter().all(|b| *b == 0)
}
pub(crate) fn add(a: u64, b: u64) -> Result<u64, ProgramError> {
    a.checked_add(b).ok_or(err(8020))
}
