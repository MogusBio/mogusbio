# Unified player navigation

Scope: interface organization only. Keep existing material/science/economic,
native authority, nonce and recovery behavior. Production market trading and
listed-but-producing assets are still outside this implementation.

- [x] Seven primary destinations share the same meaning in main workbench and
  local test account. First issuance belongs to laboratory projects; secondary
  material/product/BIO markets remain separate.
- [x] All twelve existing business leaves and original input IDs remain unique.
  Three market leaves add distinct same-document views. Parent disclosures do
  not carry business navigation handlers.
- [x] Route changes click the original leaf once, preserving existing plan,
  permission and experiment invalidation. Never reconstruct a form to navigate.
- [x] Main-workbench deep links use a fixed route whitelist, with no actor,
  amount, nonce, private graph or arbitrary URL in the routing contract.
- [x] Actual browser preserves unapplied graph text across main-market routing.
  External local-test links open separately and cannot unload that draft.
- [x] Main markets describe missing production capability. Only a same-origin,
  explicitly enabled loopback config reveals local-test links; no account start,
  wallet, native plan, transaction or balance change occurs on opening a page.
- [x] Local seven-page navigation keeps kit, ledger, run/revision and pending
  request intact. Exactly one panel is visible; initial market hashes select
  the correct category. Reload restores both route and account progress.
- [x] BIO construction leads to the dedicated energy page. Registration and
  exit use exact work IDs; identical names show kit association/short IDs.
- [x] Browser traverses all nine local leaves without changing funds, then
  completes buy/manufacture/parent chain/stake/claim/exit and market list/cancel.
- [x] Keyboard-capable native details/links and responsive CSS keep all routes
  available. Desktop1280×720 browser has no horizontal overflow. This does not
  claim a physical mobile-device run.
- [x] Final full regression, source snapshot and evidence binding closed.

Focused evidence: navigation-main-focused-20261025.log (33 cases),
test-lab-navigation-focused-20261025.log (25 cases), and
navigation-existing-controllers-20261025.log (unchanged business protections).
The first full regression's seven obsolete page-count assertions remain in its
log; they were updated for15 leaves without deleting safety assertions.

Final full regression:1008/1008 pass,0 failures, in evidence/unified-player-navigation-final-20261025.log. No science, emission, ABI or native source changed. Source/evidence identities are recorded separately by the root acceptance.
