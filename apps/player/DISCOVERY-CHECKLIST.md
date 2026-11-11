# Project directory and wallet discovery: pre-code checklist

Prepared2026-10-25. The original pre-code gates are preserved below, followed
by implementation and final integration acceptance. The final sections supersede
earlier pending statements; no stage establishes complete wallet coverage. The authoritative
frozen interfaces are [the SDK checklist](../../packages/client/DISCOVERY-CHECKLIST.md)
and [the bridge checklist](../../packages/bridge/DISCOVERY-CHECKLIST.md), plus
root's subsequent LIVE-only Root/schema probe clarification recorded below.
No browser, bridge, SDK, native, economic or deployment source changes accompany
this document. Existing strict transaction and record readers remain authoritative.

## Required implementation gates

- [x] Root confirms the new OPEN310 end-to-end chain has passed its required
  acceptance. Prior76b/OPEN316 evidence does not substitute for this gate.
- [x] Read the frozen SDK/bridge DTOs, identifiers, cursor binding, errors and
  coverage semantics; record the latest root clarifications in this document.
- [x] Read the fixed finalized discovery source, separate transport, deadlines,
  incomplete/unsupported behavior and work bounds. These are design checks only.
- [x] Root integrates the bridge/API/auth/static routes. This UI work does not
  expand anonymous permissions or choose arbitrary RPC/index endpoints.

Root authorized independent UI implementation and subsequently confirmed the
67c OPEN310 native chain and independent23709 signature package PASS. Both new
controllers are now locally exercised; actual bridge/HTTP/browser integration
remains root-owned and pending. Earlier candidate API names/fields are superseded
by the single frozen `discovery-read` contract below.

## Frozen discovery boundary synchronized before implementation

- [ ] Use only `discovery-read` with exact required body
  `{actor, section, cursor, query}`. Do not add page size, budget, filter, prefix,
  endpoint, source path or arbitrary wallet-owner fields.
- [ ] `cursor` is null or an opaque64-character lowercase hex server token.
  Never parse/manufacture traversal state in the browser or reuse another
  actor/section/query/context's cursor.
- [ ] Directory sections are `projects` and `my-projects`. Wallet sections are
  exactly `roots`, `sources`, `positions`, `material-atas`, `token-owner-hints`;
  their request query is exactly `''`, regardless of any hidden search field.
- [ ] Directory query is valid UTF-8, at most128 bytes before trimming, without
  C0/DEL controls; server canonicalization is NFC plus trim. Search matches an
  NFC/toLowerCase name substring, a full64-hex ID ignoring hex case, or the exact
  creator Base58 address. Do not use locale-sensitive case conversion.
- [ ] Search is performed server-side throughout actual candidate traversal,
  not by filtering only the currently returned maximum8 rows. Query changes
  start a new scan. Empty rows with pending traversal still allow continuation.
- [ ] Directory classes expose project issued/cap, not the current global season
  allowance. Label those values as project-issued/project-cap figures; do not
  present cap-minus-issued as the quantity currently purchasable. The existing
  purchase-plan must reread global quotas and current state before purchase.
- [ ] Schema/record-ID partition traversal is not global creation-time order.
  Use directory/discovered-project labels, never latest sales/newest offerings
  or a global chronological ranking derived from the current page.
- [ ] Response profile is `BIO-DISCOVERY1`, decision is `DISCOVERY_PAGE`,
  `DISCOVERY_BLOCKED` or `DISCOVERY_RESTART_REQUIRED`; actor, section and context4
  must match the pending request and authenticated configuration.
- [ ] Validate rows, nextCursor, bounded redacted `{code}` issues and exact read
  flags: `transactionExecuted:false`, `networkSubmitted:false`,
  `reservesOnChainNonce:false`, `discoveryOnly:true`,
  `actionEligibilityVerified:false`. Reject intents, envelopes or action authority.
- [ ] Each returned row has `recordVerified:true`, decimal `observedSlot` and
  the frozen type-specific fields below. On-chain integers stay decimal strings;
  IDs are lowercase32-byte hex, addresses Base58, and class/target bounded numbers.
