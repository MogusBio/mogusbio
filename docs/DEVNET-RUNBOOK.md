# MogusBio Devnet integration

This guide describes the original MogusBio laboratory, its local preview, and its Devnet modules.

## Cold start

Four direct material classes → F1 component (no LAB fee) → component staking → complete eligible chain hour → settlement/accrual → claim LAB → pay higher synthesis fees.

The native component manufacturer burns the required raw material units and records unused fixed species credit. It never reads a player LAB balance or charges LAB. A component root is eligible to stake directly. First claim can prepare the actual LAB token account automatically. A normal four-component cell costs 800,000 atoms = 0.8 LAB; six decimals are fixed. SOL still pays materials, account rent and actual network fees.

The protocol defines a fixed supply of 100,000,000 LAB. Distribution follows the emission schedule, completed hours, and shared weight. Staking activates at the next eligible hour, and that hour must close before settlement and claim.

## Modules and responsibilities

| Module | Responsibility |
| --- | --- |
| `cluster.mjs`, `apps/devnet/rpc.mjs` | Exact 32-byte Devnet genesis, HTTPS pinned transport, lossless integers, no writes by default |
| `operations.market1.json`, native market | Historical 33 operations plus six additive listing/fill/cancel operations; fixed SOL price, whole listing, real material escrow or root custody |
| `market-native.mjs`, `market-bridge.mjs` | Exact codecs/account plans, chain reads, quotes; no browser keys or server player signing |
| `recovery.mjs` | Private durable active intent/envelope per wallet and release; preserve pending transactions on reload |
| `state.mjs`, `appearance.mjs` | Bounded on-chain discovery and actual sealed composition geometry; incomplete/unknown is explicit |
| `runtime.mjs` | Same-origin authenticated Devnet routes with build-hash checks and isolated session actors |
| `service-adapter.mjs`, `services.mjs` | Separate verifier/global operator test identities; durable bounded queue and exact allowed operations with actual expense limits |
| `lab-devnet-client/wallet/ops`, `lab-network` | Wallet Standard and v1 capability, one website business click, automatic defaults/workflow queue, progress and recovery |

Every listing holds an existing asset. Listed roots cannot stake, transfer or be consumed; exit and historical coverage must finish first. Filling/cancelling restores ownership without reissuing discovery, creating LAB or changing the old reward beneficiary. Four-class marketplace trades do not mint additional material. Specimen launch is a sale of an existing single specimen, not issuance of arbitrary materials or new LAB.

## Local interface

`npm run preview:devnet` serves `http://localhost:4318/lab`. The network selector distinguishes **Solana Devnet** and **Local simulation**. The simulator keeps its old private journals under `.data/mogusbio-lab-sim`; `/test-lab` keeps its previous account. Phantom, Solflare and Backpack links are official wallet download entries when no installed wallet is detected.

Wallet rejection stops further signing. Recovery retains pending requests when a player closes the interface, switches accounts or networks, or restarts. Secret research graphs, salts, and signed packets stay out of localStorage.
