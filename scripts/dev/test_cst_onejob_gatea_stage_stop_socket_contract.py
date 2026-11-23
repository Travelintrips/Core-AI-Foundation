#!/usr/bin/env python3
"""Source-only Gate A stop socket access contract; never installs/changes systemd."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
DEPLOY=ROOT/"deploy/cst-onejob-vps/owner-stage-bootstrap"
SOCKET=(DEPLOY/"cst-onejob-gatea-stage-stop-bridge.socket.CANDIDATE").read_text()
WATCHDOG=(DEPLOY/"cst-onejob-gatea-watchdog.service.CANDIDATE").read_text()
GROUP=(DEPLOY/"cst-onejob-gatea-stop-group.sysusers.CANDIDATE").read_text()
BRIDGE=(ROOT/"scripts/dev/cst_onejob_gatea_stage_stop_bridge.py").read_text()

class GateAStopSocketContract(unittest.TestCase):
    def test_scoped_socket_path_and_group(self):
        self.assertIn("ListenStream=/run/cst-onejob-gatea-stage-stop.sock",SOCKET)
        self.assertIn("SocketUser=root",SOCKET)
        self.assertIn("SocketGroup=cst-onejob-gatea-stop",SOCKET)
    def test_socket_not_world_writable(self):
        self.assertIn("SocketMode=0660",SOCKET)
        self.assertNotIn("SocketMode=0666",SOCKET)
        self.assertNotIn("SocketMode=0777",SOCKET)
    def test_watchdog_has_only_special_supplementary_group(self):
        self.assertIn("DynamicUser=yes",WATCHDOG)
        self.assertIn("User=cst-onejob-gatea-watchdog",WATCHDOG)
        self.assertIn("SupplementaryGroups=cst-onejob-gatea-stop",WATCHDOG)
        self.assertNotIn("User=root",WATCHDOG)
    def test_group_requires_separate_provisioning(self):
        self.assertTrue(str(DEPLOY/"cst-onejob-gatea-stop-group.sysusers.CANDIDATE").endswith(".CANDIDATE"))
        self.assertIn("g cst-onejob-gatea-stop - -",GROUP)
    def test_source_never_launches_other_unit(self):
        self.assertIn('BROKER = "cst-onejob-gatea-preapproval-broker.service"',BRIDGE)
        self.assertIn("socket.SO_PEERCRED",BRIDGE)
        self.assertNotIn("subprocess.Popen(",BRIDGE)
    def test_no_operational_authority_from_source_candidate(self):
        self.assertTrue((DEPLOY/"cst-onejob-gatea-stage-stop-bridge.socket.CANDIDATE").exists())
        self.assertIn("SOURCE CANDIDATE ONLY",SOCKET)
        self.assertNotIn("ExecStart=/bin/sh",WATCHDOG)
        self.assertNotIn("ALTER ROLE cst_team_model_pilot_stage_login LOGIN",WATCHDOG)
if __name__=="__main__":unittest.main(verbosity=2)
