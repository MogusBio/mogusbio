# MogusBio laboratory integration

2026-10-26. English game laboratory at `/lab`, with the supplied MogusBio logo,
bright paper surfaces, green ink outlines and mint/lime accents. The classic `/` and
`/test-lab` interfaces remain available. This release is local-only.

## Completed player flow

1. Start or resume an isolated local simulation account.
2. Create a laboratory material sale, or choose an existing project.
3. Buy only the missing AA, NUC, LIPID and SUGAR for one component. An empty
   usable inventory needs one direct unit of each class. The complete 120-unit
   reference is optional; global protocol quotas remain authoritative.
4. Manufacture one component and inspect the owned result. It can be staked, or
   retained for further construction; a cell blueprint is not required to make
   this first component.
5. For cell construction, choose a validated public blueprint or edit its actual
   connections, allocations, capabilities, modes and positions. Save only a
   passing design and manufacture the other compatible functions. Optional
   reference completion reuses existing compatible components.
6. Assemble individual cells, organs and an organism, selecting real owned inputs.
   Optional complete-construction batch actions use the selected validated design.
7. Stake manufactured specimens, advance simulation hours, settle emissions,
   claim accrued LAB, schedule an exit, and wait for its hour boundary.
8. Buy, list, cancel and sell in separate material, product and organism markets.
   Counterparty trades are clearly marked as simulated.

No normal workflow requires navigating back to the classic workspace. The first
account starts with no owned specimens and no raw units. Its 48.225840 starter
LAB is earned by the existing reference model over 338 simulated hours; the
historical specimens and raw units have been transferred to the test counterparty.
Remaining unused species credits are disclosed. This is not a new LAB grant.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `lab.html`, `lab.css`, `lab-ops.css` | Brand, responsive room HUD, next-step guide and operation dialog |
| `lab-scene.js` | Original procedural room, nine selectable apparatus anchors, camera and render lifecycle |
| `lab-scene-geometries.js` | Chemical structures, anatomy illustrations and distinct owned-work forms |
| `lab-designer.js`, `lab-designer.css` | English port-and-node editor over the actual frozen graph |
| `lab-sim-client.js` | Isolated API transport, exact amounts, request journal, retry and session state |
| `lab-ui.js` | Safe DOM construction, names, units, human-readable weight and shared role mappings |
| `lab-panels-supply.js` | Project creation, directory and direct material purchases |
| `lab-panels-production.js` | Single manufacture, layer assembly, staking, settlement and owned assets |
| `lab-panels-market.js` | Three market categories, verified previews and sell/buy/cancel controls |
| `lab-ops.js` | Apparatus dispatch, saved draft state, guided progression and ownership/view synchronization |
| `apps/playtest/lab-actions.mjs` | New simulation actions using the existing launchpad/composition/settlement engines |
| `apps/playtest/lab-market.mjs` | Multi-project asset escrow and atomic simulated SOL/asset delivery |
| `apps/playtest/http.mjs` | Cookie session, origin enforcement, request revision and durable idempotency |

The existing protocol packages, native ABI, Rust implementation and economic
policies are not changed by this UI integration. New behavior is gated behind
the separate laboratory simulation namespace.

## Apparatus routing

| Equipment / activity | Operation ID |
| --- | --- |
| Project launch terminal | `projects` |
| Reagent supplies | `supplies` |
| Microscope / blueprint terminal | `design` |
| Manufacturing instrument | `workshop` |
| Central assembly chamber | `assembly` |
| Incubator / bioenergy | `energy` |
| Exchange terminal | `market` |
| Specimen cabinet | `assets` |
| Anatomical atlas | `atlas` |

Scene raycasts dispatch the same operation IDs as the accessible activity buttons.
Owned component, cell, functional-organ and organism views are distinct. Functional
organs show their actual model cell membership; the illustrated human heart and
brain remain separate atlas studies. Inspecting an owned work frames the central
viewer. Listing, consuming or selling it clears the old owned-work label.

On narrow screens a readable current-task card comes first, followed by a300px
chamber and the activity controls. The next-step card is in page flow and cannot
cover reagent buttons. Vertical touch and wheel scrolling over the chamber scroll
the page. Desktop navigation has its own bounded scroll area; essential player
activities precede visual station controls. Hidden/offscreen rendering pauses.
Low-quality and reduced-motion modes remain available.

