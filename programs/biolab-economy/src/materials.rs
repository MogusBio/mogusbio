//! P1 strict value types shared only by complete manufacture coordinators.
//! Decoding creates no inventory and grants no transaction authority.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Intake {
    pub project: [u8; 32],
    pub class: u8,
    pub token: Pubkey,
    pub owner: Pubkey,
    pub units: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Debit {
    pub species: u8,
    pub prefix: u64,
    pub take: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DebitGroup {
    pub source: [u8; 32],
    pub entries: Vec<Debit>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MaterialPlan {
    pub intakes: Vec<Intake>,
    pub debits: Vec<DebitGroup>,
    pub debit_offset: usize,
}

pub fn class(species: u8) -> Result<u8, ProgramError> {
    require((1..=32).contains(&species), 6100)?;
    Ok(if species <= 20 {
        1
    } else if species <= 28 {
        2
    } else if species <= 31 {
        3
    } else {
        4
    })
}
pub fn bom(species: u8) -> u64 {
    match species {
        1..=24 => 500,
        25 => 1000,
        29..=32 => 250,
        _ => 0,
    }
}
pub fn effective(species: u8) -> bool {
    (1..=24).contains(&species) || (29..=31).contains(&species)
}
pub fn initial_tick(c: u8, units: u64, species: u8) -> Result<u64, ProgramError> {
    require(
        (1..=4).contains(&c) && (1..=1_000_000).contains(&units),
        6110,
    )?;
    Ok(if class(species)? == c {
        units.checked_mul(1000).ok_or(err(8020))?
    } else {
        0
    })
}
pub fn catalog_hash() -> [u8; 32] {
    let mut b = b"BIOCAT\0\0".to_vec();
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&1000u32.to_le_bytes());
    b.push(4);
    for (c, credit, first, last) in [
        (1u8, 6u16, 1u16, 20u16),
        (2, 15, 21, 28),
        (3, 40, 29, 31),
        (4, 120, 32, 32),
    ] {
        b.push(c);
        b.extend_from_slice(&credit.to_le_bytes());
        b.push((last - first + 1) as u8);
        for s in first..=last {
            b.extend_from_slice(&s.to_le_bytes());
        }
    }
    typed_hash(19, &[&b])
}
pub fn source_id(domain: &[u8; 32], m: &[u8; 32], ordinal: u16) -> Result<[u8; 32], ProgramError> {
    require(ordinal < 32, 6110)?;
    Ok(typed_hash(5, &[domain, m, &ordinal.to_le_bytes()]))
}
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ProgramError> {
        let end = self.at.checked_add(n).ok_or(err(6113))?;
        let b = self.bytes.get(self.at..end).ok_or(err(6113))?;
        self.at = end;
        Ok(b)
    }
    fn u8(&mut self) -> Result<u8, ProgramError> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, ProgramError> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| err(6113))?,
        ))
    }
    fn u64(&mut self) -> Result<u64, ProgramError> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| err(6113))?,
        ))
    }
    fn bytes32(&mut self) -> Result<[u8; 32], ProgramError> {
        self.take(32)?.try_into().map_err(|_| err(6113))
    }
}
fn read_debits(r: &mut Reader) -> Result<Vec<DebitGroup>, ProgramError> {
    let n = r.u32()? as usize;
    require(n <= 32 && n * 52 <= r.bytes.len() - r.at, 6113)?;
    let mut groups = Vec::with_capacity(n);
    let mut count = 0usize;
    for _ in 0..n {
        let source = r.bytes32()?;
        if let Some(previous) = groups.last() {
            let previous: &DebitGroup = previous;
            require(previous.source < source, 6113)?;
        }
        let mask = r.u32()?;
        require(mask != 0, 6113)?;
        let entries_count = mask.count_ones() as usize;
        count = count.checked_add(entries_count).ok_or(err(6113))?;
        require(count <= 128, 6113)?;
        let mut entries = Vec::with_capacity(entries_count);
        for bit in 0..32 {
            if mask & (1u32 << bit) != 0 {
                let prefix = r.u64()?;
                let take = r.u64()?;
                require(take > 0 && prefix.checked_add(take).is_some(), 6113)?;
                entries.push(Debit {
                    species: bit + 1,
                    prefix,
                    take,
                });
            }
        }
        groups.push(DebitGroup { source, entries });
    }
    Ok(groups)
}
pub fn decode_debits(bytes: &[u8]) -> Result<Vec<DebitGroup>, ProgramError> {
    require(bytes.len() <= 3204, 6113)?;
    let mut r = Reader { bytes, at: 0 };
    let groups = read_debits(&mut r)?;
    require(r.at == bytes.len(), 6113)?;
    Ok(groups)
}
pub fn decode_plan(bytes: &[u8]) -> Result<MaterialPlan, ProgramError> {
    require(bytes.len() <= 3072, 6113)?;
    let mut r = Reader { bytes, at: 0 };
    require(r.bytes32()? == catalog_hash(), 6101)?;
    let n = r.u32()? as usize;
    require(n <= 32 && n * 105 + 4 <= r.bytes.len() - r.at, 6113)?;
    let mut intakes = Vec::with_capacity(n);
    for _ in 0..n {
        let item = Intake {
            project: r.bytes32()?,
            class: r.u8()?,
            token: Pubkey::new_from_array(r.bytes32()?),
            owner: Pubkey::new_from_array(r.bytes32()?),
            units: r.u64()?,
        };
        require(
            (1..=4).contains(&item.class) && (1..=1_000_000).contains(&item.units),
            6113,
        )?;
        if let Some(previous) = intakes.last() {
            let previous: &Intake = previous;
            require(
                (previous.project, previous.class, previous.token)
                    < (item.project, item.class, item.token),
                6113,
            )?;
        }
        require(
            !intakes.iter().any(|old: &Intake| old.token == item.token),
            6113,
        )?;
        intakes.push(item);
    }
    let debit_offset = r.at;
    let debits = read_debits(&mut r)?;
    require(r.at == bytes.len(), 6113)?;
    Ok(MaterialPlan {
        intakes,
        debits,
        debit_offset,
    })
}
pub fn assert_bom(groups: &[DebitGroup]) -> ProgramResult {
    let mut totals = [0u64; 32];
    for group in groups {
        for debit in &group.entries {
            let at = usize::from(debit.species - 1);
            totals[at] = add(totals[at], debit.take)?;
        }
    }
    require(
        totals
            .iter()
            .enumerate()
            .all(|(i, t)| *t == bom((i + 1) as u8)),
        6502,
    )
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct SourceFacts {
    pub owner: Pubkey,
    pub project: [u8; 32],
    pub mint: Pubkey,
    pub class: u8,
    pub units: u64,
}
pub(crate) fn read_source(a: &AccountInfo, id: &[u8; 32]) -> Result<SourceFacts, ProgramError> {
    header(a, &PROGRAM_ID, 11, 1, 856, id, &[b"bio", b"source", id])?;
    require(
        a.lamports() >= Rent::get()?.minimum_balance(856).max(1),
        6510,
    )?;
    let d = a.try_borrow_data()?;
    let b = &d[120..];
    let owner = key_at(b, 0)?;
    let project: [u8; 32] = b[32..64].try_into().map_err(|_| err(6110))?;
    let mint = key_at(b, 64)?;
    let m: [u8; 32] = b[128..160].try_into().map_err(|_| err(6110))?;
    let units = u64_at(b, 192)?;
    let class = b[200];
    let ordinal = u16_at(b, 201)?;
    require(
        b[96..128] == catalog_hash()
            && zeros(&b[203..208])
            && i64_at(b, 208)? >= 0
            && source_id(&domain(), &m, ordinal)? == *id
            && (1..=4).contains(&class)
            && (1..=1_000_000).contains(&units),
        6110,
    )?;
    require(
        mint == Pubkey::find_program_address(&[b"bio", b"pack", &project, &[class]], &PROGRAM_ID).0,
        6110,
    )?;
    let mut spent = false;
    for species in 1..=32 {
        let initial = initial_tick(class, units, species)?;
        let actual = u64_at(b, 224 + usize::from(species - 1) * 8)?;
        let prefix = u64_at(b, 480 + usize::from(species - 1) * 8)?;
        require(actual == initial && prefix <= initial, 6110)?;
        spent |= prefix > 0;
    }
    require(spent, 6110)?;
    Ok(SourceFacts {
        owner,
        project,
        mint,
        class,
        units,
    })
}
pub(crate) fn write_source<'a>(
    a: &AccountInfo<'a>,
    payer: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    id: &[u8; 32],
    item: &Intake,
    m: &[u8; 32],
    ordinal: u16,
    clock: &Clock,
) -> ProgramResult {
    allocate(payer, a, system, &PROGRAM_ID, 856, &[b"bio", b"source", id])?;
    let bump = valid_pda(a, &PROGRAM_ID, &[b"bio", b"source", id])?;
    write_header(a, 11, 1, id, bump)?;
    let mut d = a.try_borrow_mut_data()?;
    let b = &mut d[120..];
    b[..32].copy_from_slice(item.owner.as_ref());
    b[32..64].copy_from_slice(&item.project);
    let mint = Pubkey::find_program_address(
        &[b"bio", b"pack", &item.project, &[item.class]],
        &PROGRAM_ID,
    )
    .0;
    b[64..96].copy_from_slice(mint.as_ref());
    b[96..128].copy_from_slice(&catalog_hash());
    b[128..160].copy_from_slice(m);
    b[160..192].copy_from_slice(item.token.as_ref());
    b[192..200].copy_from_slice(&item.units.to_le_bytes());
    b[200] = item.class;
    b[201..203].copy_from_slice(&ordinal.to_le_bytes());
    b[208..216].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
    b[216..224].copy_from_slice(&clock.slot.to_le_bytes());
    for species in 1..=32 {
        let at = 224 + usize::from(species - 1) * 8;
        b[at..at + 8]
            .copy_from_slice(&initial_tick(item.class, item.units, species)?.to_le_bytes());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn debit_bytes() -> Vec<u8> {
        let mut out = 4u32.to_le_bytes().to_vec();
        for c in 1u8..=4 {
            out.extend_from_slice(&[c; 32]);
            let species = (1u8..=32)
                .filter(|s| class(*s).unwrap() == c && bom(*s) > 0)
                .collect::<Vec<_>>();
            let mask = species
                .iter()
                .fold(0u32, |mask, s| mask | (1u32 << (*s - 1)));
            out.extend_from_slice(&mask.to_le_bytes());
            for s in species {
                out.extend_from_slice(&0u64.to_le_bytes());
                out.extend_from_slice(&bom(s).to_le_bytes());
            }
        }
        out
    }
    #[test]
    fn exact_bom_and_credit_are_independent_of_number_of_sources() {
        let dp = debit_bytes();
        assert_eq!(dp.len(), 612);
        let groups = decode_debits(&dp).unwrap();
        assert_bom(&groups).unwrap();
        let mut consumed = 0;
        let mut e = 0;
        let mut r = 0;
        let mut entries = 0;
        for g in groups {
            for d in g.entries {
                entries += 1;
                consumed += d.take;
                let credit = match class(d.species).unwrap() {
                    1 => 6,
                    2 => 15,
                    3 => 40,
                    4 => 120,
                    _ => unreachable!(),
                };
                if effective(d.species) {
                    e += d.take * credit
                } else {
                    r += d.take * credit
                }
            }
        }
        assert_eq!((entries, consumed, e, r), (29, 14000, 120000, 45000));
    }
    #[test]
    fn canonical_material_plan_allows_old_inventory_without_new_intake() {
        let mut bytes = catalog_hash().to_vec();
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&debit_bytes());
        let p = decode_plan(&bytes).unwrap();
        assert!(p.intakes.is_empty());
        assert_eq!(p.debit_offset, 36);
        assert_bom(&p.debits).unwrap();
        let mut tail = bytes.clone();
        tail.push(0);
        assert!(decode_plan(&tail).is_err());
        let mut bad = bytes;
        bad[0] ^= 1;
        assert!(decode_plan(&bad).is_err());
    }
    #[test]
    fn unknown_counts_truncations_order_masks_and_integer_overflow_reject() {
        let valid = debit_bytes();
        for len in 0..valid.len() {
            assert!(decode_debits(&valid[..len]).is_err());
        }
        let mut bad = valid.clone();
        bad[..4].copy_from_slice(&33u32.to_le_bytes());
        assert!(decode_debits(&bad).is_err());
        let mut bad = valid.clone();
        bad[36..40].fill(0);
        assert!(decode_debits(&bad).is_err());
        let mut bad = valid.clone();
        bad[40..48].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(decode_debits(&bad).is_err());
        let mut bad = valid.clone();
        let second = 4 + 36 + 20 * 16;
        bad[second..second + 32].fill(1);
        assert!(decode_debits(&bad).is_err());
        let mut bad = valid;
        bad[48..56].fill(0);
        assert!(decode_debits(&bad).is_err());
    }
    #[test]
    fn fixed_species_and_source_ordinal_ranges_never_reinterpret_material() {
        assert!(class(0).is_err());
        assert!(class(33).is_err());
        assert_eq!(
            (
                class(20).unwrap(),
                class(21).unwrap(),
                class(29).unwrap(),
                class(32).unwrap()
            ),
            (1, 2, 3, 4)
        );
        assert_eq!(initial_tick(2, 1_000_000, 25).unwrap(), 1_000_000_000);
        assert_eq!(initial_tick(2, 1, 1).unwrap(), 0);
        assert!(initial_tick(5, 1, 25).is_err());
        assert_ne!(
            source_id(&[1; 32], &[2; 32], 0).unwrap(),
            source_id(&[1; 32], &[2; 32], 1).unwrap()
        );
        assert!(source_id(&[1; 32], &[2; 32], 32).is_err());
    }
}
