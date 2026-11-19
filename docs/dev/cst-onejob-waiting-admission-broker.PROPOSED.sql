-- PROPOSED DEV-ONLY. NO LIVE APPLICATION, NO LOGIN/SECRET ISSUANCE.
-- Transaction-bound WAITING -> QUEUED with a narrow broker capability.
-- The grant goes only to a NOLOGIN role with no members. Authorization and
-- runtime/evidence verification must be independently established before any
-- separate rollout can make this role assumable.
-- SECURITY INVOKER is mandatory: no privileged function-owner bypass of RLS.
-- The NOLOGIN broker has no direct table grants, so this proposal stays denied.
CREATE ROLE cst_onejob_admission_broker NOLOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA IF NOT EXISTS cst_onejob_private;
REVOKE ALL ON SCHEMA cst_onejob_private FROM PUBLIC;
GRANT USAGE ON SCHEMA cst_onejob_private TO cst_onejob_admission_broker;

CREATE OR REPLACE FUNCTION cst_onejob_private.admit_waiting_job(
  p_approval_id uuid,
  p_expected_job_id integer,
  p_expected_request_id text,
  p_expected_worker_name text,
  p_expected_source_sha text
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_approval ai_platform.cst_onejob_owner_approvals%ROWTYPE;
  v_job ai_platform.ai_jobs%ROWTYPE;
  v_audit_id integer;
BEGIN
  IF current_database() <> 'cst_onejob_owner_ledger_fixture'
    AND current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'ONEJOB_WRONG_DATABASE';
  END IF;
  -- A PostgreSQL database name is not a Supabase project identity.
  -- The broker's network/credential provisioning must independently pin
  -- project xssrfshdrtdfupgqwfdw before enabling any caller.
  IF p_expected_job_id IS NULL OR p_expected_job_id <= 0
     OR p_expected_job_id = 482
     OR p_expected_request_id !~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
     OR p_expected_worker_name !~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'
     OR p_expected_source_sha !~ '^[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'ONEJOB_UNTRUSTED_ARGUMENTS';
  END IF;

  SELECT * INTO v_approval
  FROM ai_platform.cst_onejob_owner_approvals
  WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_approval.status <> 'APPROVED'
     OR v_approval.consumed_at IS NOT NULL OR v_approval.expires_at <= clock_timestamp()
     OR v_approval.approved_at > clock_timestamp()
     OR v_approval.company_id <> '1' OR v_approval.model_id <> 'qwen2.5:3b'
     OR v_approval.job_id <> p_expected_job_id
     OR v_approval.request_id <> p_expected_request_id
     OR v_approval.worker_name <> p_expected_worker_name
     OR v_approval.source_sha <> p_expected_source_sha THEN
    RAISE EXCEPTION 'ONEJOB_APPROVAL_NOT_ADMISSIBLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ai_platform.internal_users u
    WHERE u.id=v_approval.approved_by_user_id
      AND u.account_type='internal' AND u.role='owner' AND u.status='active'
  ) THEN RAISE EXCEPTION 'ONEJOB_OWNER_NOT_ACTIVE'; END IF;
  SELECT * INTO v_job FROM ai_platform.ai_jobs
   WHERE id=p_expected_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'waiting'
     OR v_job.job_type<>'ollama_model_invocation'
     OR v_job.required_capability<>'ollama_inference'
     OR v_job.max_retry<>0
     OR v_job.payload_json->>'requestId'<>p_expected_request_id
     OR v_job.payload_json->>'modelId'<>'qwen2.5:3b' THEN
    RAISE EXCEPTION 'ONEJOB_NOT_WAITING_MODEL'; END IF;

  -- A unique index must be installed and VALID, not merely a count visible
  -- through an RLS-restricted connection.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
    JOIN pg_catalog.pg_class tbl ON tbl.oid=i.indrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid=tbl.relnamespace
    WHERE ix.relname='ai_jobs_company1_pilot_request_unique'
      AND tbl.relname='ai_jobs' AND ns.nspname='ai_platform'
      AND i.indisunique AND i.indisready AND i.indisvalid
  ) THEN RAISE EXCEPTION 'ONEJOB_UNIQUE_INDEX_UNVERIFIED'; END IF;

  -- The external readiness/receipt evidence is deliberately NOT represented
  -- as a client-supplied boolean. A future verified one-use readiness ledger
  -- with pinned attestation and TTL is required to unlock this SQL function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cst_onejob_private'
      AND c.relname='verified_admission_receipts'
  ) THEN RAISE EXCEPTION 'ONEJOB_INDEPENDENT_READINESS_PROOF_MISSING'; END IF;

  -- With no verified receipt schema or verification implementation this
  -- proposed function is intentionally a non-authorizing scaffold.
  RAISE EXCEPTION 'ONEJOB_ATOMIC_ADMISSION_NOT_YET_AUTHORIZED';

  -- The future implementation must perform, in this same transaction:
  -- UPDATE ai_jobs SET status='queued' WHERE id=... AND status='waiting';
  -- UPDATE owner_approvals SET status='CONSUMED',consumed_at=now() ...;
  -- INSERT ai_audit_logs ... RETURNING id INTO v_audit_id;
  -- and fail unless all three affected-row checks and receipt consumption pass.
  RETURN v_job.id;
END;
$$;
REVOKE ALL ON FUNCTION cst_onejob_private.admit_waiting_job(uuid,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cst_onejob_private.admit_waiting_job(uuid,integer,text,text,text)
  TO cst_onejob_admission_broker;
-- This NOLOGIN broker has no membership grants, no direct table privileges,
-- and no usable session credentials. Do not activate or mount in a service.
