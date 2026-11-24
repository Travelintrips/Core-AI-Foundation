#!/usr/bin/env python3
"""Fail-closed original Issue159 one-shot entrypoint regression: no real IO."""
from __future__ import annotations
from contextlib import redirect_stdout
from io import StringIO
import json
import os
import sys
import unittest
from unittest.mock import patch

import gpt02_issue159_one_shot_native_runtime as runtime


class SignedOneShotRuntimeTest(unittest.TestCase):
    def call(self, *, mode="development", packet=None, proof=None, failure=None):
        sealed={"approval":"PRIVATE_FIXTURE_NO_EXPORT"}
        if packet is not None:
            sealed=packet
        if proof is None:
            proof={
                "releaseDecision":"NO_GO",
                "oneCanonicalReadReviewed":True,
                "postReadRelockVerifiedByNativePostgres":True,
                "preReadConsumptionVerifiedByPostgres":True,
                "authorizationGranted":False,
                "dispatchPermitted":False,
            }
        output=StringIO()
        with (
          patch.dict(os.environ,{"APP_ENV":mode}),
          patch.object(sys,"argv",["gpt02_issue159_one_shot_native_runtime.py"]),
          patch.object(runtime,"signed_packet_from_systemd",
                       return_value=sealed) as packet_reader,
          patch.object(runtime,"SystemdDeferredOneTaskSupervisor") as factory,
          patch.object(runtime,"review_one_shot_reader_readback",
                       return_value=proof,side_effect=failure) as broker,
          redirect_stdout(output),
        ):
            code=runtime.main()
        return code,json.loads(output.getvalue()),packet_reader,factory,broker,output.getvalue()

    def test_original_signed_broker_one_call_and_no_auth_from_positive_review(self):
        code,result,packet_reader,factory,broker,raw=self.call()
        self.assertEqual(code,0)
        self.assertTrue(result["oneCanonicalReadReviewed"])
        self.assertTrue(result["nativeRelockAttested"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertFalse(result["signingPermitted"])
        self.assertEqual(result["releaseDecision"],"NO_GO")
        packet_reader.assert_called_once()
        factory.assert_called_once()
        broker.assert_called_once()
        self.assertNotIn("PRIVATE_FIXTURE_NO_EXPORT",raw)

    def test_bad_postread_relock_never_reports_success(self):
        proof={
            "releaseDecision":"NO_GO",
            "oneCanonicalReadReviewed":True,
            "postReadRelockVerifiedByNativePostgres":False,
            "preReadConsumptionVerifiedByPostgres":True,
            "authorizationGranted":False,
            "dispatchPermitted":False,
        }
        code,result,_,_,_,_=self.call(proof=proof)
        self.assertEqual(code,3)
        self.assertFalse(result["nativeRelockAttested"])
        self.assertFalse(result["oneCanonicalReadReviewed"])
        self.assertEqual(result["reason"],"ONE_SHOT_NATIVE_PROOF_INCOMPLETE")

    def test_raw_database_error_and_password_are_never_printed(self):
        code,result,_,_,_,raw=self.call(
            failure=RuntimeError("password=SYNTHETIC_SHOULD_NEVER_LEAK"))
        self.assertEqual(code,3)
        self.assertEqual(result["releaseDecision"],"NO_GO")
        self.assertNotIn("SYNTHETIC_SHOULD_NEVER_LEAK",raw)
        self.assertEqual(result["reason"],
                         "ONE_SHOT_NATIVE_READ_OR_RELOCK_UNAVAILABLE")

    def test_no_explicit_dev_mode_never_reads_signed_packet(self):
        code,result,packet_reader,factory,broker,_=self.call(mode="production")
        self.assertEqual(code,3)
        self.assertEqual(result["reason"],"DEV_SYSTEMD_ONLY_REQUIRED")
        packet_reader.assert_not_called()
        factory.assert_not_called()
        broker.assert_not_called()

    def test_no_operator_supplied_cli_overrides_even_in_dev(self):
        output=StringIO()
        with (
          patch.dict(os.environ,{"APP_ENV":"development"}),
          patch.object(sys,"argv",["script.py","--dsn","malicious"]),
          patch.object(runtime,"signed_packet_from_systemd") as packet_reader,
          redirect_stdout(output),
        ):
            result=runtime.main()
        self.assertEqual(result,3)
        packet_reader.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["releaseDecision"],"NO_GO")

    def test_error_code_only_not_any_caller_supplied_sql_or_path(self):
        code,result,_,_,_,raw=self.call(
            failure=RuntimeError("ONE_SHOT_DB_ACCESS_REVOKED"))
        self.assertEqual(code,3)
        self.assertEqual(result["reason"],"ONE_SHOT_DB_ACCESS_REVOKED")
        self.assertEqual(result["dispatchPermitted"],False)
        self.assertNotIn("credential",raw)

if __name__=="__main__":
    unittest.main()
