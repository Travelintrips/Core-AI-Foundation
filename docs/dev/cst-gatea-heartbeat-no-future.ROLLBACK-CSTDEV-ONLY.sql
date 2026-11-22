-- CST-DEV only. Revert writer RLS hardening only while no lease/approval/session exists.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtext('CST_DEV_GATEA_LEASE_ACL_V1'));
DO $guard$
DECLARE ins record; upd record;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres'
 OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
 OR EXISTS (SELECT 1 FROM ai_platform.cst_gatea_stage_leases)
 OR EXISTS (SELECT 1 FROM ai_platform.cst_onejob_owner_approvals WHERE status IN ('APPROVED','CONSUMED'))
 OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN ('cst_team_model_pilot_stage_login','cst_gatea_watchdog_relock'))
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases')<>5
 THEN RAISE EXCEPTION 'CST_GATEA_HEARTBEAT_ROLLBACK_PREFLIGHT_DENIED'; END IF;
 SELECT * INTO ins FROM pg_policies WHERE schemaname='ai_platform'
  AND tablename='cst_gatea_stage_leases' AND policyname='gatea_stage_lease_write_insert';
 SELECT * INTO upd FROM pg_policies WHERE schemaname='ai_platform'
  AND tablename='cst_gatea_stage_leases' AND policyname='gatea_stage_lease_write_update';
 IF ins.cmd IS DISTINCT FROM 'INSERT'
 OR ins.roles::text IS DISTINCT FROM '{cst_gatea_stage_lease_writer}'
 OR ins.with_check IS DISTINCT FROM '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (issued_at <= clock_timestamp()) AND (heartbeat_at <= clock_timestamp()) AND (expires_at > clock_timestamp()))'
 OR upd.cmd IS DISTINCT FROM 'UPDATE'
 OR upd.roles::text IS DISTINCT FROM '{cst_gatea_stage_lease_writer}'
 OR upd.qual IS DISTINCT FROM '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()))'
 OR upd.with_check IS DISTINCT FROM '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()) AND (heartbeat_at <= clock_timestamp()))'
 THEN RAISE EXCEPTION 'CST_GATEA_HEARTBEAT_ROLLBACK_POLICY_DRIFT'; END IF;
END $guard$;
ALTER POLICY gatea_stage_lease_write_insert ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw');
ALTER POLICY gatea_stage_lease_write_update ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw' AND state='ACTIVE' AND expires_at>clock_timestamp());
COMMIT;
