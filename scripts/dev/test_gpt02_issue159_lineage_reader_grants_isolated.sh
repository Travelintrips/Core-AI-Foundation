#!/usr/bin/env bash
# Disposable only; never connects to CST-DEV or PROD.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="gpt02-lineage-grants-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --rm --network none --name "$name" \
  -e POSTGRES_PASSWORD=fixture-only postgres:16-alpine >/dev/null
for i in $(seq 1 40); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
CREATE ROLE gpt02_store_owner NOLOGIN;
CREATE SCHEMA gpt02_private;
CREATE TABLE gpt02_private.approvals (
 task_id integer, company_id text, attempt_id uuid, command_id uuid,
 digest text, nonce text, expires_at timestamptz, claims jsonb
);
CREATE TABLE gpt02_private.operator_links (
 link_id uuid, command_id uuid, attempt_id uuid, company_id text,
 hub_task_id integer, approval_digest text, hub_execution_id uuid,
 core_task_id uuid, link_digest text, expires_at timestamptz,
 attempt_number integer, claims jsonb
);
CREATE TABLE gpt02_private.receipts (
 id uuid,command_id uuid,nonce text,digest text,consumed_at timestamptz
);
CREATE TABLE gpt02_private.core_identity_receipts (
 receipt_id uuid,command_id uuid,link_id uuid,link_digest text,
 binding_verified boolean,may_dispatch_worker boolean,
 may_issue_grant boolean,may_close_job boolean,core_ledger_written boolean
);
CREATE TABLE gpt02_private.post_consumption_fences (
 fence_id uuid,receipt_id uuid,command_id uuid,link_id uuid,attempt_id uuid,
 hub_execution_id uuid,core_task_id uuid,worker_id text,lease_epoch bigint,
 lease_started_at timestamptz,lease_expires_at timestamptz,
 dispatch_allowed boolean,core_ledger_written boolean
);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.operator_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.operator_links FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.core_identity_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.core_identity_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.post_consumption_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.post_consumption_fences FORCE ROW LEVEL SECURITY;
ALTER SCHEMA gpt02_private OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.approvals OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.operator_links OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.receipts OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.core_identity_receipts OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.post_consumption_fences OWNER TO gpt02_store_owner;
SQL
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null \
  < "$root/scripts/dev/gpt02_issue159_lineage_reader_nologin_grants.sql"
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
DO $$
DECLARE r record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_lineage_reader'
  AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolsuper)
 THEN RAISE EXCEPTION 'NOLOGIN_ROLE_CHECK_FAILED'; END IF;
 FOR r IN
  SELECT c.relname,c.oid FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='gpt02_private' AND c.relkind='r'
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=r.oid
     AND relrowsecurity AND relforcerowsecurity)
  THEN RAISE EXCEPTION 'FORCE_RLS_FAILED: %',r.relname; END IF;
  IF has_table_privilege('dev_gpt02_lineage_reader',r.oid,'INSERT')
  OR has_table_privilege('dev_gpt02_lineage_reader',r.oid,'UPDATE')
  OR has_table_privilege('dev_gpt02_lineage_reader',r.oid,'DELETE')
  OR has_table_privilege('dev_gpt02_lineage_reader',r.oid,'TRUNCATE')
  THEN RAISE EXCEPTION 'WRITE_GRANT_FOUND: %',r.relname; END IF;
  IF NOT has_column_privilege('dev_gpt02_lineage_reader',r.oid,
     (SELECT column_name FROM information_schema.columns
      WHERE table_schema='gpt02_private' AND table_name=r.relname
      ORDER BY ordinal_position LIMIT 1),'SELECT')
  THEN RAISE EXCEPTION 'EXPECTED_COLUMN_SELECT_MISSING: %',r.relname; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='gpt02_private'
  AND policyname='dev_gpt02_lineage_reader_select' AND cmd='SELECT')<>5
 THEN RAISE EXCEPTION 'FIVE_POLICIES_REQUIRED'; END IF;
END $$;
SELECT 'ISOLATED_LINEAGE_READER_PRIVILEGE_PASS' AS result;
SQL

# Execute the actual five-ledger JOIN under the restricted reader identity.
# Catalog GRANT checks alone cannot prove the query is executable under RLS.
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
BEGIN READ ONLY;
SET LOCAL ROLE dev_gpt02_lineage_reader;
SELECT count(*) AS empty_lineage_matches
FROM gpt02_private.approvals AS a
JOIN gpt02_private.operator_links AS l
  ON l.command_id = a.command_id AND l.attempt_id = a.attempt_id
 AND l.company_id = a.company_id AND l.hub_task_id = a.task_id
 AND l.approval_digest = a.digest
JOIN gpt02_private.receipts AS r
  ON r.command_id = a.command_id AND r.nonce = a.nonce
 AND r.digest = a.digest
JOIN gpt02_private.core_identity_receipts AS i
  ON i.receipt_id = r.id AND i.command_id = r.command_id
 AND i.link_id = l.link_id AND i.link_digest = l.link_digest
JOIN gpt02_private.post_consumption_fences AS f
  ON f.receipt_id = r.id AND f.command_id = a.command_id
 AND f.link_id = l.link_id AND f.attempt_id = a.attempt_id
 AND f.hub_execution_id = l.hub_execution_id
 AND f.core_task_id = l.core_task_id
