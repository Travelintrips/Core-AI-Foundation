#!/usr/bin/env python3
"""Static contract for independent Gate-A watchdog on-boot service candidate.

No unit install/enable/start, no credential reads and no database access.
No claim of host-reboot, real Supavisor draining or operational readiness.
"""
import unittest
from pathlib import Path

UNIT=Path(__file__).resolve().parents[2]/"deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-gatea-watchdog.service.CANDIDATE"
RAW=UNIT.read_text()
LINES=RAW.splitlines()

def field(name):
    prefix=name+"="
    return [line.split("=",1)[1].strip() for line in LINES if line.startswith(prefix)]

class WatchdogBootCandidateTests(unittest.TestCase):
    def test_candidate_cannot_be_auto_loaded_as_installed_unit(self):
        self.assertTrue(str(UNIT).endswith(".service.CANDIDATE"))
        self.assertIn("DO NOT install, enable or start",RAW)
        self.assertIn("runner deliberately does NOT exist",RAW)
    def test_boot_activation_contract_is_explicit(self):
        self.assertEqual(field("WantedBy"),["multi-user.target"])
        self.assertEqual(field("Wants"),["network-online.target"])
        self.assertEqual(field("After"),["network-online.target"])
    def test_recovery_after_watchdog_process_failure(self):
        self.assertEqual(field("Restart"),["on-failure"])
        self.assertEqual(field("RestartSec"),["5s"])
        self.assertEqual(field("KillMode"),["control-group"])
        self.assertEqual(field("StartLimitBurst"),["5"])
    def test_missing_independent_trust_blocks_start(self):
        asserts=set(field("AssertPathExists"))
        for required in (
          "/etc/cst-onejob-dev/gatea-authority/approved-gatea-public.pem",
          "/etc/cst-onejob-dev/gatea-authority/signed-gatea-manifest.json",
          "/etc/cst-onejob-dev/gatea-authority/gatea-approved-public.env",
          "/etc/cst-onejob-dev/gatea-authority/independent-gatea-approval.json",
          "/etc/cst-onejob-dev/gatea-watchdog/watchdog-admin-credential",
          "/run/netns/cst-onejob-gatea-watchdog-reviewed",
          "/opt/cst-onejob-dev/bootstrap/cst_onejob_stage_watchdog_runner.py"
        ):
            with self.subTest(required=required):
                self.assertIn(required,asserts)
    def test_watchdog_has_independent_namespace(self):
        self.assertEqual(field("NetworkNamespacePath"),
                         ["/run/netns/cst-onejob-gatea-watchdog-reviewed"])
        self.assertNotIn("cst-onejob-gatea-reviewed",field("NetworkNamespacePath")[0])
    def test_admin_credential_is_separate_and_systemd_loaded(self):
        self.assertEqual(field("LoadCredential"),
                         ["watchdog-db:/etc/cst-onejob-dev/gatea-watchdog/watchdog-admin-credential"])
        self.assertIn("${CREDENTIALS_DIRECTORY}/watchdog-db",field("ExecStart")[0])
        self.assertNotIn("DATABASE_URL",RAW)
    def test_reuses_existing_signature_validator_and_source_pin(self):
        pre=field("ExecStartPre")
        self.assertEqual(len(pre),2)
        self.assertIn("cst_onejob_preapproval_stage_broker.py validate",pre[0])
        self.assertIn("${CST_GATEA_APPROVED_PUBKEY_SHA256}",pre[0])
        self.assertIn("${CST_GATEA_PINNED_SOURCE_SHA}",pre[0])
        self.assertIn("EnvironmentFile=/etc/cst-onejob-dev/gatea-authority/gatea-approved-public.env",RAW)
    def test_unit_does_not_create_authorization_or_login(self):
        self.assertEqual(len(field("ExecStart")),1)
        self.assertIn("cst_onejob_stage_watchdog_runner.py",field("ExecStart")[0])
        self.assertNotIn("ALTER ROLE",RAW)
        self.assertNotIn(" LOGIN VALID UNTIL ",RAW)
        self.assertNotIn("cst_onejob_stage_jit_open_controller.py",RAW)
    def test_nonroot_runtime_identity(self):
        # systemd 255 fails numeric User=28502 without an NSS entry
        # (217/USER). Root wrapper must immediately drop UID/GID.
        self.assertEqual(field("User"),["root"])
        self.assertEqual(field("Group"),["root"])
        runner=field("ExecStart")[0]
        self.assertTrue(runner.startswith("/usr/bin/setpriv --no-new-privs --bounding-set=-all --reuid=28502 --regid=28503 --clear-groups /usr/bin/python3 -B "))
        self.assertEqual(field("NoNewPrivileges"),["yes"])
    def test_nonroot_identity_verifies_manifest_and_credential_access(self):
        pre=field("ExecStartPre")
        self.assertEqual(len(pre),2)
        self.assertTrue(all(cmd.startswith("/usr/bin/setpriv --no-new-privs --bounding-set=-all --reuid=28502 --regid=28503 --clear-groups ") for cmd in pre))
        self.assertIn("cst_onejob_preapproval_stage_broker.py validate",pre[0])
        self.assertIn("/usr/bin/test -r ${CREDENTIALS_DIRECTORY}/watchdog-db",pre[1])
        self.assertEqual(field("CapabilityBoundingSet"),[""])
        self.assertEqual(field("AmbientCapabilities"),[""])
    def test_runtime_and_disk_permissions(self):
        self.assertEqual(field("UMask"),["0077"])
        self.assertEqual(field("RuntimeDirectoryMode"),["0700"])
        self.assertEqual(field("RuntimeDirectoryPreserve"),["no"])
    def test_resource_and_os_isolation(self):
        for property in ("ProtectSystem","ProtectHome","PrivateTmp",
                         "PrivateDevices","ProtectKernelTunables",
                         "ProtectKernelModules","ProtectControlGroups",
                         "RestrictSUIDSGID","LockPersonality"):
            with self.subTest(property=property):
                self.assertIn(field(property)[0],("yes","strict"))
        self.assertEqual(field("MemoryMax"),["192M"])
        self.assertEqual(field("TasksMax"),["16"])
    def test_no_reboot_or_operational_claim(self):
        self.assertIn("NOT proof of a full VPS power-off relock",RAW)
        self.assertIn("host-reboot test",RAW)

if __name__=="__main__":
    unittest.main(verbosity=2)
