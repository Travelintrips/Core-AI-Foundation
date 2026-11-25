-- CST-DEV ONLY: project xssrfshdrtdfupgqwfdw, GPT02-1782.
-- PHASE B: run only through EXISTING legitimate table-owner custody.
-- Phase A must already have staged the exact independent NOLOGIN role.
-- This file does not create/alter a role, grant role membership, enable LOGIN,
-- change an owner, obtain SET privileges, or touch Task190 grants/policies.
-- FORCE RLS applies to this NOLOGIN/NOBYPASS owner: preflight reads catalogs,
-- NOT Owner decision rows. Do not bypass RLS to make this migration run.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = pg_catalog;

DO $owner_guard$
DECLARE reader_oid oid;
BEGIN
  IF current_user <> 'gpt02_relock_owner_approval_owner'
     OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'GPT02_1782_EXISTING_OWNER_CUSTODIAN_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname = 'gpt02_owner_approval'
      AND n.nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_EXISTING_SCHEMA_OWNER_REQUIRED';
  END IF;
  IF (
    SELECT count(*) FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'gpt02_owner_approval'
      AND c.relname IN ('gpt02_relock_owner_approval_challenges', 'gpt02_relock_owner_approval_decisions')
      AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
      AND c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
  ) <> 2 THEN
    RAISE EXCEPTION 'GPT02_1782_EXISTING_FORCE_RLS_OWNER_REQUIRED';
  END IF;
  SELECT oid INTO STRICT reader_oid FROM pg_catalog.pg_roles
    WHERE rolname = 'gpt02_owner_ledger_reader_1782_dev'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
      AND rolconnlimit = 1 AND rolvaliduntil < now();
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = reader_oid) THEN
    RAISE EXCEPTION 'GPT02_1782_READER_MUST_HAVE_NO_PARENT_ROLE';
  END IF;
  -- PUBLIC or pre-existing policies for the new role could broaden access.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid IN (
      'gpt02_owner_approval.gpt02_relock_owner_approval_challenges'::regclass,
      'gpt02_owner_approval.gpt02_relock_owner_approval_decisions'::regclass
    ) AND ((p.polcmd IN ('r', '*') AND 0::oid = ANY(p.polroles))
           OR reader_oid = ANY(p.polroles))
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_EXISTING_READER_POLICY_REQUIRES_REVIEW';
  END IF;
END;
$owner_guard$;

GRANT USAGE ON SCHEMA gpt02_owner_approval TO gpt02_owner_ledger_reader_1782_dev;
GRANT SELECT (
  id, status, manifest_sha256, manifest_json, consumed_at, expires_at,
  scope, environment, project_id, worker_principal, owner_email,
  owner_auth_supabase_id, owner_subject, issued_at
) ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  TO gpt02_owner_ledger_reader_1782_dev;
GRANT SELECT (
  challenge_id, decision, decided_at, approval_method, owner_email,
  owner_auth_supabase_id, owner_subject, scope, worker_principal, manifest_sha256
) ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions
  TO gpt02_owner_ledger_reader_1782_dev;

CREATE POLICY gpt02_1782_reader_original_challenge_select
  ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  FOR SELECT TO gpt02_owner_ledger_reader_1782_dev
  USING (
    id = '9c4f21e1-48af-4f7f-9830-931b84e3e846'::uuid
    AND scope = 'GPT02_RELOCK_CST_DEV'
    AND environment = 'DEV'
    AND project_id = 'xssrfshdrtdfupgqwfdw'
    AND worker_principal = 'openclaw-vps-main'
    AND lower(owner_email) = 'admcst001@gmail.com'
    AND status = 'CONSUMED'
  );

CREATE POLICY gpt02_1782_reader_original_decision_select
  ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions
  FOR SELECT TO gpt02_owner_ledger_reader_1782_dev
  USING (
    challenge_id = '9c4f21e1-48af-4f7f-9830-931b84e3e846'::uuid
    AND scope = 'GPT02_RELOCK_CST_DEV'
    AND worker_principal = 'openclaw-vps-main'
    AND lower(owner_email) = 'admcst001@gmail.com'
    AND decision = 'APPROVED'
    -- Decisions have no environment/project columns. Bind to the original
    -- challenge under its own exact DEV/project/Owner SELECT policy.
    AND EXISTS (
      SELECT 1 FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges AS c
      WHERE c.id = gpt02_relock_owner_approval_decisions.challenge_id
        AND c.environment = 'DEV' AND c.project_id = 'xssrfshdrtdfupgqwfdw'
    )
  );

DO $verify$
DECLARE
  reader_oid oid;
  relation_oid oid;
  relation_name text;
  expected_columns text[];
  actual_columns text[];
BEGIN
  SELECT oid INTO STRICT reader_oid FROM pg_catalog.pg_roles
    WHERE rolname = 'gpt02_owner_ledger_reader_1782_dev'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
      AND rolconnlimit = 1 AND rolvaliduntil < now();
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = reader_oid) THEN
    RAISE EXCEPTION 'GPT02_1782_READER_MUST_HAVE_NO_PARENT_ROLE';
  END IF;
  IF pg_catalog.has_schema_privilege(reader_oid, 'gpt02_owner_approval', 'CREATE')
     OR NOT pg_catalog.has_schema_privilege(reader_oid, 'gpt02_owner_approval', 'USAGE') THEN
    RAISE EXCEPTION 'GPT02_1782_READER_SCHEMA_PRIVILEGES_INVALID';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY[
    'gpt02_relock_owner_approval_challenges', 'gpt02_relock_owner_approval_decisions'
  ] LOOP
    relation_oid := pg_catalog.to_regclass('gpt02_owner_approval.' || relation_name);
    IF pg_catalog.has_table_privilege(reader_oid, relation_oid, 'SELECT')
       OR pg_catalog.has_table_privilege(reader_oid, relation_oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_any_column_privilege(reader_oid, relation_oid, 'INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'GPT02_1782_READER_TABLE_PRIVILEGES_TOO_BROAD';
    END IF;
    expected_columns := CASE relation_name
      WHEN 'gpt02_relock_owner_approval_challenges' THEN ARRAY[
        'id','status','manifest_sha256','manifest_json','consumed_at','expires_at',
        'scope','environment','project_id','worker_principal','owner_email',
        'owner_auth_supabase_id','owner_subject','issued_at'
      ]
      ELSE ARRAY[
        'challenge_id','decision','decided_at','approval_method','owner_email',
        'owner_auth_supabase_id','owner_subject','scope','worker_principal','manifest_sha256'
      ] END;
    SELECT array_agg(a.attname::text ORDER BY a.attname::text) INTO actual_columns
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = relation_oid AND a.attnum > 0 AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege(reader_oid, relation_oid, a.attnum, 'SELECT');
    IF actual_columns IS DISTINCT FROM (
      SELECT array_agg(name ORDER BY name) FROM unnest(expected_columns) AS allowed_columns(name)
    ) THEN
      RAISE EXCEPTION 'GPT02_1782_READER_COLUMN_PRIVILEGES_INVALID';
    END IF;
  END LOOP;
END;
$verify$;
COMMIT;
