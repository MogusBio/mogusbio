//! Native ARTREF transport and program-owned deterministic verification sessions.
//! Pre-code gates: bounded sequential writes, exact sealed bytes, trusted Config,
//! no caller q/PASS/state, cursor+generation CAS, and final live-input recheck.
use super::*;

#[path="heap.rs"]mod heap;

pub(crate) const ARTIFACT_OFFSET: usize = 251;
pub(crate) const ARTIFACT_MAX: usize = 262_144;
pub(crate) const CHUNK: usize = 1024;

#[derive(Clone, Copy)]
pub(crate) struct ArtifactView {
    pub id: [u8; 32],
    pub actor: Pubkey,
    pub hash: [u8; 32],
    pub total_len: usize,
    pub kind: u16,
    pub written: usize,
    pub seq: u64,
}

fn artifact_id(actor: &Pubkey, kind: u16, total: usize, hash: &[u8; 32]) -> [u8; 32] {
    typed_hash(
        19,
        &[
            &domain(),
            &config_id(),
            actor.as_ref(),
            &kind.to_le_bytes(),
            &(total as u32).to_le_bytes(),
            hash,
        ],
    )
}

fn view(account: &AccountInfo, kind: u16, sealed: bool) -> Result<ArtifactView, ProgramError> {
    require(account.data_len() >= ARTIFACT_OFFSET, 6600)?;
    let d = account.try_borrow_data()?;
    let b = &d[HEADER..];
    let id: [u8; 32] = b[..32].try_into().unwrap();
    let actor = key_at(b, 32)?;
    let total = u32_at(b, 66)? as usize;
    let written = u32_at(b, 102)? as usize;
    let hash = b[70..102].try_into().unwrap();
    let seq = u64_at(b, 106)?;
    require(
        [501, 702, crate::originality::BLUEPRINT_KIND].contains(&kind)
            && u16_at(b, 64)? == kind
            && total > 0
            && total <= ARTIFACT_MAX
            && written > 0
            && written <= total
            && d.len() == ARTIFACT_OFFSET + written
            && seq > 0
            && id == artifact_id(&actor, kind, total, &hash)
            && b[114] <= 1,
        6600,
    )?;
    if sealed {
        require(
            b[114] == 1 && written == total && i64_at(b, 115)? >= 0,
            6601,
        )?;
    } else {
        require(
            b[114] == 0 && i64_at(b, 115)? == 0 && u64_at(b, 123)? == 0,
            6601,
        )?;
    }
    drop(d);
    header(
        account,
        &PROGRAM_ID,
        24,
        1,
        ARTIFACT_OFFSET + written,
        &id,
        &[b"bio", b"artifact", &id],
    )?;
    Ok(ArtifactView {
        id,
        actor,
        hash,
        total_len: total,
        kind,
        written,
        seq,
    })
}

pub(crate) fn read_sealed(account: &AccountInfo, kind: u16) -> Result<ArtifactView, ProgramError> {
    let v = view(account, kind, true)?;
    let d = account.try_borrow_data()?;
    require(hashv(&[&d[ARTIFACT_OFFSET..]]).to_bytes() == v.hash, 6602)?;
    Ok(v)
}

fn top_up<'a>(
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    amount: u64,
) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    invoke(
        &Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![
                AccountMeta::new(*payer.key, true),
                AccountMeta::new(*target.key, false),
            ],
            data,
        },
        &[payer.clone(), target.clone(), system.clone()],
    )
}

