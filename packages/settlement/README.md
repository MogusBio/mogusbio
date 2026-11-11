# Settlement kernel

Executable Node ESM reference implementation of exact LAB reward arithmetic and ECON4 lazy accrual. Run acceptance tests from the repository root:

The current native index is [ECON4-R1](../../docs/ECON4-LAZY-SPEC.md), extending the
[ECON-SETTLE3 ordered event index](../../docs/ECON-SETTLE3.md).
`src/event-index.mjs` differentially checks its ordered event queue and active
Root membership against this economic reference. Its `observe` API requires
every business transition from fresh genesis; it rejects skipped END/START or
already closed historical import. Recovery restores an ECON3 checkpoint's exact
stored event sequence. It does not reconstruct tied events by sorting final
intervals. Native15-test evidence additionally covers ephemeral global Hour
rent returned to the saved original opener, while old Position debt remains.

```sh
node --test biolab/packages/settlement/test/*.test.mjs
```

This package has no third-party runtime dependency. `wire.mjs` reuses the sibling protocol-core byte codec. All money, hours, counters and weights are BigInt; q/B are never floating-point estimates. Source code is modular so the checked integer algorithms can be ported to Rust.

## What is implemented

- Exact 100,000,000 LAB / six decimals, 46 nonzero epochs, 35,040 hours per epoch, 17 permanently sealed genesis atoms; fixed at most 46-term prefix sync.
- Independent finished-root staking, future full-hour start/end, unique lifetime root directory, one-way consumption, transfer lock, finite historical coverage and old-beneficiary debt preservation.
- Ordinary and trusted first-discovery K weights; one combined per-root hourly floor, immutable frozen hourly denominators, independent historical Position accrual, amortized ordinary/K historical cursors.
- `advanceFrozenHour` separates global progress from unpaid historical allocations. END removes only future weight. Old pending budgets remain intact until every frozen member has accrued; only then is the exact residual sealed.
- ECON-SETTLE2 interval `accrued/paid/nextUnsettledHour`, cumulative claims with paid compare-and-swap and signed upper limit, one actor nonce checkpoint instead of permanent per-action Business/Receipt storage.
- Atomic in-memory rollback, immutable returned snapshots/results, interruption/checkpoint recovery and treasury conservation.
- Exact Position schema2 (255B body), Hour schema2 (297B), ActorNonce core body (298B), CLAIM_POSITION payload120/result88 codecs and independent offset/negative-byte tests.

`SettlementEngine` exposes the following APIs. State-machine requests include `actor`, `nonce` and `now` unless invoked through the integration path.

| API | Additional fields / purpose |
| --- | --- |
| `constructor` | `{rewardStart, saleStart}` nonnegative i64 seconds |
| `createVerifiedRoot` | Trusted upstream `{instance,owner,scope,B_int,q_ppm,certificate}`; verifies basic economic bounds, not biology or materials |
| `register` | `{instance,beneficiary?}`; owner authorization is required at the real ingress |
| `exit` | `{instance,seq}`; historical closed seq cannot affect a later stake |
| `openHour` | `{hour}` completed hour, sequential only |
| `scanHour` | `{hour,expectedPhase,expectedCursor,workCount}`; 1–8 actual work steps |
| `materializeHour` | `{hour,expectedCursor,rootCount}`; 0 only for empty directory, otherwise 1–8 roots |
| `advanceFrozenHour` | `{hour}`; completed READY/partial hour; no ledger movement; switches the CAS cursor from legacy directory traversal to processed-member count |
| `materializePosition` | Lazy path `{hour,intervalId,expectedCursor}`; actual historical Position in its own hour order; `intervalId:null` explicitly finalizes an empty lazy snapshot |
| `claimPosition` | `{intervalId,expectedPaid,upToAccrued,destinationOwner}`; actual Token account ownership must be checked by the adapter |
| `transfer` | `{instance,newOwner}`; old accrued amounts remain with original beneficiary |
| `consume` | Trusted `{instances,outputInstance,outputFacts}`; at most six actual inputs, verified output created atomically; upstream materials/fees must share the enclosing transaction |
| `acceptFrontier` | Trusted `{cost,now}` strict verified improvement, prospectively stops old K |
| `acceptWinner` | Trusted `{winnerId,instance,author,cost}` after independent round selection |
| `activateK` | `{instance,winnerId}`; original root/author, current best, ordinary stake and irreversible revoke checks |
| `invalidateCertificate` | Trusted deterministic fault `{instance,now,faultReference}`; missing data is not a fault |
| `burnManufacture` | `{amount}` actual circulating wallet funds only, no unpaid-debt burn |
| `donateToReserve` | `{amount}` passive transfer, does not recreate entitlement or budget |
| `snapshot/fromSnapshot` | Detached host persistence checkpoint and invariant audit; not a trustless cryptographic state proof |

## Integration and trust boundary

Production integration must use `executePrepared(command, request)` **inside** protocol-core `executeAtomic`. The core verifies the deployment domain and trusted authorization evidence, derives the actor/nonce from ExactFrame, and stores the sole ActorNonce. `executePrepared` does not read/write this package's standalone nonce Map. The standalone wrappers exist to execute and test the business model independently; do not maintain both nonce ledgers in production.

Root IDs and owners in the host kernel are bounded opaque strings. The Solana adapter must map verified 32-byte keys, validate actual native signatures/PDA/runtime owners/account privileges/alias rules, and validate SPL Token accounts and real CPI postconditions. A string saying `alice` is not a signature. `createVerifiedRoot`, `acceptWinner`, `acceptFrontier`, certificate invalidation, and synthesis output facts must never be exposed as free user mint/winner/PASS endpoints. The upstream composition/verifier owns real material consumption, admissibility, provenance, semantic novelty and scientific replay.

The kernel atomically clones and audits its full host state. This intentionally prioritizes reference correctness; it is not a measurement of bounded on-chain CU. Actual account reads/writes, Solana VM limits, heap, serialized messages, native token transfer failures, rent, concurrency/finality, public cranker funding and independent security audit remain production gates. See [the version change](../../docs/ECON-SETTLE2.md) and [Solana feasibility](../../docs/solana-feasibility.md).

## Cost behavior

Persistent data grows as O(unique roots + ordinary intervals + global hours + actors + K activations). No permanent per-root/hour account or per-operation full request is created. Native schema4 Hour records use 482 bytes each and may close only after complete allocation; original payer rent is returned, while Position debt persists. The `wire.mjs` schema2/297-byte host codec remains explicitly historical and is never relabelled as a native schema4 record.

The independent `SettlementEngine` oracle deliberately scans historical roots to derive each denominator, then permits lazy allocation. `ActiveSettlementIndex.freeze` instead applies only actual due events and snapshots its maintained active count/weight without writing members. Its `materialize` updates a single historical Position even after the current node has ended or changed. Native ECON4 uses this event-index approach. Pending private-owner history no longer prevents future global hours; it still has real per-Position computation and transaction costs. Production admission remains false until final native integration, live network compatibility and independent security gates pass.
