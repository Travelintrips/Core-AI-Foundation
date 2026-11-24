#!/usr/bin/env python3
"""Synthetic one-connection reader authentication and explicit relock test.

DISPOSABLE docker postgres:16-alpine --network none only.
NEVER use any live credential, DB, role or task. No PROD/DEV apply.
"""
import subprocess
import time
import uuid

PASSWORD="synthetic_ephemeral_not_a_real_secret"
ROLE="synthetic_issuer_reader"

def call(cmd,stdin=None,check=True):
    r=subprocess.run(cmd,input=stdin,text=True,capture_output=True,timeout=45)
    if check and r.returncode:raise RuntimeError(r.stderr[-1400:])
    return r

def sql(container,text):
    return call(["docker","exec","-i",container,"psql","-X","-v","ON_ERROR_STOP=1",
                 "-U","postgres","-d","postgres","-At"],stdin=text).stdout

def reader_query(container,query):
    return call(["docker","exec","-e","PGPASSWORD="+PASSWORD,container,
                 "psql","-X","-w","-h","127.0.0.1","-U",ROLE,"-d","postgres",
                 "-Atc",query],check=False)

def main():
    name="issue159-relock-"+uuid.uuid4().hex[:10]
    try:
        call(["docker","run","--rm","-d","--network","none","--name",name,
              "-e","POSTGRES_PASSWORD=fixture_only","postgres:16-alpine"])
        for _ in range(100):
            if call(["docker","exec",name,"psql","-X","-U","postgres","-d","postgres",
                     "-Atc","SELECT 1"],check=False).returncode==0: break
            time.sleep(.25)
        else:raise RuntimeError("POSTGRES_NOT_READY")
        time.sleep(2)
        sql(name,"""
CREATE ROLE synthetic_issuer_reader LOGIN NOINHERIT NOBYPASSRLS
 CONNECTION LIMIT 1 PASSWORD 'synthetic_ephemeral_not_a_real_secret';
CREATE SCHEMA isolated;
CREATE TABLE isolated.approvals(task_id integer,company text);
INSERT INTO isolated.approvals VALUES (170,'default'),(172,'default');
ALTER TABLE isolated.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE isolated.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY task170 ON isolated.approvals FOR SELECT
 TO synthetic_issuer_reader USING (task_id=170 AND company='default');
GRANT USAGE ON SCHEMA isolated TO synthetic_issuer_reader;
GRANT SELECT(task_id,company) ON isolated.approvals TO synthetic_issuer_reader;
""")
        good=reader_query(name,"BEGIN READ ONLY; SELECT task_id FROM isolated.approvals ORDER BY task_id; ROLLBACK;")
        if good.returncode or "170" not in good.stdout.splitlines() or "172" in good.stdout.splitlines():
            raise AssertionError("NATIVE_ONE_TASK_READER_FAILED:"+good.stderr[-500:])
        print("PASS_DISPOSABLE_NATIVE_LOGIN_ONE_TASK_READONLY")
        unseen=reader_query(name,"SELECT count(*) FROM isolated.approvals WHERE task_id=172")
        if unseen.returncode or unseen.stdout.strip()!="0":
            raise AssertionError("SAME_TENANT_CROSS_TASK_READ")
        print("PASS_DISPOSABLE_OTHER_TASK_DENIED")
        sql(name,"""
REVOKE SELECT(task_id,company) ON isolated.approvals FROM synthetic_issuer_reader;
REVOKE USAGE ON SCHEMA isolated FROM synthetic_issuer_reader;
ALTER ROLE synthetic_issuer_reader NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE usename='synthetic_issuer_reader' AND pid<>pg_backend_pid();
""")
        denial=reader_query(name,"SELECT 1")
        if denial.returncode==0:raise AssertionError("LOGIN_STILL_ACCEPTED_AFTER_RELOCK")
        result=sql(name,"""
SELECT (NOT rolcanlogin AND rolconnlimit=0 AND
        (SELECT count(*) FROM pg_stat_activity
         WHERE usename='synthetic_issuer_reader')=0)
FROM pg_roles WHERE rolname='synthetic_issuer_reader';
""").strip()
        if result!="t":raise AssertionError("RELOCK_INCOMPLETE:"+result)
        print("PASS_DISPOSABLE_LOGIN_DENIED_AFTER_RELOCK")
        print("PASS_DISPOSABLE_ZERO_SESSIONS")
        print("FIXTURE_ONLY_NO_LIVE_DB_OR_CREDENTIAL")
    finally:
        call(["docker","rm","-f",name],check=False)

if __name__=="__main__":main()
