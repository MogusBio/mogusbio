# CLAIM with first LAB destination setup

Before implementation:

- [x] Native lib.rs checks the actual current top-level instruction from the
  Instructions sysvar; it does not require index0. ATA at0 plus BIO CLAIM at1
  needs no native rule or economic change.
- [x] Only optional `labDestinationSetup: { beneficiary: base58 }` is admitted.
  Payer is the BIO actor, token program is Classic, mint is release LABMint,
  and destination is the canonical beneficiary ATA matching the CLAIM payload.
- [x] One official ATA CreateIdempotent instruction(data1, six fixed roles)
  precedes one BIO CLAIM. Arbitrary setup instructions/transfers are rejected.
- [x] Actual prepare/broadcast reads and strictly decodes the referenced
  Position, matching its ID and immutable beneficiary. Offline inspection only
  reconstructs exact bytes and does not claim RPC authenticity.
- [x] No-setup envelope and transaction bytes retain the existing format. Setup
  metadata is included only when present; refresh preserves it and the BIO
  Frame/nonce. All signatures cover the entire two-instruction message.
- [x] Exact ATA wire, destination/payer/mint/owner negatives and signature tests.
- [x] Prepare, failed simulation/no send, transport timeout and exact replay.
- [x] Independent same-release Bank execution and later BIO failure rollback.

The official ATA program determines its actual Classic165-byte rent. The BIO
maxRent field does not cap that separate setup cost. A failed transaction rolls
back ATA creation/payment and BIO state; ordinary network fees are separate.
No wallet/private key/network submission is invoked by encoding or inspection.

Client acceptance2026-10-25:5 dedicated tests plus the existing session and
real-file archive session tests pass10/10. This includes actual Kit signatures
for the entire two-instruction message, a distinct fee payer requiring both
signatures, exact legacy no-setup bytes, CLI preparation through real file CAS,
wrong actual Position beneficiary, malformed setup metadata, failed simulation,
socket timeout, new-blockhash refresh and duplicate confirmation without send.
These use injected RPC responses. Native Bank atomic rollback is a separate
acceptance record and is not implied by those client tests.

The final affected small suite adds the five native ECON4 wire/account tests:
14/14 pass in2904.226959ms. It verifies the CLAIM destination suffix against the
payload, strict historical Position/Registry/Hour decoders and ADVANCE29 wire,
alongside the setup and session tests above. No native/cold chain was rerun for
this client-only change. See `evidence/lab-destination-acceptance.json`.

Independent actual Bank acceptance: `programs/transaction-transport/evidence/
ata-claim-bank-76b35cfb.json` records13 signed fixture transactions under the
same76b35cfb ELF. The continuation genuinely accrues470890 atoms, transfers the
old ATA balance1024940 atoms to a sink and closes that account, then creates a
new ATA and claims at BIO top-level index1. Both a failing CLAIM and a later
third instruction failure roll back the ATA and BIO state. Included failed
transaction signature fees remain charged. This is a local Bank continuation,
not a fresh cold chain, production admission or a network broadcast.
