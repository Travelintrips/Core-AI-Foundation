"""Fail-closed on-demand DEV chain runner tests; no actual signing or DB."""
from pathlib import Path
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parent / "gpt02_issue159_approved_chain_once.py"
sys.path.insert(0, str(Path(__file__).resolve().parents[2] /
                       "deploy/ai-coding-standalone-dev"))
spec=importlib.util.spec_from_file_location("issue159_chain_once",SOURCE)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ApprovedChainOnceTest(unittest.TestCase):
    def test_cli_requires_explicit_authorization_and_cannot_create_task(self):
        env=dict(os.environ)
        env.pop("GPT02_ISSUE159_CHAIN_ONCE",None)
        process=subprocess.run([sys.executable,str(SOURCE)],
                               env=env,capture_output=True,text=True,
                               timeout=5,check=False)
        self.assertEqual(process.returncode,2)
        self.assertIn("GPT02_DEV_CHAIN_DENIED",process.stderr)
        self.assertNotIn("THREE_SIGNERS_AND_ATTESTOR_RPC_FINISHED",process.stdout)
        source=SOURCE.read_text()
        for forbidden in ("INSERT INTO","UPDATE gpt02","DELETE FROM",
                          "psycopg.connect(", "refresh_pending(", "prepare_core_task(",
                          "dispatch_to_dell(", "GPT02_ISSUE159_SIGNING_ENABLED=true"):
            self.assertNotIn(forbidden,source)

    def test_missing_dedicated_attestor_secret_prevents_signing(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(mod.os,"geteuid",return_value=0), \
                 patch.dict(os.environ,{"APP_ENV":"development",
                                       "GPT02_ISSUE159_CHAIN_ONCE":"explicit-supervised"}), \
                 patch.object(mod,"ATTESTOR_CRED",Path(d)/"absent"):
                def no_external_calls(*args,**kwargs):
                    raise AssertionError("NO_EXTERNAL_ACTION_ALLOWED")
                with self.assertRaisesRegex(mod.ChainDenied,"CHAIN_ATTESTOR_SECRET_NOT_PREPARED"):
                    mod.preflight(no_external_calls)

    def test_missing_dedicated_issuer_secret_blocks_before_any_signing(self):
        with tempfile.TemporaryDirectory() as d:
            cred=SimpleNamespace(
                is_file=lambda: True, is_symlink=lambda: False,
                stat=lambda: SimpleNamespace(st_uid=0, st_mode=0o100600),
            )
            with patch.object(mod.os,"geteuid",return_value=0), \
                 patch.dict(os.environ,{"APP_ENV":"development",
                                       "GPT02_ISSUE159_CHAIN_ONCE":"explicit-supervised"}), \
                 patch.object(mod,"ATTESTOR_CRED",cred), \
                 patch.object(mod,"ISSUER_CRED",Path(d)/"absent"):
                with self.assertRaisesRegex(mod.ChainDenied,"CHAIN_ISSUER_SECRET_NOT_PREPARED"):
                    mod.preflight(lambda *args,**kwargs: (_ for _ in ()).throw(
                        AssertionError("NO_SIGNER_OR_READER_CALL_ALLOWED")))

    def test_issuer_finalizer_failure_stops_outer_chain_without_false_success(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            units=(("approval","fixture-approval",root/"approval"),
                   ("hub","fixture-hub",root/"hub"),
                   ("core","fixture-core",root/"core"))
            called=[]
            def fake_start(unit,run):
                called.append(unit)
                if unit=="fixture-issuer":
                    raise RuntimeError("SYNTHETIC_ISSUER_FINALIZER_FAILURE")
                for _,name,path in units:
                    if name==unit: path.write_text("synthetic")
            with patch.object(mod,"LOCK",root/"lock"), \
                 patch.object(mod,"LINK_ASSEMBLER",root/"builder"), \
                 patch.object(mod,"SIGNER_UNITS",units), \
                 patch.object(mod,"ATTESTOR_UNIT","fixture-attestor"), \
                 patch.object(mod,"ISSUER_UNIT","fixture-issuer"), \
                 patch.object(mod,"preflight"), \
                 patch.object(mod,"require_link_and_time"), \
                 patch.object(mod,"start_once",side_effect=fake_start):
                with self.assertRaisesRegex(RuntimeError,"SYNTHETIC_ISSUER_FINALIZER_FAILURE"):
                    mod.execute(lambda *args,**kw: SimpleNamespace(stdout=""))
                self.assertEqual(called,["fixture-approval","fixture-hub",
                                         "fixture-core","fixture-attestor",
                                         "fixture-issuer"])

    def test_preexisting_signer_output_denies_replay_before_service_start(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            # The CI runner is non-root. Simulate an exact root-owned 0600
            # encrypted credential without weakening the live root-only check.
            cred=SimpleNamespace(
                is_file=lambda: True, is_symlink=lambda: False,
                stat=lambda: SimpleNamespace(st_uid=0, st_mode=0o100600),
            )
            assembler=root/"assemble";assembler.write_text("# test")
            output=root/"approval.json";output.write_text("already done")
            with patch.object(mod.os,"geteuid",return_value=0), \
                 patch.dict(os.environ,{"APP_ENV":"development",
                                       "GPT02_ISSUE159_CHAIN_ONCE":"explicit-supervised"}), \
                 patch.object(mod,"ATTESTOR_CRED",cred), \
                 patch.object(mod,"ISSUER_CRED",cred), \
                 patch.object(mod,"ISSUER_SIGNER_KEY",cred), \
                 patch.object(mod,"LINK_ASSEMBLER",assembler), \
                 patch.object(mod,"LINK",root/"absent-link"), \
                 patch.object(mod,"SIGNER_UNITS",(("approval","fixture-unit",output),)):
                with self.assertRaisesRegex(mod.ChainDenied,"CHAIN_SIGNER_RECEIPT_ALREADY_EXISTS"):
                    mod.preflight(lambda *args,**kw: (_ for _ in ()).throw(
                        AssertionError("NO_SYSTEMCTL_EXPECTED")))

    def test_one_shot_order_runs_approval_hub_core_then_attestor(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            names=("approval","hub","core")
            units=tuple((name,f"fixture-{name}.service",root/f"{name}.json")
                        for name in names)
            started=[]
            def fake_start(unit,run):
                started.append(unit)
                for _,name,path in units:
                    if name==unit:path.write_text('{"fake":true}')
            with patch.object(mod,"LOCK",root/"lock"), \
                 patch.object(mod,"LINK_ASSEMBLER",root/"builder.py"), \
                 patch.object(mod,"SIGNER_UNITS",units), \
                 patch.object(mod,"ATTESTOR_UNIT","fixture-attestor.service"), \
                 patch.object(mod,"ISSUER_UNIT","fixture-issuer.service"), \
                 patch.object(mod,"preflight") as check, \
                 patch.object(mod,"require_link_and_time") as verified, \
                 patch.object(mod,"start_once",side_effect=fake_start):
                mod.execute(lambda *args,**kwargs: SimpleNamespace(
                    stdout="",returncode=0))
                self.assertEqual(started,
                    ["fixture-approval.service","fixture-hub.service",
                     "fixture-core.service","fixture-attestor.service",
                     "fixture-issuer.service"])
                self.assertEqual(check.call_count,2)
                verified.assert_called_once()

    def test_signer_failure_stops_without_attestor(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            units=(("approval","fixture-approval",root/"approval"),
                   ("hub","fixture-hub",root/"hub"),
                   ("core","fixture-core",root/"core"))
            started=[]
            def fake_start(unit,run):
                started.append(unit)
                if unit=="fixture-hub":
                    raise RuntimeError("SIMULATED_HUB_FAILURE")
                (root/"approval").write_text("fixture")
            with patch.object(mod,"LOCK",root/"lock"), \
                 patch.object(mod,"LINK_ASSEMBLER",root/"assembler"), \
                 patch.object(mod,"SIGNER_UNITS",units), \
                 patch.object(mod,"preflight"), \
                 patch.object(mod,"require_link_and_time"), \
                 patch.object(mod,"start_once",side_effect=fake_start):
                with self.assertRaisesRegex(RuntimeError,"SIMULATED_HUB_FAILURE"):
                    mod.execute(lambda *args,**kwargs: SimpleNamespace(stdout=""))
                self.assertEqual(started,["fixture-approval","fixture-hub"])


if __name__=="__main__":
    unittest.main()
