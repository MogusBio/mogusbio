//! Complete P5 ARTREF manufacture. No standalone material-consumption route.
use super::*;
use materials::{MaterialPlan, SourceFacts};

#[derive(Clone, Copy)]
struct SourceRow {
    id: [u8; 32],
    index: usize,
    owner: Pubkey,
    class: u8,
    units: u64,
    new_ordinal: Option<usize>,
}
#[derive(Clone, Copy)]
struct MintRow {
    project: [u8; 32],
    class: u8,
    project_index: usize,
    mint_index: usize,
    class_offset: usize,
    issued: u64,
    burned: u64,
    supply: u64,
    total: u64,
}

fn new_target(a: &AccountInfo, code: u32) -> ProgramResult {
    require(
        a.owner == &SYSTEM_ID && a.data_is_empty() && !a.executable,
        code,
    )
}
fn protected(
    a: &[AccountInfo],
    state_end: usize,
    roles: &[Pubkey],
    plan: &MaterialPlan,
) -> ProgramResult {
    let fixed = [
        PROGRAM_ID,
        pda(&PROGRAM_ID, b"config").0,
        pda(&PROGRAM_ID, b"deploy").0,
        pda(&PROGRAM_ID, b"ops").0,
        pda(&PROGRAM_ID, b"treasury").0,
        pda(&PROGRAM_ID, b"lab-mint").0,
        pda(&PROGRAM_ID, b"lab-reserve").0,
        pda(&PROGRAM_ID, b"lab-auth").0,
        pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        pubkey!("BPFLoaderUpgradeab1e11111111111111111111111"),
    ];
    for key in roles {
        require(
            !fixed.contains(key) && !a[1..state_end].iter().any(|state| state.key == key),
            6504,
        )?;
        for item in &plan.intakes {
            require(
                *key != launchpad::pack_address(&item.project, item.class, b"pack-auth").0,
                6504,
            )?;
        }
    }
    Ok(())
}
pub(crate) fn rent_payer<'a, 'b>(
    a: &'a [AccountInfo<'b>],
    _f: &Frame,
) -> Result<&'a AccountInfo<'b>, ProgramError> {
    require(a.len() >= 9, 6503)?;
    let d = a[7].try_borrow_data()?;
    let key = key_at(&d, verification::ARTIFACT_OFFSET + 4)?;
    launchpad::role(a, &key)
}
pub(crate) fn make<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() >= 9 && a.len() <= 64 && f.payload.len() == 76, 6503)?;
    config(&a[2])?;
    let artifact = verification::read_sealed(&a[7], 501)?;
    let reference = f.payload;
    require(
        artifact.actor == f.actor
            && reference[..32] == artifact.id
            && reference[32..64] == artifact.hash
            && u32_at(reference, 64)? as usize == artifact.total_len,
        6501,
    )?;
    let raw = a[7].try_borrow_data()?;
    let payload = &raw[verification::ARTIFACT_OFFSET..];
    require((84..=3116).contains(&payload.len()), 6503)?;
    let desc = root::descriptor(&payload[..4])?;
    let rent_key = key_at(payload, 4)?;
    let cap = u64_at(payload, 36)?;
    require(cap == u64_at(reference, 68)?, 6109)?;
    let plan = materials::decode_plan(&payload[44..])?;
    materials::assert_bom(&plan.debits)?;
    let dp = &payload[44 + plan.debit_offset..];
    let m = business_key(f);
    let instance = root::instance_id(&m);
    let output = &a[8];
    writable(output)?;
    valid_pda(output, &PROGRAM_ID, &[b"bio", b"root", &instance])?;
    new_target(output, 6505)?;
    let new_ids = plan
        .intakes
        .iter()
        .enumerate()
        .map(|(i, _)| materials::source_id(&domain(), &m, i as u16))
        .collect::<Result<Vec<_>, _>>()?;
    let mut project_ids = plan.intakes.iter().map(|i| i.project).collect::<Vec<_>>();
    project_ids.sort_unstable();
    project_ids.dedup();
    let mut mint_keys = plan
        .intakes
        .iter()
        .map(|i| (i.project, i.class))
        .collect::<Vec<_>>();
    mint_keys.sort_unstable();
    mint_keys.dedup();
    let mut source_ids = plan
        .debits
        .iter()
        .map(|g| g.source)
        .chain(new_ids.iter().copied())
        .collect::<Vec<_>>();
    source_ids.sort_unstable();
    source_ids.dedup();
    require(source_ids.len() <= 32, 6113)?;
    let project_at = 9;
    let mint_at = project_at + project_ids.len();
    let token_at = mint_at + mint_keys.len();
    let source_at = token_at + plan.intakes.len();
    let state_end = source_at + source_ids.len();
    require(a.len() >= state_end, 6503)?;
    let mut mint_rows = Vec::with_capacity(mint_keys.len());
    for (i, id) in project_ids.iter().enumerate() {
        writable(&a[project_at + i])?;
        launchpad::project(&a[project_at + i], id)?;
    }
    for (i, (id, class)) in mint_keys.iter().enumerate() {
        let pi = project_at + project_ids.binary_search(id).map_err(|_| err(6503))?;
        let project = launchpad::project(&a[pi], id)?;
        let c = project.classes[usize::from(*class - 1)];
        let mi = mint_at + i;
        writable(&a[mi])?;
        let supply = launchpad::pack_mint(&a[mi], id, *class)?;
        let total = plan
            .intakes
            .iter()
            .filter(|item| item.project == *id && item.class == *class)
            .try_fold(0u64, |n, item| add(n, item.units))?;
        require(
            supply <= c.issued - c.burned && supply >= total && add(c.burned, total)? <= c.issued,
            6107,
        )?;
        mint_rows.push(MintRow {
            project: *id,
            class: *class,
            project_index: pi,
            mint_index: mi,
            class_offset: 120 + project.classes_offset + usize::from(*class - 1) * 65,
            issued: c.issued,
            burned: c.burned,
            supply,
            total,
        });
    }
    let mut sources = Vec::with_capacity(source_ids.len());
    let mut owner_keys = Vec::new();
    for (i, id) in source_ids.iter().enumerate() {
        let index = source_at + i;
        let account = &a[index];
        writable(account)?;
        valid_pda(account, &PROGRAM_ID, &[b"bio", b"source", id])?;
        let ordinal = new_ids.iter().position(|new| new == id);
        let facts = if let Some(ordinal) = ordinal {
            new_target(account, 6108)?;
            let item = plan.intakes[ordinal];
            let group = plan
                .debits
                .iter()
                .find(|g| g.source == *id)
                .ok_or(err(6117))?;
            let mut maximum = 0u64;
            for debit in &group.entries {
                require(
                    debit.prefix == 0 && materials::class(debit.species)? == item.class,
                    6117,
                )?;
                maximum = maximum.max(debit.take);
            }
            let minimum = maximum / 1000 + u64::from(maximum % 1000 != 0);
            require(item.units == minimum && minimum > 0, 6117)?;
            SourceFacts {
                owner: item.owner,
                project: item.project,
                mint: launchpad::pack_address(&item.project, item.class, b"pack").0,
                class: item.class,
                units: item.units,
            }
        } else {
            materials::read_source(account, id)?
        };
        owner_keys.push(facts.owner);
        sources.push(SourceRow {
            id: *id,
            index,
            owner: facts.owner,
            class: facts.class,
            units: facts.units,
            new_ordinal: ordinal,
        });
    }
    owner_keys.push(rent_key);
    owner_keys.sort_unstable();
    owner_keys.dedup();
    owner_keys.retain(|key| *key != f.actor);
    require(a.len() == state_end + owner_keys.len(), 6503)?;
    for (key, account) in owner_keys.iter().zip(&a[state_end..]) {
        require(account.key == key, 6503)?;
    }
    let mut roles = owner_keys.clone();
    roles.push(f.actor);
    protected(a, state_end, &roles, &plan)?;
    for source in &sources {
        let owner = launchpad::role(a, &source.owner)?;
        require(
            owner.is_signer && owner.key.is_on_curve(),
            if source.new_ordinal.is_some() {
                6104
            } else {
                6111
            },
        )?;
    }
    let payer = launchpad::role(a, &rent_key)?;
    launchpad::ordinary_wallet(payer, true)?;
    for (i, item) in plan.intakes.iter().enumerate() {
        let row = mint_rows
            .iter()
            .find(|row| row.project == item.project && row.class == item.class)
            .ok_or(err(6503))?;
        let token_account = &a[token_at + i];
        writable(token_account)?;
        require(*token_account.key == item.token, 6503)?;
        require(
            token(
                token_account,
                a[row.mint_index].key,
                Some(&item.owner),
                false,
            )?
            .amount
                >= item.units,
            6105,
        )?;
    }
    for group in &plan.debits {
        let source = sources
            .iter()
            .find(|source| source.id == group.source)
            .ok_or(err(6110))?;
        let old = if source.new_ordinal.is_none() {
            Some(a[source.index].try_borrow_data()?)
        } else {
            None
        };
        for debit in &group.entries {
            require(materials::class(debit.species)? == source.class, 6113)?;
            let prefix = if let Some(ref old) = old {
                u64_at(old, 120 + 480 + usize::from(debit.species - 1) * 8)?
            } else {
                0
            };
            require(prefix == debit.prefix, 6112)?;
            require(
                add(prefix, debit.take)?
                    <= materials::initial_tick(source.class, source.units, debit.species)?,
                6114,
            )?;
        }
    }
    let root_length = 443usize.checked_add(dp.len()).ok_or(err(8020))?;
    let mut rent = add(need_rent(output, root_length)?, nonce_rent(&a[1])?)?;
    for source in &sources {
        if source.new_ordinal.is_some() {
            rent = add(rent, need_rent(&a[source.index], 856)?)?;
        }
    }
    require(rent <= cap, 6109)?;
    require(payer.lamports() >= rent, 6509)?;
    let clock = Clock::get()?;
    // Every descriptor, input, prefix, owner, BOM and rent obligation was checked
    // before this first destructive CPI. Any subsequent failure is native-atomic.
    let mut burned = [0u64; 4];
    for (i, item) in plan.intakes.iter().enumerate() {
        let row = mint_rows
            .iter()
            .find(|row| row.project == item.project && row.class == item.class)
            .ok_or(err(6503))?;
        let mint_account = &a[row.mint_index];
        let token_account = &a[token_at + i];
        let owner = launchpad::role(a, &item.owner)?;
        let before_supply = launchpad::pack_mint(mint_account, &item.project, item.class)?;
        let before = token(token_account, mint_account.key, Some(&item.owner), false)?;
        require(
            before.amount >= item.units && before_supply >= item.units,
            6105,
        )?;
        let mut data = vec![15];
        data.extend_from_slice(&item.units.to_le_bytes());
        data.push(0);
        token_cpi(
            &a[5],
            vec![
                AccountMeta::new(*token_account.key, false),
                AccountMeta::new(*mint_account.key, false),
                AccountMeta::new_readonly(item.owner, true),
            ],
            data,
            &[token_account.clone(), mint_account.clone(), owner.clone()],
            None,
        )?;
        require(
            launchpad::pack_mint(mint_account, &item.project, item.class)?
                == before_supply - item.units
                && token(token_account, mint_account.key, Some(&item.owner), false)?.amount
                    == before.amount - item.units,
            6116,
        )?;
        burned[usize::from(item.class - 1)] = add(burned[usize::from(item.class - 1)], item.units)?;
    }
    for row in &mint_rows {
        require(
            launchpad::pack_mint(&a[row.mint_index], &row.project, row.class)?
                == row.supply - row.total,
            6116,
        )?;
        let mut d = a[row.project_index].try_borrow_mut_data()?;
        require(
            u64_at(&d, row.class_offset + 49)? == row.issued
                && u64_at(&d, row.class_offset + 57)? == row.burned,
            6512,
        )?;
        d[row.class_offset + 57..row.class_offset + 65]
            .copy_from_slice(&add(row.burned, row.total)?.to_le_bytes());
    }
    for source in &sources {
        if let Some(ordinal) = source.new_ordinal {
            materials::write_source(
                &a[source.index],
                payer,
                &a[4],
                &source.id,
                &plan.intakes[ordinal],
                &m,
                ordinal as u16,
                &clock,
            )?;
        }
    }
    for group in &plan.debits {
        let source = sources
            .iter()
            .find(|source| source.id == group.source)
            .ok_or(err(6110))?;
        let mut d = a[source.index].try_borrow_mut_data()?;
        for debit in &group.entries {
            let at = 120 + 480 + usize::from(debit.species - 1) * 8;
            require(u64_at(&d, at)? == debit.prefix, 6112)?;
            d[at..at + 8].copy_from_slice(&add(debit.prefix, debit.take)?.to_le_bytes());
        }
    }
    for source in &sources {
        materials::read_source(&a[source.index], &source.id)?;
    }
    root::write_leaf(
        output, payer, &a[4], &m, &f.digest, &desc, dp, &f.actor, &clock,
    )?;
    let mut result = instance.to_vec();
    result.extend_from_slice(&desc);
    result.extend_from_slice(&1_000_000u32.to_le_bytes());
    result.extend_from_slice(&120_000u64.to_le_bytes());
    result.extend_from_slice(&45_000u64.to_le_bytes());
    result.extend_from_slice(&14_000u64.to_le_bytes());
    for n in burned {
        result.extend_from_slice(&n.to_le_bytes());
    }
    result.extend_from_slice(&(plan.intakes.len() as u16).to_le_bytes());
    result.extend_from_slice(&(plan.debits.len() as u16).to_le_bytes());
    result.extend_from_slice(&rent.to_le_bytes());
    require(result.len() == 108, 6512)?;
    Ok(result)
}
