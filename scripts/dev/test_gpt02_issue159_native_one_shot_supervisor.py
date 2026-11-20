#!/usr/bin/env python3
"""Offline adversarial contract tests for concrete Issue159 native supervisor.

No real PostgreSQL, secrets, signer, SystemD, DELL or network activity.
Tests delegate to ORIGINAL source adapters rather than a new verifier.
"""
from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
import unittest
from pathlib import Path

import gpt02_issue159_native_one_shot_supervisor as native
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from test_gpt02_issue159_postlineage_reader_scope import PostlineageReaderScopeOfflineTest


class Clock:
    def __init__(self): self.now=10.0
    def monotonic(self): return self.now
    def sleep(self,amount): self.now+=amount


class Connection:
    def __init__(self,user,events,*,phases=None,host=native.POOLER_HOST):
        self.info=SimpleNamespace(
            user=user,host=host,port=5432,dbname="postgres",
            get_parameters=lambda: {
                "sslmode":"verify-full",
                "sslrootcert":"/etc/gpt02-dev/supabase-root-ca-2021.crt",
            },
        )
        self.autocommit=False
        self.events=events
        self.phases=phases or {}
        self.commits=0
        self.rollbacks=0
        self.closed=False
        self.description=[]
        self.rows=[]
        self.executed=[]
        self.failure=None
    def __enter__(self): return self
    def __exit__(self,*args):
        self.closed=True
        return False
    def cursor(self):return self
    def execute(self,sql,bind=None):
        self.executed.append(sql)
        self.events.append(sql)
        if self.failure==sql:
            raise RuntimeError("SYNTHETIC_PHASE_FAILED")
        if sql in (native.PHASE_A,native.PHASE_B):
            scripted=self.phases[sql]
            val=scripted.pop(0) if isinstance(scripted,list) else scripted
            self.description=[SimpleNamespace(name="count")]
            self.rows=[(val,)]
        else:
            self.description=[]
            self.rows=[]
    def fetchmany(self,num):
        if num!=2:raise AssertionError("NOT_BOUNDED")
        return self.rows
    def commit(self):
        self.events.append("COMMIT")
        self.commits+=1
    def rollback(self):
        self.events.append("ROLLBACK")
        self.rollbacks+=1


