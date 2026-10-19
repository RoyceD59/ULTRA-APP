"""Negative scope checks use in-memory copies; no production/workspace mutation."""
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "dependency_review", HERE / "prepare-security-dependency-review.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = review.parent_files()
        cls.after = review.files((review.DEST / "release-sources.tar.gz").read_bytes())

    def test_exact_review_and_checksums(self):
        self.assertEqual(review.verify()["changedPaths"], sorted(review.ALLOWED))

    def test_unrelated_customer_route_is_rejected(self):
        changed = dict(self.after)
        path = "artifacts/api-server/src/routes/uc.ts"
        raw, mode = changed[path]
        changed[path] = (raw + b"\n", mode)
        with self.assertRaisesRegex(ValueError, "Unrelated source"):
            review.validate_delta(self.before, changed)

    def test_unrelated_manifest_change_is_rejected(self):
        changed = dict(self.after)
        raw, mode = changed["package.json"]
        manifest = json.loads(raw)
        manifest["scripts"]["build"] = "echo bypass"
        changed["package.json"] = (json.dumps(manifest).encode(), mode)
        with self.assertRaisesRegex(ValueError, "Unrelated root manifest"):
            review.validate_delta(self.before, changed)

    def test_unrelated_lock_importer_version_is_rejected(self):
        changed = dict(self.after)
        raw, mode = changed["pnpm-lock.yaml"]
        self.assertIn(b"specifier: 8.22.0", raw)
        changed["pnpm-lock.yaml"] = (raw.replace(b"specifier: 8.22.0",
                                                b"specifier: 8.23.0", 1), mode)
        with self.assertRaisesRegex(ValueError, "Unrelated lockfile importer"):
            review.validate_delta(self.before, changed)

    def test_file_removal_is_rejected(self):
        changed = dict(self.after)
        del changed["artifacts/api-server/src/routes/uc.ts"]
        with self.assertRaisesRegex(ValueError, "Files added or removed"):
            review.validate_delta(self.before, changed)

    def test_mode_change_is_rejected(self):
        changed = dict(self.after)
        raw, mode = changed["package.json"]
        changed["package.json"] = (raw, mode ^ 0o111)
        with self.assertRaisesRegex(ValueError, "Unrelated source/mode"):
            review.validate_delta(self.before, changed)


if __name__ == "__main__":
    unittest.main()
