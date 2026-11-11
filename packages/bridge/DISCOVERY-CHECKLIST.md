# Discovery bridge checks before implementation

This adds read-only chain discovery to the existing release-pinned bridge. The
OPEN310 same-configuration full lifecycle acceptance is the prerequisite to
implementing this module. No protocol account, material, reward, transaction
permission or nonce rule changes.

- [x] Single action `discovery-read`, exact request fields
  `{actor, section, cursor, query}`. Reject unknown fields before transport or
  cache creation. Wallet sections require an empty query; project searches are
  bounded UTF-8 text and form part of the immutable cursor identity.
- [x] Gateway authorizes the request Actor against the live authenticated
  session. Local operator access retains its existing trusted-local boundary.
  No caller-selected wallet owner, program, domain, config, RPC, filter, prefix,
  filesystem path, data size, request budget or page size is accepted.
- [x] SDK discovery transport is separate from existing `ReadOnlyRpc`; only
  fixed read methods are added there. The release/genesis/endpoint context must
  agree with the strict full-account reader.
- [x] Both server and public action allowlists include only this new read
  operation. The operation cannot create a NativePlayerSession, prepare or
  sign a transaction, reserve a nonce or modify a business workflow.
- [x] Cache location is derived from the existing private release namespace.
  Opaque cursors bind Actor and full release context, section and query. Cursor
  cache has enforced actor/global capacity, expiry and serialized progression.
  Restart/expiry/conflict cannot expose another Actor's page.
- [x] Precise typed/context/account-owner queries use bounded streaming reads,
  deadlines and a per-page scan budget. Small/empty releases do not require
  scanning256 empty partitions before returning. Oversized result partitions
  are split by immutable native record-key prefixes; RPC errors are never
  converted into empty partitions or complete coverage.
- [x] Returned candidates are re-read as full accounts and validated using the
  existing native/PDA/model/mint readers. Position history is selected by its
  immutable beneficiary; transfer or consumption does not erase it.
- [x] Scan responses contain only bounded JSON-safe DTOs, typed read flags,
  observed slot range, coverage state, row count and opaque next cursor. No
  raw accounts, maps, cache paths, private designs, journal contents or provider
  diagnostic strings leave the HTTP boundary.
- [x] No `intent`, `envelope`, transaction bytes, action eligibility assertion,
  balance promise, fixed future income or generic all-wallet completeness is
  derived from discovery. Normal operations re-read their exact dependencies.
- [x] Search applies to candidates throughout the bounded traversal, rather
  than only filtering the displayed page. Empty rows with pending work retain
  a continuation cursor.
- [x] Material ATA discovery remains separate from Source remaining budgets
  and optional non-ATA token hints. No displayed amount is added a second time
  to manufacturing inventory or historical LAB claims.
- [x] Accept actual OPEN310 native terminal records through the real bridge
  HTTP contract, including project lookup, current Root, consumed parents,
  Source residual budgets and historical beneficiary Positions. Keep original
  fixture/account provenance; no ownership or debt patches are relabelled as
  native execution.
- [x] Test unauthorized Actor/context/cursor reuse, wrong section/query,
  malformed/oversized input and provider output, expiry/restart, concurrent
  continuation, all RPC failures and atomic preservation of prior scan state.
- [x] Test the unchanged transaction interfaces and public HTTP authorization
  after the allowlist addition. No deployment, real wallet or real-fund action.

## Implementation and acceptance

All gates above passed locally. The prerequisite is the new67c same-config
23,709-transaction Bank lifecycle, independently signature verified. The bridge
exports only the read-only `discovery-read` operation and the gateway binds its
actor to the live session. Runtime replacement is rejected before fetch/cache.

`test/discovery-bridge.test.mjs` passes6/6 against original native67c terminal
bytes: project discovery and strict reread; LIVE-only Root;61 paid historical
Positions;120 Sources; material ATA and LAB hints; cache replay; bad actors,
contexts and fields; RPC switching; actual gateway HTTP authentication, CSRF
and logout. This HOST read adapter does not establish public RPC indexing.
Evidence: `evidence/discovery-bridge-full-current.log`.

Review found that switching a trusted RPC endpoint could leave a scan cache
bound to the previous provider. Discovery caches now add a SHA256 of the
canonical trusted endpoint below the release directory. Old cursors restart,
fresh scans work, and native transaction/nonce journal namespaces stay fixed.
No permission or on-chain state change is added.

SDK adversarial and UI integration evidence is recorded in their respective
checklists. Final full-suite/source binding and actual browser evidence are
in `evidence/open310-discovery-final-acceptance-20261025.json`. Real provider,
wallet, hosted HTTPS and production admission remain separate requirements.
