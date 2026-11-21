-- SECURITY/OPERATIONS REVIEW CANDIDATE ONLY. NOT DEPLOYABLE BY DEFAULT.
-- Source for the existing CST-DEV xssrfshdrtdfupgqwfdw integration ONLY.
-- Intentionally fails closed before ANY DDL, unless an independent reviewer
-- has signed the exact code/database change and deliberately removes the
-- guard in a separately tracked, approved, one-job deployment.
-- DO NOT APPLY TO PROD. DO NOT CREATE CREDENTIALS, LOGIN, KMS OR DISPATCH.
-- Rollback source: cst-onejob-admission-capability.ROLLBACK-REVIEW-ONLY.sql
BEGIN;
-- CST_ONEJOB_REVIEW_ONLY_GUARD_BEGIN
DO $deny_unapproved$
BEGIN
  RAISE EXCEPTION 'CST_DEV_ADMISSION_CAPABILITY_NOT_AUTHORIZED_REVIEW_ONLY';
END
$deny_unapproved$;
-- CST_ONEJOB_REVIEW_ONLY_GUARD_END
DO $preflight$
DECLARE
  v_role record;
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'CST_DEV_POSTGRES_VERSION_MISMATCH';
  END IF;
  IF to_regclass('ai_platform.ai_jobs') IS NULL
     OR to_regclass('ai_platform.cst_onejob_owner_approvals') IS NULL
     OR to_regclass('ai_platform.internal_users') IS NULL
     OR to_regclass('ai_platform.ai_audit_logs') IS NULL
     OR to_regclass('cst_onejob_private.verified_admission_receipts') IS NULL
     OR to_regclass('cst_onejob_private.admission_receipt_consumptions') IS NULL
     OR to_regclass('cst_onejob_private.admission_event_outbox') IS NULL
  THEN RAISE EXCEPTION 'EXISTING_CST_DEV_SCHEMA_REQUIRED'; END IF;
  FOR v_role IN SELECT rolname,rolcanlogin,rolbypassrls,rolconnlimit
           FROM pg_roles WHERE rolname IN
           ('cst_onejob_broker_login','cst_onejob_admission_broker')
  LOOP
    IF v_role.rolcanlogin OR v_role.rolbypassrls OR v_role.rolconnlimit<>0 THEN
      RAISE EXCEPTION 'LOCKED_BROKER_ROLE_DRIFT'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
     ('cst_onejob_broker_login','cst_onejob_admission_broker'))<>2 THEN
    RAISE EXCEPTION 'EXISTING_BROKER_ROLES_MISSING'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cst_onejob_admission_executor')
     OR to_regprocedure('cst_onejob_private.admit_verified_onejob_capability(integer,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'CAPABILITY_ALREADY_EXISTS'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname='cst_onejob_admission_broker'
      AND (has_table_privilege(r.rolname,'ai_platform.ai_jobs','UPDATE')
        OR has_table_privilege(r.rolname,'ai_platform.ai_jobs','SELECT')
        OR has_table_privilege(r.rolname,
          'cst_onejob_private.verified_admission_receipts','SELECT'))
  ) THEN RAISE EXCEPTION 'BROKER_RAW_TABLE_PRIVILEGE_DRIFT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='cst_onejob_private'
        AND p.proname='admit_verified_onejob'
        AND pg_get_function_identity_arguments(p.oid)='p_job_id integer, p_verified_nonce text, p_verified_digest text'
        AND p.prosecdef=false)
  THEN RAISE EXCEPTION 'EXISTING_ATOMIC_INVOKER_MISSING'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid IN ('ai_platform.ai_jobs'::regclass,
      'ai_platform.cst_onejob_owner_approvals'::regclass,
      'ai_platform.internal_users'::regclass,
      'ai_platform.ai_audit_logs'::regclass,
      'cst_onejob_private.verified_admission_receipts'::regclass,
      'cst_onejob_private.admission_receipt_consumptions'::regclass,
      'cst_onejob_private.admission_event_outbox'::regclass)
      AND c.relrowsecurity=false
  ) THEN RAISE EXCEPTION 'RLS_REQUIRED_FOR_EXISTING_TABLES'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid=m.member
    JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE member.rolname='cst_onejob_broker_login'
      AND parent.rolname='cst_onejob_admission_broker'
      AND m.inherit_option=false AND m.set_option=true AND m.admin_option=false
  ) THEN RAISE EXCEPTION 'BROKER_MEMBERSHIP_DRIFT'; END IF;
