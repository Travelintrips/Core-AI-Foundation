#!/usr/bin/env python3
"""Issue159 owner-split relock SQL: disposable PostgreSQL 16/17 ONLY.

No live DEV/PROD DB, existing credentials, signer, worker or DELL access.
Runs a true no-superuser postgres definer + separate existing table owner.
"""
from pathlib import Path
import os
import secrets
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "docs/dev/gpt02-issue159-store-owner-relock-helper.PROPOSED.sql"
MAINT_HELPER = ROOT / "docs/dev/gpt02-issue159-store-owner-relock-helper-maintenance.REVIEW_ONLY.sql"
MAIN = ROOT / "docs/dev/gpt02-issue159-two-phase-owner-split-relock.PROPOSED.sql"
ROLE = "dev_gpt02_task_200_abcdef012345"
AUDITOR = "dev_gpt02_relock_catalog_auditor"
TABLES = ("approvals","operator_links","receipts",
          "core_identity_receipts","post_consumption_fences")
# Strictly bounded disposable images: production/DEV connections forbidden.
IMAGE = os.environ.get("GPT02_RELOCK_TEST_PG_IMAGE", "postgres:16-alpine")
if IMAGE not in ("postgres:16-alpine", "postgres:17-alpine"):
    raise SystemExit("UNAPPROVED_DISPOSABLE_POSTGRES_IMAGE")
INSTALLER = os.environ.get("GPT02_RELOCK_TEST_OWNER_INSTALLER", "direct")
if INSTALLER not in ("direct", "maintenance"):
    raise SystemExit("UNAPPROVED_DISPOSABLE_OWNER_INSTALLER")

def call(command, *, stdin=None, check=True, timeout=50):
    r = subprocess.run(command,input=stdin,text=True,
                       capture_output=True,timeout=timeout)
    if check and r.returncode:
        raise RuntimeError("FIXTURE_COMMAND_FAILED:"+r.stderr[-1800:])
    return r

def psql(db, user, password, sql, *, check=True):
    return call(["docker","exec","-i","-e","PGPASSWORD="+password,db,
                 "psql","-X","-w","-v","ON_ERROR_STOP=1",
                 "-h","127.0.0.1","-U",user,"-d","postgres",
                 "-At"],stdin=sql,check=check)

def one(db,user,password,sql):
    return psql(db,user,password,sql).stdout.strip()