pub(crate) fn put<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 8 && f.payload.len() >= 60, 6600)?;
    config(&a[2])?;
    let p = f.payload;
    let kind = u16_at(p, 0)?;
    let total = u32_at(p, 2)? as usize;
    let hash: [u8; 32] = p[6..38].try_into().unwrap();
    let seq = u64_at(p, 38)?;
    let offset = u32_at(p, 46)? as usize;
    let count = u16_at(p, 50)? as usize;
    require(
        [501, 702, crate::originality::BLUEPRINT_KIND].contains(&kind)
            && total > 0
            && total <= ARTIFACT_MAX
            && offset < total
            && offset % CHUNK == 0
            && count == (total - offset).min(CHUNK)
            && p.len() == 60 + count,
        6600,
    )?;
    let cap = u64_at(p, 52 + count)?;
    let chunk = &p[52..52 + count];
    let id = artifact_id(&f.actor, kind, total, &hash);
    let artifact = &a[7];
    writable(artifact)?;
    valid_pda(artifact, &PROGRAM_ID, &[b"bio", b"artifact", &id])?;
    let fresh = artifact.owner == &SYSTEM_ID && artifact.data_is_empty();
    let (old_written, old_seq) = if fresh {
        require(offset == 0 && seq == 0, 6603)?;
        (0, 0)
    } else {
        let old = view(artifact, kind, false)?;
        require(old.id == id && old.actor == f.actor && old.seq == seq, 6603)?;
        (old.written, old.seq)
    };
    require(offset == old_written || offset + count <= old_written, 6604)?;
    let new_written = old_written.max(offset + count);
    let length = ARTIFACT_OFFSET + new_written;
    let needed = if fresh {
        need_rent(artifact, length)?
    } else {
        Rent::get()?
            .minimum_balance(length)
            .max(1)
            .saturating_sub(artifact.lamports())
    };
    check_budget(a, add(needed, nonce_rent(&a[1])?)?, cap)?;
    if fresh {
        allocate(
            &a[0],
            artifact,
            &a[4],
            &PROGRAM_ID,
            length,
            &[b"bio", b"artifact", &id],
        )?;
        let bump = valid_pda(artifact, &PROGRAM_ID, &[b"bio", b"artifact", &id])?;
        write_header(artifact, 24, 1, &id, bump)?;
    } else if length != artifact.data_len() {
        require(
            length > artifact.data_len() && length - artifact.data_len() <= CHUNK,
            6604,
        )?;
        top_up(&a[0], artifact, &a[4], needed)?;
        artifact.resize(length)?;
    }
    {
        let mut d = artifact.try_borrow_mut_data()?;
        d[80..84].copy_from_slice(&((length - HEADER) as u32).to_le_bytes());
        let b = &mut d[HEADER..];
        b[..32].copy_from_slice(&id);
        b[32..64].copy_from_slice(f.actor.as_ref());
        b[64..66].copy_from_slice(&kind.to_le_bytes());
        b[66..70].copy_from_slice(&(total as u32).to_le_bytes());
        b[70..102].copy_from_slice(&hash);
        b[102..106].copy_from_slice(&(new_written as u32).to_le_bytes());
        b[106..114].copy_from_slice(&add(old_seq, 1)?.to_le_bytes());
        b[131 + offset..131 + offset + count].copy_from_slice(chunk);
    }
    let mut result = id.to_vec();
    result.extend_from_slice(&(new_written as u32).to_le_bytes());
    result.extend_from_slice(&add(old_seq, 1)?.to_le_bytes());
    result.push(0);
    Ok(result)
}

pub(crate) fn seal<'a>(a: &[AccountInfo<'a>], f: &Frame) -> Result<Vec<u8>, ProgramError> {
    require(a.len() == 8 && f.payload.len() == 50, 6600)?;
    config(&a[2])?;
    let kind = u16_at(f.payload, 0)?;
    let v = view(&a[7], kind, false)?;
    require(
        v.actor == f.actor
            && f.payload[2..34] == v.id
            && u64_at(f.payload, 34)? == v.seq
            && v.written == v.total_len,
        6603,
    )?;
    let now = Clock::get()?;
    require(now.unix_timestamp >= 0, 6600)?;
    writable(&a[7])?;
    check_budget(a, nonce_rent(&a[1])?, u64_at(f.payload, 42)?)?;
    {
        let d = a[7].try_borrow_data()?;
        require(hashv(&[&d[ARTIFACT_OFFSET..]]).to_bytes() == v.hash, 6602)?;
    }
    {
        let mut d = a[7].try_borrow_mut_data()?;
        d[234] = 1;
        d[235..243].copy_from_slice(&now.unix_timestamp.to_le_bytes());
        d[243..251].copy_from_slice(&now.slot.to_le_bytes());
    }
    let mut result = v.id.to_vec();
    result.extend_from_slice(&v.hash);
    result.extend_from_slice(&(v.total_len as u32).to_le_bytes());
    result.extend_from_slice(&now.unix_timestamp.to_le_bytes());
    Ok(result)
}

