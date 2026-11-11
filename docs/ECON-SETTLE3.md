# ECON-SETTLE3: ordered events and active membership

This is an explicit predeployment release replacement. There is no online
migration of previously deployed accounts. Old ECON-SETTLE2 vectors remain
reference economic vectors; V3 changes indexing and execution, not emission,
quality, weights, per-hour floor, beneficiaries, paid CAS or historical debt.

## Required proof before implementation

1. Every ordinary start and end and every trusted K start/end is scheduled at
   the next boundary of an actually observed nonnegative Clock timestamp.
   Registry seconds high-water rejects rollback. Before rewardStart, starts are
   zero. Reward events clamp only to H_END; physical movement locks keep their
   actual end. Therefore appended event due hours are nondecreasing.
2. An append-only continuous queue has a program-owned count/cursor. Events
   can only be created by validated stake/exit/Task hooks. Before opening h,
   the cursor must be at queue end or the actual next event must have due>h.
   Skipping or supplying a later account cannot prove this condition.
3. Apply START inserts one inactive lifetime Root node, snapshots its immutable
   Position, and adds that Position's exact weight. END removes the same
   Position, checks both neighbor backlinks, and subtracts that same weight.
   Head/tail/count/weight start empty and only these verified transitions change
   them. This inductively proves that the linked list is the complete membership
   set and its cached weight is the exact sum, without rescanning dead Roots.
4. All events due<=h are replayed before OPEN(h). Any newly scheduled event
   after OPEN has due>h because h is already closed and Clock cannot roll back.
   An apply call cannot process due>Registry.nextMaterializeHour. Therefore
   membership is immutable throughout h's materialization.
5. OPEN snapshots head/tail/count/normalWeight and the unique actual K. Each
   materialization must read exactly its saved next directory, its saved
   Position, and its backlink. Count and terminal tail/MAX must agree. The
   caller cannot omit a Root, repeat one, or substitute today's owner.
6. Each active Position receives floor(Budget_h*(Wnormal+sameRootK)/D_h) once.
   Hour cursor and Position.nextUnsettledHour advance atomically, then residue
   is sealed once. Existing accrued/paid and immutable beneficiary are retained.
   Thus every hour is economically identical to the complete V2 scan.

## Explicit native wire version

- Registry kind26/schema2 body256 (376 total). Old body0..39 remains: lifetime
  rootCount, nextMaterializeHour, secondsHighWater, KHistoryCount, enqueuedKStartCount.
  Append eventCount:u64@40, eventCursor:u64@48, lastEventHour:u64@56,
  activeCount:u64@64, headDirectory:u64@72, tailDirectory:u64@80,
  normalWeight:u128@88, Kactivation32@104, Kinstance32@136,
  Kbeneficiary32@168, Kordinary32@200, Kdirectory:u64@232,
  Kweight:u128@240. Empty directory pointers use MAX; absent K uses zero keys,
  MAX directory and zero weight. The old K cursor becomes enqueuedKStartCount in V3; each global Activation can enqueue START exactly once, in order.
- Directory kind28/schema2 body138 (258 total). Immutable old81B followed by
  active:u8@81, PositionID32@82, rootSeq:u64@114, prevDirectory:u64@122,
  nextDirectory:u64@130. Inactive uses zero PositionID/rootSeq and MAX links.
- Event kind38/schema1 body177 (297 total), PDA [bio,mining-event,seq:u64].
  Body seq:u64@0,dueHour:u64@8,type:u8@16,instance32@17,PositionID32@49,
  directorySeq:u64@81,rootSeq:u64@89,ActivationID32@97,businessM32@129,
  createdTime:i64@161,createdSlot:u64@169. EventID is H14(D||kind38||seq).
  Types0/1 ordinary START/END; 2/3 trusted K START/END. Ordinary activation key
  is zero. K always references its actual ordinary Position and Activation17.
- Hour kind18/schema3 body361 (481 total). Old297B retains economic fields;
  rootCutoff/rootScanCursor now equal the complete activeCount, status begins
  READY. Append headDirectory:u64@297,tailDirectory:u64@305,
  nextMaterializeDirectory:u64@313,previousMaterializeDirectory:u64@321,
  real creation rentpayer32@329. CLOSE_FINAL_HOUR returns this global Hour's
  SOL rent only to that saved payer after complete finalization. It never uses
  the identity of the last materializer or permissionless closer.
