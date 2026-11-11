//! Real input/lineage derivation and atomic one-way synthesis. No caller PASS.
use super::*;
use crate::verification::{read_sealed, ARTIFACT_OFFSET};
use biolab_kernel::graph::{self, Graph};

#[derive(Clone, Copy)]
pub(crate) struct Payload {
    pub target: u8,
    pub graph_at: usize,
    pub graph_len: usize,
    pub direct_at: usize,
    pub direct_count: usize,
    pub leaf_at: usize,
    pub leaf_count: usize,
    pub capsules: [(usize, usize); 60],
}
fn take(bytes: &[u8], at: &mut usize, n: usize) -> Result<usize, ProgramError> {
    let start = *at;
    *at = at.checked_add(n).ok_or(err(6600))?;
    require(*at <= bytes.len(), 6600)?;
    Ok(start)
}
pub(crate) fn parse_payload(bytes: &[u8]) -> Result<Payload, ProgramError> {
    require(
        bytes.len() >= 23
            && &bytes[..8] == b"BIOP7D01"
            && u16_at(bytes, 8)? == 1
            && bytes[11] == 0
            && u32_at(bytes, 12)? as usize == bytes.len() - 16,
        6600,
    )?;
    let target = bytes[10];
    let mut at = 16;
    let graph_len = u32_at(bytes, at)? as usize;
    at += 4;
    require((1..=7713).contains(&graph_len), 6600)?;
    let graph_at = take(bytes, &mut at, graph_len)?;
    let direct_count = usize::from(bytes[take(bytes, &mut at, 1)?]);
    require((2..=6).contains(&direct_count), 6600)?;
    let direct_at = take(bytes, &mut at, direct_count * 74)?;
    let leaf_at = take(bytes, &mut at, 1)?;
    let leaf_count = usize::from(bytes[leaf_at]);
    require(leaf_count <= 60, 6600)?;
    take(bytes, &mut at, leaf_count * 70)?;
    let capsule_count = usize::from(bytes[take(bytes, &mut at, 1)?]);
    require(capsule_count == leaf_count, 6600)?;
    let mut capsules = [(0, 0); 60];
    for place in capsules.iter_mut().take(leaf_count) {
        let len = u32_at(bytes, at)? as usize;
        at += 4;
        require((326..=3358).contains(&len), 6600)?;
        *place = (take(bytes, &mut at, len)?, len);
    }
    require(at == bytes.len() && bytes[graph_at + 10] == target, 6600)?;
    let roles = graph::members(target)?;
    require(leaf_count == roles.len() * 4, 6600)?;
    for (i, role) in roles.iter().enumerate() {
        for primitive in 1..=4usize {
            let offset = leaf_at + 1 + (i * 4 + primitive - 1) * 70;
            let row = &bytes[offset..offset + 70];
            require(
                row[0] == *role
                    && usize::from(row[1]) == primitive
                    && row[2..6]
                        == [
                            1,
                            0,
                            primitive as u8,
                            if primitive == 4 { *role } else { 0 },
                        ],
                6605,
            )?;
            for j in 0..i * 4 + primitive - 1 {
                require(
                    bytes[leaf_at + 1 + j * 70 + 6..leaf_at + 1 + j * 70 + 38] != row[6..38],
                    6605,
                )?;
            }
            let (start, len) = capsules[i * 4 + primitive - 1];
            require(
                hashv(&[&bytes[start..start + len]]).to_bytes() == row[38..70],
                6605,
            )?;
        }
    }
    let mut last = 0u16;
    for i in 0..direct_count {
        let d = &bytes[direct_at + i * 74..direct_at + (i + 1) * 74];
        let key = u16::from(d[0]) * 5 + u16::from(d[1]);
        require(key > last, 6605)?;
        last = key;
        for j in 0..i {
            require(
                bytes[direct_at + j * 74 + 2..direct_at + j * 74 + 34] != d[2..34],
                6605,
            )?;
        }
    }
    Ok(Payload {
        target,
        graph_at,
        graph_len,
        direct_at,
        direct_count,
        leaf_at,
        leaf_count,
        capsules,
    })
}
#[inline(never)]
pub(crate) fn parse_boxed(bytes: &[u8]) -> Result<Box<Payload>, ProgramError> {
    Ok(Box::new(parse_payload(bytes)?))
}

