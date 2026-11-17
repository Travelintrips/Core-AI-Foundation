#!/usr/bin/env python3
"""Disposable PostgreSQL 17 regression of the fixed-role relock proposal.

No Supabase connections, no existing VPS DB passwords, no PROD, no signing.
All Docker containers are network isolated and deleted in finally.
"""
import os,secrets,subprocess,time,uuid
from datetime import datetime,timezone,timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL = ROOT / "docs/dev/gpt02_issue159_fixed_writer_relock.REVIEW_ONLY.sql"
IMAGE = "mirror.gcr.io/library/postgres:17-alpine"
AUDITOR = "dev_gpt02_relock_catalog_auditor"
ROLES = (
    "dev_gpt02_attestor_evidence",
    "dev_gpt02_issuer_evidence",
    "gpt02_issuer_evidence_reader",
)

def command(args,sql=None,check=True,timeout=45):
    p=subprocess.run(args,input=sql,text=True,capture_output=True,timeout=timeout)
    if check and p.returncode:
        # Redact secrets by never printing args or submitted SQL.
        raise RuntimeError("DISPOSABLE_FIXTURE_FAILED:"+p.stderr[-650:])
    return p

def psql(db,user,password,statement,check=True):
    return command(
        ["docker","exec","-i","-e","PGPASSWORD="+password,db,
         "psql","-X","-w","-v","ON_ERROR_STOP=1",
         "-h","127.0.0.1","-U",user,"-d","postgres","-At"],
        sql=statement,check=check,
    )

def one(db,user,password,statement):
    return psql(db,user,password,statement).stdout.strip()

def yes(db,user,password,statement):
    return one(db,user,password,statement)=="t"