- [ ] Fixed coverage includes state (`IN_PROGRESS`, `TRAVERSAL_EXHAUSTED`,
  `OVERFLOW`, `UNAVAILABLE`, `CHANGED`), finalized commitment,
  `MULTI_SLOT_BEST_EFFORT`, nullable decimal observed slot endpoints,
  prefixesVisited, pending, `cryptographicComplete:false` and `fullWallet:false`.
  Exhaustion never becomes a cryptographic completeness/full-wallet label.
- [ ] The server first performs an empty-prefix small probe; no assumed256
  empty partitions or made-up percentage/progress denominator is shown.
- [ ] Root's latest scan bound accepts a sliced candidate leaf only below256
  candidates (superseding the initial below64 design);64KiB scan response,
  maximum8 emitted verified rows/page and total CAS storage below16MiB remain
  bounded. A standard chain's120 Sources must not imply256 empty partitions.
- [ ] Preserve the existing20-second bounded browser transport while the server
  page has an18-second total deadline, stops scanning by9 seconds, and uses
  at most4 scan calls plus3 closure batches and one genesis call. A deadline
  yields truthful continuation/blocking, not a fabricated empty result.
- [ ] Root's latest clarification supersedes the older unified-Root paragraph in
  the SDK checklist: roots uses separate schema1..4 small probes and native LIVE
  filtering within4 filters. Do not derive browser traversal behavior from raw
  offsets or expose filter construction in the request.

Frozen row fields (besides shared recordVerified/observedSlot):

| Type | Required discovery fields |
| --- | --- |
| PROJECT | projectIdHex, address, name, creator, seller, createdAt, createdSlot; four classes with class/mint/cap/unitPriceLamports/issued/intakeBurned/supply |
| ROOT | instanceHex, address, owner, descriptorHex, nullable target, qualityPpm, B, retired, revision, lifecycle, nullable parentInstanceHex; registration exists/ordinaryCount/directorySequence/certificateFault |
| SOURCE | sourceIdHex, address, owner, projectIdHex, class, mint, unitCount;32-entry decimal initialTick/spentPrefix/remainingTick; createdAt/createdSlot |
| POSITION | positionIdHex, address, instanceHex, positionSeq, beneficiary, start, nullable end, accrued, paid, nextUnsettledHour, rootOwner, rootLifecycle |
| MATERIAL_ATA | projectIdHex, class, mint, address, owner, positive amount, manufactureIncluded:false |
| CLASSIC_TOKEN_HINT | address, mint, owner, amount, isStandardAta, protocolMatch LAB/UNRESOLVED, manufactureIncluded:false |

Only ROOT/LIVE rows belong to the current `roots` section. SOURCE and MATERIAL_ATA
are separate sections, not interchangeable balances. Token hints may be unresolved;
an unresolved mint is not proof that it is outside the protocol. Optional hints
have independent overflow coverage and do not merge into ATA manufacture inventory.

## Scope and ownership

- [ ] Add independent page11, laboratory project sale directory/search, and
  page12, My BioLab assets. Preserve the existing10 pages and their workflows.
- [ ] Scope My assets to the pinned BioLab release/domain/config; do not present
  it as discovery of every token or application in the wallet.
- [ ] New UI scripts, relevant HTML/CSS and UI tests belong to the discovery UI
  owner. Root owns bridge/gateway/API integration and the frozen response contract.
- [ ] Keep discovery/display separate from existing purchase, manufacturing,
  synthesis, position accounting, claim and lifecycle planners.
- [ ] Preserve manual known-ID readers as explicit fallbacks when discovery is
  absent, incomplete, delayed, unsupported or unavailable.

Expected files after authorization: new independent script/controller files under
`apps/player/dist/`, `apps/player/dist/index.html`, scoped additions to
`apps/player/dist/style.css`, new focused tests under `test/`, and the existing UI
view-count assertions. Root supplies native action/static-route wiring. Concrete
filenames and exports will follow the frozen DTO; no shared transaction rewrite.

