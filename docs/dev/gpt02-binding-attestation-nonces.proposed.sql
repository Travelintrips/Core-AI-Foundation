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
 CONSTRAINT dev_gpt02_nonce_receiver_once UNIQUE(hub_execution_job_id)
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
