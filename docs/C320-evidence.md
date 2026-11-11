# C320 executable construction evidence

The twelve original public seeds are reconstructed in `packages/biology/src/seeds.mjs`. Each is actually executed at challenge 2 through the 73 specified transitions. Their independently frozen costs 413, 394, 375, 347, 343, 341, 340, 336, 332, 330, 330, 328 are reproduced by `test/seeds.test.mjs`.

The new construction starts at original S11 (L8/R3, C328). It changes only legal material wiring; no rule, source count, port capacity, quality constant, input material amount, tier or placement is changed.

- For cells C06 and C07, send both of their existing half-share N input ports from that cell's own absorption S. Both source owners have identical normal demand, so paired rewiring retains the global normal source totals. It removes four units of Manhattan cost: C324.
- For surface cells C01 and C02, supply their two O ports from their own S and return both W ports to their own S. The paired demands preserve the normal O/W source totals. Four more distance units disappear: C320.
- All 82 free material edges remain distinct physical endpoint pairs; all 260 mandatory relations remain. Each exact Graph is still 6145 bytes. Every normal port, source and inherited cut is rechecked, and recovery rounds use their actual nonuniform demands.

The C320 test independently projects all 22 required complete subtrees and runs each full test suite: dynamic targets return q2; hard C03/C09/C14/C15 and O06 return support q1 at challenge2. This demonstrates a complete legal functional construction path in the executable JS model, rather than an upper-bound formula.

These are public prelaunch discoveries, not privately reserved first-discovery rewards. C324 and C320 enter the public initial knowledge set with K=0. Subsequent paired nutrient rewiring found C318 and C316, also validated at all22 scopes and included as required public K0. The sixteen-model opening frontier is316. The next qualifying improvement must be strictly better than all then-published knowledge. This evidence does not claim mathematical optimality or any actual token reward.

The graph binary fixtures and manifest are exported by `node scripts/export-fixtures.mjs`. The zero-domain bytes are intentionally fixtures, never approved production identities. Independent Rust execution, actual SBF resource measurements and complete native integration remain separate acceptance gates.
