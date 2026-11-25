-- CST-DEV Task190: irreversible claim-before-external-consume boundary.
-- Separate from recovery receipts and completion records. NO runtime grants.
-- This source is inert until a separately authenticated custodian uses it.
BEGIN;
CREATE TABLE IF NOT EXISTS gpt02_task190_execution_custody.claims (
  claim_id uuid PRIMARY KEY,
  company_id text NOT NULL CHECK(company_id='default'),
  task_id integer NOT NULL CHECK(task_id=190),
  execution_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  owner_subject text NOT NULL CHECK(owner_subject ~ '^owner:google_[A-Za-z0-9_-]{6,120}$'),
  challenge_id uuid NOT NULL,
  authority_ref text NOT NULL CHECK(length(authority_ref) BETWEEN 16 AND 256),
  issuer_proof_sha256 text NOT NULL CHECK(issuer_proof_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT task190_claim_one_attempt UNIQUE(company_id,task_id,attempt_id),
  CONSTRAINT task190_claim_one_authority UNIQUE(authority_ref),
  CONSTRAINT task190_claim_one_challenge UNIQUE(challenge_id)
);
REVOKE ALL ON TABLE gpt02_task190_execution_custody.claims FROM PUBLIC;

-- A claimed attempt is NOT automatically retryable after crash/timeout.
-- Only an independently verified completed receipt can resolve ambiguity;
-- this ledger never issues a new chance or authorizes dispatch.
CREATE OR REPLACE FUNCTION gpt02_task190_execution_custody.guard_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $body$
BEGIN
  IF NEW.expires_at <= clock_timestamp() OR
     NEW.expires_at > clock_timestamp() + interval '120 seconds' THEN
    RAISE EXCEPTION 'TASK190_CLAIM_AUTHORITY_EXPIRED_OR_OVERSCOPED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION gpt02_task190_execution_custody.guard_claim() FROM PUBLIC;
DROP TRIGGER IF EXISTS task190_claim_fresh ON gpt02_task190_execution_custody.claims;
CREATE TRIGGER task190_claim_fresh BEFORE INSERT
ON gpt02_task190_execution_custody.claims FOR EACH ROW
EXECUTE FUNCTION gpt02_task190_execution_custody.guard_claim();

DROP TRIGGER IF EXISTS task190_claim_immutable ON gpt02_task190_execution_custody.claims;
CREATE TRIGGER task190_claim_immutable BEFORE UPDATE OR DELETE
ON gpt02_task190_execution_custody.claims FOR EACH ROW
EXECUTE FUNCTION gpt02_task190_execution_custody.deny_mutation();

-- Explicitly no GRANT, role, password, decision or dispatch mutation.
COMMIT;
