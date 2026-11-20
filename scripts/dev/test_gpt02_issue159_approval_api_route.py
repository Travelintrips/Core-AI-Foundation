#!/usr/bin/env python3
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import time
import threading
from concurrent.futures import ThreadPoolExecutor
import types
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/ai-coding-standalone-dev"
API_PATH = DEPLOY / "approval_api.py"
SCHEMA_PATH = DEPLOY / "gpt02_issue159_approval_intent_schema.sql"
sys.path.insert(0, str(DEPLOY))

fake_identity = types.ModuleType("admin_identity")
fake_identity.admin_identity = lambda token, connection: None
sys.modules["admin_identity"] = fake_identity

spec = importlib.util.spec_from_file_location("approval_api_issue159_test", API_PATH)
api = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(api)
# Capture the real source guard before per-test HTTP fixtures replace the
# service-calling dependency with inert fail-closed test callbacks.
SOURCE_CHAIN_GATE = api.issue159_chain_readiness_gate
SOURCE_APPROVED_SLOT_CLEAR = api.issue159_approved_packet_slot_clear
SOURCE_PRECOMMIT_PRESIGN = api.issue159_precommit_presign_matches

BASE_NOW_MS = int(time.time() * 1000)

CLAIMS = {
    "v": 2,
    "environment": "DEV",
    "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
    "taskId": 140,
    "commandId": "11111111-1111-4111-8111-111111111111",
    "attemptId": "22222222-2222-4222-8222-222222222222",
    "nonce": "A" * 44,
    "operatorNamespace": "ai-task-hub.public.users",
    "superAdminId": "google_fixture_super_admin",
    "companyId": "default",
    "issuedAt": BASE_NOW_MS - 1000,
    "expiresAt": BASE_NOW_MS + 120000,
}
AUTH_USER_ID = "auth_fixture_super_admin"
AAL2_TOKEN = "a" * 64
STATIC_TOKEN = "s" * 64