#[path="provenance.rs"] pub(crate) mod provenance;
pub(crate) const VERIFY_LEN:usize=4096;
const KERNEL_AT:usize=364;
const PROV_AT:usize=KERNEL_AT+biolab_kernel::scratch::BYTES;
/// Phases: inheritance0, capsule/BOM1, count/overlap2, ordinary-SHA3,
/// semantic4, biological physics5, complete6. Economic effects occur later.
pub(crate) struct Verified {
    pub artifact:[u8;32],pub artifact_sha:[u8;32],pub artifact_len:usize,
    pub graph_at:usize,pub graph_len:usize,pub leaf_at:usize,pub leaf_count:u8,pub direct_count:u8,
    pub direct_sha:[u8;32],pub leaf_sha:[u8;32],pub union_sha:[u8;32],pub semantic:[u8;32],
    pub b:u64,pub retired:u64,pub used:bool,pub phase:u8,pub seq:u16,pub progress:u16,
    pub kernel:biolab_kernel::scratch::Scratch,pub provenance:Box<provenance::Provenance>,
}
impl Verified {
    #[inline(never)]
    pub(crate) fn read_boxed(a:&AccountInfo)->Result<Box<Self>,ProgramError>{Ok(Box::new(Self::read(a)?))}
    #[inline(never)]
    fn read(a:&AccountInfo)->Result<Self,ProgramError>{
        require(a.data_len()==VERIFY_LEN,6610)?;let d=a.try_borrow_data()?;let actor=key_at(&d,88)?;drop(d);
        header(a,&PROGRAM_ID,37,3,VERIFY_LEN,actor.as_array(),&[b"bio",b"verify",actor.as_ref()])?;
        let d=a.try_borrow_data()?;require(&d[120..128]==b"BIOVFY04"&&d[210]<=1&&d[211]<=6&&u16_at(&d,324)?<=1024&&zeros(&d[328..332])&&zeros(&d[PROV_AT+provenance::BYTES..]),6610)?;
        let kernel=biolab_kernel::scratch::Scratch::decode(&d[KERNEL_AT..PROV_AT])?;let phase=d[211];
        require(kernel.actor==actor.to_bytes()&&kernel.config==config_id()
            &&((phase<5&&kernel.session.cursor==0)||(phase==5&&kernel.session.cursor<73)||(phase==6&&kernel.session.cursor==73))
            &&(d[210]==0||phase==6),6610)?;
        Ok(Self{artifact:d[128..160].try_into().unwrap(),artifact_sha:d[160..192].try_into().unwrap(),artifact_len:u32_at(&d,192)?as usize,
            graph_at:u32_at(&d,196)?as usize,graph_len:u32_at(&d,200)?as usize,leaf_at:u32_at(&d,204)?as usize,leaf_count:d[208],direct_count:d[209],used:d[210]==1,
            phase,seq:u16_at(&d,324)?,progress:u16_at(&d,326)?,direct_sha:d[212..244].try_into().unwrap(),leaf_sha:d[244..276].try_into().unwrap(),union_sha:d[276..308].try_into().unwrap(),
            b:u64_at(&d,308)?,retired:u64_at(&d,316)?,semantic:d[332..364].try_into().unwrap(),kernel,provenance:provenance::Provenance::decode_boxed(&d[PROV_AT..PROV_AT+provenance::BYTES])?})
    }
    pub(crate) fn write(&self,a:&AccountInfo)->ProgramResult{
        let mut d=a.try_borrow_mut_data()?;require(d.len()==VERIFY_LEN,6610)?;d[120..].fill(0);d[120..128].copy_from_slice(b"BIOVFY04");
        d[128..160].copy_from_slice(&self.artifact);d[160..192].copy_from_slice(&self.artifact_sha);
        for(at,value)in[(192,self.artifact_len),(196,self.graph_at),(200,self.graph_len),(204,self.leaf_at)]{d[at..at+4].copy_from_slice(&(value as u32).to_le_bytes());}
        d[208]=self.leaf_count;d[209]=self.direct_count;d[210]=u8::from(self.used);d[211]=self.phase;
        d[212..244].copy_from_slice(&self.direct_sha);d[244..276].copy_from_slice(&self.leaf_sha);d[276..308].copy_from_slice(&self.union_sha);
        d[308..316].copy_from_slice(&self.b.to_le_bytes());d[316..324].copy_from_slice(&self.retired.to_le_bytes());d[324..326].copy_from_slice(&self.seq.to_le_bytes());d[326..328].copy_from_slice(&self.progress.to_le_bytes());d[332..364].copy_from_slice(&self.semantic);
        self.kernel.encode(&mut d[KERNEL_AT..PROV_AT])?;self.provenance.encode(&mut d[PROV_AT..PROV_AT+provenance::BYTES])
    }
    pub(crate) fn result(&self)->Vec<u8>{
        let mut b=self.kernel.result();b[..8].copy_from_slice(b"BIOVSR03");b[16..18].copy_from_slice(&self.seq.to_le_bytes());b[18]=self.phase;b[25..27].copy_from_slice(&self.kernel.session.cursor.to_le_bytes());b.to_vec()
    }
    fn bound_artifact(&self,a:&AccountInfo,full_sha:bool)->Result<ArtifactView,ProgramError>{
        // A program-owned SEALED Artifact has no mutable/close path. Physics
        // steps borrow and hash exact graph bytes, without rehashing all the
        // already-validated historical capsules each time. BEGIN, provenance,
        // inheritance and FINAL verify the full ordinary payload SHA.
        let v=if full_sha{read_sealed(a,702)?}else{view(a,702,true)?};
        require(v.id==self.artifact&&v.hash==self.artifact_sha&&v.total_len==self.artifact_len,6611)?;Ok(v)
    }
    pub(crate) fn check_artifact(&self,a:&AccountInfo)->Result<ArtifactView,ProgramError>{self.bound_artifact(a,true)}
}