## API and account isolation

The preview creates another `createPlaytestHTTP` instance with:

```
basePath: /api/lab-sim
directory: .data/mogusbio-lab-sim/
```

It uses a distinct scope hash, cookie name, cookie path and durable account files.
The old `/api/playtest` namespace and `.data/playtest` accounts are separate.
The cookie is HttpOnly and SameSite=Strict; mutations require the exact local
Host, Origin and JSON content type. All simulator responses are no-store.

Endpoints are `config`, `state`, `start`, `action` and `reset`. Mutations bind
`runId`, `revision`, a random 32-byte request ID, action and exact parameters.
The HTTP layer enforces bounded bodies and per-account serialization, and persists
checkpoint plus the result receipt atomically. Same-ID retries return the recorded
result; changed bodies, stale revisions and stale runs cannot execute again.

New actions include `project-create`, `project-select`, `project-buy`,
`project-buy-kit`, `design-test`, `design-save`, `design-select`,
`manufacture-part`, `manufacture-reference` and `synthesize`. Existing stake,
settle, claim, exit and market action names are retained. The legacy namespace
does not accept these new laboratory-only capabilities.

The browser journals pending requests under `mogusbio:lab-sim:pending:v1`.
Unknown writes stay pending and retry the same body. A proxy response, malformed
JSON, invalid UTF8 or an unexpected success identity cannot discard an uncertain
request. Pending work blocks new writes but permits its own recovery button.
Disposed clients cannot revive session state or submit a deferred start.

Snapshot size is bounded: all designs have metadata, but only the selected graph
is included. Marketplace previews include the actual primitive/profile/target,
quality, weight and B credit, without embedding every graph. No preview action
creates, purchases, manufactures or stakes an asset.

## Fixed rules and accounting

- Four material classes and their species catalog remain fixed.
- Direct units are consumed by the existing material planner. Unused species
  ticks remain inventory; no manufactured work can be unpacked, dismantled or
  recycled.
- Successful synthesis consumes its actual children once. Live ownership,
  compatibility, quality, validation, fees and source provenance are checked by
  the existing composition engine.
- A reference uses 120 direct units: 30 AA, 60 NUC, 15 LIPID and 15 SUGAR. It creates
  60 components, then 15 cells, six organs and one organism. Layer fees burn
  12 + 24 + 12 = 48 LAB.
- Component manufacture alone creates one specimen, not a hidden 60-item batch.
  Explicit reference completion reports its reused and newly manufactured counts.
- The first graph model has 15 functional cells, six fixed organ containers and
  one organism, with at most 440 edges. Legal material ports, allocations and
  capacity rules remain binding. Procedurally drawing a line does not make it
  a valid functional connection.
- Support-only targets 3, 9, 14, 15 and 21 use the frozen 2.0 challenge fixture and
  Q1 output. The UI and batch adapter honor this convention.
- Reward weights shown to players remove the exact 1,000 × 1,000,000 × 4 scaling
  factors. The engine's original integer weight is unchanged. A component displays
  120 weight; a BIO with B7200 and Q1.500 displays 22,680.
- LAB keeps the existing 100,000,000 supply and emission schedule. The laboratory
  does not pay rewards for buying, viewing, listing, cancelling or copying a graph.
- Staking starts at the next full model hour. Exit ends at a future hour boundary.
  Historical accrued rewards remain payable to their original beneficiary after
  an exit or sale. No claim can pay the same debt twice.
- Listings escrow the existing asset. Escrowed, consumed or still-staked specimens
  cannot be reused for staking, sale or synthesis. A cancel returns the same asset;
  a sale transfers it and pays the seller atomically. Self-trade is rejected.

The material/fee/reward ledger shows raw-token balances, unused source ticks,
simulation SOL debits, LAB balances and burned LAB. Prices and quantities use
integer arithmetic, including values above JavaScript's safe Number range.

## Observed player acceptance

The browser test creates a project, purchases its 120 units, edits C04 capability
to 90%, requests a 1.5 challenge, and saves that validated design. A deliberately
overloaded port allocation fails without saving a design. After correction:

| Step | Observed result |
| --- | --- |
| Manufacture one component | Exactly one owned component |
| Complete reference component inventory | Reuses one; manufactures 59 |
| Assemble cells | 15 cells; 12 LAB burned |
| Assemble organs | Six functional organs; 24 LAB burned |
| Assemble organism | One BIO; 12 LAB burned; Q1.500; weight 22,680 |
| Remaining starter LAB | 0.225840 |
| Stake at hour 338 | Registration starts at 339 |
| Settle to hour 340 | 0.449486 LAB accrued |
| Claim | Balance 0.675326; unclaimed zero; repeat button disabled |
| Schedule exit | Ends at hour 341; specimen still locked until boundary |
| Settle to hour 342 | Another 0.449486 LAB remains claimable |
| List for 0.01 simulation SOL | Asset escrowed; no longer shown as owned |
| Cancel | Same BIO returned |
| Relist and simulated buyer purchase | BIO transferred; old owner retains historical reward debt |

Further market purchases, recovery and final totals are recorded in the
machine-readable acceptance evidence and browser ledger capture.

## Verification scope

Tests cover the actual HOST protocol engines, real graph editing/serialization,
origin/session isolation, exact request retries, rollback, snapshot size,
source/asset integrity, geometry lifecycle and all player operations. Browser
acceptance covers the live WebGL room and visible operation results.

This new entrance currently executes **local protocol simulation**, not real
wallet signing, native Solana submission or public multi-user trading. The
existing native tools remain in the retained classic workspace. Connecting these
new screens to real-wallet/native transaction adapters, and implementing any
remaining native market settlement, is separate production work; it is not implied
by passing HOST simulation tests. No public service is deployed by this task.

Physical mobile/low-power devices require their own performance acceptance. The
illustrated chemical/biological forms do not constitute physical synthesis,
protein folding, medical or living-organism validation. Chemical provenance is
retained in `IMMERSIVE-LAB-REFERENCES.md`.

## Final local acceptance, R2

The final full run passed **1,120/1,120** tests, with no failures, cancellations
or skips. The sale-credit focused run passed **44/44**. Browser acceptance
finished with no captured console errors or warnings. A final accounting display
correction labels a negative debit as `SOL credit`; the simulated 0.01 SOL
organism sale is now visible as income, without changing settlement.

After the project creation, material purchases, manufacture, assembly and market
walkthrough, simulation SOL reconciled from 9.855978807 to 9.842263448. LAB
reconciled as 48.225840 - 48.000000 + 0.898972 = **1.124812**, with no unclaimed
debt. The 0.898972 was claimed in two equal installments; the second remained
payable after selling the organism and restarting the local service. A material
purchase/list/cancel returned the same unit, and the purchased component displayed
its actual Q1.000 and weight120 before purchase.

Only the newly created disposable laboratory account was then restarted. It is
ready for the user with no direct material units or owned works, 48.225840 earned
starter LAB, 9.855978807 simulation SOL, and the disclosed 300000 unused NUC
species ticks. The old `/test-lab` account was not reset.

The R2 source manifest binds **540 files**, SHA-256
`3f082163c109c17585fc16b506bdfe5dc46dbaef37dafb67e86c9a76227c29db`.
Its source archive was reopened and every bound file verified. All 45 pre-existing
player files, 226 package files, 150 program files, ten locks and four policy
hashes match the earlier 507-file baseline. The existing native ELF was checked,
not rebuilt. Previous source manifests and archives remain preserved.

Acceptance and ledger evidence:

- `evidence/mogusbio-complete-acceptance-20261026.json`
- `evidence/mogusbio-browser-ledger-20261026.txt`
- `evidence/mogusbio-clean-account-20261026.txt`
- `evidence/mogusbio-source-audit-r2-20261026.json`
- `evidence/mogusbio-release-r2-full-20261026.log`

Source archive: `releases/production/source-archive-20261026-mogusbio-complete-r2.tar.gz`.
Documentation archive and file hashes are recorded separately in
`evidence/mogusbio-delivery-r2-20261026.json`. Neither archive includes local
account directories, cookies, signing keys or generated deployment artifacts.

## Historical usability follow-up