#[derive(Clone, Copy)]
struct Slice {
    source: [u8; 32],
    species: u16,
    lo: u64,
    hi: u64,
}
fn row_cmp(a: &Slice, b: &Slice) -> std::cmp::Ordering {
    a.source
        .cmp(&b.source)
        .then(a.species.cmp(&b.species))
        .then(a.lo.cmp(&b.lo))
        .then(a.hi.cmp(&b.hi))
}
fn same(a: &Slice, b: &Slice) -> bool {
    a.source == b.source && a.species == b.species
}
fn effective(s: u16) -> bool {
    s <= 24 || (29..=31).contains(&s)
}
fn credit(s: u16) -> u64 {
    if s <= 20 {
        6
    } else if s <= 28 {
        15
    } else if s <= 31 {
        40
    } else {
        120
    }
}
fn append_row(out: &mut Vec<u8>, row: Slice) {
    out.extend_from_slice(&row.source);
    out.extend_from_slice(&row.species.to_le_bytes());
    out.extend_from_slice(&row.lo.to_le_bytes());
    out.extend_from_slice(&row.hi.to_le_bytes());
}

/// Validate original immutable P5 bytes; these facts confer no current LIVE
/// status. A real direct Root (or an admitted parent's Artifact) authenticates
/// the capsule separately before this parser is trusted.
fn capsule_rows(
    capsule: &[u8],
    role: u8,
    primitive: u8,
    catalog: &[u8; 32],
    validator: &[u8; 32],
    rows: &mut Vec<Slice>,
) -> ProgramResult {
    require(
        capsule.len() >= 326
            && capsule.len() <= 3358
            && &capsule[..8] == b"BIOLAB\0\0"
            && u16_at(capsule, 8)? == 1
            && u16_at(capsule, 10)? == 12
            && u16_at(capsule, 12)? == 1
            && zeros(&capsule[14..16])
            && capsule[16..48] == domain()
            && capsule[48..80] == config_id()
            && u32_at(capsule, 80)? as usize == capsule.len() + 1
            && zeros(&capsule[85..88]),
        6606,
    )?;
    let id: [u8; 32] = capsule[120..152].try_into().unwrap();
    let m = &capsule[152..184];
    let (_, bump) = Pubkey::find_program_address(&[b"bio", b"root", &id], &PROGRAM_ID);
    require(
        capsule[84] == bump
            && capsule[88..120] == id
            && typed_hash(6, &[&domain(), m, &0u16.to_le_bytes()]) == id
            && capsule[216..248] == *catalog
            && capsule[248..280] == *validator
            && capsule[280..284] == [1, 0, primitive, if primitive == 4 { role } else { 0 }]
            && u32_at(capsule, 284)? == 1_000_000
            && u64_at(capsule, 288)? == 120_000
            && u64_at(capsule, 296)? == 45_000
            && capsule[304] == 1
            && capsule[305] == 0
            && i64_at(capsule, 306)? >= 0,
        6606,
    )?;
    let mut at = 322;
    let groups = u32_at(capsule, at)? as usize;
    at += 4;
    require(groups <= 32, 6606)?;
    let mut prior = None;
    let mut count = 0usize;
    let mut totals = [0u64; 32];
    for _ in 0..groups {
        let start = take(capsule, &mut at, 36)?;
        let source: [u8; 32] = capsule[start..start + 32].try_into().unwrap();
        let mask = u32_at(capsule, start + 32)?;
        require(
            mask != 0 && prior.map_or(true, |p: [u8; 32]| p < source),
            6606,
        )?;
        prior = Some(source);
        for bit in 0..32 {
            if mask & (1u32 << bit) == 0 {
                continue;
            }
            count += 1;
            require(count <= 128, 6606)?;
            let start = take(capsule, &mut at, 16)?;
            let lo = u64_at(capsule, start)?;
            let amount = u64_at(capsule, start + 8)?;
            require(amount > 0, 6606)?;
            let hi = add(lo, amount)?;
            totals[bit] = add(totals[bit], amount)?;
            rows.push(Slice {
                source,
                species: (bit + 1) as u16,
                lo,
                hi,
            });
        }
    }
    require(at == capsule.len(), 6606)?;
    for (i, total) in totals.iter().enumerate() {
        let species = i + 1;
        let expected = if species <= 24 {
            500
        } else if species == 25 {
            1000
        } else if species <= 28 {
            0
        } else {
            250
        };
        require(*total == expected, 6606)?;
    }
    Ok(())
}

