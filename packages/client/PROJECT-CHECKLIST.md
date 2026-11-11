# Native project creation planner — A1

Checks fixed before implementation:

- Read `launchpad::create`, the current admitted ABI and SDK encoder first.
  Create exactly four ordered classes with native cap/price and UTF-8 limits.
- Accept only release/ABI/ReadOnlyRpc/actor/name/classes/creation fee cap/rent
  cap and optional seller. Actor is creator, principal payer, rent payer and
  transaction fee payer. An external seller must be an actual ordinary wallet;
  no nonce, project ID, clock, PDA, account table or catalog override is accepted.
- Read finalized BaseConfig, EconConfig, Clock, ActorNonce, actor/seller, Ops,
  project, four mints and four authorities. Derive project ID from the observed
  actor nonce/business key; missing or system-owned empty accounts are distinct
  from malformed, executable or foreign records. Only project/mints allocate;
  authorities are canonical addresses and are not allocated by CREATE.
- Match native fixed suffix and canonical external-wallet aliases. Validate
  initialized Ops with the strict native reader, and support native lazy Ops.
- Re-read all finalized inputs before ACTION. Changed nonce, account contents,
  allocation state or issuance season requires replanning. Clock regressions
  fail closed. No observed nonce is reserved, incremented or persisted.
- Return one unsigned native action, usable by `nativeActionIntent`, plus
  predicted project/mint IDs for later recovery. The native result is 208 bytes:
  project ID, project address, four mint addresses, creation fee and actual rent.
  A prediction is never evidence that creation executed.
- Creation fee is fixed at 10,000,000 lamports. Reject known insufficient fee
  balance/cap. maxRent is a signed ceiling, not a rent quote; unavailable rent,
  aggregate funding and network fee checks stay explicitly unverified. Planning
  never signs, journals, simulates, sends or contacts a real RPC.

Acceptance: exact recorded native CREATE frame/metas and 208-byte result where
available; otherwise explicitly labelled host-only mutations of recorded Bank
accounts. Cover UTF-8/class/u64 bounds, actual finalized nonce/clock/configs,
fresh/prefunded/malformed allocation accounts, external seller aliases, stale
final reads, funding limits, no journal/send, and later actual Project decoding.

Implemented evidence:

- `create-project-bank-76b35cfb-case-1.json` supplies the real CREATE before and
  after accounts. Its planned frame and all metas match both that signed Bank
  case and sequence 1 in the original full native trace. The exact latest nonce
  cache carries the 208-byte result (10,000,000 fee; 12,284,400 actual local rent).
- Strict result decoding binds project ID/address/four mints and cost ceilings
  to the exact CREATE frame. Actual post-CREATE Project and all four Classic
  mints decode through existing strict readers. Result decoding alone does not
  establish execution provenance or mark an action executed.
- Host-only nonce, prefunding, malformed state, wallet aliases, cap/name/u64,
  stale reads and caller-mutation cases are explicitly labelled in tests.
- Focused CREATE and existing BUY workflow suites pass together: 21 tests.
  No native source, release, ABI, signing, journal or transport path was edited.
