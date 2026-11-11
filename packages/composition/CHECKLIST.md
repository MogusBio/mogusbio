# Composition implementation checklist

Before implementation:

- [x] Read P5 fixed descriptor/BOM/provenance and ROLLUP1 Artifact/Direct74/LeafMap70/capsule/root rules.
- [x] Use actual core material plan consumption; no arbitrary user-supplied q/B/PASS mint.
- [x] Keep four classes fixed and all synthesis one-way; no unpacking, recycling or destroyed input revival.
- [x] Keep P5 fee zero and parent fee `ceil(B_int*r/120000)` with original CELL/ORGAN/BIO rates.
- [x] Inject functional verification only through trusted server/module dependencies, never request callbacks or client PASS.
- [x] Integrate settlement consumption guard and preserve old Position liabilities.

Executable acceptance targets:

- [x] Bounded sequenced Artifact append/replacement/full-SHA seal/immutability.
- [x] Strict BIOP7D01 payload / Graph / Direct74 / LeafMap70 / capsule codecs.
- [x] P5 component manufacturing from four actual material balances and Source prefix state.
- [x] Layer-specific exact inputs, child graph immutability, source overlap and effective/retired provenance checks.
- [x] Atomic output creation, input consumption, actual paid-balance fee burn and no nonce duplication.
- [x] Negative tests for invalid bytes, stale sources/revisions, replay, forged capsules/PASS and failed verifier; stake/coverage guards reused from the independently tested settlement module.
- [x] Document native/SBF/H16/canonical/release gaps without declaring production admission.

The complete60→15→6→BIO lifecycle test intentionally injects verifier mocks. It proves lifecycle/material/fee/position transitions only; it is not the biological validation or production gate. Composition retains `productionAdmission=false`.
