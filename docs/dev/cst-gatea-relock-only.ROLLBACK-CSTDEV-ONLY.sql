-- CST-DEV ONLY: rollback of fixed, relock-only watchdog authority.
-- Do not run on PROD. Refuse if an operational login or lease exists.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $guard$
BEGIN
 IF to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
    OR to_regnamespace('cst_gatea_relock_private') IS NULL
    OR to_regprocedure('cst_gatea_relock_private.relock_stage_now()') IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_roles
         WHERE rolname='cst_gatea_watchdog_relock'
           AND NOT rolcanlogin AND NOT rolcreaterole
           AND NOT rolsuper AND NOT rolbypassrls)
    OR NOT EXISTS(SELECT 1 FROM pg_roles
         WHERE rolname='cst_team_model_pilot_stage_login'
           AND NOT rolcanlogin)
    OR EXISTS(SELECT 1 FROM pg_stat_activity
         WHERE usename IN ('cst_team_model_pilot_stage_login',
                          'cst_gatea_watchdog_relock'))
    OR EXISTS(SELECT 1 FROM ai_platform.cst_gatea_stage_leases)
    OR EXISTS(SELECT 1 FROM ai_platform.cst_onejob_owner_approvals
         WHERE status IN ('APPROVED','CONSUMED'))
 THEN
    RAISE EXCEPTION 'CST_GATEA_RELOCK_ROLLBACK_ACTIVE_OR_DRIFTED';
 END IF;
END
$guard$;
DROP POLICY cst_gatea_watchdog_exact_lease_read
 ON ai_platform.cst_gatea_stage_leases;
REVOKE SELECT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state)
 ON ai_platform.cst_gatea_stage_leases FROM cst_gatea_watchdog_relock;
REVOKE USAGE ON SCHEMA ai_platform FROM cst_gatea_watchdog_relock;
REVOKE EXECUTE ON FUNCTION cst_gatea_relock_private.relock_stage_now()
 FROM cst_gatea_watchdog_relock;
DROP FUNCTION cst_gatea_relock_private.relock_stage_now();
REVOKE USAGE ON SCHEMA cst_gatea_relock_private FROM cst_gatea_watchdog_relock;
DROP SCHEMA cst_gatea_relock_private;
DROP ROLE cst_gatea_watchdog_relock;
-- The separate lease table remains installed with forced RLS and no policy.
COMMIT;