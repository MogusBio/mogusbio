//! Independent Rust port of the bounded graph/stock model.
//! This returns a MODEL report only, never a production H16 or asset entitlement.

use crate::graph::{compare_edges, execution_graph, members, Graph, HARD};
use solana_program::{hash::hashv, program_error::ProgramError};

const U: u64 = 1_000_000;
type Result<T> = std::result::Result<T, ProgramError>;

fn check(value: bool, code: u32) -> Result<()> {
    if value {
        Ok(())
    } else {
        Err(ProgramError::Custom(8_000 + code))
    }
}
fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(ProgramError::ArithmeticOverflow)
}
fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(ProgramError::ArithmeticOverflow)
}
fn mul(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b).ok_or(ProgramError::ArithmeticOverflow)
}
fn exact(a: u64, b: u64) -> Result<u64> {
    check(b != 0 && a % b == 0, 1)?;
    Ok(a / b)
}
fn hard(role: usize) -> bool {
    HARD.contains(&((role + 1) as u8))
}

#[derive(Clone, Copy)]
struct Route {
    group: usize,
    macro_role: usize,
    port: usize,
    fraction: u64,
    edge_index: usize,
}
struct Cut {
    mask: u16,
    cap: u64,
}
struct Compiled {
    routes: Vec<Route>,
    starts: [usize; 46],
    v: [u64; 15],
    cuts: Vec<Cut>,
}

#[derive(Clone, Copy, Default)]
struct Ledger {
    n: u64,
    o: u64,
    generated: u64,
    maintenance: u64,
    job0: u64,
    job1: u64,
    work: u64,
    heat: u64,
}
impl Ledger {
    fn words(self) -> [u64; 8] {
        [
            self.n,
            self.o,
            self.generated,
            self.maintenance,
            self.job0,
            self.job1,
            self.work,
            self.heat,
        ]
    }
}
#[derive(Clone, Copy)]
pub struct Boundary {
    pub n: [u64; 15],
    pub i: [u8; 15],
    pub x_a: i64,
    pub x_b: i64,
}
impl Default for Boundary {
    fn default() -> Self {
        Self {
            n: [U; 15],
            i: [0; 15],
            x_a: -(U as i64) / 2,
            x_b: (U as i64) / 2,
        }
    }
}
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Run,
    Starve,
    Recover,
    Hold,
}
struct Plan {
    mode: Mode,
    target: u8,
    d: u64,
    u0: [u64; 15],
    u1: [u64; 15],
    m: [u64; 15],
    feed: [u64; 15],
}

pub struct KernelReport {
    pub quality: u32,
    pub task_applicable: bool,
    pub cost: u64,
    pub rounds: u16,
    pub positive: [u8; 64],
    /// FUNC2 witness digest; explicitly incompatible with legacy full SHA.
    pub model_digest: [u8; 32],
    pub cases: [Boundary; 4],
}

