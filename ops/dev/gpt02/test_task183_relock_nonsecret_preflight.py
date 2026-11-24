import importlib.util
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).with_name("task183_relock_nonsecret_preflight.py")
spec = importlib.util.spec_from_file_location("task183_preflight", MODULE)
m = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = m
spec.loader.exec_module(m)

SOURCE = """const REF='xssrfshdrtdfupgqwfdw';
const ROLE='gpt02_task183_relock_login.'+REF;
const root=env.CREDENTIALS_DIRECTORY;
if(typeof root!=='string'||root!=='/run/credentials/gpt02-task183-preparer-relock.service')
  fail('TASK183_RELOCK_CREDENTIAL_DIR_INVALID');
fail('TASK183_RELOCK_DEV_ONLY');
fail('TASK183_RELOCK_CA_INVALID');
"""
UNIT = """[Service]
LoadCredentialEncrypted=task183-relock-dsn:/etc/credstore.encrypted/gpt02-task183-relock-dsn
Environment=NODE_ENV=development
Environment=APP_ENV=development
Environment=GPT02_TASK183_RELOCK_SCOPE=CST-DEV_TASK183
"""

class TestTask183RelockPreflight(unittest.TestCase):
    def test_exact_contract_in_missing_credential_is_blocked(self):
        verdict = m.check_contract(SOURCE, UNIT, credential_present=False,
                                   timer_active=False, service_active=False)
        self.assertTrue(verdict.checks["systemd_credential_directory_matches"])
        self.assertTrue(verdict.checks["pooler_username_contract"])
        self.assertFalse(verdict.checks["sealed_relock_credential_exists"])
        self.assertFalse(verdict.as_dict()["canActivate"])
        self.assertIn("SEALED_RELOCK_CREDENTIAL_EXISTS", verdict.blockers)

    def test_even_with_credential_preflight_never_authorizes(self):
        data = m.check_contract(SOURCE, UNIT, credential_present=True,
                                timer_active=False, service_active=False).as_dict()
        self.assertTrue(all(data["checks"].values()))
        self.assertFalse(data["canActivate"])
        self.assertIn("AUTHORIZED_JIT_ISSUER_AND_POST_RELOCK_PROOF_REQUIRED", data["blockers"])
        self.assertFalse(data["databaseQueried"])
        self.assertFalse(data["relockExecuted"])

    def test_renamed_unit_path_denied(self):
        altered = SOURCE.replace("gpt02-task183-preparer-relock.service",
                                 "gpt02-task183-other-relock.service")
        self.assertFalse(m.check_contract(altered, UNIT, credential_present=True,
                         timer_active=False, service_active=False).checks[
                             "systemd_credential_directory_matches"])

    def test_credentials_mismatch_denied(self):
        bad = UNIT.replace("/etc/credstore.encrypted/gpt02-task183-relock-dsn",
                           "/tmp/unsafe")
        self.assertFalse(m.check_contract(SOURCE, bad, credential_present=True,
                         timer_active=False, service_active=False).checks[
                             "unit_credential_source_matches"])

    def test_prod_and_wrong_scope_denied(self):
        altered = UNIT.replace("Environment=APP_ENV=development",
                               "Environment=APP_ENV=production")
        self.assertFalse(m.check_contract(SOURCE, altered, credential_present=True,
                         timer_active=False, service_active=False).checks["service_dev_only"])

    def test_active_timer_and_service_denied(self):
        v = m.check_contract(SOURCE, UNIT, credential_present=True,
                             timer_active=True, service_active=True)
        self.assertFalse(v.checks["timer_not_running"])
        self.assertFalse(v.checks["service_not_running"])

    def test_unavailable_read_is_fail_closed(self):
        with patch.object(m, "systemctl", side_effect=OSError("offline")):
            out=io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(m.main(), 2)
            report=json.loads(out.getvalue())
        self.assertEqual(report["blockers"], ["HOST_PREFLIGHT_UNAVAILABLE"])
        self.assertFalse(report["canActivate"])

if __name__ == "__main__":
    unittest.main()
