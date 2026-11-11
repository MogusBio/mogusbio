# MARKET1 — fixed-price native market

Candidate implementation; separate extended ABI `operations.market1.json` retains
the unchanged core33 operations. No claim of deployment or signed Bank/network
acceptance is implied by this specification. Old ELF/ABI evidence stays separate.

## Operations and accounts

All use the existing ExactFrame152 public prefix8 and actor nonce; normalized
prefix7 below removes BaseConfig exactly as core. Module1301/schema1 opcodes1..6
map to native41..46. No fees, reward, minting, expiry or partial fills are added.
Prices are positive u64 total lamports; material quantity is1..1,000,000.

| Opcode/name | Payload | Normalized suffix, in order |
| --- | --- | --- |
| 1 MARKET_LIST_MATERIAL | project32,class:u8,quantity:u64,price:u64,maxRent:u64,titleLen:u8,descriptionLen:u8,title,description | Listing[w], Project[r], Mint[r], SellerATA[w], EscrowToken[w] |
| 2 MARKET_FILL_MATERIAL | listing32,expectedRevision:u64,expectedPrice:u64,maxRent:u64 | Listing[w], Project[r], Mint[r], EscrowToken[w], Destination[w], Seller[w], AssociatedTokenProgram[r] |
| 3 MARKET_CANCEL_MATERIAL | same56-byte quote payload | Listing[w], Project[r], Mint[r], EscrowToken[w], Destination[w], AssociatedTokenProgram[r] |
| 4 MARKET_LIST_ROOT | instance32,rootRevision:u64,rootRegRevision:u64,price:u64,maxRent:u64,titleLen:u8,descriptionLen:u8,title,description | Listing[w], Registry[w], Root[w], RootReg[w] |
| 5 MARKET_FILL_ROOT | same56-byte quote payload | Listing[w], Root[w], RootReg[r], Seller[w] |
| 6 MARKET_CANCEL_ROOT | same56-byte quote payload | Listing[w], Root[w] |

Title is valid UTF8 1..48bytes; description0..160bytes. Both reject ASCII controls.
The first variable payload has fixed59byte prefix; root prefix66bytes. The fixed
quote fields and request hash bind all effects. Actor is seller for list/cancel,
buyer for fill. Buyers differ from seller. Seller payment destination is derived
from the immutable record, not a caller-selected account.

## Permanent listing

`id=typedHash(26, domain||businessKey)`; Listing PDA=`[bio,market,id]`.
A Listing uses kind39/schema1/header120/body556/record676. All integers little
endian. Header key is listing id. Body offsets:

| Offset | Field |
| --- | --- |
| 0 | magic8 `BIOMKT01` |
| 8 | listingID32 |
| 40 | seller32 |
| 72 | creatingBusinessKey32 |
| 104 | assetKind:u8 (1material,2Root) |
| 105 | status:u8 (0OPEN,1SOLD,2CANCELLED) |
| 106 | category:u8 (1material,2product,3BIO) |
| 107 | material class:u8, otherwise0 |
| 108 | Root schema:u8, otherwise0 |
| 109 | Root target:u8, otherwise0 (component target0) |
| 110 | zero2 |
| 112 | project32, zero forRoot |
| 144 | mint32, zero forRoot |
| 176 | rootInstance32, zero formaterial |
| 208 | quantity:u64, Root exactly1 |
| 216 | totalPriceLamports:u64 |
| 224 | originalRootRevision:u64, material0 |
| 232 | currentRootRevision:u64, material0; list original+1, terminal original+2 |
| 240 | listingRevision:u64, OPEN0 / terminal1 |
| 248 | createdAt:i64 |
| 256 | createdSlot:u64 |
| 264 | closedAt:i64, OPEN0 |
| 272 | closedSlot:u64, OPEN0 |
| 280 | buyer32, zero except SOLD |
| 312 | closingBusinessKey32, OPEN0 |
| 344 | titleLen:u8 |
| 345 | descriptionLen:u8 |
| 346 | zero2 |
| 348 | title48, zero padded |
| 396 | description160, zero padded |

Listings are never deleted or reopened. OPEN→SOLD or OPEN→CANCELLED is atomic with
payment/asset/nonce changes. The precise latest retry returns the existing result;
a different actor/request or second terminal transition cannot repeat delivery.

Material escrow is a separate165byte canonical PDA Token account
`[bio,market-token,id]`, owned by Classic Token and controlled by Listing PDA.
Seller and receiver token accounts must be canonical ATAs for the recorded mint.
Only already-issued exact project/class/mint inventory is transferred. Escrow
must cover the exact quoted quantity; unsolicited excess tokens are not included
in the quote and never block fill/cancel or create mint/reward rights. The retained
zero/residual escrow account has no new public withdrawal or close mechanism.

Roots use trusted in-program custody: list requires actual live seller-owned Root,
expected Root/RootReg revisions, no current ordinary/K registration, actual exit
boundary and complete historical coverage. Existing native movement revocation
runs internally. The owner becomes this Listing PDA and revision increments.
No off-curve user can sign to stake, synthesize, transfer or relist it. Fill/cancel
alone can release the same Root to an on-curve buyer/original seller, incrementing
revision. No CPI exception or generic PDA-transfer permission is added. Fill also
checks current RootReg eligibility, so an intervening verified certificate fault
cannot be sold. Cancel can return a faulted specimen without restoring validity.
Old Position beneficiaries and all accrued/paid LAB remain untouched.

## Common result108

