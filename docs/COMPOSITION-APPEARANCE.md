# Composition-driven specimen appearance

2026-10-26 · MogusBio · local `/lab` simulation only.

The current `/lab` can buy materials, design, manufacture, synthesize, launch an
existing specimen, trade locally, stake, settle and claim through the laboratory.
The older classic workspace remains available. This document supersedes the
original visual-only description for these local HOST operations. It does not
claim public cross-account exchange or native wallet execution in the new UI.

## Fixed rules and player variation

Appearance is generated from the actual construction, not chosen from a species
image catalogue. A component has a fixed primitive shape; a cell includes its
four actual primitives; an organ wraps the actual included cells; a complete
organism wraps its six organs. The complete model contains 82 construction nodes:
60 components, 15 cells, six organs and the parent organism.

The current functional model fixes the cell roles, hierarchy and 5×3 occupied
layout. Players can change legal placement, mode, capacity and connection flows.
Those changes affect the corresponding contours, volume and connection paths.
The current version does not generate arbitrary real-world animal anatomy or
remove functional validation constraints.

The same blueprint retains the same main structural geometry. Each actual root
instance adds deterministic individual line markings. A cosmetic change creates
no additional function, quality, mining weight, originality award, token or unit
of material. Changing the selected editor blueprint cannot alter a manufactured
specimen's recorded appearance.

## Independently reusable modules

| Module | Input and responsibility | Authority |
| --- | --- | --- |
| `apps/playtest/lab-appearance.mjs` | Read sealed manufacture/synthesis artifacts, actual child IDs and root facts; build bounded graph and lineage references | Read-only HOST presentation projection |
| `apps/player/dist/lab-morphology.js` | Decode actual graph bytes, bind raw checksum/root/lineage, construct immutable normalized contours and actual connections | Presentation only |
| `apps/player/dist/lab-specimen-art.js` | Project shared geometry into batched SVG cards in inventory, launchpad and market | Presentation only |
| `apps/player/dist/lab-scene-geometries.js` | Render the same contours, connection paths and line marks with real depth | Presentation only |
| `apps/player/dist/lab-sim-client.js` | Hydrate compact references after the bounded HTTP response and preserve retry/identity checks | Local simulation transport |

The anatomy atlas remains a separate form study. Its human heart and brain do not
replace the abstract protocol organs. Generic navigation examples and unavailable
construction records are explicitly labelled `REFERENCE`.

## Frozen presentation transport

`BIO-LINE-APPEARANCE1`, version 1, contains canonical `structureKey`, actual root
`specimenKey`, raw encoded graph SHA256 `graphKey` and compact base64 lineage.
The raw graph checksum is separate from canonical design identity: equivalent
port assignments or mirrored plans must not overwrite a work's sealed raw graph.

Snapshot tables are normalized:

- `appearances[workId]` stores one appearance record; rows use `appearanceRef`.
- `appearanceGraphs[rawGraphSHA]` stores one encoded sealed graph.
- Each lineage entry contains a node ID and eight actual instance-prefix bytes;
  the root's full 32-byte identity also remains in `specimenKey`.
- `workLaunches` stores launch metadata once; market rows use `launchRef`.
- `designs` contains metadata; `selectedGraph` contains the current editor graph.
- `market.listings` is the canonical listing table. When
  `listingCollections === 'DERIVED_FROM_CATEGORY'`, the client reconstructs the
  material/product/organism collections by category before rendering.

Malformed, missing, oversized or unbound presentation records cannot claim a
construction-derived picture. The renderer falls back to an explicit reference.
They never reject a confirmed financial result or clear a pending request by
inventing a second transaction.

## Size and resource checks

Graph bytes are bounded at 7,713; a specimen has at most 82 units and 440 actual
connections. Shared scene objects are frozen; caches are bounded at eight scenes
and cleared across simulation runs. SVG cards batch paths by layer/type, with
fewer than 30 elements per complete organism card. Three-dimensional construction
uses at most 18 batched layers and disposes replaced resources.

Actual backend checks include 49 saved real scoped graphs, 100 listing-history
entries, 95 distinct listed roots and 110 unique appearance records: 373,217-byte
HTTP envelope. A separate conservative length projection expands every unique
root to 82 nodes, all 49 graph records to maximum wire length, and bounded text/
prices to their serialized maximum: 984,734 bytes, below the 1MiB client limit.
The latter is only a transport-capacity calculation, not a claim that artificial
padding is a valid economic construction.

## Evidence boundaries

Backend tests use actual material consumption, sealed graph/child provenance,
transfers, consumption, staking and checkpoint restart. Renderer tests compare
same-blueprint/different-instance marks, different valid plans, parent/child local
geometry, raw graph mismatch, malformed metadata, port/allocation paths, display
fallback and GPU disposal. Browser checks follow actual local material purchase
through all four work scopes and verify the same SVG after service restart and
market publication.

Final test totals, source identity and browser ledger are recorded separately in
`evidence/mogusbio-line-composition-acceptance-20261026.json`. Neither this change
nor a visual preview is a production deployment or a real biological viability
certificate. Economic policy, native ELF, fixed model, supplied Logo and classic
player source files retain their previous identities.

Final frozen local acceptance: **1,195/1,195 full regression tests passed**, plus
75/75 renderer/lifecycle-focused checks and the 22/22 backend appearance checks.
Source: 550 files, manifest SHA256
`1e9d52304f6deadb984324c618cc94bedca83fe8d24d22bc7c1d2775b031ae64`.
The browser account retains one available constructed organism for inspection.
Its current LAB balance is 1.167620 and simulation SOL is 9.783978807.
