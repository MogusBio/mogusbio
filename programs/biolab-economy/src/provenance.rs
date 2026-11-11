//! Bounded program-owned k-way provenance validation and ordinary SHA256 state.
//! This is not a hash chain. Pass 1 checks all effective AND retired intervals;
//! pass 2 hashes the exact counted canonical SourceSliceRef50 byte stream.
use crate::*;
use crate::synthesis::Payload;

pub(crate) const BYTES:usize=955;
const BATCH:usize=64;
#[derive(Clone,Copy,Default)]
struct Cursor{pos:u16,group:u16,mask:u32,remaining:u8,entries:u8}
#[derive(Clone,Copy,Default,Debug,PartialEq,Eq)]
pub(crate) struct Slice{source:[u8;32],species:u16,lo:u64,hi:u64}
fn same(a:&Slice,b:&Slice)->bool{a.source==b.source&&a.species==b.species}
fn compare(a:&Slice,b:&Slice)->std::cmp::Ordering{a.source.cmp(&b.source).then(a.species.cmp(&b.species)).then(a.lo.cmp(&b.lo)).then(a.hi.cmp(&b.hi))}
fn effective(s:u16)->bool{s<=24||(29..=31).contains(&s)}
fn credit(s:u16)->u64{if s<=20{6}else if s<=28{15}else if s<=31{40}else{120}}
fn row_bytes(row:&Slice)->[u8;50]{let mut b=[0;50];b[..32].copy_from_slice(&row.source);b[32..34].copy_from_slice(&row.species.to_le_bytes());b[34..42].copy_from_slice(&row.lo.to_le_bytes());b[42..50].copy_from_slice(&row.hi.to_le_bytes());b}
fn read_row(b:&[u8])->Result<Slice,ProgramError>{require(b.len()==50,6620)?;Ok(Slice{source:b[..32].try_into().unwrap(),species:u16_at(b,32)?,lo:u64_at(b,34)?,hi:u64_at(b,42)?})}

#[derive(Clone)]
struct StreamingSha{words:[u32;8],bytes:u64,buffer:[u8;64],used:u8}
impl StreamingSha{
    fn new()->Self{Self{words:[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],bytes:0,buffer:[0;64],used:0}}
    fn update(&mut self,mut input:&[u8])->ProgramResult{
        self.bytes=add(self.bytes,input.len()as u64)?;
        while !input.is_empty(){let count=input.len().min(64-usize::from(self.used));let start=usize::from(self.used);self.buffer[start..start+count].copy_from_slice(&input[..count]);self.used+=count as u8;input=&input[count..];
            if self.used==64{sha2::compress256(&mut self.words,std::slice::from_ref(sha2::digest::generic_array::GenericArray::from_slice(&self.buffer)));self.used=0;self.buffer.fill(0);}}
        Ok(())
    }
    fn finish(&self)->Result<[u8;32],ProgramError>{let mut s=self.clone();let bits=s.bytes.checked_mul(8).ok_or(err(8020))?;s.update(&[0x80])?;while s.used!=56{s.update(&[0])?;}s.update(&bits.to_be_bytes())?;require(s.used==0,6620)?;
        let mut digest=[0;32];for(i,word)in s.words.iter().enumerate(){digest[i*4..i*4+4].copy_from_slice(&word.to_be_bytes());}Ok(digest)}
    fn encode(&self,out:&mut[u8]){for(i,word)in self.words.iter().enumerate(){out[i*4..i*4+4].copy_from_slice(&word.to_le_bytes());}out[32..40].copy_from_slice(&self.bytes.to_le_bytes());out[40..104].copy_from_slice(&self.buffer);out[104]=self.used;}
    fn decode(b:&[u8])->Result<Self,ProgramError>{require(b.len()==105&&b[104]<64&&zeros(&b[40+usize::from(b[104])..104]),6620)?;let mut words=[0;8];for(i,w)in words.iter_mut().enumerate(){*w=u32_at(b,i*4)?;}let bytes=u64_at(b,32)?;require(bytes%64==u64::from(b[104]),6620)?;Ok(Self{words,bytes,buffer:b[40..104].try_into().unwrap(),used:b[104]})}
}

