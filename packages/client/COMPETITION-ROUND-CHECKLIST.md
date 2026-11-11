# A4 competition round / Winner activation — checks before code

- Read-only current-release planning only. Reuse original native FINALIZE_ROUND
  and ACTIVATE_WINNER; no ranking service, fabricated Winner, signing or send.
- Validate actual Base/Econ/Clock/ActorNonce/Actor, Task/KSlot and current16 seed
  snapshot. C316 remains the current opening; historical14/C318 is not relabeled.
- Derive round phase, frozen scanCount, epoch-reset and exact cursors from the
  actual Round. One call returns one native step, limit1..8. Phase0/reset and
  empty rounds have no invented scan rows; future/paused/non-next rounds block.
- Scan Knowledge in native order, with authoritative Safety immediately after
  active corrected kind2 rows unless already present. Preserve corrected origin
  anchors; do not rank off chain or omit revoked rows from contiguous scans.
- Candidate phase validates actual Candidate/Commit/Disclosure/own Knowledge,
  then appends the contiguous scan excluding own aliases. The native program
  decides eligibility and tie breaks. Phase3 resolves its selected Candidate ID
  through bounded canonical records with public cursor/context or verified hint.
- Winner recognition remains distinct from K activation. A transferred, consumed
  or exited winning Root may still receive immutable recognition; automatic K
  tail appears only when actual native eligibility holds.
- Activation reads Root/RootReg/current ordinary Position/Directory/Registry,
  actual retained old Activation, and fresh new Activation/KHistory/Event. Check
  current best, author owner, live q2 BIO, active ordinary interval, closed K,
  revision/beneficiary linkage, future start and monotone event ordering.
- Old historical reward coverage and unpaid debt are not an activation gate:
  native requires an open ordinary interval, not paid==accrued or full coverage.
- Final complete closure reread must preserve nonce, all state and current time
  observations; changes return REPLAN with no action, regressions fail closed.
- Tests separate genuine current records from synthetic Winner/correction
  fixtures. No synthetic C315 is advertised as a legal design or new frontier.

## Local implementation evidence

Completed `competition-round.mjs` exports `planNextCompetitionRound`,
`planActivateWinner` and JSON-safe `readCompetitionState`. Bounded selected
Candidate lookup binds its public cursor to Round ID, selected ID and actual
candidate count; stale contexts restart at zero. No planner reserves a nonce.

Focused test run: **9/9 pass**, `evidence/competition-round-current.log`.
The unchanged 76b ledger supplies the genuine empty-round observation. All
phase/candidate/Winner/corrected-Safety variants are labeled HOST-only fixtures,
and do not demonstrate a new legal frontier or executed native activation.

Still required before production: simulate each actual returned instruction,
fund actual rent/network fees, run actual signed multi-phase Winner lifecycle
against the admitted current ELF, then independent review and explicit release
authorization. This module performs no network broadcast or deployment.
