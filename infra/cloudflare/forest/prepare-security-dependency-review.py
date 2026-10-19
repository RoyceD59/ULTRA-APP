#!/usr/bin/env python3
"""Seal a dependency-only review archive; never select or publish it."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PARENT_SHA = "88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82"
PARENT = HERE / "auth-upload-security/release-sources.tar.gz"
DEST = HERE / "security-dependency-review"
ALLOWED = ("package.json", "artifacts/api-server/package.json", "pnpm-lock.yaml")
PINS = {"sharp": "0.35.5", "shell-quote": "1.11.0", "music-metadata": "11.16.0"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def files(raw):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        for entry in archive.getmembers():
            path = PurePosixPath(entry.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe archive path")
            if entry.isdir():
                continue
            if not entry.isfile() or entry.name in result:
                raise ValueError("Only unique ordinary files are allowed")
            result[entry.name] = (archive.extractfile(entry).read(), entry.mode)
    return result


def parent_files():
    raw = PARENT.read_bytes()
    if sha(raw) != PARENT_SHA:
        raise ValueError("Selected parent archive checksum mismatch")
    return files(raw)


def validate_delta(before, after):
    if set(before) != set(after):
        raise ValueError("Files added or removed from frozen source")
    changed = []
    for path in sorted(before):
        if before[path] != after[path]:
            if path not in ALLOWED or before[path][1] != after[path][1]:
                raise ValueError("Unrelated source/mode change: " + path)
            changed.append(path)
    if set(changed) != set(ALLOWED):
        raise ValueError("Expected exactly three dependency files")
    expected_root = json.loads(before["package.json"][0])
    expected_root["pnpm"]["overrides"].update({
        "shell-quote": PINS["shell-quote"],
        "music-metadata": PINS["music-metadata"],
    })
    expected_api = json.loads(before["artifacts/api-server/package.json"][0])
    expected_api["dependencies"]["sharp"] = PINS["sharp"]
    if json.loads(after["package.json"][0]) != expected_root:
        raise ValueError("Unrelated root manifest change")
    if json.loads(after["artifacts/api-server/package.json"][0]) != expected_api:
        raise ValueError("Unrelated API manifest change")
    def importers(raw):
        section = raw.decode().split("\nimporters:\n", 1)[1].split("\npackages:\n", 1)[0]
        matches = list(re.finditer(r"^  (\S[^\n]*):\n", section, re.MULTILINE))
        return {match[1]: section[match.start():
                matches[n + 1].start() if n + 1 < len(matches) else len(section)]
                for n, match in enumerate(matches)}
    old_importers = importers(before["pnpm-lock.yaml"][0])
    new_importers = importers(after["pnpm-lock.yaml"][0])
    if set(old_importers) != set(new_importers):
        raise ValueError("Unrelated lockfile importer addition/removal")
    def semantic_importer(raw):
        groups = list(re.finditer(r"^    (\S[^\n]*):\n", raw, re.MULTILINE))
        result = {}
        for n, group in enumerate(groups):
            section = raw[group.end():groups[n + 1].start()
                          if n + 1 < len(groups) else len(raw)]
            entries = list(re.finditer(r"^      (\S[^\n]*):\n", section, re.MULTILINE))
            result[group[1]] = {
                entry[1]: section[entry.end():entries[i + 1].start()
                                  if i + 1 < len(entries) else len(section)].strip()
                for i, entry in enumerate(entries)}
        return result
    for name, original in old_importers.items():
        expected = original
        if name == "artifacts/api-server":
            expected = expected.replace("sharp@0.35.4", "sharp@0.35.5")
            expected = expected.replace("specifier: ^0.35.4", "specifier: 0.35.5")
            expected = expected.replace("version: 0.35.4(", "version: 0.35.5(")
        if semantic_importer(new_importers[name]) != semantic_importer(expected):
            raise ValueError("Unrelated lockfile importer change: " + name)
    return changed


def prepare(derived):
    derived = Path(derived)
    if derived.is_symlink() or derived.resolve().parent != ROOT / ".consistency-build":
        raise ValueError("Use an ordinary checksum/review staging directory")
    before = parent_files()
    after = dict(before)
    for path in ALLOWED:
        source = derived / path
        if source.is_symlink() or not source.is_file():
            raise ValueError("Overlay is not an ordinary file: " + path)
        after[path] = (source.read_bytes(), before[path][1])
    changed = validate_delta(before, after)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for path, (content, mode) in sorted(after.items()):
            entry = tarfile.TarInfo(path)
            entry.size, entry.mode, entry.mtime = len(content), mode, 0
            entry.uid = entry.gid = 0
            entry.uname = entry.gname = ""
            archive.addfile(entry, io.BytesIO(content))
    raw = gzip.compress(buffer.getvalue(), mtime=0)
    scope = {
        "parentSha256": PARENT_SHA,
        "candidateSha256": sha(raw),
        "changedPaths": changed,
        "unchangedParentFiles": len(before) - len(changed),
        "dependencyPins": PINS,
        "files": [{"path": path,
                   "beforeSha256": sha(before[path][0]),
                   "afterSha256": sha(after[path][0]),
                   "beforeBytes": len(before[path][0]),
                   "afterBytes": len(after[path][0])} for path in changed],
    }
    DEST.mkdir(exist_ok=True)
    existing = DEST / "release-sources.tar.gz"
    if existing.exists() and existing.read_bytes() != raw:
        raise ValueError("Retained review bytes differ; use a separately reviewed revision")
    (DEST / "release-sources.tar.gz").write_bytes(raw)
    (DEST / "scope.json").write_text(json.dumps(scope, indent=2) + "\n")
    (DEST / "candidate.json").write_text(json.dumps({
        **{key: scope[key] for key in ("parentSha256", "candidateSha256",
                                     "changedPaths", "unchangedParentFiles",
                                     "dependencyPins")},
        "scopeSha256": sha((DEST / "scope.json").read_bytes()),
        "status": "dependency-only review; NOT SELECTED; NOT PUBLISHED",
        "selectionApproved": False, "publicationApproved": False,
        "schemaApplied": False, "clientAdvancement": False,
    }, indent=2) + "\n")
    return verify()


def verify():
    before = parent_files()
    raw = (DEST / "release-sources.tar.gz").read_bytes()
    meta = json.loads((DEST / "candidate.json").read_bytes())
    scope = json.loads((DEST / "scope.json").read_bytes())
    changed = validate_delta(before, files(raw))
    if (meta["parentSha256"] != PARENT_SHA
            or meta["candidateSha256"] != sha(raw)
            or meta["scopeSha256"] != sha((DEST / "scope.json").read_bytes())
            or scope["candidateSha256"] != sha(raw)
            or meta["changedPaths"] != changed
            or scope["changedPaths"] != changed
            or meta["dependencyPins"] != PINS
            or scope["dependencyPins"] != PINS
            or meta["selectionApproved"] or meta["publicationApproved"]
            or meta["schemaApplied"] or meta["clientAdvancement"]):
        raise ValueError("Review metadata/checksum/approval mismatch")
    after = files(raw)
    expected_files = [{"path": path, "beforeSha256": sha(before[path][0]),
                       "afterSha256": sha(after[path][0]),
                       "beforeBytes": len(before[path][0]),
                       "afterBytes": len(after[path][0])} for path in changed]
    if (scope["files"] != expected_files
            or scope["parentSha256"] != PARENT_SHA
            or scope["unchangedParentFiles"] != len(before) - len(changed)
            or meta["unchangedParentFiles"] != len(before) - len(changed)):
        raise ValueError("Reviewed byte scope mismatch")
    return meta


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--derived-source-dir")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if not args.verify and not args.derived_source_dir:
        parser.error("Supply --derived-source-dir or --verify")
    print(json.dumps(verify() if args.verify else prepare(args.derived_source_dir),
                     indent=2))