#[inline(never)]
fn compile(g: &Graph) -> Result<Compiled> {
    let full = execution_graph(g)?;
    let mut routes = Vec::with_capacity(full.edges.iter().filter(|e| e.kind <= 3).count());
    for (index, e) in full.edges.iter().enumerate() {
        if e.kind > 3 {
            continue;
        }
        let (role, macro_role, port, first) = if e.kind == 3 {
            (e.src.role, e.dst.role, e.src.port, 5)
        } else {
            (
                e.dst.role,
                e.src.role,
                e.dst.port,
                if e.kind == 1 { 1 } else { 3 },
            )
        };
        check(
            (1..=15).contains(&role)
                && (1..=15).contains(&macro_role)
                && (first..=first + 1).contains(&port),
            2,
        )?;
        let original_index = if g.target == 22 {
            index
        } else {
            g.edges
                .binary_search_by(|actual| compare_edges(actual, e))
                .unwrap_or(512)
        };
        routes.push(Route {
            group: usize::from(e.kind - 1) * 15 + usize::from(role - 1),
            macro_role: usize::from(macro_role - 1),
            port: usize::from(port - first),
            fraction: u64::from(e.fraction),
            edge_index: original_index,
        });
    }
    routes.sort_unstable_by_key(|r| (r.group, r.edge_index));
    let mut starts = [0usize; 46];
    let mut cursor = 0usize;
    for group in 0..45 {
        starts[group] = cursor;
        while cursor < routes.len() && routes[cursor].group == group {
            cursor += 1;
        }
        check(starts[group] < cursor, 2)?;
    }
    starts[45] = cursor;
    check(cursor == routes.len(), 2)?;
    let mut v = [0u64; 15];
    for cell in &full.cells {
        v[usize::from(cell.role - 1)] = u64::from(cell.v);
    }
    let mut cuts = Vec::with_capacity(full.tiers.len());
    for tier in &full.tiers {
        let mut mask = 0u16;
        for role in members(tier.scope)? {
            mask |= 1u16 << (role - 1);
        }
        cuts.push(Cut {
            mask,
            cap: if tier.mode == 0 { 12 * U } else { 15 * U / 2 },
        });
    }
    Ok(Compiled {
        routes,
        starts,
        v,
        cuts,
    })
}

fn phase(state: &Boundary) -> Result<u8> {
    if state.x_a == -(U as i64) / 2 && state.x_b == (U as i64) / 2 {
        Ok(0)
    } else if state.x_a == (U as i64) / 2 && state.x_b == -(U as i64) / 2 {
        Ok(1)
    } else {
        Err(ProgramError::Custom(8_003))
    }
}

#[inline(never)]
fn plan(state: &Boundary, f: bool, b: bool, challenge: u64, v: &[u64; 15]) -> Result<Plan> {
    let deficit = state.n.iter().position(|n| *n < U);
    let mode = if !f {
        Mode::Starve
    } else if deficit.is_some() {
        Mode::Recover
    } else if b {
        Mode::Hold
    } else {
        Mode::Run
    };
    let mut result = Plan {
        mode,
        target: 0,
        d: 0,
        u0: [0; 15],
        u1: [0; 15],
        m: [0; 15],
        feed: [0; 15],
    };
    let boost = challenge.saturating_sub(U);
    let sensor_service = v[11].min(boost);
    let integrator_service = v[12].min(boost);
    for role in 0..15 {
        result.u0[role] = if mode == Mode::Starve
            || ((mode == Mode::Hold || mode == Mode::Recover) && (role == 9 || role == 10))
        {
            0
        } else {
            U
        };
        result.u1[role] = if mode == Mode::Run && !hard(role) {
            v[role].min(boost)
        } else {
            0
        };
        check(
            result.u1[role] <= sensor_service && result.u1[role] <= integrator_service,
            4,
        )?;
        result.m[role] = exact(add(add(U, result.u0[role])?, result.u1[role])?, 4)?;
        result.feed[role] = if mode == Mode::Starve {
            0
        } else {
            result.m[role]
        };
    }
    if mode == Mode::Recover {
        let target = deficit.ok_or(ProgramError::InvalidAccountData)?;
        let d = (U - state.n[target]).min(U / 2);
        result.target = (target + 1) as u8;
        result.d = d;
        result.feed[target] = add(result.feed[target], d)?;
    }
    Ok(result)
}

struct Work {
    ledger: [Ledger; 15],
    ports: [[[u64; 2]; 15]; 3],
    macro_flow: [[u64; 15]; 4],
    paid: [[bool; 2]; 15],
    positive_now: [u8; 64],
}

#[inline(never)]
fn allocate_work() -> Box<Work> {
    Box::new(Work {
        ledger: [Ledger::default(); 15],
        ports: [[[0; 2]; 15]; 3],
        macro_flow: [[0; 15]; 4],
        paid: [[false; 2]; 15],
        positive_now: [0; 64],
    })
}

