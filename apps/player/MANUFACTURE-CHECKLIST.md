# A2 inventory and part-manufacture browser layer

Pre-code checks fixed before implementation. Scope: a seventh bounded known-inventory view; server-saved immutable public workflow manifests; explicit next-step lookup and input-only handoffs. No transaction, wallet, material reservation or nonce reservation belongs to this module. Root owns actual inventory/coordinator/store/bridge and final browser integration acceptance.

- [x] Preserve six views and add inventory/manufacture navigation.
- [x] Accept exact actor/known project IDs (max8) and Source IDs (max16), no duplicate IDs, browser balances, account tables, RPC, release or storage paths.
- [x] Keep AA/NUC/LIPID/SUGAR standard units, existing Source remaining species budgets, ticks and RU separate; do not imply unpacking, recycling, or real-molecule equivalence.
- [x] Validate actual inventory result flags, actor, context, decimal fields, bounded records and summary before display; stale results cannot produce intents.
- [x] Accept legal descriptors only: primitive1–3/profile0, primitive4/profile1–15. Save request includes explicit upload/part rent ceilings and existing four resource fields.
- [x] Saving returns WORKFLOW_SAVED and no intent. Explain server-local manifest persistence does not reserve materials/nonce and is not a transaction journal or manufacturing proof.
- [x] Restore only by actor+workflowId. Bind exact immutable identity, descriptor, source/material plan and phase/nonces; ACTION only returns one legal stage intent matching nonce/operation/resources supplied by trusted server.
- [x] Recovery, unverified prefixes, conflicts and blocking decisions retain no usable intent; actual Artifact/seal state is not manufacture success.
- [x] Only verified actual schema1 Root matching workflow output/actor/descriptor and lifecycle0 can fill known-instance asset view; no auto-read/stake.
- [x] Native handoff only fills actor+intent before input events and navigates, no prepare/simulate/connect/sign/send.
- [x] Every field, tab, navigation and config change aborts/invalidate current records and handoffs; generation guards late success/error/finally. Workflow ID text remains recoverable but no longer grants trusted state.
- [x] Text-only rendering and bounded transport; default-disabled controls and configuration failure remain closed.
- [x] Focused request/result, real listener wiring, disabled gates, handoffs, invalid records, actor changes, concurrency and late-response tests pass.
- [x] Root actual localhost layout/gate QA: seventh view, inventory/new-plan form, fixed-workflow restore and default-disabled execution/Root handoffs. Screenshots: `evidence/ui/manufacture-a2-20261025.png`, `manufacture-resume-a2-20261025.png`. Integrated SDK/bridge tests use actual recorded Bank rows; no live wallet/network acceptance.

Implementation evidence: `node --test test/manufacture-operations.test.mjs test/project-operations.test.mjs test/guided-operations.test.mjs test/native-console.test.mjs` passes 42/42 (11 new manufacture tests). `node --check` passes. Source/result variants are event fixtures, not native manufacture proofs or live-wallet acceptance. Seventh-view tests mount actual native→guided→project→manufacture listener order and preserve mutual exclusion of all seven views. Root completed actual default-disabled browser QA; enabled flows remain actual-record/event-fixture acceptance.

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
