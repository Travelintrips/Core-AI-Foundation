-- CST-DEV ONLY / NO-RUNTIME-WRITE / NO-AUTHORIZATION.
-- This migration creates evidence storage only. It MUST NOT grant runtime
-- insertion or toggle any grant, dispatch, resume, or completion switch.
-- Run through Supabase apply_migration on verified project CST-DEV only.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
DO $guard$
BEGIN
 IF to_regnamespace('ai_platform') IS NULL
    OR to_regclass('ai_platform.ai_coding_bridge_commands') IS NULL
 THEN RAISE EXCEPTION 'GPT02_DEV_PROJECT_MARKER_MISSING'; END IF;
 IF to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NOT NULL
    OR to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NOT NULL
 THEN RAISE EXCEPTION 'GPT02_BINDING_EXISTING_SCHEMA_REVIEW_REQUIRED'; END IF;
END
$guard$;

-- DEV-ONLY PROPOSAL. NOT APPLIED. No worker dispatch / task assignment.
-- This is an append-only *evidence claim*, not an independently verified binding.
-- Apply ONLY in a disposable isolated PostgreSQL test database.
-- No cross-database FK can validate AI Task Hub's separate task namespace.
CREATE SCHEMA IF NOT EXISTS ai_platform;
CREATE TABLE IF NOT EXISTS ai_platform.dev_gpt02_task_attempt_binding_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL CHECK (tenant_id='default'),
 core_command_id uuid NOT NULL,
 core_coding_task_id uuid NOT NULL,
 hub_execution_job_id uuid NOT NULL,
 hub_ai_task_id integer NOT NULL CHECK (hub_ai_task_id>0),
 attempt_id uuid NOT NULL,
 attempt_number integer NOT NULL CHECK (attempt_number>=1),
 worker_id text NOT NULL CHECK (worker_id='openclaw-dell-chatgpt-wake-dev'),
 assignee_namespace text NOT NULL CHECK (assignee_namespace='ai_task_hub.public.ai_tasks.assigned_to_id'),
 assignee_id integer NOT NULL CHECK (assignee_id>0),
 owner_namespace text NOT NULL CHECK (owner_namespace='ai_task_hub.accountable_owner'),
 accountable_owner_id text NOT NULL CHECK (length(trim(accountable_owner_id))>0 AND length(accountable_owner_id)<=128),
 evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
 evidence_source text NOT NULL CHECK (evidence_source='independent_dev_attestation'),
 operator_user_id integer NOT NULL CHECK (operator_user_id>0),
 recorded_by text NOT NULL CHECK (recorded_by ~ '^internal:[1-9][0-9]*$'),
 CONSTRAINT claim_recorded_by_operator_identity CHECK (recorded_by='internal:'||operator_user_id::text),
 source_observed_at timestamptz NOT NULL,
 receiver_observed_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 -- None of these claims authorize any execution. No verification oracle exists yet.
 binding_verified boolean NOT NULL DEFAULT false CHECK (binding_verified=false),
 may_dispatch_worker boolean NOT NULL DEFAULT false CHECK (may_dispatch_worker=false),
 may_close_job boolean NOT NULL DEFAULT false CHECK (may_close_job=false),
 CONSTRAINT claim_freshness CHECK (source_observed_at<=created_at + interval '5 seconds'
   AND receiver_observed_at<=created_at + interval '5 seconds'),
 CONSTRAINT claim_core_command_once UNIQUE(core_command_id),
 CONSTRAINT claim_hub_execution_once UNIQUE(hub_execution_job_id),
 CONSTRAINT claim_attempt_once UNIQUE(attempt_id),
 CONSTRAINT claim_task_attempt_once UNIQUE(tenant_id,hub_ai_task_id,attempt_number),
 CONSTRAINT claim_evidence_digest_once UNIQUE(evidence_sha256),
 -- Redundant as a unique key, but required for composite FK provenance binding.
 CONSTRAINT claim_nonce_provenance_tuple_once UNIQUE
  (tenant_id,core_command_id,hub_execution_job_id,attempt_id,evidence_sha256,operator_user_id)
);
-- Existing tables could predate this proposal: permissions and triggers must not drift.
CREATE OR REPLACE FUNCTION ai_platform.dev_gpt02_task_binding_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,ai_platform AS $body$
BEGIN
 RAISE EXCEPTION 'GPT02_TASK_BINDING_IMMUTABLE' USING ERRCODE='55000';
