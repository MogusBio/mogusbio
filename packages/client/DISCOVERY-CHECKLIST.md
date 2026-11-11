# Discovery SDK — frozen pre-code contract

Status: SDK implemented after the OPEN310 native-chain PASS. The frozen design
below is followed by completed scoped acceptance results. RPC tests are explicit
HOST adapters over actual signed-Bank terminal bytes, never live-network gPA or
cryptographic completeness proof. No native ABI, biology, issuance, reward,
wallet signing, transaction submission, nonce reservation or manufacture policy
changes belong to this work.

## Frozen minimal API

```js
new DiscoveryRpc({ release, endpoint, fetchImpl, allowLocalhost = false })
new DiscoveryStore({ directory })

DISCOVERY_SECTIONS // frozen array of the seven section strings below
validateDiscoveryRequest({ actor, section, cursor, query })

readDiscoveryPage({
  release, rpc, discoveryRpc, store, actor, section,
  cursor = null, query = ''
})
```

`rpc` is the existing `ReadOnlyRpc`. Both transports must bind the same admitted
release, genesis and trusted endpoint. Keep the existing `ReadOnlyRpc` method
allowlist unchanged. `DiscoveryRpc` only permits genesis and fixed discovery
queries; it accepts no arbitrary method, program ID, offset, filter or endpoint
from an HTTP request. Runtime limits are fixed policy, not browser parameters.

The bridge request is **exactly** `{ actor, section, cursor, query }`; all four
fields are required there. The gateway binds `actor` to the authenticated wallet.
`cursor` is null or an opaque server-generated 64-character lowercase hex token.
The pure exported `validateDiscoveryRequest` accepts exactly these four fields,
validates actor/section/cursor/query without network, filesystem or store access,
and returns the canonical frozen request (including the canonical query below).
The bridge runs its exact-field gate and this validator before opening a cache.
SDK defaults are applied before invoking the same validator.

| section | Scope | query |
| --- | --- | --- |
| `projects` | All actual native projects in this release | Allowed |
| `my-projects` | Project creator equals actor | Allowed |
| `roots` | Current LIVE Root owner equals actor; four schema sublanes | Must be exactly `''` |
| `sources` | Source inventoryOwner equals actor | Must be exactly `''` |
| `positions` | Position beneficiary equals actor | Must be exactly `''` |
| `material-atas` | Global project discovery, then this actor's four class ATAs | Must be exactly `''` |
| `token-owner-hints` | Bounded classic SPL owner result; hints only | Must be exactly `''` |

Project query input is a valid UTF-8 string, at most128 bytes **before** trimming,
with no C0/DEL controls. Its canonical form is NFC plus trim. A project matches
when its NFC/lowercased name contains the lowercased query, its complete64-hex
ID equals the query ignoring hex case, or its creator Base58 address equals the
query exactly. Empty canonical query matches all. Use `toLowerCase`, never a
host-locale case conversion. The canonical query and query version bind the
cursor; changing either requires a new scan. Filtering happens on actual project
records across the whole traversal, not just the eight currently displayed rows.
An empty match page still continues while any candidate/partition remains.

## Response and row contract

The response is JSON-safe; on-chain integers are decimal strings, class/target
are bounded small integers, IDs are lowercase hex and addresses are Base58.
Never return raw accounts, Buffers, Maps, private paths or transport errors.
Only fixed, module-owned public issue codes may leave this boundary. Do not copy
an external `error.code`, `name`, message, cause or stack, even if its code looks
uppercase/allowlisted. Identify locally created errors by a private brand, or map
an external failure to the fixed code for the operation that actually failed.
Public issue codes are limited to `DISCOVERY_RPC_UNAVAILABLE`,
`DISCOVERY_RPC_TIMEOUT`, `DISCOVERY_RPC_OVERFLOW`,
`DISCOVERY_RPC_INVALID_RESPONSE`, `DISCOVERY_GENESIS_MISMATCH`,
`DISCOVERY_BASE_MISMATCH`, `DISCOVERY_RECORD_CHANGED`,
`DISCOVERY_RECORD_INVALID`, `DISCOVERY_CURSOR_INVALID`,
`DISCOVERY_CURSOR_EXPIRED`, `DISCOVERY_CACHE_LIMIT`, `DISCOVERY_DEADLINE`,
`DISCOVERY_TOKEN_OWNER_OVERFLOW`, and `DISCOVERY_INTERNAL`. Request validation
throws only locally created `DISCOVERY_REQUEST_FIELDS`,
`DISCOVERY_REQUEST_ACTOR`, `DISCOVERY_REQUEST_SECTION`,
`DISCOVERY_REQUEST_CURSOR`, or `DISCOVERY_REQUEST_QUERY` errors.

