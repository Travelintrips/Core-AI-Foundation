-- ============================================================================
-- Travelintrips / Core AI Foundation — AI Coding Workspace (Phase 1)
--
-- Additive, idempotent development/production migration.
-- This phase stores task metadata only. It does not execute agents, commit to
-- GitHub, create pull requests, or modify existing AI agent records.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  repository TEXT NOT NULL,
  branch TEXT NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  priority INTEGER NOT NULL DEFAULT 50,
  result_summary TEXT,
  commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_coding_tasks_status_check CHECK (
    status IN (
      'PENDING', 'ANALYZING', 'CODING', 'TESTING', 'COMMITTING',
      'PR_CREATED', 'READY_REVIEW', 'COMPLETED', 'FAILED'
    )
  ),
  CONSTRAINT ai_coding_tasks_priority_check CHECK (priority BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  logs TEXT,
  error_message TEXT,
  CONSTRAINT ai_coding_runs_status_check CHECK (
    status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')
  )
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_code_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL,
  commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_code_changes_type_check CHECK (
    change_type IN ('ADDED', 'MODIFIED', 'DELETED', 'RENAMED')
  )
);

CREATE INDEX IF NOT EXISTS ai_coding_tasks_status_idx
  ON ai_platform.ai_coding_tasks (status);
CREATE INDEX IF NOT EXISTS ai_coding_tasks_created_at_idx
  ON ai_platform.ai_coding_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_coding_runs_task_id_idx
  ON ai_platform.ai_coding_runs (task_id);
CREATE INDEX IF NOT EXISTS ai_code_changes_task_id_idx
  ON ai_platform.ai_code_changes (task_id);