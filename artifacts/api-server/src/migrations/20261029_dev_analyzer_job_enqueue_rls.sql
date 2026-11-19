-- DEV ONLY: xssrfshdrtdfupgqwfdw. Do not apply to PROD.
-- Restrict runtime queue insertion to a canonical coding run and its analyzer.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') THEN
    RAISE EXCEPTION 'Missing isolated DEV runtime role';
  END IF;
END $$;
GRANT INSERT ON ai_platform.ai_jobs TO aicore_dev_runtime;
GRANT USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq TO aicore_dev_runtime;
DROP POLICY IF EXISTS aicore_dev_analyzer_enqueue ON ai_platform.ai_jobs;
CREATE POLICY aicore_dev_analyzer_enqueue ON ai_platform.ai_jobs
  FOR INSERT TO aicore_dev_runtime WITH CHECK (
    job_type='coding_repository_analyzer'
    AND status='queued'
    AND required_capability='coding_repository_analyzer_on_demand'
    AND max_retry=0 AND retry_strategy='manual'
    AND payload_json ? 'codingRunId'
    AND payload_json ? 'codingTaskId'
    AND payload_json ? 'orchestratorSessionId'
    AND (payload_json->>'codingRunId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (payload_json->>'codingTaskId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND payload_json->>'orchestratorSessionId' = 'coding-' || (payload_json->>'codingRunId')
    AND EXISTS (
      SELECT 1 FROM ai_platform.ai_coding_runs r
      JOIN ai_platform.ai_coding_tasks t ON t.id=r.task_id
      WHERE r.id=(payload_json->>'codingRunId')::uuid
        AND t.id=(payload_json->>'codingTaskId')::uuid
        AND t.task_number ~ '^CWS-[A-F0-9]{8}$'
    )
  );
