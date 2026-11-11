# Bounded global settlement / delegated verification service

This is a local operator process, not a public endpoint or permission to deploy.
It imports no key, seed, wallet file or hidden signer. Default `sendEnabled:false`
does actual read/planning only. Missing RPC, signer, funds, fee quote or rent quote
returns WAIT and does not submit. Do not point a public-fixture release at a public
network; the fixture boundary is enforced again by the existing native session.

`node apps/service/main.mjs tick --config /absolute/service.json`

`node apps/service/main.mjs run --config /absolute/service.json --ticks 100 --duration-ms 300000`

`status` reads the private CAS snapshot without taking the process lease. Its
operator output includes configured public actor/lane identities and must not be
published directly; use the aggregate callback below for public status. This CLI
starts no HTTP server. `STOP` in stateDirectory or
SIGINT/SIGTERM stops before subsequent signing/submission; an in-flight RPC may
take its bounded15-second timeout. Remove STOP and restart explicitly to resume.

The0600 config is `{releaseFile,localPublicFixture,service}`. `service` fields:

```json
{
  "version":"BIOLAB-SERVICE1",
  "releaseHash":"<exact release hash>",
  "abiHash":"<exact ABI hash>",
  "domainHex":"<exact domain>",
  "configHex":"<exact BaseConfig ID>",
  "stateDirectory":"/absolute/private-service-state",
  "endpoint":null,
  "sendEnabled":false,
  "globalActor":null,
  "researchJobs":[],
  "maxRent":"10000000",
  "resources":{"computeUnitLimit":1400000,"loadedAccountsDataSizeLimit":67108864,"heapSize":262144,"priorityFeeLamports":"0"},
  "limits":{"stepFee":"10000","stepRent":"10000000","stepTotal":"10010000","dayFee":"100000","dayRent":"100000000","dayTotal":"100100000","lifetimeFee":"1000000","lifetimeRent":"1000000000","lifetimeTotal":"1001000000","minimumBalance":"10000000","maxRefreshes":2,"maxQuoteAgeSlots":8},
  "poll":{"minMs":1000,"maxMs":30000,"maxTicks":100,"maxDurationMs":300000}
}
```

These example limits are policy choices, not network/rent quotes or required
funding. Replace placeholders only with an admitted release. Operational sendEnabled, poll timing and endpoint may change across an explicit
restart; they do not reset the pinned release/genesis, journals or charges. Status
reports the last started process mode, not an edited file that has not restarted.
Actor/job/resource/budget changes fail closed against existing immutable state and
require a reviewed migration; never delete journals or charged totals to bypass caps.

A global actor permits only SYNC_EMISSION, OPEN_HOUR, APPLY_EVENT, EMPTY_SKIP,
ADVANCE_FROZEN_HOUR and empty-Hour MATERIALIZE_HOUR. It never opens player positions,
claims, transfers, closes someone else's Hour, manufactures, spends LAB or runs
Ops payouts. Each explicitly delegated research job has exactly:
`{name,author,cranker,workflowId,manifestDirectory,authorJournalDirectory,delegated:true}`.
The accepted private workflow must name that cranker. Service actors are distinct
from all job authors and each other. Only VERIFY_STEP is signed; COMMIT, upload,
BEGIN and FINAL remain author operations. No private graph or salt enters health.

For sending, explicitly enable sending and provide `--adapter /absolute/adapter.mjs`.
The trusted local module exports `createServiceAdapters({release,abi})` returning
`{signer}`; signer is `{actors:[publicAddress],signOnly:true,signEnvelope(envelope,
{actor,role,requestId,signal})}`. It must sign only the exact envelope, support stable
message-SHA idempotency and never broadcast. An HSM or external wallet service can
own secrets; do not put them in config, CLI arguments, files committed here or logs.
No adapter is discovered automatically. Tests inject known public local fixture
signatures only. Optional trusted `fetchImpl`/`quoteAdapter` injections support
offline testing; normal execution uses the built-in strict RPC quote adapter.

Before signing, the exact envelope is reconstructed, simulated, and quoted through
actual getFeeForMessage plus getMinimumBalanceForRentExemption and actual account
balances. Nonce418B, newly initialized Registry376B and newly opened Hour482B rent
top-ups are counted where relevant. Empty skip/step/advance do not invent new Hour
rent. Unavailable V1 fee quotes stop submission rather than guessing. A quote is a
snapshot, never a promise that funds remain sufficient.

Step/day/lifetime fee, rent and total limits plus minimum retained balance are
checked before signing. Permanent reservations charge a conservative upper amount
before the external signer is called. Failed/unknown attempts keep those charges;
they are deliberately not described as proved actual spending or refunds. Actual
out-of-band wallet activity is outside this service budget and affects later
balance checks. UTC host day budgets persist; lifetime caps always persist.

