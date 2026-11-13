#!/usr/bin/env python3
"""CST-DEV Issue159 read-only writer credential probe.

Intended for a one-time root-owned systemd-run with LoadCredentialEncrypted.
Never prints credential values, SQL parameters, secret hashes, or DB errors.
It neither enables roles nor calls writer RPCs. No fallback credentials.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import stat
import sys

PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
CA = "/etc/gpt02-dev/supabase-root-ca-2021.crt"
ROLES = {
    "attestor": ("dev_gpt02_attestor_evidence", "attestor-dsn",
                 frozenset({"record_linked_approval"})),
    "issuer": ("dev_gpt02_issuer_evidence", "issuer-dsn",
               frozenset({"consume_linked_approval",
                          "reserve_post_consumption_fence",
                          "record_issuer_evidence",
                          "consume_issuer_lease"})),
}
RPC_NAMES = tuple(sorted(set().union(*(v[2] for v in ROLES.values()))))


class ProbeDenied(RuntimeError):
    pass


def deny(code: str):
    raise ProbeDenied(code)


def validate_dsn(conninfo: dict, role: str):
    if role not in ROLES:
        deny("PROBE_ROLE_NOT_APPROVED")
    name = ROLES[role][0]
    exact = {
        "user": f"{name}.{PROJECT}",
        "host": HOST, "port": "5432", "dbname": "postgres",
        "sslmode": "verify-full", "sslrootcert": CA,
    }
    failures = [key for key, expected in exact.items()
                if str(conninfo.get(key)) != expected]
    if not conninfo.get("password"):
        failures.append("missing_password")
    if failures:
        # Field NAMES only. Never print the provided values.
        deny("PROBE_STRICT_DEV_DSN_SCOPE_FAILED_FIELDS_" + "_".join(failures))


def check_identity(row, role: str):
    name = ROLES[role][0]
    if (row != (name, name, "postgres", "on", True, True, 1,
                False, False, False, False, False)):
        deny("PROBE_NATIVE_ROLE_READONLY_TLS_FAILED")


def check_grants(rows, role: str):
    if set(name for name, permitted in rows) != set(RPC_NAMES):
        deny("PROBE_RPC_CATALOG_INCOMPLETE")
    allowed = {name for name, permitted in rows if permitted is True}
    if allowed != ROLES[role][2]:
        deny("PROBE_RPC_GRANT_SCOPE_FAILED")


def run(role: str):
    if role not in ROLES:
        deny("PROBE_ROLE_NOT_APPROVED")
    if os.geteuid() != 0 or os.environ.get("APP_ENV") != "development":
        deny("PROBE_DEV_ROOT_REQUIRED")
    directory = os.environ.get("CREDENTIALS_DIRECTORY")
    if not directory:
        deny("PROBE_SYSTEMD_CREDENTIAL_MOUNT_REQUIRED")
    source = Path(directory)
    if (not source.is_dir() or source.is_symlink()
            or not source.resolve().as_posix().startswith("/run/credentials/")):
        deny("PROBE_CREDENTIAL_DIRECTORY_INVALID")
    filepath = source / ROLES[role][1]
    st = filepath.lstat()
    if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode)
            or st.st_size < 20 or st.st_size > 4096
            or stat.S_IMODE(st.st_mode) & 0o077):
        deny("PROBE_CREDENTIAL_FILE_CUSTODY_INVALID")
    from psycopg.conninfo import conninfo_to_dict
    import psycopg
    dsn = filepath.read_text(encoding="utf-8").strip()
    validate_dsn(conninfo_to_dict(dsn), role)
    # Only read-only SQL, no permission modifications, no RPC execution.
    with psycopg.connect(dsn, connect_timeout=5, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("BEGIN READ ONLY")
            try:
                cursor.execute("SET LOCAL statement_timeout='3000ms'")
                cursor.execute("SET LOCAL row_security=on")
                cursor.execute("""
                SELECT session_user, current_user, current_database(),
                    current_setting('transaction_read_only'),
                    EXISTS(SELECT 1 FROM pg_stat_ssl
                           WHERE pid=pg_backend_pid() AND ssl),
                    r.rolcanlogin, r.rolconnlimit,
                    r.rolsuper,r.rolcreatedb,r.rolcreaterole,
                    r.rolbypassrls,r.rolinherit
                FROM pg_roles r WHERE r.rolname=current_user
                """)
                check_identity(cursor.fetchone(), role)
                cursor.execute("""
                SELECT p.proname,has_function_privilege(current_user,p.oid,'EXECUTE')
                FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='gpt02_private'
                  AND p.proname=ANY(%s::text[])
                ORDER BY p.proname
                """, (list(RPC_NAMES),))
                check_grants(cursor.fetchall(), role)
            finally:
                cursor.execute("ROLLBACK")
    print("GPT02_DEV_CREDENTIAL_READONLY_PROBE_PASS role=" + role)
    print("writer_rpc_executed false")
    print("database_mutated false")
    print("dispatch_permitted false")


if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--role", choices=sorted(ROLES), required=True)
        args = parser.parse_args()
        run(args.role)
    except Exception as exc:
        # Always suppress raw Postgres/psycopg exception contents and secrets.
        safe_reason = (str(exc) if isinstance(exc, ProbeDenied)
                       else type(exc).__name__)
        print("GPT02_DEV_CREDENTIAL_READONLY_PROBE_DENIED "
              + safe_reason, file=sys.stderr)
        raise SystemExit(2)
