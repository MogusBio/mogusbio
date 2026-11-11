# P10.2 guided asset and purchase browser layer

Status: browser implementation, focused tests and root localhost disabled-mode integration/layout QA complete. Full Node regression passes525/525. This checklist was written before implementation. This layer is limited to read-only purchase/stake/exit/claim/accrue planning drafts. It does not implement manufacturing or claim complete asset discovery, affordability, or production readiness. Enabled real-wallet/network acceptance remains a separate release gate.

- [x] Preserve the four existing views and add a fifth mutually exclusive “资产与购买” view.
- [x] Default to disabled until trusted same-origin server configuration explicitly enables native operations; never choose a release, endpoint, journal path, nonce, or wallet.
- [x] Send only the specified exact purchase-plan, asset-read, asset-plan, and position-plan bodies with canonical public IDs, decimal integers, and explicit resource/rent/payment limits. Quantities are labeled 标准单位 / 份 and classes remain AA/NUC/LIPID/SUGAR.
- [x] Label asset lookup as known-instance lookup, provide bounded paging, and permit historical Position selection only from actual server-read records.
- [x] Render server facts, previews, decisions and errors with text nodes; reject malformed ACTIONs and retain no usable intent after non-ACTION/error results.
- [x] Invalidate the current plan and abort pending work on every field, Actor, action/tab, or navigation change, including before the first response. Guard late success/error/finally by generation and controller identity.
- [x] Accept one current ACTION only when it carries a valid exact intent and explicit plan-only/no-execution flags. Display nonce as unreserved and preserve immutable beneficiary/recipient facts.
- [x] Explain unsupported open-K exit explicitly; never fabricate ordinary-only exit accounts.
- [x] State that planning does not prove affordability, maxRent is not a network-fee cap, and first LAB ATA setup rent can lie outside native maxRent.
- [x] Make “送入交易检查” an explicit current-plan action that only fills P10.1 Actor/intent, dispatches input events, and navigates to its view. Never prepare/connect/simulate/sign/send automatically.
- [x] Add focused dependency-free tests covering actual event wiring, exact bodies/intent fidelity, default-disabled state, malformed/wait results, all view navigation, and pending-request races.
- [x] Run focused tests and syntax checks: `node --test test/guided-operations.test.mjs test/native-console.test.mjs` passed 19/19; `node --check apps/player/dist/guided-operations.js` passed. No live RPC, wallet, environment secrets, or deployment belongs to this task.
- [x] Root performed localhost browser/integration layout QA: fifth view, purchase and known-instance tabs, default-disabled inputs/buttons, bounded historical selection area and separate P10.1 handoff are visible and coherent. Proofs are `evidence/ui/guided-assets-p10-final.png` and `guided-positions-p10-final.png`. No real wallet or RPC was used.
