-- REVIEW ONLY. This is a NEW proposed Owner security scope, not Phase B authority.
-- Do not execute against CST DEV without explicit approval of this complete artifact,
-- its immutable Phase B source, target connection, fresh baseline and rollback plan.
-- No connection URL or credentials belong in this file.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SET LOCAL idle_in_transaction_session_timeout = '10s';
SET LOCAL transaction_timeout = '30s';
SET LOCAL search_path = pg_catalog;

DO $delegation_preflight$
DECLARE
  actor_oid oid;
  owner_oid oid;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR session_user <> 'postgres' OR current_user <> 'postgres'
     OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'GPT02_1782_DIRECT_PG17_POSTGRES_SESSION_REQUIRED';
  END IF;
  SELECT oid INTO STRICT actor_oid FROM pg_catalog.pg_roles
    WHERE rolname = 'postgres' AND NOT rolsuper AND rolcanlogin;
  SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles
    WHERE rolname = 'gpt02_relock_owner_approval_owner'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(1782, 20261125) THEN
    RAISE EXCEPTION 'GPT02_1782_DELEGATION_ALREADY_IN_PROGRESS';
  END IF;
  IF pg_catalog.pg_has_role(actor_oid, owner_oid, 'SET')
     OR pg_catalog.pg_has_role(actor_oid, owner_oid, 'USAGE')
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members
         WHERE roleid = owner_oid AND member = actor_oid) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members AS m
       JOIN pg_catalog.pg_roles AS g ON g.oid = m.grantor
       WHERE m.roleid = owner_oid AND m.member = actor_oid
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
         AND m.grantor <> actor_oid AND g.rolsuper
     ) THEN
    RAISE EXCEPTION 'GPT02_1782_ADMIN_ONLY_BASELINE_REQUIRED';
  END IF;
END;
$delegation_preflight$;

-- Record every membership field, including the original row OID and grantor.
CREATE TEMP TABLE gpt02_1782_membership_before ON COMMIT DROP AS
  SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
  FROM pg_catalog.pg_auth_members;
CREATE TEMP TABLE gpt02_1782_role_attributes_before ON COMMIT DROP AS
  SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
         rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
  FROM pg_catalog.pg_roles;
CREATE TEMP TABLE gpt02_1782_owner_tables_before ON COMMIT DROP AS
  SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'gpt02_owner_approval'
    AND c.relname IN ('gpt02_relock_owner_approval_challenges',
                      'gpt02_relock_owner_approval_decisions');
CREATE TEMP TABLE gpt02_1782_policies_before ON COMMIT DROP AS
  SELECT p.oid, p.polname, p.polrelid, p.polcmd, p.polpermissive, p.polroles,
         p.polqual::text AS polqual, p.polwithcheck::text AS polwithcheck
  FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before);
CREATE TEMP TABLE gpt02_1782_transaction_identity ON COMMIT DROP AS
  SELECT pg_catalog.pg_backend_pid() AS backend_pid,
         pg_catalog.pg_current_xact_id() AS transaction_id;

-- CHECKPOINT_BEFORE_TEMPORARY_GRANT
GRANT gpt02_relock_owner_approval_owner TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;

DO $grant_insert_guard$
DECLARE
  actor_oid oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres');
  owner_oid oid := (SELECT oid FROM pg_catalog.pg_roles
                   WHERE rolname = 'gpt02_relock_owner_approval_owner');
  temporary_oid oid;
