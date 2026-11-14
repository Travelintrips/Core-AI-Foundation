#!/usr/bin/env python3
"""Disposable five-table Issue159 per-task RLS negative test; NEVER apply live.

Exercises actual five relation names and join lineage, with two synthetic
tasks from the same company. Does not issue DB credentials or dispatch.
"""
import subprocess
import time
import uuid

SQL = r"""
CREATE SCHEMA gpt02_private;
CREATE ROLE task170_reader NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE broader_reader NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE TABLE gpt02_private.approvals (
 task_id integer, company_id text, command_id uuid, attempt_id uuid,
 nonce text, digest text, claims jsonb);
CREATE TABLE gpt02_private.operator_links (
 hub_task_id integer, company_id text, command_id uuid, attempt_id uuid,
 link_id uuid, hub_execution_id uuid, core_task_id uuid, approval_digest text);
CREATE TABLE gpt02_private.receipts (
 id uuid, command_id uuid, nonce text, digest text);
CREATE TABLE gpt02_private.core_identity_receipts (
 receipt_id uuid, command_id uuid, link_id uuid, link_digest text,
 binding_verified boolean, may_dispatch_worker boolean, may_issue_grant boolean,
 may_close_job boolean, core_ledger_written boolean);
CREATE TABLE gpt02_private.post_consumption_fences (
 fence_id uuid, receipt_id uuid, command_id uuid, link_id uuid,
 hub_execution_id uuid, core_task_id uuid, attempt_id uuid,
 worker_id text, lease_epoch integer, lease_expires_at timestamptz,
 dispatch_allowed boolean, core_ledger_written boolean);
DO $block$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['approvals','operator_links','receipts',
 'core_identity_receipts','post_consumption_fences'] LOOP
 EXECUTE format('ALTER TABLE gpt02_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE gpt02_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('GRANT SELECT ON gpt02_private.%I TO task170_reader',t);
 END LOOP;
END $block$;
GRANT USAGE ON SCHEMA gpt02_private TO task170_reader;
INSERT INTO gpt02_private.approvals VALUES
(170,'default','00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000270','n170','d170','{"environment":"DEV"}'),
(172,'default','00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000272','n172','d172','{"environment":"DEV"}');
INSERT INTO gpt02_private.operator_links VALUES
(170,'default','00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000270',
 '00000000-0000-0000-0000-000000000370',
 '00000000-0000-0000-0000-000000000470',
 '00000000-0000-0000-0000-000000000570','d170'),
(172,'default','00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000272',
 '00000000-0000-0000-0000-000000000372',
 '00000000-0000-0000-0000-000000000472',
 '00000000-0000-0000-0000-000000000572','d172');
INSERT INTO gpt02_private.receipts VALUES
('00000000-0000-0000-0000-000000000670',
 '00000000-0000-0000-0000-000000000170','n170','d170'),
('00000000-0000-0000-0000-000000000672',
 '00000000-0000-0000-0000-000000000172','n172','d172');
INSERT INTO gpt02_private.core_identity_receipts VALUES
('00000000-0000-0000-0000-000000000670',
 '00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000370','link170',false,false,false,false,false),
('00000000-0000-0000-0000-000000000672',
 '00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000372','link172',false,false,false,false,false);
INSERT INTO gpt02_private.post_consumption_fences VALUES
('00000000-0000-0000-0000-000000000770',
 '00000000-0000-0000-0000-000000000670',
 '00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000370',
 '00000000-0000-0000-0000-000000000470',
 '00000000-0000-0000-0000-000000000570',
 '00000000-0000-0000-0000-000000000270',
 'openclaw-dell-chatgpt-wake-dev',1,now()+interval '10 minutes',false,false),
('00000000-0000-0000-0000-000000000772',
 '00000000-0000-0000-0000-000000000672',
 '00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000372',
 '00000000-0000-0000-0000-000000000472',
 '00000000-0000-0000-0000-000000000572',
 '00000000-0000-0000-0000-000000000272',
 'openclaw-dell-chatgpt-wake-dev',1,now()+interval '10 minutes',false,false);
CREATE POLICY task_scope ON gpt02_private.approvals FOR SELECT TO task170_reader
 USING (task_id=170 AND company_id='default'
 AND command_id='00000000-0000-0000-0000-000000000170'
 AND attempt_id='00000000-0000-0000-0000-000000000270'
 AND claims->>'environment'='DEV');
CREATE POLICY task_scope ON gpt02_private.operator_links FOR SELECT TO task170_reader
 USING (hub_task_id=170 AND company_id='default'
 AND command_id='00000000-0000-0000-0000-000000000170'
 AND attempt_id='00000000-0000-0000-0000-000000000270'
 AND link_id='00000000-0000-0000-0000-000000000370');
CREATE POLICY task_scope ON gpt02_private.receipts FOR SELECT TO task170_reader
 USING (command_id='00000000-0000-0000-0000-000000000170'
 AND id='00000000-0000-0000-0000-000000000670');
CREATE POLICY task_scope ON gpt02_private.core_identity_receipts FOR SELECT TO task170_reader
 USING (command_id='00000000-0000-0000-0000-000000000170'
 AND receipt_id='00000000-0000-0000-0000-000000000670'
 AND link_id='00000000-0000-0000-0000-000000000370'
 AND NOT binding_verified AND NOT may_dispatch_worker AND NOT may_issue_grant
 AND NOT may_close_job AND NOT core_ledger_written);
CREATE POLICY task_scope ON gpt02_private.post_consumption_fences FOR SELECT TO task170_reader
 USING (command_id='00000000-0000-0000-0000-000000000170'
 AND receipt_id='00000000-0000-0000-0000-000000000670'
 AND link_id='00000000-0000-0000-0000-000000000370'
 AND fence_id='00000000-0000-0000-0000-000000000770'
 AND worker_id='openclaw-dell-chatgpt-wake-dev'
 AND lease_epoch=1 AND lease_expires_at>statement_timestamp()
 AND NOT dispatch_allowed AND NOT core_ledger_written);
SET ROLE task170_reader;
DO $test$ DECLARE t text; n int; BEGIN
FOREACH t IN ARRAY ARRAY['approvals','operator_links','receipts',
 'core_identity_receipts','post_consumption_fences'] LOOP
 EXECUTE format('SELECT count(*) FROM gpt02_private.%I',t) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'VISIBILITY_%_%',t,n; END IF;
END LOOP;
RAISE NOTICE 'PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED';
SELECT count(*) INTO n FROM gpt02_private.approvals a
 JOIN gpt02_private.operator_links l ON l.command_id=a.command_id
  AND l.attempt_id=a.attempt_id AND l.hub_task_id=a.task_id
 JOIN gpt02_private.receipts r ON r.command_id=a.command_id
  AND r.nonce=a.nonce AND r.digest=a.digest
 JOIN gpt02_private.core_identity_receipts i ON i.receipt_id=r.id
  AND i.command_id=a.command_id AND i.link_id=l.link_id
 JOIN gpt02_private.post_consumption_fences f ON f.receipt_id=r.id
  AND f.command_id=a.command_id AND f.link_id=l.link_id
  AND f.hub_execution_id=l.hub_execution_id
  AND f.core_task_id=l.core_task_id AND f.attempt_id=l.attempt_id
 WHERE a.task_id=170;
IF n<>1 THEN RAISE EXCEPTION 'EXACT_JOIN_%',n; END IF;
RAISE NOTICE 'PASS_EXACT_FIVE_TABLE_JOIN';
SELECT count(*) INTO n FROM gpt02_private.approvals WHERE task_id=172;
IF n<>0 THEN RAISE EXCEPTION 'SAME_COMPANY_CROSS_TASK_LEAK'; END IF;
RAISE NOTICE 'PASS_SAME_COMPANY_OTHER_TASK_DENIED';
IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
 WHERE r.rolname=current_user) THEN RAISE EXCEPTION 'UNEXPECTED_ROLE_MEMBERSHIP'; END IF;
IF has_table_privilege(current_user,'gpt02_private.approvals','INSERT')
 OR has_schema_privilege(current_user,'gpt02_private','CREATE')
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='gpt02_private' AND p.prosecdef
 AND has_function_privilege(current_user,p.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'PRIVILEGE_LEAK'; END IF;
RAISE NOTICE 'PASS_NO_MEMBERSHIP_WRITES_OR_PRIVILEGED_ROUTINE';
END $test$;
RESET ROLE;
"""
def run(args, input=None, check=True):
    result=subprocess.run(args,input=input,text=True,capture_output=True,timeout=60)
    if check and result.returncode: raise RuntimeError(result.stderr[-1800:])
    return result

def main():
    name="issue159-five-"+uuid.uuid4().hex[:10]
    try:
        run(["docker","run","--rm","-d","--network","none","--name",name,
             "-e","POSTGRES_PASSWORD=fixture_only","postgres:16-alpine"])
        for _ in range(100):
            if run(["docker","exec",name,"psql","-X","-U","postgres","-d","postgres",
                "-Atc","SELECT 1"],check=False).returncode==0:break
            time.sleep(.25)
        else: raise RuntimeError("PG_SQL_NOT_READY")
        r=run(["docker","exec","-i",name,"psql","-X","-v","ON_ERROR_STOP=1",
               "-U","postgres","-d","postgres"],input=SQL)
        for marker in (
            "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED",
            "PASS_EXACT_FIVE_TABLE_JOIN",
            "PASS_SAME_COMPANY_OTHER_TASK_DENIED",
            "PASS_NO_MEMBERSHIP_WRITES_OR_PRIVILEGED_ROUTINE",
        ):
            if marker not in r.stderr: raise AssertionError("MISSING_"+marker)
            print(marker)
        print("PASS_SYNTHETIC_ONLY_NOT_LIVE_RELEASE")
    finally:
        run(["docker","rm","-f",name],check=False)
if __name__=="__main__":
    main()