```js
{
  profile: 'BIO-DISCOVERY1',
  decision: 'DISCOVERY_PAGE', // or DISCOVERY_BLOCKED / DISCOVERY_RESTART_REQUIRED
  actor, section,
  context: { releaseHash, abiHash, domainHex, configHex },
  rows: [],                 // maximum8 verified rows, not a local-session list
  nextCursor: null,         // or opaque server token
  coverage: {
    state: 'IN_PROGRESS',   // TRAVERSAL_EXHAUSTED / OVERFLOW / UNAVAILABLE / CHANGED
    commitment: 'finalized',
    consistency: 'MULTI_SLOT_BEST_EFFORT',
    minObservedSlot: null,  // decimal string once observed
    maxObservedSlot: null,
    prefixesVisited: '0',
    pending: true,
    cryptographicComplete: false,
    fullWallet: false
  },
  issues: [],               // bounded [{ code }], stable redacted allowlisted codes
  readFlags: {
    transactionExecuted: false,
    networkSubmitted: false,
    reservesOnChainNonce: false,
    discoveryOnly: true,
    actionEligibilityVerified: false
  }
}
```

Every row adds `recordVerified: true` and its `observedSlot` decimal string.

- PROJECT: `type`, `projectIdHex`, `address`, `name`, `creator`, `seller`,
  `createdAt`, `createdSlot`, and four `classes` with `class`, `mint`, `cap`,
  `unitPriceLamports`, `issued`, `intakeBurned`, `supply`.
- ROOT: `type`, `instanceHex`, `address`, `owner`, `descriptorHex`, `target`
  (null for components), `qualityPpm`, `B`, `retired`, `revision`, `lifecycle`
  (`LIVE`/`CONSUMED`), `parentInstanceHex` (nullable), `registration` with
  `exists`, `ordinaryCount`, `directorySequence`, `certificateFault`. The
  default roots traversal emits verified LIVE rows only; CONSUMED remains a
  decoder/DTO value for explicit known-ID reads and detecting reread changes.
- SOURCE: `type`, `sourceIdHex`, `address`, `owner`, `projectIdHex`, `class`,
  `mint`, `unitCount`, `initialTick`, `spentPrefix`, `remainingTick` (32 decimal
  entries each), `createdAt`, `createdSlot`. Fully spent Sources may remain as
  historical records; `unitCount` is historical intake, never available material.
  Only actual `remainingTick = initialTick - spentPrefix` contributes to an
  independently validated material balance.
- POSITION: `type`, `positionIdHex`, `address`, `instanceHex`, `positionSeq`,
  `beneficiary`, `start`, `end` (nullable), `accrued`, `paid`,
  `nextUnsettledHour`, `rootOwner`, `rootLifecycle`.
- MATERIAL_ATA: `type`, `projectIdHex`, `class`, `mint`, `address`, `owner`,
  `amount`, `manufactureIncluded: false`. Emit actual positive balances only;
  absent/zero ATAs do not finish the traversal.
- CLASSIC_TOKEN_HINT: `type`, `address`, `mint`, `owner`, `amount`,
  `isStandardAta`, `protocolMatch` (`LAB`/`UNRESOLVED`),
  `manufactureIncluded: false`. An unknown mint is not labelled non-protocol.

Selecting discovered IDs still invokes the current strict known-ID inventory,
asset, synthesis or settlement reader before any proposed action. A record's
existence is not proof that an old local request executed, and discovery facts
are never spend, eligibility or claim authority.

## Native filters and candidate validation

