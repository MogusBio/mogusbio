# BIOP0R2 client wire and pending recovery

Before implementation:

- [x] Read the actual Rust ingress, nonce decoder and ABI table; public prefix8
  differs from native normalized prefix7, including INIT's moved BaseConfig.
- [x] ExactFrame codec field remains1; BIOP0R2 wire profile2 uses registered
  operation schemas and never relabels the old core operation registry.
- [x] Pin the SHA256 of exact ABI bytes against the approved release ABI hash.
- [x] Hash H4 over the original152-byte-header frame, and H3 over domain/actor/
  u64LE nonce plus24 zero bytes. No reconstructed native128-byte frame.
- [x] Timeout/recent-blockhash replacement cannot allocate a new business nonce
  or change any original frame bytes. Native account/state checks remain final.
- [x] Journal CAS and exact finalized ActorNonce snapshots distinguish latest
  replay, conflicting nonce, old unavailable history, gaps and UNKNOWN.

Acceptance to complete:

- [x] Strict frame/ABI/known account-prefix and suffix checks with byte goldens.
- [x] Pending restart/timeout/concurrent CAS/no duplicate result recovery tests.
- [x] Typed payload helpers for material buy/P5/stake/exit/claim/Artifact and
  staged synthesis, matching actual Rust offsets and allowed variants.
- [ ] ABI dynamic account rules cross-check after core freezes its final table.

Acceptance on 2026-10-25: `node --test packages/client/test/*.test.mjs`
passes33/33, including19 wire/journal tests plus the existing material-plan,
release, V1 transaction and actual-signature wallet tests. The original confirmed
result survives newer nonce caches and serialization; the globally observed
nonce and finalized-slot cache facts cannot regress across entries. New
EMPTY_SKIP ABI/schema work is separate and must be added to the approved exact
ABI bytes before a production release is admitted.

Independent gates: correct RPC genesis/finality and account data, actual wallet
capabilities/signatures, deployment identity, simulation and network submission.
These modules build/read local data only. They do not request a wallet, sign,
broadcast, prove an RPC honest, or create cross-process storage atomicity.
Persistent storage must implement the journal's external compare-and-swap
contract atomically; an in-memory revision cannot substitute for that.
