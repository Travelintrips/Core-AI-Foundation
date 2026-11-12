"""Regression gate: atomic DEV frontend releases must retain the existing GPT02 OTP page.

Read-only source tests. No VPS, Supabase, database, passwords, or deployment.
"""
from pathlib import Path
import ast
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = (
    ROOT / "scripts/vps/deploy_dev_release.py",
    ROOT / "deploy/vps-dev/cst-vps-dev-release.py",
)


class ApprovalUiReleaseRetentionTest(unittest.TestCase):
    def test_both_dev_release_scripts_preserve_admin_ui(self):
        source_bodies = [p.read_text() for p in SCRIPTS]
        for path, body in zip(SCRIPTS, source_bodies):
            with self.subTest(path=str(path)):
                tree = ast.parse(body)
                names = [
                    node.name for node in ast.walk(tree)
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                ]
                self.assertEqual(names.count("preserve_issue159_approval_ui"), 1)
                self.assertIn('Path("/opt/ai-coding-standalone-dev/admin_login.html")', body)
                self.assertIn('staged_static / "gpt02-approval.html"', body)
                self.assertIn('source.is_symlink()', body)
                self.assertIn('entry.st_uid != 0', body)
                self.assertIn('entry.st_gid != 0', body)
                self.assertIn('destination.chmod(0o644)', body)
                self.assertIn('DEV_ISSUE159_APPROVAL_UI_STAGING_COLLISION', body)
                self.assertIn('DEV_ISSUE159_APPROVAL_UI_SOURCE_SECURITY_INVALID', body)
                self.assertIn('DEV_ISSUE159_APPROVAL_UI_SOURCE_INVALID', body)
                self.assertIn('b"API_PREFIX=\'/gpt02-approval-api\'"', body)
                self.assertEqual(body.count('preserve_issue159_approval_ui(tempstatic)'), 1)
                self.assertLess(
                    body.index('preserve_issue159_approval_ui(tempstatic)'),
                    body.index('tempstatic.rename(STATIC)'),
                )
                self.assertNotIn('PROD.rename(', body)
        self.assertEqual(
            source_bodies[0][source_bodies[0].index('def preserve_issue159_approval_ui('):
                             source_bodies[0].index('def main(sha):')],
            source_bodies[1][source_bodies[1].index('def preserve_issue159_approval_ui('):
                             source_bodies[1].index('def main(sha):')],
        )


if __name__ == "__main__":
    unittest.main()
