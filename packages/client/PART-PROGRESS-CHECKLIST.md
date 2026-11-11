# A2 immutable part workflow and recovery

Pre-code contract (local implementation only):

- Reuse the frozen F1 BOM, descriptors, actual material planner and native operations. No new mint, payout, source reset, material recovery or nonce reservation.
- Compile a selected canonical material plan without selecting it again. Restore the same artifact, Sources, manufacture nonce, output ID and exact Frames after restart.
- Store only public workflow bytes under the trusted server release/actor namespace using existing safe POSIX FileJournalStore. The content hash and strict context bind the immutable manifest; repeat saves are idempotent, conflicting bytes fail closed. No browser path.
- Inventory planning reads actual known projects/Sources through ReadOnlyRpc. Preflight the frozen plan with prepareMaterialConsumption against current strict actual maps. This is a pure check, never a real token burn.
- One explicit progress read returns at most one current unsigned intent. Check actual nonce, Artifact bytes/seal/sequence and all committed prior-stage durable requests. A different nonce window, unconfirmed old receipt or current pending request requires explicit recovery, never silent renumbering.
- Upload/seal are not manufacture success. Actual Root must match output identity, business, final request hash, descriptor, B/q/retired and actual clock. Exact session confirmation and actual output verification are separate facts. A consumed/transferred output retains history but cannot hand off as an owned active part.
- Read actual new/old Sources after manufacture and require immutable origin plus spent prefixes at least the frozen debits; later legitimate consumption is allowed. Require actual intake burns in Project records; do not demand immutable old token balances.
- Test exact compilation, deterministic content IDs, restart/CAS, tamper/context, actual recorded prefix/account data, one-step recovery, stale materials, nonce conflicts and pending unknown state. Host-derived states remain explicitly labelled. Real wallet/RPC and network costs are separate acceptance gates.


Implemented local acceptance:

- Pure compiler restores exact canonical material plan and all four native stage actions, matching the new signed Bank window nonce6..9 byte-for-byte. Public manifest persists through FileJournalStore; repeat saves preserve its content ID and do not create request journal entries.
- Seven coordinator tests pass against actual purchase/part Bank records plus explicitly HOST-only stale, tampered debit and concurrent Root observations. Six independent bridge tests pass with real protected stores and sessions; first ACTION is one exact upload, pending request requires explicit recovery, unproven prior prefix blocks, actual Root remains distinct from exact108 receipt confirmation.
- Independent source review found and repaired stage action-shape mismatch, stale Root returned under a newer context, missing exact Root debit-plan binding, and cross-read nonce regression. Tests cover all four directly, including first nonce10 → inventory15 → final12 with increasing RPC context slots; production network honesty/finality remains separate acceptance.
- Native signed Bank acceptance executes22 transactions across two cold contexts, including real uploads/seal/manufacture, cap0 and later-instruction rollback, exact108 cache and distinct-lifetime same-Frame retry. This is separate from host fixtures; no native business or economic rule changes.
- Empty/missing original request history is not synthesized from a matching Artifact. Restoring a known manifest without its prior execution evidence may return WAIT_UNVERIFIED_PREFIX; restoring actual output may verify the Root while exact original request status remains unconfirmed.