- Position27/schema2 remains byte-identical. RootReg25/schema1 remains byte
  identical; its obsolete settlement interval scan cursor is reserved zero in
  V3. Coverage and movement locks remain authoritative.

## Acceptance checklist

- [x] Explicit new release and no claimed online migration.
- [x] Non-omission, historical ownership, event ordering and frozen membership proof.
- [x] Node differential hourly goldens against ECON-SETTLE2, including K/transfer/pending cancellation/downtime, restake during backlog, exact checkpoint restoration and rejection of skipped END/START transitions (6 tests).
- [x] Native ordered queue + exact active-list operations and strict event PDA/cursor.
- [ ] Native real Task/Winner K hooks, unique K and same-Root combined floor.
- [x] Native final-hour zero amounts, old debt, restart and real transaction rollback (15 ordinary SBF tests).
- [x] Native inactive historical Roots are not touched by later hourly work (4 real manufactured Roots, later empty hours have no historical Root/Position/Directory accounts). Full 60-Root consumed-chain integration remains a separate synthesis acceptance gate.
- [x] Updated native transport/permissions and ELF-bound ordinary acceptance evidence; real K and Safety are separate gates.
- [x] OPEN remains frozen through later stake/exit and early event application attempts.
- [x] Final global Hour SOL rent close, original-payer-only refund, no reopening, no debt loss, retry and transaction rollback.

No new fee, token, emission, manufacturing yield or score parameter is
introduced. Event/Position/lifetime provenance remains permanent; only active
Roots are visited per hour. Work is O(events applied + active Roots per hour),
not O(all historical manufactured Roots per hour).

## Lifetime arithmetic bound

P2 enforces shared lifetime caps of 5,000,000 / 10,000,000 / 2,500,000 /
2,500,000 units across every project, each with 1000 ticks per catalog species.
Multiplying by species counts 20/8/3/1 and credits 6/15/40/120 gives a
conservative total material credit ceiling of 2,400,000,000,000 (including
retired species). P5 source prefixes and P7 disjoint inherited provenance stop
the same material from belonging to two live physical outputs; settlement
requires END plus full historical coverage before input consumption. Thus
using every lifetime credit at maximum BIO tier and q2 still gives total
ordinary weight at most 31,680,000,000,000,000,000. Adding the unique K yields
31,680,077,760,000,000,000. Multiplication by the largest exact hourly budget
1,426,940,640 gives 45,205,590,434,104,166,400,000,000,000, below u128 capacity.
An independent host acceptance assertion checks these cross-module constants;
this bound does not assume an unbounded number of independently reusable
copies of the same material.

### CLOSE_FINAL_HOUR (native opcode27)

This explicit release addition reclaims account rent after FINAL; it does not
refund materials, manufacturing fees or mining tokens. Payload is16B:
`hour:u64,maxRent:u64`. Prefix7 remains unchanged; suffix is Registry W@7,
Hour W@8, and original rentpayer W@9 only if different from signed actor.
If actor is the original payer, suffix omits the duplicate account and returns
rent to actor@0. Registry high-water and its nextMaterializeHour are retained.
The program verifies actual Hour18/schema3, FINAL, h<nextMaterializeHour, all
member/cursor/floor/residual conservation, terminal linked-list tail, and the
saved original payer. It transfers all Hour lamports to that payer, truncates
data and assigns the empty account to System. A new nonce cannot close it
again; exact latest nonce replay returns the cached80B result without another
transfer. Opening h again fails the Registry monotone cursor. Result is
`hour:u64,HourID32,originalPayer32,refundedLamports:u64`.

Position accrued/paid and the permanent Event/Position records do not depend
on the ephemeral Hour account. Historical beneficiary claims continue after
closure. Callers retain finalized Hour audit bytes/transaction records off
chain for reconstruction; the program does not claim deleted bytes remain in
an on-chain account. At the runtime's default rent,481B requires4,238,640
lamports. Without close,24 global Hours lock101,727,360lamports/day. With timely
close after each FINAL, sequential settlement needs at most one in-flight
Hour's rent, reused for the next Hour. Actual RPC rent and transaction fees
remain deployment measurements; no protocol fee is added.