END
$preflight$;
-- Existing broker roles and login identities are NOT created or activated.
-- NOLOGIN executor alone is introduced, never granted to broker as member.
CREATE ROLE cst_onejob_admission_executor
  NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;

REVOKE ALL ON SCHEMA cst_onejob_private FROM PUBLIC;
GRANT USAGE ON SCHEMA cst_onejob_private TO
  cst_onejob_admission_executor, cst_onejob_admission_broker;
GRANT USAGE ON SCHEMA ai_platform TO cst_onejob_admission_executor;
-- The executor, not the broker login, owns the following narrowly scoped DML.
GRANT SELECT ON
  ai_platform.ai_jobs,ai_platform.cst_onejob_owner_approvals,
  cst_onejob_private.verified_admission_receipts
  TO cst_onejob_admission_executor;
GRANT SELECT(id,account_type,role,status) ON ai_platform.internal_users
  TO cst_onejob_admission_executor;
GRANT UPDATE(status) ON ai_platform.ai_jobs TO cst_onejob_admission_executor;
GRANT UPDATE(status,consumed_at) ON ai_platform.cst_onejob_owner_approvals
  TO cst_onejob_admission_executor;
GRANT UPDATE(consumed_at) ON cst_onejob_private.verified_admission_receipts
  TO cst_onejob_admission_executor;
GRANT INSERT ON
  ai_platform.ai_audit_logs,
  cst_onejob_private.admission_receipt_consumptions,
  cst_onejob_private.admission_event_outbox
  TO cst_onejob_admission_executor;
GRANT USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq
  TO cst_onejob_admission_executor;
-- All existing CST-DEV table RLS settings are preserved exactly.
-- The new non-owner executor is subject to existing RLS without FORCE flips.
-- internal_users grants only four non-secret columns plus exact Owner policy.
CREATE POLICY cst_capability_owner_read ON ai_platform.internal_users
  FOR SELECT TO cst_onejob_admission_executor
  USING (account_type='internal' AND role='owner' AND status='active');
-- Existing owner and receipt tables already have FORCE RLS.
CREATE POLICY cst_capability_job_read ON ai_platform.ai_jobs FOR SELECT
  TO cst_onejob_admission_executor
  USING (id>482 AND status IN ('waiting','queued')
      AND job_type='ollama_model_invocation'
      AND required_capability='ollama_inference'
      AND payload_json->>'modelId'='qwen2.5:3b'
      AND payload_json->>'requestId' ~
        '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$');
CREATE POLICY cst_capability_job_update ON ai_platform.ai_jobs FOR UPDATE
  TO cst_onejob_admission_executor
  USING (id>482 AND status='waiting' AND job_type='ollama_model_invocation'
      AND required_capability='ollama_inference'
      AND payload_json->>'modelId'='qwen2.5:3b'
      AND payload_json->>'requestId' ~
        '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$')
  WITH CHECK (id>482 AND status='queued' AND job_type='ollama_model_invocation'
      AND required_capability='ollama_inference'
      AND payload_json->>'modelId'='qwen2.5:3b'
      AND payload_json->>'requestId' ~
        '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$');
CREATE POLICY cst_capability_approval_read
  ON ai_platform.cst_onejob_owner_approvals FOR SELECT
  TO cst_onejob_admission_executor
  USING (company_id='1' AND purpose='CST_DEV_ONEJOB_MODEL'
      AND model_id='qwen2.5:3b');
CREATE POLICY cst_capability_approval_update
  ON ai_platform.cst_onejob_owner_approvals FOR UPDATE
  TO cst_onejob_admission_executor
  USING (company_id='1' AND status='APPROVED'
      AND purpose='CST_DEV_ONEJOB_MODEL')
  WITH CHECK (company_id='1' AND status='CONSUMED'
      AND purpose='CST_DEV_ONEJOB_MODEL');
CREATE POLICY cst_capability_receipt_read
  ON cst_onejob_private.verified_admission_receipts FOR SELECT
  TO cst_onejob_admission_executor USING (company_id='1');
CREATE POLICY cst_capability_receipt_update
  ON cst_onejob_private.verified_admission_receipts FOR UPDATE
  TO cst_onejob_admission_executor
  USING (company_id='1' AND consumed_at IS NULL)
  WITH CHECK (company_id='1' AND consumed_at IS NOT NULL);
CREATE POLICY cst_capability_consumption_insert
  ON cst_onejob_private.admission_receipt_consumptions FOR INSERT
  TO cst_onejob_admission_executor
  WITH CHECK (project_id='xssrfshdrtdfupgqwfdw');
