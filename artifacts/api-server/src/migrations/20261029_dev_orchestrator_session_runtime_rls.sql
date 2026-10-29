-- DEV project xssrfshdrtdfupgqwfdw ONLY; not for PROD.
-- Coding sessions must reference an existing canonical CWS run.
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') THEN
    RAISE EXCEPTION 'Missing DEV runtime';
  END IF;
END $$;
GRANT SELECT, INSERT ON ai_platform.ai_orchestrator_sessions TO aicore_dev_runtime;
GRANT USAGE ON SEQUENCE ai_platform.ai_orchestrator_sessions_id_seq TO aicore_dev_runtime;

DROP POLICY IF EXISTS aicore_dev_coding_session_select ON ai_platform.ai_orchestrator_sessions;
CREATE POLICY aicore_dev_coding_session_select ON ai_platform.ai_orchestrator_sessions
  FOR SELECT TO aicore_dev_runtime
  USING (agent_id='coding-orchestrator' AND session_id ~ '^coding-[0-9a-f-]{36}$');

DROP POLICY IF EXISTS aicore_dev_coding_session_insert ON ai_platform.ai_orchestrator_sessions;
CREATE POLICY aicore_dev_coding_session_insert ON ai_platform.ai_orchestrator_sessions
  FOR INSERT TO aicore_dev_runtime
  WITH CHECK (
    agent_id='coding-orchestrator'
    AND total_tokens=0 AND total_requests=0 AND last_model_used IS NULL
    AND session_id ~ '^coding-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (
      SELECT 1 FROM ai_platform.ai_coding_runs r
      JOIN ai_platform.ai_coding_tasks t ON t.id=r.task_id
      WHERE r.id=substring(session_id from 8)::uuid
        AND t.task_number ~ '^CWS-[A-F0-9]{8}$'
    )
  );
