import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "deploy/vps-dev/cst-vps-dev-release.py"
spec = importlib.util.spec_from_file_location("dev_release_approval_static", SOURCE)
release = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(release)

VALID = b'''<!doctype html><html><head><title>AI Coding DEV | Admin</title></head>
<body><script>api('/api/gpt02/issue159/approval-intent',{claims:d.claims});</script></body></html>'''


class DevReleaseApprovalStaticTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.src = self.root / "trusted-approval.html"
        self.src.write_bytes(VALID)
        self.src.chmod(0o644)
        self.target = self.root / "candidate"
        self.target.mkdir()

    def copy(self):
        return release.copy_gpt02_approval_static(
            self.target, self.src, expected_uid=os.getuid())

    def test_valid_readonly_login_preserved_with_matching_bytes_and_mode(self):
        self.copy()
        result = self.target / "gpt02-approval.html"
        self.assertEqual(result.read_bytes(), VALID)
        self.assertEqual(result.stat().st_mode & 0o777, 0o644)

    def test_symlink_source_cannot_escape_trusted_file(self):
        link = self.root / "source-link"
        link.symlink_to(self.src)
        with self.assertRaisesRegex(RuntimeError, "custody"):
            release.copy_gpt02_approval_static(
                self.target, link, expected_uid=os.getuid())

    def test_source_must_be_0644(self):
        self.src.chmod(0o666)
        with self.assertRaisesRegex(RuntimeError, "custody"):
            self.copy()

    def test_missing_source_does_not_create_target(self):
        self.src.unlink()
        with self.assertRaises(OSError):
            self.copy()
        self.assertFalse((self.target / "gpt02-approval.html").exists())

    def test_existing_static_asset_never_overwritten(self):
        path = self.target / "gpt02-approval.html"
        path.write_text("EXISTING")
        with self.assertRaisesRegex(RuntimeError, "collision"):
            self.copy()
        self.assertEqual(path.read_text(), "EXISTING")

    def test_malformed_login_contract_fail_closed(self):
        self.src.write_bytes(b"<html>Bad login</html>")
        with self.assertRaisesRegex(RuntimeError, "contract"):
            self.copy()

    def test_release_integrates_copy_before_static_swap_and_https_readback(self):
        source = SOURCE.read_text()
        self.assertIn("copy_gpt02_approval_static(tempstatic)", source)
        self.assertIn("verify_gpt02_approval_https()", source)
        self.assertLess(source.index("copy_gpt02_approval_static(tempstatic)"),
                        source.index("tempstatic.rename(STATIC)"))
        self.assertLess(source.index("verify_gpt02_approval_https()", source.rfind("verify_gpt02_approval_https()")),
                        source.index("complete = True"))

if __name__ == "__main__":
    unittest.main()
