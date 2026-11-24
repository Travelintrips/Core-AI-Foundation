-- CST-DEV GATE A lease policy/role rollback (ONLY while no lease rows,
-- unexpected memberships or active sessions exist). The expected PostgreSQL17
-- postgres ADMIN grant (NO INHERIT/SET) is allowed. Keeps schema untouched.
-- Never use against PROD, never grants LOGIN, never alters GPT02 recovery.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtext('CST_DEV_GATEA_LEASE_ACL_V1'));

DO $rollback_guard$
DECLARE policies text[];
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres'
    OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
    OR (SELECT count(*) FROM ai_platform.cst_gatea_stage_leases)<>0
    OR (SELECT count(*) FROM pg_catalog.pg_roles
        WHERE rolname IN ('cst_gatea_watchdog_lease_reader',
                          'cst_gatea_stage_lease_writer')
          AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
          AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
          AND NOT rolbypassrls)<>2
    -- PostgreSQL 17 / Supabase automatically grants the role creator
    -- ADMIN OPTION on a newly created role. That expected, non-inheriting,
    -- non-SET membership belongs only to postgres and is safe to drop.
    -- Deny every OTHER membership (including any service actor).
    OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles target ON target.oid=m.roleid
       JOIN pg_catalog.pg_roles member ON member.oid=m.member
       JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor
       WHERE (
         target.rolname IN ('cst_gatea_watchdog_lease_reader',
                            'cst_gatea_stage_lease_writer')
         OR member.rolname IN ('cst_gatea_watchdog_lease_reader',
                               'cst_gatea_stage_lease_writer')
       )
       AND NOT (
          target.rolname IN ('cst_gatea_watchdog_lease_reader',
                             'cst_gatea_stage_lease_writer')
          AND member.rolname='postgres'
          AND grantor.rolname IN ('postgres','supabase_admin')
          AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
       )
    )
    OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_stat_activity
       WHERE usename IN ('cst_gatea_watchdog_lease_reader',
                         'cst_gatea_stage_lease_writer')
    )
 THEN
   RAISE EXCEPTION 'CST_DEV_GATEA_ACL_ROLLBACK_SAFETY_DENIED';
 END IF;
 SELECT array_agg(policyname ORDER BY policyname)
   INTO policies
   FROM pg_catalog.pg_policies
   WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases';
 IF policies IS DISTINCT FROM ARRAY[
   'gatea_stage_lease_write_insert',
   'gatea_stage_lease_write_read',
   'gatea_stage_lease_write_update',
   'gatea_watchdog_lease_read']::text[]
 AND policies IS DISTINCT FROM ARRAY[
   'cst_gatea_watchdog_exact_lease_read',
   'gatea_stage_lease_write_insert',
   'gatea_stage_lease_write_read',
   'gatea_stage_lease_write_update',
   'gatea_watchdog_lease_read']::text[] THEN
   RAISE EXCEPTION 'CST_DEV_GATEA_ACL_ROLLBACK_POLICY_DRIFT';
 END IF;
 IF 'cst_gatea_watchdog_exact_lease_read'=ANY(policies)
 AND NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_policies p
     WHERE p.schemaname='ai_platform'
       AND p.tablename='cst_gatea_stage_leases'
       AND p.policyname='cst_gatea_watchdog_exact_lease_read'
       AND p.cmd='SELECT' AND p.permissive='PERMISSIVE'
       AND p.roles::text='{cst_gatea_watchdog_relock}'
       AND p.qual='(project = ''xssrfshdrtdfupgqwfdw''::text)'
       AND p.with_check IS NULL
 ) THEN
   RAISE EXCEPTION 'CST_DEV_GATEA_OTHER_WATCHDOG_POLICY_CHANGED';
 END IF;
END $rollback_guard$;

DROP POLICY gatea_watchdog_lease_read ON ai_platform.cst_gatea_stage_leases;
DROP POLICY gatea_stage_lease_write_read ON ai_platform.cst_gatea_stage_leases;
DROP POLICY gatea_stage_lease_write_insert ON ai_platform.cst_gatea_stage_leases;
DROP POLICY gatea_stage_lease_write_update ON ai_platform.cst_gatea_stage_leases;

REVOKE SELECT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state)
 ON ai_platform.cst_gatea_stage_leases FROM cst_gatea_watchdog_lease_reader;
REVOKE SELECT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state),
       INSERT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state),
       UPDATE (heartbeat_at)
 ON ai_platform.cst_gatea_stage_leases FROM cst_gatea_stage_lease_writer;
REVOKE ALL ON ai_platform.cst_gatea_stage_leases
 FROM cst_gatea_watchdog_lease_reader, cst_gatea_stage_lease_writer;
REVOKE USAGE ON SCHEMA ai_platform
 FROM cst_gatea_watchdog_lease_reader, cst_gatea_stage_lease_writer;

DROP ROLE cst_gatea_watchdog_lease_reader;
DROP ROLE cst_gatea_stage_lease_writer;

-- Preserve original empty, forced-RLS Gate-A table. Never drop it here.
COMMIT;