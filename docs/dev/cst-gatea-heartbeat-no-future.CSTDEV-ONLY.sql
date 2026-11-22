-- CST-DEV only. Reject future-dated lease heartbeats at the writer RLS layer.
-- NEVER execute against PROD. This does not open LOGIN or grant permissions.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtext('CST_DEV_GATEA_LEASE_ACL_V1'));
DO $guard$
DECLARE ins record; upd record;
BEGIN
 IF current_database() <> 'postgres' OR current_user <> 'postgres'
    OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='ai_platform.cst_gatea_stage_leases'::regclass
                   AND relkind='r' AND relrowsecurity AND relforcerowsecurity
                   AND relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres'))
    OR EXISTS (SELECT 1 FROM ai_platform.cst_gatea_stage_leases)
    OR EXISTS (SELECT 1 FROM ai_platform.cst_onejob_owner_approvals WHERE status IN ('APPROVED','CONSUMED'))
    OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN ('cst_team_model_pilot_stage_login','cst_gatea_watchdog_relock'))
    OR (SELECT count(*) FROM pg_roles
        WHERE rolname IN ('cst_team_model_pilot_stage_login','cst_gatea_watchdog_relock',
                          'cst_gatea_stage_lease_writer','cst_gatea_watchdog_lease_reader')
          AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole) <> 4
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform'
           AND tablename='cst_gatea_stage_leases') <> 5
 THEN RAISE EXCEPTION 'CST_GATEA_HEARTBEAT_PREFLIGHT_DENIED'; END IF;
 SELECT * INTO ins FROM pg_policies WHERE schemaname='ai_platform'
  AND tablename='cst_gatea_stage_leases' AND policyname='gatea_stage_lease_write_insert';
 SELECT * INTO upd FROM pg_policies WHERE schemaname='ai_platform'
  AND tablename='cst_gatea_stage_leases' AND policyname='gatea_stage_lease_write_update';
 IF ins.cmd IS DISTINCT FROM 'INSERT'
    OR ins.roles::text IS DISTINCT FROM '{cst_gatea_stage_lease_writer}'
    OR ins.qual IS NOT NULL
    OR ins.with_check IS DISTINCT FROM '(project = ''xssrfshdrtdfupgqwfdw''::text)'
    OR upd.cmd IS DISTINCT FROM 'UPDATE'
    OR upd.roles::text IS DISTINCT FROM '{cst_gatea_stage_lease_writer}'
    OR upd.qual IS DISTINCT FROM '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()))'
    OR upd.with_check IS DISTINCT FROM '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()))'
 THEN RAISE EXCEPTION 'CST_GATEA_HEARTBEAT_POLICY_DRIFT_DENIED'; END IF;
END $guard$;
ALTER POLICY gatea_stage_lease_write_insert ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw' AND state='ACTIVE'
             AND issued_at<=clock_timestamp() AND heartbeat_at<=clock_timestamp()
             AND expires_at>clock_timestamp());
ALTER POLICY gatea_stage_lease_write_update ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw' AND state='ACTIVE'
             AND expires_at>clock_timestamp() AND heartbeat_at<=clock_timestamp());
COMMIT;
