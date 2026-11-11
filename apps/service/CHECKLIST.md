# Bounded service supervisor: pre-code contract

Fixed2026-10-25. Independent local service files only. No deployment, public
listener, production secrets, native/ABI/economics or shared server edits.

- [x] Pin release/ABI/domain/config, actor namespaces, bounded run/resources,
  explicit job delegation, allowed operations and persistent spending limits.
- [x] Global lane uses the accepted actual-book keeper planner. Research lanes
  accept explicitly named manifests and VERIFY_STEP only, never author FINAL,
  claim, transfer, manufacturing, token spend or arbitrary instruction input.
- [x] External signer is injected, restricted to named public actors and sign-only;
  no private key/seed loading or automatic adapter discovery. Missing signer,
  network, balance or exact fee/rent quote stops at read/plan/WAIT.
- [x] Private fsynced CAS state, single-instance fenced lease and existing native
  sessions retain original Frame/nonce and permanent request receipts. Crash
  recovery never substitutes a different pending operation or silently bumps nonce.
- [x] Prepare/inspect/simulate/quote/sign/send/reconcile exact envelopes. A live
  pending blockhash only reconciles; expiry must be proved at finalized height
  before bounded same-Frame refresh. Unknown outcomes and cancellation races stay
  explicit. Interrupted signing requires explicit operator recovery.
- [x] Actual message fee and rent RPC quotes are bound to message/context. Enforce
  step/day/lifetime fee/rent/total limits and minimum retained SOL balance before
  signing/sending. Persist conservative charges before signer invocation; never
  label an upper reservation as proved actual expenditure or funds sufficient.
- [x] Bounded ticks/duration/backoff, stop file and SIGTERM; no hidden infinite
  retry. Operator health contains allowlisted counters/codes and configured public
  lane identities; only the separate aggregate projection is suitable for public
  status. Neither exposes credentials, packets, design, salt or adapter errors.
- [x] Offline tests use genuine saved records with explicit HOST-only transport,
  quotes and public-fixture signatures. Cover missing config/quotes/signer,
  spending caps, pending restart, expiry, crash gaps, lease/CAS and stop behavior.

CLI/runbook must identify remaining external signer/RPC/funding/production gates;
the local service is not permission to launch or spend real funds.

Initial acceptance:17 focused service tests and22 existing session/recovery/
file-journal/keeper regressions passed39/39. Preserved evidence:
`evidence/service-supervisor-current.log`, plus structured explicit CLI plan/HOST
loop evidence `evidence/service-cli-host-current.json`. The genuine account source
is current76b checkpoint SHA
`6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe`.
All transport replies, fee/rent examples, signatures, cancellation and confirmation
changes in these new tests are explicitly HOST-only local fixtures. No new SBF
execution, public service, real signer or production funding is claimed.

The author wrapper delegates current native archive reads (readTerminal) and lock
inspection while rejecting CAS/archive writes. Runtime mode is explicitly public
through automaticSubmissionEnabled; signerSendForbidden is separate. Mode/poll/
endpoint changes preserve charged totals and native pending journals on restart;
actor/job/resource/budget binding remains immutable.

A confirmed external cancellation pauses its lane until explicit operator resume.
In-flight signer/RPC stop and deadline aborts, unavailable quotes, stage interruption,
expired same-Frame refresh and lease recovery were exercised locally. Reservations
are conservative upper charges; no actual expenditure/funds-sufficiency promise.

## Read-only process observation: pre-code contract

- [x] Persist tick-start time, heartbeat time and explicit stop state; restarting
  clears the previous stop state without resetting charges or pending requests.
- [x] RUNNING requires an unchanged held lease, a proven live same-host PID and
  a recent persisted heartbeat/tick. Released/missing lease is STOPPED; a proven
  dead same-host owner is OWNER_DEAD; stale, foreign or ambiguous state is UNKNOWN.
- [x] Status reads never create state directories, acquire/recover/release leases,
  modify logs or contact a signer/network. Missing/corrupt observations fail closed.
- [x] A separate public projection exposes only aggregate allowlisted counters,
  mode and process state. No roles, addresses, job names, workflow IDs, paths,
  tokens, salt, pending packets or arbitrary strings leave that projection.
- [x] Exercise missing, live, dead, foreign, stale, released and explicit-stop
  observations plus privacy filtering with HOST-only records and temporary files.

Acceptance:5 new health tests plus17 service tests and22 existing session,
recovery, file-journal and keeper regressions pass44/44. After changing the CLI
completion snapshot to STOPPED, its test plus all5 health tests pass6/6 again.
Syntax and whitespace checks pass. No public listener, signer/RPC invocation by
status reads, lease takeover or production transaction was introduced.

Saved health evidence (new files; previous evidence is preserved):

| File | Actual result |
| --- | --- |
| `evidence/service-health-current-2026-10-25.log` |44/44,0 failed:17 service +5 health +22 core regressions |
| `evidence/service-health-final-2026-10-25.log` |6/6,0 failed after the final CLI snapshot change:5 health +1 CLI test |
| `evidence/service-cli-host-current.json` |2 historical CLI scenarios,3 ticks each; plan0 sign/0 send, HOST send1 sign/1 fake send;0 confirmed in both |

The6 final checks overlap the44 tests; they are not50 distinct tests. The CLI JSON
predates process observation and preserves its old `stopped:false` snapshot. It
proves only those HOST loop counts, not current health. The final6-test log proves
that CLI completion and subsequent status now report STOPPED. HOST fee5000 and
rent0 in that JSON are conservative fake-transport charges, not actual spending.
