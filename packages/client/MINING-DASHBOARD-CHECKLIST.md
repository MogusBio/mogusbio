# A4 strict mining dashboard and single global proposals

Pre-code checks fixed on2026-10-25. No timer, keeper daemon, simulation, signer,
broadcast, deployment or economic-rule change belongs to this module.

- [x] Exact argument allowlists, bounded known IDs/pages, ReadOnlyRpc, actor and
  admitted ABI checks precede fetching. Dashboard permits zero known instances.
- [x] Coherently read actual Base/Econ/Clock/raw nonce/Actor/Registry and strict
  Classic LAB Mint/Reserve/Treasury. Validate the book, donations and external
  burns without crediting either as extra rewards. Reread the full closure.
- [x] Display processed-frontier weights separately from wall-clock eligibility;
  use the one shared denominator floor only once. No future daily payout promise.
- [x] Read exact Root/RootReg/Directory and bounded immutable Positions. An active
  processed Directory can refer to an older sequence than RootReg's latest.
  Consumed Roots retain visible old debt but have zero future eligible weight.
- [x] Validate actual Registry K Activation/Directory/ordinary Position links and
  beneficiary. Processed K status is distinct from an ended physical interval.
- [x] Sum actor claimable only across unique listed actual Position rows whose
  immutable beneficiary equals actor; never infer debt from current Root owner.
- [x] Wrap the existing one-step keeper planner. Record all actual dependency
  reads and reread the complete closure plus raw nonce/book before returning one
  action or wait/replan decision. No new global settlement algorithm.
- [x] Wrap actual completed Hour closure; refund only its saved original opener.
  Actual observed account lamports are not a minimum-rent or network-fee quote.
- [x] Test unmodified genuine76b final ledger, explicit HOST-only alternative
  histories/frontiers/books/K state, strict malformed/race fixtures and existing
  keeper, lifecycle, treasury and settlement regressions.

Exports: `readMiningDashboard`, `planGuidedGlobalSettlement`,
`planGuidedHourClosure`. All return local planning/read flags. Missing Registry
is a valid uninitialized zero frontier; missing RootReg means never registered.
Unknown or malformed owned records fail instead of being relabeled as missing.

Acceptance: module/test syntax checks and64 relevant tests pass, including15
new dashboard/global/closure tests. Evidence: `evidence/mining-dashboard-current.log`.
Genuine current76b checkpoint SHA
`6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe`
shows BIO accrued=paid941780 atoms, manufacture burns48000000 atoms, processed
frontier341 and one still-cached active BIO Directory while its END event awaits
application. The proposed next global action is APPLY_EVENT; a genuine completed
Hour340 holds4245600 lamports refundable to its recorded opener. These remain
read/proposal observations, not newly executed transitions.

Alternative delayed-owner/new-stake history, active cached K, reserve donation,
external burn, empty/inactive/missing Registry, first-part potential, emission end
and race fixtures are explicitly HOST-only. Their successful planning is not a
new native mint, reward, stake, exit, close or transfer acceptance result.

Summary quantities use exact decimal strings; weights retain native integer
units. `processedWeights` is the processed Registry frontier and applies the
shared floor once. Root future weight is explicitly potential only and becomes
zero for consumed/faulted or emission-ended Roots; it is not a scheduled payout.
Actor claimable totals cover listed page rows only, even when an older processed
Position outside the page was also read to authenticate a Directory. Historical
beneficiary ownership is independent of current Root owner.

K status from RootReg is labeled a mirror. The global processed K view separately
validates actual Activation/Directory/ordinary Position/beneficiary and exposes
physical end versus processed active state.

Global one-step planning records every actual keeper dependency read, validates
its core economic book/nonce/Clock, then rereads the complete closure twice.
No independent keeper state machine is introduced. Hour closing uses the actual
recorded account balance and saved opener; no rent-minimum/network-fee quote or
reward transfer is inferred. No signing, sending, wallet access or deployment.

Follow-up read consistency: the total unpaid amount across listed actual Position
rows must not exceed actual Treasury.certified. The HOST delayed-beneficiary
fixture moves7 atoms from sealed to certified without changing bookSum; a
checkpoint-derived unfunded-debt corruption is rejected. Focused16/16 tests pass
(`evidence/mining-dashboard-debt-check-current.log`). No economic field or rule
was added.
