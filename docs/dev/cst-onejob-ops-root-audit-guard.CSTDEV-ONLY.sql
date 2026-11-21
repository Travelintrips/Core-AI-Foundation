-- CST-DEV ONLY. Exact project: xssrfshdrtdfupgqwfdw.
-- Add a RESTRICTIVE INSERT policy: never replace/relax the existing
-- permissive owner-approval audit policy. No role/grant/login changes.
-- Run only via verified Supabase CST-DEV project after isolated QA PASS.
-- This is NOT a trusted Operations root installation or dispatch authority.
BEGIN;
DO $cst_onejob_root_preflight$
DECLARE
  p record;
BEGIN
  IF current_database()<>'postgres' OR
     current_setting('server_version_num')::integer<160000 THEN
    RAISE EXCEPTION 'CST_DEV_DATABASE_OR_VERSION_REQUIRED';
  END IF;
  IF to_regclass('ai_platform.ai_audit_logs') IS NULL OR
     to_regclass('ai_platform.cst_onejob_owner_approvals') IS NULL OR
     to_regclass('ai_platform.ai_jobs') IS NULL THEN
    RAISE EXCEPTION 'CST_DEV_ONEJOB_SCHEMA_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals)<>0 THEN
    RAISE EXCEPTION 'OWNER_APPROVALS_EXIST_REVIEW_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles
     WHERE rolname='cst_team_model_pilot_writer' AND NOT rolcanlogin
       AND NOT rolbypassrls AND NOT rolsuper) OR
     NOT EXISTS (SELECT 1 FROM pg_roles
     WHERE rolname='cst_team_model_pilot_stage_login' AND NOT rolcanlogin
       AND NOT rolbypassrls AND NOT rolsuper) THEN
    RAISE EXCEPTION 'DEDICATED_STAGE_ROLES_NOT_LOCKED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c
      WHERE c.oid='ai_platform.ai_audit_logs'::regclass
        AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'AUDIT_TABLE_RLS_NOT_ENABLED';
  END IF;
  SELECT pol.polname,pol.polpermissive,pol.polcmd,pol.polroles,
    pg_get_expr(pol.polwithcheck,pol.polrelid) AS predicate
    INTO p FROM pg_policy pol
    WHERE pol.polrelid='ai_platform.ai_audit_logs'::regclass
      AND pol.polname='cst_onejob_stage_audit_insert';
  IF NOT FOUND OR p.polpermissive IS NOT TRUE OR p.polcmd<>'a'
     OR NOT 'cst_team_model_pilot_writer'::regrole=ANY(p.polroles)
     OR position('dispatchPermitted' in p.predicate)<=0
     OR position('owner_approved_waiting_job' in p.predicate)<=0 THEN
    RAISE EXCEPTION 'CANONICAL_OWNER_AUDIT_POLICY_NOT_VERIFIED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy
      WHERE polrelid='ai_platform.ai_audit_logs'::regclass
        AND polname='cst_onejob_stage_ops_root_binding') THEN
    RAISE EXCEPTION 'ROOT_BINDING_POLICY_ALREADY_EXISTS';
  END IF;
END
$cst_onejob_root_preflight$;

CREATE POLICY cst_onejob_stage_ops_root_binding ON ai_platform.ai_audit_logs
 AS RESTRICTIVE FOR INSERT TO cst_team_model_pilot_writer
 WITH CHECK (
   module='cst-onejob' AND action='owner_approved_waiting_job'
   AND resource_type='ai_job' AND status='success'
   AND details->>'operationsRootCandidateSha256'=
      '65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b'
   AND details->>'sameSuperAdminRootSelection'='true'
   AND details->>'operationsRootTrusted'='false'
   AND details->>'independentQaAdmissionVerified'='false'
   AND details->>'dispatchPermitted'='false'
 );

DO $cst_onejob_root_postflight$
DECLARE
 p record;
BEGIN
 SELECT pol.polpermissive,pol.polcmd,pol.polroles,
        pg_get_expr(pol.polwithcheck,pol.polrelid) AS predicate
   INTO p FROM pg_policy pol
   WHERE pol.polrelid='ai_platform.ai_audit_logs'::regclass
     AND pol.polname='cst_onejob_stage_ops_root_binding';
 IF NOT FOUND OR p.polpermissive IS NOT FALSE OR p.polcmd<>'a' OR
    NOT 'cst_team_model_pilot_writer'::regrole=ANY(p.polroles) OR
    position('operationsRootCandidateSha256' in p.predicate)=0 OR
    position('65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b'
             in p.predicate)=0 OR
    position('operationsRootTrusted' in p.predicate)=0 OR
    position('independentQaAdmissionVerified' in p.predicate)=0 THEN
    RAISE EXCEPTION 'RESTRICTIVE_OPERATIONS_ROOT_POLICY_NOT_VERIFIED';
 END IF;
 IF (SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals)<>0 OR
    has_table_privilege('cst_team_model_pilot_writer','ai_platform.ai_jobs','UPDATE')
    OR has_table_privilege('cst_team_model_pilot_writer','ai_platform.ai_jobs','DELETE')
    OR has_table_privilege('cst_team_model_pilot_writer',
         'ai_platform.cst_onejob_owner_approvals','UPDATE') THEN
   RAISE EXCEPTION 'UNEXPECTED_STAGING_SIDE_EFFECT';
 END IF;
END
$cst_onejob_root_postflight$;
COMMIT;
