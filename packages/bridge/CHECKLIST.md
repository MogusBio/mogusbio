# Local HTTP operator bridge — P10.1

Checks fixed before implementation:

- Runtime release, ABI, RPC endpoint, injected fetch, and private canonical state
  root belong to server configuration. Browser requests cannot replace them.
  Import and bridge construction never make a network request or sign anything.
- Dispatch accepts only the eight named actions and exact JSON field sets.
  Decimal u64 values and lower-case hex cross the JSON boundary explicitly;
  actors and all account addresses pass the SDK's native base58 address gate.
- Prepared envelopes are reconstructed with the pinned release and ABI before
  inspection, simulation, refresh, or broadcast. Actor-bearing actions require
  the envelope actor to equal the requested actor.
- Journals use the actual FileJournalStore under fixed release/actor-derived
  directories. Primary and cancellation histories use distinct fixed namespaces;
  browser paths, file names, private keys and replacement endpoints are refused.
- The existing SDK owns nonce, finality, exact-message, signature, bounded RPC,
  journal-before-send and cancellation rules. Only explicit broadcast calls
  NativePlayerSession.broadcastSigned. No retries, timers or economic code.
- Optional CLAIM destination setup remains the SDK's single fixed ATA prelude.
- Public configuration exposes only public release/network identity. Responses
  explicitly serialize bigint as decimal and byte arrays as lower-case hex;
  filesystem paths and keys never enter bridge configuration responses.

Acceptance: actual private FileJournalStore plus bounded finalized mock RPC and
real public fixture signatures; prepare → inspect → simulate → explicit PENDING
broadcast → finalized status/restart; all other actions send nothing; changed
release, actor, packet, resources and unknown fields fail closed; cancellation
keeps both histories; invalid log/path traversal and nonprivate/symlink roots
are refused; public config is JSON safe and excludes private runtime values.
