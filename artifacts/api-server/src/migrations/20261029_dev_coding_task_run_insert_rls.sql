-- DEV only. Apply exclusively to Supabase project xssrfshdrtdfupgqwfdw.
-- Do not grant to anon, authenticated or a production runtime.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') THEN
    RAISE EXCEPTION 'Isolated DEV runtime role missing';
  END IF;
END $$;

GRANT INSERT ON ai_platform.ai_coding_tasks TO aicore_dev_runtime;
GRANT INSERT ON ai_platform.ai_coding_runs TO aicore_dev_runtime;

DROP POLICY IF EXISTS aicore_dev_runtime_create_task ON ai_platform.ai_coding_tasks;
CREATE POLICY aicore_dev_runtime_create_task ON ai_platform.ai_coding_tasks
  FOR INSERT TO aicore_dev_runtime WITH CHECK (
    task_number ~ '^CWS-[A-F0-9]{8}$'
    AND status = 'PENDING'
    AND priority BETWEEN 0 AND 100
    AND length(trim(project_name)) > 0
    AND length(trim(repository)) > 0
    AND length(trim(instruction)) > 0
  );

DROP POLICY IF EXISTS aicore_dev_runtime_create_run ON ai_platform.ai_coding_runs;
CREATE POLICY aicore_dev_runtime_create_run ON ai_platform.ai_coding_runs
  FOR INSERT TO aicore_dev_runtime WITH CHECK (
    agent_name = 'Coding Orchestrator'
    AND status = 'RUNNING'
    AND EXISTS (
      SELECT 1 FROM ai_platform.ai_coding_tasks t
      WHERE t.id = task_id AND t.task_number ~ '^CWS-[A-F0-9]{8}$'
    )
  );