The native header is120 bytes: magic0..8, version8..10, kind10..12,
schema12..14, reserved14..16, domain16..48, config48..80, body length80..84,
bump84, reserved85..88 and immutable recordKey88..120.

| lane | Program/type filters | Actor field | Full raw size |
| --- | --- | --- | --- |
| Project / material ATA | native kind9/schema1, header0..80 | creator raw120 for my-projects only | 529..592, variable UTF-8 name |
| Root | four kind12/schema1..4 sublanes, each exact header0..80 plus LIVE raw362==0 | owner raw322 | schema1 variable; schema2/3/4=761 |
| Source | native kind11/schema1, header0..80 | inventoryOwner raw120 | 856 |
| Position | native kind27/schema2, header0..80 | beneficiary raw200 | 375 |

Add a recordKey-prefix memcmp at raw88 when the prefix is nonempty. Source and
Position may use exact dataSize; Project must not use dataSize592, and Root
must not use a fixed dataSize. Keep at most four filters per request. Each Root
schema sublane uses one complete header0..80 memcmp (including kind, schema,
reserved bytes, domain/config), owner at322, LIVE byte at362, and optional ID
prefix at88. Persist which schema sublane is active in the traversal cursor.
Start each of the four sublanes with its own bounded empty-prefix probe; do not
scan all lifecycle states then filter locally. All four Root probes fit the
four-scan-call page budget. A small final wallet with only one LIVE BIO therefore
does not split because its81 consumed ancestor records still exist on chain.

Every memcmp explicitly uses `encoding:'base64'` and canonical base64 bytes;
ordering uses explicit ASCII comparison, not a host locale comparator.
Each native scan is a standard `getProgramAccounts` request to the admitted
native program with `encoding:'base64'`, `commitment:'finalized'`,
`withContext:true`, `dataSlice:{offset:88,length:32}`, fixed filters and a server
minimum context slot. There is no RPC `limit`, `cursor` or offset pagination.
Ordering is not authority; sort validated candidates deterministically locally.

The sliced RPC account's `space` describes its **full** size. Use a separate
strict sliced-account decoder, not the full `decodeRpcAccount` invariant that
space equals returned data length. Require exact32-byte canonical base64 data,
correct owner/non-executable metadata, valid full-size bounds, unique address/ID
and matching requested ID prefix. Reject malformed envelopes or duplicates.

Get full records through existing `ReadOnlyRpc.getMultipleAccounts` (at most100
addresses per call). Derive/cross-check PDAs and decode strict owner, header,
release context, record ID, body, timestamps, Clock and relevant closure. Source
checks its Project and class mint. Project/ATA checks all four mints and their
authorities/supply. Root checks RootReg and directory when present. Position
first reads raw instance at120 and sequence at152, then derives and strictly
decodes its PDA plus RootReg/directory closure. A current Root owner different
from actor does not invalidate actor's historical Position beneficiary rights.

Reread the full relevant closure before emitting rows. Ownership/revision/budget
changes are an explicit CHANGED/retry condition, not stale verified data. In the
roots lane, a candidate consumed after its scan is CHANGED/retry and is never
emitted as a current wallet asset or silently used to claim complete LIVE
coverage. Historical consumption remains accessible through existing known-ID
Root reads and beneficiary Position discovery. No discovery row claims full
biological/original Artifact/synthesis eligibility.

## Bounded traversal and deadlines

- [x] **Start with an empty-prefix small probe**, already narrowed by native
  type/release context and actor where applicable. This has only32 data bytes
  per returned candidate and strict streaming limits; do not fetch full native
  accounts or issue256 empty queries for an empty/small deployment.
- [x] Roots use four schema-specific LIVE-filtered sublanes, at most four small
  initial probes total. Consumed ancestors do not fill the default wallet result
  or trigger overflow partitions. Persist sublane state alongside the DFS stack.
- [x] Maximum scan response64KiB; accept a successful native leaf only with
  fewer than256 rows. At256 or more rows, or an enforced response-size overflow,
  discard that leaf result and split its ID prefix into next-byte children.
  These are simultaneous limits: raising the row cap does not raise the byte
  cap or promise that255 rows fit in64KiB. It allows a normal120-Source player
  to finish the initial ID probe without256 unnecessary child queries.
