#!/usr/bin/env python3
"""Stage CST-DEV GPT02 Core-preparation login without knowing an admin password.

Run in an authorized ROOT interactive VPS terminal only. Generates a unique
host-encrypted database credential and a root-only Supabase SQL Editor snippet
containing a SCRAM verifier, never the plaintext password. This script does
NOT enable LOGIN, call prepare_core_task, sign, approve, or dispatch.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys

PROJECT_REF = "xssrfshdrtdfupgqwfdw"
POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"
ROLE = "gpt02_core_prep_login"
CREDENTIAL = Path("/etc/credstore.encrypted/gpt02-issue159-core-prep-dsn")
SQL_FILE = Path("/root/gpt02-issue159-activate-core-prep.sql")
CA_FILE = Path("/etc/gpt02-dev/supabase-root-ca-2021.crt")


def scram_verifier(password: str, salt: bytes) -> str:
    if len(password) < 60 or len(salt) != 16:
        raise ValueError("SCRAM_INPUT_INVALID")
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 4096, 32)
    stored = hashlib.sha256(hmac.digest(salted, b"Client Key", "sha256")).digest()
    server = hmac.digest(salted, b"Server Key", "sha256")
    to64 = lambda data: base64.b64encode(data).decode("ascii")
    return f"SCRAM-SHA-256$4096:{to64(salt)}${to64(stored)}:{to64(server)}"


def activation_sql(verifier: str) -> str:
    allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/:=$-"
    if (not verifier.startswith("SCRAM-SHA-256$4096:")
            or any(ch not in allowed for ch in verifier)):
        raise ValueError("VERIFIER_FORMAT_INVALID")
    return f"""-- CST-DEV ONLY. Run in authenticated Supabase CST-DEV SQL Editor.
-- This alters ONLY the existing, least-privilege Core preparation role.
-- Private SCRAM verifier: do not send this SQL to chat or save to Git.
BEGIN;
DO $preflight$
DECLARE v_role record;
DECLARE v_writable integer;
BEGIN
 IF current_database() <> 'postgres' OR session_user <> 'postgres' THEN
   RAISE EXCEPTION 'CST_DEV_ADMIN_SQL_EDITOR_REQUIRED';
 END IF;
 SELECT rolcanlogin,rolbypassrls,rolsuper,rolcreaterole,rolcreatedb
   INTO v_role FROM pg_catalog.pg_roles WHERE rolname='{ROLE}';
 IF NOT FOUND OR v_role.rolcanlogin OR v_role.rolbypassrls
    OR v_role.rolsuper OR v_role.rolcreaterole OR v_role.rolcreatedb THEN
   RAISE EXCEPTION 'CORE_PREP_NOLOGIN_ROLE_DRIFT';
 END IF;
 IF NOT pg_catalog.has_function_privilege(
  '{ROLE}', 'gpt02_stage.prepare_core_task(text,integer,text,text,text,text)'::regprocedure, 'EXECUTE'
 ) THEN RAISE EXCEPTION 'CORE_PREP_EXECUTE_GRANT_REQUIRED'; END IF;
 SELECT count(*) INTO v_writable FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','ai_platform','gpt02_stage','gpt02_private')
 AND c.relkind IN ('r','p')
 AND (pg_catalog.has_table_privilege('{ROLE}',c.oid,'INSERT')
   OR pg_catalog.has_table_privilege('{ROLE}',c.oid,'UPDATE')
   OR pg_catalog.has_table_privilege('{ROLE}',c.oid,'DELETE')
   OR pg_catalog.has_table_privilege('{ROLE}',c.oid,'TRUNCATE'));
 IF v_writable<>0 THEN RAISE EXCEPTION 'CORE_PREP_DIRECT_DML_DENIED'; END IF;
 -- Hard-pin this activation to the genuine audited Hub DEV Task #150.
 -- In particular, running this SQL on a different project must fail closed.
 IF NOT EXISTS (
   SELECT 1 FROM public.ai_tasks t
   JOIN public.team_members m ON m.id=t.assigned_to_id
      AND m.company_id=t.company_id
   JOIN public.audit_logs a ON a.company_id=t.company_id
      AND a.entity_id=t.id::text AND a.action='gpt02_pic_assigned'
      AND a.id=2591
   JOIN public.users u ON u.id=a.after::jsonb->'actorIdentity'->>'id'
   WHERE t.company_id='default' AND t.id=150
     AND t.title='GPT02 DEV lifecycle E2E - validasi baru'
     AND t.status NOT IN ('completed','cancelled')
     AND m.is_active IS TRUE AND m.name=t.assigned_to
     AND a.after::jsonb->>'taskId'='150'
     AND a.after::jsonb->>'memberId'=t.assigned_to_id::text
     AND a.after::jsonb->'actorIdentity'->>'role'='super_admin'
     AND u.role='super_admin' AND u.is_active IS TRUE AND u.company_id IS NULL
 ) THEN RAISE EXCEPTION 'FRESH_AUDITED_GPT02_TASK150_REQUIRED'; END IF;
 IF EXISTS (SELECT 1 FROM gpt02_stage.core_preparations
    WHERE company_id='default' AND hub_task_id=150)
 OR EXISTS (SELECT 1 FROM public.ai_execution_jobs
    WHERE company_id='default' AND task_id=150) THEN
   RAISE EXCEPTION 'TASK150_ALREADY_PREPARED_OR_EXECUTED';
 END IF;
