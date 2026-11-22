-- CST-DEV GATE A ONE-TIME ROLE + LEASE ACL CHANGE, EXPLICIT DEV ONLY.
-- Never execute against PROD. Never opens LOGIN, stores a password, issues
-- an approval or installs an operational watchdog. Source-reviewed only.
-- A single transaction prevents partial role/grant/policy provisioning.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtext('CST_DEV_GATEA_LEASE_ACL_V1'));
DO $gated$
DECLARE x text;
BEGIN
 IF current_database() <> 'postgres'
    OR current_user <> 'postgres'
    OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname IN ('cst_gatea_watchdog_lease_reader','cst_gatea_stage_lease_writer'))
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname='ai_platform' AND p.tablename='cst_gatea_stage_leases'
        AND NOT (p.policyname='cst_gatea_watchdog_exact_lease_read'
         AND p.cmd='SELECT' AND p.permissive='PERMISSIVE'
         AND p.roles::text='{cst_gatea_watchdog_relock}'
         AND p.qual='(project = ''xssrfshdrtdfupgqwfdw''::text)'
         AND p.with_check IS NULL)
    )
    OR (SELECT count(*) FROM ai_platform.cst_gatea_stage_leases) <> 0
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity AND relkind='r'
            AND relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
            FROM pg_catalog.pg_class
            WHERE oid='ai_platform.cst_gatea_stage_leases'::regclass)
    OR COALESCE((SELECT rolcanlogin FROM pg_catalog.pg_roles
          WHERE rolname='cst_team_model_pilot_stage_login'),true)
 THEN
   RAISE EXCEPTION 'CST_DEV_GATEA_LEASE_MIGRATION_PREFLIGHT_DENIED';
 END IF;
 SELECT string_agg(column_name||':'||data_type||':'||is_nullable,',' ORDER BY ordinal_position)
 INTO x FROM information_schema.columns
 WHERE table_schema='ai_platform' AND table_name='cst_gatea_stage_leases';
 IF x IS DISTINCT FROM
  'project:text:NO,nonce:text:NO,source_sha:text:NO,issued_at:timestamp with time zone:NO,expires_at:timestamp with time zone:NO,heartbeat_at:timestamp with time zone:NO,state:text:NO' THEN
    RAISE EXCEPTION 'CST_DEV_GATEA_LEASE_COLUMNS_DRIFT';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint
    WHERE conrelid='ai_platform.cst_gatea_stage_leases'::regclass
      AND conname IN ('cst_gatea_stage_leases_pkey','gatea_bounded_ten_minute_lease',
       'gatea_exact_dev_project','gatea_heartbeat_within_window',
       'gatea_signed_nonce_format','gatea_source_hash_format','gatea_state_scope'))<>7 THEN
   RAISE EXCEPTION 'CST_DEV_GATEA_LEASE_CONSTRAINTS_DRIFT';
 END IF;
END $gated$;

-- Neither group can authenticate, inherit grants or grant membership.
CREATE ROLE cst_gatea_watchdog_lease_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE cst_gatea_stage_lease_writer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- The following policy/grant block is the exact reviewed proposal.
SET LOCAL cst_gatea.reviewed_dev_migration='true';
DO $scope$
DECLARE name text;
BEGIN
  IF current_setting('cst_gatea.reviewed_dev_migration', true) IS DISTINCT FROM 'true'
    OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid=to_regclass('ai_platform.cst_gatea_stage_leases')
      AND relkind='r' AND relrowsecurity AND relforcerowsecurity
    ) THEN
    RAISE EXCEPTION 'CST_GATEA_LEASE_ACL_REVIEW_OR_RLS_REQUIRED';
  END IF;
  -- A separately reviewed Gate-A relock-only policy may already exist.
  -- It belongs to a different NOLOGIN role and MUST remain untouched.
  -- Reject all other policy drift (even under a matching policy name).
  IF EXISTS (
     SELECT 1 FROM pg_policies p WHERE p.schemaname='ai_platform'
       AND p.tablename='cst_gatea_stage_leases'
       AND NOT (
         p.policyname='cst_gatea_watchdog_exact_lease_read'
         AND p.cmd='SELECT' AND p.permissive='PERMISSIVE'
         AND p.roles::text='{cst_gatea_watchdog_relock}'
         AND p.qual='(project = ''xssrfshdrtdfupgqwfdw''::text)'
         AND p.with_check IS NULL
       )
  ) OR (
     EXISTS (SELECT 1 FROM pg_policies p
       WHERE p.schemaname='ai_platform'
         AND p.tablename='cst_gatea_stage_leases'
         AND p.policyname='cst_gatea_watchdog_exact_lease_read')
     AND NOT EXISTS (SELECT 1 FROM pg_roles r
       WHERE r.rolname='cst_gatea_watchdog_relock'
         AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
         AND NOT r.rolcreaterole AND NOT r.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'CST_GATEA_UNEXPECTED_EXISTING_LEASE_POLICY';
  END IF;
  FOR name IN
    SELECT unnest(ARRAY[
      'cst_gatea_watchdog_lease_reader',
      'cst_gatea_stage_lease_writer'])
  LOOP
    IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname=name
         AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
         AND NOT rolcreaterole AND NOT rolcreatedb
         AND NOT rolinherit AND NOT rolreplication
    ) THEN
      RAISE EXCEPTION 'CST_GATEA_NOLOGIN_SCOPED_ROLE_REQUIRED: %',name;
    END IF;
  END LOOP;
END $scope$;

REVOKE ALL ON TABLE ai_platform.cst_gatea_stage_leases FROM PUBLIC;
GRANT USAGE ON SCHEMA ai_platform TO
  cst_gatea_watchdog_lease_reader, cst_gatea_stage_lease_writer;

CREATE POLICY gatea_watchdog_lease_read
ON ai_platform.cst_gatea_stage_leases
FOR SELECT TO cst_gatea_watchdog_lease_reader
USING (project='xssrfshdrtdfupgqwfdw');

GRANT SELECT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state)
ON ai_platform.cst_gatea_stage_leases
TO cst_gatea_watchdog_lease_reader;

CREATE POLICY gatea_stage_lease_write_read
ON ai_platform.cst_gatea_stage_leases
FOR SELECT TO cst_gatea_stage_lease_writer
USING (project='xssrfshdrtdfupgqwfdw');

CREATE POLICY gatea_stage_lease_write_insert
ON ai_platform.cst_gatea_stage_leases
FOR INSERT TO cst_gatea_stage_lease_writer
WITH CHECK (project='xssrfshdrtdfupgqwfdw');

CREATE POLICY gatea_stage_lease_write_update
ON ai_platform.cst_gatea_stage_leases
FOR UPDATE TO cst_gatea_stage_lease_writer
USING (project='xssrfshdrtdfupgqwfdw'
       AND state='ACTIVE' AND expires_at>clock_timestamp())
WITH CHECK (project='xssrfshdrtdfupgqwfdw'
            AND state='ACTIVE' AND expires_at>clock_timestamp());

-- Immutability is enforced by column grants. After insertion, this role
-- CANNOT change signed nonce, pinned source, issuance, expiry, or state.
-- Only the heartbeat may advance inside the original signed lease window.
GRANT SELECT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state),
      INSERT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state),
      UPDATE (heartbeat_at)
ON ai_platform.cst_gatea_stage_leases
TO cst_gatea_stage_lease_writer;

-- The caller must still verify a genuine signed Gate-A permit and reserve
-- a durable nonce atomically BEFORE writing a lease. This ACL is necessary
-- but never sufficient authorization to enable database LOGIN.

COMMIT;