def main():
    name="gpt02-fixed-relock-"+uuid.uuid4().hex[:8]
    root_pw=secrets.token_urlsafe(28)
    postgres_pw=secrets.token_urlsafe(28)
    auditor_pw=secrets.token_urlsafe(28)
    roles_pw={role:secrets.token_urlsafe(28) for role in ROLES}
    role_names=",".join("'"+r+"'" for r in ROLES)
    delayed=[]
    try:
        command(["docker","run","--rm","-d","--network","none","--name",name,
                 "-e","POSTGRES_USER=fixture_root",
                 "-e","POSTGRES_PASSWORD="+root_pw,IMAGE])
        for _ in range(110):
            if psql(name,"fixture_root",root_pw,"SELECT 1",check=False).returncode==0:
                break
            time.sleep(.2)
        else:raise AssertionError("PG17_FIXTURE_START_TIMEOUT")

        # One independent auditor with NOLOGIN and three existing inert roles.
        psql(name,"fixture_root",root_pw,"""
CREATE ROLE postgres LOGIN CREATEROLE INHERIT PASSWORD '"""+postgres_pw+"""';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_signal_backend TO postgres;
CREATE ROLE dev_gpt02_relock_catalog_auditor NOLOGIN NOINHERIT
 NOCREATEROLE NOCREATEDB NOSUPERUSER NOBYPASSRLS
 CONNECTION LIMIT 0 PASSWORD NULL;
""")
        psql(name,"postgres",postgres_pw,"\n".join(
            "CREATE ROLE "+r+" NOLOGIN NOINHERIT NOSUPERUSER "
            "NOCREATEROLE NOCREATEDB NOBYPASSRLS "
            "CONNECTION LIMIT 0 PASSWORD NULL;" for r in ROLES
        ))
        for role in ROLES:
            assert yes(name,"postgres",postgres_pw,
                "SELECT count(*)=1 FROM pg_auth_members "
                "WHERE member='postgres'::regrole "
                "AND roleid='"+role+"'::regrole AND admin_option")
        print("PASS_EXISTING_ADMIN_OPTION_AND_INERT_TARGETS",flush=True)

        psql(name,"postgres",postgres_pw,SQL.read_text())
        assert one(name,"postgres",postgres_pw,
          "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
          "WHERE n.nspname='gpt02_relock_audit' AND p.prosecdef")=="2"
        assert yes(name,"postgres",postgres_pw,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
          "FROM pg_authid WHERE rolname='"+AUDITOR+"'")
        assert not yes(name,"postgres",postgres_pw,
          "SELECT has_table_privilege('"+AUDITOR+
          "','gpt02_relock_audit.writer_issuance_watchdog','SELECT')")
        print("PASS_TWO_PRIVATE_FUNCTIONS_AUDITOR_NO_RAW_DML",flush=True)

        # The test fixture uses the existing-role credential only in Docker.
        psql(name,"fixture_root",root_pw,
          "ALTER ROLE "+AUDITOR+" LOGIN CONNECTION LIMIT 1 PASSWORD '"+auditor_pw+"';")
        outsider=psql(name,"fixture_root",root_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_a()",check=False)
        assert outsider.returncode!=0 and "RELOCK_INDEPENDENT_CALLER_REQUIRED" in outsider.stderr
        assert psql(name,AUDITOR,auditor_pw,
           "SELECT * FROM gpt02_relock_audit.writer_issuance_watchdog",check=False).returncode!=0
        assert psql(name,AUDITOR,auditor_pw,
           "ALTER ROLE dev_gpt02_issuer_evidence LOGIN",check=False).returncode!=0
        print("PASS_NO_PUBLIC_AUDITOR_TABLE_OR_ROLE_ADMIN_AUTHORITY",flush=True)

        # Wrong target and unbounded TTL fail at the table constraint.
        wrong=psql(name,"postgres",postgres_pw,
           "INSERT INTO gpt02_relock_audit.writer_issuance_watchdog "
           "(role_name,task_id,scope_sha256,expires_at) "
           "VALUES('postgres',201,'"+("a"*64)+"',clock_timestamp()+interval '4 seconds')",
           check=False)
        assert wrong.returncode!=0
        long_ttl=psql(name,"postgres",postgres_pw,
           "INSERT INTO gpt02_relock_audit.writer_issuance_watchdog "
           "(role_name,task_id,scope_sha256,expires_at) "
           "VALUES('dev_gpt02_attestor_evidence',201,'"+("b"*64)+
           "',clock_timestamp()+interval '3 minutes')",check=False)
        assert long_ttl.returncode!=0
        print("PASS_EXACT_THREE_ROLES_AND_HARD_120_SECOND_TTL",flush=True)

        # One transaction: record all three short-lived DB role windows,
        # then open each existing fixed role with a single connection.
        registrations=[]
        for index,role in enumerate(ROLES):
            registrations.append(
              "INSERT INTO gpt02_relock_audit.writer_issuance_watchdog "
              "(role_name,task_id,scope_sha256,expires_at) VALUES ('"+
              role+"',201,'"+("%064x"%(index+1))+
              "',clock_timestamp()+interval '7 seconds');"
              "ALTER ROLE "+role+" LOGIN CONNECTION LIMIT 1 PASSWORD '"+
              roles_pw[role]+"';"
            )
        psql(name,"postgres",postgres_pw,"BEGIN;"+"".join(registrations)+"COMMIT;")
        # Only one not-yet-cleaned row per fixed role is permitted.
        duplicate=psql(name,"postgres",postgres_pw,
          "INSERT INTO gpt02_relock_audit.writer_issuance_watchdog "
          "(role_name,task_id,scope_sha256,expires_at) VALUES "
          "('dev_gpt02_attestor_evidence',202,'"+("c"*64)+
          "',clock_timestamp()+interval '4 seconds')",check=False)
        assert duplicate.returncode!=0
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_a()")=="0"
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()")=="0"
        # Keep all three real role sessions open; the independent auditor must
        # lock them even if the main coordinator is no longer running.
        for role in ROLES:
            proc=subprocess.Popen(
                ["docker","exec","-e","PGPASSWORD="+roles_pw[role],name,
                 "psql","-X","-w","-h","127.0.0.1","-U",role,
                 "-d","postgres","-c","SELECT pg_sleep(40)"],
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            delayed.append(proc)
            for _ in range(30):
                activity=one(name,"postgres",postgres_pw,
                    "SELECT count(*) FROM pg_stat_activity WHERE usename='"+role+"'")
                if int(activity)>=1:break
                time.sleep(.15)
            else:raise AssertionError("TEST_ROLE_SESSION_NOT_CONNECTED:"+role)
        print("PASS_ALL_THREE_ROLE_SESSIONS_OPEN_BEFORE_EXPIRE",flush=True)

        time.sleep(7.5)
        b=psql(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()",check=False)
        assert b.returncode!=0 and "RELOCK_PHASE_A_NOT_COMMITTED" in b.stderr
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_a()")=="3"
        for role in ROLES:
            assert yes(name,"postgres",postgres_pw,
              "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
              "FROM pg_authid WHERE rolname='"+role+"'")
            assert psql(name,role,roles_pw[role],"SELECT 1",check=False).returncode!=0
        assert one(name,"postgres",postgres_pw,
          "SELECT count(*) FROM gpt02_relock_audit.writer_issuance_watchdog "
          "WHERE cleaned_at IS NULL")=="3"
        print("PASS_PHASE_A_DURABLE_RELOCK_BEFORE_SESSION_CLEANUP",flush=True)

        # Rollback of phase B cannot revive old credentials or mark cleaned.
        rollback=psql(name,AUDITOR,auditor_pw,
          "BEGIN; SELECT gpt02_relock_audit.relock_expired_phase_b(); "
          "SELECT 1/0; COMMIT;",check=False)
        assert rollback.returncode!=0 and "division by zero" in rollback.stderr
        assert one(name,"postgres",postgres_pw,
          "SELECT count(*) FROM gpt02_relock_audit.writer_issuance_watchdog "
          "WHERE cleaned_at IS NULL")=="3"
        for role in ROLES:
            assert yes(name,"postgres",postgres_pw,
              "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
              "FROM pg_authid WHERE rolname='"+role+"'")
        print("PASS_ABORT_ROLLBACK_KEEP_PASSWORDS_CLEARED",flush=True)

        # New connection: finish phase B; no active scoped sessions survive.
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()")=="3"
        assert one(name,"postgres",postgres_pw,
          "SELECT count(*) FROM gpt02_relock_audit.writer_issuance_watchdog "
          "WHERE cleaned_at IS NOT NULL")=="3"
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_a()")=="0"
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()")=="0"
        for role in ROLES:
            assert one(name,"postgres",postgres_pw,
              "SELECT count(*) FROM pg_stat_activity WHERE usename='"+role+"'")=="0"
        print("PASS_PHASE_B_TERMINATES_ALL_SESSIONS_AND_IS_IDEMPOTENT",flush=True)

        # A second task can use the same fixed roles after the prior rows
        # are cleaned; the history is retained and only one open row is allowed.
        second_pw={role:secrets.token_urlsafe(28) for role in ROLES}
        second_expiry=(datetime.now(timezone.utc)+timedelta(seconds=4)).isoformat()
        second=[]
        for index,role in enumerate(ROLES):
            second.append(
              "INSERT INTO gpt02_relock_audit.writer_issuance_watchdog "
              "(role_name,task_id,scope_sha256,expires_at) VALUES ('"+
              role+"',202,'"+("%064x"%(index+101))+
              "',TIMESTAMPTZ '"+second_expiry+"');"
              "ALTER ROLE "+role+" LOGIN CONNECTION LIMIT 1 PASSWORD '"+
              second_pw[role]+"' VALID UNTIL '"+second_expiry+"';"
            )
        psql(name,"postgres",postgres_pw,"BEGIN;"+"".join(second)+"COMMIT;")
        for role in ROLES:
            proc=subprocess.Popen(
                ["docker","exec","-e","PGPASSWORD="+second_pw[role],name,
                 "psql","-X","-w","-h","127.0.0.1","-U",role,
                 "-d","postgres","-c","SELECT pg_sleep(40)"],
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            delayed.append(proc)
            for _ in range(30):
                activity=one(name,"postgres",postgres_pw,
                    "SELECT count(*) FROM pg_stat_activity WHERE usename='"+role+"'")
                if int(activity)>=1:break
                time.sleep(.15)
            else:raise AssertionError("SECOND_WINDOW_ROLE_SESSION_NOT_CONNECTED:"+role)
        time.sleep(4.5)
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_a()")=="3"
        assert one(name,AUDITOR,auditor_pw,
          "SELECT gpt02_relock_audit.relock_expired_phase_b()")=="3"
        assert one(name,"postgres",postgres_pw,
          "SELECT count(*) FROM gpt02_relock_audit.writer_issuance_watchdog "
          "WHERE cleaned_at IS NOT NULL")=="6"
        for role in ROLES:
            assert yes(name,"postgres",postgres_pw,
              "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
              "FROM pg_authid WHERE rolname='"+role+"'")
            assert one(name,"postgres",postgres_pw,
              "SELECT count(*) FROM pg_stat_activity WHERE usename='"+role+"'")=="0"
        print("PASS_REPEATED_WINDOW_HISTORY_AND_INDEPENDENT_RELOCK",flush=True)
        print("DISPOSABLE_PG17_ONLY_NO_CST_DEV_OR_PROD_MUTATIONS",flush=True)
    finally:
        for proc in delayed:
            try:
                if proc.poll() is None:proc.terminate()
                proc.wait(timeout=4)
            except Exception:
                try:proc.kill()
                except Exception:pass
        command(["docker","rm","-f",name],check=False)


if __name__=="__main__":
    main()
