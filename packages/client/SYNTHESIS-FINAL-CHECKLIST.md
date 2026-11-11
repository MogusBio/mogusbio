# A3 actual FINAL planner — checks before code

Scope: one read-driven ordinary SYNTH_FINALIZE proposal. No signing, simulation,
sending, nonce/material reservation, invented verification state or new reward.

- Accept only the fixed release/ABI/ReadOnlyRpc, actor, immutable synthesis plan,
  expected actual verification identity, maxRent and maxFee. Re-decode V4 from
  actual finalized accounts; caller q/PASS/cursors cannot authorize FINAL.
- Read Base/Econ/Clock/ActorNonce/ordinary Actor wallet; exact sealed702 Artifact,
  current direct Root/RootReg and original parent Artifacts; LAB mint/canonical
  actor ATA/reserve/Treasury; Registry, Task, current Round and Disclosure.
- For applicable q2 BIO derive next Knowledge and actual KSlot. Follow actual
  Activation→old Root/RootReg/Position and Registry/event closure. Activation has
  an ordinary Position ID, not sequence; compare canonical H14 IDs for
  at most256 recent sequence numbers per call, then fetch/decode only the
  actual matching PDA. If absent beyond this bound, explicitly
  return K_POSITION_LOOKUP_REQUIRED; never guess the latest Position.
- Verify task/round/disclosure identities and counters, K generations and stop
  linkage, current clock monotonicity, finite nonce and fresh output/Knowledge/
  required stop event. Unknown or malformed records are not treated as absent.
- Check actual input owner/LIVE/revision/fingerprint, ended ordinary/K intervals,
  completed coverage and no certificate fault. Do not require paid==accrued.
- Rebuild the current exact payload using planSynthesisPayload and require bytes
  equal the frozen plan, retaining original historical capsules.
- Check actual Classic LAB amount covers the exact fixed manufacturing fee,
  actual mint/reserve/Treasury book consistency and fee ceiling. Unclaimed or
  future LAB does not pay the burn. Rent/network affordability remains separate.
- Read final full closure coherently, derive exact registration and FINAL action,
  then reread full closure. Changed nonce/state/round returns REPLAN_STALE_STATE,
  no usable action; Clock/nonce regressions fail closed.
- Tests use current genuine76b ledger/accepted trace plus explicitly HOST-only
  restored LIVE flags and completed V4 adapters. No fake fixture is labelled new
  native execution or public RPC/wallet acceptance. Preserve economic/native ABI.


Implementation and scoped local acceptance complete:

- Export `planActualSynthesisFinalization({release,abi,rpc,actor,plan,verification,maxRent,maxFee,positionLookupStart?,positionLookupContext?})`. The optional lookup context has exactly four public keys: activationIdHex, rootInstanceHex, positionIdHex, ordinaryCount; a stale context resets the sequence search to the actual current ordinaryCount.
- `ACTION` returns one existing SDK native action, newly decoded actual V4, clock/nonce and a preview with exact fee, real LAB balance, output ID/address, current round and prior-K stop/Position facts. Every blocking decision has no action. Public accounting flags keep execution and network submission false.
- `K_POSITION_LOOKUP_REQUIRED` returns the bound context plus nextStart. The coordinator may persist this public read cursor. Exhaustion returns `K_POSITION_NOT_FOUND` with nextStart null, never guesses or loops automatically.
- Actual final closure is reread after constructing the action. Account/nonce changes return REPLAN; Clock/nonce regressions and malformed records fail closed. V4 payload offsets, counts, direct/leaf hashes, B/retired and challenge are bound to frozen702 bytes.
- Focused suite `node --test packages/client/test/synthesis-final.test.mjs` passes10/10, log `evidence/synthesis-final-current.log`. Tests cover CELL, all six distinct ORGAN fees, ordinary BIO Knowledge/KSlot, actual LAB shortage, coverage/interval blocking, concurrent Task/V4/nonce changes, strict records, standard prior-K closure, resumable300-position lookup and stale cursor reset, plus occupied stop-event rejection.
- All plan-positive synthesis input fixtures restore LIVE/current revisions and completed V4 over genuine unchanged76b records; they remain explicitly HOST-only account adapters. K closure and funded book variants are also synthetic and do not establish new native executions. One host cost315 mutation exercises stop-event dependencies only; it is not a legal C315 design, a new frontier, or evidence of mining eligibility. Native unchanged23,653-transaction chain remains separate evidence.
- No shared module, native source, ABI, economic parameter, wallet, signing or deployment was changed by this isolated module.
