-- ============================================================================
-- Travelintrips / Core AI Foundation — AI Coding Multi-Worker Execution
--
-- Additive child task/run/job bindings for durable multi-worker execution.
-- Safe after ai-coding-task-graph.sql and ai-coding-multi-worker-leases.sql.
-- ============================================================================

ALTER TABLE ai_platform.ai_coding_workstreams
  ADD COLUMN IF NOT EXISTS child_task_id UUID
    REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS child_run_id UUID
    REFERENCES ai_platform.ai_coding_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_id INTEGER
    REFERENCES ai_platform.ai_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_coding_workstreams_child_task_idx
  ON ai_platform.ai_coding_workstreams (child_task_id);

CREATE INDEX IF NOT EXISTS ai_coding_workstreams_job_idx
  ON ai_platform.ai_coding_workstreams (job_id);
