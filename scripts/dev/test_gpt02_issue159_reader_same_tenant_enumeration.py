#!/usr/bin/env python3
"""Disposable, network-isolated regression witness for Issue159 reader RLS leakage.

NO APPLY / NO LIVE DEV: deliberately demonstrates why column-level SELECT plus
company-scoped RLS cannot enforce a single task/command lineage. The test
PASSES only if the undesirable cross-task visibility is reproduced, so it must
never be interpreted as release approval.
"""
from __future__ import annotations

import subprocess
import time
import uuid


def sh(*args: str, input_sql: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, input=input_sql, text=True,
                          capture_output=True, check=True, timeout=60)


def main() -> None:
    name = "gpt02-rls-audit-" + uuid.uuid4().hex[:12]
    sql = r"""
CREATE SCHEMA gpt02_private;
CREATE ROLE issuer_reader_test NOLOGIN NOINHERIT;
CREATE TABLE gpt02_private.approvals (
  task_id integer, company_id text, command_id uuid,
  nonce text, digest text, claims jsonb
);
CREATE TABLE gpt02_private.receipts (
  id uuid, command_id uuid, nonce text, digest text
);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
-- Models the existing issuer-reader approval policy's company/task/DEV scope.
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.approvals
  FOR SELECT TO issuer_reader_test USING (
    company_id='default' AND task_id>136 AND claims->>'environment'='DEV'
  );
-- Models the proposed "tightened" correlated receipt policy (not live).
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.receipts
  FOR SELECT TO issuer_reader_test USING (EXISTS (
    SELECT 1 FROM gpt02_private.approvals a
    WHERE a.command_id=receipts.command_id
      AND a.nonce=receipts.nonce AND a.digest=receipts.digest
  ));
GRANT USAGE ON SCHEMA gpt02_private TO issuer_reader_test;
GRANT SELECT(task_id,company_id,command_id,nonce,digest,claims)
  ON gpt02_private.approvals TO issuer_reader_test;
GRANT SELECT(id,command_id,nonce,digest)
  ON gpt02_private.receipts TO issuer_reader_test;
INSERT INTO gpt02_private.approvals VALUES
 (170,'default','00000000-0000-0000-0000-000000000170','n170','d170','{"environment":"DEV"}'),
 (172,'default','00000000-0000-0000-0000-000000000172','n172','d172','{"environment":"DEV"}'),
 (173,'other','00000000-0000-0000-0000-000000000173','n173','d173','{"environment":"DEV"}');
INSERT INTO gpt02_private.receipts VALUES
 ('00000000-0000-0000-0000-000000000270','00000000-0000-0000-0000-000000000170','n170','d170'),
 ('00000000-0000-0000-0000-000000000272','00000000-0000-0000-0000-000000000172','n172','d172'),
 ('00000000-0000-0000-0000-000000000273','00000000-0000-0000-0000-000000000173','n173','d173');
SET ROLE issuer_reader_test;
DO $test$
DECLARE a integer; r integer; tasks text;
BEGIN
 SELECT count(*),string_agg(task_id::text,',' ORDER BY task_id)
   INTO a,tasks FROM gpt02_private.approvals;
 SELECT count(*) INTO r FROM gpt02_private.receipts;
 IF a<>2 OR r<>2 OR tasks<>'170,172' THEN
   RAISE EXCEPTION 'WITNESS_EXPECTATION_FAILED approvals=% receipts=% tasks=%',a,r,tasks;
 END IF;
 IF has_table_privilege(current_user,'gpt02_private.receipts','INSERT')
   OR has_schema_privilege(current_user,'gpt02_private','CREATE') THEN
   RAISE EXCEPTION 'UNEXPECTED_WRITE_AUTHORITY';
 END IF;
 RAISE NOTICE 'PASS_DETECTED_SAME_TENANT_CROSS_TASK_VISIBILITY approvals=% receipts=% tasks=%',a,r,tasks;
END $test$;
RESET ROLE;
"""
    try:
        sh("docker", "run", "--rm", "-d", "--network", "none",
           "--name", name, "-e", "POSTGRES_PASSWORD=synthetic_disposable",
           "postgres:16-alpine")
        for _ in range(100):
            status = subprocess.run(["docker", "exec", name, "pg_isready",
                                     "-U", "postgres", "-d", "postgres"],
                                    capture_output=True, timeout=5)
            if status.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("DISPOSABLE_PG_NOT_READY")
        result = sh("docker", "exec", "-i", name, "psql", "-X",
                    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
                    input_sql=sql)
        if "PASS_DETECTED_SAME_TENANT_CROSS_TASK_VISIBILITY" not in result.stderr:
            raise AssertionError("WITNESS_MARKER_MISSING")
        print("PASS_DETECTED_SAME_TENANT_CROSS_TASK_VISIBILITY")
        print("RELEASE_NO_GO: this test proves an unsafe scope, not a safe implementation")
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=20)


if __name__ == "__main__":
    main()
