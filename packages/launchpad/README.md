# Launchpad and Ops core

Pure deterministic P2 CREATE, P22 BUY and P3 QUEUE/PAY execution module. It imports the shared P0/P1 / ECON-SETTLE2 core, uses BigInt throughout and has no external packages. Existing site files are not imported or changed.

Run `node --test biolab/packages/launchpad/test/*.test.mjs` from the repository root.

## Entry points

`applyLaunchpad(state, frameBytes, context)` invokes the one shared `executeAtomic` ActorNonce boundary and returns `{state, resultBytes, replayed, businessKey, nonce}`. A failure leaves input state untouched. A latest identical retry returns before current-season, old-account or additional payer validation; only the original actor is reauthorized by the core wrapper. An older nonce is refused, and does not re-execute.

`executeLaunchpadPrepared(draft, {frame, businessKey, nonce}, context)` is the mutating trusted internal stage for a larger single core transaction. It is not a separate public authority or another nonce store. All exact payload encoders/decoders, `materialSeason`, `quotaKey`, `expenseId`, and the Expense289-byte body codec are exported from `src/index.mjs`.

## State and trusted context

Material Project/Mint/Token/Source Maps have the protocol-core shape. Additional state is:

```text
lamports: Map<addressHex, BigInt>
nativeAccounts: Map<addressHex, {programOwner:'system'|'biolab'|'token', dataLength, executable}>
seasonIssued: Map<'class:season', BigInt>
lifetimeIssued: Map<'class', BigInt>
expenses: Map<expenseRefHex, Expense>
ops: {address:Buffer32, nextExpenseNonce:BigInt, paidLamports:BigInt}
actorNonces: shared protocol-core Map
```

The trusted context provides `expectedDomain`, `configId`, `tOpen`, actual `now/slot`, `opsAddress`, five byte-sorted `opsMembers`, `authorizedActors:Set<addressHex>`, optional `protectedKeys`, and real adapter functions:

- `deriveProjectAddresses(projectId) → {projectAddress, mints[4]}`
- `deriveQuotaAddresses(class,season) → {seasonAddress,lifetimeAddress}`
- `deriveActorNonceAddress(actor)`, `deriveExpenseAddress(expenseRef)`
- `deriveAtaAddress(mint,recipient)`
- `minimumBalance(dataLength) → actual rent minimum in lamports`

These callbacks are required trusted integration inputs. This package does not invent a substitute PDA algorithm, fabricate native signatures, or treat an arbitrary client quote as actual rent. Test fixture addresses are opaque test allocations, explicitly not PDAs; fixture rent is arithmetic test data, explicitly not live network rent.

New targets are independently checked as uninitialized System accounts in the model. Each actual shortfall is `max(max(minimumBalance(length),1)−prepaid,0)` and is charged to the signed rent payer. Extra prepaid funds remain at that target. Current v2 does not create full Business per operation: first use of an actor includes the fixed418-byte ActorNonce target, later uses reuse it. New CREATE targets are Project and four Mints; BUY may add quota records/ATA; QUEUE adds the permanent Expense; PAY normally has no new record except a first actor's nonce.

## Fixed behavior

Four classes only; global single-season limits are50000/100000/25000/25000, lifetime limits100 times those values. The91/91/91/92-day calendar starts at `tOpen` and stops new issue after100 seasons. Unused sales quota does not roll over. Existing material never expires with a season, and burns do not restore issue allowance.

CREATE costs10000000 lamports to Ops and creates zero material. BUY pays the fixed project price to its frozen seller plus100000 lamports/unit to Ops, delivers actual modeled Token quantities, and increments all three issue counters in one atomic transition. It creates no Source, Root, LAB or mining weight. Gross funding is checked by unique address before incoming credits; self-sale is not a subsidy and incoming sale proceeds cannot pay the same transaction's rent.

QUEUE is a single fixed member's expense proposal, has a globally unique permanent ref and reserves no funds. PAY requires the three exact selected distinct members, including the actor, and pays only Pending expenses inside the original window. Extra signatures do not substitute for a missing selected member. The Ops136-byte floor remains, recipient and accrued paid amounts change exactly once, and expiry creates no refund.

## Remaining deployment gates

This is not deployed and is not an RPC account or native signature verifier. The real adapter must enforce canonical PDA/bump, AccountInfo owners, actual Classic Token/ATA/System instructions, account order/W permissions, native top-level signer evidence, exact gross/rent funding, and actual postconditions. SBF compute/transaction/heap/loaded-data capacity, real concurrency, native rollback and independent review remain required. In-memory serialized final-unit competition is a state-machine test, not measured Solana concurrency.