WHERE a.company_id='default' AND a.task_id=140
  AND a.command_id='10000000-0000-4000-8000-000000000001'::uuid
  AND a.attempt_id='20000000-0000-4000-8000-000000000002'::uuid
  AND a.digest=repeat('a',64);
ROLLBACK;
SQL

# Nonempty, synthetic-only fixture: validate real FORCE RLS visibility.
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
INSERT INTO gpt02_private.approvals
 (task_id,company_id,attempt_id,command_id,digest,nonce,expires_at,claims)
VALUES
 (140,'default','20000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000001',repeat('a',64),repeat('N',40),
 now()+interval '2 minutes','{"environment":"DEV"}'::jsonb),
 (141,'default','20000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000002',repeat('b',64),repeat('N',40),
 now()+interval '2 minutes','{"environment":"PROD"}'::jsonb);
INSERT INTO gpt02_private.operator_links
 (link_id,command_id,attempt_id,company_id,hub_task_id,approval_digest,
 hub_execution_id,core_task_id,link_digest,expires_at,attempt_number,claims)
VALUES
 ('30000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000002','default',140,
 repeat('a',64),'40000000-0000-4000-8000-000000000004',
 '50000000-0000-4000-8000-000000000005',repeat('c',64),
 now()+interval '90 seconds',1,'{"environment":"DEV"}'::jsonb),
 ('30000000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000002',
 '20000000-0000-4000-8000-000000000003','default',141,
 repeat('b',64),'40000000-0000-4000-8000-000000000005',
 '50000000-0000-4000-8000-000000000006',repeat('d',64),
 now()+interval '90 seconds',1,'{"environment":"PROD"}'::jsonb);
INSERT INTO gpt02_private.receipts
 (id,command_id,nonce,digest,consumed_at)
VALUES
 ('60000000-0000-4000-8000-000000000006',
 '10000000-0000-4000-8000-000000000001',repeat('N',40),repeat('a',64),now()),
 ('60000000-0000-4000-8000-000000000007',
 '10000000-0000-4000-8000-000000000002',repeat('N',40),repeat('b',64),now());
INSERT INTO gpt02_private.core_identity_receipts
 (receipt_id,command_id,link_id,link_digest,binding_verified,
 may_dispatch_worker,may_issue_grant,may_close_job,core_ledger_written)
VALUES
 ('60000000-0000-4000-8000-000000000006',
 '10000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000003',repeat('c',64),false,false,false,false,false),
 ('60000000-0000-4000-8000-000000000007',
 '10000000-0000-4000-8000-000000000002',
 '30000000-0000-4000-8000-000000000004',repeat('d',64),false,false,false,false,false);
INSERT INTO gpt02_private.post_consumption_fences
 (fence_id,receipt_id,command_id,link_id,attempt_id,hub_execution_id,
 core_task_id,worker_id,lease_epoch,lease_started_at,lease_expires_at,
 dispatch_allowed,core_ledger_written)
VALUES
 ('70000000-0000-4000-8000-000000000007',
 '60000000-0000-4000-8000-000000000006',
 '10000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000003',
 '20000000-0000-4000-8000-000000000002',
 '40000000-0000-4000-8000-000000000004',
 '50000000-0000-4000-8000-000000000005',
 'openclaw-dell-chatgpt-wake-dev',1,now(),now()+interval '10 seconds',false,false),
 ('70000000-0000-4000-8000-000000000008',
 '60000000-0000-4000-8000-000000000007',
 '10000000-0000-4000-8000-000000000002',
 '30000000-0000-4000-8000-000000000004',
 '20000000-0000-4000-8000-000000000003',
 '40000000-0000-4000-8000-000000000005',
 '50000000-0000-4000-8000-000000000006',
 'openclaw-dell-chatgpt-wake-dev',1,now(),now()+interval '10 seconds',false,false);
SQL
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
BEGIN READ ONLY;
SET LOCAL ROLE dev_gpt02_lineage_reader;
DO $$
DECLARE v_allowed integer; v_denied integer;
BEGIN
 SELECT count(*) INTO v_allowed
 FROM gpt02_private.approvals a
 JOIN gpt02_private.operator_links l
  ON l.command_id=a.command_id AND l.attempt_id=a.attempt_id
  AND l.company_id=a.company_id AND l.hub_task_id=a.task_id
  AND l.approval_digest=a.digest
 JOIN gpt02_private.receipts r
  ON r.command_id=a.command_id AND r.nonce=a.nonce AND r.digest=a.digest
 JOIN gpt02_private.core_identity_receipts i
  ON i.receipt_id=r.id AND i.command_id=r.command_id
  AND i.link_id=l.link_id AND i.link_digest=l.link_digest
 JOIN gpt02_private.post_consumption_fences f
  ON f.receipt_id=r.id AND f.command_id=a.command_id
  AND f.link_id=l.link_id AND f.attempt_id=a.attempt_id
  AND f.hub_execution_id=l.hub_execution_id AND f.core_task_id=l.core_task_id
 WHERE a.company_id='default' AND a.task_id=140
   AND a.command_id='10000000-0000-4000-8000-000000000001'::uuid;
 SELECT count(*) INTO v_denied FROM gpt02_private.approvals
 WHERE task_id=141;
 IF v_allowed<>1 OR v_denied<>0 THEN
   RAISE EXCEPTION 'RLS_NONEMPTY_VISIBILITY_FAILED valid=% invalid=%',v_allowed,v_denied;
 END IF;
END $$;
ROLLBACK;
SELECT 'POPULATED_READER_RLS_PASS' AS result;
SQL
