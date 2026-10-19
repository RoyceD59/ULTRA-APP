"""Repack only a verified lockfile delta; preserve both approved archives."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ORIGINAL_SHA = "db2ef861871dcff39cde08350d9374e9b8d1220409e2f506141cf9c4666cad59"
original = HERE / "approved-consistency/release-sources.tar.gz"
original_bytes = original.read_bytes()
assert hashlib.sha256(original_bytes).hexdigest() == ORIGINAL_SHA
metadata = json.loads((HERE / "approved-consistency/candidate.json").read_text())
assert metadata["candidateSha256"] == ORIGINAL_SHA
lock_path = ROOT / ".consistency-build/security-preparation/minimal-security-lock.yaml"
# Independently assert the exact allowed delta; fail on any collateral update.
subprocess.run(
    ["node", "--input-type=module", "-e",
     "import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';"
     "import {securityLock} from './infra/cloudflare/forest/consistency-security.mjs';"
     "const old=execFileSync('tar',['-xOf',process.argv[1],'pnpm-lock.yaml'],{encoding:'utf8'});"
     "if(securityLock(old)!==readFileSync(process.argv[2],'utf8'))throw Error('Unapproved lockfile delta');",
     str(original), str(lock_path)], cwd=ROOT, check=True,
)
lock = lock_path.read_bytes()
raw = io.BytesIO()
with tarfile.open(fileobj=io.BytesIO(original_bytes), mode="r:gz") as source:
    with tarfile.open(fileobj=raw, mode="w") as destination:
        for entry in source.getmembers():
            if entry.name == "pnpm-lock.yaml":
                entry.size = len(lock)
                destination.addfile(entry, io.BytesIO(lock))
            else:
                destination.addfile(entry, source.extractfile(entry) if entry.isfile() else None)
archive_bytes = gzip.compress(raw.getvalue(), mtime=0)
sha = hashlib.sha256(archive_bytes).hexdigest()
metadata.update({
    "candidateSha256": sha,
    "originalCandidateSha256": ORIGINAL_SHA,
    "securityChangedPaths": ["pnpm-lock.yaml"],
    "status": "security-only preparation; NOT PUBLISHED",
    "securityPins": {"proxy-addr": "2.0.8", "source-map-js": "1.2.2", "compression": "1.8.2"},
})
if "pnpm-lock.yaml" not in metadata["changedPaths"]:
    metadata["changedPaths"] = sorted(metadata["changedPaths"] + ["pnpm-lock.yaml"])
    metadata["unchangedFrozenFiles"] -= 1
output = HERE / "security-consistency"
output.mkdir(exist_ok=True)
archive_path = output / "release-sources.tar.gz"
if archive_path.exists() and archive_path.read_bytes() != archive_bytes:
    raise RuntimeError("Refusing to replace a different retained security candidate")
archive_path.write_bytes(archive_bytes)
(output / "candidate.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(json.dumps({"candidateSha256": sha, "changedFromApproved": ["pnpm-lock.yaml"],
                  "originalPreserved": ORIGINAL_SHA}))
