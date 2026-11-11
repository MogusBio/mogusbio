# Global settlement keeper

Checks fixed before implementation:

- Plan from actual finalized BaseConfig, ActorNonce, Registry and Clock; decode
  exact native Event38/1, Directory28/2, Position27/2 and Activation17/1 records.
  Missing queued events are errors, not proof that a range is empty.
- Apply only the actual due event at Registry.eventCursor/nextHour. START uses
  the actual tail; END uses actual previous/next neighbors in that order; K
  events use the actual original Activation. No historical Root scan.
- OPEN requires the due event frontier already applied. Empty skip is bounded
  by the actual next event and completed clock hour, with a genuinely fresh
  current Hour. Existing Hour4 advances independently of member debt. Existing
  zero-member hours may be finalized without inventing a member; Hour3 remains
  an explicit legacy/manual boundary.
- Re-read Registry and Clock together before returning an action. If another
  cranker changed the frontier/list, return REPLAN_STALE_REGISTRY without an
  action or journal mutation. Final on-chain CAS still decides execution.
- Closing is an explicit selected historical hour, never a scan or early debt
  expiry: require FINAL/completeness and refund only the saved original opener.
- Pure planning never signs, journals, broadcasts, supplies money or promises
  funded service. Explicit one-step execution requires an injected external
  signer and durable NativePlayerSession; simulate before a deliberate send.
  Pending/unknown/stale results require reconciliation or explicit recovery,
  never silent cancellation or renumbering. No private key storage or timers.
- Test empty/active/open/advance/empty-finalize, START/END/K exact tails, malformed
  identities, missing data, stale clock and the default no-sign/no-send boundary.
  Actual native/Bank capacity remains separately evidenced under its own ELF.

Acceptance: five base planner/CLI tests plus eight independent event/identity/
race tests passed. The full Node integration includes these tests (461/461).
Native same-ELF lifecycle and Bank evidence remain independently scoped.