pub(crate) fn begin<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(f.payload.len()==88&&a.len()>=9,6600)?;let(validator,rule)=config_hashes(&a[2])?;
    let artifact=read_sealed(&a[7],702)?;require(f.payload[..32]==artifact.id&&f.payload[32..64]==artifact.hash&&u32_at(f.payload,64)?as usize==artifact.total_len,6611)?;
    let challenge=u32_at(f.payload,68)?;require((500_000..=2_000_000).contains(&challenge)&&challenge%1000==0,6600)?;let expected=u64_at(f.payload,72)?;let cap=u64_at(f.payload,80)?;
    let now=Clock::get()?;let state=&a[8];writable(state)?;valid_pda(state,&PROGRAM_ID,&[b"bio",b"verify",f.actor.as_ref()])?;
    let fresh=state.owner==&SYSTEM_ID&&state.data_is_empty();let(old,old_clock)=crate::originality::prior_session(state,&f.actor)?;require(old==expected&&now.unix_timestamp>=old_clock,6612)?;
    let raw=a[7].try_borrow_data()?;let bytes=&raw[ARTIFACT_OFFSET..];let payload=crate::synthesis::parse_boxed(bytes)?;require(a.len()==9+payload.direct_count,6600)?;
    require(![3,9,14,15,21].contains(&payload.target)||challenge==2_000_000,6600)?;
    let derived=crate::synthesis::prepare(bytes,&payload,&a[9..],&f.actor,&validator,&rule)?;
    let session=biolab_kernel::runtime::begin_session(&derived.graph,challenge,hashv(&[&bytes[payload.graph_at..payload.graph_at+payload.graph_len]]).to_bytes())?;
    let needed=if fresh{need_rent(state,VERIFY_LEN)?}else{0};check_budget(a,add(needed,nonce_rent(&a[1])?)?,cap)?;
    if fresh{allocate(&a[0],state,&a[4],&PROGRAM_ID,VERIFY_LEN,&[b"bio",b"verify",f.actor.as_ref()])?;}let bump=valid_pda(state,&PROGRAM_ID,&[b"bio",b"verify",f.actor.as_ref()])?;write_header(state,37,3,f.actor.as_array(),bump)?;
    let kernel=biolab_kernel::scratch::Scratch{generation:add(expected,1)?,clock:now.unix_timestamp,actor:f.actor.to_bytes(),config:config_id(),validator,direct:derived.direct_sha,last_from:u16::MAX,last_count:0,last_request:[0;32],session,quality:0,task:false,cost:0};
    let value=Verified{artifact:artifact.id,artifact_sha:artifact.hash,artifact_len:artifact.total_len,graph_at:payload.graph_at,graph_len:payload.graph_len,leaf_at:payload.leaf_at,leaf_count:payload.leaf_count as u8,direct_count:payload.direct_count as u8,
        direct_sha:derived.direct_sha,leaf_sha:derived.leaf_sha,union_sha:[0;32],semantic:[0;32],b:derived.b,retired:derived.retired,used:false,phase:if payload.target<=15{1}else{0},seq:0,progress:0,kernel,provenance:provenance::Provenance::new_boxed()};
    value.write(state)?;Ok(value.result())
}

