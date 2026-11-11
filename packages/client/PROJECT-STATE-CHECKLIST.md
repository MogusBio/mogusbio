# Project record and creation status checks

Checks fixed before implementation:

- Read a known canonical project ID from the pinned release and finalized RPC. Verify BaseConfig and initialized EconConfig, actual Clock, Project and four Classic mints together.
- Validate exact native record identity, catalog, creator/business binding, immutable prices/caps, each canonical mint/authority, decimals0, absent freeze authority and supply bounds. Missing/prefunded empty Project is not a created record; malformed records fail closed.
- A planning hash, advanced nonce, public ID or sealed payload is never an exact creation success. A read proves only the observed Project record and mints.
- Recover an exact request only from its durable session Frame and verified result. Preserve CONFIRMED history; a latest cache overwritten by another nonce does not establish an unobserved old H4.
- Compare the actual record's immutable creator/business/name/seller/classes with the request before associating them. Issue/burn counters may legitimately change after creation.
- Parse the exact208-byte native receipt with the SDK decoder. No new op, mint, signature, send, nonce reservation or write to chain is introduced.
- Preserve the generic session decision and expose exact-request proof separately from project-record verification. No promotion of ALREADY_PROCESSED or NONCE_CONFLICT into confirmed success.
- Test genuine immutable ledger/cold-prefix records plus explicit hostile host-only variants, no live wallet or RPC.
