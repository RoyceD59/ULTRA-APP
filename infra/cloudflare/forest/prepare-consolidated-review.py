#!/usr/bin/env python3
"""Retain a committed-source review candidate, never select or publish it."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PARENT_SHA = "88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82"
PARENT = HERE / "auth-upload-security/release-sources.tar.gz"
PRODUCTS = ("artifacts/api-server/", "artifacts/projecthub/", "artifacts/uc-companion/",
            "lib/", "scripts/", "patches/")
ROOT_FILES = {".npmrc", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
              "tsconfig.json", "tsconfig.base.json"}
PROTECTED = (
    "artifacts/api-server/scripts/import-global-impact.ts",
    "artifacts/api-server/src/lib/global-impact-store.ts",
    "artifacts/api-server/src/routes/uc-impact.ts",
    "artifacts/api-server/src/lib/jwt.ts",
    "artifacts/api-server/src/lib/review-media-signature.ts",
    "artifacts/api-server/src/routes/storage.ts",
    "lib/db/src/schema/uc-global-impact.ts",
    "lib/db/migrations/0067_uc_global_impact.sql",
    "artifacts/uc-companion/hooks/useGlobalImpact.ts",
    "artifacts/uc-companion/lib/globalImpact.ts",
    "artifacts/uc-companion/lib/releasePolicy.ts",
    "artifacts/uc-companion/scripts/active-static-build.cjs",
    "artifacts/uc-companion/scripts/prepare-static-build.cjs",
)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def source_path(name):
    parts = PurePosixPath(name).parts
    if name.startswith("/") or ".." in parts:
        raise ValueError("Unsafe archive path")
    if not (name in ROOT_FILES or name.startswith(PRODUCTS)):
        return False
    if any(p in {"node_modules", "dist", "static-build", "forest-dist",
                 ".whatsapp-session", ".expo", ".expo-shared", "__pycache__"} for p in parts):
        return False
    if PurePosixPath(name).name.startswith(".env") or name.endswith(".tsbuildinfo"):
        return False
    if name.startswith("artifacts/api-server/data/"):
        return False
    return True

def files(raw, zipped=False):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz" if zipped else "r:") as archive:
        for entry in archive.getmembers():
            if not entry.isfile():
                if not entry.isdir() and entry.name.startswith(PRODUCTS):
                    raise ValueError("Only ordinary source files are accepted")
                continue
            if entry.name in result:
                raise ValueError("Duplicate source path")
            result[entry.name] = (archive.extractfile(entry).read(), entry.mode)
    return result

def prepare(commit, destination, derived_source=None):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Supply an exact committed source SHA")
    subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"], cwd=ROOT, check=True)
    parent_bytes = PARENT.read_bytes()
    if sha(parent_bytes) != PARENT_SHA:
        raise ValueError("Retained parent checksum mismatch")
    parent = files(parent_bytes, zipped=True)
    paths = [p.rstrip("/") for p in PRODUCTS] + sorted(ROOT_FILES)
    committed = files(subprocess.check_output(
        ["git", "archive", "--format=tar", commit, *paths], cwd=ROOT))
    selected = {name: value for name, value in committed.items() if source_path(name)}
    derived_paths = []
    if derived_source:
        derived_source = Path(derived_source)
        if derived_source.is_symlink() or derived_source.resolve().parent != ROOT / ".consistency-build":
            raise ValueError("Dependency overlays must come from an ordinary local staging directory")
        for name in ("package.json", "pnpm-lock.yaml", "artifacts/api-server/package.json"):
            path = derived_source / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("Dependency overlay is not an ordinary file")
            selected[name] = (path.read_bytes(), selected[name][1])
            derived_paths.append(name)
        expected_root = json.loads(committed["package.json"][0])
        expected_root["pnpm"]["overrides"].update({"fast-copy": "4.1.0", "shell-quote": "1.11.0"})
        expected_api = json.loads(committed["artifacts/api-server/package.json"][0])
        expected_api["dependencies"]["sharp"] = "0.35.5"
        if (json.loads(selected["package.json"][0]) != expected_root
                or json.loads(selected["artifacts/api-server/package.json"][0]) != expected_api):
            raise ValueError("Unrelated manifest change in dependency overlay")
    for name in PROTECTED:
        if name not in selected or selected[name][0] != parent[name][0]:
            raise ValueError("Approved consistency/security invariant differs: " + name)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(selected):
            content, mode = selected[name]
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = len(content), mode, 0
            entry.uid = entry.gid = 0
            entry.uname = entry.gname = ""
            archive.addfile(entry, io.BytesIO(content))
    compressed = gzip.compress(buffer.getvalue(), mtime=0)
    candidate = sha(compressed)
    changes = []
    for name in sorted(set(parent) | set(selected)):
        before, after = parent.get(name), selected.get(name)
        if (before and after and before[0] == after[0]
                and bool(before[1] & 0o111) == bool(after[1] & 0o111)):
            continue
        changes.append({"path": name, "kind": "added" if not before else "removed" if not after else "changed",
                        "beforeSha256": sha(before[0]) if before else None,
                        "afterSha256": sha(after[0]) if after else None,
                        "beforeBytes": len(before[0]) if before else 0,
                        "afterBytes": len(after[0]) if after else 0,
                        "beforeExecutable": bool(before[1] & 0o111) if before else None,
                        "afterExecutable": bool(after[1] & 0o111) if after else None})
    scope = {
        "sourceCommit": commit, "parentSha256": PARENT_SHA, "candidateSha256": candidate,
        "derivedDependencyPaths": derived_paths,
        "sourceFiles": len(selected), "sourceBytes": sum(len(v[0]) for v in selected.values()),
        "protectedExactParentPaths": list(PROTECTED), "files": changes,
        "excluded": "Untracked files, other products, runtime records, secret files and generated build output",
        "status": "consolidated source review only; NOT SELECTED; NOT PUBLISHED",
        "selectionApproved": False, "publicationApproved": False,
        "schemaApplied": False, "clientAdvancement": False,
    }
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "release-sources.tar.gz"
    if target.exists() and target.read_bytes() != compressed:
        previous = target.read_bytes()
        retained = destination / ("retained-" + sha(previous) + ".tar.gz")
        if retained.exists() and retained.read_bytes() != previous:
            raise ValueError("Retained review archive checksum mismatch")
        retained.write_bytes(previous)
    target.write_bytes(compressed)
    (destination / "scope.json").write_text(json.dumps(scope, indent=2) + "\n")
    summary = {k: v for k, v in scope.items() if k != "files"}
    summary["changedFileCount"] = len(changes)
    summary["scopeSha256"] = sha((destination / "scope.json").read_bytes())
    (destination / "candidate.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--derived-source-dir")
    args = parser.parse_args()
    prepare(args.source_commit, HERE / "consolidated-review", args.derived_source_dir)
