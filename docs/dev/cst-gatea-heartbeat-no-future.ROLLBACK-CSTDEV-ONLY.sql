-- CST-DEV ONLY: rollback future-heartbeat writer RLS hardening.
-- Use only before any real lease/approval. Does NOT change roles or grants.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtext('CST_DEV_GATEA_LEASE_ACL_V1'));
DO $guard$
DECLARE p_insert record;
        p_update record;
BEGIN
 IF current_database()<>'postgres'
    OR current_user<>'postgres'
    OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_class c
       WHERE c.oid='ai_platform.cst_gatea_stage_leases'::regclass
         AND c.relrowsecurity AND c.relforcerowsecurity)
    OR EXISTS (SELECT 1 FROM ai_platform.cst_gatea_stage_leases)
    OR EXISTS (SELECT 1 FROM ai_platform.cst_onejob_owner_approvals
       WHERE status IN ('APPROVED','CONSUMED'))
    OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN
       ('cst_team_model_pilot_stage_login','cst_gatea_watchdog_relock'))
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
       ('cst_team_model_pilot_stage_login','cst_gatea_watchdog_relock',
        'cst_gatea_stage_lease_writer') AND rolcanlogin)
    OR (SELECT count(*) FROM pg_policies
       WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases')<>5
 THEN
   RAISE EXCEPTION 'CST_GATEA_FUTURE_HEARTBEAT_ROLLBACK_DENIED';
 END IF;
 SELECT * INTO p_insert FROM pg_policies p
  WHERE p.schemaname='ai_platform'
   AND p.tablename='cst_gatea_stage_leases'
   AND p.policyname='gatea_stage_lease_write_insert';
 SELECT * INTO p_update FROM pg_policies p
  WHERE p.schemaname='ai_platform'
   AND p.tablename='cst_gatea_stage_leases'
   AND p.policyname='gatea_stage_lease_write_update';
 IF p_insert.policyname IS NULL OR p_update.policyname IS NULL
    OR p_insert.cmd<>'INSERT'
    OR p_insert.roles::text<>'{cst_gatea_stage_lease_writer}'
    OR p_insert.qual IS NOT NULL
    OR p_insert.with_check <>
     '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (issued_at <= clock_timestamp()) AND (heartbeat_at <= clock_timestamp()) AND (expires_at > clock_timestamp()))'
    OR p_update.cmd<>'UPDATE'
    OR p_update.roles::text<>'{cst_gatea_stage_lease_writer}'
    OR p_update.qual <>
     '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()))'
    OR p_update.with_check <>
     '((project = ''xssrfshdrtdfupgqwfdw''::text) AND (state = ''ACTIVE''::text) AND (expires_at > clock_timestamp()) AND (heartbeat_at <= clock_timestamp()))'
 THEN
   RAISE EXCEPTION 'CST_GATEA_FUTURE_HEARTBEAT_ROLLBACK_POLICY_DRIFT';
 END IF;
END $guard$;

ALTER POLICY gatea_stage_lease_write_insert
 ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw');

ALTER POLICY gatea_stage_lease_write_update
 ON ai_platform.cst_gatea_stage_leases
 WITH CHECK (project='xssrfshdrtdfupgqwfdw'
             AND state='ACTIVE'
             AND expires_at>clock_timestamp());
COMMIT;