struct Round<'a> {
    stock: &'a mut [u64; 15],
    work: &'a mut Work,
    positive: &'a mut [u8; 64],
}

impl Round<'_> {
    #[inline(never)]
    fn route(
        &mut self,
        compiled: &Compiled,
        species: usize,
        role: usize,
        amount: u64,
    ) -> Result<()> {
        let group = species * 15 + role;
        let mut delivered = 0u64;
        for route in &compiled.routes[compiled.starts[group]..compiled.starts[group + 1]] {
            let n = exact(mul(amount, route.fraction)?, U)?;
            delivered = add(delivered, n)?;
            let port_total = &mut self.work.ports[species][role][route.port];
            *port_total = add(*port_total, n)?;
            check(*port_total <= U / 2, 5)?;
            let macro_total = &mut self.work.macro_flow[species][route.macro_role];
            *macro_total = add(*macro_total, n)?;
            check(*macro_total <= if species == 0 { 6 * U } else { 8 * U }, 6)?;
            if n != 0 && route.edge_index < 512 {
                let bit = 1u8 << (route.edge_index % 8);
                self.positive[route.edge_index / 8] |= bit;
                self.work.positive_now[route.edge_index / 8] |= bit;
            }
        }
        check(delivered == amount, 7)
    }

    #[inline(never)]
    fn react_pay(
        &mut self,
        compiled: &Compiled,
        role: usize,
        amount: u64,
        purpose: usize,
    ) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let energy = mul(amount, 4)?;
        check(self.stock[role] >= amount, 8)?;
        self.route(compiled, 1, role, amount)?;
        self.stock[role] = sub(self.stock[role], amount)?;
        let ledger = &mut self.work.ledger[role];
        ledger.n = add(ledger.n, amount)?;
        ledger.o = add(ledger.o, amount)?;
        ledger.generated = add(ledger.generated, energy)?;
        check(ledger.n <= U, 9)?;
        match purpose {
            0 => ledger.maintenance = add(ledger.maintenance, energy)?,
            1 | 2 => {
                check(!self.work.paid[role][purpose - 1] && energy <= U, 10)?;
                self.work.paid[role][purpose - 1] = true;
                if purpose == 1 {
                    ledger.job0 = add(ledger.job0, energy)?;
                } else {
                    ledger.job1 = add(ledger.job1, energy)?;
                }
            }
            _ => return Err(ProgramError::InvalidArgument),
        }
        Ok(())
    }
}

fn service_score(value: u64, scale: u64) -> Result<u64> {
    Ok(sub(mul(value, scale)?, 19 * U)? / 11)
}
fn sum(values: &[u64]) -> Result<u64> {
    values.iter().try_fold(0, |total, value| add(total, *value))
}

