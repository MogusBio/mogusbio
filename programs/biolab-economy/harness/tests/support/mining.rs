#![allow(dead_code)]
//! Shared true-SBF ordinary earning helpers. Never patches Treasury or accrued.
use crate::support::*;
fn at(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &PROGRAM).0
}
pub fn root(instance: Pubkey) -> Pubkey {
    at(&[b"bio", b"root", instance.as_ref()])
}
pub fn root_reg(instance: Pubkey) -> Pubkey {
    at(&[b"bio", b"root-reg", instance.as_ref()])
}
pub fn position(instance: Pubkey, seq: u64) -> Pubkey {
    at(&[b"bio", b"reg", instance.as_ref(), &seq.to_le_bytes()])
}
pub fn directory(seq: u64) -> Pubkey {
    at(&[b"bio", b"mining-root", &seq.to_le_bytes()])
}
pub fn hour(h: u64) -> Pubkey {
    at(&[b"bio", b"hour", &h.to_le_bytes()])
}
fn pos_id(instance: Pubkey, seq: u64) -> [u8; 32] {
    hash(
        14,
        &[
            &domain(),
            &27u16.to_le_bytes(),
            instance.as_ref(),
            &seq.to_le_bytes(),
        ],
    )
}
fn next(a: &[(Pubkey, Account)], actor: Pubkey) -> u64 {
    let n = account(a, nonce(&actor));
    if n.data.is_empty() {
        0
    } else {
        read64(&n.data, 120)
    }
}
fn book(m: &mut Vec<AccountMeta>) {
    m.extend([
        AccountMeta::new_readonly(pda(b"lab-mint"), false),
        AccountMeta::new_readonly(pda(b"lab-reserve"), false),
        AccountMeta::new_readonly(pda(b"lab-auth"), false),
        AccountMeta::new(pda(b"treasury"), false),
    ]);
}
fn native(
    op: u8,
    a: &[(Pubkey, Account)],
    actor: Pubkey,
    p: Vec<u8>,
    metas: Vec<AccountMeta>,
) -> Instruction {
    Instruction {
        program_id: PROGRAM,
        accounts: metas,
        data: wire_actor(op, next(a, actor), &p, actor),
    }
}
pub fn execute(vm: &Mollusk, a: Vec<(Pubkey, Account)>, ix: Instruction) -> Vec<(Pubkey, Account)> {
    assert!(
        legacy_packet_size(&[ix.clone()]) <= 1232,
        "ordinary mining instruction packet"
    );
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(
        r.raw_result,
        Ok(()),
        "ordinary mining opcode{} CU{}",
        ix.data[8],
        r.compute_units_consumed
    );
    r.resulting_accounts
}
pub fn local_start(a: &[(Pubkey, Account)]) -> i64 {
    i64::from_le_bytes(
        account(a, pda(b"econ-config")).data[384..392]
            .try_into()
            .unwrap(),
    )
}
pub fn create_lab_ata(
    vm: &Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    owner: Pubkey,
) -> Vec<(Pubkey, Account)> {
    let destination = ata(&pda(b"lab-mint"), &owner);
    add_empty(&mut a, destination);
    if !a.iter().any(|(k, _)| *k == owner) {
        a.push((
            owner,
            Account {
                lamports: 1_000_000_000,
                owner: SYSTEM,
                ..Default::default()
            },
        ));
    }
    add_empty(&mut a, nonce(&owner));
    let ix = Instruction {
        program_id: associated_token::ID,
        accounts: vec![
            AccountMeta::new(BOOT, true),
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(pda(b"lab-mint"), false),
            AccountMeta::new_readonly(SYSTEM, false),
            AccountMeta::new_readonly(token::ID, false),
        ],
        data: vec![1],
    };
    let r = vm.process_instruction(&ix, &a);
    assert_eq!(r.raw_result, Ok(()));
    r.resulting_accounts
}
pub fn event_key(seq: u64) -> Pubkey {
    at(&[b"bio", b"mining-event", &seq.to_le_bytes()])
}
fn event_count(a: &[(Pubkey, Account)]) -> u64 {
    let d = &account(a, pda(b"mining")).data;
    if d.is_empty() {
        0
    } else {
        read64(d, 160)
    }
}
pub fn stake(
    vm: &Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    instance: Pubkey,
    actor: Pubkey,
    beneficiary: Pubkey,
) -> Vec<(Pubkey, Account)> {
    add_empty(&mut a, pda(b"mining"));
    add_empty(&mut a, root_reg(instance));
    let rr = &account(&a, root_reg(instance)).data;
    let seq = if rr.is_empty() { 0 } else { read64(rr, 160) };
    let directory_seq = if seq == 0 {
        let r = &account(&a, pda(b"mining")).data;
        if r.is_empty() {
            0
        } else {
            read64(r, 120)
        }
    } else {
        read64(rr, 364)
    };
    let g = if account(&a, pda(b"mining")).data.is_empty() {
        0
    } else {
        read64(&account(&a, pda(b"mining")).data, 128)
    };
    let ev = event_key(event_count(&a));
    for key in [
        directory(directory_seq),
        position(instance, seq),
        hour(g),
        ev,
    ] {
        add_empty(&mut a, key);
    }
    let mut p = instance.to_bytes().to_vec();
    p.extend_from_slice(&read64(&account(&a, root(instance)).data, 354).to_le_bytes());
    p.extend_from_slice(&seq.to_le_bytes());
    p.extend_from_slice(&directory_seq.to_le_bytes());
    p.extend_from_slice(beneficiary.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix_actor(actor);
    book(&mut m);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new_readonly(root(instance), false),
        AccountMeta::new(root_reg(instance), false),
        AccountMeta::new(directory(directory_seq), false),
        AccountMeta::new(position(instance, seq), false),
        AccountMeta::new(hour(g), false),
    ]);
    if seq > 0 {
        m.push(AccountMeta::new_readonly(
            position(instance, seq - 1),
            false,
        ));
    }
    m.push(AccountMeta::new(ev, false));
    let ix = native(20, &a, actor, p, m);
    execute(vm, a, ix)
}
pub fn exit(
    vm: &Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    instance: Pubkey,
    actor: Pubkey,
) -> Vec<(Pubkey, Account)> {
    let seq = read64(&account(&a, root_reg(instance)).data, 160) - 1;
    let mut p = instance.to_bytes().to_vec();
    p.extend_from_slice(&seq.to_le_bytes());
    p.extend_from_slice(&read64(&account(&a, root(instance)).data, 354).to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let ev = event_key(event_count(&a));
    add_empty(&mut a, ev);
    let mut m = prefix_actor(actor);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new_readonly(root(instance), false),
        AccountMeta::new(root_reg(instance), false),
        AccountMeta::new(position(instance, seq), false),
        AccountMeta::new(ev, false),
    ]);
    let ix = native(21, &a, actor, p, m);
    execute(vm, a, ix)
}
pub fn apply_pending_events(
    vm: &Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    h: u64,
) -> Vec<(Pubkey, Account)> {
    loop {
        let rb = &account(&a, pda(b"mining")).data;
        let seq = read64(rb, 168);
        let count = read64(rb, 160);
        if seq == count {
            break;
        }
        let ev = &account(&a, event_key(seq)).data;
        let b = &ev[120..];
        if read64(b, 8) > h {
            break;
        }
        let kind = b[16];
        let dir = read64(b, 81);
        let instance = Pubkey::new_from_array(b[17..49].try_into().unwrap());
        let ps = read64(b, 89);
        let activation: [u8; 32] = b[97..129].try_into().unwrap();
        let nb = &account(&a, directory(dir)).data;
        let mut p = seq.to_le_bytes().to_vec();
        p.extend_from_slice(&h.to_le_bytes());
        p.extend_from_slice(&100_000_000u64.to_le_bytes());
        let mut m = prefix();
        m.extend([
            AccountMeta::new(pda(b"mining"), false),
            AccountMeta::new_readonly(event_key(seq), false),
            AccountMeta::new(directory(dir), false),
            AccountMeta::new_readonly(position(instance, ps), false),
        ]);
        if kind == 0 {
            let tail = read64(rb, 200);
            if tail != u64::MAX {
                m.push(AccountMeta::new(directory(tail), false));
            }
        } else if kind == 1 {
            for link in [read64(nb, 242), read64(nb, 250)] {
                if link != u64::MAX {
                    m.push(AccountMeta::new(directory(link), false));
                }
            }
        } else {
            m.push(AccountMeta::new_readonly(
                at(&[b"bio", b"activation", &activation]),
                false,
            ));
        }
        let ix = native(24, &a, BOOT, p, m);
        a = execute(vm, a, ix);
    }
    a
}
pub fn open_ix(a: &[(Pubkey, Account)], h: u64) -> Instruction {
    let seq = read64(&account(a, pda(b"mining")).data, 168);
    let mut p = h.to_le_bytes().to_vec();
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix();
    book(&mut m);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new(hour(h), false),
        AccountMeta::new_readonly(event_key(seq), false),
    ]);
    native(23, a, BOOT, p, m)
}
pub fn materialize_ix(a: &[(Pubkey, Account)], h: u64) -> Instruction {
    let hb = &account(a, hour(h)).data;
    let cursor = read64(hb, 152);
    let cutoff = read64(hb, 136);
    let dir = read64(hb, 433);
    let member = if cutoff == 0 {
        None
    } else {
        let n = &account(a, directory(dir)).data;
        Some((
            Pubkey::new_from_array(n[129..161].try_into().unwrap()),
            read64(n, 234),
        ))
    };
    let seq = member.map_or(0, |(_, s)| s);
    let mut p = h.to_le_bytes().to_vec();
    p.extend_from_slice(&cursor.to_le_bytes());
    p.extend_from_slice(&seq.to_le_bytes());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix();
    book(&mut m);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new(hour(h), false),
    ]);
    if let Some((instance, seq)) = member {
        m.extend([
            AccountMeta::new_readonly(directory(dir), false),
            AccountMeta::new(root_reg(instance), false),
            AccountMeta::new(position(instance, seq), false),
        ]);
    }
    native(25, a, BOOT, p, m)
}
pub fn advance_hour_ix(a:&[(Pubkey,Account)],h:u64)->Instruction {
    let mut p=h.to_le_bytes().to_vec();p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m=prefix();m.extend([AccountMeta::new(pda(b"mining"),false),AccountMeta::new(hour(h),false)]);
    native(29,a,BOOT,p,m)
}
pub fn materialize_member_ix(a:&[(Pubkey,Account)],h:u64,instance:Pubkey,seq:u64)->Instruction {
    let dir=read64(&account(a,root_reg(instance)).data,364);
    let mut p=h.to_le_bytes().to_vec();p.extend_from_slice(&read64(&account(a,hour(h)).data,152).to_le_bytes());p.extend_from_slice(&seq.to_le_bytes());p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m=prefix();book(&mut m);m.extend([AccountMeta::new(pda(b"mining"),false),AccountMeta::new(hour(h),false),AccountMeta::new_readonly(directory(dir),false),AccountMeta::new(root_reg(instance),false),AccountMeta::new(position(instance,seq),false)]);
    native(25,a,BOOT,p,m)
}
pub fn freeze_hour(vm:&Mollusk,mut a:Vec<(Pubkey,Account)>,h:u64)->Vec<(Pubkey,Account)> {
    a=apply_pending_events(vm,a,h);let seq=read64(&account(&a,pda(b"mining")).data,168);add_empty(&mut a,event_key(seq));add_empty(&mut a,hour(h));let x=open_ix(&a,h);a=execute(vm,a,x);let x=advance_hour_ix(&a,h);execute(vm,a,x)
}
pub fn settle_hour(vm: &Mollusk, mut a: Vec<(Pubkey, Account)>, h: u64) -> Vec<(Pubkey, Account)> {
    a = apply_pending_events(vm, a, h);
    let seq = read64(&account(&a, pda(b"mining")).data, 168);
    add_empty(&mut a, event_key(seq));
    add_empty(&mut a, hour(h));
    let ix = open_ix(&a, h);
    a = execute(vm, a, ix);
    if std::env::var("BIOLAB_LAZY_SETTLEMENT").as_deref()==Ok("1") {
        let hb=&account(&a,hour(h)).data;assert_eq!(hb.len(),482);assert_eq!(u16::from_le_bytes(hb[12..14].try_into().unwrap()),4);
        let count=read64(hb,136);let mut dir=read64(hb,417);let mut members=Vec::new();
        for _ in 0..count{let n=&account(&a,directory(dir)).data;members.push((Pubkey::new_from_array(n[129..161].try_into().unwrap()),read64(n,234)));dir=read64(n,250);}
        assert_eq!(dir,u64::MAX);let x=advance_hour_ix(&a,h);a=execute(vm,a,x);
        if members.is_empty(){let x=materialize_ix(&a,h);a=execute(vm,a,x);}else{for(instance,seq)in members.into_iter().rev(){let x=materialize_member_ix(&a,h,instance,seq);a=execute(vm,a,x);}}
        assert_eq!(account(&a,hour(h)).data[160],4);return a;
    }
    while account(&a, hour(h)).data[160] != 4 {
        let ix = materialize_ix(&a, h);
        a = execute(vm, a, ix);
    }
    a
}
pub fn settle_through(
    vm: &Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    exclusive_boundary: u64,
) -> Vec<(Pubkey, Account)> {
    loop {
        let h = read64(&account(&a, pda(b"mining")).data, 128);
        if h >= exclusive_boundary {
            break;
        }
        a = settle_hour(vm, a, h);
    }
    a
}
pub fn claim(
    vm: &Mollusk,
    a: Vec<(Pubkey, Account)>,
    instance: Pubkey,
    seq: u64,
    actor: Pubkey,
) -> Vec<(Pubkey, Account)> {
    let d = &account(&a, position(instance, seq)).data;
    let beneficiary = Pubkey::new_from_array(d[200..232].try_into().unwrap());
    let paid = read64(d, 359);
    let accrued = read64(d, 351);
    let destination = ata(&pda(b"lab-mint"), &beneficiary);
    let mut p = pos_id(instance, seq).to_vec();
    p.extend_from_slice(&paid.to_le_bytes());
    p.extend_from_slice(&accrued.to_le_bytes());
    p.extend_from_slice(destination.as_ref());
    p.extend_from_slice(actor.as_ref());
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix_actor(actor);
    m.extend([
        AccountMeta::new_readonly(pda(b"lab-mint"), false),
        AccountMeta::new(pda(b"lab-reserve"), false),
        AccountMeta::new_readonly(pda(b"lab-auth"), false),
        AccountMeta::new(pda(b"treasury"), false),
        AccountMeta::new(position(instance, seq), false),
        AccountMeta::new(destination, false),
    ]);
    let ix = native(3, &a, actor, p, m);
    execute(vm, a, ix)
}
pub fn earn_then_exit(
    vm: &mut Mollusk,
    mut a: Vec<(Pubkey, Account)>,
    instances: &[Pubkey],
    active_hours: u64,
) -> Vec<(Pubkey, Account)> {
    assert!(active_hours > 0);
    let start = local_start(&a);
    clock_at(vm, &mut a, start + 1);
    a = create_lab_ata(vm, a, BOOT);
    for &instance in instances {
        a = stake(vm, a, instance, BOOT, BOOT);
    }
    clock_at(vm, &mut a, start + (active_hours as i64) * 3600 + 1);
    for &instance in instances {
        a = exit(vm, a, instance, BOOT);
    }
    clock_at(vm, &mut a, start + (active_hours as i64 + 1) * 3600 + 1);
    a = settle_through(vm, a, active_hours + 1);
    for &instance in instances {
        a = claim(vm, a, instance, 0, BOOT);
        assert_eq!(read64(&account(&a, root_reg(instance)).data, 258), 1);
    }
    a
}

/// Return only a finalized global Hour's SOL rent to its saved opener. A
/// permissionless different actor pays its own nonce rent and receives no refund.
pub fn close_hour(
    vm: &Mollusk,
    a: Vec<(Pubkey, Account)>,
    h: u64,
    actor: Pubkey,
) -> Vec<(Pubkey, Account)> {
    let data = &account(&a, hour(h)).data;
    let payer = Pubkey::new_from_array(data[120 + 329..120 + 361].try_into().unwrap());
    let mut p = h.to_le_bytes().to_vec();
    p.extend_from_slice(&100_000_000u64.to_le_bytes());
    let mut m = prefix_actor(actor);
    m.extend([
        AccountMeta::new(pda(b"mining"), false),
        AccountMeta::new(hour(h), false),
    ]);
    if actor != payer {
        m.push(AccountMeta::new(payer, false));
    }
    let instruction = native(27, &a, actor, p, m);
    execute(vm, a, instruction)
}
