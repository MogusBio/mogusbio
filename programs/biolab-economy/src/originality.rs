//! Native immutable task knowledge and bounded originality transitions.
use super::*;
use biolab_kernel::{graph, runtime, scratch::Scratch};

pub(crate) const FAMILY:[u8;32]=[160,43,204,72,38,231,208,253,243,141,12,162,12,38,137,129,71,231,26,176,41,238,246,151,54,121,0,16,247,147,245,254];
pub(crate) const PREWARM_SECONDS:i64=86400;
const ROUND_SECONDS:i64=259200;
const WINDOW:i64=86400;
const VERIFY_LEN:usize=4096;
const SCRATCH_AT:usize=364;
pub(crate) const BLUEPRINT_KIND:u16=1002;
const INITIAL:[([u8;32],u64);16]=[
([16,171,66,38,130,124,236,99,125,187,104,208,70,86,134,239,6,37,6,40,3,196,88,186,82,206,12,171,186,114,22,51],341),
([26,39,115,52,238,191,87,190,144,226,185,12,17,113,245,11,112,126,190,247,150,124,16,168,207,199,158,233,212,227,140,97],340),
([53,213,210,244,114,231,106,78,97,121,221,194,29,113,38,214,73,160,217,176,115,159,236,81,49,228,170,57,244,204,164,33],343),
([55,231,187,252,243,61,120,244,122,49,187,231,161,25,64,255,53,215,145,146,119,254,14,176,78,24,64,64,123,106,83,205],394),
([64,253,12,78,208,67,20,131,67,17,11,37,185,50,215,132,109,229,183,190,136,64,97,35,148,54,251,153,251,26,21,239],330),
([81,229,116,119,183,166,162,230,233,121,24,87,101,154,166,236,231,164,99,191,105,226,172,51,31,96,248,205,88,58,191,46],336),
([97,96,170,234,127,74,241,208,238,246,120,52,202,170,140,58,137,46,59,166,100,169,3,75,226,45,82,202,21,9,205,106],332),
([120,148,56,149,226,90,52,254,14,194,25,35,158,119,253,95,172,183,89,237,152,85,55,252,35,229,42,190,231,46,158,203],413),
([142,124,137,27,62,130,173,72,241,158,66,185,228,229,61,193,164,137,106,42,125,191,73,244,195,30,171,63,149,121,210,239],347),
([143,233,100,37,59,198,111,74,143,42,117,1,38,239,49,198,100,246,244,138,246,248,25,247,104,87,164,226,130,246,195,154],324),
([169,55,139,71,28,249,207,240,203,37,238,8,122,155,156,235,146,187,144,112,254,83,151,243,141,99,250,37,213,192,152,15],330),
([180,98,156,227,209,176,165,242,173,6,45,52,17,18,161,154,37,148,52,184,243,43,148,208,35,100,177,221,50,216,213,95],320),
([183,134,94,237,5,2,87,171,65,202,242,193,205,239,89,48,45,48,68,245,106,103,75,114,114,167,38,122,36,98,38,235],318),
([194,173,150,108,177,25,240,4,44,21,237,66,159,254,99,57,228,213,1,218,28,157,178,132,16,61,243,115,71,33,44,212],375),
([233,2,125,51,197,185,155,5,166,19,223,249,32,106,114,123,139,2,21,210,255,2,234,221,100,60,35,24,250,218,156,42],316),
([237,248,148,118,227,1,36,23,166,196,225,160,218,212,61,109,220,136,161,192,91,86,239,212,193,6,182,80,180,233,23,44],328),
];
pub(crate) const INITIAL_COUNT:usize=if cfg!(feature="historical-opening14"){14}else{16};
#[cfg(feature="acceptance-test")]
fn initial_rows()->impl Iterator<Item=&'static([u8;32],u64)>{INITIAL.iter().filter(|row|INITIAL_COUNT==16||row.1>=320)}
#[cfg(feature="production-admission")]
fn initial_rows()->impl Iterator<Item=&'static([u8;32],u64)>{constants::INITIAL_DESIGNS.iter()}
fn required_bitmap()->u16{if INITIAL_COUNT==16{u16::MAX}else{0x3fff}}
#[cfg(feature="production-admission")]
fn frontier_limit()->u64{constants::OPENING_FRONTIER}
#[cfg(feature="acceptance-test")]
fn frontier_limit()->u64{if INITIAL_COUNT==16{316}else{320}}

#[inline(never)]
pub(crate) fn initial_set_id()->[u8;32]{
    #[cfg(feature="production-admission")]
    {return constants::INITIAL_SEED_SET_ID;}
    #[cfg(feature="acceptance-test")]
    {
    // No per-header Vec: Config validation runs many times in a 32-KiB P5
    // instruction, and the Solana bump allocator cannot reclaim temporary Vecs.
    let mut b=[0u8;709];b[0]=if INITIAL_COUNT==16{3}else{2};b[1..33].copy_from_slice(&domain());b[33..65].copy_from_slice(&FAMILY);b[65..69].copy_from_slice(&(INITIAL_COUNT as u32).to_le_bytes());let mut at=69;
    for(design,c)in initial_rows(){b[at..at+32].copy_from_slice(design);b[at+32..at+40].copy_from_slice(&c.to_le_bytes());at+=40;}typed_hash(15,&[&b[..at]])
    }
}

fn fresh(a:&AccountInfo)->bool{a.owner==&SYSTEM_ID&&a.data_is_empty()&&!a.executable}
fn ref33(b:&[u8],at:usize)->Result<Option<[u8;32]>,ProgramError>{
    require(at+33<=b.len()&&b[at]<=1,6702)?;let value=b[at+1..at+33].try_into().unwrap();
    if b[at]==0{require(zeros(&b[at+1..at+33]),6702)?;Ok(None)}else{Ok(Some(value))}
}
fn put_ref(b:&mut[u8],at:usize,value:Option<[u8;32]>){b[at..at+33].fill(0);if let Some(value)=value{b[at]=1;b[at+1..at+33].copy_from_slice(&value);}}
fn put64(b:&mut[u8],at:usize,value:u64){b[at..at+8].copy_from_slice(&value.to_le_bytes());}
fn puti64(b:&mut[u8],at:usize,value:i64){b[at..at+8].copy_from_slice(&value.to_le_bytes());}
fn put32(b:&mut[u8],at:usize,value:&[u8;32]){b[at..at+32].copy_from_slice(value);}
fn record(a:&AccountInfo,kind:u16,len:usize,key:&[u8;32],seeds:&[&[u8]])->ProgramResult{
    header(a,&PROGRAM_ID,kind,if [15,20].contains(&kind){2}else{1},len,key,seeds)?;require(a.lamports()>=Rent::get()?.minimum_balance(len).max(1),6702)
}
fn record_rent(a:&AccountInfo,key:&[u8;32],seeds:&[&[u8]],len:usize)->Result<u64,ProgramError>{
    writable(a)?;valid_pda(a,&PROGRAM_ID,seeds)?;let _=key;
    if fresh(a){need_rent(a,len)}else{require(a.owner==&PROGRAM_ID&&!a.executable&&a.data_len()==len,6702)?;Ok(0)}
}
fn create_record<'a>(a:&AccountInfo<'a>,payer:&AccountInfo<'a>,system:&AccountInfo<'a>,kind:u16,key:&[u8;32],seeds:&[&[u8]],body:&[u8])->ProgramResult{
    require(fresh(a),6702)?;allocate(payer,a,system,&PROGRAM_ID,120+body.len(),seeds)?;
    let bump=valid_pda(a,&PROGRAM_ID,seeds)?;write_header(a,kind,if [15,20].contains(&kind){2}else{1},key,bump)?;a.try_borrow_mut_data()?[120..].copy_from_slice(body);Ok(())
}
fn store_body(a:&AccountInfo,body:&[u8])->ProgramResult{writable(a)?;require(a.data_len()==120+body.len(),6702)?;a.try_borrow_mut_data()?[120..].copy_from_slice(body);Ok(())}
pub(crate) fn schedule(cfg:&AccountInfo)->Result<(i64,i64),ProgramError>{config(cfg)?;let d=cfg.try_borrow_data()?;Ok((i64_at(&d,376)?,i64_at(&d,384)?))}

