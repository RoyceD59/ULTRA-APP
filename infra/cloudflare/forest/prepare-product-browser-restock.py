"""Prepare only the approved browser/restock delta over the frozen product release.

No deployment, database changes, dependency changes or copying of main wholesale.
Ambiguous backports fail closed. The selected checksums are reviewed separately.
"""
import base64
import difflib
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE_MAIN = "2651a6ae"
REVIEW = HERE / "product-browser-restock-review"
PARENT = HERE / "product-page-review"
ALLOWED = {
    "artifacts/api-server/src/index.ts", "artifacts/api-server/src/routes/index.ts",
    "artifacts/api-server/src/routes/uc.ts", "artifacts/api-server/src/lib/restock-requests.ts",
    "artifacts/api-server/src/routes/uc-restock-requests.ts", "artifacts/api-server/src/tests/restock-requests.test.ts",
    "artifacts/api-server/src/tests/customer-count.test.ts",
    "artifacts/projecthub/src/pages/admin/inventory.tsx",
    "artifacts/projecthub/src/components/restock-requests-panel.tsx",
    "artifacts/uc-companion/app/_layout.tsx", "artifacts/uc-companion/app/product/[id].tsx",
    "artifacts/uc-companion/components/CompanionMenu.tsx", "artifacts/uc-companion/components/ProductCard.tsx",
    "artifacts/uc-companion/components/product/ProductRecordPage.tsx",
    "artifacts/uc-companion/components/product/ProductLayers.tsx",
    "artifacts/uc-companion/components/product/ProductPhoto.tsx",
    "artifacts/uc-companion/components/product/RestockRequestForm.tsx",
    "artifacts/uc-companion/components/product/LinkedText.tsx",
    "artifacts/uc-companion/hooks/useApi.ts", "artifacts/uc-companion/hooks/usePublicWebDocument.ts",
    "artifacts/uc-companion/lib/productImageUrl.ts", "artifacts/uc-companion/lib/productLinks.ts",
    "artifacts/uc-companion/lib/publicRecordLayout.ts",
    "artifacts/uc-companion/lib/__tests__/productLinks.test.mts",
    "artifacts/uc-companion/lib/__tests__/publicRecordLayout.test.mts",
    "artifacts/uc-companion/server/serve.js", "artifacts/uc-companion/server/public-rendering.cjs",
    "artifacts/uc-companion/server/record-details.cjs",
    "artifacts/uc-companion/scripts/__tests__/record-details.test.mjs",
    "lib/db/src/schema/index.ts", "lib/db/src/schema/uc-restock-requests.ts",
    "lib/db/migrations/0069_restock_requests.sql", "lib/api-spec/openapi.yaml",
    "lib/api-client-react/src/generated/api.ts", "lib/api-client-react/src/generated/api.schemas.ts",
    "lib/api-client-react/package.json", "lib/api-client-react/src/companion-restock.ts",
    "lib/api-zod/src/generated/api.ts", "lib/api-zod/src/generated/types/index.ts",
}
MODEL = re.compile(r"^lib/api-zod/src/generated/types/(?:restock|listUcRestockRequests)[A-Za-z]*\.ts$")
sha = lambda data: hashlib.sha256(data).hexdigest()
git = lambda *args: subprocess.check_output(["git", *args], cwd=ROOT, stderr=subprocess.DEVNULL)

def load(path):
    result = {}
    with tarfile.open(path, "r:gz") as archive:
        for item in archive:
            if item.isdir():
                continue
            assert item.isfile() and not item.name.startswith("/") and ".." not in pathlib.PurePosixPath(item.name).parts
            assert item.name not in result and not (item.mode & 0o7000)
            result[item.name] = (archive.extractfile(item).read(), item.mode & 0o777)
    return result

def backport(path, reference, current, frozen):
    """Apply just the new changes, preserving unrelated frozen source."""
    old, new = reference.splitlines(True), current.splitlines(True)
    for tag, a, b, c, d in reversed(difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes()):
        if tag == "equal":
            continue
        removed, added = "".join(old[a:b]), "".join(new[c:d])
        applied = False
        if path == "artifacts/api-server/src/routes/index.ts" and not removed and added.strip() == "router.use(ucRestockRequestsRouter);":
            matched = re.search(r'import (\w+) from ["\']\./uc-product-records\.js["\']', frozen)
            assert matched, "Frozen product-router import is required"
            anchor = f"router.use({matched[1]});"
            assert frozen.count(anchor) == 1
            frozen = frozen.replace(anchor, anchor + "\n" + added.rstrip(), 1)
            continue
        if path == "artifacts/api-server/src/index.ts" and not removed and added.startswith("  await ensureRestockRequestSchema();"):
            # The frozen release bootstraps editorial data at module scope,
            # whereas main does it inside applyStartupMigrations.
            anchor = "await ensureProductEditorialSchema();\n"
            assert frozen.count(anchor) == 1
            frozen = frozen.replace(anchor, anchor + "".join(
                line[2:] if line.startswith("  ") else line for line in added.splitlines(True)), 1)
            continue
        # Most-specific unique context first; never use a line-number guess.
        for width in range(8, -1, -1):
            left = "".join(old[max(0, a-width):a])
            right = "".join(old[b:b+width])
            for prefix, suffix in [(left, right), (left, ""), ("", right)]:
                needle = prefix + removed + suffix
                if needle and frozen.count(needle) == 1:
                    frozen = frozen.replace(needle, prefix + added + suffix, 1)
                    applied = True
                    break
            if applied:
                break
        if applied:
            continue
        # A single named-import edit can have a different frozen sibling list.
        match_old = re.fullmatch(r"\s*import\s*\{([^}]+)\}\s*from\s*(['\"])([^'\"]+)\2;\s*", removed)
        match_new = re.fullmatch(r"\s*import\s*\{([^}]+)\}\s*from\s*(['\"])([^'\"]+)\2;\s*", added)
        if match_old and match_new and match_old[3] == match_new[3]:
            before = {part.strip() for part in match_old[1].split(",")}
            additions = [part.strip() for part in match_new[1].split(",") if part.strip() not in before]
            target = re.compile(r"(import\s*\{)([^}]+)(\}\s*from\s*['\"]" + re.escape(match_old[3]) + r"['\"];)")
            matches = list(target.finditer(frozen))
            if len(matches) == 1 and before <= set(part.strip() for part in matches[0][2].split(",")):
                frozen = target.sub(lambda m: m[1] + m[2].rstrip() + ", " + ", ".join(additions) + " " + m[3], frozen, count=1)
                continue
        if not removed and all(line.startswith(("import ", "export ")) for line in added.strip().splitlines()):
            if added.strip() not in frozen:
                frozen = added + frozen
            continue
        if added and added.strip() in frozen and removed.strip() not in frozen:
            continue
        raise RuntimeError(f"Ambiguous scoped backport: {path}, baseline line {a+1}")
    return frozen

