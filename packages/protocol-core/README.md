# Protocol core

Dependency-free Node ESM implementation of strict P0 binary/hash utilities and P1 material accounting, with the approved ECON-SETTLE2 atomic nonce boundary. Import `src/index.mjs`. The existing site is not used or modified.

Run `node --test biolab/packages/protocol-core/test/*.test.mjs` from the repository root.

## Interfaces

- `ByteReader`, `ByteWriter`, checked integer helpers: bounded little-endian primitives, canonical bool/Option/Vec, fatal UTF-8, exact exhaustion.
- `typedHash`, `deploymentDomain`, `businessKey`, `requestHash`, `sourceId`, `instanceId`, `projectId`, `receiptKey`: exact typed tuples. Source uses the P1 amended ordinal tuple.
- `encodeExactFrame` / `decodeExactFrame`: 152-byte header, closed operation registry, codec/schema1, maximum4096 bytes. These functions parse the envelope; the owning business module must validate its entire exact payload.
- `encodeRecord` / `decodeRecord`: exact120-byte header. They do not prove the actual PDA, canonical bump, runtime owner, or kind-specific body semantics.
- `encodeBusinessRecord` / `decodeBusinessRecord` / `inspectBusinessRetry`: frozen reference/legacy full-Business format. ECON-SETTLE2 execution does not create these per operation.
- `encodeMaterialPlan`, `encodeDebitPlan` and decoders; fixed `catalogHash`, `F1_BOM`; Source736-byte and Project408+name-byte body codecs.
- `prepareMaterialConsumption(state, context, trustedBOM = F1_BOM)`: builds a new complete material state and exact Effective/Retired slices; the original state is never changed. It has no public bare-consumption opcode.
- `executeAtomic(state, frameBytes, {expectedDomain, authorizedActors}, transition)`: parses the canonical nonce from the ExactFrame, checks trusted actor authorization, clones all data, and commits the bounded nonce only if the synchronous trusted transition succeeds. Returns `{state, resultBytes, replayed, businessKey, nonce}`. Cached results are at most256 bytes.
- `nonceOpId`, `opIdNonce`, `encodeActorNonceBody`, `decodeActorNonceBody`: one canonical nonce encoding and fixed298-byte cache body.
- `EXECUTION_V2_WIRE`: approved bounded Position/Hour/ActorNonce record registration and current materialization/claim metadata. All production profiles remain disabled until SBF acceptance; current `executeAtomic` rejects the legacy per-hour Receipt creation/claim paths.

## Material state contract

Keys in every Map are lowercase raw32-byte hex. Amounts are BigInt. Addresses and hashes are Buffer32.

```text
state.projects: Map<projectHex, Project>
state.mints: Map<mintHex, {supply}>
state.tokens: Map<tokenHex, {mint, owner, amount, initialized:true, native:false, frozen?:false}>
state.sources: Map<sourceHex, Source>
state.actorNonces: Map<domainHex:actorHex, {nextNonce, lastDigest, lastResult}>
```

`context` contains `domain`, `manufactureBusiness`, `plan`, `authorizedOwners:Set<ownerHex>`, `createdAt`, and `createdSlot`. The plan contains canonical `catalogHash`, `intakes`, and `debits`; see `test/fixtures.mjs` for the full executable shape. Returned material totals are `burnedStandardUnits[4]`, `consumedTick`, `effectiveCreditInt`, `retiredCreditInt`, `effective[]`, and `retired[]`.

The P5/P7 coordinator must place material preparation, approved structure/function validation, real output creation, all fees and nonce commit inside one `executeAtomic` transition. A successful material preparation alone is not a manufactured asset. Any input/output failure discards the entire draft. Existing stock retains its original owner and lineage; synthesis never returns material.

## Trust and deployment boundary

Authorization Sets are trusted execution-model evidence, not Ed25519 signatures. The in-memory Token arithmetic is an exact accounting model, not a Classic Token CPI. An adapter must verify real native signer/top-level rules, canonical PDA/owners, immutable configuration, registered Mint authorities and actual burn postconditions. The P5/P7 coordinator supplies the trusted BOM and full output validator; client PASS booleans are not accepted here.

This module has not been deployed or ported to SBF. Its Node tests do not establish CU, transaction limits, loaded account data, rent, network finality, or real transaction atomicity. The parent Solana acceptance module owns those gates.