#[derive(Clone)]
pub(crate) struct Task{pub event:u64,pub count:u64,pub next_round:u64,pub best:Option<(u64,[u8;32],u64)>,pub generation:u64,pub opening:bool,pub paused:bool,pub epoch:u64,pub high:i64}
impl Task{
    fn empty(now:i64)->Self{Self{event:0,count:0,next_round:0,best:None,generation:0,opening:false,paused:false,epoch:0,high:now}}
    pub(crate) fn read(a:&AccountInfo)->Result<Self,ProgramError>{
        record(a,30,255,&FAMILY,&[b"bio",b"task",&FAMILY])?;let d=a.try_borrow_data()?;let b=&d[120..];
        require(b[..32]==FAMILY&&u32_at(b,32)?==1&&b[60]<=1&&b[117]<=1&&b[118]<=1&&i64_at(b,127)?>=0,6702)?;
        let best=if b[60]==0{require(zeros(&b[61..109]),6702)?;None}else{let c=u64_at(b,61)?;let index=u64_at(b,101)?;require(c>0&&index<u64_at(b,44)?,6702)?;Some((c,b[69..101].try_into().unwrap(),index))};
        Ok(Self{event:u64_at(b,36)?,count:u64_at(b,44)?,next_round:u64_at(b,52)?,best,generation:u64_at(b,109)?,opening:b[117]==1,paused:b[118]==1,epoch:u64_at(b,119)?,high:i64_at(b,127)?})
    }
    fn encode(&self)->[u8;135]{let mut b=[0;135];put32(&mut b,0,&FAMILY);b[32..36].copy_from_slice(&1u32.to_le_bytes());put64(&mut b,36,self.event);put64(&mut b,44,self.count);put64(&mut b,52,self.next_round);if let Some((c,d,i))=self.best{b[60]=1;put64(&mut b,61,c);put32(&mut b,69,&d);put64(&mut b,101,i);}put64(&mut b,109,self.generation);b[117]=u8::from(self.opening);b[118]=u8::from(self.paused);put64(&mut b,119,self.epoch);puti64(&mut b,127,self.high);b}
    fn observe(&mut self,now:i64)->ProgramResult{require(now>=self.high,6704)?;self.high=now;Ok(())}
    fn touch(&mut self)->Result<u64,ProgramError>{self.event=add(self.event,1)?;Ok(self.event)}
    fn improve(&mut self,c:u64,design:[u8;32],index:u64)->Result<bool,ProgramError>{if self.best.map_or(true,|old|c<old.0){self.best=Some((c,design,index));self.generation=add(self.generation,1)?;Ok(true)}else{Ok(false)}}
}
fn task_load(a:&AccountInfo,now:i64)->Result<Task,ProgramError>{if fresh(a){valid_pda(a,&PROGRAM_ID,&[b"bio",b"task",&FAMILY])?;Ok(Task::empty(now))}else{Task::read(a)}}
fn task_store<'a>(a:&AccountInfo<'a>,ctx:&[AccountInfo<'a>],t:&Task)->ProgramResult{let b=t.encode();if fresh(a){create_record(a,&ctx[0],&ctx[4],30,&FAMILY,&[b"bio",b"task",&FAMILY],&b)}else{store_body(a,&b)}}
fn slot_body(a:&AccountInfo,generation:u64)->Result<[u8;74],ProgramError>{
    let mut b=[0;74];if fresh(a){put32(&mut b,0,&FAMILY);}else{record(a,34,194,&FAMILY,&[b"bio",b"k-slot",&FAMILY])?;b.copy_from_slice(&a.try_borrow_data()?[120..]);require(b[..32]==FAMILY&&b[73]<=4&&u64_at(&b,32)?==generation,6702)?;let current=ref33(&b,40)?;require((b[73]==0)==current.is_none(),6702)?;}put64(&mut b,32,generation);Ok(b)
}
fn slot_store<'a>(a:&AccountInfo<'a>,ctx:&[AccountInfo<'a>],body:&[u8;74])->ProgramResult{if fresh(a){create_record(a,&ctx[0],&ctx[4],34,&FAMILY,&[b"bio",b"k-slot",&FAMILY],body)}else{store_body(a,body)}}
fn round_id(n:u64)->[u8;32]{typed_hash(9,&[&domain(),&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()])}
fn round_new(task:&Task,n:u64)->[u8;389]{let mut b=[0;389];put32(&mut b,0,&FAMILY);b[32..36].copy_from_slice(&1u32.to_le_bytes());put64(&mut b,36,n);b[44]=if task.best.is_some(){1}else{2};if let Some((c,d,_))=task.best{put64(&mut b,45,c);put32(&mut b,53,&d);}put64(&mut b,85,task.count);put64(&mut b,93,task.count);put64(&mut b,118,task.epoch);put64(&mut b,381,task.count);b}
fn round_read(a:&AccountInfo,n:u64)->Result<[u8;389],ProgramError>{
    let id=round_id(n);record(a,15,509,&id,&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()])?;let mut b=[0;389];b.copy_from_slice(&a.try_borrow_data()?[120..]);
    require(b[..32]==FAMILY&&u32_at(&b,32)?==1&&u64_at(&b,36)?==n&&b[44]<=2&&b[117]<=4&&b[134]<=1,6702)?;
    require(u64_at(&b,85)?<=u64_at(&b,93)?,6702)?;if b[44]!=1{require(zeros(&b[45..85]),6702)?;}Ok(b)
}
fn round_load(a:&AccountInfo,t:&Task,n:u64)->Result<[u8;389],ProgramError>{if fresh(a){valid_pda(a,&PROGRAM_ID,&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()])?;Ok(round_new(t,n))}else{round_read(a,n)}}
fn round_store<'a>(a:&AccountInfo<'a>,ctx:&[AccountInfo<'a>],n:u64,body:&[u8;389])->ProgramResult{if fresh(a){let id=round_id(n);create_record(a,&ctx[0],&ctx[4],15,&id,&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()],body)}else{store_body(a,body)}}
fn disclosure_id(design:&[u8;32])->[u8;32]{typed_hash(8,&[&domain(),design])}
fn disclosure_read(a:&AccountInfo,design:&[u8;32])->Result<[u8;217],ProgramError>{let id=disclosure_id(design);record(a,14,337,&id,&[b"bio",b"disclosure",&id])?;let mut b=[0;217];b.copy_from_slice(&a.try_borrow_data()?[120..]);require(b[..32]==*design&&b[184..216]==FAMILY&&(1..=22).contains(&b[216])&&u64_at(&b,128)?>0&&i64_at(&b,144)?>=0,6702)?;Ok(b)}
fn disclosure_body(design:&[u8;32],artifact:&[u8;32],graph:&[u8;32],payload:&[u8;32],actor:&Pubkey,target:u8,event:u64,now:&Clock)->[u8;217]{let mut b=[0;217];for(at,v)in[(0,design),(32,artifact),(64,graph),(96,payload)]{put32(&mut b,at,v);}put64(&mut b,128,event);put64(&mut b,136,now.slot);puti64(&mut b,144,now.unix_timestamp);put32(&mut b,152,actor.as_array());put32(&mut b,184,&FAMILY);b[216]=target;b}
fn knowledge_key(index:u64)->[u8;32]{let mut id=[0;32];id[..8].copy_from_slice(&index.to_le_bytes());id}
fn knowledge_body(index:u64,design:&[u8;32],disclosure:&[u8;32],first:u64,event:u64,now:&Clock,cost:u64,kind:u8,evidence:&[u8;32],artifact:&[u8;32],admission:&[u8;32])->[u8;279]{let mut b=[0;279];put32(&mut b,0,&FAMILY);b[32..36].copy_from_slice(&1u32.to_le_bytes());put64(&mut b,36,index);put32(&mut b,44,design);put32(&mut b,76,disclosure);put64(&mut b,108,first);put64(&mut b,116,event);put64(&mut b,124,now.slot);puti64(&mut b,132,now.unix_timestamp);put64(&mut b,140,cost);b[148]=kind;put32(&mut b,149,evidence);put32(&mut b,181,artifact);put32(&mut b,213,admission);b}
fn knowledge_read(a:&AccountInfo,index:u64)->Result<[u8;279],ProgramError>{let key=knowledge_key(index);record(a,33,399,&key,&[b"bio",b"knowledge",&FAMILY,&index.to_le_bytes()])?;let mut b=[0;279];b.copy_from_slice(&a.try_borrow_data()?[120..]);require(b[..32]==FAMILY&&u32_at(&b,32)?==1&&u64_at(&b,36)?==index&&u64_at(&b,108)?>0&&u64_at(&b,116)?>u64_at(&b,108)?&&i64_at(&b,132)?>=0&&u64_at(&b,140)?>0&&b[148]<=2&&b[245]<=1,6702)?;let fault=ref33(&b,246)?;require((b[245]==0)==fault.is_none(),6702)?;Ok(b)}
fn admission_id(artifact:&[u8;32],evidence:&[u8;32],kind:u8,graph:&[u8;32],leaf:&[u8;32],target:u8,c:u32,q:u32,task:bool,cost:u64,transcript:&[u8;32],positive:&[u8;64])->[u8;32]{
    let _=artifact;let mut b=Vec::with_capacity(321);for v in [&domain(),&config_id(),&APPROVED_RULE_HASH,graph,leaf,evidence]{b.extend_from_slice(v);}b.extend_from_slice(&[target,kind]);b.extend_from_slice(&c.to_le_bytes());b.extend_from_slice(&q.to_le_bytes());b.push(u8::from(task));b.extend_from_slice(&cost.to_le_bytes());for v in [2u32,1,1]{b.extend_from_slice(&v.to_le_bytes());}let mask=graph::members(target).unwrap_or_default().iter().fold(0u16,|m,r|m|(1u16<<(*r-1)));b.extend_from_slice(&mask.to_le_bytes());b.extend_from_slice(transcript);b.extend_from_slice(positive);typed_hash(16,&[&b])
}

struct Blueprint {graph_at:usize,graph_len:usize,map_sha:[u8;32],challenge:u32,graph:graph::Graph}
#[inline(never)]
fn blueprint(bytes:&[u8])->Result<Box<Blueprint>,ProgramError>{
    require((25..=8098).contains(&bytes.len())&&&bytes[..8]==b"BIOP7K01"&&u16_at(bytes,8)?==1&&bytes[11]==0&&u32_at(bytes,12)?as usize==bytes.len()-16,6712)?;
    let challenge=u32_at(bytes,16)?;require((500_000..=2_000_000).contains(&challenge)&&challenge%1000==0,6712)?;
    let len=u32_at(bytes,20)?as usize;let end=24usize.checked_add(len).ok_or(err(6712))?;require((1..=7713).contains(&len)&&end<bytes.len(),6712)?;
    let g=graph::decode_graph(&bytes[24..end])?;require(g.target==bytes[10]&&g.domain==domain()&&g.config==config_id()&&g.catalog==materials::catalog_hash()&&g.rule==APPROVED_RULE_HASH,6712)?;
    let roles=graph::members(g.target)?;require(usize::from(bytes[end])==roles.len()*4&&bytes.len()==end+1+roles.len()*24,6712)?;
    for(i,role)in roles.iter().enumerate(){for primitive in 1..=4usize{let at=end+1+(i*4+primitive-1)*6;require(bytes[at..at+6]==[*role,primitive as u8,1,0,primitive as u8,if primitive==4{*role}else{0}],6712)?;}}
    Ok(Box::new(Blueprint{graph_at:24,graph_len:len,map_sha:hashv(&[&bytes[end..]]).to_bytes(),challenge,graph:g}))
}
struct BlueprintSession{artifact:[u8;32],sha:[u8;32],len:usize,graph_at:usize,graph_len:usize,map_sha:[u8;32],semantic:[u8;32],used:bool,historical:bool,base_kind:u8,base_ref:[u8;32],failure:u32,failure_stage:u8,failure_cursor:u16,kernel:Scratch}
impl BlueprintSession{
    #[inline(never)]fn read_boxed(a:&AccountInfo)->Result<Box<Self>,ProgramError>{Ok(Box::new(Self::read(a)?))}
    #[inline(never)]fn read(a:&AccountInfo)->Result<Self,ProgramError>{
        require(a.data_len()==VERIFY_LEN,6715)?;let d=a.try_borrow_data()?;let actor=key_at(&d,88)?;drop(d);let schema=u16_at(&a.try_borrow_data()?,12)?;require([4,5].contains(&schema),6715)?;header(a,&PROGRAM_ID,37,schema,VERIFY_LEN,actor.as_array(),&[b"bio",b"verify",actor.as_ref()])?;
        let d=a.try_borrow_data()?;let historical=schema==5;require(&d[120..128]==if historical{b"BIOHRP01"}else{b"BIOBPV01"}&&d[268]<=1&&zeros(&d[SCRATCH_AT+biolab_kernel::scratch::BYTES..]),6715)?;if historical{require(d[269]<=1&&d[306]<=3&&u16_at(&d,307)?<=73&&zeros(&d[309..364]),6715)?;if u32_at(&d,302)?==0{require(zeros(&d[306..309]),6715)?;}}else{require(zeros(&d[269..364]),6715)?;}
        let kernel=Scratch::decode(&d[SCRATCH_AT..SCRATCH_AT+biolab_kernel::scratch::BYTES])?;require(kernel.actor==actor.to_bytes()&&kernel.config==config_id()&&kernel.validator==APPROVED_VALIDATOR_HASH,6715)?;let failure=u32_at(&d,302)?;require(failure==0||(historical&&valid_failure_code(d[306],failure)&&kernel.quality==0&&!kernel.task&&kernel.cost==0),6715)?;
        require(d[268]==0||kernel.session.cursor==73,6715)?;
        Ok(Self{artifact:d[128..160].try_into().unwrap(),sha:d[160..192].try_into().unwrap(),len:u32_at(&d,192)?as usize,graph_at:u32_at(&d,196)?as usize,graph_len:u32_at(&d,200)?as usize,map_sha:d[204..236].try_into().unwrap(),semantic:d[236..268].try_into().unwrap(),used:d[268]==1,historical,base_kind:d[269],base_ref:d[270..302].try_into().unwrap(),failure:u32_at(&d,302)?,failure_stage:d[306],failure_cursor:u16_at(&d,307)?,kernel})
    }
    fn write(&self,a:&AccountInfo)->ProgramResult{let mut d=a.try_borrow_mut_data()?;require(d.len()==VERIFY_LEN,6715)?;d[120..].fill(0);d[120..128].copy_from_slice(if self.historical{b"BIOHRP01"}else{b"BIOBPV01"});if self.historical{d[269]=self.base_kind;d[270..302].copy_from_slice(&self.base_ref);d[302..306].copy_from_slice(&self.failure.to_le_bytes());d[306]=self.failure_stage;d[307..309].copy_from_slice(&self.failure_cursor.to_le_bytes());}for(at,v)in[(128,&self.artifact),(160,&self.sha),(204,&self.map_sha),(236,&self.semantic)]{d[at..at+32].copy_from_slice(v);}for(at,v)in[(192,self.len),(196,self.graph_at),(200,self.graph_len)]{d[at..at+4].copy_from_slice(&(v as u32).to_le_bytes());}d[268]=u8::from(self.used);self.kernel.encode(&mut d[SCRATCH_AT..SCRATCH_AT+biolab_kernel::scratch::BYTES])}
    fn result(&self)->Vec<u8>{let mut b=Vec::with_capacity(126);b.extend_from_slice(b"BIOBPS01");b.extend_from_slice(&self.kernel.generation.to_le_bytes());b.extend_from_slice(&self.kernel.session.cursor.to_le_bytes());b.extend_from_slice(&self.kernel.quality.to_le_bytes());b.extend_from_slice(&self.kernel.cost.to_le_bytes());b.extend_from_slice(&self.kernel.session.digest);b.extend_from_slice(&self.semantic);b.extend_from_slice(&self.artifact);b.extend_from_slice(&self.failure.to_le_bytes());b.push(self.failure_stage);b.extend_from_slice(&self.failure_cursor.to_le_bytes());b}
    fn bound(&self,a:&AccountInfo)->ProgramResult{let v=verification::read_sealed(a,if self.historical&&self.base_kind==1{702}else{BLUEPRINT_KIND})?;require(v.id==self.artifact&&v.hash==self.sha&&v.total_len==self.len,6715)}
}
/// Shared actor generation guard. Reset is signed by the actor at the top-level
/// entry. A new profile can never interpret the old profile as completed proof.
pub(crate) fn prior_session(a:&AccountInfo,actor:&Pubkey)->Result<(u64,i64),ProgramError>{
    if fresh(a){valid_pda(a,&PROGRAM_ID,&[b"bio",b"verify",actor.as_ref()])?;return Ok((0,0));}
    require(a.owner==&PROGRAM_ID&&a.data_len()==VERIFY_LEN,6715)?;let schema=u16_at(&a.try_borrow_data()?,12)?;
    match schema{3=>{let old=verification::Verified::read_boxed(a)?;require(old.kernel.actor==actor.to_bytes(),6715)?;Ok((old.kernel.generation,old.kernel.clock))},4|5=>{let old=BlueprintSession::read_boxed(a)?;require(old.kernel.actor==actor.to_bytes(),6715)?;Ok((old.kernel.generation,old.kernel.clock))},_=>Err(err(6715))}
}
pub(crate) fn blueprint_begin<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==9&&f.payload.len()==84,6700)?;config(&a[2])?;let v=verification::read_sealed(&a[7],BLUEPRINT_KIND)?;let p=f.payload;
    require(p[..32]==v.id&&p[32..64]==v.hash&&u32_at(p,64)?as usize==v.total_len,6715)?;let expected=u64_at(p,68)?;let now=Clock::get()?;
    writable(&a[8])?;let(old,clock)=prior_session(&a[8],&f.actor)?;require(old==expected&&now.unix_timestamp>=clock,6703)?;
    let raw=a[7].try_borrow_data()?;let bytes=&raw[verification::ARTIFACT_OFFSET..];let decoded=blueprint(bytes)?;
    let semantic=crate::synthesis::semantic_id(&decoded.graph)?;let graph_sha=hashv(&[&bytes[decoded.graph_at..decoded.graph_at+decoded.graph_len]]).to_bytes();
    let session=runtime::begin_session(&decoded.graph,decoded.challenge,graph_sha)?;
    let needed=if fresh(&a[8]){need_rent(&a[8],VERIFY_LEN)?}else{0};check_budget(a,add(needed,nonce_rent(&a[1])?)?,u64_at(p,76)?)?;
    if fresh(&a[8]){allocate(&a[0],&a[8],&a[4],&PROGRAM_ID,VERIFY_LEN,&[b"bio",b"verify",f.actor.as_ref()])?;}
    let bump=valid_pda(&a[8],&PROGRAM_ID,&[b"bio",b"verify",f.actor.as_ref()])?;write_header(&a[8],37,4,f.actor.as_array(),bump)?;
    let state=BlueprintSession{artifact:v.id,sha:v.hash,len:v.total_len,graph_at:decoded.graph_at,graph_len:decoded.graph_len,map_sha:decoded.map_sha,semantic,used:false,historical:false,base_kind:0,base_ref:[0;32],failure:0,failure_stage:0,failure_cursor:0,kernel:Scratch{generation:add(expected,1)?,clock:now.unix_timestamp,actor:f.actor.to_bytes(),config:config_id(),validator:APPROVED_VALIDATOR_HASH,direct:decoded.map_sha,last_from:u16::MAX,last_count:0,last_request:[0;32],session,quality:0,task:false,cost:0}};
    state.write(&a[8])?;Ok(state.result())
}
pub(crate) fn blueprint_step<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==9&&f.payload.len()==84&&f.payload[43]==0,6700)?;config(&a[2])?;writable(&a[8])?;let mut state=BlueprintSession::read_boxed(&a[8])?;let p=f.payload;
    require(!state.used&&state.failure==0&&state.kernel.actor==f.actor.to_bytes()&&p[..32]==state.artifact&&u64_at(p,32)?==state.kernel.generation,6715)?;
    let from=u16_at(p,40)?;let count=p[42];require((1..=2).contains(&count),6700)?;let request=hashv(&[&p[..76]]).to_bytes();
    check_budget(a,nonce_rent(&a[1])?,u64_at(p,76)?)?;if state.kernel.last_from==from&&state.kernel.last_count==count&&state.kernel.last_request==request{return Ok(state.result());}
    require(from==state.kernel.session.cursor&&p[44..76]==state.kernel.session.digest&&from<73,6703)?;let now=Clock::get()?;require(now.unix_timestamp>=state.kernel.clock,6704)?;state.bound(&a[7])?;
    let raw=a[7].try_borrow_data()?;let bytes=&raw[verification::ARTIFACT_OFFSET..];let decoded=if state.historical&&state.base_kind==1{history_graph(bytes,state.kernel.session.challenge)?}else{blueprint(bytes)?};let sha=hashv(&[&bytes[decoded.graph_at..decoded.graph_at+decoded.graph_len]]).to_bytes();
    require(sha==state.kernel.session.graph_sha&&decoded.map_sha==state.map_sha&&decoded.challenge==state.kernel.session.challenge,6715)?;
    let advancement=runtime::advance(&decoded.graph,sha,&mut state.kernel.session,count);
    if let Err(error)=advancement{if state.historical{if let Some(code)=definite_error(&error,2){state.failure=code;state.failure_stage=2;state.failure_cursor=from;}else{return Err(error);}}else{return Err(error);}}
    if state.failure==0&&state.kernel.session.cursor==73{match runtime::finish_session(&decoded.graph,&state.kernel.session){Ok(report)=>{state.kernel.quality=report.quality;state.kernel.task=report.task_applicable;state.kernel.cost=report.cost;},Err(error)=>{if state.historical{if let Some(code)=definite_error(&error,3){state.failure=code;state.failure_stage=3;state.failure_cursor=73;}else{return Err(error);}}else{return Err(error);}}}}
    state.kernel.clock=now.unix_timestamp;state.kernel.last_from=from;state.kernel.last_count=count;state.kernel.last_request=request;state.write(&a[8])?;Ok(state.result())
}

