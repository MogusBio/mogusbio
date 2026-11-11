# Biology implementation gate

The frozen F1.4 and P6 graph/port rules are the inputs. This package implements the finite digital model; no real protein folding or living organism claim is made.

1. Implement the exact fixed hierarchy, typed endpoints, 260 fixed edges, LCA ownership, open fractions and immutable child projections. Validate malformed/duplicate/missing/foreign edges and strict binary round trips before using a graph.
2. Implement exact integer per-round energy, flow, normal/safety/recovery/obstacle state transitions and shared capacities. All 73 transitions must run; every test starts from its declared state.
3. Verify declared control inputs, service limits, mechanical work/heat and positive-edge task cost. A client PASS or claimed quality is never an input.
4. Implement canonical equivalence and test relabeling/zero-edge/port/mirror attacks. Actual graph and instance identity must remain separate.
5. Compare reference cases against frozen hand calculations and reject independently constructed bad graphs. Tests of this JS reference do not certify Solana execution; the SBF gate remains separate.

Integration is blocked until these checks run. Changes caused by real implementation findings are recorded in docs, rather than silently changing a frozen constant.
