# Immersive laboratory UI

Latest local revision: see [composition-driven appearance](COMPOSITION-APPEARANCE.md). The new `/lab` now includes direct material purchase, individual manufacturing, validated assembly, local single-specimen launch/market and staking/claim operations. Actual owned component/cell/organ/organism previews share the recorded construction geometry. The visual-only scope below is the original historical milestone.

2026-10-26 · local preview only · separate English interface at `/lab`.

## Experience

Enter an original procedural laboratory with a central glass observation chamber,
microscope, reagent bench, incubator, anatomical displays and botanical windows.
Choose a station, orbit the room, inspect molecules or specimens, open field notes,
edit a reference design, run the existing functional validator, and save the result
as a local observation. Use **Classic workspace** for the existing business UI.

All new user-visible labels are English. The previous `/` and `/test-lab` interfaces
are retained. A new visual observation does not consume inventory, issue an asset,
stake a specimen, earn LAB, or send a transaction. Manufacturing, sale, wallet and
mining controls remain in the existing workspace. No public deployment is included.

## Modules

| Module | Responsibility | Authority |
| --- | --- | --- |
| `lab.html`, `lab.css` | Responsive laboratory HUD, station rail, molecular cards, notebook | Presentation |
| `lab-model.js` | Draft edits, layer selection, response and local-record validation | UI checks only |
| `lab.js` | Interaction, bounded loading, cancellation, request binding, field notes | Read configuration and submit local model tests |
| `lab-scene.js` | Procedural room, selection, camera, render lifecycle and quality | Presentation |
| `lab-scene-geometries.js` | Molecules, cell, heart, brain and organism meshes | Presentation |
| `lab-assets/` | Pinned MIT Three.js, four molecular structures, provenance | Static assets |
| `apps/server/main.mjs` | Explicit static routes, negotiated gzip, validation request digest | Existing validator remains authoritative |

No whole-directory static serving is introduced. Three.js imports locally; no
CDN, external fonts, downloaded models or textures are needed at runtime.

## Model contract

The laboratory reads the existing OPEN310 collection of 17 references. The default
is C310. Its editable metabolic parameter is C04 `v`, and requested challenge is
limited to the existing fixed-model range. The selected validation layers are:

| Target | Meaning | Assembly inputs in the existing protocol |
| --- | --- | --- |
| 4 | Metabolic cell C04 | Four matching functional components |
| 17 | Metabolic organ O02, C03–C05 | Three matching functional cells |
| 22 | Complete digital organism | Six matching functional organs |

Each selected layer contains C04, so its response control actually affects the
submitted model. The anatomy atlas's illustrated human heart and brain are
separate form studies. They are not O02 and do not assert validated anatomical
function. Organ validation uses an abstract cellular preview.

The existing `/api/validate` executes 73 rounds of normal operation, shortage,
obstruction and recovery. Its successful response now includes `requestSHA`, the
SHA256 of `JSON.stringify` of the parsed `{graph, challenge, target}` request.
The controller computes the same digest before submission and requires a match,
in addition to PASS, layer, scope, round count, quality bounds and identifiers.
This binds a displayed response to its request; it is not independent verification
of an untrusted server. This local interface continues to report
`productionAdmission:false`.

Changing a target, reference, challenge or capacity clears the prior result and
cancels outstanding work. A late response cannot restore it. Rerunning also clears
the previous PASS before starting. Invalid designs cannot be saved as a successful
new observation.

## Local persistence and failure handling

Only key `biolab:immersive-records:v1` is written, with at most 12 observations.
Stored records have a checked profile, date, reference name, layer/scope, quality,
rule/design/graph identifiers, 73 rounds, and explicit preview/no-network flags.
Rendering uses text nodes. A completed observation can be saved once per run;
storage failure preserves the test result and does not report a successful save.
Clearing the bench resets only this draft.

Configuration and molecular loading are bounded by a 15-second abort, including
fetch/body implementations that ignore the signal. Response size and JSON type
are bounded. Model tests reuse the existing bounded experiment runner. Network
failure leaves the draft available. Missing molecules disable their display
controls; no coordinates are invented. Missing WebGL exposes a 2D inspector with
the same actual validation service. Closing during delayed initialization cannot
create a permanent metrics timer. Source links are rebuilt under the official
HTTPS PubChem host rather than trusting arbitrary supplied URLs.

## Visual and performance boundaries

The room is procedural and batches static geometry by material. Atoms and bonds
use instanced meshes, geometry is bounded, no shadow or postprocessing passes are
enabled, and there are no large image assets. Normal DPR is capped at 1.5; low mode
uses DPR1 and caps rendering near 30 FPS. Auto mode can reduce quality after slow
frames. Hidden/offscreen rendering pauses. Reduced-motion mode avoids continuous
motion. Specimen switches dispose previous GPU resources. Metrics report observed
FPS and draw calls rather than a fabricated performance guarantee.

Three.js transfers in 170,948 gzip bytes and molecular data in 2,277 gzip bytes.
Raw delivery remains available when gzip is refused. Compression is negotiated
only for these explicit assets.

Glycine, ATP and glucose use real PubChem 3D conformers; DOPC is explicitly a 2D
chemical drawing. Molecular bonds and relative coordinates are preserved under
uniform display scaling. These are representative compounds, not a redefinition
of the four protocol material classes. There is no protein-folding, chemical
reaction, medical or living-organism simulation claim. See
[reference and provenance record](IMMERSIVE-LAB-REFERENCES.md).

## Acceptance

Focused tests cover the actual fixed validator, request isolation, data failures,
local storage, lifecycle, source integrity, molecular formulas/valence and exact
geometry. HTTP tests verify all explicit routes, MIME/security headers, gzip
negotiation, and byte-identical preservation of every previous player file.

Browser acceptance checks the actual WebGL room, molecular cards, stations,
anatomy atlas, layer selection, successful and failed experiments, saved notes,
quality mode and camera interaction. Local screenshots and measured results are
recorded under `evidence/immersive-lab-*20261026*`.

Real low-power/mobile hardware performance remains device-dependent. This UI
change does not substitute for deployment, real-wallet/chain acceptance or an
independent security audit. Existing release restrictions remain in place.

Final local acceptance: **1,047/1,047** full tests and **36/36** focused tests
passed, with zero failures. Source manifest: `6b31e8f6a04e16e5e3bfa405292cdcf8f26ff7449f49bd06c05e997a96251bb5`
(522 files). The previous 507-source release has only the
workbench server changed; every previous player file and all package/protocol
sources remain byte-identical. Browser screenshots show the actual WebGL room.
Observed performance was 75 FPS in Auto and 25 FPS in Low on the local viewport;
these are measurements for this device, not universal targets. Full machine-readable
acceptance: `evidence/immersive-lab-acceptance-20261026.json`.