parent_meta = json.loads((PARENT / "candidate.json").read_text())
parent_bytes = (PARENT / "release-sources.tar.gz").read_bytes()
assert sha(parent_bytes) == parent_meta["candidateSha256"]
files = load(PARENT / "release-sources.tar.gz")
security_archive = HERE / "security-center-cache-review/release-sources.tar.gz"
assert sha(security_archive.read_bytes()) == parent_meta["parentSha256"], "Selected security baseline must match the reviewed parent"
baseline = load(security_archive)
changed = set(git("diff", "--name-only", BASE_MAIN, "--").decode().splitlines())
changed.update(git("ls-files", "--others", "--exclude-standard").decode().splitlines())
selected = sorted(path for path in changed if path in ALLOWED or MODEL.fullmatch(path))
failures = []
for path in selected:
    content = (ROOT / path).read_bytes()
    if path == "lib/api-client-react/package.json":
        package = json.loads(files[path][0])
        package["exports"]["./companion/restock"] = "./src/companion-restock.ts"
        files[path] = ((json.dumps(package, indent=2) + "\n").encode(), files[path][1])
        continue
    try:
        reference = git("show", f"{BASE_MAIN}:{path}").decode()
    except subprocess.CalledProcessError:
        assert path not in files, f"New main file conflicts with frozen source: {path}"
        files[path] = (content, 0o644)
        continue
    assert path in files, f"Frozen source lacks changed prerequisite: {path}"
    try:
        files[path] = (backport(path, reference, content.decode(), files[path][0].decode()).encode(), files[path][1])
    except RuntimeError as error:
        failures.append(str(error))
if failures:
    raise RuntimeError("Scoped source reconciliation required:\n" + "\n".join(failures))

changed_paths = sorted(path for path, value in files.items() if baseline.get(path) != value)
old_sources = {entry["path"]: entry.get("source", "inherited-approved-product-page") for entry in json.loads((PARENT / "scope.json").read_text())}
scope = [{"path": path, "beforeSha256": sha(baseline[path][0]) if path in baseline else None,
          "afterSha256": sha(files[path][0]),
          "source": "owner-approved-browser-restock-design" if path in selected else old_sources.get(path, "inherited-product-page")}
         for path in changed_paths]
raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode="w") as archive:
    for path, (content, mode) in sorted(files.items()):
        item = tarfile.TarInfo(path)
        item.size, item.mode, item.mtime = len(content), mode, 0
        archive.addfile(item, io.BytesIO(content))
packed = gzip.compress(raw.getvalue(), mtime=0)
candidate = sha(packed)
scope_hash = sha(json.dumps(scope, separators=(",", ":"), ensure_ascii=False).encode())
REVIEW.mkdir(parents=True, exist_ok=True)
(REVIEW / "release-sources.tar.gz").write_bytes(packed)
(REVIEW / "scope.json").write_text(json.dumps(scope, indent=2) + "\n")
metadata = {**parent_meta, "candidateSha256": candidate, "scopeSha256": scope_hash,
    "changedPaths": changed_paths, "sourceFiles": len(files), "unchangedParentFiles": len(files)-len(changed_paths),
    "browserRestockPredecessorSha256": parent_meta["candidateSha256"],
    "status": "prepared-source-only; NOT PUBLISHED",
    "separateEdgeWorker": {"path": "infra/cloudflare/ucfilters-router.js",
        "sha256": sha((ROOT / "infra/cloudflare/ucfilters-router.js").read_bytes()),
        "activation": "Separate Cloudflare worker publication required; not activated by the Replit build"}}
(REVIEW / "candidate.json").write_text(json.dumps(metadata, indent=2) + "\n")
approval = json.loads((PARENT / "owner-approval.json").read_text())
approval.update(candidateSha256=candidate, scopeSha256=scope_hash, browserRestockDesignApproved=True)
approval["notes"].append("Owner approved the written browser/restock design. Preparation is not evidence of publication, live stock initialization or payment activation.")
(REVIEW / "owner-approval.json").write_text(json.dumps(approval, indent=2) + "\n")
print(json.dumps({"candidateSha256": candidate, "scopeSha256": scope_hash,
    "featureFiles": len(selected), "sourceFiles": len(files), "published": False}))