pub(crate) struct Derived {
    pub graph: Graph,
    pub direct_sha: [u8; 32],
    pub leaf_sha: [u8; 32],
    pub union_sha: [u8; 32],
    pub semantic: [u8; 32],
    pub b: u64,
    pub retired: u64,
}

fn expected_direct(payload:&Payload,i:usize)->Result<(u8,u8,u16),ProgramError>{
    if payload.target<=15{require(payload.direct_count==4&&i<4,6607)?;Ok((payload.target,(i+1)as u8,1))}
    else if payload.target<=21{let roles=graph::members(payload.target)?;require(payload.direct_count==roles.len()&&i<roles.len(),6607)?;Ok((roles[i],0,2))}
    else{require(payload.target==22&&payload.direct_count==6&&i<6,6607)?;Ok(((16+i)as u8,0,3))}
}
pub(crate) fn current_direct(bytes:&[u8],payload:&Payload,i:usize,account:&AccountInfo,actor:&Pubkey,validator:&[u8;32])->Result<crate::root::RootFacts,ProgramError>{
    let(scope,primitive,schema)=expected_direct(payload,i)?;let root=crate::root::read_root(account)?;
    let d=&bytes[payload.direct_at+i*74..payload.direct_at+(i+1)*74];
    require(d[0]==scope&&d[1]==primitive&&root.schema==schema&&root.owner==*actor&&root.lifecycle==0
        &&root.revision==u64_at(d,34)?&&d[2..34]==*root.instance.as_ref()&&d[42..74]==root.fingerprint
        &&root.validator==*validator&&root.catalog==crate::materials::catalog_hash(),6608)?;
    if schema==1{require(root.descriptor==[1,0,primitive,if primitive==4{scope}else{0}],6608)?;}
    else{require(root.descriptor[0]==scope,6608)?;}Ok(root)
}

/// Authenticate current direct roots now. Historical proofs are bounded program
/// steps, completed before any resource is consumed.
pub(crate) fn prepare(bytes:&[u8],payload:&Payload,roots:&[AccountInfo],actor:&Pubkey,validator:&[u8;32],rule:&[u8;32])->Result<Derived,ProgramError>{
    require(roots.len()==payload.direct_count,6607)?;let g=graph::decode_graph(&bytes[payload.graph_at..payload.graph_at+payload.graph_len])?;
    require(g.domain==domain()&&g.config==config_id()&&g.catalog==crate::materials::catalog_hash()&&g.rule==*rule,6607)?;
    let mut b=0;let mut retired=0;
    for(i,account)in roots.iter().enumerate(){let root=current_direct(bytes,payload,i,account,actor,validator)?;b=add(b,root.b)?;retired=add(retired,root.retired)?;
        if payload.target<=15{let leaf=&bytes[payload.leaf_at+1+i*70..payload.leaf_at+1+(i+1)*70];let(start,len)=payload.capsules[i];let capsule=&bytes[start..start+len];let data=account.try_borrow_data()?;
            require(leaf[6..38]==*root.instance.as_ref()&&leaf[38..70]==root.fingerprint&&data.len()==len+121&&capsule[..322]==data[..322]&&capsule[322..]==data[443..],6608)?;}
    }
    require(b==(payload.leaf_count as u64)*120_000&&retired==(payload.leaf_count as u64)*45_000,6609)?;
    Ok(Derived{graph:g,direct_sha:hashv(&[&bytes[payload.direct_at..payload.direct_at+74*payload.direct_count]]).to_bytes(),
        leaf_sha:hashv(&[&bytes[payload.leaf_at..payload.leaf_at+1+70*payload.leaf_count]]).to_bytes(),union_sha:[0;32],semantic:[0;32],b,retired})
}
pub(crate) fn validate_capsule_at(bytes:&[u8],payload:&Payload,index:usize,validator:&[u8;32])->ProgramResult{
    require(index<payload.leaf_count,6606)?;let row=&bytes[payload.leaf_at+1+index*70..payload.leaf_at+1+(index+1)*70];let(start,len)=payload.capsules[index];
    capsule_rows(&bytes[start..start+len],row[0],row[1],&crate::materials::catalog_hash(),validator,&mut Vec::new())
}

