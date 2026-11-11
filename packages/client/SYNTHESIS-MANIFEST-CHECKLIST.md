# A3 immutable synthesis manifest and bounded hints

Pre-code contract: store public ordinary synthesis design bytes, never chain
authority, secret salt, a confirmed request, PASS or a fabricated output ID.

- [x] Freeze strict release/ABI/domain/config/actor, canonical702 bytes and graph,
  exact direct IDs/revisions/fingerprints/creation facts, parent Artifact IDs,
  challenge lattice, fee/rent ceilings and explicit v1 resources.
- [x] Create from actual decoded direct accounts and existing plan; restore
  canonical plan without rereading or requiring current children LIVE. Rebuild
  Artifact/graph SHA/PDA/direct/parent addresses and actual fixed leaf-based fee.
- [x] Content-hash identity and exact canonical encoding bind all frozen fields.
  No nonce prediction or fixed STEP count. No source-union success assumption.
- [x] Protected FileJournalStore per workflow persists immutable text;
  idempotent save/restart/load, no browser path or request-journal mutation.
- [x] A separate bounded hint record contains only latest ordinary FINAL Frame
  and one strict position-lookup cursor. It is never execution or state proof.
- [x] FINAL hint binds exact ordinary124 payload, actor/domain/config/Artifact
  reference and frozen fee/rent ceilings. Nonces never decrease; same nonce may
  only retain the same exact Frame. No append-only attempt history.
- [x] Cursor update retains concurrent latest FINAL Frame; FINAL update retains
  cursor. CAS races cannot silently overwrite the other field. Missing hints
  read as null; malformed records/contexts/cursors fail closed.
- [x] Focused tests cover canonical bytes/context/tampering, restart/idempotency,
  frozen payload restoration after input lifecycle changes, exact native FINAL
  frames, monotone attempt state, bounded cursor validation and CAS preservation.

No native operation, signatures, wallet, live RPC, economic rule or deployment
change is part of this module.


Implemented API: createSynthesisManifest / restoreSynthesisManifest /
publicSynthesisWorkflow / SynthesisWorkflowStore. All frozen creation metadata
comes from planSynthesisPayload rechecking copied actual direct accounts. Restore
rebuilds the same canonical payload/PDA/plan without current input reads; native
verification and FINAL still independently establish actual correctness.

Focused manifest suite7/7 passed, combined inputs+manifest16/16 passed; syntax
checks passed. Tests use genuine76b historical records with explicitly HOST-only
restored LIVE inputs. No new native execution/PASS is claimed. Tests cover all
three hierarchy levels, exact fees/caps, canonical top-level/nested field order,
context/tampering, restarts, real protected FileJournalStore, bounded latest FINAL
and strict lookup cursors, monotone/same-nonce attempt identity, and concurrent
hint updates preserving the other field. Lock contention surfaces the existing
FILE_CAS_GATE_BUSY/LOCK_BUSY for explicit retry; it does not overwrite state.

Manifest and hint records contain no private keys or secret salt. Hints are
local convenience only; a remembered Frame is not a submitted or executed
request, and a remembered lookup is not an authenticated Task/K/Position record.