pub(crate) fn step<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()>=9&&f.payload.len()==84&&f.payload[43]==0,6600)?;let(validator,_)=config_hashes(&a[2])?;writable(&a[8])?;
    let mut state=Verified::read_boxed(&a[8])?;require(!state.used&&state.kernel.validator==validator,6612)?;let p=f.payload;
    let generation=u64_at(p,32)?;let cursor=u16_at(p,40)?;let count=p[42];let prior:[u8;32]=p[44..76].try_into().unwrap();
    require(p[..32]==state.artifact&&generation==state.kernel.generation&&(1..=2).contains(&count),6612)?;check_budget(a,nonce_rent(&a[1])?,u64_at(p,76)?)?;
    let request=hashv(&[&p[..76]]).to_bytes();if state.kernel.last_from==cursor&&state.kernel.last_count==count&&state.kernel.last_request==request{return Ok(state.result());}
    require(state.seq==cursor&&state.kernel.session.digest==prior&&state.phase<6&&(state.phase==5||count==1),6613)?;
    let now=Clock::get()?;require(now.unix_timestamp>=state.kernel.clock,6614)?;state.bound_artifact(&a[7],state.phase!=5)?;
    let raw=a[7].try_borrow_data()?;let bytes=&raw[ARTIFACT_OFFSET..];
    if state.phase==5{
        require(a.len()==9,6600)?;let end=state.graph_at.checked_add(state.graph_len).ok_or(err(6611))?;require(end<=bytes.len(),6611)?;let graph_bytes=&bytes[state.graph_at..end];
        let actual_sha=hashv(&[graph_bytes]).to_bytes();require(actual_sha==state.kernel.session.graph_sha,6611)?;let g=biolab_kernel::graph::decode_graph(graph_bytes)?;
        biolab_kernel::runtime::advance(&g,actual_sha,&mut state.kernel.session,count)?;
        if state.kernel.session.cursor==73{let report=biolab_kernel::runtime::finish_session(&g,&state.kernel.session)?;state.kernel.quality=report.quality;state.kernel.task=report.task_applicable;state.kernel.cost=report.cost;state.phase=6;}
    }else{
        let payload=crate::synthesis::parse_boxed(bytes)?;require(payload.graph_at==state.graph_at&&payload.graph_len==state.graph_len&&payload.leaf_at==state.leaf_at&&payload.leaf_count==usize::from(state.leaf_count),6611)?;
        match state.phase{
            0=>{require(a.len()==11&&state.progress<u16::from(state.direct_count),6600)?;crate::synthesis::inherit_parent(bytes,&payload,usize::from(state.progress),&a[9],&a[10],&Pubkey::new_from_array(state.kernel.actor),&validator)?;state.progress+=1;if state.progress==u16::from(state.direct_count){state.progress=0;state.phase=1;}},
            1=>{require(a.len()==9&&state.progress<u16::from(state.leaf_count),6600)?;crate::synthesis::validate_capsule_at(bytes,&payload,usize::from(state.progress),&validator)?;state.progress+=1;if state.progress==u16::from(state.leaf_count){state.progress=0;state.provenance.reset_iterators(bytes,&payload)?;state.phase=2;}},
            2=>{require(a.len()==9,6600)?;let b=state.b;let retired=state.retired;if state.provenance.count_step(bytes,&payload,b,retired)?{state.phase=3;}},
            3=>{require(a.len()==9,6600)?;if let Some(sha)=state.provenance.hash_step(bytes,&payload)?{state.union_sha=sha;state.phase=4;}},
            4=>{require(a.len()==9,6600)?;let g=biolab_kernel::graph::decode_graph(&bytes[state.graph_at..state.graph_at+state.graph_len])?;state.semantic=crate::synthesis::semantic_id(&g)?;state.phase=5;},
            _=>return Err(err(6613)),
        }
    }
    state.seq=state.seq.checked_add(1).ok_or(err(8020))?;require(state.seq<=1024,6613)?;state.kernel.clock=now.unix_timestamp;state.kernel.last_from=cursor;state.kernel.last_count=count;state.kernel.last_request=request;
    state.write(&a[8])?;Ok(state.result())
}
