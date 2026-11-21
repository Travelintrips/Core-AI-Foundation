-- CST-DEV xssrfshdrtdfupgqwfdw ONLY.
-- Source candidate: add the ONE missing Owner password-change flag for a
-- dedicated READ-ONLY signed-session lookup. Never expose email or password.
-- No role LOGIN, shared runtime writer grant, source root, job or admission.
BEGIN;
DO $preflight$
BEGIN
 IF current_database()<>'postgres' OR
    NOT EXISTS(SELECT 1 FROM pg_roles
      WHERE rolname='cst_team_model_pilot_stage_login'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
       AND NOT rolinherit AND rolconnlimit=1)
 OR NOT EXISTS(SELECT 1 FROM pg_roles
      WHERE rolname='cst_team_model_pilot_writer'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 OR NOT EXISTS(SELECT 1 FROM pg_auth_members m
      JOIN pg_roles lo ON lo.oid=m.member
      JOIN pg_roles wr ON wr.oid=m.roleid
      WHERE lo.rolname='cst_team_model_pilot_stage_login'
        AND wr.rolname='cst_team_model_pilot_writer'
        AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option)
 OR EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE usename='cst_team_model_pilot_stage_login')
 OR EXISTS(SELECT 1 FROM ai_platform.cst_onejob_owner_approvals)
 THEN RAISE EXCEPTION 'CST_DEV_ONEJOB_OWNER_PASSWORD_STATE_PREFLIGHT_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class
     WHERE oid='ai_platform.internal_users'::regclass
       AND relrowsecurity AND relforcerowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_policy
     WHERE polrelid='ai_platform.internal_users'::regclass
       AND polname='cst_onejob_stage_owner_select'
       AND polpermissive AND polcmd='r')
 THEN RAISE EXCEPTION 'CANONICAL_OWNER_RLS_REQUIRED'; END IF;
 IF has_column_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','must_change_password','SELECT')
 OR has_column_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','email','SELECT')
 OR has_table_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','UPDATE')
 THEN RAISE EXCEPTION 'OWNER_SESSION_READER_BASELINE_DRIFT'; END IF;
END $preflight$;
GRANT SELECT (must_change_password)
 ON ai_platform.internal_users TO cst_team_model_pilot_writer;
DO $postflight$
BEGIN
 IF NOT has_column_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','must_change_password','SELECT')
 OR has_column_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','email','SELECT')
 OR has_column_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','password_hash','SELECT')
 OR has_table_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','UPDATE')
 OR has_table_privilege('cst_team_model_pilot_writer',
      'ai_platform.internal_users','DELETE')
 OR EXISTS(SELECT 1 FROM pg_roles
      WHERE rolname='cst_team_model_pilot_stage_login' AND rolcanlogin)
 THEN RAISE EXCEPTION 'CST_DEV_ONEJOB_OWNER_PASSWORD_STATE_POSTFLIGHT_DENIED'; END IF;
END $postflight$;
COMMIT;