class SupervisorTest(unittest.TestCase):
    def setUp(self):
        fixture=PostlineageReaderScopeOfflineTest()
        fixture.setUp()
        self.candidate=fixture.check()
        self.role=self.candidate["candidateRole"]
        self.events=[]
        self.clock=Clock()
        self.relock=Connection(
            native.RELOCK_NATIVE_ROLE,self.events,
            phases={native.PHASE_A:[1],native.PHASE_B:[1]},
        )
        self.consumer=Connection(native.POOLER_USER_SUFFIX.join(
            ["dev_gpt02_reader_claim_consumer",""]
        )[:-len(native.POOLER_USER_SUFFIX)] + native.POOLER_USER_SUFFIX,
            self.events)
        self.reader=Connection(self.role+native.POOLER_USER_SUFFIX,self.events)
        self.auditor=Connection(native.AUDITOR_DB_USER,self.events)
        self.guard=Connection("dev_gpt02_reader_admission_guard"+
                              native.POOLER_USER_SUFFIX,self.events)
        self.factories=native.TrustedConnectionFactories(
            consumer=lambda:self.consumer,
            guard=lambda:self.guard,
            scoped_reader=lambda:self.reader,
            auditor=lambda:self.auditor,
            relock=lambda:self.relock,
        )
        self.ca=patch("gpt02_issue159_pinned_tls_ca._public_ca_fingerprint_matches",
                      return_value=True)
        self.ca.start()
        self.addCleanup(self.ca.stop)
        self.supervisor=native.OneTaskNativeSupervisor(
            self.candidate,self.factories,
            monotonic=self.clock.monotonic,sleep=self.clock.sleep,
        )
    def claim(self):
        receipt={"role":self.role,"scopeSha256":self.candidate["scopeSha256"]}
        p=patch.object(native,"consume_once_via_pinned_connection",
                       return_value=receipt)
        with p as called:
            actual=self.supervisor.consume_scope_once(self.candidate,"a"*64)
        called.assert_called_once_with(self.consumer,self.candidate,"a"*64)
        return actual

    def test_consumption_delegates_atomic_original_and_denies_replay(self):
        receipt=self.claim()
        self.assertEqual(receipt["role"],self.role)
        self.assertTrue(self.supervisor._consumed)
        with self.assertRaisesRegex(BrokerAdmissionError,"CONSUMPTION_REPLAY_DENIED"):
            self.supervisor.consume_scope_once(self.candidate,"b"*64)

    def test_uncertain_commit_never_retries_issuance_but_allows_cleanup(self):
        with patch.object(native,"consume_once_via_pinned_connection",
                          side_effect=RuntimeError("COMMIT_ACK_UNCERTAIN")) as call:
            with self.assertRaisesRegex(RuntimeError,"COMMIT_ACK_UNCERTAIN"):
                self.supervisor.consume_scope_once(self.candidate,"a"*64)
            with self.assertRaisesRegex(BrokerAdmissionError,"CONSUMPTION_REPLAY_DENIED"):
                self.supervisor.consume_scope_once(self.candidate,"a"*64)
            call.assert_called_once()
        self.assertEqual(self.supervisor.relock_and_verify(self.candidate)["role"],self.role)

    def test_guard_must_follow_atomic_claim_and_independent_audit(self):
        with self.assertRaisesRegex(BrokerAdmissionError,"GUARD_BEFORE_AUDIT"):
            with self.supervisor.open_canonical_guard_connection(self.candidate):pass
        self.claim()
        with self.assertRaisesRegex(BrokerAdmissionError,"GUARD_BEFORE_AUDIT"):
            with self.supervisor.open_canonical_guard_connection(self.candidate):pass
        with self.supervisor.open_minimal_auditor_connection(self.candidate) as aud:
            self.assertIs(aud,self.auditor)
        with self.supervisor.open_canonical_guard_connection(self.candidate) as guard:
            self.assertIs(guard,self.guard)
            with self.supervisor.open_one_scoped_connection(self.candidate) as reader:
                self.assertIs(reader,self.reader)
            with self.assertRaisesRegex(BrokerAdmissionError,"READER_REPLAY"):
                with self.supervisor.open_one_scoped_connection(self.candidate):pass
        with self.assertRaisesRegex(BrokerAdmissionError,"GUARD_REPLAY"):
            with self.supervisor.open_canonical_guard_connection(self.candidate):pass

    def test_unknown_task_role_cannot_cross_scope(self):
        forged=dict(self.candidate)
        forged["candidateRole"]=self.role+"_wrong"
        with self.assertRaises(BrokerAdmissionError):
            self.supervisor.consume_scope_once(forged,"a"*64)
        self.assertFalse(self.supervisor._consumption_attempted)

    def test_guard_or_reader_with_wrong_tls_or_identity_denied(self):
        self.claim()
        with self.supervisor.open_minimal_auditor_connection(self.candidate): pass
        self.reader.info.user="gpt02_issuer_evidence_reader"+native.POOLER_USER_SUFFIX
        with self.supervisor.open_canonical_guard_connection(self.candidate):
            with self.assertRaisesRegex(BrokerAdmissionError,
                "NATIVE_SCOPED_SUPERVISOR_SESSION_IDENTITY_INVALID"):
                with self.supervisor.open_one_scoped_connection(self.candidate):pass

    def test_auditor_wrong_identity_denied(self):
        self.claim()
        self.auditor.info.user="postgres"
        with self.assertRaisesRegex(BrokerAdmissionError,
            "NATIVE_SCOPED_SUPERVISOR_SESSION_IDENTITY_INVALID"):
            with self.supervisor.open_minimal_auditor_connection(self.candidate):pass

    def test_two_relock_phases_must_commit_separately_then_original_auditor_checks(self):
        values=self.supervisor.relock_and_verify(self.candidate)
        self.assertEqual(values["role"],self.role)
        self.assertEqual(values["scopeSha256"],self.candidate["scopeSha256"])
        self.assertEqual(self.relock.commits,2)
        self.assertEqual(
            self.events,
            ["SET TRANSACTION READ WRITE","SET LOCAL statement_timeout = '9000ms'",
             native.PHASE_A,"COMMIT",
             "SET TRANSACTION READ WRITE","SET LOCAL statement_timeout = '9000ms'",
             native.PHASE_B,"COMMIT"],
        )
        for key in ("noLogin","passwordNull","connectionLimitZero",
                    "zeroActiveSessions","grantsRevoked"):
            self.assertIs(values[key],True)
        with self.assertRaisesRegex(BrokerAdmissionError,"RELOCK_REPLAY_DENIED"):
            self.supervisor.relock_and_verify(self.candidate)

    def test_deadline_no_cleanup_proof_is_never_a_success(self):
        self.relock.phases[native.PHASE_A]=0
        self.relock.phases[native.PHASE_B]=0
        # Fast-forward a synthetic monotonic clock (NO actual time.sleep).
        self.supervisor._sleep=lambda _:setattr(self.clock,"now",self.clock.now+21)
        with self.assertRaisesRegex(BrokerAdmissionError,"RELOCK_DEADLINE_EXCEEDED"):
            self.supervisor.relock_and_verify(self.candidate)
        self.assertTrue(self.relock.commits>=2)

    def test_phase_a_failure_cannot_attempt_phase_b(self):
        self.relock.failure=native.PHASE_A
        with self.assertRaisesRegex(RuntimeError,"SYNTHETIC_PHASE_FAILED"):
            self.supervisor.relock_and_verify(self.candidate)
        self.assertEqual(self.relock.commits,0)
        self.assertEqual(self.relock.rollbacks,1)
        self.assertNotIn(native.PHASE_B,self.events)

    def test_phase_b_failure_keeps_committed_nologin_then_denies(self):
        self.relock.failure=native.PHASE_B
        with self.assertRaisesRegex(RuntimeError,"SYNTHETIC_PHASE_FAILED"):
            self.supervisor.relock_and_verify(self.candidate)
        self.assertEqual(self.relock.commits,1)
        self.assertEqual(self.relock.rollbacks,1)

    def test_missing_or_wrong_factory_denied_without_native_call(self):
        with self.assertRaisesRegex(BrokerAdmissionError,"TRUSTED_FACTORIES_REQUIRED"):
            native.OneTaskNativeSupervisor(self.candidate,{})
        invalid=native.TrustedConnectionFactories(
            consumer=None,guard=lambda:None,scoped_reader=lambda:None,
            auditor=lambda:None,relock=lambda:None,
        )
        with self.assertRaisesRegex(BrokerAdmissionError,"FACTORY_UNAVAILABLE"):
            native.OneTaskNativeSupervisor(self.candidate,invalid)

    def test_source_is_not_any_new_signer_dispatch_role_or_db_credential(self):
        source=(Path(__file__).resolve().parents[2]/
            "deploy/ai-coding-standalone-dev/gpt02_issue159_native_one_shot_supervisor.py"
        ).read_text()
        for token in ("CREATE ROLE ","ALTER ROLE ","PASSWORD ","LoadCredential=",
                      "service_role","SUPABASE_DATABASE_URL","dispatch_worker(",
                      "subprocess.run(","psycopg.connect("):
            self.assertNotIn(token,source)
        self.assertIn("NATIVE_ONE_TASK_SUPERVISOR_UNINSTALLED",source)

if __name__=="__main__":
    unittest.main()