`BIOMKR01`8, listingID32, assetKind:u8,status:u8,category:u8,zero:u8,
listingRevision:u64,currentRootRevision:u64,quantity:u64,totalPrice:u64,
recipient32. On list recipient is escrow authority/Listing PDA. On terminal fill
it is buyer; on cancel it is original seller. It is cached by existing ActorNonce.

Error family6800..6815 covers exact fields/text, listing state/quote, material
identity, ATA/escrow, funds, root custody/CAS and terminal result consistency.
All failed instructions leave business state unchanged under the Solana runtime;
network fees remain outside the program's business rollback/rent cap.

## Devnet bridge and browser contract

`createDevnetMarketBridge({release,abi,core,endpoint,fetchImpl})` is a server-side
wrapper. The trusted runtime supplies the admitted extended ABI and pinned RPC.
It forwards every core action unchanged; all market transactions continue through
core `prepare → inspect → simulate → wallet sign → broadcast → finalized status`.
Planning neither reserves a nonce nor signs, submits, credits or changes custody.
The public session must bind `body.actor` to the authenticated wallet first.

Every plan includes `actor`, `maxRent` and `resources`. Lamport quantities, amounts
and revisions use canonical decimal strings. Resources contain numeric
`computeUnitLimit`, `loadedAccountsDataSizeLimit`, optional numeric `heapSize`,
and string `priorityFeeLamports`. Fee and rent caps remain explicit. Native rent
is quoted from actual missing accounts and real RPC rent minima; base network
fees must still be quoted in the prepare/simulate flow before wallet confirmation.

- `market-list-plan`: material fields `assetType:'MATERIAL',projectIdHex,class,
  quantity,priceLamports,title,description?`; work fields
  `assetType:'WORK',instanceHex,priceLamports,title,description?`.
- `work-launch-plan`: same work fields, with optional `assetType:'WORK'`. This is
  the same single real Root listing, with its own title/description, not another
  token issuance, material mint or reward source.
- `market-buy-plan` / `market-cancel-plan`: `listingIdHex,expectedRevision,
  expectedPriceLamports`; identity, category, mint, project, seller, quantity,
  custody and destination ATAs are obtained from actual records.
- `market-read`: `actor`, optional `category:'ALL'|'MATERIAL'|'PRODUCT'|'BIO'`,
  `mine:boolean,status:'OPEN'|'ALL',prefixHex:'',cursor:null|string,pageSize:1..8,
  page:number`. An opaque cursor is actor/query/runtime/endpoint bound and expires
  after15minutes. Refresh starts a new live traversal.

Plans return `{decision:'ACTION',intent,preview}` or a specific blocked/replan
state without an intent. Four finalized snapshots bind current nonce, actual
asset/listing state and eligibility, including one after rent queries. A state
change or an hour boundary requires a fresh plan. Native execution still rechecks
all state atomically; an unsigned plan is not a reservation or execution proof.
A depleted seller wallet may receive its recorded payment without pre-funding.

Read returns `{decision:'MARKET_PAGE',rows,page,nextCursor,more,coverage,
contextSlot,liveScan:true,snapshotGuarantee:false}`. Rows include `listingIdHex`,
`address,seller,assetType,category,class,scope,target,projectIdHex,mint,workIdHex,
quantity,priceLamports,revision,status,title,description,buyer,createdAt,
createdSlot,closedAt,closedSlot,qualityPpm,B,descriptorHex,canBuy,canCancel,blocked,
availableQuantity,recordVerified:true,observedSlot`; optional/nonapplicable values
are null and u64/i64 values are strings. Buy/cancel use the row's `revision` and
`priceLamports` as the expected quote.

Catalogue RPC queries filter actual program owner, kind39, domain, BaseConfig,
record size676, status/category/seller and a progressively refined ID prefix.
Responses are bounded to256KiB and256candidates per partition; overflow subdivides
the prefix and performs at most4partition reads per page. An incomplete empty page
is explicitly `coverage:'PARTIAL'` with a continuation cursor, never an apparently
empty complete market. Full row dependencies are independently decoded and read
again before returning. This is a live scan rather than an immutable database
snapshot; additions behind a cursor require refresh. RPC errors, malformed
accounts, finality regressions and cursor corruption fail closed.

## Verification evidence and limits

- `evidence/native-market1-build-sbf.log`: real SBF build of the candidate.
- `evidence/native-market1-sbf-final.log`: 8actual SBF tests with official Token
  and ATA processors, including custody, mint conservation, exact retry,
  transaction rollback, old unpaid beneficiary preservation, boundary/coverage,
  donated escrow dust and recreation of a closed destination ATA.
- `evidence/native-market1-bridge-regression.log`: 33HOST tests total: 13market
  read/planning/preparation tests, 6SDK tests, and 14existing core discovery,
  session and public-identity regression tests. Raw core inputs derive from the
  untouched OPEN310 Bank captures; new MARKET1 read snapshots are explicit codec
  fixtures. These do not prove deployment, public RPC, signatures, or Devnet
  business execution. Unsigned preparation/inspection uses the actual existing
  NativePlayerSession path without fabricating network signatures.

The candidate SBF acceptance ELF at the time of that run was
`e1d3ab06c3a1d106d9f621222c128594c5e2a807db2ff0606cfb1a9fc23a7c91`.
It is separate from a later runtime/build/release. Deployment admission, immutable
ProgramData, actual Devnet execution and wallet confirmation remain required for
a public Devnet release. No existing core33 capture or hash is replaced by this
extended profile's evidence.
