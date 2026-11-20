#!/usr/bin/env python3
"""Inert systemd encrypted one-task credential factory boundary tests.

All bytes are synthetic and stored only in a temporary test directory.
No psycopg package or PostgreSQL network login required for these tests.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import gpt02_issue159_systemd_native_factories as custody
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from test_gpt02_issue159_postlineage_reader_scope import PostlineageReaderScopeOfflineTest


class FakeConnection:
    def __init__(self,params):
        self.info=SimpleNamespace(
            user=params["user"],host=params["host"],
            port=params["port"],dbname=params["dbname"],
            get_parameters=lambda:{
                "sslmode":params["sslmode"],
                "sslrootcert":params["sslrootcert"],
            },
        )
        self.autocommit=params["autocommit"]
        self.closed=False
    def close(self):self.closed=True


class FakeDriver:
    def __init__(self):
        self.requests=[]
        self.last_connection=None
        self.swap_user=None
    def connect(self,**kwargs):
        self.requests.append(kwargs)
        k=dict(kwargs)
        if self.swap_user:
            k["user"]=self.swap_user
        self.last_connection=FakeConnection(k)
        return self.last_connection


class SystemdOneTaskCustodyTest(unittest.TestCase):
    def setUp(self):
        fixture=PostlineageReaderScopeOfflineTest()
        fixture.setUp()
        self.candidate=fixture.check()
        self.role=self.candidate["candidateRole"]
        self.temp=tempfile.TemporaryDirectory(prefix="gpt02-systemd-custody-fixture-")
        self.addCleanup(self.temp.cleanup)
        base=Path(self.temp.name)
        self.directory=base/"gpt02-issue159-one-shot-183-qa.service"
        self.directory.mkdir(mode=0o700)
        self.env=patch.dict(os.environ,{
            "CREDENTIALS_DIRECTORY":str(self.directory),
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.base=patch.object(custody,"SYSTEMD_BASE",str(base))
        self.base.start()
        self.addCleanup(self.base.stop)
        self.ca=patch("gpt02_issue159_pinned_tls_ca._public_ca_fingerprint_matches",
                       return_value=True)
        self.ca.start()
        self.addCleanup(self.ca.stop)
        self.driver=FakeDriver()
        self.module=patch.object(custody.importlib,"import_module",
                         return_value=self.driver)
        self.module.start()
        self.addCleanup(self.module.stop)
        self.expected={
            "consumer":("dev_gpt02_reader_claim_consumer"+
                         custody.POOLER_USER_SUFFIX,custody.POOLER_HOST),
            "guard":("dev_gpt02_reader_admission_guard"+
                      custody.POOLER_USER_SUFFIX,custody.POOLER_HOST),
            "scoped_reader":(self.role+custody.POOLER_USER_SUFFIX,
                             custody.POOLER_HOST),
            "auditor":(custody.AUDITOR_DB_USER,custody.POOLER_HOST),
            "relock":(custody.RELOCK_NATIVE_ROLE,custody.RELOCK_DIRECT_HOST),
        }
        for role,(user,host) in self.expected.items():
            self.write(role,{
                "database":"postgres","host":host,"password":"F"*65,
                "port":5432,"projectRef":"xssrfshdrtdfupgqwfdw",
                "sslMode":"verify-full","user":user,
            })

    def write(self,name,body,mode=0o600):
        file=self.directory/custody.FILES[name]
        file.write_text(json.dumps(body),encoding="utf-8")
        file.chmod(mode)
        return file

    def test_all_five_exact_roles_bound_without_connecting_during_bootstrap(self):
        factory=custody.factories_from_systemd(self.candidate)
        self.assertEqual(self.driver.requests,[])
        for name,(expected_user,expected_host) in self.expected.items():
            opener=getattr(factory,name)
            conn=opener()
            self.assertEqual(conn.info.user,expected_user)
            self.assertEqual(conn.info.host,expected_host)
            self.assertFalse(conn.autocommit)
            sent=self.driver.requests[-1]
            self.assertEqual(sent["sslmode"],"verify-full")
            self.assertEqual(sent["sslrootcert"],custody.PINNED_CA_PATH)
            self.assertEqual(sent["application_name"],
                             "gpt02-issue159-one-task-native-dev")
        self.assertEqual(len(self.driver.requests),5)

    def test_unexpected_credential_role_host_or_tls_never_opens_connection(self):
        for name,mutate in (
            ("consumer",{"user":"postgres"}),
            ("scoped_reader",{"host":"another.supabase.co"}),
            ("guard",{"sslMode":"require"}),
            ("auditor",{"projectRef":"prod"}),
            ("relock",{"port":6543}),
            ("consumer",{"password":"short"}),
        ):
            with self.subTest(name=name,mutate=mutate):
                self.driver.requests.clear()
                obj=json.loads((self.directory/custody.FILES[name]).read_text())
                changed={**obj,**mutate}
                self.write(name,changed)
                factory=custody.factories_from_systemd(self.candidate)
                with self.assertRaisesRegex(BrokerAdmissionError,
                    "NATIVE_SCOPE_INVALID"):
                    getattr(factory,name)()
                self.assertEqual(self.driver.requests,[])
                self.write(name,obj)

    def test_extra_fields_and_group_readable_file_fail_before_driver(self):
        f=self.directory/custody.FILES["consumer"]
        original=json.loads(f.read_text())
        self.write("consumer",{**original,"token":"not_allowed"})
        with self.assertRaisesRegex(BrokerAdmissionError,"FIELDS_INVALID"):
            custody.factories_from_systemd(self.candidate).consumer()
        self.write("consumer",original,mode=0o644)
        with self.assertRaisesRegex(BrokerAdmissionError,"FILE_UNTRUSTED"):
            custody.factories_from_systemd(self.candidate).consumer()
        self.assertEqual(self.driver.requests,[])

    def test_symlink_secret_and_missing_file_fail_closed(self):
        p=self.directory/custody.FILES["guard"]
        p.unlink()
        target=Path(self.temp.name)/"synthetic_external.json"
        target.write_text('{"password":"not_safe"}')
        target.chmod(0o600)
        p.symlink_to(target)
        with self.assertRaises(BrokerAdmissionError):
            custody.factories_from_systemd(self.candidate).guard()
        p.unlink()
        with self.assertRaisesRegex(BrokerAdmissionError,"UNAVAILABLE"):
            custody.factories_from_systemd(self.candidate).guard()
        self.assertEqual(self.driver.requests,[])

    def test_systemd_directory_cannot_be_replaced_by_arbitrary_temp_path(self):
        os.environ["CREDENTIALS_DIRECTORY"]=str(Path(self.temp.name)/"untrusted")
        with self.assertRaisesRegex(BrokerAdmissionError,"SCOPE_REQUIRED"):
            custody.factories_from_systemd(self.candidate)
        os.environ["CREDENTIALS_DIRECTORY"]=str(self.directory)
        self.directory.chmod(0o777)
        with self.assertRaisesRegex(BrokerAdmissionError,"DIRECTORY_UNTRUSTED"):
            custody.factories_from_systemd(self.candidate)

    def test_other_task_cannot_reuse_this_exact_reader_credential(self):
        swapped=dict(self.candidate)
        swapped["candidateRole"]=self.role+"_other"
        with self.assertRaises(BrokerAdmissionError):
            custody.factories_from_systemd(swapped)
        self.assertEqual(self.driver.requests,[])

    def test_wrong_libpq_negotiated_role_closes_connection(self):
        self.driver.swap_user="postgres"
        with self.assertRaisesRegex(BrokerAdmissionError,"SESSION_IDENTITY_INVALID"):
            custody.factories_from_systemd(self.candidate).scoped_reader()
        self.assertTrue(self.driver.last_connection.closed)

    def test_missing_driver_is_a_denial_not_credential_logging(self):
        with patch.object(custody.importlib,"import_module",
                          side_effect=ImportError("synthetic_missing_driver")):
            with self.assertRaisesRegex(BrokerAdmissionError,
                "POSTGRES_CONNECTION_DENIED"):
                custody.factories_from_systemd(self.candidate).consumer()

    def test_signed_packet_file_is_same_locked_systemd_unit_not_caller_path(self):
        packet={k:{"claims":{"fixture_only":True},"signature":"fixture_not_valid"}
                for k in ("approval","hubLink","coreLink","issuerEvidence")}
        path=self.directory/custody.SIGNED_PACKET_FILE
        path.write_text(json.dumps(packet))
        path.chmod(0o600)
        self.assertEqual(custody.signed_packet_from_systemd(),packet)
        path.chmod(0o644)
        with self.assertRaisesRegex(BrokerAdmissionError,"FILE_UNTRUSTED"):
            custody.signed_packet_from_systemd()
        path.unlink()
        path.symlink_to(Path(self.temp.name)/"untrusted-packet.json")
        with self.assertRaises(BrokerAdmissionError):
            custody.signed_packet_from_systemd()

    def test_deferred_bridge_never_opens_credentials_before_original_claim(self):
        lazy=custody.SystemdDeferredOneTaskSupervisor()
        with self.assertRaisesRegex(BrokerAdmissionError,"NOT_AUTHENTICATED"):
            lazy.open_one_scoped_connection(self.candidate)
        with patch.object(custody,"factories_from_systemd",
                          return_value=self.expected) as factory, patch(
                          "gpt02_issue159_native_one_shot_supervisor.OneTaskNativeSupervisor"
                        ) as NativeConstructor:
            NativeConstructor.return_value.consume_scope_once.return_value={
                "releaseDecision":"NO_GO"
            }
            self.assertEqual(self.driver.requests,[])
            assert lazy.consume_scope_once(self.candidate,"a"*64)=={
                "releaseDecision":"NO_GO"
            }
            factory.assert_called_once_with(self.candidate)
            NativeConstructor.assert_called_once_with(self.candidate,self.expected)
            NativeConstructor.return_value.consume_scope_once.assert_called_once_with(
                self.candidate,"a"*64
            )
            with self.assertRaisesRegex(BrokerAdmissionError,"CLAIM_REPLAY"):
                lazy.consume_scope_once(self.candidate,"b"*64)

    def test_deferred_bridge_failed_first_claim_cannot_reenter(self):
        lazy=custody.SystemdDeferredOneTaskSupervisor()
        with patch.object(custody,"factories_from_systemd",
                          side_effect=RuntimeError("UNAVAILABLE")) as opened:
            with self.assertRaisesRegex(RuntimeError,"UNAVAILABLE"):
                lazy.consume_scope_once(self.candidate,"a"*64)
            with self.assertRaisesRegex(BrokerAdmissionError,"CLAIM_REPLAY"):
                lazy.consume_scope_once(self.candidate,"a"*64)
            opened.assert_called_once()
        with self.assertRaisesRegex(BrokerAdmissionError,"NOT_AUTHENTICATED"):
            lazy.relock_and_verify(self.candidate)

    def test_template_systemd_is_disabled_with_separate_exact_encrypted_credential_files(self):
        unit=(Path(__file__).resolve().parents[2]/
          "deploy/ai-coding-standalone-dev/gpt02-issue159-one-shot-native@.service"
        ).read_text()
        self.assertIn("Type=oneshot",unit)
        self.assertIn("DynamicUser=yes",unit)
        self.assertIn("MemoryMax=128M",unit)
        self.assertIn("TimeoutStartSec=70s",unit)
        self.assertNotRegex(unit,r"(?m)^\\[Install\\]$")
        self.assertNotIn("ExecStartPre=",unit)
        self.assertNotIn("EnvironmentFile=",unit)
        self.assertNotIn("Restart=on-failure",unit)
        self.assertIn(
            "ConditionPathExists=/etc/gpt02-dev/issue159-one-shot-%i-enabled.approved",unit
        )
        self.assertIn("LoadCredentialEncrypted=relock-catalog-dsn:",unit)
        self.assertIn("LoadCredentialEncrypted=approved-lifecycle-packet.json:",unit)
        for filename in custody.FILES.values():
            self.assertIn("LoadCredentialEncrypted="+filename+":",unit)

    def test_source_has_no_credential_issuance_or_authentication_shortcut(self):
        source=(Path(__file__).resolve().parents[2]/
                "deploy/ai-coding-standalone-dev/gpt02_issue159_systemd_native_factories.py"
               ).read_text()
        for token in (
            "CREATE ROLE ","ALTER ROLE ","PASSWORD NULL","subprocess.",
            "GenUI","dispatchWorker","SINGLE_OWNER_OVERRIDE",
            "psycopg.connect(","DECRYPT_CREDENTIAL=",
        ):
            self.assertNotIn(token,source)
        self.assertIn('raise SystemExit("NO_CLI_ONE_SHOT_SYSTEMD_CUSTODY_NOT_PROVISIONED")',source)

if __name__=="__main__":
    unittest.main()