#[derive(Clone,Copy)]
pub(crate) struct AdmissionFacts{
    pub artifact:[u8;32],pub payload_sha:[u8;32],pub graph_sha:[u8;32],pub leaf_sha:[u8;32],pub semantic:[u8;32],
    pub target:u8,pub challenge:u32,pub quality:u32,pub task:bool,pub cost:u64,pub transcript:[u8;32],pub positive:[u8;64],
}
pub(crate) struct PreparedAdmission{
    pub rent:u64,tail:usize,task:Task,round:[u8;389],round_number:u64,disclosure:[u8;217],disclosure_new:bool,
    knowledge:Option<[u8;279]>,slot:Option<[u8;74]>,facts:AdmissionFacts,competition:Option<Competition>,stop:Option<Box<PreparedStop>>,
}
#[inline(never)]
pub(crate) fn prepare_synth(a:&[AccountInfo],f:&Frame,facts:&AdmissionFacts,tail:usize,now:&Clock)->Result<Box<PreparedAdmission>,ProgramError>{
    let(_,reward)=schedule(&a[2])?;require(now.unix_timestamp>=reward,6704)?;let qualified=facts.target==22&&facts.quality==2_000_000&&facts.task&&facts.cost>0;
    require((1..=22).contains(&facts.target)&&(!facts.task||qualified),6715)?;
    let compete=f.payload.len()==189&&f.payload[124]==1;
    require(f.payload.len()==124||compete,6700)?;require(!compete||qualified,6715)?;
    require(a.len()>=tail+(if qualified{5}else{3})+(if compete{3}else{0}),6702)?;
    let mut task=task_load(&a[tail],now.unix_timestamp)?;task.observe(now.unix_timestamp)?;let n=u64::try_from((now.unix_timestamp-reward)/ROUND_SECONDS).map_err(|_|err(6728))?;
    let mut round=round_load(&a[tail+1],&task,n)?;require(round[117]!=4,6725)?;
    let did=disclosure_id(&facts.semantic);let new=fresh(&a[tail+2]);let disclosure=if new{
        let event=task.touch()?;disclosure_body(&facts.semantic,&facts.artifact,&facts.graph_sha,&facts.payload_sha,&f.actor,facts.target,event,now)
    }else{let b=disclosure_read(&a[tail+2],&facts.semantic)?;require(u64_at(&b,128)?<=task.event&&i64_at(&b,144)?<=now.unix_timestamp&&u64_at(&b,136)?<=now.slot,6703)?;b};
    let mut rent=record_rent(&a[tail],&FAMILY,&[b"bio",b"task",&FAMILY],255)?;
    let rid=round_id(n);rent=add(rent,record_rent(&a[tail+1],&rid,&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()],509)?)?;
    rent=add(rent,record_rent(&a[tail+2],&did,&[b"bio",b"disclosure",&did],337)?)?;
    let(mut knowledge,mut slot)=(None,None);let mut stop=None;let mut competition_tail=tail+if qualified{5}else{3};
    if qualified{
        let ka=&a[tail+3];let sa=&a[tail+4];let index=task.count;let key=knowledge_key(index);require(fresh(ka),6714)?;
        rent=add(rent,record_rent(ka,&key,&[b"bio",b"knowledge",&FAMILY,&index.to_le_bytes()],399)?)?;
        rent=add(rent,record_rent(sa,&FAMILY,&[b"bio",b"k-slot",&FAMILY],194)?)?;
        let mut sb=slot_body(sa,task.generation)?;
        let had_activation=ref33(&sb,40)?.is_some();
        let event=task.touch()?;let m=business_key(f);let instance=crate::root::instance_id(&m);
        let admission=admission_id(&facts.artifact,&instance,1,&facts.graph_sha,&facts.leaf_sha,facts.target,facts.challenge,facts.quality,facts.task,facts.cost,&facts.transcript,&facts.positive);
        knowledge=Some(knowledge_body(index,&facts.semantic,&did,u64_at(&disclosure,128)?,event,now,facts.cost,1,&instance,&facts.artifact,&admission));
        task.count=add(task.count,1)?;let improved=task.improve(facts.cost,facts.semantic,index)?;put64(&mut round,93,task.count);
        if had_activation{let(value,extra)=prepare_stop(a,competition_tail,&a[14],&sb,&task,now,improved,2)?;competition_tail+=4+usize::from(value.event_at.is_some());rent=add(rent,extra)?;if improved{sb[73]=3;}stop=Some(Box::new(value));}
        put64(&mut sb,32,task.generation);slot=Some(sb);
    }
    require(a.len()==competition_tail+if compete{3}else{0},6702)?;
    let competition=if compete{let c=prepare_competition(a,f,competition_tail,n,&task,&mut round,facts,&disclosure,knowledge.as_ref().ok_or(err(6715))?,now,reward)?;rent=add(rent,c.rent)?;Some(c)}else{None};
    Ok(Box::new(PreparedAdmission{rent,tail,task,round,round_number:n,disclosure,disclosure_new:new,knowledge,slot,facts:*facts,competition,stop}))
}
#[inline(never)]
pub(crate) fn commit_synth<'a>(a:&[AccountInfo<'a>],f:&Frame,p:&PreparedAdmission)->ProgramResult{
    // Trusted internal postcondition: synthesis::finalize has just allocated and
    // written this new Root after full inputs, descriptor and runtime validation.
    // No external entry or CPI can supply PreparedAdmission or mutate this owned
    // Root between the writer and this call. Check the actual canonical account
    // and all admission-bound facts without rerunning the whole Root decoder.
    let tail=p.tail;let now=Clock::get()?;let id=crate::root::instance_id(&business_key(f));
    require(a[9].owner==&PROGRAM_ID&&a[9].data_len()==761,6729)?;valid_pda(&a[9],&PROGRAM_ID,&[b"bio",b"root",&id])?;
    let d=a[9].try_borrow_data()?;require(d[88..120]==id&&d[120..152]==id&&key_at(&d,322)?==f.actor&&zeros(&d[354..443])&&i64_at(&d,306)?==now.unix_timestamp&&u64_at(&d,314)?==now.slot&&u32_at(&d,284)?==p.facts.quality&&d[443..475]==p.facts.artifact&&d[475..507]==p.facts.payload_sha&&d[511..543]==p.facts.graph_sha&&d[543..575]==p.facts.leaf_sha&&d[623..655]==p.facts.transcript&&d[655..719]==p.facts.positive&&d[727..759]==p.facts.semantic&&u64_at(&d,719)?==p.facts.cost,6729)?;drop(d);
    if p.disclosure_new{let id=disclosure_id(&p.facts.semantic);create_record(&a[tail+2],&a[0],&a[4],14,&id,&[b"bio",b"disclosure",&id],&p.disclosure)?;}
    if let Some(k)=&p.knowledge{let index=u64_at(k,36)?;let key=knowledge_key(index);create_record(&a[tail+3],&a[0],&a[4],33,&key,&[b"bio",b"knowledge",&FAMILY,&index.to_le_bytes()],k)?;}
    if let Some(stop)=&p.stop{commit_stop(a,&a[14],stop,f)?;}
    if let Some(slot)=&p.slot{slot_store(&a[tail+4],a,slot)?;}
    if let Some(c)=&p.competition{let rid=round_id(p.round_number);create_record(&a[c.tail+2],&a[0],&a[4],32,&c.id,&[b"bio",b"candidate",&rid,&c.index.to_le_bytes()],&c.candidate)?;store_body(&a[c.tail+1],&c.commit)?;}
    round_store(&a[tail+1],a,p.round_number,&p.round)?;task_store(&a[tail],a,&p.task)
}