## Twelve mutually exclusive views

- [ ] All12 navigation items show exactly one matching `.view`; prior10 pages
  remain selectable and preserve their controls and event-listener behavior.
- [ ] At viewport heights720px and900px the sidebar navigation can scroll, and
  pages11/12 remain reachable. Verify small/mobile layouts and keyboard focus;
  no fixed-height sidebar clipping or trapped unreachable navigation entries.
- [ ] New controller registration does not change listener order relied on by
  the transaction console or override another page's title after navigation.
- [ ] Navigation invalidates selections and pending handoffs, aborts active
  requests and does not invoke discovery, a wallet or a transaction automatically.
- [ ] Default-disabled/unconfigured UI states are explicit. No demo rows, fake
  wallet balances, inferred ownership or cached known IDs appear as live discovery.
- [ ] Render project names and returned strings with text nodes/textContent;
  never interpolate untrusted metadata into executable HTML or external URLs.

## Authentication, context and late responses

- [ ] Derive the read-only query actor from trusted config/session identity;
  `browserAuthMatches(config)` must match releaseHash/abiHash/domainHex/configHex.
  A caller-entered wallet address or auth event detail is not authentication.
- [ ] Gateway authorization requires the request actor to equal the authenticated
  actor. The UI adds no arbitrary-wallet or arbitrary-author private-log reader.
- [ ] On `biolab-auth-change`, logout, expiry, account/network/release change or
  configuration reload: abort requests; increment generation; clear lists,
  cursors, selections, coverage, row verification and handoff state.
- [ ] Capture actor/context/query/section/generation for each request. Accept its
  response only while all captured identities and the active controller match.
- [ ] Late success after logout or switching accounts cannot repopulate a list,
  re-enable a button or fill another account's existing-page inputs.
- [ ]401/403 and stale-context responses leave operations closed and request
  session/config refresh; never silently retry as another identity.
- [ ] Use bounded same-origin requests/responses. Do not put cookies, login
  signatures, private workflow IDs, salts or RPC credentials in UI state/URLs.

## Strictly read-only discovery

- [ ] Reading/searching/paging produces no intent, unsigned envelope, reserved
  nonce, workflow creation, signature request, stake, claim or broadcast.
- [ ] No wallet connect/sign/send call occurs on mount, navigation, refresh,
  pagination, row selection or handoff. Login does not authorize transactions.
- [ ] Do not display maxRent, reserved fees, refundable rent, material credits or
  unsettled/potential rewards as liquid SOL/LAB or spendable inventory.
- [ ] Display actual wallet LAB separately from recorded unclaimed Position debt;
  never add potential daily rewards or K weight to a spendable balance.
- [ ] Existing explicit prepare/inspect/simulate/sign/send/reconcile steps remain
  necessary after the user separately requests an existing-page planner.

## Directory and pagination coverage

- [ ] Accept only frozen, bounded search/filter/cursor fields; no user-selected
  program owner, memcmp offsets, RPC method, endpoint, filesystem path or raw plan.
- [ ] Cursor identity binds actor/context, section, filters and snapshot as
  specified by the server contract. A cursor is not transaction authority.
- [ ] Filter/query changes reset pagination and selected rows. Deduplicate by
  canonical verified record identity rather than name or displayed label.
- [ ] Distinguish returned-page count from a verified total. `nextCursor:null`
  alone does not establish full coverage or a coherent whole-wallet snapshot.
- [ ] Show coverage/watermark and incomplete reasons per category. Missing pages,
  limits, index lag, RPC failure, unknown schemas or validation failures cannot be
  silently treated as zero assets or complete discovery.
- [ ] Use discovered/verified rows and bounded subtotals even on
  TRAVERSAL_EXHAUSTED. The frozen contract always has fullWallet:false and
  cryptographicComplete:false; never relabel it as all-wallet completeness.
- [ ] Do not claim all rows were observed atomically at one slot when discovery
  and row validation have different watermarks or pages can change over time.
- [ ] An exhausted traversal with zero verified rows differs from unavailable/
  pending data. Preserve that difference without claiming full-wallet absence.

