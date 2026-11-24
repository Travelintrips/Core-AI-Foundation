-- CST-DEV GATE A LEASE ACL ONLY. PROPOSED / NOT APPROVED / NOT DEPLOYED.
-- Requires the separately reviewed Gate-A stage lease table to exist.
-- NO role creation, LOGIN, user account, GRANT membership, password, token,
-- SECURITY DEFINER, elevated administrative permission or Data API access.
--
-- These are dedicated NOLOGIN privilege groups, not login credentials:
-- cst_gatea_watchdog_lease_reader: fixed-project SELECT only
-- cst_gatea_stage_lease_writer: fixed-project SELECT/INSERT/bounded UPDATE.
-- The watchdog's separate role relock permission is NOT conferred here.
BEGIN;
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
