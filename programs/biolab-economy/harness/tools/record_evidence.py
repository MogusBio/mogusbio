"""Record successful local SBF logs and the exact binaries that were exercised.

Run after the documented build and Mollusk test commands, from the program root.
This is evidence packaging, not an independent audit or production admission.
"""
import hashlib
import json
import os
from pathlib import Path
import re


def fingerprint(path):
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


root = Path(__file__).resolve().parents[2]
log = (root / "evidence/mollusk-native.log").read_text()
build = (root / "evidence/build-sbf.log").read_text()
summary = re.search(r"test result: ok\.[^\n]+", log)
errors = [line for line in build.splitlines()
          if re.search(r"^error|Error:|exceeds|exceeded|Stack offset", line)]
if summary is None or errors:
    raise SystemExit("Refusing to record success: tests failed/missing or SBF resource errors exist")

workspace = root.parents[1]
cargo = Path(os.environ.get("CARGO_HOME", workspace / ".local-tools/cargo"))
packages = sorted(cargo.glob("registry/src/*/mollusk-svm-programs-token-0.16.0"))
if len(packages) != 1:
    raise SystemExit("Expected exactly one pinned official Token ELF package")

measurements = []
for operation, cu, raw in re.findall(r"(ECON_[A-Z_]+) cu=(\d+)(?: packet=\d+)? raw=([^\n]+)", log):
    item = {"operation": operation, "computeUnits": int(cu), "raw": raw}
    if item not in measurements:
        measurements.append(item)

program = root / "target/deploy/biolab_economy.so"
record = {
    "date": "2026-10-25",
    "scope": "BIOECON2 isolated native acceptance adapter: E0-E3, P2 launchpad, P3 Ops",
    "productionEnabled": False,
    "program": {"file": "target/deploy/biolab_economy.so", **fingerprint(program)},
    "classicToken": {"package": "mollusk-svm-programs-token@0.16.0", **fingerprint(packages[0] / "src/elf/token.so")},
    "associatedToken": {"package": "mollusk-svm-programs-token@0.16.0", **fingerprint(packages[0] / "src/elf/associated_token.so")},
    "runtime": {"mollusk": "0.16.2", "solanaProgram": "3.0.0", "architecture": "SBPF v3",
                "platformTools": "1.56", "heapBytes": 32768, "computeLimit": 1400000},
    "testSummary": summary.group(0),
    "buildResourceErrors": errors,
    "measurements": measurements,
    "sourceFiles": {str(p.relative_to(root)): fingerprint(p) for p in sorted((root / "src").glob("*.rs"))},
    "packetSizes": {"createReferenceLegacy": 1048, "buyThirdPartyReferenceLegacy": 1158, "payReferenceLegacy": 960},
    "limits": ["Mollusk supplies native runtime signer privileges; wallet Ed25519 signing is not exercised",
               "Literal local release markers; full immutable P0 Manifest/loader admission not implemented",
               "No public Position credit/accrual or Source/material-consumption operation",
               "Packet measurement is exact size accounting; richer role/message variants require independent serialization"]
}
(root / "evidence/native-acceptance.json").write_text(json.dumps(record, indent=2) + "\n")
# cargo-build-sbf produces this unused artifact. Never open or distribute it.
deployment_key = root / "target/deploy/biolab_economy-keypair.json"
if deployment_key.exists():
    deployment_key.unlink()
print(json.dumps({"program": record["program"], "testSummary": record["testSummary"]}, indent=2))
