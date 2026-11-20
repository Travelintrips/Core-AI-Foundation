-- DISPOSABLE-ONLY feasibility fixture. NOT a migration, NOT for CST-DEV/PROD.
-- The existing SECURITY INVOKER admit_verified_onejob implementation is reused.
-- A distinct NOLOGIN function owner is the *only* role holding DML grants.
-- Broker may EXECUTE the narrow wrapper, but receives no table UPDATE/INSERT.
-- Only a separately custodied QA service can create validated receipt rows.
-- No real password, signer, job, credentials, or service is created here.
DO $guard$
BEGIN
 IF current_database() <> 'cst_onejob_capability_disposable' OR
    current_setting('cst.onejob_disposable_only', true) IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'CAPABILITY_FIXTURE_DISPOSABLE_ONLY'; END IF;
END
$guard$;
CREATE ROLE cst_onejob_admission_executor NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE cst_onejob_admission_broker NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE cst_onejob_broker_login LOGIN NOINHERIT NOBYPASSRLS;
GRANT cst_onejob_admission_broker TO cst_onejob_broker_login
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
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
-- Base table owners remain postgres in this disposable fixture.
ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_audit_logs FORCE ROW LEVEL SECURITY;
-- Mirror the ACTUAL CST-DEV internal_users RLS baseline. Column SELECT alone
-- is not enough: a non-owner SECURITY DEFINER executor needs a SELECT policy.
-- FORCE RLS is used here ONLY in the disposable fixture (not live migration).
ALTER TABLE ai_platform.internal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.internal_users FORCE ROW LEVEL SECURITY;
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
SET search_path=pg_catalog
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
