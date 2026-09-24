-- ============================================================================
-- Travelintrips / Core AI Foundation — AI Coding Task Graph
--
-- Durable multi-workstream planning state for the AI Coding control plane.
-- Additive and idempotent. This migration does not start workers or execute AI.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_task_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  contract_version INTEGER NOT NULL DEFAULT 1,
  plan_hash TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREPARED',
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_coding_task_graphs_status_check CHECK (
    status IN ('PREPARED','APPROVED','RUNNING','COMPLETED','FAILED','CANCELLED')
  ),
  CONSTRAINT ai_coding_task_graphs_version_check CHECK (version > 0),
  CONSTRAINT ai_coding_task_graphs_contract_version_check CHECK (contract_version > 0),
  CONSTRAINT ai_coding_task_graphs_plan_hash_check CHECK (plan_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_task_graphs_task_version_uidx
  ON ai_platform.ai_coding_task_graphs (task_id, version);
CREATE INDEX IF NOT EXISTS ai_coding_task_graphs_task_idx
  ON ai_platform.ai_coding_task_graphs (task_id);
CREATE INDEX IF NOT EXISTS ai_coding_task_graphs_status_idx
  ON ai_platform.ai_coding_task_graphs (status);

CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_workstreams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL REFERENCES ai_platform.ai_coding_task_graphs(id) ON DELETE CASCADE,
  workstream_key TEXT NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  priority INTEGER NOT NULL DEFAULT 50,
  ownership_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_profiles JSONB NOT NULL DEFAULT '[]'::jsonb,
  worker_id TEXT,
  branch_name TEXT,
  base_sha TEXT,
  head_sha TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  result_json JSONB,
  error_message TEXT,
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_coding_workstreams_status_check CHECK (
    status IN (
      'PENDING','READY','CLAIMED','RUNNING','REVIEW_REQUIRED',
      'BLOCKED','COMPLETED','FAILED','CANCELLED'
    )
  ),
  CONSTRAINT ai_coding_workstreams_priority_check CHECK (priority BETWEEN 0 AND 100),
  CONSTRAINT ai_coding_workstreams_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_workstreams_graph_key_uidx
  ON ai_platform.ai_coding_workstreams (graph_id, workstream_key);
CREATE INDEX IF NOT EXISTS ai_coding_workstreams_graph_idx
  ON ai_platform.ai_coding_workstreams (graph_id);
CREATE INDEX IF NOT EXISTS ai_coding_workstreams_status_idx
  ON ai_platform.ai_coding_workstreams (status);

CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_workstream_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL REFERENCES ai_platform.ai_coding_task_graphs(id) ON DELETE CASCADE,
  workstream_id UUID NOT NULL REFERENCES ai_platform.ai_coding_workstreams(id) ON DELETE CASCADE,
  depends_on_workstream_id UUID NOT NULL REFERENCES ai_platform.ai_coding_workstreams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_coding_workstream_dependencies_not_self CHECK (
    workstream_id <> depends_on_workstream_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_workstream_dependencies_pair_uidx
  ON ai_platform.ai_coding_workstream_dependencies (workstream_id, depends_on_workstream_id);
CREATE INDEX IF NOT EXISTS ai_coding_workstream_dependencies_graph_idx
  ON ai_platform.ai_coding_workstream_dependencies (graph_id);
CREATE INDEX IF NOT EXISTS ai_coding_workstream_dependencies_workstream_idx
  ON ai_platform.ai_coding_workstream_dependencies (workstream_id);
