# Native staged verification and one-way synthesis

This document describes the native staged verifier shared by the `BIOECON2` acceptance adapter and the `BIOP0R2` production envelope. Its acceptance results use explicitly local fixtures; no public deployment is implied. Mathematical releases and ELF hashes are pinned separately: retain the original `releases/func2/manifest.json`; the current release is `releases/func2r2/manifest.json`. Formatting-induced source drift was detected rather than silently replacing the old validator identity.

## Module boundaries

| Module | Authority and output |
|---|---|
| `verification.rs` Artifact | Program-owned, sequential 1024-byte uploads; exact ordinary payload SHA; permanent seal. No input material is consumed during upload. |
| `verification.rs` Session | One reusable 4096-byte actor PDA; generation CAS, Clock high-water mark, exact sealed Artifact and Config-approved validator; program-derived progress only. |
| `synthesis.rs` payload/input | Exact graph, Direct74 current Roots, historical Leaf70/capsules; fixed subtree membership, descriptor, inherited projection and current-owner/revision checks. |
| `provenance.rs` | Counts and checks every historical effective **and retired** source interval, then replays the canonical effective union into ordinary SHA256. |
| `semantic.rs` | Frozen H7 port/mirror equivalence; zero fraction edges removed from semantic identity but retained in physical graph/evidence indexing. |
| `biolab-kernel` | Real stock/energy/control/recovery/mechanical execution: all 73 transitions, actual positive edge bitmap, quality, task cost and FUNC2 chain. |
| `synthesis.rs` FINAL | Fresh owner/LIVE/revision/fingerprint and mining guards; real Classic SPL Token burn, consumed child Roots, new complete Root, verification-used flag, nonce and originality changes in one atomic transaction. |
| `originality.rs` | Disclosure, task knowledge/frontier and competition transitions. The client cannot pass q/C/PASS into this hook. |

The four raw classes are direct manufacturing tokens. Upload/Scratch/Root account rent is SOL storage funding; it does not restore or recycle raw material. Consumed child Roots remain historical records but lose LIVE status and mining registration eligibility. A separate independently manufactured object is a separate Root.

## Exact native transport

The table below specifies normalized internal operations behind the shared128-byte `BIOECON2` acceptance frame. The production adapter instead authenticates its real152-byte ExactFrame and eight-account prefix, including the Base/immutable Loader binding, then maps to these same handlers. It does not accept the test frame as production transport. Both routes retain the actor nonce, top-level instruction-data check, canonical Config and account permissions. All integers below are little-endian. The normalized account arrays begin with actor W/signature, actorNonce W, Config R, Instructions sysvar R, System program, Classic Token program, Clock sysvar.

The Artifact PDA is `["bio","artifact",artifactID32]`. Its header is kind24/schema1; payload begins at byte251. Artifact ID is H19(domain || ConfigID || preparer || payloadKind:u16 || totalLength:u32 || ordinarySHA32). Supported explicit native kinds are P5=501, synthesis=702, blueprint=1002. A valid seal has no mutation or close entry point.

| Native opcode | Payload after frame | Extra accounts |
|---|---|---|
| 9 PUT | kind:u16, total:u32, SHA32, seq:u64, offset:u32, count:u16, chunk, maxRent:u64 | Artifact W |
| 10 SEAL | kind:u16, artifactID32, expectedSeq:u64, maxRent:u64 | Artifact W |
| 11 BEGIN | ID32, SHA32, length:u32, challenge:u32, previousGeneration:u64, maxRent:u64 | Artifact R, actor Verify W, exact current Direct Roots R |
| 12 STEP | ID32, generation:u64, workSeq:u16, count:u8, zero:u8, previousFUNC2Digest32, maxRent:u64 | Artifact R, Verify W; inheritance phase additionally selected actual Root R and its actual original sealed Artifact R |
| 13 FINAL mode0 | ID32, SHA32, length:u32, generation:u64, finalFUNC2Digest32, maxLAB:u64, maxRent:u64 | Artifact R, Verify W, output Root W, LAB mint W, actor LAB source W, Treasury W, reserve R, mining Registry W, Direct Roots W, matching RootRegs W, originality tail |

