# A4 private research manifest and idempotent request store

Pre-code scope: a private frozen BIO competition plan and bounded local recovery
records. No chain request journal, nonce reservation, signature, broadcast,
physical PASS, reward authority or new economic rule is created.

- [x] Reuse canonical synthesis manifest restore; require author BIO/challenge2m,
  distinct on-curve cranker, exact duplicated caps/resources, explicit captured
  expectedGeneration, round/commitNonce and private32-byte salt.
- [x] Rebuild branded delegated workflow. Freeze exact COMMIT Frame, commitment,
  future author FINAL nonce n+chunkCount+3 and all private design/context bytes.
  Restore without requiring consumed inputs LIVE and never silently renumber.
- [x] Before actual confirmed COMMIT, public metadata is an explicit allowlist
  of IDs/roles/window/caps/resources. No salt, private design, graph/Artifact SHA,
  payload or direct IDs. Explicit reveal may include synthesis public metadata,
  never the salt. Salt appears on chain only in the later exact189-byte FINAL.
- [x] Persist private files with existing safe POSIX FileJournalStore600 files
  and700 directories. Parsing/build/filesystem failures expose stable codes,
  never private source text, salt, causes or provider error payloads.
- [x] Private hint stores only one exact competition FINAL Frame at the frozen
  future nonce, binding mode1, commitId/salt/Artifact/generation and signed caps.
  A remembered Frame is not evidence of submission or execution.
- [x] A separate protected position lookup record stores only bounded public
  activation/root/position IDs, count and cursor. It preserves private FINAL
  hints, salt and manifest bytes and accepts strict canonical decimal cursors.
- [x] createRequest binds public requestId and canonical requestDigest to the
  first CAS-winning private manifest. Retry returns it before calling build,
  even after observed author state changes. Different digest fails closed.
- [x] Build may run concurrently but losing results remain only in memory and
  are discarded. Save workflow index only after request CAS; retry repairs an
  interrupted index write from the protected winning request record.
- [x] Tests cover private/public separation, exact window/Frame/caps, immutable
  restore, canonical tampering/context, retry/restart/concurrent first winner,
  digest conflicts, interrupted-index repair, file modes and error redaction.

Accepted locally: manifest + progress tests pass 20/20; manifest contributes
8 focused cases. Source and test `node --check` pass. Evidence is
`evidence/research-progress-current.log`. Fixtures are explicitly HOST lifecycle
restorations of recorded public inputs; this helper performs no real RPC,
signature, simulation or send.

The coordinator must still read the actual prior generation, round, author
nonce and confirmed native COMMIT before disclosure. A manifest ID freezes the
captured generation; creating a different coherent manifest ID is not proof
that its generation was ever observed. Request CAS preserves the original
captured plan across retries. Recovery must reread real native accounts and the
existing request journal; private hints alone establish no execution result.