/// Exact frozen anchor projection on two strictly validated graphs. Environment
/// anchors (None) remain in every partial graph; filtering by owner alone would
/// incorrectly drop those required shared fixture edges. Opens are uniquely
/// determined by retained edges; nodes and partial slots are fixed.
fn unchanged(parent:&Graph,child:&Graph)->ProgramResult{
    require(parent.domain==child.domain&&parent.config==child.config&&parent.catalog==child.catalog&&parent.rule==child.rule&&child.target!=22,6616)?;
    for c in &child.cells{require(parent.cells.iter().any(|p|p==c),6616)?;}
    for t in &child.tiers{require(parent.tiers.iter().any(|p|p==t),6616)?;}
    let roles=graph::members(child.target)?;let mut child_edges=child.edges.iter();
    for e in &parent.edges{let internal=[graph::anchor(e.src)?,graph::anchor(e.dst)?].iter().all(|anchor|anchor.map_or(true,|role|roles.contains(&role)));
        if internal{require(child_edges.next()==Some(e),6616)?;}}
    require(child_edges.next().is_none()&&child.slots.is_empty(),6616)
}
pub(crate) fn inherit_parent(bytes:&[u8],payload:&Payload,index:usize,root_account:&AccountInfo,child_artifact:&AccountInfo,actor:&Pubkey,validator:&[u8;32])->ProgramResult{
    require(payload.target>15,6616)?;let root=current_direct(bytes,payload,index,root_account,actor,validator)?;
    let original=read_sealed(child_artifact,702)?;let rd=root_account.try_borrow_data()?;
    require(rd[443..475]==original.id&&rd[475..507]==original.hash&&u32_at(&rd,507)?as usize==original.total_len,6616)?;
    let raw=child_artifact.try_borrow_data()?;let child_bytes=&raw[ARTIFACT_OFFSET..];let child_payload=parse_boxed(child_bytes)?;
    require(child_payload.target==root.descriptor[0]&&child_payload.leaf_count*120_000==root.b as usize
        &&hashv(&[&child_bytes[child_payload.graph_at..child_payload.graph_at+child_payload.graph_len]]).to_bytes()==rd[511..543]
        &&hashv(&[&child_bytes[child_payload.leaf_at..child_payload.leaf_at+1+70*child_payload.leaf_count]]).to_bytes()==rd[543..575],6616)?;
    let parent=graph::decode_graph(&bytes[payload.graph_at..payload.graph_at+payload.graph_len])?;
    let child=graph::decode_graph(&child_bytes[child_payload.graph_at..child_payload.graph_at+child_payload.graph_len])?;unchanged(&parent,&child)?;
    for j in 0..child_payload.leaf_count{
        let child_row=&child_bytes[child_payload.leaf_at+1+j*70..child_payload.leaf_at+1+(j+1)*70];
        let i=(0..payload.leaf_count).find(|i|{let at=payload.leaf_at+1+i*70;bytes[at]==child_row[0]&&bytes[at+1]==child_row[1]}).ok_or(err(6616))?;
        let parent_row=&bytes[payload.leaf_at+1+i*70..payload.leaf_at+1+(i+1)*70];require(parent_row==child_row,6616)?;
        let(pa,pl)=payload.capsules[i];let(ca,cl)=child_payload.capsules[j];require(pl==cl&&bytes[pa..pa+pl]==child_bytes[ca..ca+cl],6616)?;
    }Ok(())
}

