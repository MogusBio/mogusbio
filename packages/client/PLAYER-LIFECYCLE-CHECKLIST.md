# A4 player lifecycle: K-aware EXIT and TRANSFER

Pre-code contract fixed 2026-10-25. Only a read-driven native proposal is built;
no account mutation, simulation, signing, broadcast or deployment occurs.

- [x] Reject unknown/runtime-result arguments, wrong operation/ABI/RPC, malformed
  instance/caps and forbidden recipients before fetching. Only a ReadOnlyRpc
  transport can supply actual finalized observations.
- [x] Read actual Base/Econ/Clock/raw ActorNonce/Actor/Root/RootReg/Registry,
  derive bounded dependent keys, then reread the complete closure. Regressing
  clocks fail; state/nonce/cache or hour-boundary changes require replanning.
- [x] Ordinary EXIT authenticates current owner/LIVE Root, certificate status,
  exact current open Position, start boundary, root revision and event ordering.
  It uses the existing56-byte payload and fixed native suffix only.
- [x] Open-K EXIT checks Task/slot generation and reference, actual Activation
  and RootReg/ordinary crosslinks, clocks and counter room. K END event uses
  Registry.eventCount; ordinary END uses eventCount+1, in native append order.
  Preserve ordinary physical end past H_END while capping event due values.
- [x] TRANSFER uses the existing88-byte payload, Registry/Root/RootReg suffix,
  exact Root/registration revisions, on-curve safe recipient and no recipient
  signer. Never-registered roots permit canonical missing RootReg/Registry.
- [x] Movement requires ended ordinary/K boundaries and complete historical
  coverage. Unpaid historical debt does not prevent movement or change its
  immutable beneficiary. Never automatically claim or erase debt.
- [x] Every block/replan result has no action. ACTION records remain local
  proposals with actual rent/network fee/simulation/execution unverified.
- [x] Test genuine current76b Root/closed history, explicitly HOST-only open-K
  restoration, malformed links, counters, event reuse, wallet changes, coherent
  reread races, boundary/coverage/debt rules and repeated deterministic planning.

Export: `planPlayerLifecycleAction({release, abi, rpc, actor, instance,
kind:'exit'|'transfer', newOwner? /* transfer only */, maxRent})`.

Native normalized account counts are12 ordinary EXIT,16 K EXIT and10 TRANSFER.
The official public instruction builder supplies its eight-account wire prefix,
so raw wire counts are13,17 and11. No manual raw-index conversion is used.

Acceptance: module/test syntax checks and58 tests pass, including15 new lifecycle
tests plus existing account, originality-reader, asset, keeper, native and
settlement-workflow regressions. Log: `evidence/player-lifecycle-current.log`.
The default closed BIO/Position/RootReg source is the unmodified current76b ledger
SHA `6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe`.
Open-K, unpaid-debt, missing-registration, counter/race and failure cases are
explicitly HOST-only planning fixtures. No new SBF result or executed transfer,
exit or economic effect is claimed by these tests.

Clock handling: forward slots/time within one boundary use the last coherent
observation; a boundary/reward-start crossing forces replanning. Otherwise normal
Clock advancement would make a real read-driven proposal impossible. ActorNonce
bytes/cache, Actor wallet lamports and every non-Clock dependency must be identical
across the final full reread. New native transaction execution and independent
SBF/Bank parity for this coordinator still require separate acceptance.

Preview includes expected next Root/RootReg revisions, ordered native event
sequences/due hours, preserved historical beneficiary and last-Position unpaid
amount. That amount is explicitly not a total across unqueried historical rows.
Recipient ownership is an actual safety check only; no recipient account/signature
is inserted into TRANSFER's native instruction. Simulation/rent/network fees remain
unverified and no nonce is reserved.