The current `ReadOnlyRpc` has no wallet/program enumeration method. Existing
material inventory reads are known-ID bounded (8 projects/16 Sources) and derive
only ATAs. Existing known-ID lists/caches do not establish wallet-wide coverage.
The frozen discovery source must address those limits rather than hide them.

## Current works, transfer/consumption and historical rights

- [ ] Current usable work requires actual Root ownership by the session actor
  and LIVE lifecycle; owner equality alone does not make a consumed Root usable.
- [ ] The `roots` section itself lists only current LIVE works. OPEN310's81
  consumed ancestor records are not wallet assets or selectable synthesis inputs;
  do not hardcode81 or a presumed total into runtime UI.
- [ ] Transfer, consumption, revision or registration changes invalidate any
  cached action eligibility. Existing readers/planners recheck before execution.
- [ ] A Root consumed/transferred after probing is rejected or yields CHANGED
  during strict reread; stale rows cannot retain an enabled handoff. A POSITION
  may still validly reference that consumed/transferred Root.
- [ ] Root registration/interval/eligibility indicators are descriptions of the
  verified record, not permission to reuse inputs or count parent and child.
- [ ] Historical rights select actual Position records by immutable beneficiary,
  independently of the current Root owner. A transferred/consumed Root does not
  erase an old beneficiary's accrued debt or unsettled coverage.
- [ ] Key a Position by canonical instance/sequence/Position identity. Different
  pages or ownership/rights tabs must not count the same Position debt twice.
- [ ] Keep ordinary/K status as actual interval information. Do not add a second
  K unclaimed amount to a Position's recorded claimable amount.
- [ ] Distinguish accrued, paid, claimable and next-unsettled hour. Unsettled work
  is not a calculated or guaranteed future payment.

## Material units, non-ATA accounts and Source budgets

- [ ] Show AA/NUC/LIPID/SUGAR as four fixed classes of direct standard units;
  introduce no package opening, disassembly, recovery or reverse synthesis.
- [ ] Verify project/mint/class/owner/account linkage before describing a token
  balance as protocol material. Unknown/foreign tokens are not interchangeable.
- [ ] Keep unconsumed standard-unit token balances separate from Source records:
  Source initial ticks, spent prefix and remaining ticks are inventory accounting
  after intake, not a second copy of the burned token units.
- [ ] Source.unitCount is historical original intake quantity, not currently
  available standard units. Current Source residual budget comes from the32
  remainingTick entries; it is not a refundable token balance or a promise that
  those residual species can satisfy another manufacturing BOM.
- [ ] Never add Source initial/spent amounts back to currently available tokens.
  Show exhausted Sources as historical provenance, not usable balances.
- [ ] Distinguish discovery of a non-ATA token account from support for consuming
  it. The current strict inventory reader derives ATAs only; discovery must not
  silently promise non-ATA manufacturing, transfer tokens or create an ATA.
- [ ] Label unsupported/frozen/foreign token-account forms explicitly according
  to the frozen DTO and preserve incomplete validation/coverage where relevant.
- [ ] Manufacturing handoff remains bounded by the current strict inventory
  reader; a large discovered wallet is not an unbounded material-plan request.

## Three handoff classes: identifiers only, then strict reread

1. Directory to sale/purchase: fill an existing project-read/project-purchase
   entry with the selected project ID and current actor. Require actual
   `project-read` verification before its established purchase handoff. The
   purchase planner then rereads price, global season quotas, project quotas and
   balances; a directory row's issued/cap is not current purchasable quantity,
   a fixed-price promise or proof of the user's CREATE request.
2. Works and rights to existing asset/mining/synthesis pages: fill only actual
   selected instance IDs and, for historical rights, the exact Position sequence.
   Existing `asset-read`/`mining-read` or `synthesis-inputs` must reread before any
   planner is enabled. Respect existing batch/hierarchy bounds. A historical
   Position selection targets its fixed payee and never inherits the new owner.