/// First integration stage: four actually manufactured, current P5 components.
/// Parent inheritance is added through the same exact payload and Root guards;
/// unsupported stages are explicitly rejected rather than accepted as proofs.
pub(crate) fn derive_cell(
    bytes: &[u8],
    payload: &Payload,
    roots: &[AccountInfo],
    actor: &Pubkey,
    validator: &[u8; 32],
    rule: &[u8; 32],
) -> Result<Derived, ProgramError> {
    require(
        payload.target <= 15 && payload.direct_count == 4 && roots.len() == 4,
        6607,
    )?;
    let g = graph::decode_graph(&bytes[payload.graph_at..payload.graph_at + payload.graph_len])?;
    require(
        g.domain == domain() && g.config == config_id() && g.rule == *rule,
        6607,
    )?;
    let mut rows = Vec::new();
    let mut b = 0u64;
    let mut retired = 0u64;
    for (i, account) in roots.iter().enumerate() {
        let root = crate::root::read_root(account)?;
        let direct = &bytes[payload.direct_at + i * 74..payload.direct_at + (i + 1) * 74];
        let leaf = &bytes[payload.leaf_at + 1 + i * 70..payload.leaf_at + 1 + (i + 1) * 70];
        require(
            root.schema == 1
                && root.owner == *actor
                && root.lifecycle == 0
                && root.revision == u64_at(direct, 34)?
                && direct[0] == payload.target
                && usize::from(direct[1]) == i + 1
                && direct[2..34] == *root.instance.as_ref()
                && direct[42..74] == root.fingerprint
                && root.validator == *validator
                && root.catalog == g.catalog
                && leaf[6..38] == *root.instance.as_ref()
                && leaf[38..70] == root.fingerprint,
            6608,
        )?;
        let (start, len) = payload.capsules[i];
        let capsule = &bytes[start..start + len];
        let data = account.try_borrow_data()?;
        require(
            data.len() == len + 121
                && capsule[..322] == data[..322]
                && capsule[322..] == data[443..],
            6608,
        )?;
        capsule_rows(
            capsule,
            payload.target,
            (i + 1) as u8,
            &g.catalog,
            validator,
            &mut rows,
        )?;
        b = add(b, root.b)?;
        retired = add(retired, root.retired)?;
    }
    rows.sort_unstable_by(row_cmp);
    let mut previous: Option<Slice> = None;
    let mut merged: Vec<Slice> = Vec::new();
    let mut effective_credit = 0u64;
    let mut retired_credit = 0u64;
    for row in rows {
        if let Some(prior) = previous {
            require(!same(&prior, &row) || row.lo >= prior.hi, 6609)?;
        }
        previous = Some(row);
        let amount = (row.hi - row.lo)
            .checked_mul(credit(row.species))
            .ok_or(err(8020))?;
        if effective(row.species) {
            effective_credit = add(effective_credit, amount)?;
            if let Some(last) = merged.last_mut() {
                if same(last, &row) && last.hi == row.lo {
                    last.hi = row.hi;
                    continue;
                }
            }
            merged.push(row);
        } else {
            retired_credit = add(retired_credit, amount)?;
        }
    }
    require(
        b == 480_000 && retired == 180_000 && effective_credit == b && retired_credit == retired,
        6609,
    )?;
    let mut encoded = Vec::with_capacity(4 + 50 * merged.len());
    encoded.extend_from_slice(&(merged.len() as u32).to_le_bytes());
    for row in merged {
        append_row(&mut encoded, row);
    }
    let union_sha = hashv(&[&encoded]).to_bytes();
    let leaf_sha =
        hashv(&[&bytes[payload.leaf_at..payload.leaf_at + 1 + 70 * payload.leaf_count]]).to_bytes();
    let direct_sha =
        hashv(&[&bytes[payload.direct_at..payload.direct_at + 74 * payload.direct_count]])
            .to_bytes();
    let semantic = semantic_id(&g)?;
    Ok(Derived {
        graph: g,
        direct_sha,
        leaf_sha,
        union_sha,
        semantic,
        b,
        retired,
    })
}

#[path="semantic.rs"]mod semantic;
pub(crate) use semantic::semantic_id;

