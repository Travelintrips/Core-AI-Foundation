-- CST-DEV Task190: inert durable consumption ledger, NOT an execution permission.
-- Install only in an independently approved DEV rollout. No live role grants,
-- public RPC, signer, dispatch, or recovered historical receipt.
BEGIN;
CREATE SCHEMA IF NOT EXISTS gpt02_task190_execution_custody;
REVOKE ALL ON SCHEMA gpt02_task190_execution_custody FROM PUBLIC;

CREATE TABLE IF NOT EXISTS gpt02_task190_execution_custody.consumptions (
  receipt_id uuid PRIMARY KEY,
  company_id text NOT NULL CHECK (company_id = 'default'),
  task_id integer NOT NULL CHECK (task_id = 190),
  execution_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  owner_subject text NOT NULL CHECK (owner_subject ~ '^owner:google_[A-Za-z0-9_-]{6,120}$'),
  challenge_id uuid NOT NULL,
  authority_ref text NOT NULL CHECK (length(authority_ref) BETWEEN 16 AND 256),
  issuer_proof_sha256 text NOT NULL CHECK (issuer_proof_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_sha256 text NOT NULL CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT task190_custody_expiry CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '120 seconds'
  ),
  CONSTRAINT task190_custody_one_attempt UNIQUE (company_id, task_id, attempt_id),
  CONSTRAINT task190_custody_one_authority UNIQUE (authority_ref),
  CONSTRAINT task190_custody_one_challenge UNIQUE (challenge_id)
);

REVOKE ALL ON TABLE gpt02_task190_execution_custody.consumptions FROM PUBLIC;

CREATE OR REPLACE FUNCTION gpt02_task190_execution_custody.deny_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'TASK190_CUSTODY_APPEND_ONLY' USING ERRCODE = '23514';
END
$fn$;

REVOKE ALL ON FUNCTION gpt02_task190_execution_custody.deny_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS task190_consumption_immutable ON gpt02_task190_execution_custody.consumptions;
CREATE TRIGGER task190_consumption_immutable
BEFORE UPDATE OR DELETE ON gpt02_task190_execution_custody.consumptions
FOR EACH ROW EXECUTE FUNCTION gpt02_task190_execution_custody.deny_mutation();

-- No DB login role, INSERT/SELECT grant, security-definer writer,
-- verification bypass, permission issuance, or execution API is created.
COMMIT;
