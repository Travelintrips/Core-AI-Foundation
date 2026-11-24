-- Exact CST-DEV-only rollback for the single restrictive owner audit policy.
-- No permission to drop it after any real one-job Owner approval exists.
-- Neither broader grants nor other policies are modified.
BEGIN;
DO $rollback_preflight$
BEGIN
 IF current_database()<>'postgres' OR
    (SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals)<>0 THEN
   RAISE EXCEPTION 'ROLLBACK_REQUIRES_EMPTY_CST_DEV_APPROVAL_LEDGER';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policy
  WHERE polrelid='ai_platform.ai_audit_logs'::regclass
   AND polname='cst_onejob_stage_ops_root_binding'
   AND polpermissive=false AND polcmd='a') THEN
   RAISE EXCEPTION 'ROOT_BINDING_POLICY_NOT_PRESENT';
 END IF;
END
$rollback_preflight$;
DROP POLICY cst_onejob_stage_ops_root_binding ON ai_platform.ai_audit_logs;
COMMIT;
