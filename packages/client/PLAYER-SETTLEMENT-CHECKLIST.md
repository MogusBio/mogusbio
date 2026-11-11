# Player settlement coordinator

Checks fixed before implementation:

- Reuse strict native decoders and the existing ECON4 planners; do not invent
  balances, membership, beneficiary, quality or rewards.
- Verify the finalized BaseConfig and actor nonce. For accrual, reread Position,
  Registry, RootReg and the immutable Directory identity in one finalized batch.
  Subsequent reads must respect that context slot; the native CAS remains final.
- Explicit `claim` uses only actual accrued-minus-paid debt and the immutable
  beneficiary's canonical LAB ATA. An absent ATA selects the already reviewed
  atomic ATA+CLAIM path. A pre-funded empty System account at that exact ATA
  still needs the same idempotent setup. It does not borrow the cranker wallet.
- Explicit `accrue` selects exactly the Position's next unsettled hour, never
  skips its own history, and requires the actual older frozen lazy Hour4.
- Report prior-position coverage, an unfrozen frontier and completed coverage
  as wait/done outcomes. Missing or malformed data is an error, not an empty
  hour or proof that the player has no debt.
- Export only an unsigned exact ABI intent. No signing, automatic retries,
  timers, implicit cancellation, nonce reservation or send occurs here.
- Accept actual finalized reads through the bounded ReadOnlyRpc transport;
  a trusted RPC remains an external trust boundary, not a cryptographic proof.

Acceptance: actual finalized batch reads; own chronological accrual; inactive
historical Directory; claim to the old beneficiary; first ATA creation metadata;
wrong ATA owner; zero debt; prior-interval wait; frontier wait; malformed/missing
hour failure; no send; CLI new-file intent export.

Acceptance completed: five coordinator/CLI tests passed. The shared fixture is
explicitly a native-account codec fixture, not an additional SBF execution. The
independent native cold/Bank evidence remains bound to its exact ELF and scope.
