-- Only before any genuine Owner approval / active stage login; do not
-- remove privileges from running authenticated staging transactions.
BEGIN;
DO $preflight$
BEGIN
 IF current_database()<>'postgres'
 OR EXISTS(SELECT 1 FROM ai_platform.cst_onejob_owner_approvals)
 OR EXISTS(SELECT 1 FROM pg_stat_activity
   WHERE usename='cst_team_model_pilot_stage_login')
 THEN RAISE EXCEPTION 'OWNER_STAGE_SESSION_READER_ROLLBACK_DENIED';END IF;
 IF NOT has_column_privilege('cst_team_model_pilot_writer',
   'ai_platform.internal_users','must_change_password','SELECT')
 THEN RAISE EXCEPTION 'OWNER_STAGE_READER_NOT_INSTALLED';END IF;
END $preflight$;
REVOKE SELECT (must_change_password)
 ON ai_platform.internal_users FROM cst_team_model_pilot_writer;
DO $postflight$
BEGIN
 IF has_column_privilege('cst_team_model_pilot_writer',
     'ai_platform.internal_users','must_change_password','SELECT')
 THEN RAISE EXCEPTION 'OWNER_STAGE_READER_REVOKE_FAILED';END IF;
END $postflight$;
COMMIT;
