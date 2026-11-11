# FUNC2 execution evidence

The original F1.4 model is retained: fixed four material classes, the same graph hierarchy/ports, per-role reactions, source/sink capacities, inherited cuts, paid control permissions, all 73 real state transitions, recovery, mechanical loads, quality and task cost. This revision changes evidence and acceptance placement, not those physiological or reward constants.

Actual SBF measurements found software incremental SHA256 of only 67,092 bytes exceeds a 1.4M CU transaction budget. The original multi-megabyte full-transcript single SHA assumption therefore does not pass its resource gate. A SHA chain must never be labelled the same hash as that original full string.

FUNC2 explicitly uses suite2, fixture1, load1 and new domains. The fixed kernel's 88 control probes, negative controls and role-isolation rules are release acceptance tests of the pinned validator, not additional player-provided executable code. Each submitted parameter graph still executes every one of the 73 real transitions with all local and inherited obligations. New user-programmable primitives would require a new validation policy.

The initial digest is SHA256(ASCII BIO6TI02 || exact_graph_sha32 || challenge:u32 || suite:u32=2 || fixture:u32=1 || load:u32=1), with 56 bytes and LE integers. Each round updates SHA256(ASCII BIO6TR02 || previous32 || WitnessRecord2271). All four cases are ordered N32/S2R/H2R/SH, case IDs 0..3, round IDs restart at0.

WitnessRecord, in order and without padding: case:u8, round:u16, mode:u8 (RUN0/STARVE1/RECOVER2/HOLD3), f/b/startPhase/target four u8, d:u64; six vectors of15 u64 (Nstart,Nend,m,feed,u0,u1); xEnd:i64[2]; IEnd:u8[15]; positiveNOW:u8[64] in original physical graph indices; ledger:u64[15][8] (N,O,Egen,maintenance,job0,job1,externalWork,heat); macro:u64[4][15] (N/O/W/R owners1..15). Virtual members are validated but the bitmap only refers to real graph edges. Each chained step hashes2311 bytes.

The actual graph binds domain/config/catalog/rule and target. An H7 equivalent port/mirror transformation may retain design identity but must still change the physical evidence if actual bytes change. Formal ADMISSION321 uses suite2 and an approved FUNC2 validator hash; it cannot assert compatibility with old suite1 H16 values.

The JS report is a local reference result. `productionAdmission=false` remains until independent Rust/SBF comparison and native atomic authority, Token and synthesis integration pass. If the complete73-round kernel does not fit, execution must be split into a progress-bound chain verification session; no round or invariant is silently omitted.
