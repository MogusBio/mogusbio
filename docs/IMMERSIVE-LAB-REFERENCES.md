# Immersive laboratory: rendering and chemical references

Date: 2026-10-26. This is a source and asset record for the separate English
laboratory interface. The existing simple UI, protocol, economy and user account
data are not replaced by these assets. No deployment or transaction is performed.

## Lightweight reference

The user supplied [Doodle District](https://doodleshooter.vercel.app/) and its
[source repository](https://github.com/iifor/doodleshooter). The official
[README](https://raw.githubusercontent.com/iifor/doodleshooter/main/README.md)
describes a static Three.js game whose environment, objects and audio are
procedural. The actual
[renderer](https://raw.githubusercontent.com/iifor/doodleshooter/main/src/render.js)
uses an intermediate scene buffer and a fullscreen outline/hatching treatment.
Its renderer disables MSAA, caps the device pixel ratio at1.5, and resizes the
render target alongside the viewport.

Useful architectural lessons are an original procedural environment, reuse of
geometry/materials, a bounded render resolution, and a coherent lighting style.
The laboratory does not need the shooter's multiplayer, pointer lock, weapons,
destructible environment, or full postprocessing stack to achieve a recognizable
3D space. Those features would add work unrelated to a laboratory interface.

The GitHub standard license endpoint returned404 during this inspection. No
Doodle District source, model, texture, logo or sound is copied into the project.
The new room, equipment and specimen models are original procedural work.

## Pinned rendering dependency

The only vendored rendering library is official
[Three.js r160](https://github.com/mrdoob/three.js/tree/r160).

| Property | Value |
| --- | --- |
| Version | 0.160.0, `REVISION = 160` |
| Official source | [three.module.js](https://raw.githubusercontent.com/mrdoob/three.js/r160/build/three.module.js) |
| License | [MIT](https://raw.githubusercontent.com/mrdoob/three.js/r160/LICENSE); retained locally as `lab-assets/THREE-LICENSE.txt` and inline in the bundle |
| Local module | `apps/player/dist/lab-assets/three.module.js` |
| Upstream bytes | 1,272,972 |
| Local minified bytes | 667,444 |
| Gzip bytes | 170,948 |
| Minifier | Existing workspace esbuild0.28.2; ESM, ES2020, legal comments preserved |
| Upstream SHA256 | `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495` |
| Local SHA256 | `dd285eb9d71c24939368fd6a9bcb6b8b7f272048a37be3f25eacdc9df39393fc` |

No package dependency or lockfile was changed. The module is self-contained, so
its import does not fetch a CDN or another library. The deterministic gzip
variant is served only with the appropriate `Content-Encoding: gzip`; its
presence alone is not a claim that a server has enabled compression.

## Authentic chemical data

`lab-assets/molecules.json` is10,305 bytes (2,277 bytes gzipped). It contains
four factual compound records downloaded from the NIH PubChem PUG REST service.
The top-level profile is `BIOLAB-MOLECULES1`, with records under `compounds`.

| ID | Actual compound | PubChem CID | Formula | Coordinates | Display |
| --- | --- | --- | --- | --- | --- |
| glycine | Glycine | [750](https://pubchem.ncbi.nlm.nih.gov/compound/750) | C2H5NO2 | PubChem3D conformer | 5 heavy atoms,4 bonds;5 H omitted |
| atp | Adenosine triphosphate | [5957](https://pubchem.ncbi.nlm.nih.gov/compound/5957) | C10H16N5O13P3 | PubChem3D conformer | 31 heavy atoms,33 bonds;16 H omitted |
| dopc | 1,2-Dioleoyl-sn-glycero-3-phosphocholine | [10350317](https://pubchem.ncbi.nlm.nih.gov/compound/10350317) | C44H84NO8P | Official2D drawing | 54 heavy atoms,53 bonds;84 H omitted |
| glucose | D-glucose | [5793](https://pubchem.ncbi.nlm.nih.gov/compound/5793) | C6H12O6 | PubChem3D conformer | 12 heavy atoms,12 bonds;12 H omitted |

Identity was resolved using official name/property requests rather than assumed
identifiers. In particular glycine is CID750, and the stereospecific DOPC record
resolved to CID10350317. The DOPC name and formula are additionally supported by
the official
[synonym record](https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/10350317/synonyms/JSON).

The exact coordinate/connectivity sources are:

- [Glycine3D record](https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/750/record/JSON?record_type=3d)
- [ATP3D record](https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/5957/record/JSON?record_type=3d)
- [DOPC2D record](https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/10350317/record/JSON?record_type=2d)
- [D-glucose3D record](https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/5793/record/JSON?record_type=3d)

The DOPC3D request returned404. The interface must identify its geometry as a
**2D chemical diagram**, not an experimentally determined3D lipid conformation.
All its displayed z coordinates are0, and the authoritative chemical bonds are
retained. The other three entries retain one actual source conformer rather
than generating arbitrary bead connections.

Hydrogens are omitted from display for clarity and rendering cost. Their full
formula counts and per-heavy-atom attachment counts remain in the dataset.
Source formal charges are also retained, including DOPC's phosphate/choline
charge pair.3D coordinates use angstrom units;2D coordinates use drawing units.
The renderer may recenter and uniformly scale a specimen for inspection, but
must not change its connectivity or claim the normalized scene scale is a
physical experiment measurement.

These four compounds are representative visual studies of the protocol's four
material classes. They do not redefine a complete material unit, all20 amino
acid species, the nucleotide catalog, or the lipid catalog. A displayed formula
or moving molecule is not a reaction, protein-folding or manufacturing proof.
Likewise procedural heart/brain/organism illustrations are visual atlas assets,
not new validated protocol organs or evidence of living biological production.

## Integrity checks

Asset generation checked exact source CID, formula identity, finite coordinates,
all valid zero-based bond indices, no self/duplicate bonds, one connected heavy
atom graph per molecule, and preserved attached hydrogen counts. Each source
record and final local asset is SHA256-pinned in
`apps/player/dist/lab-assets/sources.json`.

Browser frame rate and draw-call measurements belong to the actual scene/UI
acceptance. Bundle size and procedural geometry alone do not prove a particular
device's frame rate. Real low-power/mobile behavior remains a distinct test.
