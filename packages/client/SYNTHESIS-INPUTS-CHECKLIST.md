# A3.1 actual synthesis inputs — pre-code contract

Scope fixed before implementation: read actual known input accounts and plan an
ordinary frozen702 payload. No upload, manufacturing, nonce/material reservation,
wallet, signature, journal, simulation, broadcast, economic or native ABI change.

- [x] Exact known-ID API only; unique32-byte IDs, target1..22, expected fixed
  direct count (four parts / members(target) cells / six organs), maximum6.
- [x] Actual finalized Base/Econ/Clock/ActorNonce/on-curve ordinary Actor,
  canonical Root/RootReg and every upper input's original702 Artifact closure.
  Discovery/full/reread use at most23 accounts, below100 RPC bound.
- [x] Strict ownership/header/domain/config/PDA/intrinsic state decoding. Clock,
  nonce and Root/Artifact times cannot regress or be in the future. Missing or
  prefunded empty System RootReg is distinct from malformed native state.
- [x] Return observed records even if owner, LIVE, exact hierarchy/service
  profile, certificate fault, ordinary/K end or historical coverage blocks use.
  Never treat unknown/open K as no K. No requirement to pay/claim old debt first.
- [x] Parent Artifact must match original Root hashes/length/graph/leaf binding,
  preserving immutable child graph/capsules. No rebuilt or caller capsules.
- [x] Complete closure is reread in one finalized batch. Changed relevant record,
  nonce or Actor funding returns REPLAN_STALE_STATE with no usable input/plan.
- [x] Only all-eligible records enter existing planSynthesisPayload under fixed
  release graph context. Challenge follows frozen500000..2000000/1000 lattice;
  hard targets3/9/14/15/21 require2000000. Copy caller graph and IDs before awaits.
- [x] Separate actual raw backend inputs from JSON-safe public summary. State
  facts establish no manufacturing success and no actual execution authority.
- [x] Tests use unchanged genuine76b records and explicitly HOST-only restored
  LIVE/registration/clock mutations. Cover all hierarchy levels, exact fees,
  inheritance, blocked intervals/coverage, malformed records, bounds, stale
  reads and no non-read transport calls.


Implemented exports: `readSynthesisInputs`, `planActualSynthesis`, and
`SYNTHESIS_INPUT_LIMITS`. `INPUTS_READ` preserves actual raw records and explicit
blocked eligibility; only `SYNTHESIS_PLANNED` includes an all-eligible frozen
payload plan. `REPLAN_STALE_STATE` exposes neither actual input rows nor plan.
Summary and eligibility are JSON-safe; quantities use decimal strings. Raw
`directInputs` and plan are backend objects and must be stripped from public
bridge responses or deliberately converted by the coordinator.

Focused validation:9/9 tests passed (about2.75s), plus syntax checks. Unchanged
genuine76b final accounts prove consumed input rejection and original702
closure; restored LIVE/interval/coverage/Clock/nonce/ownership examples are
explicit HOST-only planning fixtures, not new actual manufacture or finality
proofs. Maximum observed full batch is23 accounts. CELL/ORGAN16/17/18/BIO
fees0.8/3.2/4.8/6.4/12LAB and exact capsule counts are checked. Tests also cover
parent hash/prefix corruption, funding/revision/nonce/Artifact races, missing
RootReg, openK, unpaid-debt independence, strict bounds and caller-mutation
copying. Transport only requests genesis and finalized account reads.

The native FINAL still independently validates and consumes inputs. This layer
does not prove wallet/network finality, actual LAB affordability, physical PASS,
latest Task/K dependencies or transaction success. Those remain later A3/A4
coordinator/native and production acceptance responsibilities.
