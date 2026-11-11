# P10.1 browser transaction console checklist

- [x] Preserve the local builder, player journey, economy, and dark green design; add a fourth advanced transaction view.
- [x] Default to disabled operation when trusted server configuration is absent. Accept no browser-supplied release, endpoint, or state path.
- [x] Connect a Wallet Standard wallet only after an explicit click. Require the actual `solana:signTransaction` feature, numeric version `1`, and the configured chain. An unverified/null chain disables wallet connection and signing without blocking read-only planning.
- [x] Separate intent entry, preparation, exact-envelope inspection, simulation, signing, and explicit broadcast.
- [x] Display actor, nonce, fee payer, every required signer, resources, request/frame hash, lifetime, and exact public envelope before signing.
- [x] Send the exact envelope `unsignedHex` bytes to the wallet; never use a wallet send feature. Keep signatures only in memory.
- [x] Bound request and response bytes and request time. Render all wallet, server, intent, and RPC data with text nodes.
- [x] Invalidate dependent state on actor/intent changes and refresh. Cancellation-budget edits abort and invalidate in-flight cancellation preparation even before its first envelope exists, preserving primary state. Require successful new simulation and signing after refresh; block failed simulation.
- [x] Preserve original and cancellation envelopes in distinct views/logs. Cancellation uses the original nonce and requires its own inspection, simulation, signature, and broadcast.
- [x] Render exact SDK status decisions. Treat `PENDING`, transport uncertainty, and `UNKNOWN` as unverified; never infer business confirmation from submission.
- [x] Provide explicit status/reconciliation, public envelope export/import, and full external signature import without silent retry or nonce changes.
- [x] Add focused dependency-free tests for gates, byte fidelity, stale responses, bounded transport, and cancellation isolation.
- [x] Run focused tests and syntax/static checks: `node --test test/native-console.test.mjs` passed 11/11; `node --check apps/player/dist/native-console.js` passed. No live wallet, network, signing key, or deployment is used for implementation verification.
- [x] Root agent performed localhost browser layout/integration QA: the fourth view and default-disabled wallet/transaction gates render correctly, execution/recovery regions are readable, and returning to C320 still produces PASS 73/73/q2. Enabled real-wallet and target-network acceptance remain separate release gates.
