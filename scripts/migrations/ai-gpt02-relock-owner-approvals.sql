-- GPT02 CST-DEV Owner approval ledger.
-- Apply using the Supabase DEV postgres migration session after the bootstrap
-- step has temporarily granted that session SET ROLE through the runtime
-- grantor. The NOLOGIN role owns this private schema. Runtime gets only the
-- RLS-scoped DML below; both temporary role memberships are removed before
-- the migration finishes / immediately after it completes.

SET ROLE gpt02_relock_owner_approval_owner;

DO $schema_guard$
BEGIN
  IF current_user <> 'gpt02_relock_owner_approval_owner' THEN
    RAISE EXCEPTION 'GPT02_LEDGER_MIGRATION_REQUIRES_DEDICATED_NOLOGIN_OWNER';
  END IF;
END
$schema_guard$;

CREATE SCHEMA IF NOT EXISTS gpt02_owner_approval;
REVOKE ALL ON SCHEMA gpt02_owner_approval FROM PUBLIC, anon, authenticated, service_role, aicore_dev_runtime;
GRANT USAGE ON SCHEMA gpt02_owner_approval TO aicore_dev_runtime;

CREATE TABLE IF NOT EXISTS gpt02_owner_approval.gpt02_relock_owner_approval_challenges (
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
  ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges(scope)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS gpt02_relock_owner_challenges_expiry_idx
  ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges(status, expires_at);

CREATE TABLE IF NOT EXISTS gpt02_owner_approval.gpt02_relock_owner_approval_decisions (
  challenge_id UUID PRIMARY KEY REFERENCES gpt02_owner_approval.gpt02_relock_owner_approval_challenges(id),
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

CREATE OR REPLACE FUNCTION gpt02_owner_approval.gpt02_relock_approval_challenge_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, gpt02_owner_approval AS $guard$
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

DROP TRIGGER IF EXISTS gpt02_relock_owner_challenge_immutable
  ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges;
CREATE TRIGGER gpt02_relock_owner_challenge_immutable
  BEFORE UPDATE OR DELETE ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  FOR EACH ROW EXECUTE FUNCTION gpt02_owner_approval.gpt02_relock_approval_challenge_guard();

CREATE OR REPLACE FUNCTION gpt02_owner_approval.gpt02_relock_approval_decision_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, gpt02_owner_approval AS $guard$
DECLARE challenge gpt02_owner_approval.gpt02_relock_owner_approval_challenges%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'GPT02_RELOCK_APPROVAL_DECISION_APPEND_ONLY';
  END IF;
  SELECT * INTO challenge
    FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges
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

DROP TRIGGER IF EXISTS gpt02_relock_owner_decision_guard
  ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions;
CREATE TRIGGER gpt02_relock_owner_decision_guard
  BEFORE INSERT OR UPDATE OR DELETE ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION gpt02_owner_approval.gpt02_relock_approval_decision_guard();

-- The ledger schema is not exposed through the Data API. RLS adds a second
-- boundary for the application runtime, even if another grant is introduced.
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_decisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gpt02_owner_challenge_select_runtime ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges;
CREATE POLICY gpt02_owner_challenge_select_runtime
  ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  FOR SELECT TO aicore_dev_runtime
  USING (scope = 'GPT02_RELOCK_CST_DEV' AND environment = 'DEV' AND project_id = 'xssrfshdrtdfupgqwfdw' AND worker_principal = 'openclaw-vps-main');
DROP POLICY IF EXISTS gpt02_owner_challenge_insert_runtime ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges;
CREATE POLICY gpt02_owner_challenge_insert_runtime
  ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  FOR INSERT TO aicore_dev_runtime
  WITH CHECK (scope = 'GPT02_RELOCK_CST_DEV' AND environment = 'DEV' AND project_id = 'xssrfshdrtdfupgqwfdw' AND worker_principal = 'openclaw-vps-main' AND status = 'PENDING');
DROP POLICY IF EXISTS gpt02_owner_challenge_update_runtime ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges;
CREATE POLICY gpt02_owner_challenge_update_runtime
  ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  FOR UPDATE TO aicore_dev_runtime
  USING (scope = 'GPT02_RELOCK_CST_DEV' AND status = 'PENDING')
  WITH CHECK (scope = 'GPT02_RELOCK_CST_DEV' AND status IN ('CONSUMED','EXPIRED'));

DROP POLICY IF EXISTS gpt02_owner_decision_select_runtime ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions;
CREATE POLICY gpt02_owner_decision_select_runtime
  ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions
  FOR SELECT TO aicore_dev_runtime
  USING (scope = 'GPT02_RELOCK_CST_DEV' AND worker_principal = 'openclaw-vps-main');
DROP POLICY IF EXISTS gpt02_owner_decision_insert_runtime ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions;
CREATE POLICY gpt02_owner_decision_insert_runtime
  ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions
  FOR INSERT TO aicore_dev_runtime
  WITH CHECK (scope = 'GPT02_RELOCK_CST_DEV' AND worker_principal = 'openclaw-vps-main' AND decision = 'APPROVED' AND approval_method = 'FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION');

REVOKE ALL ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION gpt02_owner_approval.gpt02_relock_approval_challenge_guard() FROM PUBLIC, anon, authenticated, service_role, aicore_dev_runtime;
REVOKE ALL ON FUNCTION gpt02_owner_approval.gpt02_relock_approval_decision_guard() FROM PUBLIC, anon, authenticated, service_role, aicore_dev_runtime;
GRANT SELECT, INSERT, UPDATE ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges TO aicore_dev_runtime;
GRANT SELECT, INSERT ON gpt02_owner_approval.gpt02_relock_owner_approval_decisions TO aicore_dev_runtime;

RESET ROLE;
-- The runtime grantor must first revoke its temporary SET ROLE membership to
-- the postgres migration session. The separate finalization migration then
-- removes this bootstrap membership from aicore_dev_runtime.