3. Materials to inventory/manufacturing: fill only selected verified project and
   Source IDs within the existing8/16 bounds. Require `inventory-read` before
   manufacturing planning. A non-ATA discovery row is not an unsupported token
   account injection into that known-ID reader.

- [ ] Each handoff requires an explicit click on a current verified row/selection;
  dispatch normal input/change events so receiving-page drafts are invalidated.
- [ ] Handoff changes fields/navigation only. It performs no API read, planning,
  wallet call, mutation or queued action; rereads are explicit on the existing page.
- [ ] Origin page generation/identity must still match at handoff time. Changing
  actor/query/page/nav or receiving a stale response cannot fill a form.
- [ ] Receiving strict readers are authoritative even when a row was previously
  verified. Discovery never bypasses exact transaction or rent/resource checks.

## Focused acceptance required after implementation

- [ ] All12 views remain mutually exclusive, preserve prior navigation and have
  correct titles; defaults stay closed and no navigation triggers RPC/wallet work.
- [ ] At720/900px height and mobile sizes, scroll/focus reach every sidebar
  entry, including11/12, without covering the page's explicit action controls.
- [ ] Login/account change/logout/expiry/context switch abort active operations;
  delayed responses cannot restore old lists, cursors or handoffs.
- [ ] Request validation covers extra fields, malformed IDs/decimals, cursor
  tampering/binding, limit bounds, actor mismatch and untrusted strings.
- [ ] Response validation rejects foreign context/actor, unverified records,
  duplicate IDs, impossible amounts/flags and responses claiming execution.
- [ ] Exhausted empty, pending empty, limit reached, changed records, unsupported
  records and failed later pages display different truthful coverage states.
- [ ] A matching project beyond the first8 rows is found by continued server
  traversal; empty match pages with pending work are not displayed as final empty.
- [ ] A project can have unused project cap while the global season allowance
  is exhausted. Directory labels do not claim it is purchasable; the existing
  purchase-plan blocks/limits purchase after its actual quota reread.
- [ ] Project creation times may arrive out of chronological order across
  schema/record-ID partitions. No page label, sort badge or empty-page state
  claims latest sales or a complete global chronological ranking.
- [ ] All five wallet sections send query:''; directory normalization/128-byte
  bounds and cursor query binding follow the frozen DTO without local page-only
  search. Total page timeout/continuation does not fabricate successful discovery.
- [ ] Ownership changes and consumed Root records cannot appear as usable inputs;
  old beneficiary rights remain visible and retain exact Position identity/payee.
- [ ] OPEN310 terminal data excludes consumed ancestors from roots while keeping
  all beneficiary Positions, including those linked to consumed/transferred Root;
  a consumption race is CHANGED/rejected, never stale eligibility.
- [ ] Check against the latest reported standard-chain native terminal counts:
  120 Source records (one original standard unit each; AA/NUC/LIPID/SUGAR intake
  30/60/15/15),82 Root records (1 LIVE,81 consumed),61 historical Positions.
  Four material classes do not mean four Source records. Compare against final
  successful Bank evidence when available; these counts are not UI constants
  or a claim that the pending end-to-end Bank acceptance is complete.
- [ ] Materials test standard units versus Source remaining/spent/exhausted
  provenance, ATA/non-ATA distinction and unknown/frozen token forms.
- [ ] Source history can total120 originally ingested units without120 available
  units. Verify labels and subtotals never add original Source.unitCount back to
  ATA balances; remainingTick and fresh strict inventory/BOM checks govern any
  later manufacturing handoff.
- [ ] All three handoffs only fill existing fields/navigation, require reread and
  cannot reuse stale selection; no wallet, nonce reservation or financial mutation.
- [ ] Verify no double debt/weight, invented liquidity, estimated daily guarantees,
  inferred full-wallet totals or fake income; counts obey declared coverage.
- [ ] Focused new UI tests, existing transaction/auth/all10-page regressions and
  root's real bridge-to-UI contract tests pass against the frozen OPEN310 release.

Implementation acceptance and runtime/network coverage are not yet claimed.


## Local UI implementation acceptance

