#!/usr/bin/env python3
"""Disposable PostgreSQL 16 negative test for a task-bound read capability.

This is a DESIGN FEASIBILITY TEST ONLY. It must never create credentials,
activate the live reader or be construed as a reviewed migration.
A security-definer function is incompatible with the EXISTING reader's
no_privileged_routines guard and cannot be installed without separate review.
"""
from __future__ import annotations

import subprocess
import time
import uuid


def run(*args: str, sql: str | None = None, check: bool = True):
    return subprocess.run(args, input=sql, text=True, capture_output=True,
                          check=check, timeout=60)


def main() -> None:
    name = "gpt02-capability-" + uuid.uuid4().hex[:12]
    # No live databases, sockets, DSN or user data. Network isolated.
    statements = r"""
CREATE SCHEMA gpt02_private;
CREATE ROLE capability_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE reader_test NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE TABLE gpt02_private.approvals (
  task_id integer NOT NULL,
  company_id text NOT NULL,
  command_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL,
  environment text NOT NULL,
  dispatch_allowed boolean NOT NULL DEFAULT false
);
CREATE TABLE gpt02_private.reader_capabilities (
  token_sha256 text PRIMARY KEY,
  task_id integer NOT NULL,
  company_id text NOT NULL,
  command_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE gpt02_private.approvals OWNER TO capability_owner;
ALTER TABLE gpt02_private.reader_capabilities OWNER TO capability_owner;
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.reader_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.reader_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY owned_approval ON gpt02_private.approvals
  FOR SELECT TO capability_owner USING (true);
CREATE POLICY owned_capability ON gpt02_private.reader_capabilities
  FOR SELECT TO capability_owner USING (true);
INSERT INTO gpt02_private.approvals VALUES
 (170,'default','00000000-0000-0000-0000-000000000170',
   '00000000-0000-0000-0000-000000000270','DEV',false),
 (172,'default','00000000-0000-0000-0000-000000000172',
   '00000000-0000-0000-0000-000000000272','DEV',false),
 (173,'other','00000000-0000-0000-0000-000000000173',
   '00000000-0000-0000-0000-000000000273','DEV',false);
INSERT INTO gpt02_private.reader_capabilities VALUES
 (encode(sha256(convert_to('synthetic-private-capability-for-task-170','UTF8')),'hex'),
 170,'default','00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000270',now()+interval '10 minutes'),
 (encode(sha256(convert_to('synthetic-expired-capability','UTF8')),'hex'),
 172,'default','00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000272',now()-interval '1 minute');
-- Only exact tuple + independent server-issued capability can be read.
-- SECURITY DEFINER illustrates the *alternative* architecture and is
-- purposefully NOT compatible with current reader identity rules.
CREATE FUNCTION gpt02_private.read_bounded_lineage(
 p_token text,p_task integer,p_company text,p_command uuid,p_attempt uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog AS $function$
 SELECT jsonb_build_object('taskId',a.task_id,'commandId',a.command_id)
 FROM gpt02_private.reader_capabilities c
 JOIN gpt02_private.approvals a
   ON a.task_id=c.task_id AND a.company_id=c.company_id
  AND a.command_id=c.command_id AND a.attempt_id=c.attempt_id
 WHERE c.token_sha256=encode(sha256(convert_to(p_token,'UTF8')),'hex')
  AND c.task_id=p_task AND c.company_id=p_company
  AND c.command_id=p_command AND c.attempt_id=p_attempt
  AND c.expires_at>statement_timestamp()
  AND a.environment='DEV' AND NOT a.dispatch_allowed
  AND a.company_id='default'
 $function$;
ALTER FUNCTION gpt02_private.read_bounded_lineage(text,integer,text,uuid,uuid)
 OWNER TO capability_owner;
REVOKE ALL ON FUNCTION gpt02_private.read_bounded_lineage(text,integer,text,uuid,uuid)
 FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_private TO reader_test;
GRANT EXECUTE ON FUNCTION gpt02_private.read_bounded_lineage(text,integer,text,uuid,uuid)
 TO reader_test;
SET ROLE reader_test;
DO $assert$
DECLARE result jsonb;
BEGIN
 IF has_table_privilege(current_user,'gpt02_private.approvals','SELECT')
    OR has_table_privilege(current_user,'gpt02_private.reader_capabilities','SELECT')
    OR has_table_privilege(current_user,'gpt02_private.approvals','UPDATE')
    OR has_schema_privilege(current_user,'gpt02_private','CREATE') THEN
   RAISE EXCEPTION 'DIRECT_TABLE_OR_WRITE_RIGHTS_EXPOSED';
 END IF;
 RAISE NOTICE 'PASS_NO_DIRECT_TABLE_ACCESS';
 SELECT gpt02_private.read_bounded_lineage(
 'synthetic-private-capability-for-task-170',170,'default',
 '00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000270') INTO result;
 IF result->>'taskId'<>'170' THEN RAISE EXCEPTION 'LEGITIMATE_LINEAGE_FAILED'; END IF;
 RAISE NOTICE 'PASS_EXACT_TASK_170';
 SELECT gpt02_private.read_bounded_lineage(
 'synthetic-private-capability-for-task-170',172,'default',
 '00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000272') INTO result;
 IF result IS NOT NULL THEN RAISE EXCEPTION 'SAME_TENANT_CROSS_TASK_LEAK'; END IF;
 RAISE NOTICE 'PASS_SAME_TENANT_TASK_172_DENIED';
 SELECT gpt02_private.read_bounded_lineage(
 'synthetic-private-capability-for-task-170',173,'other',
 '00000000-0000-0000-0000-000000000173',
 '00000000-0000-0000-0000-000000000273') INTO result;
 IF result IS NOT NULL THEN RAISE EXCEPTION 'OTHER_TENANT_LEAK'; END IF;
 RAISE NOTICE 'PASS_OTHER_TENANT_DENIED';
 SELECT gpt02_private.read_bounded_lineage(
 'wrong-token',170,'default',
 '00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000270') INTO result;
 IF result IS NOT NULL THEN RAISE EXCEPTION 'FORGED_TOKEN_ACCEPTED'; END IF;
 RAISE NOTICE 'PASS_FORGED_TOKEN_DENIED';
 SELECT gpt02_private.read_bounded_lineage(
 'synthetic-expired-capability',172,'default',
 '00000000-0000-0000-0000-000000000172',
 '00000000-0000-0000-0000-000000000272') INTO result;
 IF result IS NOT NULL THEN RAISE EXCEPTION 'EXPIRED_CAPABILITY_ACCEPTED'; END IF;
 RAISE NOTICE 'PASS_EXPIRED_TOKEN_DENIED';
 SELECT gpt02_private.read_bounded_lineage(
 'synthetic-private-capability-for-task-170',170,'default',
 '00000000-0000-0000-0000-000000000170',
 '00000000-0000-0000-0000-000000000272') INTO result;
 IF result IS NOT NULL THEN RAISE EXCEPTION 'WRONG_ATTEMPT_ACCEPTED'; END IF;
 RAISE NOTICE 'PASS_WRONG_ATTEMPT_DENIED';
END $assert$;
RESET ROLE;
DO $assert$
BEGIN
 IF has_function_privilege('PUBLIC',
 'gpt02_private.read_bounded_lineage(text,integer,text,uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'PUBLIC_EXECUTE_LEAK';
 END IF;
 RAISE NOTICE 'PASS_PUBLIC_EXECUTE_DENIED';
END $assert$;
"""
    try:
        run("docker", "run", "--rm", "-d", "--network", "none", "--name", name,
            "-e", "POSTGRES_PASSWORD=synthetic_disposable",
            "postgres:16-alpine")
        for _ in range(100):
            check = run("docker", "exec", name, "pg_isready",
                        "-U", "postgres", "-d", "postgres", check=False)
            if check.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("DISPOSABLE_PG_NOT_READY")
        output = run("docker", "exec", "-i", name, "psql", "-X",
                     "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
                     sql=statements)
        markers = [
            "PASS_NO_DIRECT_TABLE_ACCESS", "PASS_EXACT_TASK_170",
            "PASS_SAME_TENANT_TASK_172_DENIED", "PASS_OTHER_TENANT_DENIED",
            "PASS_FORGED_TOKEN_DENIED", "PASS_EXPIRED_TOKEN_DENIED",
            "PASS_WRONG_ATTEMPT_DENIED", "PASS_PUBLIC_EXECUTE_DENIED",
        ]
        for marker in markers:
            if marker not in output.stderr:
                raise AssertionError("MISSING_TEST_MARKER:" + marker)
            print(marker)
        print("PROTOTYPE_ONLY: CURRENT_READER_IDENTITY_GATE_INCOMPATIBLE")
    finally:
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
