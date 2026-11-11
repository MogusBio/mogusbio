# Settlement implementation checklist

Scope: executable, dependency-free Node ESM reference kernel based on ROLLUP1 documents 10–12, with the explicit SETTLE2 storage revision described below; not a deployed Solana program. All monetary values and counters use checked BigInt. Root certificates and winner facts are accepted only at the trusted integration boundary; this package does not certify biology, verify signatures, derive PDAs, or execute SPL Token CPIs.

SETTLE2 cost correction: permanent per-root/per-hour Receipt plus permanent full-frame Business storage fails the economic acceptance gate. Replace Receipt with cumulative `accrued/paid` in each immutable-beneficiary ordinary interval, and replace unbounded per-operation Business with one fixed-size per-actor strict nonce/last-result checkpoint. Hourly budget, weights, exact per-root floor, one-time classification, historical beneficiary and one-way consumption remain unchanged. This is a wire/storage revision, not a claim that the old ABI is implemented unchanged.

Before implementation:

- [x] Read frozen staking, hour settlement, receipt and static-vector specifications.
- [x] Keep the frozen 100,000,000 LAB / 6 decimals / 46 nonzero epoch curve.
- [x] Preserve per-root, per-hour floor and normal-plus-K before floor.
- [x] Preserve unique lifetime root directory, amortized interval cursors, finite reward domain and first-root empty-prefix proof.
- [x] Specify atomic command rollback and committed-operation replay before mutable checks.

Implementation and executable acceptance:

- [x] Exact emission arithmetic and checked u64/u128 operations.
- [x] Verified-root ingress, staking, future-hour exit, transfer and one-way consumption guards.
- [x] Unique K history with trusted winner/current-frontier checks and irreversible transfer/consume revocation.
- [x] Bounded first-pass work, second-pass materialization, coverage and immutable hour denominators.
- [x] Treasury sync, reserve/supply conservation, one-time claims and historical beneficiaries.
- [x] Duplicate, stale-cursor, interruption, epoch, high-water rollback, finite-domain and adversarial tests.
- [x] Document measured host execution separately from unmeasured Solana CU/rent/transaction feasibility.
- [x] Reuse core ByteReader/ByteWriter for exact Position/Hour/claim codecs; 55 executable cases pass, including historical author and finite safety hooks.

No added token, fee, material recycling, floor adjustment, subsidy or silent change to economic behavior.
