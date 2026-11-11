# Originality, opening and finite safety

This ESM module implements the task state machine for BIO-DESIGN-01, using the real biology canonical H7 and FUNC2 validator. It has no wallet, deployment or native-signature capability. Run:

```sh
node --test biolab/packages/originality/test/*.test.mjs
```

## Production opening

The required opening set is sixteen complete graphs: the twelve original goldens plus the already published C324, C320, C318 and C316 improvements. The sixteen entries are H7-byte sorted for the version3 initial H15 set identity; the membership bitmap is0xffff. Every seed is read from a real SEALED schema2 blueprint Artifact and replayed through FUNC2. All sixteen must be registered before the reward boundary and the complete opening prefix must be sealed. Additional genuinely validated pre-opening public knowledge may lower the opening frontier further. Seed blueprints create no material, asset, ordinary stake or K.

The opening snapshot keeps the original176-byte body layout and records the actual full seed count/digest/minimum. The version3 initial set identity uses709 bytes and changes from both historical twelve- and fourteen-entry identities; it must be bound by the new deployment configuration. Production opening is at most316. No production API allows selecting the historical opening or deleting already public knowledge.

## State and APIs

`createOriginalityCoordinator(config, dependencies)` captures immutable domain/config/catalog/rule/rewardStart/seedOpen and a trusted `validateDesign` implementation (the actual FUNC2 implementation is the default). Public contexts require `actor`, `authorizedActors`, nonnegative native `now` and `slot`; these are trusted ingress evidence, not a generated native signature. All transitions return a detached `{state,result}` draft. The outer protocol-core `executeAtomic` owns the sole actor nonce and atomic commit. This package never opens a second nonce ledger.

| API | Required additional context |
| --- | --- |
| `initialize` | Trusted bootstrap state containing the same settlement reward clock |
| `initialGraphs / initialSetId` | Detached required public reference graphs / H15 identity |
| `registerSeed` | `artifactId`; only seedOpen≤now<rewardStart; no supplied q/C/PASS |
| `sealOpeningStep` | `expectedCursor,maxScan` (1–8 contiguous seed records) |
| `commit` | Exact1002/1 frame; fixed family/version/round/hidden H22; actor and rent payer authorized |
| `discloseBlueprint` | Actual SEALED schema2 `artifactId`; structure/canonical only, no functional knowledge grant |
| `admitManufactured` | Trusted SYNTH hook `rootId,frameBytes,now,slot,competition?`; reads actual stored root/Artifact and replays its graph |
| `finalizeStep` | `round,expectedPhase,expectedCandidateCursor,expectedKnowledgeCursor,maxScan` |
| `activateWinner` | Original author `winnerId`; original still-eligible root must already have valid ordinary stake |
| `exitStake` | `rootId,seq`; route owner EXIT here when OPEN K may stop, so the same transaction records the task event/generation |
| `proveFault` | `knowledgeIndex,expectedEpoch`; independently replays the exact existing accepted evidence |
| `auditNext` | `expectedEpoch,expectedCursor`; one exact continuous knowledge record per call |
| `recoverTask` | `expectedEpoch,expectedKnowledgeCount`; complete prefix/tail CAS, no caller-selected best cost |

The manufacturing integration is intentionally server-owned:

```js
const tasks = createOriginalityCoordinator(config);
const composition = createCompositionCoordinator(config, {
  verifyFunction: validateDesign,
  semanticDesign: designId,
  admitKnowledge(draft, root, report, tx) {
    const accepted = tasks.admitManufactured(draft, { ...tx, rootId: root.instance });
    Object.assign(draft, accepted.state);
  },
});
```

The hook must stay inside the same outer atomic transition as material/fee burns, old-root consumption and new-root creation. A failed COMPETE reveal rejects the entire draft; it does not silently become normal manufacture. The hook is also called for lower-quality and partial targets, preserving their original complete disclosure without adding BIO knowledge.

## Commitment and competition