- [x] Added `discovery-contract.js`, `project-directory.js`,
  `wallet-discovery.js`, page11/page12 HTML, scoped styles and scrollable sidebar.
  The existing console action allowlist adds only `discovery-read`.
- [x] Directory focused acceptance passed before wallet implementation. Final
  discovery tests pass22/22 (10 directory,12 wallet); all85 existing auth/console/
  guided/project/manufacture/synthesis/mining/research UI regressions also pass,
  combined107/107 with0 failures in `evidence/discovery-ui-focused-2026-10-25.log`.
- [x] Contract, actor/context/generation checks, late response rejection,
  401/403 fail-closed behavior, all12-view exclusivity, query normalization,
  empty-page continuation, exact same-cursor retry after unknown transport,
  capped DTO validation and safe text rendering are covered by HOST UI fixtures.
- [x] Display separates current LIVE Root, historical beneficiary Position,
  standard-unit ATA, Source remaining ticks and non-ATA/token hints. The1.024940
  LAB example remains only a bounded per-page hint; no actual-spend promise.
- [x] All handoffs fill identifiers/navigation only and invoke no reader,
  planner, nonce reservation, wallet or broadcast. Old pages must be reread.
- [x] JavaScript syntax checks and whitespace checks pass. No native, protocol,
  economics, SDK/bridge/server/gateway implementation was changed by this UI work.
- [x] Root's actual67c terminal records pass real bridge-to-UI DTO validation,
  authentication and HTTP behavior. HOST UI factories are not new Bank execution.
- [ ] Root's actual browser validates navigation/actor switch and sidebar reach
  at720px/900px viewport heights and mobile layout. CSS fixture assertions alone
  do not establish rendered scrolling/keyboard reachability.

The detailed unchecked acceptance items above remain integration obligations;
local fixture success does not establish cryptographic/full-wallet coverage,
production admission, actual provider scan support or deployment readiness.

## Bounded cross-page identifier selection addendum

Root authorized this small usability increment after the initial107 UI checks.
Single-row directory/Root/Position handoffs remain unchanged. A saved selection
does not assert that a previously observed row is still usable.

- [x] Source selection has at most16 unique Source IDs and at most8 unique
  project IDs. Root synthesis selection has at most6 unique currently observed
  LIVE owner IDs. Duplicate adds are idempotent; overflow leaves the set unchanged.
- [x] Persist only identifier entries plus actor/context4/section/query:'' scope.
  Store no Source.unitCount, ticks, value, reward, quality or inferred aggregate.
- [x] Keep the set on continuation/retry within the same section. Clear on a
  fresh scan, section change, actor/context/config change, authorization denial,
  navigation or explicit clear. Failed/late replies cannot restore an old set.
- [x] Support removing one selected ID and clearing all without mutating chain
  state or consuming the current discovery cursor.
- [x] Source set handoff fills bounded known project/source IDs, then requires
  an explicit existing inventory-read. Root set handoff fills synthesis-direct
  IDs/current actor only; it does not infer target/hierarchy/design or eligibility.
  Existing synthesis-inputs must explicitly reread ownership and consumption.
- [x] Test16/8/6 limits, duplicate IDs, project-binding conflicts, cross-page
  continuation, failed-page retry, fresh scan, query/scope/auth/context/nav changes,
  identifier-only contents, removal/clear and zero reader/wallet/plan calls.
- [x] Root actual browser reload verifies readable set counts/limits, adding
  across Source pages and explicit reread wording. No old-row monetary totals.


Selection increment acceptance:115/115 combined UI tests pass,0 failures, in
`evidence/discovery-selection-ui-2026-10-25.log`:30 discovery tests (10 directory,
20 wallet) plus the same85 prior UI/auth/console regressions. This includes one
additional test after the initial29-test checkpoint proving unknown continuation
preserves the ID set and retries the same opaque cursor without auto handoff.
Syntax/whitespace checks pass. The historical107-test log remains unchanged.