class ApprovalApiIssue159RouteTest(unittest.TestCase):
    def setUp(self):
        fd, self.db = tempfile.mkstemp(prefix="issue159-route-", suffix=".db")
        os.close(fd)
        con = sqlite3.connect(self.db)
        con.execute("""CREATE TABLE admin_identities (
          user_id TEXT PRIMARY KEY, role TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0
        )""")
        con.executescript(SCHEMA_PATH.read_text())
        con.execute("INSERT INTO admin_identities VALUES (?,?,?)",
                    (AUTH_USER_ID,"super_admin",1))
        con.execute("""INSERT INTO gpt02_issue159_admin_operator_links
          (auth_user_id,hub_operator_id,email,enabled) VALUES (?,?,?,1)""",
          (AUTH_USER_ID,CLAIMS["superAdminId"],"fixture@example.com"))
        con.commit()
        con.close()
        os.chmod(self.db, 0o600)
        api.DB = self.db
        self.packet = self.db + ".approved.json"
        self.pending = self.db + ".pending.json"
        api.ISSUE159_APPROVED_PACKET = self.packet
        api.ISSUE159_PENDING_CLAIMS = self.pending
        api.TOKEN = STATIC_TOKEN
        api.ISSUE159_APPROVAL_INTENT_ENABLED = False
        api.admin_identity = lambda token, connection: None
        # Tests exercise the API only. Never run any real systemd signer,
        # attestor or issuer from an HTTP fixture.
        api.issue159_chain_readiness_gate = lambda record: True
        api.issue159_precommit_presign_matches = lambda record: True
        # Tests may mock watchdog health but never start a real supervisor.
        api.issue159_independent_relock_supervisor_ready = lambda: True
        api.run_after_approval = lambda task_id: {
            "environment": "DEV", "taskId": task_id,
            "autoChainCompleted": False,
            "autoChainError": "ISOLATED_TEST_NO_SIGNER",
            "authorizationGranted": False, "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }
        # Every test uses an isolated signature-output namespace, never the
        # running VPS/systemd RuntimeDirectory.
        self.signer_fixture = tempfile.TemporaryDirectory(
            prefix="issue159-signer-output-fixture-"
        )
        api.ISSUE159_SIGNER_OUTPUTS = tuple(
            Path(self.signer_fixture.name) / (role + "-signature.json")
            for role in ("approval", "hub", "core", "issuer")
        )
        api.ISSUE159_OPERATOR_LINK_OUTPUT = (
            Path(self.signer_fixture.name) / "gpt02_issue159_hub_core_link_claims.json"
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), api.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        if os.path.exists(self.db):
            os.unlink(self.db)
        if os.path.exists(self.packet):
            os.unlink(self.packet)
        if os.path.exists(self.pending):
            os.unlink(self.pending)
        self.signer_fixture.cleanup()

    def request(self, token=None, claims=None):
        data = json.dumps({"claims": CLAIMS if claims is None else claims}).encode()
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(
            self.base + "/api/gpt02/issue159/approval-intent",
            data=data, headers=headers, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as res:
                return res.status, json.load(res)
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode())

    def count(self):
        con = sqlite3.connect(self.db)
        value = con.execute(
            "select count(*) from gpt02_issue159_approval_intents"
        ).fetchone()[0]
        con.close()
        return value

    def pending_request(self, token=AAL2_TOKEN):
        req = urllib.request.Request(
            self.base + "/api/gpt02/issue159/approval-intent/pending",
            headers={"Authorization": "Bearer " + token},
            method="GET",
        )
        real_lstat = os.lstat
        def secure_pending_lstat(path):
            result = real_lstat(path)
            if os.fspath(path) == self.pending:
                return SimpleNamespace(
                    st_mode=result.st_mode, st_uid=0, st_gid=0
                )
            return result
        try:
            with patch.object(api.os, "lstat", side_effect=secure_pending_lstat):
                with urllib.request.urlopen(req, timeout=3) as res:
                    return res.status, json.load(res)
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode())

    def test_pending_route_requires_real_active_super_admin_session(self):
        api.admin_identity = lambda token, connection: None
        status, body = self.pending_request()
        self.assertEqual(status, 401)
        self.assertEqual(body, {"error": "unauthorized"})
        req = urllib.request.Request(
            self.base + "/api/gpt02/issue159/approval-intent/pending", method="GET"
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=3)
        self.assertEqual(ctx.exception.code, 401)

    def test_pending_route_returns_only_current_bound_request(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o600)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertTrue(body["pending"])
        self.assertEqual(body["taskId"], CLAIMS["taskId"])
        self.assertEqual(body["claims"], CLAIMS)
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")

    def test_issue159_no_dispatch_lease_cannot_enter_coding_worker_queue(self):
        # Distinct DEV queues must not turn a GPT02 issuer/lease record into
        # a coding job or a worker permission. No real worker, auth account
        # or database is used: this class hosts a disposable local HTTP API.
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        with api.conn() as con:
            con.executescript("""
                CREATE TABLE jobs (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL,
                    payload TEXT NOT NULL, status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    checkpoint TEXT, updated_at TEXT NOT NULL
                );
                CREATE TABLE job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL, status TEXT NOT NULL,
                    detail TEXT, created_at TEXT NOT NULL
                );
            """)
            con.execute("""INSERT INTO approval_permissions
                (principal,repository,environment,action,enabled)
                VALUES (?,?,?,?,1)""", (
                    AUTH_USER_ID, "Travelintrips/Core-AI-Foundation",
                    "DEV", "approve_coding",
                ))
            con.commit()

        def post_job(data):
            request = urllib.request.Request(
                self.base + "/api/jobs", method="POST",
                data=json.dumps(data).encode(),
                headers={
                    "Authorization": "Bearer " + AAL2_TOKEN,
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=3) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as exc:
                return exc.code, json.loads(exc.read().decode())

        forged_lease = {
            "environment": "DEV", "issuerEvidenceVerified": True,
            "leaseConsumed": True, "dispatchAllowed": False,
            "autoChainCompleted": True, "releaseDecision": "NO_GO",
        }
        status, body = post_job({
            "kind": "gpt02_issue159_issuer_dispatch",
            "repository": "Travelintrips/Core-AI-Foundation",
            "ref": "develop", "issuerLease": forged_lease,
        })
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "job_not_allowed")
        with sqlite3.connect(self.db) as con:
            self.assertEqual(
                con.execute("SELECT count(*) FROM jobs").fetchone()[0], 0,
            )

        # An authorized ordinary coding-test request remains usable, but
        # nested GPT02 claims/leases are not copied to the durable queue.
        status, body = post_job({
            "kind": "coding_test",
            "repository": "Travelintrips/Core-AI-Foundation",
            "ref": "develop",
            "filename": "ai-coding-sandbox/solution.py",
            "source": "def add(a, b): return a + b\\n",
            "tests": "def test_add(): assert 2 + 3 == 5\\n",
            "requires_ollama": False,
            "issuerLease": forged_lease,
            "approvalIntent": {"taskId": 171, "approved": True},
            "autoChainCompleted": True,
            "dispatchAllowed": True,
        })
        self.assertEqual(status, 201)
        self.assertEqual(body["status"], "QUEUED")
        self.assertEqual(body["environment"], "DEV")
        with sqlite3.connect(self.db) as con:
            queued = con.execute(
                "SELECT kind,payload,status FROM jobs",
            ).fetchall()
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0][0], "coding_test")
        self.assertEqual(queued[0][2], "QUEUED")
        payload = json.loads(queued[0][1])
        self.assertEqual(set(payload), {
            "repository", "ref", "filename", "source", "tests",
            "requires_ollama", "environment",
        })
        self.assertEqual(payload["environment"], "DEV")
        self.assertIs(payload["requires_ollama"], False)
        self.assertEqual(self.count(), 0)

    def test_direct_worker_queue_fails_closed_on_forged_issuer_lease_kind(self):
        # Second, independent boundary: even direct SQLite queue injection
        # cannot turn GPT02 NO_DISPATCH lease evidence into a worker action.
        # Exercise the ORIGINAL durable_worker.py step() using only an
        # in-memory database and inert modules in place of external runners.
        from types import ModuleType
        worker_path = DEPLOY / "durable_worker.py"
        fake_inspector = ModuleType("repository_inspect")
        fake_runner = ModuleType("coding_runner")
        def external_execution_forbidden(*args, **kwargs):
            raise AssertionError("GPT02_ISSUER_LEASE_MUST_NEVER_EXECUTE")
        fake_inspector.inspect = external_execution_forbidden
        fake_runner.run = external_execution_forbidden

        with patch.dict(sys.modules, {
            "repository_inspect": fake_inspector,
            "coding_runner": fake_runner,
        }):
            spec = importlib.util.spec_from_file_location(
                "gpt02_worker_boundary_fixture", worker_path,
            )
            worker = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(worker)

        with sqlite3.connect(":memory:") as db:
            worker.setup(db)
            forged = {
                "environment": "DEV", "taskId": 171,
                "issuerEvidenceVerified": True,
                "leaseConsumed": True,
                "dispatch_allowed": False,
                "autoChainCompleted": True,
                "releaseDecision": "NO_GO",
                "kind": "coding_test",
                "requires_ollama": True,
            }
            db.execute("""INSERT INTO jobs
                (id,kind,payload,status,updated_at)
                VALUES (?,?,?,?,?)""", (
                    "synthetic-issuer-lease",
                    "gpt02_issue159_issuer_dispatch",
                    json.dumps(forged), "QUEUED", worker.now(),
                ))
            db.commit()
            with patch.object(worker, "inspect",
                              side_effect=external_execution_forbidden) as inspector, \
                 patch.object(worker, "run_coding",
                              side_effect=external_execution_forbidden) as coder:
                self.assertTrue(worker.step(db))
                inspector.assert_not_called()
                coder.assert_not_called()

            result = db.execute("""SELECT status,attempts,checkpoint
                FROM jobs WHERE id='synthetic-issuer-lease'""").fetchone()
            self.assertEqual(result[0], "FAILED")
            self.assertEqual(result[1], 1)
            self.assertEqual(result[2], "unsupported job kind")
            self.assertEqual([
                row[0] for row in db.execute("""SELECT status
                  FROM job_events WHERE job_id='synthetic-issuer-lease'
                  ORDER BY id""")
            ], ["RUNNING", "FAILED"])
            self.assertFalse(worker.step(db))
            self.assertEqual(
                db.execute("SELECT COUNT(*) FROM jobs WHERE status='QUEUED'").fetchone()[0],
                0,
            )
            # A supported inspection still works; GPT02 lease forgery never
            # promotes to worker dispatch or gains an execution branch.
            db.execute("""INSERT INTO jobs
                (id,kind,payload,status,updated_at)
                VALUES (?,?,?,?,?)""", (
                    "synthetic-repo-inspection",
                    "repository_inspection",
                    json.dumps({
                        "repository": "Travelintrips/Core-AI-Foundation",
                        "ref": "develop",
                    }), "QUEUED", worker.now(),
                ))
            db.commit()
            with patch.object(worker, "inspect",
                              return_value={"isolatedReadOnly": True}) as inspector, \
                 patch.object(worker, "run_coding",
                              side_effect=external_execution_forbidden) as coder:
                self.assertTrue(worker.step(db))
                inspector.assert_called_once_with(
                    "Travelintrips/Core-AI-Foundation", "develop",
                )
                coder.assert_not_called()
            self.assertEqual(db.execute("""SELECT status FROM jobs
                WHERE id='synthetic-repo-inspection'""").fetchone()[0], "SUCCESS")
            self.assertEqual(self.count(), 0)

    def test_authenticated_http_denied_by_unset_auto_chain_flag_without_consumption(self):
        # Mirror the real DEV fail-closed gate: approval-intent route is
        # enabled but unattended one-use auto-chain cannot consume an
        # authenticated Super Admin decision before its runtime is ready.
        # All identity/claims and database data in this test are synthetic.
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        api.issue159_chain_readiness_gate = SOURCE_CHAIN_GATE
        with patch.dict(os.environ, {
            "GPT02_ISSUE159_AUTO_CHAIN_PREAPPROVAL_READY": "false",
        }), patch.object(api, "run_after_approval", side_effect=AssertionError(
            "FAIL_CLOSED_MUST_NOT_START_SIGNER",
        )) as signer, patch.object(
            api, "persist_issue159_approved_packet",
            side_effect=AssertionError("FAIL_CLOSED_MUST_NOT_PUBLISH_PACKET"),
        ) as packet:
            status, body = self.request(AAL2_TOKEN)
            self.assertEqual(status, 409)
            self.assertEqual(body["error"], "issue159_auto_chain_not_ready")
            self.assertIs(body["signingPermitted"], False)
            self.assertIs(body["authorizationGranted"], False)
            self.assertIs(body["dispatchPermitted"], False)
            self.assertEqual(body["releaseDecision"], "NO_GO")
            self.assertEqual(self.count(), 0)
            self.assertFalse(signer.called)
            self.assertFalse(packet.called)
            self.assertFalse(Path(self.packet).exists())

    def test_missing_independent_relock_watchdog_never_consumes_one_use_approval(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        api.issue159_chain_readiness_gate = SOURCE_CHAIN_GATE
        with patch.dict(os.environ, {
            "GPT02_ISSUE159_AUTO_CHAIN_PREAPPROVAL_READY": "true",
        }), patch.object(Path, "is_socket", return_value=True), (
            patch.object(api, "issue159_independent_relock_supervisor_ready",
                         return_value=False)
        ):
            self.assertFalse(SOURCE_CHAIN_GATE({"task_id": 140}))
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "issue159_auto_chain_not_ready")
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 0)

    def test_runtime_gate_requires_explicit_flag_issuer_socket_and_clean_outputs(self):
        fixture_record={"task_id": 140}
        with patch.dict(os.environ, {"GPT02_ISSUE159_AUTO_CHAIN_PREAPPROVAL_READY":"false"}):
            with patch.object(Path, "is_socket", return_value=True):
                self.assertFalse(SOURCE_CHAIN_GATE(fixture_record))
        with patch.dict(os.environ, {"GPT02_ISSUE159_AUTO_CHAIN_PREAPPROVAL_READY":"true"}):
            with patch.object(Path, "is_socket", return_value=False):
                self.assertFalse(SOURCE_CHAIN_GATE(fixture_record))
            with patch.object(Path, "is_socket", return_value=True):
                self.assertFalse(SOURCE_CHAIN_GATE({"task_id": None}))
                self.assertTrue(SOURCE_CHAIN_GATE(fixture_record))
                output=api.ISSUE159_SIGNER_OUTPUTS[-1]
                output.write_text("fixture-preserved-issuer-signature")
                self.assertFalse(SOURCE_CHAIN_GATE(fixture_record))
                self.assertEqual(output.read_text(), "fixture-preserved-issuer-signature")
                output.unlink()

    def test_precommit_presign_rechecks_exact_pending_task_and_trusted_reader(self):
        # Source checker runs in memory against a private synthetic file.
        now = int(time.time() * 1000)
        claims = {**CLAIMS, "issuedAt": now - 1000, "expiresAt": now + 240000}
        record = {
            "task_id": claims["taskId"], "command_id": claims["commandId"],
            "attempt_id": claims["attemptId"], "company_id": "default",
            "actor_id": claims["superAdminId"], "decision": "APPROVE",
            "role_at_decision": "super_admin",
            "recorded_at_ms": now,
            "expires_at_ms": claims["expiresAt"],
            "claims_sha256": api.validate_approval_claims(claims)["claimsSha256"],
        }
        Path(self.pending).write_text(json.dumps({"claims": claims}))
        os.chmod(self.pending, 0o600)
        real_lstat = os.lstat
        def only_private_fixture(path):
            result = real_lstat(path)
            if os.fspath(path) == self.pending:
                return SimpleNamespace(
                    st_mode=result.st_mode, st_uid=0, st_gid=0,
                    st_nlink=result.st_nlink, st_size=result.st_size,
                )
            return result
        facts = {"issuer": "test-fixture-only"}
        with patch.object(api, "ISSUE159_PENDING_CLAIMS", self.pending), (
            patch.object(api.os, "lstat", side_effect=only_private_fixture)
        ), patch.object(api, "_socket_fact_reader", return_value=facts) as reader, (
            patch.object(api, "_verify_pre_sign_facts", return_value=now + 500000)
        ) as verifier:
            self.assertTrue(SOURCE_PRECOMMIT_PRESIGN(record))
            reader.assert_called_once_with({
                "companyId": "default",
                "hubTaskId": claims["taskId"],
                "commandCandidateId": claims["commandId"],
                "attemptId": claims["attemptId"],
            })
            self.assertEqual(verifier.call_args.args[0], facts)
            self.assertEqual(verifier.call_args.args[1], claims)
            self.assertFalse(SOURCE_PRECOMMIT_PRESIGN({
                **record, "claims_sha256": "0" * 64,
            }))
            self.assertFalse(SOURCE_PRECOMMIT_PRESIGN({
                **record, "actor_id": "wrong-admin",
            }))
            self.assertFalse(SOURCE_PRECOMMIT_PRESIGN({
                **record, "command_id": "22222222-2222-4222-8222-222222222222",
            }))
            verifier.side_effect = RuntimeError("REVOKED_SUPERADMIN_AUDIT")
            self.assertFalse(SOURCE_PRECOMMIT_PRESIGN(record))
        self.assertEqual(self.count(), 0)

    def test_precommit_presign_denies_missing_and_late_request_without_write(self):
        now = int(time.time() * 1000)
        claims = {**CLAIMS, "issuedAt": now - 500,
                  "expiresAt": now + 50000}
        record = {
            "task_id": claims["taskId"], "command_id": claims["commandId"],
            "attempt_id": claims["attemptId"], "company_id": "default",
            "actor_id": claims["superAdminId"], "decision": "APPROVE",
            "role_at_decision": "super_admin", "recorded_at_ms": now,
            "expires_at_ms": claims["expiresAt"],
            "claims_sha256": api.validate_approval_claims(claims)["claimsSha256"],
        }
        with patch.object(api, "ISSUE159_PENDING_CLAIMS", self.pending):
            self.assertFalse(SOURCE_PRECOMMIT_PRESIGN(record))
            Path(self.pending).write_text(json.dumps({"claims": claims}))
            os.chmod(self.pending, 0o600)
            real_lstat = os.lstat
            def private_stat(path):
                st = real_lstat(path)
                if os.fspath(path) == self.pending:
                    return SimpleNamespace(st_mode=st.st_mode, st_uid=0,
                         st_gid=0, st_nlink=st.st_nlink, st_size=st.st_size)
                return st
            with patch.object(api.os, "lstat", side_effect=private_stat), (
                patch.object(api, "_socket_fact_reader")
            ) as reader:
                self.assertFalse(SOURCE_PRECOMMIT_PRESIGN(record))
                reader.assert_not_called()
        self.assertEqual(self.count(), 0)

    def test_prior_approved_packet_or_temp_blocks_one_use_intent_before_insert(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        api.issue159_chain_readiness_gate = SOURCE_CHAIN_GATE
        base = Path(self.packet)
        paths = (base, base.with_name("." + base.name + ".tmp"))
        with patch.dict(os.environ, {
            "GPT02_ISSUE159_AUTO_CHAIN_PREAPPROVAL_READY": "true",
        }), patch.object(Path, "is_socket", return_value=True):
            for path in paths:
                with self.subTest(path=path.name):
                    data = b"prior-immutable-approval"
                    path.write_bytes(data)
                    self.assertFalse(SOURCE_APPROVED_SLOT_CLEAR())
                    status, body = self.request(AAL2_TOKEN)
                    self.assertEqual(status, 409)
                    self.assertEqual(body["error"], "issue159_auto_chain_not_ready")
                    self.assertEqual(body["releaseDecision"], "NO_GO")
                    self.assertFalse(body["dispatchPermitted"])
                    self.assertEqual(path.read_bytes(), data)
                    self.assertEqual(self.count(), 0)
                    path.unlink()
            self.assertTrue(SOURCE_APPROVED_SLOT_CLEAR())

    def test_pending_route_hides_approval_when_old_approved_packet_exists(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o600)
        Path(self.packet).write_bytes(b"preserved-prior-approval")
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertFalse(body["pending"])
        self.assertEqual(body["reason"], "APPROVED_PACKET_OUTPUT_OCCUPIED")
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 0)

    def test_approved_packet_publication_is_exclusive_and_preserves_old_evidence(self):
        result = {
            "intentId": "33333333-3333-4333-8333-333333333333",
            "claimsSha256": api.validate_approval_claims(CLAIMS)["claimsSha256"],
            "actorId": CLAIMS["superAdminId"],
            "authMethod": "supabase_admin_session",
            "roleAtDecision": "super_admin",
            "decision": "APPROVE",
            "recordedAt": BASE_NOW_MS,
            "expiresAt": CLAIMS["expiresAt"],
        }
        api.persist_issue159_approved_packet(CLAIMS, result)
        target = Path(self.packet)
        original = target.read_bytes()
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertTrue(SOURCE_APPROVED_SLOT_CLEAR() is False)
        with self.assertRaises(FileExistsError):
            api.persist_issue159_approved_packet(CLAIMS, {
                **result, "intentId": "44444444-4444-4444-8444-444444444444",
            })
        self.assertEqual(target.read_bytes(), original)
        self.assertFalse(target.with_name("." + target.name + ".tmp").exists())

    def test_two_simultaneous_packet_publishers_preserve_exactly_one_artifact(self):
        result = {
            "intentId": "33333333-3333-4333-8333-333333333333",
            "claimsSha256": api.validate_approval_claims(CLAIMS)["claimsSha256"],
            "actorId": CLAIMS["superAdminId"],
            "authMethod": "supabase_admin_session",
            "roleAtDecision": "super_admin",
            "decision": "APPROVE",
            "recordedAt": BASE_NOW_MS,
            "expiresAt": CLAIMS["expiresAt"],
        }
        barrier = threading.Barrier(2, timeout=5)

        def publish(intent_id):
            barrier.wait()
            try:
                api.persist_issue159_approved_packet(CLAIMS, {
                    **result, "intentId": intent_id,
                })
                return "published"
            except FileExistsError:
                return "already_occupied"

        attempts = (
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
        )
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(publish, attempts))
        self.assertCountEqual(outcomes, ["published", "already_occupied"])
        path = Path(self.packet)
        content = json.loads(path.read_text())
        self.assertIn(content["intentId"], attempts)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(path.with_name("." + path.name + ".tmp").exists())
        self.assertEqual(self.count(), 0)

    def test_approved_packet_symlink_is_occupied_and_never_followed(self):
        external = Path(self.signer_fixture.name) / "untouched-historical-packet"
        external.write_bytes(b"immutable-historical-evidence")
        Path(self.packet).symlink_to(external)
        self.assertFalse(SOURCE_APPROVED_SLOT_CLEAR())
        with self.assertRaises(FileExistsError):
            api.persist_issue159_approved_packet(CLAIMS, {
                "intentId": "33333333-3333-4333-8333-333333333333",
                "claimsSha256": api.validate_approval_claims(CLAIMS)["claimsSha256"],
                "actorId": CLAIMS["superAdminId"],
                "authMethod": "supabase_admin_session",
                "roleAtDecision": "super_admin",
                "decision": "APPROVE",
                "recordedAt": BASE_NOW_MS,
                "expiresAt": CLAIMS["expiresAt"],
            })
        self.assertEqual(external.read_bytes(), b"immutable-historical-evidence")
        self.assertEqual(self.count(), 0)
        Path(self.packet).unlink()

    def test_auto_chain_result_no_dispatch_contract_is_pinned_after_approval(self):
        # A legitimate issuer/lease chain reports evidence completed, not
        # signing/dispatch permission or worker Final ACK.
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        complete = {
            "environment": "DEV", "taskId": CLAIMS["taskId"],
            "autoChainCompleted": True, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
        }
        with patch.object(api, "run_after_approval", return_value=complete) as run:
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        run.assert_called_once_with(CLAIMS["taskId"])
        self.assertEqual(body["actorId"], CLAIMS["superAdminId"])
        self.assertIs(body["intentRecorded"], True)
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["autoChainCompleted"], True)
        self.assertIs(body["signingPermitted"], False)
        self.assertIs(body["authorizationGranted"], False)
        self.assertIs(body["dispatchPermitted"], False)
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(body["claimsSha256"],
                         api.validate_approval_claims(CLAIMS)["claimsSha256"])
        self.assertEqual(self.count(), 1)
        self.assertTrue(Path(self.packet).is_file())

    def test_untrusted_chain_response_cannot_promote_no_go_to_dispatch(self):
        # The child service cannot define approval provenance, signer grants,
        # release GO, or whether a one-use approval can be replayed.
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        forged = {
            "environment": "DEV", "taskId": CLAIMS["taskId"],
            "autoChainCompleted": True,
            "authorizationGranted": True,
            "dispatchPermitted": True,
            "releaseDecision": "GO",
            "signingPermitted": True,
            "approvalCanBeReplayed": True,
            "actorId": "synthetic_other_actor",
            "intentId": "synthetic_other_intent",
        }
        with patch.object(api, "run_after_approval", return_value=forged):
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertIs(body["autoChainCompleted"], False)
        self.assertEqual(body["autoChainError"], "AUTO_CHAIN_RESULT_CONTRACT_INVALID")
        self.assertEqual(body["actorId"], CLAIMS["superAdminId"])
        self.assertNotEqual(body["intentId"], "synthetic_other_intent")
        self.assertIs(body["intentRecorded"], True)
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["signingPermitted"], False)
        self.assertIs(body["authorizationGranted"], False)
        self.assertIs(body["dispatchPermitted"], False)
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        original = Path(self.packet).read_bytes()
        replay, replay_body = self.request(AAL2_TOKEN)
        self.assertEqual(replay, 409)
        self.assertEqual(replay_body["error"], "approval_intent_conflict")
        self.assertEqual(self.count(), 1)
        self.assertEqual(Path(self.packet).read_bytes(), original)

    def test_wrong_task_chain_response_cannot_claim_success(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        wrong = {
            "environment": "DEV", "taskId": 171,
            "autoChainCompleted": True, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
        }
        with patch.object(api, "run_after_approval", return_value=wrong):
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertIs(body["autoChainCompleted"], False)
        self.assertEqual(body["autoChainError"], "AUTO_CHAIN_RESULT_CONTRACT_INVALID")
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["signingPermitted"], False)
        self.assertIs(body["dispatchPermitted"], False)
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)

    def test_extra_chain_keys_cannot_override_approval_identity(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        injected = {
            "environment": "DEV", "taskId": CLAIMS["taskId"],
            "autoChainCompleted": True, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
            "claimsSha256": "0"*64,
        }
        with patch.object(api, "run_after_approval", return_value=injected):
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertIs(body["autoChainCompleted"], False)
        self.assertEqual(body["autoChainError"], "AUTO_CHAIN_RESULT_CONTRACT_INVALID")
        self.assertNotEqual(body["claimsSha256"], "0"*64)
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["authorizationGranted"], False)
        self.assertIs(body["dispatchPermitted"], False)
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)

    def test_committed_intent_unexpected_auto_chain_oserror_stays_no_go(self):
        # A once-only approval has already committed and its immutable
        # packet has been published before the DEV auto-chain starts. Even
        # an unexpected file/socket failure cannot imply safe reapproval.
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        sensitive = "SYNTHETIC_PRIVATE_DETAILS_MUST_NOT_LEAK"
        with patch.object(api, "run_after_approval",
                          side_effect=FileNotFoundError(sensitive)) as run:
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        run.assert_called_once_with(CLAIMS["taskId"])
        self.assertTrue(body["intentRecorded"])
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["autoChainCompleted"], False)
        self.assertEqual(body["autoChainError"], "AUTO_CHAIN_UNEXPECTED_FAILURE")
        self.assertNotIn(sensitive, json.dumps(body))
        self.assertIs(body["signingPermitted"], False)
        self.assertIs(body["authorizationGranted"], False)
        self.assertIs(body["dispatchPermitted"], False)
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        original_packet = Path(self.packet).read_bytes()
        self.assertTrue(original_packet)
        replay, replay_body = self.request(AAL2_TOKEN)
        self.assertEqual(replay, 409)
        self.assertEqual(replay_body["error"], "approval_intent_conflict")
        self.assertEqual(self.count(), 1)
        self.assertEqual(Path(self.packet).read_bytes(), original_packet)

    def test_committed_intent_unexpected_auto_chain_valueerror_not_http_400(self):
        # A ValueError used to escape to the outer generic invalid_request
        # handler even though SQLite was irrevocably committed.
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        with patch.object(api, "run_after_approval",
                          side_effect=ValueError("SYNTHETIC_INTERNAL_DETAIL")):
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertTrue(body["intentRecorded"])
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["autoChainCompleted"], False)
        self.assertEqual(body["autoChainError"], "AUTO_CHAIN_UNEXPECTED_FAILURE")
        self.assertNotIn("SYNTHETIC_INTERNAL_DETAIL", json.dumps(body))
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        self.assertTrue(Path(self.packet).is_file())

    def test_committed_intent_expected_auto_chain_error_still_no_go(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        with patch.object(api, "run_after_approval",
                          side_effect=api.AutoChainError("UNIT_FAILED_SYNTHETIC")):
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertTrue(body["intentRecorded"])
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["autoChainCompleted"], False)
        self.assertEqual(body["autoChainError"], "UNIT_FAILED_SYNTHETIC")
        self.assertIs(body["signingPermitted"], False)
        self.assertIs(body["authorizationGranted"], False)
        self.assertIs(body["dispatchPermitted"], False)
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)

    def test_committed_intent_packet_serialization_failure_cannot_be_retried(self):
        # Approval is committed BEFORE packet JSON publication. A ValueError
        # must be reported as recovery-required, not generic 400 invalid_request.
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        private_marker = "SYNTHETIC_PACKET_SERIALIZATION_DETAILS"
        with patch.object(api, "persist_issue159_approved_packet",
                          side_effect=ValueError(private_marker)), \
             patch.object(api, "run_after_approval") as signer:
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "issue159_approved_packet_recovery_required")
        self.assertIs(body["intentRecorded"], True)
        self.assertIs(body["approvalCanBeReplayed"], False)
        self.assertIs(body["signingPermitted"], False)
        self.assertIs(body["authorizationGranted"], False)
        self.assertIs(body["dispatchPermitted"], False)
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertNotIn(private_marker, json.dumps(body))
        self.assertEqual(self.count(), 1)
        self.assertFalse(Path(self.packet).exists())
        signer.assert_not_called()
        again, replay = self.request(AAL2_TOKEN)
        self.assertEqual(again, 409)
        self.assertEqual(replay["error"], "approval_intent_conflict")
        self.assertEqual(self.count(), 1)

    def test_committed_intent_packet_type_failure_cannot_be_retried(self):
        # Non-IO serialization errors use the same fail-closed recovery gate.
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        with patch.object(api, "persist_issue159_approved_packet",
                          side_effect=TypeError("SYNTHETIC_INTERNAL_PACKET")) as pub, \
             patch.object(api, "run_after_approval") as signer:
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 503)
        pub.assert_called_once()
        signer.assert_not_called()
        self.assertTrue(body["intentRecorded"])
        self.assertFalse(body["approvalCanBeReplayed"])
        self.assertEqual(body["error"], "issue159_approved_packet_recovery_required")
        self.assertNotIn("SYNTHETIC_INTERNAL_PACKET", json.dumps(body))
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        self.assertFalse(Path(self.packet).exists())

    def test_committed_sqlite_intent_survives_packet_publish_io_failure(self):
        """A publish error must never imply the one-use approval can be repeated."""
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        with patch.object(api, "persist_issue159_approved_packet",
                side_effect=OSError("synthetic-io-failure")), (
             patch.object(api, "run_after_approval")
        ) as auto_chain:
            status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 503)
        self.assertEqual(body["error"],
                         "issue159_approved_packet_recovery_required")
        self.assertTrue(body["intentRecorded"])
        self.assertFalse(body["approvalCanBeReplayed"])
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        self.assertFalse(Path(self.packet).exists())
        auto_chain.assert_not_called()
        # A repeated approval request is still a replay, never a second row.
        again, replay_body = self.request(AAL2_TOKEN)
        self.assertEqual(again, 409)
        self.assertEqual(replay_body["error"], "approval_intent_conflict")
        self.assertEqual(self.count(), 1)

    def test_prior_verified_link_prevents_one_use_approval_and_is_preserved(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        api.issue159_chain_readiness_gate = SOURCE_CHAIN_GATE
        link = Path(api.ISSUE159_OPERATOR_LINK_OUTPUT)
        temp = link.with_name("." + link.name + ".auto.tmp")
        with patch.dict(os.environ, {
            "GPT02_ISSUE159_AUTO_CHAIN_PREAPPROVAL_READY": "true",
        }), patch.object(Path, "is_socket", return_value=True):
            for path in (link, temp):
                with self.subTest(path=path.name):
                    prior = b"immutable-previous-task-link-evidence"
                    path.write_bytes(prior)
                    self.assertFalse(api.issue159_operator_link_slot_clear())
                    status, body = self.request(AAL2_TOKEN)
                    self.assertEqual(status, 409)
                    self.assertEqual(body["error"], "issue159_auto_chain_not_ready")
                    self.assertFalse(body["dispatchPermitted"])
                    self.assertEqual(body["releaseDecision"], "NO_GO")
                    self.assertEqual(self.count(), 0)
                    self.assertEqual(path.read_bytes(), prior)
                    path.unlink()
            self.assertTrue(api.issue159_operator_link_slot_clear())

    def test_pending_ui_hides_button_when_verified_link_is_occupied(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o600)
        target = Path(api.ISSUE159_OPERATOR_LINK_OUTPUT)
        target.write_bytes(b"immutable-verifier-link-previous-task")
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertFalse(body["pending"])
        self.assertEqual(body["reason"], "VERIFIED_OPERATOR_LINK_OCCUPIED")
        self.assertEqual(self.count(), 0)
        self.assertEqual(target.read_bytes(), b"immutable-verifier-link-previous-task")

    def test_existing_live_readiness_gate_denies_before_approval_write(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        api.issue159_chain_readiness_gate = lambda record: False
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "issue159_auto_chain_not_ready")
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 0)

    def test_signer_collision_blocks_pending_and_new_approval_before_write(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o600)
        with tempfile.TemporaryDirectory(prefix="issue159-signer-collision-") as td:
            targets = tuple(
                Path(td) / (role + "-signature.json")
                for role in ("approval", "hub", "core", "issuer")
            )
            with patch.object(api, "ISSUE159_SIGNER_OUTPUTS", targets):
                self.assertTrue(api.issue159_signer_output_preflight_clear())
                for target in targets:
                    for path in (target, target.with_name(
                        "." + target.name + ".tmp"
                    )):
                        with self.subTest(file=path.name, role=target.stem):
                            original = b"opaque-preserved-prior-task-evidence"
                            path.write_bytes(original)
                            status, body = self.pending_request()
                            self.assertEqual(status, 200)
                            self.assertFalse(body["pending"])
                            self.assertEqual(
                                body["reason"], "SIGNATURE_OUTPUT_OCCUPIED"
                            )
                            status, body = self.request(AAL2_TOKEN)
                            self.assertEqual(status, 409)
                            self.assertEqual(
                                body["error"], "signature_output_occupied"
                            )
                            self.assertIs(body["dispatchPermitted"], False)
                            self.assertEqual(body["releaseDecision"], "NO_GO")
                            self.assertEqual(self.count(), 0)
                            self.assertEqual(path.read_bytes(), original)
                            path.unlink()
                # A symlink MUST count as occupied: never follow its target.
                external = Path(td) / "unrelated-evidence"
                external.write_text("do-not-touch")
                targets[0].symlink_to(external)
                self.assertFalse(api.issue159_signer_output_preflight_clear())
                status, body = self.request(AAL2_TOKEN)
                self.assertEqual((status, body["error"]),
                                 (409, "signature_output_occupied"))
                self.assertEqual(external.read_text(), "do-not-touch")
                self.assertEqual(self.count(), 0)
                targets[0].unlink()
                # Once no prior output is in the isolated path, an ORIGINAL
                # authorized single approval remains permitted (NO DISPATCH).
                status, body = self.request(AAL2_TOKEN)
                self.assertEqual(status, 201, body)
                self.assertEqual(self.count(), 1)
                self.assertEqual(body["releaseDecision"], "NO_GO")

    def test_output_collision_never_leaks_to_unauthorized_caller(self):
        api.admin_identity = lambda token, connection: None
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        with tempfile.TemporaryDirectory(prefix="issue159-untrusted-") as td:
            target = Path(td) / "approval-signature.json"
            target.write_text("opaque")
            with patch.object(api, "ISSUE159_SIGNER_OUTPUTS", (target,)):
                status, body = self.request()
                self.assertEqual((status, body["error"]),
                                 (401, "unauthorized"))
                status, body = self.request(AAL2_TOKEN)
                self.assertEqual(status, 403)
                self.assertNotEqual(
                    body.get("error"), "signature_output_occupied"
                )
                self.assertEqual(self.count(), 0)
                self.assertEqual(target.read_text(), "opaque")

    def test_pending_route_rejects_wrong_actor_expired_and_insecure_file(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        wrong = {**CLAIMS, "superAdminId": "another-super-admin"}
        Path(self.pending).write_text(json.dumps({"claims": wrong}))
        os.chmod(self.pending, 0o600)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertFalse(body["pending"])
        self.assertEqual(body["reason"], "PENDING_REQUEST_ACTOR_MISMATCH")

        expired = {**CLAIMS, "issuedAt": BASE_NOW_MS - 300000,
                   "expiresAt": BASE_NOW_MS - 1}
        Path(self.pending).write_text(json.dumps({"claims": expired}))
        os.chmod(self.pending, 0o600)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertEqual(body["reason"], "PENDING_REQUEST_EXPIRED")

        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o644)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertEqual(body["reason"], "PENDING_REQUEST_FILE_SECURITY_INVALID")

    def test_pending_route_detects_already_approved_binding(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o600)
        digest = api.validate_approval_claims(CLAIMS)["claimsSha256"]
        con = sqlite3.connect(self.db)
        con.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,claims_sha256,
             actor_id,auth_method,role_at_decision,decision,recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("33333333-3333-4333-8333-333333333333", CLAIMS["taskId"],
             CLAIMS["commandId"], CLAIMS["attemptId"], CLAIMS["companyId"],
             digest, CLAIMS["superAdminId"], "supabase_admin_session",
             "super_admin", "APPROVE", BASE_NOW_MS, CLAIMS["expiresAt"]),
        )
        con.commit()
        con.close()
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertFalse(body["pending"])
        self.assertEqual(body["reason"], "PENDING_REQUEST_ALREADY_APPROVED")

    def test_expired_but_previously_approved_request_shows_ledger_not_refresh(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID,
            "email": "fixture@example.com",
            "role": "super_admin",
            "auth_level": "aal1",
        }
        expired = {**CLAIMS, "issuedAt": BASE_NOW_MS - 200000,
                   "expiresAt": BASE_NOW_MS - 100000}
        Path(self.pending).write_text(json.dumps({"claims": expired}))
        os.chmod(self.pending, 0o600)
        # An expired request with no matching approval remains expired.
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertEqual(body["reason"], "PENDING_REQUEST_EXPIRED")
        digest = api.validate_approval_claims(expired)["claimsSha256"]
        con = sqlite3.connect(self.db)
        con.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,claims_sha256,
             actor_id,auth_method,role_at_decision,decision,recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("33333333-3333-4333-8333-333333333333", expired["taskId"],
             expired["commandId"], expired["attemptId"], expired["companyId"],
             digest, expired["superAdminId"], "supabase_admin_session",
             "super_admin", "APPROVE", BASE_NOW_MS - 150000, expired["expiresAt"]),
        )
        con.commit()
        con.close()
        # The approved historical request must not offer another approval/refresh.
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertFalse(body["pending"])
        self.assertEqual(body["reason"], "PENDING_REQUEST_ALREADY_APPROVED")
        self.assertEqual(body["taskId"], expired["taskId"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertNotIn("claims", body)
        self.assertEqual(self.count(), 1)

    def test_pending_route_returns_json_for_malformed_contract_claims(self):
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID,
            "email": "fixture@example.com",
            "role": "super_admin",
            "auth_level": "aal1",
        }
        Path(self.pending).write_text(json.dumps({"claims": {"taskId": CLAIMS["taskId"]}}))
        os.chmod(self.pending, 0o600)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertEqual(
            body,
            {
                "environment": "DEV",
                "pending": False,
                "reason": "PENDING_REQUEST_INVALID",
                "releaseDecision": "NO_GO",
            },
        )

    def test_issue159_mapping_missing_fails_closed(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID, "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        con=sqlite3.connect(self.db)
        con.execute("DELETE FROM gpt02_issue159_admin_operator_links")
        con.commit(); con.close()
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 403)
        self.assertEqual(body, {"error": "active_super_admin_required"})
        self.assertEqual(self.count(), 0)

    def test_feature_disabled_is_404_and_never_writes(self):
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual((status, body), (404, {"error": "not_found"}))
        self.assertEqual(self.count(), 0)
        self.assertFalse(os.path.exists(self.packet))

    def test_static_fallback_token_cannot_create_issue159_intent(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        status, body = self.request(STATIC_TOKEN)
        self.assertEqual(status, 403)
        self.assertEqual(body, {"error": "active_super_admin_required"})
        self.assertEqual(self.count(), 0)
        self.assertFalse(os.path.exists(self.packet))

    def test_verified_aal2_super_admin_records_intent_but_stays_no_go(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: (
            {"user_id": AUTH_USER_ID, "email": "fixture@example.com",
             "role": "super_admin", "auth_level": "aal2"}
            if token == AAL2_TOKEN else None
        )
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(body["actorId"], CLAIMS["superAdminId"])
        self.assertEqual(body["authMethod"], "supabase_admin_session")
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        self.assertTrue(os.path.exists(self.packet))
        self.assertEqual(os.stat(self.packet).st_mode & 0o777, 0o600)
        packet = json.loads(Path(self.packet).read_text())
        self.assertEqual(packet["claims"], CLAIMS)
        self.assertEqual(packet["intentId"], body["intentId"])
        self.assertEqual(packet["claimsSha256"], body["claimsSha256"])
        self.assertEqual(packet["actorId"], CLAIMS["superAdminId"])
        self.assertFalse(packet["signingPermitted"])
        self.assertFalse(packet["authorizationGranted"])
        self.assertFalse(packet["dispatchPermitted"])
        self.assertEqual(packet["releaseDecision"], "NO_GO")

    def test_aal1_super_admin_records_intent_without_aal2_requirement(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID,
            "email": "fixture@example.com",
            "role": "super_admin",
            "auth_level": "aal1",
        }
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(body["actorId"], CLAIMS["superAdminId"])
        self.assertEqual(body["authMethod"], "supabase_admin_session")
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        self.assertTrue(os.path.exists(self.packet))

    def test_missing_auth_level_is_rejected_before_intent_write(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID,
            "email": "fixture@example.com",
            "role": "super_admin",
        }
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 403)
        self.assertEqual(body, {"error": "active_super_admin_required"})
        self.assertEqual(self.count(), 0)

    def test_admin_role_and_missing_bearer_are_rejected(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": AUTH_USER_ID,
            "email": "fixture@example.com",
            "role": "admin",
        }
        status, _ = self.request(AAL2_TOKEN)
        self.assertEqual(status, 403)
        status, _ = self.request(None)
        self.assertEqual(status, 401)
        self.assertEqual(self.count(), 0)

    def post_refresh(self, token=None, payload=b"{}"):
        headers={"Content-Type":"application/json"}
        if token is not None:
            headers["Authorization"]="Bearer "+token
        request=urllib.request.Request(
            self.base+"/api/gpt02/issue159/approval-intent/refresh",
            data=payload,headers=headers,method="POST")
        try:
            with urllib.request.urlopen(request,timeout=3) as response:
                return response.status,json.load(response)
        except urllib.error.HTTPError as error:
            return error.code,json.loads(error.read().decode())

    def test_refresh_requires_current_supabase_super_admin_not_static_token(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED=True
        api.admin_identity=lambda token,conn: None
        for token,expected in ((None,401),(STATIC_TOKEN,403),(AAL2_TOKEN,403)):
            with self.subTest(token=token is not None):
                status,out=self.post_refresh(token)
                self.assertEqual(status,expected)
                self.assertEqual(out["releaseDecision"],"NO_GO")
        self.assertEqual(self.count(),0)

    def test_refresh_disabled_fail_closed(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED=False
        status,body=self.post_refresh(AAL2_TOKEN)
        self.assertEqual(status,403)
        self.assertEqual(body["releaseDecision"],"NO_GO")

    def test_refresh_valid_admin_calls_only_bound_request_refresh(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED=True
        api.admin_identity=lambda token,connection: {
            "user_id":AUTH_USER_ID,
            "email":"fixture@example.com",
            "role":"super_admin","auth_level":"aal1",
        }
        response={"environment":"DEV","pending":True,"taskId":148,
                  "expiresAt":BASE_NOW_MS+240000,"requestRefreshed":True,
                  "signingPermitted":False,"authorizationGranted":False,
                  "dispatchPermitted":False,"releaseDecision":"NO_GO"}
        with patch.object(api,"refresh_pending",return_value=response) as mock:
            status,body=self.post_refresh(AAL2_TOKEN)
        self.assertEqual(status,200)
        self.assertEqual(body,response)
        mock.assert_called_once_with(self.db,self.pending,CLAIMS["superAdminId"])
        self.assertEqual(self.count(),0)

    def test_refresh_rejects_user_payload_and_preparation_expiry(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED=True
        api.admin_identity=lambda token,connection: {
            "user_id":AUTH_USER_ID,
            "email":"fixture@example.com",
            "role":"super_admin","auth_level":"aal1",
        }
        with patch.object(api,"refresh_pending") as mock:
            for payload in (b'{"taskId":148}',b'',b"{}",):
                if payload==b"{}":
                    continue
                status,out=self.post_refresh(AAL2_TOKEN,payload=payload)
                self.assertEqual(status,400)
                self.assertEqual(out["releaseDecision"],"NO_GO")
            mock.assert_not_called()
        with patch.object(api,"refresh_pending",side_effect=api.RefreshDenied(
            "ISSUE159_PREPARATION_NOT_FRESH_ENOUGH",409)):
            status,out=self.post_refresh(AAL2_TOKEN)
        self.assertEqual(status,409)
        self.assertEqual(out["error"],"ISSUE159_PREPARATION_NOT_FRESH_ENOUGH")
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(self.count(),0)

    def test_source_route_precedes_generic_static_token_authorization(self):
        source = API_PATH.read_text()
        route = source.index("if p=='/api/gpt02/issue159/approval-intent':")
        generic = source.index("if not self.authorized(): return self.send(401", route)
        self.assertLess(route, generic)
        self.assertIn("enabled=ISSUE159_APPROVAL_INTENT_ENABLED", source)
        self.assertIn("issue159_identity_verifier", source)

if __name__ == "__main__":
    unittest.main()