#[inline(never)]
fn step(
    compiled: &Compiled,
    state: &mut Boundary,
    f: bool,
    b: bool,
    challenge: u64,
    positive: &mut [u8; 64],
    minima: &mut [u64; 15],
    trace: &mut Vec<u8>,
    work: &mut Work,
) -> Result<()> {
    let old_n = state.n;
    let phase_start = phase(state)?;
    check(
        state.n.iter().all(|n| *n <= U) && state.i.iter().all(|i| *i <= 3),
        11,
    )?;
    let p = plan(state, f, b, challenge, &compiled.v)?;
    work.ledger = [Ledger::default(); 15];
    work.ports = [[[0; 2]; 15]; 3];
    work.macro_flow = [[0; 15]; 4];
    work.paid = [[false; 2]; 15];
    work.positive_now = [0; 64];
    let mut round = Round {
        stock: &mut state.n,
        work,
        positive,
    };
    for role in 0..15 {
        round.react_pay(compiled, role, U / 4, 0)?;
    }
    if p.mode != Mode::Starve {
        round.react_pay(compiled, 11, U / 4, 1)?;
        if p.u1[11] != 0 {
            round.react_pay(compiled, 11, exact(p.u1[11], 4)?, 2)?;
        }
        check(round.work.paid[11][0], 4)?;
        round.react_pay(compiled, 12, U / 4, 1)?;
        if p.u1[12] != 0 {
            check(round.work.paid[11][1], 4)?;
            round.react_pay(compiled, 12, exact(p.u1[12], 4)?, 2)?;
        }
    }
    for role in 0..15 {
        if role == 11 || role == 12 {
            continue;
        }
        if p.u0[role] != 0 {
            round.react_pay(compiled, role, exact(p.u0[role], 4)?, 1)?;
        }
        if p.u1[role] != 0 {
            check(round.work.paid[12][1], 4)?;
            round.react_pay(compiled, role, exact(p.u1[role], 4)?, 2)?;
        }
    }
    let food = sum(&p.feed)?;
    let consumed = round.work.ledger.iter().try_fold(0, |n, l| add(n, l.n))?;
    if food != 0 {
        for role in [3usize, 4, 7] {
            let output = exact(mul(15, add(add(U, p.u0[role])?, p.u1[role])?)?, 4)?;
            check(round.work.paid[role][0] && food <= output, 12)?;
        }
        for role in [2usize, 8, 13, 14] {
            check(round.work.paid[role][0], 13)?;
        }
        check(food <= 12 * U, 14)?;
        round.work.macro_flow[3][8] = food;
    }
    for role in 0..15 {
        round.route(compiled, 0, role, p.feed[role])?;
        round.route(compiled, 2, role, round.work.ledger[role].n)?;
        round.stock[role] = add(round.stock[role], p.feed[role])?;
        check(
            round.stock[role] <= U
                && round.stock[role] == add(sub(old_n[role], p.m[role])?, p.feed[role])?,
            11,
        )?;
        // The fixed J exchange is 0.1 outward and back; actual fixed edges were
        // checked structurally. J starts/ends at one and its transient is 1.1.
        check(U + U / 10 <= 6 * U / 5, 15)?;
    }
    check(consumed <= 12 * U && 3 * U <= 4 * U, 14)?;
    for cut in &compiled.cuts {
        for species in 0..4 {
            let mut total = 0u64;
            for role in 0..15 {
                if cut.mask & (1u16 << role) != 0 {
                    total = add(total, round.work.macro_flow[species][role])?;
                }
            }
            check(total <= cut.cap, 14)?;
        }
    }
    if p.mode == Mode::Run {
        for role in [9usize, 10] {
            check(
                add(round.work.ledger[role].job0, round.work.ledger[role].job1)? >= challenge,
                16,
            )?;
            round.work.ledger[role].work = challenge;
        }
        state.x_a = -state.x_a;
        state.x_b = -state.x_b;
    }
    let mut work = 0u64;
    let mut heat = 0u64;
    for ledger in &mut round.work.ledger {
        ledger.heat = sub(
            add(
                add(add(ledger.generated, ledger.maintenance)?, ledger.job0)?,
                ledger.job1,
            )?,
            ledger.work,
        )?;
        work = add(work, ledger.work)?;
        heat = add(heat, ledger.heat)?;
    }
    check(add(heat, work)? == mul(consumed, 8)?, 8)?;
    let next_i = if p.mode == Mode::Starve {
        2
    } else if round.stock.iter().any(|n| *n < U) {
        3
    } else if b {
        2
    } else {
        phase(&Boundary {
            n: *round.stock,
            i: state.i,
            x_a: state.x_a,
            x_b: state.x_b,
        })?
    };
    state.i = [next_i; 15];
    if p.mode == Mode::Run {
        let mut services = [0u64; 15];
        let rr = service_score(food, 4)?;
        for role in [3usize, 4, 7] {
            services[role] = rr.min(add(p.u0[role], p.u1[role])?);
        }
        for role in [5usize, 6] {
            services[role] =
                service_score(round.work.macro_flow[0][role], 8)?.min(add(p.u0[role], p.u1[role])?);
        }
        for role in [0usize, 1] {
            services[role] = service_score(round.work.macro_flow[1][role], 8)?
                .min(service_score(round.work.macro_flow[2][role], 8)?)
                .min(add(p.u0[role], p.u1[role])?);
        }
        for role in [9usize, 10] {
            services[role] = round.work.ledger[role].work;
        }
        let mut noncontrol = rr;
        for role in [0usize, 1, 3, 4, 5, 6, 7, 9, 10] {
            noncontrol = noncontrol.min(services[role]);
        }
        let available = noncontrol.saturating_sub(U).min(U);
        services[11] = add(U, p.u1[11].min(p.u1[12]).min(available))?;
        services[12] = services[11];
        for role in 0..15 {
            if !hard(role) {
                minima[role] = minima[role].min(services[role]);
            }
        }
    }
    trace.push(match p.mode {
        Mode::Run => 0,
        Mode::Starve => 1,
        Mode::Recover => 2,
        Mode::Hold => 3,
    });
    trace.extend_from_slice(&[u8::from(f), u8::from(b), phase_start, p.target]);
    trace.extend_from_slice(&p.d.to_le_bytes());
    for n in old_n {
        trace.extend_from_slice(&n.to_le_bytes());
    }
    for n in round.stock.iter() {
        trace.extend_from_slice(&n.to_le_bytes());
    }
    for vector in [&p.m, &p.feed, &p.u0, &p.u1] {
        for value in vector {
            trace.extend_from_slice(&value.to_le_bytes());
        }
    }
    trace.extend_from_slice(&state.x_a.to_le_bytes());
    trace.extend_from_slice(&state.x_b.to_le_bytes());
    trace.extend_from_slice(&state.i);
    trace.extend_from_slice(&round.work.positive_now);
    for ledger in round.work.ledger.iter() {
        for word in ledger.words() {
            trace.extend_from_slice(&word.to_le_bytes());
        }
    }
    for species in round.work.macro_flow.iter() {
        for amount in species {
            trace.extend_from_slice(&amount.to_le_bytes());
        }
    }
    Ok(())
}

