# BIOP0R2 instruction construction and pending recovery

`src/native.mjs` and `src/journal.mjs` build and inspect local protocol data. They
do not invoke a wallet, submit a transaction or alter economic rules. The
canonical registry is the exact UTF-8 bytes of
`programs/biolab-economy/operations.p0r2.json`; `loadNativeAbi` requires its
approved SHA256. Reformatting that JSON also changes its identity. A changed
registry requires a newly admitted release, rather than silently using a stale
client ABI.

## Wire boundary

`encodeNativeFrame` and `decodeNativeFrame` use the152-byte public ExactFrame.
The codec field remains1. The release profile is BIOP0R2 and payload schemas
come from the admitted registry. Unknown schemas, nonzero reserved bytes,
unregistered lengths and malformed variable payloads fail locally. `nonce` is a
BigInt u64; its `opId` is `u64LE || zero24`. `nativeRequestHash` is H4 of the
original complete frame bytes. `nativeBusinessKey` is H3 of the domain, actor
and that exact opId. No native private frame is reconstructed for either hash.

`buildNativeInstruction({ release, abi, frame, suffix, dynamicAccounts })`
returns an official Kit instruction with the canonical public prefix8. INIT
uses the two registered write overrides and includes BaseConfig exactly once.
The caller supplies the fixed suffix in registry role order; flags are compiled
from the approved table. Known addresses are derived from the actual release,
frame and canonical PDA seeds. Duplicate accounts, off-curve dynamic signers
and more than64 unique account keys including the program are rejected.

Dynamic suffixes still require a planner using actual account state. Their
ordered roles, ownership, revisions, membership, prior K references, proof
dependencies and token accounts are fully checked by the native program.
The generic builder accepts explicit dynamic flags and addresses; it does not
assert that arbitrary supplied dynamic accounts satisfy those state rules.
`canonicalNativeWalletTable` merges wallet aliases, omits actor and sorts raw
32-byte keys for the project/purchase wallet table. It cannot be used to reorder
ordered Root, Position or verification proof accounts.

Typed payload helpers cover:

| Flow | Export |
| --- | --- |
| Four-class project | `encodeCreateProjectPayload` |
| Material purchase | `encodeBuyMaterialPayload` |
| Part manufacture | `encodeManufacturePartPayload` |
| Ordinary stake/exit | `encodeRegisterOrdinaryPayload`, `encodeExitOrdinaryPayload` |
| Root ownership transfer | `encodeTransferRootPayload` |
| Historical Position claim | `encodeClaimPositionPayload` |
| Artifact upload/seal | `encodeArtifactPutPayload`, `encodeArtifactSealPayload` |
| Staged function verification | `encodeVerifyBeginPayload`, `encodeVerifyStepPayload` |
| Ordinary/competitive synthesis | `encodeSynthFinalizePayload` |
| Emission and hour processing | `encodeSyncEmissionPayload`, `encodeOpenHourPayload`, `encodeApplyEventPayload`, `encodeMaterializeHourPayload`, `encodeCloseFinalHourPayload`, `encodeEmptySkipPayload` |

Quantities, nonce values, payment caps and revisions remain BigInt. Typed
helpers do not accept quality/PASS assertions. For a hard target the sealed
graph determines the fixed2m challenge requirement in native verification;
other targets use the frozen500000..2000000, step1000 lattice. A successful
client encoding says nothing about the biological validation result.

P5 source IDs bind H3 of the future manufacture request. Upload and seal consume
the same actor's business nonce before manufacture. A workflow planner must
therefore calculate the future P5 nonce from the exact remaining operation
sequence before sealing its material plan. It must replan if other actor
requests change that sequence. Neither this builder nor a local journal
reserves an on-chain nonce, and retrying an old frame under a new nonce is not
permitted. The same rule applies when a competition commitment binds a later
manufacture request.

## Pending journal

`decodeActorNonceSnapshot` accepts a finalized RPC account observation only
after checking the requested canonical PDA, account owner, full418-byte
record, kind35/schema1, domain, config, bump and actor key. An absent account,
or an empty System-owned prefunded canonical PDA, represents nonce0. It returns
a privately branded immutable fact; callers cannot supply a plain object as a
recovery proof. The transport must still verify the actual cluster genesis,
RPC response and finalized commitment. Structural decoding cannot prove an RPC
honest.

Create `new PendingJournal({ abi, release, actor })`. Every mutation requires
`expectedRevision`; persistence additionally uses
`persistJournalCAS(journal, store, { expectedStorageRevision })`.
`store.compareAndSwap(expectedRevision, serialized)` must be one actual atomic
operation. A read followed by an unprotected write is insufficient across tabs
or processes. `serialize()` and `PendingJournal.restore(context, serialized)`
preserve exact frames and validate their hashes, schemas, context, nonce facts
and terminal results. Storage integrity checks do not make local storage an
authority over chain balances.

`begin` allows only one unresolved request for an actor. `recordAttempt` stores
a transaction attempt's blockhash/expiry metadata without changing its frame.
`noteUnknown` records transport uncertainty; it does not declare the request
failed or create a replacement business nonce. `retryFrame` returns detached
original bytes. `reconcile` has these outcomes:

| Finalized ActorNonce fact for local nonce n | Decision |
| --- | --- |
| nextNonce == n | `RETRY_SAME_FRAME` |
| nextNonce == n+1 and cached H4 matches | `CONFIRMED`, exact registered cached result |
| nextNonce == n+1 and H4 differs | `NONCE_CONFLICT`, no result |
| nextNonce > n+1 and result was never learned | `ALREADY_PROCESSED`, no reconstructed result |
| Older slot, regressing nonce, or changing cache at the same nonce | Reject observation |

The same finalized slot cannot describe two different account states. Journal
observations are checked globally across its entries, rather than separately
per request. Once a result was confirmed locally, a later cache overwrite
preserves that original confirmation and result with
`resultSource: LOCAL_CONFIRMED_HISTORY`. Fresh recovery from the one-entry
on-chain cache uses `LATEST_NONCE_CACHE`. The implementation never claims that
the program stores arbitrary old full request results.

Replacing an expired transaction's recent blockhash creates a different message
and requires a new actual wallet signature. It must retain the original
instruction frame and business nonce until a finalized observation resolves the
request. A transaction timeout alone is not proof that nothing executed.

## Acceptance and remaining gates

The complete client suite passed33/33 on2026-10-25 using
`node --test packages/client/test/*.test.mjs`. Tests independently lay out frame
and payload offsets; verify original H4, flags and PDA identities; build two
official V1 messages with different blockhashes and identical protocol frames;
exercise timeout/restart, conflicting requests, stale reads, confirmed history,
same-slot facts, local CAS and an atomic external-store racing-tab example.
Existing release/V1/wallet tests use actual signatures and explicit public local
fixtures, with no network write.

The subsequent read-only RPC/account and actual POSIX file-CAS layers are
implemented and described in [RPC.md](RPC.md). The parent P5 workflow also binds
future manufacture nonces after canonical upload/seal operations. The combined
client suite now passes50/50. Still separate: final ABI dynamic-rule freeze;
complete state-based suffix planning for every competitive/safety path; actual
trusted live RPC genesis/finality/deployment verification; target wallet V1
capabilities and exact signatures; production deployment/release validation and
network submission. The instruction carries `productionAdmission: false`; a public
local fixture also carries `localPublicFixture: true`. These fields are honest
local output metadata and are not native certificates or deployment approval.
