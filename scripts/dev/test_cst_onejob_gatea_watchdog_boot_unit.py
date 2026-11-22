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
        self.assertIn("source-only runner now exists",RAW)
    def test_boot_activation_contract_is_explicit(self):
        self.assertEqual(field("WantedBy"),["multi-user.target"])
        self.assertEqual(field("Wants"),["network-online.target"])
        self.assertEqual(field("After"),["network-online.target"])
    def test_recovery_after_watchdog_process_failure(self):
        self.assertEqual(field("Restart"),["always"])
        self.assertEqual(field("RestartSec"),["5s"])
        self.assertEqual(field("KillMode"),["control-group"])
        self.assertEqual(field("StartLimitIntervalSec"),["0"])
        self.assertEqual(field("StartLimitBurst"),[])
    def test_missing_independent_trust_blocks_start(self):
        asserts=set(field("AssertPathExists"))
        for required in (
          "/etc/cst-onejob-dev/gatea-authority/gatea-approved-public.env",
          "/etc/cst-onejob-dev/gatea-watchdog/watchdog-admin-credential",
          "/etc/cst-onejob-dev/gatea-watchdog/supabase-root-2021.pem",
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
                         ["watchdog-db:/etc/cst-onejob-dev/gatea-watchdog/watchdog-admin-credential",
                          "watchdog-ca:/etc/cst-onejob-dev/gatea-watchdog/supabase-root-2021.pem"])
        self.assertIn("${CREDENTIALS_DIRECTORY}/watchdog-db",field("ExecStart")[0])
        self.assertIn("${CREDENTIALS_DIRECTORY}/watchdog-ca",field("ExecStart")[0])
        self.assertNotIn("DATABASE_URL",RAW)
    def test_close_only_watchdog_has_no_expiring_open_permit_dependency(self):
        self.assertNotIn("signed-gatea-manifest.json",RAW)
        self.assertNotIn("independent-gatea-approval.json",RAW)
        self.assertNotIn("preapproval_stage_broker.py validate",RAW)
        self.assertIn("${CST_GATEA_PINNED_SOURCE_SHA}",field("ExecStart")[0])
        self.assertIn("EnvironmentFile=/etc/cst-onejob-dev/gatea-authority/gatea-approved-public.env",RAW)
    def test_unit_does_not_create_authorization_or_login(self):
        self.assertEqual(len(field("ExecStart")),1)
        self.assertIn("cst_onejob_stage_watchdog_runner.py",field("ExecStart")[0])
        self.assertNotIn("ALTER ROLE",RAW)
        self.assertNotIn(" LOGIN VALID UNTIL ",RAW)
        self.assertNotIn("cst_onejob_stage_jit_open_controller.py",RAW)
    def test_nonroot_runtime_identity(self):
        # A systemd-managed transient identity works without a permanent
        # passwd entry and can read its own LoadCredential directly.
        self.assertEqual(field("DynamicUser"),["yes"])
        self.assertEqual(field("User"),["cst-onejob-gatea-watchdog"])
        self.assertEqual(field("Group"),[])
        runner=field("ExecStart")[0]
        self.assertTrue(runner.startswith("/usr/bin/python3 -B "))
        self.assertNotIn("setpriv",RAW)
        self.assertEqual(field("NoNewPrivileges"),["yes"])
    def test_dynamic_identity_verifies_both_relock_credentials(self):
        pre=field("ExecStartPre")
        self.assertEqual(len(pre),2)
        self.assertEqual(pre[0],"/usr/bin/test -r ${CREDENTIALS_DIRECTORY}/watchdog-db")
        self.assertEqual(pre[1],"/usr/bin/test -r ${CREDENTIALS_DIRECTORY}/watchdog-ca")
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