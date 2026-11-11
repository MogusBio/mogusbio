# First LAB claim destination

`labDestinationSetup` is a strict optional field on a prepared native envelope
and CLI intent:

```json
{"labDestinationSetup":{"beneficiary":"POSITION_BENEFICIARY_ADDRESS"}}
```

Only CLAIM_POSITION accepts it. The object has exactly one field. It cannot
specify a payer, mint, token program, ATA address, instruction list or transfer.
`buildClaimLabDestinationSetup` derives the canonical Classic Token ATA for the
release's LABMint and that beneficiary. The derived address must equal the
CLAIM payload destination; the funding payer is the BIO frame actor. The actual
Position is read during session preparation and before submission, strictly
decoded and checked against the payload PositionID and immutable beneficiary.

The resulting transaction contains exactly two instructions: official
Associated Token CreateIdempotent, then the unchanged BIO CLAIM. Its six roles
are actor payer, derived ATA, beneficiary, fixed LABMint, SystemProgram and
ClassicToken; its data is the single byte1, matching the
[official Associated Token interface](https://raw.githubusercontent.com/solana-program/associated-token-account/main/interface/src/instruction.rs).
The BIO program's existing top-level check reads the actual current instruction
index, so the CLAIM may run at index1 without changing native business rules.

The entire V1 message, including ATA account roles and instruction bytes, must
have all required signatures. An independent transaction fee payer is supported
by the existing complete-signature verifier, while ATA funding remains the actor.
The BIO frame, H4 and business nonce remain unchanged. Optional setup is omitted
entirely from old no-setup envelopes; their encoded message bytes remain the
same. Offline inspection reconstructs the complete message and checks byte
identity, but cannot establish that any RPC account response is authentic.

`NativePlayerSession.prepare` accepts this metadata and never signs or sends.
`refresh` retains the same setup, frame and nonce while replacing the recent
blockhash. `broadcastSigned` is still an explicit separate operation, verifies
the complete exact signed message and persists the attempt before submission.
`planAccruedPositionClaim` can produce the metadata when the actual destination
account is absent. No extra protocol request, nonce account or reward exists.

CreateIdempotent makes a retry safe when the correct ATA already exists. It
rejects an existing incompatible ATA. Failure of either instruction rolls back
the transaction's state changes; timeout alone still means UNKNOWN until the
original BIO nonce is reconciled. A matching finalized result prevents another
submission by the client. A successful simulation is neither execution nor a
verified business result.

The official ATA program charges the actual cluster rent for its165-byte Classic
account to the actor. BIO payload maxRent applies to BIO's own account creation;
it does not cap the preceding ATA program's rent. Network fees are separate from
transaction state rollback. This is an existing Solana account requirement,
not a new protocol economic fee.

Five dedicated client tests cover canonical wire, exact old-envelope bytes,
single/two signer cryptography, arbitrary metadata rejection, actual beneficiary
checks, wallet tampering, failed simulation, timeout/refresh, finalized replay
and CLI file-CAS preparation. Combined with the existing session/archive tests,
the affected10-test suite passes. Those injected-RPC tests do not claim actual
on-chain execution. Independent actual Bank acceptance now records13 signed
fixture transactions using the same76b35cfb ELF, genuine newly earned470890
atoms, an actually closed old ATA, a successful new ATA plus CLAIM at index1,
and complete state rollback when either the CLAIM or a later third instruction
fails. Failed included transaction fees remain charged. See
`programs/transaction-transport/evidence/ata-claim-bank-76b35cfb.json`; this is a
local Bank continuation with no network broadcast or production admission.
The final affected small suite including the five native ECON4
wire/account tests passes14/14. Its evidence is recorded in
`evidence/lab-destination-acceptance.json`.
