# Native synthesis planning

`src/synthesis-workflow.mjs` plans existing BIOP0R2 operations. It does not create
Roots, sign transactions, issue certificates or broadcast. Actual native BEGIN,
STEP and FINAL still verify every permission, physical transition, fee and CAS.

## Public API

| Function | Inputs and result |
|---|---|
| `decodeNativeSealedSynthesisArtifact` | Actual account, expected ID. Checks native702 metadata/header/PDA/seal/ordinary SHA and canonical payload. |
| `decodeNativeSynthesisVerification` | Actual finalized V4 account plus original actor/contextSlot and optional expected Artifact binding. Returns a branded generation/phase/progress/physical-round/digest snapshot; no client PASS. |
| `planSynthesisPayload` | Actual current Direct Root accounts, original sealed702 Artifacts for upper inputs, freely designed valid graph and actor. Builds canonical Direct74/Leaf70 and unchanged historical capsules. |
| `planSynthesisPreparation` | Payload plan, starting author nonce, expected prior generation, challenge and rent caps. Plans1024-byte PUTs, SEAL and BEGIN. It does not predict provenance/physics STEP count or final nonce. |
| `planNextSynthesisStep` | Branded actual V4 snapshot and caller nonce. Plans one next STEP: one provenance step or at most two physical rounds; phase0 includes its actual parent Root and original Artifact. A different signed caller may crank the original actor's PDA. |
| `planSynthesisRegistration` | Completed actual V4, actual Clock/Task/KSlot and, when required, actual previous activation/RootReg/ordinary Position/Root/Registry. Derives Disclosure/Knowledge and exact old-K stop dependencies. Unknown Task/K state is not treated as absence. |
| `planSynthesisFinalization` | Completed actual V4, fresh unchanged Direct Roots, each actual RootReg observation, registration plan, fee cap and LAB source. Plans mode0 FINAL with current ownership/revision, own ended/covered intervals, exact input order and output identity. |

Actions return `operation,nonce,frame,payload,suffix,dynamicAccounts,instruction`.
These can be passed to the explicit player session. Reading through finalized
RPC and rechecking immediately before an action remain necessary; a structurally
valid account decoder does not prove an RPC honest. The native transaction is
the final authority if state changes between planning and execution.

The same payload builder handles four components to CELL, the frozen child CELL
membership to ORGAN, and six ORGANs to BIO. Higher layers preserve the exact
original leaf capsule bytes and use the frozen `assertChildUnchanged` projection.
They cannot rename or mutate a previously manufactured child's internal graph.
Fee estimates are existing protocol fees:0.8 LAB for one four-leaf CELL,
3.2 LAB for the two-CELL ORGAN16 example and12 LAB for the60-leaf BIO. The planner
does not award LAB or infer mining eligibility from these estimates.

## Private commitment with an independent cranker

`planDelegatedSynthesisCompetition` composes the existing
`planPrivateDesignCommit`; it adds no on-chain operation. Let the author's next
nonce be `n`, and let `C = ceil(exact702PayloadBytes /1024)`:

| Author action | Author nonce |
|---|---:|
| COMMIT hidden H22 | n |
| C public uploads, after commitment confirmation | n+1 through n+C |
| SEAL | n+C+1 |
| BEGIN | n+C+2 |
| FINAL with original salt and commitment | n+C+3 |

Every STEP is sent by a **different** cranker address with its independent
business nonce. The number of inheritance, interval, hashing and physical calls
can vary without changing the author's committed FINAL nonce. No filler SYNC,
nonce renumbering or replacement author is used.

`resumeDelegatedSynthesisPreparation` requires the actual unused Commit31 record
matching H22 and author, and author nextNonce exactly `n+1`. Only then should its
upload actions be used. `planDelegatedSynthesisStep` fixes the independent
cranker and accepts a freshly decoded V4 snapshot for each one-step plan.
`planDelegatedSynthesisFinalization` requires author nextNonce exactly `n+C+3`,
completed task-applicable V4, the same actual H7, original salt, actual unused
Commit31, current Round15/candidate index and approved SeedSnapshot5. It checks
the manufacture window and builds189-byte mode1 plus its exact Snapshot,
Commit and Candidate tail. The author must not insert another core operation
into this nonce window. Failure/stale state must be reconciled; the helper never
changes the commitment to hide a conflict.

The workflow is private local data, not an encrypted artifact service. Uploads
are public. The caller must retain the salt privately and confirm COMMIT before
publishing the graph. Neither the nonce nor a reward is reserved by planning;
competition eligibility, stronger competing submissions and eventual winners
remain native rules. Known opening designs cannot gain a new reward by using
this helper.

## Acceptance scope

`test/synthesis-workflow.test.mjs` exercises three hierarchy examples,
historical capsule preservation, actual-phase account selection, third-party
cranking, forged/stale decoder rejection, inherited-child mutation rejection,
fresh revisions/coverage and fixed delegated author nonce accounting. It also
checks the exact189-byte reveal and candidate tail, changed salt/author nonce,
and confirmation before exposing upload actions.

The codec fixtures originate from an independently accepted local SBF ledger.
Tests explicitly restore LIVE flags or construct private verifier fields only
in host memory to test client encoding. Those fixtures are **not** presented as
new native authority, new manufacturing, a mathematical PASS or issued assets.
The full native/Bank chain and true K competition have separate exact-ELF
evidence. This module's unit results do not replace that evidence or a real
wallet/RPC deployment acceptance.
