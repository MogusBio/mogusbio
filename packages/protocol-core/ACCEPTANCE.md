# Protocol-core acceptance record

Date: 2026-10-24. Command executed from the shared workspace:

`node --test biolab/packages/protocol-core/test/*.test.mjs`

Latest run: **35 tests, 35 passed, 0 failed, 0 skipped**. The run used Node's built-in ESM, `node:test`, `node:crypto` and strict BigInt arithmetic; no package downloads.

Independent frozen expected values include the P0 TH1/TH2/TH3, IF2 request digest, P1 CAT1, M1, SRC0–SRC3, PLAN1 and BODY1. These values are literal expectations from the frozen documents, rather than outputs asserted against themselves. Round trips additionally check every implemented format.

The functional accounting tests verify first manufacture480000 source credit =120000 Effective +45000 Retired +315000 unused, followed by a second manufacture600000 cumulative source credit =240000 Effective +90000 Retired +270000 unused. A multi-project split still gives the same120000 Effective credit. Adversarial cases cover wrong/missing owners, frozen Token state, excess supply, nonminimal intake, absent debit, stale/overdrawn stock, duplicate Source/token/entries, forged Source identity, invalid directory, tails and malicious lengths.

ECON-SETTLE2 tests cover latest identical retry without re-entry, same nonce/different bytes conflict, old nonce refusal, nonce gap, cached-result isolation, fixed298-byte serialization, missing actor evidence, domain mismatch, and full draft rollback after material consumption/output creation followed by validation failure.

The approved v2 registry is tested for Position kind27/schema2, Hour kind18/schema2, ActorNonce kind35/schema1, MATERIALIZE1201/1/schema2 and CLAIM_POSITION1203/1/schema1. Legacy per-hour Receipt schemas remain available to reference codecs but are expressly rejected by current execution.

Review found and corrected a P3 registry size before completion: QUEUE_EXPENSE result is56 bytes, as specified by the independent P3 attachment. A regression test locks that value.

Not established: native signatures/PDA/bump, actual token program, full biological output validity, real Solana atomic rollback/concurrency, compute and loaded-data capacity, rent/fee economics, or independent Rust parity. There is no claim of production approval or absence of all bugs.
