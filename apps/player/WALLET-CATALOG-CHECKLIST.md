# Mainstream Solana wallet entry: implementation gates

Prepared2026-10-25 before implementation. Scope: visible wallet choices and
strict selection of installed Wallet Standard objects. No change to the native
v1 wire format, protocol, economic rules, signing verifier or network policy.

- [x] Always list Phantom (幽灵钱包), Solflare and Backpack; keep other registered
  Wallet Standard wallets visible. Uninstalled cards contain only fixed official
  HTTPS destinations and never auto-open/download/install anything.
- [x] A brand name is a display grouping, not an identity or capability proof.
  Same-brand registrations now share one visible entry; the selected exact object remains pinned, with no merged feature/account authority.
- [x] Show connection, message-login and independent numeric-v1 transaction
  capabilities separately. String1, v0-only and signAndSend-only never pass the
  transaction gate. Unknown/unconfigured service chain is not mainnet or ready.
- [x] Read-only config is bounded, same-origin, no-store and generation guarded.
  Failure/late response leaves network capability unknown; provider errors are
  not printed. No arbitrary provider URL or external icon is rendered.
- [x] A card click selects the exact still-registered object in the existing
  authentication controller and may explicitly connect it once. A card cannot
  sign a message, sign/send a transaction, grant a session or manufacture assets.
- [x] Existing auth-controller event/nonce/context/session invalidation remains
  authoritative. Unregister, account/wallet changes, refusal and stale connection
  requests cannot restore the previous session or trigger a later auto-connect.
- [x] Native-wallet synchronization only chooses an existing option bound to the
  exact live object; brand names and changed registry order are not identity. It never
  connects or signs through the transaction controller.
- [x] Test the three brands, other wallets, missing installation, fixed URLs,
  duplicate names, exact object selection, malformed/string/v0 capabilities,
  unknown/wrong chain, late registration/removal/config, rejected connection,
  no automatic wallet calls and existing authentication regression behavior.

## Official destinations verified2026-10-25

- Phantom: https://phantom.com/download
- Solflare: https://www.solflare.com/download/
- Backpack: https://backpack.app/

The official pages identify wallet/extension downloads. Their inclusion is not
an assertion that each currently installed version supports native numeric-v1
transactions. Actual wallet features remain the gate. Parent reviewed Solana's
larger-transaction upgrade guidance separately. Desktop/provider, real RPC and
mobile-device acceptance remain required; this module adds no mobile deep-link
or alternative legacy/v0 transaction path.

## Acceptance

Player-shell integration addendum: after an accepted explicit wallet-card
selection, open optional `#player-login` while closing the wallet dialog so the
next explicit challenge/sign actions are visible. Do not request a challenge
or signature; preserve behavior when the optional shell is absent. Covered by
the additional focused optional-shell test below.

Local implementation and40/40 focused cases pass,0 failures. Evidence:
`evidence/wallet-catalog-focused-20261025.log`. This includes11 catalog cases,
14 authentication cases (four new card-selection/integration cases),11 existing
console cases and4 unchanged SDK wallet cases. Earlier37/38/39 rounds are
retained as superseded focused logs.

Main cards use plain connection/login/network/update status; chain names,
numeric-v1 and independent-signing diagnostics are collapsed under compatibility
details. Tests check primary copy, exact native registry index, fixed official
URLs, duplicate names, revoked objects, queued logout/unregister, refusal, stale
network responses, actual panel-to-auth contract and zero implicit signatures.

No actual Phantom, Solflare or Backpack extension is installed or operated for
this HOST test. Parent owns actual browser/API integration and the final full
suite/source freeze. Real provider/device/transaction acceptance is not claimed.

The optional-login-shell increment passes12/12 wallet-catalog cases (including
one additional shell test),0 failures, in
`evidence/wallet-player-login-focus-20261025.log`. This rerun is a subset of the
previous40-case combined scope plus the one new case; counts are not added.

## Root integration closure

The final local full suite passes936/936,0 failures. Actual490x490 browser
checks compact six-entry navigation and keyboard scroll reach, collapsed login,
Phantom/Solflare/Backpack official-entry cards, explicit public-test-wallet
connection and message login, short verified identity, readonly actor in player
mode, advanced fallback, exact SOL conversion and invalid-amount clearing, and
named type4 purpose selection. No actual mainstream extension is installed here;
real wallet transaction, mobile app/device and network acceptance remain pending.
See evidence/player-ux-wallets-browser-20261025.json and the final root acceptance.

## Single brand entry correction

User requires one visible entry per wallet brand. OKX/OKEX/OKX Wallet/OKEX Wallet
use strict aliases; generic same-name registrations are grouped in the modal,
auth selector and transaction selector. Capability ranking chooses one actual
object, never a combination of objects. Existing selected live objects stay
pinned across reorder/new registration/capability changes. Removal clears the
existing authorization/signatures, and no refusal triggers a fallback connect.

Visible option bindings use WeakMap identity, not a brand label or the latest
registry index. An explicit card choice rebuilds the representative option
before selecting its index, avoiding an empty real-select value. Solana chain,
numeric-v1, account and signature checks remain unchanged. Focused integration
passes46/46 in evidence/wallet-dedup-integration-20261025.log; full regression
is recorded separately in evidence/wallet-single-entry-acceptance-20261025.json.
