# Native player session

Checks fixed before implementation:

- One prepared action contains exactly one BIOP0R2 instruction, the pinned ABI,
  release domain/config, original frame and actor nonce. It never accepts an
  arbitrary additional transfer or silently renumbers a manufacturing intent.
  The reviewed CLAIM-only exception atomically prepends the fixed canonical
  beneficiary LAB ATA CreateIdempotent instruction; no other prelude is allowed.
- Preparation reads actual finalized BaseConfig and actor nonce before an
  explicit local journal CAS. No private keys enter the server or journal.
- A wallet-signed packet must preserve every prepared message byte and have all
  required native Ed25519 signatures. A partial Ops signature cannot be sent.
- A network attempt is durably recorded before submission. RPC acceptance is
  PENDING, never proof of execution. A timeout keeps the exact original frame.
- Finalized actor nonce/cache reconciliation determines the business outcome.
  Recent blockhash replacement changes only the transaction lifetime, after
  checking that the original business nonce remains free.
- No implicit retries, timers, signing, deployment or broadcast. Public signing
  fixtures can only be submitted to an explicitly selected loopback endpoint.
- Endpoint/genesis/Base/finality, stream limits and lossless u64 parsing use the
  same restrictions as the read-only client. RPC cannot prove itself honest.

Required acceptance: exact envelope round-trip; modified message/payload/fee
rejection; real signature verification; pending persistence before send; timeout
and restart; duplicate/no longer current nonce; expired blockhash; local fixture
network restriction; storage CAS conflict; wrong-genesis/no network injection.