Root separately reported6 actual67c bridge/HTTP tests PASS and actual narrow
browser directory discovery -> strict project reread -> purchase-field handoff.
This does not yet attest the new Source/Root set browser path. Root is checking
wallet selection/Position/identity behavior using the actual roughly490px panel.
That narrow-panel evidence must not be described as actual720px/900px-height
viewport acceptance; desktop scrolling remains CSS/structure checked until an
actual viewport check is available. No automatic reads, wallets or mutations
were introduced by the identifier-set increment.


## Actual browser select-option repair

The actual browser found a real handoff bug after the115-test selection round:
Position handoff correctly set page start to its exact sequence and requested
page limit1, but the real guided-page-limit select exposed only5/10/20. Assigning
an unavailable select value becomes an empty string, disabling the strict asset
reader. The earlier permissive DOM fixture missed this browser behavior.

- [x] Add only option1 (single historical segment) to guided-page-limit; preserve
  the normal selected default10 and existing5/10/20 options. SDK1..20 behavior,
  the exact Position sequence, fixed beneficiary and transaction rules are unchanged.
- [x] The discovery DOM fixture now rejects values absent from actual option
  elements. A new test mounts the existing guided controller, selects a discovered
  Position and checks limit1, exact start60, an enabled strict asset-read button,
  the exact legal request body, and zero automatic reader/transaction calls.
- [x] Related post-fix focused scope passes48/48,0 failures, saved separately as
  `evidence/discovery-history-select-fix-2026-10-25.log`; syntax/whitespace pass.
  The old107/115 logs remain pre-fix rounds. Root's pre-fix full suite passed
  898/898 in `evidence/node-implementation-open310-discovery-before-browser-fix-20261025.log`;
  it did not capture the real missing-select-option bug and is not final post-fix
  acceptance. This repair adds one new real-option-constrained UI regression.
- [x] Root reloads the actual browser and confirms exact seq0/limit1, an enabled
  strict asset reader and one actual historical row. Final full-suite output is
  recorded by the root acceptance summary rather than the old898-test log.

Root's latest actual browser scope used1265×712: directory manual ID-free discovery
-> strict project read -> purchase form only; ActorA sees1 LIVE BIO; Root ID set
handoff fills synthesis-direct without auto read; two NUC residual Source IDs
survive next-page continuation as2/16 IDs across1/8 project, then explicit existing
inventory-read succeeds with totalTick10000 and all four ATA balances0. Historical
first-page Positions reference consumed Roots and have paid==accrued (801386 atoms
in the inspected scope,0 unclaimed); material ATAs0; classic LAB hint1024940 atoms;
wallet switch clears rows/sets, ActorB roots0, logout disables discovery, and browser
warning/error lists are empty. Screenshots are under `evidence/ui/`, including
`wallet-discovery-root-20261025.jpg`, `wallet-discovery-inventory-20261025.jpg`,
`wallet-discovery-lab-20261025.jpg` and `wallet-discovery-switch-20261025.jpg`.
The historical single-row handoff has now passed the actual browser rerun. The earlier490px panel is prior evidence, not this current viewport.
Actual720px/900px-height checks remain unperformed; no such visual acceptance is
claimed from CSS structure tests or the1265×712 screenshots.

## Final integration closure

The bridge, gateway authentication, actor separation and strict-reader handoffs
passed six original67c-account HTTP/bridge cases. Actual browser closure passed
eight scoped cases with six unchanged JPEG screenshots, recorded by
`evidence/discovery-browser-acceptance-20261025.json`. The repaired historical
selector reads one real consumed-root Position; the two-ID Source path rereads
actual inventory, and the Root set fills the correct synthesis-direct ID without
calling the input reader. No transaction, real wallet, public RPC or deployment
was exercised. The temporary browser tab/server were closed after acceptance.

Earlier unchecked detailed pre-code bullets state the original test plan; the
implementation/contract behavior is covered by focused SDK, bridge and UI tests
and the final root full suite. The only additional visual sizes explicitly
unperformed here are actual720/900-height browser checks, not a protocol or
production-readiness claim. The actual captured viewport is1265x712.
