# P2 / P22 / P3 implementation checklist

Read before implementation: frozen CREATE, material-season/quota, BUY delivery/atomic funding, and Ops QUEUE/PAY exact specifications. Reuse protocol-core P0/P1 codecs and ECON-SETTLE2 ActorNonce. Full Business creation is legacy only; current rent targets include a new fixed ActorNonce when necessary.

## Required invariants

- Exactly four distinct registered material Mints, immutable project terms, zero creation supply, no Source/Root/LAB reward on create or buy.
- Shared global class/season and lifetime caps across all projects and actors. Fixed91/91/91/92-day quarters; no rollovers or burn refunds.
- Exact purchase delivery and all three counters, seller price and100000 lamports/unit resource fee commit together.
- Per-address gross SOL budget before credits; self-sale still pays the resource fee and cannot use future receipt to fund rent.
- Rent quotes come from the trusted runtime adapter. Each unique new target shortfall is computed independently; prepaid excess does not offset another account.
- Single-member expense queue, permanent unique ref, fixed3-of-5 indices/signers for payment, no reserve created by queue, no duplicate payments or expiry refunds.
- All business transitions run inside the single shared core nonce transaction; any failure leaves original state unchanged.

## Acceptance to run

- Exact CREATE/BUY/QUEUE/PAY payload/result sizes and independent frozen golden hashes.
- Normal funding and token delivery; zero-price/self-sale; buyer/seller/rent aliases and gross insufficiency.
- Cross-season window edges, global cap across projects, race for the final unit, issuance supply guard, lazy-counter corruption refusal.
- Distinct Ops3/5, missing/repeated/extra members, nonce races, not-before/expiry, duplicate ref/payment and insufficient spendable Ops balance.
- Replays, old nonce refusal, atomic failures after internal effects, no fake chain signatures or pseudo-PDAs.

## Runtime boundary

This is a deterministic pure execution model. Address derivation, verified native signer/account metadata, minimum rent, actual Token/ATA/System execution and Solana transaction/concurrency limits must come from the real adapter. No provider callback here is claimed to prove on-chain identity.