fn burn_fee<'a>(a: &[AccountInfo<'a>], amount: u64) -> ProgramResult {
    let mint_account = &a[10];
    let source = &a[11];
    let book_account = &a[12];
    let reserve = &a[13];
    for account in [mint_account, source, book_account] {
        writable(account)?;
    }
    valid_pda(reserve, &PROGRAM_ID, &[b"bio", b"lab-reserve"])?;
    require(source.key != reserve.key, 8012)?;
    let supply = mint(mint_account)?;
    let source_before = token(source, mint_account.key, Some(a[0].key), false)?;
    let rb = token(
        reserve,
        mint_account.key,
        Some(&pda(&PROGRAM_ID, b"lab-auth").0),
        true,
    )?;
    let mut book = treasury(book_account, rb.amount, supply)?;
    require(source_before.amount >= amount, 8018)?;
    let mut data = vec![15];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(6);
    token_cpi(
        &a[5],
        vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new(*mint_account.key, false),
            AccountMeta::new_readonly(*a[0].key, true),
        ],
        data,
        &[source.clone(), mint_account.clone(), a[0].clone()],
        None,
    )?;
    require(
        mint(mint_account)? == supply.checked_sub(amount).ok_or(err(8020))?
            && token(source, mint_account.key, Some(a[0].key), false)?.amount
                == source_before.amount - amount
            && token(reserve, mint_account.key, Some(&rb.owner), true)?.amount == rb.amount,
        8017,
    )?;
    book[4] = add(book[4], amount)?;
    write_treasury(book_account, book)?;
    treasury(book_account, rb.amount, supply - amount)?;
    Ok(())
}

/// No re-execution report is supplied by the caller. The program-owned session
/// and immutable Artifact fix prior complete execution; current Roots and mining
/// guards are checked again in the actual burn/consume/create transaction.
#[inline(never)]
fn final_payload(bytes:&[u8],state:&crate::verification::Verified)->Result<Box<Payload>,ProgramError>{
    let end=state.graph_at.checked_add(state.graph_len).ok_or(err(6615))?;
    let direct_at=end.checked_add(1).ok_or(err(6615))?;let direct_count=usize::from(state.direct_count);let leaf_count=usize::from(state.leaf_count);
    require(end<bytes.len()&&usize::from(bytes[end])==direct_count&&direct_count>=2&&direct_count<=6
        &&direct_at+direct_count*74==state.leaf_at&&state.leaf_at+1+leaf_count*70<=bytes.len()
        &&usize::from(bytes[state.leaf_at])==leaf_count&&bytes[state.graph_at+10]==state.kernel.session.target
        &&hashv(&[&bytes[state.graph_at..end]]).to_bytes()==state.kernel.session.graph_sha
        &&hashv(&[&bytes[direct_at..direct_at+direct_count*74]]).to_bytes()==state.direct_sha
        &&hashv(&[&bytes[state.leaf_at..state.leaf_at+1+leaf_count*70]]).to_bytes()==state.leaf_sha,6615)?;
    Ok(Box::new(Payload{target:state.kernel.session.target,graph_at:state.graph_at,graph_len:state.graph_len,direct_at,direct_count,leaf_at:state.leaf_at,leaf_count,capsules:[(0,0);60]}))
}

#[inline(never)]
fn prepare_registration(a:&[AccountInfo],f:&Frame,state:&crate::verification::Verified,target:u8,tail:usize,now:&Clock)->Result<Box<crate::originality::PreparedAdmission>,ProgramError>{
    let facts=crate::originality::AdmissionFacts{artifact:state.artifact,payload_sha:state.artifact_sha,graph_sha:state.kernel.session.graph_sha,
        leaf_sha:state.leaf_sha,semantic:state.semantic,target,challenge:state.kernel.session.challenge,quality:state.kernel.quality,task:state.kernel.task,cost:state.kernel.cost,transcript:state.kernel.session.digest,positive:state.kernel.session.positive};
    crate::originality::prepare_synth(a,f,&facts,tail,now)
}