END;
$body$;
REVOKE ALL ON TABLE ai_platform.dev_gpt02_task_attempt_binding_claims FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_platform.dev_gpt02_task_binding_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS dev_gpt02_task_binding_immutable_trg ON ai_platform.dev_gpt02_task_attempt_binding_claims;
CREATE TRIGGER dev_gpt02_task_binding_immutable_trg
 BEFORE UPDATE OR DELETE ON ai_platform.dev_gpt02_task_attempt_binding_claims
 FOR EACH ROW EXECUTE FUNCTION ai_platform.dev_gpt02_task_binding_immutable();
-- No insert grants for runtime app, worker, anon or authenticated roles.
-- No role, signer, migration or endpoint is authorized to install this in DEV live.

-- DEV-ONLY DISPOSABLE TEST PROPOSAL, NOT APPLIED TO LIVE DATABASES.
-- Nonce evidence is not a grant, approval, dispatch token, or runtime signing authority.
CREATE SCHEMA IF NOT EXISTS ai_platform;
CREATE TABLE IF NOT EXISTS ai_platform.dev_gpt02_binding_attestation_nonces (
 nonce uuid PRIMARY KEY,
 tenant_id text NOT NULL CHECK (tenant_id='default'),
 core_command_id uuid NOT NULL,
 hub_execution_job_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 operator_user_id integer NOT NULL CHECK (operator_user_id>0),
 evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
 attestation_sha256 text NOT NULL UNIQUE CHECK (attestation_sha256 ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 may_issue_grant boolean NOT NULL DEFAULT false CHECK (may_issue_grant=false),
 may_dispatch_worker boolean NOT NULL DEFAULT false CHECK (may_dispatch_worker=false),
 CONSTRAINT dev_gpt02_nonce_window CHECK (expires_at>issued_at AND expires_at<=issued_at+interval '120 seconds'),
 CONSTRAINT dev_gpt02_nonce_recency CHECK (issued_at>=recorded_at-interval '120 seconds' AND issued_at<=recorded_at+interval '5 seconds'),
 CONSTRAINT dev_gpt02_nonce_expiry CHECK (expires_at>recorded_at),
 CONSTRAINT dev_gpt02_nonce_attempt_once UNIQUE(attempt_id),
 CONSTRAINT dev_gpt02_nonce_command_once UNIQUE(core_command_id),
 CONSTRAINT dev_gpt02_nonce_receiver_once UNIQUE(hub_execution_job_id),
 -- A reserved nonce cannot COMMIT without a matching binding claim, even if
 -- the nonce INSERT comes before the claim INSERT inside one transaction.
 CONSTRAINT dev_gpt02_nonce_binding_provenance_fk FOREIGN KEY
  (tenant_id,core_command_id,hub_execution_job_id,attempt_id,evidence_sha256,operator_user_id)
  REFERENCES ai_platform.dev_gpt02_task_attempt_binding_claims
  (tenant_id,core_command_id,hub_execution_job_id,attempt_id,evidence_sha256,operator_user_id)
  DEFERRABLE INITIALLY DEFERRED
);
CREATE OR REPLACE FUNCTION ai_platform.dev_gpt02_nonce_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,ai_platform AS $nonce_guard$
BEGIN
 RAISE EXCEPTION 'GPT02_NONCE_IMMUTABLE' USING ERRCODE='55000';
END;
$nonce_guard$;
REVOKE ALL ON TABLE ai_platform.dev_gpt02_binding_attestation_nonces FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_platform.dev_gpt02_nonce_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS dev_gpt02_nonce_immutable_trg ON ai_platform.dev_gpt02_binding_attestation_nonces;
CREATE TRIGGER dev_gpt02_nonce_immutable_trg
 BEFORE UPDATE OR DELETE ON ai_platform.dev_gpt02_binding_attestation_nonces
 FOR EACH ROW EXECUTE FUNCTION ai_platform.dev_gpt02_nonce_immutable();
-- Deliberately no runtime INSERT grants, no exposed API and no SECURITY DEFINER.

-- An explicit fail-closed final contract check at migration completion.
DO $verify$
BEGIN
 IF to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NULL
 OR to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NULL
 THEN RAISE EXCEPTION 'GPT02_EVIDENCE_SCHEMA_NOT_CREATED'; END IF;
 IF has_table_privilege('anon','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
 OR has_table_privilege('authenticated','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
 OR has_table_privilege('anon','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
 OR has_table_privilege('authenticated','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
 THEN RAISE EXCEPTION 'GPT02_UNINTENDED_APP_WRITE_GRANT'; END IF;
END
$verify$;