P9's explicit competition transport appends mode byte1, commitment32 and salt32 to the mode0 payload (total189). A handler must explicitly accept this transport and pass it to the originality module; 124-byte mode0 cannot accidentally be interpreted as a commitment.

1024-byte PUT plus frame and accounts exceeds legacy1232 bytes. Its transport requires actual v1 serialization and Bank acceptance. Under v1, requested heap belongs in header config bit4; ComputeBudget instructions are no-ops. The complex verifier uses an explicitly requested256KiB heap. A Mollusk heap setting measures program execution but does not, by itself, prove outer message parsing or signature/fee handling. Parent Bank transport tests cover that separate boundary.

## Program-owned session

Verify PDA seeds are `["bio","verify",originalActor]`. Synthesis uses kind37/schema3 and marker `BIOVFY04`; Blueprint uses a distinct schema/profile. The actor may reset the common PDA only with expected generation and a nondecreasing actual Clock. Reset writes the new profile header, so one profile cannot reuse the other profile's completed proof. Generation remains at full account byte380 in both profiles.

Synthesis header/body offsets, all absolute:

| Range | Field |
|---|---|
| 120..128 | marker |
| 128..192 | Artifact ID32, payload SHA32 |
| 192..208 | payload length, graph offset, graph length, LeafMap offset (four u32) |
| 208..212 | leaf count, direct count, used flag, phase |
| 212..308 | Direct SHA32, LeafMap SHA32, effectiveUnion SHA32 |
| 308..324 | B:u64, retiredCredit:u64 |
| 324..328 | workSeq:u16, phaseProgress:u16 |
| 328..332 | zero |
| 332..364 | semantic H7 |
| 364..1577 | private kernel Scratch1213 |
| 1577..2532 | private provenance state955 |
| 2532..4096 | zero |

STEP return80: `BIOVSR03`, generation:u64@8, workSeq:u16@16, phase:u8@18, target:u8@19, q:u32@20, task:u8@24, physicsRound:u16@25, zero27..32, C:u64@32, digest32@40, lastFrom:u16@72, lastCount:u8@74, zero75..80.

| Phase | One STEP performs |
|---|---|
| 0 | One actual parent Root and original sealed Artifact: inherited graph projection, exact LeafMap and original capsule bytes. CELL skips this because BEGIN authenticates four actual P5 Roots directly. |
| 1 | One original P5 capsule: identity, immutable fingerprint, descriptor, debit plan, per-species BOM and credit checks. |
| 2 | At most64 sorted historical intervals: k-way merge, no effective/retired overlap, canonical effective segment count and credit totals. |
| 3 | At most64 of the same immutable historical intervals: canonical merging and **ordinary** SHA256 internal-state update. This is not a replacement hash chain. |
| 4 | Program-computed semantic H7. |
| 5 | One or two of the real73 biological transitions, including source/energy/control/cuts/hold/recovery/mechanics obligations. |
| 6 | Complete, eligible for fresh FINAL checks; still no consumed input or reward by itself. |

workSeq and physicsRound are independent. Maximum catalog rows7680 require120 COUNT +120 HASH calls. With6 inheritance,60 capsule,1 semantic and37 two-round physics calls the catalog maximum is344 STEP calls, below the explicit1024 limit. Inputs with122 rows/3358-byte capsules use115+115 COUNT/HASH calls. An exact latest STEP replay is idempotent; an old cursor or a different digest is rejected. Transaction failure restores the whole previous session state.

Ordinary challenge range is500000..2000000 at1000 steps; hard targets3/9/14/15/21 require2000000 and retain q1000000. Quality and task applicability come from the actual kernel, not from a client Boolean or a challenge shortcut.

Physics STEP verifies immutable Artifact metadata binding and hashes the exact graph bytes each time. BEGIN, provenance, inheritance and FINAL verify ordinary full payload SHA. The physics optimization is valid only because the program-owned sealed Artifact has no mutation/close route; adding either requires re-auditing this assumption.

