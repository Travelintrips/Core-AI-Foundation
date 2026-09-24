-- ============================================================================
-- Travelintrips / Core AI Foundation — AI Coding Multi-Worker Leases
--
-- Additive lease/heartbeat metadata for durable multi-worker claim ownership.
-- Does not execute workers or grant Git/model privileges.
-- ============================================================================

ALTER TABLE ai_platform.ai_coding_workstreams
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ai_coding_workstreams_lease_expires_idx
  ON ai_platform.ai_coding_workstreams (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_coding_workstreams_worker_idx
  ON ai_platform.ai_coding_workstreams (worker_id)
  WHERE worker_id IS NOT NULL;
