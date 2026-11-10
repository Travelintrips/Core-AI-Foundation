-- DEV-only additive storage contract for GPT02 Issue #159 approval intent evidence.
-- NOT applied by this PR. No signer, no key, no dispatch authority.
-- Existing approval_decisions remains unchanged.
CREATE TABLE IF NOT EXISTS gpt02_issue159_approval_intents (
  id TEXT PRIMARY KEY,
  source_decision_id TEXT NOT NULL REFERENCES approval_decisions(id),
  task_id INTEGER NOT NULL CHECK (task_id > 136),
  command_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  company_id TEXT NOT NULL CHECK (company_id = 'default'),
  claims_sha256 TEXT NOT NULL CHECK (
    length(claims_sha256) = 64 AND
    claims_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  actor_id TEXT NOT NULL CHECK (
    actor_id <> '' AND actor_id <> 'dev_approval_token'
  ),
  auth_method TEXT NOT NULL CHECK (auth_method = 'supabase_aal2'),
  role_at_decision TEXT NOT NULL CHECK (role_at_decision = 'super_admin'),
  decision TEXT NOT NULL CHECK (decision = 'APPROVE'),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms > 0),
  expires_at_ms INTEGER NOT NULL CHECK (
    expires_at_ms > recorded_at_ms AND
    expires_at_ms - recorded_at_ms <= 300000
  ),
  UNIQUE(task_id, command_id, attempt_id),
  UNIQUE(claims_sha256)
);
CREATE INDEX IF NOT EXISTS idx_gpt02_issue159_approval_intents_lookup
  ON gpt02_issue159_approval_intents(
    company_id, task_id, command_id, attempt_id
  );
