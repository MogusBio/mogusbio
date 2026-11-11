//! Scratch module pre-implementation checks: fixed 1213-byte encoding; only
//! owner-program writes; actor-authorized generation reset; exact graph/context
//! binding; program-derived state; current cursor/digest CAS; latest replay only;
//! real Clock high-water; no asset/material/token effects before finalization.
use crate::runtime::{Boundary, Session};
use solana_program::program_error::ProgramError;
pub const BYTES: usize = 1213;
type Result<T> = std::result::Result<T, ProgramError>;
pub struct Scratch {
    pub generation: u64,
    pub clock: i64,
    pub actor: [u8; 32],
    pub config: [u8; 32],
    pub validator: [u8; 32],
    pub direct: [u8; 32],
    pub last_from: u16,
    pub last_count: u8,
    pub last_request: [u8; 32],
    pub session: Session,
    pub quality: u32,
    pub task: bool,
    pub cost: u64,
}
struct Writer<'a> {
    data: &'a mut [u8],
    at: usize,
}
impl Writer<'_> {
    fn put(&mut self, b: &[u8]) {
        self.data[self.at..self.at + b.len()].copy_from_slice(b);
        self.at += b.len();
    }
}
struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}
impl Reader<'_> {
    fn bytes<const N: usize>(&mut self) -> [u8; N] {
        let mut b = [0; N];
        b.copy_from_slice(&self.data[self.at..self.at + N]);
        self.at += N;
        b
    }
    fn u8(&mut self) -> u8 {
        self.bytes::<1>()[0]
    }
    fn u16(&mut self) -> u16 {
        u16::from_le_bytes(self.bytes())
    }
    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.bytes())
    }
    fn u64(&mut self) -> u64 {
        u64::from_le_bytes(self.bytes())
    }
    fn i64(&mut self) -> i64 {
        i64::from_le_bytes(self.bytes())
    }
}
fn put_boundary(w: &mut Writer, b: &Boundary) {
    for n in b.n {
        w.put(&n.to_le_bytes());
    }
    w.put(&b.i);
    w.put(&b.x_a.to_le_bytes());
    w.put(&b.x_b.to_le_bytes());
}
fn read_boundary(r: &mut Reader) -> Boundary {
    let mut n = [0; 15];
    for v in &mut n {
        *v = r.u64();
    }
    Boundary {
        n,
        i: r.bytes(),
        x_a: r.i64(),
        x_b: r.i64(),
    }
}
impl Scratch {
    pub fn encode(&self, data: &mut [u8]) -> Result<()> {
        if data.len() != BYTES {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut w = Writer { data, at: 0 };
        w.put(b"BIOVFY02");
        w.put(&2u16.to_le_bytes());
        w.put(&[
            if self.session.cursor == 73 { 2 } else { 1 },
            self.session.target,
        ]);
        w.put(&self.session.challenge.to_le_bytes());
        w.put(&self.generation.to_le_bytes());
        w.put(&self.session.cursor.to_le_bytes());
        w.put(&self.clock.to_le_bytes());
        for b in [
            &self.session.graph_sha,
            &self.actor,
            &self.config,
            &self.validator,
            &self.direct,
        ] {
            w.put(b);
        }
        w.put(&self.last_from.to_le_bytes());
        w.put(&[self.last_count]);
        w.put(&self.last_request);
        put_boundary(&mut w, &self.session.boundary);
        for n in self.session.minima {
            w.put(&n.to_le_bytes());
        }
        w.put(&self.session.positive);
        w.put(&self.session.digest);
        for b in &self.session.cases {
            put_boundary(&mut w, b);
        }
        w.put(&self.quality.to_le_bytes());
        w.put(&[u8::from(self.task)]);
        w.put(&self.cost.to_le_bytes());
        if w.at != BYTES {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(())
    }
    pub fn decode(data: &[u8]) -> Result<Self> {
        if data.len() != BYTES {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut r = Reader { data, at: 0 };
        if r.bytes::<8>() != *b"BIOVFY02" || r.u16() != 2 {
            return Err(ProgramError::InvalidAccountData);
        }
        let status = r.u8();
        let target = r.u8();
        let challenge = r.u32();
        let generation = r.u64();
        let cursor = r.u16();
        let clock = r.i64();
        if cursor > 73 || status != if cursor == 73 { 2 } else { 1 } || generation == 0 {
            return Err(ProgramError::InvalidAccountData);
        }
        let graph_sha = r.bytes();
        let actor = r.bytes();
        let config = r.bytes();
        let validator = r.bytes();
        let direct = r.bytes();
        let last_from = r.u16();
        let last_count = r.u8();
        let last_request = r.bytes();
        let boundary = read_boundary(&mut r);
        let mut minima = [0; 15];
        for n in &mut minima {
            *n = r.u64();
        }
        let positive = r.bytes();
        let digest = r.bytes();
        let mut cases = [Boundary::default(); 4];
        for b in &mut cases {
            *b = read_boundary(&mut r);
        }
        let quality = r.u32();
        let task = r.u8();
        let cost = r.u64();
        if task > 1 || r.at != BYTES || (cursor < 73 && (quality != 0 || task != 0 || cost != 0)) {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(Self {
            generation,
            clock,
            actor,
            config,
            validator,
            direct,
            last_from,
            last_count,
            last_request,
            quality,
            task: task == 1,
            cost,
            session: Session {
                target,
                challenge,
                graph_sha,
                cursor,
                boundary,
                minima,
                positive,
                digest,
                cases,
            },
        })
    }
    pub fn result(&self) -> [u8; 80] {
        let mut b = [0u8; 80];
        b[..8].copy_from_slice(b"BIOVSR02");
        b[8..16].copy_from_slice(&self.generation.to_le_bytes());
        b[16..18].copy_from_slice(&self.session.cursor.to_le_bytes());
        b[18] = if self.session.cursor == 73 { 2 } else { 1 };
        b[19] = self.session.target;
        b[20..24].copy_from_slice(&self.quality.to_le_bytes());
        b[24] = u8::from(self.task);
        b[32..40].copy_from_slice(&self.cost.to_le_bytes());
        b[40..72].copy_from_slice(&self.session.digest);
        b[72..74].copy_from_slice(&self.last_from.to_le_bytes());
        b[74] = self.last_count;
        b
    }
}
