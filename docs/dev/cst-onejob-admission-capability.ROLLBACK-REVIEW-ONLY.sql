-- REVIEW-ONLY rollback for an *unused* approved capability deployment.
-- Not authorized for execution on CST-DEV or PROD. Does NOT reverse a job.
-- Stop and independently reconcile jobs/receipts if ANY admission occurred.
BEGIN;
-- CST_ONEJOB_REVIEW_ONLY_GUARD_BEGIN
DO $deny_unapproved$
BEGIN
  RAISE EXCEPTION 'CST_DEV_ADMISSION_CAPABILITY_ROLLBACK_NOT_AUTHORIZED_REVIEW_ONLY';
END
$deny_unapproved$;
-- CST_ONEJOB_REVIEW_ONLY_GUARD_END
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM cst_onejob_private.admission_event_outbox)
     OR EXISTS (SELECT 1 FROM cst_onejob_private.admission_receipt_consumptions)
  THEN RAISE EXCEPTION 'ROLLBACK_REQUIRES_INDEPENDENT_RECEIPT_RECONCILIATION'; END IF;
  IF to_regprocedure(
      'cst_onejob_private.admit_verified_onejob_capability(integer,text,text)')
      IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles
       WHERE rolname='cst_onejob_admission_executor'
         AND rolcanlogin=false AND rolbypassrls=false)
  THEN RAISE EXCEPTION 'EXACT_CAPABILITY_INSTALL_REQUIRED'; END IF;
END
$preflight$;
REVOKE ALL ON FUNCTION
 cst_onejob_private.admit_verified_onejob_capability(integer,text,text)
 FROM PUBLIC,cst_onejob_admission_broker,cst_onejob_broker_login;
DROP FUNCTION cst_onejob_private.admit_verified_onejob_capability(integer,text,text);
DROP POLICY cst_capability_owner_read ON ai_platform.internal_users;
DROP POLICY cst_capability_job_read ON ai_platform.ai_jobs;
DROP POLICY cst_capability_job_update ON ai_platform.ai_jobs;
DROP POLICY cst_capability_approval_read ON ai_platform.cst_onejob_owner_approvals;
DROP POLICY cst_capability_approval_update ON ai_platform.cst_onejob_owner_approvals;
DROP POLICY cst_capability_receipt_read ON cst_onejob_private.verified_admission_receipts;
DROP POLICY cst_capability_receipt_update ON cst_onejob_private.verified_admission_receipts;
DROP POLICY cst_capability_consumption_insert ON cst_onejob_private.admission_receipt_consumptions;
DROP POLICY cst_capability_outbox_insert ON cst_onejob_private.admission_event_outbox;
DROP POLICY cst_capability_audit_insert ON ai_platform.ai_audit_logs;
REVOKE ALL PRIVILEGES ON
 ai_platform.ai_jobs,ai_platform.cst_onejob_owner_approvals,
 cst_onejob_private.verified_admission_receipts,
 ai_platform.ai_audit_logs,cst_onejob_private.admission_receipt_consumptions,
 cst_onejob_private.admission_event_outbox
 FROM cst_onejob_admission_executor;
REVOKE SELECT(id,account_type,role,status) ON ai_platform.internal_users
 FROM cst_onejob_admission_executor;
REVOKE USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq
 FROM cst_onejob_admission_executor;
REVOKE EXECUTE ON FUNCTION
 cst_onejob_private.admit_verified_onejob(integer,text,text)
 FROM cst_onejob_admission_executor;
REVOKE ALL ON SCHEMA ai_platform,cst_onejob_private
 FROM cst_onejob_admission_executor;
DROP ROLE cst_onejob_admission_executor;
DO $postflight$
BEGIN
 IF to_regrole('cst_onejob_admission_executor') IS NOT NULL
 OR to_regprocedure(
   'cst_onejob_private.admit_verified_onejob_capability(integer,text,text)') IS NOT NULL
 OR has_table_privilege('cst_onejob_admission_broker','ai_platform.ai_jobs','UPDATE')
 THEN RAISE EXCEPTION 'ROLLBACK_ROLE_OR_CAPABILITY_REMAINS'; END IF;
END
$postflight$;
-- Prior insecure broker EXECUTE on the raw invoker is deliberately NOT restored.
-- Existing RLS, owner approval tables, QA ledgers and signers are untouched.
COMMIT;