## FINAL accounting and atomicity

Fresh current Direct Roots must match owner, LIVE state, revision, immutable fingerprint, approved catalog/validator and exact Direct74 order. Every Direct RootReg must have ended its interval and completed historical coverage; paid claims may remain claimable by their original beneficiary. Registry Clock high-water checks prevent state rewind. Need-rent includes nonce, output Root, Registry once, each RootReg once and originality records, all under the signed maxRent cap.

The fee is ceil(B×rate/120000), with rate200000 atoms for CELL/BIO and400000 for ORGAN. For the fixed60-leaf chain this is15×0.8=12 LAB for cells,24 LAB for organs and12 LAB for BIO:48 LAB total. No recycling, downward decomposing or extra raw issuance is introduced.

After all preflight checks, real Classic `BurnChecked` reduces the actor source and mint supply. The complete output Root is allocated and written; inputs become consumed and their RootRegs permanently revoked; originality records are committed; Verify.used and actor nonce complete. A later failing native instruction reverts all these effects, including SOL account funding. The historical input material debit plans and previous earned mining claims remain immutable.

## Evidence and limits

All native balances and time cycles below are local SBF/Mollusk or Bank test ledgers. Clock is advanced in the local runtime to exercise each simulated hourly transition; no public-chain LAB was issued or mined and no user wallet was connected.

- `programs/biolab-kernel/evidence/kernel-func2r2-step-run.log`: the R2 kernel rerun passed the actual37 physical graphs ×73 transitions against independent Node q/C/bitmap/FUNC2/final state, replay/reset/Clock/rollback cases and440-edge bounds. R2 ELF SHA256 is `b9d9f7fd4428f215d1170022afc3585033601eafec9b9448c475676856ac217d`; the explicit R2 validator hash is `2ff0b0b6344c186e10090325117a7a0e9e5faedaaec5913d460831b8e6b730a0`. The historical FUNC2 manifest remains preserved.
- `kernel-positive-bounds.json`: all180 free endpoint pairs positive,440 total edges/7713 bytes, plus all22 subtrees; each73-round execution matched Node. Peak1,162,478 CU/32KiB in scope18, complete BIO1,066,175 CU.
- `programs/biolab-economy/evidence/native_synthesis-prechecked-run.log`: true raw purchase, four P5,85-hour earning808520 atoms, burn800000, new CELL, two more real mining hours28538 atoms. The acceptance-adapter peak is1,091,411 CU/256KiB. Owner/revision changes after verification fail fresh FINAL checks; FINAL followed by a deliberately failing native instruction reverts token burn, consumed inputs, new Root, session, nonce and SOL rent together.
- `native-rows-bounds-result.txt`: real native COUNT/HASH handler at185300-byte synthetic resource fixture/7680 rows, ordinary SHA378004 bytes; R2 peaks842456/1181005 CU.
- `native-blob-bounds-result.txt`:214100-byte synthetic resource fixture/max3358-byte capsules; R2 peaks869944/1208301 CU. Both ordinary digests match Node and fit64-row steps. These tests deliberately inject host-only private state for resource profiling, never FINAL or asset admission. They are not replacements for true manufacturing/provenance acceptance.
- `native-final-bound-result.txt` and `native_final_bounds-prechecked-run.log`: the true native FINAL handler accepts four3358-byte input capsules at1,059,447 CU; FINAL followed by an intentionally bad instruction fails at instruction1 after1,071,250 CU and rolls the whole transaction back. The maximum-capsule Root authority is a host-only resource fixture; its fee funding is genuinely earned. Its input authority is not claimed as a manufactured maximum-DP chain. The previous1,395,894-CU near-limit result is preserved in the earlier isolated log. The reduction caches fresh, same-instruction Root facts and retains actual owner/revision/LIVE/PDA/Clock CAS and complete immutable-capsule hash checks.
- `native-layers-prechecked-cold-run.log`: a completed cold acceptance-adapter chain bought120 raw units `[30,60,15,15]`, actually manufactured60 P5, earned48083160 atoms over337 simulated hourly cycles, then produced15 CELL →6 ORGAN →BIO. Its81 inputs were consumed once;48000000 fee atoms were burned;83160 remained before BIO mining. Two further BIO hours earned941780 atoms, ending at1024940. It executed1213 staged validation calls, with all73 physical rounds for every object. C320 was an opening-known design, so extra K reward was0. Its historical ELF SHA256 is `1ec400ccbed4949a11505d1269be1032dfb05dd82382d28e1e573730c1d69088`; its peak1,353,554 CU is not substituted for the final production-envelope measurement.

