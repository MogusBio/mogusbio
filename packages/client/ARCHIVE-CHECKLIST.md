# Durable terminal archive

- [x] A full23312-operation workflow cannot be represented as an unbounded
  single16MiB/10000-entry pending file. Keep those fail-closed bounds and move
  terminal history to durable immutable local storage.
- [x] Namespace binds ABI, domain, H2 and actor; exact canonical terminal export
  binds frame/H3/H4, nonce, original observation, state, attempts and result.
- [x] ARCHIVE2 fsyncs content-addressed batch segments and atomic index pages
  preserving immutable nonce mappings before producing a
  private in-process receipt. A bool, serialized clone or receipt for changed
  entry cannot prune anything.
- [x] Pruning is local CAS, validates all entries before mutation, and never
  changes global finalized observations, nonce highwater or unprocessed entries.
- [x] External storage CAS failure/crash leaves immutable archive plus complete
  old/new main journal, so archived history survives either state.
- [x] Empty/terminal-only journals may observe a newer branded finalized nonce
  without inventing results. Any unresolved pending requires reconcile first.
- [x] Exact receipt, conflict, restart, global highwater and old-result tests.
- [x] Real child-process crashes around archive index/main-journal rename.
- [x]23312 real local durable archive entries, bounded live journal, reopen and
  randomly read old results. This tests storage capacity, not23312 new native
  mining executions; the independent Bank cold-chain evidence remains separate.

POSIX trusted local FS and existing CAS locks remain required. No chain state,
token, material, reward or protocol nonce semantics are changed.

Independent acceptance2026-10-25:

- 23312 large1236-byte ExactFrames were actually fsynced to local ARCHIVE2,
  reopened and historical results checked, in39990.085ms. Maximum live batch
  was3,074,609 bytes; the pruned main journal was610 bytes. Earlier per-record
  blob/index storage took282633.541ms and was replaced by batch segments and
 1024-nonce pages. The first pre-refactor PDA-heavy run exceeded its300s test
  timeout; it is not counted as a pass.
- True child-process failures before/after archive-index rename and after the
  pruned main-journal rename preserve complete old/new journals and old results.
- Private receipts reject bools, JSON clones, mismatched entries and duplicates;
  archive snapshots detach caller objects before their first await.
- ALREADY_PROCESSED preserves its first terminal observation through archive,
  failed main CAS, later nonce advancement and re-archive. It never asserts the
  original Frame executed or invents its result.
- Real FileStore/session512-entry compaction, reopening status0 from archive,
  and preparing nonce520 after another device advanced nonce all pass.

Exact API and local-format details are in RPC.md. These tests certify local
storage/recovery behavior; the separate native/Bank cold-chain record certifies
protocol execution.