fn opening_key()->[u8;32]{typed_hash(15,&[&[0],&domain(),&FAMILY])}
fn seed_key(design:&[u8;32])->[u8;32]{typed_hash(15,&[&[1],&domain(),&FAMILY,design])}
fn opening_read(a:&AccountInfo)->Result<[u8;189],ProgramError>{let key=opening_key();record(a,3,309,&key,&[b"bio",b"opening",&FAMILY])?;let mut b=[0;189];b.copy_from_slice(&a.try_borrow_data()?[120..]);require(b[..32]==FAMILY&&b[32..64]==initial_set_id()&&u16_at(&b,72)?&!required_bitmap()==0&&u64_at(&b,74)?<=u64_at(&b,64)?&&b[114]<=1&&b[155]<=1,6702)?;if b[114]==0{require(zeros(&b[115..155]),6702)?;}let snapshot=ref33(&b,156)?;require((b[155]==1)==snapshot.is_some(),6702)?;Ok(b)}
fn opening_new()->[u8;189]{let mut b=[0;189];put32(&mut b,0,&FAMILY);put32(&mut b,32,&initial_set_id());put32(&mut b,82,&hashv(&[b"BIOSEED1",&domain(),&FAMILY]).to_bytes());b}
fn seed_read(a:&AccountInfo,design:&[u8;32])->Result<[u8;201],ProgramError>{let key=seed_key(design);record(a,4,321,&key,&[b"bio",b"seed",&FAMILY,design])?;let mut b=[0;201];b.copy_from_slice(&a.try_borrow_data()?[120..]);require(b[..32]==FAMILY&&b[32..64]==*design&&u64_at(&b,128)?>0&&(b[176]==255||usize::from(b[176])<INITIAL_COUNT)&&u64_at(&b,177)?>0&&i64_at(&b,193)?>=0,6702)?;Ok(b)}
fn read_reference(p:&[u8],state:&BlueprintSession)->ProgramResult{require(p.len()==84&&p[..32]==state.artifact&&p[32..64]==state.sha&&u32_at(p,64)?as usize==state.len&&u64_at(p,68)?==state.kernel.generation,6715)}
#[inline(never)]
pub(crate) fn register_seed<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==15&&f.payload.len()==84,6700)?;let(open,reward)=schedule(&a[2])?;let now=Clock::get()?;require(now.unix_timestamp>=open&&now.unix_timestamp<reward,6717)?;
    let mut session=BlueprintSession::read_boxed(&a[8])?;read_reference(f.payload,&session)?;require(!session.historical&&session.kernel.actor==f.actor.to_bytes()&&session.kernel.session.cursor==73&&session.kernel.session.target==22&&session.kernel.session.challenge==2_000_000&&session.kernel.quality==2_000_000&&session.kernel.task&&session.kernel.cost>0&&now.unix_timestamp>=session.kernel.clock,6715)?;session.bound(&a[7])?;
    let design=session.semantic;let sid=seed_key(&design);let did=disclosure_id(&design);let mut task=task_load(&a[9],now.unix_timestamp)?;task.observe(now.unix_timestamp)?;
    let mut opening=if fresh(&a[10]){opening_new()}else{opening_read(&a[10])?};require(opening[155]==0&&u64_at(&opening,64)?==task.count,6717)?;
    let mut slot=slot_body(&a[14],task.generation)?;require(ref33(&slot,40)?.is_none()&&slot[73]==0,6726)?;
    let ordinal=initial_rows().position(|(d,_)|*d==design).map_or(255,|n|n as u8);if ordinal!=255{require(session.kernel.cost==initial_rows().nth(ordinal as usize).ok_or(err(6718))?.1,6718)?;}
    if !fresh(&a[11]){
        let seed=seed_read(&a[11],&design)?;let index=u64_at(&seed,136)?;let k=knowledge_read(&a[13],index)?;let disclosure=disclosure_read(&a[12],&design)?;
        require(k[148]==0&&k[149..181]==sid&&k[44..76]==design&&k[213..245]==seed[96..128]&&seed[144..176]==did&&u64_at(&disclosure,128)?==u64_at(&k,108)?,6715)?;
        let mut result=design.to_vec();result.extend_from_slice(&index.to_le_bytes());result.extend_from_slice(&sid);task_store(&a[9],a,&task)?;return Ok(result)
    }
    require(!session.used,6715)?;let index=task.count;let key=knowledge_key(index);require(fresh(&a[13]),6714)?;let is_disclosure_new=fresh(&a[12]);
    let disclosure=if is_disclosure_new{let event=task.touch()?;disclosure_body(&design,&session.artifact,&session.kernel.session.graph_sha,&session.sha,&f.actor,22,event,&now)}else{let b=disclosure_read(&a[12],&design)?;require(u64_at(&b,128)?<=task.event&&i64_at(&b,144)?<=now.unix_timestamp,6703)?;b};
    let event=task.touch()?;let admission=admission_id(&session.artifact,&session.artifact,0,&session.kernel.session.graph_sha,&session.map_sha,22,session.kernel.session.challenge,session.kernel.quality,true,session.kernel.cost,&session.kernel.session.digest,&session.kernel.session.positive);
    let knowledge=knowledge_body(index,&design,&did,u64_at(&disclosure,128)?,event,&now,session.kernel.cost,0,&sid,&session.artifact,&admission);
    let mut seed=[0;201];for(at,v)in[(0,&FAMILY),(32,&design),(64,&session.artifact),(96,&admission),(144,&did)]{put32(&mut seed,at,v);}put64(&mut seed,128,session.kernel.cost);put64(&mut seed,136,index);seed[176]=ordinal;put64(&mut seed,177,event);put64(&mut seed,185,now.slot);puti64(&mut seed,193,now.unix_timestamp);
    let mut rent=nonce_rent(&a[1])?;for(ai,key,seeds,len)in[
        (9,FAMILY,vec![b"bio".as_slice(),b"task",&FAMILY],255),(10,opening_key(),vec![b"bio".as_slice(),b"opening",&FAMILY],309),
        (11,sid,vec![b"bio".as_slice(),b"seed",&FAMILY,&design],321),(12,did,vec![b"bio".as_slice(),b"disclosure",&did],337),
        (13,key,vec![b"bio".as_slice(),b"knowledge",&FAMILY,&index.to_le_bytes()],399),(14,FAMILY,vec![b"bio".as_slice(),b"k-slot",&FAMILY],194)]{rent=add(rent,record_rent(&a[ai],&key,&seeds,len)?)?;}
    check_budget(a,rent,u64_at(f.payload,76)?)?;
    task.count=add(task.count,1)?;task.improve(session.kernel.cost,design,index)?;put64(&mut slot,32,task.generation);put64(&mut opening,64,task.count);
    if usize::from(ordinal)<INITIAL_COUNT{let bitmap=u16_at(&opening,72)?|(1u16<<ordinal);opening[72..74].copy_from_slice(&bitmap.to_le_bytes());}
    if is_disclosure_new{create_record(&a[12],&a[0],&a[4],14,&did,&[b"bio",b"disclosure",&did],&disclosure)?;}
    create_record(&a[11],&a[0],&a[4],4,&sid,&[b"bio",b"seed",&FAMILY,&design],&seed)?;create_record(&a[13],&a[0],&a[4],33,&key,&[b"bio",b"knowledge",&FAMILY,&index.to_le_bytes()],&knowledge)?;
    if fresh(&a[10]){let key=opening_key();create_record(&a[10],&a[0],&a[4],3,&key,&[b"bio",b"opening",&FAMILY],&opening)?;}else{store_body(&a[10],&opening)?;}
    slot_store(&a[14],a,&slot)?;task_store(&a[9],a,&task)?;session.used=true;session.kernel.clock=now.unix_timestamp;session.write(&a[8])?;
    let mut result=design.to_vec();result.extend_from_slice(&index.to_le_bytes());result.extend_from_slice(&sid);Ok(result)
}
pub(crate) fn seal_opening<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(f.payload.len()==17&&a.len()>=10,6700)?;let(_,reward)=schedule(&a[2])?;let now=Clock::get()?;require(now.unix_timestamp>=reward,6717)?;
    let mut task=Task::read(&a[7])?;task.observe(now.unix_timestamp)?;let mut opening=opening_read(&a[8])?;
    require(opening[155]==0&&u16_at(&opening,72)?==required_bitmap()&&u64_at(&opening,64)?>=INITIAL_COUNT as u64,6719)?;
    let mut cursor=u64_at(&opening,74)?;let count=u64_at(&opening,64)?;let max=f.payload[8];require((1..=8).contains(&max)&&u64_at(f.payload,0)?==cursor,6720)?;
    let stop=add(cursor,u64::from(max))?.min(count);require(a.len()==10+((stop-cursor)as usize)*2,6702)?;
    let mut digest:[u8;32]=opening[82..114].try_into().unwrap();let mut best=if opening[114]==1{Some((u64_at(&opening,115)?,<[u8;32]>::try_from(&opening[123..155]).unwrap()))}else{None};
    for pair in a[10..].chunks_exact(2){let k=knowledge_read(&pair[0],cursor)?;let design:[u8;32]=k[44..76].try_into().unwrap();let s=seed_read(&pair[1],&design)?;require(k[148]==0&&k[245]==0&&k[149..181]==seed_key(&design)&&k[213..245]==s[96..128]&&u64_at(&s,136)?==cursor&&i64_at(&k,132)?<reward&&i64_at(&s,193)?<reward,6720)?;
        let cost=u64_at(&k,140)?;digest=hashv(&[b"BIOSEED1",&digest,&cursor.to_le_bytes(),&design,&cost.to_le_bytes(),&k[213..245]]).to_bytes();if best.map_or(true,|old|cost<old.0){best=Some((cost,design));}cursor=add(cursor,1)?;}
    put64(&mut opening,74,cursor);put32(&mut opening,82,&digest);if let Some((c,d))=best{opening[114]=1;put64(&mut opening,115,c);put32(&mut opening,123,&d);}
    let mut rent=nonce_rent(&a[1])?;let mut snapshot=None;
    if cursor==count{
        let(c,design)=best.ok_or(err(6719))?;require(c<=frontier_limit(),6719)?;let event=task.touch()?;let mut b=[0;176];for(at,v)in[(0,&FAMILY),(32,&initial_set_id()),(80,&digest),(120,&design)]{put32(&mut b,at,v);}puti64(&mut b,64,reward);put64(&mut b,72,count);put64(&mut b,112,c);put64(&mut b,152,event);put64(&mut b,160,now.slot);puti64(&mut b,168,now.unix_timestamp);let id=typed_hash(15,&[&[3],&domain(),&b]);
        require(fresh(&a[9]),6719)?;rent=add(rent,record_rent(&a[9],&id,&[b"bio",b"seed-final",&FAMILY],296)?)?;snapshot=Some((id,b));opening[155]=1;put_ref(&mut opening,156,Some(id));task.opening=true;
    }else{valid_pda(&a[9],&PROGRAM_ID,&[b"bio",b"seed-final",&FAMILY])?;require(fresh(&a[9]),6719)?;}
    check_budget(a,rent,u64_at(f.payload,9)?)?;if let Some((id,b))=snapshot{create_record(&a[9],&a[0],&a[4],5,&id,&[b"bio",b"seed-final",&FAMILY],&b)?;}
    store_body(&a[8],&opening)?;task_store(&a[7],a,&task)?;let mut result=opening[156..189].to_vec();result.extend_from_slice(&cursor.to_le_bytes());result.extend_from_slice(&count.to_le_bytes());Ok(result)
}