Crash/recovery:

- Existing native session journals and archives keep original Frame, nonce,
  signatures-attempt metadata and confirmed results. Service receipts preserve
  quote/reservation records. Keep the whole private state directory backed up.
- A pending/unknown packet with a live blockhash is only reconciled, never
  repeatedly resigned or sent. The same Frame may refresh only after finalized
  height exceeds its last-valid height AND the blockhash is invalid. Refresh count
  and spending budgets remain bounded. No new nonce replaces an unresolved Frame.
- Interrupted SIGNING remains WAIT_SIGNING_RECOVERY. First reconcile the external
  sign-only adapter. `resume-signing --lane NAME --config ...` explicitly authorizes
  retry of an unsubmitted envelope; existing native attempts prohibit that reset.
- Competing cancellation is never automatically prepared/signed. An operator may
  use the existing separate native cancellation session at the service actor's
  `cancellation.json`; service reconciliation preserves which exact Frame won.
  A confirmed cancellation pauses that lane. After review, `resume-cancelled --lane
  NAME --config ...` explicitly resumes fresh planning. Conflict/overwritten-cache
  results are not reported as successful original work.
- A crashed lease is not stolen by age. Read `service-lease.json` through the CAS
  file envelope; after proving the recorded local PID is dead, use `recover-lease
  --token TOKEN --config ...`. A live/reused PID or foreign host blocks recovery.
  FileJournalStore gate crashes require its existing manual inspection procedure.

This module still needs actual configured RPC V1 quoting/simulation, funded
service actors, a reviewed external signer, monitoring/backups and any future
production admission. No production network, real funding or public process was
started as part of local implementation. Local fake transport tests do not prove
real network costs, throughput or an external signer's operational security.

Initial acceptance:39 tests passed (17 service tests plus22 existing native
session, recovery, journal and keeper tests), preserved in
`evidence/service-supervisor-current.log`. The structured historical CLI evidence is
`evidence/service-cli-host-current.json`, generated by explicit offline harness
`node test/service-cli-evidence.mjs /absolute/evidence.json`. The plan loop performs
3 ticks with0 signatures/submissions. Its HOST controlled-send loop performs3 ticks
with1 public-fixture signature and1 fake submission, then waits on the same nonce.
The adapter/transport/fee/finality replies are HOST-only, never public network
execution or evidence of real costs.

Current process-health acceptance is recorded separately without replacing that
history: `evidence/service-health-current-2026-10-25.log` passes44/44 (17 service,
5 health,22 core), and `evidence/service-health-final-2026-10-25.log` passes6/6
(5 health plus the CLI completion/status test) after the final snapshot fix. The
6 checks overlap the44; they are not50 unique tests. The historical CLI JSON has
the former `stopped:false` field and does not prove current health; its two
3-tick scenarios still prove0/0 plan signatures/submissions and1/1 HOST fake
signatures/submissions, with0 confirmations in each. CLI completion now refreshes
its snapshot after releasing the lease and reports STOPPED, as the final test
checks. Its HOST5000-lamport fee/rent0 are conservative fake-transport charges.

Health exposes automaticSubmissionEnabled and signerSendForbidden independently.
Only the supervisor may submit after its own gates; the injected signer must never
submit. Stop/run deadlines abort the wrapped RPC transport and external adapter
waits; each signer/quote call also has a15-second bound. Author sessions retain
readTerminal archive reads while CAS and archive writes are forbidden.

Read-only process observation distinguishes `RUNNING`, `STOPPED`, `OWNER_DEAD`
and `UNKNOWN`. RUNNING requires a stable held lease, a live same-host PID and a
persisted recent tick/heartbeat; PID existence by itself is insufficient. The
freshness bound is max(30 seconds, three poll.maxMs intervals plus15 seconds).
Opening a supervisor resets tick time, so it stays UNKNOWN until its first tick.
Released/missing leases are STOPPED; proven dead local owners are OWNER_DEAD;
foreign owners, stale/future/missing timestamps or unreadable leases are UNKNOWN.
STOP and stop() are persisted. A stalled long-running tick can become UNKNOWN
even when its process exists. Status never creates journals or recovers leases.

For optional public GET status, inject only an existing read-only callback:
`publicServiceHealth(() => readServiceHealth({release,abi,config}))`, imported from
`apps/service/public-health.mjs`. This returns only configured/processState/mode,
ticks/confirmed, global backlog, fixed-category lane counts and current quote/
budget blocker counts. Unknown/unavailable scalar counters use null; zero values
in the fixed state-count template do not prove an observed healthy process. Role addresses,
job names, workflow IDs, paths, salts, lease tokens/PIDs, pending packets and
errors are discarded. Provider errors return UNKNOWN without their error text.
Do not expose the operator raw health object or add HTTP stop/sign/recovery APIs.
