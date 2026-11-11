# Launchpad acceptance record

2026-10-24. Executed `node --test biolab/packages/launchpad/test/*.test.mjs`.

**28 passed, 0 failed, 0 skipped.** Expected frozen digests are literal independent document values for CREATE, BUY, QUEUE and PAY complete REQUESTs; quota0/99/lifetime and Expense identity are also checked. This does not use self-round-trip alone as evidence.

Executed accounting scenarios cover project creation with four zero-supply Mints and actual per-target modeled rent, ordinary purchase with exact seller/Ops/delivery/counter entries, self-sale gross insufficiency, zero-price resource fees, distinct contributor authority, cross-project global final-unit competition, cross-season persistent totals, external-burn non-refund, prepaid excess isolation, missing-counter corruption, all-or-nothing outer failure, single-member queue, nonce race, selected3-of-5 payment, duplicate ref/payment, wrong fields, expiry/not-before and Ops floor.

Review added explicit cross-checks between Project/Mint/Token/Quota/Expense model records and their account metadata and permanent balances. These are internal execution-model consistency checks; a real adapter still has to obtain trustworthy runtime facts. A client-supplied metadata object is never proof of account identity.

No wallet, native transaction, actual token, PDA, live rent, public-network signature or Solana deployment was used. Root project integration, SBF port/compute and real concurrent/atomic execution remain separate required acceptance gates. ECON-SETTLE2 replaces historical per-operation Business storage; old frozen documents were not modified.