fn snapshot_read(a:&AccountInfo,reward:i64)->Result<[u8;176],ProgramError>{
    valid_pda(a,&PROGRAM_ID,&[b"bio",b"seed-final",&FAMILY])?;require(a.owner==&PROGRAM_ID&&a.data_len()==296,6702)?;let mut b=[0;176];b.copy_from_slice(&a.try_borrow_data()?[120..]);
    let key=typed_hash(15,&[&[3],&domain(),&b]);record(a,5,296,&key,&[b"bio",b"seed-final",&FAMILY])?;require(b[..32]==FAMILY&&b[32..64]==initial_set_id()&&i64_at(&b,64)?==reward&&u64_at(&b,72)?>=INITIAL_COUNT as u64&&u64_at(&b,112)?<=frontier_limit()&&u64_at(&b,152)?>0&&i64_at(&b,168)?>=reward,6705)?;Ok(b)
}
fn commit_read(a:&AccountInfo,id:&[u8;32])->Result<[u8;207],ProgramError>{
    record(a,31,327,id,&[b"bio",b"commit",id])?;let mut b=[0;207];b.copy_from_slice(&a.try_borrow_data()?[120..]);require(b[..32]==FAMILY&&u32_at(&b,32)?==1&&b[108..140]==*id&&u64_at(&b,140)?>0&&i64_at(&b,156)?>=0&&b[164]<=1,6702)?;
    let candidate=ref33(&b,165)?;require((b[164]==0)==candidate.is_none()&&b[198]<=1&&(b[198]==0)==candidate.is_none(),6702)?;if b[198]==0{require(u64_at(&b,199)?==0,6702)?;}Ok(b)
}
fn opid(nonce:u64)->[u8;32]{let mut b=[0;32];b[..8].copy_from_slice(&nonce.to_le_bytes());b}
fn commitment(round:u64,author:&Pubkey,design:&[u8;32],manufacture_nonce:u64,salt:&[u8;32])->[u8;32]{typed_hash(22,&[&domain(),&FAMILY,&1u32.to_le_bytes(),&round.to_le_bytes(),author.as_ref(),design,&opid(manufacture_nonce),salt])}
pub(crate) fn commit<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==12&&f.payload.len()==116,6700)?;let p=f.payload;require(p[..32]==FAMILY&&u32_at(p,32)?==1&&key_at(p,76)?==f.actor,6701)?;
    let(_,reward)=schedule(&a[2])?;let now=Clock::get()?;let n=u64_at(p,36)?;let round_start=reward.checked_add(i64::try_from(n).map_err(|_|err(6728))?.checked_mul(ROUND_SECONDS).ok_or(err(6728))?).ok_or(err(6728))?;
    require(now.unix_timestamp>=round_start&&now.unix_timestamp<round_start.checked_add(WINDOW).ok_or(err(6728))?,6707)?;
    let mut task=Task::read(&a[7])?;task.observe(now.unix_timestamp)?;require(task.opening&&!task.paused,if task.paused{6706}else{6705})?;slot_body(&a[8],task.generation)?;snapshot_read(&a[9],reward)?;
    let mut round=round_load(&a[10],&task,n)?;require(round[117]==0,6722)?;let id=business_key(f);require(fresh(&a[11]),6710)?;
    let rent=add(add(nonce_rent(&a[1])?,record_rent(&a[10],&round_id(n),&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()],509)?)?,record_rent(&a[11],&id,&[b"bio",b"commit",&id],327)?)?;check_budget(a,rent,u64_at(p,108)?)?;
    let event=task.touch()?;let mut b=[0;207];put32(&mut b,0,&FAMILY);b[32..36].copy_from_slice(&1u32.to_le_bytes());put64(&mut b,36,n);put32(&mut b,44,f.actor.as_array());b[76..108].copy_from_slice(&p[44..76]);put32(&mut b,108,&id);put64(&mut b,140,event);put64(&mut b,148,now.slot);puti64(&mut b,156,now.unix_timestamp);let commits=add(u64_at(&round,101)?,1)?;put64(&mut round,101,commits);
    create_record(&a[11],&a[0],&a[4],31,&id,&[b"bio",b"commit",&id],&b)?;round_store(&a[10],a,n,&round)?;task_store(&a[7],a,&task)?;let mut result=id.to_vec();result.extend_from_slice(&event.to_le_bytes());Ok(result)
}


struct Competition{rent:u64,tail:usize,id:[u8;32],index:u64,commit:[u8;207],candidate:[u8;348]}
fn prepare_competition(a:&[AccountInfo],f:&Frame,tail:usize,n:u64,task:&Task,round:&mut[u8;389],facts:&AdmissionFacts,disclosure:&[u8;217],knowledge:&[u8;279],now:&Clock,reward:i64)->Result<Competition,ProgramError>{
    require(task.opening&&!task.paused,if task.paused{6706}else{6705})?;snapshot_read(&a[tail],reward)?;
    let elapsed=(now.unix_timestamp-reward)%ROUND_SECONDS;require(elapsed>=WINDOW&&elapsed<2*WINDOW,6711)?;
    let commit_id:[u8;32]=f.payload[125..157].try_into().unwrap();let salt:[u8;32]=f.payload[157..189].try_into().unwrap();let mut commit=commit_read(&a[tail+1],&commit_id)?;
    require(u64_at(&commit,36)?==n&&commit[44..76]==f.actor.to_bytes(),6709)?;require(commit[164]==0,6710)?;
    require(commit[76..108]==commitment(n,&f.actor,&facts.semantic,f.nonce,&salt)&&commit_id!=business_key(f),6708)?;
    let start=reward.checked_add(i64::try_from(n).map_err(|_|err(6728))?.checked_mul(ROUND_SECONDS).ok_or(err(6728))?).ok_or(err(6728))?;
    require(i64_at(&commit,156)?>=start&&i64_at(&commit,156)?<start+WINDOW&&u64_at(&commit,140)?<u64_at(knowledge,116)?,6709)?;
    let index=u64_at(round,109)?;let m=business_key(f);let root=crate::root::instance_id(&m);let rid=round_id(n);let id=typed_hash(18,&[&domain(),&rid,&commit_id,&root]);
    require(fresh(&a[tail+2]),6716)?;let rent=record_rent(&a[tail+2],&id,&[b"bio",b"candidate",&rid,&index.to_le_bytes()],468)?;writable(&a[tail+1])?;
    let mut c=[0;348];for(at,v)in[(0,&FAMILY),(52,&commit_id),(84,&root),(116,f.actor.as_array()),(148,&facts.semantic),(188,&disclosure_id(&facts.semantic)),(220,&<[u8;32]>::try_from(&knowledge[213..245]).unwrap()),(252,&opid(f.nonce)),(308,&m)]{put32(&mut c,at,v);}c[32..36].copy_from_slice(&1u32.to_le_bytes());put64(&mut c,36,n);put64(&mut c,44,index);put64(&mut c,180,facts.cost);put64(&mut c,284,u64_at(knowledge,116)?);put64(&mut c,292,now.slot);puti64(&mut c,300,now.unix_timestamp);put64(&mut c,340,u64_at(knowledge,36)?);
    require(c[188..220]==disclosure_id(&facts.semantic)&&u64_at(disclosure,128)?==u64_at(knowledge,108)?,6715)?;
    commit[164]=1;put_ref(&mut commit,165,Some(id));commit[198]=1;put64(&mut commit,199,index);let count=add(index,1)?;put64(round,109,count);Ok(Competition{rent,tail,id,index,commit,candidate:c})
}

