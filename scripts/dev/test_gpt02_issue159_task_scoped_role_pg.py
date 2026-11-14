#!/usr/bin/env python3
"""Issue159 disposable role-scoped RLS test — NO LIVE APPLY / NO DEPLOY.

Builds two synthetic tasks in the same company in a network-isolated PG16
container. Demonstrates DB-enforced separation without SECURITY DEFINER or
mutable session GUCs. The per-task role/credential life cycle is NOT designed.
"""
import subprocess
import time
import uuid

SQL = r"""
CREATE SCHEMA gpt02_private;
CREATE ROLE issue159_task170_reader NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE TABLE gpt02_private.approvals (
  task_id integer, company_id text, command_id uuid, attempt_id uuid, claims jsonb
);
CREATE TABLE gpt02_private.receipts (
  task_id integer, company_id text, command_id uuid, receipt_id uuid
);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
INSERT INTO gpt02_private.approvals VALUES
(170,'default','00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000270','{"environment":"DEV"}'),
(172,'default','00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000272','{"environment":"DEV"}');
INSERT INTO gpt02_private.receipts VALUES
(170,'default','00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000370'),
(172,'default','00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000372');
CREATE POLICY exact_task ON gpt02_private.approvals FOR SELECT
 TO issue159_task170_reader USING (
  task_id=170 AND company_id='default'
  AND command_id='00000000-0000-0000-0000-000000000170'
  AND attempt_id='00000000-0000-0000-0000-000000000270'
  AND claims->>'environment'='DEV'
 );
CREATE POLICY exact_task ON gpt02_private.receipts FOR SELECT
 TO issue159_task170_reader USING (
  task_id=170 AND company_id='default'
  AND command_id='00000000-0000-0000-0000-000000000170'
 );
GRANT USAGE ON SCHEMA gpt02_private TO issue159_task170_reader;
GRANT SELECT(task_id,company_id,command_id,attempt_id,claims)
 ON gpt02_private.approvals TO issue159_task170_reader;
GRANT SELECT(task_id,company_id,command_id,receipt_id)
 ON gpt02_private.receipts TO issue159_task170_reader;
SET ROLE issue159_task170_reader;
DO $test$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM gpt02_private.approvals;
 IF n<>1 THEN RAISE EXCEPTION 'APPROVAL_SCOPING_FAILED:%',n; END IF;
 RAISE NOTICE 'PASS_ONE_VISIBLE_APPROVAL';
 SELECT count(*) INTO n FROM gpt02_private.receipts;
 IF n<>1 THEN RAISE EXCEPTION 'RECEIPT_SCOPING_FAILED:%',n; END IF;
 RAISE NOTICE 'PASS_ONE_VISIBLE_RECEIPT';
 SELECT count(*) INTO n FROM gpt02_private.approvals WHERE task_id=172;
 IF n<>0 THEN RAISE EXCEPTION 'CROSS_TASK_LEAK'; END IF;
 RAISE NOTICE 'PASS_SAME_COMPANY_TASK_172_DENIED';
 SELECT count(*) INTO n FROM gpt02_private.approvals a
 JOIN gpt02_private.receipts r ON r.command_id=a.command_id
 WHERE a.task_id=170 AND a.company_id='default';
 IF n<>1 THEN RAISE EXCEPTION 'JOIN_SHAPE_FAILED:%',n; END IF;
 RAISE NOTICE 'PASS_VALID_TASK_JOIN';
 IF has_table_privilege(current_user,'gpt02_private.approvals','INSERT')
  OR has_schema_privilege(current_user,'gpt02_private','CREATE')
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='gpt02_private' AND p.prosecdef
   AND has_function_privilege(current_user,p.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'EXCESS_PRIVILEGE'; END IF;
 RAISE NOTICE 'PASS_NO_WRITE_OR_PRIVILEGED_ROUTINE';
END $test$;
RESET ROLE;
"""

def call(*args, input=None, check=True):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=45)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-1500:] or "COMMAND_FAILED")
    return result

def main():
    name="gpt02-scope-"+uuid.uuid4().hex[:10]
    try:
        call("docker","run","--rm","-d","--network","none",
             "--name",name,"-e","POSTGRES_PASSWORD=fixture_only","postgres:16-alpine")
        for _ in range(90):
            if call("docker","exec",name,"pg_isready","-U","postgres","-d","postgres",check=False).returncode==0:
                break
            time.sleep(0.25)
        else: raise RuntimeError("PG_NOT_READY")
        result=call("docker","exec","-i",name,"psql","-X","-v","ON_ERROR_STOP=1",
                    "-U","postgres","-d","postgres",input=SQL)
        markers=(
            "PASS_ONE_VISIBLE_APPROVAL",
            "PASS_ONE_VISIBLE_RECEIPT",
            "PASS_SAME_COMPANY_TASK_172_DENIED",
            "PASS_VALID_TASK_JOIN",
            "PASS_NO_WRITE_OR_PRIVILEGED_ROUTINE",
        )
        for marker in markers:
            if marker not in result.stderr: raise AssertionError("MISSING_"+marker)
            print(marker)
        print("PASS_DISPOSABLE_SCOPE_ONLY_NOT_RELEASE_AUTHORIZATION")
    finally:
        call("docker","rm","-f",name,check=False)

if __name__=="__main__":
    main()
