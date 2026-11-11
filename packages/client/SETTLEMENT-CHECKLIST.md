# ECON4 client workflow

Before implementation: reuse the exact native ABI and strict program-owned
Registry26/2, Hour18/3,4 and Position27/2 decoders. Never interpret a historical
schema2 host Hour as a current native snapshot.

- ADVANCE requires the actual mature current Hour4, lazy0 and READY/partial
  state. Its instruction has only Registry/Hour after the common prefix and
  never contains a treasury or token transfer.
- Historical accrual requires an actual lazy snapshot, its processed-count
  CAS and the chosen Position's own chronological coverage. Current Directory
  membership/links are irrelevant; its immutable Root/directory identity is not.
- RootReg and Position must agree on Root, directory and coverage sequence;
  an expired stake or a consumed Root does not erase its old beneficiary debt.
- Ordinary and same-Root K combine before one floor. A preview is not chain
  execution, wallet authorization or a promise about the next live state.
- Claim destinations must be actual Classic token accounts for the LAB mint
  and immutable Position beneficiary. A cranker cannot redirect the payment.
  An explicitly absent destination uses only the canonical beneficiary LAB ATA
  and `labDestinationSetup:{beneficiary}`. Session rechecks the actual Position
  and atomically prepends the one whitelisted idempotent ATA instruction.
- Test mature/immature hours, schema3, duplicate/stale cursors, ended current
  nodes, own-history skips, K combined floor, empty lazy finalization and wrong
  token destinations. No helper signs, sends or advances a nonce automatically.

Implementation acceptance: three workflow tests passed, including schema3 and
immature rejection, current-inactive historical membership, own cursor failure,
the856164 combined-K golden, empty finalization, wrong-beneficiary rejection,
paid-CAS upper bounds and the exact first-claim ATA metadata/PDA. The real
native/Bank and final full-chain evidence remain independently scoped in
`docs/FINAL-REVIEW.md`; client previews are not substituted for those runs.