pub(crate) struct Provenance{
    cursors:[Cursor;60],last:Option<Slice>,open:Option<Slice>,count:u32,b:u64,retired:u64,processed:u32,emitted:u32,sha:StreamingSha,
}
impl Provenance{
    pub(crate) fn new()->Self{Self{cursors:[Cursor::default();60],last:None,open:None,count:0,b:0,retired:0,processed:0,emitted:0,sha:StreamingSha::new()}}
    #[inline(never)]
    pub(crate) fn new_boxed()->Box<Self>{Box::new(Self::new())}
    pub(crate) fn reset_iterators(&mut self,bytes:&[u8],payload:&Payload)->ProgramResult{
        self.cursors=[Cursor::default();60];self.last=None;self.open=None;self.processed=0;
        for (i,(start,len))in payload.capsules.iter().take(payload.leaf_count).enumerate(){let cap=&bytes[*start..*start+*len];let groups=u32_at(cap,322)?;require((1..=32).contains(&groups),6621)?;
            self.cursors[i]=Cursor{pos:362,group:326,mask:u32_at(cap,358)?,remaining:groups as u8,entries:0};require(self.cursors[i].mask!=0,6621)?;}
        Ok(())
    }
    fn peek(&self,i:usize,bytes:&[u8],payload:&Payload)->Result<Option<Slice>,ProgramError>{
        let cursor=self.cursors[i];if cursor.remaining==0{return Ok(None);}require(cursor.mask!=0&&cursor.entries<128,6621)?;
        let(start,len)=payload.capsules[i];let cap=&bytes[start..start+len];let group=usize::from(cursor.group);let pos=usize::from(cursor.pos);
        require(group+36<=cap.len()&&pos+16<=cap.len(),6621)?;let lo=u64_at(cap,pos)?;let amount=u64_at(cap,pos+8)?;require(amount>0,6621)?;
        Ok(Some(Slice{source:cap[group..group+32].try_into().unwrap(),species:(cursor.mask.trailing_zeros()+1)as u16,lo,hi:add(lo,amount)?}))
    }
    fn next(&mut self,bytes:&[u8],payload:&Payload)->Result<Option<Slice>,ProgramError>{
        let mut chosen:Option<(usize,Slice)>=None;
        for i in 0..payload.leaf_count{if let Some(row)=self.peek(i,bytes,payload)?{if chosen.as_ref().map_or(true,|(_,old)|compare(&row,old).is_lt()){chosen=Some((i,row));}}}
        let Some((i,row))=chosen else{return Ok(None);};let cursor=&mut self.cursors[i];cursor.mask&=cursor.mask-1;cursor.pos=cursor.pos.checked_add(16).ok_or(err(6621))?;cursor.entries=cursor.entries.checked_add(1).ok_or(err(6621))?;
        if cursor.mask==0{cursor.remaining-=1;if cursor.remaining>0{cursor.group=cursor.pos;let(start,len)=payload.capsules[i];let cap=&bytes[start..start+len];cursor.mask=u32_at(cap,usize::from(cursor.group)+32)?;require(cursor.mask!=0,6621)?;cursor.pos=cursor.pos.checked_add(36).ok_or(err(6621))?;}else{let(_,len)=payload.capsules[i];require(usize::from(cursor.pos)==len,6621)?;}}
        self.processed=self.processed.checked_add(1).ok_or(err(8020))?;require(self.processed<=7680,6621)?;Ok(Some(row))
    }
    fn done(&self,payload:&Payload)->bool{self.cursors.iter().take(payload.leaf_count).all(|c|c.remaining==0)}
    /// Count canonical effective segments while checking every historical row.
    pub(crate) fn count_step(&mut self,bytes:&[u8],payload:&Payload,b:u64,retired:u64)->Result<bool,ProgramError>{
        for _ in 0..BATCH{let Some(row)=self.next(bytes,payload)?else{break;};if let Some(last)=self.last{require(!same(&last,&row)||row.lo>=last.hi,6609)?;}self.last=Some(row);
            let value=(row.hi-row.lo).checked_mul(credit(row.species)).ok_or(err(8020))?;
            if effective(row.species){self.b=add(self.b,value)?;
                if let Some(open)=&mut self.open{if same(open,&row)&&open.hi==row.lo{open.hi=row.hi;continue;}self.count=self.count.checked_add(1).ok_or(err(8020))?;}self.open=Some(row);
            }else{self.retired=add(self.retired,value)?;}
        }
        if !self.done(payload){return Ok(false);}if self.open.take().is_some(){self.count=self.count.checked_add(1).ok_or(err(8020))?;}
        require(self.count>0&&self.count<=7680&&self.b==b&&self.retired==retired,6609)?;
        self.reset_iterators(bytes,payload)?;self.sha=StreamingSha::new();self.sha.update(&self.count.to_le_bytes())?;self.emitted=0;Ok(true)
    }
    fn emit(&mut self,row:&Slice)->ProgramResult{self.sha.update(&row_bytes(row))?;self.emitted=self.emitted.checked_add(1).ok_or(err(8020))?;require(self.emitted<=self.count,6621)}
    /// Replay exact immutable iterators into the ordinary SHA internal state.
    pub(crate) fn hash_step(&mut self,bytes:&[u8],payload:&Payload)->Result<Option<[u8;32]>,ProgramError>{
        for _ in 0..BATCH{let Some(row)=self.next(bytes,payload)?else{break;};if !effective(row.species){continue;}
            if let Some(mut open)=self.open.take(){if same(&open,&row)&&open.hi==row.lo{open.hi=row.hi;self.open=Some(open);continue;}self.emit(&open)?;}self.open=Some(row);
        }
        if !self.done(payload){return Ok(None);}if let Some(open)=self.open.take(){self.emit(&open)?;}require(self.emitted==self.count,6621)?;Ok(Some(self.sha.finish()?))
    }
    pub(crate) fn encode(&self,out:&mut[u8])->ProgramResult{
        require(out.len()==BYTES,6620)?;let mut at=0;
        for c in self.cursors{out[at..at+2].copy_from_slice(&c.pos.to_le_bytes());out[at+2..at+4].copy_from_slice(&c.group.to_le_bytes());out[at+4..at+8].copy_from_slice(&c.mask.to_le_bytes());out[at+8]=c.remaining;out[at+9]=c.entries;out[at+10..at+12].fill(0);at+=12;}
        for row in [self.last,self.open]{out[at]=u8::from(row.is_some());out[at+1..at+51].copy_from_slice(&row.map_or([0;50],|r|row_bytes(&r)));at+=51;}
        out[at..at+4].copy_from_slice(&self.count.to_le_bytes());at+=4;out[at..at+8].copy_from_slice(&self.b.to_le_bytes());at+=8;out[at..at+8].copy_from_slice(&self.retired.to_le_bytes());at+=8;
        out[at..at+4].copy_from_slice(&self.processed.to_le_bytes());at+=4;out[at..at+4].copy_from_slice(&self.emitted.to_le_bytes());at+=4;self.sha.encode(&mut out[at..at+105]);at+=105;require(at==BYTES,6620)
    }
    #[inline(never)]
    pub(crate) fn decode_boxed(bytes:&[u8])->Result<Box<Self>,ProgramError>{
        require(bytes.len()==BYTES,6620)?;let mut p=Box::new(Self::new());let mut at=0;
        for c in &mut p.cursors{*c=Cursor{pos:u16_at(bytes,at)?,group:u16_at(bytes,at+2)?,mask:u32_at(bytes,at+4)?,remaining:bytes[at+8],entries:bytes[at+9]};require(c.remaining<=32&&c.entries<=128&&zeros(&bytes[at+10..at+12]),6620)?;at+=12;}
        for slot in [&mut p.last,&mut p.open]{let flag=bytes[at];require(flag<=1,6620)?;*slot=if flag==1{Some(read_row(&bytes[at+1..at+51])?)}else{require(zeros(&bytes[at+1..at+51]),6620)?;None};at+=51;}
        p.count=u32_at(bytes,at)?;at+=4;p.b=u64_at(bytes,at)?;at+=8;p.retired=u64_at(bytes,at)?;at+=8;p.processed=u32_at(bytes,at)?;at+=4;p.emitted=u32_at(bytes,at)?;at+=4;p.sha=StreamingSha::decode(&bytes[at..at+105])?;require(p.count<=7680&&p.processed<=7680&&p.emitted<=p.count,6620)?;Ok(p)
    }
}

#[cfg(test)]mod tests{
    use super::*;use sha2::Digest;
    #[test]fn ordinary_sha_state_matches_standard_vectors_and_restarts(){
        for len in [0,1,3,55,56,63,64,65,1024,5404,384004]{let bytes=(0..len).map(|i|(i%251)as u8).collect::<Vec<_>>();let mut s=StreamingSha::new();
            for part in bytes.chunks(37){s.update(part).unwrap();let mut encoded=[0;105];s.encode(&mut encoded);s=StreamingSha::decode(&encoded).unwrap();}
            assert_eq!(s.finish().unwrap().as_slice(),sha2::Sha256::digest(&bytes).as_slice(),"len{len}");}
    }
    #[test]fn empty_provenance_codec_is_exact_and_rejects_bad_sha_buffer(){let p=Provenance::new();let mut bytes=[0;BYTES];p.encode(&mut bytes).unwrap();let q=Provenance::decode_boxed(&bytes).unwrap();let mut again=[0;BYTES];q.encode(&mut again).unwrap();assert_eq!(again,bytes);bytes[BYTES-1]=64;assert!(Provenance::decode_boxed(&bytes).is_err());}
}
