-- Supabase Auth subjects are not AI Task Hub operator subjects. This mapping
-- binds the authenticated OTP identity to the exact Hub operator namespace used
-- by approval claims and dual-account signatures. It grants no authority by itself.
CREATE TABLE IF NOT EXISTS gpt02_issue159_admin_operator_links (
  auth_user_id TEXT PRIMARY KEY CHECK (
    auth_user_id <> '' AND auth_user_id <> 'dev_approval_token'
  ),
  hub_operator_id TEXT NOT NULL UNIQUE CHECK (
    hub_operator_id <> '' AND hub_operator_id <> 'dev_approval_token' AND
    hub_operator_id NOT GLOB '*[^A-Za-z0-9_.:@-]*'
  ),
  email TEXT NOT NULL CHECK (
    email <> '' AND instr(email, '@') > 1
  ),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gpt02_issue159_admin_operator_links_email
  ON gpt02_issue159_admin_operator_links(lower(email));

-- DEV-only additive storage contract for GPT02 Issue #159 single Super Admin approval evidence.
-- NOT an execution approval, signer, key, or dispatch authority.
-- This table is self-contained: legacy approval_decisions rows are coding_test
-- decisions and MUST NOT be reused as Issue159 approval provenance.
CREATE TABLE IF NOT EXISTS gpt02_issue159_approval_intents (
  id TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL CHECK (task_id > 139),
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
  auth_method TEXT NOT NULL CHECK (auth_method IN ('supabase_admin_session','supabase_aal2')),
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
    company_id, task_id, command_id, attempt_id, claims_sha256, actor_id
  );
