-- CST-DEV ONLY. Defense-in-depth against future-dated Gate A lease heartbeats.
-- Applies only to two existing writer RLS policies; NO password, LOGIN,
-- role membership, table, function, signer, dispatch, or PROD change.
-- Gate A watchdog ALREADY rejects heartbeat_at > authoritative DB clock.
-- DB writer must reject the value at source, not rely solely on watchdog.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtext('CST_DEV_GATEA_LEASE_ACL_V1'));
DO $preflight$
DECLARE
 p_insert record;
 p_update record;
BEGIN
 IF current_database()<>'postgres'
   OR current_user<>'postgres'
   OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid='ai_platform.cst_gatea_stage_leases'::regclass
        AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
        AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres'))
   OR EXISTS(SELECT 1 FROM ai_platform.cst_gatea_stage_leases)
   OR EXISTS(SELECT 1 FROM ai_platform.cst_onejob_owner_approvals
      WHERE status IN ('APPROVED','CONSUMED'))
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE usename IN ('cst_team_model_pilot_stage_login',
                       'cst_gatea_watchdog_relock'))
   OR (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('cst_team_model_pilot_stage_login',
                        'cst_gatea_watchdog_relock',
                        'cst_gatea_stage_lease_writer',
                        'cst_gatea_watchdog_lease_reader')
        AND NOT rolcanlogin AND NOT rolsuper
        AND NOT rolbypassrls AND NOT rolcreaterole)<>4
   OR (SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname='ai_platform'
         AND tablename='cst_gatea_stage_leases')<>5
 THEN
    RAISE EXCEPTION 'CST_GATEA_HEARTBEAT_PATCH_PRECONDITION_DENIED';
 END IF;
 SELECT * INTO p_insert FROM pg_catalog.pg_policies p
   WHERE p.schemaname='ai_platform'
     AND p.tablename='cst_gatea_stage_leases'
     AND p.policyname='gatea_stage_lease_write_insert';
 SELECT * INTO p_update FROM pg_catalog.pg_policies p
   WHERE p.schemaname='ai_platform'
     AND p.tablename='cst_gatea_stage_leases'
     AND p.policyname='gatea_stage_lease_write_update';
 IF p_insert.policyname IS NULL OR p_update.policyname IS NULL
    OR p_insert.cmd<>'INSERT'
    OR p_insert.roles::text<>'{cst_gatea_stage_lease_writer}'
    OR p_insert.permissive<>'PERMISSIVE'
    OR p_insert.qual IS NOT NULL
    OR p_insert.with_check <> '(project = ''xssrfshdrtdfupgqwfdw''::text)'
    OR p_update.cmd<>'UPDATE'
    OR p_update.roles::text<>'{cst_gatea_stage_lease_writer}'
    OR p_update.permissive<>'PERMISSIVE'
    OR p_update.qual <>
       '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()))'
    OR p_update.with_check <>
       '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()))'
 THEN
    RAISE EXCEPTION 'CST_GATEA_HEARTBEAT_POLICY_DRIFT_DENIED';
 END IF;
END $preflight$;

ALTER POLICY gatea_stage_lease_write_insert
 ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw'
             AND state='ACTIVE'
             AND issued_at<=clock_timestamp()
             AND heartbeat_at<=clock_timestamp()
             AND expires_at>clock_timestamp());

ALTER POLICY gatea_stage_lease_write_update
 ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw'
             AND state='ACTIVE'
             AND expires_at>clock_timestamp()
             AND heartbeat_at<=clock_timestamp());

-- Existing SELECT policies, UPDATE USING, column grants, private relock-only
-- function, 10-minute CHECK, source pin, and LOGIN roles are unchanged.
COMMIT;