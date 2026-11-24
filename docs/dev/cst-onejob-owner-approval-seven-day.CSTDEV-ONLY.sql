-- CST-DEV ONLY, source candidate: never apply to PROD or another project.
-- Owner's one-use business approval may be processed for up to seven days,
-- while an independent technical LOGIN lease remains <= 10 minutes and the
-- signed QA proof remains <= 5 minutes at the moment of admission.
-- Run only through reviewed project-bound migration on xssrfshdrtdfupgqwfdw.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE
  old_check text;
  old_policy text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO old_check
  FROM pg_constraint WHERE conrelid='ai_platform.cst_onejob_owner_approvals'::regclass
    AND conname='cst_onejob_owner_approvals_check';
  IF old_check IS NULL OR old_check NOT LIKE '%00:30:00%' THEN
    RAISE EXCEPTION 'CSTDEV_OWNER_7DAY_OLD_CHECK_MISMATCH';
  END IF;
  SELECT with_check INTO old_policy FROM pg_policies
  WHERE schemaname='ai_platform' AND tablename='cst_onejob_owner_approvals'
    AND policyname='cst_onejob_stage_approval_insert' AND cmd='INSERT';
  IF old_policy IS NULL OR old_policy NOT LIKE '%00:30:00%' THEN
    RAISE EXCEPTION 'CSTDEV_OWNER_7DAY_OLD_POLICY_MISMATCH';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cst_team_model_pilot_stage_login'
              AND rolcanlogin)
      OR EXISTS(SELECT 1 FROM pg_stat_activity
         WHERE usename='cst_team_model_pilot_stage_login')
      OR EXISTS(SELECT 1 FROM ai_platform.cst_onejob_owner_approvals
         WHERE status IN ('APPROVED','CONSUMED')) THEN
    RAISE EXCEPTION 'CSTDEV_OWNER_7DAY_ACTIVE_STAGE_OR_APPROVAL_DENIED';
  END IF;
END
$guard$;

ALTER TABLE ai_platform.cst_onejob_owner_approvals
  DROP CONSTRAINT cst_onejob_owner_approvals_check,
  ADD CONSTRAINT cst_onejob_owner_approvals_check
  CHECK (expires_at>approved_at AND expires_at<=approved_at+interval '7 days');

DROP POLICY cst_onejob_stage_approval_insert
  ON ai_platform.cst_onejob_owner_approvals;

CREATE POLICY cst_onejob_stage_approval_insert
 ON ai_platform.cst_onejob_owner_approvals
 FOR INSERT TO cst_team_model_pilot_writer
 WITH CHECK (
   purpose='CST_DEV_ONEJOB_MODEL'
   AND status='APPROVED' AND consumed_at IS NULL
   AND company_id='1' AND model_id='qwen2.5:3b'
   AND request_id ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
   AND worker_name ~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'
   AND source_sha ~ '^[a-f0-9]{40}$'
   AND expires_at>approved_at AND expires_at<=approved_at+interval '7 days'
   AND EXISTS (
     SELECT 1 FROM ai_platform.internal_users u
     WHERE u.id=approved_by_user_id AND u.role='owner'
       AND u.status='active' AND u.account_type='internal'
   )
   AND EXISTS (
     SELECT 1 FROM ai_platform.ai_jobs j
     WHERE j.id=job_id AND j.status='waiting'
       AND j.job_type='ollama_model_invocation'
       AND j.payload_json->>'requestId'=request_id
       AND j.payload_json->>'modelId'=model_id
   )
 );
-- Deliberately no grants, new role, GRANT LOGIN, privilege escalation,
-- queue transition, signer activation, dispatch or Final ACK.
COMMIT;