# Guided native purchase planner — P10.2b

Checks fixed before implementation:

- The first guided operation is self-BUY only: actor is the principal payer,
  rent payer, recipient, and transaction fee payer. Seller is read from the
  actual Project. No request can choose a release, endpoint, account table,
  nonce, mint, seller, destination, price quote, quota counter, or season.
- ReadOnlyRpc owns injected bounded transport and finalized/genesis checks.
  BaseConfig and initialized native EconConfig are distinct required records.
  Clock comes from the actual sysvar, never the browser clock.
- Project/mint/ATA/season/lifetime PDAs and their full native records are read
  and validated. Missing or system-owned empty canonical accounts may be fresh;
  malformed, foreign, or executable records are never treated as absent.
- Reuse the exact native BUY encoder, wallet table, instruction builder,
  materialSeason, quotaKey, fixed resource fee, and class cap constants. Keep
  native u64 arithmetic/quantity bounds and price/payment/rent caps explicit.
- Validate the real Project price/seller/cap/counters, Classic mint authority,
  decimals, freeze policy and supply health, canonical self ATA owner/mint/state,
  global quota health and available project/season/lifetime allowance.
- Re-read the finalized inputs together before ACTION; changed nonce, season,
  counters, pointers, or relevant accounts require a new plan. An observed nonce
  is never reserved or silently incremented.
- Return actual observations and either a blocking/replan decision or one
  nativeActionIntent for the existing explicit prepare/check/simulate/sign/send
  flow. Planning never signs, journals, simulates, retries, or sends.
- maxRent is a signed ceiling, not a rent quote. Any unavailable rent-exemption,
  aggregate rent/gross-funding, or network-fee proof remains explicitly
  unverified; ACTION is an unsigned proposal requiring simulation, not a claim
  of execution readiness. Unsupported CREATE/gifting/arbitrary destinations are
  rejected rather than inferred.

Acceptance: actual recorded signed Bank before-state fixtures for all four
classes; missing/prefunded ATA and quota cases; exact intent/frame/metas; real
nonce/Clock/price/counters; class/quantity/u64/cap bounds; malformed ownership,
mint/ATA/quota/clock/config rejection; stale final reads; external seller alias
table; no sendTransaction, journal, invented rent/network fee or browser state.
