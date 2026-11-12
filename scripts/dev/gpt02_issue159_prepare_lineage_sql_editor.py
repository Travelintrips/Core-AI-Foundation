#!/usr/bin/env python3
"""Prepare CST-DEV lineage reader credential for manual Supabase SQL Editor use.

Run by an authorized operator in a *local interactive root terminal* on the
authorized VPS. Never invokes SQL, enables LOGIN, starts services or touches
PROD. Password stays in process memory and host-encrypted systemd credential.
The SQL file contains a SCRAM verifier, not a plaintext password.
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
ROLE = "dev_gpt02_lineage_login"
CREDENTIAL = Path("/etc/credstore.encrypted/gpt02-issue159-lineage-reader-dsn")
SQL_FILE = Path("/root/gpt02-issue159-activate-lineage-reader.sql")
CERT = "/run/credentials/gpt02-issue159-lineage-reader.service/supabase-root-ca-2021.crt"
SERVICE = "gpt02-issue159-lineage-reader.service"


def scram_verifier(password: str, salt: bytes) -> str:
    if len(password) < 60 or len(salt) != 16:
        raise ValueError("SCRAM_INPUT_INVALID")
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 4096)
    stored_key = hashlib.sha256(hmac.digest(salted, b"Client Key", "sha256")).digest()
    server_key = hmac.digest(salted, b"Server Key", "sha256")
    b64 = lambda data: base64.b64encode(data).decode("ascii")
    return f"SCRAM-SHA-256$4096:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


def sql_for_reader(verifier: str) -> str:
    # Only known-safe characters occur in the generated SCRAM verifier.
    safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/:=$-"
    if not verifier.startswith("SCRAM-SHA-256$4096:") or any(c not in safe for c in verifier):
        raise ValueError("SCRAM_VERIFIER_FORMAT_INVALID")
    return f"""-- CST-DEV ONLY. Generated locally, root-only file. Contains a SCRAM verifier.
-- Paste into the authenticated Supabase CST-DEV SQL Editor, not into a chat.
-- No existing role, database password, signer, or owner permission is changed.
BEGIN;
DO $preflight$
DECLARE
  v_login boolean;
  v_reader boolean;
  v_count integer;
  v_forced boolean;
  v_write boolean;
BEGIN
  SELECT rolcanlogin INTO v_login FROM pg_catalog.pg_roles WHERE rolname='{ROLE}';
  IF v_login IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'LINEAGE_LOGIN_NOT_STANDBY';
  END IF;
  SELECT (NOT rolcanlogin AND NOT rolbypassrls) INTO v_reader
    FROM pg_catalog.pg_roles WHERE rolname='dev_gpt02_lineage_reader';
  IF v_reader IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'LINEAGE_READER_ROLE_UNSAFE';
  END IF;
  SELECT count(*) INTO v_count FROM pg_catalog.pg_policies
    WHERE schemaname='gpt02_private'
      AND policyname='dev_gpt02_lineage_reader_select' AND cmd='SELECT';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'LINEAGE_RLS_POLICIES_INCOMPLETE';
  END IF;
  SELECT count(*), bool_and(c.relrowsecurity AND c.relforcerowsecurity),
    bool_or(pg_catalog.has_table_privilege('{ROLE}',c.oid,'INSERT')
       OR pg_catalog.has_table_privilege('{ROLE}',c.oid,'UPDATE')
       OR pg_catalog.has_table_privilege('{ROLE}',c.oid,'DELETE')
       OR pg_catalog.has_table_privilege('{ROLE}',c.oid,'TRUNCATE'))
    INTO v_count,v_forced,v_write
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='gpt02_private' AND c.relname IN
     ('approvals','operator_links','receipts',
      'core_identity_receipts','post_consumption_fences');
  IF v_count <> 5 OR v_forced IS DISTINCT FROM TRUE OR v_write IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'LINEAGE_READ_ONLY_OR_FORCE_RLS_INVALID';
  END IF;
END $preflight$;
ALTER ROLE {ROLE} LOGIN PASSWORD '{verifier}';
COMMIT;
-- Verify via SQL (without password): SELECT rolcanlogin FROM pg_roles
-- WHERE rolname='{ROLE}';  Expected: true.
"""


def preflight() -> None:
    if os.geteuid() != 0 or not sys.stdin.isatty() or not sys.stdout.isatty():
        raise RuntimeError("LOCAL_INTERACTIVE_ROOT_TERMINAL_REQUIRED")
    if CREDENTIAL.exists() or SQL_FILE.exists():
        raise RuntimeError("PROVISIONING_ARTIFACT_ALREADY_PRESENT_STOP")
    if not Path("/etc/gpt02-dev/supabase-root-ca-2021.crt").is_file():
        raise RuntimeError("DEV_SUPABASE_CA_NOT_FOUND")
    if subprocess.run(["systemctl", "is-active", "--quiet", SERVICE], check=False).returncode == 0:
        raise RuntimeError("LINEAGE_READER_SERVICE_MUST_STAY_STOPPED")
    if not CREDENTIAL.parent.is_dir():
        raise RuntimeError("SYSTEMD_CREDENTIAL_DIRECTORY_MISSING")


def prepare() -> None:
    preflight()
    from psycopg.conninfo import make_conninfo

    password = secrets.token_urlsafe(64)
    verifier = scram_verifier(password, secrets.token_bytes(16))
    dsn = make_conninfo(
        host=POOLER, port=5432, dbname="postgres",
        user=f"{ROLE}.{PROJECT_REF}", password=password,
        sslmode="verify-full", sslrootcert=CERT,
        connect_timeout=3, options="-c default_transaction_read_only=on",
    )
    sql = sql_for_reader(verifier)
    os.umask(0o077)
    try:
        # Encrypt from stdin in memory, never write plaintext DSN to disk.
        result = subprocess.run(
            ["systemd-creds", "encrypt", "--with-key=host",
             "--name=lineage-reader-dsn", "-", str(CREDENTIAL)],
            input=dsn.encode("utf-8"), stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, check=False, timeout=15)
        if result.returncode != 0 or not CREDENTIAL.is_file():
            raise RuntimeError("HOST_ENCRYPTED_CREDENTIAL_FAILED")
        CREDENTIAL.chmod(0o600)
        fd = os.open(SQL_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="ascii") as output:
                output.write(sql)
                output.flush()
                os.fsync(output.fileno())
        except Exception:
            SQL_FILE.unlink(missing_ok=True)
            raise
        print("SQL_EDITOR_PREPARATION_READY")
        print("SQL file (root-only):", str(SQL_FILE))
        print("Encrypted reader credential: prepared, not activated")
        print("Database role, running services and PROD: unchanged")
        print("NEXT: paste SQL file privately into CST-DEV Supabase SQL Editor.")
    except Exception:
        # Never leave an orphan credential if preparation failed.
        if not SQL_FILE.exists():
            CREDENTIAL.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    try:
        prepare()
    except Exception as exc:
        print("PREPARATION_STOPPED:", type(exc).__name__, file=sys.stderr)
        sys.exit(1)
