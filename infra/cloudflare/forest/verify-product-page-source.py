"""Verify reviewed source bytes/modes and optionally an existing build stage."""
import hashlib
import json
import os
import pathlib
import stat
import sys
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def archive(path):
    files = {}
    with tarfile.open(path, "r:gz") as source:
        for entry in source:
            name = entry.name
            parts = pathlib.PurePosixPath(name).parts
            if not parts or name.startswith("/") or ".." in parts or "\\" in name:
                raise ValueError("Unsafe source archive path")
            if entry.isdir():
                continue
            if not entry.isfile() or name in files:
                raise ValueError("Unexpected or duplicate archive entry")
            if entry.mode & 0o7000:
                raise ValueError("Privileged archive mode")
            files[name] = (source.extractfile(entry).read(), entry.mode & 0o777)
    return files


candidate = archive(sys.argv[1])
parent = archive(sys.argv[2])
scope = json.loads(pathlib.Path(sys.argv[3]).read_text())
assert len({entry["path"] for entry in scope}) == len(scope), "Duplicate scope path"
assert set(parent) <= set(candidate), "Parent source deleted"
changed = sorted(name for name, value in candidate.items() if parent.get(name) != value)
assert changed == sorted(entry["path"] for entry in scope), "Unapproved source delta"
for entry in scope:
    name = entry["path"]
    assert digest(candidate[name][0]) == entry["afterSha256"], "Changed source mismatch"
    before = digest(parent[name][0]) if name in parent else None
    assert before == entry["beforeSha256"], "Parent source mismatch"
assert candidate["pnpm-lock.yaml"] == parent["pnpm-lock.yaml"], "Dependency lock changed"

if len(sys.argv) > 4:
    root = pathlib.Path(sys.argv[4]).absolute()
    assert not root.is_symlink(), "Stage root is a symlink"
    for name, (data, mode) in candidate.items():
        target = root / name
        for ancestor in target.parents:
            if ancestor == root:
                break
            assert not ancestor.is_symlink(), "Source directory is a symlink"
        observed = target.lstat()
        assert stat.S_ISREG(observed.st_mode), "Source entry is not a regular file"
        assert stat.S_IMODE(observed.st_mode) == mode, "Source mode mismatch: " + name
        assert target.read_bytes() == data, "Stage source mismatch: " + name
    # Extra JS/TS can shadow reviewed imports even when all expected files match.
    generated = {"node_modules", "dist", "static-build", ".git", ".expo",
                 ".pnpm-store", ".cache", ".turbo"}
    for directory, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if name not in generated]
        for name in dirs:
            assert not (pathlib.Path(directory) / name).is_symlink(), "Unexpected source symlink"
        for name in names:
            target = pathlib.Path(directory) / name
            relative = target.relative_to(root).as_posix()
            if relative == "artifacts/uc-companion/expo-env.d.ts" and relative not in candidate:
                expected = ('/// <reference types="expo/types" />\n\n'
                            '// NOTE: This file should not be edited and should be in your git ignore')
                assert target.read_text().strip() == expected, "Unexpected Expo declaration content"
                continue
            if target.suffix in {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}:
                assert relative in candidate, "Unreviewed executable source: " + relative

print(json.dumps({"sourceFiles": len(candidate),
                  "unchangedParentFiles": len(candidate) - len(changed),
                  "changedFiles": len(changed), "stageVerified": len(sys.argv) > 4}))
