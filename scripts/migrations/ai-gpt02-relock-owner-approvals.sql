-- GPT02 CST-DEV: dedicated Owner-signed, one-use relock approval ledger.
-- This migration is NOT applied by the application at runtime. Deploy only
-- through the separately reviewed DEV migration gate after security review.

CREATE TABLE IF NOT EXISTS ai_platform.gpt02_relock_owner_approval_challenges (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope = 'GPT02_RELOCK_CST_DEV'),
  owner_subject TEXT NOT NULL,
  owner_auth_supabase_id UUID NOT NULL,
  owner_email TEXT NOT NULL,
  worker_principal TEXT NOT NULL CHECK (worker_principal = 'openclaw-vps-main'),
  environment TEXT NOT NULL CHECK (environment = 'DEV'),
  project_id TEXT NOT NULL CHECK (project_id = 'xssrfshdrtdfupgqwfdw'),
  request_id UUID NOT NULL UNIQUE,
  manifest_json JSONB NOT NULL,
  manifest_sha256 CHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  nonce_hash CHAR(64) NOT NULL UNIQUE CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONSUMED','EXPIRED','REJECTED')),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gpt02_relock_challenge_ttl_check CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '120 seconds'),
  CONSTRAINT gpt02_relock_challenge_consumed_check CHECK (
    (status = 'CONSUMED' AND consumed_at IS NOT NULL) OR
    (status <> 'CONSUMED' AND consumed_at IS NULL)
  ),
  CONSTRAINT gpt02_relock_manifest_scope_check CHECK (
    manifest_json->>'scope' = 'GPT02_RELOCK_CST_DEV' AND
    manifest_json->>'environment' = 'DEV' AND
    manifest_json->>'projectId' = 'xssrfshdrtdfupgqwfdw' AND
    manifest_json->>'workerPrincipal' = 'openclaw-vps-main'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS gpt02_relock_one_pending_owner_challenge_uidx
  ON ai_platform.gpt02_relock_owner_approval_challenges(scope)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS gpt02_relock_owner_challenges_expiry_idx
  ON ai_platform.gpt02_relock_owner_approval_challenges(status, expires_at);

CREATE TABLE IF NOT EXISTS ai_platform.gpt02_relock_owner_approval_decisions (
  challenge_id UUID PRIMARY KEY REFERENCES ai_platform.gpt02_relock_owner_approval_challenges(id),
  scope TEXT NOT NULL CHECK (scope = 'GPT02_RELOCK_CST_DEV'),
  owner_subject TEXT NOT NULL,
  owner_auth_supabase_id UUID NOT NULL,
  owner_email TEXT NOT NULL,
  worker_principal TEXT NOT NULL CHECK (worker_principal = 'openclaw-vps-main'),
  manifest_sha256 CHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  signed_session_sha256 CHAR(64) NOT NULL CHECK (signed_session_sha256 ~ '^[0-9a-f]{64}$'),
  approval_method TEXT NOT NULL CHECK (approval_method = 'FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION'),
  decision TEXT NOT NULL CHECK (decision = 'APPROVED'),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION ai_platform.gpt02_relock_approval_challenge_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'GPT02_RELOCK_CHALLENGE_DELETE_DENIED';
  END IF;
  IF (NEW.id, NEW.scope, NEW.owner_subject, NEW.owner_auth_supabase_id,
      NEW.owner_email, NEW.worker_principal, NEW.environment, NEW.project_id,
      NEW.request_id, NEW.manifest_json, NEW.manifest_sha256, NEW.nonce_hash,
      NEW.issued_at, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.scope, OLD.owner_subject, OLD.owner_auth_supabase_id,
      OLD.owner_email, OLD.worker_principal, OLD.environment, OLD.project_id,
      OLD.request_id, OLD.manifest_json, OLD.manifest_sha256, OLD.nonce_hash,
      OLD.issued_at, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'GPT02_RELOCK_CHALLENGE_IMMUTABLE_FIELDS';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('CONSUMED','EXPIRED') THEN
    RAISE EXCEPTION 'GPT02_RELOCK_CHALLENGE_TRANSITION_DENIED';
  END IF;
  IF NEW.status = 'CONSUMED' AND NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'GPT02_RELOCK_CHALLENGE_CONSUMPTION_TIMESTAMP_REQUIRED';
  END IF;
  IF NEW.status = 'EXPIRED' AND NEW.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'GPT02_RELOCK_EXPIRED_CHALLENGE_CANNOT_BE_CONSUMED';
  END IF;
  IF NEW.status = 'EXPIRED' AND OLD.expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'GPT02_RELOCK_ACTIVE_CHALLENGE_CANNOT_BE_EXPIRED';
  END IF;
  IF NEW.status = 'CONSUMED' AND OLD.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'GPT02_RELOCK_EXPIRED_CHALLENGE_CANNOT_BE_CONSUMED';
  END IF;
  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS gpt02_relock_owner_challenge_immutable ON ai_platform.gpt02_relock_owner_approval_challenges;
CREATE TRIGGER gpt02_relock_owner_challenge_immutable
  BEFORE UPDATE OR DELETE ON ai_platform.gpt02_relock_owner_approval_challenges
  FOR EACH ROW EXECUTE FUNCTION ai_platform.gpt02_relock_approval_challenge_guard();

CREATE OR REPLACE FUNCTION ai_platform.gpt02_relock_approval_decision_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $guard$
DECLARE challenge ai_platform.gpt02_relock_owner_approval_challenges%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'GPT02_RELOCK_APPROVAL_DECISION_APPEND_ONLY';
  END IF;
  SELECT * INTO challenge
    FROM ai_platform.gpt02_relock_owner_approval_challenges
   WHERE id = NEW.challenge_id
   FOR KEY SHARE;
  IF NOT FOUND OR challenge.status <> 'CONSUMED'
     OR challenge.scope <> NEW.scope
     OR challenge.owner_subject <> NEW.owner_subject
     OR challenge.owner_auth_supabase_id <> NEW.owner_auth_supabase_id
     OR lower(challenge.owner_email) <> lower(NEW.owner_email)
     OR challenge.worker_principal <> NEW.worker_principal
     OR challenge.manifest_sha256 <> NEW.manifest_sha256
     OR challenge.environment <> 'DEV'
     OR challenge.project_id <> 'xssrfshdrtdfupgqwfdw'
     OR challenge.expires_at <= NEW.decided_at
     OR NEW.approval_method <> 'FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION'
  THEN
    RAISE EXCEPTION 'GPT02_RELOCK_APPROVAL_DECISION_CHALLENGE_MISMATCH';
  END IF;
  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS gpt02_relock_owner_decision_guard ON ai_platform.gpt02_relock_owner_approval_decisions;
CREATE TRIGGER gpt02_relock_owner_decision_guard
  BEFORE INSERT OR UPDATE OR DELETE ON ai_platform.gpt02_relock_owner_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION ai_platform.gpt02_relock_approval_decision_guard();

REVOKE ALL ON ai_platform.gpt02_relock_owner_approval_challenges FROM PUBLIC;
REVOKE ALL ON ai_platform.gpt02_relock_owner_approval_decisions FROM PUBLIC;

-- Trigger functions are invoked only by their attached triggers. Do not leave
-- the default PUBLIC EXECUTE privilege on either implementation function.
REVOKE ALL ON FUNCTION ai_platform.gpt02_relock_approval_challenge_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_platform.gpt02_relock_approval_decision_guard() FROM PUBLIC;
