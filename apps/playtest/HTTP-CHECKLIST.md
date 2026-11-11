# Local interactive test account

This is explicitly enabled loopback-only reference-model testing. It does not
replace wallet authentication, native execution or any production admission.

- [x] Normal workbench/gateway never exposes these routes; explicit preview flag
  and exact Host/Origin are required. No wallet secrets, chain sends or grants.
- [x] One click creates/resumes an isolated test account. A private HttpOnly
  SameSite cookie selects a server-derived file, never a caller-selected path.
- [x] Reuse FileJournalStore for durable atomic CAS. Each action checks run ID,
  revision and idempotency key; identical retry cannot consume twice. Failure or
  a losing concurrent CAS never commits partial reference-model changes.
- [x] Reset starts a fresh run from the actual prepared baseline. Old requests
  cannot enter the new run. Browser reload and server restart resume the account.
- [x] UI uses buttons/cards and server next-actions. It never accepts invented
  balance, reward, quality, ownership, nonce or backend configuration.
- [x] Deterministic runtime uses actual protocol/science/economy modules. Test
  SOL and local System/PDA/rent are explicit fixtures; labels never claim native
  chain confirmation. Prepared LAB must be earned by its real model ledger.
- [x] Verify session isolation, duplicate click/retry, stale revision/run, bad
  fields/origin, failed rollback and restore with actual endpoint contracts.
- [x] Actual browser walks buy, manufacture, cells, organs, BIO, stake, advance,
  claim, exit and reset; saves visible evidence and keeps the account available.

Browser evidence: `evidence/click-playtest-browser-steps-20261025.json` records the real local UI path, all three markets and reload restoration. 9 HTTP cases pass (storage/transport fixtures); 15 runtime/market cases independently exercise the actual reference modules. Normal production routes remain closed.
