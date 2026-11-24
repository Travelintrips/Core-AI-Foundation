-- Exact rollback only BEFORE the first Owner approval / scoped stage session.
-- Existing writer, all prior RLS policies and audit records remain.
BEGIN;
DO $preflight$
BEGIN
 IF current_database()<>'postgres'
 OR EXISTS(SELECT 1 FROM ai_platform.cst_onejob_owner_approvals)
 OR EXISTS(SELECT 1 FROM pg_stat_activity
           WHERE usename='cst_team_model_pilot_stage_login')
 THEN RAISE EXCEPTION 'ROOT_AUDIT_READER_ROLLBACK_ACTIVE_APPROVAL_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policy
  WHERE polrelid='ai_platform.ai_audit_logs'::regclass
  AND polname='cst_onejob_stage_owner_audit_read' AND polcmd='r')
 THEN RAISE EXCEPTION 'ROOT_AUDIT_READER_POLICY_NOT_INSTALLED'; END IF;
END
$preflight$;
DROP POLICY cst_onejob_stage_owner_audit_read ON ai_platform.ai_audit_logs;
REVOKE SELECT (module,action,resource_type,resource_id,status,details)
 ON ai_platform.ai_audit_logs FROM cst_team_model_pilot_writer;
REVOKE SELECT (purpose)
 ON ai_platform.cst_onejob_owner_approvals FROM cst_team_model_pilot_writer;
COMMIT;
