-- Migration 002: Persistent signed URL revocations
-- Ensures that revoked download tokens remain revoked across process restarts.
-- The in-memory deny-list in signedUrlService.ts is seeded from this table on startup.

CREATE TABLE IF NOT EXISTS ai_platform.signed_url_revocations (
  token_id   TEXT        NOT NULL PRIMARY KEY,     -- the random nonce embedded in the token
  project_id INTEGER,                              -- creative_projects.id (informational)
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by TEXT,                                 -- admin email or system
  reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_signed_url_revocations_revoked_at
  ON ai_platform.signed_url_revocations (revoked_at);

COMMENT ON TABLE ai_platform.signed_url_revocations IS
  'Persistent signed URL token deny-list. Survives process restarts.';