- [x] Resume deterministic DFS with an O(32)-depth sibling-counter stack,
  rather than materializing an unbounded queue. Prefixes are disjoint; account
  ID is immutable. Full32-byte ID overflow/duplicates fail closed.
- [x] Maximum4 scanning RPC calls per page (`getProgramAccounts` or the one
  token-owner probe), maximum3 actual `getMultipleAccounts` common/closure calls
  plus at most one genesis call. No nested per-row RPC loop or hidden extra calls;
  batch all rows instead of calling `readProjectState` separately for each row.
- [x] Genesis verification is not duplicated by the two transports. The scanner
  reuses verification actually performed by the same-endpoint admitted
  `ReadOnlyRpc`; only trusted SDK code can establish that association, never an
  HTTP boolean/proof object. Verify the returned genesis against this release
  and decode the actual Base against this release. Test the complete page's
  actual fetch count, not just scanner-method counters. If independent scanner
  verification is later retained instead, revise the explicit call budget and
  acceptance cases before implementation rather than hiding a second fetch.
- [x] Total page deadline **18,000ms** including store/RPC/response work, below
  browser `nativeRequest`'s existing20,000ms timeout. Per RPC at most2,000ms and
  never more than remaining deadline. Use a dedicated short-timeout ReadOnlyRpc
  for full reads. Stop scanning by9,000ms to reserve time
  for strict closure reads; a page may perform fewer than four scan calls.
- [x] A fact-read budget/deadline shortfall emits no unverified row. Preserve
  the bounded pending candidates/cursor for continuation. At most one leaf's
  remaining255 sliced candidates plus the previous eight-row response are
  persisted. Do not fetch255 full records in a batch; at most eight selected
  rows and their bounded closure are strictly read per page.
- [x] Empty/unmatched page with pending candidates/partitions has a nextCursor.
  Only exhausted candidates **and** exhausted partitions finish traversal.
- [x] Timeout, HTTP/JSON-RPC error, index exclusion, unsupported method or invalid
  response is never an empty successful leaf and never advances past it.

The limits bound our network response, memory, calls and elapsed time. Standard
RPC exposes no client-selected cap on the validator's internal account scan work.
A provider that disables scans may leave discovery unavailable. A provider that
silently truncates nonstandard results cannot be proven honest by standard RPC.
Neither `TRAVERSAL_EXHAUSTED` nor a small probe is cryptographic completeness.

## Cursor, cache and Actor isolation

- [x] Bind opaque server cursor to admitted context4, program/genesis, endpoint
  identity, actor, section, canonical query, query version and finalized policy.
  HTTP cannot supply traversal state, raw prefix or another author's namespace.
- [x] Protected off-chain CAS cache only, no permanent chain account. TTL30min
  absolute, maximum4 unfinished scans per actor,128 retained scans globally,
  256KiB serialized state per scan; bounded fixed scratch/index allowance, no
  append-only page history. Completed scans do not occupy the actor's active
  quota and are first eligible for global/aggregate-size eviction.
- [x] Keep at most one retained scan per actor/section. An explicit fresh request
  with cursor null replaces that actor/section's old scan (including a changed
  query); its previous cursors require restart. Replacement does not increase
  active quota. Seven sections read normally must not lock an actor merely
  because completed response caches exist, and repeated refresh of one section
  must not fill four active slots or lock the user for30min.
- [x] Reserve quota before creating state. Prune expired state on allocation and
  reads; recover/remove bounded stale scratch/orphan files before new allocation.
  At quota return a stable limit response; never create unchecked files first.
- [x] A single cursor advance wins CAS; concurrent/retried same-page request can
  replay the retained exact previous response. Older cursors explicitly require
  restart, never silently skip a page. A failed fact read must not consume IDs.
- [x] Restart may resume valid cache; expired/lost/evicted cursor returns
  DISCOVERY_RESTART_REQUIRED. Re-scan is the recovery, not permanent accounting.
- [x] Name query/creator/section changes cannot reuse another traversal. Actor
  switch/logout clears UI cursors; server still checks principal independently.
- [x] SDK discovery creates no `NativePlayerSession`, actor nonce/cancellation
  journal or transaction workflow. Public capability summaries expose sections
  and profile only, never private cache paths.