fn candidate_id(round:&[u8;32],commit:&[u8;32],root:&[u8;32])->[u8;32]{typed_hash(18,&[&domain(),round,commit,root])}
fn candidate_read(a:&AccountInfo,n:u64,index:u64)->Result<([u8;32],[u8;348]),ProgramError>{
    require(a.owner==&PROGRAM_ID&&a.data_len()==468,6702)?;let mut b=[0;348];b.copy_from_slice(&a.try_borrow_data()?[120..]);
    let commit:[u8;32]=b[52..84].try_into().unwrap();let root:[u8;32]=b[84..116].try_into().unwrap();let author=key_at(&b,116)?;let rid=round_id(n);let id=candidate_id(&rid,&commit,&root);
    record(a,32,468,&id,&[b"bio",b"candidate",&rid,&index.to_le_bytes()])?;let manufacture:[u8;32]=b[308..340].try_into().unwrap();
    require(b[..32]==FAMILY&&u32_at(&b,32)?==1&&u64_at(&b,36)?==n&&u64_at(&b,44)?==index&&u64_at(&b,180)?>0&&u64_at(&b,284)?>0&&i64_at(&b,300)?>=0&&author.is_on_curve()&&manufacture==typed_hash(3,&[&domain(),author.as_ref(),&b[252..284]])&&root==crate::root::instance_id(&manufacture),6702)?;Ok((id,b))
}
fn round_result(n:u64,b:&[u8;389])->Vec<u8>{let mut r=round_id(n).to_vec();r.extend_from_slice(&b[306..339]);r.extend_from_slice(&b[339..372]);r.extend_from_slice(&b[372..381]);r.push(b[117]);r.extend_from_slice(&b[175..183]);r.extend_from_slice(&b[183..191]);r}
fn expected_scan(p:&[u8],b:&[u8;389])->ProgramResult{require(p[44]==b[117]&&u64_at(p,45)?==u64_at(b,175)?&&u64_at(p,53)?==u64_at(b,if b[117]==1{126}else{183})?,6723)}
fn finish_round(task:&mut Task,b:&mut[u8;389],now:&Clock)->ProgramResult{let event=task.touch()?;task.next_round=add(task.next_round,1)?;b[117]=4;b[281]=1;put64(b,282,event);put64(b,290,now.slot);puti64(b,298,now.unix_timestamp);Ok(())}
#[inline(never)]
pub(crate) fn finalize_round<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()>=10&&f.payload.len()==102,6700)?;let p=f.payload;require(p[..32]==FAMILY&&u32_at(p,32)?==1&&key_at(p,62)?==f.actor,6701)?;let max=p[61];require((1..=8).contains(&max),6700)?;
    let(_,reward)=schedule(&a[2])?;let n=u64_at(p,36)?;let deadline=reward.checked_add(i64::try_from(add(n,1)?).map_err(|_|err(6728))?.checked_mul(ROUND_SECONDS).ok_or(err(6728))?).ok_or(err(6728))?;let now=Clock::get()?;require(now.unix_timestamp>=deadline,6704)?;
    let mut task=Task::read(&a[7])?;task.observe(now.unix_timestamp)?;require(!task.paused&&n==task.next_round,if task.paused{6706}else{6721})?;slot_body(&a[8],task.generation)?;
    let absent=fresh(&a[9]);let mut b=if absent{let mut value=round_new(&Task::empty(now.unix_timestamp),n);value[44]=0;value}else{round_read(&a[9],n)?};
    require(b[117]!=4,6725)?;
    if !absent&&(b[117]==0||u64_at(&b,118)?!=task.epoch){require(p[44]==b[117]&&u64_at(p,45)?==0&&u64_at(p,53)?==0,6723)?;}else{expected_scan(p,&b)?;}
    let mut rent=nonce_rent(&a[1])?;
    if absent{require(a.len()==10,6702)?;rent=add(rent,record_rent(&a[9],&round_id(n),&[b"bio",b"round",&FAMILY,&1u32.to_le_bytes(),&n.to_le_bytes()],509)?)?;finish_round(&mut task,&mut b,&now)?;}
    else if b[117]==0||u64_at(&b,118)?!=task.epoch{
        require(a.len()==10,6702)?;b[117]=1;put64(&mut b,118,task.epoch);b[126..281].fill(0);put64(&mut b,381,task.count);
    }else if b[117]==1{
        let mut cursor=u64_at(&b,126)?;let stop=add(cursor,u64::from(max))?.min(u64_at(&b,381)?);let mut at=10;
        while cursor<stop{require(at<a.len(),6702)?;let row=knowledge_read(&a[at],cursor)?;at+=1;let origin=safety::effective_index(a,&mut at,&row,cursor)?;if row[245]==0&&origin<u64_at(&b,85)?{let c=u64_at(&row,140)?;if b[134]==0||c<u64_at(&b,135)?{b[134]=1;put64(&mut b,135,c);b[143..175].copy_from_slice(&row[44..76]);}}cursor=add(cursor,1)?;}require(at==a.len(),6702)?;put64(&mut b,126,cursor);if cursor==u64_at(&b,381)?{b[117]=2;}
    }else if b[117]==2{
        let index=u64_at(&b,175)?;let count=u64_at(&b,109)?;
        if index==count{require(a.len()==10,6702)?;b[117]=3;}
        else{
            require(index<count&&a.len()>=14,6716)?;let(cid,c)=candidate_read(&a[10],n,index)?;let commit_id:[u8;32]=c[52..84].try_into().unwrap();let commit=commit_read(&a[11],&commit_id)?;let design:[u8;32]=c[148..180].try_into().unwrap();let disclosure=disclosure_read(&a[12],&design)?;let own_index=u64_at(&c,340)?;let own=knowledge_read(&a[13],own_index)?;
            require(commit[164]==1&&ref33(&commit,165)?==Some(cid)&&u64_at(&commit,199)?==index&&commit[44..76]==c[116..148]&&u64_at(&commit,36)?==n&&c[188..220]==disclosure_id(&design)&&own_index<u64_at(&b,93)?&&own[44..76]==design&&own[149..181]==c[84..116]&&own[213..245]==c[220..252]&&u64_at(&own,140)?==u64_at(&c,180)?&&u64_at(&own,116)?==u64_at(&c,284)?&&u64_at(&own,108)?==u64_at(&disclosure,128)?,6715)?;
            let round_start=deadline-ROUND_SECONDS;require(i64_at(&commit,156)?>=round_start&&i64_at(&commit,156)?<round_start+WINDOW&&i64_at(&c,300)?>=round_start+WINDOW&&i64_at(&c,300)?<round_start+2*WINDOW,6711)?;
            let mut cursor=u64_at(&b,183)?;let stop=add(cursor,u64::from(max))?.min(u64_at(&b,381)?);let mut next=14;
            while cursor<stop{let row=if cursor==own_index{own}else{require(next<a.len(),6702)?;let v=knowledge_read(&a[next],cursor)?;next+=1;v};let origin=safety::effective_index(a,&mut next,&row,cursor)?;if row[245]==0&&origin<u64_at(&b,93)?&&u64_at(&row,140)?<=u64_at(&c,180)?{let event=u64_at(&row,108)?;if b[191]==0||event<u64_at(&b,192)?{b[191]=1;put64(&mut b,192,event);}}cursor=add(cursor,1)?;}require(next==a.len(),6702)?;
            put64(&mut b,183,cursor);if cursor==u64_at(&b,381)?{
                let commit_seq=u64_at(&commit,140)?;let cost=u64_at(&c,180)?;let eligible=own[245]==0&&b[191]==1&&commit_seq<u64_at(&b,192)?&&(b[134]==0||cost<u64_at(&b,135)?);
                let better=ref33(&b,200)?.is_none()||cost<u64_at(&b,233)?||(cost==u64_at(&b,233)?&&(commit_seq<u64_at(&b,241)?||(commit_seq==u64_at(&b,241)?&&c[308..340]<b[249..281])));
                if eligible&&better{put_ref(&mut b,200,Some(cid));put64(&mut b,233,cost);put64(&mut b,241,commit_seq);b[249..281].copy_from_slice(&c[308..340]);}put64(&mut b,175,add(index,1)?);put64(&mut b,183,0);b[191..200].fill(0);if u64_at(&b,175)?==count{b[117]=3;}
            }
        }
    }else if b[117]==3{
        if ref33(&b,200)?.is_none(){require(a.len()==10,6702)?;finish_round(&mut task,&mut b,&now)?;}
        else{
            require(a.len()>=16,6702)?;let index={require(a[10].data_len()==468,6702)?;u64_at(&a[10].try_borrow_data()?,164)?};let(cid,c)=candidate_read(&a[10],n,index)?;require(ref33(&b,200)?==Some(cid)&&u64_at(&c,180)?==u64_at(&b,233)?,6716)?;
            let commit_id:[u8;32]=c[52..84].try_into().unwrap();let commit=commit_read(&a[11],&commit_id)?;let own=knowledge_read(&a[12],u64_at(&c,340)?)?;require(own[245]==0&&own[213..245]==c[220..252]&&u64_at(&commit,140)?==u64_at(&b,241)?,6715)?;
            let root=crate::root::read_root(&a[14])?;require(root.instance.as_ref()==&c[84..116]&&root.q==2_000_000,6715)?;
            valid_pda(&a[15],&PROGRAM_ID,&[b"bio",b"root-reg",root.instance.as_ref()])?;
            let rr=if fresh(&a[15]){None}else{Some(crate::settlement::root_reg(&a[15],&root.instance)?)};
            let author=key_at(&c,116)?;let rid=round_id(n);let wid=typed_hash(10,&[&domain(),&rid]);require(fresh(&a[13]),6725)?;rent=add(rent,record_rent(&a[13],&wid,&[b"bio",b"winner",&wid],372)?)?;
            let slot=slot_body(&a[8],task.generation)?;let activation=if eligible_k(&task,&root,rr.as_deref(),&author,u64_at(&c,180)?,now.unix_timestamp,reward){
                let last=ref33(&slot,40)?.map(|_|21);require(a.len()==21+usize::from(last.is_some()),6702)?;
                let prepared=prepare_activation(a,KAccounts{root_reg:15,ordinary:16,activation:17,directory:18,registry:19,event:20,last},&root,rr.ok_or(err(6726))?,&slot,&task,&wid,&author,u64_at(&c,180)?,&now,add(task.event,1)?)?;rent=add(rent,prepared.rent)?;Some(prepared)
            }else{require(a.len()==16,6702)?;None};
            let event=add(task.event,1)?;let mut w=[0;252];for(at,v)in[(0,&FAMILY),(44,&<[u8;32]>::try_from(&c[84..116]).unwrap()),(76,&<[u8;32]>::try_from(&c[116..148]).unwrap()),(108,&<[u8;32]>::try_from(&c[148..180]).unwrap()),(148,&commit_id),(180,&cid)]{put32(&mut w,at,v);}w[32..36].copy_from_slice(&1u32.to_le_bytes());put64(&mut w,36,n);put64(&mut w,140,u64_at(&c,180)?);put64(&mut w,212,u64_at(&commit,140)?);put64(&mut w,220,u64_at(&c,284)?);put64(&mut w,228,event);put64(&mut w,236,now.slot);puti64(&mut w,244,now.unix_timestamp);
            check_budget(a,rent,u64_at(p,94)?)?;create_record(&a[13],&a[0],&a[4],16,&wid,&[b"bio",b"winner",&wid],&w)?;put_ref(&mut b,306,Some(wid));
            if let Some(activation)=activation{commit_activation(a,&activation,f)?;task.generation=activation.generation;slot_store(&a[8],a,&activation.slot)?;put_ref(&mut b,339,Some(activation.id));b[372]=1;put64(&mut b,373,activation.start);}
            finish_round(&mut task,&mut b,&now)?;
        }
    }else{return Err(err(6722));}
    check_budget(a,rent,u64_at(p,94)?)?;round_store(&a[9],a,n,&b)?;task_store(&a[7],a,&task)?;Ok(round_result(n,&b))
}

