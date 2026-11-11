# Local interactive protocol account

Prepared before implementation. This is an explicitly local HOST reference
runtime, not a native Bank, public wallet or deployable account. It never uses
network access, real signing keys or transaction broadcast.

- [x] Use frozen biology/catalog functions, OPEN310 seventeen public seeds and
  C310; do not alter scientific or economic constants.
- [x] Build startup funds through actual part staking/closed-hour accrual/claim.
  Only test SOL is supplied by the explicit System/rent/address model adapter.
- [x] Ready baseline has60 live unlocked parts, one spare120-unit material set
  and earned LAB sufficient for the actual48LAB complete parent-chain fee.
- [x] Cache baseline once; every runtime/restore/reset gets a detached clone.
- [x] Purchases, manufacture, inheritance, consumption, fees, staking, time,
  claims and exit execute the existing reference modules. Failed actions leave
  all state unchanged. UI kit grouping cannot authorize or duplicate materials.
- [x] Export plain JSON checkpoint with exact BigInt/Map/Buffer types; restored
  model invariants and frozen identities are checked. Export remains below12MiB,
  snapshot below256KiB. Root HTTP owns opaque sessions, revision, idempotency,
  persistence, serialized access and reset/run-generation handling.
- [x] Test complete clickable path, material/fee accounting, repeated claim,
  parents consuming inputs once, insufficient material and checkpoint isolation.

API: `preparePlaytestCheckpoint({onProgress})`,
`createPlaytestRuntime({checkpoint,onProgress})`,
`restorePlaytestRuntime(checkpoint)`. Runtime exposes `snapshot()`, synchronous
`execute({action,params})`, and plain-JSON `exportState()`.

## Local acceptance

Six focused cases pass,0 failures, in
`evidence/playtest-runtime-focused-20261025.log`. Complete new-kit purchase,
manufacture,15 CELL,6 ORGAN,C310 BIO,stake,time,claim,exit and final claim execute
the actual reference modules. Manufacturing burns48,000,000 atoms; startup
funds48,225,840 atoms were earned by60 parts over338 model hours, not injected.
Repeated claim, wrong stage, invalid requests/time, locked child and immutable
checkpoint identity fail without a state change. Restores/reset clones are
isolated; default stake chooses latest eligible highest-scope work.

Measured ready checkpoint1,404,611 JSON bytes and snapshot about30KiB; full-chain
exports remain below12MiB and snapshots below256KiB by executable assertions.
Cold startup takes about31 seconds and yields progress; prepared resets clone
without replay. Snapshot kits expose real canConsume and actual-root-derived
upgrade costs. Root HTTP must warm/cache the template and owns revision/request
idempotency, persistent sessions, account isolation and reset generations.

No native/Solana transaction is executed by this module. Test SOL/rent/address
allocations are explicit HOST adapters; all LAB/material/function arithmetic is
provided by the existing frozen modules. Three earlier accepted logs preserve
the pre-refinement focused scope; the six-case log is final for this module.