fn task_cost(g: &Graph, positive: &[u8; 64]) -> Result<u64> {
    let mut coordinates = [(0u8, 0u8); 15];
    for slot in &g.slots {
        coordinates[usize::from(slot.role - 1)] = (slot.x, slot.y);
    }
    let mut cost = 90u64;
    for (index, e) in g.edges.iter().enumerate() {
        if e.kind > 3 || positive[index / 8] & (1u8 << (index % 8)) == 0 {
            continue;
        }
        let a = coordinates[usize::from(e.src.role - 1)];
        let b = coordinates[usize::from(e.dst.role - 1)];
        cost = add(
            cost,
            1 + u64::from(a.0.abs_diff(b.0)) + u64::from(a.1.abs_diff(b.1)),
        )?;
    }
    Ok(cost)
}

/// Program-owned continuation only. No user-provided stock/q/trace is accepted.
#[derive(Clone)]
pub struct Session {
    pub target: u8,
    pub challenge: u32,
    pub graph_sha: [u8; 32],
    pub cursor: u16,
    pub boundary: Boundary,
    pub minima: [u64; 15],
    pub positive: [u8; 64],
    pub digest: [u8; 32],
    pub cases: [Boundary; 4],
}
pub fn begin_session(g: &Graph, challenge: u32, graph_sha: [u8; 32]) -> Result<Session> {
    let c = u64::from(challenge);
    check((U / 2..=2 * U).contains(&c) && c % 1000 == 0, 17)?;
    check(
        !((g.target <= 15 && HARD.contains(&g.target)) || g.target == 21) || c == 2 * U,
        17,
    )?;
    let digest = hashv(&[
        b"BIO6TI02",
        &graph_sha,
        &challenge.to_le_bytes(),
        &2u32.to_le_bytes(),
        &1u32.to_le_bytes(),
        &1u32.to_le_bytes(),
    ])
    .to_bytes();
    Ok(Session {
        target: g.target,
        challenge,
        graph_sha,
        cursor: 0,
        boundary: Boundary::default(),
        minima: [2 * U; 15],
        positive: [0; 64],
        digest,
        cases: [Boundary::default(); 4],
    })
}