pub(crate) struct ActivationFacts{pub id:[u8;32],pub winner:[u8;32],pub instance:Pubkey,pub author:Pubkey,pub ordinary:[u8;32],pub generation:u64,pub local:u64,pub global:u64,pub start:u64,pub end:Option<u64>,pub body:[u8;251]}
pub(crate) fn read_activation(a:&AccountInfo)->Result<ActivationFacts,ProgramError>{
    require(a.owner==&PROGRAM_ID&&a.data_len()==371,6702)?;let mut b=[0;251];b.copy_from_slice(&a.try_borrow_data()?[120..]);let winner:[u8;32]=b[32..64].try_into().unwrap();let local=u64_at(&b,168)?;let id=typed_hash(11,&[&domain(),&FAMILY,&winner,&local.to_le_bytes()]);record(a,17,371,&id,&[b"bio",b"activation",&id])?;
    let start=u64_at(&b,184)?;require(b[..32]==FAMILY&&b[192]<=1&&start<H_END&&u64_at(&b,202)?>0&&i64_at(&b,218)?>=0,6702)?;
    let end=if b[192]==0{require(u64_at(&b,193)?==0&&b[201]==0&&zeros(&b[226..251]),6702)?;None}else{let end=u64_at(&b,193)?;require(end>=start&&end<=H_END&&(1..=6).contains(&b[201])&&b[226]==1&&u64_at(&b,227)?>=u64_at(&b,202)?&&u64_at(&b,235)?>=u64_at(&b,210)?&&i64_at(&b,243)?>=i64_at(&b,218)?,6702)?;Some(end)};
    Ok(ActivationFacts{id,winner,instance:key_at(&b,64)?,author:key_at(&b,96)?,ordinary:b[128..160].try_into().unwrap(),generation:u64_at(&b,160)?,local,global:u64_at(&b,176)?,start,end,body:b})
}
struct PreparedStop{tail:usize,event_at:Option<usize>,activation:[u8;251],registration:Vec<u8>}
fn prepare_stop(a:&[AccountInfo],tail:usize,registry:&AccountInfo,slot:&[u8;74],task:&Task,now:&Clock,stop:bool,reason:u8)->Result<(PreparedStop,u64),ProgramError>{
    require(a.len()>=tail+4,6702)?;let old=read_activation(&a[tail])?;require(ref33(slot,40)?==Some(old.id),6726)?;let root=crate::root::read_root(&a[tail+3])?;require(root.instance==old.instance,6726)?;
    let mut rr=crate::settlement::root_reg(&a[tail+1],&old.instance)?;require(rr[97..129]==old.id&&u64_at(&rr,89)?==add(old.local,1)?&&rr[129]==u8::from(old.end.is_some())&&u64_at(&rr,130)?==old.end.unwrap_or(0),6726)?;
    require(a[tail+2].data_len()==375,6702)?;let seq=u64_at(&a[tail+2].try_borrow_data()?,152)?;require(seq<u64_at(&rr,40)?,6726)?;let position=crate::settlement::position_body(&a[tail+2],&old.instance,seq,u64_at(&rr,244)?)?;let position_id=typed_hash(14,&[&domain(),&27u16.to_le_bytes(),old.instance.as_ref(),&seq.to_le_bytes()]);require(old.ordinary==position_id&&position[80..112]==old.author.to_bytes()&&old.start>=u64_at(&position,149)?,6726)?;
    let mut body=old.body;let mut rent=0;let mut event_at=None;
    if stop&&old.end.is_none(){
        writable(&a[tail])?;writable(&a[tail+1])?;require(now.unix_timestamp>=i64_at(&body,218)?&&now.slot>=u64_at(&body,210)?,6704)?;
        let(_,reward)=schedule(&a[2])?;require(now.unix_timestamp>=reward,6704)?;let mut end=add(((now.unix_timestamp-reward)/3600)as u64,1)?.min(H_END).max(old.start);if position[157]==1{end=end.min(u64_at(&position,158)?).max(old.start);}
        body[192]=1;put64(&mut body,193,end);body[201]=reason;body[226]=1;put64(&mut body,227,task.event);put64(&mut body,235,now.slot);puti64(&mut body,243,now.unix_timestamp);
        rr[129]=1;put64(&mut rr,130,end);let revision=add(u64_at(&rr,32)?,1)?;put64(&mut rr,32,revision);event_at=Some(tail+4);require(a.len()>tail+4,6702)?;rent=crate::settlement::event_rent(&a[tail+4],registry)?;
    }
    Ok((PreparedStop{tail,event_at,activation:body,registration:rr},rent))
}
fn commit_stop<'a>(a:&[AccountInfo<'a>],registry:&AccountInfo<'a>,stop:&PreparedStop,f:&Frame)->ProgramResult{
    if let Some(index)=stop.event_at{store_body(&a[stop.tail],&stop.activation)?;store_body(&a[stop.tail+1],&stop.registration)?;crate::settlement::enqueue_k_event(a,registry,&a[index],&a[stop.tail],&a[stop.tail+2],f,true)?;}Ok(())
}

pub(crate) fn exit_with_k<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()>=12&&f.payload.len()==56,6700)?;let instance=key_at(f.payload,0)?;let rr=crate::settlement::root_reg(&a[9],&instance)?;
    if rr[129]==1{require(a.len()==12,6702)?;return crate::settlement::exit(a,f);}
    require(a.len()==16,6702)?;let root=crate::root::read_root(&a[8])?;require(root.instance==instance&&root.owner==f.actor&&root.lifecycle==0&&root.revision==u64_at(f.payload,40)?,6709)?;
    let now=Clock::get()?;let mut task=Task::read(&a[12])?;task.observe(now.unix_timestamp)?;let mut slot=slot_body(&a[13],task.generation)?;task.touch()?;task.generation=add(task.generation,1)?;
    // Internal aliases are references to the same already checked accounts, not
    // another external account table or a second authority/nonce ingress.
    let mut view=a.to_vec();let tail=view.len();view.extend([a[14].clone(),a[9].clone(),a[10].clone(),a[8].clone(),a[15].clone()]);
    let(mut stop,rent)=prepare_stop(&view,tail,&a[7],&slot,&task,&now,true,1)?;require(stop.event_at.is_some(),6726)?;
    // EXIT updates ordinary and K in one object transition: its existing final
    // write advances RegRevision exactly once, after this invisible preparation.
    put64(&mut stop.registration,32,u64_at(&rr,32)?);
    let rg=crate::settlement::registry(&a[7])?;let _=rg;let event_seq=u64_at(&a[7].try_borrow_data()?,160)?;let next=add(event_seq,1)?;
    valid_pda(&a[11],&PROGRAM_ID,&[b"bio",b"mining-event",&next.to_le_bytes()])?;let ordinary_rent=need_rent(&a[11],297)?;let total=add(add(nonce_rent(&a[1])?,rent)?,ordinary_rent)?;check_budget(a,total,u64_at(f.payload,48)?)?;
    commit_stop(&view,&a[7],&stop,f)?;slot[73]=2;put64(&mut slot,32,task.generation);slot_store(&a[13],a,&slot)?;task_store(&a[12],a,&task)?;crate::settlement::exit(&a[..12],f)
}

#[derive(Clone,Copy)]
struct KAccounts{root_reg:usize,ordinary:usize,activation:usize,directory:usize,registry:usize,event:usize,last:Option<usize>}
struct PreparedActivation{rent:u64,map:KAccounts,id:[u8;32],start:u64,local:u64,global:u64,body:[u8;251],registration:Vec<u8>,registry:[u64;5],slot:[u8;74],generation:u64}
fn eligible_k(task:&Task,root:&crate::root::RootFacts,rr:Option<&[u8]>,author:&Pubkey,cost:u64,now:i64,reward:i64)->bool{
    !task.paused&&task.best.map_or(false,|b|b.0==cost)&&root.lifecycle==0&&root.owner==*author&&root.schema==4&&root.q==2_000_000&&now>=reward&&(((now-reward)/3600)as u64)<H_END-1
        &&rr.map_or(false,|r|r[154]==0&&r[203]==0&&u64_at(r,40).unwrap_or(0)>0&&r[80]==0&&r[129]==1)
}
#[inline(never)]
fn prepare_activation(a:&[AccountInfo],map:KAccounts,root:&crate::root::RootFacts,mut rr:Vec<u8>,slot:&[u8;74],task:&Task,winner:&[u8;32],author:&Pubkey,cost:u64,now:&Clock,event:u64)->Result<Box<PreparedActivation>,ProgramError>{
    let(_,reward)=schedule(&a[2])?;require(eligible_k(task,root,Some(&rr),author,cost,now.unix_timestamp,reward),6726)?;
    let count=u64_at(&rr,40)?;let ordinary=crate::settlement::position_body(&a[map.ordinary],&root.instance,count-1,u64_at(&rr,244)?)?;
    let start=add(((now.unix_timestamp-reward)/3600)as u64,1)?;require(start<H_END&&ordinary[157]==0&&ordinary[80..112]==author.to_bytes()&&u64_at(&ordinary,149)?<=start,6726)?;
    // Position.body48 is registration M, while its actual immutable identity is
    // derived from instance/seq. Never confuse that M with the interval ID.
    let ordinary_id=typed_hash(14,&[&domain(),&27u16.to_le_bytes(),root.instance.as_ref(),&(count-1).to_le_bytes()]);
    require(rr[48..80]==ordinary_id&&root.revision==u64_at(&ordinary,112)?,6726)?;
    let mut rg=crate::settlement::registry(&a[map.registry])?;crate::settlement::observe(&mut rg,now.unix_timestamp)?;let global=rg[3];
    match ref33(slot,40)?{None=>require(global==0&&map.last.is_none(),6726)?,Some(last)=>{let old=read_activation(&a[map.last.ok_or(err(6726))?])?;require(old.id==last&&add(old.global,1)?==global&&old.start<=start&&old.end.map_or(false,|end|end<=start),6726)?;}}
    let local=u64_at(&rr,89)?;let id=typed_hash(11,&[&domain(),&FAMILY,winner,&local.to_le_bytes()]);let generation=add(task.generation,1)?;
    let mut body=[0;251];for(at,v)in[(0,&FAMILY),(32,winner),(64,root.instance.as_array()),(96,author.as_array()),(128,&ordinary_id)]{put32(&mut body,at,v);}put64(&mut body,160,generation);put64(&mut body,168,local);put64(&mut body,176,global);put64(&mut body,184,start);put64(&mut body,202,event);put64(&mut body,210,now.slot);puti64(&mut body,218,now.unix_timestamp);
    let dir_id=typed_hash(14,&[&domain(),&28u16.to_le_bytes(),&[1],&global.to_le_bytes()]);require(fresh(&a[map.activation])&&fresh(&a[map.directory]),6726)?;
    let mut rent=record_rent(&a[map.activation],&id,&[b"bio",b"activation",&id],371)?;rent=add(rent,record_rent(&a[map.directory],&dir_id,&[b"bio",b"mining-k",&global.to_le_bytes()],201)?)?;rent=add(rent,crate::settlement::event_rent(&a[map.event],&a[map.registry])?)?;
    writable(&a[map.root_reg])?;writable(&a[map.registry])?;let revision=add(u64_at(&rr,32)?,1)?;put64(&mut rr,32,revision);put64(&mut rr,89,add(local,1)?);put32(&mut rr,97,&id);rr[129]=0;put64(&mut rr,130,0);rg[3]=add(global,1)?;
    let mut slot=*slot;put64(&mut slot,32,generation);put_ref(&mut slot,40,Some(id));slot[73]=1;
    Ok(Box::new(PreparedActivation{rent,map,id,start,local,global,body,registration:rr,registry:rg,slot,generation}))
}
fn commit_activation<'a>(a:&[AccountInfo<'a>],p:&PreparedActivation,f:&Frame)->ProgramResult{
    create_record(&a[p.map.activation],&a[0],&a[4],17,&p.id,&[b"bio",b"activation",&p.id],&p.body)?;
    let key=typed_hash(14,&[&domain(),&28u16.to_le_bytes(),&[1],&p.global.to_le_bytes()]);let mut directory=[0;81];put64(&mut directory,0,p.global);directory[8]=1;directory[9..41].copy_from_slice(&p.body[64..96]);put32(&mut directory,41,&p.id);put64(&mut directory,73,p.local);
    create_record(&a[p.map.directory],&a[0],&a[4],28,&key,&[b"bio",b"mining-k",&p.global.to_le_bytes()],&directory)?;store_body(&a[p.map.root_reg],&p.registration)?;crate::settlement::write_registry(&a[p.map.registry],p.registry)?;crate::settlement::enqueue_k_event(a,&a[p.map.registry],&a[p.map.event],&a[p.map.activation],&a[p.map.ordinary],f,false)
}