END $preflight$;
ALTER ROLE {ROLE} LOGIN PASSWORD '{verifier}';
COMMIT;
-- Confirmation (no secret): SELECT rolcanlogin,rolbypassrls FROM
-- pg_roles WHERE rolname='{ROLE}'; expected: true,false.
"""


def preflight() -> None:
    if os.geteuid() != 0 or not sys.stdin.isatty() or not sys.stdout.isatty():
        raise RuntimeError("ROOT_INTERACTIVE_TERMINAL_REQUIRED")
    if CREDENTIAL.exists() or SQL_FILE.exists():
        raise RuntimeError("CORE_PREP_CREDENTIAL_ALREADY_STAGED")
    if not CA_FILE.is_file() or CA_FILE.is_symlink():
        raise RuntimeError("DEV_TLS_CA_REQUIRED")
    if not CREDENTIAL.parent.is_dir():
        raise RuntimeError("ENCRYPTED_STORE_REQUIRED")


def stage() -> None:
    preflight()
    from psycopg.conninfo import make_conninfo

    password = secrets.token_urlsafe(64)
    verifier = scram_verifier(password, secrets.token_bytes(16))
    dsn = make_conninfo(
        host=POOLER, port=5432, dbname="postgres",
        user=f"{ROLE}.{PROJECT_REF}", password=password,
        sslmode="verify-full", sslrootcert=str(CA_FILE),
        connect_timeout=3,
    )
    sql = activation_sql(verifier)
    os.umask(0o077)
    try:
        result = subprocess.run(
            ["systemd-creds", "encrypt", "--with-key=host",
             "--name=core-prep-dsn", "-", str(CREDENTIAL)],
            input=dsn.encode(), stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, check=False, timeout=15,
        )
        if result.returncode or not CREDENTIAL.is_file():
            raise RuntimeError("CORE_PREP_CREDENTIAL_ENCRYPT_FAILED")
        CREDENTIAL.chmod(0o600)
        fd = os.open(SQL_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="ascii") as file:
            file.write(sql)
            file.flush()
            os.fsync(file.fileno())
    except Exception:
        SQL_FILE.unlink(missing_ok=True)
        CREDENTIAL.unlink(missing_ok=True)
        raise
    print("CORE_PREP_SQL_EDITOR_READY")
    print("Root-only activation SQL:", SQL_FILE)
    print("Host-encrypted dedicated Core prep DSN: staged")
    print("LOGIN not yet enabled; no task or approval was created.")


if __name__ == "__main__":
    try:
        stage()
    except Exception as exc:
        print("CORE_PREP_STAGING_STOPPED:", type(exc).__name__, file=sys.stderr)
        sys.exit(1)
