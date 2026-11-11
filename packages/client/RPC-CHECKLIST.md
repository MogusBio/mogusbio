# Read-only RPC and native-account acceptance

- [x] Read native BaseConfig, Root, Project, Source and Classic Token readers.
- [x] Fixed HTTPS endpoint or explicitly enabled loopback HTTP; injected fetch
  only, redirects rejected, read-only method allowlist.
- [x] Use official lossless JSON integer parser/stringifier for RPC u64 values.
- [x] Genesis identity, exact Base1048/body928/mode and native PDA/header tests.
- [x] Finalized/minContextSlot, global monotonic context and bounded canonical
  base64 account responses, using real ActorNonce decoder.
- [x] Actual V1 wire resource config and read-only simulation acceptance; a
  successful simulation must never be represented as transaction execution.
- [x] Exact Classic Mint/TokenAccount, Root schema1-4, Project/Source readers.
- [ ] Live RPC honesty, deployed immutable loader/ELF identity, actual wallet
  capabilities and signatures remain independently required.

File CAS design is separate: POSIX local trusted FS, no symlink path, atomic
exclusive lock directory, restrictive modes, fsynced temporary file then atomic
rename and parent-directory fsync. Never reclaim a lock merely because it is
old. Crashed-lock recovery must be explicit and verify the owner process is no
longer alive before an operator removes it. Corrupt state fails closed.

- [x] File CAS implemented with atomic acquisition/recovery gate, restrictive
  files and directories, immutable owner token, temp-file fsync, rename and
  parent-directory fsync. No lock expiry or automatic lock stealing.
- [x] Two actual Node processes race the same version; exactly one wins.
- [x] Actual child-process crashes before and after rename preserve complete
  old/new payload and require explicit dead-owner recovery. Live owner and
  symlink/corruption/adversarial mode checks reject.

Acceptance2026-10-25: new RPC/account tests9/9 and real-file CAS tests5/5.
The combined client suite, including concurrent parent workflow additions,
passes50/50. No actual endpoint, wallet or send method was invoked.
