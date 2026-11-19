-- DEV ONLY: apply solely to Supabase DEV project xssrfshdrtdfupgqwfdw.
-- Use existing Human Task Center as the escalation registry. One Human Task per originating job.
-- This migration does NOT dispatch/resume workers, change job statuses or touch PROD.
CREATE UNIQUE INDEX IF NOT EXISTS ai_human_tasks_dev_lifecycle_job_unique
  ON ai_platform.ai_human_tasks(source_id)
  WHERE source_module = 'ai_core_lifecycle' AND source_type = 'job' AND source_id IS NOT NULL;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
GRANT SELECT, INSERT, UPDATE ON ai_platform.ai_human_tasks TO aicore_dev_runtime;
GRANT SELECT, INSERT ON ai_platform.ai_human_task_history TO aicore_dev_runtime;
GRANT USAGE, SELECT ON SEQUENCE ai_platform.ai_human_tasks_id_seq TO aicore_dev_runtime;
GRANT USAGE, SELECT ON SEQUENCE ai_platform.ai_human_task_history_id_seq TO aicore_dev_runtime;
DROP POLICY IF EXISTS dev_lifecycle_human_tasks_read ON ai_platform.ai_human_tasks;
CREATE POLICY dev_lifecycle_human_tasks_read ON ai_platform.ai_human_tasks
  FOR SELECT TO aicore_dev_runtime USING (source_module='ai_core_lifecycle');
DROP POLICY IF EXISTS dev_lifecycle_human_tasks_insert ON ai_platform.ai_human_tasks;
CREATE POLICY dev_lifecycle_human_tasks_insert ON ai_platform.ai_human_tasks
  FOR INSERT TO aicore_dev_runtime WITH CHECK (source_module='ai_core_lifecycle' AND source_type='job');
DROP POLICY IF EXISTS dev_lifecycle_human_tasks_update ON ai_platform.ai_human_tasks;
CREATE POLICY dev_lifecycle_human_tasks_update ON ai_platform.ai_human_tasks
  FOR UPDATE TO aicore_dev_runtime USING (source_module='ai_core_lifecycle')
  WITH CHECK (source_module='ai_core_lifecycle' AND source_type='job');
DROP POLICY IF EXISTS dev_lifecycle_history_read ON ai_platform.ai_human_task_history;
CREATE POLICY dev_lifecycle_history_read ON ai_platform.ai_human_task_history
  FOR SELECT TO aicore_dev_runtime USING (EXISTS (SELECT 1 FROM ai_platform.ai_human_tasks t WHERE t.id=task_id AND t.source_module='ai_core_lifecycle'));
DROP POLICY IF EXISTS dev_lifecycle_history_insert ON ai_platform.ai_human_task_history;
CREATE POLICY dev_lifecycle_history_insert ON ai_platform.ai_human_task_history
  FOR INSERT TO aicore_dev_runtime WITH CHECK (EXISTS (SELECT 1 FROM ai_platform.ai_human_tasks t WHERE t.id=task_id AND t.source_module='ai_core_lifecycle'));
