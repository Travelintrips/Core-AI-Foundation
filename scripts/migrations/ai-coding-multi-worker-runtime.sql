-- ============================================================================
-- Travelintrips / Core AI Foundation — AI Coding Multi-Worker Runtime
--
-- Additive follow-up to ai-coding-task-graph.sql.
-- Safe for databases where the original task-graph migration already ran.
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
