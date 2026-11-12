#!/usr/bin/env python3
"""Interactive, one-time CST-DEV lineage reader provisioning.

RUN MANUALLY ON THE AUTHORIZED VPS as root, with an admin database connection
string supplied through a *hidden terminal prompt*, never ChatGPT or CI.
Never prints either database credential, and refuses to change PROD.
No signer/writer credential, approval, or dispatch is touched.
"""
from __future__ import annotations
import base64
import getpass
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import subprocess
import sys

EXPECTED_DB = "postgres"
PROJECT_REF = "xssrfshdrtdfupgqwfdw"
HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
LOGIN_ROLE = "dev_gpt02_lineage_login"
READER_ROLE = "dev_gpt02_lineage_reader"
CREDENTIAL = Path("/etc/credstore.encrypted/gpt02-issue159-lineage-reader-dsn")
CA = "/run/credentials/gpt02-issue159-lineage-reader.service/supabase-root-ca-2021.crt"


def require_prerequisites():
    if os.geteuid() != 0 or CREDENTIAL.exists():
        raise RuntimeError("ROOT_AND_ABSENT_CREDENTIAL_REQUIRED")
    if not Path("/etc/gpt02-dev/supabase-root-ca-2021.crt").is_file():
        raise RuntimeError("PINNED_CA_REQUIRED")
    status = subprocess.run(
        ["systemctl", "is-active", "--quiet", "gpt02-issue159-lineage-reader.service"],
        check=False)
    if status.returncode == 0:
        raise RuntimeError("STOP_READER_BEFORE_PROVISIONING")


def main() -> int:
    # Reject redirects, pipelines and machine-to-machine automation.
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise RuntimeError("INTERACTIVE_LOCAL_TERMINAL_REQUIRED")
    require_prerequisites()

    import psycopg
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
    from psycopg import sql

    admin_dsn = getpass.getpass("CST-DEV administrative PostgreSQL DSN (hidden): ")
    args = conninfo_to_dict(admin_dsn)
    if (args.get("dbname") != EXPECTED_DB or
            args.get("host") != HOST or str(args.get("port")) != "5432" or
            not args.get("user", "").endswith("." + PROJECT_REF) or
            args.get("sslmode") != "verify-full" or not args.get("sslrootcert")):
        raise RuntimeError("ADMIN_DSN_SCOPE_OR_TLS_INVALID")
    if args.get("user", "").startswith(LOGIN_ROLE):
        raise RuntimeError("ADMIN_READER_ROLE_REUSE_DENIED")

    password = secrets.token_urlsafe(64)
    # PostgreSQL ALTER ROLE doesn't support bind parameters. Supply a SCRAM
    # verifier rather than the plaintext password, so DB logs cannot disclose
    # the actual reader credential.
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 4096, 32)
    stored = hashlib.sha256(hmac.digest(salted, b"Client Key", "sha256")).digest()
    server = hmac.digest(salted, b"Server Key", "sha256")
    b64 = lambda data: base64.b64encode(data).decode("ascii")
    verifier = f"SCRAM-SHA-256$4096:{b64(salt)}${b64(stored)}:{b64(server)}"
    reader_dsn = make_conninfo(
        host=HOST, port=5432, dbname=EXPECTED_DB,
        user=f"{LOGIN_ROLE}.{PROJECT_REF}", password=password,
        sslmode="verify-full", sslrootcert=CA,
        connect_timeout=3, options="-c default_transaction_read_only=on",
    )
    with psycopg.connect(admin_dsn, connect_timeout=5, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT r.rolcanlogin,r.rolbypassrls,r.rolsuper,r.rolcreaterole
                   FROM pg_roles r WHERE r.rolname=%s""", (LOGIN_ROLE,))
            state = cur.fetchone()
            if state != (False, False, False, False):
                raise RuntimeError("STANDBY_READER_ROLE_DRIFT")
            cur.execute(
                """SELECT inherit_option,set_option,admin_option
                   FROM pg_auth_members m
                   JOIN pg_roles reader ON reader.oid=m.roleid
                   JOIN pg_roles login ON login.oid=m.member
                   WHERE reader.rolname=%s AND login.rolname=%s""",
                (READER_ROLE, LOGIN_ROLE))
            if cur.fetchone() != (True, False, False):
                raise RuntimeError("READER_MEMBERSHIP_DRIFT")
            cur.execute(
                """SELECT count(*) FROM pg_policies WHERE schemaname='gpt02_private'
                   AND policyname='dev_gpt02_lineage_reader_select'""")
            if cur.fetchone()[0] != 5:
                raise RuntimeError("RLS_POLICY_NOT_READY")
        conn.rollback()

    # Use a local encrypted credential file, not any plaintext on disk.
    os.umask(0o077)
    process = subprocess.run(
        ["systemd-creds", "encrypt", "--name=lineage-reader-dsn", "-", str(CREDENTIAL)],
        input=reader_dsn.encode(), stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, check=False)
    if process.returncode:
        raise RuntimeError("ENCRYPTED_CREDENTIAL_CREATE_FAILED")
    CREDENTIAL.chmod(0o600)

    try:
        # Password is delivered through the authenticated PostgreSQL connection.
        # Never print it; DDL identifier is a fixed literal.
        with psycopg.connect(admin_dsn, connect_timeout=5, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute(sql.SQL("ALTER ROLE dev_gpt02_lineage_login LOGIN PASSWORD {}")
                            .format(sql.Literal(verifier)))
            conn.commit()
        print("DEV_READER_LOGIN_ENABLED_CREDENTIAL_ENCRYPTED")
        print("Service not started; run read-only validation before start.")
        return 0
    except Exception:
        # The encrypted artifact is not left installed after failed activation.
        CREDENTIAL.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("PROVISIONING_FAILED: " + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
