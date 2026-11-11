# A3.2 synthesis records and exact result binding

Checks fixed before implementation (2026-10-25). This module decodes observed
program records and result bytes only; no RPC, journal, signing, send, material
effect, nonce reservation, native ABI or economic-rule change.

- [x] Decode kind24/schema1 Artifact kind702 with strict header/domain/config/PDA,
  H19 identity, actor, total/written/sequence/seal, exact account length, SHA and
  optional frozen-body prefix. Partial upload and full unsealed state remain
  distinct from sealed bytes and from any manufactured output.
- [x] Expose exact V4 direct/leaf/union SHA, leaf/direct counts, B and retired
  from native offsets while preserving actual decoder branding and used history.
- [x] Read prior verification generation from canonical missing/System-empty PDA
  or strict native kind37 schema3/4/5. Never default another profile to zero.
  Blueprint/historical records must validate profile magic, actor/config/validator,
  Scratch cursor/generation/clock, used/failure invariants and reserved bytes.
- [x] Bind exact156-byte FINAL result to exact SYNTH_FINALIZE Frame and full
  canonical702 payload, H19 Artifact, H3/H8 output, immutable model context,
  leaf-derived B/retired/fee, semantic identity, frame transcript and q bounds.
  When a real V4 snapshot is supplied, bind its completed result too. FINAL
  result contains no rent amount; maxRent is signed but not an actual-rent quote.
- [x] Matching bytes alone retain businessExecutionVerified:false. A result
  decoder never creates PASS, execution provenance or a usable output.
- [x] Test genuine current76b ledger/trace records plus explicit HOST-only
  partial, alternate-profile, receipt and corruption fixtures. Do not relabel
  historical receipts absent from saved trace as captured native returns.

Planned exports: decodeNativeSynthesisArtifact, decodeNativePriorVerification,
decodeSynthesisFinalizeBody, decodeNativeSynthesisFinalizeResult and
decodeNativeSynthesisVerificationResult. Existing
decodeNativeSynthesisVerification remains the actual branded V4 entry point.


Implementation acceptance: `node --test packages/client/test/synthesis-records.test.mjs packages/client/test/synthesis-workflow.test.mjs` passes16/16 (11 new records tests and5 existing synthesis workflow tests). Both changed/new modules pass syntax checks. Log: `evidence/synthesis-records-current.log`. No live RPC, signing, new native execution or user assets used.

Genuine source is the current76b final ledger SHA6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe plus accepted full-chain BEGIN/STEP/FINAL Frames. Actual702 Artifact, completed used V4 and BIO Root agree on hashes, quantities, generation, semantic and transcript. Historical result caches are absent;156 and80 byte receipt fixtures reconstructed from those facts are explicitly HOST-only and do not claim captured return data.

Prior profiles3/4/5 are strictly supported. Schema4/5 fixtures are HOST-only profile constructions retaining the genuine Scratch, with native reserved-byte and failure invariants checked; their presence never supplies a synthetic generation0. Fresh generation0 requires actual null or canonical empty System PDA.

`decodeNativeSynthesisVerificationResult` binds80-byte BEGIN/STEP magic, reserved bytes, reset generation or work-sequence/last-from/count, valid phase/round and result bounds, plus optional observed V4. `decodeNativeSynthesisFinalizeResult` binds156-byte exact FINAL and optional V4; it does not calculate physical quality from a graph alone, quote actual rent, validate live source availability or establish execution. Those responsibilities stay with actual state coordination and native transactions.
