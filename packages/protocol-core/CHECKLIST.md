# P0 / P1 implementation checklist

Before implementation, dependencies were read from `p0-abi1-20261024`, `p1-inventory1-20261024`, P5 component ABI, and ROLLUP1 integration registry. The current P1 amendment supersedes the historical unpack Source hash.

## Invariants to implement

- Exact little-endian integers, strict limits, canonical ordering, known tags, no trailing bytes, no floats or implicit truncation.
- P0 typed hashes, 152-byte ExactFrame, 120-byte record header, permanent request byte equality.
- Source identity binds domain, the single manufacturing business key, and sorted intake ordinal.
- Exactly four immutable classes and 32 species; no unpack, recycling, Source transfer, or prefix reset endpoint.
- Every new Source has the locally minimal intake, real BOM debit, immutable owner, and monotone per-species prefix.
- All four material credit accounts balance: effective + retired + unused = original material credit.
- Multiple owners require explicit authorization evidence from the trusted execution adapter; the pure library does not fabricate native signatures, PDAs, token-program execution, or on-chain finality.
- A failed output validator, stale prefix, duplicate nonce, or other failure leaves original input state unchanged.

## Acceptance to run

- Independent frozen P0 and P1 golden hashes / bytes and decoder round trips.
- Malicious length, unknown tags, noncanonical enum/bool/UTF-8, integer overflow and trailing data.
- Single and successive F1 manufacture; exact unused material and Effective/Retired credit.
- Multi-owner, cross-project input, nonminimal intake, stale/duplicate intervals, mixed-species misuse.
- Same request retry, altered request conflict, failure rollback, and alias isolation.

## Outside this pure module

Rust/SBF parity, canonical PDA/bump, native direct signer checks, actual Classic Token `BurnChecked`, transaction atomicity, account ownership, compute/loaded-data/rent limits, and full structure/function validation remain integration gates. Passing Node tests does not open production operations.

## ECON-SETTLE2 approved execution amendment

The parent approved a bounded per-actor ActorNonce instead of permanent full Business per operation. The frozen Business codec remains a reference/legacy format. Current model execution uses a canonical `u64 nonce || zero[24]` opId and one latest digest/result cache. Same latest digest returns the original result; older requests are rejected rather than executed again. The new errors occupy 7000–7002. Atomic tests cover rollback and replays across material/output/nonces.
