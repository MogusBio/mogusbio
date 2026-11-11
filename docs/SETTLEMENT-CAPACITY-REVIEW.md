# ECON3 settlement capacity review

Review date: 2026-10-25. This is a read-only review of the frozen a56a native business implementation and its existing executable evidence. No business source, ABI, issuance, reward formula or material parameter was changed for this review. The finding below is an implementation release blocker, rather than a claim that Solana cannot run the functional verifier.

## Finding: every active Root gates the next global hour

The current `src/settlement.rs` has three linked requirements:

1. `open_hour` accepts only `h == Registry.nextHour`.
2. `materialize` also requires that equality, follows the saved active linked list, and changes `Registry.nextHour = h + 1` only after **all** `Hour.activeCount` Positions have been materialized. Every call writes the same Registry, Hour and Treasury, in addition to its Position and RootReg.
3. An ordinary END event requires `Position.nextUnsettledHour == end`. Thus a Position's unpaid accounting history also gates removal from the active index and the next membership frontier.

Permissionless calls prevent an owner from withholding a signature; they do not remove the mandatory global work or pay the caller's network costs. A holder of many legal primitive components can therefore impose hourly work on every other player without upgrading those components. EMPTY_SKIP cannot help: its proof requires no active ordinary/K member. CLOSE only runs after final materialization.

The material limits really permit the large case. One fixed primitive BOM takes, per species, 500 AA ticks, up to 1000 NUC ticks, 250 lipid ticks and 250 sugar ticks. A standard unit grants 1000 ticks of each species in its class. The balanced lifetime caps are consequently sufficient for:

`min(5,000,000 / 0.5, 10,000,000 / 1, 2,500,000 / 0.25, 2,500,000 / 0.25) = 10,000,000`

distinct simultaneously LIVE primitive Roots. The corresponding first-season caps permit 100,000. All can legally register; there is no protocol active-count admission cap below this amount. Splitting ownership is unnecessary. Inventory prefixes, material conservation and parent/child exclusion remain correct; they do not prevent this workload.

## Quantified bound and source reconciliation

The exact a56a SDK-to-SBF materialization regression used **100,607 execution CU** for one real primitive Position (`evidence/native-sdk-production-conformance.log`). This is a measured representative call, not a proved minimum over all possible pubkeys/bump-search costs. The following table is a capacity model using that measured cost, with **zero** skipped slots, no other traffic, no signature/write-lock/data-loading cost, no OPEN/events/claims, no network latency, and complete ownership of the writable-account quota. Real sustained capacity is lower; none of these figures is a guaranteed admission rate.

The currently published upgrade page reports 200ms slots. The exact Agave4.3.2 runtime used by our Bank acceptance selects 12m writable/30m block at the 200ms stage, then scales both by 100/60 with the 100m-block feature: **20m writable-account CU and 50m block CU per 200ms slot**. Each writable account is charged the transaction's complete cost, so three shared writable accounts do not provide three independent quotas. [Official slot activation](https://solana.com/upgrades/reduced-slot-times), [exact Agave4.3.2 slot parameters](https://github.com/anza-xyz/agave/blob/v4.3.2/runtime/src/slot_params.rs), [cost-tracker account charging](https://github.com/anza-xyz/agave/blob/v4.3.2/cost-model/src/cost_tracker.rs).

| Resource profile | Calls per slot, ignoring non-execution costs | Calls per hour | Wall time for one earned hour with 10m active |
|---|---:|---:|---:|
| Agave4.3.2: 20m account CU /200ms | 198 | 3,564,000 | at least 10,101.2 seconds =2.806 hours |
| Older published 12m account figure /200ms | 119 | 2,142,000 | at least 16,806.8 seconds =4.669 hours |
| Agave4.3.2 pre-slot-reduction: 40m /400ms | 397 | 3,573,000 | at least 10,075.6 seconds =2.799 hours |