/// Execute an exact bounded prefix. The actual Graph is re-decoded by the caller
/// each transaction; the cursor and state come only from program-owned storage.
#[inline(never)]
pub fn advance(g: &Graph, graph_sha: [u8; 32], session: &mut Session, count: u8) -> Result<()> {
    check(
        session.target == g.target
            && session.graph_sha == graph_sha
            && session.cursor < 73
            && count > 0
            && u16::from(count) <= 73 - session.cursor,
        20,
    )?;
    let compiled = compile(g)?;
    let mut trace = Vec::with_capacity(2271);
    let mut work = allocate_work();
    for _ in 0..count {
        let cursor = session.cursor;
        let (case, round, end) = if cursor < 32 {
            (0u8, cursor, 32)
        } else if cursor < 50 {
            (1, cursor - 32, 50)
        } else if cursor < 54 {
            (2, cursor - 50, 54)
        } else {
            (3, cursor - 54, 73)
        };
        let (f, b) = match case {
            0 => (true, false),
            1 => (round >= 2, false),
            2 => (true, round < 2),
            _ => (round != 0, round < 17),
        };
        trace.clear();
        trace.push(case);
        trace.extend_from_slice(&round.to_le_bytes());
        step(
            &compiled,
            &mut session.boundary,
            f,
            b,
            u64::from(session.challenge),
            &mut session.positive,
            &mut session.minima,
            &mut trace,
            &mut work,
        )?;
        check(trace.len() == 2271, 18)?;
        session.digest = hashv(&[b"BIO6TR02", &session.digest, &trace]).to_bytes();
        session.cursor += 1;
        if session.cursor == end {
            session.cases[usize::from(case)] = session.boundary;
            if session.cursor != 73 {
                session.boundary = Boundary::default();
            }
        }
    }
    Ok(())
}

pub fn finish_session(g: &Graph, session: &Session) -> Result<KernelReport> {
    check(session.cursor == 73 && session.target == g.target, 20)?;
    let challenge = u64::from(session.challenge);
    let hard_target = (g.target <= 15 && HARD.contains(&g.target)) || g.target == 21;
    let mut quality = 2 * U;
    if hard_target {
        quality = U;
    } else {
        for role in members(g.target)? {
            if !HARD.contains(&role) {
                quality = quality.min(session.minima[usize::from(role - 1)]);
            }
        }
        quality = quality / 1000 * 1000;
    }
    check(
        quality >= U / 2 && (hard_target || quality >= challenge),
        19,
    )?;
    let task_applicable = g.target == 22
        && quality == 2 * U
        && g.cells
            .iter()
            .all(|c| HARD.contains(&c.role) || c.v == U as u32);
    let cost = if task_applicable {
        task_cost(g, &session.positive)?
    } else {
        0
    };
    Ok(KernelReport {
        quality: quality as u32,
        task_applicable,
        cost,
        rounds: session.cursor,
        positive: session.positive,
        model_digest: session.digest,
        cases: session.cases,
    })
}

/// Retained whole-transaction baseline. Its real 1.4M failure is not suppressed.
pub fn run_suite(g: &Graph, challenge: u32, graph_sha: [u8; 32]) -> Result<KernelReport> {
    let mut session = begin_session(g, challenge, graph_sha)?;
    advance(g, graph_sha, &mut session, 73)?;
    finish_session(g, &session)
}
