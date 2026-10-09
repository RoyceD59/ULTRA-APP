#!/usr/bin/env python3
"""Seal a separate dependency-only review; never select or publish it."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "review", HERE / "prepare-security-dependency-review.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
review.PARENT_SHA = "1e4c4a6ab52703298db9b4b460cc7faed8ccd796a672f46a9b8baa6c905e9af0"
review.PARENT = HERE / "security-dependency-review/release-sources.tar.gz"
review.DEST = HERE / "security-center-review"
review.ALLOWED = ("package.json", "pnpm-lock.yaml")
review.PINS = {"fast-copy": "4.1.0", "postcss-selector-parser": "7.1.6"}


def validate_delta(before, after):
    if set(before) != set(after):
        raise ValueError("Files added or removed")
    changed = []
    for path in sorted(before):
        if before[path] != after[path]:
            if path not in review.ALLOWED or before[path][1] != after[path][1]:
                raise ValueError("Unrelated source/mode change: " + path)
            changed.append(path)
    if set(changed) != set(review.ALLOWED):
        raise ValueError("Expected exactly two dependency files")
    expected = json.loads(before["package.json"][0])
    expected["pnpm"]["overrides"].update(review.PINS)
    if json.loads(after["package.json"][0]) != expected:
        raise ValueError("Unrelated root manifest change")
    result = subprocess.run(
        ["node", str(HERE / "verify-security-center-lock.mjs")],
        input=json.dumps({
            "before": before["pnpm-lock.yaml"][0].decode(),
            "after": after["pnpm-lock.yaml"][0].decode(),
        }), text=True, capture_output=True)
    if result.returncode:
        raise ValueError("Lock scope verification failed: " + result.stderr)
    return changed


review.validate_delta = validate_delta
if __name__ == "__main__":
    if sys.argv[1:] == ["--verify"]:
        output = review.verify()
    elif len(sys.argv) == 3 and sys.argv[1] == "--derived-source-dir":
        output = review.prepare(sys.argv[2])
    else:
        raise SystemExit("Supply --verify or --derived-source-dir PATH")
    print(json.dumps(output, indent=2))
