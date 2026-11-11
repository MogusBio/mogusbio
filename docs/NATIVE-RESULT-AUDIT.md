# Native result length audit

Audited 2026-10-25 against all 33 public operations in
`programs/biolab-economy/operations.p0r2.json` and their actual native return
builders. BUY_MATERIAL was the only mismatch: the native implementation returns
58 bytes while the ABI declared 64. The correction changes that declaration to
58; no native source, payload, accounts, economics, or result bytes change.

The exact ABI SHA-256 changes from
`8f48f9ea410c5edaec52910b80508a955a5c04ddf30ebf6122ccffd4f8d1c87a` to
`089d63ad876fe0701ab783b25ad9de3b6ea7cb0f2a48e085e451fe51a6d9024f`.
Existing ELF, trace, Bank, checkpoint, and source-manifest evidence retains its
original identity and scope. This source audit and client regression do not
claim new native execution or acceptance under a new ABI binding.

Source locations below are relative to `programs/biolab-economy/`. Lengths are
the bytes returned on success, including an exact retry of a completed request.

| Native opcode | Operation | Native bytes | Corrected ABI bytes | Return builder |
| --- | --- | ---: | ---: | --- |
| 1 | INIT | 72 | 72 | `src/initialize.rs:140` |
| 4 | CREATE_PROJECT | 208 | 208 | `src/launchpad.rs:381` |
| 5 | BUY_MATERIAL | 58 | 58 | `src/launchpad.rs:664` |
| 6 | QUEUE_OPS | 56 | 56 | `src/ops.rs:124` |
| 7 | PAY_OPS | 64 | 64 | `src/ops.rs:317` |
| 9 | ARTIFACT_PUT | 45 | 45 | `src/verification.rs:202` |
| 10 | ARTIFACT_SEAL | 76 | 76 | `src/verification.rs:235` |
| 8 | MANUFACTURE_PART | 108 | 108 | `src/component.rs:378` |
| 11 | VERIFY_BEGIN | 80 | 80 | `src/verification.rs:310`, shared `result()` at 281 |
| 12 | VERIFY_STEP | 80 | 80 | `src/verification.rs:318`, shared `result()` at 281 |
| 13 | SYNTH_FINALIZE | 156 | 156 | `src/synthesis.rs:665` |
| 20 | REGISTER_ORDINARY | 64 | 64 | `src/settlement.rs:785` |
| 21 | EXIT_ORDINARY | 40 | 40 | `src/originality.rs:414`, delegates to `src/settlement.rs:845` |
| 26 | TRANSFER_ROOT | 72 | 72 | `src/settlement.rs:1717` |
| 22 | SYNC_EMISSION | 8 | 8 | `src/settlement.rs:881` |
| 23 | OPEN_HOUR | 24 | 24 | `src/settlement.rs:1005` |
| 24 | APPLY_EVENT | 8 | 8 | `src/settlement.rs:1179` |
| 28 | EMPTY_SKIP | 24 | 24 | `src/settlement.rs:927` |
| 29 | ADVANCE_FROZEN_HOUR | 16 | 16 | `src/settlement.rs:1031` |
| 25 | MATERIALIZE_HOUR | 33 | 33 | `src/settlement.rs:1283` |
| 27 | CLOSE_FINAL_HOUR | 80 | 80 | `src/settlement.rs:1332` |
| 3 | CLAIM_POSITION | 88 | 88 | `src/position.rs:151` |
| 30 | BLUEPRINT_BEGIN | 133 | 133 | `src/originality.rs:146`, shared `result()` at 136 |
| 31 | BLUEPRINT_STEP | 133 | 133 | `src/originality.rs:159`, shared `result()` at 136 |
| 32 | REGISTER_SEED | 72 | 72 | `src/originality.rs:250` and 268 |
| 33 | SEAL_OPENING | 49 | 49 | `src/originality.rs:286` |
| 34 | COMMIT | 40 | 40 | `src/originality.rs:307` |
| 35 | FINALIZE_ROUND | 124 | 124 | `src/originality.rs:334` |
| 36 | ACTIVATE_WINNER | 48 | 48 | `src/originality.rs:470` |
| 37 | HISTORICAL_REPLAY_BEGIN | 133 | 133 | `src/originality.rs:517`, shared `result()` at 136 |
| 38 | PROVE_TASK_FAULT | 58 | 58 | `src/originality_safety.rs:113` |
| 39 | AUDIT_NEXT | 66 | 66 | `src/originality_safety.rs:135` |
| 40 | RECOVER_TASK | 64 | 64 | `src/originality_safety.rs:144` |

## Wrapper and decoder behavior

`src/lib.rs:103` normalizes the public account prefix for production admission;
it does not alter operation results. Its dispatch passes each returned vector
directly to `finish_nonce` at line 161. `src/nonce.rs:51` stores the vector's exact
length and bytes in ActorNonce and returns those exact bytes with
`set_return_data`. The retry branch at `src/nonce.rs:34` returns the stored slice
unchanged. There is no alignment or six-byte padding step.

BUY emits quantity, sale lamports, resource lamports, rent lamports (four u64),
season (u16), and project/season/lifetime issued counts (three u64):
`4 × 8 + 2 + 3 × 8 = 58`. The existing
`packages/launchpad/src/codec.mjs:64` decoder already requires exactly 58 bytes;
the older protocol-core operation entry `(202,1)` also declares 58 bytes. Native
`packages/client/src/native.mjs:105` admission requires the exact ABI result
length, and finalized journal reconciliation calls that admission gate at
`packages/client/src/journal.mjs:129`. The old declaration therefore rejected a
real matching finalized BUY cache rather than reporting CONFIRMED.

VERIFY_BEGIN/STEP wrap the kernel's fixed `[u8; 80]` result
(`programs/biolab-kernel/src/scratch.rs:194`) without changing its length.
Blueprint/history results contain a 126-byte prefix plus u32 failure, u8 stage,
and u16 failure cursor, totaling 133 bytes; the vector's initial capacity of 126
is not its final length. REGISTER_ORDINARY includes a u128 weight, totaling 64
bytes. EXIT's K-aware wrapper preserves the ordinary 40-byte result in both
branches.

The targeted client regression constructs the exact 58-byte BUY layout,
requires native ABI admission and strict decoded field values, and rejects both
a truncated 57-byte result and the previously advertised padded 64-byte result.
Actual signed Bank execution and session recovery require separately recorded
evidence tied to the exact ELF, ABI and account snapshot used for that run.
