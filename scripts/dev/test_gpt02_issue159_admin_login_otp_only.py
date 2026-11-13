#!/usr/bin/env python3
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "deploy/ai-coding-standalone-dev/admin_login.html"


class AdminLoginOtpOnlyTest(unittest.TestCase):
    def test_login_uses_email_otp_without_password_or_totp_challenge(self):
        source = PAGE.read_text()
        self.assertIn("Kirim OTP ke email", source)
        self.assertIn("auth('/otp?redirect_to='+encodeURIComponent(redirectTo)", source)
        self.assertIn("const redirectTo='https://dev.cstlogistic.co.id/gpt02-approval.html'", source)
        self.assertNotIn("location.origin+API_PREFIX+'/'", source)
        self.assertIn("new URLSearchParams(location.hash.replace(/^#/,''))", source)
        self.assertIn("auth('/verify'", source)
        self.assertIn("type:'email'", source)
        self.assertNotIn("grant_type=password", source)
        self.assertNotIn("'/factors/", source)
        self.assertNotIn("/factors", source.lower())
        self.assertNotIn("verify_mfa", source.lower())
        self.assertIn("aal1", source)
        self.assertIn("Super Admin aktif", source)

    def test_dashboard_api_requests_use_isolated_approval_prefix(self):
        source = PAGE.read_text()
        self.assertIn("const API_PREFIX='/gpt02-approval-api';", source)
        self.assertIn(
            "const url=API_PREFIX+(path.startsWith('/')?path:'/'+path);",
            source,
        )
        self.assertIn("fetch(url,", source)

    def test_issue159_has_one_approval_action_and_keeps_no_go_flags(self):
        source = PAGE.read_text()
        self.assertIn("/api/gpt02/issue159/approval-intent/pending", source)
        self.assertIn("/api/gpt02/issue159/approval-intent", source)
        self.assertIn("Setujui task ini satu kali", source)
        self.assertIn("Signing, authorization, dan dispatch tetap NO-GO", source)
        self.assertNotIn("dev_approval_token", source)

    def test_invalid_pending_request_has_clear_status_message(self):
        source = PAGE.read_text()
        self.assertIn("PENDING_REQUEST_INVALID:", source)
        self.assertIn("Permintaan approval tidak valid.", source)

    def test_inline_javascript_parses(self):
        source = PAGE.read_text()
        match = re.search(r"<script>([\s\S]*?)</script>", source)
        self.assertIsNotNone(match)
        result = subprocess.run(
            ["node", "--check", "-"],
            input=match.group(1),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
