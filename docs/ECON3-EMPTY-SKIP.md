# ECON3 EMPTY_SKIP specification (review draft)

Status: design review, no implementation acceptance yet. This is a settlement recovery optimization. It preserves the existing46-epoch `prefix` budget, per-hour flooring, accrued Position liabilities, ordinary/K weights and100-million LAB supply. It does not change biological mathematics or create a new fee/token.

## Wire and authority

- Native acceptance opcode28; production operation1102/schema2/suboperation3. The production adapter must authenticate its normal ExactFrame, Config/Base/Loader and actor permissions before dispatching the existing internal frame.
- Payload24 bytes: `expectedNextHour:u64 || targetExclusive:u64 || maxRent:u64`, little-endian. No caller budget, weight, event sequence, PASS or reward amount.
- Successful return24 bytes: `from:u64 || to:u64 || sealedAtoms:u64`.
- Any signed actor may crank. Use the ordinary latest ActorNonce exact-request cache; older nonces remain already processed and cannot execute again. Only nonce-account rent may be required. No Hour or extra receipt is allocated.
- Normalized account order: existing seven-account prefix; LAB mint R@7, reserve R@8, reserve authority R@9, Treasury W@10, Registry W@11, canonical Hour(from) R@12, canonical Event(eventCursor) R@13. Exactly14 accounts. Registry must already exist; existing SYNC can initialize an unused Registry.

## Proof that the range is empty

1. Read actual Clock, Config rewardStart, canonical Registry/header and validated ordered-event index. Enforce Registry Clock high-water with `observe`; require `expectedNextHour == Registry.nextHour`.
2. Require `from < to <= completed(actualClock,rewardStart) <= H_END`. `to` is exclusive: skipping up to an event due at `to` does not process or cross that event. A due event at `from` prevents any positive skip.
3. Require actual `activeCount == 0` and actual `Kweight == 0`. The existing index decoder must also establish empty list head/tail and ordinary weight0, plus zero K identity fields. Client-supplied omitted Roots cannot satisfy this check.
4. Require the exact canonical Hour PDA for `from` to be System-owned, data-empty and nonexecutable. An already OPEN/READY/PARTIAL/FINAL Hour at the cursor is rejected by this operation. An empty READY Hour must first finish through ordinary MATERIALIZE; this operation does not silently discard it.
5. Read cursor/count only from the trusted Registry. Require the exact Event(cursor) PDA even when the queue is exhausted. If cursor<count, decode that actual program-owned immutable event, matching sequence/header/identity, and require `event.due >= to`. If cursor==count, require that canonical Event account to be System-owned, empty and nonexecutable; unsolicited positive lamports do not make an empty System account occupied. Wrong, missing or substituted event accounts fail. The ordered enqueue invariant makes this one frontier event a proof that no later event lies inside `[from,to)`. A zero-length START/END pair at the cursor must both pass normal queue processing before skipping beyond that boundary; client history omissions or RPC failures never prove an empty interval.

## Exact book transition

Read actual Classic mint/reserve and Treasury through `read_book`, retaining its supply/reserve/conservation checks. First call existing `sync_book` to classify all completed-hour budget from U into U_pending. Then compute only:

`sealedAtoms = prefix(to) - prefix(from)`

`U_pending -= sealedAtoms; V += sealedAtoms; Registry.nextHour = to`.

Write Treasury and Registry only after all gates, arithmetic and signed maxRent checks pass. Preserve every other field, including book accrued/paid/burn counters, reserve token amount, mint supply, Registry eventCursor/count/root count and active/K records. There is no token CPI. In particular, claims accrued before the idle period stay attached to their immutable beneficiary Positions. `prefix(H_END) = N-17` stays unchanged; the17-atom truncation remainder is already sealed in V at genesis and must not be allocated or counted again by this operation.

## Replay, concurrency and failure

- The same exact latest actor nonce/request returns the framework's cached24-byte result, without reclassifying money. Older processed nonces are rejected; no permanent result account is introduced.
- A new request using an old `expectedNextHour` fails CAS. Two actors racing the same cursor cannot both advance it; normal writable-account serialization and the equality check select one.
- Regressing Clock, future/incomplete target, target beyond H_END, zero/reversed range, nonempty live/K state, an already opened Hour or a missing/wrong/premature event fails without state changes.
- If a subsequent instruction in the same native transaction fails, Treasury classification, Registry cursor/high-water and actor nonce/result all roll back. No materials or rewards are minted on either path.

## Required executable acceptance

1. Compare empty per-hour OPEN/MATERIALIZE totals with one skip over the same interval, including epoch boundaries and several cross-epoch slices. Verify exact V, U/U_pending and unchanged mint/reserve.
2. Pending START at due D: skip to D succeeds; crossing D fails; process event through the existing queue then observe activeCount>0 and reject further skip. Exercise pending K activation and K-only active rejection as actual queue transitions where feasible.
3. An already OPEN empty Hour rejects; its ordinary finalization followed by a skip succeeds. Wrong canonical Hour, next Event omission, fake empty frontier Event and forged sequence/due all reject.
4. Two separately signed actors race the same expected cursor; one succeeds, the other fails without mutation. Exact nonce replay returns the same result; a changed payload conflicts. Test valid skip followed by a deliberate failing instruction and compare all accounts before/after.
5. Long idle across all46 epochs and H_END: bounded arithmetic work independent of elapsed hours, exact `prefix` sums, no future range, no terminal17 sweep, no repeated classification. Include an existing real unpaid historical Position and prove its debt/claim remains usable.
6. Build the full SBF ELF without stack warnings; run native regression and production-envelope schema/packet/budget tests. Record actual CU/heap and bind the new source/ABI/ELF identity. The prior7fa cold/Bank evidence is historical for that exact ELF and cannot be relabelled as acceptance of this new opcode.
