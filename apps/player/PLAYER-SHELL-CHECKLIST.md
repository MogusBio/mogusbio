# Player shell simplification: pre-code gates

Historical scope below: the original six-destination shell. The current seven-group navigation, preserved twelve original leaves plus three market pages, is covered by NAVIGATION-CHECKLIST.md and the unified navigation acceptance. Original safety checks remain in place.

Scope: player navigation, progressive disclosure and exact fee display only.
No protocol, economics, request validation, signing, transaction, recovery or
native source changes. Existing field nodes/IDs and controller listeners stay.

- [x] Keep all12 original data-view values, one nav node each, and all old views.
- [x] Show6 main player destinations, accessible sale/research destinations,
  and expandable help/advanced tools. Programmatic original handoffs remain valid.
- [x] Show each page's present purpose and next action without executing it.
- [x] Group technical identity/IDs/code and original responses in expandable
  details; advanced mode reveals them. Preserve source nodes and original values.
- [x] Verified public login actor can be shown and made readonly. No event
  detail, entered address or cached DOM may fabricate an authenticated session.
  Local operator manual fallback remains accessible in advanced mode.
- [x] Keep necessary fees visible. SOL9/LAB6 mirror conversion is exact BigInt,
  rejects negatives/exponents/extra precision/overflow, and emits original input
  on intentional edits only. Never silently increase a spending limit.
- [x] Mirror follows original field disabled state and programmatic updates;
  invalid text cannot retain a previously valid spend ceiling.
- [x] Existing config/read/plan gates remain authoritative. No automatic wallet,
  plan, signing, broadcast, nonce reservation, purchase or manufactured output.
- [x] Auth/context changes discard stale shell identity. New labels cannot make
  an old plan/selection valid. Navigation still invokes old invalidation handlers.
- [x] Add visual-designer container only; separate owner supplies graph editing.
- [x] Focused shell tests and existing player navigation/controller tests pass.
  Actual browser inspection remains root-owned; no network/wallet compatibility
  or production admission is asserted.

## Local implementation closure

Player shell focused11/11 passes in `evidence/player-shell-focused-20261025.log`.
Existing auth/console/guided/project/manufacture/synthesis/mining/research/directory/
wallet UI regression120/120 passes in `evidence/player-shell-existing-ui-20261025.log`.
The earlier7/9 failure was an incomplete test fixture lacking classList.add,
retained as `evidence/player-shell-fixture-incomplete-20261025.log`; production
validation was not weakened. Syntax checks pass. Stable MutationObserver sync
is idempotent and close disconnects it.

The shell defaults to six player destinations; laboratory sales and originality
remain accessible. Login starts collapsed. Technical ID/Actor fields keep their
original nodes in per-page drawers; raw records are expandable. Only verified
public identity is displayed as logged in, with accidental Actor edits readonly
in player mode. Advanced/local manual fallback remains available. Necessary
fees stay visible as exact SOL9/LAB6 mirrors of the original integer ceilings;
mounting authorizes no spend, invalid text clears old ceilings, and0 stays0.
Type4 now asks for a named functional-cell purpose; generic types derive only
their fixed profile0. No plan, wallet, transaction or broadcast is called.

Added normal static route required: `/player-shell.js`. Root owns that route,
new visual-designer implementation and actual browser acceptance. This file
adds its visible container and matching visual/wallet-card styles only. The
original12 views, field IDs, data-view identities, request contracts, permissions,
explicit reads/signatures and economic rules remain. Focused checks are local
DOM/HTTP fixtures, not real wallet or network compatibility evidence.

## Narrow-screen follow-up

Root's actual490x490 screenshot showed the initial navigation/account chrome
pushing the canvas below the fold. Mobile CSS now uses a single horizontal,
scrollable6-destination row beside the brand, with sale/research and expandable
advanced tools kept in a compact secondary row. The primary row is keyboard
focusable, keeps all buttons, and has no clipped fixed height. Account toolbar
uses one line; its duplicate note is visually omitted only on small screens.
Login summary stays closed/compact and all login controls remain in its drawer.
The builder's purpose card is compact without hiding its action.

Post-change focused12/12 passes in `evidence/player-shell-focused-20261025.log`.
Only HTML/CSS and this structural regression changed; no player-shell/controller
logic, identity gate or fee rule changed. Root owns actual browser rerun and the
single final full regression. Earlier120 existing UI checks remain scoped to the
preceding implementation; no repeated120-run is claimed for this CSS increment.

## Root integration closure

The final local full suite passes936/936,0 failures. Actual490x490 browser
checks compact six-entry navigation and keyboard scroll reach, collapsed login,
Phantom/Solflare/Backpack official-entry cards, explicit public-test-wallet
connection and message login, short verified identity, readonly actor in player
mode, advanced fallback, exact SOL conversion and invalid-amount clearing, and
named type4 purpose selection. No actual mainstream extension is installed here;
real wallet transaction, mobile app/device and network acceptance remain pending.
See evidence/player-ux-wallets-browser-20261025.json and the final root acceptance.
