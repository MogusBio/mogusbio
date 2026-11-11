# Read-only RPC, native account readers and persistent pending journals

The API is exported from `src/index.mjs`. It performs explicit reads and
read-only simulation only. It has no send method, wallet prompt or signing
operation. The default RPC object has no transport: callers must inject
`fetchImpl` deliberately before it can request any network data.

## Endpoint and identity

Construct `new ReadOnlyRpc({ endpoint, release, fetchImpl })`. The endpoint is
fixed for that instance and requires HTTPS without user credentials or a URL
fragment. Explicit `allowLocalhost: true` also permits HTTP on exactly
localhost,127.0.0.1 or[::1]. Redirects are rejected. The only JSON-RPC methods
implemented are `getGenesisHash`, `getMultipleAccounts` and
`simulateTransaction`. A provider's software version does not establish V1
support and is never used to claim it.

`verifyGenesis()` compares the actual returned base58 hash's32 raw bytes to the
admitted release GENESIS. All reads verify it before reading account state.
`verifyBaseConfig()` additionally reads the actual canonical PDA and checks
owner, executable flag, native kind1/schema2 header, domain/H2, record key,
header bump, exact1048-byte record and exact928-byte approved body. Mode1 is
required for a production release. Only a release explicitly admitted as the
known public local fixture accepts its corresponding mode0 body.

The application must call `verifyBaseConfig` before acting on other read
results. Raw account/nonce reads remain available independently so initialization
can inspect an absent ActorNonce. Release JSON, a matching response and a client
decoder cannot prove a provider honest or certify the deployed immutable ELF.
The separate loader/build/release gate remains mandatory.

## Reads and limits

`getMultipleAccounts(addresses, { minContextSlot? })` requests finalized base64
accounts only. It rejects duplicate or more than100 keys, mismatched count,
noncanonical base64, unsupported encoding, unsafe metadata, wrong data sizes,
and regressing contexts. RPC JSON integers use the official lossless parser, so
u64 lamports, rent epochs, context slots and nonce facts remain BigInt. The
default streamed-response maximum is8MiB, individual account-data maximum1MiB
and total decoded account-data maximum4MiB; constructor options can lower or
explicitly bound these limits. It checks Content-Length when provided and
counts streamed bytes even when no length was advertised.

An optional `minContextSlot` is BigInt and cannot move below this instance's
highwater. Every contextual read or successful simulation must return a slot at
least that minimum and the current highwater. A stale response that arrives
after a newer concurrent response is rejected. These constraints do not prove
that independent providers serve the same finalized bank.

| Reader | Result |
| --- | --- |
| `getActorNonce(actor, options)` | Branded canonical snapshot for `PendingJournal.reconcile` |
| `getRoot(instance, options)` | `{ contextSlot, account, value }`, actual Root schema1-4 |
| `getProject(id, options)` | Native Project, four class counters/prices and canonical mint PDAs |
| `getSource(id, options)` | Actual consumed Source and remaining per-species ticks |
| `getRegistry(options)` | Actual native kind26/schema2 index and event/Clock highwater |
| `getHour(hour, options)` | Actual native kind18/schema3 or4; explicit lazy flag and original rent payer |
| `getPosition(instance, seq, options)` | Historical kind27/schema2 interval, immutable beneficiary and accrued/paid CAS |
| `getClassicMint(address, decodeOptions, options)` | Exact Classic82-byte initialized Mint |
| `getClassicTokenAccount(address, decodeOptions, options)` | Exact Classic165-byte initialized non-native TokenAccount |

The pure corresponding `decodeNativeBaseConfig`, `decodeNativeRoot`,
`decodeNativeProject`, `decodeNativeSource`, `decodeClassicMint` and
`decodeClassicTokenAccount` functions also accept already fetched actual account
objects. Classic readers reject Token2022/extensions, invalid COption tags,
uninitialized/frozen tokens and mismatched expected addresses, mints or
authorities. The `reserve` token option additionally forbids delegates, delegated
amount and close authority. Mint options can require exact decimals and
mint/freeze authorities, including null. Absent authority payload bytes may
contain historical data, matching Classic Token's native representation.

Root readers mirror the native Root reader's frozen descriptor, identity,
catalog/validator, component BOM, derived leaf/base/retired values, quality
lattice, challenge/evidence versions, lifecycle and stored cost rules. They
retain old consumed Roots and derive the same immutable fingerprint excluding
the121 mutable bytes. They do not rerun function validation or create PASS
certificates. Source ticks and Root scalar fields do not grant write authority.
Rent exemption is checked by the native transaction; a fixed client rent
constant is deliberately not substituted for the live cluster schedule.

## Actual V1 simulation

`simulatePreparedV1(wire, { supportedTransactionVersions: [1], minContextSlot? })`
strictly decodes actual canonical V1 wire. It requires explicit mask31 message
resource values, at most12 signatures, compute1..1400000, loaded-account
bytes1..67108864 and heap32768..262144 in1024-byte steps. It verifies the actual
BaseConfig first, then submits only `simulateTransaction` with base64,
finalized/minContextSlot, `sigVerify: false` and
`replaceRecentBlockhash: true`. An unsupported version or simulation error is
rejected. The original request/frame and input wire are not altered.

The result includes `unitsConsumed`, logs, resource values, context slot and any
replacement blockhash metadata. It always says `simulationOnly: true`,
`transactionExecuted: false` and `signatureVerified: false`. This does not prove
signature validity, future inclusion, account freshness at execution or actual
settlement. A caller declaring version support also cannot make an unsupported
RPC successfully simulate V1; actual provider execution is the compatibility
test, rather than a getVersion string.

