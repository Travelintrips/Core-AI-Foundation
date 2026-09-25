-- ============================================================================
-- Core AI Foundation — Multi-worker integration manifest approvals
--
-- Durable explicit approval + isolated verification state.
-- This migration is additive and does not create commits, push, or merge.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_integration_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE CASCADE,
  graph_id UUID NOT NULL REFERENCES ai_platform.ai_coding_task_graphs(id) ON DELETE CASCADE,
  manifest_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'APPROVED',
  approved_by TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verification_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_coding_integration_reviews_hash_check
    CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_coding_integration_reviews_status_check
    CHECK (status IN ('APPROVED','VERIFIED','FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_integration_reviews_graph_manifest_uidx
  ON ai_platform.ai_coding_integration_reviews (graph_id, manifest_hash);
CREATE INDEX IF NOT EXISTS ai_coding_integration_reviews_task_idx
  ON ai_platform.ai_coding_integration_reviews (task_id);
CREATE INDEX IF NOT EXISTS ai_coding_integration_reviews_graph_idx
  ON ai_platform.ai_coding_integration_reviews (graph_id);
CREATE INDEX IF NOT EXISTS ai_coding_integration_reviews_status_idx
  ON ai_platform.ai_coding_integration_reviews (status);
