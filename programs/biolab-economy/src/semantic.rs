//! Exact H7 canonicalization; called with a graph already strictly decoded.
use crate::*;
use biolab_kernel::graph::{self,Graph};

fn column(rows: &[graph::Edge], kind: u8) -> Vec<u8> {
    let mut values = rows
        .iter()
        .map(|e| {
            let p = if kind == 3 { e.dst } else { e.src };
            (e.owner, p.kind, p.role, p.sub, p.port, e.fraction)
        })
        .collect::<Vec<_>>();
    values.sort_unstable();
    let mut out = Vec::with_capacity(21);
    out.push(values.len() as u8);
    for (owner, kind, role, sub, port, fraction) in values {
        out.extend_from_slice(&[owner, kind, role, sub]);
        out.extend_from_slice(&port.to_le_bytes());
        out.extend_from_slice(&fraction.to_le_bytes());
    }
    out
}
fn normalized(g:&Graph)->Graph{
    let mut n = g.clone();
    n.edges.retain(|e| e.kind > 3 || e.fraction != 0);
    for cell in &g.cells {
        for (kind, low, high) in [(1, 1, 2), (2, 3, 4), (3, 5, 6)] {
            let rows = n
                .edges
                .iter()
                .copied()
                .filter(|e| {
                    e.kind == kind
                        && if kind == 3 {
                            e.src.role == cell.role
                        } else {
                            e.dst.role == cell.role
                        }
                })
                .collect::<Vec<_>>();
            let a = column(
                &rows
                    .iter()
                    .copied()
                    .filter(|e| {
                        if kind == 3 {
                            e.src.port == low
                        } else {
                            e.dst.port == low
                        }
                    })
                    .collect::<Vec<_>>(),
                kind,
            );
            let b = column(
                &rows
                    .iter()
                    .copied()
                    .filter(|e| {
                        if kind == 3 {
                            e.src.port == high
                        } else {
                            e.dst.port == high
                        }
                    })
                    .collect::<Vec<_>>(),
                kind,
            );
            if a > b {
                for e in &mut n.edges {
                    if e.kind != kind {
                        continue;
                    }
                    let p = if kind == 3 { &mut e.src } else { &mut e.dst };
                    if p.role == cell.role {
                        p.port = if p.port == low { high } else { low };
                    }
                }
            }
        }
    }
    n.edges.sort_unstable_by(graph::compare_edges);
    n
}

fn endpoint(out:&mut Vec<u8>,p:graph::Endpoint){out.extend_from_slice(&[p.kind,p.role,p.sub]);out.extend_from_slice(&p.port.to_le_bytes());}
/// Serialization of transformations of an already strictly validated graph.
/// Dropping zero free edges, swapping the two equal-capacity physical ports and
/// mirroring the fixed rectangle preserve structure, LCA and aggregate opens.
/// No untrusted graph can call this without its strict decoder first.
fn body(n:&Graph,mirror:u8)->Vec<u8>{
    let mut out=Vec::with_capacity(7636);out.extend_from_slice(&1u16.to_le_bytes());out.push(n.target);out.extend_from_slice(&n.catalog);out.extend_from_slice(&n.rule);
    out.push(n.nodes.len()as u8);for node in &n.nodes{out.extend_from_slice(&[node.scope,node.kind,node.role,node.parent]);}
    out.push(n.cells.len()as u8);for cell in &n.cells{out.push(cell.role);out.extend_from_slice(&cell.v.to_le_bytes());}
    out.push(n.tiers.len()as u8);for tier in &n.tiers{out.extend_from_slice(&[tier.scope,tier.mode]);}
    out.extend_from_slice(&(n.edges.len()as u16).to_le_bytes());for e in &n.edges{out.extend_from_slice(&[e.owner,e.kind]);endpoint(&mut out,e.src);endpoint(&mut out,e.dst);out.extend_from_slice(&e.fraction.to_le_bytes());}
    out.push(n.opens.len()as u8);for open in &n.opens{out.extend_from_slice(&[open.role,open.species]);out.extend_from_slice(&open.remaining.to_le_bytes());}
    out.push(n.slots.len()as u8);for slot in &n.slots{out.extend_from_slice(&[slot.role,if mirror&1!=0{4-slot.x}else{slot.x},if mirror&2!=0{2-slot.y}else{slot.y}]);}out
}
pub(crate) fn semantic_id(g:&Graph)->Result<[u8;32],ProgramError>{
    let n=normalized(g);let mut best=0u8;let mut slots=Vec::new();
    for mirror in 0..if g.target==22{4}else{1}{let mut bytes=Vec::with_capacity(45);for slot in &n.slots{bytes.extend_from_slice(&[slot.role,if mirror&1!=0{4-slot.x}else{slot.x},if mirror&2!=0{2-slot.y}else{slot.y}]);}
        if mirror==0||bytes<slots{best=mirror;slots=bytes;}}
    Ok(typed_hash(7,&[&body(&n,best)]))
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn direct_serialization_equals_frozen_encoder_for_every_legal_symmetry(){
        let directory=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/graphs");let mut count=0;
        for entry in std::fs::read_dir(directory).unwrap(){let path=entry.unwrap().path();if path.extension().and_then(|x|x.to_str())!=Some("bin"){continue;}
            let g=graph::decode_graph(&std::fs::read(path).unwrap()).unwrap();let n=normalized(&g);
            for mirror in 0..if g.target==22{4}else{1}{let mut candidate=n.clone();for slot in &mut candidate.slots{if mirror&1!=0{slot.x=4-slot.x;}if mirror&2!=0{slot.y=2-slot.y;}}
                let wire=graph::encode_graph(&candidate).unwrap();let mut expected=1u16.to_le_bytes().to_vec();expected.push(g.target);expected.extend_from_slice(&g.catalog);expected.extend_from_slice(&g.rule);expected.extend_from_slice(&wire[144..]);assert_eq!(body(&n,mirror),expected);}
            count+=1;
        }assert_eq!(count,37);
    }
}
