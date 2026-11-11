# P10.2 asset planning — checks fixed before code

- Known-instance lookup only; no claim that a wallet yields a complete holdings index.
- Read canonical Root, optional RootReg/Registry, RuntimeEconConfig, Clock and actual ActorNonce. Optional absence never masks malformed records.
- Discover dependent Position/Directory/Event/Hour pointers, then reread all determining state together. Changed pointers/revisions return REPLAN_STALE_STATE without an intent.
- Stake uses actual owner, LIVE lifecycle, revision, count, lifetime directory, closed end boundaries, certificate facts and genuine previous Position. Unpaid old debt is not a restake prohibition.
- First global stake mirrors sync-book and empty-current-Hour prefix checks; retained older lazy Pending is not discarded.
- Ordinary exit uses actual latest Position/start boundary. Open K blocks with K_AWARE_EXIT_REQUIRED until the complete Task/KSlot branch is implemented.
- One unsigned intent at most; no signing, journaling, automatic settlement, sending or nonce reservation. Simulation and native execution remain authoritative.
- maxRent is a native allocation cap, not proven total affordability. Network fee/rent quotes remain explicitly unverified.
- Verify genuine checkpoint reads and host-only adversarial fixtures independently from native execution evidence.

Acceptance completed: nine focused tests cover unchanged genuine76b BIO/Position reads and restake proposals; host-only ordinary-open/K-open/end/owner/consumed/race/malformed-record branches; cold first-stake retained-lazy-prefix arithmetic; historical claim book checks without current Root ownership; and Position-directory/Clock cross-links. An independent read-only source review found and root fixed the page directory cross-link gap. No new native staking execution or live RPC finality is claimed by these planner tests. `planGuidedPositionAction` also validates initialized economy/mint/reserve/Treasury before proposing a historical claim. Open-K exit and asset transfer forms remain outside this layer.