The desktop activity menu now scrolls independently instead of being clipped by
the fixed full-page layout. The narrow-window mission is visible on entry,
activity tabs wrap into two rows, and short operation dialogs scroll as a whole
while keeping their close button and section tabs accessible. The task card no
longer covers reagent controls. Anatomical controls occupy the central column
in desktop mode, away from the task column.

The first material action is `project-buy-first-component {projectId}`. It uses
the existing P2 purchase engine and only supplements the fixed recipe's missing
classes, counting both direct inventory and unused species inventory. Its whole
action rolls back if a later class purchase fails. Repeat requests remain
idempotent; sufficient inventory buys zero and charges zero. It never creates a
component. The browser test bought four units for0.0024 simulation SOL and then
explicitly made one Q1.000 exchange component of weight120.

Full regression: **1130 passed, 0 failed**. Final focused checks: **57 passed**;
final controller checks: **20 passed**. All eight activity tabs, the asset panel's
bottom actions, notes/dialog mutual exclusion, room wheel scrolling, first
purchase and single manufacture were checked in the live505x505 browser.
Desktop rail and anatomical layout were reviewed against CSS constraints; the
tool did not expose a physical wide-screen viewport, so this is not wide-device
performance or physical-device acceptance.

The disposable account was returned to its empty starting inventory for the user.
Current source binding: `source-manifest-20261026-mogusbio-usability.json`,
SHA-256 `038a04ebaa1267f39d6de4729679aae95767fde2d8ab847d1ed6201b7b93a966`.
Evidence: `evidence/mogusbio-usability-acceptance-20261026.json`.
Previous manifests/archives remain historical releases; they were not overwritten.

## Current sketch laboratory revision

The current entrance is a bright cream-paper, ink-outline laboratory. The exact
supplied Logo is preserved. It opens at human eye height: WASD/arrows or movement
buttons walk, dragging looks around, instrument labels and the bottom toolbelt
open the same operations. Inspect switches to an orbit view of the actual owned
component, cell, functional organ or organism. Cached geometry, shared surfaces
and lightweight outlines avoid separate heavyweight renderers per card.

Launchpad distinguishes material projects from single-specimen launches. The
new local `work-launch {workId,title,description,priceLamports}` action offers
exactly one existing owned, unlocked Root through the existing market escrow.
Names/descriptions have strict UTF-8 bounds, metadata survives reload, and status
is derived from the real listing. No duplicate specimen, creator token or LAB
reward is issued. The publisher is the seller, not a claim of first discovery.
The directory remains scoped to one local simulation ledger.

The three illustrated markets provide Browse, Sell, My listings and Activity,
with exact-integer price/quality/weight sorting, name search and folded filters.
Owned assets are selected through image cards. Purchases have a review step.
Material, component, cell, organ and organism artwork is distinct. The observed
organism/organ prefix bug was fixed and covered by a regression test.

A 23-entry visible playthrough purchased124 direct units and consumed120, leaving
one of each class. It reused the first component while making59 more, then built
15 cells,6 organs and1 organism. Both component and organism were staked, accrued
LAB, claimed and exited. Construction burned48 LAB; mining earned0.946536 LAB;
ending LAB was1.172376. The component launch was cancelled and reused, and the
Q2.000/weight23760 organism sold for0.01 simulation SOL. Ending SOL was9.791578807.
The disposable account was then reset to empty inventory for the user; the old
test-lab account was not reset.

1160/1160 full tests,43/43 final UI checks and15/15 compact-design checks passed.
Visible control centres were hit-tested at1280x800,1280x600,390x844 and844x390; no
blocked controls remained in those checks. Final browser logs contained no errors
or warnings. One desktop sample reported75 FPS/195 draw calls; this is not a
physical-device performance guarantee.

The source manifest binds545 files, SHA-256
`101026a30857d16fe455bfdc270543986523f8bbbaa5f9ee7da43bd9e8f4f674`.
All original classic-player, protocol, Rust and lock files match the earlier
507-file baseline; economic policies and the existing native ELF are unchanged.
Evidence is in `evidence/mogusbio-sketch-acceptance-20261026.json`; the verified
source archive is `releases/production/source-archive-20261026-mogusbio-sketch.tar.gz`.

This is local protocol simulation. Native-wallet submission in this entrance,
public cross-session trading, public blueprint edition sales and first-discovery
reward activation/claiming are outside this UI release. It has not been deployed.
