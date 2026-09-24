-- ============================================================================
-- Travelintrips / Core AI Foundation — Per-Workstream AI Handoff Leases
--
-- Durable, auditable, one-shot AI approval state for parallel coding
-- workstreams. Additive and idempotent. Does not invoke a model.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_workstream_ai_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL
    REFERENCES ai_platform.ai_coding_task_graphs(id) ON DELETE CASCADE,
  workstream_id UUID NOT NULL
    REFERENCES ai_platform.ai_coding_workstreams(id) ON DELETE CASCADE,
  claim_attempt INTEGER NOT NULL,
  package_version INTEGER NOT NULL DEFAULT 1,
  package_hash TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREPARED',
  package_json JSONB NOT NULL,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  consumed_execution_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_coding_workstream_ai_handoffs_status_check CHECK (
    status IN ('PREPARED','APPROVED','CONSUMED','REVOKED')
  ),
  CONSTRAINT ai_coding_workstream_ai_handoffs_claim_attempt_check CHECK (
    claim_attempt > 0
  ),
  CONSTRAINT ai_coding_workstream_ai_handoffs_package_version_check CHECK (
    package_version > 0
  ),
  CONSTRAINT ai_coding_workstream_ai_handoffs_package_hash_check CHECK (
    package_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ai_coding_workstream_ai_handoffs_plan_hash_check CHECK (
    plan_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ai_coding_workstream_ai_handoffs_base_sha_check CHECK (
    base_sha ~ '^[0-9a-f]{40}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_workstream_ai_handoffs_attempt_uidx
  ON ai_platform.ai_coding_workstream_ai_handoffs (
    workstream_id,
    claim_attempt
  );

CREATE INDEX IF NOT EXISTS ai_coding_workstream_ai_handoffs_graph_idx
  ON ai_platform.ai_coding_workstream_ai_handoffs (graph_id);

CREATE INDEX IF NOT EXISTS ai_coding_workstream_ai_handoffs_status_idx
  ON ai_platform.ai_coding_workstream_ai_handoffs (status);

CREATE INDEX IF NOT EXISTS ai_coding_workstream_ai_handoffs_expires_idx
  ON ai_platform.ai_coding_workstream_ai_handoffs (expires_at)
  WHERE expires_at IS NOT NULL;
