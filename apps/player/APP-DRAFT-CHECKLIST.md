# Draft preservation and bounded local experiments

The read-only review identified unapplied JSON being overwritten by graphical
edits, a hung experiment holding the Run button indefinitely, and PASS handoff
retaining an older synthesis mode/encoding. This correction changes local UI
state only. It creates no native intent, wallet call or asset.

- [x] Dirty JSON blocks capability, flow, layout and tier mutation without
  overwriting the textarea or the applied graph. Role selection remains safe.
  Applying JSON, choosing a new reference, Reset, or explicitly discarding the
  unapplied draft are the clear ways to proceed; no confirmation loop is added.
- [x] `/api/validate` requests use an AbortController,20-second timeout and64KiB
  bounded UTF-8 JSON response. Timeout also works when a provider ignores abort.
  Failure preserves the current graph and re-enables Run for an explicit retry.
- [x] Navigating away cancels a pending experiment and invalidates its response.
  An older response cannot restore PASS or alter a newer experiment's controls.
- [x] Starting a new experiment clears the prior result and its handoff, even
  when the graph is unchanged. A captured old Next button cannot navigate.
- [x] PASS handoff opens the existing synthesis plan tab, fills the target and
  clears older encoded graph bytes. Actual input reading, local design import,
  native verification, costs and explicit signatures remain separate.
- [x] Six tests exercise the actual automatically mounted `app.js` with a DOM
  harness and the real local validation API. Timeout/cancellation tests also
  cover a noncooperative provider, bounded bodies and retry behavior.

Focused acceptance:17/17 pass in
`evidence/app-draft-request-focused-20261025.log`:6 new draft/request cases,
8 existing visual-editor cases and3 existing workbench/API cases. Syntax checks
pass. Root owns the full-suite and actual-browser acceptance. The new browser
module requires the explicit `/app-state.js` static route. Frozen scientific,
economic, ABI and native-program files were not edited.