def main():
    # Test-only source is forbidden from creating privileged LIVE postgres
    # roles; all commands must remain within network-isolated Docker.
    name="issue159-owner-split-"+uuid.uuid4().hex[:9]
    root_pw=secrets.token_urlsafe(24)
    owner_pw=secrets.token_urlsafe(24)
    maintenance_pw=secrets.token_urlsafe(24)
    pg_pw=secrets.token_urlsafe(24)
    auditor_pw=secrets.token_urlsafe(24)
    scoped_pw=secrets.token_urlsafe(24)
    try:
        call(["docker","run","--rm","-d","--network","none",
              "--name",name,"-e","POSTGRES_USER=fixture_root",
              "-e","POSTGRES_PASSWORD="+root_pw,IMAGE])
        for _ in range(100):
            r=psql(name,"fixture_root",root_pw,"SELECT 1",check=False)
            if r.returncode==0:break
            time.sleep(.2)
        else:raise AssertionError("PG16_LOOPBACK_NOT_READY")

        psql(name,"fixture_root",root_pw,f"""
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT PASSWORD '{pg_pw}';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_signal_backend TO postgres;
CREATE ROLE gpt02_store_owner LOGIN NOINHERIT PASSWORD '{owner_pw}';
CREATE ROLE {AUDITOR} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_private TO postgres;
""")
        psql(name,"gpt02_store_owner",owner_pw,"\n".join(
          "CREATE TABLE gpt02_private."+t+"(id bigint);"
          "ALTER TABLE gpt02_private."+t+
          " ENABLE ROW LEVEL SECURITY;"
          "ALTER TABLE gpt02_private."+t+
          " FORCE ROW LEVEL SECURITY;"
          for t in TABLES
        ))
        psql(name,"postgres",pg_pw,f"""
CREATE ROLE {ROLE} LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1
 PASSWORD '{scoped_pw}';
""")
        admin=one(name,"fixture_root",root_pw,f"""
SELECT count(*) FROM pg_auth_members
WHERE roleid='{ROLE}'::regrole AND member='postgres'::regrole
 AND admin_option
""")
        assert admin=="1","NON_SUPER_POSTGRES_LACKS_ROLE_ADMIN_OPTION"
        print("PASS_NON_SUPER_OWNER_HAS_EXACT_SCOPED_ROLE_ADMIN_OPTION",flush=True)

        psql(name,"gpt02_store_owner",owner_pw,
            "GRANT USAGE ON SCHEMA gpt02_private TO "+ROLE+";"+
            "GRANT SELECT ON "+
            ",".join("gpt02_private."+t for t in TABLES)+
            " TO "+ROLE+";"+
            "GRANT SELECT (id) ON gpt02_private.approvals TO "+ROLE+";")
        column_acl = one(name,"postgres",pg_pw,
           "SELECT COALESCE(attacl::text,'NO_COLUMN_ACL') "
           "FROM pg_attribute "
           "WHERE attrelid='gpt02_private.approvals'::regclass "
           "AND attname='id' AND attnum>0")
        print("COLUMN_ACL_PRESENT_BEFORE_RELOCK",column_acl!='NO_COLUMN_ACL',flush=True)
        assert ROLE in column_acl, "NEGATIVE_CONTROL_COLUMN_GRANT_NOT_CREATED"
        assert one(name,"postgres",pg_pw,
            "SELECT has_table_privilege('postgres','gpt02_private.approvals',"
            "'SELECT WITH GRANT OPTION')")=="f"
        print("PASS_POSTGRES_CANNOT_REVOKE_FOREIGN_OWNER_TABLE_GRANTS",flush=True)

        # A limited postgres actor must neither mint the owner helper nor
        # install phase functions before the genuine owner-signed helper.
        # Both failures must roll back without leaving a partially created
        # privilege-bearing schema or a callable SECURITY DEFINER routine.
        wrong_owner=psql(name,"postgres",pg_pw,HELPER.read_text(),check=False)
        assert wrong_owner.returncode!=0 and (
            "GPT02_OWNER_SESSION_REQUIRED" in wrong_owner.stderr
        ), "POSTGRES_INCORRECTLY_INSTALLED_OWNER_HELPER"
        assert one(name,"postgres",pg_pw,
          "SELECT to_regprocedure("
          "'gpt02_private.revoke_expired_scoped_reader_grants(name)')")=="", (
            "UNAUTHORIZED_OWNER_HELPER_LEFT_BEHIND")
        print("PASS_LIMITED_POSTGRES_CANNOT_INSTALL_STORE_OWNER_HELPER",flush=True)
        # SET ROLE via a synthetic temporary grant must not substitute
        # for a real authenticated owner. This grant exists in the
        # disposable fixture only and is revoked immediately afterwards.
        psql(name,"fixture_root",root_pw,
          "GRANT gpt02_store_owner TO postgres WITH SET TRUE, INHERIT FALSE;")
        assert one(name,"postgres",pg_pw,
          "SELECT pg_has_role(current_user,'gpt02_store_owner','SET')")=="t"
        attempted_owner=psql(name,"postgres",pg_pw,
          "SET ROLE gpt02_store_owner;" + chr(10) + HELPER.read_text(),
          check=False)
        assert attempted_owner.returncode!=0 and (
          "GPT02_OWNER_SESSION_REQUIRED" in attempted_owner.stderr
        ), "SET_ROLE_IMPERSONATION_NOT_DENIED: "+attempted_owner.stderr[-300:]
        assert one(name,"postgres",pg_pw,
          "SELECT to_regprocedure("
          "'gpt02_private.revoke_expired_scoped_reader_grants(name)')")=="", (
          "SET_ROLE_IMPERSONATION_LEFT_OWNER_HELPER")
        psql(name,"fixture_root",root_pw,
          "REVOKE gpt02_store_owner FROM postgres;")
        assert one(name,"postgres",pg_pw,
          "SELECT pg_has_role(current_user,'gpt02_store_owner','SET')")=="f"
        print("PASS_SET_ROLE_NOT_EQUIVALENT_TO_OWNER_AUTHENTICATED_SESSION",flush=True)
        missing_helper=psql(name,"postgres",pg_pw,MAIN.read_text(),check=False)
        assert missing_helper.returncode!=0 and (
            "OWNER_BOUND_REVOKE_HELPER_REQUIRED" in missing_helper.stderr
        ), "UNSIGNED_OWNER_SPLIT_PHASE_FUNCTIONS_INSTALLED"
        assert one(name,"postgres",pg_pw,
          "SELECT to_regnamespace('gpt02_relock_audit')")=="", (
            "FAILED_PHASE_INSTALL_LEFT_PRIVILEGED_SCHEMA_BEHIND")
        print("PASS_OWNER_HELPER_REQUIRED_BEFORE_PHASE_FUNCTIONS",flush=True)

        # This second installer test is strictly disposable / review only.
        # The store owner is NOLOGIN before helper installation, and the
        # independently authenticated maintenance principal is re-locked
        # BEFORE the same Phase A/B code and recovery guards are exercised.
        if INSTALLER == "maintenance":
            marker="CREATE FUNCTION gpt02_private.revoke_expired_scoped_reader_grants"
            assert HELPER.read_text().split(marker,1)[1] == (
              MAINT_HELPER.read_text().split(marker,1)[1]), "HELPER_SOURCE_DRIFT"
            psql(name,"fixture_root",root_pw,
              "ALTER ROLE gpt02_store_owner NOLOGIN PASSWORD NULL CONNECTION LIMIT 0;"
              "CREATE ROLE gpt02_owner_maintenance LOGIN NOINHERIT "
              "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS "
              "PASSWORD '"+maintenance_pw+"';"
              "GRANT gpt02_store_owner TO gpt02_owner_maintenance "
              "WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;")
            assert one(name,"fixture_root",root_pw,
              "SELECT NOT rolcanlogin AND rolconnlimit=0 "
              "AND rolpassword IS NULL FROM pg_authid "
              "WHERE rolname='gpt02_store_owner'")=="t"
            installed=psql(name,"gpt02_owner_maintenance",maintenance_pw,
              "SET ROLE gpt02_store_owner;"+chr(10)+MAINT_HELPER.read_text())
            assert "CREATE FUNCTION" in installed.stdout
            psql(name,"fixture_root",root_pw,
              "REVOKE gpt02_store_owner FROM gpt02_owner_maintenance;"
              "ALTER ROLE gpt02_owner_maintenance "
              "NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
            assert one(name,"fixture_root",root_pw,
              "SELECT NOT rolcanlogin AND rolconnlimit=0 "
              "AND rolpassword IS NULL FROM pg_authid "
              "WHERE rolname='gpt02_owner_maintenance'")=="t"
            assert one(name,"fixture_root",root_pw,
              "SELECT NOT pg_has_role("
              "'gpt02_owner_maintenance','gpt02_store_owner','SET')")=="t"
            print("PASS_REVIEW_ONLY_MAINTENANCE_INSTALLER_RETIRED_BEFORE_PHASE_A",flush=True)
        else:
            psql(name,"gpt02_store_owner",owner_pw,HELPER.read_text())
        # Identical Phase A/B code and the same independent auditor prove
        # owner helper revocation AFTER maintenance authority is gone.
        psql(name,"postgres",pg_pw,MAIN.read_text())
        print("PASS_OWNER_SPLIT_MIGRATIONS_EXISTING_NOLOGIN_ROLE_NOT_RECREATED",flush=True)

        auditor=one(name,"postgres",pg_pw,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 FROM pg_roles "
          "WHERE rolname='"+AUDITOR+"'")
        assert auditor=="t"
        count=one(name,"postgres",pg_pw,
          "SELECT count(*) FROM pg_proc p JOIN pg_namespace n "
          "ON n.oid=p.pronamespace "
          "WHERE n.nspname='gpt02_relock_audit' AND p.prosecdef")
        assert count=="2"
        assert one(name,"postgres",pg_pw,
          "SELECT has_table_privilege('"+AUDITOR+
          "','gpt02_relock_audit.reader_issuance_watchdog','SELECT')")=="f"
        print("PASS_TWO_PRIVATE_FUNCTIONS_NO_AUDITOR_LEDGER_READ",flush=True)

        # Actual disposable login only: never do this in CST DEV.
        psql(name,"fixture_root",root_pw,
          f"ALTER ROLE {AUDITOR} LOGIN CONNECTION LIMIT 1 "
          f"PASSWORD '{auditor_pw}';")
        psql(name,"postgres",pg_pw,f"""
INSERT INTO gpt02_relock_audit.reader_issuance_watchdog
(role_name,task_id,scope_sha256,expires_at)
VALUES ('{ROLE}',200,'{"a"*64}',clock_timestamp()-interval '1 second');
""")
        # A newly admitted session is explicitly unable to call the owner
        # helper directly, despite its nested use by phase B.
        assert psql(name,AUDITOR,auditor_pw,
          "SELECT gpt02_private.revoke_expired_scoped_reader_grants('"+
          ROLE+"'::name)",check=False).returncode!=0
        assert one(name,"postgres",pg_pw,
          "SELECT has_table_privilege('"+ROLE+
          "','gpt02_private.approvals','SELECT')")=="t"
        before=psql(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()",
          check=False)
        assert before.returncode!=0 and "RELOCK_PHASE_A_NOT_COMMITTED" in before.stderr
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_a()")=="1"
        assert one(name,"postgres",pg_pw,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 AND "
          "rolpassword IS NULL FROM pg_authid WHERE rolname='"+ROLE+"'")=="t"
        assert psql(name,ROLE,scoped_pw,"SELECT 1",check=False).returncode!=0
        assert one(name,"postgres",pg_pw,
          "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
          "WHERE cleaned_at IS NULL")=="1"
        print("PASS_PHASE_A_COMMITTED_NOLOGIN_BEFORE_PHASE_B",flush=True)
        # The gpt02_store_owner nested definer can REVOKE within phase B,
        # but its writes must roll back if the outer transaction aborts.
        # This is a synthetic failure BEFORE COMMIT and must never mark the
        # issuance ledger cleaned or restore a password/login.
        aborted=psql(name,AUDITOR,auditor_pw,
          "BEGIN; SELECT gpt02_relock_audit.relock_expired_phase_b(); "
          "SELECT 1 / 0; COMMIT;",check=False)
        assert aborted.returncode!=0 and "division by zero" in aborted.stderr
        assert one(name,"postgres",pg_pw,
          "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
          "WHERE cleaned_at IS NULL")=="1"
        assert one(name,"postgres",pg_pw,
          "SELECT has_table_privilege('"+ROLE+
          "','gpt02_private.approvals','SELECT')")=="t"
        assert one(name,"postgres",pg_pw,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
          "FROM pg_authid WHERE rolname='"+ROLE+"'")=="t"
        print("PASS_OWNER_SPLIT_PHASE_B_ABORT_ROLLBACK_PRESERVES_DURABLE_NOLOGIN",flush=True)
        print("PASS_OWNER_NESTED_REVOKE_ROLLED_BACK_AND_LEDGER_STILL_PENDING",flush=True)
        # A foreign SET membership must NEVER be hidden by clean direct
        # table/schema ACLs; the owner helper cannot remove role grants.
        # Phase A has committed NOLOGIN: rejection keeps the role locked
        # and ledger pending for an authorized role-membership cleanup.
        psql(name,"fixture_root",root_pw,
          "CREATE ROLE rogue_set_target NOLOGIN;"
          "GRANT rogue_set_target TO "+ROLE+
          " WITH INHERIT FALSE, SET TRUE;")
        assert one(name,"postgres",pg_pw,
          "SELECT pg_has_role('"+ROLE+"','rogue_set_target','SET')")=="t"
        anomalous=psql(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()",check=False)
        assert anomalous.returncode!=0 and (
          "RELOCK_SCOPED_ROLE_MEMBERSHIP_PRESENT" in anomalous.stderr
        ), "OUTBOUND_SET_MEMBERSHIP_FALSE_CLEANUP"
        assert one(name,"postgres",pg_pw,
          "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
          "WHERE cleaned_at IS NULL")=="1"
        assert one(name,"postgres",pg_pw,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 AND "
          "rolpassword IS NULL FROM pg_authid WHERE rolname='"+ROLE+"'")=="t"
        psql(name,"fixture_root",root_pw,
          "REVOKE rogue_set_target FROM "+ROLE+";")
        psql(name,"fixture_root",root_pw,
          "CREATE ROLE rogue_set_caller NOLOGIN;"
          "GRANT "+ROLE+" TO rogue_set_caller WITH INHERIT FALSE, SET TRUE;")
        assert one(name,"postgres",pg_pw,
          "SELECT pg_has_role('rogue_set_caller','"+ROLE+"','SET')")=="t"
        inbound=psql(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()",check=False)
        assert inbound.returncode!=0 and (
          "RELOCK_SCOPED_ROLE_MEMBERSHIP_PRESENT" in inbound.stderr
        ), "INBOUND_SET_MEMBERSHIP_FALSE_CLEANUP"
        assert one(name,"postgres",pg_pw,
          "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
          "WHERE cleaned_at IS NULL")=="1"
        psql(name,"fixture_root",root_pw,
          "REVOKE "+ROLE+" FROM rogue_set_caller;")
        print("PASS_RELOCK_REJECTS_UNEXPECTED_INBOUND_OUTBOUND_SET_MEMBERSHIP",flush=True)
        # Even the sole accepted creator-admin relationship must not
        # grant SET or INHERIT of the scoped role. The earlier filter
        # omitted this privilege escalation route for creator membership.
        psql(name,"fixture_root",root_pw,
          "GRANT "+ROLE+" TO postgres WITH ADMIN TRUE, "
          "INHERIT FALSE, SET TRUE;")
        assert one(name,"postgres",pg_pw,
          "SELECT pg_has_role('postgres','"+ROLE+"','SET')")=="t"
        creator_set=psql(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()",check=False)
        assert creator_set.returncode!=0 and (
          "RELOCK_SCOPED_ROLE_MEMBERSHIP_PRESENT" in creator_set.stderr
        ), "CREATOR_SET_TRUE_FALSE_CLEANUP"
        assert one(name,"postgres",pg_pw,
          "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
          "WHERE cleaned_at IS NULL")=="1"
        psql(name,"fixture_root",root_pw,
          "GRANT "+ROLE+" TO postgres WITH ADMIN TRUE, "
          "INHERIT TRUE, SET FALSE;")
        assert one(name,"postgres",pg_pw,
          "SELECT bool_or(inherit_option)::text FROM pg_auth_members "
          "WHERE member='postgres'::regrole "
          "AND roleid='"+ROLE+"'::regrole")=="true"
        creator_inherit=psql(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()",check=False)
        assert creator_inherit.returncode!=0 and (
          "RELOCK_SCOPED_ROLE_MEMBERSHIP_PRESENT" in creator_inherit.stderr
        ), "CREATOR_INHERIT_TRUE_FALSE_CLEANUP"
        assert one(name,"postgres",pg_pw,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 AND "
          "rolpassword IS NULL FROM pg_authid WHERE rolname='"+ROLE+"'")=="t"
        psql(name,"fixture_root",root_pw,
          "GRANT "+ROLE+" TO postgres WITH ADMIN TRUE, "
          "INHERIT FALSE, SET FALSE;")
        assert one(name,"postgres",pg_pw,
          "SELECT pg_has_role('postgres','"+ROLE+"','SET')")=="f"
        print("PASS_CREATOR_ADMIN_SET_INHERIT_OPTIONS_MUST_BE_FALSE",flush=True)

        # Retry on an independent PostgreSQL connection.
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()")=="1"
        for t in TABLES:
            assert one(name,"postgres",pg_pw,
              "SELECT has_table_privilege('"+ROLE+
              "','gpt02_private."+t+"','SELECT')")=="f",t
        assert one(name,"postgres",pg_pw,
          "SELECT has_any_column_privilege('"+ROLE+
          "','gpt02_private.approvals','SELECT')")=="f", (
            "COLUMN_SELECT_GRANT_SURVIVED_OWNER_CLEANUP")
        assert one(name,"postgres",pg_pw,
          "SELECT has_schema_privilege('"+ROLE+"','gpt02_private','USAGE')")=="f"
        assert one(name,"postgres",pg_pw,
          "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
          "WHERE cleaned_at IS NOT NULL")=="1"
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()")=="0"
        # A user might later regain schema USAGE. Assert that the
        # *catalog column ACL* is removed, not just hidden by no USAGE.
        column_acl_after=one(name,"postgres",pg_pw,
          "SELECT COALESCE(attacl::text,'NO_COLUMN_ACL') "
          "FROM pg_attribute "
          "WHERE attrelid='gpt02_private.approvals'::regclass "
          "AND attname='id' AND attnum>0")
        assert ROLE not in column_acl_after, (
          "RETAINED_COLUMN_GRANT_SURVIVED_OWNER_CLEANUP")
        print("PASS_OWNER_HELPER_REVOKED_FIVE_TABLE_GRANTS_AND_SCHEMA",flush=True)
        print("PASS_PHASE_B_CLEANUP_DURABLE_AND_REPLAY_IDEMPOTENT",flush=True)

        outsider=psql(name,"fixture_root",root_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_a()",check=False)
        assert outsider.returncode!=0 and "RELOCK_INDEPENDENT_CALLER_REQUIRED" in outsider.stderr
        assert psql(name,ROLE,scoped_pw,"SELECT 1",check=False).returncode!=0
        print("PASS_NO_PUBLIC_OR_CROSS_ROLE_AUTHORITY_AND_PASSWORD_STAYS_LOCKED",flush=True)
        print("DISPOSABLE_OWNER_INSTALLER="+INSTALLER,flush=True)
        print("DISPOSABLE_PG_IMAGE="+IMAGE,flush=True)
        print("DISPOSABLE_PG16_OR_PG17_ONLY_NO_CST_DEV_OR_PROD_MUTATIONS",flush=True)
    finally:
        call(["docker","rm","-f",name],check=False)

if __name__=="__main__":
    main()
