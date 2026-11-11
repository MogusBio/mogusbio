# Separate signed request recovery

Rules fixed before implementation:

- [x] Recovery reuses the existing native SYNC_EMISSION operation. It does not
  introduce an on-chain cancellation opcode, fee, token or nonce format.
- [x] Primary and cancellation sessions must share actor, ABI, release, domain
  and Config identity, and must use distinct durable journal namespaces.
- [x] Cancellation is a separately prepared and separately wallet-signed Frame
  at the original nonce. The primary Frame and its log remain intact.
- [x] The cancellation helper constructs the fixed SYNC_EMISSION suffix itself;
  the caller cannot supply arbitrary instructions or change the business nonce.
- [x] A matching finalized latest nonce result is the execution fact. A transport
  timeout, pending signature or successful simulation is not confirmation.
- [x] If the original wins, only its result is confirmed; if SYNC wins, only the
  cancellation result is confirmed. Native nonce exclusion prevents both.
- [x] When a later nonce overwrites the latest cache before either result was
  retained, both outcomes remain unknown. Recovery cannot reconstruct history.
- [x] Refresh signs a new blockhash around the same exact cancellation Frame.
  It never changes the primary request, request nonce or native replay rules.
- [x] Actual distinct FileJournalStore acceptance: original win, SYNC win,
  latest-cache overwrite, preserved original Frame and retry after timeout.
- [x] Same namespace, mismatched identities and identical cancellation Frame
  rejected before admitting a competing request.
- [x] A winner appearing between the two finalized reads triggers rereading of
  the earlier pending side. If that RPC is still behind while its peer proves
  a closed nonce, the aggregate status is UNKNOWN rather than open pending.
- [x] Documentation, explicit signature and no-broadcast client scope.
- [x] Independent same-release native Bank race evidence: four real signed v1
  transactions across two original-ledger branches, each winner advances the
  nonce once and the different-H4 loser is rejected; cache matches the winner.

Client tests use injected finalized RPC observations and actual POSIX file CAS.
They never call a real network, wallet or on-chain write.

2026-10-25 independent client acceptance: `test/recovery.test.mjs` passes8/8 in
4934.26025ms. Both actual POSIX FileJournalStores are reopened across outcomes.
The timeout test uses complete real fixture signatures and an injected transport
that loses a response; the refreshed message rejects the old signature and
preserves the exact cancellation Frame and original nonce. The original-win
test also advances the latest nonce cache and confirms that retained original
result42 is not lost. The first interleaved-read test exposed an incorrect
CANCELLATION_PENDING aggregate; the implementation now rereads that side and
the test passes. A second test keeps the original RPC at the older honest
finalized snapshot and confirms the result remains UNKNOWN. Native Bank
nonce-race execution is recorded separately in
`programs/transaction-transport/evidence/recovery-competition-bank-76b35cfb.json`.