fn winner_read(a:&AccountInfo,id:&[u8;32])->Result<[u8;252],ProgramError>{record(a,16,372,id,&[b"bio",b"winner",id])?;let mut b=[0;252];b.copy_from_slice(&a.try_borrow_data()?[120..]);require(b[..32]==FAMILY&&u32_at(&b,32)?==1&&*id==typed_hash(10,&[&domain(),&round_id(u64_at(&b,36)?)] )&&u64_at(&b,140)?>0&&u64_at(&b,212)?>0&&u64_at(&b,220)?>u64_at(&b,212)?&&u64_at(&b,228)?>u64_at(&b,220)?&&i64_at(&b,244)?>=0,6702)?;Ok(b)}
pub(crate) fn activate_winner<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()>=17&&f.payload.len()==48,6700)?;let id:[u8;32]=f.payload[..32].try_into().unwrap();let now=Clock::get()?;let(_,reward)=schedule(&a[2])?;
    let mut task=Task::read(&a[7])?;task.observe(now.unix_timestamp)?;require(task.generation==u64_at(f.payload,32)?,6703)?;let slot=slot_body(&a[8],task.generation)?;let w=winner_read(&a[9],&id)?;require(w[76..108]==f.actor.to_bytes(),6709)?;
    let root=crate::root::read_root(&a[10])?;require(root.instance.as_ref()==&w[44..76],6702)?;let rr=crate::settlement::root_reg(&a[11],&root.instance)?;require(eligible_k(&task,&root,Some(&rr),&f.actor,u64_at(&w,140)?,now.unix_timestamp,reward),6726)?;
    let last=ref33(&slot,40)?.map(|_|17);require(a.len()==17+usize::from(last.is_some()),6702)?;let event=add(task.event,1)?;let prepared=prepare_activation(a,KAccounts{root_reg:11,ordinary:12,activation:13,directory:14,registry:15,event:16,last},&root,rr,&slot,&task,&id,&f.actor,u64_at(&w,140)?,&now,event)?;
    check_budget(a,add(prepared.rent,nonce_rent(&a[1])?)?,u64_at(f.payload,40)?)?;commit_activation(a,&prepared,f)?;task.touch()?;task.generation=prepared.generation;slot_store(&a[8],a,&prepared.slot)?;task_store(&a[7],a,&task)?;
    let mut result=prepared.id.to_vec();result.extend_from_slice(&prepared.start.to_le_bytes());result.extend_from_slice(&prepared.generation.to_le_bytes());Ok(result)
}

#[inline(never)]
fn history_graph(bytes:&[u8],challenge:u32)->Result<Box<Blueprint>,ProgramError>{
    let payload=crate::synthesis::parse_boxed(bytes)?;let end=payload.graph_at.checked_add(payload.graph_len).ok_or(err(6737))?;let g=graph::decode_graph(&bytes[payload.graph_at..end])?;
    require(g.target==22&&g.domain==domain()&&g.config==config_id()&&g.catalog==materials::catalog_hash()&&g.rule==APPROVED_RULE_HASH,6737)?;
    let map_end=payload.leaf_at+1+payload.leaf_count*70;require(map_end<=bytes.len(),6737)?;
    Ok(Box::new(Blueprint{graph_at:payload.graph_at,graph_len:payload.graph_len,map_sha:hashv(&[&bytes[payload.leaf_at..map_end]]).to_bytes(),challenge,graph:g}))
}

#[path="originality_safety.rs"]mod safety;
pub(crate) use safety::{prove_fault,audit_next,recover_task};

/// Only errors from fixed, pure approved parser/runtime call sites are eligible.
/// Account/PDA/signature/Artifact binding failures are checked outside these
/// sites. VM budget, allocator aborts and other traps never return through here.
fn definite_error(error:&ProgramError,stage:u8)->Option<u32>{
    match(stage,error){
        (0,ProgramError::InvalidAccountData)=>Some(0xff00_0001),
        (0,ProgramError::Custom(code))if [6600,6605,6712,6737,8000].contains(code)=>Some(*code),
        (1,ProgramError::Custom(8017))=>Some(8017),
        (2,ProgramError::Custom(code))if(8001..=8016).contains(code)=>Some(*code),
        (2,ProgramError::ArithmeticOverflow)=>Some(0xff00_0002),
        (3,ProgramError::Custom(8019))=>Some(8019),
        _=>None,
    }
}
#[inline(never)]
pub(crate) fn history_begin<'a>(a:&[AccountInfo<'a>],f:&Frame)->Result<Vec<u8>,ProgramError>{
    require(a.len()==10&&f.payload.len()==117,6730)?;config(&a[2])?;let p=f.payload;let kind=p[0];require(kind<=1,6737)?;
    let base:[u8;32]=p[1..33].try_into().unwrap();let v=verification::read_sealed(&a[7],if kind==0{BLUEPRINT_KIND}else{702})?;require(p[33..65]==v.id&&p[65..97]==v.hash&&u32_at(p,97)?as usize==v.total_len,6737)?;
    // These are actual immutable evidence bindings, not catchable model errors.
    let challenge=if kind==0{
        require(a[9].data_len()==321,6737)?;let design:[u8;32]=a[9].try_borrow_data()?[152..184].try_into().unwrap();let seed=seed_read(&a[9],&design)?;let(_,reward)=schedule(&a[2])?;require(base==seed_key(&design)&&seed[64..96]==v.id&&i64_at(&seed,193)?<reward,6737)?;2_000_000
    }else{
        let root=crate::root::read_root(&a[9])?;require(root.schema==4&&root.instance.to_bytes()==base,6737)?;let d=a[9].try_borrow_data()?;require(d[443..475]==v.id&&d[475..507]==v.hash&&u32_at(&d,507)?as usize==v.total_len,6737)?;u32_at(&d,607)?
    };
    let expected=u64_at(p,101)?;let now=Clock::get()?;let(old,clock)=prior_session(&a[8],&f.actor)?;require(expected==old&&now.unix_timestamp>=clock,6703)?;writable(&a[8])?;
    let raw=a[7].try_borrow_data()?;let bytes=&raw[verification::ARTIFACT_OFFSET..];let attempt=if kind==0{blueprint(bytes).and_then(|b|{require(b.challenge==challenge,6712)?;Ok(b)})}else{history_graph(bytes,challenge)};
    let mut failure=0;let mut failure_stage=0;let mut graph_at=0;let mut graph_len=bytes.len();let mut map_sha=[0;32];let mut semantic=[0;32];
    let session=match attempt{
        Ok(decoded)=>{graph_at=decoded.graph_at;graph_len=decoded.graph_len;map_sha=decoded.map_sha;semantic=crate::synthesis::semantic_id(&decoded.graph)?;let sha=hashv(&[&bytes[graph_at..graph_at+graph_len]]).to_bytes();match runtime::begin_session(&decoded.graph,challenge,sha){Ok(session)=>session,Err(error)=>{failure=definite_error(&error,1).ok_or(error)?;failure_stage=1;failure_session(challenge,v.hash,failure)}}},
        Err(error)=>{failure=definite_error(&error,0).ok_or(error)?;failure_session(challenge,v.hash,failure)},
    };
    let rent=add(nonce_rent(&a[1])?,if fresh(&a[8]){need_rent(&a[8],VERIFY_LEN)?}else{0})?;check_budget(a,rent,u64_at(p,109)?)?;
    if fresh(&a[8]){allocate(&a[0],&a[8],&a[4],&PROGRAM_ID,VERIFY_LEN,&[b"bio",b"verify",f.actor.as_ref()])?;}let bump=valid_pda(&a[8],&PROGRAM_ID,&[b"bio",b"verify",f.actor.as_ref()])?;write_header(&a[8],37,5,f.actor.as_array(),bump)?;
    let state=BlueprintSession{artifact:v.id,sha:v.hash,len:v.total_len,graph_at,graph_len,map_sha,semantic,used:false,historical:true,base_kind:kind,base_ref:base,failure,failure_stage,failure_cursor:0,kernel:Scratch{generation:add(expected,1)?,clock:now.unix_timestamp,actor:f.actor.to_bytes(),config:config_id(),validator:APPROVED_VALIDATOR_HASH,direct:map_sha,last_from:u16::MAX,last_count:0,last_request:[0;32],session,quality:0,task:false,cost:0}};state.write(&a[8])?;Ok(state.result())
}
fn failure_session(challenge:u32,payload:[u8;32],code:u32)->runtime::Session{runtime::Session{target:22,challenge,graph_sha:payload,cursor:0,boundary:runtime::Boundary::default(),minima:[0;15],positive:[0;64],digest:hashv(&[b"BIOFAIL1",&payload,&code.to_le_bytes()]).to_bytes(),cases:[runtime::Boundary::default();4]}}

fn valid_failure_code(stage:u8,code:u32)->bool{match stage{0=>[0xff00_0001,6600,6605,6712,6737,8000].contains(&code),1=>code==8017,2=>(8001..=8016).contains(&code)||code==0xff00_0002,3=>code==8019,_=>false}}
