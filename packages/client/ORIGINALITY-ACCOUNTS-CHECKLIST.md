# A4 strict native originality account readers

Pre-code checks fixed on 2026-10-25. Scope is observed account decoding only;
no RPC, native instructions, signing, deployment, economics or UI changes.

- [x] Reuse the strict native account header, owner, exact size, domain/config,
  schema, PDA/bump and record-key checks. Missing/System-empty accounts are not
  fabricated as initialized records.
- [x] Decode exact Task30/1, KSlot34/1, Commit31/1, Round15/2, Candidate32/1,
  Winner16/1, Knowledge33/1, Disclosure14/1, Safety20/2 and Snapshot5/1 bodies.
  Validate native flag/ref encodings, identities, counters, times and reserved
  ranges; expose immutable data separately from contextual eligibility.
- [x] Commit timestamps must fall in the recorded round's COMMIT window;
  Candidate timestamps must fall in its reveal window. Bind Candidate H3/H8,
  canonical nonce opId, H18 ID, disclosure ID and round/index PDA.
- [x] An active corrected Knowledge kind2 requires the actual Safety account
  matching its address, qualified correction admission/index and authoritative
  effective origin. Revoked history does not become eligible knowledge.
- [x] OpeningSnapshot binds the supplied validated current16 release's exact
  initial set, reward cutoff, minimum seed count, frontier and H15 identity.
  Historical14 data must never be relabeled as the current opening.
- [x] Expose all fields needed by bounded round finalization and K activation.
  Winner recognition alone does not certify current K activation eligibility.
- [x] Test genuine current76b saved ledger records, explicit HOST-only missing
  record fixtures, corrupt/truncated/foreign headers/PDA/context, malformed
  flags, references and inconsistent counters. Tests execute locally only.

Planned exports: decodeNativeOriginalityTask(release, account),
decodeNativeKSlot(release, account, {generation} = {}),
decodeNativeCommit(release, account, id),
decodeNativeRound(release, account, round),
decodeNativeCandidate(release, account, {round, index}),
decodeNativeWinner(release, account, id),
decodeNativeKnowledge(release, account, index, {safetyAccount} = {}),
decodeNativeDisclosure(release, account, design),
decodeNativeSafety(release, account, {epoch, id} = {}), and
decodeNativeOpeningSnapshot(release, account).

Account bytes are observed state, not proof of a fresh transaction's execution.
Cross-account permissions, current task generation/high-water, live Root/Position
and round boundaries remain the responsibility of the actual-state planner.

Acceptance: syntax check passes; focused and existing account/competition/synthesis
regressions pass 22/22 (11 new tests). Evidence log:
`evidence/originality-accounts-current.log`. Genuine current76b ledger SHA
`6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe`
provides unmodified Task, KSlot,16-seed Snapshot, Round,17 Knowledge rows and37
Disclosures. Commit/Candidate/Winner/Safety and transitions missing from that
checkpoint are explicitly HOST-only record fixtures, not captured native results.

Reader limits: account inputs do not themselves establish finalized RPC provenance,
current rent exemption or execution of a pending request. Candidate has no stored
verified/ranked flag; Winner recognition does not imply K eligibility. Safety's H3
business record key is compared when an expected `id` is supplied; its epoch PDA
and native header remain checked when reading solely from observed state.
Historical faulty Knowledge links remain visible through
`disclosureIdentityMatches:false`, tagged revocation/fault references and
`eligibilityVerified:false`; active corrected kind2 always needs authoritative
Safety. Current planners still need mutually consistent actual Task/Root/Position,
round count, generation, time and account crosslinks before constructing an action.