The general 100m-block upgrade article still contains an older 12m-account table. It must not be combined with an unscaled 100m/200ms assumption to promise throughput. The table above makes the discrepancy explicit and uses the exact tested client's feature composition for the primary bound. This review does not independently query the target cluster's activated feature accounts. [Older upgrade table](https://solana.com/upgrades/100m-cu-blocks), [SIMD0525 scaling specification](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0525-reduce-slot-times.md).

Under the primary profile, 100,000 active Roots require at least 101.2 seconds of exclusive account quota per reward hour; 1m require 1010.2 seconds. The measured-cost ceiling is 3.564m active Roots, already consuming every relevant account CU. Ten million require about 2.8 times the entire available wall-clock capacity, even before overhead. Equivalently, catching up with 10m/h would require at most **36,000 cost units per Position**, while the current single call executes 100,607 CU. Even the complete 50m block quota, ignoring the shared-account restriction, yields only 8.928m such calls per hour.

Agave also charges signatures, write locks, instruction bytes and loaded account data. Scheduling initially uses the requested CU limit and later updates actual execution usage. Our high 1.4m test budget is not a promise that leaders reserve only 100,607 units. Tight CU requests or batched calls may improve packing but cannot remove the global all-active-per-hour algorithm. [Exact cost model](https://github.com/anza-xyz/agave/blob/v4.3.2/cost-model/src/cost_model.rs).

The full 23,312-transaction Bank replay proves signatures, transport and actual program execution in a sequential local fixture. Its positive-only test Clock is explicitly advanced by the trace. It is not a sustained per-slot cost-tracker contention benchmark and cannot refute this finding.

## SOL funding does not close by itself

At 100k stable active components over 90 days/2160 hours, the present one-MATERIALIZE-per-transaction workflow requires 216m transactions. This matches the first issuance quarter's91 days from seedOpen minus the fixed one-day reward prewarm, if those components are ready at rewardStart; it does not assume they are always issued on the first day. At the independently checked local 5000-lamport/signature fee, that alone is **1080 SOL**. Selling all 200k standard units in that season sends only **20 SOL** in fixed resource fees to Ops. Creation fees are additional, but no rule ensures enough creations, keeper funding or a reimbursement; sales principal belongs to the seller.

Even an unproved ideal batch of 13 calls within 1.4m execution CU would reduce this signature component only to `ceil(216m / 13) * 5000 =83.076925 SOL`, before extra instruction/account costs, message limits, events, OPEN, claims, infrastructure or priority fees. Such a batch is not an already accepted planner. This funding comparison uses local fee assumptions, not a public-network quote. The shared-account computational bottleneck remains with batching.

Players can pay to settle their own debt, but the current list cursor forces them to settle all earlier members too. A claim-less holder's large or zero-rounded positions can therefore make other players fund unrelated work. The existing rules do not contain a lower active-count gate or a funded global keeper guarantee, so an ordinary operational disclaimer is insufficient.

## Minimal next-version repair, without changing economics

The smallest sound direction is to separate **freezing an hour's denominator** from **certifying every Position's debt**:

1. Replay the complete due event frontier, using its actual immutable Position weight and K facts; freeze `Budget_h`, exact total ordinary weight, unique K identity/weight, denominator and eligible Position count in an immutable Hour snapshot. Advance the **freeze** frontier without waiting for per-Position accrual. Global steady-state work becomes hourly snapshots plus actual membership changes.
2. Allow a caller to materialize its own actual Position over already frozen hours, strictly from that Position's next-unsettled cursor. Verify immutable beneficiary, weight and `[start,end)` eligibility from the Position itself. Do not follow today's mutable Directory links to prove historical membership. Preserve the exact `floor(Budget_h * (ordinaryWeight + sameRootK_h) / D_h)` **for every hour**, then sum those floors. A generic reward-index division or separately flooring K is not an equivalent shortcut.
3. Reserve the complete hourly budget in pending/escrow. Each unique Position-hour moves its computed amount to certified debt once. The Hour may count materialized eligible Positions and accumulate actual allocations, but it may seal exact residue and return its original payer's rent **only when completeness is actually proved**. Unmaterialized entitlement must not be silently expired, distributed to another player, approximated as residue or minted again. Unfinished old Hour snapshots remain readable after the freeze frontier advances.
4. Remove the END-event dependence on already materialized history: actual END can subtract membership weight at its fixed boundary while retaining the old Position and beneficiary debt. Keep any historical-coverage lock local to the Root being transferred, restaked or consumed; that owner can settle its own backlog without unrelated Roots. Child consumption must still respect actual ordinary/K end, and old earned debt must survive consumption.
5. Keep existing fixed supply, issuance caps, weights, denominator floor, per-hour halving schedule, same-Root K merge, beneficiary and paid CAS. Use explicit new wire/schema semantics; do not reinterpret the old sequential Hour cursor in place. A predeployment revision needs no invented migration or online admin override.

This repair does not make arbitrary activity free. Event floods, requested-CU packing, account contention for actual token claims, historical snapshot rent and claimant-side long-history costs still need bounds and measured tests. In particular, lazy accrual must not merely hide another all-active scan inside event removal or residue sealing. Its advantage is precise: a member's missing materialization cannot stop the next denominator snapshot or other members' accrual.

Before claiming the blocker fixed, independent tests must show: an unprocessed member A does not prevent freezing h+1 or settling B; an ended/transferred/consumed A keeps the old beneficiary's debt; K changes combine before each floor; arbitrary processing order and duplicates preserve allocation totals; exact old residue waits for completeness; pending+certified+paid+sealed conservation holds; and native/Bank rollback and concurrency work through the production envelope. No such revised implementation is claimed by this audit.

## Subsequent ECON4 module response

The original finding above describes the exact frozen a56a baseline and is retained as its review record. The subsequently approved [ECON4-R1 specification](ECON4-LAZY-SPEC.md) has now been implemented in a distinct local-public-fixture ELF `76b35cfb…c58e`, ABI `8f48f9ea…c87a`. It adds independent freeze-frontier advancement, historical Position lazy accrual, END decoupling and exact delayed residue finalization. Native tests demonstrate the ignored-member and historical-debt cases without injected entitlements; the same candidate executed a40-transaction cold two-F1 trace through actual Kit8-signed v1 Bank transport. Exact evidence is in `programs/biolab-economy/evidence/econ4r1-native-acceptance.json`.

This is actual implementation of the principal all-member gating repair, rather than a disclaimer or a promise to subsidize global work. The same76b candidate has subsequently passed its complete23,653-transaction native cold lifecycle and actual signed Bank replay, executing341 ADVANCE calls and reverse-member lazy accrual while genuinely manufacturing60 parts→15 cells→6 organs→BIO. An explicitly separate historical14 opening fixture also compares actual awarded K sequentially and with interleaved historical lazy accrual: Position/RootReg/Treasury/Mint/Reserve bytes match and the same-root single floor remains856,164 atoms (separate H/K floors would be856,163). Current formal16 opening already knows those candidate designs; the historical fixture is not a claim of current novelty. Exact scoped evidence is `programs/biolab-economy/evidence/econ4r1-integrated-acceptance.json` and `programs/transaction-transport/evidence/full-lifecycle-bank-76b35cfb.json`. Independent security/release review, claimant history, high membership-event rates, shared account contention for real claims and snapshot rent remain genuine gates/costs. Local sequential Bank replay does not measure sustained adversarial slot contention.