Preferred implementation simplification: use one existing `FileJournalStore`
CAS payload for the bounded scan set, quotas, TTL pruning and page transitions.
Cap the entire serialized payload below its existing16MiB hard limit (the
per-scan256KiB/global128 limits are ceilings, not a promise that every maximum
coexists). Refuse new allocation before exceeding the aggregate cap. This
avoids introducing a multi-file index/atomicity/orphan mechanism. If implemented
this way, treat "state file" above as a per-scan serialized-state budget and
reuse the store's existing bounded atomic scratch-file protection.

## SPL limits and coverage meaning

`getTokenAccountsByOwner(actor,{programId:classicTokenProgram},config)` permits
encoding/dataSlice/commitment/minContextSlot, but no standard cursor or row limit.
Its strict response-size and fewer-than256-row rule is the same as a native leaf.
On successful bounded response, retain only its bounded candidate buffer and
re-read selected full165-byte accounts before reporting any balances. Overflow
returns explicit OVERFLOW; it cannot be repaired by native recordKey partitioning.
Multiple SPL accounts can have identical owner, mint and all data bytes, so no
unique SPL body-ID partition is claimed. No Token2022/NFT/all-wallet coverage.

Material ATA coverage is independent: all-project partition traversal discovers
actual mint IDs and derives actor's canonical ATAs, without a session-known-ID
list or an unbounded global mint dictionary. Non-ATA hints never merge into the
current ATA-based manufacture inventory. Existing manufacture readers decide
usable materials independently when the user selects a bounded project/source
set. LAB hints do not become LAB spend/claim authority.

All pages are finalized observations over a returned slot range, not a historical
single-slot snapshot. Transfers or creation into already-visited prefixes can be
missed until refresh/re-scan. Rows may disappear between discovery and action;
strict action readers remain mandatory. Return both slot endpoints and the
coverage/refresh limitation even when the traversal is exhausted.

## Slice size check and corrected native fixture totals

The complete native construction creates120 Source records, each from one raw
material unit: class totals30/60/15/15. It does not create only four Sources.
The terminal fixture also has82 Roots (81 consumed) and61 beneficiary Positions;
material ATAs are zero after intake, while actual remaining Source ticks total
300000. Discovery tests must assert those separate facts, not sum raw unitCount
as spendable material or turn consumed ancestors into wallet holdings.

The64KiB feasibility calculation uses a genuine public native Source's32-byte
header-ID slice as the data shape,44-character address/owner fields, maximum-u64
lamports/rentEpoch/slot, an API version and normal JSON-RPC context. Canonical
`stringifyJsonWithBigInts` serialization gives285 bytes per keyed sliced row:
120 rows plus envelope =34461 bytes, below65536.255 rows would be73071 bytes
and must still split on the byte cap. This is only a conservative JSON size
calculation with repeated fixture shapes, not newly executed chain accounts or
proof of a live discovery RPC result.

## Implementation and scoped acceptance — completed

- [x] Implement only owned `packages/client/src/discovery*.mjs`, focused client
  tests and this checklist after native-chain approval. Parent owns bridge,
  server/gateway authorization and exports; the state agent owns UI.
- [x] Test actual67c terminal-account bytes with a clearly labelled HOST RPC
  filter/transport fixture; do not label a fixture as actual network gPA proof.
- [x] Verify exact RPC envelopes/filters/offsets/slice/full-space semantics;
  empty deployment and sufficiently small fewer-than256-row responses finish
  the initial probe without256
  queries, unrelated programs/contexts/actors never leak. Verify the actual final
  82-Root fixture (81 consumed, one LIVE BIO): only that BIO is emitted from four
  schema/LIVE-filtered empty-prefix probes, with no unnecessary ID partitioning.
- [x] Assert all120 Source IDs, raw class-unit totals30/60/15/15, separately
  derived300000 remaining ticks,61 beneficiary Positions and zero material ATA
  balances.120 sliced Sources fit one bounded probe; paginate full record reads
  eight at a time without extra prefix subdivision or a255-account fetch.
