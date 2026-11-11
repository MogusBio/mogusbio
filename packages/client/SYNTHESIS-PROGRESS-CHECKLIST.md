# A3 ordinary synthesis persistence and progress

Pre-code contract, 2026-10-25. This module does not add native operations,
economic parameters, implicit signatures or broadcast. It connects existing
ordinary synthesis to actual bounded state reads and explicit browser handoff.

- Freeze canonical702 bytes, immutable input identities/revisions/fingerprints,
  parent Artifact references, challenge, rent/fee ceilings and resource choices.
  Restore without requiring consumed historical inputs to become LIVE again.
- Persist public manifests and bounded local recovery hints in the trusted
  release/actor namespace using protected POSIX FileJournalStore CAS. Content
  ID is context-bound and repeat saves are idempotent; browser cannot give paths.
- Ordinary upload is not a fixed actor nonce window. Select PUT offset/sequence
  from actual prefix, then SEAL, actual prior-generation BEGIN, actual branded
  V4 STEP and fresh FINAL dependencies. Return at most one unsigned action.
- Recognize unresolved current requests before giving another action. Do not
  require author journal proofs for steps genuinely cranked by another actor.
- FINAL proposal remembers its exact public Frame locally, without creating a
  transaction request or reserving a nonce. A later observed actual output and
  original-request execution confirmation are separate facts.
- Detect output from actual consumed direct children pointing to one parent;
  verify exact immutable child fingerprints/revisions, parent/business/time,
  output Artifact/graph/leaf/semantic/evidence and final coherent reread. Later
  valid parent transfer/consumption does not delete its historical creation.
- Preserve actual finished output after the actor's verification PDA has been
  reused by another design. Never manufacture history from nonce advancement.
- Page old-K Position lookup cursors are public local read hints only, bound to
  actual activation/root/Position/count; every selected Position is reverified.
- Test actual ledger/trace bytes, actual native execution separately, explicitly
  hostile host variants, partial-upload interruption, external STEP, pending
  request, restart, concurrent input consumption and output/status distinction.
