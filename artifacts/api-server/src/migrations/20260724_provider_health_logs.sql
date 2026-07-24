-- Migration: Create ai_provider_health_logs table
-- Stores every health-check result so admins can see a timeline of provider
-- uptime, failures, and recovery events. Rows older than 30 days are pruned
-- automatically by providerHealthService.

CREATE TABLE IF NOT EXISTS ai_platform.ai_provider_health_logs (
  id            SERIAL PRIMARY KEY,
  provider_id   INTEGER NOT NULL
                  REFERENCES ai_platform.ai_providers(id) ON DELETE CASCADE,
  is_active     BOOLEAN NOT NULL,
  http_status   INTEGER,
  error         TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phlog_provider_checked
  ON ai_platform.ai_provider_health_logs(provider_id, checked_at DESC);