BEGIN
  -- GRANT locks this target role until transaction end. Prove that it inserted
  -- our own row, rather than updating a concurrent administrator's prior row.
  -- PG17 AddRoleMems creates the grantor ACL dependency only on the INSERT path.
  SELECT m.oid INTO STRICT temporary_oid FROM pg_catalog.pg_auth_members AS m
  WHERE m.roleid = owner_oid AND m.member = actor_oid AND m.grantor = actor_oid
    AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option
    AND m.xmin = pg_catalog.pg_current_xact_id()::xid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_shdepend AS d
    WHERE d.dbid = 0 AND d.classid = 'pg_catalog.pg_auth_members'::regclass
      AND d.objid = temporary_oid AND d.objsubid = 0
      AND d.refclassid = 'pg_catalog.pg_authid'::regclass
      AND d.refobjid = actor_oid AND d.deptype = 'a'
      AND d.xmin = pg_catalog.pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_TEMPORARY_GRANT_NOT_CREATED_BY_THIS_TRANSACTION';
  END IF;
  IF EXISTS (
    (SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members WHERE oid <> temporary_oid
     EXCEPT SELECT * FROM pg_temp.gpt02_1782_membership_before)
    UNION ALL
    (SELECT * FROM pg_temp.gpt02_1782_membership_before
     EXCEPT SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members WHERE oid <> temporary_oid)
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_MEMBERSHIP_BASELINE_CHANGED';
  END IF;
END;
$grant_insert_guard$;
-- CHECKPOINT_AFTER_TEMPORARY_GRANT
SET LOCAL ROLE gpt02_relock_owner_approval_owner;

-- BEGIN_PINNED_PHASE_B_BODY
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
-- END_PINNED_PHASE_B_BODY

-- CHECKPOINT_BEFORE_ROLE_RESTORE
-- NONE is explicit: RESET ROLE can restore a connection-time role setting.
SET LOCAL ROLE NONE;
DO $restore_actor_guard$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR NOT EXISTS (
       SELECT 1 FROM pg_temp.gpt02_1782_transaction_identity
       WHERE backend_pid = pg_catalog.pg_backend_pid()
         AND transaction_id = pg_catalog.pg_current_xact_id()
     ) THEN
    RAISE EXCEPTION 'GPT02_1782_TRANSACTION_IDENTITY_CHANGED';
  END IF;
END;
$restore_actor_guard$;
REVOKE gpt02_relock_owner_approval_owner FROM postgres
  GRANTED BY postgres RESTRICT;

DO $complete_restore_guard$
DECLARE
  reader_oid oid := (SELECT oid FROM pg_catalog.pg_roles
                    WHERE rolname = 'gpt02_owner_ledger_reader_1782_dev');
BEGIN
  IF EXISTS (
    (SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members
     EXCEPT SELECT * FROM pg_temp.gpt02_1782_membership_before)
    UNION ALL
    (SELECT * FROM pg_temp.gpt02_1782_membership_before
     EXCEPT SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members)
  ) OR pg_catalog.pg_has_role('postgres', 'gpt02_relock_owner_approval_owner', 'SET')
    OR pg_catalog.pg_has_role('postgres', 'gpt02_relock_owner_approval_owner', 'USAGE')
  THEN
    RAISE EXCEPTION 'GPT02_1782_MEMBERSHIP_NOT_EXACTLY_RESTORED';
  END IF;
  IF EXISTS (
    (SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
       FROM pg_catalog.pg_roles
     EXCEPT SELECT * FROM pg_temp.gpt02_1782_role_attributes_before)
    UNION ALL
    (SELECT * FROM pg_temp.gpt02_1782_role_attributes_before
     EXCEPT SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
                   rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
       FROM pg_catalog.pg_roles)
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_ROLE_ATTRIBUTES_CHANGED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.gpt02_1782_owner_tables_before AS b
    LEFT JOIN pg_catalog.pg_class AS c ON c.oid = b.oid
    WHERE c.oid IS NULL OR c.relowner <> b.relowner
      OR c.relrowsecurity <> b.relrowsecurity
      OR c.relforcerowsecurity <> b.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_OWNER_OR_RLS_CHANGED';
  END IF;
  IF EXISTS (
    SELECT * FROM pg_temp.gpt02_1782_policies_before
    EXCEPT SELECT p.oid, p.polname, p.polrelid, p.polcmd, p.polpermissive, p.polroles,
                  p.polqual::text, p.polwithcheck::text
      FROM pg_catalog.pg_policy AS p
      WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before)
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before)
      AND NOT EXISTS (SELECT 1 FROM pg_temp.gpt02_1782_policies_before AS b WHERE b.oid = p.oid)
  ) <> 2 OR (
    SELECT count(*) FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
    WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before)
      AND p.polroles = ARRAY[reader_oid] AND p.polcmd = 'r'
      AND p.polpermissive AND p.polwithcheck IS NULL AND p.polqual IS NOT NULL
      AND (c.relname, p.polname) IN (
        ('gpt02_relock_owner_approval_challenges', 'gpt02_1782_reader_original_challenge_select'),
        ('gpt02_relock_owner_approval_decisions', 'gpt02_1782_reader_original_decision_select')
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'GPT02_1782_EXACT_READER_POLICY_DELTA_REQUIRED';
  END IF;
END;
$complete_restore_guard$;
-- CHECKPOINT_BEFORE_COMMIT
COMMIT;
