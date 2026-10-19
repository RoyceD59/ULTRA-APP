"""Retain an additive archive using reviewed merged hunks, never working-tree routes."""
from pathlib import Path
import difflib
import gzip
import hashlib
import io
import json
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PARENT_SHA = "b3a298f2e19090a5da3b98a0c0b320cde8afe733f80430af48bfc9a24183921c"
AUTH = "a619d3808dfbab526b225bad7cada8395b7a00e9"
UPLOAD = "0aaa29c9e12ee43d65202964ba62f5b2097d800f"
ADAPTER = "6c8aac72da5eecec5ea934c71f62dac06873fb9c"
PREFIX = "artifacts/api-server/"

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(revision, path):
    return subprocess.check_output(["git", "show", f"{revision}:{path}"], cwd=ROOT)

def transplant(frozen, before, after):
    """Require unique unchanged context around every merged hunk."""
    old = before.decode().splitlines(keepends=True)
    new = after.decode().splitlines(keepends=True)
    result = frozen.decode()
    for group in difflib.SequenceMatcher(None, old, new, autojunk=False).get_grouped_opcodes(3):
        left = "".join(old[group[0][1]:group[-1][2]])
        right = "".join(new[group[0][3]:group[-1][4]])
        if not left or result.count(left) != 1:
            raise RuntimeError("Merged hunk does not uniquely match frozen preimage")
        result = result.replace(left, right, 1)
    return result.encode()

def count_route(data):
    start = data.index(b'router.get("/uc/admin/customers/count"')
    end = data.index(b"\n});", start) + len(b"\n});")
    return start, end, data[start:end]

parent = (HERE / "security-consistency/release-sources.tar.gz").read_bytes()
assert sha(parent) == PARENT_SHA
with tarfile.open(fileobj=io.BytesIO(parent), mode="r:gz") as source:
    entries = source.getmembers()
    original = {e.name: source.extractfile(e).read() for e in entries if e.isfile()}
files = dict(original)

def apply(revision, relative):
    path = PREFIX + relative
    files[path] = transplant(files[path], git(revision + "^", path), git(revision, path))

# The test adapter is a prerequisite of the already-merged regression fixtures.
apply(ADAPTER, "src/routes/storage.ts")
apply(AUTH, "src/lib/jwt.ts")
for relative in ["src/lib/objectStorage.ts", "src/lib/review-media-signature.ts",
                 "src/routes/storage.ts", "src/routes/uc.ts", "src/tests/review-media-signature.test.ts"]:
    apply(UPLOAD, relative)

# Transplant only the live-account gate, not the receipt or reporting changes.
path = PREFIX + "src/routes/uc.ts"
start, end, frozen = count_route(files[path])
_, _, merged = count_route(git(AUTH, path))
insertion_start = merged.index(b"    // Identity claims alone")
insertion_end = merged.index(b"    res.json", insertion_start)
gate = merged[insertion_start:insertion_end]
assert b"teamUsersTable.isActive" in gate and b"res.status(401)" in gate
assert frozen.count(b"  try {\n") == 1
files[path] = files[path][:start] + frozen.replace(b"  try {\n", b"  try {\n" + gate, 1) + files[path][end:]

for revision, relative in [
    (AUTH, "src/tests/jwt-session-expiry.test.ts"),
    (AUTH, "src/tests/customer-count-auth.test.ts"),
    (UPLOAD, "src/tests/storage-public-media-security.test.ts"),
    (ADAPTER, "src/tests/storage-upload-allowlist.test.ts"),
]:
    path = PREFIX + relative
    assert path not in files
    files[path] = git(revision, path)

changed = sorted(path for path in files if files[path] != original.get(path))
scope = []
patch = []
for path in changed:
    old, new = original.get(path, b""), files[path]
    scope.append({"path": path, "beforeSha256": sha(old) if path in original else None,
                  "afterSha256": sha(new), "beforeBytes": len(old), "afterBytes": len(new)})
    for line in difflib.unified_diff(old.decode().splitlines(True), new.decode().splitlines(True),
                                   fromfile="parent/" + path, tofile="candidate/" + path):
        patch.append(line if line.endswith("\n") else line + "\n\\ No newline at end of file\n")

raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode="w") as destination:
    for entry in entries:
        if entry.isfile():
            entry.size = len(files[entry.name])
            destination.addfile(entry, io.BytesIO(files[entry.name]))
        else:
            destination.addfile(entry)
    for path in sorted(set(files) - set(original)):
        entry = tarfile.TarInfo(path)
        entry.mode = 0o644
        entry.size = len(files[path])
        entry.mtime = 0
        destination.addfile(entry, io.BytesIO(files[path]))
archive = gzip.compress(raw.getvalue(), mtime=0)
identity = sha(archive)
metadata = json.loads((HERE / "security-consistency/candidate.json").read_text())
metadata.update({
    "candidateSha256": identity, "parentSecuritySha256": PARENT_SHA,
    "securityChangedPaths": changed,
    "changedPaths": sorted(set(metadata["changedPaths"]) | set(changed)),
    "unchangedFrozenFiles": metadata["unchangedFrozenFiles"] - len(set(changed) & set(original)),
    "status": "auth/upload security-only preparation; NOT PUBLISHED",
})
scope_document = {
    "parentSha256": PARENT_SHA, "candidateSha256": identity,
    "mergedRevisions": {"auth": AUTH, "uploads": UPLOAD, "storageAdapter": ADAPTER},
    "files": scope, "unchangedParentFiles": len(original) - len(set(changed) & set(original)),
    "excluded": ["receipt payment projection", "customer reporting timezone/statistics feature",
                 "schemas", "client sources", "dependency changes", "production initialization"],
}
output = HERE / "auth-upload-security"
output.mkdir(exist_ok=True)
for name, data in [
    ("release-sources.tar.gz", archive),
    ("candidate.json", (json.dumps(metadata, indent=2) + "\n").encode()),
    ("scope.json", (json.dumps(scope_document, indent=2) + "\n").encode()),
    ("merged-security.patch", "".join(patch).rstrip("\n").encode()),
]:
    target = output / name
    if target.exists():
        if target.read_bytes() != data:
            raise RuntimeError(f"Refusing to replace retained bytes: {target}")
    else:
        target.write_bytes(data)
print(json.dumps({"candidateSha256": identity, "scopeSha256": sha((output / "scope.json").read_bytes()),
                  "changedPaths": changed}, indent=2))