CREATE POLICY cst_capability_outbox_insert
  ON cst_onejob_private.admission_event_outbox FOR INSERT
  TO cst_onejob_admission_executor
  WITH CHECK (project_id='xssrfshdrtdfupgqwfdw'
      AND event_type='cst_onejob.admitted');
CREATE POLICY cst_capability_audit_insert ON ai_platform.ai_audit_logs
  FOR INSERT TO cst_onejob_admission_executor
  WITH CHECK (module='cst-onejob' AND action='signed_admission_queued'
      AND status='success');
-- Explicitly revoke the old SECURITY INVOKER RPC from the broker.
REVOKE ALL ON FUNCTION
  cst_onejob_private.admit_verified_onejob(integer,text,text)
  FROM PUBLIC, cst_onejob_admission_broker, cst_onejob_broker_login;
GRANT EXECUTE ON FUNCTION
  cst_onejob_private.admit_verified_onejob(integer,text,text)
  TO cst_onejob_admission_executor;
CREATE FUNCTION cst_onejob_private.admit_verified_onejob_capability(
  p_job_id integer,p_nonce text,p_digest text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE admitted integer;
BEGIN
 IF session_user <> 'cst_onejob_broker_login'
    OR current_user <> 'cst_onejob_admission_executor'
 THEN RAISE EXCEPTION 'ONEJOB_CAPABILITY_CALLER_DENIED'; END IF;
 IF p_job_id IS NULL OR p_job_id <= 482 THEN
   RAISE EXCEPTION 'ONEJOB_CAPABILITY_NEW_JOB_REQUIRED'; END IF;
 -- The existing signed-admission business contract remains authoritative:
 -- independently issued PRE receipt, active Owner approval, locked job,
 -- one-use nonce, audit and outbox, all in ONE transaction.
 SELECT cst_onejob_private.admit_verified_onejob(p_job_id,p_nonce,p_digest)
   INTO admitted;
 RETURN admitted;
END
$fn$;
REVOKE ALL ON FUNCTION
 cst_onejob_private.admit_verified_onejob_capability(integer,text,text)
 FROM PUBLIC;
-- A transient schema CREATE grant is used ONLY for ownership transfer.
GRANT CREATE ON SCHEMA cst_onejob_private TO cst_onejob_admission_executor;
ALTER FUNCTION cst_onejob_private.admit_verified_onejob_capability(integer,text,text)
 OWNER TO cst_onejob_admission_executor;
REVOKE CREATE ON SCHEMA cst_onejob_private FROM cst_onejob_admission_executor;
GRANT EXECUTE ON FUNCTION
 cst_onejob_private.admit_verified_onejob_capability(integer,text,text)
 TO cst_onejob_admission_broker;
-- The broker has no table DML grants; the executor has NOLOGIN and cannot be
-- assumed by the broker, preserving the SQL enforcement boundary.


-- Postflight verifies SQL-only role and direct table security boundaries.
DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='cst_onejob_admission_executor'
      AND rolcanlogin=false AND rolbypassrls=false AND rolconnlimit=0
  ) THEN RAISE EXCEPTION 'EXECUTOR_ROLE_NOT_LOCKED'; END IF;
  IF pg_has_role('cst_onejob_broker_login',
    'cst_onejob_admission_executor','MEMBER')
    OR has_table_privilege('cst_onejob_admission_broker',
      'ai_platform.ai_jobs','SELECT')
    OR has_table_privilege('cst_onejob_admission_broker',
      'ai_platform.ai_jobs','UPDATE')
    OR has_table_privilege('cst_onejob_admission_broker',
      'cst_onejob_private.verified_admission_receipts','SELECT')
    OR has_function_privilege('cst_onejob_admission_broker',
      'cst_onejob_private.admit_verified_onejob(integer,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'DIRECT_BROKER_BYPASS_DETECTED'; END IF;
  IF NOT has_function_privilege('cst_onejob_admission_broker',
    'cst_onejob_private.admit_verified_onejob_capability(integer,text,text)','EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(
        p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=to_regprocedure(
        'cst_onejob_private.admit_verified_onejob_capability(integer,text,text)')
        AND a.grantee=0 AND a.privilege_type='EXECUTE')
    OR has_schema_privilege('cst_onejob_admission_executor',
      'cst_onejob_private','CREATE')
  THEN RAISE EXCEPTION 'SCOPED_CAPABILITY_OR_EXECUTOR_GRANTS_INVALID'; END IF;
END
$postflight$;
COMMIT;