Native BIOECON2 envelope op20 STAKE adds one new ordinary START Event W at the
end (after the optional previous Position); op21 ordinary EXIT adds END Event W
at suffix index11. Open K must go through the native Task exit coordinator first
and enqueue K_END before ordinary END. Op23 OPEN adds the canonical next Event
R/absent placeholder at suffix13, proving no due event was omitted. Op24 now
means APPLY_EVENT: payload `eventSeq:u64,boundary:u64,maxRent:u64` (24B), suffix
Registry W, Event R, Directory W, Position R, then the old tail W for START, or
the existing prev then next neighbors W for END, or actual Activation R for K.
Op25 payload remains32B, but its cursor counts active members and its Directory
must equal Hour.nextMaterializeDirectory. Empty hours require no historical
Root, RootReg, Directory or Position accounts. The complete native economics
does not depend on the current Root owner during replay.

The Node `ActiveSettlementIndex.observe(ECON2 snapshot)` helper is explicitly a
fresh-genesis, per-transition differential oracle. It atomically rejects first
observations of already closed/K-zero-length/already accrued records with
`INDEX_REQUIRES_EVENT_HISTORY`; it is not a generic migration or cold import API.
Recovery uses its own trusted ECON3 `snapshot/fromSnapshot`, preserving every
stored event sequence and validating the active linked list. Native recovery
likewise resumes the existing Event PDA sequence and cursor without reconstructing
or sorting events from current owners or final closed intervals.

`observe` also rejects observing an old END and a replacement START for the same
Root in one call: that snapshot skipped business transitions and cannot prove
their tied append order. This rejects atomically before adding either event.

## Current executable acceptance

`programs/biolab-economy/evidence/native-settlement3-ordinary-acceptance.json`
binds the actual SBF ELF and the settlement/test/helper source hashes. All 15
ordinary tests pass using real manufactured material Roots and actual Reserve
TransferChecked claims, with no preloaded LAB or accrued balances. The true
4-Root, 85-hour chain earns 808520 atoms for the 800000-atom first-cell fee.
Same-transaction MATERIALIZE+CLAIM consumes 358937 CU in this fixture; empty
post-exit OPEN/materialize consume 230311/167291 CU and do not grow with inactive
history. Permissionless/self Hour close uses 134763/104848 CU. Every mining
instruction tested fits a 1232-byte legacy transaction. Node's 61 settlement
tests include 6 independent ECON3 differential/index restoration cases.
These are fixture measurements, not a claim that all protocol operations share
the same transport/resource bound.

Safety's trusted in-program preflight/commit hooks are implemented but this
ordinary run does not claim replay acceptance. The Root's canonical
RootReg25 carries permanent certificateFault plus its first real Safety
reference/event; immutable Root certificate bytes stay unchanged. The caller
must first prove an actual stored-certificate mismatch. Missing data or a
client boolean cannot invoke the hook. It merges any same-transaction K stop,
retains previous TRANSFER/CONSUMED first cause and all accrued/paid debt, closes
an OPEN ordinary Position with the frozen CERT_INVALID reason2, and seals
empty pending coverage. Both START and END remain in their original queue
order. No new public arbitrary-fault setter is exposed.

`evidence/native-settlement3-upgrade-acceptance.json` records a separate added
cross-module scenario on the same ordinary checkpoint ELF. Four actual
components earn 808520 atoms over 85 hours; the player claims only 800000,
leaving 8520 owed to the original Position. Actual 73-round CELL verification
and FINAL burn those 800000 atoms and consume all four Roots. The old Position
bytes remain unchanged, and an actual Reserve claim after consumption pays
the remaining 8520. Once the CELL starts, the active directory has one member
and its first complete hour accrues 15696 atoms; consumed parts add no second
weight. Actual post-burn Mint supply and Reserve balance are checked.

This added complex synthesis scenario requests a 262144-byte VM heap. Its
FINAL uses 1070453 CU and serializes to 1248 legacy bytes, exceeding the 1232
limit. It therefore does not close the actual V1 SDK/wallet/heap-request
transport admission gate. The 15 ordinary-only scenarios used 32768 bytes;
this 16th separate test must not be reported as a single final merged-release
run or as proof that complex synthesis fits legacy transport.
