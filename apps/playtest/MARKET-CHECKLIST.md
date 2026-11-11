# Local HOST market implementation checks

Prepared before implementation. This market is a local test-account adapter;
no wallet, network request, signature or native Solana marketplace is involved.
It preserves the frozen catalog, science models, LAB emission and primary sale
fees. Fixed secondary test prices are UI fixtures, not a token valuation model.

- [x] Derive MATERIAL / PRODUCT / BIO from registered mint / actual Root scope;
  never trust a category or owner supplied by the client.
- [x] Migrate old checkpoints once. Give the explicitly labelled test
  counterparty test SOL only; buy its raw materials using real launchpad
  issuance, quotas and fees, and manufacture its part using real P5.
- [x] Listing raw material transfers existing tokens into escrow; no mint,
  Source recovery, unpacking or recycling operation exists. Maintain exact
  token-supply totals and registered issuance/burn ledgers.
- [x] Listing a work uses actual SettlementEngine transfer into escrow and
  respects active/pending stake, exit boundary and unsettled-history locks.
  Listed works cannot be reused, staked or listed twice; originals and parents
  cannot share material. Cancel/buy transfers the existing Root onward.
- [x] Historical Position beneficiaries and debt stay unchanged by ownership
  transfers; the new owner may independently register future ordinary rewards.
- [x] Exact test-SOL payment and existing asset delivery commit atomically;
  insufficient funds, wrong owners, malformed requests, repeated buy/cancel
  and all failing operations leave the entire runtime unchanged.
- [x] Market purchases appear in actual inventory/works, market sales remove
  them, and incomplete old kit groupings cannot manufacture missing assets.
- [x] Bound listings/history/checkpoint sizes; restore validates escrow and
  money/material invariants; reset makes an isolated clone of the template.
- [x] Exercise raw listing/cancel/buy/sell, manufactured part buy/sell and
  future rewards, higher-scope listing, stake locks, history debt, insufficient
  material/funds, duplicate actions, checkpoint migration and reset isolation.

API: `market-list` accepts either `{assetType:'MATERIAL',class:1..4,quantity:'1'}`
(quantity defaults to one) or `{assetType:'WORK',workId:<64 lowercase hex>}`.
Prices are server-derived fixed test quotes. `market-buy`, `market-cancel`, and
`market-test-counterparty-buy` each accept `{listingId:<64 lowercase hex>}`.
No client owner, category, price, mint or recipient override is accepted.

## Acceptance evidence

`evidence/playtest-market-and-runtime-final-20261025.log` passes all 15
focused cases (6 original runtime, 9 market), including a full reference
CELL/ORGAN/BIO construction, actual parent transfers, token supply/issuance
conservation, exact payment, escrow reuse rejection, active/pending/exit and
unsettled-history locks, historical debt after sale, missing funds, duplicate
buy/cancel/claim, old-template migration and detached reset clones.

The genuinely saved pre-market baseline (1,404,611 JSON bytes) restores without
changes to player assets: 60 unlocked parts, 120 raw units and 48,225,840 LAB
atoms remain. The migrated checkpoint is 1,435,306 bytes; its snapshot is
47,636 bytes. The prepared template deliberately keeps the legacy shape;
restore initializes the detached test counterparty once, and market-aware
checkpoints never run issuance/manufacture bootstrap again.

The counterparty receives explicit test SOL, buys one 120-unit material kit
through launchpad (all four quota/issuance/fee transitions), and manufactures
one real P5 primitive-1 component. Its four single-unit raw offers and one
component offer are escrowed from those actual balances. Primary issuance
becomes [90,180,45,45], manufacturing intake becomes [31,61,16,16]; resale
never changes either ledger or mint supply. Secondary quotes are 500,000
lamports per raw unit and 1,200,000 lamports per actual 120,000 B_int credit.
Only the local test fixture chooses these prices. No marketplace fee, LAB
bonus or emission change is introduced.

`SettlementEngine.transfer` is the actual ownership authority. The existing
Root's mutable owner/revision bytes are synchronized; immutable certificates,
material provenance and historical Position beneficiaries remain unchanged.
Because listing uses the existing transfer semantics, future first-discovery
eligibility is not restored by cancellation or buying a work back. Existing
ordinary rewards remain available to the new owner after normal registration.

Native Solana escrow PDA/Token/System CPI, market instruction ABI, real signer
and concurrent chain execution remain future production work. This local
adapter cannot be used as proof of native market execution or real liquidity.
No deployment, real wallet operation or external network request was made.