pub(crate) fn finalize<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len()>=15&&(f.payload.len()==124||(f.payload.len()==189&&f.payload[124]==1)),6600)?;
    let (validator, _rule) = config_hashes(&a[2])?;
    let mut state = crate::verification::Verified::read_boxed(&a[8])?;
    writable(&a[8])?;
    let p = f.payload;
    require(
        !state.used
            && state.kernel.actor == f.actor.to_bytes()
            && state.kernel.validator == validator
            && p[..32] == state.artifact
            && p[32..64] == state.artifact_sha
            && u32_at(p, 64)? as usize == state.artifact_len
            && u64_at(p, 68)? == state.kernel.generation
            && p[76..108] == state.kernel.session.digest
            && state.kernel.session.cursor == 73 && state.phase == 6,
        6615,
    )?;
    let now = Clock::get()?;
    require(now.unix_timestamp >= state.kernel.clock, 6614)?;
    state.check_artifact(&a[7])?;
    let raw = a[7].try_borrow_data()?;
    let bytes = &raw[ARTIFACT_OFFSET..];
    // All heavy proof work is already program-derived and bound to this exact
    // immutable Artifact. FINAL repeats current direct-input CAS, not 73 rounds.
    let payload = final_payload(bytes,&state)?;
    let tail=15+2*payload.direct_count;
    let report=biolab_kernel::runtime::KernelReport{quality:state.kernel.quality,task_applicable:state.kernel.task,cost:state.kernel.cost,rounds:73,
        positive:state.kernel.session.positive,model_digest:state.kernel.session.digest,cases:state.kernel.session.cases};
    // Every synthesized upper-layer Root is disclosed atomically. Applicable
    // BIO also registers true verified Knowledge through the same transition.
    let registration=prepare_registration(a,f,&state,payload.target,tail,&now)?;
    let root_count = payload.direct_count;
    let roots = &a[15..15 + root_count];
    let registrations = &a[15 + root_count..15 + 2 * root_count];
    let mut sum_b = 0u64;
    let mut sum_retired = 0u64;
    // These facts come only from this instruction's fresh strict Root decoder.
    // No client field or old verification session can supply this vector.
    let mut prechecked=Vec::with_capacity(root_count);
    let mut rent = add(nonce_rent(&a[1])?, need_rent(&a[9], 761)?)?;
    rent=add(rent,registration.rent)?;
    rent = add(rent, crate::settlement::registry_rent(&a[14])?)?;
    for (i, (account, registration)) in roots.iter().zip(registrations.iter()).enumerate() {
        let root=current_direct(bytes,&payload,i,account,&f.actor,&validator)?;
        crate::settlement::assert_movable(registration, &root.instance, &a[2], now.unix_timestamp)?;
        rent = add(
            rent,
            crate::settlement::movement_rent(registration, &root.instance)?,
        )?;
        sum_b = add(sum_b, root.b)?;
        sum_retired = add(sum_retired, root.retired)?;
        prechecked.push(root);
    }
    require(sum_b == state.b && sum_retired == state.retired, 6615)?;
    let rate = if payload.target <= 15 {
        200_000u128
    } else if payload.target <= 21 {
        400_000
    } else {
        200_000
    };
    let fee =
        u64::try_from(((state.b as u128) * rate + 119_999) / 120_000).map_err(|_| err(8020))?;
    require(fee <= u64_at(p, 108)?, 8015)?;
    check_budget(a, rent, u64_at(p, 116)?)?;
    let m = business_key(f);
    let id = crate::root::instance_id(&m);
    writable(&a[9])?;
    valid_pda(&a[9], &PROGRAM_ID, &[b"bio", b"root", &id])?;
    // All effects below are native SVM state changes, and roll back together.
    burn_fee(a, fee)?;
    allocate(
        &a[0],
        &a[9],
        &a[4],
        &PROGRAM_ID,
        761,
        &[b"bio", b"root", &id],
    )?;
    let schema = if payload.target <= 15 {
        2
    } else if payload.target <= 21 {
        3
    } else {
        4
    };
    let bump = valid_pda(&a[9], &PROGRAM_ID, &[b"bio", b"root", &id])?;
    write_header(&a[9], 12, schema, &id, bump)?;
    {
        let mut d = a[9].try_borrow_mut_data()?;
        let body = &mut d[120..];
        body[..32].copy_from_slice(&id);
        body[32..64].copy_from_slice(&m);
        body[64..96].copy_from_slice(&f.digest);
        body[96..128].copy_from_slice(&crate::materials::catalog_hash());
        body[128..160].copy_from_slice(&validator);
        body[160..164].copy_from_slice(&[
            payload.target,
            if schema == 2 {
                1
            } else if schema == 3 {
                2
            } else {
                3
            },
            if schema == 2 {
                payload.target
            } else if schema == 3 {
                payload.target - 15
            } else {
                0
            },
            0,
        ]);
        body[164..168].copy_from_slice(&report.quality.to_le_bytes());
        body[168..176].copy_from_slice(&state.b.to_le_bytes());
        body[176..184].copy_from_slice(&state.retired.to_le_bytes());
        body[184] = 2;
        body[185] = u8::from(report.task_applicable);
        body[186..194].copy_from_slice(&now.unix_timestamp.to_le_bytes());
        body[194..202].copy_from_slice(&now.slot.to_le_bytes());
        body[202..234].copy_from_slice(f.actor.as_ref());
        body[323..355].copy_from_slice(&state.artifact);
        body[355..387].copy_from_slice(&state.artifact_sha);
        body[387..391].copy_from_slice(&(state.artifact_len as u32).to_le_bytes());
        body[391..423].copy_from_slice(&state.kernel.session.graph_sha);
        body[423..455].copy_from_slice(&state.leaf_sha);
        body[455..487].copy_from_slice(&state.union_sha);
        body[487..491].copy_from_slice(&state.kernel.session.challenge.to_le_bytes());
        body[491..495].copy_from_slice(&2u32.to_le_bytes());
        body[495..499].copy_from_slice(&1u32.to_le_bytes());
        body[499..503].copy_from_slice(&1u32.to_le_bytes());
        body[503..535].copy_from_slice(&report.model_digest);
        body[535..599].copy_from_slice(&report.positive);
        body[599..607].copy_from_slice(&report.cost.to_le_bytes());
        body[607..639].copy_from_slice(&state.semantic);
        body[639] = root_count as u8;
        body[640] = payload.leaf_count as u8;
    }
    for (i, ((account, registration),before)) in roots.iter().zip(registrations.iter()).zip(prechecked.iter()).enumerate() {
        let direct = &bytes[payload.direct_at + i * 74..payload.direct_at + (i + 1) * 74];
        let instance = key_at(direct, 2)?;
        crate::settlement::mark_consumed(a, &a[14], registration, &instance, f)?;
        crate::root::consume_prechecked(account,before,&f.actor,u64_at(direct,34)?,&id,&m,&now)?;
    }
    // commit_synth strictly decodes this actual new Root and checks its owner,
    // instance, LIVE/revision, Clock, q and exact evidence fields. Repeating the
    // same full decoder here only spends CU; the stronger check remains below.
    crate::originality::commit_synth(a,f,&registration)?;
    state.used = true;
    state.kernel.clock = now.unix_timestamp;
    state.write(&a[8])?;
    let mut result = id.to_vec();
    result.extend_from_slice(&report.quality.to_le_bytes());
    result.extend_from_slice(&state.b.to_le_bytes());
    result.extend_from_slice(&state.retired.to_le_bytes());
    result.extend_from_slice(&fee.to_le_bytes());
    result.extend_from_slice(&report.model_digest);
    result.extend_from_slice(&state.semantic);
    result.extend_from_slice(&state.artifact);
    Ok(result)
}

#[cfg(test)]mod projection_tests{
    use super::*;
    #[test]fn bounded_inheritance_is_equal_to_frozen_projection_for_all_subtrees(){
        let directory=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/graphs");
        for file in ["candidate-c320.bin","candidate-c324.bin","seed-00.bin","seed-11.bin"]{
            let parent=graph::decode_graph(&std::fs::read(directory.join(file)).unwrap()).unwrap();
            for target in 1..=21{let child=graph::project_graph(&parent,target).unwrap();unchanged(&parent,&child).unwrap_or_else(|e|panic!("{file} target{target}: {e:?}"));
                let mut changed=child.clone();changed.tiers[0].mode^=1;graph::validate_graph(&changed).unwrap();assert!(unchanged(&parent,&changed).is_err());
                if target>15{for role in graph::members(target).unwrap(){let leaf=graph::project_graph(&child,role).unwrap();unchanged(&child,&leaf).unwrap_or_else(|e|panic!("{file} organ{target} leaf{role}: {e:?}"));}}
            }
        }
    }
}
