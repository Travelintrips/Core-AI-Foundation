#!/usr/bin/env python3
"""Disposable PostgreSQL 16 role-scoped read and revocation test.

NO LIVE DEV / NO PROD / NO CREDENTIAL ACCESS. No network on container.
Validates that REVOKE blocks new queries after a synthetic one-task read.
It does not prove killing already-open sessions, expiry, or credential custody.
"""
import subprocess
import time
import uuid

SQL=r"""
CREATE SCHEMA gpt02_private;
CREATE ROLE synthetic_task_reader NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE TABLE gpt02_private.approvals(task_id int,company_id text,command_id uuid,attempt_id uuid,claims jsonb);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
INSERT INTO gpt02_private.approvals VALUES
(170,'default','00000000-0000-0000-0000-000000000170','00000000-0000-0000-0000-000000000270','{"environment":"DEV"}'),
(172,'default','00000000-0000-0000-0000-000000000172','00000000-0000-0000-0000-000000000272','{"environment":"DEV"}');
CREATE POLICY task170_only ON gpt02_private.approvals FOR SELECT
 TO synthetic_task_reader USING (task_id=170 AND company_id='default'
 AND command_id='00000000-0000-0000-0000-000000000170'
 AND attempt_id='00000000-0000-0000-0000-000000000270'
 AND claims->>'environment'='DEV');
GRANT USAGE ON SCHEMA gpt02_private TO synthetic_task_reader;
GRANT SELECT(task_id,company_id,command_id,attempt_id,claims)
 ON gpt02_private.approvals TO synthetic_task_reader;
SET ROLE synthetic_task_reader;
DO $a$ DECLARE n int; BEGIN
 SELECT count(*) INTO n FROM gpt02_private.approvals;
 IF n<>1 THEN RAISE EXCEPTION 'SCOPE_INVALID_%',n; END IF;
 SELECT count(*) INTO n FROM gpt02_private.approvals WHERE task_id=172;
 IF n<>0 THEN RAISE EXCEPTION 'CROSS_TASK_ACCESS'; END IF;
 RAISE NOTICE 'PASS_READ_ONLY_ONE_TASK';
END $a$;
RESET ROLE;
REVOKE SELECT(task_id,company_id,command_id,attempt_id,claims)
 ON gpt02_private.approvals FROM synthetic_task_reader;
REVOKE USAGE ON SCHEMA gpt02_private FROM synthetic_task_reader;
SET ROLE synthetic_task_reader;
DO $a$ BEGIN
 BEGIN
   PERFORM task_id FROM gpt02_private.approvals LIMIT 1;
   RAISE EXCEPTION 'READ_STILL_ALLOWED_AFTER_REVOKE';
 EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS_READ_REVOKED_DENIED';
 END;
 IF has_any_column_privilege(current_user,'gpt02_private.approvals','SELECT')
 OR has_schema_privilege(current_user,'gpt02_private','USAGE')
 OR pg_has_role(current_user,'pg_read_all_data','USAGE') THEN
  RAISE EXCEPTION 'RESIDUAL_READER_PRIVILEGE';
 END IF;
 RAISE NOTICE 'PASS_NO_RESIDUAL_READER_PRIVILEGE';
END $a$;
RESET ROLE;
SELECT count(*) AS active_synthetic_sessions FROM pg_stat_activity
 WHERE usename='synthetic_task_reader';
"""

def call(args, stdin=None, check=True):
    r=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=45)
    if check and r.returncode: raise RuntimeError(r.stderr[-1400:])
    return r

def main():
    name="issue159-revoke-"+uuid.uuid4().hex[:10]
    try:
        call(["docker","run","--rm","-d","--network","none","--name",name,
              "-e","POSTGRES_PASSWORD=disposable_only","postgres:16-alpine"])
        for _ in range(100):
            if call(["docker","exec",name,"psql","-X","-U","postgres","-d","postgres",
                     "-Atc","SELECT 1"],check=False).returncode==0: break
            time.sleep(.25)
        else: raise RuntimeError("PG_START_NOT_READY")
        r=call(["docker","exec","-i",name,"psql","-X","-v","ON_ERROR_STOP=1",
                "-U","postgres","-d","postgres","-At"],stdin=SQL)
        for m in ("PASS_READ_ONLY_ONE_TASK","PASS_READ_REVOKED_DENIED",
                  "PASS_NO_RESIDUAL_READER_PRIVILEGE"):
            if m not in r.stderr:raise AssertionError("MISSING_"+m)
            print(m)
        if r.stdout.strip().splitlines()[-1]!="0":raise AssertionError("ACTIVE_SESSIONS_FOUND")
        print("PASS_NO_ACTIVE_SYNTHETIC_SESSIONS")
        print("SYNTHETIC_ONLY_NO_LIVE_ROLE_OR_CREDENTIAL_CHANGE")
    finally:
        call(["docker","rm","-f",name],check=False)

if __name__=="__main__": main()