`native_layers.rs` explicitly labels a debug resume and excludes it from cold trace recording. A funded ledger checkpoint records actual previously earned accounts for targeted continuation tests. It is not replayed as genesis and cannot replace the full cold transaction sequence.

The signable local production-envelope fixture is a separate, explicitly non-publishable artifact: `target/production-signing-deploy/biolab_economy.so`, SHA256 `7fa418aca6a32e25d48619d04ca8f905c6750d4b2ff7fd5f29f0bf68cf2c2828`. Its public test-key recipe and Base mode0 are enforced as local-fixture status; a strict production build rejects those public keys. Its real ExactFrame/Loader/config gate, Classic token initialization and1024-byte Artifact upload/seal have passed five actual Agave4.3.2 Bank transactions with official Kit8 v1 signatures. The maximum serialized packet was1695 bytes (two exceeded legacy1232), peak149449 CU and352773 total CU at32KiB. See `programs/transaction-transport/evidence/production-admission-trace-bank.json` and `production-bank-smoke.log`.

The same exact signable ELF subsequently passed a589.24-second **cold full lifecycle** in SBF/Mollusk, including the production16-known-design opening with frontier316 and the full accounting above. The true top-level invocation callback recorded23312 instructions in `production-signing-full-chain.jsonl` (48906604 bytes, SHA256 `ca72ecb7222dbe715552bea5ff73d1731b0f2ebac94c180a9db046806c391942`). An independent reader checked every JSON record, continuous sequence numbers, nondecreasing actual Clock and the final success footer's summary hash. It observed at most33 account metas and1236 instruction-data bytes. The trace includes the true genesis INIT, material purchases, all manufacturing, hourly earning, all1213 validation steps, all synthesis fees and BIO mining; no intermediate funded snapshot is installed into its genesis.

The measured full-chain peak was1200817 CU for scope18's physical STEP, leaving199183 CU (14.23%) under1.4m. The largest FINAL was BIO at609137 CU. Heap was explicitly262144 bytes; the Bank replay requests that heap in its v1 budget header. `production-signing-cold-result.txt` and `production-signing-cold-trace-validation.json` preserve these results independently of targeted resume reports.

The separate runner then successfully replayed **all23312 transactions in actual Agave4.3.2 ProgramTest Bank**, with official Kit8 v1 signatures, only SOL at genesis, all120 material units purchased and all LAB actually released by the program. `programs/transaction-transport/evidence/full-lifecycle-bank.json` records the same7fa ELF/trace SHA,60 P5/15 CELL/6 ORGAN/1 BIO,81 consumed inputs,48000000 burned fee atoms and1024940 final LAB atoms. Peak was1200817 CU, maximum packet1695 bytes,380 packets exceeded legacy1232, and total3711428063 CU. Its `fixtureOnly:true`, `productionAdmission:false` and `networkBroadcast:false` fields remain explicit: this accepts local real runtime/transport execution, not a published project or a real economy price guarantee.

Remaining release gates are tracked by the root integration manifest: single-ELF regression for subsequent Safety/EMPTY_SKIP changes, applicable BIO originality/competition/K and certificate-fault lifecycle integration, strict publication configuration, and independent acceptance/security review. The7fa cold Bank result is preserved with its exact identity and is not relabelled as acceptance of later code. None of the remaining gates is implied by a local JS PASS, a transport smoke test or a resource-only fixture.