H22 uses the exact204-byte domain/family/version/round/author/design/future manufacture opId/salt tuple. COMMIT and the future manufacturing opId are different nonce uses in the same core actor sequence. Future opId and salt are hidden at commitment, then bound to the actual702 frame. The original root ID, request hash, native creation time/slot and competition mode/tail must all match. A client's proposed PASS, q, C or callback result is never accepted.

Each round is exactly72h: first24h commit, middle24h reveal plus first successful manufacture/validation, final24h preparation. Start and deadline prefixes are immutable. Task event sequence and clock high-water marks prevent backfill. Every actual task-qualified independently manufactured BIO appends a continuous knowledge entry; equal designs remain valid independent ordinary assets while the semantic knowledge comparison deduplicates their meaning.

Finalization scans the entire start baseline, then each candidate against the entire pre-deadline knowledge prefix. Eligibility requires cost strictly below the valid round-start minimum and commitment event before every relevant earlier/equal-quality first disclosure. Ordering is cost, commitment event, then manufacturing business bytes. Manufacturing first cannot overtake an earlier valid commitment. One immutable historical winner is selected; author exit/sale/consumption never promotes a runner-up. At most one K attaches to the original root, original author and its actual ordinary stake, at a future complete hour and only while still current best. A better normal PASS stops old K prospectively; an equal-cost independent copy neither starts a second K nor stops the existing one.

Raw Artifact bytes are public before formal disclosure. The protocol award is bounded to its registered-event commitment/knowledge rules, not real-world intellectual-property priority. The client must calculate and confirm COMMIT before uploading or formally disclosing a new design; uploading is not secrecy.

## Finite safety scope

This implementation proves complete replay-output or knowledge-link mismatch for already accepted evidence. A legitimate matching proof attempt has no effect. A definite mismatch invalidates exactly that old entry, pauses task K through the actual settlement interface, permanently faults the root only when its own stored certificate is wrong, and may append one corrected knowledge fact from the same original evidence. It cannot create an asset, candidate, replacement winner, K or refund. Prior Position debt and historical winners survive unchanged.

Safety correction replay compares the correction against its fixed proof's correct output, so a permanently wrong original root certificate cannot repeatedly fault the same corrected fact. Auditing must traverse every accepted/explicitly invalid record; another mismatch requires its own new finite proof/epoch. New normal manufacturing can continue while paused; any appended tail prevents recovery until it too is audited. Recovery sets the minimum from the full audited set and performs an epoch/count CAS. It never automatically reactivates K.

Missing data, invalid bindings, thrown/unknown runtime execution or unavailable resources currently return `SAFETY_REPLAY_UNKNOWN`; they never become a FAULT or administrator pause. The additional deterministic structure/function-FAIL proof branch is intentionally not claimed implemented. A scientific error common to both verifier and replay cannot be detected by this mechanism. No admin cost, pause, verifier-swap or payment-clawback setter exists.

## Executable evidence and remaining gates

Thirty-one business/codec tests cover real sixteen-seed FUNC2 opening, typed H22/H16 and snapshot bytes, copied designs, commitment priority, same-hour competition, q1-before-q2 disclosure, sold authors, owner EXIT, delayed K activation, complete bounded scans, finite safety proofs/corrections, prefix/tail recovery and historical debt. Competition fixtures explicitly represent the **non-production historical twelve-seed opening328**, with real FUNC2 C324/C320 graph results; production always requires all sixteen prepublished graphs. Upstream root-storage fixtures isolate originality and do not claim to manufacture real materials; composition separately tests the full material lifecycle.

Exact wire helpers currently cover H22, suite2/fixture1/load1 H16 payload321, schema2 blueprint/DescriptorMap, sixteen-entry initial set and176-byte opening snapshot. Native Task/Knowledge/Candidate/Winner/Safety/PDA/privilege adapters and their complete account codecs remain production integration work. Model Safety reference IDs are deterministic RECORD identities, not a claim to have derived/created actual Solana Safety PDA accounts. Real signatures/rent/Token CPIs/SBF compute and memory, concurrent native account locks, finality and independent review remain gates. `productionAdmission=false` is retained.
