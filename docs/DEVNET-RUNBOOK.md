# MogusBio Devnet integration

Updated 2026-10-26. Mainnet and public website deployment remain out of scope. The previous classic UI and persistent local simulation remain available. A real wallet account starts with its actual balances; no simulation LAB, clock, specimens or materials migrate to Devnet.

## Cold start

Four direct material classes → F1 component (no LAB fee) → component staking → complete eligible chain hour → settlement/accrual → claim LAB → pay higher synthesis fees.

The native component manufacturer burns the required raw material units and records unused fixed species credit. It never reads a player LAB balance or charges LAB. A component root is eligible to stake directly. First claim can prepare the actual LAB token account automatically. A normal four-component cell costs 800,000 atoms = 0.8 LAB; six decimals are fixed. SOL still pays materials, account rent and actual network fees.

INIT creates the fixed 100,000,000 LAB reserve and removes mint authority. This reserve is not a starter grant or circulating player balance. Distribution follows frozen emission, real hour boundaries and shared weight. A new stake at reward start does not immediately earn: activation starts at the next eligible hour and that hour must close before settlement and claim. Before reward start/opening seal the UI reports the wait. There is no Devnet “advance hours” button.

## Modules and responsibilities

| Module | Responsibility |
| --- | --- |
| `cluster.mjs`, `apps/devnet/rpc.mjs` | Exact 32-byte Devnet genesis, HTTPS pinned transport, lossless integers, no writes by default |
| `operations.market1.json`, native market | Historical 33 operations plus six additive listing/fill/cancel operations; fixed SOL price, whole listing, real material escrow or root custody |
| `market-native.mjs`, `market-bridge.mjs` | Exact codecs/account plans, chain reads, quotes; no browser keys or server player signing |
| `recovery.mjs` | Private durable active intent/envelope per wallet and release; preserve pending transactions on reload |
| `state.mjs`, `appearance.mjs` | Bounded on-chain discovery and actual sealed composition geometry; incomplete/unknown is explicit |
| `runtime.mjs` | Same-origin authenticated Devnet routes, exact build hash/deployment gate on both native API aliases, isolated session actors |
| `service-adapter.mjs`, `services.mjs` | Separate verifier/global operator test identities; durable bounded queue and exact allowed operations with actual expense limits |
| `lab-devnet-client/wallet/ops`, `lab-network` | Wallet Standard and v1 capability, one website business click, automatic defaults/workflow queue, progress and recovery |
| `prepare/build/loader/deploy` | Public release binding, real SBF v3 build, official Loader-v3 wire, durable signed attempts and immutable code proof |
| `bootstrap`, `bootstrap-executor` | INIT, 17 actually verified opening seeds, and opening seal using real Clock, nonce, transaction and account evidence |

Every listing holds an existing asset. Listed roots cannot stake, transfer or be consumed; exit and historical coverage must finish first. Filling/cancelling restores ownership without reissuing discovery, creating LAB or changing the old reward beneficiary. Four-class marketplace trades do not mint additional material. Specimen launch is a sale of an existing single specimen, not issuance of arbitrary materials or new LAB.

## Local interface

`npm run preview:devnet` serves `http://localhost:4318/lab`. The network selector distinguishes **Solana Devnet** and **Local simulation**. The simulator keeps its old private journals under `.data/mogusbio-lab-sim`; `/test-lab` keeps its previous account. Missing program/initialization/hash verification disables native business actions. Phantom, Solflare and Backpack links are official wallet download entries when no installed wallet is detected.

One website action may still need several wallet signature prompts when a protocol workflow has sequential nonces. Wallet rejection stops further signing. Closing, switching wallet/network or restarting never constitutes chain confirmation; recovery retains the original pending request. Secret research graph/salt and signed packets stay out of localStorage.

## Operator sequence

Private Devnet identities live only under `.data/devnet/keys` with owner-only permissions. They are separate from player wallets. Public addresses are in `.data/devnet/identities-public.json`. Do not reuse them on Mainnet.

After all source edits stop, choose a fresh absolute `DIR` inside `.data/devnet`. Commands use `node apps/devnet/cli.mjs <command> --directory "$DIR"`. The prepared release has a real INIT deadline; if it expires before deployment, prepare a new release/build in a new directory. Never rewrite an already deployed immutable release.

1. `prepare`: real Clock, new domain/nonce, frozen source/ABI/model/policy hashes; no signing/sending.
2. `build`: production-admission SBF v3, source binding checked before and after; no old fixture ELF substitution.
3. `quote`: actual Devnet rent and payer balance, exact ELF length, explicit estimated network-fee reserve. Loader buffer drains into ProgramData, so its rent is not counted twice.
4. `deploy --max-spend-lamports <cap>`: simulate/sign/journal/send/confirm each real step, compare full on-chain bytes, make immutable, save proof. Resume reuses an unexpired unknown packet byte-for-byte. A new lifetime requires finalized expiry and absence of the exact effect. Signed attempts remain archived.
5. `init`, then `seed` in bounded passes, then `seal`. `opening` combines these in dependency order and returns explicit CONTINUE/WAIT_CHAIN_TIME. `node scripts/devnet-opening-watch.mjs --directory "$DIR"` resumes automatically in bounded passes for at most 48 hours, stopping when sealed or an immutable schedule/source precondition fails. Real prewarm is 24 hours; no fabricated clock is available.
6. `configure`: writes the local preview config with exact release and ELF hash. Restart the preview. The service starts only after code verification and waits for chain readiness; verifier/global operators need their own test SOL. Total service spend caps: 0.24 SOL across at most eight research jobs (0.03 each), plus 0.1 SOL global lifetime, excluding bootstrap/player transactions.
7. `readiness`: independently inspect immutable program, Base/Economy, opening, reserve and real Clock. Wallet extension acceptance and actual Devnet business transactions still require genuine network receipts.

The official [Solana faucet](https://faucet.solana.com/) supplies test tokens. On 2026-10-26 the two programmatic requests in evidence returned errors; the independently read deployment wallet balance was zero. These failed requests are not funding or deployment evidence. No Mainnet SOL is required.

## Acceptance scope

HOST/SDK tests, SBF execution tests, real read-only RPC facts, real wallet signatures and real finalized transactions are different evidence layers. Local PASS never asserts a deployed Devnet program. Current evidence and fresh full-suite totals belong in the dated integration acceptance JSON. Real end-to-end Devnet acceptance must cover project create, four purchases, F1 manufacture, actual upper synthesis, staking, elapsed-hour settlement, claim, exit/restart and material/specimen market fill/cancel with two genuine wallet actors.
