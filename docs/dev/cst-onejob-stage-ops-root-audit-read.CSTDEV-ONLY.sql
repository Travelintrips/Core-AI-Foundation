-- Exact project xssrfshdrtdfupgqwfdw (CST-DEV), never PROD.
-- Minimal SELECT-only Owner audit readback for ONE Super Admin business click.
-- Existing writer retains NOLOGIN, staged login retains NOLOGIN;
-- no approval, root trust, signer service or admission is activated.
BEGIN;
DO $preflight$
BEGIN
 IF current_database()<>'postgres' OR
    current_setting('server_version_num')::integer<160000 OR
    to_regclass('ai_platform.ai_audit_logs') IS NULL OR
    to_regclass('ai_platform.cst_onejob_owner_approvals') IS NULL OR
    to_regclass('ai_platform.ai_jobs') IS NULL
 THEN RAISE EXCEPTION 'CST_DEV_EXACT_SCHEMA_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles
    WHERE rolname='cst_team_model_pilot_writer'
      AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper)
 OR NOT EXISTS(SELECT 1 FROM pg_roles
    WHERE rolname='cst_team_model_pilot_stage_login'
      AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
      AND rolconnlimit=1)
 OR (SELECT count(*) FROM pg_auth_members m
     JOIN pg_roles wr ON wr.oid=m.roleid JOIN pg_roles st ON st.oid=m.member
     WHERE wr.rolname='cst_team_model_pilot_writer'
       AND st.rolname='cst_team_model_pilot_stage_login'
       AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option)<>1
 THEN RAISE EXCEPTION 'CST_DEV_STAGING_ROLE_SCOPE_REQUIRED'; END IF;
 IF EXISTS (SELECT 1 FROM ai_platform.cst_onejob_owner_approvals)
 OR EXISTS (SELECT 1 FROM pg_stat_activity
     WHERE usename='cst_team_model_pilot_stage_login')
 THEN RAISE EXCEPTION 'OWNER_APPROVAL_OR_STAGE_SESSION_ALREADY_PRESENT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class
    WHERE oid='ai_platform.ai_audit_logs'::regclass AND relrowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_class
    WHERE oid='ai_platform.cst_onejob_owner_approvals'::regclass
      AND relrowsecurity AND relforcerowsecurity)
 THEN RAISE EXCEPTION 'OWNER_AUDIT_RLS_NOT_ENABLED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policy
    WHERE polrelid='ai_platform.ai_audit_logs'::regclass
      AND polname='cst_onejob_stage_ops_root_binding'
      AND NOT polpermissive AND polcmd='a')
 OR NOT EXISTS (SELECT 1 FROM pg_policy
    WHERE polrelid='ai_platform.ai_audit_logs'::regclass
      AND polname='cst_onejob_stage_audit_insert'
      AND polpermissive AND polcmd='a')
 OR NOT EXISTS (SELECT 1 FROM pg_policy
    WHERE polrelid='ai_platform.cst_onejob_owner_approvals'::regclass
      AND polname='cst_onejob_stage_approval_select'
      AND polpermissive AND polcmd='r')
 THEN RAISE EXCEPTION 'CANONICAL_ONEJOB_STAGING_POLICIES_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policy
    WHERE polrelid='ai_platform.ai_audit_logs'::regclass
      AND polname='cst_onejob_stage_owner_audit_read')
 OR has_column_privilege('cst_team_model_pilot_writer',
    'ai_platform.ai_audit_logs','details','SELECT')
 OR has_column_privilege('cst_team_model_pilot_writer',
    'ai_platform.cst_onejob_owner_approvals','purpose','SELECT')
 THEN RAISE EXCEPTION 'ROOT_EVIDENCE_READER_ALREADY_CHANGED'; END IF;
END
$preflight$;

-- Two COLUMN-LEVEL SELECT grants, never broad SELECT or UPDATE.
-- Existing approval read RLS already limits Company 1 approved records.
GRANT SELECT (purpose)
 ON ai_platform.cst_onejob_owner_approvals
 TO cst_team_model_pilot_writer;
GRANT SELECT (module,action,resource_type,resource_id,status,details)
 ON ai_platform.ai_audit_logs
 TO cst_team_model_pilot_writer;

-- Audit rows are visible ONLY when matched to a real, active, singleton
-- Company-1 Owner approval, the exact candidate fingerprint and explicit
-- not-trusted/not-admitted/not-dispatched markers. No other audit type.
CREATE POLICY cst_onejob_stage_owner_audit_read
 ON ai_platform.ai_audit_logs
 FOR SELECT TO cst_team_model_pilot_writer
 USING (
  module='cst-onejob' AND action='owner_approved_waiting_job'
  AND resource_type='ai_job' AND status='success'
  AND details->>'operationsRootCandidateSha256'=
      '65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b'
  AND details->>'sameSuperAdminRootSelection'='true'
  AND details->>'operationsRootTrusted'='false'
  AND details->>'independentQaAdmissionVerified'='false'
  AND details->>'dispatchPermitted'='false'
  AND EXISTS (
   SELECT 1 FROM ai_platform.cst_onejob_owner_approvals a
   WHERE a.id::text=details->>'approvalId'
     AND a.job_id::text=resource_id
     AND a.approved_by_user_id::text=details->>'ownerUserId'
     AND a.request_id=details->>'requestId'
     AND a.worker_name=details->>'workerName'
     AND a.source_sha=details->>'sourceSha'
     AND a.purpose='CST_DEV_ONEJOB_MODEL'
     AND a.company_id='1' AND a.model_id='qwen2.5:3b'
     AND a.status='APPROVED' AND a.consumed_at IS NULL
  )
 );

DO $postflight$
DECLARE p record;
BEGIN
 SELECT polpermissive,polcmd,polroles,
   pg_get_expr(polqual,polrelid) AS predicate
 INTO p FROM pg_policy
 WHERE polrelid='ai_platform.ai_audit_logs'::regclass
  AND polname='cst_onejob_stage_owner_audit_read';
 IF NOT FOUND OR p.polpermissive IS NOT TRUE OR p.polcmd<>'r'
  OR NOT 'cst_team_model_pilot_writer'::regrole=ANY(p.polroles)
  OR position('operationsRootCandidateSha256' in p.predicate)=0
  OR position('owner_approved_waiting_job' in p.predicate)=0
  OR position('approved_by_user_id' in p.predicate)=0
  OR NOT has_column_privilege('cst_team_model_pilot_writer',
      'ai_platform.ai_audit_logs','details','SELECT')
  OR NOT has_column_privilege('cst_team_model_pilot_writer',
      'ai_platform.cst_onejob_owner_approvals','purpose','SELECT')
  OR has_table_privilege('cst_team_model_pilot_writer',
      'ai_platform.ai_audit_logs','UPDATE')
  OR has_table_privilege('cst_team_model_pilot_writer',
      'ai_platform.ai_audit_logs','DELETE')
  OR has_table_privilege('cst_team_model_pilot_writer',
      'ai_platform.cst_onejob_owner_approvals','UPDATE')
 THEN RAISE EXCEPTION 'ROOT_AUDIT_READER_POSTFLIGHT_DENIED'; END IF;
END
$postflight$;
COMMIT;
