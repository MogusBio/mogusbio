# MogusBio — Original Solana Devnet Release

This is the original MogusBio protocol with its native Solana programs, laboratory application, and tests. The source is from the frozen October 26, 2026 Devnet release candidate.

The candidate passed the archived local test run with 1,367 tests. The archived build was prepared for Solana Devnet. A Devnet deployment and live business transactions were still pending at that checkpoint.

The source includes the laboratory and player client, native Rust/SBF programs, verification models, manufacturing and composition, staking and LAB settlement, marketplace operations, specifications, and dependency locks.

The export contains the complete 597-file frozen source manifest and the associated documentation. It excludes LC1, runtime data, wallet keypairs, generated build records, and deployment quotes.

See [the Devnet runbook](docs/DEVNET-RUNBOOK.md) and [the frozen source manifest](releases/production/source-manifest-20261026-mogusbio-devnet-final.json). From the source root, use `npm ci` and `npm run preview:devnet` for the local preview.
