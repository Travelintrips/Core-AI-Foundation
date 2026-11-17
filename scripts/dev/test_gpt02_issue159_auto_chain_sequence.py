#!/usr/bin/env python3
"""Isolated orchestration regression for existing GPT02 DEV auto-chain.

No hosted DB, external reader, signing key, systemd, approval consumption,
lease issuance or worker dispatch. Uses only synthetic fixture outputs.
"""
from __future__ import annotations

import json
import subprocess as real_subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import gpt02_issue159_auto_chain as chain
SOURCE_UNIT = chain._unit


class AutoChainSequenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gpt02-chain-sequence-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.approved = self.root / "gpt02_issue159_approved_claims.json"
        self.link = self.root / "gpt02_issue159_hub_core_link_claims.json"
        self.signed = {}
        self.sequence = []
        self.claims = {
            "taskId": 201,
            "companyId": "default",
            "commandId": "11111111-1111-4111-8111-111111111111",
            "attemptId": "22222222-2222-4222-8222-222222222222",
            "expiresAt": int(time.time() * 1000) + 240000,
        }
        self.approved.write_text(json.dumps({"claims": self.claims}))
        self.actual_paths = {
            "/run/gpt02-issue159-sign-once-approval/approval-signature.json":
                self.root / "approval-signature.json",
            "/run/gpt02-issue159-sign-once-hub/hub-signature.json":
                self.root / "hub-signature.json",
            "/run/gpt02-issue159-sign-once-core/core-signature.json":
                self.root / "core-signature.json",
        }
        def stub_path(path):
            return self.actual_paths.get(str(path), Path(path))
        def fake_unit(name):
            self.sequence.append(name)
            if name == "gpt02-issue159-sign-once-approval.service":
                self.actual_paths[
                    "/run/gpt02-issue159-sign-once-approval/approval-signature.json"
                ].write_bytes(b"fixture-approval-sig")
            elif name == "gpt02-issue159-sign-once-operator@hub.service":
                self.actual_paths[
                    "/run/gpt02-issue159-sign-once-hub/hub-signature.json"
                ].write_bytes(b"fixture-hub-sig")
            elif name == "gpt02-issue159-sign-once-operator@core.service":
                self.actual_paths[
                    "/run/gpt02-issue159-sign-once-core/core-signature.json"
                ].write_bytes(b"fixture-core-sig")
        self.fake_unit = fake_unit
        self.patches = [
            patch.object(chain, "APP", self.root),
            patch.object(chain, "APPROVED", self.approved),
            patch.object(chain, "LINK", self.link),
            patch.object(chain, "Path", side_effect=stub_path),
            patch.object(chain, "_reset_failed", return_value=None),
            patch.object(chain, "subprocess"),
            patch.object(chain, "_unit", side_effect=self.fake_unit),
            patch.object(chain, "_socket_fact_reader", return_value={"kind": "fixture"}),
            patch.object(chain, "assemble_verified_operator_link",
                         return_value={"environment": "DEV", "hubTaskId": 201,
                                       "dispatchPermitted": False,
                                       "releaseDecision": "NO_GO"}),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    @staticmethod
    def _systemd_show(condition="yes", *, result="success", exit_status="0",
                      active="inactive", load="loaded"):
        return (
            f"LoadState={load}\\n"
            f"ConditionResult={condition}\\n"
            f"Result={result}\\n"
            f"ExecMainStatus={exit_status}\\n"
            f"ActiveState={active}\\n"
        ).replace("\\n", "\n")

    def _run_unit_with(self, start_rc=0, show_output=None, show_rc=0,
                       start_exception=None):
        first=real_subprocess.CompletedProcess([],0,stdout="")
        second=(
            start_exception if start_exception is not None else
            real_subprocess.CompletedProcess([],start_rc,stdout="")
        )
        last=real_subprocess.CompletedProcess(
            [],show_rc,stdout=self._systemd_show() if show_output is None
            else show_output,
        )
        with patch.object(chain, "subprocess", real_subprocess):
            with patch.object(real_subprocess, "run",
                              side_effect=[first,second,last]) as runner:
                SOURCE_UNIT("gpt02-issue159-attestor-record-once.service")
        return runner.call_count

    def test_successful_oneshot_requires_condition_result_yes(self):
        self.assertEqual(self._run_unit_with(), 3)

    def test_systemd_skipped_unit_cannot_fake_success_from_stale_exit_zero(self):
        with self.assertRaisesRegex(chain.AutoChainError,
                                    "UNIT_CONDITION_NOT_MET"):
            self._run_unit_with(show_output=self._systemd_show(condition="no"))
        self.assertFalse(self.sequence)

    def test_oneshot_unavailable_or_malformed_show_is_denied(self):
        for output in (
            self._systemd_show().replace("ConditionResult=yes" + chr(10), ""),
            "success\\n0\\n",
            self._systemd_show(load="not-found"),
            self._systemd_show(active="active"),
            self._systemd_show(exit_status="1"),
        ):
            with self.subTest(value=output[:25]):
                with self.assertRaisesRegex(chain.AutoChainError,
                                            "UNIT_RESULT_INVALID"):
                    self._run_unit_with(show_output=output)
        with self.assertRaisesRegex(chain.AutoChainError,
                                    "UNIT_RESULT_UNAVAILABLE"):
            self._run_unit_with(show_rc=1)

    def test_systemd_start_failure_is_not_marked_completed(self):
        with self.assertRaisesRegex(chain.AutoChainError,"UNIT_FAILED"):
            self._run_unit_with(start_rc=1)

    def test_systemd_timeout_is_denied_without_signing(self):
        with self.assertRaisesRegex(chain.AutoChainError,
                                    "UNIT_SYSTEMD_UNAVAILABLE"):
            self._run_unit_with(start_exception=real_subprocess.TimeoutExpired(
                cmd="systemctl start",timeout=25,
            ))

    def test_successful_synthetic_order_reports_no_dispatch(self):
        result = chain.run_after_approval(201)
        self.assertEqual(self.sequence, [
            "gpt02-issue159-sign-once-approval.service",
            "gpt02-issue159-sign-once-operator@hub.service",
            "gpt02-issue159-sign-once-operator@core.service",
            "gpt02-issue159-attestor-record-once.service",
            "gpt02-issue159-issuer-finalize-once.service",
        ])
        self.assertTrue(result["autoChainCompleted"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(result["releaseDecision"], "NO_GO")
        self.assertEqual(json.loads(self.link.read_text())["hubTaskId"], 201)

    def test_link_occupied_prevents_later_signer_attestor_and_issuer(self):
        prior = b"retained-old-task-link"
        self.link.write_bytes(prior)
        with self.assertRaisesRegex(chain.AutoChainError, "LINK_OUTPUT_OCCUPIED"):
            chain.run_after_approval(201)
        self.assertEqual(self.sequence, [
            "gpt02-issue159-sign-once-approval.service",
        ])
        self.assertEqual(self.link.read_bytes(), prior)

    def test_attestor_failure_never_starts_issuer(self):
        def fail_attestor(name):
            self.fake_unit(name)
            if name == "gpt02-issue159-attestor-record-once.service":
                raise chain.AutoChainError("UNIT_FAILED_ATTESTOR")
        with patch.object(chain, "_unit", side_effect=fail_attestor):
            with self.assertRaisesRegex(chain.AutoChainError, "UNIT_FAILED_ATTESTOR"):
                chain.run_after_approval(201)
        self.assertEqual(self.sequence[-1],
                         "gpt02-issue159-attestor-record-once.service")
        self.assertNotIn("gpt02-issue159-issuer-finalize-once.service",
                         self.sequence)

    def test_issuer_failure_is_not_reported_as_completed(self):
        def fail_issuer(name):
            self.fake_unit(name)
            if name == "gpt02-issue159-issuer-finalize-once.service":
                raise chain.AutoChainError("UNIT_FAILED_ISSUER")
        with patch.object(chain, "_unit", side_effect=fail_issuer):
            with self.assertRaisesRegex(chain.AutoChainError, "UNIT_FAILED_ISSUER"):
                chain.run_after_approval(201)
        self.assertEqual(self.sequence[-1],
                         "gpt02-issue159-issuer-finalize-once.service")

    def test_expired_approval_cannot_start_any_unit(self):
        self.claims["expiresAt"] = int(time.time() * 1000) + 10_000
        self.approved.write_text(json.dumps({"claims": self.claims}))
        with self.assertRaisesRegex(chain.AutoChainError, "APPROVAL_NOT_FRESH"):
            chain.run_after_approval(201)
        self.assertFalse(self.sequence)

    def test_wrong_task_binding_cannot_start_any_unit(self):
        with self.assertRaisesRegex(chain.AutoChainError, "APPROVED_TASK_BINDING_MISMATCH"):
            chain.run_after_approval(202)
        self.assertFalse(self.sequence)


if __name__ == "__main__":
    unittest.main()
