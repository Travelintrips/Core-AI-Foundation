-- Supabase DEV xssrfshdrtdfupgqwfdw only; never apply to production.
-- Allow the isolated runtime to claim previously authorized coding analyzer jobs.
GRANT UPDATE (started_at) ON ai_platform.ai_jobs TO aicore_dev_runtime;
DROP POLICY IF EXISTS aicore_dev_analyzer_claim_update ON ai_platform.ai_jobs;
CREATE POLICY aicore_dev_analyzer_claim_update ON ai_platform.ai_jobs
FOR UPDATE TO aicore_dev_runtime
USING (
  job_type='coding_repository_analyzer'
  AND status IN ('queued','running')
  AND required_capability='coding_repository_analyzer_on_demand'
  AND payload_json ? 'codingRunId'
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_runs r
    JOIN ai_platform.ai_coding_tasks t ON t.id=r.task_id
    WHERE (payload_json->>'codingRunId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND r.id=(payload_json->>'codingRunId')::uuid
      AND t.task_number ~ '^CWS-[A-F0-9]{8}$'
  )
)
WITH CHECK (
  job_type='coding_repository_analyzer'
  AND status='running'
  AND required_capability='coding_repository_analyzer_on_demand'
  AND payload_json ? 'codingRunId'
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_runs r
    JOIN ai_platform.ai_coding_tasks t ON t.id=r.task_id
    WHERE (payload_json->>'codingRunId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND r.id=(payload_json->>'codingRunId')::uuid
      AND t.task_number ~ '^CWS-[A-F0-9]{8}$'
  )
);
