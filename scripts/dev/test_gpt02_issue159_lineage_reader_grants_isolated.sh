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
