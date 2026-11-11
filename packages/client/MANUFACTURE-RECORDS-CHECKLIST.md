# A2 part Artifact and manufacture result readers

Pre-code scope and checks (2026-10-25): read-only decoding; no chain operation,
RPC discovery, journal, signing, material selection, or economic rule changes.

- [x] Reuse strict native owner/header/domain/config/PDA decoding for kind24/schema1.
- [x] Admit only Artifact kind501; validate bounded native total/written/sequence,
  canonical identity, seal marker/time/slot, exact account size and payload prefix.
  A partial prefix does not prove an immutable full payload or manufacture.
- [x] Optionally bind to expected actor and expected immutable payload bytes.
  Completed payload SHA must agree; unsealed and sealed states remain distinct.
- [x] Decode exact108-byte MANUFACTURE_PART receipt only with its exact Frame and
  full artifactBody: the 76-byte Frame is an ARTREF and contains no descriptor or
  material plan. Verify SHA, total length, H19 artifact ID, canonical descriptor,
  catalog, exact F1 BOM and new Source identity/minimal intake rules first.
- [x] Bind result output ID/H3/H8, descriptor, fixed q/B/retired/tick totals,
  four intake burn quantities, intake/debit counts and actual rent ceiling.
- [x] Preserve `businessExecutionVerified:false`; matching decoded bytes are not
  evidence that an observed request executed. Source availability and actual
  execution provenance remain the coordinator/native program's responsibility.
- [x] Test genuine current-ELF trace/ledger bytes and explicitly labeled hostile
  host-only mutations, including truncation, actor/config/PDA/hash mismatch,
  partial/sealed boundaries, descriptor/BOM/result tampering and rent excess.

Exact native bounds: Artifact total1..262144, CHUNK1024, account prefix251;
part manufacture body84..3116 and ARTREF76. This reader does not impose the
workflow's expected sequence on every native Artifact: explicit duplicate old
chunk writes can legitimately advance native sequence. The coordinator must
compare observed sequence/prefix/seal with the frozen workflow stage.

Implemented exports in `src/manufacture-records.mjs`:

- `decodeNativePartArtifact({release,info,artifactId,actor?,expectedBody?})`
  returns exact native metadata, immutable payload prefix, full body only when
  complete, and separate `sealed`/`fullPayloadHashVerified` facts.
- `decodePartManufactureBody({release,abi,frame,artifactBody})` checks the
  authenticated full kind501 body; returns canonical descriptor/materialPlan,
  business/output identity, new Source IDs, four intake burns and counts.
- `decodeNativeManufacturePartResult({release,abi,frame,result,artifactBody})`
  binds the exact108-byte receipt. It returns `businessExecutionVerified:false`.

`node --test packages/client/test/manufacture-records.test.mjs`: 6/6 passed.
Genuine evidence: unchanged76b ledger SHA `6dc5c36b168799263063c53dc3a10f463027e4a484fa0c5eaefecc3a5e5f7cfe`,
sealed part Artifact, accepted full-chain MANUFACTURE Frame and matching actual
part Root. The trace does not retain that historical return cache;108-byte
receipt cases are explicitly HOST-ONLY fixtures, not captured execution output.
Actual108-byte return capture was subsequently completed in the focused signed
local Bank run recorded below. Existing Source availability/class/prefix and
actual execution proof remain the higher coordinator/native program's checks.

Additional strictness: completed unsealed payloads with a wrong full SHA fail
closed even though native PUT can temporarily hold such a prefix before SEAL.
No current ABI, native source, math/economics, shared exports or UI was changed.

## Follow-on actual signed Bank acceptance (fixed before implementation)

Replay only the accepted cold INIT/CREATE/four-BUY prefix. The original trace's
first manufacture occurs at763 after unrelated seed publication; a new SDK part
window begins at nonce6, using the actual purchase balances and native fixed BOM.
All upload/seal/manufacture operations execute as genuine signed Bank V1 txs.
A second independent cold Bank runs the same window with authenticated cap0, so
insufficient-rent testing reaches the actual signed body obligation rather than
merely a mismatched ARTREF cap. The normal Bank covers later-instruction failure,
success, and distinct-lifetime same-Frame retry. Capture every non-executable
referenced before/after account, genuine108 return/cache, burns/prefixes/Root,
nonce, actual fees and rent. No material/nonce/debt/genesis protocol state is
injected. Existing evidence remains immutable and is never re-labelled.


Actual follow-on acceptance completed: `bank_part_result` passed1/1 in5.26s;
22 genuine signed V1 transactions across two independent cold Banks. Each Bank
executes accepted INIT/CREATE/four-BUY plus a newly SDK-planned nonce6..9 part
window, avoiding the unrelated16-seed windows in the original full trace.
An authenticated cap0 full body fails at native6109 with all business state
rolled back. A valid manufacture followed by a failing System transfer also
rolls back. Success captures108 bytes, nonce9→10, one genuine part Root,
four1-unit burns,14,000 spent ticks and18,000 remaining Source ticks. Actual
Root+Source rent is35,628,240 lamports; included signature fee is5,000. Exact
same-Frame retry uses another blockhash, changes no business state and pays
only the local5,000 signature fee. Scope is local Bank, not public RPC finality.

New immutable evidence: `programs/transaction-transport/evidence/part-result-bank-76b35cfb.json`,
`part-result-bank-76b35cfb-case-1.json`, `part-result-bank-76b35cfb.log`.
Maximum669,453 CU /1,695 V1 bytes, total4,112,813 CU. The Node reader suite is
now9/9 passing, including genuine108 result/cache, actual per-material
Mint/ATA/Project burns, Source identities/prefixes/remaining ticks, Root,
nonce and retry/rollback snapshots. Header-only Rust formatting after the run
did not alter native code or test semantics. Full-chain replay was not repeated.
