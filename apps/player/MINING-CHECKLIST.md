# A4 mining dashboard and lifecycle browser layer

Pre-code contract fixed2026-10-25. Add the independent ninth view, preserving
existing native console and other views. The tenth research view is coordinated
separately; root owns shared route/script/API wiring.

- [x] Read at most4 explicit known IDs and1–5 immutable Positions per Root.
  No wallet discovery, automatic polling, estimated daily payout or fake balance.
- [x] Bind returned JSON-safe overview to Actor, IDs/page and actual read flags.
  Distinguish processed frontier denominator from current wall-clock eligibility;
  show one shared floor and historical beneficiary debt instead of current owner.
- [x] Show actual treasury/supply/burn/donation/backlog facts, global K versus
  RootReg mirror status, consumed future weight0 and scoped claimable totals.
- [x] Explicitly request one global advancement, completed Hour rent refund or
  K-aware EXIT/TRANSFER. Bind intent operation/payload/caps/instance/recipient to
  the current request and native default resources; blocked results keep no intent.
- [x] Handoff only fills Actor/intent and navigates to existing P10.1 console.
  Prepare, inspect, simulate, wallet signing, sending and recovery stay explicit.
- [x] Open an actually read historical Position in the existing guided asset
  page without automatic lookup, staking, claiming or beneficiary reassignment.
- [x] Every field/tab/view/config change aborts/invalidate obsolete actions;
  generation/controller guards late success/failure/finally responses.
- [x] All responses/errors use text-only rendering and bounded same-origin
  transport. Default-disabled configuration still explains the complete flow.
- [x] Focused browser event tests plus existing guided/native/project/manufacture/
  synthesis regressions. No signing, sending, live wallet/RPC or deployment.

Bridge actions: mining-read, global-plan, hour-close-plan, lifecycle-plan.
The server fixes release/network; this page explicitly supplies fixed default V1
resources. The bridge still validates those fields. The browser supplies no
replacement runtime, economic rules, trusted validation or caller-selected RPC.

Acceptance: syntax check and64 UI tests pass, including9 new mining tests plus
existing native/guided/project/manufacture/synthesis tests. Log:
`evidence/mining-ui-current.log`. Final navigation contains10 independent views.
The new tests use genuine current76b-derived public summaries/native proposals;
HOST-only browser K/modified response fixtures test rendering and binding only.
No browser fixture is presented as a newly executed native transaction.

Explicit request bodies include resources for global/hour/lifecycle planning,
with priorityFeeLamports as canonical string0. Read requests contain only bounded
known IDs/page information. Expected payload length, signed rent cap, fixed suffix
roles, dynamic account uniqueness, lifecycle revisions/recipient and K event order
are checked before handoff. Original-opener Hour refunds cannot be redirected.

Every form/tab/view/config change invalidates old intents. Stale async success or
failure cannot revive or overwrite a newer request. Actual Root and Position
handoffs merely fill the existing guided page, preserving actor and historical
beneficiary semantics; the user must explicitly read/plan there. The native
console still owns prepare/inspect/simulate/sign/send/status/recovery.


Actual localhost browser QA covered default-disabled overview, lifecycle tab, ten-page navigation and zero browser errors. Screenshots: evidence/ui/mining-a4-20261025.png and mining-lifecycle-a4-20261025.png. Actual bridge-to-browser contracts separately passed against the genuine76b checkpoint; these are record adapters, not live wallet acceptance.

## Click-flow handoff correction

A shared asset-handoff module now fills the complete known-asset query and
explicitly selects the asset panel before navigation. New parts/synthesized
Roots reset stale historical pagination to0/5; exact historical Position
handoffs preserve their sequence and use the existing1-row option. Mining
previously navigated to guided without selecting its asset tab, leaving the
purchase panel visible; the shared handoff closes that path.

Selecting a verified dashboard Root also fills the lifecycle instance field,
invalidating prior proposals through the existing input listener. It does not
read, plan, connect, sign, send, stake, exit, transfer or claim automatically.
Workflow IDs already remain in existing fields after save/navigation, and the
explicit restore path still strictly rereads the original immutable workflow.
No new cached workflow authority or financial permission is added.

Focused handoff/manufacture/synthesis/mining tests pass38/38 in
`evidence/click-flow-handoff-focused-20261025.log`. Existing output tests now
start with historical page60/limit1 to prove new outputs reset those fields.
Real wallet/network/browser acceptance remains root-owned.