- [x] Test overflow split, duplicate/deep split, empty pending pages, query match
  beyond the first eight rows, Unicode/128-byte limits, complete ID/creator search,
  query changes, actor changes and cursor tamper/replay/concurrent CAS.
- [x] Test durable resume, expiry, eviction, real global/actor/disk quotas,
  and no unbounded append/all-account/known-session fallback. Reuse unmodified
  FileJournalStore atomic scratch/rename and explicit dead-owner recovery; its
  existing process-crash tests live in `test/file-journal.test.mjs`, with no new
  multi-file cache recovery mechanism introduced by discovery.
  Read all seven sections sequentially without completed-cache quota lockout;
  refresh one section repeatedly without exhausting the actor's active quota;
  old replaced cursors explicitly require restart.
- [x] Test cap/deadline/abort-ignoring transport, malformed/duplicate/truncated
  JSON, RPC errors/timeouts/index exclusion and no error-as-empty behavior.
  Assert real end-to-end fetch counts include genesis and full closure rereads.
  Inject external error codes/messages containing sensitive-looking strings;
  only the fixed module-owned public error/issue allowlists may be returned.
- [x] Test exact full closure and final reread changes: Root transfer/consumption,
  Source spend, project counters/ATA balance, Position beneficiary independent of
  Root transfer, invalid PDA/directory/clock and no stale action authority.
- [x] Test SPL cap success/overflow and arbitrary identical non-ATA data; preserve
  ATA material coverage while token-owner coverage is unknown/overflowed.
- [x] Focused SDK tests, syntax checks and evidence logs. Parent separately
  reports six bridge/HTTP contracts PASS and actual browser directory discovery.
  Final full-suite/browser freeze is parent-owned; no deployment, secret access,
  live RPC qualification or independent external audit occurred in this task.

Implemented aggregate entry: `src/discovery.mjs` exports `DiscoveryRpc`,
`DiscoveryStore`, `readDiscoveryPage`, `DISCOVERY_SECTIONS` and
`validateDiscoveryRequest`. Internal files are `discovery-core.mjs`,
`discovery-rpc.mjs` and `discovery-store.mjs`. Existing RPC, native, economic,
bridge, server and UI sources were not edited by this SDK task.

Acceptance evidence:

- `evidence/discovery-projects-current.log`: first directory layer7/7 PASS.
- `evidence/discovery-wallet-current.log`: first wallet layer6/6 PASS, including
  untouched actual67c terminal bytes and explicitly HOST-only mutations.
- `evidence/discovery-sdk-current.log`: combined focused25/25 PASS (23.1s).
  Three additional targeted hardening cases subsequently PASS without any source
  changes: full32-byte overflow bound, malformed JSON/HTTP/context denial, wrong
  Source PDA/substituted directory. The parent's final suite covers all28 SDK
  cases together (projects7, RPC6, store5, wallet10).
- `evidence/discovery-sdk-fixture-failed.log` preserves the earlier23/24 run:
  a purported self-consistent malicious component fixture was itself invalid
  before SDK invocation. The fixture now constructs a valid CELL-weight record
  that disagrees with its linked Root and is correctly rejected. No production
  rule was relaxed. Earlier RPC/store fixture failures were similarly test
  context/callback issues; the accepted combined run includes those cases.

The cache is a single protected CAS file with an8MiB aggregate payload cap, below
the inherited16MiB store limit. Its constructor-only optional clock injection is
for trusted runtime/tests, never an HTTP request. Endpoint failover isolation is
parent-owned in the bridge's discovery cache directory; transaction journal
namespaces are unchanged. Position records additionally match Root B/quality/
hierarchy, latest RootReg position/end, and historical closed-interval rules.
Clock.slot beyond the actual RPC context is rejected. A restart/error without a
usable scan returns pending:false and nextCursor:null; valid blocked scans keep
their actual continuation. No deployment/network or execution proof is inferred.

Primary RPC specifications consulted:

- https://solana.com/docs/rpc/http/getprogramaccounts
- https://solana.com/docs/rpc/http/gettokenaccountsbyowner
- https://solana.com/docs/rpc/http/getmultipleaccounts
- https://raw.githubusercontent.com/anza-xyz/agave/v3.1.8/rpc/src/rpc.rs

