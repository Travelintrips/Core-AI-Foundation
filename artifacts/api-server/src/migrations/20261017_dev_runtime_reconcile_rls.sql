-- DEV ONLY: apply to CST-DEV, never to legacy PROD.
-- Runtime role already has SELECT and column-scoped UPDATE privileges.
-- RLS had no applicable policies, making these privileges ineffective.
-- Policies grant no additional table or column privileges.
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_coding_tasks','ai_coding_runs','ai_coding_autonomous_tasks']
  LOOP
    EXECUTE format('CREATE POLICY aicore_dev_runtime_read ON ai_platform.%I FOR SELECT TO aicore_dev_runtime USING (true)',t);
    EXECUTE format('CREATE POLICY aicore_dev_runtime_reconcile ON ai_platform.%I FOR UPDATE TO aicore_dev_runtime USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
COMMIT;
