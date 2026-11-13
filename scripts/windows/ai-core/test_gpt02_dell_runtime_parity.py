"""Pure tempfile tests of fail-closed source/runtime custody, no live GPT02."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from gpt02_dell_runtime_parity import ParityFailure, verify

CRLF = {"dev_chatgpt_native_transport.py", "dell-wake-executor-once.mjs"}
FILES = {
    "dev_chatgpt_native_transport.py": b"alpha\n",
    "dell-wake-executor-once.mjs": b"bravo\n",
    "gpt02-local-cache-readback.js": b"charlie\n",
}
FILES.update({f"runtime-module-{i}.py": (f"module {i}\n").encode()
              for i in range(21)})


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ParityTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.src = root / "source"
        self.runtime = root / "runtime"
        self.src.mkdir()
        self.runtime.mkdir()
        for name, data in FILES.items():
            (self.src / name).write_bytes(data)
            (self.runtime / name).write_bytes(data.replace(b"\n", b"\r\n")
                                                if name in CRLF else data)
        self.manifest = {
            "scope": "GPT02_DELL_DEV_CANONICAL_DRAFT_NO_DEPLOY",
            "files": [{"name": k, "bytes": len(v), "sha256_lf": sha(v)}
                      for k, v in FILES.items()],
            "expected_windows_runtime_sha256": {
                k: sha(v.replace(b"\n", b"\r\n") if k in CRLF else v)
                for k, v in FILES.items() if k in CRLF
                or k == "gpt02-local-cache-readback.js"
            }
        }
        self.store_manifest()

    def store_manifest(self):
        (self.src / "gpt02-dell-canonical-source-manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8")

    def test_exact_windows_runtime_matches(self):
        o = verify(self.src, self.runtime, "runtime")
        self.assertEqual(o["critical_hashes"], 3)
        self.assertEqual(o["result"], "PASS")
        self.assertFalse(o["changes_made"])

    def test_linux_source_checkout_can_simulate_windows_pins(self):
        self.assertEqual(verify(self.src, self.src, "source")["result"], "PASS")

    def test_external_manifest_matches_without_touching_runtime(self):
        auditor = self.src.parent / "auditor"
        auditor.mkdir()
        manifest = auditor / "canonical.json"
        manifest.write_bytes(
            (self.src / "gpt02-dell-canonical-source-manifest.json").read_bytes())
        out = verify(self.runtime, self.runtime, "runtime", manifest)
        self.assertEqual(out["runtime_files"], len(FILES))
        self.assertEqual(out["result"], "PASS")

    def test_git_only_test_file_not_required_on_dell_runtime(self):
        only_source = "test_native_git_only.py"
        source = b"print('synthetic test')\n"
        (self.src / only_source).write_bytes(source)
        self.manifest["files"].append({
            "name": only_source, "bytes": len(source), "sha256_lf": sha(source)
        })
        self.store_manifest()
        self.assertEqual(verify(self.runtime, self.runtime, "runtime",
                                self.src / "gpt02-dell-canonical-source-manifest.json")["result"], "PASS")
        self.assertEqual(verify(self.src, self.src, "source")["result"], "PASS")

    def test_missing_runtime_fails_closed(self):
        (self.runtime / "runtime-module-1.py").unlink()
        with self.assertRaisesRegex(ParityFailure, "missing"):
            verify(self.src, self.runtime, "runtime")

    def test_changed_runtime_fails_closed(self):
        (self.runtime / "runtime-module-1.py").write_text("different")
        with self.assertRaisesRegex(ParityFailure, "drift"):
            verify(self.src, self.runtime, "runtime")

    def test_critical_windows_crlf_drift_fails(self):
        (self.runtime / "dev_chatgpt_native_transport.py").write_bytes(
            FILES["dev_chatgpt_native_transport.py"])
        with self.assertRaisesRegex(ParityFailure, "byte hash"):
            verify(self.src, self.runtime, "runtime")

    def test_duplicate_manifest_name_fails(self):
        self.manifest["files"].append(self.manifest["files"][0].copy())
        self.store_manifest()
        with self.assertRaisesRegex(ParityFailure, "duplicate"):
            verify(self.src, self.runtime, "runtime")

    def test_parent_traversal_fails(self):
        self.manifest["files"][0]["name"] = "../auth.json"
        self.store_manifest()
        with self.assertRaisesRegex(ParityFailure, "invalid manifest filename"):
            verify(self.src, self.runtime, "runtime")

    def test_symlinked_runtime_fails(self):
        f = self.runtime / "runtime-module-2.py"
        f.unlink()
        try:
            f.symlink_to(self.src / f.name)
        except OSError:
            self.skipTest("symlinks require Windows privilege")
        with self.assertRaisesRegex(ParityFailure, "symlinked"):
            verify(self.src, self.runtime, "runtime")


if __name__ == "__main__":
    unittest.main()
