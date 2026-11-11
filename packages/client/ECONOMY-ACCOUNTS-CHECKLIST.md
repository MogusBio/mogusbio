# P10.2a shared economy account readers

Status: reader implementation and focused validation complete. This checklist was written before implementation. This layer reads supplied public account records only; it performs no RPC, signing, journaling, transaction planning, or execution. Browser guided operations remain unimplemented by this layer.

- [x] Reuse the existing canonical native header/PDA/domain/config decoder and admit only exact native kinds, schemas, and lengths.
- [x] Decode RootReg kind25/schema1 body260, mirroring every native `root_reg` invariant without inventing restrictions on valid physical end boundaries, backlog restakes, or permanent revocation.
- [x] Decode initialized RuntimeEconConfig kind36/schema3 body304 (`ECOCFG03`), bound to the exact admitted release, canonical mint/reserve/auth PDAs, fixed supply/decimals, hashes, initial seed set, and production-admission schedule (including explicit local-public fixture releases).
- [x] Decode Treasury kind6/schema1 body64 with checked u64 book arithmetic and native reserved/burn bounds; validate financial inequalities separately against actual decoded canonical Classic SPL mint/reserve records.
- [x] Preserve valid reserve donations and external burns: book sum ≤ reserve and supply ≤ fixed supply − burned; never replace those inequalities with equality.
- [x] Decode raw canonical Clock sysvar records of exactly 40 bytes with strict address/owner/non-executable checks and BigInt slot/time fields.
- [x] Test unchanged genuine saved checkpoint records when their public release identity is available; identify synthetic and host-mutated hostile fixtures explicitly.
- [x] Test hostile header/identity/size, body invariants, overflow, schedule, token identity/authority, donation/burn, and Clock cases.
- [x] Run meaningful focused tests and JS syntax check. Root integrates exports/RPC convenience methods separately; no shared module, native program, or environment edits belong to this task.

Validation: `node --test packages/client/test/economy-accounts.test.mjs` passed 8/8; `node --check packages/client/src/economy-accounts.mjs` passed.

The genuine unchanged record test uses `programs/biolab-economy/evidence/actual-final-bio-7fa418ac-a247b6eef233.bin`, SHA256 `a247b6eef23398840a0ed15b81738aa8cdf9e38efc425ce047d889cfe3210279`, with `production-admission-fixture-result58.json`. It reads the actual RuntimeEconConfig, all 82 RootRegs, Treasury and actual Classic SPL mint/reserve, and Clock. Host-only mutations exercise rejection and permitted native inequalities; they do not claim any new native execution or account creation.
