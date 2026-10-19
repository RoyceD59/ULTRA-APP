#!/usr/bin/env python3
"""Retain an unselected three-upgrade review with the exact existing cache guard."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("base_center_review", HERE / "prepare-security-center-review.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
review = base.review
OLD_PATCH = "patches/http-cache-semantics@4.2.0.patch"
review.DEST = HERE / "security-center-cache-review"
review.ALLOWED = ("package.json", "pnpm-lock.yaml")
review.PINS = {**review.PINS, "http-cache-semantics": "4.3.0"}

def validate_delta(before, after):
    if set(after) != set(before):
        raise ValueError("Unexpected added or removed source paths")
    for path in before:
        if before[path][1] != after[path][1]:
            raise ValueError(f"Source mode changed: {path}")
    changed = sorted(path for path in before if before[path][0] != after[path][0])
    if changed != ["package.json", "pnpm-lock.yaml"]:
        raise ValueError(f"Unexpected changed source files: {changed}")
    expected = json.loads(before["package.json"][0])
    expected["pnpm"]["overrides"].update(review.PINS)
    patches = expected["pnpm"]["patchedDependencies"]
    del patches["http-cache-semantics@4.2.0"]
    patches["http-cache-semantics@4.3.0"] = OLD_PATCH
    if json.loads(after["package.json"][0]) != expected:
        raise ValueError("Unrelated root manifest changes")
    result = subprocess.run(
        ["node", str(HERE / "verify-security-center-lock.mjs")],
        input=json.dumps({"before": before["pnpm-lock.yaml"][0].decode(),
                          "after": after["pnpm-lock.yaml"][0].decode(),
                          "cacheReview": True}),
        text=True, capture_output=True, cwd=HERE.parents[2], check=True,
    )
    return changed

review.validate_delta = validate_delta
if __name__ == "__main__":
    if sys.argv[1:] == ["--verify"]:
        result = review.verify()
    elif len(sys.argv) == 3 and sys.argv[1] == "--derived-source-dir":
        result = review.prepare(sys.argv[2])
    else:
        raise SystemExit("Supply --verify or --derived-source-dir PATH")
    print(json.dumps(result, indent=2))