## Actual local file CAS

`await FileJournalStore.open({ directory, name? })` provides the adapter for
`persistJournalCAS`. The directory must be an absolute normalized POSIX path on
a trusted local filesystem. Existing symlink path components are rejected; new
directories use0700 and data/owner/temp files use0600. Existing files must be
owned by the current user, regular, single-link and inaccessible to other
users. Windows and filesystems lacking the required semantics are unsupported.
No wallet key is stored.

`load()` returns `{ revision: BigInt, payload: string|null }`. `compareAndSwap`
requires a BigInt storage revision and payload string; it returns the new
storage revision or false on a stale revision. The envelope includes a payload
SHA256 and bounded size. Corrupt bytes, hashes, modes or paths fail closed.
`PendingJournal.restore` must still check the payload's frame/nonce semantics.
The envelope hash detects corruption; it is not an authentication signature.

An atomic lock-directory acquisition excludes competing processes. A separate
short-lived atomic gate serializes lock acquisition and explicit crash recovery,
so recovery cannot accidentally remove a newly acquired lock. Under the lock,
CAS checks the current revision, writes a unique temp file, fsyncs that file,
atomically renames it to the state path, then fsyncs the parent directory before
reporting success. Readers observe either complete prior or complete new state.
`load` itself is a lock-free snapshot and does not reserve its returned revision.

There is no timeout-based lock stealing. `inspectLock()` reports an owner token,
host and PID. After verifying a crashed process, a caller may explicitly invoke
`recoverAbandonedLock({ expectedToken })`; recovery requires the same host and
`kill(pid,0)` returning ESRCH while the acquisition gate is held. A live process,
unknown owner, different token/host or unproven process death is rejected.
PID reuse conservatively prevents recovery. A crash during the short gate
initialization/removal, or malformed lock metadata, requires separate manual
inspection; the adapter never deletes an uncertain gate to resume work.

An error after rename may mean that new state is present despite the caller not
receiving success. Reopen and inspect the durable revision/payload; use the
pending journal's unchanged Frame and finalized nonce reconciliation. Do not
invent a new business nonce after a storage/transport timeout. OS-process crash
tests cover before/after rename; these tests do not simulate hardware power
loss or certify a remote/network filesystem's fsync guarantees.

Acceptance2026-10-25:9 RPC/account tests plus5 real-file tests pass. The full
client suite passes50/50 with parent workflow additions. Transport tests use
injected Response fixtures; storage tests use two actual Node processes and
real process exits/SIGKILL. No live endpoint, private wallet or broadcast was
used.

## ARCHIVE2 terminal history

The single pending file retains its16MiB/10000-entry fail-closed limit. Long
workflows move terminal records to an actual durable archive:

1. `journal.exportTerminal(nonce)` snapshots an exact terminal entry and its
   ABI/domain/H2/actor context. Pending entries cannot be exported.
2. `store.archiveTerminals(exports)` accepts up to1000 entries. ARCHIVE2 writes
   an immutable canonical content-addressed segment and atomically replaces
   bounded1024-nonce index pages. Existing nonce mappings cannot change to a
   different entry. File and directory fsyncs complete before private receipts
   are issued. Caller objects are detached before the first await.
3. `journal.pruneArchived(receipts, { expectedRevision })` validates the actual
   private receipt and exact current entry for every nonce before deleting any
   local retained entry. A bool or serialized receipt cannot authorize pruning.
   Global finalized observations and nonce highwater are never pruned.
4. Persist the smaller journal by the normal external storage CAS. A CAS
   conflict leaves harmless durable archive data and the complete old journal;
   reload it and retry. Receipt creation can be repeated idempotently after a
   restart. It does not require keeping an in-memory brand across crashes.
5. `journal.getArchived(nonce, store)` reopens the actual namespace/page/segment,
   verifies hashes and complete stored Frame/H3/H4/schema/observation semantics,
   and returns the old entry. A confirmed old result is labelled
   `LOCAL_DURABLE_ARCHIVE`; it is not reconstructed from the chain's overwritten
   one-entry cache. Prototype per-record ARCHIVE1 files remain readable.

CONFIRMED, NONCE_CONFLICT and ALREADY_PROCESSED all keep their original terminal
entry bytes, even if a later observation advances the global nonce. The last
state means only that the actor's nonce has passed the request. It cannot prove
that this particular Frame executed, and has no result.
`businessExecutionVerified` and `executionReason` are derived output metadata,
never fields inserted into immutable archived entries. Only CONFIRMED reports
verified execution; ALREADY_PROCESSED reports
`NONCE_ADVANCED_RESULT_UNAVAILABLE_EXECUTION_UNKNOWN`.

`journal.observeFinalized(brandedSnapshot, { expectedRevision })` permits an
empty or terminal-only retained journal to adopt a newer actual finalized nonce,
including another device's requests. It invents no result. It rejects any
unresolved pending entry, which must first use `reconcile` so its original
request cannot be hidden by a new one. Global slot/nonce/cache monotonicity is
identical to reconciliation.

The session compacts at512 retained entries or4MiB and can query pruned results.
Independent23312-record local archive acceptance took39.99s, with a maximum
unpruned batch3,074,609 bytes and a610-byte final pending file. This is genuine
local filesystem capacity, not23312 additional native mining executions.
