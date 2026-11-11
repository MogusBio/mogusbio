# MogusBio — Original Solana Devnet Release

[Official website](https://mogus.store/)

MogusBio is a composable digital biology protocol. This repository preserves the original Solana Devnet release candidate from October 26, 2026.

- [Browse the applications](apps/)
- [Browse the protocol packages](packages/)
- [Browse the Solana programs](programs/)
- [Browse the regression tests](test/)
- [Browse the offline graph fixtures](fixtures/graphs/)
- [Download the source and documentation](mogusbio-devnet-20261026-source.zip)
- [Git bundle](mogusbio-devnet-20261026.bundle)
- [Devnet runbook](DEVNET-RUNBOOK.md)
- [File checksums](SHA256SUMS.txt)

The source package includes the native Rust/SBF programs, lab interface, digital biology verification, manufacturing and composition, staking and LAB settlement, marketplace operations, tests, and dependency locks. All 597 entries in the frozen source manifest are present.

The archived local run passed 1,367 tests. A live Devnet deployment and live business transactions were pending at that checkpoint. See [the release notes](DEVNET-RELEASE.md) for the exact scope.

Clone the repository and run the local regression tests:

```sh
git clone https://github.com/MogusBio/mogusbio.git
cd mogusbio
npm ci
npm test
```

The local Bank fixtures are under `programs/biolab-economy/evidence/` and `programs/transaction-transport/evidence/`. The fixtures represent offline tests.
