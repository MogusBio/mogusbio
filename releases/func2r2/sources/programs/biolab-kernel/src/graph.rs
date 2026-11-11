//! P6 graph module checklist, recorded before implementation:
//! - Decode exactly BIOP6G01/schema1, bounded 7713 bytes and at most440 edges.
//! - Verify every one of the fixed catalog edges, typed free ports, exact LCA,
//!   complete fixed subtree, v/tier lattice, open fractions and bijective slots.
//! - Reject duplicate or unordered edges, hidden nodes, unknown fields and tails.
//! - Preserve every real child; fixture completion may add only external peers.
//! - Native signer/PDA and biological functionality remain separate modules.

use solana_program::program_error::ProgramError;
use std::cmp::Ordering;

pub const MICRO: u64 = 1_000_000;
pub const HARD: [u8; 4] = [3, 9, 14, 15];
pub const MAX_GRAPH_BYTES: usize = 7713;
pub const MAX_EDGES: usize = 440;
const FULL_ROLES: [u8; 15] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const ORGANS: [&[u8]; 6] = [
    &[1, 2],
    &[3, 4, 5],
    &[6, 7, 8, 9],
    &[10, 11],
    &[12, 13],
    &[14, 15],
];

type Result<T> = std::result::Result<T, ProgramError>;
fn invalid<T>() -> Result<T> {
    Err(ProgramError::InvalidAccountData)
}
fn check(condition: bool) -> Result<()> {
    if condition {
        Ok(())
    } else {
        invalid()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Endpoint {
    pub kind: u8,
    pub role: u8,
    pub sub: u8,
    pub port: u16,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Edge {
    pub owner: u8,
    pub kind: u8,
    pub src: Endpoint,
    pub dst: Endpoint,
    pub fraction: u32,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Node {
    pub scope: u8,
    pub kind: u8,
    pub role: u8,
    pub parent: u8,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Cell {
    pub role: u8,
    pub v: u32,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Tier {
    pub scope: u8,
    pub mode: u8,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Open {
    pub role: u8,
    pub species: u8,
    pub remaining: u32,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Slot {
    pub role: u8,
    pub x: u8,
    pub y: u8,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Graph {
    pub target: u8,
    pub domain: [u8; 32],
    pub config: [u8; 32],
    pub catalog: [u8; 32],
    pub rule: [u8; 32],
    pub nodes: Vec<Node>,
    pub cells: Vec<Cell>,
    pub tiers: Vec<Tier>,
    pub edges: Vec<Edge>,
    pub opens: Vec<Open>,
    pub slots: Vec<Slot>,
}

fn parent(scope: u8) -> Option<u8> {
    match scope {
        1..=2 => Some(16),
        3..=5 => Some(17),
        6..=9 => Some(18),
        10..=11 => Some(19),
        12..=13 => Some(20),
        14..=15 => Some(21),
        16..=21 => Some(22),
        _ => None,
    }
}
fn contains(target: u8, role: u8) -> bool {
    match target {
        1..=15 => role == target,
        16..=21 => ORGANS[(target - 16) as usize].contains(&role),
        22 => (1..=15).contains(&role),
        _ => false,
    }
}
pub fn members(target: u8) -> Result<Vec<u8>> {
    match target {
        1..=15 => Ok(vec![target]),
        16..=21 => Ok(ORGANS[(target - 16) as usize].to_vec()),
        22 => Ok(FULL_ROLES.to_vec()),
        _ => invalid(),
    }
}
fn member_count(target: u8) -> Result<usize> {
    match target {
        1..=15 => Ok(1),
        16..=21 => Ok(ORGANS[(target - 16) as usize].len()),
        22 => Ok(15),
        _ => invalid(),
    }
}
fn member_at(target: u8, index: usize) -> u8 {
    if target <= 15 {
        target
    } else if target <= 21 {
        ORGANS[(target - 16) as usize][index]
    } else {
        (index + 1) as u8
    }
}
fn scope_count(target: u8) -> Result<usize> {
    Ok(if target <= 15 {
        member_count(target)?
    } else if target <= 21 {
        member_count(target)? + 1
    } else {
        member_count(target)? + 7
    })
}
fn scope_at(target: u8, index: usize) -> u8 {
    if target == 22 {
        (index + 1) as u8
    } else if index < member_count(target).unwrap_or(0) {
        member_at(target, index)
    } else {
        target
    }
}
pub fn anchor(endpoint: Endpoint) -> Result<Option<u8>> {
    if endpoint.kind == 1 {
        return Ok(None);
    }
    let value = if (4..=6).contains(&endpoint.kind) {
        endpoint
            .role
            .checked_add(9)
            .ok_or(ProgramError::InvalidAccountData)?
    } else {
        endpoint.role
    };
    check((1..=22).contains(&value))?;
    Ok(Some(value))
}
pub fn lca(a: Option<u8>, b: Option<u8>) -> Result<u8> {
    if a.is_none() || b.is_none() {
        return Ok(0);
    }
    let mut mask: u32 = 0;
    let mut cursor = a;
    while let Some(scope) = cursor {
        check((1..=22).contains(&scope))?;
        mask |= 1u32 << scope;
        cursor = parent(scope);
    }
    cursor = b;
    while let Some(scope) = cursor {
        check((1..=22).contains(&scope))?;
        if mask & (1u32 << scope) != 0 {
            return Ok(scope);
        }
        cursor = parent(scope);
    }
    invalid()
}
pub fn leaf(role: u8, sub: u8, port: u16) -> Endpoint {
    Endpoint {
        kind: 0,
        role,
        sub,
        port,
    }
}
fn endpoint(kind: u8, role: u8, port: u16, sub: u8) -> Endpoint {
    Endpoint {
        kind,
        role,
        sub,
        port,
    }
}
pub fn edge(kind: u8, src: Endpoint, dst: Endpoint, fraction: u32) -> Result<Edge> {
    Ok(Edge {
        owner: lca(anchor(src)?, anchor(dst)?)?,
        kind,
        src,
        dst,
        fraction,
    })
}
fn endpoint_tuple(e: Endpoint) -> (u8, u8, u8, u16) {
    (e.kind, e.role, e.sub, e.port)
}
pub fn compare_edges(a: &Edge, b: &Edge) -> Ordering {
    (
        a.owner,
        a.kind,
        endpoint_tuple(a.src),
        endpoint_tuple(a.dst),
    )
        .cmp(&(
            b.owner,
            b.kind,
            endpoint_tuple(b.src),
            endpoint_tuple(b.dst),
        ))
}

/// Streams the complete fixed catalog. Validation binary-searches each required
/// edge in the real sorted graph; it never trusts a client-provided count/hash.
fn for_each_fixed<F: FnMut(Edge) -> Result<()>>(target: u8, mut emit: F) -> Result<usize> {
    member_count(target)?;
    let mut count = 0usize;
    let mut add = |kind: u8, src: Endpoint, dst: Endpoint| -> Result<()> {
        let anchors = [anchor(src)?, anchor(dst)?];
        if anchors
            .iter()
            .all(|value| value.map(|r| contains(target, r)).unwrap_or(true))
        {
            emit(edge(kind, src, dst, 0)?)?;
            count += 1;
        }
        Ok(())
    };
    let env = |p| endpoint(1, 0, p, 0);
    let head = |p| endpoint(7, 12, p, 0);
    let gt = |r, p| endpoint(8, r, p, 0);
    for r in [1, 2] {
        add(4, env(1), leaf(r, 4, 16))?;
        add(4, leaf(r, 4, 19), env(2))?;
    }
    add(4, env(3), leaf(4, 4, 16))?;
    add(4, leaf(4, 4, 17), leaf(5, 4, 16))?;
    add(4, leaf(5, 4, 17), leaf(8, 4, 16))?;
    for r in [6, 7] {
        add(4, leaf(8, 4, 17), leaf(r, 4, 16))?;
    }
    add(4, leaf(8, 4, 18), leaf(9, 4, 16))?;
    add(4, leaf(9, 4, 17), env(4))?;
    add(4, env(5), leaf(15, 4, 16))?;
    add(4, leaf(15, 4, 17), leaf(14, 4, 16))?;
    add(4, leaf(14, 4, 19), leaf(15, 4, 18))?;
    add(4, leaf(15, 4, 19), env(6))?;
    for r in 1..=15 {
        add(4, leaf(14, 4, 17), leaf(r, 1, 10))?;
        add(4, leaf(r, 1, 11), leaf(14, 4, 18))?;
        add(4, leaf(r, 1, 7), leaf(r, 2, 1))?;
        add(4, leaf(r, 1, 8), leaf(r, 2, 2))?;
        add(4, leaf(r, 2, 3), leaf(r, 1, 9))?;
        add(5, leaf(r, 2, 4), endpoint(2, r, 1, 0))?;
        for s in 0..2 {
            add(5, leaf(r, 2, s + 5), endpoint(3, r, 1, s as u8))?;
            add(6, leaf(r, 3, s + 3), leaf(r, 4, s + 1))?;
        }
        add(7, leaf(r, 1, 12), leaf(12, 4, 31 + r as u16))?;
        add(7, leaf(r, 1, 12), leaf(12, 4, 63 + r as u16))?;
        add(7, leaf(r, 1, 12), head(15 + r as u16))?;
    }
    add(7, env(7), leaf(12, 4, 16))?;
    add(7, env(8), leaf(12, 4, 17))?;
    add(7, endpoint(4, 1, 2, 0), leaf(12, 4, 18))?;
    add(7, endpoint(4, 2, 2, 0), leaf(12, 4, 19))?;
    add(7, env(7), head(1))?;
    add(7, env(8), head(2))?;
    add(7, head(32), leaf(12, 2, 7))?;
    add(7, head(32), leaf(12, 3, 5))?;
    add(8, leaf(12, 4, 80), leaf(13, 3, 1))?;
    add(8, leaf(12, 4, 81), leaf(13, 3, 2))?;
    for r in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15] {
        add(8, leaf(13, 4, 80), leaf(r, 3, 1))?;
    }
    for r in [1, 2, 4, 5, 6, 7, 8, 10, 11] {
        add(8, leaf(13, 4, 81), leaf(r, 3, 2))?;
    }
    for r in [1, 2] {
        for p in [1, 2] {
            add(9, leaf(r, 4, 20), gt(r, p))?;
        }
    }
    for r in [4, 5] {
        add(9, leaf(3, 4, 16), gt(r, 3))?;
    }
    for r in [6, 7, 8] {
        add(9, leaf(9, 4, 18), gt(r, 4))?;
    }
    add(9, leaf(9, 4, 18), gt(9, 5))?;
    for p in [6, 7] {
        add(9, leaf(15, 4, 20), gt(15, p))?;
    }
    for (r, axis) in [(10, 1), (11, 2)] {
        for k in [4, 5, 6] {
            add(10, leaf(r, 4, 16), endpoint(k, axis, 1, 0))?;
        }
    }
    Ok(count)
}
pub fn fixed_edges(target: u8) -> Result<Vec<Edge>> {
    // The full fixture will append up to180 material edges. Reserve once to
    // avoid an unreclaimed grow-copy in Solana's bump allocator.
    let capacity = if target == 22 {
        MAX_EDGES
    } else {
        for_each_fixed(target, |_| Ok(()))?
    };
    let mut edges = Vec::with_capacity(capacity);
    for_each_fixed(target, |e| {
        edges.push(e);
        Ok(())
    })?;
    edges.sort_unstable_by(compare_edges);
    Ok(edges)
}
fn valid_free(e: &Edge, target: u8) -> bool {
    if !(1..=3).contains(&e.kind)
        || e.fraction > 1_000_000
        || e.src.kind != 0
        || e.dst.kind != 0
        || !contains(target, e.src.role)
        || !contains(target, e.dst.role)
    {
        return false;
    }
    match e.kind {
        1 | 2 => {
            e.src.sub == 4
                && e.src.port == 17
                && (if e.kind == 1 {
                    [6, 7].contains(&e.src.role)
                } else {
                    [1, 2].contains(&e.src.role)
                })
                && e.dst.sub == 1
                && (if e.kind == 1 {
                    [1, 2].contains(&e.dst.port)
                } else {
                    [3, 4].contains(&e.dst.port)
                })
        }
        3 => {
            e.src.sub == 1
                && [5, 6].contains(&e.src.port)
                && [1, 2].contains(&e.dst.role)
                && e.dst.sub == 4
                && e.dst.port == 18
        }
        _ => false,
    }
}
fn free_group(e: &Edge) -> (u8, u8) {
    (if e.kind == 3 { e.src.role } else { e.dst.role }, e.kind)
}
fn make_nodes(target: u8) -> Result<Vec<Node>> {
    let count = scope_count(target)?;
    Ok((0..count)
        .map(|i| {
            let scope = scope_at(target, i);
            Node {
                scope,
                kind: if scope <= 15 {
                    1
                } else if scope <= 21 {
                    2
                } else {
                    3
                },
                role: if scope <= 15 {
                    scope
                } else if scope <= 21 {
                    scope - 15
                } else {
                    0
                },
                parent: if scope == target {
                    0
                } else {
                    parent(scope).unwrap_or(0)
                },
            }
        })
        .collect())
}
fn make_opens(target: u8, edges: &[Edge]) -> Result<Vec<Open>> {
    let mut result = Vec::with_capacity(member_count(target)? * 3);
    let mut assigned = [[0u32; 3]; 15];
    for e in edges {
        if e.kind <= 3 {
            let (role, species) = free_group(e);
            check((1..=15).contains(&role) && (1..=3).contains(&species))?;
            let total = &mut assigned[usize::from(role - 1)][usize::from(species - 1)];
            *total = total
                .checked_add(e.fraction)
                .ok_or(ProgramError::InvalidAccountData)?;
        }
    }
    for i in 0..member_count(target)? {
        let role = member_at(target, i);
        for species in 1..=3 {
            let total = assigned[usize::from(role - 1)][usize::from(species - 1)];
            result.push(Open {
                role,
                species,
                remaining: 1_000_000u32
                    .checked_sub(total)
                    .ok_or(ProgramError::InvalidAccountData)?,
            });
        }
    }
    Ok(result)
}

pub fn validate_graph(g: &Graph) -> Result<()> {
    let roles = member_count(g.target)?;
    let scopes = scope_count(g.target)?;
    check(
        g.nodes.len() == scopes
            && g.cells.len() == roles
            && g.tiers.len() == scopes
            && g.edges.len() <= MAX_EDGES,
    )?;
    for (i, n) in g.nodes.iter().enumerate() {
        let scope = scope_at(g.target, i);
        check(
            n.scope == scope
                && n.kind
                    == if scope <= 15 {
                        1
                    } else if scope <= 21 {
                        2
                    } else {
                        3
                    },
        )?;
        check(
            n.role
                == if scope <= 15 {
                    scope
                } else if scope <= 21 {
                    scope - 15
                } else {
                    0
                },
        )?;
        check(
            n.parent
                == if scope == g.target {
                    0
                } else {
                    parent(scope).ok_or(ProgramError::InvalidAccountData)?
                },
        )?;
    }
    for (i, cell) in g.cells.iter().enumerate() {
        check(
            cell.role == member_at(g.target, i)
                && cell.v <= 1_000_000
                && cell.v % 1000 == 0
                && (!HARD.contains(&cell.role) || cell.v == 0),
        )?;
    }
    for (i, tier) in g.tiers.iter().enumerate() {
        check(tier.scope == scope_at(g.target, i) && tier.mode <= 1)?;
    }
    let mut actual_fixed = 0usize;
    let mut assigned_by_group = [[0u32; 3]; 15];
    for (i, e) in g.edges.iter().enumerate() {
        if i > 0 {
            check(compare_edges(&g.edges[i - 1], e) == Ordering::Less)?;
        }
        check(e.owner == lca(anchor(e.src)?, anchor(e.dst)?)?)?;
        if e.kind <= 3 {
            check(valid_free(e, g.target))?;
            let (role, species) = free_group(e);
            let assigned = &mut assigned_by_group[usize::from(role - 1)][usize::from(species - 1)];
            *assigned = assigned
                .checked_add(e.fraction)
                .ok_or(ProgramError::InvalidAccountData)?;
        } else {
            actual_fixed += 1;
            check(e.fraction == 0)?;
        }
    }
    let required_fixed = for_each_fixed(g.target, |expected| {
        let index = g
            .edges
            .binary_search_by(|actual| compare_edges(actual, &expected))
            .map_err(|_| ProgramError::InvalidAccountData)?;
        check(g.edges[index] == expected)
    })?;
    check(actual_fixed == required_fixed)?;
    // Each accepted endpoint pair has one catalog type and one computed LCA.
    // Hence strict ordering also rejects pair reuse under renamed owner/type:
    // free types use disjoint ports; all fixed pairs are verified above.
    check(g.opens.len() == roles * 3)?;
    for (i, open) in g.opens.iter().enumerate() {
        let role = member_at(g.target, i / 3);
        let species = (i % 3 + 1) as u8;
        let assigned = assigned_by_group[usize::from(role - 1)][usize::from(species - 1)];
        let remaining = 1_000_000u32
            .checked_sub(assigned)
            .ok_or(ProgramError::InvalidAccountData)?;
        check(open.role == role && open.species == species && open.remaining == remaining)?;
        if remaining > 0 {
            let external = if species == 1 { [6, 7] } else { [1, 2] };
            check(g.target != 22 && external.iter().any(|r| !contains(g.target, *r)))?;
        }
    }
    if g.target == 22 {
        check(g.slots.len() == 15)?;
        let mut occupied = 0u16;
        for (i, slot) in g.slots.iter().enumerate() {
            check(slot.role == (i + 1) as u8 && slot.x <= 4 && slot.y <= 2)?;
            let bit = 1u16 << (slot.y as u16 * 5 + slot.x as u16);
            check(occupied & bit == 0)?;
            occupied |= bit;
        }
        check(occupied == 0x7fff)?;
    } else {
        check(g.slots.is_empty())?;
    }
    Ok(())
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    fn raw(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or(ProgramError::InvalidAccountData)?;
        let out = self
            .bytes
            .get(self.offset..end)
            .ok_or(ProgramError::InvalidAccountData)?;
        self.offset = end;
        Ok(out)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.raw(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(
            self.raw(2)?
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        ))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.raw(4)?
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        ))
    }
    fn id(&mut self) -> Result<[u8; 32]> {
        self.raw(32)?
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)
    }
    fn endpoint(&mut self) -> Result<Endpoint> {
        Ok(Endpoint {
            kind: self.u8()?,
            role: self.u8()?,
            sub: self.u8()?,
            port: self.u16()?,
        })
    }
    fn count(&mut self, maximum: usize, item_size: usize, wide: bool) -> Result<usize> {
        let n = if wide {
            self.u16()? as usize
        } else {
            self.u8()? as usize
        };
        check(
            n <= maximum
                && n.checked_mul(item_size)
                    .ok_or(ProgramError::InvalidAccountData)?
                    <= self.bytes.len() - self.offset,
        )?;
        Ok(n)
    }
}
pub fn decode_graph(bytes: &[u8]) -> Result<Graph> {
    check(bytes.len() <= MAX_GRAPH_BYTES)?;
    let mut r = Reader { bytes, offset: 0 };
    check(r.raw(8)? == b"BIOP6G01" && r.u16()? == 1)?;
    let target = r.u8()?;
    check(r.u8()? == 0)?;
    let body_length = r.u32()? as usize;
    check(
        body_length
            == bytes
                .len()
                .checked_sub(16)
                .ok_or(ProgramError::InvalidAccountData)?,
    )?;
    member_count(target)?;
    let domain = r.id()?;
    let config = r.id()?;
    let catalog = r.id()?;
    let rule = r.id()?;
    let count = r.count(22, 4, false)?;
    let mut nodes = Vec::with_capacity(count);
    for _ in 0..count {
        nodes.push(Node {
            scope: r.u8()?,
            kind: r.u8()?,
            role: r.u8()?,
            parent: r.u8()?,
        });
    }
    let count = r.count(15, 5, false)?;
    let mut cells = Vec::with_capacity(count);
    for _ in 0..count {
        cells.push(Cell {
            role: r.u8()?,
            v: r.u32()?,
        });
    }
    let count = r.count(22, 2, false)?;
    let mut tiers = Vec::with_capacity(count);
    for _ in 0..count {
        tiers.push(Tier {
            scope: r.u8()?,
            mode: r.u8()?,
        });
    }
    let count = r.count(MAX_EDGES, 16, true)?;
    let mut edges = Vec::with_capacity(count);
    for _ in 0..count {
        edges.push(Edge {
            owner: r.u8()?,
            kind: r.u8()?,
            src: r.endpoint()?,
            dst: r.endpoint()?,
            fraction: r.u32()?,
        });
    }
    let count = r.count(45, 6, false)?;
    let mut opens = Vec::with_capacity(count);
    for _ in 0..count {
        opens.push(Open {
            role: r.u8()?,
            species: r.u8()?,
            remaining: r.u32()?,
        });
    }
    let count = r.count(15, 3, false)?;
    let mut slots = Vec::with_capacity(count);
    for _ in 0..count {
        slots.push(Slot {
            role: r.u8()?,
            x: r.u8()?,
            y: r.u8()?,
        });
    }
    check(r.offset == bytes.len())?;
    let graph = Graph {
        target,
        domain,
        config,
        catalog,
        rule,
        nodes,
        cells,
        tiers,
        edges,
        opens,
        slots,
    };
    validate_graph(&graph)?;
    Ok(graph)
}

fn write_endpoint(bytes: &mut Vec<u8>, e: Endpoint) {
    bytes.extend_from_slice(&[e.kind, e.role, e.sub]);
    bytes.extend_from_slice(&e.port.to_le_bytes());
}
pub fn encode_graph(graph: &Graph) -> Result<Vec<u8>> {
    validate_graph(graph)?;
    let mut bytes = Vec::with_capacity(MAX_GRAPH_BYTES);
    bytes.extend_from_slice(b"BIOP6G01");
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&[graph.target, 0]);
    bytes.extend_from_slice(&[0; 4]);
    for id in [&graph.domain, &graph.config, &graph.catalog, &graph.rule] {
        bytes.extend_from_slice(id);
    }
    bytes.push(graph.nodes.len() as u8);
    for n in &graph.nodes {
        bytes.extend_from_slice(&[n.scope, n.kind, n.role, n.parent]);
    }
    bytes.push(graph.cells.len() as u8);
    for c in &graph.cells {
        bytes.push(c.role);
        bytes.extend_from_slice(&c.v.to_le_bytes());
    }
    bytes.push(graph.tiers.len() as u8);
    for t in &graph.tiers {
        bytes.extend_from_slice(&[t.scope, t.mode]);
    }
    bytes.extend_from_slice(&(graph.edges.len() as u16).to_le_bytes());
    for e in &graph.edges {
        bytes.extend_from_slice(&[e.owner, e.kind]);
        write_endpoint(&mut bytes, e.src);
        write_endpoint(&mut bytes, e.dst);
        bytes.extend_from_slice(&e.fraction.to_le_bytes());
    }
    bytes.push(graph.opens.len() as u8);
    for o in &graph.opens {
        bytes.extend_from_slice(&[o.role, o.species]);
        bytes.extend_from_slice(&o.remaining.to_le_bytes());
    }
    bytes.push(graph.slots.len() as u8);
    for s in &graph.slots {
        bytes.extend_from_slice(&[s.role, s.x, s.y]);
    }
    check(bytes.len() <= MAX_GRAPH_BYTES)?;
    let body_len = (bytes.len() - 16) as u32;
    bytes[12..16].copy_from_slice(&body_len.to_le_bytes());
    Ok(bytes)
}
pub fn project_graph(g: &Graph, target: u8) -> Result<Graph> {
    validate_graph(g)?;
    member_count(target)?;
    check((0..scope_count(g.target)?).any(|i| scope_at(g.target, i) == target))?;
    let mut count = 0usize;
    for e in &g.edges {
        if [anchor(e.src)?, anchor(e.dst)?]
            .iter()
            .all(|a| a.map(|r| contains(target, r)).unwrap_or(true))
        {
            count += 1;
        }
    }
    let mut edges = Vec::with_capacity(count);
    for e in &g.edges {
        if [anchor(e.src)?, anchor(e.dst)?]
            .iter()
            .all(|a| a.map(|r| contains(target, r)).unwrap_or(true))
        {
            edges.push(*e);
        }
    }
    let graph = Graph {
        target,
        domain: g.domain,
        config: g.config,
        catalog: g.catalog,
        rule: g.rule,
        nodes: make_nodes(target)?,
        cells: g
            .cells
            .iter()
            .filter(|c| contains(target, c.role))
            .copied()
            .collect(),
        tiers: g
            .tiers
            .iter()
            .filter(|t| {
                (0..scope_count(target).unwrap_or(0)).any(|i| scope_at(target, i) == t.scope)
            })
            .copied()
            .collect(),
        opens: make_opens(target, &edges)?,
        edges,
        slots: if target == 22 {
            g.slots.clone()
        } else {
            vec![]
        },
    };
    validate_graph(&graph)?;
    Ok(graph)
}
pub fn assert_child_unchanged(parent_graph: &Graph, child: &Graph) -> Result<()> {
    check(project_graph(parent_graph, child.target)? == *child)
}

fn make_free(kind: u8, role: u8, source: u8, port: u16, fraction: u32) -> Result<Edge> {
    if kind == 3 {
        edge(kind, leaf(role, 1, port), leaf(source, 4, 18), fraction)
    } else {
        edge(kind, leaf(source, 4, 17), leaf(role, 1, port), fraction)
    }
}
pub fn execution_graph(g: &Graph) -> Result<Graph> {
    validate_graph(g)?;
    if g.target == 22 {
        return Ok(g.clone());
    }
    let mut free: Vec<Edge> = Vec::with_capacity(180);
    free.extend(g.edges.iter().filter(|e| e.kind <= 3).copied());
    let mut parts_by_group = [[[0u32; 2]; 3]; 15];
    for e in &free {
        let (role, kind) = free_group(e);
        let port = if kind == 3 { e.src.port } else { e.dst.port };
        let first = if kind == 1 {
            1
        } else if kind == 2 {
            3
        } else {
            5
        };
        let assigned = &mut parts_by_group[usize::from(role - 1)][usize::from(kind - 1)]
            [usize::from(port - first)];
        *assigned = assigned
            .checked_add(e.fraction)
            .ok_or(ProgramError::InvalidAccountData)?;
    }
    for role in 1..=15 {
        for kind in 1..=3 {
            let sources = if kind == 1 { [6, 7] } else { [1, 2] };
            let ports = if kind == 1 {
                [1, 2]
            } else if kind == 2 {
                [3, 4]
            } else {
                [5, 6]
            };
            if !contains(g.target, role) {
                free.push(make_free(kind, role, sources[0], ports[0], 500_000)?);
                free.push(make_free(kind, role, sources[1], ports[1], 500_000)?);
                continue;
            }
            let parts = parts_by_group[usize::from(role - 1)][usize::from(kind - 1)];
            let assigned = parts[0]
                .checked_add(parts[1])
                .ok_or(ProgramError::InvalidAccountData)?;
            let remaining = 1_000_000u32
                .checked_sub(assigned)
                .ok_or(ProgramError::InvalidAccountData)?;
            if remaining == 0 {
                continue;
            }
            let mut external = [0u8; 2];
            let mut count = 0usize;
            for source in sources {
                if !contains(g.target, source) {
                    external[count] = source;
                    count += 1;
                }
            }
            check(count > 0)?;
            let low = 500_000u32.max(parts[0]).min(1_000_000 - parts[1]);
            let totals = [low - parts[0], 1_000_000 - low - parts[1]];
            for i in 0..2 {
                let quotient = totals[i] / count as u32;
                let remainder = totals[i] % count as u32;
                for (j, source) in external[..count].iter().enumerate() {
                    let fraction = quotient + if (j as u32) < remainder { 1 } else { 0 };
                    if fraction > 0 {
                        free.push(make_free(kind, role, *source, ports[i], fraction)?);
                    }
                }
            }
        }
    }
    let mut edges = fixed_edges(22)?;
    edges.extend(free);
    edges.sort_unstable_by(compare_edges);
    let graph = Graph {
        target: 22,
        domain: g.domain,
        config: g.config,
        catalog: g.catalog,
        rule: g.rule,
        nodes: make_nodes(22)?,
        cells: FULL_ROLES
            .iter()
            .map(|role| {
                g.cells
                    .iter()
                    .find(|c| c.role == *role)
                    .copied()
                    .unwrap_or(Cell {
                        role: *role,
                        v: if HARD.contains(role) { 0 } else { 1_000_000 },
                    })
            })
            .collect(),
        tiers: (1..=22)
            .map(|scope| {
                g.tiers
                    .iter()
                    .find(|t| t.scope == scope)
                    .copied()
                    .unwrap_or(Tier { scope, mode: 0 })
            })
            .collect(),
        opens: make_opens(22, &edges)?,
        edges,
        slots: FULL_ROLES
            .iter()
            .map(|role| Slot {
                role: *role,
                x: (*role - 1) % 5,
                y: (*role - 1) / 5,
            })
            .collect(),
    };
    validate_graph(&graph)?;
    Ok(graph)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hex(s: &str) -> Vec<u8> {
        s.as_bytes()
            .chunks_exact(2)
            .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
            .collect()
    }
    const C3: &str = "42494f50364730310100030024010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001030103000103000000000103000800030400030107000003020100000000000304000301080000030202000000000003040003020300000301090000000000030500030204000203000100000000000305000302050003030001000000000003050003020600030301010000000000030600030303000003040100000000000306000303040000030402000000000003030140420f00030240420f00030340420f0000";
    fn reference() -> Graph {
        let mut edges = fixed_edges(22).unwrap();
        for role in 1..=15 {
            for source in [6, 7] {
                edges.push(make_free(1, role, source, source as u16 - 5, 500_000).unwrap());
            }
            for kind in [2, 3] {
                let hard = HARD.contains(&role);
                let count = if hard { 1 } else { 2 };
                for p in 0..count {
                    let source = if hard {
                        (HARD.iter().position(|r| *r == role).unwrap() % 2 + 1) as u8
                    } else {
                        p + 1
                    };
                    edges.push(
                        make_free(
                            kind,
                            role,
                            source,
                            if kind == 2 {
                                3 + p as u16
                            } else {
                                5 + p as u16
                            },
                            if hard { 1_000_000 } else { 500_000 },
                        )
                        .unwrap(),
                    );
                }
            }
        }
        edges.sort_unstable_by(compare_edges);
        Graph {
            target: 22,
            domain: [0; 32],
            config: [0; 32],
            catalog: [0; 32],
            rule: [0; 32],
            nodes: make_nodes(22).unwrap(),
            cells: FULL_ROLES
                .iter()
                .map(|r| Cell {
                    role: *r,
                    v: if HARD.contains(r) { 0 } else { 1_000_000 },
                })
                .collect(),
            tiers: (1..=22).map(|scope| Tier { scope, mode: 0 }).collect(),
            opens: make_opens(22, &edges).unwrap(),
            edges,
            slots: FULL_ROLES
                .iter()
                .map(|r| Slot {
                    role: *r,
                    x: (*r - 1) % 5,
                    y: (*r - 1) / 5,
                })
                .collect(),
        }
    }
    #[test]
    fn c3_exact_js_golden_round_trip() {
        let bytes = hex(C3);
        assert_eq!(bytes.len(), 308);
        let g = decode_graph(&bytes).unwrap();
        assert_eq!(g.target, 3);
        assert_eq!(encode_graph(&g).unwrap(), bytes);
    }
    #[test]
    fn all_260_fixed_edges_and_22_subtrees_are_validated() {
        let fixed = fixed_edges(22).unwrap();
        assert_eq!(fixed.len(), 260);
        let counts: Vec<usize> = (4..=10)
            .map(|k| fixed.iter().filter(|e| e.kind == k).count())
            .collect();
        assert_eq!(counts, [90, 45, 30, 53, 24, 12, 6]);
        let g = reference();
        validate_graph(&g).unwrap();
        assert_eq!(encode_graph(&g).unwrap().len(), 6145);
        for target in 1..=22 {
            let child = project_graph(&g, target).unwrap();
            assert_child_unchanged(&g, &child).unwrap();
            let bytes = encode_graph(&child).unwrap();
            assert_eq!(decode_graph(&bytes).unwrap(), child);
        }
        assert_eq!(
            encode_graph(&project_graph(&g, 3).unwrap()).unwrap(),
            hex(C3)
        );
    }
    #[test]
    fn catalog_pair_uniqueness_justifies_ordered_duplicate_guard() {
        let fixed = fixed_edges(22).unwrap();
        for (i, a) in fixed.iter().enumerate() {
            for b in fixed.iter().skip(i + 1) {
                assert!(a.src != b.src || a.dst != b.dst);
            }
        }
    }
    #[test]
    fn missing_fixed_edges_and_renamed_owner_type_cannot_pass() {
        for kind in 4..=10 {
            let mut g = reference();
            let i = g.edges.iter().position(|e| e.kind == kind).unwrap();
            g.edges.remove(i);
            assert!(validate_graph(&g).is_err());
        }
        let mut g = reference();
        let e = g.edges[0];
        g.edges.push(e);
        g.edges.sort_unstable_by(compare_edges);
        assert!(validate_graph(&g).is_err());
        let mut g = reference();
        g.edges[0].owner = 23;
        assert!(validate_graph(&g).is_err());
    }
    #[test]
    fn malformed_counts_reserved_schema_tail_and_fixed_fraction_reject() {
        let bytes = hex(C3);
        for (offset, value) in [(8, 2), (11, 1), (12, 1), (144, 255)] {
            let mut bad = bytes.clone();
            bad[offset] = value;
            assert!(decode_graph(&bad).is_err());
        }
        let mut tail = bytes.clone();
        tail.push(0);
        assert!(decode_graph(&tail).is_err());
        assert!(decode_graph(&bytes[..307]).is_err());
        let mut g = reference();
        g.edges.iter_mut().find(|e| e.kind == 6).unwrap().fraction = 1;
        assert!(validate_graph(&g).is_err());
    }
    #[test]
    fn invalid_free_port_overfraction_slots_and_child_mutation_reject() {
        let mut g = reference();
        g.edges.iter_mut().find(|e| e.kind == 1).unwrap().fraction = 1_000_000;
        assert!(validate_graph(&g).is_err());
        let mut g = reference();
        let child = project_graph(&g, 6).unwrap();
        g.cells[5].v = 999_000;
        assert!(assert_child_unchanged(&g, &child).is_err());
        let mut g = reference();
        g.slots[1].x = g.slots[0].x;
        g.slots[1].y = g.slots[0].y;
        assert!(validate_graph(&g).is_err());
        let mut g = reference();
        g.edges
            .push(edge(5, leaf(1, 2, 5), leaf(2, 4, 1), 0).unwrap());
        g.edges.sort_unstable_by(compare_edges);
        assert!(validate_graph(&g).is_err());
    }
    #[test]
    fn partial_fixture_preserves_actual_dut_in_all_21_subtrees() {
        let full = reference();
        for target in 1..=21 {
            let child = project_graph(&full, target).unwrap();
            let fixture = execution_graph(&child).unwrap();
            assert_eq!(fixture.target, 22);
            assert_child_unchanged(&fixture, &child).unwrap();
            assert_eq!(fixture.slots.len(), 15);
        }
    }
    #[test]
    fn all_37_exported_node_fixture_bytes_parse_and_round_trip_without_manifest_answers() {
        let directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/graphs");
        let mut count = 0usize;
        for entry in std::fs::read_dir(&directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()) != Some("bin") {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            let graph = decode_graph(&bytes)
                .unwrap_or_else(|e| panic!("{} rejected: {:?}", path.display(), e));
            assert_eq!(
                encode_graph(&graph).unwrap(),
                bytes,
                "{} bytes differ",
                path.display()
            );
            count += 1;
        }
        assert_eq!(count, 37);
        let c320 =
            decode_graph(&std::fs::read(directory.join("candidate-c320.bin")).unwrap()).unwrap();
        for target in 1..=22 {
            let path = directory.join(format!("c320-scope-{:02}.bin", target));
            let child_bytes = std::fs::read(path).unwrap();
            let child = decode_graph(&child_bytes).unwrap();
            assert_child_unchanged(&c320, &child).unwrap();
            assert_eq!(
                encode_graph(&project_graph(&c320, target).unwrap()).unwrap(),
                child_bytes
            );
            let fixture = execution_graph(&child).unwrap();
            validate_graph(&fixture).unwrap();
            assert_child_unchanged(&fixture, &child).unwrap();
        }
    }
    #[test]
    fn full_440_edge_7713_byte_limit_is_real_and_overlimit_rejects() {
        let mut graph = reference();
        for role in 1..=15 {
            for kind in 1..=3 {
                let sources = if kind == 1 { [6, 7] } else { [1, 2] };
                let ports = if kind == 1 {
                    [1, 2]
                } else if kind == 2 {
                    [3, 4]
                } else {
                    [5, 6]
                };
                for source in sources {
                    for port in ports {
                        let candidate = make_free(kind, role, source, port, 0).unwrap();
                        if !graph
                            .edges
                            .iter()
                            .any(|e| compare_edges(e, &candidate) == Ordering::Equal)
                        {
                            graph.edges.push(candidate);
                        }
                    }
                }
            }
        }
        graph.edges.sort_unstable_by(compare_edges);
        validate_graph(&graph).unwrap();
        assert_eq!(graph.edges.len(), 440);
        let bytes = encode_graph(&graph).unwrap();
        assert_eq!(bytes.len(), 7713);
        assert_eq!(decode_graph(&bytes).unwrap(), graph);
        graph.edges.push(graph.edges[0]);
        assert!(validate_graph(&graph).is_err());
        let mut too_large = bytes;
        too_large.push(0);
        assert!(decode_graph(&too_large).is_err());
    }
}
